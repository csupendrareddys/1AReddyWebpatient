"""Patient Family plan quotas (Phase 3).

A member/minor never buys their own plan — the OWNER's membership plan governs
how many minors they may create, how many adults they may link, and how many
private roles they may author. This resolves the owner's active plan and its
:class:`PatientFamilyPolicy`, then asserts headroom at CREATE time.

Resolution mirrors ``assert_provider_quota_available`` in shape, but swaps the
source: a provider quota reads the tenant's SaaS ``Plan``; a family quota reads
the individual owner's ``MembershipPlan`` via their ``MembershipSubscription``
(PATIENT vertical) — the first quota keyed to a person, not a tenant.

**Unconfigured default (deliberate choice).** A plan with no policy row — and a
patient with no membership subscription at all — resolves to ``_DEFAULT_CAPS``
(permissive), NOT hard-deny. The family feature shipped in P1/P2 without
quotas; hard-denying every unconfigured plan would retroactively disable it for
every existing patient until an admin touched each plan. Once an admin saves a
policy for a plan, that row is authoritative — including ``0`` to deny. To flip
the global stance to "deny until configured", set ``_DEFAULT_CAPS`` to zeros.
"""
from sqlalchemy import func

from app.extensions import db
from app.models import (
    HouseGroupMember, MembershipVertical, PatientFamilyPolicy, PatientRole,
)

# kind → (policy attribute, human label)
_KINDS = {
    'minors': ('max_minor_subaccounts', 'minor profiles'),
    'links': ('max_family_links', 'linked family members'),
    'roles': ('max_patient_roles', 'family roles'),
}

# Caps used when the owner's plan has no policy row (or no subscription). See the
# module docstring — permissive so the already-shipped feature keeps working;
# set to zeros to force explicit admin configuration instead.
_DEFAULT_CAPS = {'minors': 5, 'links': 10, 'roles': 10}


class PatientQuotaExceeded(Exception):
    """The owner's plan has no headroom for one more of ``kind``."""

    def __init__(self, kind, current, cap):
        self.kind = kind
        self.current = current
        self.cap = cap
        label = _KINDS.get(kind, (None, kind))[1]
        super().__init__(
            f'Your plan allows up to {cap} {label} '
            f'(you have {current}). Upgrade your plan to add more.'
        )


def resolve_policy(patient):
    """The live :class:`PatientFamilyPolicy` for the patient's active plan, or
    ``None`` when the patient has no (non-cancelled) subscription or the plan
    carries no policy row."""
    from app.api.membership.service import MembershipSubscriptionService
    sub = MembershipSubscriptionService.resolve_for_provider(
        patient.tenant_id, MembershipVertical.PATIENT, patient.id)
    if not sub:
        return None
    return PatientFamilyPolicy.query.filter_by(
        tenant_id=patient.tenant_id, plan_id=sub.membership_plan_id).first()


def resolve_cap(patient, kind):
    """The cap for ``kind`` from the owner's plan. ``-1`` unlimited, ``0`` deny.
    Falls back to ``_DEFAULT_CAPS`` when unconfigured (see module docstring)."""
    attr = _KINDS[kind][0]
    policy = resolve_policy(patient)
    if policy is None or not policy.is_active:
        return _DEFAULT_CAPS[kind]
    return getattr(policy, attr)


def _current_count(patient, kind):
    """How many of ``kind`` the owner already has (active, non-deleted)."""
    if kind == 'minors':
        q = db.session.query(func.count(HouseGroupMember.id)).filter(
            HouseGroupMember.tenant_id == patient.tenant_id,
            HouseGroupMember.patient_id == patient.id,
            HouseGroupMember.is_child_account.is_(True),
            HouseGroupMember.is_active.is_(True),
        )
    elif kind == 'links':
        q = db.session.query(func.count(HouseGroupMember.id)).filter(
            HouseGroupMember.tenant_id == patient.tenant_id,
            HouseGroupMember.patient_id == patient.id,
            HouseGroupMember.linked_user_id.isnot(None),
            HouseGroupMember.is_child_account.is_(False),
            HouseGroupMember.is_active.is_(True),
        )
    else:  # roles — the owner's own private roles only
        q = db.session.query(func.count(PatientRole.id)).filter(
            PatientRole.tenant_id == patient.tenant_id,
            PatientRole.owner_patient_id == patient.id,
            PatientRole.is_deleted.is_(False),
        )
    return q.scalar() or 0


def assert_quota_available(patient, kind):
    """Raise :class:`PatientQuotaExceeded` if the owner has no room for one more
    of ``kind`` (``kind`` ∈ ``minors`` / ``links`` / ``roles``). ``-1`` unlimited
    short-circuits; ``0`` denies immediately."""
    if kind not in _KINDS:
        raise ValueError(f'Unknown quota kind "{kind}"')
    cap = resolve_cap(patient, kind)
    if cap == -1:
        return
    current = _current_count(patient, kind)
    if current >= cap:
        raise PatientQuotaExceeded(kind, current, cap)
