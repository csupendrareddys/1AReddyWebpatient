"""
Doctor billing profile — per-doctor payout configuration.

Kept as a dedicated 1:1 table (not columns on the already-large Doctor model)
so the payout config can grow per phase without bloating every doctor read:
  * Phase 1 — billing_type (plan default), payout_mode (autopay|claim), hold_days_override.
  * Phase 2 — active_agreement_id → DoctorEmploymentAgreement.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, AuditMixin, utcnow
from app.models._enums import (
    DoctorBillingType, PayoutMode, SalaryCadence, PlatformFeeMode, PayoutStatus,
)

_enum_values = lambda e: [x.value for x in e]  # store enum .value (lowercase)


class DoctorBillingProfile(TenantMixin, TimestampMixin, AuditMixin, db.Model):
    """One row per doctor: which billing bucket + how they're released/paid."""
    __tablename__ = 'doctor_billing_profiles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='billing_profile_id')
    doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, unique=True, index=True,
    )

    billing_type = db.Column(
        db.Enum(DoctorBillingType, values_callable=_enum_values),
        default=DoctorBillingType.PLAN, nullable=False,
    )
    payout_mode = db.Column(
        db.Enum(PayoutMode, values_callable=_enum_values),
        default=PayoutMode.AUTOPAY, nullable=False,
    )
    # Per-doctor override of the T-day hold; None → falls back to plan / tenant.
    hold_days_override = db.Column(db.Integer, nullable=True)

    # Per-doctor TDS rate (%) override; None → falls back to the tenant-wide flat
    # BillingConfig.tds_rate. This is how one doctor gets a different TDS from the
    # rest (e.g. a different PAN / section), mirroring hold_days_override.
    tds_rate_override = db.Column(db.Numeric(5, 2), nullable=True)

    # Per-doctor salary / retainer override (Item 2B) — layered on top of the
    # plan's default_monthly_salary / default_base_retainer. None → use the plan
    # default. This is how two doctors on the same plan get different pay.
    salary_override = db.Column(db.Numeric(10, 2), nullable=True)
    retainer_override = db.Column(db.Numeric(10, 2), nullable=True)

    # Per-doctor override of the family-doctor second-opinion credit grant;
    # None → falls back to the doctor's plan CreditPolicy.second_opinion_grant.
    second_opinion_rate_override = db.Column(db.Numeric(10, 2), nullable=True)

    # The employment/consultant agreement in force (Phase 2/3).
    # (Legacy — retained for existing rows; plan+override is the new source.)
    active_agreement_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctor_employment_agreements.agreement_id', ondelete='SET NULL'),
        nullable=True,
    )

    doctor = db.relationship('Doctor', backref=db.backref('billing_profile', uselist=False))
    active_agreement = db.relationship('DoctorEmploymentAgreement', foreign_keys=[active_agreement_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'billing_type': self.billing_type.value if self.billing_type else 'plan',
            'payout_mode': self.payout_mode.value if self.payout_mode else 'autopay',
            'hold_days_override': self.hold_days_override,
            'tds_rate_override': float(self.tds_rate_override) if self.tds_rate_override is not None else None,
            'salary_override': float(self.salary_override) if self.salary_override is not None else None,
            'retainer_override': float(self.retainer_override) if self.retainer_override is not None else None,
            'second_opinion_rate_override': (
                float(self.second_opinion_rate_override)
                if self.second_opinion_rate_override is not None else None
            ),
            'active_agreement_id': str(self.active_agreement_id) if self.active_agreement_id else None,
        }

    def __repr__(self):
        return f'<DoctorBillingProfile doctor={self.doctor_id} {self.billing_type.value}>'


class DoctorEmploymentAgreement(TenantMixin, TimestampMixin, AuditMixin, db.Model):
    """Versioned employment / consultancy terms for a doctor (Phase 2/3).

    Effective-dated so salary runs reference the agreement in force for a
    period. Min-slot rules are TRACK + WARN only (never hard-block).
    """
    __tablename__ = 'doctor_employment_agreements'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='agreement_id')
    doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    billing_type = db.Column(
        db.Enum(DoctorBillingType, values_callable=_enum_values),
        default=DoctorBillingType.EMPLOYEE, nullable=False,
    )
    effective_from = db.Column(db.Date, nullable=True)
    effective_to = db.Column(db.Date, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    # Minimum slot requirements (hours). day_window_* enforces "day-time only".
    min_hours_per_day = db.Column(db.Numeric(5, 2), nullable=True)
    min_hours_per_week = db.Column(db.Numeric(6, 2), nullable=True)
    min_hours_per_month = db.Column(db.Numeric(7, 2), nullable=True)
    day_window_start = db.Column(db.Time, nullable=True)
    day_window_end = db.Column(db.Time, nullable=True)
    per_type_minimums = db.Column(JSON, nullable=True)   # {"chat": 2, "audio": 4} hours

    # Compensation
    monthly_salary = db.Column(db.Numeric(10, 2), default=0, nullable=False)
    payment_cadence = db.Column(
        db.Enum(SalaryCadence, values_callable=_enum_values),
        default=SalaryCadence.MONTHLY, nullable=False,
    )
    platform_fee_mode = db.Column(
        db.Enum(PlatformFeeMode, values_callable=_enum_values),
        default=PlatformFeeMode.ZERO, nullable=False,
    )
    platform_fee_value = db.Column(db.Numeric(10, 4), nullable=True)  # for CUSTOM mode

    # Consultant (Phase 3) — a base retainer on top of per-patient earnings.
    base_retainer_amount = db.Column(db.Numeric(10, 2), nullable=True)
    retainer_cadence = db.Column(
        db.Enum(SalaryCadence, values_callable=_enum_values), nullable=True,
    )

    notes = db.Column(db.Text, nullable=True)

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'billing_type': self.billing_type.value if self.billing_type else None,
            'effective_from': self.effective_from.isoformat() if self.effective_from else None,
            'effective_to': self.effective_to.isoformat() if self.effective_to else None,
            'is_active': self.is_active,
            'min_hours_per_day': str(self.min_hours_per_day) if self.min_hours_per_day is not None else None,
            'min_hours_per_week': str(self.min_hours_per_week) if self.min_hours_per_week is not None else None,
            'min_hours_per_month': str(self.min_hours_per_month) if self.min_hours_per_month is not None else None,
            'day_window_start': self.day_window_start.strftime('%H:%M') if self.day_window_start else None,
            'day_window_end': self.day_window_end.strftime('%H:%M') if self.day_window_end else None,
            'per_type_minimums': self.per_type_minimums or {},
            'monthly_salary': str(self.monthly_salary),
            'payment_cadence': self.payment_cadence.value if self.payment_cadence else 'monthly',
            'platform_fee_mode': self.platform_fee_mode.value if self.platform_fee_mode else 'zero',
            'platform_fee_value': str(self.platform_fee_value) if self.platform_fee_value is not None else None,
            'base_retainer_amount': str(self.base_retainer_amount) if self.base_retainer_amount is not None else None,
            'retainer_cadence': self.retainer_cadence.value if self.retainer_cadence else None,
            'notes': self.notes,
        }

    def __repr__(self):
        return f'<DoctorEmploymentAgreement doctor={self.doctor_id} {self.billing_type.value}>'


