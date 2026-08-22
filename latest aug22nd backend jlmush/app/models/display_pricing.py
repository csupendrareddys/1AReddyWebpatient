"""Display pricing — the platform markup/discount laid over a provider's fee.

What a doctor quotes is what the doctor is *paid* — a ``slot_pricing`` tier for
a consultation, or ``DoctorMarketplaceProduct.doctor_price`` for a catalog
service. What the patient *sees and pays* is that fee plus a platform
increment, minus a platform discount. This table stores that overlay so
SUPER_ADMIN can price each offering independently without touching the
provider's own numbers.

Deliberately NOT columns on the priced records themselves: a doctor's pricing
goes through an approval queue, and admin markup must be editable without
re-opening that approval — and must survive the doctor editing their price.

Rows are sparse. An absent row means "no markup, no discount", so the display
price equals the provider's fee. Readers must treat a missing rule as identity.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, AuditMixin

#: ``scope_type`` value for catalog services. Everything else is a
#: ``ConsultationType`` value ('audio', 'video', 'chat', 'complete', …).
SERVICE_SCOPE = 'service'


def _id_map(raw):
    """``{plan_id: [id, ...]}`` with everything stringified, or ``{}``.

    Tolerates a non-dict — these columns are JSON, so a hand-edited row can
    hold anything, and a serializer is not the place to discover that.
    """
    if not isinstance(raw, dict):
        return {}
    return {
        str(plan_id): [str(i) for i in (ids or [])]
        for plan_id, ids in raw.items()
    }


class DisplayPricingRule(TenantMixin, TimestampMixin, AuditMixin, db.Model):
    """Admin-entered increment + overall discount for one doctor × offering.

    The offering is addressed by a (``scope_type``, ``scope_key``) pair:

    ==================  ==========================  =========================
    scope_type          scope_key                   priced record
    ==================  ==========================  =========================
    a ConsultationType  duration slot ('10-20')     ``Doctor.slot_pricing``
    ``'service'``       ``DoctorProduct`` id        ``DoctorMarketplaceProduct``
    ==================  ==========================  =========================

    One pair per row, so a doctor's video 10-20 slot and their Medical
    Certificate service are priced independently.
    """
    __tablename__ = 'display_pricing_rules'
    __table_args__ = (
        db.UniqueConstraint(
            'tenant_id', 'doctor_id', 'scope_type', 'scope_key',
            name='uq_display_pricing_scope',
        ),
        db.Index(
            'ix_display_pricing_lookup',
            'tenant_id', 'scope_type', 'scope_key',
        ),
        # The doctor-less half of ``uq_display_pricing_scope``: a UNIQUE
        # constraint doesn't constrain rows whose doctor_id is NULL, so
        # group-offering rules would be free to duplicate without this.
        db.Index(
            'uq_display_pricing_scope_no_doctor',
            'tenant_id', 'scope_type', 'scope_key',
            unique=True,
            postgresql_where=db.text('doctor_id IS NULL'),
        ),
    )

    id = db.Column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
        name='display_pricing_rule_id',
    )
    #: NULL for offerings that aren't priced per doctor. A group offering is a
    #: plan with a team behind it and ONE ``patient_price``, so its overlay
    #: belongs to the offering, not to any member. Postgres treats NULLs as
    #: distinct in a UNIQUE constraint, so the scope constraint below cannot
    #: dedupe those rows — a partial unique index does it instead (see the
    #: migration).
    doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    #: A ``ConsultationType`` *value*, or ``SERVICE_SCOPE``. Stored as text
    #: rather than the enum so a legacy tier (which readers coerce to
    #: 'complete') and the non-enum service scope both fit without a schema
    #: change.
    scope_type = db.Column(db.String(32), nullable=False)

    #: Duration-slot key ('0-10', '10-20', … see
    #: ``app.common.display_pricing.slot_key``) or a ``DoctorProduct`` id.
    #: Wide enough for a UUID.
    scope_key = db.Column(db.String(64), nullable=False)

    #: Flat ₹ added on top of the provider's fee.
    increment_fixed = db.Column(
        db.Numeric(10, 2), nullable=False, default=0, server_default='0',
    )
    #: % of the provider's fee added on top.
    increment_pct = db.Column(
        db.Numeric(5, 2), nullable=False, default=0, server_default='0',
    )
    #: % taken off the incremented (gross) price.
    overall_discount_pct = db.Column(
        db.Numeric(5, 2), nullable=False, default=0, server_default='0',
    )

    #: Ids of the ``Voucher`` / ``Coupon`` rows the admin has marked applicable
    #: to this offering. Each selected row's flat ₹ ``amount`` is subtracted
    #: from the discounted price.
    #:
    #: Stored as JSON id lists rather than two join tables: the selection is
    #: always read and written as a whole set alongside the rule it belongs to,
    #: never queried "which rules use voucher X" — a join table would add two
    #: tables and a cascade for no query we make. Unknown or inactive ids are
    #: skipped at resolve time, so a deleted voucher degrades to "no discount"
    #: rather than to an error.
    voucher_ids = db.Column(db.JSON, nullable=True)
    coupon_ids = db.Column(db.JSON, nullable=True)

    #: Per-membership-plan discount for THIS offering, ``{plan_id: pct}``.
    #:
    #: ``MembershipPlan.member_discount_pct`` is the tier's headline promise
    #: ("20% off everything"). It is no longer applied flatly: it is now the
    #: CEILING, and this map is where an admin dials one offering below it —
    #: a service the platform makes no margin on can grant a member 5% while
    #: the same member still gets the full 20% on a consultation.
    #:
    #: Sparse in two directions on purpose. A plan absent from the map gets
    #: its own ceiling, so a newly created membership tier is immediately
    #: honoured everywhere without an admin touching every priced row; and
    #: only genuine overrides (a value BELOW the ceiling) are written, so
    #: lowering a plan's headline % automatically lowers every offering that
    #: was riding on it. Values above the ceiling are clamped at resolve time
    #: as well as on save — a plan's headline number is the promise, and no
    #: per-offering row may quietly exceed it.
    #:
    #: JSON rather than a join table for the same reason as the id lists
    #: above: it is always read and written as one whole set beside the rule
    #: it belongs to, never queried "which rules discount plan X".
    plan_discounts = db.Column(db.JSON, nullable=True)

    #: Per-membership-plan voucher / coupon selections for THIS offering,
    #: ``{plan_id: [discount_id, ...]}``.
    #:
    #: The sibling of ``voucher_ids`` / ``coupon_ids`` above, and the same flat
    #: ₹ rows out of the same two books — the difference is *who* they reduce
    #: the price for. The plain lists apply to everybody and are therefore
    #: baked into the displayed price. These apply only to buyers holding that
    #: membership plan, so they cannot be: the price is quoted before we know
    #: who is looking, exactly as with ``plan_discounts``. They come off at
    #: purchase, after the plan's percentage, and only for that plan's holders.
    #:
    #: Sparse: a plan with no entry gets nothing extra, which is the right
    #: default — an unconfigured tier should not silently acquire a voucher.
    #: That is the opposite of ``plan_discounts``, where absence means the full
    #: ceiling, and deliberately so: a percentage ceiling is a promise the tier
    #: already made, a voucher is a thing an admin has to actually pick.
    plan_voucher_ids = db.Column(db.JSON, nullable=True)
    plan_coupon_ids = db.Column(db.JSON, nullable=True)

    doctor = db.relationship('Doctor', backref=db.backref(
        'display_pricing_rules', lazy='dynamic', cascade='all, delete-orphan',
    ))

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'scope_type': self.scope_type,
            'scope_key': self.scope_key,
            'increment_fixed': float(self.increment_fixed or 0),
            'increment_pct': float(self.increment_pct or 0),
            'overall_discount_pct': float(self.overall_discount_pct or 0),
            'voucher_ids': [str(v) for v in (self.voucher_ids or [])],
            'coupon_ids': [str(c) for c in (self.coupon_ids or [])],
            'plan_discounts': {
                str(k): float(v or 0)
                for k, v in (self.plan_discounts or {}).items()
            },
            'plan_voucher_ids': _id_map(self.plan_voucher_ids),
            'plan_coupon_ids': _id_map(self.plan_coupon_ids),
        }

    def __repr__(self):
        return (
            f'<DisplayPricingRule doctor={self.doctor_id} '
            f'{self.scope_type}/{self.scope_key}>'
        )
