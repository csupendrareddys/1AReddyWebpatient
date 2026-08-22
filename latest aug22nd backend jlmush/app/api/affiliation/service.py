"""
AffiliationService — backing logic for the apex-marketplace doctor↔hospital
roster management surface (Round 8).

The model is single-table: ``DoctorHospitalAffiliation`` carries both
the request lifecycle (PENDING/APPROVED/REJECTED/CANCELLED) and the
confirmed-link is_active flag. PENDING and REJECTED rows have
is_active=False so existing patient-side ``filter_by(is_active=True)``
queries keep surfacing only APPROVED affiliations.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_

from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.common.encryption import hash_for_search
from app.models import (
    Doctor,
    DoctorHospitalAffiliation,
    ProfileEducationDegree,
    get_or_create_profile_owner,
    Hospital,
    Clinic,
    User,
    UserRole,
    UserStatus,
    UserVerificationStatus,
    DoctorAffiliationRequestStatus,
    EmploymentType,
)

logger = logging.getLogger(__name__)


# Invite codes default to 30-day TTL; doctor can revoke / regenerate at
# any time. Short enough that an accidental leak isn't permanent;
# long enough that a hospital admin doesn't need to coordinate the
# share moment with the doctor down to the hour.
INVITE_CODE_TTL_DAYS = 30

# Activation tokens for hospital-invited doctors. Slightly shorter
# window: the doctor is expected to act on a fresh email/SMS; if the
# token expires, the hospital admin can re-issue the invite.
ACTIVATION_TOKEN_TTL_DAYS = 7
ACTIVATION_REDIS_PREFIX = 'doc_invite_activation:'


def _resolve_affiliation_category(tid, cid, name, ctype):
    """Best-effort resolve a degree/specialization id-or-name to a Category id,
    so invited doctors' degree rows carry a real ``degree_category_id`` (needed
    by product degree-gating) instead of always NULL. Prefers a valid id, falls
    back to a case-insensitive name match (active first); returns None if
    nothing matches."""
    from app.models import Category
    if cid:
        c = Category.query.filter_by(
            tenant_id=tid, id=cid, category_type=ctype,
        ).first()
        if c:
            return c.id
    n = (name or '').strip()
    if n:
        c = (Category.query
             .filter(Category.tenant_id == tid,
                     Category.category_type == ctype,
                     db.func.lower(Category.name) == n.lower())
             .order_by(Category.is_active.desc())
             .first())
        if c:
            return c.id
    return None


class AffiliationError(ValueError):
    """Domain error surfaced as 400 by the route layer."""


class AffiliationNotFound(LookupError):
    """Surfaced as 404."""


class AffiliationForbidden(PermissionError):
    """Surfaced as 403."""


def _utcnow():
    return datetime.now(timezone.utc)


def _generate_invite_code() -> str:
    """8-byte token_urlsafe → ~11-char URL-safe code."""
    # secrets.token_urlsafe(8) returns ~11 chars (base64 of 8 bytes).
    # Plenty of entropy to resist guessing (52 bits) yet short enough
    # to read aloud over a phone call between doctor and hospital admin.
    return secrets.token_urlsafe(8)


# ─── Facility resolution ──────────────────────────────────────────────────

def _resolve_facility_for_user(user: User):
    """
    Return ``(facility, vertical)`` where ``facility`` is the Hospital or
    Clinic that the calling user admins, and ``vertical`` is the
    matching ``'hospital'`` or ``'clinic'`` string.

    A user is a facility admin iff (a) their role is HOSPITAL or CLINIC,
    and (b) a Hospital/Clinic row has ``admin_user_id = user.id``. Both
    conditions are checked — a User can carry the role without having
    been claimed by a facility row yet (mid-signup state).
    """
    tid = current_tenant_id_strict()
    if user.role == UserRole.HOSPITAL:
        h = Hospital.query.filter_by(
            tenant_id=tid, admin_user_id=user.id, is_deleted=False,
        ).first()
        if not h:
            raise AffiliationForbidden(
                'No hospital row is linked to this admin user.'
            )
        return h, 'hospital'
    if user.role == UserRole.CLINIC:
        c = Clinic.query.filter_by(
            tenant_id=tid, admin_user_id=user.id, is_deleted=False,
        ).first()
        if not c:
            raise AffiliationForbidden(
                'No clinic row is linked to this admin user.'
            )
        return c, 'clinic'
    raise AffiliationForbidden('Only hospital/clinic admins can manage affiliations.')


def _resolve_doctor_for_user(user: User) -> Doctor:
    tid = current_tenant_id_strict()
    if user.role != UserRole.DOCTOR:
        raise AffiliationForbidden('Only doctors can manage their own invite code.')
    doc = Doctor.query.filter_by(
        tenant_id=tid, user_id=user.id, is_deleted=False,
    ).first()
    if not doc:
        raise AffiliationForbidden('Doctor profile not found for this user.')
    return doc


# ─── Doctor side: invite code lifecycle ──────────────────────────────────

class AffiliationService:
    """Business operations for both doctors and facility admins."""

    @staticmethod
    def get_doctor_invite(user: User):
        """Return the doctor's currently-active invite code, if any."""
        doc = _resolve_doctor_for_user(user)
        code = doc.affiliation_invite_code
        expires_at = doc.affiliation_invite_code_expires_at
        # Lazy expiry: a code that is past its expires_at counts as gone.
        if code and expires_at and expires_at < _utcnow():
            return {
                'code': None,
                'expires_at': None,
                'expired_at': expires_at.isoformat(),
            }
        return {
            'code': code,
            'expires_at': expires_at.isoformat() if expires_at else None,
        }

    @staticmethod
    def generate_doctor_invite(user: User):
        """
        (Re)generate the doctor's invite code. Any prior code is
        overwritten — there is at most one active code per doctor.
        Returns the new code + expires_at.
        """
        doc = _resolve_doctor_for_user(user)
        new_code = _generate_invite_code()
        # The tenant-scoped partial unique index guards against the
        # 2^-52 collision case; retry up to 3 times for safety.
        for attempt in range(3):
            existing = Doctor.query.filter_by(
                tenant_id=doc.tenant_id,
                affiliation_invite_code=new_code,
            ).first()
            if existing is None or existing.id == doc.id:
                break
            new_code = _generate_invite_code()
        else:
            raise AffiliationError(
                'Could not allocate a unique invite code, please try again.'
            )

        doc.affiliation_invite_code = new_code
        doc.affiliation_invite_code_expires_at = (
            _utcnow() + timedelta(days=INVITE_CODE_TTL_DAYS)
        )
        db.session.commit()
        return {
            'code': doc.affiliation_invite_code,
            'expires_at': doc.affiliation_invite_code_expires_at.isoformat(),
        }

    @staticmethod
    def revoke_doctor_invite(user: User):
        doc = _resolve_doctor_for_user(user)
        doc.affiliation_invite_code = None
        doc.affiliation_invite_code_expires_at = None
        db.session.commit()

    # ─── Doctor side: requests inbox ──────────────────────────────────

    @staticmethod
    def list_doctor_requests(user: User):
        """
        List affiliation requests targeting this doctor. Returns both
        PENDING (actionable) and the most-recent resolved rows so the
        UI can render a small history list too.
        """
        doc = _resolve_doctor_for_user(user)
        rows = (
            DoctorHospitalAffiliation.query
            .filter_by(tenant_id=doc.tenant_id, doctor_id=doc.id)
            .order_by(DoctorHospitalAffiliation.created_at.desc())
            .limit(50)
            .all()
        )
        return [r.to_dict() for r in rows]

    @staticmethod
    def respond_to_request(user: User, request_id, approve: bool,
                           rejection_reason: str | None = None):
        doc = _resolve_doctor_for_user(user)
        row = DoctorHospitalAffiliation.query.filter_by(
            tenant_id=doc.tenant_id, id=request_id, doctor_id=doc.id,
        ).first()
        if not row:
            raise AffiliationNotFound('Affiliation request not found.')
        if row.status != DoctorAffiliationRequestStatus.PENDING:
            raise AffiliationError(
                f'Request is already {row.status.value}; cannot modify.'
            )

        if approve:
            row.status = DoctorAffiliationRequestStatus.APPROVED
            row.is_active = True
            row.start_date = _utcnow().date()
        else:
            row.status = DoctorAffiliationRequestStatus.REJECTED
            row.is_active = False
            row.rejection_reason = (rejection_reason or '').strip()[:500] or None
        row.responded_at = _utcnow()
        db.session.commit()
        return row.to_dict()

    # ─── Facility side: code-redeem path ──────────────────────────────

    @staticmethod
    def request_by_code(user: User, code: str, employment_type: str):
        """
        Hospital/clinic admin submits a doctor's invite code +
        employment_type. Creates a PENDING affiliation that the doctor
        must approve before it becomes active.
        """
        facility, vertical = _resolve_facility_for_user(user)
        tid = facility.tenant_id

        code = (code or '').strip()
        if not code:
            raise AffiliationError('Please enter the doctor\'s invite code.')

        try:
            et = EmploymentType(employment_type)
        except (ValueError, KeyError):
            raise AffiliationError(
                f'Invalid employment_type "{employment_type}".'
            )

        doc = Doctor.query.filter_by(
            tenant_id=tid, affiliation_invite_code=code, is_deleted=False,
        ).first()
        if not doc:
            raise AffiliationError('No doctor matches that code.')
        # Lazy-expire: backend re-checks the code's expiry.
        if (
            doc.affiliation_invite_code_expires_at
            and doc.affiliation_invite_code_expires_at < _utcnow()
        ):
            raise AffiliationError(
                'This invite code has expired. Ask the doctor for a new one.'
            )

        # Polymorphic facility: write the row keyed by whichever
        # column matches the calling user's role. The CHECK constraint
        # on the table enforces exactly-one-of, and the partial unique
        # index keys on both columns so a doctor can be active at one
        # hospital OR one clinic but not duplicate either.
        facility_kw = (
            {'hospital_id': facility.id} if vertical == 'hospital'
            else {'clinic_id': facility.id}
        )

        # Idempotency: if a PENDING row already exists for this pair,
        # return it instead of erroring. APPROVED → conflict (already
        # affiliated). Otherwise create a fresh row.
        active = DoctorHospitalAffiliation.query.filter_by(
            tenant_id=tid, doctor_id=doc.id, **facility_kw,
        ).filter(
            DoctorHospitalAffiliation.status.in_([
                DoctorAffiliationRequestStatus.PENDING,
                DoctorAffiliationRequestStatus.APPROVED,
            ])
        ).first()
        if active:
            if active.status == DoctorAffiliationRequestStatus.APPROVED:
                raise AffiliationError(
                    'This doctor is already affiliated with your facility.'
                )
            # PENDING already exists — surface that to the caller.
            return active.to_dict()

        row = DoctorHospitalAffiliation(
            tenant_id=tid,
            doctor_id=doc.id,
            employment_type=et,
            is_active=False,
            status=DoctorAffiliationRequestStatus.PENDING,
            requested_by_user_id=user.id,
            request_method='code',
            invite_code_used=code,
            requested_at=_utcnow(),
            **facility_kw,
        )
        db.session.add(row)
        db.session.commit()
        return row.to_dict()

    @staticmethod
    def list_facility_doctors(user: User, status: str | None = None):
        """
        Roster view for a facility admin. Returns affiliations sorted
        most-recent-first; can be filtered by lifecycle status. Embeds
        the doctor's identity (name, phone, email) so the UI doesn't
        need a second N+1 fetch.
        """
        facility, vertical = _resolve_facility_for_user(user)
        facility_kw = (
            {'hospital_id': facility.id} if vertical == 'hospital'
            else {'clinic_id': facility.id}
        )

        q = (
            DoctorHospitalAffiliation.query
            .filter_by(tenant_id=facility.tenant_id, **facility_kw)
        )
        if status:
            try:
                st = DoctorAffiliationRequestStatus(status)
            except ValueError:
                raise AffiliationError(f'Invalid status "{status}".')
            q = q.filter(DoctorHospitalAffiliation.status == st)
        rows = q.order_by(DoctorHospitalAffiliation.created_at.desc()).all()

        out = []
        for r in rows:
            base = r.to_dict()
            if r.doctor and r.doctor.user:
                base['doctor_phone'] = r.doctor.user.phone_number
                base['doctor_email'] = r.doctor.user.email
                base['doctor_email_verified'] = bool(r.doctor.user.email_verified)
                base['doctor_phone_verified'] = bool(r.doctor.user.phone_verified)
                base['doctor_pending_activation'] = bool(
                    r.doctor.user.must_set_password
                )
            out.append(base)
        return out

    @staticmethod
    def cancel_request(user: User, request_id):
        """Facility admin withdraws their own PENDING request."""
        facility, vertical = _resolve_facility_for_user(user)
        facility_kw = (
            {'hospital_id': facility.id} if vertical == 'hospital'
            else {'clinic_id': facility.id}
        )
        row = DoctorHospitalAffiliation.query.filter_by(
            tenant_id=facility.tenant_id, id=request_id, **facility_kw,
        ).first()
        if not row:
            raise AffiliationNotFound('Request not found.')
        if row.status != DoctorAffiliationRequestStatus.PENDING:
            raise AffiliationError(
                f'Request is already {row.status.value}; cannot cancel.'
            )
        row.status = DoctorAffiliationRequestStatus.CANCELLED
        row.is_active = False
        row.responded_at = _utcnow()
        db.session.commit()
        return row.to_dict()

    # ─── Shared invite core (used by facility, admin, doctor flows) ──

    @staticmethod
    def _create_invited_user(
        *, role: UserRole, tenant_id, first_name: str, last_name: str,
        email: str, phone: str, state: str | None = None,
        dob=None, gender=None,
    ) -> User:
        """Materialize a User row in *pending-activation* state.

        Shared by the three invite surfaces:
          * Facility admin → DOCTOR (this module's ``invite_doctor``)
          * Super-admin / Platform owner → DOCTOR or PATIENT
          * Doctor → PATIENT

        Caller is responsible for: (a) field validation BEFORE calling
        this, (b) creating the role-specific row (Doctor / Patient) +
        any associated rows (affiliations, qualifications), and (c)
        minting + dispatching the activation token afterwards.

        Encapsulated here so the four invariants don't drift between
        callers:
          * ``status = ACTIVE`` (real user, not a draft)
          * ``must_set_password = True``
          * ``email_verified = False`` AND ``phone_verified = False``
          * ``password_hash`` is a random unguessable token (the signin
            gate will refuse anyway, but a guessable hash would be a
            footgun if the gate ever regressed)
        """
        new_user = User(
            first_name=(first_name or '').strip(),
            last_name=(last_name or '').strip(),
            state=(state or '').strip() if state else None,
            dob=dob,
            gender=gender,
            role=role,
            status=UserStatus.ACTIVE,
            tenant_id=tenant_id,
            must_set_password=True,
        )
        new_user.email = email
        new_user.email_verified = False
        new_user.phone_number = phone
        new_user.phone_verified = False
        new_user.set_password(secrets.token_urlsafe(32))
        db.session.add(new_user)
        db.session.flush()
        return new_user

    @staticmethod
    def _dispatch_activation_token(user: User, tenant_id, inviter_name: str):
        """Mint a fresh activation token, persist in Redis, send email + SMS.

        Returns the public activation link so the caller can include it
        in the API response (the admin operator may want to copy it
        out-of-band if the email/SMS delivery hiccups).
        """
        token = secrets.token_urlsafe(32)
        _store_activation_token(token, user.id, tenant_id)
        link = _build_activation_link(token, tenant_id=tenant_id)
        _dispatch_invite_email(user, link, inviter_name)
        _dispatch_invite_sms(user, link, inviter_name)
        return link

    @staticmethod
    def _duplicate_user_check(tenant_id, email: str, phone: str,
                              *, dup_msg_suffix: str = ''):
        """Raise AffiliationError if a User with this email or phone
        already exists in the tenant. ``dup_msg_suffix`` lets the caller
        tailor the recovery hint (e.g. "Ask the doctor for their invite
        code instead." for the facility flow vs. just plain "Already
        exists" for the admin flow)."""
        email_hash = hash_for_search(email)
        phone_hash = hash_for_search(phone)
        if User.query.filter_by(
            tenant_id=tenant_id, _email_hash=email_hash, is_deleted=False,
        ).first():
            raise AffiliationError(
                f"A user with this email already exists.{dup_msg_suffix}"
            )
        if User.query.filter_by(
            tenant_id=tenant_id, _phone_hash=phone_hash, is_deleted=False,
        ).first():
            raise AffiliationError(
                f"A user with this phone number already exists.{dup_msg_suffix}"
            )

    # ─── Facility side: invite-doctor path (no password, no OTP) ─────

    @staticmethod
    def invite_doctor(user: User, data, file_paths, employment_type: str):
        """
        Hospital/clinic admin invites a brand-new doctor onto their
        roster. The hospital does NOT set a password and does NOT
        coordinate any OTPs — they only attest the doctor's identity
        and qualifications. The backend creates the User+Doctor pair
        in a *pending-activation* state:

          * ``status = ACTIVE`` (so the row counts as an authentic
            user, not a half-baked draft)
          * ``must_set_password = True``
          * ``email_verified = False``, ``phone_verified = False``
          * ``password_hash`` set to a random unguessable value so the
            normal signin path can't be brute-forced
          * An APPROVED affiliation row tying the new doctor to the
            calling facility (hospital is vouching)
          * A short-lived activation token stored in Redis; both the
            doctor's email AND phone receive an activation link.

        Signin remains blocked until the doctor walks through the
        activation page (set password → verify email OTP → verify
        phone OTP). The auth.service gate at sign-in time enforces
        this.

        Raises:
            AffiliationError: validation failures, duplicate email/phone.
        """
        facility, vertical = _resolve_facility_for_user(user)

        try:
            et = EmploymentType(employment_type)
        except (ValueError, KeyError):
            raise AffiliationError(
                f'Invalid employment_type "{employment_type}".'
            )

        tid = facility.tenant_id

        # ── Validate required fields ────────────────────────────────
        required = [
            'first_name', 'last_name', 'phone_number', 'email',
            'state', 'registration_number', 'aadhar_number',
        ]
        for k in required:
            if not (data.get(k) or '').strip():
                raise AffiliationError(
                    f"Missing required field: {k.replace('_', ' ')}."
                )

        email = AuthService_normalize_email(data['email'])
        phone = data['phone_number'].strip()

        # ── Duplicate detection (clear "already exists" error) ──────
        # We refuse to mint a second User for the same person. Hospital
        # admin should switch to the code-redeem flow instead.
        email_hash = hash_for_search(email)
        phone_hash = hash_for_search(phone)

        existing_email = User.query.filter_by(
            tenant_id=tid, _email_hash=email_hash, is_deleted=False,
        ).first()
        if existing_email:
            raise AffiliationError(
                "A user with this email already exists. "
                "Ask the doctor for their invite code instead."
            )
        existing_phone = User.query.filter_by(
            tenant_id=tid, _phone_hash=phone_hash, is_deleted=False,
        ).first()
        if existing_phone:
            raise AffiliationError(
                "A user with this phone number already exists. "
                "Ask the doctor for their invite code instead."
            )
        existing_reg = Doctor.query.filter_by(
            tenant_id=tid,
            registration_number=data['registration_number'],
            is_deleted=False,
        ).first()
        if existing_reg:
            raise AffiliationError(
                "A doctor with this MCI registration number already exists."
            )
        existing_aadhar = Doctor.query.filter_by(
            tenant_id=tid, aadhar_number=data['aadhar_number'],
            is_deleted=False,
        ).first()
        if existing_aadhar:
            raise AffiliationError(
                "A doctor with this Aadhaar number already exists."
            )

        # ── Create User + Doctor in pending-activation state ────────
        new_user = User(
            first_name=data['first_name'].strip(),
            last_name=data['last_name'].strip(),
            state=data['state'].strip(),
            role=UserRole.DOCTOR,
            status=UserStatus.ACTIVE,
            tenant_id=tid,
            must_set_password=True,
        )
        new_user.email = email
        new_user.email_verified = False
        new_user.phone_number = phone
        new_user.phone_verified = False
        # Random unguessable password — signin gate will reject anyway
        # because of must_set_password=True, but a guessable hash would
        # be a footgun if the gate ever regressed.
        new_user.set_password(secrets.token_urlsafe(32))

        db.session.add(new_user)
        db.session.flush()

        if not file_paths.get('registration_certificate'):
            raise AffiliationError('Registration certificate file is required.')
        if not file_paths.get('aadhar_attachment'):
            raise AffiliationError('Aadhaar document is required.')

        new_doctor = Doctor(
            user_id=new_user.id,
            tenant_id=tid,
            aadhar_number=data['aadhar_number'].strip(),
            aadhar_attachment=file_paths['aadhar_attachment'],
            registration_number=data['registration_number'].strip(),
            registration_certificate=file_paths['registration_certificate'],
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(new_doctor)
        db.session.flush()

        # Optional qualifications (same shape as /auth/signup/doctor's
        # ``qualifications`` array)
        qualifications = data.get('qualifications') or []
        cert_paths = file_paths.get('qualification_certificates') or []
        for i, qual in enumerate(qualifications):
            if not (qual.get('degree_name') or '').strip():
                continue
            cert = cert_paths[i] if i < len(cert_paths) else ''
            _raw_year = qual.get('year_of_passing')
            try:
                _year = int(str(_raw_year).strip()) if _raw_year not in (None, '') else None
            except (ValueError, TypeError):
                _year = None
            db.session.add(ProfileEducationDegree(
                doctor_id=new_doctor.id,
                tenant_id=tid,
                profile_owner_id=get_or_create_profile_owner('doctor', new_doctor.id, tid).id,
                degree_name=qual['degree_name'],
                institution=qual.get('institution', ''),
                certificate_link=cert,
                passing_year=_year,
                degree_category_id=_resolve_affiliation_category(
                    tid, qual.get('degree_id'), qual.get('degree_name'), 'degree'),
            ))

        # APPROVED affiliation — the facility admin attests the
        # identity; the doctor doesn't need to re-approve their own
        # employer.
        facility_kw = (
            {'hospital_id': facility.id} if vertical == 'hospital'
            else {'clinic_id': facility.id}
        )
        affiliation = DoctorHospitalAffiliation(
            tenant_id=tid,
            doctor_id=new_doctor.id,
            employment_type=et,
            is_active=True,
            status=DoctorAffiliationRequestStatus.APPROVED,
            requested_by_user_id=user.id,
            request_method='invite',
            requested_at=_utcnow(),
            responded_at=_utcnow(),
            start_date=_utcnow().date(),
            **facility_kw,
        )
        db.session.add(affiliation)
        db.session.commit()

        # ── Mint activation token, store in Redis, dispatch invite ──
        token = secrets.token_urlsafe(32)
        _store_activation_token(token, new_user.id, tid)

        invite_link = _build_activation_link(token, tenant_id=tid)
        facility_name = (
            facility.name if hasattr(facility, 'name') else 'the facility'
        )
        _dispatch_invite_email(new_user, invite_link, facility_name)
        _dispatch_invite_sms(new_user, invite_link, facility_name)

        return {
            'user_id': str(new_user.id),
            'doctor_id': str(new_doctor.id),
            'affiliation': affiliation.to_dict(),
            'invite_email_sent_to': email,
            'invite_sms_sent_to': phone,
            'activation_link': invite_link,  # also returned for admin to copy
        }

    # ─── Admin- and doctor-driven invites ─────────────────────────────
    # The facility ``invite_doctor`` above is hospital/clinic specific.
    # The four entry points below cover the three new flows asked for
    # in the round-9 admin tooling work:
    #
    #   * ``admin_invite_doctor``  — super_admin / platform_owner
    #     invites a doctor into their tenant. No facility affiliation
    #     (admins aren't a facility); doctor lands on the tenant roster
    #     and can affiliate with a hospital later via the existing
    #     code-redeem path.
    #   * ``admin_invite_patient`` — super_admin / platform_owner
    #     invites a patient into their tenant.
    #   * ``doctor_invite_patient`` — doctor invites a patient into
    #     the doctor's tenant. Same shape as admin_invite_patient,
    #     just gated by role.
    #
    # All three reuse ``_create_invited_user`` +
    # ``_dispatch_activation_token`` so the must_set_password/redis/
    # email/SMS invariants stay identical to the facility flow.

    @staticmethod
    def admin_invite_doctor(inviter: User, data, file_paths):
        """Tenant admin invites a doctor. The doctor lands on the
        tenant's roster in pending-activation state — same end-state
        as ``invite_doctor`` but without the facility affiliation row.
        """
        tid = current_tenant_id_strict()

        required = [
            'first_name', 'last_name', 'phone_number', 'email',
            'state', 'registration_number', 'aadhar_number',
        ]
        for k in required:
            if not (data.get(k) or '').strip():
                raise AffiliationError(
                    f"Missing required field: {k.replace('_', ' ')}."
                )

        email = AuthService_normalize_email(data['email'])
        phone = data['phone_number'].strip()
        AffiliationService._duplicate_user_check(tid, email, phone)
        if Doctor.query.filter_by(
            tenant_id=tid,
            registration_number=data['registration_number'],
            is_deleted=False,
        ).first():
            raise AffiliationError(
                'A doctor with this registration number already exists.'
            )
        if Doctor.query.filter_by(
            tenant_id=tid, aadhar_number=data['aadhar_number'],
            is_deleted=False,
        ).first():
            raise AffiliationError(
                'A doctor with this Aadhaar number already exists.'
            )

        new_user = AffiliationService._create_invited_user(
            role=UserRole.DOCTOR, tenant_id=tid,
            first_name=data['first_name'], last_name=data['last_name'],
            email=email, phone=phone, state=data['state'],
        )

        if not file_paths.get('registration_certificate'):
            raise AffiliationError('Registration certificate is required.')
        if not file_paths.get('aadhar_attachment'):
            raise AffiliationError('Aadhaar document is required.')

        new_doctor = Doctor(
            user_id=new_user.id,
            tenant_id=tid,
            aadhar_number=data['aadhar_number'].strip(),
            aadhar_attachment=file_paths['aadhar_attachment'],
            registration_number=data['registration_number'].strip(),
            registration_certificate=file_paths['registration_certificate'],
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(new_doctor)
        db.session.flush()

        qualifications = data.get('qualifications') or []
        cert_paths = file_paths.get('qualification_certificates') or []
        for i, qual in enumerate(qualifications):
            if not (qual.get('degree_name') or '').strip():
                continue
            cert = cert_paths[i] if i < len(cert_paths) else ''
            _raw_year = qual.get('year_of_passing')
            try:
                _year = int(str(_raw_year).strip()) if _raw_year not in (None, '') else None
            except (ValueError, TypeError):
                _year = None
            db.session.add(ProfileEducationDegree(
                doctor_id=new_doctor.id,
                tenant_id=tid,
                profile_owner_id=get_or_create_profile_owner('doctor', new_doctor.id, tid).id,
                degree_name=qual['degree_name'],
                institution=qual.get('institution', ''),
                certificate_link=cert,
                passing_year=_year,
                degree_category_id=_resolve_affiliation_category(
                    tid, qual.get('degree_id'), qual.get('degree_name'), 'degree'),
            ))

        db.session.commit()

        inviter_name = _inviter_display_name(inviter)
        link = AffiliationService._dispatch_activation_token(new_user, tid, inviter_name)
        return {
            'user_id': str(new_user.id),
            'doctor_id': str(new_doctor.id),
            'invite_email_sent_to': email,
            'invite_sms_sent_to': phone,
            'activation_link': link,
        }

    @staticmethod
    def _attach_in_tenant_provider_subscription_or_warn(
        *, vertical, provider_id, user_id, plan_code, tenant_id,
    ):
        """Bind a freshly-invited facility / doctor to one of the
        TENANT'S authored provider plans, in PENDING state.

        Earlier code routed through ``AuthService._attach_provider_membership_or_warn``,
        which creates a ``MembershipSubscription`` against an APEX
        ``MembershipPlan``. The invite dialog on a subscriber tenant
        (e.g. jlmush.in) picks plan codes from
        ``/api/tenant-provider-plans/public/<vertical>`` — those are
        ``TenantProviderPlan`` codes that don't exist in the apex
        catalog. The apex attach silently raised
        ``MembershipPlanNotFound``, was logged + dropped, and the
        invited hospital landed in production with no subscription
        row — surfacing as "No membership tier yet" on the
        provider's My Membership page.

        This helper does the right thing: looks up the
        ``TenantProviderPlan`` by ``(tenant_id, code)``, then calls
        ``TenantProviderSubscriptionService.create_pending_for_provider``
        so the My Membership page (which already queries BOTH apex
        and in-tenant endpoints) finds the row.

        Best-effort on failure — logs WARN and lets the invite
        proceed so the operator can fix the plan attachment after
        the fact rather than blocking activation.
        """
        if not plan_code:
            return
        try:
            from app.api.tenant_provider_plan.service import (
                TenantProviderSubscriptionService,
                PlanNotFound, PlanCodeConflict, WrongVertical,
                ProviderQuotaExceeded, SubscriptionExists,
                TenantProviderPlanError,
            )
            from app.models import (
                TenantProviderPlan, MembershipPlanStatus, MembershipVertical,
            )
        except ImportError as e:
            logger.warning(
                '[INVITE_%s] tenant_provider_plan service unavailable '
                '(import error: %s); skipping plan attach.',
                vertical.upper(), e,
            )
            return

        try:
            v_enum = MembershipVertical(vertical)
        except ValueError:
            logger.warning(
                '[INVITE_%s] unknown vertical for plan attach; skipping.',
                vertical.upper(),
            )
            return

        plan = (
            TenantProviderPlan.query
            .filter_by(
                tenant_id=tenant_id, code=plan_code, is_deleted=False,
            )
            .first()
        )
        if plan is None:
            logger.warning(
                '[INVITE_%s] plan_code=%r not found in tenant=%s — '
                'check that the operator picked a code that exists in '
                'this tenant\'s authored TenantProviderPlan rows.',
                vertical.upper(), plan_code, tenant_id,
            )
            return
        if plan.status != MembershipPlanStatus.ACTIVE:
            logger.warning(
                '[INVITE_%s] plan_code=%r exists but is not ACTIVE '
                '(status=%s) — skipping attach.',
                vertical.upper(), plan_code, plan.status.value,
            )
            return

        try:
            TenantProviderSubscriptionService.create_pending_for_provider(
                tenant_id=tenant_id,
                vertical=v_enum,
                provider_id=provider_id,
                user_id=user_id,
                plan_id=plan.id,
            )
        except (
            PlanNotFound, WrongVertical, ProviderQuotaExceeded,
            SubscriptionExists, PlanCodeConflict,
            TenantProviderPlanError,
        ) as exc:
            logger.warning(
                '[INVITE_%s] subscription create failed for '
                'user=%s provider=%s plan_code=%s: %s',
                vertical.upper(), user_id, provider_id, plan_code, exc,
            )

    @staticmethod
    def admin_invite_hospital(inviter: User, data, file_paths):
        """Tenant admin invites a hospital onto their tenant. Creates
        User (role=HOSPITAL, pending-activation) + Hospital
        (verification_status=PENDING) and optionally attaches a
        marketplace plan via the existing provider-membership helper.

        The Hospital lands in PENDING verification so a tenant admin
        can still review it after the hospital admin activates and
        signs in — same gate as the public signup flow.
        """
        from app.models import Hospital, UserVerificationStatus

        return AffiliationService._invite_facility_core(
            inviter=inviter, data=data, file_paths=file_paths,
            vertical='hospital', facility_model=Hospital,
            role=UserRole.HOSPITAL,
            verification_pending=UserVerificationStatus.PENDING,
        )

    @staticmethod
    def admin_invite_clinic(inviter: User, data, file_paths):
        """Tenant admin invites a clinic onto their tenant. Same shape
        as ``admin_invite_hospital`` — role=CLINIC, model=Clinic."""
        from app.models import Clinic, UserVerificationStatus

        return AffiliationService._invite_facility_core(
            inviter=inviter, data=data, file_paths=file_paths,
            vertical='clinic', facility_model=Clinic,
            role=UserRole.CLINIC,
            verification_pending=UserVerificationStatus.PENDING,
        )

    @staticmethod
    def _invite_facility_core(*, inviter, data, file_paths, vertical,
                              facility_model, role,
                              verification_pending):
        """Shared body for admin_invite_hospital + admin_invite_clinic.

        Hospitals and clinics differ only in their model class and the
        ``hospital_type`` field (hospital-only). Everything else —
        validation, duplicate detection, User + Facility row creation,
        plan attachment, activation token dispatch — is identical.
        """
        tid = current_tenant_id_strict()

        required = [
            'first_name', 'last_name', 'phone_number', 'email',
            'name', 'address', 'city', 'pincode',
        ]
        for k in required:
            if not (data.get(k) or '').strip():
                raise AffiliationError(
                    f"Missing required field: {k.replace('_', ' ')}."
                )

        email = AuthService_normalize_email(data['email'])
        phone = data['phone_number'].strip()
        AffiliationService._duplicate_user_check(tid, email, phone)

        if data.get('registration_number'):
            existing_reg = facility_model.query.filter_by(
                registration_number=data['registration_number'].strip(),
                tenant_id=tid,
                is_deleted=False,
            ).first()
            if existing_reg:
                raise AffiliationError(
                    f'Registration number already registered for a {vertical}.'
                )

        new_user = AffiliationService._create_invited_user(
            role=role, tenant_id=tid,
            first_name=data['first_name'], last_name=data['last_name'],
            email=email, phone=phone, state=data.get('state'),
        )

        # Build the facility row. Hospital + Clinic share most columns
        # but the schema is NOT symmetric:
        #   * ``hospital_type`` is hospital-only
        #   * ``registration_certificate`` is CLINIC-ONLY (the Hospital
        #     model has admin_aadhaar_attachment but no
        #     registration_certificate column — same shape the public
        #     ``signup_hospital`` flow uses). Passing it to
        #     ``Hospital(...)`` raises ``TypeError: 'registration_certificate'
        #     is an invalid keyword argument for Hospital``, which is
        #     exactly the 500 a Round-9 hospital invite from jlmush
        #     surfaced in prod.
        # Mirror the public-signup contract: store the cert only on
        # clinic; log + drop on hospital so the operator can see in
        # CloudWatch that the file didn't persist (rather than the
        # invite silently 500'ing).
        facility_kwargs = dict(
            tenant_id=tid,
            admin_user_id=new_user.id,
            name=data['name'].strip(),
            registration_number=(data.get('registration_number') or '').strip() or None,
            phone=(data.get('phone') or phone).strip(),
            email=email,
            website=(data.get('website') or '').strip() or None,
            address=data['address'].strip(),
            city=data['city'].strip(),
            state=(data.get('state') or '').strip(),
            pincode=data['pincode'].strip(),
            admin_aadhaar_attachment=file_paths.get('admin_aadhaar_attachment'),
            verification_status=verification_pending,
        )
        if vertical == 'clinic':
            facility_kwargs['registration_certificate'] = (
                file_paths.get('registration_certificate')
            )
        elif vertical == 'hospital' and file_paths.get('registration_certificate'):
            logger.warning(
                "[INVITE_HOSPITAL] registration_certificate uploaded but "
                "Hospital model has no column for it — dropping. "
                "Hospital admin can re-upload after activation via the "
                "facility profile surface."
            )
        if vertical == 'hospital' and data.get('hospital_type'):
            facility_kwargs['hospital_type'] = data['hospital_type']

        facility = facility_model(**facility_kwargs)
        db.session.add(facility)
        db.session.commit()

        # Optional in-tenant provider plan attach. The invite dialog
        # populates its plan dropdown from the tenant's authored
        # ``TenantProviderPlan`` catalog (not the apex marketplace
        # catalog), so we must persist a ``TenantProviderSubscription``
        # — NOT a ``MembershipSubscription``. Earlier code routed
        # through the apex helper and silently dropped every
        # subscription because the codes didn't exist in the apex
        # ``MembershipPlan`` table (surfaced as "No membership tier
        # yet" on the invitee's My Membership page).
        # ``plan_code=None`` is a no-op (plan was optional or the
        # tenant had no published plans).
        plan_code = (data.get('plan_code') or '').strip() or None
        AffiliationService._attach_in_tenant_provider_subscription_or_warn(
            vertical=vertical,
            provider_id=facility.id,
            user_id=new_user.id,
            plan_code=plan_code,
            tenant_id=tid,
        )

        inviter_name = _inviter_display_name(inviter)
        link = AffiliationService._dispatch_activation_token(
            new_user, tid, inviter_name,
        )
        return {
            'user_id': str(new_user.id),
            f'{vertical}_id': str(facility.id),
            'invite_email_sent_to': email,
            'invite_sms_sent_to': phone,
            'activation_link': link,
        }

    @staticmethod
    def admin_invite_patient(inviter: User, data):
        """Tenant admin invites a patient. JSON payload — no file
        uploads (patients don't carry identity documents at signup)."""
        return AffiliationService._invite_patient_core(inviter, data)

    @staticmethod
    def doctor_invite_patient(inviter: User, data):
        """Doctor invites a patient. Same shape as admin invite; the
        patient is scoped to the doctor's tenant via current_tenant_id."""
        return AffiliationService._invite_patient_core(inviter, data)

    @staticmethod
    def _invite_patient_core(inviter: User, data):
        """Shared body for admin_invite_patient + doctor_invite_patient.

        Patients have a much smaller required-field set than doctors:
        name, phone, email. DOB / gender are optional but accepted
        when sent so the patient profile is partially pre-filled.
        """
        from app.models import Patient

        tid = current_tenant_id_strict()

        required = ['first_name', 'last_name', 'phone_number', 'email']
        for k in required:
            if not (data.get(k) or '').strip():
                raise AffiliationError(
                    f"Missing required field: {k.replace('_', ' ')}."
                )

        email = AuthService_normalize_email(data['email'])
        phone = data['phone_number'].strip()
        AffiliationService._duplicate_user_check(tid, email, phone)

        dob = data.get('dob') or None
        gender = data.get('gender') or None
        # Accept both 'F'/'M' shortcodes and the full enum names so the
        # frontend can use whichever is more natural.
        if gender:
            from app.models._enums import Gender
            try:
                gender = Gender(gender) if isinstance(gender, str) else gender
            except ValueError:
                raise AffiliationError(f'Invalid gender "{gender}".')

        new_user = AffiliationService._create_invited_user(
            role=UserRole.PATIENT, tenant_id=tid,
            first_name=data['first_name'], last_name=data['last_name'],
            email=email, phone=phone, dob=dob, gender=gender,
        )

        new_patient = Patient(
            user_id=new_user.id,
            tenant_id=tid,
            # Round-10 followup audit trail — who invited this
            # patient. Lets the doctor's My Patients page filter
            # "patients I invited" without joining via approvals or
            # appointments. Admin invites record the admin user too,
            # which is the right call for "who added this patient"
            # in the future admin invitee-roster surface.
            invited_by_user_id=inviter.id,
        )
        db.session.add(new_patient)
        db.session.commit()

        inviter_name = _inviter_display_name(inviter)
        link = AffiliationService._dispatch_activation_token(new_user, tid, inviter_name)
        return {
            'user_id': str(new_user.id),
            'patient_id': str(new_patient.id),
            'invite_email_sent_to': email,
            'invite_sms_sent_to': phone,
            'activation_link': link,
        }

    # ─── Activation flow (doctor-driven via the magic link) ──────────

    @staticmethod
    def activation_lookup(token: str):
        """Token → identity + step state. Drives the activation page."""
        payload = _read_activation_token(token)
        if not payload:
            raise AffiliationError('This activation link is invalid or expired.')
        user_id = payload['user_id']
        u = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not u:
            raise AffiliationError('Account not found for this activation link.')
        return {
            'first_name': u.first_name,
            'last_name': u.last_name,
            'email': u.email,
            'phone_number': u.phone_number,
            'must_set_password': bool(u.must_set_password),
            'email_verified': bool(u.email_verified),
            'phone_verified': bool(u.phone_verified),
        }

    @staticmethod
    def activation_set_password(token: str, new_password: str):
        u = _resolve_activation_user(token)
        if not new_password or len(new_password) < 8:
            raise AffiliationError('Password must be at least 8 characters.')
        u.set_password(new_password)
        u.must_set_password = False
        db.session.commit()
        return {'must_set_password': False}

    @staticmethod
    def activation_send_email_otp(token: str):
        """Generate a fresh OTP, store under ``pre_signup_email_otp:<email>``
        (same key the verify path reads), then send via EmailService.
        If the provider fails the OTP stays in Redis so dev / on-call
        can read it from the logs and test the verify path manually.
        """
        u = _resolve_activation_user(token)
        otp = _generate_otp()
        _store_activation_otp('email', u.email, otp)
        try:
            from app.services.email_service import EmailService
            EmailService.send_email_verification_otp(u, otp)
        except Exception as e:
            logger.warning(
                '[ACTIVATE] email OTP send failed (non-fatal, OTP retained): %s', e,
            )
        return {'sent_to': u.email}

    @staticmethod
    def activation_verify_email_otp(token: str, otp: str):
        u = _resolve_activation_user(token)
        if not _verify_activation_otp('email', u.email, otp):
            raise AffiliationError('Invalid or expired OTP.')
        u.email_verified = True
        db.session.commit()
        return {'email_verified': True}

    @staticmethod
    def activation_send_phone_otp(token: str):
        """Generate a fresh OTP, store under ``pre_signup_phone_otp:<phone>``
        (same key SMSService.verify_pre_signup_phone_otp reads), then
        attempt the Combirds send. If the provider is unconfigured the
        OTP stays in Redis so the activation can still complete
        (operator reads the OTP out of the backend log).
        """
        u = _resolve_activation_user(token)
        otp = _generate_otp()
        _store_activation_otp('phone', u.phone_number, otp)
        try:
            from app.services.sms_service import SMSService
            # Send via the existing DLT path. NB: SMSService internally
            # generates its OWN otp and overwrites the Redis key. To
            # keep our planted OTP authoritative we don't actually call
            # the OTP-generating wrapper — we just use the raw template
            # body via ``send_sms`` so the SMS arrives with OUR otp.
            SMSService.send_sms(
                u.phone_number, 'signup_otp',
                first_name=u.first_name or 'there', otp=otp,
            )
        except Exception as e:
            logger.warning(
                '[ACTIVATE] phone OTP send failed (non-fatal, OTP retained): %s', e,
            )
        return {'sent_to': u.phone_number}

    @staticmethod
    def activation_verify_phone_otp(token: str, otp: str):
        u = _resolve_activation_user(token)
        if not _verify_activation_otp('phone', u.phone_number, otp):
            raise AffiliationError('Invalid or expired OTP.')
        u.phone_verified = True
        db.session.commit()
        # Activation is "done" when password set + both contacts
        # verified. We deliberately do NOT mint an access token here —
        # the doctor signs in via the normal /auth/signin path with the
        # password they just set.
        if u.email_verified and not u.must_set_password:
            _delete_activation_token(token)
        return {
            'phone_verified': True,
            'activation_complete': (
                u.email_verified and u.phone_verified and not u.must_set_password
            ),
        }


# ─── Activation token helpers (Redis-backed) ────────────────────────────

def _redis():
    """Return Flask's Redis client; raise a clear error if unconfigured."""
    # ``app.extensions.redis_client`` is a module attribute, not a
    # Flask extension entry — match the convention used by auth.service.
    from app.extensions import redis_client
    if redis_client is None:
        raise AffiliationError(
            'Redis not configured — activation tokens unavailable.'
        )
    return redis_client


# Activation OTPs reuse the same Redis prefixes as the regular pre-
# signup flow, so any future cross-check (SMSService.verify_*,
# AuthService.verify_pre_signup_*) reads the same key. The activation
# path itself however bypasses the duplicate-User guard inside
# ``send_pre_signup_*_otp`` because the invited doctor's User row
# already exists by design.
ACTIVATION_OTP_TTL = 600
ACTIVATION_EMAIL_OTP_PREFIX = 'pre_signup_email_otp:'
ACTIVATION_PHONE_OTP_PREFIX = 'pre_signup_phone_otp:'


def _generate_otp():
    """6-digit numeric OTP, padded to 6 chars."""
    return f'{secrets.randbelow(900000) + 100000:06d}'


def _store_activation_otp(kind: str, identifier: str, otp: str):
    r = _redis()
    prefix = (
        ACTIVATION_EMAIL_OTP_PREFIX if kind == 'email'
        else ACTIVATION_PHONE_OTP_PREFIX
    )
    r.setex(prefix + identifier, ACTIVATION_OTP_TTL, otp)


def _verify_activation_otp(kind: str, identifier: str, otp: str) -> bool:
    r = _redis()
    prefix = (
        ACTIVATION_EMAIL_OTP_PREFIX if kind == 'email'
        else ACTIVATION_PHONE_OTP_PREFIX
    )
    key = prefix + identifier
    stored = r.get(key)
    if stored is None:
        return False
    if isinstance(stored, bytes):
        stored = stored.decode('utf-8')
    if stored != (otp or '').strip():
        return False
    r.delete(key)
    return True


def _store_activation_token(token: str, user_id, tenant_id):
    r = _redis()
    payload = f'{user_id}|{tenant_id}'
    r.setex(
        ACTIVATION_REDIS_PREFIX + token, ACTIVATION_TOKEN_TTL_DAYS * 86400,
        payload,
    )


def _read_activation_token(token: str):
    r = _redis()
    raw = r.get(ACTIVATION_REDIS_PREFIX + token)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode()
    user_id, tenant_id = raw.split('|', 1)
    return {'user_id': user_id, 'tenant_id': tenant_id}


def _delete_activation_token(token: str):
    r = _redis()
    r.delete(ACTIVATION_REDIS_PREFIX + token)


def _resolve_activation_user(token: str) -> User:
    payload = _read_activation_token(token)
    if not payload:
        raise AffiliationError('This activation link is invalid or expired.')
    u = User.query.filter_by(id=payload['user_id'], is_deleted=False).first()
    if not u:
        raise AffiliationError('Account not found for this activation link.')
    return u


def _resolve_frontend_base(tenant_id=None) -> str:
    """Resolve the FRONTEND base URL for the current request / tenant.

    Shared by ``_build_activation_link`` and ``build_login_url`` so
    they apply the same multi-tenant routing rules (and break in the
    same way, with the same fallbacks, if anyone changes one).

    Priority — first match wins:

      1. ``X-Tenant-Host`` header (explicit, set by our frontend's
         axios interceptor) paired with ``request.scheme`` (honours
         ``X-Forwarded-Proto`` via ProxyFix).
      2. ``Origin`` header (browser-set on cross-origin requests).
      3. ``Tenant.fqdn`` / ``Tenant.domain`` DB lookup using
         ``tenant_id`` (for non-browser callers like background jobs).
      4. ``FRONTEND_BASE_URL`` config (single-host dev fallback).
      5. Hardcoded ``http://localhost:3001`` (last-resort dev).

    Returns the base URL WITHOUT a trailing slash so callers can
    just append ``/auth/...``.
    """
    from flask import current_app, has_request_context, request

    if has_request_context():
        host_header = (request.headers.get('X-Tenant-Host') or '').strip()
        if host_header:
            return f'{request.scheme}://{host_header}'.rstrip('/')
        origin = (request.headers.get('Origin') or '').strip()
        if origin.startswith(('http://', 'https://')):
            return origin.rstrip('/')

    if tenant_id is not None:
        try:
            from app.models import Tenant
            t = Tenant.query.get(tenant_id)
            if t:
                host = getattr(t, 'fqdn', None) or getattr(t, 'domain', None)
                if host:
                    scheme = 'http' if 'localhost' in host else 'https'
                    return f'{scheme}://{host}'.rstrip('/')
        except Exception:  # noqa: BLE001
            pass

    return current_app.config.get(
        'FRONTEND_BASE_URL', 'http://localhost:3001',
    ).rstrip('/')


# Map role enum-value strings → the frontend path that hosts the
# login form for that role. Matches the route table in
# ``Frontend/src/route.jsx``:
#   /auth/service-receiver/login  → PATIENT
#   /auth/service-provider/login  → DOCTOR + facility roles (Round 8.5)
#   /auth/admin/login             → SUPER_ADMIN / SUB_ADMIN / PLATFORM_OWNER
#
# The legacy ``/auth/login`` path that the previous email used does
# NOT exist in the frontend — it 404'd. Verified doctors who
# clicked "Sign in to <tenant>" got a blank page.
_ROLE_LOGIN_PATH = {
    'patient':         '/auth/service-receiver/login',
    'doctor':          '/auth/service-provider/login',
    'hospital':        '/auth/service-provider/login',
    'clinic':          '/auth/service-provider/login',
    'pharmacy':        '/auth/service-provider/login',
    'diagnosis':       '/auth/service-provider/login',
    'super_admin':     '/auth/admin/login',
    'sub_admin':       '/auth/admin/login',
    'platform_owner':  '/auth/admin/login',
}


def build_login_url(role=None, tenant_id=None) -> str:
    """Per-tenant, per-role sign-in URL for notification emails / SMS.

    ``role`` can be a ``UserRole`` enum, the enum value string, or
    None (defaults to the service-provider portal — most invite
    emails go to doctors and facility admins). Unknown role strings
    also fall back to service-provider so a typo in a template
    never lands the user on a 404.
    """
    from app.models import UserRole

    role_str = None
    if role is None:
        pass
    elif isinstance(role, UserRole):
        role_str = role.value
    else:
        role_str = str(role).lower()

    path = _ROLE_LOGIN_PATH.get(role_str, '/auth/service-provider/login')
    return f'{_resolve_frontend_base(tenant_id=tenant_id)}{path}'


def _build_activation_link(token: str, tenant_id=None) -> str:
    """Build the per-tenant ``/auth/activate?token=…`` URL.

    Host resolution shared with ``build_login_url`` — see
    ``_resolve_frontend_base`` for the priority chain.
    """
    return f'{_resolve_frontend_base(tenant_id=tenant_id)}/auth/activate?token={token}'


def _dispatch_invite_email(user: User, link: str, facility_name: str):
    """Best-effort outbound email — uses the existing ``staff_invited``
    template (recipient_name, inviter_name, accept_url). Failure is
    logged but not raised; the admin still gets the activation_link
    back in the response so they can share it out-of-band."""
    try:
        from app.services.email_service import EmailService
        EmailService.send_staff_invited_email(
            to_email=user.email,
            first_name=user.first_name,
            inviter_name=facility_name,
            accept_url=link,
        )
    except Exception as e:
        logger.warning('[INVITE] activation email failed (non-fatal): %s', e)


def _dispatch_invite_sms(user: User, link: str, facility_name: str):
    """Best-effort outbound SMS — uses the existing ``staff_invited``
    DLT template. Body does not carry the link (template is fixed);
    the SMS just notifies the doctor to check their email/dashboard.
    Failure is logged but not raised."""
    try:
        from app.services.sms_service import SMSService
        SMSService.send_staff_invited_sms(
            phone_number=user.phone_number,
            first_name=user.first_name,
            company_name=facility_name,
        )
    except Exception as e:
        logger.warning('[INVITE] activation SMS failed (non-fatal): %s', e)


def AuthService_normalize_email(email):
    """Mirror of AuthService._normalize_email; defined locally so this
    module can run without importing auth.service (circular-friendly)."""
    return (email or '').strip().lower()


def _inviter_display_name(inviter: User) -> str:
    """Resolve a human-readable name for the activation email/SMS body.

    Order of preference:
      1. Tenant name (so the invitee sees "Welcome to Larazen" rather
         than "Welcome from Anish Doctor" — the brand identity is
         what they recognize)
      2. Inviter's own full name (fallback)
      3. Plain "the team" (safety net)
    """
    try:
        if getattr(inviter, 'tenant', None) and inviter.tenant.name:
            return inviter.tenant.name
    except Exception:  # noqa: BLE001
        pass
    if inviter and (inviter.first_name or inviter.last_name):
        return ' '.join(filter(None, [inviter.first_name, inviter.last_name]))
    return 'the team'
