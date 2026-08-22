"""What a membership tier caps: support staff seats and My Link affiliations.

Two numbers on ``MembershipPlan`` (``max_support_staff`` /
``max_link_connections``) and one place that reads them, because the two
questions a cap has to answer — *what is the ceiling* and *how many are held* —
must be answered the same way everywhere. The provider's usage meter, the
button that greys out, and the request that gets refused are all this module;
if the meter said 4/5 and the write still refused, the number on screen would
be the thing people stopped trusting.

Four decisions worth knowing:

**No membership means no cap.** A provider without a PENDING / TRIAL / ACTIVE
subscription is unlimited, not zero. Most existing practices are in exactly
that state — City Care has no subscription at all — and reading "no plan" as
"no staff" would turn shipping this into a mass revocation. The cap is a
property of a tier somebody bought, so nothing to buy is nothing to enforce.

**NULL means unlimited** (see the column comments). Same reasoning, one layer
down.

**A cap refuses the next one; it never severs.** Usage is counted, never
enforced retroactively. A member moved to a smaller tier — or one whose tier is
re-tuned under them — can sit legitimately over their limit; they keep
everything and simply cannot add. Anything else would let an admin editing a
plan silently delete another practice's staff.

**Counted live from the rows, not from a stored tally.** These are small counts
behind an indexed column, and a counter that can drift is a counter that will
— every path that creates or removes one of these rows would have to remember
to move it, including the two that already exist for delinking.
"""
from __future__ import annotations

import logging

