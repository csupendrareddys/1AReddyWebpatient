"""
Marketplace models: DoctorProduct, DoctorMarketplaceProduct, MarketplaceOrder.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, SoftDeleteMixin, utcnow


class DoctorProduct(TenantMixin, SoftDeleteMixin, db.Model):
    """
    Admin-defined product/service catalog items that doctors can offer.
    Examples: Medical Certificate, Sick Leave Letter, Fitness Report, etc.
    """
    __tablename__ = 'doctor_products'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='product_id')

    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    min_price = db.Column(db.Numeric(10, 2), nullable=False)
    max_price = db.Column(db.Numeric(10, 2), nullable=False)

    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    # Group-offering template (Item 3D admin) — when True this catalog item is a
    # "group offering" (e.g. Longevity) that doctors form multi-doctor groups
    # against, rather than an individually-sold service. The specialization list
    # below is the REQUIRED set the group must collectively cover.
    is_group_service = db.Column(db.Boolean, default=False, nullable=False, index=True)

    # Specialization gating (Item 3C) — list of specialization ids (as strings)
    # allowed to offer this product / required to cover a group offering.
    # NULL/empty = any doctor may offer it.
    allowed_specialization_ids = db.Column(db.JSON, nullable=True)

    # Admin-imposed service details. The doctor may only set their selling price
    # + description; tax (GST) and the consultation config are set by the ADMIN
    # here on the catalog item. Each mode is optional.
    tax_mode = db.Column(db.String(20), nullable=False, default='none')  # none|intra_state|inter_state
    cgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    sgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    igst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    # Overall consultation bound (kept for back-compat). The per-mode counts
    # below are the ones the service UI now edits — audio and video separately.
    min_consultations = db.Column(db.Integer, nullable=False, default=1)
    max_consultations = db.Column(db.Integer, nullable=False, default=1)
    voice_enabled = db.Column(db.Boolean, nullable=False, default=True)
    # Audio (voice): min/max number of calls included, and min/max slot length.
    audio_min_consultations = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    audio_max_consultations = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    voice_min_duration = db.Column(db.Integer, nullable=False, default=5)
    voice_max_duration = db.Column(db.Integer, nullable=False, default=30)
    video_enabled = db.Column(db.Boolean, nullable=False, default=True)
    # Video: min/max number of calls included, and min/max slot length.
    video_min_consultations = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    video_max_consultations = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    video_min_duration = db.Column(db.Integer, nullable=False, default=5)
    video_max_duration = db.Column(db.Integer, nullable=False, default=30)
    chat_enabled = db.Column(db.Boolean, nullable=False, default=True)
    # When the service's consultations may be scheduled — per weekday
    # {mon: {open, close, closed}, ...}, mirroring a group offering.
    working_hours = db.Column(db.JSON, nullable=True)

    # ── Eligibility criteria ──────────────────────────────────────────────
    # All of the below follow the same NULL/empty = "no rule, anyone may offer
    # it" convention as allowed_specialization_ids above.

    # Degree ids (Category.category_type == 'degree') the doctor must hold.
    # A doctor satisfies this by holding ANY one of the listed degrees.
    required_degree_ids = db.Column(db.JSON, nullable=True)

    # Work-qualification ids (Category.category_type == 'work_qualification').
    # Satisfied by holding ANY one of the listed qualifications.
    required_work_qualification_ids = db.Column(db.JSON, nullable=True)

    # Experience requirement in disjunctive normal form: a list of AND-groups,
    # OR'd together. A doctor qualifies if EVERY condition in ANY ONE group
    # holds. This shape can express any boolean combination of the three
    # levels while staying flat enough to build in a UI and validate cheaply.
    #
    #   [[{"level": "ug", "years": 2}, {"level": "super_speciality", "years": 2}],
    #    [{"level": "pg", "years": 1}]]
    #
    # reads as: (UG >= 2y AND SS >= 2y) OR (PG >= 1y)
    experience_rule = db.Column(db.JSON, nullable=True)
    # Audience targeting — who this product is surfaced to first (age /
    # gender / entity priority+general, category link, payment mode,
    # quotas). Config-only for now; the patient-list reordering that
    # consumes it lands in a later phase. Shape kept identical to
    # ``GroupOffering.targeting`` and ``Doctor.consultation_targeting``.
    targeting = db.Column(db.JSON, nullable=True)

    # PageConfigAsset's PK attribute is `id` but its db column is `asset_id`;
    # the FK must name the column.
    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    created_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    created_by = db.relationship('User', foreign_keys=[created_by_id], backref='created_products')
    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])
    appointment_products = db.relationship('AppointmentProduct', back_populates='product', lazy='dynamic')
    # Admin-set payout schedule: the doctor's fee for this service is released in
    # these installments (fixed ₹ or % of the fee, each after N days).
    payout_installments = db.relationship(
        'DoctorProductInstallment', back_populates='product',
        cascade='all, delete-orphan', lazy='selectin',
        order_by='DoctorProductInstallment.installment_no',
    )

    __table_args__ = (
        Index('ix_doctor_products_active', 'tenant_id', 'is_active', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'min_price': str(self.min_price),
            'max_price': str(self.max_price),
            'is_active': self.is_active,
            'is_group_service': self.is_group_service,
            'allowed_specialization_ids': self.allowed_specialization_ids or [],
            'required_degree_ids': self.required_degree_ids or [],
            'required_work_qualification_ids': self.required_work_qualification_ids or [],
            'experience_rule': self.experience_rule or [],
            'targeting': self.targeting or None,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            # Admin-imposed service details.
            'tax_mode': self.tax_mode,
            'cgst_rate': str(self.cgst_rate) if self.cgst_rate is not None else None,
            'sgst_rate': str(self.sgst_rate) if self.sgst_rate is not None else None,
            'igst_rate': str(self.igst_rate) if self.igst_rate is not None else None,
            'min_consultations': self.min_consultations,
            'max_consultations': self.max_consultations,
            'voice_enabled': self.voice_enabled,
            'audio_min_consultations': self.audio_min_consultations,
            'audio_max_consultations': self.audio_max_consultations,
            'voice_min_duration': self.voice_min_duration,
            'voice_max_duration': self.voice_max_duration,
            'video_enabled': self.video_enabled,
            'video_min_consultations': self.video_min_consultations,
            'video_max_consultations': self.video_max_consultations,
            'video_min_duration': self.video_min_duration,
            'video_max_duration': self.video_max_duration,
            'chat_enabled': self.chat_enabled,
            'working_hours': self.working_hours or {},
            'payout_installments': [i.to_dict() for i in self.payout_installments],
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<DoctorProduct {self.name}>'


class DoctorProductInstallment(TenantMixin, db.Model):
    """Admin-set payout installment on a service catalog item.

    Each row says how much of the selling doctor's fee is released, and when:
    a fixed rupee amount or a percentage of the fee, matured ``due_after_days``
    after the order completes. The schedule is a template on the product —
    percentages resolve against the doctor's actual sale price at payout time.
    Mirrors the group-offering :class:`ServiceGroupMemberInstallment` so both
    surfaces share one mental model.
    """
    __tablename__ = 'doctor_product_installments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='installment_id')
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    installment_no = db.Column(db.Integer, nullable=False, default=1)
    payment_type = db.Column(db.String(20), nullable=False, default='fixed')  # fixed | percentage
    amount = db.Column(db.Numeric(10, 2), nullable=True)      # when fixed
    percentage = db.Column(db.Numeric(5, 2), nullable=True)   # when percentage (of the fee)
    period_label = db.Column(db.String(60), nullable=True)    # human label, e.g. 'On completion'
    due_after_days = db.Column(db.Integer, nullable=False, default=0)

    product = db.relationship('DoctorProduct', back_populates='payout_installments')

    def resolved_amount(self, fee):
        """This installment's rupee value against a concrete sale ``fee``."""
        fee = float(fee or 0)
        if self.payment_type == 'percentage':
            return fee * float(self.percentage or 0) / 100
        return float(self.amount or 0)

    def to_dict(self):
        return {
            'id': str(self.id),
            'product_id': str(self.product_id),
            'installment_no': self.installment_no,
            'payment_type': self.payment_type,
            'amount': str(self.amount) if self.amount is not None else None,
            'percentage': str(self.percentage) if self.percentage is not None else None,
            'period_label': self.period_label,
            'due_after_days': self.due_after_days,
        }

    def __repr__(self):
        return f'<DoctorProductInstallment {self.id} #{self.installment_no}>'


