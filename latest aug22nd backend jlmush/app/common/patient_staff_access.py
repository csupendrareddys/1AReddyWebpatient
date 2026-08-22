"""Resolve a logged-in caregiver to the patient(s) they support, and compute a
seat's effective grants.

Deliberately lean next to ``app/common/provider_access.py``: a patient IS a
``User``, so there is no admin-User borrowing indirection — the act-on-behalf
proxy targets the patient's own row directly. This module answers the two
questions the patient-staff routes ask:

  * which ``PatientStaff`` seats does this user hold, and for which patient?
  * what may a given seat view / manage (union across its roles)?

The request-time path gate is the SHARED one —
``app/api/patient_family/rules.py::linked_adult_allowed`` — because a caregiver's
grants have the same ``{module: {can_view, can_manage}}`` shape as a linked
adult's. Fail closed lives there.
"""
from app.models import (
    PatientStaff, PatientStaffStatus, PatientRolePermission,
)


def staff_seats_for(user):
    """Active, non-deleted ``PatientStaff`` rows whose login is ``user``."""
    if user is None:
        return []
    return (PatientStaff.query
            .filter(PatientStaff.user_id == user.id,
                    PatientStaff.status == PatientStaffStatus.ACTIVE,
                    PatientStaff.is_deleted.is_(False))
            .all())


def seat_for_patient(user, patient_id):
    """The caller's active staff seat for one patient, or ``None``.

    This is the authorization check the act proxy makes: only a caller who holds
    an ACTIVE seat for exactly this patient may act on them.
    """
    if user is None:
        return None
    return (PatientStaff.query
            .filter(PatientStaff.user_id == user.id,
                    PatientStaff.patient_id == patient_id,
                    PatientStaff.status == PatientStaffStatus.ACTIVE,
                    PatientStaff.is_deleted.is_(False))
            .first())


def effective_grants(staff):
    """Union of the seat's active roles' permissions as
    ``{module_key: {'can_view': bool, 'can_manage': bool}}``. Empty = no access.

    A caregiver with no active role can do nothing — the gate then denies every
    module, which is the correct fail-closed default for a fresh, un-roled seat.
    """
    role_ids = [a.role_id for a in staff.role_assignments if a.is_active]
    if not role_ids:
        return {}
    perms = PatientRolePermission.query.filter(
        PatientRolePermission.tenant_id == staff.tenant_id,
        PatientRolePermission.role_id.in_(role_ids),
    ).all()
    out = {}
    for p in perms:
        cur = out.setdefault(p.module_key, {'can_view': False, 'can_manage': False})
        cur['can_view'] = cur['can_view'] or p.can_view
        cur['can_manage'] = cur['can_manage'] or p.can_manage
    return out
