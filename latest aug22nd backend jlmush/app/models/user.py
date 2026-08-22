"""
User and UserSession models.

Changes from original model.py:
- Inherits TenantMixin (adds tenant_id FK)
- _email_hash / _phone_hash are now tenant-scoped unique constraints
- Added: middle_name, gender, dob, profile_image columns
- Added: full_name property
- All DateTime columns use timezone=True
"""
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON
from werkzeug.security import generate_password_hash, check_password_hash

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin, utcnow
from app.models._enums import UserStatus, UserRole, Gender


class User(TenantMixin,TimestampMixin,SoftDeleteMixin, db.Model):
    """
    Core user model with authentication, authorization, and profile management.

    Sensitive fields (email, phone) are encrypted at rest with AES-256.
    Searchable fields have a SHA-256 hash for lookup.
    """
    __tablename__ = 'users'

    # Primary Key
    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name='user_id'
    )

    # Authentication fields - ENCRYPTED
    # Email: encrypted value + hash for search
    _email_encrypted = db.Column(db.Text, nullable=True)
    _email_hash = db.Column(db.String(64), nullable=True, index=True)

    # Phone: encrypted value + hash for search
    _phone_encrypted = db.Column(db.Text, nullable=True)
    _phone_hash = db.Column(db.String(64), nullable=False, index=True)

    # Password (bcrypt hashed - not encrypted)
    password_hash = db.Column(db.String(256), nullable=False)

    # User information (not encrypted - public info)
    first_name = db.Column(db.String(150), nullable=False, default='')
    middle_name = db.Column(db.String(100), nullable=True)
    last_name = db.Column(db.String(150), nullable=True, default='')
    gender = db.Column(db.Enum(Gender), nullable=True)
    dob = db.Column(db.Date, nullable=True)
    profile_image = db.Column(db.String(500), nullable=True)
    referral_code = db.Column(db.String(12), nullable=True, default='')
    state = db.Column(db.String(150), nullable=True, default='')

    # Status and role
    status = db.Column(
        db.Enum(UserStatus),
        default=UserStatus.PENDING,
        nullable=False,
        index=True
    )
    role = db.Column(
        db.Enum(UserRole),
        default=UserRole.PATIENT,
        nullable=False,
        index=True
    )

    # Timestamps
    last_login = db.Column(db.DateTime(timezone=True), nullable=True, index=True)

    # Security fields
    failed_login_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime(timezone=True), nullable=True)

    # Email verification
    email_verified = db.Column(db.Boolean, default=False, nullable=False, index=True)

    # Phone verification (Round 8.5). Mirror of ``email_verified`` for the
    # phone column — flipped to True after a /pre-signup/verify-phone-otp
    # round OR via the activation flow (when a doctor activates an
    # admin-created invite). Existing rows backfilled to True by the
    # migration (every pre-Round-8.5 user went through the OTP signup).
    phone_verified = db.Column(
        db.Boolean, default=False, nullable=False, server_default='false', index=True,
    )

    # First-login password gate. Set to True when an account is auto-created
    # by the public anonymous booking flow (no password ever entered by the
    # user). The patient logs in once via phone-OTP, and the patient route
    # guard then forces them through ``/book/set-password`` before letting
    # them reach the dashboard. Cleared when ``POST /auth/set-initial-password``
    # succeeds.
    must_set_password = db.Column(
        db.Boolean, default=False, nullable=False, server_default='false', index=True,
    )

    # Managed (guardian-owned) account — e.g. a MINOR sub-profile a patient
    # guardian creates and switches into. It is a real Patient+User (so it
    # reuses the whole patient system) but must NEVER authenticate: it carries an
    # unusable password + INACTIVE status, and this flag makes every sign-in /
    # OTP / reset path fail closed explicitly. The guardian operates it through
    # the patient-family "act as" scope, not a login.
    is_managed = db.Column(
        db.Boolean, default=False, nullable=False, server_default='false', index=True,
    )

    # Relationships - Healthcare profiles
    doctor_profile = db.relationship(
        'Doctor',
        back_populates='user',
        uselist=False,
        cascade="all, delete-orphan",
        foreign_keys="[Doctor.user_id]"
    )
    patient_profile = db.relationship(
        'Patient',
        back_populates='user',
        # Round-10 followup: Patient now has TWO FKs to User
        # (``user_id`` for the actual patient row, and
        # ``invited_by_user_id`` for the doctor/admin who created
        # them via invite). Pin the user-profile relationship to
        # the original ``user_id`` FK or SQLAlchemy raises
        # AmbiguousForeignKeysError trying to compute the join.
        foreign_keys='Patient.user_id',
        uselist=False,
        cascade="all, delete-orphan",
    )
    pharmacy_profile = db.relationship(
        'Pharmacy',
        back_populates='user',
        uselist=False,
        cascade="all, delete-orphan"
    )
    admin_profile = db.relationship(
        'Admin',
        back_populates='user',
        uselist=False,
        cascade="all, delete-orphan",
        foreign_keys="[Admin.user_id]"
    )
    addresses = db.relationship(
        'Address',
        back_populates='user',
        lazy='dynamic',
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint('failed_login_attempts >= 0', name='check_failed_attempts'),
        Index('ix_users_status_role', 'status', 'role'),
        UniqueConstraint('tenant_id', '_email_hash', name='uq_users_tenant_email'),
        UniqueConstraint('tenant_id', '_phone_hash', name='uq_users_tenant_phone'),
        Index('ix_users_active', 'tenant_id', 'status', postgresql_where=text('is_deleted = FALSE')),
    )

    # --- Encrypted Field Properties ---

    @property
    def email(self):
        """Get decrypted email."""
        if not self._email_encrypted:
            return None
        try:
            from app.common.encryption import decrypt
            return decrypt(self._email_encrypted)
        except Exception:
            return None

    @email.setter
    def email(self, value):
        """Set encrypted email with hash for search."""
        if value:
            from app.common.encryption import encrypt, hash_for_search
            self._email_encrypted = encrypt(value)
            self._email_hash = hash_for_search(value)
        else:
            self._email_encrypted = None
            self._email_hash = None

    @property
    def phone_number(self):
        """Get decrypted phone number."""
        if not self._phone_encrypted:
            return None
        try:
            from app.common.encryption import decrypt
            return decrypt(self._phone_encrypted)
        except Exception:
            return None

    @phone_number.setter
    def phone_number(self, value):
        """Set encrypted phone number with hash for search."""
        if value:
            from app.common.encryption import encrypt, hash_for_search
            self._phone_encrypted = encrypt(value)
            self._phone_hash = hash_for_search(value)
        else:
            self._phone_encrypted = None
            self._phone_hash = None

    @property
    def full_name(self):
        """Return the user's full name, joining non-empty parts."""
        return ' '.join(filter(None, [self.first_name, self.middle_name, self.last_name]))

    # Authentication methods
    def set_password(self, password):
        """Hashes and stores the password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Verifies the provided password against stored hash."""
        return check_password_hash(self.password_hash, password)

    # Security methods
    def increment_failed_login(self):
        """Increments failed login attempts and locks account if threshold exceeded."""
        self.failed_login_attempts = (self.failed_login_attempts or 0) + 1
        if self.failed_login_attempts >= 5:
            self.locked_until = datetime.now(timezone.utc) + timedelta(minutes=30)

    def reset_failed_login(self):
        """Resets failed login attempts on successful login."""
        self.failed_login_attempts = 0
        self.locked_until = None

    def is_account_locked(self):
        """Checks if account is currently locked."""
        if not self.locked_until:
            return False
        now = datetime.now(timezone.utc)
        if now < self.locked_until:
            return True
        # Lock expired → reset counters
        self.reset_failed_login()
        return False

    # Serialization
    def to_dict(self, include_sensitive=False):
        """Serializes User object to dictionary."""
        data = {
            'id': str(self.id),
            'email': self.email,  # Decrypted via property
            'first_name': self.first_name,
            'middle_name': self.middle_name,
            'last_name': self.last_name,
            'full_name': self.full_name,
            'gender': self.gender.value if self.gender else None,
            'dob': self.dob.isoformat() if self.dob else None,
            'profile_image': self.profile_image,
            'phone_number': self.phone_number,  # Decrypted via property
            'status': self.status.value,
            'role': self.role.value,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'email_verified': self.email_verified,
            # Surfaced so the frontend route guard can force-redirect
            # auto-created (public-booking) accounts to the set-password
            # screen on first login.
            'must_set_password': self.must_set_password,
        }

        # Include admin permissions for admin users. The legacy
        # ``Admin.permissions`` column was removed in favour of the RBAC
        # system (app/models/rbac.py); resolve fresh from there if a
        # profile exists.
        if self.role in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN):
            data['permissions'] = getattr(self.admin_profile, 'permissions', None) or []

        if include_sensitive:
            data.update({
                'updated_at': self.updated_at.isoformat() if self.updated_at else None,
                'failed_login_attempts': self.failed_login_attempts,
                'is_locked': self.is_account_locked()
            })
        return data

    def __repr__(self):
        return f"<User {self.email} ({self.role.value})>"


