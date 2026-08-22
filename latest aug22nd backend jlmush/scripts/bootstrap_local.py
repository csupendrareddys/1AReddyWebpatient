"""Local-dev DB bootstrap — reproduce the platform tenant's PROD state.

``scripts/migrate.py`` builds the schema on a fresh DB via
``db.create_all()`` + ``stamp head``. That path deliberately does NOT run
the migration *bodies*, so the data those migrations seed — notably the
default ``plan1`` row and the per-tenant ``tenant_subscriptions`` backfill
from ``d4e5f6a7b8c9_pricing_plans_subscriptions_addons`` — is absent on a
brand-new local database.

Without that data a tenant has no subscription, so
``PlanService.resolve`` raises ``NoActiveSubscription`` and plan limits
are skipped entirely (lenient fallback) — which would hide exactly the
gating this environment exists to exercise.

Builds the post-split TWO-ROW world, idempotently:

  1. the VENDOR tenant   (is_platform=True, is_default=True, slug='vendor')
     — sells the SaaS, owns no product data, bypasses entitlement
  2. the LARAZEN tenant  (ordinary customer, slug='larazen')
     — runs the product and is really plan-gated
  3. the default plan ``plan1``      (what a brand-new tenant lands on)
  4. the ``larazen-ops`` plan + Larazen's ACTIVE subscription
  5. a PLATFORM_OWNER user on the VENDOR tenant

The vendor/customer distinction is the point: put the owner or the
product data on the wrong row and entitlement stops meaning anything.
See ``scripts/split_apex_tenant.py`` for the migration that produced
this shape on an existing database.

USAGE
-----
    docker compose exec backend python scripts/bootstrap_local.py

Idempotent: safe to re-run; every step is guarded by an existence check.
"""
import os
import sys
from datetime import timedelta

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)


# Platform-owner login (change via env if you like).
OWNER_PHONE = os.environ.get('BOOTSTRAP_OWNER_PHONE', '9876500000')
OWNER_PASSWORD = os.environ.get('BOOTSTRAP_OWNER_PASSWORD', 'Owner@1234')
OWNER_EMAIL = os.environ.get('BOOTSTRAP_OWNER_EMAIL', 'owner@platform-seed.test')

# Host that resolves to the Larazen tenant locally. The vendor answers on
# bare localhost via the is_default fallback.
LARAZEN_DOMAIN = os.environ.get('BOOTSTRAP_LARAZEN_DOMAIN', 'larazen.localhost')

# plan1 values copied verbatim from the pricing migration so the local
# cap matches production exactly (max_super_admins = 1).
PLAN1 = dict(
    code='plan1', name='Plan 1',
    description='Starter plan (local bootstrap copy).',
    trial_days=14,
    max_total_users=20, max_super_admins=1, max_sub_admins=3, max_providers=16,
    grace_period_days=0, razorpay_supported=True, tenant_keys_allowed=False,
)


