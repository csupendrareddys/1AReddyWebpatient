"""
Payment models: Payment, BillingConfig, DoctorPayout.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON, JSONB

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import PaymentStatus, PayoutStatus


class Payment(TenantMixin, db.Model):
    """Payment transactions."""
    __tablename__ = 'payments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='payment_id')
    # A payment settles EITHER an appointment OR a marketplace order (service /
    # group-service purchase) — exactly one of these is set. Both nullable so
    # the same Razorpay create-order/verify/webhook path serves both.
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id'), nullable=True, index=True)
    order_id = db.Column(UUID(as_uuid=True), db.ForeignKey('marketplace_orders.order_id', ondelete='SET NULL'), nullable=True, index=True)
    # A payment may instead settle one installment of a Group Offering plan
    # booking (same Razorpay create-order/verify path).
    booking_installment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offering_booking_installments.booking_installment_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    # A payment may instead settle a membership-plan activation/renewal/upgrade
    # for a plan-based provider (same Razorpay create-order/verify path). Its
    # chosen period is recorded in ``payment_metadata`` so verify can set the
    # subscription's new period window.
    membership_subscription_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_subscriptions.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    # A payment may instead settle one period of the tenant's own SaaS
    # subscription (tenant → vendor). These are the ONLY payments that run on
    # the vendor's Razorpay keys — everything above runs on the tenant's own
    # gateway config. The paid period is in ``payment_metadata`` so verify /
    # webhook can extend ``TenantSubscription.current_period_end``.
    tenant_subscription_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenant_subscriptions.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=False, index=True)

    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(10), default='INR', nullable=False)
    payment_gateway = db.Column(db.String(100), nullable=True)
    transaction_id = db.Column(db.String(200), nullable=True, index=True)
    gateway_order_id = db.Column(db.String(200), nullable=True)
    status = db.Column(db.Enum(PaymentStatus), default=PaymentStatus.PENDING, nullable=False, index=True)
    payment_metadata = db.Column(JSON, nullable=True)

    payment_date = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    appointment = db.relationship('Appointment', back_populates='payments')
    order = db.relationship('MarketplaceOrder', foreign_keys=[order_id])

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'transaction_id', name='uq_payment_tenant_transaction_id'),
        Index('ix_payments_tenant_status_date', 'tenant_id', 'status', 'payment_date'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'amount': str(self.amount),
            'currency': self.currency,
            'status': self.status.value,
            'transaction_id': self.transaction_id,
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'order_id': str(self.order_id) if self.order_id else None,
            'booking_installment_id': str(self.booking_installment_id) if self.booking_installment_id else None,
            'tenant_subscription_id': str(self.tenant_subscription_id) if self.tenant_subscription_id else None,
            'payment_date': self.payment_date.isoformat() if self.payment_date else None,
        }

    def __repr__(self):
        return f"<Payment {self.id} - {self.status.value}>"


class BillingConfig(TenantMixin, db.Model):
    """Platform billing configuration."""
    __tablename__ = 'billing_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='billing_config_id')

    # Charge 1
    charge1_name = db.Column(db.String(100), default='Platform Fee', nullable=False)
    charge1_type = db.Column(db.String(20), default='percentage', nullable=False)
    charge1_value = db.Column(db.Numeric(10, 4), default=0, nullable=False)

    # Charge 2
    charge2_name = db.Column(db.String(100), default='Service Fee', nullable=False)
    charge2_type = db.Column(db.String(20), default='percentage', nullable=False)
    charge2_value = db.Column(db.Numeric(10, 4), default=0, nullable=False)

    # Charge 3
    charge3_name = db.Column(db.String(100), default='Processing Fee', nullable=False)
    charge3_type = db.Column(db.String(20), default='percentage', nullable=False)
    charge3_value = db.Column(db.Numeric(10, 4), default=0, nullable=False)

    # ── Tax: the DOCTOR's supply (professional / healthcare service) ────
    # The doctor's quoted fee is TAX-INCLUSIVE (the Pricing tab tells them it
    # "is your payout amount"), so GST here is carved OUT of that fee — never
    # added on top, and never levied on the platform's markup as well. See
    # ``app/common/tax.py``.
    cgst_rate = db.Column(db.Numeric(5, 2), default=9.0, nullable=False)
    sgst_rate = db.Column(db.Numeric(5, 2), default=9.0, nullable=False)
    # IGST for an inter-state supply. IGST == CGST + SGST; NULL means "derive
    # it", so an existing tenant keeps behaving as before without a data fix.
    igst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    # none | intra_state | inter_state | auto  (mirrors DoctorProduct.tax_mode,
    # plus ``auto`` = decide from place of supply). ``none`` is the
    # Notification 12/2017-CT(R) Entry 74 healthcare exemption.
    doctor_tax_mode = db.Column(db.String(20), default='auto', nullable=False,
                                server_default='auto')

    # Per-consultation-type overrides. Shape:
    #   {"video": {"cgst": 9, "sgst": 9}, "home_visit": {"cgst": 2.5, "sgst": 2.5}}
    # Optional extra keys per entry: "igst" (defaults to cgst+sgst) and "mode"
    # (defaults to doctor_tax_mode). Any consultation type NOT listed here
    # falls back to the flat rates above (non-breaking default). Nullable — an
    # empty/absent map means "every type uses the flat pair", exactly as before.
    gst_by_consultation_type = db.Column(JSONB, nullable=True)

    # ── Tax: the PLATFORM's supply (facilitation / intermediary service) ──
    # A distinct supply with its own taxable value (display price − doctor fee)
    # and its own rate — standard-rated 18% today, independent of whatever the
    # healthcare supply attracts.
    platform_fee_cgst_rate = db.Column(db.Numeric(5, 2), default=9.0,
                                       nullable=False, server_default='9.0')
    platform_fee_sgst_rate = db.Column(db.Numeric(5, 2), default=9.0,
                                       nullable=False, server_default='9.0')
    platform_fee_igst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    platform_tax_mode = db.Column(db.String(20), default='auto', nullable=False,
                                  server_default='auto')
    # True: the patient pays exactly the display price and the platform's GST
    # is carved out of the margin. False: it is added on top of the display
    # price. Inclusive is the default because the display price is the amount
    # actually charged.
    platform_fee_tax_inclusive = db.Column(db.Boolean, default=True,
                                           nullable=False, server_default='true')

    # TDS rate (s.194J professional fees). Deducted from the DOCTOR's fee.
    tds_rate = db.Column(db.Numeric(5, 2), default=10.0, nullable=False)
    # CBDT Circular 23/2017: TDS is on the amount excluding GST when the GST is
    # separately identifiable — which it is here, since we carve it out.
    tds_exclude_gst = db.Column(db.Boolean, default=True, nullable=False,
                                server_default='true')

    # Tenant-default hold period (T days) before a Plan doctor's completed-
    # appointment earning becomes payable/claimable. Per-doctor override lives
    # on DoctorBillingProfile; plan-level override on TenantProviderPlan.features.
    default_hold_days = db.Column(db.Integer, default=0, nullable=False, server_default='0')

    # ── Platform-wide discount ───────────────────────────────────────────
    # One tenant-wide % off every patient-facing price — a site-wide sale, not
    # a per-offering markdown. It is the LAST reduction baked into the price a
    # patient is quoted, and it is what the struck-through "was" figure on
    # every card is measured against.
    #
    # Three reductions exist and they are not interchangeable:
    #   * ``DisplayPricingRule`` — SUPER_ADMIN's markup/markdown for ONE
    #     doctor × offering, plus its vouchers/coupons. Baked silently into
    #     the price; never shown as a strikethrough, because it is per-row and
    #     a card full of individually-struck rows reads as chaos.
    #   * this column — one number for the whole tenant. Baked in AND shown,
    #     since a single site-wide figure is a claim the whole page can make.
    #   * ``MembershipPlan.member_discount_pct`` — depends on WHO is buying,
    #     so it cannot be in a quoted price at all. Applied at purchase and
    #     surfaced as the "Applicable at billing" chip.
    #
    # Not nullable with a 0 default: "no sale on" is a real, common state, and
    # a NULL here would only add a branch to every reader.
    platform_discount_pct = db.Column(
        db.Numeric(5, 2), default=0, nullable=False, server_default='0',
    )

    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Bill template content
    bill_company_name = db.Column(db.String(300), default='JL Triangle Private Limited', nullable=False)
    bill_company_tagline = db.Column(db.String(300), default='A Practo Group Company', nullable=False)
    bill_pan = db.Column(db.String(50), default='AAFCJ1085J', nullable=False)
    bill_gst_reg = db.Column(db.String(50), default='36AAFCJ1085J1ZF', nullable=False)
    bill_cin = db.Column(db.String(50), default='U72900TG2021PTC148836', nullable=False)
    bill_sac = db.Column(db.String(20), default='9993', nullable=False)
    bill_support_email = db.Column(db.String(200), default='support@jlmush.com', nullable=False)
    bill_footer_note = db.Column(db.Text, default='Healthcare services exempt from GST', nullable=False)
    bill_logo_url = db.Column(db.String(500), nullable=True)

    def to_dict(self):
        return {
            'id': str(self.id),
            'charge1_name': self.charge1_name,
            'charge1_type': self.charge1_type,
            'charge1_value': str(self.charge1_value),
            'charge2_name': self.charge2_name,
            'charge2_type': self.charge2_type,
            'charge2_value': str(self.charge2_value),
            'charge3_name': self.charge3_name,
            'charge3_type': self.charge3_type,
            'charge3_value': str(self.charge3_value),
            'cgst_rate': str(self.cgst_rate),
            'sgst_rate': str(self.sgst_rate),
            'igst_rate': str(self.igst_rate) if self.igst_rate is not None else None,
            'doctor_tax_mode': self.doctor_tax_mode,
            'gst_by_consultation_type': self.gst_by_consultation_type or {},
            'platform_fee_cgst_rate': str(self.platform_fee_cgst_rate),
            'platform_fee_sgst_rate': str(self.platform_fee_sgst_rate),
            'platform_fee_igst_rate': (
                str(self.platform_fee_igst_rate)
                if self.platform_fee_igst_rate is not None else None),
            'platform_tax_mode': self.platform_tax_mode,
            'platform_fee_tax_inclusive': bool(self.platform_fee_tax_inclusive),
            'tds_rate': str(self.tds_rate),
            'tds_exclude_gst': bool(self.tds_exclude_gst),
            'default_hold_days': self.default_hold_days,
            'platform_discount_pct': float(self.platform_discount_pct or 0),
            'is_active': self.is_active,
            'bill_company_name': self.bill_company_name,
            'bill_company_tagline': self.bill_company_tagline,
            'bill_pan': self.bill_pan,
            'bill_gst_reg': self.bill_gst_reg,
            'bill_cin': self.bill_cin,
            'bill_sac': self.bill_sac,
            'bill_support_email': self.bill_support_email,
            'bill_footer_note': self.bill_footer_note,
            'bill_logo_url': self.bill_logo_url,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<BillingConfig {self.id} active={self.is_active}>"


class DoctorPayout(TenantMixin, db.Model):
    """Tracks payouts from the platform to doctors via Razorpay."""
    __tablename__ = 'doctor_payouts'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='payout_id')
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    # A payout is anchored to a source. Historically always an appointment; now
    # also a Group Offering plan installment or an individual service order.
    # ``source_type`` says which; ``source_ref_id`` points at the installment/
    # order (no hard FK — loose link so the payout survives source cleanup).
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id'), nullable=True, index=True)
    source_type = db.Column(db.String(30), nullable=False, default='appointment', index=True)  # appointment|plan_installment|service_order
    source_ref_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    source_label = db.Column(db.String(200), nullable=True)  # e.g. "Longevity Plan — Cardiology (inst 1/2)"
    payment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('payments.payment_id'), nullable=True, index=True)

    bill_number = db.Column(db.String(50), nullable=False, index=True)

    appointment_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    payment_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    total_charges = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    taxes_gst = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    tds_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    razorpay_fee = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    payout_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    charge1_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    charge2_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    charge3_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    # Per-charge breakdown snapshotted at payout creation so the charge TAX is
    # visible on the payout even after the plan's ChargePolicy is later retuned:
    # ``[{name, base_charge, tax, total}, ...]`` (from
    # ``billing_service.compute_platform_charges_detail``).
    charges_snapshot = db.Column(JSONB, nullable=True)

    # NOTE: targets `profile_bank_accounts` (ProfileBankAccount) — the legacy
    # `doctor_bank_accounts` table was removed when bank details were merged
    # into the shared profile sub-models.
    bank_account_id = db.Column(UUID(as_uuid=True), db.ForeignKey('profile_bank_accounts.id'), nullable=True)

    razorpay_transfer_id = db.Column(db.String(200), nullable=True, index=True)
    razorpay_payout_id = db.Column(db.String(200), nullable=True)

    status = db.Column(db.Enum(PayoutStatus, values_callable=lambda e: [x.value for x in e]), default=PayoutStatus.PENDING, nullable=False, index=True)
    status_reason = db.Column(db.Text, nullable=True)

    # T-day hold / claim (Phase 1). When held, status=ON_HOLD until hold_until;
    # then the scheduler promotes to PENDING (autopay) or CLAIMABLE (claim).
    # payout_mode is a snapshot of the doctor's mode at payout creation.
    hold_until = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    payout_mode = db.Column(db.String(20), nullable=True)
    claim_requested_at = db.Column(db.DateTime(timezone=True), nullable=True)
    claimed_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)

    consultation_type = db.Column(db.String(100), nullable=True)

    initiated_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    initiated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    doctor = db.relationship('Doctor', backref=db.backref('payouts', lazy='dynamic'))
    appointment = db.relationship('Appointment', backref=db.backref('payout', uselist=False))
    payment = db.relationship('Payment')
    bank_account = db.relationship('ProfileBankAccount')

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'bill_number', name='uq_doctor_payout_tenant_bill_number'),
        Index('ix_payout_tenant_doctor_status', 'tenant_id', 'doctor_id', 'status'),
        Index('ix_payout_tenant_created', 'tenant_id', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'payment_id': str(self.payment_id) if self.payment_id else None,
            'bill_number': self.bill_number,
            'source_type': self.source_type,
            'source_ref_id': str(self.source_ref_id) if self.source_ref_id else None,
            'source_label': self.source_label,
            'appointment_amount': str(self.appointment_amount),
            'payment_amount': str(self.payment_amount),
            'total_charges': str(self.total_charges),
            'taxes_gst': str(self.taxes_gst),
            'tds_amount': str(self.tds_amount),
            'razorpay_fee': str(self.razorpay_fee),
            'payout_amount': str(self.payout_amount),
            'charge1_amount': str(self.charge1_amount),
            'charge2_amount': str(self.charge2_amount),
            'charge3_amount': str(self.charge3_amount),
            'charges_snapshot': self.charges_snapshot or [],
            'razorpay_transfer_id': self.razorpay_transfer_id,
            'status': self.status.value,
            'status_reason': self.status_reason,
            'hold_until': self.hold_until.isoformat() if self.hold_until else None,
            'payout_mode': self.payout_mode,
            'claim_requested_at': self.claim_requested_at.isoformat() if self.claim_requested_at else None,
            'consultation_type': self.consultation_type,
            'initiated_at': self.initiated_at.isoformat() if self.initiated_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<DoctorPayout {self.bill_number} {self.status.value}>"
