"""
Pytest fixtures for testing the Healthcare API.

Provides:
- Flask test client with test configuration
- Database setup/teardown
- Authentication helpers
- Sample user factories
"""
import pytest
from flask import Flask
from flask_jwt_extended import create_access_token, create_refresh_token
import uuid
from datetime import timedelta

from app import create_app
from app.extensions import db
from app.models import (
    User, Patient, Doctor, Appointment, Prescription,
    UserRole, UserStatus, UserVerificationStatus,
    AppointmentStatus, AppointmentType,
    Tenant, TenantStatus,
)
from app.models._base import set_tenant_context


@pytest.fixture(scope='session')
def app():
    """Create application for testing.

    Database URL precedence (highest first):
      1. ``TEST_DATABASE_URL`` env var
      2. ``DATABASE_URL`` env var (lets CI reuse its bootstrapped DB)
      3. Hardcoded local default
    """
    import os
    db_url = (
        os.environ.get('TEST_DATABASE_URL')
        or os.environ.get('DATABASE_URL')
        or 'postgresql://postgres:postgres123@localhost:5433/healthcare_test'
    )
    redis_url = os.environ.get('TEST_REDIS_URL') or 'redis://localhost:6380/1'

    test_config = {
        'TESTING': True,
        'SQLALCHEMY_DATABASE_URI': db_url,
        'SQLALCHEMY_TRACK_MODIFICATIONS': False,
        'JWT_SECRET_KEY': 'test-jwt-secret-key',
        'JWT_COOKIE_CSRF_PROTECT': False,
        'JWT_TOKEN_LOCATION': ['headers', 'cookies'],
        'RATELIMIT_ENABLED': False,
        'REDIS_URL': redis_url,
        'WTF_CSRF_ENABLED': False,
    }
    
    app = create_app(config_override=test_config)

    with app.app_context():
        db.create_all()
        # Seed a default tenant — production always has one (the platform
        # tenant). Public endpoints fall back to ``is_default=True`` when
        # the request didn't carry tenant context, so without a row here
        # those endpoints would 500 in CI even though they're correct.
        # We commit eagerly so subsequent function-scoped sessions see it.
        #
        # BOTH flags, because the real vendor row carries both — see
        # bootstrap_local.py / scripts/bootstrap_vendor.py, which create it
        # as is_platform=True, is_default=True. They mean different things
        # (is_platform = the SaaS vendor and its entitlement bypass;
        # is_default = where an unresolved anonymous request lands) and must
        # not be conflated, but production's single row happens to be both.
        #
        # Setting only is_default made this fixture model a tenant that does
        # not exist in production, and the difference is load-bearing:
        # /auth/me skips plan resolution for is_platform tenants, so on a
        # FRESH database the platform owner resolved a plan and
        # test_default_tenant_user_gets_no_plan_resolution failed. It passed
        # on any developer's database only because a real vendor row already
        # existed there and this branch never ran.
        if not Tenant.query.filter_by(is_default=True).first():
            platform = Tenant(
                name='Test Platform',
                slug='platform',
                status=TenantStatus.ACTIVE,
                is_default=True,
                is_platform=True,
            )
            db.session.add(platform)
            db.session.commit()
        yield app
        db.session.remove()
        # ``drop_all`` can fail with CircularDependencyError because the
        # existing schema has a mutual FK between ``appointments`` and
        # ``prescriptions``. This is a pre-existing model issue, NOT
        # something for the test session to fix. CI runs against an
        # ephemeral container that's destroyed between runs, so we don't
        # actually need teardown to drop tables — making the cleanup
        # best-effort lets the run report green when the schema would
        # otherwise turn the last test into an ERROR for cosmetic reasons.
        try:
            db.drop_all()
        except Exception:  # noqa: BLE001
            pass


@pytest.fixture(scope='function')
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture(scope='function')
def db_session(app):
    """Create a new database session for each test."""
    with app.app_context():
        connection = db.engine.connect()
        transaction = connection.begin()
        
        # Bind session to this connection
        db.session.begin_nested()
        
        yield db.session
        
        db.session.rollback()
        transaction.rollback()
        connection.close()


