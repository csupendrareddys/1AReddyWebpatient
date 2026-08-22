"""Provenance for patient-profile edits — who changed it last, and when.

A patient profile has two write surfaces: the patient's own settings page
(``/api/patient/*`` + ``/api/entity-profile/me``) and the admin Operations
act-on-behalf proxy, which re-dispatches to those same views with
``current_user`` swapped. Support needs to tell the two apart — "did the
patient change their own phone number, or did one of us?" — so the write
stamps ``Patient.profile_updated_{at,by_id,by_role}``.

Two things make that awkward, and this module owns both:

1. **The set of writes that count.** Not every ``/api/patient`` POST is a
   profile edit (booking, ratings, marketplace purchase aren't).
   :data:`PROFILE_WRITE_ENDPOINTS` is the single definition, keyed by Flask
   endpoint name rather than URL regex so it stays readable and can't drift
   from the routes. Both write surfaces consult it.

2. **Who the actor really is.** Inside the act-on-behalf proxy
   ``current_user`` *is* the patient — that's the whole point — so reading it
   there would record every admin edit as a self-edit. The proxy calls
   :func:`set_acting_admin` before dispatching, and :func:`current_actor`
   prefers that over ``current_user``.
"""
import logging

from flask import g, has_request_context

from app.extensions import db
from app.models._base import utcnow

logger = logging.getLogger(__name__)

# ``g`` key holding the REAL caller during an act-on-behalf dispatch.
_ACTING_ADMIN_KEY = '_ops_acting_admin'

# Lowest :class:`~app.models._enums.RoleLevel` whose holder may approve their
# own Operations edit. Level 3 ("Operational Team Senior") is the first seeded
# role that carries a verifier action — L1 is view-only and L2 can edit but
# only L1-verifies, which is not the right the doctor queue checks. Level 4
# (Senior Manager, L3 verifier) and 5 (Full Access) clear it too.
SELF_APPROVE_MIN_ROLE_LEVEL = 3

# Flask endpoints whose success means "this patient's profile changed".
# Deliberately excludes reads, booking, payments, ratings and appointment
# documents — those are activity, not profile state.
PROFILE_WRITE_ENDPOINTS = frozenset({
    # Profile sections
    'api.patient.update_profile',
    'api.patient.update_personal_details',
    'api.patient.update_contact_identity',
    'api.patient.update_address',
    'api.patient.update_emergency_contact',
    'api.patient.update_insurance',
    'api.patient.update_female_health',
    'api.patient.verify_and_update',
    # Vitals / habits / surgeries
    'api.patient.update_vitals',
    'api.patient.update_habits',
    'api.patient.add_surgery',
    # Health records + attachments
    'api.patient.add_health_record',
    'api.patient.update_health_record',
    'api.patient.delete_health_record',
    'api.patient.upload_health_record_attachment',
    'api.patient.delete_health_record_attachment',
    # House / family group
    'api.patient.add_house_group_member',
    'api.patient.update_house_group_member',
    'api.patient.delete_house_group_member',
    'api.patient.send_house_group_request',
    'api.patient.accept_house_group_request',
    'api.patient.reject_house_group_request',
    'api.patient.cancel_house_group_request',
    'api.patient.generate_house_group_invite',
    'api.patient.join_by_invite_code',
    'api.patient.update_member_permissions',
    # Entity details tab
    'api.entity_profile.update_my_entity_profile',
})

# Which UI SECTION each write endpoint changes, for the per-section "last
# updated by" indicators. A subset of PROFILE_WRITE_ENDPOINTS — house-group and
# attachment writes aren't a single profile section, so they only bump the
# whole-profile stamp. Keys match the frontend ProfileSetting section keys.
ENDPOINT_SECTION = {
    'api.patient.update_personal_details': 'personal_details',
    'api.patient.update_contact_identity': 'contact_identity',
    'api.patient.verify_and_update': 'contact_identity',   # OTP phone/email change
    'api.patient.update_address': 'address',
    'api.patient.update_emergency_contact': 'emergency_contact',
    'api.patient.update_insurance': 'insurance',
    'api.patient.update_female_health': 'female_health',
    'api.patient.update_vitals': 'vitals',
    'api.patient.update_habits': 'habits',
    'api.patient.add_surgery': 'surgeries',
    'api.patient.add_health_record': 'health_records',
    'api.patient.update_health_record': 'health_records',
    'api.patient.delete_health_record': 'health_records',
    'api.entity_profile.update_my_entity_profile': 'entity_details',
}


def set_acting_admin(user):
    """Record the real caller for the current act-on-behalf dispatch.

    Pass ``None`` to clear. Only the Operations proxy calls this, and it
    always clears in a ``finally``.
    """
    if has_request_context():
        setattr(g, _ACTING_ADMIN_KEY, user)


def acting_admin():
    """The real caller during an act-on-behalf dispatch, else ``None``."""
    if not has_request_context():
        return None
    return getattr(g, _ACTING_ADMIN_KEY, None)


