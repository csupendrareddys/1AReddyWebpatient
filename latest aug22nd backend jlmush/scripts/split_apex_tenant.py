"""Split the SaaS vendor out of the apex tenant.

Before: ONE tenant row (slug ``platform``, ``is_default=True``) is
simultaneously the SaaS vendor, the anonymous-request fallback, and a
fully-exempt clinic business running a marketplace.

After: TWO rows.
  * ``larazen``  -- the existing row, converted **in place**. Keeps every
    user, doctor, clinic, appointment and landing config it already had
    (nothing moves across ``tenant_id``). Becomes an ordinary customer:
    ``is_default=False``, ``is_platform=False``, real plan, really gated.
  * ``vendor``   -- a brand-new, empty row. ``is_platform=True`` (sells
    the SaaS, bypasses entitlement) and ``is_default=True`` (anonymous
    fallback). Owns no product data.

The PLATFORM_OWNER user moves to the vendor row and their sessions are
revoked, so they must sign in again on the vendor host.

Run order matters -- ``scripts/create_larazen_plan.py`` must have run
first, since this attaches Larazen's subscription to it.

Dry-run by default; pass ``--apply`` to commit::

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/split_apex_tenant.py
    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/split_apex_tenant.py --apply

Idempotent: re-running after a successful split reports "already split"
and changes nothing.
"""
import argparse
import uuid
from datetime import datetime, timedelta, timezone

from app import create_app
from app.extensions import db
from app.models import Tenant, User
from app.models._enums import UserRole, TenantStatus, SubscriptionStatus, BillingCycle
from app.models.plan import Plan, TenantSubscription

LARAZEN_SLUG = 'larazen'
LARAZEN_NAME = 'Larazen'
LARAZEN_PLAN_CODE = 'larazen-ops'

VENDOR_SLUG = 'vendor'
VENDOR_NAME = 'SaaS Platform'


def _log(msg):
    print(msg, flush=True)