# Mirror of the plan1 features blob from the pricing migration
# ``d4e5f6a7b8c9_pricing_plans_subscriptions_addons.py``. Hard-coded
# here (instead of importing the migration module, which has
# alembic-context side-effects) so the test suite can seed plan1
# even when the test DB was bootstrapped via ``db.create_all() +
# stamp head`` and the migration's data INSERTs never ran.
_PLAN1_FEATURES = {
    'patient': {
        'basic_info': True, 'vitals': False,
        'documents': False, 'family': False,
    },
    'doctor': {
        'profile': True, 'calendar': True,
        'pricing': True, 'prescriptions': True,
    },
    'admin': {
        'manage_users': True, 'page_configuration': False,
    },
    'communication': {
        'sms': {'enabled': True, 'control': 'platform'},
        'email': {'enabled': True, 'control': 'platform'},
    },
    # ONLINE booking defaults to consultation_type=video and the route
    # gates it on FeatureGate.require_feature('consultation.video').
    # Leaves must be {'enabled': True} DICTS, not bare booleans —
    # DomainPolicy reads leaf meta and a bool silently fails its checks
    # (backend CLAUDE.md gotcha).
    'consultation': {
        'video': {'enabled': True},
        'audio': {'enabled': True},
        'chat': {'enabled': True},
    },
    'payments': {
        'razorpay': {'enabled': True, 'control': 'platform'},
    },
    'domain': {
        'subdomain': {'enabled': True, 'configurable': True},
        'custom_domain': {'enabled': False, 'configurable': False},
    },
}


@pytest.fixture(autouse=True, scope='function')
def _ensure_default_tenant_subscription(app, db_session):
    """Make sure the default tenant has a TenantSubscription on
    ``plan1`` so the new ``@feature_required`` decorators on patient
    / doctor / admin routes don't blanket-402 every existing test.

    Two-step:
      1. SEED ``plan1`` if absent. CI bootstraps via
         ``db.create_all() + stamp head`` which creates the
         ``plans`` table but never runs the pricing migration's
         data INSERTs. Same with any dev DB that was created from
         scratch outside alembic. We seed a minimum-viable plan1
         row matching the migration's shape.
      2. Backfill a TenantSubscription on the default tenant.

    Both steps are idempotent (skip if the row already exists).

    Tests that need a tenant WITHOUT a subscription
    (``test_no_subscription_returns_402_no_active_subscription``)
    use a separate fresh tenant, so this autouse fixture doesn't
    interfere with them.
    """
    from datetime import datetime, timedelta, timezone
    try:
        from app.models import (
            Tenant, Plan, PlanStatus, TenantSubscription,
            SubscriptionStatus, BillingCycle, OverLimitAction,
        )
    except ImportError:
        yield
        return

    # Step 1 — seed plan1 if missing. Look up WITHOUT the
    # is_deleted filter (the column is UNIQUE on ``code`` regardless
    # of soft-delete state, so we'd UNIQUE-violate on re-insert if a
    # previous test soft-deleted plan1).
    plan1 = Plan.query.filter_by(code='plan1', owner_tenant_id=None).first()
    if plan1 is not None:
        # Self-heal drift: the test DB persists between runs, so a
        # plan1 seeded by an OLDER conftest keeps its old feature tree
        # forever and newly-gated routes 403 mysteriously. Merge in any
        # top-level feature keys added to _PLAN1_FEATURES since.
        merged = {**_PLAN1_FEATURES, **(plan1.features or {})}
        for key, val in _PLAN1_FEATURES.items():
            merged[key] = val
        if merged != (plan1.features or {}):
            plan1.features = merged
            db.session.commit()
    if plan1 is None:
        try:
            plan1 = Plan(
                code='plan1',
                name='Plan 1',
                description='Test-seeded starter plan',
                status=PlanStatus.ACTIVE,
                is_default=True,
                trial_days=14,
                max_total_users=20,
                max_super_admins=1,
                max_sub_admins=3,
                max_providers=16,
                over_limit_action=OverLimitAction.BLOCK_NEW,
                grace_period_days=0,
                razorpay_supported=True,
                tenant_keys_allowed=False,
                features=_PLAN1_FEATURES,
            )
            db.session.add(plan1)
            db.session.commit()
        except Exception:
            # Plan model not present / different shape than expected.
            # Yield without seeding — tests that depend on plan1 will
            # skip via _get_seeded_plan1's own guard.
            db.session.rollback()
            yield
            return
    elif getattr(plan1, 'is_deleted', False):
        # A previous test soft-deleted plan1; un-delete so this run
        # behaves the same as a fresh DB.
        plan1.is_deleted = False
        db.session.commit()

    # Step 2 — subscribe the default tenant if not already.
    default = Tenant.query.filter_by(is_default=True).first()
    if default is None:
        yield
        return

    set_tenant_context(db.session, default.id)
    existing = (
        TenantSubscription.query
        .filter_by(tenant_id=default.id, is_deleted=False)
        .first()
    )
    if existing is None:
        now = datetime.now(timezone.utc)
        db.session.add(TenantSubscription(
            tenant_id=default.id,
            plan_id=plan1.id,
            status=SubscriptionStatus.ACTIVE,
            billing_cycle=BillingCycle.MONTHLY,
            current_period_start=now,
            current_period_end=now + timedelta(days=30),
        ))
        db.session.commit()
    yield


