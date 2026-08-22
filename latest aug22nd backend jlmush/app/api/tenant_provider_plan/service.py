"""Service layer for tenant-scoped provider plans + subscriptions.

Splits cleanly into two service classes:

  * :class:`TenantProviderPlanService` — CRUD on ``TenantProviderPlan``.
    Authoring is gated on the feature path
    ``tenant.can_create_<vertical>_plans``. The platform-owner ops path
    bypasses that gate (separate ``author_on_behalf`` entry point).

  * :class:`TenantProviderSubscriptionService` — write/read of
    ``TenantProviderSubscription``. Provider signup inside the tenant
    calls ``create_pending_for_provider``; tenant admin approval flips
    it to TRIAL. Mirrors :class:`MembershipSubscriptionService`.

Quota enforcement (``Plan.max_provider_doctors`` and siblings) lives
in :func:`assert_provider_quota_available` and runs at subscription /
direct-registration time, NOT at plan-create time — a draft plan with
no subscribers shouldn't block the platform owner from setting the
quota to 0 retroactively.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Sequence

from sqlalchemy import func

from app.extensions import db
from app.api.pricing.service import FeatureGate
from app.models import (
    BillingCycle,
    Clinic,
    Doctor,
    Hospital,
    MembershipPlanStatus,
    MembershipSubscriptionStatus,
    MembershipVertical,
    Plan,
    TenantProviderPlan,
    TenantProviderSubscription,
    TenantSubscription,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Domain errors
# --------------------------------------------------------------------------- #

class TenantProviderPlanError(Exception):
    """Base class for tenant-provider-plan service errors."""


class FeatureNotEntitled(TenantProviderPlanError):
    """Tenant doesn't have the ``tenant.can_create_<vertical>_plans``
    add-on — can't create / edit plans for this vertical."""

    def __init__(self, vertical: MembershipVertical):
        self.vertical = vertical
        super().__init__(
            f"Tenant not entitled to author {vertical.value} plans"
        )


class PlanNotFound(TenantProviderPlanError, LookupError):
    """Plan id / code lookup miss within the tenant."""


class PlanCodeConflict(TenantProviderPlanError):
    """Another active plan already uses this ``code`` in the tenant."""


class WrongVertical(TenantProviderPlanError):
    """Subscribing a provider to a plan whose vertical doesn't match
    the provider type."""


class ProviderQuotaExceeded(TenantProviderPlanError):
    """Tenant's per-vertical provider-entity quota is full."""

    def __init__(self, vertical: MembershipVertical, current: int, cap):
        self.vertical = vertical
        self.current = current
        self.cap = cap
        super().__init__(
            f"Provider quota for {vertical.value} exceeded: "
            f"{current} / {cap}"
        )


class SubscriptionExists(TenantProviderPlanError):
    """Provider already has a live (PENDING/TRIAL/ACTIVE) subscription
    in this tenant."""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _now():
    return datetime.now(timezone.utc)


_VERTICAL_FEATURE = {
    MembershipVertical.DOCTOR: 'tenant.can_create_doctor_plans',
    MembershipVertical.CLINIC: 'tenant.can_create_clinic_plans',
    MembershipVertical.HOSPITAL: 'tenant.can_create_hospital_plans',
}

# Maps vertical → the ORM model that holds the per-tenant entity rows. Used
# for quota counting + cross-tenant validation when subscribing.
_VERTICAL_PROFILE_MODEL = {
    MembershipVertical.DOCTOR: Doctor,
    MembershipVertical.CLINIC: Clinic,
    MembershipVertical.HOSPITAL: Hospital,
}

# Maps vertical → the column on ``Plan`` that caps how many entities the
# tenant may register. Provider-entity quotas; -1 = unlimited, 0/None =
# vertical disallowed entirely.
_VERTICAL_QUOTA_ATTR = {
    MembershipVertical.DOCTOR: 'max_provider_doctors',
    MembershipVertical.CLINIC: 'max_provider_clinics',
    MembershipVertical.HOSPITAL: 'max_provider_hospitals',
}


def assert_feature_entitled(tenant_id, vertical: MembershipVertical) -> None:
    """Raise :class:`FeatureNotEntitled` unless the tenant's resolved
    feature tree includes ``tenant.can_create_<vertical>_plans``.

    Plumbing for both the in-tenant CRUD path (tenant super-admin
    authoring) and signup-time gating ("is plan selection required?").
    The platform-owner ops path bypasses this check.
    """
    feature_path = _VERTICAL_FEATURE[vertical]
    if not FeatureGate.is_enabled(tenant_id, feature_path):
        raise FeatureNotEntitled(vertical)