def admin_can_self_approve(admin_user):
    """Does ``admin_user`` hold the right to approve their own support edit?

    Yes for SUPER_ADMIN and PLATFORM_OWNER: they bypass ``rbac_required`` on
    every other route, so a role assignment they may not even have must not be
    what decides this one. For a sub-admin it's their highest active assigned
    role level against :data:`SELF_APPROVE_MIN_ROLE_LEVEL` — a junior operator
    can still make the edit (that's ``OPERATIONS_*``/``EDIT``), it just lands
    in the approvals queue for someone senior, exactly like the doctor's own.

    Unassigned, deactivated or level-less roles count as "not senior enough".
    Failing closed is the safe direction: the cost is one extra trip to the
    approvals screen, whereas failing open would let any operator who reaches
    the proxy self-approve, which is the thing being restricted.
    """
    from app.models import UserRole

    role = getattr(admin_user, 'role', None)
    if role in (UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER):
        return True

    admin = getattr(admin_user, 'admin_profile', None)
    if admin is None:
        return False
    try:
        assignments = admin.role_assignments.filter_by(is_active=True).all()
    except Exception:  # noqa: BLE001 — never fail a write over a lookup
        logger.exception(
            '[PROFILE_AUDIT] role lookup failed for admin=%s',
            getattr(admin_user, 'id', None),
        )
        return False
    return any(
        a.role is not None
        and a.role.is_active
        and not a.role.is_deleted
        and (a.role.level or 0) >= SELF_APPROVE_MIN_ROLE_LEVEL
        for a in assignments
    )


def self_approving_admin():
    """The admin whose current support edit should apply without a second pass.

    Returns the acting admin when this request is an Operations act-on-behalf
    dispatch **and** that admin also holds the right to approve what they just
    submitted; ``None`` otherwise — including on every request a doctor makes
    for themselves, which is why their own edits still queue exactly as they
    always have.

    This is the single seam the approval-carrying surfaces consult, so
    "does a support edit apply on the spot?" has one answer across the doctor
    profile's field-approval queue, their availability requests and their
    marketplace listings, rather than three that can drift.

    The approval right itself is :func:`admin_can_self_approve`.
    """
    admin = acting_admin()
    if admin is None or not admin_can_self_approve(admin):
        return None
    return admin


def listing_approval_status_on_submit(doctor=None, section='group_plan'):
    """``'approved'`` when the change should go live immediately, else
    ``'pending'``.

    The marketplace surfaces — a doctor's service listing, a group offering —
    carry their review state as a plain ``approval_status`` column rather than
    an approval-request row, so there is nothing to go back and review: the
    status IS the decision, and it has to be right at write time.

    Approved on the spot when EITHER a self-approving admin is submitting from
    Operations (:func:`self_approving_admin`) OR the owning ``doctor``'s own
    approval mode for ``section`` is ``'auto'`` — the same auto-approval rule
    the field-approval and availability paths already honour, so an
    auto-approval doctor's marketplace listings don't sit in the admin queue.
    """
    if self_approving_admin() is not None:
        return 'approved'
    if doctor is not None and section:
        try:
            from app.api.admin.approval_policy_service import effective_permission_mode
            if effective_permission_mode(doctor, section) == 'auto':
                return 'approved'
        except Exception:  # noqa: BLE001 — never block a submit on the check
            pass
    return 'pending'


def current_actor():
    """The user who should be credited with the current write.

    The acting admin wins over ``current_user`` — inside the proxy the latter
    is the impersonated patient.
    """
    admin = acting_admin()
    if admin is not None:
        return admin
    if not has_request_context():
        return None
    try:
        from flask_jwt_extended import current_user
        return current_user or None
    except (RuntimeError, KeyError):
        # No verified JWT on this request (shouldn't happen on a write, but
        # never let provenance bookkeeping break the write itself).
        return None


def stamp_profile_update(patient, actor=None, commit=True):
    """Record ``actor`` as the last editor of ``patient``'s profile.

    Best-effort by design: this runs after the real write has already
    committed, so a failure here must not turn a successful save into a 500.
    It logs and rolls back instead.
    """
    if patient is None:
        return
    actor = actor if actor is not None else current_actor()
    try:
        patient.profile_updated_at = utcnow()
        if actor is not None:
            patient.profile_updated_by_id = actor.id
            patient.profile_updated_by_role = (
                actor.role.value if getattr(actor, 'role', None) else None
            )
        db.session.add(patient)
        if commit:
            db.session.commit()
    except Exception:  # noqa: BLE001 — provenance is not worth failing a save
        logger.exception(
            '[PROFILE_AUDIT] failed to stamp patient=%s', getattr(patient, 'id', None),
        )
        try:
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass


# Roles that should read as "(Admin)" in the UI. Doctors get their own label
# so a doctor-entered vital isn't mistaken for a support edit.
_ADMIN_ROLES = {'super_admin', 'sub_admin', 'platform_owner', 'admin'}