@pytest.fixture
def sample_patient(app, db_session):
    """Create a sample patient user.

    Post-schema-split: ``first_name`` / ``middle_name`` / ``last_name``
    / ``gender`` / ``dob`` / ``profile_image`` live on User; the
    Patient row only carries health-attribute columns. Passing those
    name fields to ``Patient(...)`` raises ``TypeError`` since the
    columns no longer exist.
    """
    # Resolve the default tenant once so the Patient row has a
    # tenant_id (it inherits TenantMixin).
    default_tenant = Tenant.query.filter_by(is_default=True).first()
    tenant_id = default_tenant.id if default_tenant else None
    set_tenant_context(db.session, tenant_id)

    phone = f"9{uuid.uuid4().int % 1000000000:09d}"
    email = f"patient_{uuid.uuid4().hex[:8]}@test.com"

    user = User(
        role=UserRole.PATIENT,
        first_name='Test',
        last_name='Patient',
        email_verified=True,
        tenant_id=tenant_id,
    )
    user.email = email
    user.phone_number = phone
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.flush()

    patient = Patient(
        user_id=user.id,
        tenant_id=tenant_id,
    )
    db.session.add(patient)
    db.session.commit()

    return user, patient


@pytest.fixture
def sample_doctor(app, db_session):
    """Create a sample verified doctor user.

    Post-schema-split shape (mirrors ``sample_patient``): name fields
    live on User (Doctor exposes them as read-only properties);
    ``User.is_active`` became the ``status`` enum; Doctor's
    ``registration_certificate`` / ``aadhar_number`` /
    ``aadhar_attachment`` are NOT NULL now.
    """
    from app.models._enums import UserStatus

    default_tenant = Tenant.query.filter_by(is_default=True).first()
    tenant_id = default_tenant.id if default_tenant else None
    set_tenant_context(db.session, tenant_id)

    email = f"doctor_{uuid.uuid4().hex[:8]}@test.com"
    phone = f"8{uuid.uuid4().int % 1000000000:09d}"

    user = User(
        role=UserRole.DOCTOR,
        first_name='Dr. Test',
        last_name='Doctor',
        status=UserStatus.ACTIVE,
        email_verified=True,
        tenant_id=tenant_id,
    )
    user.email = email
    user.phone_number = phone
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.flush()

    doctor = Doctor(
        user_id=user.id,
        tenant_id=tenant_id,
        registration_number=f'DOC{uuid.uuid4().hex[:8].upper()}',
        registration_certificate='test/reg-cert.pdf',
        aadhar_number=f'{uuid.uuid4().int % 10**12:012d}',
        aadhar_attachment='test/aadhar.pdf',
        verification_status=UserVerificationStatus.VERIFIED,
        consultation_fee=500.00,
        experience_years=5,
    )
    db.session.add(doctor)
    db.session.commit()

    return user, doctor


@pytest.fixture
def sample_appointment(sample_patient, sample_doctor, db_session):
    """Create a sample appointment. ``tenant_id`` is passed explicitly —
    the before_flush auto-fill only fires inside a request context."""
    from datetime import date, time

    _, patient = sample_patient
    _, doctor = sample_doctor

    appointment = Appointment(
        tenant_id=doctor.tenant_id,
        patient_id=patient.id,
        doctor_id=doctor.id,
        appointment_date=date.today(),
        start_time=time(10, 0),
        appointment_type=AppointmentType.ONLINE,
        status=AppointmentStatus.PENDING,
        chief_complaint='Test complaint',
    )
    db.session.add(appointment)
    db.session.commit()

    return appointment


