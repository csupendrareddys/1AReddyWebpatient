"""Verify the apex split actually took, and that Larazen is really gated.

The whole point of the split is that Larazen stops being exempt. A split
that "succeeded" but left Larazen sailing through every gate is a failed
split, so this checks entitlement outcomes, not just row flags.

Read-only. Exits non-zero if any check fails.
"""
import sys

from app import create_app
from app.extensions import db
from app.models import Tenant
from app.api.pricing.service import (
    PlanService, FeatureGate, MarketplacePolicy, ALLOWED_FEATURE_PATHS,
)

FAILURES = []


def check(label, actual, expected):
    ok = actual == expected
    print('  [%s] %-52s got=%r want=%r'
          % ('PASS' if ok else 'FAIL', label, actual, expected))
    if not ok:
        FAILURES.append(label)
    return ok


def main():
    app = create_app()
    with app.app_context():
        vendor = Tenant.query.filter_by(slug='vendor').first()
        larazen = Tenant.query.filter_by(slug='larazen').first()

        print('== rows ==')
        if vendor is None or larazen is None:
            print('  FAIL: expected both a "vendor" and a "larazen" tenant; '
                  'got vendor=%r larazen=%r' % (vendor, larazen))
            sys.exit(1)
        check('vendor.is_platform', vendor.is_platform, True)
        check('vendor.is_default', vendor.is_default, True)
        check('larazen.is_platform', larazen.is_platform, False)
        check('larazen.is_default', larazen.is_default, False)

        print('== larazen is on a real plan ==')
        resolved = PlanService.resolve(larazen.id)
        check('plan_code', resolved.plan_code, 'larazen-ops')

        limits = dict(resolved.limits or {})
        print('  limits: %r' % limits)
        unlimited = [k for k, v in limits.items() if v == -1]
        check('no unlimited (-1) limits', unlimited, [])

        counts = PlanService.current_counts(larazen.id)
        print('  actual seats: %r' % counts)
        for key in ('super_admin', 'sub_admin', 'provider', 'total'):
            if key in limits:
                ok = counts[key] <= limits[key]
                print('  [%s] seats fit: %-12s %d <= %d'
                      % ('PASS' if ok else 'FAIL', key, counts[key], limits[key]))
                if not ok:
                    FAILURES.append('seats fit: %s' % key)

        print('== larazen is genuinely gated (the decisive check) ==')
        # Granted -> True; withheld -> False. If the withheld path comes
        # back True, a bypass is still firing somewhere.
        check('granted   patient.family',
              FeatureGate.is_enabled(larazen.id, 'patient.family'), True)
        check('granted   consultation.video',
              FeatureGate.is_enabled(larazen.id, 'consultation.video'), True)
        check('WITHHELD  consultation.in_person',
              FeatureGate.is_enabled(larazen.id, 'consultation.in_person'), False)
        check('WITHHELD  admin.page_configuration',
              FeatureGate.is_enabled(larazen.id, 'admin.page_configuration'), False)
        check('WITHHELD  payments.tenant_keys',
              FeatureGate.is_enabled(larazen.id, 'payments.tenant_keys'), False)

        granted = [p for p in ALLOWED_FEATURE_PATHS
                   if FeatureGate.is_enabled(larazen.id, p)]
        print('  larazen grants %d / %d feature paths'
              % (len(granted), len(ALLOWED_FEATURE_PATHS)))
        ok = len(granted) < len(ALLOWED_FEATURE_PATHS)
        print('  [%s] larazen does NOT have every feature'
              % ('PASS' if ok else 'FAIL'))
        if not ok:
            FAILURES.append('larazen still has every feature')

        print('== marketplace still routes to larazen ==')
        check('larazen runs marketplace',
              MarketplacePolicy.runs_marketplace(larazen.id, 'doctor'), True)

        print('== vendor still bypasses ==')
        check('vendor bypasses feature gate',
              FeatureGate.is_enabled(vendor.id, 'payments.tenant_keys'), True)

        print('== host resolution ==')
        # vertical_plan_types is tenant-scoped: larazen has the seeded
        # four, the brand-new vendor row has none. That difference is a
        # clean, auth-free discriminator for which tenant a host resolved.
        # Probe the hosts each tenant ACTUALLY claims (its custom domain,
        # falling back to the local-dev subdomain) so the check is valid
        # on the deployed boxes, not just a local stack.
        client = app.test_client()
        for host, label, expect_nonempty in (
            (larazen.domain or 'larazen.localhost', 'larazen host', True),
            (vendor.domain or 'localhost', 'apex/vendor host', False),
        ):
            r = client.get('/api/v1/public/vertical-plan-types',
                           headers={'Host': host})
            body = r.get_json() or {}
            data = body.get('data') or []
            n = len(data) if isinstance(data, list) else 0
            ok = (n > 0) == expect_nonempty
            print('  [%s] %-18s host=%-18s status=%s verticals=%d'
                  % ('PASS' if ok else 'FAIL', label, host, r.status_code, n))
            if not ok:
                FAILURES.append('host resolution: %s' % label)

    print('')
    if FAILURES:
        print('FAILED (%d): %s' % (len(FAILURES), ', '.join(FAILURES)))
        sys.exit(1)
    print('all checks passed')


if __name__ == '__main__':
    main()
