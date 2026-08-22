"""
Auth Service
Business logic for authentication operations with Redis-backed refresh tokens.

Security Model:
- Refresh tokens are SINGLE-USE (enforced via Redis)
- Every refresh rotates the token
- Replay detection: missing token = immediate session revocation
- Redis failure = fail closed (401), NO database fallback
- Database stores sessions for audit only, NOT on refresh hot path

Features:
- Role-based signup for all user types
- Single login endpoint for all roles
- Session limit enforcement (1 per user by default)
- Per-device sessions with audit trail
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from flask import current_app
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from werkzeug.security import generate_password_hash, check_password_hash

from app.extensions import db
from app.models import User, UserSession, UserStatus, UserRole
from app.auth.session_store import SessionStore


class InvalidPassword(ValueError):
    """Re-authentication before a sensitive action failed."""


class AccountDeletionBlocked(ValueError):
    """The account anchors something that must be handed over before it
    can be deleted. ``code`` is machine-readable for the frontend."""

    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

logger = logging.getLogger(__name__)


class AuthService:
    """Service class for authentication operations."""
    
    @staticmethod
    def signup(data):
        """
        Register a new user with any role.
        
        Args:
            data: Dictionary with phone_number, password, first_name, state, role
                  Optional: email, last_name, referral_code
        
        Returns:
            Created User instance
        
        Raises:
            ValueError: If phone already exists, email exists (if provided), or invalid role
        """
        from app.common.encryption import hash_for_search
        
        logger.debug(f"[SVC:SIGNUP] ▶ START — role={data.get('role')}, email={data.get('email')}")
        
        # Validate role
        role_str = data.get('role', 'patient').lower()
        try:
            role = UserRole(role_str)
        except ValueError:
            valid_roles = [r.value for r in UserRole]
            raise ValueError(f"Invalid role. Must be one of: {', '.join(valid_roles)}")

        # ── Resolve tenant FIRST — same person can sign up at multiple
        #    tenants with the same phone/email. Per-tenant uniqueness is
        #    enforced at the DB layer by composite uniques on
        #    (tenant_id, _phone_hash) and (tenant_id, _email_hash).
        #
        # USER-CREATION INVARIANT (Phase 0):
        #   The new ``User`` row MUST take its ``tenant_id`` from
        #   ``g.tenant_id`` — the server-resolved request tenant. We
        #   intentionally IGNORE ``data['tenant_id']`` and treat
        #   ``data['tenant_slug']`` as a hint only when ``g.tenant_id``
        #   is unavailable AND the request is on the platform host
        #   (where ``before_request`` falls back to default). Trusting
        #   a request-body field would let a malicious client create
        #   accounts in arbitrary tenants.
        from flask import g, request
        from app.models import Tenant
        tenant_id = getattr(g, 'tenant_id', None)
        if not tenant_id:
            # Body-supplied slug is allowed only as a last-resort hint
            # for platform-host signups (e.g. self-serve tenant-signup
            # flow). Strict paths already 404 before we get here when
            # the host doesn't match a tenant.
            tenant_slug = (
                data.get('tenant_slug')
                or (request.headers.get('X-Tenant-Slug') if request else None)
            )
            if tenant_slug:
                t = Tenant.query.filter_by(slug=tenant_slug).first()
                if not t:
                    raise ValueError(f'Tenant "{tenant_slug}" not found.')
                tenant_id = t.id
        if not tenant_id:
            # No host match, no slug match. Refuse rather than silently
            # routing the new account to the default tenant. The old
            # fallback was the root of the cross-tenant signin leak's
            # twin: a signup that landed in the wrong tenant.
            raise ValueError('Tenant context required.')

        # ── Email uniqueness — PER TENANT (not global) ────────────
        email = data.get('email')
        if email:
            email_hash = hash_for_search(email)
            existing_email = User.query.filter_by(
                _email_hash=email_hash, tenant_id=tenant_id, is_deleted=False,
            ).first()
            if existing_email:
                logger.debug(f"[SVC:SIGNUP] ✗ Email already exists in tenant {tenant_id}")
                raise ValueError('Email already registered in this tenant.')

        # ── Phone uniqueness — PER TENANT ─────────────────────────
        phone_number = data['phone_number']  # Required field
        phone_hash = hash_for_search(phone_number)
        existing_phone = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if existing_phone:
            logger.debug(f"[SVC:SIGNUP] ✗ Phone already exists in tenant {tenant_id}")
            raise ValueError('Phone number already registered in this Platform.')
        
        # Phone OTP is mandatory pre-signup verification.
        phone_token = data.get('phone_verification_token')
        if not phone_token:
            raise ValueError('Phone verification is required. Please verify your phone number first.')
        phone_payload = AuthService._verify_pre_signup_token(phone_token, 'pre_signup_phone')
        if phone_payload.get('identifier') != phone_number:
            raise ValueError('Phone verification token does not match submitted phone number.')

        # Email OTP is mandatory IFF an email was supplied. We require
        # ownership proof because email is later used as a login
        # identifier and password-reset surface — accepting it on faith
        # lets an attacker squat someone else's address (audit found
        # this exact hole). If no email is supplied, signup proceeds
        # phone-only.
        email_verified = False
        if email:
            email_token = data.get('email_verification_token')
            if not email_token:
                raise ValueError(
                    'Email verification is required when an email is supplied. '
                    'Please verify your email first.'
                )
            email_payload = AuthService._verify_pre_signup_token(
                email_token, 'pre_signup_email'
            )
            # Compare normalized — token stores lowercased trimmed form.
            if email_payload.get('identifier') != AuthService._normalize_email(email):
                raise ValueError(
                    'Email verification token does not match submitted email.'
                )
            email_verified = True

        # Tenant was resolved upfront for the duplicate check — reuse it.
        # Create user
        user = User(
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            state=data.get('state', ''),
            referral_code=data.get('referral_code', ''),
            role=role,
            status=UserStatus.ACTIVE,
            tenant_id=tenant_id,
        )
        if email:
            user.email = email
            # Verified via the pre-signup email OTP token validated above.
            # Stays True for the lifetime of the row unless the user
            # explicitly changes their email post-signup (separate flow).
            user.email_verified = email_verified
        user.phone_number = phone_number  # Required, always set (verified via OTP above)
        # Round 8.5 — mirror ``email_verified`` semantics for the phone
        # column. Phone OTP has been validated above (mandatory in this
        # path), so the column truthfully reflects ownership proof.
        user.phone_verified = True
        user.set_password(data['password'])

        db.session.add(user)
        db.session.flush()  # Get user ID before creating profile
        logger.debug(f"[SVC:SIGNUP] User created: id={user.id}, role={role.value}")
        
        # Auto-create profile based on role. Every profile model inherits
        # TenantMixin, so the tenant_id resolved above must propagate.
        if role == UserRole.PATIENT:
            from app.models import Patient
            # Patient profile no longer carries name columns — they live on
            # User now (see docstring on app/models/patient.py).
            patient = Patient(
                user_id=user.id,
                tenant_id=tenant_id,
            )
            db.session.add(patient)
            logger.debug(f"[SVC:SIGNUP] Patient profile created")

            # Corporate patient → attach a core EntityProfile (no-op for an
            # individual). Docs/logos/personnel are completed later in the
            # profile. Shared helper handles all three owner types.
            db.session.flush()  # need patient.id for the owner FK
            AuthService._attach_entity_profile(data, tenant_id, patient_id=patient.id)

            # Marketplace (receiver) plan chosen at registration → create the
            # patient's membership and start it right away so the plan tag shows
            # on their dashboard. Best-effort: a bad/blank plan_code must never
            # block the signup that already succeeded.
            plan_code = data.get('plan_code') or data.get('membership_plan_code')
            if plan_code:
                try:
                    from app.api.membership.service import (
                        MembershipSubscriptionService,
                    )
                    sub = MembershipSubscriptionService.create_pending_for_patient(
                        patient_id=patient.id, user_id=user.id,
                        plan_code=plan_code,
                    )
                    MembershipSubscriptionService.activate_trial(sub)
                    logger.debug(
                        f"[SVC:SIGNUP] patient membership {plan_code} activated"
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        f"[SVC:SIGNUP] patient membership skipped ({plan_code}): {e}"
                    )
        elif role == UserRole.PHARMACY:
            from app.models import Pharmacy
            pharmacy = Pharmacy(
                user_id=user.id,
                tenant_id=tenant_id,
                name=data.get('first_name', ''),  # Use first_name as pharmacy name
            )
            db.session.add(pharmacy)
            logger.debug(f"[SVC:SIGNUP] Pharmacy profile created")
        # Doctor profile is created via signup_doctor endpoint
        # Admin profiles are created by super_admin
        
        db.session.commit()
        logger.debug(f"[SVC:SIGNUP] ✓ DONE — user_id={user.id}")

        # Welcome email — best-effort. SendClean failure must not roll
        # back the signup that already committed.
        if user.email:
            try:
                from app.services.email_service import EmailService
                EmailService.send_welcome_email(user)
            except Exception as e:
                logger.warning(f"[SVC:SIGNUP] welcome email failed (non-fatal): {e}")

        return user

    @staticmethod
    def signup_doctor(data, file_paths):
        """
        Register a new doctor with profile and qualifications.
        
        Args:
            data: Dictionary with personal, professional, and qualification info
            file_paths: Dictionary with paths to uploaded files:
                - registration_certificate: path to registration cert
                - aadhar_attachment: path to Aadhaar document
                - qualification_certificates: list of paths for each qualification
        
        Returns:
            Tuple of (User, Doctor) instances
        
        Raises:
            ValueError: If validation fails
        """
        from app.common.encryption import hash_for_search
        from app.models import Doctor, ProfileEducationDegree, UserVerificationStatus, get_or_create_profile_owner

        # ── Resolve tenant FIRST so dup-checks scope to it ────────
        # The same physical doctor can register at multiple clinics
        # using the same email / phone / MCI registration / Aadhaar.
        # Each clinic has its own User+Doctor row, scoped to its tenant.
        from flask import g, request
        from app.models import Tenant
        tenant_id = getattr(g, 'tenant_id', None)
        tenant_slug = (
            data.get('tenant_slug')
            or (request.headers.get('X-Tenant-Slug') if request else None)
        )
        if not tenant_id and tenant_slug:
            t = Tenant.query.filter_by(slug=tenant_slug).first()
            if not t:
                raise ValueError(f'Tenant "{tenant_slug}" not found.')
            tenant_id = t.id
        if not tenant_id:
            # Phase 0: refuse rather than silently route to default
            # tenant. ``before_request`` already 404s strict paths on
            # non-platform hosts; this is the platform-host-no-slug
            # case (e.g. self-serve doctor signup that didn't pass
            # tenant context).
            raise ValueError('Tenant context required.')

        # ── Plan / quota gate — branches by tenant kind ───────────────
        # Apex tenant (``larazen.in`` itself) = marketplace signup, must
        # bring a ``MembershipPlan`` code from the /join funnel.
        # Non-apex tenant = in-tenant signup, gated by the tenant's
        # provider-entity quota and (when the tenant has the matching
        # add-on + has authored ≥1 active plan) a tenant_provider_plan
        # picker. Both branches fail fast BEFORE any User/Doctor row is
        # written so a bad selection rejects with a 400 cleanly.
        _resolved_tenant_provider_plan = None
        if AuthService._runs_marketplace(tenant_id, 'doctor'):
            AuthService._assert_marketplace_plan_required(
                vertical='doctor', plan_code=data.get('plan_code'),
            )
        else:
            _resolved_tenant_provider_plan = (
                AuthService._assert_in_tenant_signup_allowed(
                    tenant_id=tenant_id,
                    vertical='doctor',
                    tenant_provider_plan_id=data.get(
                        'tenant_provider_plan_id'
                    ),
                )
            )

        # ── Email + phone uniqueness — PER TENANT ─────────────────
        email = data.get('email')
        email_hash = hash_for_search(email)
        existing_email = User.query.filter_by(
            _email_hash=email_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if existing_email:
            raise ValueError('Email already registered in this tenant.')

        phone_hash = hash_for_search(data['phone_number'])
        existing_phone = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if existing_phone:
            raise ValueError('Phone number already registered in this Platform.')

        # ── Registration number — PER TENANT ──────────────────────
        # Same physician's MCI/SMC number is the same physical credential
        # regardless of which clinic they affiliate with; uniqueness is
        # only meaningful inside one tenant's data.
        existing_reg = Doctor.query.filter_by(
            registration_number=data['registration_number'],
            tenant_id=tenant_id,
            is_deleted=False,
        ).first()
        if existing_reg:
            raise ValueError('Registration number already registered in this tenant.')

        # ── Aadhaar — PER TENANT ──────────────────────────────────
        # Same Aadhaar across tenants is expected (it identifies the
        # physical person); only flag a duplicate within the same tenant.
        aadhar = data.get('aadhar_number')
        if aadhar:
            existing_aadhar = Doctor.query.filter_by(
                aadhar_number=aadhar,
                tenant_id=tenant_id,
                is_deleted=False,
            ).first()
            if existing_aadhar:
                raise ValueError('Aadhaar number already registered in this tenant.')

        # Phone OTP is mandatory pre-signup verification.
        phone_token = data.get('phone_verification_token')
        if not phone_token:
            raise ValueError('Phone verification is required. Please verify your phone number first.')
        phone_payload = AuthService._verify_pre_signup_token(phone_token, 'pre_signup_phone')
        if phone_payload.get('identifier') != data['phone_number']:
            raise ValueError('Phone verification token does not match submitted phone number.')

        # Email OTP is mandatory for doctor signup — email is required
        # on the schema (registration emails / approval notifications go
        # there) and must be ownership-verified to prevent squatting.
        email_token = data.get('email_verification_token')
        if not email_token:
            raise ValueError('Email verification is required. Please verify your email first.')
        email_payload = AuthService._verify_pre_signup_token(
            email_token, 'pre_signup_email'
        )
        if email_payload.get('identifier') != AuthService._normalize_email(email):
            raise ValueError(
                'Email verification token does not match submitted email.'
            )

        # Tenant already resolved upfront for the duplicate checks.
        # Create user (pending status for admin approval)
        user = User(
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            state=data.get('state', ''),
            referral_code=data.get('referral_code', ''),
            role=UserRole.DOCTOR,
            status=UserStatus.PENDING,  # Requires admin approval
            tenant_id=tenant_id,
        )
        user.email = email
        # Verified via pre-signup email OTP token validated above.
        user.email_verified = True
        user.phone_number = data['phone_number']  # Verified via SMS OTP above
        # Round 8.5: mirror ``email_verified`` for the phone side. The
        # column was added in migration f2a3b4c5d6e7; the model default
        # is False but every legitimate signup has gone through SMS OTP
        # at this point, so we flip it here. Without this flip the new
        # ``PHONE_NOT_VERIFIED`` signin gate would reject every freshly-
        # signed-up doctor.
        user.phone_verified = True
        user.set_password(data['password'])

        db.session.add(user)
        db.session.flush()  # Get user ID

        # Create doctor profile.
        #
        # NB: ``first_name`` / ``last_name`` / ``middle_name`` /
        # ``gender`` / ``dob`` / ``profile_image`` were removed from
        # the Doctor model (see header comment in app/models/doctor.py)
        # and now live on the User row; the Doctor's ``to_dict``
        # proxies them via ``self.user.first_name`` etc. Passing them
        # into the constructor crashed signup with
        # ``TypeError: 'first_name' is an invalid keyword argument
        # for Doctor``.
        doctor = Doctor(
            user_id=user.id,
            tenant_id=tenant_id,
            aadhar_number=data['aadhar_number'],  # Will be encrypted at DB level if needed
            aadhar_attachment=file_paths['aadhar_attachment'],
            registration_number=data['registration_number'],
            registration_certificate=file_paths['registration_certificate'],
            verification_status=UserVerificationStatus.PENDING,
        )
        
        db.session.add(doctor)
        db.session.flush()  # Get doctor ID
        
        # Create qualifications. The signup form sends level-aware master-data
        # ids (degree_id / specialization_id / qualification_level /
        # year_of_passing) alongside the free-text names — consume them so the
        # doctor is immediately searchable / gate-eligible via the queryable FK
        # stores, instead of dropping them (they were validated then discarded,
        # leaving every new doctor invisible to specialization search). Mirrors
        # DoctorService.save_education's write-through. All id fields are
        # optional, so older frontend builds keep working (names only).
        from app.models import Category, ProfileEducationSpecialization
        from app.models.catalog import (
            CATEGORY_TYPE_SPECIALIZATION, CATEGORY_TYPE_DEGREE,
        )
        qualifications = data.get('qualifications', [])
        cert_paths = file_paths.get('qualification_certificates', [])
        owner_id = get_or_create_profile_owner('doctor', doctor.id, tenant_id).id

        def _valid_cat(cid, ctype):
            if not cid:
                return None
            c = Category.query.filter_by(
                tenant_id=tenant_id, id=cid, category_type=ctype,
            ).first()
            return c.id if c else None

        def _resolve_name(name, ctype):
            n = (name or '').strip()
            if not n:
                return None
            c = (Category.query
                 .filter(Category.tenant_id == tenant_id,
                         Category.category_type == ctype,
                         db.func.lower(Category.name) == n.lower())
                 .order_by(Category.is_active.desc())
                 .first())
            return c.id if c else None

        spec_desired = {}  # str(category_id) -> (level, is_primary)
        for i, qual in enumerate(qualifications):
            cert_path = cert_paths[i] if i < len(cert_paths) else ''
            raw_year = qual.get('year_of_passing')
            try:
                passing_year = int(str(raw_year).strip()) if raw_year not in (None, '') else None
            except (ValueError, TypeError):
                passing_year = None
            deg_cat = (_valid_cat(qual.get('degree_id'), CATEGORY_TYPE_DEGREE)
                       or _resolve_name(qual.get('degree_name'), CATEGORY_TYPE_DEGREE))
            qualification = ProfileEducationDegree(
                doctor_id=doctor.id,
                tenant_id=tenant_id,
                profile_owner_id=owner_id,
                degree_name=qual['degree_name'],
                institution=qual['institution'],
                certificate_link=cert_path,
                passing_year=passing_year,
                degree_category_id=deg_cat,
            )
            db.session.add(qualification)

            spec_cat = (_valid_cat(qual.get('specialization_id'), CATEGORY_TYPE_SPECIALIZATION)
                        or _resolve_name(qual.get('specialization_name'), CATEGORY_TYPE_SPECIALIZATION))
            if spec_cat and str(spec_cat) not in spec_desired:
                spec_desired[str(spec_cat)] = (qual.get('qualification_level'), i == 0)

        for cid, (level, primary) in spec_desired.items():
            db.session.add(ProfileEducationSpecialization(
                tenant_id=tenant_id, profile_owner_id=owner_id, doctor_id=doctor.id,
                category_id=cid, qualification_level=level, is_primary=primary,
            ))

        db.session.commit()

        # ── Membership / subscription attach ──────────────────────
        # Apex tenant → marketplace MembershipSubscription. Other
        # tenants → TenantProviderSubscription (only when the gate
        # above resolved a plan; if quota-only with no plan picker,
        # nothing to attach). Both are best-effort so the User+Doctor
        # rows stay committed even on attach failure.
        if AuthService._runs_marketplace(tenant_id, 'doctor'):
            plan_code = data.get('plan_code')
            if plan_code:
                from app.api.membership.service import (
                    MembershipAlreadyExists,
                    MembershipPlanInactive,
                    MembershipPlanNotFound,
                    MembershipPlanWrongVertical,
                    MembershipSubscriptionService,
                )
                try:
                    MembershipSubscriptionService.create_pending_for_doctor(
                        doctor_id=doctor.id,
                        user_id=user.id,
                        plan_code=plan_code,
                    )
                except (
                    MembershipPlanNotFound,
                    MembershipPlanInactive,
                    MembershipPlanWrongVertical,
                    MembershipAlreadyExists,
                ) as exc:
                    logger.warning(
                        "[SVC:SIGNUP_DOCTOR] membership attach failed for "
                        "user=%s doctor=%s plan_code=%s: %s",
                        user.id, doctor.id, plan_code, exc,
                    )
        else:
            AuthService._attach_in_tenant_subscription_or_warn(
                tenant_id=tenant_id,
                vertical='doctor',
                provider_id=doctor.id,
                user_id=user.id,
                tenant_provider_plan_id=(
                    _resolved_tenant_provider_plan.id
                    if _resolved_tenant_provider_plan is not None
                    else data.get('tenant_provider_plan_id')
                ),
            )

        # Doctor-flavored welcome email (mentions "pending approval"). Best-effort.
        if user.email:
            try:
                from app.services.email_service import EmailService
                EmailService.send_welcome_email(user)
            except Exception as e:
                logger.warning(f"[SVC:SIGNUP_DOCTOR] welcome email failed (non-fatal): {e}")

        return user, doctor

    @staticmethod
    def _resolve_apex_tenant_for_provider_signup(data):
        """Tenant resolver for marketplace facility signups.

        Marketplace clinic/hospital signups hit the apex
        (``larazen.in``) where ``before_request`` doesn't resolve a
        tenant. Falls back to the platform (``is_default=True``)
        tenant. Same shape as the doctor signup tenant resolver but
        without the optional ``X-Tenant-Slug`` override — marketplace
        provider rows always belong to the platform tenant.
        """
        from flask import g
        from app.models import Tenant
        tenant_id = getattr(g, 'tenant_id', None)
        if tenant_id:
            return tenant_id
        default_tenant = Tenant.query.filter_by(is_default=True).first()
        if not default_tenant:
            raise ValueError('Platform tenant not configured.')
        return default_tenant.id

    @staticmethod
    def _attach_entity_profile(data, tenant_id, *, hospital_id=None, clinic_id=None, patient_id=None):
        """Create a core EntityProfile for a corporate registrant, linked to
        exactly one owner (hospital / clinic / patient). No-op when the entity
        type is 'individual' or absent. Accepts either a nested ``entity`` dict
        (patient JSON signup) or flat ``entity_*`` form fields (facility
        multipart signup). Caller must have flushed so the owner id exists.

        Only text fields are captured here; logos, document attachments and
        authorized personnel are completed later in the profile.
        """
        entity = data.get('entity')
        if not entity and data.get('entity_type'):
            # Flat form-field shape (facility multipart signup).
            entity = {
                k: data.get(k) for k in (
                    'entity_type', 'entity_name', 'legal_name', 'trade_name',
                    'promoters', 'year_of_establishment',
                    'registration_license_number', 'cin_number', 'gst_number', 'pan_number',
                )
            }
        if not entity or (entity.get('entity_type') or 'individual') == 'individual':
            return None

        from app.models import EntityProfile, EntityType

        promoters = entity.get('promoters')
        if isinstance(promoters, str):
            promoters = [s.strip() for s in promoters.split(',') if s.strip()]

        year = entity.get('year_of_establishment')
        try:
            year = int(year) if year not in (None, '') else None
        except (TypeError, ValueError):
            year = None

        ep = EntityProfile(
            tenant_id=tenant_id,
            hospital_id=hospital_id, clinic_id=clinic_id, patient_id=patient_id,
            entity_type=EntityType(entity.get('entity_type')),
            entity_name=(entity.get('entity_name') or None),
            legal_name=(entity.get('legal_name') or None),
            trade_name=(entity.get('trade_name') or None),
            promoters=promoters or [],
            year_of_establishment=year,
            registration_license_number=(entity.get('registration_license_number') or None),
            cin_number=(entity.get('cin_number') or None),
            gst_number=(entity.get('gst_number') or None),
            pan_number=(entity.get('pan_number') or None),
        )
        db.session.add(ep)
        logger.debug('[SVC:SIGNUP] EntityProfile attached (%s)',
                     'hospital' if hospital_id else 'clinic' if clinic_id else 'patient')
        return ep

    @staticmethod
    def signup_clinic(data, file_paths):
        """Register a marketplace clinic on the apex.

        Mirrors ``signup_doctor`` minus the qualifications-array
        complexity. Creates:
          * one ``User`` row (role=CLINIC, status=PENDING),
          * one ``Clinic`` row (verification_status=PENDING) bound to
            that user via ``admin_user_id``,
          * optionally a PENDING ``MembershipSubscription`` row when
            ``data['plan_code']`` is set.

        File paths come from the route layer's S3 upload step. Phone
        + email OTPs are mandatory (same as doctor).

        Raises ``ValueError`` on validation / business-rule failures;
        the route layer translates to 422 / 409.
        """
        from app.common.encryption import hash_for_search
        from app.models import Clinic, UserVerificationStatus

        # Marketplace plan gate — see _assert_marketplace_plan_required.
        AuthService._assert_marketplace_plan_required(
            vertical='clinic', plan_code=data.get('plan_code'),
        )

        tenant_id = AuthService._resolve_apex_tenant_for_provider_signup(data)

        # ── Duplicate guards (per tenant) ─────────────────────────
        email = data.get('email')
        email_hash = hash_for_search(email) if email else None
        if email_hash:
            existing_email = User.query.filter_by(
                _email_hash=email_hash, tenant_id=tenant_id, is_deleted=False,
            ).first()
            if existing_email:
                raise ValueError('Email already registered.')

        phone_hash = hash_for_search(data['phone_number'])
        existing_phone = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if existing_phone:
            raise ValueError('Phone number already registered.')

        if data.get('registration_number'):
            existing_reg = Clinic.query.filter_by(
                registration_number=data['registration_number'],
                tenant_id=tenant_id,
                is_deleted=False,
            ).first()
            if existing_reg:
                raise ValueError(
                    'Registration number already registered for a clinic.'
                )

        # ── OTP gates (same shape as doctor) ──────────────────────
        phone_token = data.get('phone_verification_token')
        if not phone_token:
            raise ValueError(
                'Phone verification is required. '
                'Please verify your phone number first.'
            )
        phone_payload = AuthService._verify_pre_signup_token(
            phone_token, 'pre_signup_phone',
        )
        if phone_payload.get('identifier') != data['phone_number']:
            raise ValueError(
                'Phone verification token does not match submitted phone number.'
            )

        email_token = data.get('email_verification_token')
        if not email_token:
            raise ValueError(
                'Email verification is required. '
                'Please verify your email first.'
            )
        email_payload = AuthService._verify_pre_signup_token(
            email_token, 'pre_signup_email',
        )
        if email_payload.get('identifier') != AuthService._normalize_email(email):
            raise ValueError(
                'Email verification token does not match submitted email.'
            )

        # ── Create User + Clinic ──────────────────────────────────
        user = User(
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            state=data.get('state', ''),
            role=UserRole.CLINIC,
            status=UserStatus.PENDING,
            tenant_id=tenant_id,
        )
        user.email = email
        user.email_verified = True
        user.phone_number = data['phone_number']
        # Round 8.5 — see signup_doctor() above for rationale.
        user.phone_verified = True
        user.set_password(data['password'])
        db.session.add(user)
        db.session.flush()  # get user.id

        clinic = Clinic(
            tenant_id=tenant_id,
            admin_user_id=user.id,
            name=data['name'],
            registration_number=data.get('registration_number'),
            phone=data.get('phone') or data.get('phone_number'),
            email=email,
            website=data.get('website'),
            address=data['address'],
            city=data['city'],
            state=data.get('state', ''),
            pincode=data['pincode'],
            registration_certificate=file_paths.get('registration_certificate'),
            admin_aadhaar_attachment=file_paths.get('admin_aadhaar_attachment'),
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(clinic)
        db.session.flush()  # get clinic.id for the entity-profile owner FK
        AuthService._attach_entity_profile(data, tenant_id, clinic_id=clinic.id)
        db.session.commit()

        AuthService._attach_provider_membership_or_warn(
            vertical='clinic',
            provider_id=clinic.id,
            user_id=user.id,
            plan_code=data.get('plan_code'),
        )

        # Best-effort welcome email — same pattern as doctor signup.
        if user.email:
            try:
                from app.services.email_service import EmailService
                EmailService.send_welcome_email(user)
            except Exception as e:
                logger.warning(
                    f"[SVC:SIGNUP_CLINIC] welcome email failed (non-fatal): {e}"
                )

        return user, clinic

    @staticmethod
    def signup_hospital(data, file_paths):
        """Register a marketplace hospital on the apex.

        Same shape as ``signup_clinic`` but creates a ``Hospital`` row
        (with the hospital-specific ``hospital_type`` field) instead.
        """
        from app.common.encryption import hash_for_search
        from app.models import Hospital, UserVerificationStatus

        # Marketplace plan gate — see _assert_marketplace_plan_required.
        AuthService._assert_marketplace_plan_required(
            vertical='hospital', plan_code=data.get('plan_code'),
        )

        tenant_id = AuthService._resolve_apex_tenant_for_provider_signup(data)

        # ── Duplicate guards (per tenant) ─────────────────────────
        email = data.get('email')
        email_hash = hash_for_search(email) if email else None
        if email_hash:
            existing_email = User.query.filter_by(
                _email_hash=email_hash, tenant_id=tenant_id, is_deleted=False,
            ).first()
            if existing_email:
                raise ValueError('Email already registered.')

        phone_hash = hash_for_search(data['phone_number'])
        existing_phone = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if existing_phone:
            raise ValueError('Phone number already registered.')

        if data.get('registration_number'):
            existing_reg = Hospital.query.filter_by(
                registration_number=data['registration_number'],
                tenant_id=tenant_id,
                is_deleted=False,
            ).first()
            if existing_reg:
                raise ValueError(
                    'Registration number already registered for a hospital.'
                )

        # ── OTP gates (same shape as doctor / clinic) ─────────────
        phone_token = data.get('phone_verification_token')
        if not phone_token:
            raise ValueError(
                'Phone verification is required. '
                'Please verify your phone number first.'
            )
        phone_payload = AuthService._verify_pre_signup_token(
            phone_token, 'pre_signup_phone',
        )
        if phone_payload.get('identifier') != data['phone_number']:
            raise ValueError(
                'Phone verification token does not match submitted phone number.'
            )

        email_token = data.get('email_verification_token')
        if not email_token:
            raise ValueError(
                'Email verification is required. '
                'Please verify your email first.'
            )
        email_payload = AuthService._verify_pre_signup_token(
            email_token, 'pre_signup_email',
        )
        if email_payload.get('identifier') != AuthService._normalize_email(email):
            raise ValueError(
                'Email verification token does not match submitted email.'
            )

        # ── Create User + Hospital ────────────────────────────────
        user = User(
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            state=data.get('state', ''),
            role=UserRole.HOSPITAL,
            status=UserStatus.PENDING,
            tenant_id=tenant_id,
        )
        user.email = email
        user.email_verified = True
        user.phone_number = data['phone_number']
        # Round 8.5 — see signup_doctor() above for rationale.
        user.phone_verified = True
        user.set_password(data['password'])
        db.session.add(user)
        db.session.flush()

        hospital = Hospital(
            tenant_id=tenant_id,
            admin_user_id=user.id,
            name=data['name'],
            registration_number=data.get('registration_number'),
            hospital_type=data.get('hospital_type'),
            phone=data.get('phone') or data.get('phone_number'),
            email=email,
            website=data.get('website'),
            address=data['address'],
            city=data['city'],
            state=data.get('state', ''),
            pincode=data['pincode'],
            admin_aadhaar_attachment=file_paths.get('admin_aadhaar_attachment'),
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(hospital)
        db.session.flush()  # get hospital.id for the entity-profile owner FK
        AuthService._attach_entity_profile(data, tenant_id, hospital_id=hospital.id)
        db.session.commit()

        AuthService._attach_provider_membership_or_warn(
            vertical='hospital',
            provider_id=hospital.id,
            user_id=user.id,
            plan_code=data.get('plan_code'),
        )

        if user.email:
            try:
                from app.services.email_service import EmailService
                EmailService.send_welcome_email(user)
            except Exception as e:
                logger.warning(
                    f"[SVC:SIGNUP_HOSPITAL] welcome email failed (non-fatal): {e}"
                )

        return user, hospital

    @staticmethod
    def _runs_marketplace(tenant_id, vertical='doctor') -> bool:
        """Does this tenant run the public marketplace funnel?

        Was ``_is_apex_tenant``, keyed on ``Tenant.is_default`` back when
        the apex tenant was the only marketplace. That flag now means
        only "where do unresolved anonymous requests land" — the
        marketplace itself belongs to an ordinary customer tenant. So the
        question became a plan entitlement; see
        :class:`app.api.pricing.service.MarketplacePolicy`.
        """
        from app.api.pricing.service import MarketplacePolicy
        return MarketplacePolicy.runs_marketplace(tenant_id, vertical)

    @staticmethod
    def _assert_in_tenant_signup_allowed(
        *, tenant_id, vertical: str, tenant_provider_plan_id,
    ):
        """In-tenant signup pre-flight — the parallel of
        ``_assert_marketplace_plan_required`` for non-marketplace tenants.

        Three gates, all surfaced as ``ValueError`` (translated to 400
        by the route layer):

          1. Per-vertical entity quota — refuse when the tenant has
             already registered ``Plan.max_provider_<vertical>``
             entities. Treats NULL/missing quota as 0 (deny).
          2. Plan selection required — when the tenant holds the
             ``tenant.can_create_<vertical>_plans`` add-on AND has
             authored ≥1 ACTIVE ``TenantProviderPlan`` for the vertical,
             the signup form MUST supply ``tenant_provider_plan_id``
             matching one of those rows.
          3. Wrong vertical / missing plan — the plan_id has to belong
             to the tenant and match the vertical being signed up.

        Returns the resolved ``TenantProviderPlan`` row (or ``None`` if
        no plan was required) so the caller can pass it into the
        post-creation attach without re-querying.
        """
        from app.api.tenant_provider_plan.service import (
            FeatureNotEntitled,
            PlanNotFound,
            ProviderQuotaExceeded,
            TenantProviderPlanService,
            assert_provider_quota_available,
        )
        from app.models import (
            MembershipPlanStatus, MembershipVertical, TenantProviderPlan,
        )

        try:
            vertical_enum = MembershipVertical(vertical)
        except ValueError as exc:
            raise ValueError(f'Unknown provider vertical: {vertical!r}') from exc

        # Quota gate first — fail-fast before we even look at plans.
        try:
            assert_provider_quota_available(tenant_id, vertical_enum)
        except ProviderQuotaExceeded as exc:
            raise ValueError(
                f"This tenant has reached its {vertical} limit "
                f"({exc.current}/{exc.cap}). Ask your admin to upgrade "
                f"the plan to register more {vertical}s."
            ) from None

        # Plan selection — required only if the add-on + active plans
        # both exist.
        required = TenantProviderPlanService.is_plan_selection_required(
            tenant_id=tenant_id, vertical=vertical_enum,
        )
        if not required:
            return None

        if not tenant_provider_plan_id:
            raise ValueError(
                f"This tenant requires you to pick a {vertical} plan "
                f"before signup. Please choose one from the signup form."
            )
        plan = (
            TenantProviderPlan.query
            .filter_by(
                id=tenant_provider_plan_id,
                tenant_id=tenant_id,
                is_deleted=False,
            )
            .first()
        )
        if plan is None or plan.status != MembershipPlanStatus.ACTIVE:
            raise ValueError(
                f"Selected plan is no longer available. Please refresh "
                f"and pick a different option."
            )
        if plan.vertical != vertical_enum:
            raise ValueError(
                f"Selected plan is for {plan.vertical.value}, not "
                f"{vertical}. Please pick a {vertical} plan."
            )
        return plan

    @staticmethod
    def _attach_in_tenant_subscription_or_warn(
        *, tenant_id, vertical: str, provider_id, user_id,
        tenant_provider_plan_id,
    ):
        """Post-creation attach for the in-tenant flow. Best-effort —
        warns and continues on any domain error so the just-created
        Doctor/Clinic/Hospital row isn't rolled back. If the tenant
        only had quota gating (no plan required), this is a no-op.
        """
        if not tenant_provider_plan_id:
            return
        from app.api.tenant_provider_plan.service import (
            TenantProviderPlanError,
            TenantProviderSubscriptionService,
        )
        from app.models import MembershipVertical
        try:
            vertical_enum = MembershipVertical(vertical)
        except ValueError:
            return
        try:
            TenantProviderSubscriptionService.create_pending_for_provider(
                tenant_id=tenant_id,
                vertical=vertical_enum,
                provider_id=provider_id,
                user_id=user_id,
                plan_id=tenant_provider_plan_id,
            )
        except TenantProviderPlanError as exc:
            logger.warning(
                "[SVC:SIGNUP_%s] tenant-provider sub attach failed for "
                "user=%s provider=%s plan_id=%s: %s",
                vertical.upper(), user_id, provider_id,
                tenant_provider_plan_id, exc,
            )

    @staticmethod
    def _assert_marketplace_plan_required(*, vertical: str, plan_code):
        """Pre-flight guard for marketplace signup endpoints.

        Marketplace providers (doctor / clinic / hospital) MUST come
        through the ``/join`` funnel, which appends ``?plan=<code>`` to
        the signup URL. Bypassing the funnel — old direct links, manual
        URL crafting, postman, etc. — should NOT be able to create a
        provider account without picking a tier.

        Raises ``ValueError`` (the route layer maps that to a 400
        response) when ``plan_code`` is missing OR doesn't resolve to
        an ACTIVE plan in the expected vertical. Runs BEFORE any User /
        Doctor / Clinic / Hospital row is created so a bad plan_code
        doesn't leave dangling state.

        Returns the resolved ``MembershipPlan`` so callers can pass it
        to the post-creation attach without re-querying.
        """
        from app.api.membership.service import (
            MembershipPlanInactive,
            MembershipPlanNotFound,
            MembershipPlanWrongVertical,
            MembershipSubscriptionService,
        )
        from app.models import MembershipVertical

        if not plan_code:
            raise ValueError(
                'Plan selection is required. Please pick a tier at '
                '/join before signing up.'
            )
        try:
            vertical_enum = MembershipVertical(vertical)
        except ValueError as exc:
            raise ValueError(f'Unknown provider vertical: {vertical!r}') from exc
        try:
            plan = MembershipSubscriptionService._resolve_active_plan(
                plan_code, expected_vertical=vertical_enum,
            )
            # An active-but-unpublished plan is admin-assign only — it cannot be
            # picked for self-serve signup from the landing.
            if not getattr(plan, 'publish_on_landing', False):
                raise ValueError(
                    f'Plan "{plan_code}" is not available for self-signup. '
                    'Please contact the admin to be assigned this plan.'
                )
            return plan
        except MembershipPlanNotFound:
            raise ValueError(
                f'Plan "{plan_code}" not found. Pick a tier at /join.'
            ) from None
        except MembershipPlanInactive:
            raise ValueError(
                f'Plan "{plan_code}" is no longer available. '
                'Pick a different tier at /join.'
            ) from None
        except MembershipPlanWrongVertical:
            raise ValueError(
                f'Plan "{plan_code}" is not for {vertical}s. '
                'Pick the right tier at /join.'
            ) from None

    @staticmethod
    def _attach_provider_membership_or_warn(
        *, vertical: str, provider_id, user_id, plan_code,
    ):
        """Best-effort marketplace membership attach for clinic / hospital
        signup. Mirrors the doctor-signup pattern: if the provider came
        via the apex pricing card the form carries ``plan_code``; we
        persist a PENDING ``MembershipSubscription`` row. Failures log
        WARN but do not unwind the just-created provider row — they can
        re-pick a plan from the dashboard once Round 9 ships self-serve
        plan change.
        """
        if not plan_code:
            return
        from app.api.membership.service import (
            MembershipAlreadyExists,
            MembershipPlanInactive,
            MembershipPlanNotFound,
            MembershipPlanWrongVertical,
            MembershipSubscriptionService,
        )
        creator = {
            'clinic': MembershipSubscriptionService.create_pending_for_clinic,
            'hospital': MembershipSubscriptionService.create_pending_for_hospital,
        }.get(vertical)
        if creator is None:
            return
        try:
            kwargs = {f'{vertical}_id': provider_id}
            creator(user_id=user_id, plan_code=plan_code, **kwargs)
        except (
            MembershipPlanNotFound,
            MembershipPlanInactive,
            MembershipPlanWrongVertical,
            MembershipAlreadyExists,
        ) as exc:
            logger.warning(
                "[SVC:SIGNUP_%s] membership attach failed for "
                "user=%s provider=%s plan_code=%s: %s",
                vertical.upper(), user_id, provider_id, plan_code, exc,
            )

    @staticmethod
    def signin(identifier, identifier_type, password, device_info=None,
               expected_role=None, tenant_slug=None):
        """
        Authenticate a user and create session.
        Enforces session limit (1 per user by default).

        Args:
            identifier: User email, phone number, or Aadhaar number
            identifier_type: 'email', 'phone', or 'aadhar'
            password: User password
            device_info: Optional device fingerprint info
            expected_role: Optional ('admin', 'patient', 'doctor', …) — gates which role
                           is allowed to authenticate from a given login portal.
            tenant_slug:   Optional explicit tenant slug. If supplied, the
                           user lookup is scoped to that tenant. Otherwise
                           the resolution priority is:
                             1. ``X-Tenant-Slug`` request header
                             2. ``g.tenant_id`` (already set by before_request)
                             3. Default ``is_default=True`` tenant.
                           Same identifier (email/phone) can exist in
                           multiple tenants — the slug picks the right one.

        Returns:
            Tuple of (user, access_token, refresh_token, session_id)

        Raises:
            ValueError: If credentials are invalid or session limit reached
        """
        from app.common.encryption import hash_for_search
        from flask import g, request
        from app.models import Tenant

        logger.debug(f"[SVC:SIGNIN] ▶ START — type={identifier_type}")

        # ── Resolve tenant for the lookup ─────────────────────────
        # STRICT (Phase 0): trust ``g.tenant_id`` from before_request.
        # That hook now refuses requests on non-platform hosts whose
        # X-Tenant-Host doesn't match a known tenant — so by the time
        # we get here on a non-platform host, ``g.tenant_id`` is the
        # right tenant or the request was already rejected (404).
        # The default-tenant fallback that used to live here is gone:
        # it was the root cause of cross-tenant signin (a patient on
        # tenant A could sign in from tenant B's host because
        # resolution silently routed to default).
        slug = (
            tenant_slug
            or (request.headers.get('X-Tenant-Slug') if request else None)
        )
        tenant_id = getattr(g, 'tenant_id', None)
        if not tenant_id and slug:
            t = Tenant.query.filter_by(slug=slug).first()
            if not t:
                # Don't leak whether slug exists — same error as bad creds.
                raise ValueError('Invalid credentials.')
            tenant_id = t.id
        if not tenant_id:
            # Reached only on the platform apex with no JWT and no
            # explicit slug — refuse rather than guessing the tenant.
            # Pre-Phase-0 this fell back to the default tenant; that
            # behaviour is what we're closing.
            raise ValueError('Invalid credentials.')

        # ── Find user, scoped to tenant ───────────────────────────
        identifier_hash = hash_for_search(identifier)

        if identifier_type == 'email':
            user = User.query.filter_by(
                _email_hash=identifier_hash,
                tenant_id=tenant_id,
                is_deleted=False,
            ).first()
            error_msg = 'Invalid email or password'
        elif identifier_type == 'phone':
            user = User.query.filter_by(
                _phone_hash=identifier_hash,
                tenant_id=tenant_id,
                is_deleted=False,
            ).first()
            error_msg = 'Invalid phone number or password'
        else:  # aadhar
            user = None
            error_msg = 'Invalid Aadhaar number or password'

        if not user:
            logger.debug(
                f"[SVC:SIGNIN] ✗ User not found in tenant={tenant_id} for type={identifier_type}"
            )
            raise ValueError(error_msg)

        # Post-lookup invariant: the matched user MUST belong to the
        # resolved request tenant. Dead code today (the query above
        # filters by both), but locks the contract against future
        # drift where a code path could return a user from another
        # tenant.
        if str(user.tenant_id) != str(tenant_id):
            logger.warning(
                '[SVC:SIGNIN] ✗ Tenant mismatch: user.tenant=%s req.tenant=%s '
                '(refused with opaque error)',
                user.tenant_id, tenant_id,
            )
            raise ValueError(error_msg)
        
        logger.debug(f"[SVC:SIGNIN] User found: id={user.id}, role={user.role.value}, status={user.status.value}")
        
        if user.is_account_locked():
            logger.debug(f"[SVC:SIGNIN] ✗ Account locked: user={user.id}")
            raise ValueError('Account is temporarily locked. Please try again later.')
        
        if not user.check_password(password):
            prev_attempts = user.failed_login_attempts or 0
            user.increment_failed_login()
            db.session.commit()
            logger.debug(f"[SVC:SIGNIN] ✗ Wrong password: user={user.id}, failed_attempts={user.failed_login_attempts}")

            # Fire account_locked email only on the TRANSITION (4 → 5).
            # Subsequent attempts on a locked account hit the
            # ``is_account_locked()`` branch above and don't re-notify.
            if prev_attempts < 5 <= (user.failed_login_attempts or 0):
                try:
                    from app.services.email_service import EmailService
                    unlock_time = (
                        user.locked_until.strftime('%d %b %Y, %H:%M UTC')
                        if user.locked_until else 'in 30 minutes'
                    )
                    EmailService.send_account_locked_email(
                        user, unlock_time=unlock_time
                    )
                except Exception as e:
                    logger.warning(f"[SVC:SIGNIN] account-locked notification failed: {e}")

            raise ValueError(error_msg)

        # A managed (guardian-owned) profile — e.g. a minor sub-account — is a
        # real User but must NEVER authenticate. Fail closed regardless of
        # status (a held user is otherwise allowed in to the holding page); the
        # guardian reaches it through the patient-family "act as" scope, never a
        # login.
        if getattr(user, 'is_managed', False):
            raise ValueError('This is a managed profile and cannot be signed in to.')

        if user.status != UserStatus.ACTIVE:
            # Any held user (pending admin verification, or marked inactive) may
            # still sign in — the frontend routes them to the holding page
            # (an admin chat) instead of the dashboard. Only BLOCKED accounts
            # stay locked out. Downstream gates (must_set_password / phone /
            # email verified) still protect accounts that haven't finished
            # onboarding.
            _held_ok = user.status in (UserStatus.PENDING, UserStatus.INACTIVE)
            if not _held_ok:
                logger.debug(f"[SVC:SIGNIN] ✗ Account not active: user={user.id}, status={user.status.value}")
                raise ValueError('Account is not active. Please contact support.')
            logger.info(f"[SVC:SIGNIN] held user admitted to holding page: user={user.id}, status={user.status.value}")

        # Validate role matches expected login page. The admin portal is
        # shared by SUPER_ADMIN, SUB_ADMIN, and PLATFORM_OWNER — the owner
        # operates at the admin tier, just with cross-tenant reach.
        if expected_role:
            role_page_mapping = {
                # A caregiver (support staff) signs in at the patient door too —
                # admitted here and on the 'service_receiver' umbrella below.
                'patient': [UserRole.PATIENT, UserRole.PATIENT_STAFF],
                'doctor': [UserRole.DOCTOR],
                'admin': [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER],
                'super_admin': [UserRole.SUPER_ADMIN],
                'sub_admin': [UserRole.SUB_ADMIN],
                'platform_owner': [UserRole.PLATFORM_OWNER],
                # "Service provider" is the umbrella for every role that
                # delivers care on the platform — doctor, clinic admin,
                # hospital admin, pharmacy admin, diagnosis admin. Each
                # lands on a different dashboard post-login (the
                # frontend maps user.role → dashboard path), but they
                # all sign in through the same ServiceProviderLogin
                # form. Previously this list only included DOCTOR,
                # which 4xx-d every hospital / clinic admin with
                # ROLE_MISMATCH and forced them to the patient login.
                # PROVIDER_STAFF belongs here for the same reason: from a
                # receptionist's side this IS their clinic's login. Giving
                # staff their own portal would mean asking someone who
                # thinks of themselves as "the clinic" which door is
                # theirs. What differs is the landing page and what their
                # roles reach — not the door.
                'service_provider': [
                    UserRole.DOCTOR,
                    UserRole.HOSPITAL,
                    UserRole.CLINIC,
                    UserRole.PHARMACY,
                    UserRole.DIAGNOSIS,
                    UserRole.PROVIDER_STAFF,
                ],
                # PATIENT_STAFF belongs here for the same reason PROVIDER_STAFF
                # sits on the provider umbrella: a caregiver's login IS the
                # patient's door. What differs is the landing page and what
                # their role reaches — not the door.
                'service_receiver': [UserRole.PATIENT, UserRole.PATIENT_STAFF],
            }
            allowed_roles = role_page_mapping.get(expected_role, [])
            if allowed_roles and user.role not in allowed_roles:
                logger.debug(f"[SVC:SIGNIN] ✗ Role mismatch: user.role={user.role.value}, expected_role={expected_role}")
                raise ValueError('ROLE_MISMATCH')

        # Round 8.5 — invited doctors (hospital/clinic admin created
        # the account on their behalf) land in "pending activation"
        # state. These gates fire BEFORE the generic email-verified
        # gate so the more specific "please open the activation link"
        # message wins over the generic email-verify hint.
        # Scoped to the DOCTOR role so the anonymous-booking patient
        # flow (which also uses ``must_set_password=True`` but logs in
        # via phone OTP + /book/set-password) is unaffected.
        if user.role == UserRole.DOCTOR:
            if user.must_set_password:
                logger.debug(
                    f"[SVC:SIGNIN] ✗ Pending activation: user={user.id}"
                )
                raise ValueError('PENDING_ACTIVATION')
            # Mirror gate on the phone side. Pre-Round-8.5 doctors
            # are backfilled to phone_verified=True by migration
            # f2a3b4c5d6e7, so this only blocks invited accounts
            # that finished password but skipped phone OTP.
            if not user.phone_verified:
                logger.debug(
                    f"[SVC:SIGNIN] ✗ Phone not verified: user={user.id}"
                )
                raise ValueError('PHONE_NOT_VERIFIED')

        # Round 9 — admin / doctor can invite a PATIENT. Invited
        # patients also land in must_set_password=True state with
        # both contacts unverified. Block password-based signin until
        # they walk the activation page.
        #
        # We carefully DON'T just check ``must_set_password`` for the
        # PATIENT role — the anonymous-booking flow also creates the
        # patient with must_set_password=True but the phone is OTP-
        # verified at booking time, so phone_verified=True there.
        # Gating on the conjunction (must_set_password AND NOT
        # phone_verified) lets the booking flow through while still
        # blocking invited patients.
        if user.role == UserRole.PATIENT:
            if user.must_set_password and not user.phone_verified:
                logger.debug(
                    f"[SVC:SIGNIN] ✗ Pending activation: user={user.id}"
                )
                raise ValueError('PENDING_ACTIVATION')

        # Round 9 (extended) — admin can also invite a HOSPITAL or
        # CLINIC. The facility admin lands as the invited User with
        # must_set_password=True and both contacts unverified. Same
        # gate semantics as the doctor-invite path: refuse signin
        # until the activation page is walked.
        if user.role in (UserRole.HOSPITAL, UserRole.CLINIC):
            if user.must_set_password:
                logger.debug(
                    f"[SVC:SIGNIN] ✗ Pending activation: user={user.id}"
                )
                raise ValueError('PENDING_ACTIVATION')
            if not user.phone_verified:
                logger.debug(
                    f"[SVC:SIGNIN] ✗ Phone not verified: user={user.id}"
                )
                raise ValueError('PHONE_NOT_VERIFIED')

        # Email-identifier signin is gated on email verification. Phone
        # signin is exempt because the phone number is verified via OTP
        # at signup. Without this gate, an attacker who signs up with a
        # victim's email (which they don't own) can simply log in.
        if identifier_type == 'email' and not user.email_verified:
            logger.debug(
                f"[SVC:SIGNIN] ✗ Email not verified: user={user.id}"
            )
            raise ValueError('EMAIL_NOT_VERIFIED')

        # Check session limit using Redis (source of truth for active sessions)
        max_sessions = current_app.config.get('MAX_SESSIONS_PER_USER', 1)
        
        # Clean up stale session IDs from user's session set
        SessionStore.cleanup_expired_sessions(str(user.id))
        
        # Count active sessions in Redis
        active_sessions = SessionStore.get_user_session_count(str(user.id))
        logger.debug(f"[SVC:SIGNIN] Session check: active={active_sessions}, max={max_sessions}")
        
        if active_sessions >= max_sessions:
            logger.debug(f"[SVC:SIGNIN] ✗ Session limit reached: user={user.id}")
            raise ValueError(
                f'Maximum {max_sessions} session(s) allowed. '
                'Please logout from other devices first.'
            )
        
        # Reset failed login attempts
        user.reset_failed_login()
        user.last_login = datetime.now(timezone.utc)
        
        # Create session in database (source of truth for audit)
        session = AuthService._create_session(user, device_info)
        logger.debug(f"[SVC:SIGNIN] Session created: session_id={session.id}")
        
        # Generate unique jti for refresh token
        jti = str(uuid.uuid4())
        
        # Generate tokens with session_id AND jti in claims.
        # ``tenant_id`` is included so the before_request JWT-vs-host
        # invariant can read it directly from the token without
        # falling back to a ``current_user`` DB lookup. Phase 0 plan:
        # JWT carrying tenant_id=A replayed against host that resolves
        # to tenant B → 403 (tenant_mismatch). That check needs the
        # claim to be present.
        tenant_claim = str(user.tenant_id) if user.tenant_id else None
        access_token = create_access_token(
            identity=user,
            additional_claims={
                'session_id': str(session.id),
                'refresh_jti': jti,
                'tenant_id': tenant_claim,
                'role': user.role.value,
            }
        )
        refresh_token = create_refresh_token(
            identity=user,
            additional_claims={
                'session_id': str(session.id),
                'jti': jti,
                'tenant_id': tenant_claim,
            }
        )
        logger.debug(f"[SVC:SIGNIN] Tokens generated: jti={jti[:8]}...")
        
        # Calculate TTL
        now = datetime.now(timezone.utc)
        refresh_lifetime = current_app.config.get('JWT_REFRESH_TOKEN_EXPIRES', timedelta(days=15))
        if isinstance(refresh_lifetime, timedelta):
            refresh_ttl = int(refresh_lifetime.total_seconds())
        else:
            refresh_ttl = 15 * 24 * 60 * 60
        
        absolute_ttl = int((session.absolute_expiry - now).total_seconds())
        ttl_seconds = min(refresh_ttl, absolute_ttl)
        
        # Store refresh token jti in Redis (SECURITY CRITICAL)
        if not SessionStore.store_refresh_token(jti, str(session.id), ttl_seconds):
            db.session.rollback()
            logger.error(f"[SVC:SIGNIN] ✗ Redis store failed, rolling back")
            raise ValueError('Authentication service temporarily unavailable. Please try again.')
        
        # Store placeholder hash in DB (for audit/compatibility)
        session.refresh_token_hash = generate_password_hash(jti)
        db.session.commit()
        
        # Cache session in Redis
        SessionStore.cache_session(
            session_id=str(session.id),
            user_id=str(user.id),
            expires_at=session.expires_at,
            created_at=session.created_at,
            device_info=session.device_fingerprint
        )
        
        logger.info(f"[SVC:SIGNIN] ✓ DONE — user={user.id}, session={session.id}, jti={jti[:8]}...")

        return user, access_token, refresh_token, str(session.id)

    @staticmethod
    def signin_via_otp(phone_number, otp, device_info=None, expected_role=None):
        """
        Authenticate a user via phone OTP (passwordless login via Combirds SMS).
        Verifies OTP from Redis, then creates session just like normal signin.

        Args:
            phone_number: User mobile number
            otp: 6-digit OTP code
            device_info: Optional device fingerprint info
            expected_role: Optional ('patient', 'doctor', 'hospital',
                'clinic', 'pharmacy', 'diagnosis', 'admin', 'super_admin',
                'sub_admin'). When set, the matched user must have this
                role — otherwise we raise. Mirror of the password-login
                ``expected_role`` gate: a patient login portal should
                only authenticate patients, doctor portal only doctors,
                etc. Treats ``'service_provider'`` and
                ``'service_receiver'`` as umbrella aliases the way the
                password path already does.

        Returns:
            Tuple of (user, access_token, refresh_token, session_id)

        Raises:
            ValueError: If OTP is invalid/expired, user not found, role
                mismatch, or session limit reached
        """
        from app.common.encryption import hash_for_search
        from app.services.sms_service import SMSService

        logger.debug(f"[SVC:SIGNIN_OTP] ▶ START — phone={phone_number}")

        # 1) Peek the OTP first — but DON'T consume yet. If we ate the
        # OTP here and a downstream gate (locked / not-active / wrong
        # role) rejected the login, the user would see "Invalid OTP"
        # on every retry because Redis was emptied by the first call.
        # The original symptom: doctor's phone tried on the patient
        # portal → OTP consumed → role gate raised → retry → "Invalid
        # or expired verification code" (which is a lie — the OTP was
        # fine, the ROLE was wrong). Consume only when the login is
        # actually going to succeed (step 6 below).
        otp_valid = SMSService._verify_otp(
            phone_number, otp,
            SMSService.PHONE_OTP_PREFIX,
            consume=False,
        )
        if not otp_valid:
            logger.debug(f"[SVC:SIGNIN_OTP] ✗ Invalid or expired OTP")
            raise ValueError('Invalid or expired verification code')

        # 2) Find user by phone — scoped to tenant. Same number can exist
        # in N tenants now (per-tenant identity), so we MUST filter by
        # the requesting tenant or we'll log into the wrong account.
        from app.common.tenant_context import current_tenant_id_or_default
        tenant_id = current_tenant_id_or_default()
        phone_hash = hash_for_search(phone_number)
        user = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()

        if not user:
            logger.debug(f"[SVC:SIGNIN_OTP] ✗ User not found for phone in tenant={tenant_id}")
            raise ValueError('No account found with this mobile number')

        if user.is_account_locked():
            logger.debug(f"[SVC:SIGNIN_OTP] ✗ Account locked: user={user.id}")
            raise ValueError('Account is temporarily locked. Please try again later.')

        # Managed (guardian-owned) profiles — e.g. minor sub-accounts — never log in.
        if getattr(user, 'is_managed', False):
            raise ValueError('This is a managed profile and cannot be signed in to.')

        if user.status != UserStatus.ACTIVE:
            logger.debug(f"[SVC:SIGNIN_OTP] ✗ Account not active: user={user.id}")
            raise ValueError('Account is not active. Please contact support.')

        # 2.5) Role gate. Each login portal should only authenticate
        # users of its own role — otherwise a doctor could land in the
        # patient login and successfully sign in, ending up confused at
        # the wrong dashboard (the post-login redirect uses user.role
        # so they bounce back to /dashboard/doctor anyway, which makes
        # the patient login look broken). Same check the password path
        # applies (see signin's expected_role branch). Fires BEFORE
        # OTP is consumed so a wrong-portal attempt doesn't blow the
        # OTP away — the user can switch portals and reuse the same
        # code immediately.
        if expected_role:
            user_role = user.role.value if user.role else None
            allowed_roles = {expected_role}
            # Umbrella aliases — patient login portal sends
            # 'service_receiver'; provider login portal sends
            # 'service_provider'. Map those onto the underlying roles
            # the user's row actually carries.
            if expected_role == 'service_provider':
                # 'provider_staff' included for the same reason as on the
                # password path: staff use their practice's portal, because
                # from their side it IS their practice's login. Only the
                # post-login landing and their reach differ.
                allowed_roles = {
                    'doctor', 'hospital', 'clinic',
                    'pharmacy', 'diagnosis', 'provider_staff',
                }
            elif expected_role == 'service_receiver':
                # 'patient_staff' (a caregiver) uses the patient portal for the
                # same reason 'provider_staff' uses the provider one.
                allowed_roles = {'patient', 'patient_staff'}
            elif expected_role in ('admin', 'super_admin'):
                # Admin portal — accept both super_admin and sub_admin
                allowed_roles = {'super_admin', 'sub_admin'}

            if user_role not in allowed_roles:
                logger.debug(
                    f"[SVC:SIGNIN_OTP] ✗ Role mismatch: user_role={user_role} "
                    f"expected={expected_role}"
                )
                # Generic phrasing — mirrors the password-login
                # ROLE_MISMATCH UX: tell the user the number isn't
                # registered as the role for THIS portal, without
                # revealing the role the account actually carries
                # (avoids leaking that the phone exists + what kind
                # of user it belongs to).
                pretty_expected = expected_role.replace('_', ' ')
                raise ValueError(
                    f"This mobile number is not registered as a "
                    f"{pretty_expected} on this site. Please use the "
                    f"matching login portal."
                )

        # 3) Session limit check
        max_sessions = current_app.config.get('MAX_SESSIONS_PER_USER', 1)
        SessionStore.cleanup_expired_sessions(str(user.id))
        active_sessions = SessionStore.get_user_session_count(str(user.id))

        if active_sessions >= max_sessions:
            logger.debug(f"[SVC:SIGNIN_OTP] ✗ Session limit reached: user={user.id}")
            raise ValueError(
                f'Maximum {max_sessions} session(s) allowed. '
                'Please logout from other devices first.'
            )

        # 3.5) All gates passed — NOW consume the OTP. Up to this
        # point the peek at step 1 left the Redis key intact, so any
        # earlier rejection (wrong role, locked, inactive) didn't
        # waste the doctor's code. Single-use semantics are still
        # honoured here.
        SMSService._verify_otp(
            phone_number, otp,
            SMSService.PHONE_OTP_PREFIX,
            consume=True,
        )

        # 4) Reset failed login attempts & update last login
        user.reset_failed_login()
        user.last_login = datetime.now(timezone.utc)

        # 5) Create session (same logic as password signin)
        session = AuthService._create_session(user, device_info)
        jti = str(uuid.uuid4())

        # tenant_id on the claim — same Phase 0 invariant that the
        # password-signin path sets. See the parallel comment in
        # AuthService.signin() above.
        tenant_claim = str(user.tenant_id) if user.tenant_id else None
        access_token = create_access_token(
            identity=user,
            additional_claims={
                'session_id': str(session.id),
                'refresh_jti': jti,
                'tenant_id': tenant_claim,
                'role': user.role.value,
            }
        )
        refresh_token = create_refresh_token(
            identity=user,
            additional_claims={
                'session_id': str(session.id),
                'jti': jti,
                'tenant_id': tenant_claim,
            }
        )

        now = datetime.now(timezone.utc)
        refresh_lifetime = current_app.config.get('JWT_REFRESH_TOKEN_EXPIRES', timedelta(days=15))
        if isinstance(refresh_lifetime, timedelta):
            refresh_ttl = int(refresh_lifetime.total_seconds())
        else:
            refresh_ttl = 15 * 24 * 60 * 60

        absolute_ttl = int((session.absolute_expiry - now).total_seconds())
        ttl_seconds = min(refresh_ttl, absolute_ttl)

        if not SessionStore.store_refresh_token(jti, str(session.id), ttl_seconds):
            db.session.rollback()
            raise ValueError('Authentication service temporarily unavailable.')

        session.refresh_token_hash = generate_password_hash(jti)
        db.session.commit()

        SessionStore.cache_session(
            session_id=str(session.id),
            user_id=str(user.id),
            expires_at=session.expires_at,
            created_at=session.created_at,
            device_info=session.device_fingerprint
        )

        logger.info(f"[SVC:SIGNIN_OTP] ✓ DONE — user={user.id}, session={session.id}")

        return user, access_token, refresh_token, str(session.id)

    @staticmethod
    def refresh_tokens(user, session_id, refresh_token_jwt):
        """
        Refresh access token using Redis-backed single-use refresh tokens.
        
        SECURITY INVARIANTS:
        - Refresh tokens are SINGLE-USE (consumed atomically)
        - Every refresh rotates the token (new jti)
        - Missing token = replay attack = session revocation
        - Redis unavailable = fail closed (401)
        - Database is NOT on the hot path
        
        Args:
            user: Current user (from JWT identity)
            session_id: Session ID from JWT claims
            refresh_token_jwt: Current refresh token JWT
        
        Returns:
            Tuple of (new_access_token, new_refresh_token)
        
        Raises:
            ValueError: If session invalid, replay detected, or Redis unavailable
        """
        # 1. Decode refresh token to extract jti
        logger.debug(f"[SVC:REFRESH] ▶ START — user={user.id}, session={session_id}")
        try:
            token_data = decode_token(refresh_token_jwt)
            jti = token_data.get('jti')
            token_session_id = token_data.get('session_id')
        except Exception as e:
            logger.error(f"[SVC:REFRESH] ✗ Decode failed: {e}")
            raise ValueError('Invalid refresh token')
        
        if not jti:
            raise ValueError('Invalid refresh token format')
        
        logger.debug(f"[SVC:REFRESH] Decoded: jti={jti[:8]}..., token_session={token_session_id}")
        
        # 2. Verify session_id matches (defense in depth)
        if token_session_id != session_id:
            logger.warning(f"[SVC:REFRESH] ✗ Session ID mismatch: token={token_session_id}, claim={session_id}")
            raise ValueError('Session mismatch')
        
        # 3. Consume refresh token from Redis (ATOMIC GET + DELETE)
        stored_session_id = SessionStore.consume_refresh_token(jti)
        logger.debug(f"[SVC:REFRESH] Consume result: stored_session={stored_session_id}")
        
        # 4. Token not found: either the response to a JUST-completed
        # rotation never reached the client (mobile timeout — the retry
        # must be idempotent) or a genuine replay (revoke). The grace
        # record distinguishes them.
        if not stored_session_id:
            grace = SessionStore.get_refresh_grace(jti)
            if grace and grace.get('session_id') == session_id:
                logger.info(
                    f"[SVC:REFRESH] ↺ GRACE replay within window: jti={jti[:8]}..., "
                    f"session={session_id} — returning the same rotated pair")
                return grace['access_token'], grace['refresh_token']
            logger.warning(
                f"[SVC:REFRESH] ✗ REPLAY DETECTED: jti={jti[:8]}..., session={session_id}, user={user.id}"
            )
            AuthService._revoke_session_on_replay(session_id, str(user.id))
            raise ValueError('Session invalid')
        
        # 5. Verify returned session_id matches
        if stored_session_id != session_id:
            logger.warning(
                f"[SVC:REFRESH] ✗ Redis session mismatch: stored={stored_session_id}, expected={session_id}"
            )
            AuthService._revoke_session_on_replay(session_id, str(user.id))
            raise ValueError('Session invalid')
        
        # 6. Get session from DB for absolute expiry check (cold path, optional)
        session = UserSession.query.get(session_id)
        if not session or session.is_revoked:
            logger.debug(f"[SVC:REFRESH] ✗ Session revoked/not found in DB")
            raise ValueError('Session invalid')
        
        # 7. Check absolute expiry
        now = datetime.now(timezone.utc)
        if now > session.absolute_expiry:
            logger.debug(f"[SVC:REFRESH] ✗ Absolute expiry reached")
            AuthService._revoke_session_on_replay(session_id, str(user.id))
            raise ValueError('Session expired')
        
        # 8. Generate new jti for rotation (ALWAYS rotate)
        new_jti = str(uuid.uuid4())
        
        # 9. Generate new tokens (carry tenant_id forward — same
        # invariant as the initial signin path)
        tenant_claim = str(user.tenant_id) if user.tenant_id else None
        new_access_token = create_access_token(
            identity=user,
            additional_claims={
                'session_id': session_id,
                'refresh_jti': new_jti,
                'tenant_id': tenant_claim,
                'role': user.role.value,
            }
        )
        new_refresh_token = create_refresh_token(
            identity=user,
            additional_claims={
                'session_id': session_id,
                'jti': new_jti,
                'tenant_id': tenant_claim,
            }
        )
        
        # 10. Calculate TTL for new refresh token
        refresh_lifetime = current_app.config.get('JWT_REFRESH_TOKEN_EXPIRES', timedelta(days=15))
        if isinstance(refresh_lifetime, timedelta):
            refresh_ttl = int(refresh_lifetime.total_seconds())
        else:
            refresh_ttl = 15 * 24 * 60 * 60
        
        absolute_ttl = int((session.absolute_expiry - now).total_seconds())
        ttl_seconds = min(refresh_ttl, absolute_ttl)
        
        # 11. Store new jti in Redis (SECURITY CRITICAL)
        if not SessionStore.store_refresh_token(new_jti, session_id, ttl_seconds):
            logger.error("[SVC:REFRESH] ✗ Redis store failed, failing closed")
            raise ValueError('Session invalid')

        # 11b. Grace record: if our RESPONSE is lost in transit, the
        # client's retry with the just-consumed jti gets this same pair
        # back instead of tripping replay detection and losing the whole
        # session (see SessionStore.store_refresh_grace). Best-effort.
        grace_seconds = current_app.config.get('REFRESH_GRACE_SECONDS', 60)
        if grace_seconds:
            SessionStore.store_refresh_grace(
                jti, session_id, new_access_token, new_refresh_token,
                min(int(grace_seconds), ttl_seconds))
        
        # 12. Async/best-effort DB update (NOT blocking)
        try:
            session.last_refreshed_at = now
            if isinstance(refresh_lifetime, timedelta):
                session.expires_at = now + refresh_lifetime
            else:
                session.expires_at = now + timedelta(days=15)
            session.refresh_token_hash = generate_password_hash(new_jti)
            db.session.commit()
        except Exception as e:
            logger.warning(f"[SVC:REFRESH] DB update failed (non-critical): {e}")
            db.session.rollback()
        
        # 13. Update session cache in Redis
        SessionStore.update_session_expiry(session_id, session.expires_at)
        
        logger.info(f"[SVC:REFRESH] ✓ DONE — user={user.id}, session={session_id}, new_jti={new_jti[:8]}...")
        
        return new_access_token, new_refresh_token
    
    @staticmethod
    def _revoke_session_on_replay(session_id: str, user_id: str):
        """
        Revoke session when replay is detected.
        
        This is called when:
        1. Refresh token jti not found in Redis (already consumed = replay)
        2. Session ID mismatch
        
        Actions:
        1. Delete any remaining Redis keys (best effort)
        2. Mark session revoked in DB (source of truth)
        3. Log security event
        """
        logger.warning(
            f"[SVC:SECURITY] Session revoked due to replay: session={session_id}, user={user_id}"
        )
        
        # Delete from Redis (best effort)
        SessionStore.delete_session(session_id, user_id)
        
        # Revoke in database (source of truth)
        try:
            session = UserSession.query.get(session_id)
            if session and not session.is_revoked:
                session.revoke()
                db.session.commit()
        except Exception as e:
            logger.error(f"[SVC:SECURITY] Failed to revoke session in DB: {e}")
            db.session.rollback()
    
    @staticmethod
    def logout(session_id, user_id, refresh_jti=None):
        """
        Logout by revoking and deleting session.
        
        Args:
            session_id: Session ID to logout
            user_id: User ID for verification
            refresh_jti: Optional refresh token jti to delete from Redis
        """
        # Delete refresh token from Redis first (SECURITY CRITICAL)
        if refresh_jti:
            SessionStore.delete_refresh_token(refresh_jti)
        
        session = UserSession.query.get(session_id)
        if session and str(session.user_id) == str(user_id):
            # Mark as revoked in database (keep for audit)
            session.revoke()
            db.session.commit()
            
            # Delete session cache from Redis
            SessionStore.delete_session(session_id, user_id)
            
            logger.info(f"[SVC:LOGOUT] ✓ user={user_id}, session={session_id}")
    
    @staticmethod
    def logout_all(user_id):
        """Logout from all devices by revoking all sessions."""
        sessions = UserSession.query.filter_by(user_id=user_id).all()
        for session in sessions:
            db.session.delete(session)
        db.session.commit()

        # Delete from Redis
        SessionStore.delete_all_user_sessions(str(user_id))

    # ── Account deletion (deactivate + anonymize) ────────────────────────

    @staticmethod
    def delete_account(user, password, reason=None):
        """Self-serve account deletion: deactivate + anonymize the AUTH
        identity. Clinical records are NEVER hard-deleted — medical data
        carries statutory retention obligations, so appointments,
        prescriptions, payments and the patient/doctor profile rows stay,
        keyed by ids that no longer resolve to a login or to contact PII.

        What happens to the ``users`` row:
          * email cleared (encrypted blob + search hash both go),
          * phone replaced with a synthetic unique value (the column is
            NOT NULL + unique per tenant — same trick as managed minors),
            which also frees the real number for future re-registration,
          * names / dob / gender / photo / state wiped,
          * password replaced with an unusable random hash,
          * status → INACTIVE and ``is_deleted`` → True (every login and
            lookup path already filters on these),
          * all sessions + refresh tokens revoked.

        Raises
        ------
        InvalidPassword
            Re-authentication failed.
        AccountDeletionBlocked
            The account anchors something that must be handed over first
            (``.code`` says what: owner_account / facility_account /
            last_super_admin / managed_minors / upcoming_appointments /
            managed_account).
        """
        import secrets
        from datetime import date

        from app.common.encryption import hash_for_search
        from app.models import Appointment, AppointmentStatus, HouseGroupMember

        if user.is_managed:
            # Guardian-operated sub-profile: it has no credentials of its
            # own, so "delete my account" can never target it directly.
            raise AccountDeletionBlocked(
                'managed_account',
                'Managed profiles are removed by their guardian, not deleted here.')

        if not user.check_password(password):
            raise InvalidPassword('Password is incorrect.')

        role = user.role
        if role == UserRole.PLATFORM_OWNER:
            raise AccountDeletionBlocked(
                'owner_account',
                'The platform owner account cannot be self-deleted.')
        if role in (UserRole.CLINIC, UserRole.HOSPITAL):
            raise AccountDeletionBlocked(
                'facility_account',
                'This login anchors a facility. Transfer or close the '
                'facility with your administrator first.')

        if role == UserRole.SUPER_ADMIN:
            others = User.query.filter(
                User.tenant_id == user.tenant_id,
                User.role == UserRole.SUPER_ADMIN,
                User.id != user.id,
                User.is_deleted == False,  # noqa: E712
                User.status == UserStatus.ACTIVE,
            ).count()
            if others == 0:
                raise AccountDeletionBlocked(
                    'last_super_admin',
                    'You are the only active super admin of this '
                    'organisation. Create another admin (or contact the '
                    'vendor) before deleting your account.')

        _ACTIVE_APPT = (
            AppointmentStatus.PENDING_PAYMENT, AppointmentStatus.PENDING,
            AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS,
        )
        if role == UserRole.PATIENT and user.patient_profile:
            minors = HouseGroupMember.query.filter_by(
                tenant_id=user.tenant_id,
                patient_id=user.patient_profile.id,
                is_child_account=True, is_active=True,
            ).count()
            if minors:
                raise AccountDeletionBlocked(
                    'managed_minors',
                    'This account manages minor sub-profiles. Remove them '
                    'first so their records are handed over properly.')
            upcoming = Appointment.query.filter(
                Appointment.patient_id == user.patient_profile.id,
                Appointment.is_deleted == False,  # noqa: E712
                Appointment.status.in_(_ACTIVE_APPT),
                Appointment.appointment_date >= date.today(),
            ).count()
            if upcoming:
                raise AccountDeletionBlocked(
                    'upcoming_appointments',
                    'You still have upcoming appointments. Cancel them '
                    'before deleting your account.')
        if role == UserRole.DOCTOR and user.doctor_profile:
            upcoming = Appointment.query.filter(
                Appointment.doctor_id == user.doctor_profile.id,
                Appointment.is_deleted == False,  # noqa: E712
                Appointment.status.in_(_ACTIVE_APPT),
                Appointment.appointment_date >= date.today(),
            ).count()
            if upcoming:
                raise AccountDeletionBlocked(
                    'upcoming_appointments',
                    'You still have upcoming appointments booked with you. '
                    'Cancel or complete them before deleting your account.')

        # ── Seal the statutory record identity ──────────────────────
        # Retained clinical/financial records must stay IDENTIFIABLE for
        # their statutory retention period (NMC/MCI reg. 1.3 for medical
        # records; Companies Act 2013 s.128(5), CGST s.36, Income-tax
        # rules for books and working papers) — a record that can't say
        # whose it is loses its evidentiary value. So the legal identity
        # (name / dob / gender — NEVER contact channels) is snapshotted
        # onto the profile rows and the deletion register BEFORE the auth
        # identity is scrubbed. ``Patient.full_name`` / ``Doctor.full_name``
        # fall back to this snapshot once the User row is anonymized.
        from app.models import AccountDeletionRecord
        from app.models.account_deletion import LEGAL_BASIS
        from app.models._base import utcnow

        identity_snapshot = {
            'full_name': user.full_name,
            'first_name': user.first_name,
            'middle_name': user.middle_name,
            'last_name': user.last_name,
            'gender': user.gender.value if user.gender else None,
            'dob': user.dob.isoformat() if user.dob else None,
            'sealed_at': utcnow().isoformat(),
            'basis': 'statutory_record_identity',
        }
        if user.patient_profile is not None:
            user.patient_profile.record_identity = identity_snapshot
        if user.doctor_profile is not None:
            user.doctor_profile.record_identity = identity_snapshot

        scrubbed = [
            'email', 'phone_number', 'first_name', 'middle_name',
            'last_name', 'gender', 'dob', 'profile_image', 'state',
            'referral_code', 'password',
        ]
        register_row = AccountDeletionRecord(
            tenant_id=user.tenant_id,
            user_id=user.id,
            role=role.value,
            # One-way search hashes of the identifiers being ERASED —
            # lets support answer "was this number's account deleted,
            # and when?" without re-storing the contact data itself.
            email_hash=user._email_hash,
            phone_hash=user._phone_hash,
            identity_snapshot=identity_snapshot,
            scrubbed_fields=scrubbed,
            reason=(reason or '').strip()[:1000] or None,
            legal_basis=LEGAL_BASIS,
        )
        db.session.add(register_row)

        # ── Anonymize the auth identity ─────────────────────────────
        # A synthetic 0000-prefixed phone (same convention as managed
        # minors) satisfies NOT NULL + per-tenant uniqueness while making
        # it obvious in the DB that this is not a reachable number.
        for _ in range(20):
            candidate = '0000' + ''.join(
                secrets.choice('0123456789') for _ in range(6))
            clash = User.query.filter_by(
                tenant_id=user.tenant_id,
                _phone_hash=hash_for_search(candidate),
            ).first()
            if clash is None:
                break
        else:  # pragma: no cover — 20 collisions on 10^6 space
            raise RuntimeError('Could not allocate an anonymized phone slot.')

        old_id = str(user.id)
        user.email = None
        user.phone_number = candidate
        user.first_name = 'Deleted'
        user.middle_name = None
        user.last_name = 'Account'
        user.gender = None
        user.dob = None
        user.profile_image = None
        user.state = ''
        user.referral_code = ''
        user.email_verified = False
        user.phone_verified = False
        user.password_hash = generate_password_hash(secrets.token_urlsafe(32))
        user.status = UserStatus.INACTIVE
        user.is_deleted = True
        db.session.commit()

        # Kill every live session + refresh token.
        AuthService.logout_all(old_id)

        logger.info(
            '[SVC:DELETE_ACCOUNT] ✓ user=%s role=%s tenant=%s reason=%r — '
            'auth identity anonymized; clinical records retained',
            old_id, role.value, user.tenant_id, (reason or '')[:200],
        )
    
    @staticmethod
    def logout_other_sessions(user_id, current_session_id):
        """Logout from all devices except current session."""
        sessions = UserSession.query.filter(
            UserSession.user_id == user_id,
            UserSession.id != current_session_id
        ).all()
        
        for session in sessions:
            SessionStore.delete_session(str(session.id), str(user_id))
            db.session.delete(session)
        
        db.session.commit()
        return len(sessions)
    
    @staticmethod
    def remote_logout(user_id, target_session_id):
        """
        Logout a specific session remotely.
        
        Args:
            user_id: User ID performing the action
            target_session_id: Session ID to logout
            
        Returns:
            True if session was logged out, False if not found
        """
        session = UserSession.query.filter_by(
            id=target_session_id,
            user_id=user_id
        ).first()
        
        if session:
            SessionStore.delete_session(str(session.id), str(user_id))
            db.session.delete(session)
            db.session.commit()
            return True
        return False
    
    @staticmethod
    def get_active_sessions(user_id):
        """Get all active sessions for a user from Redis."""
        # Get active sessions from Redis (source of truth)
        redis_sessions = SessionStore.get_user_sessions(str(user_id))
        
        # Enrich with database info for display (device fingerprint, etc.)
        sessions = []
        for redis_session in redis_sessions:
            session_id = redis_session.get('session_id')
            db_session = UserSession.query.get(session_id) if session_id else None
            
            if db_session:
                session_data = db_session.to_dict()
                sessions.append(session_data)
            else:
                # Session exists in Redis but not in DB (shouldn't happen, but handle gracefully)
                sessions.append({
                    'session_id': session_id,
                    'created_at': redis_session.get('created_at'),
                    'expires_at': redis_session.get('expires_at'),
                    'device_info': redis_session.get('device_info'),
                })
        
        return sessions
    
    @staticmethod
    def _create_session(user, device_info=None):
        """Create a new user session."""
        from flask import request
        import json
        
        # Build device fingerprint
        fingerprint_data = device_info or {
            'user_agent': request.headers.get('User-Agent', ''),
            'ip': request.remote_addr,
        }
        
        refresh_days = current_app.config.get('JWT_REFRESH_TOKEN_EXPIRES', timedelta(days=10))
        if isinstance(refresh_days, timedelta):
            expires_delta = refresh_days
        else:
            expires_delta = timedelta(days=10)
        
        hard_limit_days = current_app.config.get('SESSION_HARD_LIMIT_DAYS', 30)
        
        session = UserSession(
            user_id=user.id,
            # Session lives under the same tenant as the user it belongs to.
            tenant_id=user.tenant_id,
            refresh_token_hash='',  # Will be set after token generation
            device_fingerprint=json.dumps(fingerprint_data),
            expires_at=datetime.now(timezone.utc) + expires_delta,
            absolute_expiry=datetime.now(timezone.utc) + timedelta(days=hard_limit_days),
        )
        db.session.add(session)
        db.session.flush()  # Get session ID without committing
        
        return session
    
    @staticmethod
    def change_password(user, current_password, new_password):
        """Change user password and logout all sessions."""
        if not user.check_password(current_password):
            raise ValueError('Current password is incorrect')

        user.set_password(new_password)

        # Logout all sessions for security
        AuthService.logout_all(user.id)

        db.session.commit()
        return True

    # ─── Pre-Signup OTP Verification ────────────────────────────────────────────

    @staticmethod
    def _create_pre_signup_token(identifier, purpose):
        """Create a short-lived JWT for pre-signup phone/email verification.

        Args:
            identifier: Phone number or email address
            purpose: 'pre_signup_phone' or 'pre_signup_email'

        Returns:
            str: Signed JWT string (10-minute TTL)
        """
        import jwt as pyjwt

        payload = {
            'identifier': identifier,
            'purpose': purpose,
            'iat': datetime.now(timezone.utc),
            'exp': datetime.now(timezone.utc) + timedelta(minutes=10),
        }
        secret = current_app.config.get('SECRET_KEY', 'dev-fallback-secret')
        return pyjwt.encode(payload, secret, algorithm='HS256')

    @staticmethod
    def _verify_pre_signup_token(token, expected_purpose):
        """Decode and validate a pre-signup verification JWT.

        Args:
            token: JWT string returned from verify_pre_signup_*_otp
            expected_purpose: 'pre_signup_phone' or 'pre_signup_email'

        Returns:
            dict: Payload containing 'identifier' key

        Raises:
            ValueError: If token is invalid, expired, or wrong purpose
        """
        import jwt as pyjwt

        if not token:
            raise ValueError('Verification token is missing.')

        secret = current_app.config.get('SECRET_KEY', 'dev-fallback-secret')
        try:
            payload = pyjwt.decode(token, secret, algorithms=['HS256'])
        except pyjwt.ExpiredSignatureError:
            raise ValueError('Verification has expired. Please re-verify.')
        except pyjwt.InvalidTokenError:
            raise ValueError('Invalid verification token.')

        if payload.get('purpose') != expected_purpose:
            raise ValueError('Invalid verification token purpose.')

        return payload

    @staticmethod
    def send_pre_signup_phone_otp(phone_number, first_name=None):
        """Send OTP to mobile number for pre-signup verification.

        Phone uniqueness is checked PER TENANT — same number can be
        registered in N tenants. Resolves tenant the same way send_pre_signup_email_otp
        did: g.tenant_id → X-Tenant-Slug → default tenant.

        ``first_name`` is optional — when supplied (frontend signup form
        already collected it), the SMS body renders a personalized
        ``Hi {first_name}.`` prefix; otherwise SMSService falls back to
        ``Hi there.``.
        """
        from app.common.encryption import hash_for_search
        from app.services.sms_service import SMSService
        from flask import g, request
        from app.models import Tenant

        tenant_id = getattr(g, 'tenant_id', None)
        if not tenant_id:
            tenant_slug = request.headers.get('X-Tenant-Slug') if request else None
            if tenant_slug:
                t = Tenant.query.filter_by(slug=tenant_slug.strip()).first()
                if not t:
                    raise ValueError(f'Tenant "{tenant_slug}" not found.')
                tenant_id = t.id
        if not tenant_id:
            # Phase 0: strict — pre-signup OTP must run under the
            # tenant the user intends to register in. Refuse if
            # neither g.tenant_id nor X-Tenant-Slug resolved.
            raise ValueError('Tenant context required.')

        phone_hash = hash_for_search(phone_number)
        if User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first():
            raise ValueError('Phone number already registered in this Platform.')

        SMSService.send_pre_signup_phone_otp(phone_number, first_name=first_name)
        logger.debug(f"[SVC:PRE_SIGNUP_PHONE] OTP sent (tenant={tenant_id})")
        return True

    @staticmethod
    def verify_pre_signup_phone_otp(phone_number, otp):
        """Verify pre-signup phone OTP and return a short-lived JWT.

        Frontend stores the JWT and submits it as ``phone_verification_token``
        on the signup payload. The signup path validates that the token's
        identifier matches the submitted phone number.
        """
        from app.services.sms_service import SMSService

        if not SMSService.verify_pre_signup_phone_otp(phone_number, otp):
            raise ValueError('Invalid or expired OTP. Please request a new one.')
        logger.debug(f"[SVC:PRE_SIGNUP_PHONE] ✓ OTP verified")
        return AuthService._create_pre_signup_token(phone_number, 'pre_signup_phone')

    # ─── Pre-signup email OTP ─────────────────────────────────────────
    #
    # Mirrors the pre-signup phone OTP flow. Required before signup() will
    # accept an email — closes the unverified-email security hole at the
    # gate instead of relying on a post-login banner.
    #
    # OTP is stored in Redis under ``pre_signup_email_otp:{normalized_email}``
    # for 10 minutes. Verify returns a short-lived JWT
    # (``email_verification_token``) the frontend submits with the signup
    # payload; signup() validates the token's ``identifier`` matches the
    # submitted email before flipping ``email_verified=True``.

    PRE_SIGNUP_EMAIL_OTP_PREFIX = 'pre_signup_email_otp:'
    PRE_SIGNUP_EMAIL_OTP_TTL = 600  # 10 minutes

    @staticmethod
    def _normalize_email(email):
        return (email or '').strip().lower()

    @staticmethod
    def send_pre_signup_email_otp(email, first_name=None):
        """Send a 6-digit OTP to ``email`` for pre-signup verification.

        Email uniqueness is checked PER TENANT — same address can be
        registered in N tenants — using the same tenant resolution
        sequence as ``send_pre_signup_phone_otp``.

        ``first_name`` is optional; renders the personalized greeting in
        the email when provided.

        :raises ValueError: if email is already registered in the
            resolved tenant, or the email send fails.
        """
        import random
        from app.common.encryption import hash_for_search
        from app.extensions import redis_client
        from app.services.email_service import EmailService
        from flask import g, request
        from app.models import Tenant

        normalized = AuthService._normalize_email(email)
        if not normalized or '@' not in normalized:
            raise ValueError('Please enter a valid email address.')

        tenant_id = getattr(g, 'tenant_id', None)
        if not tenant_id:
            tenant_slug = request.headers.get('X-Tenant-Slug') if request else None
            if tenant_slug:
                t = Tenant.query.filter_by(slug=tenant_slug.strip()).first()
                if not t:
                    raise ValueError(f'Tenant "{tenant_slug}" not found.')
                tenant_id = t.id
        if not tenant_id:
            # Phase 0: strict — pre-signup email OTP must run under
            # the tenant the user intends to register in.
            raise ValueError('Tenant context required.')

        # Per-tenant uniqueness check — same as phone path.
        email_hash = hash_for_search(normalized)
        if User.query.filter_by(
            _email_hash=email_hash, tenant_id=tenant_id, is_deleted=False,
        ).first():
            raise ValueError('Email already registered in this tenant.')

        otp = str(random.randint(100000, 999999))
        key = f"{AuthService.PRE_SIGNUP_EMAIL_OTP_PREFIX}{normalized}"
        redis_client.setex(key, AuthService.PRE_SIGNUP_EMAIL_OTP_TTL, otp)

        # Lightweight pseudo-User for EmailService.send_email_verification_otp,
        # which expects ``.email`` and ``.first_name``. We don't have a real
        # User row yet (that's the whole point of pre-signup), so wrap the
        # supplied fields in a tiny shim.
        class _Stub:
            pass
        stub = _Stub()
        stub.email = normalized
        stub.first_name = first_name or 'there'
        stub.id = 'pre-signup'  # only used in log lines

        try:
            EmailService.send_email_verification_otp(stub, otp)
        except Exception:
            redis_client.delete(key)
            raise
        logger.debug(f"[SVC:PRE_SIGNUP_EMAIL] OTP sent (tenant={tenant_id})")
        return True

    @staticmethod
    def verify_pre_signup_email_otp(email, otp):
        """Verify pre-signup email OTP and return a short-lived JWT.

        Frontend stores the JWT and submits it as ``email_verification_token``
        on the signup payload. ``signup()`` validates that the token's
        identifier matches the submitted email before flipping
        ``email_verified=True``.

        :raises ValueError: on mismatch / expiry / no prior send.
        """
        from app.extensions import redis_client

        normalized = AuthService._normalize_email(email)
        key = f"{AuthService.PRE_SIGNUP_EMAIL_OTP_PREFIX}{normalized}"
        stored = redis_client.get(key)
        if stored is None:
            raise ValueError('OTP expired or not requested. Please request a new one.')
        if isinstance(stored, bytes):
            stored = stored.decode('utf-8')
        if stored != (otp or '').strip():
            raise ValueError('Invalid OTP.')
        redis_client.delete(key)
        logger.debug(f"[SVC:PRE_SIGNUP_EMAIL] ✓ OTP verified")
        return AuthService._create_pre_signup_token(normalized, 'pre_signup_email')

    @staticmethod
    def request_password_reset(identifier):
        """Request password reset — generates a single OTP and pushes it
        via SMS (always) and email (when on file).

        ``identifier`` can be an email address OR phone number; we look up
        the user in the current tenant, then deliver the same OTP through
        every channel the user is reachable on. Redis is the source of
        truth for the OTP; transient send failures don't 500 the request.

        Raises:
            ValueError: if no user matches ``identifier`` in the current
                tenant. The route layer maps this to a 404 so the UI can
                surface a clear "No account found for X" message instead
                of the previous always-success enumeration-safe response
                that left operators wondering why the OTP never arrived
                (it never went out — there was no user to send it to).
        """
        import secrets
        import random
        from app.common.encryption import hash_for_search
        from app.services.sms_service import SMSService
        from app.extensions import redis_client
        
        from app.common.tenant_context import current_tenant_id_or_default

        identifier = identifier.strip()
        identifier_hash = hash_for_search(identifier)
        # Tenant-scoped lookup. The same identifier can match a user in
        # multiple tenants now; we must reset only the password belonging
        # to the tenant the request originated from (resolved upstream
        # from X-Tenant-Slug / JWT). Otherwise a malicious user could
        # trigger a reset email for another tenant's account just by
        # knowing the email.
        tenant_id = current_tenant_id_or_default()

        print(f"\n[DEV:FORGOT_PW] Searching for identifier: '{identifier}' tenant={tenant_id}")
        print(f"[DEV:FORGOT_PW] Hash: {identifier_hash[:16]}...")

        # Try email lookup first
        user = User.query.filter_by(
            _email_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()

        if not user:
            # Fallback: try phone number lookup (for users who signed up phone-only)
            user = User.query.filter_by(
                _phone_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
            ).first()
            if user:
                print(f"[DEV:FORGOT_PW] Found user by PHONE: id={user.id}")
            else:
                # No user matches. Was previously a silent
                # always-success return — enumeration defense — but
                # the operator running this app explicitly preferred
                # a clear "no account found" error over enumeration
                # protection so they can debug their own flows. The
                # route layer maps ValueError → 404 with the message.
                print(f"[DEV:FORGOT_PW] No user found by email OR phone for: '{identifier}' tenant={tenant_id}")
                logger.debug(f"[SVC:FORGOT_PW] Identifier not found in tenant")
                raise ValueError(
                    "No account is registered with that email or "
                    "mobile number on this tenant."
                )
        else:
            print(f"[DEV:FORGOT_PW] Found user by EMAIL: id={user.id}")
        
        # Generate a secure random URL token (256-bit URL-safe)
        token = secrets.token_urlsafe(32)
        
        # Generate a 6-digit OTP for on-page entry
        otp = str(random.randint(100000, 999999))
        
        # Store URL token in Redis: reset_token:{token} -> user_id, TTL = 1 hour
        redis_client.setex(f"reset_token:{token}", 3600, str(user.id))
        
        # Store OTP -> token mapping in Redis (TTL = 10 minutes)
        # Key by identifier_hash so verify_reset_otp can find it
        redis_client.setex(f"reset_otp:{identifier_hash}", 600, token)
        redis_client.setex(f"reset_otp_code:{identifier_hash}", 600, otp)
        
        logger.debug(f"[SVC:FORGOT_PW] OTP generated for user_id={user.id}")

        # Multi-channel delivery — Redis OTP is the source of truth, so
        # a transient send failure on either channel shouldn't 500. Send
        # SMS + email in parallel when both are on file; the user can
        # use whichever arrives first.
        first_name = user.first_name or 'there'
        try:
            phone_addr = user.phone_number  # required at signup, always set
            if phone_addr:
                SMSService.send_reset_password_otp(phone_addr, otp, first_name=first_name)
                logger.debug(f"[SVC:FORGOT_PW] ✓ Reset OTP SMS sent to user_id={user.id}")
            else:
                logger.debug(f"[SVC:FORGOT_PW] No phone on file for user_id={user.id}, skipping SMS")
        except Exception as e:
            logger.warning(f"[SVC:FORGOT_PW] SMS send failed (OTP still valid): {e}")

        # Only deliver the reset OTP to email if the email has actually
        # been verified. Otherwise an attacker who signed up with the
        # victim's email (which they don't own) could trigger a reset
        # to land in their own inbox and take over the account. The SMS
        # path above is unaffected — phone is verified at signup.
        if user.email and user.email_verified:
            try:
                from app.services.email_service import EmailService
                EmailService.send_password_reset_email(user, otp)
                logger.debug(f"[SVC:FORGOT_PW] ✓ Reset OTP email sent to user_id={user.id}")
            except Exception as e:
                logger.warning(f"[SVC:FORGOT_PW] Email send failed (OTP still valid): {e}")
        elif user.email and not user.email_verified:
            logger.info(
                f"[SVC:FORGOT_PW] skipping email — unverified for user_id={user.id}"
            )

        return True

    # ─── Post-login email verification ─────────────────────────────────
    #
    # Closes the unverified-email security hole. After signin, the
    # frontend prompts the user to verify their email. That generates a
    # 6-digit OTP, stores it in Redis under ``email_verify_otp:{user_id}``
    # for 10 minutes, and dispatches the OTP via SendClean using the
    # ``verify_email_otp`` template. The verify endpoint accepts the OTP,
    # flips ``email_verified=True`` and clears the Redis key.
    #
    # Rate-limited at the route layer (3 sends/min, 10 verifies/min).

    EMAIL_VERIFY_OTP_PREFIX = 'email_verify_otp:'
    EMAIL_VERIFY_OTP_TTL = 600  # 10 minutes

    @staticmethod
    def send_email_verification_otp(user):
        """Send a 6-digit OTP to ``user.email`` via SendClean.

        :raises ValueError: if no email on file, email already verified,
            or the email send fails.
        """
        import random
        from app.extensions import redis_client
        from app.services.email_service import EmailService

        if not user.email:
            raise ValueError('No email on file for this account.')
        if user.email_verified:
            raise ValueError('Email is already verified.')

        otp = str(random.randint(100000, 999999))
        key = f"{AuthService.EMAIL_VERIFY_OTP_PREFIX}{user.id}"
        redis_client.setex(key, AuthService.EMAIL_VERIFY_OTP_TTL, otp)

        try:
            EmailService.send_email_verification_otp(user, otp)
        except Exception:
            redis_client.delete(key)
            raise
        logger.debug(f"[SVC:EMAIL_VERIFY] OTP sent for user_id={user.id}")
        return True

    @staticmethod
    def verify_email_otp(user, otp):
        """Match ``otp`` against the value stored in Redis. On match, set
        ``email_verified=True`` and consume the key.

        :returns: True on success.
        :raises ValueError: on mismatch / expiry / already-verified.
        """
        from app.extensions import redis_client

        if user.email_verified:
            return True
        key = f"{AuthService.EMAIL_VERIFY_OTP_PREFIX}{user.id}"
        stored = redis_client.get(key)
        if stored is None:
            raise ValueError('OTP expired or not requested. Please request a new one.')
        if isinstance(stored, bytes):
            stored = stored.decode('utf-8')
        if stored != otp:
            raise ValueError('Invalid OTP.')

        user.email_verified = True
        db.session.commit()
        redis_client.delete(key)
        logger.debug(f"[SVC:EMAIL_VERIFY] ✓ user_id={user.id} email verified")
        return True


    @staticmethod
    def verify_reset_otp(identifier, otp):
        """
        Verify the 6-digit OTP entered on the forgot-password page.
        identifier can be email or phone — must match what was used in request_password_reset.
        Returns the full reset token if valid, so the frontend can call reset_password.
        """
        from app.common.encryption import hash_for_search
        from app.extensions import redis_client
        
        identifier_hash = hash_for_search(identifier.strip())
        
        # Get stored OTP code
        stored_otp = redis_client.get(f"reset_otp_code:{identifier_hash}")
        if stored_otp is None:
            raise ValueError("OTP has expired or is invalid. Please request a new one.")
        
        if isinstance(stored_otp, bytes):
            stored_otp = stored_otp.decode('utf-8')
        
        if stored_otp != otp.strip():
            raise ValueError("Incorrect OTP. Please check and try again.")
        
        # Get the associated full token
        token = redis_client.get(f"reset_otp:{identifier_hash}")
        if token is None:
            raise ValueError("OTP has expired. Please request a new one.")
        
        if isinstance(token, bytes):
            token = token.decode('utf-8')
        
        # Delete OTP keys (single-use)
        redis_client.delete(f"reset_otp_code:{identifier_hash}")
        redis_client.delete(f"reset_otp:{identifier_hash}")
        
        logger.debug(f"[SVC:VERIFY_OTP] ✓ OTP verified for identifier_hash={identifier_hash[:8]}...")
        return token  # Frontend uses this token to call reset_password
    @staticmethod
    def reset_password(token, new_password):
        """Reset password using reset token."""
        from app.extensions import redis_client
        
        # Look up token in Redis
        redis_key = f"reset_token:{token}"
        user_id = redis_client.get(redis_key)
        
        if not user_id:
            logger.debug(f"[SVC:RESET_PW] ✗ Token not found or expired")
            raise ValueError("Invalid or expired reset link. Please request a new one.")
        
        # Decode bytes if needed
        if isinstance(user_id, bytes):
            user_id = user_id.decode('utf-8')
        
        # Find user
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user:
            logger.debug(f"[SVC:RESET_PW] ✗ User not found for id={user_id}")
            raise ValueError("Invalid or expired reset link.")
        
        # Set new password
        user.set_password(new_password)
        
        # Delete token from Redis (single-use)
        redis_client.delete(redis_key)
        
        # Revoke all active sessions for security
        AuthService.logout_all(user.id)
        
        db.session.commit()
        logger.info(f"[SVC:RESET_PW] ✓ Password reset for user_id={user.id}")
        return True