# ────────────────────────────────────────────────────────────────────────── #
# Tenant fixtures + helpers — landing page + page-config endpoints all run
# under a tenant context (``g.tenant_id``) which is normally set by the
# ``before_request`` hook from the request's host. Tests skip that hook so
# we set ``app.current_tenant_id`` manually via ``set_tenant_context`` and
# also stamp ``g.tenant_id`` so service layer reads work.
# ────────────────────────────────────────────────────────────────────────── #

@pytest.fixture
def fresh_tenant(app, db_session):
    """Create a brand-new tenant row + activate its RLS context.

    Yields the tenant. After the test, the row is rolled back via
    ``db_session``'s transaction so subsequent tests see a clean slate.
    """
    slug = f"t{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name=f'Test Tenant {slug}',
        slug=slug,
        status=TenantStatus.ACTIVE,
        is_default=False,
    )
    db.session.add(tenant)
    db.session.commit()

    # Activate the RLS context so subsequent INSERTs/SELECTs against
    # ``TenantMixin`` tables resolve to this tenant.
    set_tenant_context(db.session, tenant.id)

    yield tenant


@pytest.fixture
def tenant_request_context(app, fresh_tenant):
    """Context manager fixture that pushes a Flask test request context with
    ``g.tenant_id`` set — services that read ``g.tenant_id`` directly (most
    of the landing-config service layer) need this.
    """
    from flask import g
    with app.test_request_context():
        g.tenant_id = fresh_tenant.id
        # Also sets ``app.current_tenant_id`` on the SQL session for RLS.
        set_tenant_context(db.session, fresh_tenant.id)
        yield fresh_tenant


def auth_headers_for_tenant(app, user, tenant):
    """Generate JWT headers including a tenant claim. Used by admin endpoint
    tests so the rbac decorator + tenant-resolution middleware see a real
    user with a real tenant.
    """
    with app.app_context():
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={
                'role': user.role.value,
                'tenant_id': str(tenant.id),
                'session_id': str(uuid.uuid4()),
            },
        )
        return {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
            # Some middleware reads tenant from this header.
            'X-Tenant-Slug': tenant.slug,
        }


def get_auth_headers(app, user):
    """Generate authentication headers for a user.

    Creates a real ``UserSession`` row before minting the JWT — the
    ``user_lookup_callback`` registered in ``app/extensions.py`` runs
    for every authenticated request and returns ``None`` (→ 401
    "Error loading the user") when the JWT's ``session_id`` claim
    doesn't match any non-revoked, non-expired row in
    ``user_sessions`` or any cached entry in Redis. A random UUID
    fails both checks, so without seeding a session here every test
    that hits a ``@jwt_required`` endpoint 401s.

    Existing CI tests didn't surface this — they all hit public
    endpoints. The patient-profile suite is the first authenticated
    test in CI.
    """
    from datetime import datetime, timedelta, timezone
    from app.models import UserSession

    with app.app_context():
        # Re-set the RLS tenant context inside this nested app
        # context — without it, INSERT on ``user_sessions`` (which
        # inherits ``TenantMixin``) can be rejected by the Postgres
        # row-level security policy if the SET LOCAL from the outer
        # fixture didn't carry across.
        if user.tenant_id:
            set_tenant_context(db.session, user.tenant_id)

        # Stamp a session row that the user-lookup callback will
        # accept: matches by id, not revoked, not expired.
        session = UserSession(
            user_id=user.id,
            tenant_id=user.tenant_id,
            refresh_token_hash='test-hash-not-validated',
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            absolute_expiry=datetime.now(timezone.utc) + timedelta(days=30),
            is_revoked=False,
        )
        db.session.add(session)
        db.session.commit()

        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={
                'role': user.role.value,
                # ``tenant_id`` claim drives the before_request tenant-
                # context hook → RLS scoping for the test request.
                'tenant_id': str(user.tenant_id) if user.tenant_id else None,
                'session_id': str(session.id),
            }
        )
        return {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }


# ─────────────────────────────────────────────────────────────────────── #
# Multi-tenant test helpers — seed N tenants with custom domains and N
# users (patient/super_admin/sub_admin/doctor) per tenant. Tests use
# these to exercise tenant-isolation across the whole authenticated
# surface (cross-tenant signin rejection, JWT-host invariant, per-
# tenant data scoping). The Phase 0 strict-tenant-resolution fix is
# only useful if the tests cover a multi-tenant world, not the single-
# default-tenant world the existing fixtures assumed.
# ─────────────────────────────────────────────────────────────────────── #


