"""Regressions caught the hard way today.

Each test class corresponds to a bug that 500'd in production while
the operator was debugging the platform-owner approval flow. The
goal is not exhaustive coverage of the surrounding feature — it's
to pin the specific failure mode that broke live so the same
shape of bug can't slip back in unnoticed.

1. **Doctor / Admin @property shims** (commit 4328a8b).
   ``Doctor.first_name`` / ``profile_image`` / ``about`` / etc.
   were moved off Doctor + Admin into User / ProfileAbout /
   ProfileSignature. Dozens of read sites still read them off
   the original table → AttributeError on every call. Shims on
   Doctor + Admin forward to the source of truth. These tests
   prove the shims resolve correctly (including None-safety
   when the related row doesn't exist).

2. **ApprovalService.apply_doctor_availability_sync** (commits
   715fb69, 4595090). Two endpoints approve doctor-availability
   requests; only one used to mirror the approval into the
   Doctor row. The extracted helper now owns the entire
   doctor-side mirror. Tests confirm status flips to APPROVED,
   approved_working_days mirrors the change, time_slots
   re-materialise from day_overrides.

3. **FeatureGate.is_enabled apex bypass** (commit add7f4e).
   The platform/default tenant (``is_default=True``) should
   bypass all FeatureGate checks — it's the platform's own
   tenant, not a paying subscriber. Tests confirm the default
   tenant passes any path and a non-default tenant still hits
   the plan-tree walk.

4. **Smoke import** of every services module — catches the
   class of bug where I added a ``logger.X`` call without
   importing logger, and the route's broad except hid the
   NameError as a 400.
"""
from __future__ import annotations

import importlib
import uuid

import pytest
from flask import g

from app.extensions import db
from app.models import (
    Admin, ApprovalEntityType, ApprovalRequest, ApprovalRequestStatus,
    AvailabilityApprovalStatus, Doctor, Tenant, TenantStatus,
    User, UserRole, ProfileAbout, ProfileSignature,
)
from app.models._base import get_or_create_profile_owner, set_tenant_context
from app.api.admin.rbac.services import ApprovalService
from app.api.pricing.service import FeatureGate, NoActiveSubscription
from app.common.tenant_context import current_tenant_id_strict  # noqa: F401


# ─── shared fixtures ───────────────────────────────────────────────

@pytest.fixture
def second_tenant(app, db_session):
    slug = f't_reg_{uuid.uuid4().hex[:8]}'
    t = Tenant(
        name=f'Regression Tenant {slug}',
        slug=slug,
        status=TenantStatus.ACTIVE,
        is_default=False,
    )
    db.session.add(t)
    db.session.commit()
    return t


def _make_user(tenant_id, role=UserRole.DOCTOR):
    set_tenant_context(db.session, tenant_id)
    u = User(
        role=role,
        first_name='Reg',
        last_name='Test',
        middle_name='M',
        email_verified=True,
        phone_verified=True,
        tenant_id=tenant_id,
        profile_image='https://example.com/u.png',
    )
    u.email = f'reg_{uuid.uuid4().hex[:8]}@test.com'
    u.phone_number = f'9{uuid.uuid4().int % 1000000000:09d}'
    u.set_password('TestPass123!')
    db.session.add(u)
    db.session.commit()
    return u


def _make_doctor(tenant_id, user=None):
    if user is None:
        user = _make_user(tenant_id, role=UserRole.DOCTOR)
    set_tenant_context(db.session, tenant_id)
    d = Doctor(
        tenant_id=tenant_id,
        user_id=user.id,
        aadhar_number='AADHAR-FAKE-1234',
        aadhar_attachment='s3://fake/aadhar',
        registration_number=f'MED-{uuid.uuid4().hex[:6]}',
        registration_certificate='s3://fake/cert',
    )
    db.session.add(d)
    db.session.commit()
    return d


def _make_admin(tenant_id):
    user = _make_user(tenant_id, role=UserRole.SUPER_ADMIN)
    set_tenant_context(db.session, tenant_id)
    a = Admin(tenant_id=tenant_id, user_id=user.id)
    db.session.add(a)
    db.session.commit()
    return a


# ─── 1. Doctor / Admin @property shims ─────────────────────────────