class UserSession(TenantMixin, db.Model):
    """
    User session for multi-device authentication.
    Each session represents a login from a specific device.
    Enables per-device logout and instant invalidation via Redis.
    """
    __tablename__ = 'user_sessions'

    # Primary Key - also used as session_id in JWT claims
    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        name='session_id'
    )

    # Foreign Key to User
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Refresh token (hashed for security)
    refresh_token_hash = db.Column(db.String(256), nullable=False)

    # Device identification for session management UI
    device_fingerprint = db.Column(db.String(500), nullable=True)  # JSON: {browser, device_type, user_agent, ip}

    # Session timing
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)  # Refresh token expiry (15 days, extendable)
    absolute_expiry = db.Column(db.DateTime(timezone=True), nullable=False)  # Hard limit (60 days from login)
    last_refreshed_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    # Revocation status
    is_revoked = db.Column(db.Boolean, default=False, nullable=False, index=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationship
    user = db.relationship(
        'User',
        backref=db.backref('sessions', lazy='dynamic', cascade='all, delete-orphan')
    )

    __table_args__ = (
        Index('ix_user_sessions_tenant_user_revoked', 'tenant_id', 'user_id', 'is_revoked'),
        Index('ix_user_sessions_tenant_expires', 'tenant_id', 'expires_at'),
    )

    def set_refresh_token(self, refresh_token):
        """Hash and store the refresh token."""
        self.refresh_token_hash = generate_password_hash(refresh_token)

    def check_refresh_token(self, refresh_token):
        """Verify refresh token against stored hash."""
        if not self.refresh_token_hash:
            return False
        return check_password_hash(self.refresh_token_hash, refresh_token)

    def is_expired(self):
        """Check if session has expired (either soft or hard expiry)."""
        now = utcnow()
        return now > self.expires_at or now > self.absolute_expiry

    def is_past_rotation_threshold(self, threshold_days=7):
        """Check if session is past the rotation threshold."""
        threshold = self.last_refreshed_at + timedelta(days=threshold_days)
        return utcnow() > threshold

    def rotate_token(self, new_refresh_token, new_expiry_days=15):
        """Rotate the refresh token and extend expiry."""
        self.set_refresh_token(new_refresh_token)
        self.last_refreshed_at = utcnow()
        self.expires_at = utcnow() + timedelta(days=new_expiry_days)

    def revoke(self):
        """Mark session as revoked."""
        self.is_revoked = True
        self.revoked_at = utcnow()

    def to_dict(self, include_token=False):
        """Serialize session for API response."""
        data = {
            'session_id': str(self.id),
            'user_id': str(self.user_id),
            'device_fingerprint': self.device_fingerprint,
            'created_at':   self.created_at.isoformat() if self.created_at else None,
            'last_refreshed_at': self.last_refreshed_at.isoformat() if self.last_refreshed_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'is_revoked': self.is_revoked,
        }
        return data

    def __repr__(self):
        return f"<UserSession {self.id} user={self.user_id} revoked={self.is_revoked}>"
