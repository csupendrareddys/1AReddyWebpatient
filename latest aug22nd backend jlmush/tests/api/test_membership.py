"""Integration tests for the marketplace membership HTTP surface.

Covers Round 1 — admin catalog CRUD + public read.

    * PLATFORM_OWNER can create / list / get / update / archive a
      MembershipPlan via ``/api/platform/membership-plans``.
    * Validator rejects bad payloads with 422.
    * Public ``/api/public/membership-plans`` returns ACTIVE-only,
      ordered by (vertical, sort_order, tier), with optional
      ``?vertical=`` filter.
    * Partial unique on ``(vertical, tier)`` is enforced — second
      ``doctor/basic`` create returns 409.
    * Status enum is uppercase in DB (regression test for the CI
      bootstrap failure that produced
      ``invalid input value for enum membershipsubscriptionstatus:
      "trial"``).

Skipped cleanly when no Postgres is available.
"""
from __future__ import annotations

import json
import uuid

import pytest


pytestmark = pytest.mark.skipif(
    not pytest.importorskip('psycopg2', reason='requires postgres') or False,
    reason='membership integration tests require a live Postgres',
)


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture
def platform_owner_user(app, db_session):
    """Create a PLATFORM_OWNER user anchored to the platform tenant.

    Idempotent: if one already exists (seeded by a prior test or by the
    conftest default-tenant fixture), reuse it. Otherwise create one.

    Runs on ``db_session``'s already-pushed app context and deliberately
    does NOT open a nested ``app.app_context()``. Flask-SQLAlchemy
    scopes ``db.session`` to the app context and removes it on
    teardown, so a User built inside a nested context comes back
    DETACHED — and the ``commit()`` below expires its attributes, so
    the first read in :func:`get_auth_headers` raises
    ``DetachedInstanceError``. That only bites on an EMPTY database:
    when rows already exist the early-return path hands back a
    freshly-loaded (unexpired) instance, which survives detachment
    unharmed. Hence "passes locally, errors on fresh CI". Mirrors the
    ``sample_patient`` / ``sample_doctor`` pattern in conftest.
    """
    from app.models import Tenant, User, UserRole, UserStatus
    from app.extensions import db

    # Post-vendor-split: PLATFORM_OWNER only bypasses the tenant
    # gates when the resolved tenant is the VENDOR (is_platform).
    # The conftest default tenant models "where anonymous requests
    # land", which is a separate flag — mark it as the vendor here
    # (mirrors production, where the vendor row is the default one
    # today) or every /platform call 403s "requires an active
    # support session".
    platform = Tenant.query.filter_by(is_default=True).first()
    assert platform, 'session fixture must seed a default tenant'
    if not platform.is_platform:
        platform.is_platform = True
        db.session.commit()

    po = User.query.filter_by(
        role=UserRole.PLATFORM_OWNER, is_deleted=False,
    ).first()
    if po:
        return po

    from app.models._base import set_tenant_context
    set_tenant_context(db.session, platform.id)

    po = User(
        role=UserRole.PLATFORM_OWNER,
        status=UserStatus.ACTIVE,
        first_name='Platform',
        last_name='Owner',
        email_verified=True,
        tenant_id=platform.id,
    )
    po.email = f'platform_owner_{uuid.uuid4().hex[:8]}@test.com'
    po.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    po.set_password('TestPass123!')
    db.session.add(po)
    db.session.commit()
    return po


@pytest.fixture
def platform_owner_headers(app, platform_owner_user):
    from tests.conftest import get_auth_headers
    return get_auth_headers(app, platform_owner_user)


@pytest.fixture
def fresh_plan_code():
    """Random code so parallel tests don't collide on the unique-code
    constraint. The ``(vertical, tier)`` partial-unique is enforced
    inside each test."""
    return f'doctor_starter_{uuid.uuid4().hex[:6]}'


@pytest.fixture(autouse=True)
def _seed_vertical_plan_types(app, db_session):
    """MembershipPlan's ``vertical`` string became the tenant-scoped
    ``vertical_plan_type_id`` FK; VerticalPlanType rows are seeded by
    scripts (not migrations/create_all), so the test DB starts with
    none. Ensure the default tenant has the base three; payloads use
    :func:`_vpt_id` to reference them."""
    from app.extensions import db
    from app.models import Tenant
    from app.models.membership import VerticalPlanType

    with app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        if t is None:
            yield
            return
        for code, name in (('doctor', 'Doctor'), ('clinic', 'Clinic'),
                           ('hospital', 'Hospital')):
            exists = VerticalPlanType.query.filter_by(
                tenant_id=t.id, code=code).first()
            if exists is None:
                db.session.add(VerticalPlanType(
                    tenant_id=t.id, code=code, name=name))
        db.session.commit()
    yield


def _vpt_id(code):
    """Id of the default tenant's VerticalPlanType ``code`` (seeded by
    the autouse fixture above). Runs inside the conftest-held app
    context, so plain queries work from test bodies."""
    from app.models import Tenant
    from app.models.membership import VerticalPlanType

    t = Tenant.query.filter_by(is_default=True).first()
    row = VerticalPlanType.query.filter_by(tenant_id=t.id, code=code).first()
    assert row is not None, f'vertical plan type {code!r} not seeded'
    return str(row.id)


