"""
Group Offering (multidisciplinary healthcare plan) models.

A Group Offering is an ADMIN-authored, patient-bookable plan that bundles a
set of qualification "slots" (e.g. Cardiologist ×10 consults, Dietitian ×6)
into one priced package with a fixed duration. Each slot carries its own
consultation count, min/max call time, an allocated doctor budget, and (once
allocated by the admin) a specific doctor.

This is distinct from ``MarketplaceServiceGroup`` (the doctor-led group
offering that a lead doctor assembles from their network). That feature is
untouched; this is a new, richer, admin-only entity per the plan builder spec.

Phase 1 covers the plan + its qualification slots (this file). Payment
schedule / installments (Section 3) and per-doctor payout wiring land in
later phases.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, utcnow


# Duration presets offered on the builder. ``custom`` uses duration_value as a
# raw day count; the presets resolve to these day counts for display / summary.
DURATION_PRESET_DAYS = {
    '15_days': 15,
    '1_month': 30,
    '3_months': 90,
    '6_months': 180,
    '12_months': 365,
}


class GroupOffering(TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model):
    """An admin-authored multidisciplinary healthcare plan."""
    __tablename__ = 'group_offerings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='group_offering_id')

    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(100), nullable=False, default='Healthcare Plan')
    product_category=db.Column(db.String(100), nullable=False)
    # Duration: a preset key ('15_days', '1_month', …, or 'custom') plus the
    # resolved day count. Presets resolve via DURATION_PRESET_DAYS; 'custom'
    # stores the operator's raw day count in duration_value.
    duration_type = db.Column(db.String(20), nullable=False, default='1_month')
    duration_value = db.Column(db.Integer, nullable=False, default=30)

    patient_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    doctor_budget = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    description = db.Column(db.Text, nullable=True)

    # Tax (Section 3). Healthcare is GST-exempt by default (tax_mode='none');
    # an operator can charge intra-state (CGST + SGST) or inter-state (IGST).
    # Rates are per-plan so the plan carries its own tax the way the spec asks.
    tax_mode = db.Column(db.String(20), nullable=False, default='none')  # none|intra_state|inter_state
    cgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    sgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    igst_rate = db.Column(db.Numeric(5, 2), nullable=True)

    # Working hours (per plan): voice/video calls can only happen and chat is
    # only allowed within this daily window, per weekday, in the tenant's local
    # time. Shape: {"mon": {"open": "09:00", "close": "20:00", "closed": false},
    # ... "sun": {...}}. Empty/None = always open.
    working_hours = db.Column(db.JSON, nullable=True)

    # Audience targeting — same shape as ``DoctorProduct.targeting``.
    # Config-only until the patient-list reordering phase lands.
    targeting = db.Column(db.JSON, nullable=True)

    # draft → published → archived. Publish is gated (all slots allocated,
    # budget valid, ≥1 slot) in the service layer.
    status = db.Column(db.String(20), nullable=False, default='draft', index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True, index=True)

    # A hidden DoctorProduct that backs the plan's communication channels — the
    # channel machinery (PurchasedService / ServiceChannel) is product-scoped,
    # so a plan needs a product + communication config for its team chat/calls
    # to open. Created on publish; the team's product_id points to it.
    backing_product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    members = db.relationship(
        'GroupOfferingMember', back_populates='offering',
        cascade='all, delete-orphan', lazy='selectin',
        order_by='GroupOfferingMember.sort_order',
    )
    installments = db.relationship(
        'GroupOfferingInstallment', back_populates='offering',
        cascade='all, delete-orphan', lazy='selectin',
        order_by='GroupOfferingInstallment.installment_no',
    )

    @property
    def total_consultations(self):
        return sum((m.max_consultations or 0) for m in self.members)

    @property
    def allocated_budget_total(self):
        return sum((float(m.allocated_budget or 0)) for m in self.members)

    @property
    def doctors_included(self):
        return len({str(m.doctor_id) for m in self.members if m.doctor_id})

    @property
    def platform_margin(self):
        return float(self.patient_price or 0) - float(self.doctor_budget or 0)

    @property
    def all_slots_allocated(self):
        return bool(self.members) and all(m.doctor_id for m in self.members)

    # ── Tax (Section 3) ───────────────────────────────────────────────────
    # Tax is INCLUDED in the doctor's contribution fee (the doctor budget),
    # exactly like consultation-fee / service-fee GST — the patient pays the
    # plan price and the GST is carved out of the doctors' share, never added
    # on top. So the base is the doctor budget, and total_payable == the plan
    # price (tax-inclusive).
    @property
    def cgst_amount(self):
        if self.tax_mode == 'intra_state':
            return float(self.doctor_budget or 0) * float(self.cgst_rate or 0) / 100
        return 0.0

    @property
    def sgst_amount(self):
        if self.tax_mode == 'intra_state':
            return float(self.doctor_budget or 0) * float(self.sgst_rate or 0) / 100
        return 0.0

    @property
    def igst_amount(self):
        if self.tax_mode == 'inter_state':
            return float(self.doctor_budget or 0) * float(self.igst_rate or 0) / 100
        return 0.0

    @property
    def tax_amount(self):
        """GST portion sitting inside the doctor budget (not added to price)."""
        return self.cgst_amount + self.sgst_amount + self.igst_amount

    @property
    def doctor_budget_ex_tax(self):
        """Doctors' net contribution after the included tax is carved out."""
        return float(self.doctor_budget or 0) - self.tax_amount

    @property
    def total_payable(self):
        """What the patient pays — the plan price, tax already included."""
        return float(self.patient_price or 0)

    @property
    def installment_total(self):
        """Resolved installment amounts (percentage rows against patient_price)."""
        base = float(self.patient_price or 0)
        total = 0.0
        for i in self.installments:
            if i.payment_type == 'percentage':
                total += base * float(i.percentage or 0) / 100
            else:
                total += float(i.amount or 0)
        return total

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'category': self.category,
            'product_category':self.product_category,
            'duration_type': self.duration_type,
            'duration_value': self.duration_value,
            'patient_price': str(self.patient_price),
            'doctor_budget': str(self.doctor_budget),
            'description': self.description,
            'status': self.status,
            # The DoctorProduct minted on publish that the marketplace team +
            # feature-product links hang off (null until published).
            'backing_product_id': str(self.backing_product_id) if self.backing_product_id else None,
            'is_active': self.is_active,
            'members': [m.to_dict() for m in self.members],
            'installments': [i.to_dict() for i in self.installments],
            # Tax config (Section 3).
            'tax_mode': self.tax_mode,
            'cgst_rate': str(self.cgst_rate) if self.cgst_rate is not None else None,
            'sgst_rate': str(self.sgst_rate) if self.sgst_rate is not None else None,
            'igst_rate': str(self.igst_rate) if self.igst_rate is not None else None,
            'working_hours': self.working_hours or {},
            'targeting': self.targeting or None,
            # Computed summary fields (Section 4).
            'total_consultations': self.total_consultations,
            'allocated_budget_total': self.allocated_budget_total,
            'doctors_included': self.doctors_included,
            'platform_margin': self.platform_margin,
            'all_slots_allocated': self.all_slots_allocated,
            'cgst_amount': self.cgst_amount,
            'sgst_amount': self.sgst_amount,
            'igst_amount': self.igst_amount,
            'tax_amount': self.tax_amount,
            'doctor_budget_ex_tax': self.doctor_budget_ex_tax,
            'total_payable': self.total_payable,
            'installment_total': self.installment_total,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<GroupOffering {self.id} [{self.status}] {self.name!r}>'


