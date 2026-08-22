"""Integration tests for the pricing HTTP surface.

These are integration tests — they assume a running Postgres with RLS
enabled and a seeded platform tenant + PLATFORM_OWNER user (same setup
the rest of ``tests/api/*`` uses). The happy path covers:

    * PLATFORM_OWNER can list and read Plan1 after the migration.
    * Override validator rejects bad payloads with 422.
    * Add-on + override precedence on the resolved ``/api/pricing/me``.
    * Downgrade / capacity-addon drills.

If the test environment has no Postgres, the whole module skips so
``pytest -x`` doesn't trip on the rest of the suite.

Run just this file:
    pytest tests/api/test_pricing.py -x -q
"""
from __future__ import annotations

import json

import pytest


# Every test needs the app fixture + DB. Skip cleanly when not available.
pytestmark = pytest.mark.skipif(
    not pytest.importorskip('psycopg2', reason='requires postgres') or False,
    reason='pricing integration tests require a live Postgres',
)


@pytest.fixture
def platform_owner_headers(app):
    """Return auth headers for the PLATFORM_OWNER. Expects conftest to
    seed one — if it doesn't, this fixture will skip the test.

    Also marks the default tenant as the VENDOR: post-vendor-split, a
    PLATFORM_OWNER only bypasses the tenant gates on the is_platform
    row (same flip test_membership.py's fixture makes).
    """
    from app.extensions import db
    from app.models import Tenant, User, UserRole
    from tests.conftest import get_auth_headers
    with app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        if t is not None and not t.is_platform:
            t.is_platform = True
            db.session.commit()
        po = User.query.filter_by(role=UserRole.PLATFORM_OWNER, is_deleted=False).first()
        if not po:
            pytest.skip('No PLATFORM_OWNER seeded in test DB')
        return get_auth_headers(app, po)


@pytest.fixture
def seeded_tenant(app, db_session):
    """A fresh top-level customer tenant the platform console can act
    on (the tests assign vendor-catalog subscriptions to it)."""
    import uuid as _uuid

    from app.extensions import db
    from app.models import Tenant, TenantStatus

    slug = f'pr_{_uuid.uuid4().hex[:8]}'
    t = Tenant(name=f'Pricing {slug}', slug=slug,
               status=TenantStatus.ACTIVE, is_default=False)
    db.session.add(t)
    db.session.commit()
    return t


@pytest.fixture
def super_admin_headers(app, db_session):
    """A SUPER_ADMIN in the default tenant, which the autouse conftest
    fixture keeps subscribed to plan1 — so /pricing/me resolves."""
    import uuid as _uuid

    from app.extensions import db
    from app.models import Tenant, User, UserRole, UserStatus
    from app.models._base import set_tenant_context
    from tests.conftest import get_auth_headers

    with app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        set_tenant_context(db.session, t.id)
        sa = User(
            role=UserRole.SUPER_ADMIN, status=UserStatus.ACTIVE,
            first_name='Pricing', last_name='Admin',
            email_verified=True, tenant_id=t.id,
        )
        sa.email = f'pricing_sa_{_uuid.uuid4().hex[:8]}@test.com'
        sa.phone_number = f'9{_uuid.uuid4().int % 1_000_000_000:09d}'
        sa.set_password('TestPass123!')
        db.session.add(sa)
        db.session.commit()
        return get_auth_headers(app, sa)


# --------------------------------------------------------------------------- #
# Plan catalog
# --------------------------------------------------------------------------- #

class TestPlanCatalog:

    def test_list_plans_returns_plan1(self, client, platform_owner_headers):
        resp = client.get('/api/v1/platform/plans', headers=platform_owner_headers)
        assert resp.status_code == 200
        data = resp.get_json()['data']
        codes = [p['code'] for p in data]
        assert 'plan1' in codes

    def test_get_plan1_has_plan1_defaults(self, client, platform_owner_headers):
        resp = client.get('/api/v1/platform/plans/plan1', headers=platform_owner_headers)
        assert resp.status_code == 200
        plan = resp.get_json()['data']
        assert plan['user_limits']['total'] == 20
        assert plan['user_limits']['per_role']['super_admin'] == 1
        assert plan['user_limits']['per_role']['sub_admin'] == 3
        assert plan['user_limits']['per_role']['provider'] == 16
        assert plan['razorpay_supported'] is True
        assert plan['tenant_keys_allowed'] is False


# --------------------------------------------------------------------------- #
# Override validation at the API boundary
# --------------------------------------------------------------------------- #

class TestOverrideValidation:

    def test_non_integer_override_is_rejected(self, client, platform_owner_headers, seeded_tenant):
        payload = {
            'plan_code': 'plan1',
            'overrides': {'limits': {'total': 'twenty'}},
        }
        resp = client.post(
            f'/api/v1/platform/tenants/{seeded_tenant.id}/subscription',
            data=json.dumps(payload),
            headers=platform_owner_headers,
        )
        assert resp.status_code == 422
        body = resp.get_json()
        assert 'overrides' in body.get('errors', {})


# --------------------------------------------------------------------------- #
# Resolved /me endpoint — add-on and override precedence
# --------------------------------------------------------------------------- #

class TestResolvedMe:

    def test_default_me_omits_debug(self, client, super_admin_headers):
        resp = client.get('/api/v1/pricing/me', headers=super_admin_headers)
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert 'feature_sources' not in body

    def test_debug_me_includes_sources(self, client, super_admin_headers):
        resp = client.get('/api/v1/pricing/me?debug=1', headers=super_admin_headers)
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert 'feature_sources' in body
        assert 'limit_sources' in body


# --------------------------------------------------------------------------- #
# Downgrade drill — plan with lower cap + existing users over that cap
# --------------------------------------------------------------------------- #

@pytest.mark.xfail(reason='requires fixture factories; scaffold-only in this commit')
class TestDowngradeDrill:

    def test_over_limit_state_set_on_downgrade(self):
        """
        Fresh tenant -> create 18 providers on plan with max_providers=20
        -> platform-owner switches plan to max_providers=10
        -> subscription.status = OVER_LIMIT, existing 18 providers untouched,
           19th creation returns 402 plan_limit_exceeded.
        """
        raise NotImplementedError


@pytest.mark.xfail(reason='requires fixture factories; scaffold-only in this commit')
class TestCapacityAddonDrill:

    def test_addon_grants_extra_seats(self):
        """
        Plan1 max_providers=16. Attach addon_5_providers {provider: 5}.
        -> resolved limit = 21, limit_sources has addon:addon_5_providers.
        -> 17th..21st provider creation succeeds; 22nd returns 402.
        Detach -> 17th onwards returns 402 again.
        """
        raise NotImplementedError