_VERTICAL_SNAPSHOT_KEY = {
    MembershipVertical.DOCTOR: 'doctor',
    MembershipVertical.CLINIC: 'clinic',
    MembershipVertical.HOSPITAL: 'hospital',
}


def _resolve_quota_cap(tenant_id, vertical: MembershipVertical):
    """Return the platform-owner-set per-vertical entity cap for this
    tenant. Prefers the subscription-time ``plan_snapshot``
    (grandfathering — catalog edits never change what a subscriber
    bought); legacy rows without one fall back to the live ``Plan``.
    NULL/missing → 0 (deny). ``-1`` → unlimited.
    """
    sub = (
        TenantSubscription.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .first()
    )
    if sub is None:
        return 0
    # Same isinstance guard as PlanService._resolve_uncached: only a
    # real dict is a snapshot; anything else means live-plan fallback.
    snap = sub.plan_snapshot if isinstance(sub.plan_snapshot, dict) else {}
    ent = snap.get('provider_entity_limits')
    if isinstance(ent, dict):
        cap = ent.get(_VERTICAL_SNAPSHOT_KEY[vertical])
        return 0 if cap is None else cap
    plan = Plan.query.filter_by(id=sub.plan_id, is_deleted=False).first()
    if plan is None:
        return 0
    attr = _VERTICAL_QUOTA_ATTR[vertical]
    cap = getattr(plan, attr, None)
    return 0 if cap is None else cap


def _addon_entity_delta(tenant_id, vertical: MembershipVertical) -> int:
    """Extra entity headroom bought as add-ons: the sum over the
    tenant's ACTIVE, unexpired add-ons of ``limits[<vertical>]`` x
    units x quantity. Suspended/cancelled rows grant nothing; a NULL
    period end (one_time purchase) never expires on its own."""
    from app.models import TenantAddon
    from app.models._base import utcnow
    from app.models._enums import AddonSubscriptionStatus

    key = {
        MembershipVertical.DOCTOR: 'doctor',
        MembershipVertical.CLINIC: 'clinic',
        MembershipVertical.HOSPITAL: 'hospital',
    }[vertical]
    now = utcnow()
    total = 0
    rows = (
        TenantAddon.query
        .filter_by(tenant_id=tenant_id, is_deleted=False,
                   status=AddonSubscriptionStatus.ACTIVE)
        .all()
    )
    for ta in rows:
        # ``is True`` on purpose: a MagicMock attribute is
        # truthy, which made every add-on look like stock.
        if getattr(ta, 'is_stock', False) is True:
            continue                          # inventory, not capacity
        end = ta.current_period_end
        if end is not None:
            if end.tzinfo is None:
                from datetime import timezone as _tz
                end = end.replace(tzinfo=_tz.utc)
            if end < now:
                continue
        addon = ta.addon
        if addon is None or addon.is_deleted or not addon.limits:
            continue
        delta = addon.limits.get(key)
        if not isinstance(delta, int):
            continue
        qty = max(int(ta.quantity or 1), 1)
        units = ta.units if isinstance(ta.units, int) and ta.units > 0 else 1
        total += delta * qty * units
    return total


def _entity_count(tenant_id, vertical: MembershipVertical) -> int:
    """Live count of non-deleted provider entities in one vertical —
    the same census assert_provider_quota_available charges against."""
    profile_model = _VERTICAL_PROFILE_MODEL[vertical]
    q = db.session.query(func.count(profile_model.id)).filter(
        profile_model.tenant_id == tenant_id,
        profile_model.is_deleted.is_(False),
    )
    from app.models import Doctor, User, UserRole
    if profile_model is Doctor:
        q = q.join(User, Doctor.user_id == User.id).filter(
            User.role == UserRole.DOCTOR)
    return q.scalar() or 0


