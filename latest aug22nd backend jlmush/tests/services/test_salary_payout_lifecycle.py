"""Salary/retainer payout lifecycle — the P2 machinery.

SalaryPayout reuses the per-patient payout state machine and money path, so
these tests pin the pieces that make that safe to share: the billing-type guard
on generation, hold stamping, the transfer-ref prefix the webhook routes on,
the amount column each rail pays from, maturity promotion, the in-flight guard
that protects a bank account mid-transfer, and reconciliation — for BOTH rails.

Cashfree is never actually called; the beneficiary/transfer layer is
monkeypatched so the state transitions are exercised without a network.
"""
import uuid
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import (
    DoctorBillingType, PayoutStatus, SalaryPayout, DoctorPayout,
    ProfileBankAccount,
)
from app.api.common.payment import billing_service as bsvc
from app.api.common.payment import beneficiary_service as bene
from app.api.common.payment import cashfree_payout as cf
from app.api.common.payment.billing_service import (
    get_or_create_billing_profile, generate_salary_payout, disburse_payout,
    promote_matured_payouts, reconcile_processing_payouts, payable_amount,
    _is_salary, _next_transfer_ref, _transfer_remarks, recompute_salary_net,
)
from tests.services.test_compensation_and_salary_adjustments import _make_doctor


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def employee(app, db_session, fresh_tenant):
    """An EMPLOYEE doctor with a ₹20,000 salary override and a billing profile."""
    doctor = _make_doctor(fresh_tenant)
    profile = get_or_create_billing_profile(doctor)
    profile.billing_type = DoctorBillingType.EMPLOYEE
    profile.salary_override = Decimal('20000')
    db.session.commit()
    return doctor, profile


@pytest.fixture
def consultant(app, db_session, fresh_tenant):
    """A CONSULTANT doctor with a ₹8,000 retainer override."""
    doctor = _make_doctor(fresh_tenant)
    profile = get_or_create_billing_profile(doctor)
    profile.billing_type = DoctorBillingType.CONSULTANT
    profile.retainer_override = Decimal('8000')
    db.session.commit()
    return doctor, profile


def _bank(doctor, *, verified=True):
    """A primary bank account for the doctor, optionally a verified beneficiary."""
    from app.models import get_or_create_profile_owner
    owner = get_or_create_profile_owner('doctor', doctor.id, doctor.tenant_id)
    acc = ProfileBankAccount(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id, order_index=0,
        profile_owner_id=owner.id,
        bank_name='Test Bank', account_name='Test', account_number='000111222333',
        ifsc_code='SBIN0001234',
        cashfree_beneficiary_id='BENE_TEST' if verified else None,
        beneficiary_status='verified' if verified else 'none',
    )
    db.session.add(acc)
    db.session.commit()
    return acc


# ── generation + billing-type guard ─────────────────────────────────────────

class TestGenerateSalaryPayout:

    def test_employee_salary_is_generated_and_hold_stamped(self, employee):
        doctor, profile = employee
        sp = generate_salary_payout(doctor, date(2026, 1, 1), date(2026, 1, 31), kind='salary')
        assert sp.status == PayoutStatus.PENDING          # T==0 → PENDING by design
        assert sp.payout_mode is not None                 # mode snapshotted by apply_hold
        assert sp.gross_salary == Decimal('20000.00')
        assert sp.net_amount == Decimal('20000.00')

    def test_hold_days_put_salary_on_hold(self, employee):
        doctor, profile = employee
        profile.hold_days_override = 5
        db.session.commit()
        sp = generate_salary_payout(doctor, date(2026, 2, 1), date(2026, 2, 28), kind='salary')
        assert sp.status == PayoutStatus.ON_HOLD
        assert sp.hold_until is not None and sp.hold_until > datetime.now(timezone.utc)

    def test_salary_pins_the_primary_bank_account(self, employee):
        doctor, profile = employee
        acc = _bank(doctor)
        sp = generate_salary_payout(doctor, date(2026, 3, 1), date(2026, 3, 31), kind='salary')
        assert sp.bank_account_id == acc.id, 'destination pinned at creation, not transfer time'

    @pytest.mark.parametrize('billing_type,kind,ok', [
        (DoctorBillingType.EMPLOYEE, 'salary', True),
        (DoctorBillingType.EMPLOYEE, 'retainer', False),
        (DoctorBillingType.CONSULTANT, 'retainer', True),
        (DoctorBillingType.CONSULTANT, 'salary', False),
        (DoctorBillingType.PLAN, 'salary', False),
        (DoctorBillingType.PLAN, 'retainer', False),
    ])
    def test_billing_type_guard(self, employee, billing_type, kind, ok):
        doctor, profile = employee
        profile.billing_type = billing_type
        profile.salary_override = Decimal('20000')
        profile.retainer_override = Decimal('8000')
        db.session.commit()
        if ok:
            sp = generate_salary_payout(doctor, date(2026, 4, 1), date(2026, 4, 30), kind=kind)
            assert sp.kind == kind
        else:
            with pytest.raises(ValueError, match='only valid for'):
                generate_salary_payout(doctor, date(2026, 4, 1), date(2026, 4, 30), kind=kind)

    def test_unknown_kind_rejected(self, employee):
        doctor, _ = employee
        with pytest.raises(ValueError, match="'salary' or 'retainer'"):
            generate_salary_payout(doctor, date(2026, 5, 1), date(2026, 5, 31), kind='bonus')

    def test_duplicate_period_rejected(self, employee):
        doctor, _ = employee
        generate_salary_payout(doctor, date(2026, 6, 1), date(2026, 6, 30), kind='salary')
        with pytest.raises(ValueError, match='already exists'):
            generate_salary_payout(doctor, date(2026, 6, 1), date(2026, 6, 30), kind='salary')

    def test_missing_amount_rejected(self, employee):
        doctor, profile = employee
        profile.salary_override = None      # no override, no plan default, no legacy
        db.session.commit()
        with pytest.raises(ValueError, match='No salary/retainer configured'):
            generate_salary_payout(doctor, date(2026, 7, 1), date(2026, 7, 31), kind='salary')


