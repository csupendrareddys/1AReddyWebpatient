"""Compensation strategy + salary adjustment audit trail.

Covers the two rules that protect real money in the employee/consultant work:

  * who earns a per-appointment payout (the strategy), and
  * that a salary adjustment can never rewrite history or move an amount the
    doctor has already been shown.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import DoctorBillingType, PayoutStatus, SalaryPayout
from app.models.doctor_billing import SalaryPayoutAdjustment
from app.api.common.payment.billing_service import (
    get_or_create_billing_profile, adjust_salary_payout, recompute_salary_net,
)
from app.api.common.payment.compensation import (
    resolve_strategy, PLAN_BASED, EMPLOYEE_FIXED, CONSULTANT_RETAINER_INCENTIVE,
)


def _make_doctor(tenant):
    """A tenant-scoped doctor.

    Built from ``make_user_in_tenant`` rather than the older ``sample_doctor``
    fixture: that one still passes ``is_active`` to ``User``, which is no longer
    a column, so it raises on construction. ``Doctor`` also derives
    first_name/last_name from ``User`` (read-only properties), so only the real
    NOT NULL columns are set here.
    """
    from app.models import Doctor, UserRole, UserVerificationStatus
    from tests.conftest import make_user_in_tenant

    user, *_ = make_user_in_tenant(tenant, role=UserRole.DOCTOR, email_prefix='doc')
    suffix = user.id.hex[:8]
    doctor = Doctor(
        user_id=user.id, tenant_id=tenant.id,
        aadhar_number=f'AAD{suffix}', aadhar_attachment=f'aadhar/{suffix}.pdf',
        registration_number=f'REG{suffix}', registration_certificate=f'reg/{suffix}.pdf',
        verification_status=UserVerificationStatus.VERIFIED,
        consultation_fee=500.00, experience_years=5,
    )
    db.session.add(doctor)
    db.session.commit()
    return doctor


@pytest.fixture
def bare_doctor(app, db_session, fresh_tenant):
    """A doctor with NO billing profile row."""
    return _make_doctor(fresh_tenant)


@pytest.fixture
def doctor_with_profile(app, db_session, fresh_tenant):
    """A doctor plus a materialised billing profile."""
    doctor = _make_doctor(fresh_tenant)
    profile = get_or_create_billing_profile(doctor)
    db.session.commit()
    return doctor, profile


def _make_salary(doctor, *, gross='20000', status=PayoutStatus.PENDING, month=1):
    sp = SalaryPayout(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
        period_start=date(2026, month, 1), period_end=date(2026, month, 28),
        kind='salary', gross_salary=Decimal(gross), deductions=Decimal('0'),
        net_amount=Decimal(gross), status=status,
    )
    db.session.add(sp)
    db.session.commit()
    return sp


class TestCompensationStrategy:
    """Which compensation model a doctor resolves to, and who earns per visit."""

    @pytest.mark.parametrize('billing_type,expected_model,earns,periodic', [
        (DoctorBillingType.PLAN, PLAN_BASED, True, None),
        (DoctorBillingType.EMPLOYEE, EMPLOYEE_FIXED, False, 'salary'),
        (DoctorBillingType.CONSULTANT, CONSULTANT_RETAINER_INCENTIVE, True, 'retainer'),
    ])
    def test_resolves_model_per_billing_type(
        self, doctor_with_profile, billing_type, expected_model, earns, periodic,
    ):
        doctor, profile = doctor_with_profile
        profile.billing_type = billing_type
        db.session.commit()

        strategy = resolve_strategy(doctor)
        assert strategy.name == expected_model
        assert strategy.earns_per_appointment() is earns
        assert strategy.periodic_kind() == periodic

    def test_employee_never_earns_per_appointment(self, doctor_with_profile):
        """Salary replaces per-visit earnings — this is what stops double pay."""
        doctor, profile = doctor_with_profile
        profile.billing_type = DoctorBillingType.EMPLOYEE
        db.session.commit()
        assert resolve_strategy(doctor).earns_per_appointment() is False

    def test_consultant_earns_while_no_target_configured(self, doctor_with_profile):
        """Backward compatibility: absent target => every appointment earns,
        which is exactly the behaviour before target gating existed."""
        doctor, profile = doctor_with_profile
        profile.billing_type = DoctorBillingType.CONSULTANT
        db.session.commit()
        assert resolve_strategy(doctor).earns_per_appointment() is True

    def test_missing_profile_falls_back_to_plan(self, bare_doctor):
        """A doctor with no billing profile must behave as plan (column default)
        rather than blowing up inside appointment completion."""
        strategy = resolve_strategy(bare_doctor)
        assert strategy.name == PLAN_BASED
        assert strategy.earns_per_appointment() is True


class TestSalaryAdjustments:
    """The audit trail: original preserved, reason mandatory, frozen after push."""

    def test_adjustment_preserves_original_and_recomputes_net(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, gross='20000')

        adjust_salary_payout(sp, amount='-1500', kind='lwp',
                             reason='Leave Without Pay (2 Days)')

        assert sp.gross_salary == Decimal('20000.00'), 'original must never be rewritten'
        assert sp.adjustments_total == Decimal('-1500.00')
        assert sp.net_amount == Decimal('18500.00')

    def test_adjustment_records_who_what_and_why(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=2)

        adj = adjust_salary_payout(sp, amount='-1500', kind='lwp',
                                   reason='Leave Without Pay (2 Days)')

        assert adj.reason == 'Leave Without Pay (2 Days)'
        assert adj.kind == 'lwp'
        assert adj.amount == Decimal('-1500.00')
        assert adj.created_at is not None
        payload = sp.to_dict()
        assert len(payload['adjustments']) == 1, 'doctor must always see the trail'
        assert payload['adjustments'][0]['reason'] == 'Leave Without Pay (2 Days)'

    def test_reason_is_mandatory(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=3)
        for blank in (None, '', '   '):
            with pytest.raises(ValueError, match='reason is required'):
                adjust_salary_payout(sp, amount='-100', kind='penalty', reason=blank)

    def test_rejects_unknown_kind_and_zero_amount(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=4)
        with pytest.raises(ValueError, match='kind must be'):
            adjust_salary_payout(sp, amount='-100', kind='whatever', reason='x')
        with pytest.raises(ValueError, match='zero adjustment'):
            adjust_salary_payout(sp, amount='0', kind='bonus', reason='x')

    def test_adjustments_accumulate_and_can_offset(self, doctor_with_profile):
        """A mistake is corrected by an opposing entry, never by editing."""
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, gross='20000', month=5)

        adjust_salary_payout(sp, amount='-1500', kind='lwp', reason='LWP 2 days')
        adjust_salary_payout(sp, amount='500', kind='bonus', reason='Weekend cover')
        adjust_salary_payout(sp, amount='1000', kind='correction', reason='LWP miscounted')

        assert sp.adjustments_total == Decimal('0.00')
        assert sp.net_amount == Decimal('20000.00')
        assert len(sp.adjustments) == 3, 'history is append-only, nothing removed'

    @pytest.mark.parametrize('frozen_status', [
        PayoutStatus.CLAIMABLE, PayoutStatus.PROCESSING,
        PayoutStatus.COMPLETED, PayoutStatus.FAILED,
    ])
    def test_cannot_adjust_once_pushed(self, doctor_with_profile, frozen_status):
        """Past push the doctor has been shown a figure; it must not move."""
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=6)
        sp.status = frozen_status
        db.session.commit()

        with pytest.raises(ValueError, match='no longer be adjusted'):
            adjust_salary_payout(sp, amount='-100', kind='penalty', reason='too late')

    def test_can_adjust_while_on_hold(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=7, status=PayoutStatus.ON_HOLD)
        adjust_salary_payout(sp, amount='-250', kind='penalty', reason='Late start')
        assert sp.net_amount == Decimal('19750.00')

    def test_cannot_drive_payout_negative(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, gross='1000', month=8)
        with pytest.raises(ValueError, match='negative'):
            adjust_salary_payout(sp, amount='-5000', kind='penalty', reason='huge')
        db.session.rollback()
        assert SalaryPayoutAdjustment.query.filter_by(salary_payout_id=sp.id).count() == 0

    def test_recompute_includes_incentives_and_deductions(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, gross='20000', month=9)
        sp.incentive_total = Decimal('3200')
        sp.deductions = Decimal('700')
        db.session.commit()

        adjust_salary_payout(sp, amount='-1500', kind='lwp', reason='LWP')

        # 20000 - 1500 + 3200 - 700
        assert sp.net_amount == Decimal('21000.00')
        assert sp.gross_salary == Decimal('20000.00')

    def test_deleting_payout_cascades_its_adjustments(self, doctor_with_profile):
        doctor, _ = doctor_with_profile
        sp = _make_salary(doctor, month=10)
        adjust_salary_payout(sp, amount='-100', kind='penalty', reason='x')
        sp_id = sp.id
        db.session.delete(sp)
        db.session.commit()
        assert SalaryPayoutAdjustment.query.filter_by(salary_payout_id=sp_id).count() == 0