def entity_usage(tenant_id) -> dict:
    """{'doctor'|'clinic'|'hospital': {'used', 'limit'}} — the tenant's
    marketplace-entity census against its effective caps (plan snapshot
    + add-on headroom; -1 = unlimited)."""
    out = {}
    for vertical, key in (
            (MembershipVertical.DOCTOR, 'doctor'),
            (MembershipVertical.CLINIC, 'clinic'),
            (MembershipVertical.HOSPITAL, 'hospital')):
        cap = _resolve_quota_cap(tenant_id, vertical)
        if cap != -1:
            cap += _addon_entity_delta(tenant_id, vertical)
        out[key] = {'used': _entity_count(tenant_id, vertical),
                    'limit': cap}
    return out


def assert_provider_quota_available(
    tenant_id, vertical: MembershipVertical,
) -> None:
    """Check the tenant has headroom for one more provider entity in
    this vertical. Raises :class:`ProviderQuotaExceeded` if at cap.

    Treats NULL / missing quota as 0 (deny) — legacy plan rows that
    pre-date the quota columns must be explicitly backfilled by the
    platform owner before the tenant can register provider entities.
    """
    cap = _resolve_quota_cap(tenant_id, vertical)
    if cap == -1:
        # Unlimited sentinel.
        return
    cap += _addon_entity_delta(tenant_id, vertical)
    current = _entity_count(tenant_id, vertical)
    if current >= cap:
        raise ProviderQuotaExceeded(vertical, current, cap)


# --------------------------------------------------------------------------- #
# TenantProviderPlanService — CRUD
# --------------------------------------------------------------------------- #