def make_tenant_with_domain(domain=None, slug=None):
    """Create an active tenant with a custom ``domain`` and return it.

    ``domain`` defaults to a random ``custom-<hex>.example.com`` so
    ``before_request``'s host-based resolution can match it without
    colliding with any other test's tenant.
    """
    slug = slug or f't{uuid.uuid4().hex[:8]}'
    domain = domain or f'custom-{uuid.uuid4().hex[:8]}.example.com'
    t = Tenant(
        name=f'Test {slug}',
        slug=slug,
        domain=domain,
        status=TenantStatus.ACTIVE,
        is_default=False,
    )
    db.session.add(t)
    db.session.commit()
    set_tenant_context(db.session, t.id)
    return t


def make_user_in_tenant(tenant, role=UserRole.PATIENT, password='TestPass123!',
                       email_prefix='u'):
    """Create a User row scoped to ``tenant`` with the given role.

    Returns ``(user, email, phone, password)`` so callers don't have
    to round-trip the encrypted columns to recover the plaintext.
    """
    set_tenant_context(db.session, tenant.id)
    email = f'{email_prefix}_{uuid.uuid4().hex[:8]}@test.com'
    phone = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user = User(
        role=role,
        first_name='Test',
        last_name=role.value.title().replace('_', ''),
        email_verified=True,
        # Round 8.5 — mirror what production signup produces: phone is
        # OTP-verified at signup, so phone_verified=True. The new signin
        # gate (PHONE_NOT_VERIFIED for role=DOCTOR) would otherwise
        # reject test doctors created via this helper.
        phone_verified=True,
        tenant_id=tenant.id,
        # Default User.status is PENDING — signin then refuses with
        # "Account is not active." Stamp ACTIVE so isolation tests can
        # exercise the real auth path without a separate activation step.
        status=UserStatus.ACTIVE,
    )
    user.email = email
    user.phone_number = phone
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user, email, phone, password


@pytest.fixture
def tenant_world(app, db_session):
    """Two tenants (A and B), each with a patient + super_admin + doctor.

    Yields a dict-like structure tests can index into:
        world['tenant_a']['tenant']         # the Tenant row
        world['tenant_a']['patient']        # (user, email, phone, password)
        world['tenant_a']['super_admin']    # (user, email, phone, password)
        world['tenant_a']['doctor']         # (user, email, phone, password)
        world['tenant_b']['tenant']
        ...

    Plus the platform's default tenant under ``world['platform']``.
    """
    platform = Tenant.query.filter_by(is_default=True).first()
    assert platform, 'session fixture must seed a default tenant'

    # Random slugs/domains: the inner ``commit()`` inside
    # ``make_tenant_with_domain`` flushes outside the ``db_session``
    # transaction, so a hard-coded slug like ``'tenant-a'`` collides
    # across tests. The helper's defaults are random hex tokens, which
    # are unique per fixture invocation.
    tenant_a = make_tenant_with_domain()
    tenant_b = make_tenant_with_domain()

    world = {'platform': {'tenant': platform}, 'tenant_a': {}, 'tenant_b': {}}
    world['tenant_a']['tenant'] = tenant_a
    world['tenant_b']['tenant'] = tenant_b

    for key, t in (('tenant_a', tenant_a), ('tenant_b', tenant_b)):
        world[key]['patient'] = make_user_in_tenant(
            t, UserRole.PATIENT, email_prefix=f'pat_{key}',
        )
        world[key]['super_admin'] = make_user_in_tenant(
            t, UserRole.SUPER_ADMIN, email_prefix=f'sa_{key}',
        )
        world[key]['doctor'] = make_user_in_tenant(
            t, UserRole.DOCTOR, email_prefix=f'doc_{key}',
        )

    return world


def get_auth_cookies(app, client, user):
    """Set authentication cookies on the test client."""
    with app.app_context():
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={
                'role': user.role.value,
                'session_id': str(uuid.uuid4()),
            }
        )
        refresh_token = create_refresh_token(
            identity=str(user.id),
            additional_claims={
                'session_id': str(uuid.uuid4()),
            }
        )
        
        client.set_cookie('localhost', 'access_token_cookie', access_token)
        client.set_cookie('localhost', 'refresh_token_cookie', refresh_token)
        
    return client