class SalaryPayout(TenantMixin, TimestampMixin, AuditMixin, db.Model):
    """A salary / retainer payment for one pay period. Settled by the admin,
    mirroring the DoctorPayout settle path (reuses PayoutStatus)."""
    __tablename__ = 'salary_payouts'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='salary_payout_id')
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    agreement_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_employment_agreements.agreement_id', ondelete='SET NULL'), nullable=True)

    period_start = db.Column(db.Date, nullable=False)
    period_end = db.Column(db.Date, nullable=False)
    kind = db.Column(db.String(20), default='salary', nullable=False)  # salary | retainer

    # ``gross_salary`` is the ORIGINAL configured amount and is never rewritten
    # after creation. Every later change is an append-only row in
    # ``salary_payout_adjustments`` summed into ``adjustments_total``, so
    # "expected vs approved + why" stays reconstructible forever rather than
    # relying on an audit log that could drift from the figure actually paid.
    gross_salary = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    adjustments_total = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    incentive_total = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    deductions = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    net_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    compliance_withheld = db.Column(db.Boolean, default=False, nullable=False)
    status = db.Column(
        db.Enum(PayoutStatus, values_callable=_enum_values),
        default=PayoutStatus.PENDING, nullable=False, index=True,
    )
    status_reason = db.Column(db.Text, nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # ── Shared payout lifecycle (mirrors DoctorPayout) ────────────────────
    # Salary rides the same ON_HOLD → push → CLAIMABLE → claim → PROCESSING →
    # webhook machinery as per-patient payouts, so there is one state machine
    # and one money path, and the admin still never moves money.
    bank_account_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('profile_bank_accounts.id', ondelete='SET NULL'),
        nullable=True,
    )
    hold_until = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    payout_mode = db.Column(db.String(20), nullable=True)  # autopay | claim
    claim_requested_at = db.Column(db.DateTime(timezone=True), nullable=True)
    claimed_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
    )
    # Cashfree transfer ref (``sp<hex>``); stored so a FAILED payout can be
    # retried under a fresh ref, exactly as DoctorPayout does.
    razorpay_transfer_id = db.Column(db.String(100), nullable=True)

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'doctor_id', 'period_start', 'period_end', 'kind',
                            name='uq_salary_payout_period'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'agreement_id': str(self.agreement_id) if self.agreement_id else None,
            'period_start': self.period_start.isoformat() if self.period_start else None,
            'period_end': self.period_end.isoformat() if self.period_end else None,
            'kind': self.kind,
            'gross_salary': str(self.gross_salary),
            'adjustments_total': str(self.adjustments_total or 0),
            'incentive_total': str(self.incentive_total or 0),
            'deductions': str(self.deductions),
            'net_amount': str(self.net_amount),
            'compliance_withheld': self.compliance_withheld,
            'status': self.status.value,
            'status_reason': self.status_reason,
            'hold_until': self.hold_until.isoformat() if self.hold_until else None,
            'payout_mode': self.payout_mode,
            'bank_account_id': str(self.bank_account_id) if self.bank_account_id else None,
            'claim_requested_at': self.claim_requested_at.isoformat() if self.claim_requested_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            # Always shipped with the payout: the doctor is entitled to see why
            # the approved amount differs from the expected one, wherever the
            # payout is rendered, without a second call.
            'adjustments': [a.to_dict() for a in self.adjustments],
        }

    def __repr__(self):
        return f'<SalaryPayout doctor={self.doctor_id} {self.period_start}..{self.period_end} {self.status.value}>'