class TenantProviderPlanService:

    # --- create -----------------------------------------------------

    @staticmethod
    def create(
        *,
        tenant_id,
        author_user_id,
        vertical: MembershipVertical,
        code: str,
        name: str,
        description: str | None = None,
        price_inr_monthly=None,
        price_inr_annual=None,
        trial_days: int = 0,
        features: dict | None = None,
        sort_order: int = 0,
        status: str = 'draft',
        bypass_feature_check: bool = False,
        authored_by: str = 'tenant',
    ) -> TenantProviderPlan:
        """Create a new plan template for the tenant.

        ``bypass_feature_check=True`` is for the platform-owner ops
        endpoint — the platform owner can always author on a tenant's
        behalf regardless of whether the tenant currently holds the
        capability add-on. Defaults False (tenant self-service path).
        """
        if not bypass_feature_check:
            assert_feature_entitled(tenant_id, vertical)

        existing = (
            TenantProviderPlan.query
            .filter_by(
                tenant_id=tenant_id, code=code, is_deleted=False,
            )
            .first()
        )
        if existing:
            raise PlanCodeConflict(code)

        plan = TenantProviderPlan(
            tenant_id=tenant_id,
            code=code,
            name=name,
            description=description,
            vertical=vertical,
            price_inr_monthly=price_inr_monthly,
            price_inr_annual=price_inr_annual,
            trial_days=trial_days or 0,
            features=features or {},
            sort_order=sort_order or 0,
            status=MembershipPlanStatus(status) if status else MembershipPlanStatus.DRAFT,
            authored_by=authored_by,
            created_by_id=author_user_id,
        )
        db.session.add(plan)
        db.session.commit()
        logger.info(
            'tenant_provider_plan.created tenant=%s code=%s vertical=%s '
            'authored_by=%s',
            tenant_id, code, vertical.value, authored_by,
        )
        return plan

    # --- update -----------------------------------------------------

    @staticmethod
    def update(
        *,
        plan_id,
        tenant_id,
        editor_user_id,
        fields: dict,
        bypass_feature_check: bool = False,
    ) -> TenantProviderPlan:
        """Patch the editable fields on an existing plan. Status changes
        go through here as well — set ``fields['status']`` to a value
        of :class:`MembershipPlanStatus`.
        """
        plan = (
            TenantProviderPlan.query
            .filter_by(id=plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if plan is None:
            raise PlanNotFound(plan_id)

        if not bypass_feature_check:
            assert_feature_entitled(tenant_id, plan.vertical)

        editable = {
            'name', 'description',
            'price_inr_monthly', 'price_inr_annual',
            'trial_days', 'features', 'sort_order', 'status',
        }
        for key, value in fields.items():
            if key not in editable:
                continue
            if key == 'status' and isinstance(value, str):
                value = MembershipPlanStatus(value)
            setattr(plan, key, value)
        plan.updated_by_id = editor_user_id
        db.session.commit()
        return plan

    # --- delete (soft) ---------------------------------------------

    @staticmethod
    def archive(*, plan_id, tenant_id, editor_user_id) -> TenantProviderPlan:
        """Soft-archive a plan. Existing live subscriptions keep working
        until cancelled — archiving only hides the plan from the signup
        picker.
        """
        plan = (
            TenantProviderPlan.query
            .filter_by(id=plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if plan is None:
            raise PlanNotFound(plan_id)
        plan.status = MembershipPlanStatus.ARCHIVED
        plan.updated_by_id = editor_user_id
        db.session.commit()
        return plan

    # --- list -------------------------------------------------------

    @staticmethod
    def list_for_tenant(
        *, tenant_id, vertical: MembershipVertical | None = None,
        statuses: Sequence[MembershipPlanStatus] | None = None,
    ) -> list[TenantProviderPlan]:
        q = TenantProviderPlan.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        )
        if vertical is not None:
            q = q.filter(TenantProviderPlan.vertical == vertical)
        if statuses is not None:
            q = q.filter(TenantProviderPlan.status.in_(statuses))
        return (
            q.order_by(
                TenantProviderPlan.vertical.asc(),
                TenantProviderPlan.sort_order.asc(),
                TenantProviderPlan.created_at.asc(),
            )
            .all()
        )

    # --- signup-time helper ----------------------------------------

    @staticmethod
    def list_active_for_signup(
        *, tenant_id, vertical: MembershipVertical,
    ) -> list[TenantProviderPlan]:
        """Plans the in-tenant signup picker should render. Excludes
        DRAFT / ARCHIVED.
        """
        return TenantProviderPlanService.list_for_tenant(
            tenant_id=tenant_id, vertical=vertical,
            statuses=[MembershipPlanStatus.ACTIVE],
        )

    @staticmethod
    def is_plan_selection_required(
        *, tenant_id, vertical: MembershipVertical,
    ) -> bool:
        """Decide whether provider signup inside a tenant must pick a
        plan. Rules (see module docstring):

          * Tenant lacks the capability add-on → no plans → not required.
          * Tenant has the add-on but no ACTIVE plans for the vertical →
            still not required (provider registers directly; tenant
            admin can author plans later without disrupting in-flight
            signups).
          * Tenant has the add-on AND ≥1 ACTIVE plan for the vertical →
            REQUIRED.
        """
        try:
            assert_feature_entitled(tenant_id, vertical)
        except FeatureNotEntitled:
            return False
        active = TenantProviderPlanService.list_active_for_signup(
            tenant_id=tenant_id, vertical=vertical,
        )
        return len(active) > 0


# --------------------------------------------------------------------------- #
# TenantProviderSubscriptionService — provider ↔ plan link
# --------------------------------------------------------------------------- #

class TenantProviderSubscriptionService:

    @staticmethod
    def create_pending_for_provider(
        *,
        tenant_id,
        vertical: MembershipVertical,
        provider_id,
        user_id,
        plan_id,
    ) -> TenantProviderSubscription:
        """Bind a provider profile inside the tenant to one of the
        tenant's authored plans, in PENDING state.

        Called from the in-tenant provider signup pipeline after the
        Doctor / Clinic / Hospital row commits. Tenant-admin approval
        later flips the row to TRIAL via :meth:`activate_trial`.

        Quota check + cross-vertical validation live here so the route
        layer stays a thin wrapper.
        """
        plan = (
            TenantProviderPlan.query
            .filter_by(
                id=plan_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if plan is None:
            raise PlanNotFound(plan_id)
        if plan.status != MembershipPlanStatus.ACTIVE:
            # Mirror the apex-membership behaviour: only active plans
            # can be subscribed to.
            raise PlanNotFound(plan_id)
        if plan.vertical != vertical:
            raise WrongVertical(
                f"Plan {plan.code} is for {plan.vertical.value}, "
                f"not {vertical.value}"
            )

        # Employee / consultant plans are for doctors NOT on a membership tier.
        # A plan-based doctor must be converted to employee/consultant first —
        # the three billing types are mutually exclusive.
        if vertical == MembershipVertical.DOCTOR:
            from app.models import Doctor, DoctorBillingType
            from app.api.common.payment import billing_service as bsvc
            doc = Doctor.query.filter_by(
                id=provider_id, tenant_id=tenant_id).first()
            if doc is not None and \
                    bsvc.current_billing_type(doc) == DoctorBillingType.PLAN:
                raise TenantProviderPlanError(
                    'This doctor is plan-based (on a membership tier). Convert '
                    'them to employee or consultant in their billing settings '
                    'before subscribing them to an employee/consultant plan.')

        # NOTE — provider-quota check intentionally NOT done here.
        #
        # The quota in ``Plan.max_provider_<vertical>`` is a cap on
        # how many Doctor/Clinic/Hospital ROWS a tenant can have,
        # not on how many subscriptions. By the time this method
        # runs the provider already exists (provider_id is FK to
        # an existing row), so the cap was implicitly consumed at
        # provider-create time. Re-checking it here would count
        # the provider against itself and reject whenever the
        # tenant happens to be at-or-above cap — exactly the
        # "Provider quota for hospital exceeded: 1 / 0" rejection
        # the Round-10 backfill flow hit in prod.
        #
        # If the tenant is over quota, that's a problem to catch
        # at provider-CREATION time (invite_facility_core /
        # signup_hospital) — Round 11 should add the check there.
        # For now, attaching a plan to an existing provider is
        # always allowed; the platform owner can adjust the
        # tenant's plan if they need to enforce the cap.

        # One live subscription per provider profile per tenant.
        existing = (
            TenantProviderSubscription.query
            .filter_by(
                tenant_id=tenant_id,
                provider_type=vertical,
                provider_id=provider_id,
                is_deleted=False,
            )
            .filter(
                TenantProviderSubscription.status.in_([
                    MembershipSubscriptionStatus.PENDING,
                    MembershipSubscriptionStatus.TRIAL,
                    MembershipSubscriptionStatus.ACTIVE,
                ])
            )
            .first()
        )
        if existing is not None:
            raise SubscriptionExists(
                f"Provider {provider_id} already has subscription "
                f"{existing.id}"
            )

        sub = TenantProviderSubscription(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_type=vertical,
            provider_id=provider_id,
            tenant_provider_plan_id=plan.id,
            billing_cycle=BillingCycle.MONTHLY,
            status=MembershipSubscriptionStatus.PENDING,
            created_by_id=user_id,
        )
        db.session.add(sub)
        db.session.commit()
        logger.info(
            'tenant_provider_sub.created tenant=%s vertical=%s '
            'provider_id=%s plan=%s',
            tenant_id, vertical.value, provider_id, plan.code,
        )
        return sub

    @staticmethod
    def request_plan(
        *, tenant_id, vertical: MembershipVertical, provider_id, user_id, plan_id,
    ) -> TenantProviderSubscription:
        """Provider self-serve plan request (Phase A5). Admin then approves.

        * No active-ish subscription yet → create a PENDING one directly.
        * Already subscribed → record a pending change request
          (``requested_plan_id`` / ``requested_at``) WITHOUT touching the
          live plan. Requesting the current plan clears any stale request.
        """
        from datetime import datetime, timezone

        plan = (
            TenantProviderPlan.query
            .filter_by(id=plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if plan is None or plan.status != MembershipPlanStatus.ACTIVE:
            raise PlanNotFound(plan_id)
        if plan.vertical != vertical:
            raise WrongVertical(
                f"Plan {plan.code} is for {plan.vertical.value}, "
                f"not {vertical.value}"
            )

        existing = (
            TenantProviderSubscription.query
            .filter_by(
                tenant_id=tenant_id, provider_type=vertical,
                provider_id=provider_id, is_deleted=False,
            )
            .filter(TenantProviderSubscription.status.in_([
                MembershipSubscriptionStatus.PENDING,
                MembershipSubscriptionStatus.TRIAL,
                MembershipSubscriptionStatus.ACTIVE,
            ]))
            .first()
        )
        if existing is None:
            return TenantProviderSubscriptionService.create_pending_for_provider(
                tenant_id=tenant_id, vertical=vertical,
                provider_id=provider_id, user_id=user_id, plan_id=plan_id,
            )

        if str(existing.tenant_provider_plan_id) == str(plan.id):
            existing.requested_plan_id = None
            existing.requested_at = None
        else:
            existing.requested_plan_id = plan.id
            existing.requested_at = datetime.now(timezone.utc)
        db.session.commit()
        logger.info(
            'tenant_provider_sub.plan_requested tenant=%s sub=%s requested=%s',
            tenant_id, existing.id, plan.code,
        )
        return existing

    @staticmethod
    def approve_request(
        *, tenant_id, subscription_id, actor_user_id,
    ) -> TenantProviderSubscription:
        """Admin approves a provider's request. Applies a pending plan-change
        request (then clears it), or activates a PENDING signup request."""
        sub = (
            TenantProviderSubscription.query
            .filter_by(id=subscription_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if sub is None:
            raise PlanNotFound(subscription_id)

        if sub.requested_plan_id:
            TenantProviderSubscriptionService.change_plan(
                tenant_id=tenant_id, subscription_id=sub.id,
                new_plan_id=sub.requested_plan_id, actor_user_id=actor_user_id,
            )
            sub.requested_plan_id = None
            sub.requested_at = None
            db.session.commit()
            return sub

        if sub.status == MembershipSubscriptionStatus.PENDING:
            return TenantProviderSubscriptionService.activate(
                tenant_id=tenant_id, subscription_id=sub.id,
                actor_user_id=actor_user_id,
            )
        return sub

    @staticmethod
    def get_active_for_user(*, tenant_id, user_id):
        """Single-row read for the tenant provider's own dashboard:
        "what plan am I on?"."""
        return (
            TenantProviderSubscription.query
            .filter_by(
                tenant_id=tenant_id, user_id=user_id, is_deleted=False,
            )
            .filter(
                TenantProviderSubscription.status.in_([
                    MembershipSubscriptionStatus.PENDING,
                    MembershipSubscriptionStatus.TRIAL,
                    MembershipSubscriptionStatus.ACTIVE,
                ])
            )
            .order_by(TenantProviderSubscription.created_at.desc())
            .first()
        )

    @staticmethod
    def get_pending_for_provider(
        *, tenant_id, vertical: MembershipVertical, provider_id,
    ):
        """Return the PENDING subscription for this provider profile, if
        any. Used by the verification-approval handler to flip
        PENDING → TRIAL when the tenant admin approves the provider."""
        return (
            TenantProviderSubscription.query
            .filter_by(
                tenant_id=tenant_id,
                provider_type=vertical,
                provider_id=provider_id,
                status=MembershipSubscriptionStatus.PENDING,
                is_deleted=False,
            )
            .order_by(TenantProviderSubscription.created_at.desc())
            .first()
        )

    # ─── Round-10 admin management API ─────────────────────────────

    @staticmethod
    def list_unsubscribed_providers(*, tenant_id, vertical: MembershipVertical):
        """Providers (Doctor / Clinic / Hospital) in this tenant that
        DON'T have a live ``TenantProviderSubscription``.

        "Live" = PENDING / TRIAL / ACTIVE (not CANCELLED, not soft-
        deleted). A row that's been cancelled is treated as unsubscribed
        so the super_admin can put the provider back on a plan.

        Returns a list of dicts ``{provider_id, user_id, display_name}``
        ready for the "Subscribe Provider" picker dropdown. Vertical
        is mandatory because the underlying tables (doctors / clinics /
        hospitals) are different schemas — the caller pre-filters by
        vertical anyway via the UI tabs.
        """
        from app.models import (
            Clinic, Doctor, Hospital,
        )
        live_statuses = (
            MembershipSubscriptionStatus.PENDING,
            MembershipSubscriptionStatus.TRIAL,
            MembershipSubscriptionStatus.ACTIVE,
        )
        # IDs of provider rows that ARE already subscribed (live), so we
        # can subtract them. Sub-query rather than NOT IN to dodge the
        # NULL-in-NOT-IN gotcha.
        subscribed_ids = {
            str(row.provider_id) for row in (
                TenantProviderSubscription.query
                .filter_by(
                    tenant_id=tenant_id, provider_type=vertical,
                    is_deleted=False,
                )
                .filter(TenantProviderSubscription.status.in_(live_statuses))
                .all()
            )
        }

        out = []
        if vertical == MembershipVertical.DOCTOR:
            from app.models import DoctorBillingType
            from app.api.common.payment import billing_service as bsvc
            rows = (
                Doctor.query
                .filter_by(tenant_id=tenant_id, is_deleted=False)
                .all()
            )
            for d in rows:
                if str(d.id) in subscribed_ids:
                    continue
                # Only employee / consultant doctors belong here — a plan-based
                # doctor is managed on the Membership Subscriptions page instead.
                if bsvc.current_billing_type(d) == DoctorBillingType.PLAN:
                    continue
                u = d.user
                fn = (u.first_name or '').strip() if u else ''
                ln = (u.last_name or '').strip() if u else ''
                label = (f'Dr. {fn} {ln}'.strip()) or f'Doctor {d.id}'
                out.append({
                    'provider_id': str(d.id),
                    'user_id': str(u.id) if u else None,
                    'display_name': label,
                })
        elif vertical == MembershipVertical.CLINIC:
            rows = (
                Clinic.query
                .filter_by(tenant_id=tenant_id, is_deleted=False)
                .all()
            )
            for c in rows:
                if str(c.id) in subscribed_ids:
                    continue
                out.append({
                    'provider_id': str(c.id),
                    'user_id': str(c.admin_user_id) if c.admin_user_id else None,
                    'display_name': c.name or f'Clinic {c.id}',
                })
        elif vertical == MembershipVertical.HOSPITAL:
            rows = (
                Hospital.query
                .filter_by(tenant_id=tenant_id, is_deleted=False)
                .all()
            )
            for h in rows:
                if str(h.id) in subscribed_ids:
                    continue
                out.append({
                    'provider_id': str(h.id),
                    'user_id': str(h.admin_user_id) if h.admin_user_id else None,
                    'display_name': h.name or f'Hospital {h.id}',
                })
        # Stable ordering — alphabetical by display_name so the picker
        # is easy to scan and re-renders idempotently.
        out.sort(key=lambda r: r['display_name'].lower())
        return out

    @staticmethod
    def list_for_tenant(
        *, tenant_id, vertical: MembershipVertical | None = None,
        status: MembershipSubscriptionStatus | None = None,
    ):
        """All provider subscriptions in this tenant.

        Used by ``GET /api/tenant-provider-subscriptions`` so a tenant
        SUPER_ADMIN can review their roster: who's on which plan, who's
        still in PENDING (awaiting verification), who's been cancelled.
        Strictly tenant-scoped — no row from another tenant can ever
        appear here (RLS + the explicit tenant_id filter both apply).
        Ordered newest-first so freshly-added providers float to the
        top of the table.
        """
        q = TenantProviderSubscription.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        )
        if vertical is not None:
            q = q.filter_by(provider_type=vertical)
        if status is not None:
            q = q.filter_by(status=status)
        return (
            q.order_by(TenantProviderSubscription.created_at.desc())
             .all()
        )

    @staticmethod
    def change_plan(
        *, tenant_id, subscription_id, new_plan_id, actor_user_id,
    ) -> TenantProviderSubscription:
        """Move a provider's subscription to a different plan in the
        SAME tenant + SAME vertical.

        Tenant-scope check is in two places:
          * Subscription must belong to ``tenant_id`` (filter below).
          * New plan must also belong to ``tenant_id`` (filter below).
        Both are mandatory — without the subscription check a
        SUPER_ADMIN could spoof another tenant's subscription_id via
        a forged URL; without the plan check they could attach their
        provider to a plan authored by a different tenant. Both
        return ``PlanNotFound`` (deliberately opaque — we don't leak
        whether the row exists elsewhere).

        Vertical must match — a doctor subscription can't be moved
        onto a hospital plan. Returns the updated subscription.
        """
        sub = (
            TenantProviderSubscription.query
            .filter_by(
                id=subscription_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if sub is None:
            raise PlanNotFound(subscription_id)

        new_plan = (
            TenantProviderPlan.query
            .filter_by(
                id=new_plan_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if new_plan is None:
            raise PlanNotFound(new_plan_id)
        if new_plan.status != MembershipPlanStatus.ACTIVE:
            raise PlanNotFound(new_plan_id)
        if new_plan.vertical != sub.provider_type:
            raise WrongVertical(
                f"Plan {new_plan.code} is for {new_plan.vertical.value}, "
                f"not {sub.provider_type.value}"
            )

        # Idempotent: re-saving the same plan is a no-op so the UI
        # can fire PATCH on every change-plan dialog submit without
        # producing audit-log noise.
        if str(sub.tenant_provider_plan_id) == str(new_plan.id):
            return sub

        old_plan_id = sub.tenant_provider_plan_id
        sub.tenant_provider_plan_id = new_plan.id
        db.session.commit()
        logger.info(
            'tenant_provider_sub.plan_changed tenant=%s sub=%s '
            'old_plan=%s new_plan=%s actor=%s',
            tenant_id, sub.id, old_plan_id, new_plan.id, actor_user_id,
        )
        return sub

    @staticmethod
    def cancel(
        *, tenant_id, subscription_id, actor_user_id,
    ) -> TenantProviderSubscription:
        """Soft-cancel a provider's subscription. Status flips to
        CANCELLED; the row stays (with ``is_deleted=False``) so the
        audit trail of who-was-on-what-when survives. Re-subscribing
        the same provider mints a new row via
        ``create_pending_for_provider`` — the unique-active-row
        constraint there ignores CANCELLED rows.

        Tenant-scope check on the subscription_id. Idempotent on
        already-cancelled rows.
        """
        sub = (
            TenantProviderSubscription.query
            .filter_by(
                id=subscription_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if sub is None:
            raise PlanNotFound(subscription_id)
        if sub.status == MembershipSubscriptionStatus.CANCELLED:
            return sub
        sub.status = MembershipSubscriptionStatus.CANCELLED
        db.session.commit()
        logger.info(
            'tenant_provider_sub.cancelled tenant=%s sub=%s actor=%s',
            tenant_id, sub.id, actor_user_id,
        )
        return sub

    @staticmethod
    def activate(
        *, tenant_id, subscription_id, actor_user_id,
    ) -> TenantProviderSubscription:
        """Operator-driven flip of a PENDING / TRIAL subscription to
        ACTIVE.

        The Round-10 admin table shows a "Pending" chip for newly
        attached subscriptions; this method powers the "Activate"
        row-action that takes them to ACTIVE without waiting on the
        verification-approval auto-trigger (useful when the operator
        wants to bypass the trial window for an already-paying
        provider, or when the verification flow was skipped).

        Tenant-scoped lookup. Idempotent on already-ACTIVE rows.
        Refuses to re-activate a CANCELLED row — operator should
        create a fresh subscription instead so the audit trail keeps
        a clean break.
        """
        sub = (
            TenantProviderSubscription.query
            .filter_by(
                id=subscription_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if sub is None:
            raise PlanNotFound(subscription_id)
        if sub.status == MembershipSubscriptionStatus.ACTIVE:
            return sub
        if sub.status == MembershipSubscriptionStatus.CANCELLED:
            raise TenantProviderPlanError(
                'Cannot activate a cancelled subscription. '
                'Create a new one instead.'
            )
        now = _now()
        sub.status = MembershipSubscriptionStatus.ACTIVE
        # Anchor a 30-day initial billing period so the first cycle
        # has a sensible end date — matches the trial-fallback used
        # in activate_trial when trial_days = 0.
        if sub.current_period_start is None:
            sub.current_period_start = now
        if (
            sub.current_period_end is None
            or sub.current_period_end < now
        ):
            sub.current_period_end = now + timedelta(days=30)
        db.session.commit()
        logger.info(
            'tenant_provider_sub.activated tenant=%s sub=%s actor=%s',
            tenant_id, sub.id, actor_user_id,
        )
        return sub

    @staticmethod
    def activate_trial(subscription) -> TenantProviderSubscription:
        """Flip a PENDING subscription to TRIAL. Idempotent — re-firing
        on an already-TRIAL/ACTIVE row is a no-op so admins can re-save
        the approval without resetting the trial clock.

        Trial duration comes from the bound ``TenantProviderPlan``'s
        ``trial_days`` column. Anchors ``current_period_start`` /
        ``current_period_end`` to the same boundaries the SaaS
        ``TenantSubscription`` flow uses (period = trial window when
        trial_days > 0, otherwise day-of-activation forward).
        """
        if subscription is None:
            return None
        if subscription.status != MembershipSubscriptionStatus.PENDING:
            return subscription
        plan = subscription.plan
        now = _now()
        subscription.status = MembershipSubscriptionStatus.TRIAL
        subscription.current_period_start = now
        if plan and plan.trial_days and plan.trial_days > 0:
            trial_end = now + timedelta(days=plan.trial_days)
            subscription.trial_ends_at = trial_end
            subscription.current_period_end = trial_end
        else:
            # No trial — go straight to a 30-day initial billing period
            # for parity with the marketplace flow. The first invoice
            # cycle will overwrite this on the next period rollover.
            subscription.current_period_end = now + timedelta(days=30)
        db.session.commit()
        logger.info(
            'tenant_provider_sub.trial_activated tenant=%s id=%s '
            'trial_ends=%s',
            subscription.tenant_id, subscription.id,
            subscription.trial_ends_at,
        )
        return subscription
