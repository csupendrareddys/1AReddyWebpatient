"""Self-serve tenant provisioning.

Wraps four existing pieces in one atomic-ish service call:

  1. :meth:`PlatformTenantService.create_tenant` — Tenant + landing seed +
     Cloudflare DNS provisioning (best-effort, failures captured on the row).
  2. :class:`TenantSubscription` — inserted directly so we can set
     ``status=TRIAL`` + ``trial_ends_at`` from the chosen plan.
  3. :meth:`SuperAdminService.create_admin` — first SUPER_ADMIN user scoped
     to the new tenant. Reuses the full dedup / RBAC / admin-profile logic.
  4. JWT issuance — returns ready-to-use access + refresh tokens so the
     caller can redirect straight into the new tenant's dashboard.

Schema is untouched — no new columns. ``SelfServeResult`` is a plain
namedtuple we hand back to the route handler for response shaping.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from app.api.admin.super_admin.service import SuperAdminService
from app.api.platform.service import PlatformTenantService
from app.common.tenant_context import with_tenant_context
from app.extensions import db
from app.models import (
    Plan, PlanStatus, Tenant,
    SubscriptionStatus, BillingCycle, TenantSubscription,
)
from app.models._base import utcnow


class PlanNotAvailable(ValueError):
    pass


class SlugUnavailable(ValueError):
    pass


@dataclass
class SelfServeResult:
    tenant: Tenant
    subscription: TenantSubscription
    user: object
    admin: object


class TenantSelfServeService:

    @staticmethod
    def provision(*, plan_code, tenant_payload, admin_payload,
                  seller_tenant=None, billing_cycle=None) -> SelfServeResult:
        """Create tenant + TRIAL subscription + initial super-admin.

        ``seller_tenant`` selects the funnel: None sells the VENDOR
        catalog and creates a top-level tenant (the original flow);
        an apex reseller Tenant sells that reseller's OWN catalog and
        creates a CHILD (parent + quota scoped here, mirroring
        ``ResellerService.create_child_tenant`` — the console and the
        public funnel must never disagree about what a child looks
        like). The caller has already verified apex-ness.

        Raises
        ------
        PlanNotAvailable
            If the requested plan doesn't exist or isn't ACTIVE in the
            selling catalog.
        SlugUnavailable
            If the requested subdomain is already taken (includes soft-deleted
            tenants because DNS may still reference them).
        ChildQuotaExceeded
            Reseller funnel only: the apex plan has no free child slots.
        ValueError
            Bubbled from ``SuperAdminService.create_admin`` on duplicate
            phone / email (scoped to the new tenant).
        """
        # --- Plan resolution: catalog entry must exist AND be ACTIVE ---
        # Owner-scoped: NULL sells the vendor catalog (top-level
        # tenants); an apex seller sells only rows it owns. The
        # ``ck_plans_apex_vendor_only`` CHECK guarantees an owned row is
        # kind='normal', so no extra kind check is needed here.
        owner_id = seller_tenant.id if seller_tenant is not None else None
        plan = Plan.query.filter_by(
            code=plan_code, status=PlanStatus.ACTIVE, is_deleted=False,
            owner_tenant_id=owner_id,
        ).first()
        if not plan:
            raise PlanNotAvailable(
                f'Plan "{plan_code}" is not available for self-serve signup.'
            )

        # --- Reseller funnel: a child consumes a subdomain slot ---
        # Checked before any row exists so a full reseller fails fast
        # (racing signups are caught again by the count after commit;
        # a rare over-provision is the reseller's to resolve, same as
        # the console path).
        if seller_tenant is not None:
            from app.api.pricing.service import ResellerPolicy
            ResellerPolicy.assert_child_slot(str(seller_tenant.id),
                                             'subdomains')

        # --- Slug availability: refuse if ANY tenant holds it (deleted or not)
        slug = tenant_payload['slug']
        if Tenant.query.filter_by(slug=slug).first():
            raise SlugUnavailable(f'Subdomain "{slug}" is already taken.')

        # 1. Tenant row + landing seed + DNS provisioning (reuse the platform
        #    service so the Cloudflare side-effect, error capture, and
        #    landing-config seed stay in one place).
        # Pass the resolved plan through (``_plan`` short-circuits
        # create_tenant's vendor-catalog lookup — an apex-owned plan
        # would be invisible to it). create_tenant creates the ONE
        # subscription; inserting a second here used to violate
        # ``ux_tenant_subscriptions_active`` and 500 the signup.
        tenant = PlatformTenantService.create_tenant({
            'name': tenant_payload['name'],
            'slug': slug,
            'domain': None,                 # custom domain comes later,
                                            # self-serve, once the tenant
                                            # is in and plan-entitled
            'logo_url': None,
            'settings': None,
            '_plan': plan,
            'billing_cycle': billing_cycle or 'monthly',
            # Children hang off the apex; P4 moves their DNS into the
            # apex's own zone — until then they resolve like every
            # other slug under the platform base domain.
            'parent_tenant_id': owner_id,
            'auto_subdomain': True,
        })

        # The anonymous request hit the apex domain so RLS is currently
        # pinned to the platform (default) tenant. Flip the session's
        # tenant context to the newly-created tenant so every INSERT on
        # tenant-scoped tables (``tenant_subscriptions``, ``users``,
        # ``admins`` …) satisfies the ``tenant_id = current_setting(...)``
        # RLS predicate. ``with_tenant_context`` restores the previous
        # value on exit.
        with with_tenant_context(tenant.id):
            # 2. The subscription already exists -- create_tenant made it
            #    from ``plan_code`` above, including the TRIAL/ACTIVE
            #    branching off ``plan.trial_days``. Read it back rather
            #    than inserting a second one.
            #
            #    Note this respects a plan that declares no trial: such a
            #    plan starts ACTIVE instead of being given an arbitrary
            #    14-day trial it never offered.
            subscription = (
                TenantSubscription.query
                .filter_by(tenant_id=tenant.id, is_deleted=False)
                .first()
            )
            if subscription is None:
                raise RuntimeError(
                    'Tenant created without a subscription -- refusing to '
                    'continue, every PlanService gate would raise '
                    'NoActiveSubscription for this tenant.'
                )

            # 3. Super-admin user. ``create_admin`` runs its own commit and
            #    also consults ``PlanService.require_within_limit`` — the
            #    first SA passes (0 < 1 for Plan1 ``max_super_admins``).
            #    On failure (dup phone/email, zero admin seats) the
            #    tenant+subscription are already committed — abandon
            #    them so the visitor can retry the SAME slug, and so a
            #    reseller's child quota isn't eaten by failed attempts.
            #    The abandon itself happens OUTSIDE this block: the
            #    rollback ends the transaction and with it the SET
            #    LOCAL tenant var, so any tenant-scoped UPDATE issued
            #    in here afterwards would be silently RLS-filtered.
            admin_data = dict(admin_payload)
            admin_data['role'] = 'super_admin'
            admin_data['tenant_id'] = tenant.id
            admin_failure = None
            user = admin = None
            try:
                user, admin = SuperAdminService.create_admin(
                    admin_data, created_by_user=None, tenant_id=tenant.id,
                )
            except Exception as e:      # noqa: BLE001 — re-raised below
                db.session.rollback()
                admin_failure = e

        if admin_failure is not None:
            TenantSelfServeService._abandon_tenant(tenant)
            raise admin_failure

        return SelfServeResult(
            tenant=tenant, subscription=subscription, user=user, admin=admin,
        )

    @staticmethod
    def _abandon_tenant(tenant):
        """Retire a half-created tenant whose admin never materialised.

        Soft-delete + rename (never a hard DELETE — FK cascades on a
        committed tenant are a minefield). The rename frees the slug
        for an immediate retry: the availability pre-check counts
        soft-deleted holders, so without it the visitor's own failed
        attempt would squat their subdomain. Same ``__deleted-`` suffix
        convention as ``PlatformTenantService._free_or_reject`` so ops
        sees one vocabulary. Quota accounting recovers automatically —
        ``ResellerPolicy.child_counts`` skips ``is_deleted`` rows.
        Best-effort: cleanup failure must not mask the original error.
        """
        try:
            from app.services.cloudflare_dns import CloudflareDnsService
            try:
                CloudflareDnsService.deprovision_tenant(tenant)
            except Exception:
                pass
            suffix = f'__deleted-{str(tenant.id)[:8]}'
            tenant.slug = f'{tenant.slug}{suffix}'[:100]
            tenant.is_deleted = True
            # Fresh transaction, fresh SET LOCAL — the subscription row
            # is RLS-scoped to the tenant being retired.
            with with_tenant_context(tenant.id):
                sub = (TenantSubscription.query
                       .filter_by(tenant_id=tenant.id, is_deleted=False)
                       .first())
                if sub is not None:
                    sub.is_deleted = True
                db.session.commit()
        except Exception:
            db.session.rollback()