def _classify_actor(role, actor_uid, owner_uid):
    """The accountability bucket for a stamped edit: ``owner`` (the patient's
    own account), ``linked`` (a family member — a ``patient`` role but a
    different user), ``staff`` (a support-staff caregiver), ``admin`` or
    ``doctor``. Shared by the whole-profile and per-section serialisers."""
    if role == 'patient_staff':
        return 'staff'
    if role in _ADMIN_ROLES:
        return 'admin'
    if role == 'doctor':
        return 'doctor'
    if role == 'patient':
        return 'owner' if (owner_uid and str(actor_uid) == owner_uid) else 'linked'
    return 'other'


def describe_last_update(patient):
    """Serialise the provenance columns for the profile header.

    Returns ``actor_type`` (``patient`` | ``admin`` | ``doctor`` | ``other``)
    and the actor's display name, leaving the exact wording to the frontend.
    ``updated_at`` is ``None`` for profiles untouched since this shipped —
    the UI hides the indicator rather than inventing a date.
    """
    if patient is None or not patient.profile_updated_at:
        return {'updated_at': None, 'updated_by': None}

    role = patient.profile_updated_by_role
    actor = patient.profile_updated_by
    name = None
    if actor is not None:
        name = (
            f"{(actor.first_name or '').strip()} {(actor.last_name or '').strip()}".strip()
            or actor.email
            or None
        )
    # Distinguish the self-service actors the patient cares about: their OWN
    # account, a LINKED family member (also a ``patient`` role, different user),
    # and a support-staff CAREGIVER (``patient_staff``).
    owner_uid = str(patient.user_id) if getattr(patient, 'user_id', None) else None
    actor_uid = str(patient.profile_updated_by_id) if patient.profile_updated_by_id else None
    actor_type = _classify_actor(role, actor_uid, owner_uid)

    # Self-edits are the common case and the patient's own name is already on
    # the page, so fall back to it rather than showing "Unknown".
    if not name and actor_type == 'owner' and patient.user:
        name = (
            f"{(patient.user.first_name or '').strip()} "
            f"{(patient.user.last_name or '').strip()}".strip() or None
        )

    return {
        'updated_at': patient.profile_updated_at.isoformat(),
        'updated_by': {
            'id': str(patient.profile_updated_by_id) if patient.profile_updated_by_id else None,
            'name': name,
            'role': role,
            'actor_type': actor_type,
        },
    }


def stamp_section_update(patient, section_key, actor=None, commit=True):
    """Record ``actor`` as the last editor of one profile/health SECTION.

    Written with an ATOMIC ``jsonb_set`` UPDATE that touches only this section's
    key — NOT a Python read-modify-write of the whole ``section_provenance`` map.
    The profile page saves the four personal-tab sections in PARALLEL, and a
    read-modify-write there races: each request reads the same snapshot and
    writes the whole column back, so the last writer clobbers the others' stamps.
    The per-key UPDATE serialises on the row lock, so every section persists.
    Best-effort — never turns a saved change into a 500."""
    if patient is None or not section_key:
        return
    import json as _json
    from sqlalchemy import text
    actor = actor if actor is not None else current_actor()
    entry = _json.dumps({
        'by_id': str(actor.id) if actor is not None else None,
        'by_role': (actor.role.value
                    if actor is not None and getattr(actor, 'role', None) else None),
        'at': utcnow().isoformat(),
    })
    try:
        db.session.execute(text(
            "UPDATE patients SET section_provenance = jsonb_set("
            "  coalesce(section_provenance::jsonb, '{}'::jsonb), ARRAY[:sk], (:val)::jsonb"
            ")::json WHERE patient_id = :pid"
        ), {'sk': section_key, 'val': entry, 'pid': patient.id})
        if commit:
            db.session.commit()
    except Exception:  # noqa: BLE001 — provenance is not worth failing a save
        logger.exception('[PROFILE_AUDIT] failed to stamp section=%s patient=%s',
                         section_key, getattr(patient, 'id', None))
        try:
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass


def describe_section_updates(patient):
    """Per-section provenance for the profile page:
    ``{section_key: {updated_at, updated_by: {id, name, role, actor_type}}}``.
    ``actor_type`` is owner/linked/staff/admin/doctor — same classification as
    :func:`describe_last_update`. Empty when nothing has been stamped."""
    prov = getattr(patient, 'section_provenance', None) if patient else None
    if not prov:
        return {}
    from app.models import User
    owner_uid = str(patient.user_id) if getattr(patient, 'user_id', None) else None
    ids = {v.get('by_id') for v in prov.values() if v.get('by_id')}
    users = {}
    if ids:
        for u in User.query.filter(User.id.in_(ids)).all():
            users[str(u.id)] = u
    out = {}
    for section_key, v in prov.items():
        at = v.get('at')
        if not at:
            continue
        by_id = v.get('by_id')
        role = v.get('by_role')
        u = users.get(by_id) if by_id else None
        name = None
        if u is not None:
            name = (f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
                    or u.email or None)
        actor_type = _classify_actor(role, by_id, owner_uid)
        if not name and actor_type == 'owner' and patient.user:
            name = (f"{(patient.user.first_name or '').strip()} "
                    f"{(patient.user.last_name or '').strip()}".strip() or None)
        out[section_key] = {
            'updated_at': at,
            'updated_by': {'id': by_id, 'name': name, 'role': role, 'actor_type': actor_type},
        }
    return out