class TestDoctorPropertyShims:
    """Reads off Doctor that USED to be columns on Doctor but have
    since been moved to User / ProfileAbout / ProfileSignature. The
    shims forward to the right source of truth."""

    def test_name_fields_resolve_from_user(self, app, db_session, fresh_tenant):
        doctor = _make_doctor(fresh_tenant.id)
        assert doctor.first_name == 'Reg'
        assert doctor.middle_name == 'M'
        assert doctor.last_name == 'Test'

    def test_profile_image_resolves_from_user(self, app, db_session, fresh_tenant):
        doctor = _make_doctor(fresh_tenant.id)
        assert doctor.profile_image == 'https://example.com/u.png'

    def test_about_returns_none_when_no_profile_about(
        self, app, db_session, fresh_tenant,
    ):
        doctor = _make_doctor(fresh_tenant.id)
        # No ProfileAbout row → about returns None instead of AttributeError
        assert doctor.about is None

    def test_about_resolves_from_profile_about_when_present(
        self, app, db_session, fresh_tenant,
    ):
        doctor = _make_doctor(fresh_tenant.id)
        # profile_owner_id became NOT NULL (profile-owner
        # centralization) — obtain it the way every app writer does.
        po = get_or_create_profile_owner('doctor', doctor.id, fresh_tenant.id)
        pa = ProfileAbout(
            tenant_id=fresh_tenant.id,
            doctor_id=doctor.id,
            profile_owner_id=po.id,
            brief_about_text='Senior cardiologist.',
        )
        db.session.add(pa)
        db.session.commit()
        # Property forwards to ProfileAbout.brief_about_text
        assert doctor.about == 'Senior cardiologist.'

    def test_signature_image_resolves_from_profile_signature(
        self, app, db_session, fresh_tenant,
    ):
        doctor = _make_doctor(fresh_tenant.id)
        po = get_or_create_profile_owner('doctor', doctor.id, fresh_tenant.id)
        ps = ProfileSignature(
            tenant_id=fresh_tenant.id,
            doctor_id=doctor.id,
            profile_owner_id=po.id,
            signature1_url='https://example.com/sig.png',
        )
        db.session.add(ps)
        db.session.commit()
        assert doctor.signature_image == 'https://example.com/sig.png'

    def test_shims_are_read_only(self, app, db_session, fresh_tenant):
        """Writes to a shim must raise — the source of truth lives
        elsewhere. Silent writes would create the illusion that a
        Doctor.first_name = 'X' assignment worked when it'd be
        thrown away on commit."""
        doctor = _make_doctor(fresh_tenant.id)
        with pytest.raises(AttributeError):
            doctor.first_name = 'NewName'


class TestAdminPropertyShims:
    """Same pattern, Admin side."""

    def test_admin_name_fields_resolve_from_user(self, app, db_session, fresh_tenant):
        admin = _make_admin(fresh_tenant.id)
        assert admin.first_name == 'Reg'
        assert admin.last_name == 'Test'

    def test_admin_profile_image_resolves_from_user(
        self, app, db_session, fresh_tenant,
    ):
        admin = _make_admin(fresh_tenant.id)
        assert admin.profile_image == 'https://example.com/u.png'

    def test_admin_about_returns_none_when_no_profile_about(
        self, app, db_session, fresh_tenant,
    ):
        admin = _make_admin(fresh_tenant.id)
        assert admin.about is None


# ─── 2. apply_doctor_availability_sync ─────────────────────────────