def _default_tenant_id():
    """The default tenant's id as str — the g.tenant_id shim for
    service-layer calls (tenant autofill + rail resolution read g,
    which a freshly pushed app context does not carry)."""
    from app.models import Tenant
    return str(Tenant.query.filter_by(is_default=True).first().id)


# --------------------------------------------------------------------------- #
# Admin CRUD
# --------------------------------------------------------------------------- #

class TestMembershipPlanAdminCrud:

    def test_list_empty_initially(self, client, platform_owner_headers):
        resp = client.get(
            '/api/v1/platform/membership-plans',
            headers=platform_owner_headers,
        )
        # Either zero plans (fresh DB) or some — both fine. The shape
        # must be a list either way.
        assert resp.status_code == 200
        assert isinstance(resp.get_json().get('data'), list)

    def test_create_valid_plan(
        self, client, platform_owner_headers, fresh_plan_code,
    ):
        payload = {
            'code': fresh_plan_code,
            'name': 'Doctor Starter',
            'description': 'Solo doctor starting digital.',
            'vertical_plan_type_id': _vpt_id('doctor'),
            'tier': 'basic',
            'price_inr_monthly': 0,
            'trial_days': 14,
            'features': {'bullets': ['Basic EHR', 'Visit history']},
        }
        resp = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps(payload),
            headers=platform_owner_headers,
        )
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()['data']
        assert body['code'] == fresh_plan_code
        assert body['vertical_plan_type']['code'] == 'doctor'
        assert body['tier'] == 'basic'
        # Server-side default: creates always start as draft.
        assert body['status'] == 'draft'

    def test_create_rejects_missing_required_fields(
        self, client, platform_owner_headers,
    ):
        resp = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({'code': 'x_only'}),
            headers=platform_owner_headers,
        )
        assert resp.status_code == 422
        body = resp.get_json()
        # Validator returns a structured ``errors`` dict; ``missing``
        # bucket holds the omitted required-field names.
        assert 'errors' in body or 'data' in body

    def test_create_rejects_missing_vertical_plan_type(
        self, client, platform_owner_headers,
    ):
        """Verticals became tenant-defined FK rows — there is no closed
        enum to reject against anymore. What the validator DOES require
        is the ``vertical_plan_type_id`` itself."""
        payload = {
            'code': f'bad_vert_{uuid.uuid4().hex[:6]}',
            'name': 'Bad',
            'tier': 'basic',
        }
        resp = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps(payload),
            headers=platform_owner_headers,
        )
        assert resp.status_code == 422
        errors = resp.get_json().get('errors', {})
        assert 'vertical_plan_type_id' in errors.get('missing', errors)

    def test_duplicate_code_returns_409(
        self, client, platform_owner_headers, fresh_plan_code,
    ):
        payload = {
            'code': fresh_plan_code,
            'name': 'Doctor Starter',
            'vertical_plan_type_id': _vpt_id('doctor'),
            'tier': 'basic',
        }
        first = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps(payload),
            headers=platform_owner_headers,
        )
        assert first.status_code == 201

        # Second create with the same code, different (vertical, tier)
        # to isolate the code-uniqueness check.
        dup = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({**payload, 'tier': 'growth'}),
            headers=platform_owner_headers,
        )
        assert dup.status_code == 409

    def test_multiple_plans_per_vertical_tier_allowed(
        self, client, platform_owner_headers,
    ):
        """Round 8.5: the platform owner can author N plans per
        (vertical, tier). The old partial-unique index +
        409-pre-flight on (vertical, tier) were dropped — only the
        ``code`` column carries a uniqueness constraint."""
        suffix = uuid.uuid4().hex[:6]
        first = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': f'plan_a_{suffix}', 'name': 'A',
                'vertical_plan_type_id': _vpt_id('clinic'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        assert first.status_code == 201

        # Different code, same (vertical, tier) — used to 409, now 201.
        sibling = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': f'plan_b_{suffix}', 'name': 'B',
                'vertical_plan_type_id': _vpt_id('clinic'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        assert sibling.status_code == 201, sibling.get_json()

    def test_update_flips_status(
        self, client, platform_owner_headers, fresh_plan_code,
    ):
        # Create draft, then PUT status=active. Mirrors the
        # clickable-chip flow in the admin UI.
        create = client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': fresh_plan_code, 'name': 'X',
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        assert create.status_code == 201
        assert create.get_json()['data']['status'] == 'draft'

        update = client.put(
            f'/api/v1/platform/membership-plans/{fresh_plan_code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )
        assert update.status_code == 200
        assert update.get_json()['data']['status'] == 'active'

    def test_update_rejects_invalid_commission_pct(
        self, client, platform_owner_headers, fresh_plan_code,
    ):
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': fresh_plan_code, 'name': 'X',
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        bad = client.put(
            f'/api/v1/platform/membership-plans/{fresh_plan_code}',
            data=json.dumps({'commission_pct': 150}),  # > 100
            headers=platform_owner_headers,
        )
        assert bad.status_code == 422

    def test_archive_soft_deletes(
        self, client, platform_owner_headers, fresh_plan_code,
    ):
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': fresh_plan_code, 'name': 'X',
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        archive = client.delete(
            f'/api/v1/platform/membership-plans/{fresh_plan_code}',
            headers=platform_owner_headers,
        )
        assert archive.status_code == 204

        # After archive, GET returns 404 (soft-deleted rows are
        # excluded from the catalog read path).
        gone = client.get(
            f'/api/v1/platform/membership-plans/{fresh_plan_code}',
            headers=platform_owner_headers,
        )
        assert gone.status_code == 404

    def test_get_unknown_returns_404(
        self, client, platform_owner_headers,
    ):
        resp = client.get(
            '/api/v1/platform/membership-plans/does_not_exist_xxx',
            headers=platform_owner_headers,
        )
        assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #

class TestMembershipPlanAuth:

    def test_anonymous_admin_endpoint_returns_401(self, client):
        # No headers → @jwt_required hits first → 401.
        resp = client.get('/api/v1/platform/membership-plans')
        assert resp.status_code in (401, 422)  # 422 if JWT lib rejects shape

    def test_super_admin_allowed_doctor_blocked(
        self, app, client, db_session,
    ):
        """Membership plans became TENANT-scoped: the catalog routes now
        deliberately allow SUPER_ADMIN/SUB_ADMIN (a tenant authors its
        own plans). The wall that remains is against non-admin roles —
        a DOCTOR must still 403."""
        from app.models import Tenant, User, UserRole, UserStatus
        from app.models._base import set_tenant_context
        from app.extensions import db
        from tests.conftest import get_auth_headers

        with app.app_context():
            platform = Tenant.query.filter_by(is_default=True).first()
            set_tenant_context(db.session, platform.id)
            users = {}
            for role, tag in ((UserRole.SUPER_ADMIN, 'sa'),
                              (UserRole.DOCTOR, 'doc')):
                u = User(
                    role=role,
                    status=UserStatus.ACTIVE,
                    first_name='Auth', last_name='Probe',
                    email_verified=True, tenant_id=platform.id,
                )
                u.email = f'{tag}_{uuid.uuid4().hex[:8]}@test.com'
                u.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
                u.set_password('TestPass123!')
                db.session.add(u)
                db.session.commit()
                users[tag] = get_auth_headers(app, u)

        resp = client.get(
            '/api/v1/platform/membership-plans', headers=users['sa'],
        )
        assert resp.status_code == 200

        resp = client.get(
            '/api/v1/platform/membership-plans', headers=users['doc'],
        )
        assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# Public read
# --------------------------------------------------------------------------- #

class TestMembershipPlanPublicRead:

    def test_public_endpoint_returns_only_active(
        self, client, platform_owner_headers,
    ):
        suffix = uuid.uuid4().hex[:6]
        # Create one draft + one active. Draft must NOT appear in
        # public listing.
        for tier, code, status in (
            ('basic', f'pub_draft_{suffix}', 'draft'),
            ('growth', f'pub_active_{suffix}', 'active'),
        ):
            client.post(
                '/api/v1/platform/membership-plans',
                data=json.dumps({
                    'code': code, 'name': code,
                    'vertical_plan_type_id': _vpt_id('doctor'), 'tier': tier,
                }),
                headers=platform_owner_headers,
            )
            if status == 'active':
                client.put(
                    f'/api/v1/platform/membership-plans/{code}',
                    data=json.dumps({'status': 'active'}),
                    headers=platform_owner_headers,
                )

        resp = client.get('/api/v1/public/membership-plans')
        assert resp.status_code == 200
        plans = resp.get_json()['data']['plans']
        codes = [p['code'] for p in plans]
        assert f'pub_active_{suffix}' in codes
        assert f'pub_draft_{suffix}' not in codes

    def test_public_endpoint_vertical_filter(
        self, client, platform_owner_headers,
    ):
        suffix = uuid.uuid4().hex[:6]
        for vertical, tier in (
            ('doctor', 'pro'),
            ('hospital', 'pro'),
        ):
            code = f'vfilt_{vertical}_{suffix}'
            client.post(
                '/api/v1/platform/membership-plans',
                data=json.dumps({
                    'code': code, 'name': code,
                    'vertical_plan_type_id': _vpt_id(vertical), 'tier': tier,
                }),
                headers=platform_owner_headers,
            )
            client.put(
                f'/api/v1/platform/membership-plans/{code}',
                data=json.dumps({'status': 'active'}),
                headers=platform_owner_headers,
            )

        resp = client.get('/api/v1/public/membership-plans?vertical=hospital')
        assert resp.status_code == 200
        plans = resp.get_json()['data']['plans']
        # Every returned plan is a hospital plan; we may have other
        # hospital plans from other tests so don't assert exact match —
        # just verticality and that our hospital plan is present.
        for p in plans:
            assert p['vertical_plan_type']['code'] == 'hospital'
        codes = [p['code'] for p in plans]
        assert f'vfilt_hospital_{suffix}' in codes
        assert f'vfilt_doctor_{suffix}' not in codes

    def test_public_endpoint_strips_internal_fields(
        self, client, platform_owner_headers,
    ):
        code = f'strip_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': code,
                'vertical_plan_type_id': _vpt_id('clinic'), 'tier': 'basic',
                'commission_pct': 12.5,
                'platform_fee_inr': 25,
            }),
            headers=platform_owner_headers,
        )
        client.put(
            f'/api/v1/platform/membership-plans/{code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )
        resp = client.get('/api/v1/public/membership-plans?vertical=clinic')
        plans = resp.get_json()['data']['plans']
        match = next((p for p in plans if p['code'] == code), None)
        assert match is not None
        # Operator-knob fields stay server-side only.
        assert 'commission_pct' not in match
        assert 'platform_fee_inr' not in match

    def test_public_endpoint_unknown_vertical_returns_empty(self, client):
        """Verticals are tenant-defined rows now, not a closed enum —
        an unknown code is simply a filter that matches nothing."""
        resp = client.get('/api/v1/public/membership-plans?vertical=alien')
        assert resp.status_code == 200
        assert resp.get_json()['data']['plans'] == []


# --------------------------------------------------------------------------- #
# Schema regression — enum literals in partial-index must be uppercase.
# --------------------------------------------------------------------------- #

class TestSchemaRegression:
    """Locks down the bug that broke CI first time round:

        invalid input value for enum membershipsubscriptionstatus: "trial"
        LINE 1: …WHERE is_deleted = false AND status IN ('trial', 'active')

    SQLAlchemy's ``db.Enum(PyEnum)`` stores Python member NAMES
    (uppercase). The partial-unique index on
    ``membership_subscriptions`` referenced lowercase literals which
    don't exist in the Postgres enum, so ``db.create_all()`` blew up
    on first-time bootstrap. The fix in
    ``Backend/app/models/membership.py`` switches the index predicate
    to ``IN ('TRIAL', 'ACTIVE')``. This test inspects the model's
    table-args to make sure that fix doesn't regress.
    """

    def test_subscriptions_partial_index_uses_uppercase_enum_values(self):
        from app.models.membership import MembershipSubscription
        from sqlalchemy import Index

        unique_indexes = [
            ix for ix in MembershipSubscription.__table_args__
            if isinstance(ix, Index) and getattr(ix, 'unique', False)
        ]
        assert unique_indexes, 'expected at least one unique partial index'
        clauses = [
            str(ix.dialect_options.get('postgresql', {}).get('where', ''))
            for ix in unique_indexes
        ]
        # At least one of the unique indexes must filter by uppercase
        # TRIAL / ACTIVE — those are the Postgres enum values.
        assert any(
            "'TRIAL'" in c and "'ACTIVE'" in c
            for c in clauses
        ), f'partial-index predicates: {clauses}'
        assert not any(
            "'trial'" in c or "'active'" in c
            for c in clauses
        ), (
            'partial-index predicate uses lowercase enum literals — '
            'will break db.create_all() bootstrap'
        )


# --------------------------------------------------------------------------- #
# Round 2 — MembershipSubscriptionService (provider-facing)
# --------------------------------------------------------------------------- #
# Exercises the service layer directly. We hit the API for the
# ``/api/membership/me`` read but use the service for the PENDING →
# TRIAL transition because simulating the multipart doctor signup +
# OTP tokens through the HTTP surface is fragile (S3 stubs, SMS
# stubs, encryption salt, …). The signup integration is verified
# manually via the smoke run in the plan's Verification section.
# --------------------------------------------------------------------------- #

@pytest.fixture
def active_doctor_plan(app, db_session, platform_owner_headers, client):
    """Create + activate a doctor-vertical plan and return its code.

    Uses the admin API so the result mirrors what the platform owner
    would author in production.
    """
    code = f'doctor_starter_{uuid.uuid4().hex[:6]}'
    client.post(
        '/api/v1/platform/membership-plans',
        data=json.dumps({
            'code': code,
            'name': 'Doctor Starter (test)',
            'vertical_plan_type_id': _vpt_id('doctor'),
            'tier': 'basic',
            'price_inr_monthly': 0,
            'trial_days': 14,
            'features': {'bullets': ['Basic EHR', 'Visit history']},
        }),
        headers=platform_owner_headers,
    )
    client.put(
        f'/api/v1/platform/membership-plans/{code}',
        data=json.dumps({'status': 'active'}),
        headers=platform_owner_headers,
    )
    return code


@pytest.fixture
def doctor_user(app, db_session):
    """Create a Doctor + User in the platform tenant.

    Bypasses the multipart signup pipeline so the test stays focused
    on the membership-subscription side. The User is left in PENDING
    status (matches what the real signup creates pre-approval).
    """
    from app.extensions import db
    from app.models import (
        Doctor, Tenant, User, UserRole, UserStatus,
        UserVerificationStatus,
    )
    from app.models._base import set_tenant_context

    if True:  # ambient conftest app context; a nested one would detach the returned ORM rows on exit
        platform = Tenant.query.filter_by(is_default=True).first()
        set_tenant_context(db.session, platform.id)

        user = User(
            role=UserRole.DOCTOR,
            status=UserStatus.PENDING,
            first_name='Test', last_name='Doctor',
            email_verified=True,
            tenant_id=platform.id,
        )
        user.email = f'doc_{uuid.uuid4().hex[:8]}@test.com'
        user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
        user.set_password('TestPass123!')
        db.session.add(user)
        db.session.flush()

        doctor = Doctor(
            user_id=user.id,
            tenant_id=platform.id,
            # name fields live on User now (read-only properties here);
            # cert/aadhar columns became NOT NULL.
            registration_number=f'REG{uuid.uuid4().hex[:8].upper()}',
            registration_certificate='test/reg-cert.pdf',
            aadhar_number=f'{uuid.uuid4().int % 10**12:012d}',
            aadhar_attachment='test/aadhar.pdf',
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(doctor)
        db.session.commit()
        return user, doctor


class TestMembershipSubscriptionService:

    def test_create_pending_for_doctor_happy_path(
        self, app, doctor_user, active_doctor_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=active_doctor_plan,
            )
            assert sub.status == MembershipSubscriptionStatus.PENDING
            assert sub.trial_ends_at is None
            assert sub.current_period_start is None

    def test_create_pending_rejects_inactive_plan(
        self, app, doctor_user, platform_owner_headers, client,
    ):
        # Create a DRAFT plan; service must refuse to subscribe.
        from app.api.membership.service import (
            MembershipPlanInactive, MembershipSubscriptionService,
        )

        user, doctor = doctor_user
        code = f'draft_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': code,
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(MembershipPlanInactive):
                MembershipSubscriptionService.create_pending_for_doctor(
                    doctor_id=doctor.id,
                    user_id=user.id,
                    plan_code=code,
                )

    def test_create_pending_rejects_wrong_vertical(
        self, app, doctor_user, platform_owner_headers, client,
    ):
        from app.api.membership.service import (
            MembershipPlanWrongVertical, MembershipSubscriptionService,
        )

        user, doctor = doctor_user
        code = f'clinic_basic_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': 'Clinic Basic (test)',
                'vertical_plan_type_id': _vpt_id('clinic'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        client.put(
            f'/api/v1/platform/membership-plans/{code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(MembershipPlanWrongVertical):
                MembershipSubscriptionService.create_pending_for_doctor(
                    doctor_id=doctor.id,
                    user_id=user.id,
                    plan_code=code,
                )

    def test_create_pending_rejects_unknown_plan(
        self, app, doctor_user,
    ):
        from app.api.membership.service import (
            MembershipPlanNotFound, MembershipSubscriptionService,
        )

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(MembershipPlanNotFound):
                MembershipSubscriptionService.create_pending_for_doctor(
                    doctor_id=doctor.id,
                    user_id=user.id,
                    plan_code='does_not_exist_xxx',
                )

    def test_create_pending_blocks_duplicate(
        self, app, doctor_user, active_doctor_plan,
    ):
        from app.api.membership.service import (
            MembershipAlreadyExists, MembershipSubscriptionService,
        )

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=active_doctor_plan,
            )
            with pytest.raises(MembershipAlreadyExists):
                MembershipSubscriptionService.create_pending_for_doctor(
                    doctor_id=doctor.id,
                    user_id=user.id,
                    plan_code=active_doctor_plan,
                )

    def test_activate_trial_starts_clock(
        self, app, doctor_user, active_doctor_plan,
    ):
        from datetime import timedelta
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=active_doctor_plan,
            )
            assert sub.status == MembershipSubscriptionStatus.PENDING

            MembershipSubscriptionService.activate_trial(sub)
            assert sub.status == MembershipSubscriptionStatus.TRIAL
            assert sub.trial_ends_at is not None
            assert sub.current_period_start is not None
            # Trial window should be exactly 14 days from start
            # (per the plan fixture). Allow 1-second slop for the
            # ``_now()`` calls being a hair apart.
            window = sub.trial_ends_at - sub.current_period_start
            assert abs(window - timedelta(days=14)) < timedelta(seconds=2)

    def test_activate_trial_is_idempotent(
        self, app, doctor_user, active_doctor_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=active_doctor_plan,
            )
            MembershipSubscriptionService.activate_trial(sub)
            first_end = sub.trial_ends_at

            # Second call must NOT re-stamp trial_ends_at — admin can
            # re-fire approval (manual edits, etc.) and we don't want
            # the trial clock to reset.
            MembershipSubscriptionService.activate_trial(sub)
            assert sub.trial_ends_at == first_end
            assert sub.status == MembershipSubscriptionStatus.TRIAL

    def test_zero_trial_days_plan_goes_straight_to_active(
        self, app, doctor_user, platform_owner_headers, client,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, doctor = doctor_user
        code = f'doctor_growth_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': code,
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'growth',
                'trial_days': 0,
            }),
            headers=platform_owner_headers,
        )
        client.put(
            f'/api/v1/platform/membership-plans/{code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )

        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=code,
            )
            MembershipSubscriptionService.activate_trial(sub)
            # No trial → ACTIVE, not TRIAL.
            assert sub.status == MembershipSubscriptionStatus.ACTIVE
            assert sub.trial_ends_at is None


