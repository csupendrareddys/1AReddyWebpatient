"""Patient Support Staff API — two audiences, one blueprint (/api/patient-staff).

**The OWNER (a patient)** provisions and manages caregivers: create a login,
list seats, rename / reset password, assign roles, suspend, revoke. Every owner
route is ``@role_required(PATIENT)`` and resolves the caller's OWN ``Patient`` —
a patient id is never taken from the body. This is the anti-self-escalation
wall, and it is free here: a caregiver's account carries ``role=PATIENT_STAFF``,
so ``role_required(PATIENT)`` alone bars them from every management route. A
caregiver can never create staff or grant themselves a role.

**The CAREGIVER (``role=PATIENT_STAFF``)** has exactly two surfaces: ``GET /me``
(who am I / which patient / what may I do) and the act proxy
(``/act/<patient_id>/<subpath>``), which runs a patient self-service endpoint AS
the patient — bounded by the caregiver's role (``rules.linked_adult_allowed``:
GET needs ``view``, writes need ``manage``, fail closed) and stamped with the
caregiver as the real actor (accountability).

Roles + the permission matrix are the shared ``PatientRole`` machinery, authored
via ``/api/patient-family/roles``; a caregiver and a linked adult are gated the
same way.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.extensions import db
from app.api.patient_staff import patient_staff_bp
from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
    forbidden_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.common.patient_staff_credentials import (
    ensure_patient_staff_user, revoke_patient_staff_login,
)
from app.common.patient_staff_access import (
    staff_seats_for, seat_for_patient, effective_grants,
)
from app.api.patient_family.service import PatientRoleService
from app.models import (
    UserRole, UserStatus, Patient, PatientRole,
    PatientStaff, PatientStaffRole, PatientStaffStatus,
)
from app.models._base import utcnow, soft_delete_record


# ── owner helpers ────────────────────────────────────────────────────────────

def _owner_patient():
    """The caller's own Patient row (they are the employer)."""
    return Patient.query.filter_by(
        user_id=current_user.id, tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()


def _owned_staff(staff_id, patient):
    """A caregiver seat that belongs to ``patient``, or None. Scoping the lookup
    to the owner is the authorization check — no seat is addressable across
    patients."""
    if not patient:
        return None
    return PatientStaff.query.filter_by(
        id=staff_id, patient_id=patient.id, is_deleted=False,
    ).first()


def _assignable_role(patient, role_id):
    """A role the owner may grant: one of their OWN private roles, or a shared
    (owner-null) role. Refusing another patient's private role is the same
    anti-escalation rule the family assign path enforces."""
    role = PatientRoleService.get_owned(patient.tenant_id, patient.id, role_id)
    if role:
        return role
    return PatientRole.query.filter_by(
        tenant_id=patient.tenant_id, id=role_id, is_deleted=False,
        owner_patient_id=None,
    ).first()


def _set_roles(staff, patient, role_ids):
    """Reconcile a seat's role assignments to exactly ``role_ids`` (validated).
    Deactivate-not-delete, and reactivate an existing row rather than inserting a
    duplicate (the unique (staff_id, role_id) guarantees one row per pair)."""
    valid = set()
    for rid in (role_ids or []):
        role = _assignable_role(patient, rid)
        if role:
            valid.add(str(role.id))
    existing = {str(a.role_id): a for a in staff.role_assignments}
    for rid, a in existing.items():
        want = rid in valid
        if a.is_active != want:
            a.is_active = want
            a.deactivated_at = None if want else utcnow()
    for rid in valid - set(existing):
        db.session.add(PatientStaffRole(
            tenant_id=patient.tenant_id, staff_id=staff.id, role_id=rid,
            assigned_by_id=current_user.id, is_active=True,
        ))


# ══════════════════════════════════════════════════════════════════════════════
# OWNER (patient) — manage caregivers. @role_required(PATIENT) is the wall.
# ══════════════════════════════════════════════════════════════════════════════

@patient_staff_bp.route('', methods=['GET'])
@patient_staff_bp.route('/', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def list_staff():
    patient = _owner_patient()
    if not patient:
        return not_found_response('Patient profile')
    seats = (PatientStaff.query
             .filter_by(patient_id=patient.id, is_deleted=False)
             .order_by(PatientStaff.created_at.desc()).all())
    return success_response(data={'staff': [s.to_dict() for s in seats]})


@patient_staff_bp.route('', methods=['POST'])
@patient_staff_bp.route('/', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def create_staff():
    patient = _owner_patient()
    if not patient:
        return not_found_response('Patient profile')
    data = request.get_json() or {}
    first = (data.get('first_name') or '').strip()
    if not first:
        return error_response('A first name is required.', status_code=400)
    email = (data.get('email') or '').strip()
    password = (data.get('password') or '').strip()
    if not email or not password:
        return error_response(
            'A login email and password are required — a caregiver signs in with '
            'their own credentials.', status_code=400)

    staff = PatientStaff(
        tenant_id=patient.tenant_id, patient_id=patient.id,
        first_name=first,
        last_name=(data.get('last_name') or '').strip() or None,
        relation=(data.get('relation') or '').strip() or None,
        email=email,
        phone_number=(data.get('phone_number') or '').strip() or None,
        notes=(data.get('notes') or '').strip() or None,
        status=PatientStaffStatus.ACTIVE,
        created_by_id=current_user.id,
    )
    db.session.add(staff)
    db.session.flush()
    user, err = ensure_patient_staff_user(
        staff, email=email, password=password, phone_number=staff.phone_number)
    if err:
        db.session.rollback()
        return error_response(err, status_code=400)

    role_ids = data.get('role_ids')
    if role_ids:
        _set_roles(staff, patient, role_ids)
    db.session.commit()
    return created_response(data=staff.to_dict(), message='Caregiver added')


@patient_staff_bp.route('/<staff_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_staff(staff_id):
    """Rename a caregiver and/or change their sign-in. A password alone is a
    reset; a new email repoints the login."""
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    data = request.get_json() or {}
    if 'first_name' in data:
        staff.first_name = (data['first_name'] or '').strip() or staff.first_name
    if 'last_name' in data:
        staff.last_name = (data['last_name'] or '').strip() or None
    if 'relation' in data:
        staff.relation = (data['relation'] or '').strip() or None

    email = (data.get('email') or '').strip() or None
    password = (data.get('password') or '').strip() or None
    if email or password:
        user, err = ensure_patient_staff_user(staff, email=email, password=password)
        if err:
            db.session.rollback()
            return error_response(err, status_code=400)
        if email:
            staff.email = email
    db.session.commit()
    return success_response(data=staff.to_dict(), message='Caregiver updated')


@patient_staff_bp.route('/<staff_id>/roles', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def set_staff_roles(staff_id):
    """Replace the roles a caregiver holds. Body: ``{role_ids: [...],
    can_pay_on_behalf?: bool}``. Only the owner's own or shared roles are
    accepted; anything else is silently dropped (a caregiver can't be handed
    another patient's private role). ``can_pay_on_behalf`` — the money-handling
    permission — rides here too when present (it's a per-seat flag, deliberately
    off the shared role catalog)."""
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    data = request.get_json() or {}
    _set_roles(staff, patient, data.get('role_ids') or [])
    if 'can_pay_on_behalf' in data:
        staff.can_pay_on_behalf = bool(data['can_pay_on_behalf'])
    db.session.commit()
    db.session.refresh(staff)
    return success_response(data=staff.to_dict(), message='Roles updated')


@patient_staff_bp.route('/<staff_id>/suspend', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def suspend_staff(staff_id):
    """Stand a caregiver down: their grants stop applying and their login is
    disabled — without deleting the person or their audit trail."""
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    staff.status = PatientStaffStatus.SUSPENDED
    revoke_patient_staff_login(staff)
    db.session.commit()
    return success_response(data=staff.to_dict(), message='Caregiver suspended')


@patient_staff_bp.route('/<staff_id>/activate', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def activate_staff(staff_id):
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    staff.status = PatientStaffStatus.ACTIVE
    if staff.user:
        staff.user.status = UserStatus.ACTIVE
    db.session.commit()
    return success_response(data=staff.to_dict(), message='Caregiver reactivated')


@patient_staff_bp.route('/<staff_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT)
def delete_staff(staff_id):
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    revoke_patient_staff_login(staff)
    soft_delete_record(staff)
    db.session.commit()
    return success_response(message='Caregiver removed')


@patient_staff_bp.route('/<staff_id>/minors', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def set_staff_minors(staff_id):
    """Owner-only: grant a caregiver access to a SET of the owner's MINOR
    sub-profiles, each optionally bounded by a role (omit the role → the WHOLE
    minor account). Reconciles ``PatientStaffMinorScope`` for this seat.

    OWNER-ONLY: ``role_required(PATIENT)`` bars a caregiver, so they can never
    widen their own minor reach. Only the owner's OWN child accounts + roles the
    owner may assign are accepted; anything else is dropped (an unassignable role
    drops the minor rather than silently granting the whole account)."""
    from app.models import HouseGroupMember, PatientStaffMinorScope
    patient = _owner_patient()
    staff = _owned_staff(staff_id, patient)
    if not staff:
        return not_found_response('Caregiver')
    data = request.get_json() or {}
    grants = data.get('minors')
    if not isinstance(grants, list):
        return error_response('"minors" must be a list of {member_id, role_id?}')

    valid = {}  # member_id -> role_id|None
    for g in grants:
        mid = (g or {}).get('member_id')
        if not mid:
            continue
        member = HouseGroupMember.query.filter_by(
            id=mid, patient_id=patient.id, is_child_account=True, is_active=True,
        ).first()
        if not member:
            continue  # not the owner's own minor
        role_id = (g or {}).get('role_id')
        if role_id and not _assignable_role(patient, role_id):
            continue  # unassignable role → never silently widen to "whole"
        valid[str(member.id)] = role_id

    existing = {str(s.house_group_member_id): s for s in staff.minor_scopes}
    for mid, row in existing.items():
        if mid not in valid:
            db.session.delete(row)
    for mid, role_id in valid.items():
        row = existing.get(mid)
        if row:
            row.role_id = role_id  # flip whole↔granular on an existing grant
        else:
            db.session.add(PatientStaffMinorScope(
                tenant_id=patient.tenant_id, staff_id=staff.id,
                house_group_member_id=mid, role_id=role_id,
                granted_by_id=current_user.id))
    db.session.commit()
    db.session.refresh(staff)
    return success_response(data=staff.to_dict(), message='Minor access updated')


# ══════════════════════════════════════════════════════════════════════════════
# CAREGIVER (PATIENT_STAFF) — the caregiver's own surfaces (/me, /act, /act-minor).
# ══════════════════════════════════════════════════════════════════════════════

@patient_staff_bp.route('/me', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT_STAFF)
def staff_me():
    """The caregiver's own basic profile + the patient(s) they support and what
    they may do. Drives the caregiver's home (their profile card) + the courtesy
    UI gating (the server is the real lock)."""
    seats = staff_seats_for(current_user)
    out = []
    for seat in seats:
        patient = Patient.query.get(seat.patient_id)
        grants = effective_grants(seat)
        # Minor sub-profiles of this patient the caregiver was granted, nested
        # under the employer patient (a minor belongs to exactly one patient).
        minors = [
            {
                'member_id': str(s.house_group_member_id),
                'name': (' '.join(p for p in (
                    s.member.first_name, s.member.last_name) if p).strip()
                    if s.member else None),
                'role_id': str(s.role_id) if s.role_id else None,
                'whole': s.role_id is None,
            }
            for s in seat.minor_scopes
        ]
        out.append({
            'staff_id': str(seat.id),
            'patient_id': str(seat.patient_id),
            'patient_name': patient.full_name if patient else None,
            'relation': seat.relation,
            'modules': sorted(grants.keys()),
            'grants': grants,
            'minors': minors,
            # Whether this caregiver may pay (from their own method) for bookings
            # they create for this patient — courtesy gating; the pay endpoint is
            # the real lock.
            'can_pay': bool(seat.can_pay_on_behalf),
        })
    # The caregiver's own identity — a login is provisioned FOR them by the
    # patient, so this is a read-only card (they change only their password).
    first = seats[0] if seats else None
    me = {
        'name': f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or 'Caregiver',
        'email': current_user.email,
        'relation': first.relation if first else None,
    }
    return success_response(data={'me': me, 'patients': out})


@patient_staff_bp.route('/me', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT_STAFF)
def update_me():
    """A caregiver edits their own basic profile — name + relation. Their login
    email and their access stay the patient's to manage; the name is the bit
    that's theirs to keep current."""
    seats = staff_seats_for(current_user)
    if not seats:
        return not_found_response('Caregiver')
    data = request.get_json() or {}
    first = (data.get('first_name') or '').strip()
    for s in seats:
        if first:
            s.first_name = first
        if 'last_name' in data:
            s.last_name = (data.get('last_name') or '').strip() or None
        if 'relation' in data:
            s.relation = (data.get('relation') or '').strip() or None
    # Keep the login's display name in step — same person, and it shows in
    # audit trails.
    if first:
        current_user.first_name = first
    if 'last_name' in data:
        current_user.last_name = (data.get('last_name') or '').strip()
    db.session.commit()
    seat = seats[0]
    return success_response(data={'me': {
        'name': f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or 'Caregiver',
        'email': current_user.email,
        'relation': seat.relation,
    }}, message='Profile updated')


@patient_staff_bp.route('/me/password', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT_STAFF)
def change_my_password():
    """A caregiver changes their own password. The patient set the first one, so
    being able to replace it without going back to them is the point of this
    route (mirrors the provider-staff self-service reset)."""
    from app.common.staff_credentials import MIN_PASSWORD_LENGTH
    data = request.get_json() or {}
    current_password = (data.get('current_password') or '').strip()
    new_password = (data.get('new_password') or '').strip()
    if not current_password or not new_password:
        return error_response('Current and new password are both required')
    if not current_user.check_password(current_password):
        return error_response('Current password is incorrect', status_code=400)
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return error_response(f'Password must be at least {MIN_PASSWORD_LENGTH} characters')
    current_user.set_password(new_password)
    db.session.commit()
    return success_response(message='Password updated')


@patient_staff_bp.route('/act/<patient_id>/<path:subpath>',
                        methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT_STAFF)
def staff_act(patient_id, subpath):
    """Run one patient self-service endpoint AS the patient this caregiver serves.

    Mirrors the linked-adult act path: the caller must hold an ACTIVE seat for
    exactly this patient, their role must permit the (path, method), and the
    proxy stamps the caregiver as the real actor so every write is attributable
    to them — the whole point of a separate login."""
    from app.api.admin.operations.act_on_behalf import _proxy, _COMPILED_PATHS
    from app.api.patient_family.rules import linked_adult_allowed

    seat = seat_for_patient(current_user, patient_id)
    if not seat:
        return not_found_response('Patient')
    grants = effective_grants(seat)
    if not linked_adult_allowed(subpath, request.method, grants):
        return forbidden_response('Your role does not permit this action.')
    owner = Patient.query.get(patient_id)
    if not owner:
        return not_found_response('Patient profile')
    return _proxy(owner, 'patient', 'Support staff', _COMPILED_PATHS, subpath,
                  stamp_provenance=True)


@patient_staff_bp.route('/act-minor/<member_id>/<path:subpath>',
                        methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT_STAFF)
def staff_act_minor(member_id, subpath):
    """Run one patient self-service endpoint AS a MINOR this caregiver was granted.

    Walls (none taken from the body): the caller holds an ACTIVE seat for the
    patient who OWNS this minor, AND a ``PatientStaffMinorScope`` row links that
    seat to this minor. The scope's ``role_id`` decides WHAT:

      * NULL → the WHOLE minor account, but capped at the standard patient surface
               (``_COMPILED_PATHS``), NOT the parent's extended allowlist — so a
               caregiver cannot post chat / upload documents / verify contact-OTP
               AS the minor; those stay the parent's alone.
      * set  → only the modules that ``PatientRole`` grants (``linked_adult_allowed``:
               GET needs view, writes need manage; fail closed).

    Every write is stamped with the caregiver as the real actor (accountability),
    exactly like the guardian's minor proxy and the main-patient caregiver proxy.
    """
    from app.models import (
        HouseGroupMember, PatientStaffMinorScope, Patient as _Patient,
    )
    from app.api.admin.operations.act_on_behalf import _proxy, _COMPILED_PATHS
    from app.api.patient_family.rules import linked_adult_allowed

    member = HouseGroupMember.query.filter_by(
        id=member_id, is_active=True, is_child_account=True,
    ).first()
    if not member or not member.linked_patient_id:
        return not_found_response('Minor profile')

    # WHERE wall: an active seat for the patient that OWNS this minor, then the
    # per-minor grant row linking that seat to this minor. Neither is addressable
    # across patients, and a caregiver can never widen this set (owner-only).
    seat = seat_for_patient(current_user, member.patient_id)
    if not seat:
        return not_found_response('Minor profile')
    scope = PatientStaffMinorScope.query.filter_by(
        staff_id=seat.id, house_group_member_id=member.id,
        tenant_id=current_tenant_id_strict(),
    ).first()
    if not scope:
        return forbidden_response('You do not have access to this minor.')

    minor = _Patient.query.get(member.linked_patient_id)
    if not minor:
        return not_found_response('Minor profile')

    # role NULL → whole minor (capped surface below); role set → bounded by it.
    if scope.role_id:
        grants = PatientRoleService.effective_for_member(scope)
        if not linked_adult_allowed(subpath, request.method, grants):
            return forbidden_response('Your role does not permit this action.')
    return _proxy(minor, 'patient', 'Support staff', _COMPILED_PATHS, subpath,
                  stamp_provenance=True)