def split(larazen_domain, vendor_domain, apply_changes):
    # ── Preconditions ────────────────────────────────────────────────
    existing_vendor = Tenant.query.filter_by(slug=VENDOR_SLUG).first()
    larazen = Tenant.query.filter_by(slug=LARAZEN_SLUG).first()
    if existing_vendor is not None and larazen is not None:
        _log('already split: vendor=%s larazen=%s -- nothing to do'
             % (existing_vendor.id, larazen.id))
        return

    apex = Tenant.query.filter_by(is_platform=True).first()
    if apex is None:
        raise SystemExit(
            'No is_platform tenant found. Run the b1p2l3a4t5f6 migration first.'
        )
    if apex.slug == VENDOR_SLUG:
        raise SystemExit(
            'The is_platform tenant is already the vendor row, but no '
            '%r tenant exists. Refusing to guess -- inspect manually.'
            % LARAZEN_SLUG
        )

    plan = Plan.query.filter_by(code=LARAZEN_PLAN_CODE, owner_tenant_id=None).first()
    if plan is None:
        raise SystemExit(
            'Plan %r not found. Run scripts/create_larazen_plan.py first.'
            % LARAZEN_PLAN_CODE
        )

    # Only the apex's OWN platform owners move. Selecting on role alone
    # sweeps up any PLATFORM_OWNER sitting on a customer tenant and
    # re-homes it onto the vendor -- handing that user the entitlement
    # bypass and the whole control plane. In a clean database there are
    # none, which is exactly why an unscoped query looks correct right
    # up until it isn't.
    owners = User.query.filter_by(
        role=UserRole.PLATFORM_OWNER, is_deleted=False, tenant_id=apex.id,
    ).all()
    strays = User.query.filter(
        User.role == UserRole.PLATFORM_OWNER,
        User.is_deleted.is_(False),
        User.tenant_id != apex.id,
    ).all()
    if strays:
        for u in strays:
            _log('  ! PLATFORM_OWNER %s lives on tenant %s'
                 % (u.id, u.tenant_id))
        raise SystemExit(
            'Refusing to split: %d PLATFORM_OWNER user(s) live outside '
            'the apex tenant (listed above). Whether each is a mistake '
            'to demote or a real operator to re-home is a judgement '
            'call, so resolve them first.' % len(strays)
        )

    _log('apex tenant to convert : %s (%s)' % (apex.slug, apex.id))
    _log('  -> slug              : %s' % LARAZEN_SLUG)
    _log('  -> name              : %s' % LARAZEN_NAME)
    _log('  -> domain            : %s' % (larazen_domain or '(none)'))
    _log('  -> is_default        : True  -> False')
    _log('  -> is_platform       : True  -> False')
    _log('  -> plan              : %s (%s)' % (plan.code, plan.id))
    _log('new vendor tenant      : %s / %s' % (VENDOR_SLUG, VENDOR_NAME))
    _log('  -> domain            : %s' % (vendor_domain or '(none -- is_default fallback only)'))
    _log('platform owners to move: %d' % len(owners))
    for o in owners:
        _log('  - %s' % o.id)

    if not apply_changes:
        _log('')
        _log('DRY RUN -- nothing written. Re-run with --apply to commit.')
        return

    # ── 1. Convert the apex row in place ─────────────────────────────
    # Clear both flags BEFORE inserting the vendor row: the partial
    # unique indexes (ux_tenants_single_platform / _single_default)
    # allow only one true row each, and Postgres checks them per
    # statement, not per transaction.
    apex.slug = LARAZEN_SLUG
    apex.name = LARAZEN_NAME
    apex.is_default = False
    apex.is_platform = False
    apex.auto_subdomain = True
    if larazen_domain:
        apex.domain = larazen_domain
        # Mark it verified rather than issuing a TXT challenge. This
        # domain is the zone the tenant was already being served on
        # before the split -- ownership was never in question, and
        # leaving it 'pending' would make the tenant's own onboarding
        # report its live site as not yet reachable.
        apex.domain_verification_status = 'verified'
        apex.domain_verified_at = datetime.now(timezone.utc)
    db.session.flush()

    # ── 2. Create the vendor row ─────────────────────────────────────
    vendor = Tenant(
        id=uuid.uuid4(),
        name=VENDOR_NAME,
        slug=VENDOR_SLUG,
        status=TenantStatus.ACTIVE,
        is_default=True,
        is_platform=True,
        # The vendor sits on its own domain, not on a <slug>.<zone>
        # subdomain of the zone -- that zone belongs to Larazen.
        auto_subdomain=False,
    )
    if vendor_domain:
        # Give the vendor an explicit host. is_platform_host() resolves
        # the vendor by THIS column, so without it the vendor is only
        # reachable as the is_default catch-all: every unrecognised host
        # would serve its marketing site, and nothing would positively
        # identify the vendor's own domain.
        vendor.domain = vendor_domain
        vendor.domain_verification_status = 'verified'
        vendor.domain_verified_at = datetime.now(timezone.utc)
    db.session.add(vendor)
    db.session.flush()
    _log('created vendor tenant %s' % vendor.id)

    # ── 3. Move the platform owner(s) ────────────────────────────────
    # users is unique on (tenant_id, _phone_hash) / (tenant_id,
    # _email_hash), so re-homing the row cannot collide.
    for o in owners:
        o.tenant_id = vendor.id
    db.session.flush()

    # Their existing sessions were minted against the old tenant; revoke
    # so they re-authenticate on the vendor host rather than carrying a
    # token whose tenant claim no longer matches (the JWT-vs-host
    # invariant in app/__init__.py would scrub it anyway).
    revoked = 0
    try:
        from app.models.user import UserSession
        for o in owners:
            revoked += (
                UserSession.query
                .filter_by(user_id=o.id)
                .delete(synchronize_session=False)
            )
    except Exception as e:  # noqa: BLE001
        _log('  ! session revoke skipped: %s: %s' % (type(e).__name__, e))
    _log('moved %d platform owner(s), revoked %d session(s)'
         % (len(owners), revoked))

    # ── 4. Point Larazen at its real plan ────────────────────────────
    now = datetime.now(timezone.utc)
    sub = (
        TenantSubscription.query
        .filter_by(tenant_id=apex.id, is_deleted=False)
        .first()
    )
    if sub is None:
        sub = TenantSubscription(tenant_id=apex.id)
        db.session.add(sub)
    sub.plan_id = plan.id
    sub.status = SubscriptionStatus.ACTIVE
    sub.billing_cycle = BillingCycle.ANNUAL
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=365)
    sub.trial_ends_at = None
    sub.cancelled_at = None
    sub.over_limit_since = None
    sub.suspend_after = None
    _log('subscription -> %s (ACTIVE, annual)' % plan.code)

    db.session.commit()
    _log('')
    _log('split committed.')
    _log('  larazen : %s  (is_default=False, is_platform=False)' % apex.id)
    _log('  vendor  : %s  (is_default=True,  is_platform=True)' % vendor.id)
    _log('')
    _log('Larazen is now plan-gated. Verify with:')
    _log('  python scripts/verify_apex_split.py')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--apply', action='store_true',
        help='commit the split (default is a dry run)',
    )
    ap.add_argument(
        '--larazen-domain', default='larazen.localhost',
        help='custom domain to give the converted Larazen tenant so it is '
             'reachable by host (default: larazen.localhost)',
    )
    ap.add_argument(
        '--vendor-domain', default=None,
        help="the SaaS vendor's own domain. Required in production: the "
             'vendor is identified by this column, not by the DNS zone '
             'apex, which stays with Larazen',
    )
    args = ap.parse_args()

    app = create_app()
    with app.app_context():
        split(args.larazen_domain, args.vendor_domain, args.apply)


if __name__ == '__main__':
    main()