def main():
    from app import create_app
    from app.extensions import db
    from app.models import (
        Tenant, TenantStatus, Plan, TenantSubscription,
        User, UserRole, UserStatus,
        PlanStatus, SubscriptionStatus, BillingCycle, OverLimitAction,
    )
    from app.models._base import utcnow, set_tenant_context
    from app.common.encryption import hash_for_search
    from flask import g

    app = create_app()
    with app.app_context():
        print('=' * 60)
        print(' Local bootstrap — vendor + larazen tenants, plans, owner')
        print('=' * 60)

        # 1a. VENDOR tenant --------------------------------------------------
        # Sells the SaaS. is_platform grants the entitlement bypass;
        # is_default makes it where unresolved anonymous requests land.
        vendor = Tenant.query.filter_by(
            is_platform=True, is_deleted=False,
        ).first()
        if vendor:
            print(f'[--] vendor tenant exists  ({vendor.slug} / {vendor.id})')
        else:
            vendor = Tenant(
                name='SaaS Platform', slug='vendor',
                is_platform=True, is_default=True,
                auto_subdomain=False,          # owns the zone apex itself
                status=TenantStatus.ACTIVE,
            )
            db.session.add(vendor)
            db.session.commit()
            print(f'[OK] created vendor tenant  ({vendor.id})')

        # 1b. LARAZEN tenant -------------------------------------------------
        # An ordinary paying customer. Neither flag set, so every gate
        # applies to it exactly as it would to any other tenant.
        tenant = Tenant.query.filter_by(
            slug='larazen', is_deleted=False,
        ).first()
        if tenant:
            print(f'[--] larazen tenant exists  ({tenant.slug} / {tenant.id})')
        else:
            tenant = Tenant(
                name='Larazen', slug='larazen',
                domain=LARAZEN_DOMAIN,
                is_platform=False, is_default=False,
                auto_subdomain=True, status=TenantStatus.ACTIVE,
            )
            db.session.add(tenant)
            db.session.commit()
            print(f'[OK] created larazen tenant  ({tenant.id})')

        # Set tenant context so RLS-guarded inserts (subscription) are allowed.
        g.tenant_id = tenant.id
        set_tenant_context(db.session, tenant.id)

        # 2. Default plan (plan1) ------------------------------------------
        plan = Plan.query.filter_by(code='plan1', is_deleted=False, owner_tenant_id=None).first()
        if plan:
            print(f'[--] plan1 exists  (max_super_admins={plan.max_super_admins})')
        else:
            plan = Plan(
                status=PlanStatus.ACTIVE, is_default=True,
                over_limit_action=OverLimitAction.BLOCK_NEW,
                features={},  # limits are what we're testing; empty tree is fine
                **PLAN1,
            )
            db.session.add(plan)
            db.session.commit()
            print(f'[OK] created plan1  (max_super_admins={plan.max_super_admins})')

        # 2b. Larazen's own plan ---------------------------------------------
        # plan1 cannot be reused: it grants zero feature paths and caps
        # seats below what Larazen already uses.
        from scripts.create_larazen_plan import ensure_larazen_plan
        larazen_plan = ensure_larazen_plan(verbose=False)
        db.session.commit()
        print(f'[OK] larazen-ops plan ready  '
              f'(super_admin cap={larazen_plan.max_super_admins})')

        # 3. Larazen subscription --------------------------------------------
        sub = TenantSubscription.query.filter_by(
            tenant_id=tenant.id, is_deleted=False,
        ).first()
        if sub:
            print(f'[--] larazen subscription exists  (plan={sub.plan.code}, '
                  f'status={sub.status.value})')
        else:
            now = utcnow()
            sub = TenantSubscription(
                tenant_id=tenant.id, plan_id=larazen_plan.id,
                status=SubscriptionStatus.ACTIVE,
                billing_cycle=BillingCycle.ANNUAL,
                current_period_start=now,
                current_period_end=now + timedelta(days=365),
            )
            db.session.add(sub)
            db.session.commit()
            print('[OK] created larazen subscription  '
                  '(larazen -> larazen-ops, ACTIVE)')

        # 4. Platform owner ----------------------------------------------
        # On the VENDOR tenant, not the product tenant. An owner sitting
        # inside a customer's tenant is the coupling this split removed.
        g.tenant_id = vendor.id
        set_tenant_context(db.session, vendor.id)
        owner = User.query.filter_by(
            _phone_hash=hash_for_search(OWNER_PHONE),
            tenant_id=vendor.id, is_deleted=False,
        ).first()
        if owner:
            print(f'[--] platform owner exists  (id={owner.id})')
        else:
            owner = User(
                first_name='Platform', last_name='Owner',
                role=UserRole.PLATFORM_OWNER, status=UserStatus.ACTIVE,
                tenant_id=vendor.id, email_verified=True, phone_verified=True,
            )
            owner.phone_number = OWNER_PHONE
            owner.email = OWNER_EMAIL
            owner.set_password(OWNER_PASSWORD)
            db.session.add(owner)
            db.session.commit()
            print(f'[OK] created platform owner  (id={owner.id})')

        print('-' * 60)
        print(f'  vendor tenant   : {vendor.id}  (is_platform, is_default)')
        print(f'  larazen tenant  : {tenant.id}  (ordinary customer)')
        print(f'  larazen host    : {LARAZEN_DOMAIN}')
        print(f'  larazen plan    : larazen-ops  '
              f'(super_admin cap={larazen_plan.max_super_admins})')
        print(f'  owner login     : phone={OWNER_PHONE}  password={OWNER_PASSWORD!r}')
        print('                    (sign in on the VENDOR host, not larazen)')
        print('=' * 60)
        print('\nNext: docker compose exec backend '
              'python scripts/seed_platform_users.py')
        return 0


if __name__ == '__main__':
    sys.exit(main())