def _legacy_eligibility(member):
    """Build an eligibility dict from a pre-multi slot's single qualification,
    so older rows still serialize (and match) as a one-item rule."""
    if not (member.qualification_id or member.qualification_name):
        return {'specialization_ids': [], 'work_qualification_ids': [], 'experience_rule': []}
    is_work = member.qualification_kind == 'work_qualification'
    ids = [str(member.qualification_id)] if member.qualification_id else []
    names = [member.qualification_name] if member.qualification_name else []
    return {
        'specialization_ids': [] if is_work else ids,
        'specialization_names': [] if is_work else names,
        'work_qualification_ids': ids if is_work else [],
        'work_qualification_names': names if is_work else [],
        'experience_rule': [],
    }


class GroupOfferingMember(TenantMixin, TimestampMixin, db.Model):
    """One qualification slot within a Group Offering.

    A slot is a qualification (Category / specialization) with its own
    consultation count, min/max call time, and allocated budget. ``doctor_id``
    is nullable while drafting; publish requires every slot allocated.
    """
    __tablename__ = 'group_offering_members'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='member_id')
    offering_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offerings.group_offering_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # The qualification/specialty this slot requires — a Category that is either
    # a 'specialization' or a 'work_qualification' (qualification_kind says
    # which). SET NULL on delete; the snapshot name keeps it readable.
    qualification_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('categories.category_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    qualification_name = db.Column(db.String(150), nullable=True)
    qualification_kind = db.Column(db.String(20), nullable=False, default='specialization')  # specialization|work_qualification

    # Full doctor-eligibility rule for the slot — the SAME model a marketplace
    # service uses. A dict:
    #   {"specialization_ids": [...],   # education specializations (any-of)
    #    "specialization_names": [...],
    #    "work_qualification_ids": [...],
    #    "work_qualification_names": [...],
    #    "experience_rule": [[{level, years}, ...], ...]}  # DNF, OR of AND-groups
    # Any-of within each list (OR); the lists + experience are ANDed. Empty
    # criteria mean "no rule". The single columns above mirror the FIRST
    # specialization/work-qual for legacy readers (payout label, display).
    eligibility = db.Column(db.JSON, nullable=True)

    # Template slots carry no doctor — doctors are assigned per TEAM. Kept
    # nullable for back-compat with earlier data.
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    # Consultations: a min/max range. Each mode (voice / video / chat) is
    # OPTIONAL — like an individual service — so a slot offers any subset. Call
    # durations apply only when that mode is enabled; chat is bounded only by
    # the plan's working hours.
    min_consultations = db.Column(db.Integer, nullable=False, default=1)
    max_consultations = db.Column(db.Integer, nullable=False, default=1)
    voice_enabled = db.Column(db.Boolean, nullable=False, default=True)
    voice_min_duration = db.Column(db.Integer, nullable=False, default=5)    # minutes
    voice_max_duration = db.Column(db.Integer, nullable=False, default=30)
    video_enabled = db.Column(db.Boolean, nullable=False, default=True)
    video_min_duration = db.Column(db.Integer, nullable=False, default=5)
    video_max_duration = db.Column(db.Integer, nullable=False, default=30)
    chat_enabled = db.Column(db.Boolean, nullable=False, default=True)

    # Legacy single-duration columns (superseded by the per-mode ones above).
    consultation_count = db.Column(db.Integer, nullable=False, default=1)
    min_duration = db.Column(db.Integer, nullable=False, default=5)
    max_duration = db.Column(db.Integer, nullable=False, default=30)

    allocated_budget = db.Column(db.Numeric(10, 2), nullable=False, default=0)  # the slot fee

    sort_order = db.Column(db.Integer, nullable=False, default=0)

    offering = db.relationship('GroupOffering', back_populates='members')
    qualification = db.relationship('Category', foreign_keys=[qualification_id])
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'offering_id': str(self.offering_id),
            'qualification_id': str(self.qualification_id) if self.qualification_id else None,
            'qualification_name': (
                self.qualification.name if self.qualification else self.qualification_name
            ),
            'qualification_kind': self.qualification_kind,
            # Full eligibility rule (specializations + work-quals + experience).
            # Falls back to the single legacy qualification so older slots keep
            # working as a one-item specialization/work-qual rule.
            'eligibility': self.eligibility or _legacy_eligibility(self),
            'doctor_id': str(self.doctor_id) if self.doctor_id else None,
            'doctor_name': self.doctor.full_name if self.doctor else None,
            'min_consultations': self.min_consultations,
            'max_consultations': self.max_consultations,
            'voice_enabled': self.voice_enabled,
            'voice_min_duration': self.voice_min_duration,
            'voice_max_duration': self.voice_max_duration,
            'video_enabled': self.video_enabled,
            'video_min_duration': self.video_min_duration,
            'video_max_duration': self.video_max_duration,
            'chat_enabled': self.chat_enabled,
            'allocated_budget': str(self.allocated_budget),
            'sort_order': self.sort_order,
        }

    def __repr__(self):
        return f'<GroupOfferingMember {self.id} q={self.qualification_name} d={self.doctor_id}>'