class TestMembershipMeEndpoint:

    def test_anonymous_request_returns_401(self, client):
        resp = client.get('/api/v1/membership/me')
        assert resp.status_code in (401, 422)

    def test_user_without_subscription_returns_404(
        self, app, client, doctor_user,
    ):
        from tests.conftest import get_auth_headers
        user, _ = doctor_user
        # Doctor must be ACTIVE for session lookup to succeed —
        # tweak status just for the JWT round-trip.
        from app.extensions import db
        from app.models import UserStatus
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            user.status = UserStatus.ACTIVE
            db.session.commit()
            headers = get_auth_headers(app, user)
        resp = client.get('/api/v1/membership/me', headers=headers)
        assert resp.status_code == 404

    def test_me_returns_joined_subscription_and_plan(
        self, app, client, doctor_user, active_doctor_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.extensions import db
        from app.models import UserStatus
        from tests.conftest import get_auth_headers

        user, doctor = doctor_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_doctor(
                doctor_id=doctor.id,
                user_id=user.id,
                plan_code=active_doctor_plan,
            )
            MembershipSubscriptionService.activate_trial(sub)
            user.status = UserStatus.ACTIVE
            db.session.commit()
            headers = get_auth_headers(app, user)

        resp = client.get('/api/v1/membership/me', headers=headers)
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert body['subscription']['status'] == 'trial'
        assert body['plan']['code'] == active_doctor_plan
        assert body['plan']['vertical_plan_type']['code'] == 'doctor'
        # Plan features carry the marketing bullets we authored above.
        assert body['plan']['features'] == {
            'bullets': ['Basic EHR', 'Visit history'],
        }


# --------------------------------------------------------------------------- #
# Round 3+4 — Clinic + Hospital marketplace
# --------------------------------------------------------------------------- #
# Service-layer coverage for the new verticals. We exercise the polymorphic
# ``create_pending_for_provider`` + the activate_trial → /me round-trip the
# same way the doctor tests do. The HTTP signup endpoints are integration
# tested manually (multipart + OTP tokens + S3 uploads are awkward to fake
# without rewriting half the auth pipeline; same call we made for doctor).
# --------------------------------------------------------------------------- #


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def active_clinic_plan(app, db_session, platform_owner_headers, client):
    """Create + activate a clinic-vertical plan and return its code."""
    code = f'clinic_basic_{uuid.uuid4().hex[:6]}'
    client.post(
        '/api/v1/platform/membership-plans',
        data=json.dumps({
            'code': code,
            'name': 'Clinic Basic (test)',
            'vertical_plan_type_id': _vpt_id('clinic'),
            'tier': 'basic',
            'price_inr_monthly': 999,
            'trial_days': 14,
            'features': {'bullets': ['Multi-user login', 'Appointment scheduling']},
        }),
        headers=platform_owner_headers,
    )
    client.put(
        f'/api/v1/platform/membership-plans/{code}',
        data=json.dumps({'status': 'active'}),
        headers=platform_owner_headers,
    )
    return code


@pytest.fixture
def active_hospital_plan(app, db_session, platform_owner_headers, client):
    """Create + activate a hospital-vertical plan and return its code."""
    code = f'hospital_basic_{uuid.uuid4().hex[:6]}'
    client.post(
        '/api/v1/platform/membership-plans',
        data=json.dumps({
            'code': code,
            'name': 'Hospital Basic (test)',
            'vertical_plan_type_id': _vpt_id('hospital'),
            'tier': 'basic',
            'price_inr_monthly': 4999,
            'trial_days': 14,
            'features': {'bullets': ['Multi-user system', 'OP + IP management']},
        }),
        headers=platform_owner_headers,
    )
    client.put(
        f'/api/v1/platform/membership-plans/{code}',
        data=json.dumps({'status': 'active'}),
        headers=platform_owner_headers,
    )
    return code


@pytest.fixture
def clinic_admin_user(app, db_session):
    """Create a User(role=CLINIC) + Clinic row in the platform tenant.

    Bypasses the multipart signup pipeline — purpose-built for the
    service-layer tests below, same shape as ``doctor_user``.
    """
    from app.extensions import db
    from app.models import (
        Clinic, Tenant, User, UserRole, UserStatus,
        UserVerificationStatus,
    )
    from app.models._base import set_tenant_context

    if True:  # ambient conftest app context; a nested one would detach the returned ORM rows on exit
        platform = Tenant.query.filter_by(is_default=True).first()
        set_tenant_context(db.session, platform.id)

        user = User(
            role=UserRole.CLINIC,
            status=UserStatus.PENDING,
            first_name='Test', last_name='Clinic',
            email_verified=True, tenant_id=platform.id,
        )
        user.email = f'clinic_{uuid.uuid4().hex[:8]}@test.com'
        user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
        user.set_password('TestPass123!')
        db.session.add(user)
        db.session.flush()

        clinic = Clinic(
            tenant_id=platform.id,
            admin_user_id=user.id,
            name=f'Test Clinic {uuid.uuid4().hex[:4]}',
            registration_number=f'CLN{uuid.uuid4().hex[:8].upper()}',
            address='1 Test Lane',
            city='Bengaluru',
            state='Karnataka',
            pincode='560001',
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(clinic)
        db.session.commit()
        return user, clinic


@pytest.fixture
def hospital_admin_user(app, db_session):
    """Create a User(role=HOSPITAL) + Hospital row in the platform tenant."""
    from app.extensions import db
    from app.models import (
        Hospital, Tenant, User, UserRole, UserStatus,
        UserVerificationStatus,
    )
    from app.models._base import set_tenant_context

    if True:  # ambient conftest app context; a nested one would detach the returned ORM rows on exit
        platform = Tenant.query.filter_by(is_default=True).first()
        set_tenant_context(db.session, platform.id)

        user = User(
            role=UserRole.HOSPITAL,
            status=UserStatus.PENDING,
            first_name='Test', last_name='Hospital',
            email_verified=True, tenant_id=platform.id,
        )
        user.email = f'hospital_{uuid.uuid4().hex[:8]}@test.com'
        user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
        user.set_password('TestPass123!')
        db.session.add(user)
        db.session.flush()

        hospital = Hospital(
            tenant_id=platform.id,
            admin_user_id=user.id,
            name=f'Test Hospital {uuid.uuid4().hex[:4]}',
            registration_number=f'HOS{uuid.uuid4().hex[:8].upper()}',
            hospital_type='Multi-Speciality',
            address='1 Hospital Road',
            city='Mumbai',
            state='Maharashtra',
            pincode='400001',
            verification_status=UserVerificationStatus.PENDING,
        )
        db.session.add(hospital)
        db.session.commit()
        return user, hospital


# ── Service tests — Clinic ──────────────────────────────────────────────────

class TestClinicMembershipService:

    def test_create_pending_for_clinic_happy_path(
        self, app, clinic_admin_user, active_clinic_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import (
            MembershipSubscriptionStatus, MembershipVertical,
        )

        user, clinic = clinic_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_clinic(
                clinic_id=clinic.id,
                user_id=user.id,
                plan_code=active_clinic_plan,
            )
            assert sub.status == MembershipSubscriptionStatus.PENDING
            assert sub.provider_type == MembershipVertical.CLINIC
            assert sub.trial_ends_at is None

    def test_create_pending_for_clinic_rejects_doctor_plan(
        self, app, clinic_admin_user, active_doctor_plan,
    ):
        """Wrong-vertical guard — clinic admin trying to subscribe to
        a doctor-tier plan code must be rejected by the service layer."""
        from app.api.membership.service import (
            MembershipPlanWrongVertical, MembershipSubscriptionService,
        )

        user, clinic = clinic_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(MembershipPlanWrongVertical):
                MembershipSubscriptionService.create_pending_for_clinic(
                    clinic_id=clinic.id,
                    user_id=user.id,
                    plan_code=active_doctor_plan,
                )

    def test_activate_trial_for_clinic(
        self, app, clinic_admin_user, active_clinic_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, clinic = clinic_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_clinic(
                clinic_id=clinic.id,
                user_id=user.id,
                plan_code=active_clinic_plan,
            )
            assert sub.status == MembershipSubscriptionStatus.PENDING

            MembershipSubscriptionService.activate_trial(sub)
            assert sub.status == MembershipSubscriptionStatus.TRIAL
            assert sub.trial_ends_at is not None


# ── Service tests — Hospital ────────────────────────────────────────────────

class TestHospitalMembershipService:

    def test_create_pending_for_hospital_happy_path(
        self, app, hospital_admin_user, active_hospital_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import (
            MembershipSubscriptionStatus, MembershipVertical,
        )

        user, hospital = hospital_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_hospital(
                hospital_id=hospital.id,
                user_id=user.id,
                plan_code=active_hospital_plan,
            )
            assert sub.status == MembershipSubscriptionStatus.PENDING
            assert sub.provider_type == MembershipVertical.HOSPITAL
            assert sub.trial_ends_at is None

    def test_create_pending_for_hospital_rejects_clinic_plan(
        self, app, hospital_admin_user, active_clinic_plan,
    ):
        from app.api.membership.service import (
            MembershipPlanWrongVertical, MembershipSubscriptionService,
        )

        user, hospital = hospital_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(MembershipPlanWrongVertical):
                MembershipSubscriptionService.create_pending_for_hospital(
                    hospital_id=hospital.id,
                    user_id=user.id,
                    plan_code=active_clinic_plan,
                )

    def test_activate_trial_for_hospital(
        self, app, hospital_admin_user, active_hospital_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.models import MembershipSubscriptionStatus

        user, hospital = hospital_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_hospital(
                hospital_id=hospital.id,
                user_id=user.id,
                plan_code=active_hospital_plan,
            )
            MembershipSubscriptionService.activate_trial(sub)
            assert sub.status == MembershipSubscriptionStatus.TRIAL
            assert sub.trial_ends_at is not None


# ── /api/membership/me — vertical-agnostic ──────────────────────────────────

class TestMembershipMeAcrossVerticals:
    """``/me`` returns the right vertical regardless of caller role."""

    def test_me_returns_clinic_vertical_for_clinic_admin(
        self, app, client, clinic_admin_user, active_clinic_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.extensions import db
        from app.models import UserStatus
        from tests.conftest import get_auth_headers

        user, clinic = clinic_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_clinic(
                clinic_id=clinic.id, user_id=user.id,
                plan_code=active_clinic_plan,
            )
            MembershipSubscriptionService.activate_trial(sub)
            user.status = UserStatus.ACTIVE
            db.session.commit()
            headers = get_auth_headers(app, user)

        resp = client.get('/api/v1/membership/me', headers=headers)
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert body['plan']['vertical_plan_type']['code'] == 'clinic'
        assert body['plan']['code'] == active_clinic_plan
        assert body['subscription']['status'] == 'trial'

    def test_me_returns_hospital_vertical_for_hospital_admin(
        self, app, client, hospital_admin_user, active_hospital_plan,
    ):
        from app.api.membership.service import MembershipSubscriptionService
        from app.extensions import db
        from app.models import UserStatus
        from tests.conftest import get_auth_headers

        user, hospital = hospital_admin_user
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            sub = MembershipSubscriptionService.create_pending_for_hospital(
                hospital_id=hospital.id, user_id=user.id,
                plan_code=active_hospital_plan,
            )
            MembershipSubscriptionService.activate_trial(sub)
            user.status = UserStatus.ACTIVE
            db.session.commit()
            headers = get_auth_headers(app, user)

        resp = client.get('/api/v1/membership/me', headers=headers)
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert body['plan']['vertical_plan_type']['code'] == 'hospital'
        assert body['plan']['code'] == active_hospital_plan
        assert body['subscription']['status'] == 'trial'


# --------------------------------------------------------------------------- #
# UX-cleanup pass — plan-required guard on the signup pipeline.
# --------------------------------------------------------------------------- #
# Pre-flight validation in ``AuthService._assert_marketplace_plan_required``
# rejects signup BEFORE any User/Provider rows are created when:
#   * no plan_code was supplied (someone hit the old signup URL directly),
#   * plan_code references a missing / archived / wrong-vertical plan.
#
# The funnel ( /join → /join/<vertical> → signup?plan=<code> ) always
# supplies a valid code, so these tests cover the "URL-tampered" / "stale
# link" cases.
# --------------------------------------------------------------------------- #

class TestSignupPlanRequiredGuard:

    def test_missing_plan_code_rejected(self, app):
        """No plan_code → ValueError. Doesn't need a plan row to exist."""
        from app.auth.service import AuthService
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(ValueError, match='Plan selection is required'):
                AuthService._assert_marketplace_plan_required(
                    vertical='doctor', plan_code=None,
                )
            with pytest.raises(ValueError, match='Plan selection is required'):
                AuthService._assert_marketplace_plan_required(
                    vertical='doctor', plan_code='',
                )

    def test_unknown_plan_code_rejected(self, app):
        from app.auth.service import AuthService
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(ValueError, match='not found'):
                AuthService._assert_marketplace_plan_required(
                    vertical='doctor', plan_code='does_not_exist_xxx',
                )

    def test_inactive_plan_rejected(
        self, app, client, platform_owner_headers,
    ):
        """A DRAFT plan code (not yet activated) must be rejected at
        signup. The validator surfaces a friendly "no longer available"
        message that the route layer turns into 400."""
        from app.auth.service import AuthService
        code = f'guard_draft_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': code,
                'vertical_plan_type_id': _vpt_id('doctor'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(ValueError, match='no longer available'):
                AuthService._assert_marketplace_plan_required(
                    vertical='doctor', plan_code=code,
                )

    def test_wrong_vertical_rejected(
        self, app, client, platform_owner_headers,
    ):
        """A clinic-tier plan code passed to a doctor signup must fail
        the vertical check before any rows are created. Prevents URL
        tampering between /join/clinic and /auth/.../doctor/signup."""
        from app.auth.service import AuthService
        code = f'guard_wrongvert_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': 'Clinic Basic',
                'vertical_plan_type_id': _vpt_id('clinic'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        client.put(
            f'/api/v1/platform/membership-plans/{code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            with pytest.raises(ValueError, match='not for doctors'):
                AuthService._assert_marketplace_plan_required(
                    vertical='doctor', plan_code=code,
                )

    def test_active_correct_vertical_returns_plan(
        self, app, client, platform_owner_headers,
    ):
        """Happy path — returns the resolved MembershipPlan row."""
        from app.auth.service import AuthService
        from app.models import MembershipPlan
        code = f'guard_happy_{uuid.uuid4().hex[:6]}'
        client.post(
            '/api/v1/platform/membership-plans',
            data=json.dumps({
                'code': code, 'name': code,
                'vertical_plan_type_id': _vpt_id('hospital'), 'tier': 'basic',
            }),
            headers=platform_owner_headers,
        )
        client.put(
            f'/api/v1/platform/membership-plans/{code}',
            data=json.dumps({'status': 'active'}),
            headers=platform_owner_headers,
        )
        with app.app_context():
            from flask import g as _g
            _g.tenant_id = _default_tenant_id()
            from app.extensions import db as _db
            # Self-signup additionally requires the plan to be PUBLISHED
            # on the landing page (publish_on_landing, default False) —
            # an intentional gate added after this test was written.
            row = MembershipPlan.query.filter_by(
                code=code, is_deleted=False).first()
            row.publish_on_landing = True
            _db.session.commit()
            plan = AuthService._assert_marketplace_plan_required(
                vertical='hospital', plan_code=code,
            )
            assert isinstance(plan, MembershipPlan)
            assert plan.code == code