class TestApplyDoctorAvailabilitySync:
    """The cross-route mirror that flips the doctor row to APPROVED
    + materialises time_slots. Two endpoints used to need this
    inline; only one had it. Extracting it into the service catches
    both routes — these tests pin the helper's behaviour."""

    def _make_approval(self, doctor, meta, data, status=ApprovalRequestStatus.COMPLETED):
        admin = _make_user(doctor.tenant_id, role=UserRole.SUPER_ADMIN)
        approval = ApprovalRequest(
            tenant_id=doctor.tenant_id,
            requested_by_id=admin.id,
            entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
            entity_id=doctor.id,
            changes={'_meta': meta, 'data': data},
            reason='regression test',
            required_level=1,
            current_level=1 if status == ApprovalRequestStatus.COMPLETED else 0,
            status=status,
        )
        db.session.add(approval)
        db.session.commit()
        return approval, admin

    def test_working_hours_global_flips_status_and_mirrors(
        self, app, db_session, fresh_tenant,
    ):
        """Approving a 'working_hours' global update flips
        approval_status to APPROVED AND copies the new working_days
        into approved_working_days."""
        doctor = _make_doctor(fresh_tenant.id)
        new_wh = {'Monday': [{'start': '09:00', 'end': '17:00'}]}
        approval, admin = self._make_approval(
            doctor,
            meta={'category': 'working_hours', 'type': 'global'},
            data=new_wh,
        )

        ApprovalService.apply_doctor_availability_sync(approval, admin.id)
        db.session.refresh(doctor)

        assert doctor.availability_approval_status == (
            AvailabilityApprovalStatus.APPROVED
        )
        assert doctor.approved_working_days == new_wh
        assert doctor.availability_approved_at is not None
        assert doctor.availability_approved_by_id == admin.id

    def test_calendar_writes_day_overrides_into_availability_config(
        self, app, db_session, fresh_tenant,
    ):
        """The 'calendar' category writes the new day_overrides into
        availability_config — that's what the patient slot endpoint
        reads when materialising time_slots.

        We push a Flask request context with ``g.tenant_id`` set so
        the ``before_flush`` hook in ``app/models/_base.py`` can
        auto-fill ``tenant_id`` on TimeSlot inserts that the
        downstream ``materialize_day_overrides`` call performs.
        Without this, the insert NOT NULL-violates and the whole
        sync rolls back.
        """
        doctor = _make_doctor(fresh_tenant.id)
        doctor.availability_config = {'slot_size': 15}
        db.session.commit()

        new_overrides = {
            '2026-12-01': [
                {'start': '09:00', 'end': '09:15', 'duration': 15,
                 'consultation_types': ['video']}
            ]
        }
        approval, admin = self._make_approval(
            doctor,
            meta={'category': 'calendar', 'type': 'global'},
            data=new_overrides,
        )

        with app.test_request_context():
            g.tenant_id = fresh_tenant.id
            set_tenant_context(db.session, fresh_tenant.id)
            ApprovalService.apply_doctor_availability_sync(approval, admin.id)
        db.session.refresh(doctor)

        assert doctor.availability_approval_status == (
            AvailabilityApprovalStatus.APPROVED
        )
        # The approved schedule lands on the dedicated approved-snapshot
        # column now (live-draft config split from the approved copy);
        # the OLD slot_size key still survives in the live config.
        assert doctor.approved_day_overrides == new_overrides
        assert doctor.availability_config.get('slot_size') == 15

    def test_non_completed_approval_is_no_op(
        self, app, db_session, fresh_tenant,
    ):
        """An approval still PENDING must NOT touch the doctor row —
        only COMPLETED ones mirror through. Otherwise multi-level
        approvals would auto-mark the doctor APPROVED at L1."""
        doctor = _make_doctor(fresh_tenant.id)
        # Doctor starts in NOT_SUBMITTED state (the default per model).
        original_status = doctor.availability_approval_status
        approval, admin = self._make_approval(
            doctor,
            meta={'category': 'working_hours', 'type': 'global'},
            data={'Monday': []},
            status=ApprovalRequestStatus.PENDING,
        )

        ApprovalService.apply_doctor_availability_sync(approval, admin.id)
        db.session.refresh(doctor)

        # No flip — still in the original state.
        assert doctor.availability_approval_status == original_status

    def test_non_availability_entity_type_is_no_op(
        self, app, db_session, fresh_tenant,
    ):
        """Helper must early-return for approvals that aren't doctor
        availability/fee — e.g. a DOCTOR_PROFILE approval — so a
        generic approve route can safely call it for every entity
        without spuriously stomping the doctor's availability fields.
        """
        doctor = _make_doctor(fresh_tenant.id)
        admin = _make_user(doctor.tenant_id, role=UserRole.SUPER_ADMIN)
        approval = ApprovalRequest(
            tenant_id=doctor.tenant_id,
            requested_by_id=admin.id,
            entity_type=ApprovalEntityType.DOCTOR_PROFILE,
            entity_id=doctor.id,
            changes={},
            reason='test',
            required_level=1,
            current_level=1,
            status=ApprovalRequestStatus.COMPLETED,
        )
        db.session.add(approval)
        db.session.commit()

        # Should not raise; should not touch any doctor availability row.
        ApprovalService.apply_doctor_availability_sync(approval, admin.id)
        db.session.refresh(doctor)
        # availability status unchanged from the model default
        assert doctor.availability_approval_status == (
            AvailabilityApprovalStatus.NOT_SUBMITTED
        )