class GroupOfferingInstallment(TenantMixin, TimestampMixin, db.Model):
    """One installment in a Group Offering's payment schedule (Section 3).

    Installment #1 (``is_booking=True``) is the booking amount, due immediately.
    Later installments carry their own timing (``due_after_days`` +
    ``due_label``). Each amount is either a fixed rupee value or a percentage
    of the patient price (``payment_type``).
    """
    __tablename__ = 'group_offering_installments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='installment_id')
    offering_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offerings.group_offering_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    installment_no = db.Column(db.Integer, nullable=False, default=1)
    payment_type = db.Column(db.String(20), nullable=False, default='fixed')  # fixed|percentage
    amount = db.Column(db.Numeric(10, 2), nullable=True)       # when payment_type='fixed'
    percentage = db.Column(db.Numeric(5, 2), nullable=True)    # when payment_type='percentage'

    due_after_days = db.Column(db.Integer, nullable=False, default=0)
    # Human label for the timing: 'Due Immediately', 'Before First Consultation',
    # 'After 5 Days', 'After 10 Days', 'Mid Plan', 'End of Plan', 'Custom'.
    due_label = db.Column(db.String(50), nullable=True)
    is_booking = db.Column(db.Boolean, nullable=False, default=False)

    offering = db.relationship('GroupOffering', back_populates='installments')

    @property
    def resolved_amount(self):
        if self.payment_type == 'percentage' and self.offering is not None:
            return float(self.offering.patient_price or 0) * float(self.percentage or 0) / 100
        return float(self.amount or 0)

    def to_dict(self):
        return {
            'id': str(self.id),
            'offering_id': str(self.offering_id),
            'installment_no': self.installment_no,
            'payment_type': self.payment_type,
            'amount': str(self.amount) if self.amount is not None else None,
            'percentage': str(self.percentage) if self.percentage is not None else None,
            'due_after_days': self.due_after_days,
            'due_label': self.due_label,
            'is_booking': self.is_booking,
            'resolved_amount': self.resolved_amount,
        }

    def __repr__(self):
        return f'<GroupOfferingInstallment {self.id} #{self.installment_no}>'