class SalaryPayoutAdjustment(TenantMixin, TimestampMixin, db.Model):
    """One admin correction to a salary payout — append-only, never edited.

    Healthcare payroll needs to explain a difference months later ("why was
    April ₹18,500 when the salary is ₹20,000?"). Storing only the final figure
    loses that, and mutating ``gross_salary`` would destroy the original
    outright. So the original stays untouched on the payout and every change is
    a row here: amount (signed — negative for leave-without-pay or a penalty,
    positive for a bonus), a MANDATORY reason, who did it and when.

    There is deliberately no update or delete path. A mistaken adjustment is
    corrected by adding an opposing one, so the history always reconstructs the
    figure that was actually paid.
    """
    __tablename__ = 'salary_payout_adjustments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='adjustment_id')
    salary_payout_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('salary_payouts.salary_payout_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # Signed: negative reduces the payout, positive increases it.
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    kind = db.Column(db.String(20), nullable=False, default='correction')  # lwp|penalty|bonus|correction
    reason = db.Column(db.Text, nullable=False)
    created_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
    )

    salary_payout = db.relationship(
        'SalaryPayout',
        backref=db.backref('adjustments', order_by='SalaryPayoutAdjustment.created_at',
                           cascade='all, delete-orphan'),
    )
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    VALID_KINDS = ('lwp', 'penalty', 'bonus', 'correction')

    def to_dict(self):
        actor = None
        if self.created_by:
            actor = f'{self.created_by.first_name or ""} {self.created_by.last_name or ""}'.strip() \
                or self.created_by.email
        return {
            'id': str(self.id),
            'salary_payout_id': str(self.salary_payout_id),
            'amount': str(self.amount),
            'kind': self.kind,
            'reason': self.reason,
            'created_by_id': str(self.created_by_id) if self.created_by_id else None,
            'created_by_name': actor,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<SalaryPayoutAdjustment {self.kind} {self.amount} payout={self.salary_payout_id}>'
