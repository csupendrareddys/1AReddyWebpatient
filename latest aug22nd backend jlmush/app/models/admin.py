"""
Admin model.

Changes from original model.py:
- All models inherit TenantMixin (adds tenant_id FK)
- Admin: REMOVED first_name, middle_name, last_name  — these now live on User
- Admin.full_name property delegates to self.user.full_name
- Admin.to_dict() sources name fields from self.user
- AdminProfileExtended has been PRUNED — its data now lives in the consolidated
  profile_extended table (profile_shared.py :: ProfileExtended)
- All DateTime columns use timezone=True
"""
import uuid

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import PublishStatus


class Admin(TenantMixin, db.Model):
    """
    Admin profile extending the User model.

    User.role determines admin type:
    - SUPER_ADMIN: Full access to all features, bypasses permission checks
    - SUB_ADMIN: Limited access controlled via RBAC (PermissionService.check())
    """
    __tablename__ = 'admins'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='admin_id')
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        unique=True,
        nullable=False,
        index=True
    )

    # NOTE: Legacy permissions column removed. Use RBAC system (PermissionService.check()) instead.

    # Who created this admin (for audit trail)
    created_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)

    # Publish status (placeholder for admins — only profile completion is active)
    publish_status = db.Column(
        db.Enum(PublishStatus, values_callable=lambda x: [e.value for e in x]),
        default=PublishStatus.INACTIVE,
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    activated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    user = db.relationship('User', back_populates='admin_profile', foreign_keys=[user_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id], backref='created_admins')
    # Centralized profile-detail owner (see docs/profile-owner-centralization.md).
    profile_owner = db.relationship('ProfileOwner', back_populates='admin', uselist=False)

    @property
    def full_name(self):
        """Delegate to the linked User's full_name."""
        if self.user:
            return self.user.full_name
        return ''

    # ── Backward-compat property shims (same pattern as Doctor) ──────────
    # ``first_name`` / ``middle_name`` / ``last_name`` / ``gender`` / ``dob``
    # / ``profile_image`` / ``about`` / ``signature_image`` moved off Admin
    # / AdminProfileExtended into User / dedicated tables. Older code
    # that reads ``admin.first_name`` etc. used to AttributeError;
    # these forward to the right source-of-truth so call sites just work.

    @property
    def first_name(self):
        return self.user.first_name if self.user else None

    @property
    def middle_name(self):
        return self.user.middle_name if self.user else None

    @property
    def last_name(self):
        return self.user.last_name if self.user else None

    @property
    def gender(self):
        return self.user.gender if self.user else None

    @property
    def dob(self):
        return self.user.dob if self.user else None

    @property
    def profile_image(self):
        return self.user.profile_image if self.user else None

    @property
    def about(self):
        from app.models.profile_shared import ProfileAbout
        row = ProfileAbout.query.filter_by(admin_id=self.id).first()
        return row.brief_about_text if row else None

    @property
    def signature_image(self):
        from app.models.profile_shared import ProfileSignature
        row = ProfileSignature.query.filter_by(admin_id=self.id).first()
        return row.signature1_url if row else None

    def to_dict(self, include_user=False):
        data = {
            'id': str(self.id),
            'user_id': str(self.user_id),
            'full_name': self.full_name,
            # Name fields sourced from User
            'first_name': self.user.first_name if self.user else None,
            'middle_name': self.user.middle_name if self.user else None,
            'last_name': self.user.last_name if self.user else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'is_deleted': self.is_deleted,
            'publish_status': self.publish_status.value if self.publish_status else 'inactive',
        }
        if self.created_by_id:
            data['created_by_id'] = str(self.created_by_id)
        if include_user and self.user:
            data['user_details'] = self.user.to_dict()
            data['role'] = self.user.role.value
            data['status'] = self.user.status.value
        return data

    def __repr__(self):
        return f"<Admin {self.full_name}>"


# AdminProfileExtended was PRUNED — its data now lives in the consolidated
# profile_extended table (app/models/profile_shared.py :: ProfileExtended),
# reached via the admin's central profile_owner row. The legacy
# admin_profiles_extended table is dropped by migration aa11bb22cc33.



# NOTE: AdminSignature, AdminAbout, AdminEducation, AdminBankAccount,
# AdminDeclarationResponse, AdminDocument have been merged into polymorphic
# models in app/models/profile_shared.py (ProfileSignature, ProfileAbout, etc.)
# with entity_type='admin' + entity_id=admin_id.