class GroupOfferingBooking(TenantMixin, TimestampMixin, db.Model):
    """A patient's purchase of a Group Offering plan.

    Plan fields are snapshotted at booking time so later edits (or deletion)
    of the offering don't change an existing booking's price / schedule. The
    booking activates once its first (booking) installment is paid.
    """
    __tablename__ = 'group_offering_bookings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='booking_id')
    offering_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offerings.group_offering_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    # The team (MarketplaceServiceGroup) serving this booking — the patient
    # picks a team when booking. Drives channels + per-doctor payouts.
    team_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_service_groups.group_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # Snapshots taken at booking.
    plan_name = db.Column(db.String(200), nullable=True)
    plan_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    tax_mode = db.Column(db.String(20), nullable=False, default='none')
    tax_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    total_payable = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    # pending_payment → active (first installment paid) → completed | cancelled.
    status = db.Column(db.String(20), nullable=False, default='pending_payment', index=True)

    offering = db.relationship('GroupOffering', foreign_keys=[offering_id])
    patient = db.relationship('Patient', foreign_keys=[patient_id])
    installments = db.relationship(
        'GroupOfferingBookingInstallment', back_populates='booking',
        cascade='all, delete-orphan', lazy='selectin',
        order_by='GroupOfferingBookingInstallment.installment_no',
    )
    # Completion documents are DoctorDocument rows (group_booking_id set) — the
    # SAME model + lifecycle as marketplace-service documents. The doctor-side
    # backref is ``doctor_documents`` (lazy='dynamic').

    @property
    def team(self):
        from app.models.marketplace import MarketplaceServiceGroup
        return MarketplaceServiceGroup.query.get(self.team_id) if self.team_id else None

    @property
    def delivered_documents(self):
        """Documents actually pushed to the patient (ACTIVE, not deleted)."""
        from app.models.document import DocumentStatus
        return [
            d for d in self.doctor_documents
            if d.status == DocumentStatus.ACTIVE and not d.is_deleted
        ]

    @property
    def all_docs_uploaded(self):
        """The plan's completion document (one per booking, authored by the team
        lead) has been pushed to the patient."""
        return bool(self.delivered_documents)

    @property
    def amount_paid(self):
        return sum(float(i.amount or 0) for i in self.installments if i.status == 'paid')

    @property
    def amount_due(self):
        return float(self.total_payable or 0) - self.amount_paid

    @property
    def next_due_installment(self):
        for i in self.installments:
            if i.status != 'paid':
                return i
        return None

    @property
    def all_paid(self):
        return bool(self.installments) and all(i.status == 'paid' for i in self.installments)

    def to_dict(self):
        nxt = self.next_due_installment
        return {
            'id': str(self.id),
            'offering_id': str(self.offering_id) if self.offering_id else None,
            'patient_id': str(self.patient_id),
            'patient_name': self.patient.full_name if self.patient else None,
            'plan_name': self.plan_name,
            'plan_price': str(self.plan_price),
            'tax_mode': self.tax_mode,
            'tax_amount': str(self.tax_amount),
            'total_payable': str(self.total_payable),
            'status': self.status,
            'amount_paid': self.amount_paid,
            'amount_due': self.amount_due,
            'next_due_installment_id': str(nxt.id) if nxt else None,
            'installments': [i.to_dict() for i in self.installments],
            'documents': [{
                'id': str(d.id),
                'doctor_name': d.doctor.full_name if d.doctor else None,
                'file_name': (d.description or 'Document'),
                'document_url': d._get_pdf_url(),
                'note': d.description,
                'issued_at': d.issue_date.isoformat() if d.issue_date else None,
            } for d in self.delivered_documents],
            'all_docs_uploaded': self.all_docs_uploaded,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<GroupOfferingBooking {self.id} [{self.status}] patient={self.patient_id}>'


class GroupOfferingBookingInstallment(TenantMixin, TimestampMixin, db.Model):
    """One installment of a booking's payment schedule (snapshotted at booking).

    ``amount`` is the resolved rupee value to charge; the first (booking)
    installment carries the plan's tax on top of its base share.
    """
    __tablename__ = 'group_offering_booking_installments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='booking_installment_id')
    booking_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offering_bookings.booking_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    installment_no = db.Column(db.Integer, nullable=False, default=1)
    amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    due_after_days = db.Column(db.Integer, nullable=False, default=0)
    due_label = db.Column(db.String(50), nullable=True)
    is_booking = db.Column(db.Boolean, nullable=False, default=False)

    status = db.Column(db.String(20), nullable=False, default='pending', index=True)  # pending|paid
    paid_at = db.Column(db.DateTime(timezone=True), nullable=True)
    payment_id = db.Column(UUID(as_uuid=True), nullable=True)  # settling Payment (no FK; loose link)

    booking = db.relationship('GroupOfferingBooking', back_populates='installments')

    def to_dict(self):
        return {
            'id': str(self.id),
            'booking_id': str(self.booking_id),
            'installment_no': self.installment_no,
            'amount': str(self.amount),
            'due_after_days': self.due_after_days,
            'due_label': self.due_label,
            'is_booking': self.is_booking,
            'status': self.status,
            'paid_at': self.paid_at.isoformat() if self.paid_at else None,
        }

    def __repr__(self):
        return f'<GroupOfferingBookingInstallment {self.id} #{self.installment_no} [{self.status}]>'