# ── the three things that differ between the two rails ──────────────────────

class TestDisbursalHelpers:
    # These probe pure functions on the objects, so the rows are transient
    # (explicit id, never inserted) — avoids DoctorPayout's NOT NULL appointment_id
    # and keeps the checks about the helpers, not the schema.

    def _salary(self, doctor):
        return SalaryPayout(
            id=uuid.uuid4(), tenant_id=doctor.tenant_id, doctor_id=doctor.id,
            period_start=date(2026, 1, 1), period_end=date(2026, 1, 31),
            kind='salary', gross_salary=Decimal('20000'), deductions=Decimal('0'),
            net_amount=Decimal('20000'), status=PayoutStatus.CLAIMABLE,
        )

    def _patient_payout(self, doctor):
        return DoctorPayout(
            id=uuid.uuid4(), tenant_id=doctor.tenant_id, doctor_id=doctor.id,
            bill_number='JLH0001', payment_amount=Decimal('1000'),
            total_charges=Decimal('100'), taxes_gst=Decimal('0'),
            tds_amount=Decimal('0'), razorpay_fee=Decimal('0'),
            payout_amount=Decimal('900'), status=PayoutStatus.CLAIMABLE,
        )

    def test_is_salary_discriminates(self, employee):
        doctor, _ = employee
        assert _is_salary(self._salary(doctor)) is True
        assert _is_salary(self._patient_payout(doctor)) is False

    def test_transfer_ref_prefix_routes_the_webhook(self, employee):
        doctor, _ = employee
        assert _next_transfer_ref(self._salary(doctor)).startswith('sp')
        assert _next_transfer_ref(self._patient_payout(doctor)).startswith('po')

    def test_payable_amount_per_rail(self, employee):
        doctor, _ = employee
        sp = self._salary(doctor)
        dp = self._patient_payout(doctor)
        assert payable_amount(sp) == sp.net_amount == Decimal('20000')
        assert payable_amount(dp) == dp.payout_amount == Decimal('900')

    def test_transfer_remarks_per_rail(self, employee):
        doctor, _ = employee
        assert 'salary' in _transfer_remarks(self._salary(doctor))
        assert _transfer_remarks(self._patient_payout(doctor)) == 'JLH0001'


# ── maturity + in-flight guard + reconciliation, for salary ─────────────────