class DoctorMarketplaceProduct(TenantMixin, db.Model):
    """Products that doctors have explicitly chosen to sell from the admin catalog."""
    __tablename__ = 'doctor_marketplace_products'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='mp_id')
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'), nullable=False, index=True)

    doctor_price = db.Column(db.Numeric(10, 2), nullable=False)
    doctor_description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    # Admin-approval gate (mirrors MarketplaceServiceGroup.approval_status).
    # pending → approved | rejected. A product is only bookable by patients
    # once approved; a doctor edit (price/description) resets it to pending so
    # the change is re-reviewed.
    approval_status = db.Column(db.String(20), default='pending', nullable=False, index=True)
    rejection_reason = db.Column(db.Text, nullable=True)

    # Consultation scheduling (Phase 3c) — how many calls the service includes
    # and the allowed call length. min/max let the doctor bound both.
    min_consultations = db.Column(db.Integer, nullable=False, default=1)
    max_consultations = db.Column(db.Integer, nullable=False, default=1)
    min_call_duration = db.Column(db.Integer, nullable=False, default=5)   # minutes
    max_call_duration = db.Column(db.Integer, nullable=False, default=30)  # minutes

    # Per-vendor payout installment override the admin can set/adjust before
    # approving this listing. A list of
    # {payment_type, amount|percentage, due_after_days}. When set, the service
    # payout slices by THIS instead of the catalog product's schedule.
    payout_installments = db.Column(db.JSON, nullable=True)

    # Tax (Phase 3c) — included in the doctor's fee (like consultation fees):
    # the patient pays doctor_price, GST is carved out of the doctor's share.
    tax_mode = db.Column(db.String(20), nullable=False, default='none')  # none|intra_state|inter_state
    cgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    sgst_rate = db.Column(db.Numeric(5, 2), nullable=True)
    igst_rate = db.Column(db.Numeric(5, 2), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    doctor = db.relationship('Doctor', backref=db.backref('marketplace_products', lazy='dynamic'))
    product = db.relationship('DoctorProduct')

    @property
    def tax_amount(self):
        """GST included in the doctor_price (carved out of the doctor's fee)."""
        price = float(self.doctor_price or 0)
        if self.tax_mode == 'intra_state':
            return price * (float(self.cgst_rate or 0) + float(self.sgst_rate or 0)) / 100
        if self.tax_mode == 'inter_state':
            return price * float(self.igst_rate or 0) / 100
        return 0.0

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'product_id': str(self.product_id),
            'product_name': self.product.name if self.product else None,
            'product_description': self.product.description if self.product else None,
            'doctor_price': str(self.doctor_price),
            'doctor_description': self.doctor_description,
            'is_active': self.is_active,
            'approval_status': self.approval_status,
            'rejection_reason': self.rejection_reason,
            'min_consultations': self.min_consultations,
            'max_consultations': self.max_consultations,
            'min_call_duration': self.min_call_duration,
            'max_call_duration': self.max_call_duration,
            'tax_mode': self.tax_mode,
            'cgst_rate': str(self.cgst_rate) if self.cgst_rate is not None else None,
            'sgst_rate': str(self.sgst_rate) if self.sgst_rate is not None else None,
            'igst_rate': str(self.igst_rate) if self.igst_rate is not None else None,
            'tax_amount': self.tax_amount,
            'payout_installments': self.payout_installments or [],
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<DoctorMarketplaceProduct doctor={self.doctor_id} product={self.product_id}>'


class FeatureProductLink(TenantMixin, db.Model):
    """One row of the admin "Feature ↔ Product Linking" table.

    Backs the existing per-offering linking grid: for a given offering
    (a consultation type value like ``video``, or ``service`` / ``group``),
    optionally under a plan label, a provider (doctor) is linked to a bookable
    product plus a free-text feature list and two priority-formula placeholders.
    Rows are replaced wholesale per offering on save.
    """
    __tablename__ = 'feature_product_links'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='link_id')
    # Offering bucket: a consultation-type value, or 'service' / 'group'.
    offering_key = db.Column(db.String(40), nullable=False, index=True)
    # Plan/group label the row sits under (grouped offerings); NULL for the flat
    # consultation tables. Free text — mirrors the grid's plan grouping.
    plan_ref = db.Column(db.String(200), nullable=True)
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='SET NULL'),
        nullable=True,
    )
    # A group offering is delivered by a TEAM, not an individual doctor — group
    # rows link the team (all its members) instead of a single doctor_id.
    team_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_service_groups.group_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    features = db.Column(db.JSON, nullable=True, default=list)      # list of strings
    formula1 = db.Column(db.Text, nullable=True)
    formula2 = db.Column(db.Text, nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])
    product = db.relationship('DoctorProduct', foreign_keys=[product_id])
    team = db.relationship('MarketplaceServiceGroup', foreign_keys=[team_id])

    __table_args__ = (
        Index('ix_feature_product_links_offering', 'tenant_id', 'offering_key'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'offering_key': self.offering_key,
            'plan_ref': self.plan_ref,
            'doctor_id': str(self.doctor_id) if self.doctor_id else None,
            'doctor_name': self.doctor.full_name if self.doctor else None,
            'product_id': str(self.product_id) if self.product_id else None,
            'product_name': self.product.name if self.product else None,
            'team_id': str(self.team_id) if self.team_id else None,
            'team_name': (self.team.lead.full_name + "'s team"
                          if self.team and self.team.lead else None),
            'team_members': ([m.doctor_name for m in self.team.members if m.doctor_name]
                             if self.team else []),
            'features': self.features or [],
            'formula1': self.formula1,
            'formula2': self.formula2,
            'display_order': self.display_order,
        }

    def __repr__(self):
        return f'<FeatureProductLink {self.offering_key} doctor={self.doctor_id}>'


class MarketplaceOrder(TenantMixin, db.Model):
    """Orders for marketplace products purchased without an appointment."""
    __tablename__ = 'marketplace_orders'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='order_id')
    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'), nullable=False)

    # Set when the order was placed against a group offering. ``doctor_id``
    # then points at the group lead (so existing single-doctor queries keep
    # working); every group member sees the order via ``group_id``.
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey('marketplace_service_groups.group_id', ondelete='SET NULL'), nullable=True, index=True)

    price_at_purchase = db.Column(db.Numeric(10, 2), nullable=False)
    # Lifecycle: pending (placed, before doctor accepts) → under_process
    # (accepted & paid, awaiting delivery) → completed (delivered).
    # cancelled / rejected are terminal. 'paid' retained for back-compat.
    status = db.Column(db.String(50), default='pending', index=True)

    payment_id = db.Column(db.String(100), nullable=True)

    doctor_notes = db.Column(db.Text, nullable=True)
    patient_data = db.Column(db.Text, nullable=True)
    # Optional file the patient attaches while booking (S3 URL), so the doctor
    # can review it before accepting / rejecting the order.
    patient_attachment_link = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    patient = db.relationship('Patient', backref=db.backref('marketplace_orders', lazy='dynamic'))
    doctor = db.relationship('Doctor', backref=db.backref('marketplace_sales', lazy='dynamic'))
    product = db.relationship('DoctorProduct')
    group = db.relationship('MarketplaceServiceGroup', foreign_keys=[group_id])

    def to_dict(self):
        data = {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'patient_name': self.patient.full_name if self.patient else 'Unknown',
            'doctor_id': str(self.doctor_id),
            'doctor_name': self.doctor.full_name if self.doctor else None,
            'product_id': str(self.product_id),
            'product_name': self.product.name if self.product else None,
            'group_id': str(self.group_id) if self.group_id else None,
            'price_at_purchase': str(self.price_at_purchase),
            'status': self.status,
            'doctor_notes': self.doctor_notes,
            'patient_data': self.patient_data,
            'patient_attachment_link': self.patient_attachment_link,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        # For group orders, surface all serving doctors so both the doctor
        # and patient UIs can show "served by A, B, …".
        if self.group_id and self.group:
            data['serving_doctors'] = [m.doctor_name for m in self.group.members if m.doctor_name]
        return data

    def __repr__(self):
        return f'<MarketplaceOrder {self.id} patient={self.patient_id}>'


class MarketplaceServiceGroup(TenantMixin, db.Model):
    """
    A group of doctors offering one catalog product/service together.

    Created by a lead doctor who picks co-doctors from their care network.
    Requires admin approval before it becomes bookable by patients. A patient
    order placed against an approved group is served collaboratively by every
    member (the order's ``doctor_id`` = lead for back-compat).
    """
    __tablename__ = 'marketplace_service_groups'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='group_id')
    # Nullable: a "team" fulfilling an admin-authored Group Offering plan links
    # to the plan (group_offering_id) instead of a single catalog product.
    product_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'), nullable=True, index=True)
    group_offering_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offerings.group_offering_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    created_by_doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)

    group_price = db.Column(db.Numeric(10, 2), nullable=False)
    group_description = db.Column(db.Text, nullable=True)

    # Specialization rules (Item 3D) — the specialization category ids this
    # offering requires the group to collectively cover. NULL/empty = no rule.
    required_specialization_ids = db.Column(db.JSON, nullable=True)

    # awaiting_members → pending (all members accepted) → approved | rejected.
    # ``awaiting_members`` is new (Item 3D member-consent gate); ``pending``
    # keeps the admin-review semantics.
    approval_status = db.Column(db.String(20), default='pending', nullable=False, index=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    product = db.relationship('DoctorProduct')
    lead = db.relationship('Doctor', foreign_keys=[created_by_doctor_id])
    members = db.relationship(
        'MarketplaceServiceGroupMember', back_populates='group',
        cascade='all, delete-orphan', lazy='selectin',
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'product_id': str(self.product_id) if self.product_id else None,
            'product_name': self.product.name if self.product else None,
            'product_min_price': str(self.product.min_price) if self.product else None,
            'product_max_price': str(self.product.max_price) if self.product else None,
            'group_offering_id': str(self.group_offering_id) if self.group_offering_id else None,
            'created_by_doctor_id': str(self.created_by_doctor_id),
            'lead_name': self.lead.full_name if self.lead else None,
            'group_price': str(self.group_price),
            'group_description': self.group_description,
            'required_specialization_ids': self.required_specialization_ids or [],
            'approval_status': self.approval_status,
            'rejection_reason': self.rejection_reason,
            'is_active': self.is_active,
            'members': [m.to_dict() for m in self.members],
            'all_members_accepted': all(
                m.status == 'accepted' for m in self.members
            ) if self.members else True,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<MarketplaceServiceGroup {self.id} [{self.approval_status}]>'


class MarketplaceServiceGroupMember(TenantMixin, db.Model):
    """A doctor participating in a group service offering."""
    __tablename__ = 'marketplace_service_group_members'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='member_id')
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey('marketplace_service_groups.group_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    role = db.Column(db.String(20), default='member', nullable=False)  # lead | member

    # Member consent (Item 3D): invited → accepted | declined. The lead is
    # 'accepted' on creation; admin-assigned members are 'accepted'.
    status = db.Column(db.String(20), default='invited', nullable=False)
    responded_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # For a plan-team: the plan slot this member fills + their allocated fee
    # (≤ the slot budget). Their payout installment schedule hangs off this row.
    group_offering_member_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offering_members.member_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    allocated_fee = db.Column(db.Numeric(10, 2), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    group = db.relationship('MarketplaceServiceGroup', back_populates='members')
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])
    payout_installments = db.relationship(
        'ServiceGroupMemberInstallment', back_populates='member',
        cascade='all, delete-orphan', lazy='selectin',
        order_by='ServiceGroupMemberInstallment.installment_no',
    )

    __table_args__ = (
        db.UniqueConstraint('group_id', 'doctor_id', name='uq_service_group_member'),
    )

    @property
    def doctor_name(self):
        return self.doctor.full_name if self.doctor else None

    def to_dict(self, include_installments=True):
        data = {
            'id': str(self.id),
            'group_id': str(self.group_id),
            'doctor_id': str(self.doctor_id),
            'doctor_name': self.doctor_name,
            'role': self.role,
            'status': self.status,
            'group_offering_member_id': str(self.group_offering_member_id) if self.group_offering_member_id else None,
            'allocated_fee': str(self.allocated_fee) if self.allocated_fee is not None else None,
        }
        if include_installments:
            data['payout_installments'] = [i.to_dict() for i in self.payout_installments]
        return data

    def __repr__(self):
        return f'<MarketplaceServiceGroupMember group={self.group_id} doctor={self.doctor_id}>'


class ServiceGroupMemberInstallment(TenantMixin, db.Model):
    """A doctor's payout installment schedule within a plan team.

    Each row is one payout installment of the member's allocated fee — a fixed
    rupee amount or a percentage of the fee, with a period label. The installment
    amounts must sum to at most the member's allocated fee. Only the member (and
    admin) can see their own schedule.
    """
    __tablename__ = 'service_group_member_installments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='installment_id')
    member_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_service_group_members.member_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    installment_no = db.Column(db.Integer, nullable=False, default=1)
    payment_type = db.Column(db.String(20), nullable=False, default='fixed')  # fixed | percentage
    amount = db.Column(db.Numeric(10, 2), nullable=True)      # when fixed
    percentage = db.Column(db.Numeric(5, 2), nullable=True)   # when percentage (of allocated_fee)
    period_label = db.Column(db.String(60), nullable=True)    # e.g. 'On completion', 'After 15 days'
    due_after_days = db.Column(db.Integer, nullable=False, default=0)

    member = db.relationship('MarketplaceServiceGroupMember', back_populates='payout_installments')

    @property
    def resolved_amount(self):
        if self.payment_type == 'percentage' and self.member is not None:
            return float(self.member.allocated_fee or 0) * float(self.percentage or 0) / 100
        return float(self.amount or 0)

    def to_dict(self):
        return {
            'id': str(self.id),
            'member_id': str(self.member_id),
            'installment_no': self.installment_no,
            'payment_type': self.payment_type,
            'amount': str(self.amount) if self.amount is not None else None,
            'percentage': str(self.percentage) if self.percentage is not None else None,
            'period_label': self.period_label,
            'due_after_days': self.due_after_days,
            'resolved_amount': self.resolved_amount,
        }

    def __repr__(self):
        return f'<ServiceGroupMemberInstallment {self.id} #{self.installment_no}>'