from app.models import (
    CareNetworkConnection,
    MembershipPlan,
    MembershipSubscription,
    MembershipSubscriptionStatus,
    ProviderStaff,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

SUPPORT_STAFF = 'support_staff'
MY_LINKS = 'my_links'

# ``column``  — the MembershipPlan attribute holding the cap.
# ``noun``    — how the metric reads in a refusal ("2 of 2 support staff").
# ``upgrade`` — what a member does about it, in their words.
METRICS = {
    SUPPORT_STAFF: {
        'column': 'max_support_staff',
        'noun': 'support staff',
        'label': 'Support staff',
    },
    MY_LINKS: {
        'column': 'max_link_connections',
        'noun': 'My Link affiliations',
        'label': 'My Link affiliations',
    },
}

# The three provider kinds that can hold either of these. Strings rather than an
# enum because the callers arrive holding three different ones —
# ``StaffProviderType`` from the staff routes, ``MembershipVertical`` from the
# subscription, a bare role string from the network service — and coercing at
# the door beats making each of them import the same one.
_KINDS = ('doctor', 'clinic', 'hospital')

# Which ProviderStaff FK anchors a practice's roster, per kind.
_STAFF_COLUMN = {
    'doctor': 'doctor_id',
    'clinic': 'clinic_id',
    'hospital': 'hospital_id',
}

# Which end of a My Link row each kind sits on. A row is owned by the DOCTOR
# (``doctor_id``) and points at the facility, so the doctor counts rows they
# own and a facility counts rows aimed at it. Doctor↔doctor links are a
# reciprocal pair, so each doctor still counts exactly their own half.
_LINK_COLUMN = {
    'doctor': 'doctor_id',
    'clinic': 'target_clinic_id',
    'hospital': 'target_hospital_id',
}


def _kind_of(provider_type) -> str:
    """'doctor' | 'clinic' | 'hospital' from an enum, a string, or a model row."""
    value = getattr(provider_type, 'value', provider_type)
    value = str(value).lower()
    if value not in _KINDS:
        raise ValueError(f'Not a provider kind that can hold plan limits: {value!r}')
    return value


class PlanLimitExceeded(ValueError):
    """A membership tier's cap would be broken by this request.

    Subclasses ``ValueError`` on purpose. The connection service raises into
    routes that already turn a ValueError into a clean 400 with its message, so
    a path that hasn't been taught about limits refuses politely instead of
    500ing. The routes that *have* been taught catch this class first and
    answer 403 with a machine-readable code, the way ``feature_required`` does
    for a disabled feature.
    """

    def __init__(self, metric, limit, used, plan_name=None, subject=None):
        self.metric = metric
        self.limit = limit
        self.used = used
        self.plan_name = plan_name
        # Whose ceiling this is, when it isn't the caller's — a doctor is told
        # the clinic is full, not that "the limit" was hit, because there is
        # nothing they can do about someone else's plan and they'd otherwise go
        # looking at their own.
        self.subject = subject
        super().__init__(self.message)

    @property
    def message(self):
        noun = METRICS[self.metric]['noun']
        whose = f'{self.subject} has' if self.subject else 'You have'
        plan = f' on the {self.plan_name} plan' if self.plan_name else ''
        return (
            f'{whose} used all {self.limit} {noun} included{plan} '
            f'({self.used} of {self.limit}). Upgrade the membership to add more.'
        )


def limit_response(exc: PlanLimitExceeded):
    """The 403 a route returns for :class:`PlanLimitExceeded`.

    Shaped like ``feature_required``'s deny — a ``code`` the client can branch
    on plus the numbers, so an upgrade prompt doesn't have to parse English out
    of the message.
    """
    from app.common.responses import error_response

    return error_response(
        exc.message,
        code='plan_limit_exceeded',
        status_code=403,
        data={
            'metric': exc.metric,
            'limit': exc.limit,
            'used': exc.used,
            'plan_name': exc.plan_name,
        },
    )


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #

def plan_for(provider_type, provider_id) -> MembershipPlan | None:
    """The tier this provider currently holds, or None.

    Keyed on (provider_type, provider_id) rather than the user, because that
    pair is what the partial unique index makes at-most-one — a user can hold
    rows for more than one profile, and ``.first()`` on the user would pick
    arbitrarily between them.
    """
    kind = _kind_of(provider_type)
    sub = (
        MembershipSubscription.query
        .filter(
            MembershipSubscription.provider_id == provider_id,
            MembershipSubscription.is_deleted == False,  # noqa: E712
            MembershipSubscription.status.in_([
                MembershipSubscriptionStatus.PENDING,
                MembershipSubscriptionStatus.TRIAL,
                MembershipSubscriptionStatus.ACTIVE,
            ]),
        )
        .first()
    )
    if sub is None:
        return None
    # Guard the polymorphic pair: provider_id alone is a bare uuid, and a plan
    # picked up from a row of a different vertical would cap the wrong thing.
    if _kind_of(sub.provider_type) != kind:
        return None
    return sub.plan


def limit_for(provider_type, provider_id, metric) -> int | None:
    """The cap for one metric — ``None`` when unlimited (no plan, or no cap)."""
    plan = plan_for(provider_type, provider_id)
    if plan is None:
        return None
    return getattr(plan, METRICS[metric]['column'], None)


def usage_for(provider_type, provider_id, metric) -> int:
    """How many the provider currently holds."""
    kind = _kind_of(provider_type)
    if metric == SUPPORT_STAFF:
        # Every non-deleted row, matching exactly what the directory lists.
        # Not "only ACTIVE ones": the meter sits next to that list, and a
        # screen showing six people above the words "4 of 5 used" reads as a
        # bug however defensible the distinction is.
        return (
            ProviderStaff.query
            .filter(
                getattr(ProviderStaff, _STAFF_COLUMN[kind]) == provider_id,
                ProviderStaff.is_deleted == False,  # noqa: E712
            )
            .count()
        )
    if metric == MY_LINKS:
        # ``context='link'`` only. My Network is the same table and a different
        # relationship — capping affiliations must not quietly cap referrals.
        return (
            CareNetworkConnection.query
            .filter(
                getattr(CareNetworkConnection, _LINK_COLUMN[kind]) == provider_id,
                CareNetworkConnection.context == 'link',
                CareNetworkConnection.status == 'active',
            )
            .count()
        )
    raise ValueError(f'Unknown plan-limit metric: {metric!r}')


def _metric_snapshot(provider_type, provider_id, metric, plan) -> dict:
    limit = None if plan is None else getattr(plan, METRICS[metric]['column'], None)
    used = usage_for(provider_type, provider_id, metric)
    return {
        'metric': metric,
        'label': METRICS[metric]['label'],
        'limit': limit,
        'used': used,
        'unlimited': limit is None,
        # Clamped at 0 so an over-limit member (a downgrade, or a re-tuned
        # tier) reads as "none left" rather than a negative count.
        'remaining': None if limit is None else max(0, limit - used),
        'at_limit': limit is not None and used >= limit,
    }


def snapshot(provider_type, provider_id) -> dict:
    """Both metrics plus the tier they came from — what the provider's UI reads.

    One round trip for both, because both meters render on the same page and
    two endpoints would let them disagree by a refetch.
    """
    plan = plan_for(provider_type, provider_id)
    return {
        'plan': None if plan is None else {
            'code': plan.code, 'name': plan.name, 'tier': plan.tier.value,
        },
        SUPPORT_STAFF: _metric_snapshot(provider_type, provider_id, SUPPORT_STAFF, plan),
        MY_LINKS: _metric_snapshot(provider_type, provider_id, MY_LINKS, plan),
    }


# --------------------------------------------------------------------------- #
# Enforcement
# --------------------------------------------------------------------------- #

def require_capacity(provider_type, provider_id, metric, *, subject=None):
    """Raise :class:`PlanLimitExceeded` if adding one more would break the cap.

    Call this immediately before the write, not at the start of a longer flow —
    the count is only true at the moment it's taken.
    """
    plan = plan_for(provider_type, provider_id)
    if plan is None:
        return
    limit = getattr(plan, METRICS[metric]['column'], None)
    if limit is None:
        return
    used = usage_for(provider_type, provider_id, metric)
    if used < limit:
        return
    raise PlanLimitExceeded(
        metric, limit=limit, used=used, plan_name=plan.name, subject=subject,
    )


def require_link_capacity(*parties):
    """Check My Link capacity for every party to a connection.

    ``parties`` are ``(provider_type, provider_id, subject)`` triples. Both ends
    are checked because a link is one row that lands in two rosters: the doctor
    creates it, but it is the facility's Operation Page it turns on, and a
    facility that only ever accepts would otherwise never meet its own cap.

    Raises on the first party that is full, naming them — a doctor who is told
    only that "the limit" was reached has no way to know it isn't theirs.
    """
    for provider_type, provider_id, subject in parties:
        if provider_id is None:
            continue
        require_capacity(provider_type, provider_id, MY_LINKS, subject=subject)