class TestLifecycleSweeps:

    def _salary(self, doctor, *, status, hold_delta=None, mode='claim', bank=None):
        sp = SalaryPayout(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id,
            period_start=date(2026, 8, 1), period_end=date(2026, 8, 31),
            kind='salary', gross_salary=Decimal('20000'), deductions=Decimal('0'),
            net_amount=Decimal('20000'), status=status, payout_mode=mode,
            hold_until=(datetime.now(timezone.utc) + hold_delta) if hold_delta else None,
            bank_account_id=bank.id if bank else None,
            razorpay_transfer_id='sptest' if status == PayoutStatus.PROCESSING else None,
        )
        db.session.add(sp); db.session.commit()
        return sp

    def test_matured_claim_salary_becomes_claimable(self, employee):
        doctor, _ = employee
        matured = self._salary(doctor, status=PayoutStatus.ON_HOLD, hold_delta=timedelta(days=-1), mode='claim')
        promote_matured_payouts(doctor.tenant_id)
        db.session.refresh(matured)
        assert matured.status == PayoutStatus.CLAIMABLE

    def test_future_hold_is_untouched(self, employee):
        doctor, _ = employee
        future = self._salary(doctor, status=PayoutStatus.ON_HOLD, hold_delta=timedelta(days=5), mode='claim')
        promote_matured_payouts(doctor.tenant_id)
        db.session.refresh(future)
        assert future.status == PayoutStatus.ON_HOLD

    def test_in_flight_counts_salary_and_protects_bank(self, employee):
        doctor, _ = employee
        acc = _bank(doctor)
        assert bene.in_flight_payouts(acc) == 0
        self._salary(doctor, status=PayoutStatus.PROCESSING, bank=acc)
        assert bene.in_flight_payouts(acc) == 1, 'a moving salary must lock its bank account'

    def test_reconcile_marks_salary_completed(self, employee, monkeypatch):
        doctor, _ = employee
        sp = self._salary(doctor, status=PayoutStatus.PROCESSING)
        monkeypatch.setattr(cf, 'is_configured', lambda: True)
        monkeypatch.setattr(cf, 'get_transfer_status', lambda ref: {'data': {'status': 'SUCCESS'}})
        stats = reconcile_processing_payouts(doctor.tenant_id)
        db.session.refresh(sp)
        assert sp.status == PayoutStatus.COMPLETED
        assert stats['completed'] >= 1


# ── disburse_payout gating (shared money path) ──────────────────────────────

class TestDisbursePayout:

    def _claimable_salary(self, doctor, bank=None):
        sp = SalaryPayout(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id,
            period_start=date(2026, 9, 1), period_end=date(2026, 9, 30),
            kind='salary', gross_salary=Decimal('20000'), deductions=Decimal('0'),
            net_amount=Decimal('20000'), status=PayoutStatus.CLAIMABLE,
            bank_account_id=bank.id if bank else None,
        )
        db.session.add(sp); db.session.commit()
        return sp

    def test_refuses_when_cashfree_not_configured(self, employee, monkeypatch):
        doctor, _ = employee
        sp = self._claimable_salary(doctor, _bank(doctor))
        monkeypatch.setattr(cf, 'is_configured', lambda: False)
        ok, msg = disburse_payout(sp)
        assert ok is False and 'not configured' in msg
        assert sp.status == PayoutStatus.CLAIMABLE, 'no money, no state change'

    def test_refuses_without_verified_beneficiary(self, employee, monkeypatch):
        doctor, _ = employee
        sp = self._claimable_salary(doctor, _bank(doctor, verified=False))
        monkeypatch.setattr(cf, 'is_configured', lambda: True)
        ok, msg = disburse_payout(sp)
        assert ok is False and 'beneficiary' in msg.lower()

    def test_happy_path_sends_and_goes_processing(self, employee, monkeypatch):
        doctor, _ = employee
        acc = _bank(doctor)
        sp = self._claimable_salary(doctor, acc)
        monkeypatch.setattr(cf, 'is_configured', lambda: True)
        sent = {}
        def _fake_transfer(bank, *, amount, transfer_id, remarks=None):
            sent.update(amount=amount, transfer_id=transfer_id)
            return {'status': 'RECEIVED'}
        monkeypatch.setattr(bene, 'disburse_to_bank', _fake_transfer)

        ok, msg = disburse_payout(sp)
        assert ok is True
        assert sp.status == PayoutStatus.PROCESSING
        assert sent['amount'] == Decimal('20000'), 'pays the salary net, not a per-patient amount'
        assert sent['transfer_id'].startswith('sp'), 'salary transfer ref'

    def test_zero_amount_is_not_sent(self, employee, monkeypatch):
        doctor, _ = employee
        sp = self._claimable_salary(doctor, _bank(doctor))
        sp.net_amount = Decimal('0'); db.session.commit()
        monkeypatch.setattr(cf, 'is_configured', lambda: True)
        called = {'n': 0}
        monkeypatch.setattr(bene, 'disburse_to_bank',
                            lambda *a, **k: called.__setitem__('n', called['n'] + 1))
        ok, msg = disburse_payout(sp)
        assert ok is False and called['n'] == 0, 'never fire a zero-value transfer'