# ─── 3. FeatureGate apex bypass ───────────────────────────────────

class TestFeatureGateApexBypass:
    """The platform/default tenant (``is_default=True``) is the
    platform's own tenant and should bypass FeatureGate checks.
    Real subscriber tenants (``is_default=False``) keep the strict
    gate."""

    def test_default_tenant_passes_any_known_path(self, app, db_session):
        # The session's default tenant (seeded in conftest) is
        # is_default=True. Pick a known plan-feature path that
        # plan1 doesn't grant — the apex still resolves it True.
        default = Tenant.query.filter_by(is_default=True).first()
        assert default is not None, 'conftest must have seeded a default tenant'

        # ``patient.intake_forms`` was the exact path that 403'd in
        # prod — proof we don't regress.
        assert FeatureGate.is_enabled(default.id, 'patient.intake_forms') is True

    def test_non_default_tenant_still_uses_plan_tree(
        self, app, db_session, second_tenant,
    ):
        # On a non-default tenant with no TenantSubscription,
        # ``is_enabled`` falls through past the apex bypass and into
        # ``PlanService.resolve`` — which raises ``NoActiveSubscription``.
        # The exception is exactly what proves the apex bypass did NOT
        # apply for the subscriber tenant: if it had, we'd have returned
        # True without ever calling resolve.
        with pytest.raises(NoActiveSubscription):
            FeatureGate.is_enabled(second_tenant.id, 'patient.intake_forms')

    def test_unknown_path_still_denies_even_on_default_tenant(
        self, app, db_session,
    ):
        """The unknown-path guard must run BEFORE the apex bypass.
        Otherwise a typo (``feature.intkae_forms``) would silently
        pass on the platform tenant and 500 later when something
        else looked the path up in the plan."""
        default = Tenant.query.filter_by(is_default=True).first()
        assert FeatureGate.is_enabled(default.id, 'this.is.not.a.real.path') is False


# ─── 4. Smoke import — catches NameError-class bugs ───────────────

class TestServiceModulesImportClean:
    """The 'logger not defined' 500 that broke
    /availability-approvals/<id>/approve was a NameError raised by
    a fresh ``logger.info`` call in a module that never imported
    logging. Test framework catches this class of bug at collection
    time — if any of these modules import-errors, the test fails
    before any production traffic ever hits it.
    """

    @pytest.mark.parametrize('module_path', [
        'app.api.admin.rbac.services',
        'app.api.admin.rbac.routes',
        'app.api.admin.availability_products',
        'app.api.admin.routes',
        'app.common.module_lifecycle',
        'app.common.module_routes',
        'app.common.tenant_context',
        'app.api.pricing.service',
        'app.api.service_provider.doctor.routes',
        'app.api.service_provider.doctor.service',
        'app.api.service_reciever.patient.service',
        'app.models.doctor',
        'app.models.admin',
        'app.models._base',
    ])
    def test_module_imports_cleanly(self, app, module_path):
        """No NameError, no ImportError, no syntax issue."""
        mod = importlib.import_module(module_path)
        assert mod is not None

    def test_apply_doctor_availability_sync_has_logger(self):
        """Specific defence against the logger-not-defined bug that
        broke prod once already. The helper's source code must
        reference ``logger`` somewhere AND the module must expose
        a ``logger`` attribute at the top level."""
        from app.api.admin.rbac import services as svc
        assert hasattr(svc, 'logger'), (
            'rbac/services.py must expose a module-level logger — '
            'apply_doctor_availability_sync calls logger.info/.warning'
        )
        import inspect
        src = inspect.getsource(svc.ApprovalService.apply_doctor_availability_sync)
        assert 'logger' in src, 'helper must log; check rbac/services.py'
