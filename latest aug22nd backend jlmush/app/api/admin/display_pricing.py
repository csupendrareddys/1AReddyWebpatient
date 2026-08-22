"""Admin "Display Pricing Configuration" — SUPER_ADMIN markup over provider fees.

Backs the three-level drill-down at ``/dashboard/admin/pricing-config``:

    1. ``GET  /offerings``  what can be priced: the consultation types that
                            exist in the DB, plus the Service / Product
                            Catalog, each with live doctor counts.
    2. ``GET  /scopes``     the second axis for one offering — duration slots
                            for a consultation type, catalog items for
                            services.
    3. ``GET  /rows``       one row per doctor for the chosen scope: their
                            quoted fee, the saved overlay, and the resulting
                            Display Price.
    4. ``PUT  /rules``      bulk-save the overlay for that scope.

plus the membership tiers the rows table needs a column each for:

    5. ``GET  /membership-plans``   the tenant's receiver tiers and the
                                    ceiling each one promises.

and the two discount books an admin picks from, one route set each:

    ``GET|POST /vouchers``          ``GET|POST /coupons``
    ``PUT|DELETE /vouchers/<id>``   ``PUT|DELETE /coupons/<id>``

Everything is derived from what providers have actually priced —
``Doctor.slot_pricing`` for consultations, ``DoctorMarketplaceProduct`` for
services — which is the same data the booking and marketplace flows charge
from. Plan-based patient reductions are now half-modelled here: the *rate* each
membership tier gets off a given doctor × offering is configured on this
surface (``plan_discounts``, bounded by the tier's own headline
``member_discount_pct``), but the *subtraction* still happens at purchase,
because which of those rates applies depends on the individual patient's active
plan and is only knowable once we know who is buying.
"""
import logging
from decimal import Decimal

from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.common.display_pricing import (
    GROUP_SCOPE, SERVICE_SCOPE, apply_rule, discount_amounts, price_breakdown,
    rules_for_scope, slot_key, tier_consultation_type,
)
from app.common.member_discount import (
    offering_discount_pct, plan_discount_amount, plan_discount_caps,
    plan_discount_pct,
)
from app.common.responses import error_response, success_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    BillingConfig, ConsultationType, Coupon, DisplayPricingRule, Doctor,
    DoctorBillingProfile, DoctorMarketplaceProduct, DoctorProduct, GroupOffering,
    UserRole, Voucher,
)
# Not re-exported by ``app.models`` — see ``member_discount.plan_discount_caps``.
from app.models.membership import MembershipPlan, VerticalPlanType

logger = logging.getLogger(__name__)

display_pricing_bp = Blueprint('display_pricing', __name__)

#: Human labels for the DB enum. The frontend has its own richer map (colour +
#: icon); this is the fallback so a newly added ConsultationType renders with
#: something sensible before the frontend catches up.
TYPE_LABELS = {
    'audio': 'Voice Consultation',
    'video': 'Video Consultation',
    'chat': 'Chat Consultation',
    'complete': 'In-Person Consultation',
    'home_visit': 'Home Visit Consultancy',
    'camp': 'Camp Consultancy',
}


# ─── shared helpers ────────────────────────────────────────────────────────

def _tenant_doctors():
    """Live doctors for the calling tenant, with their pricing JSON."""
    return Doctor.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).all()


def _priced_tiers(doctor):
    """``(consultation_type, slot_range, tier)`` for every tier with a price."""
    for tier in (doctor.slot_pricing or []):
        if not isinstance(tier, dict) or tier.get('price') in (None, ''):
            continue
        key = slot_key(tier)
        if not key:
            continue
        yield tier_consultation_type(tier), key, tier


def _listed_services(tenant_id=None):
    """Per-doctor service listings for the tenant, as lightweight rows.

    Inactive and unapproved listings are included on purpose: an admin should
    be able to set the display price before a listing goes live, not scramble
    once it is already bookable.

    Only the six columns this surface reads are selected, rather than whole ORM
    objects — the listing row carries a lot of scheduling/tax config none of
    which is needed to price it.
    """
    return db.session.query(
        DoctorMarketplaceProduct.doctor_id,
        DoctorMarketplaceProduct.product_id,
        DoctorMarketplaceProduct.doctor_price,
        DoctorMarketplaceProduct.doctor_description,
        DoctorMarketplaceProduct.is_active,
        DoctorMarketplaceProduct.approval_status,
    ).filter(
        DoctorMarketplaceProduct.tenant_id == (
            tenant_id or current_tenant_id_strict()),
    ).all()


def _tds_rates_by_doctor(tenant_id=None):
    """``{doctor_id_str: tds_rate_float}`` for every doctor in the tenant.

    Mirrors ``billing_service.resolve_tds_rate`` — the per-doctor
    ``DoctorBillingProfile.tds_rate_override`` wins, else the tenant flat
    ``BillingConfig.tds_rate`` — but resolves the whole page in two queries
    instead of two per row. Doctors with no override simply aren't in the
    override map and pick up the flat rate.
    """
    tenant_id = tenant_id or current_tenant_id_strict()

    config = BillingConfig.query.filter_by(
        tenant_id=tenant_id, is_active=True).first()
    flat = float(config.tds_rate) if config and config.tds_rate is not None else 0.0

    overrides = {
        str(doc_id): float(rate)
        for doc_id, rate in db.session.query(
            DoctorBillingProfile.doctor_id, DoctorBillingProfile.tds_rate_override,
        ).filter(
            DoctorBillingProfile.tenant_id == tenant_id,
            DoctorBillingProfile.tds_rate_override.isnot(None),
        ).all()
    }
    return _DefaultingRates(overrides, flat)


class _DefaultingRates(dict):
    """Override map that falls back to the tenant flat rate on a miss."""

    def __init__(self, overrides, flat):
        super().__init__(overrides)
        self._flat = flat

    def get(self, key, default=None):  # noqa: D102 — dict override
        return super().get(key, self._flat)


def _group_offerings(tenant_id=None):
    """Live group offerings for the tenant, lightest columns only.

    Drafts are included on purpose, same reasoning as unapproved service
    listings: an admin should be able to set the overlay before the plan goes
    live rather than scramble once patients can buy it.
    """
    return db.session.query(
        GroupOffering.id,
        GroupOffering.name,
        GroupOffering.category,
        GroupOffering.patient_price,
        GroupOffering.duration_value,
        GroupOffering.status,
        GroupOffering.is_active,
    ).filter(
        GroupOffering.tenant_id == (tenant_id or current_tenant_id_strict()),
        GroupOffering.is_deleted == False,  # noqa: E712
    ).order_by(GroupOffering.name.asc()).all()


def _plan_ids(rule, field, plan_id):
    """One plan's stored id list off a rule's ``{plan_id: [id, ...]}`` map."""
    if rule is None:
        return []
    raw = getattr(rule, field, None)
    if not isinstance(raw, dict):
        return []
    ids = raw.get(str(plan_id))
    return [str(i) for i in ids] if isinstance(ids, list) else []


def _slot_label(range_key):
    """'0-10' → '0 – 10 mins'; anything unparseable renders verbatim."""
    parts = str(range_key).split('-')
    if len(parts) == 2 and all(p.strip().isdigit() for p in parts):
        return f'{parts[0].strip()} – {parts[1].strip()} mins'
    return str(range_key)


def _slot_sort_key(range_key):
    """Order slots by their start minute, unknown keys last."""
    head = str(range_key).split('-')[0].strip()
    return (0, int(head)) if head.isdigit() else (1, 0)


# ─── level 1: offerings ────────────────────────────────────────────────────

@display_pricing_bp.route('/offerings', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_offerings():
    """Everything that can be display-priced, with live usage counts.

    Every consultation type in the enum is returned (not only the ones in use)
    so an admin can see a type sitting at zero doctors rather than wondering
    where it went. The Service / Product Catalog is appended as one more
    offering — same drill-down, different second axis.
    """
    doctors = _tenant_doctors()

    doctor_counts, scope_keys = {}, {}
    for doctor in doctors:
        for ctype, key, _tier in _priced_tiers(doctor):
            doctor_counts.setdefault(ctype, set()).add(str(doctor.id))
            scope_keys.setdefault(ctype, set()).add(key)

    known = [ct.value for ct in ConsultationType]
    # A legacy tier may carry a type no longer in the enum — surface it rather
    # than silently stranding its pricing.
    extra = sorted(set(doctor_counts) - set(known))

    offerings = [
        {
            'value': value,
            'label': TYPE_LABELS.get(value, value.replace('_', ' ').title()),
            'kind': 'consultation',
            'doctor_count': len(doctor_counts.get(value, ())),
            'scope_count': len(scope_keys.get(value, ())),
            'in_enum': value in known,
        }
        for value in known + extra
    ]

    listings = _listed_services()
    offerings.append({
        'value': SERVICE_SCOPE,
        'label': 'Service / Product Catalog',
        'kind': 'service',
        'doctor_count': len({str(m.doctor_id) for m in listings}),
        'scope_count': len({str(m.product_id) for m in listings}),
        'in_enum': True,
    })

    # Group offerings are priced per plan, not per doctor, so ``doctor_count``
    # reports the plans themselves — it is what the card's "N doctors" chip
    # would otherwise misstate as zero.
    plans = _group_offerings()
    offerings.append({
        'value': GROUP_SCOPE,
        'label': 'Group Offerings',
        'kind': 'group',
        'doctor_count': len(plans),
        'scope_count': len(plans),
        'in_enum': True,
    })
    return success_response(data=offerings)


# ─── level 2: scopes within an offering ────────────────────────────────────

@display_pricing_bp.route('/scopes', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_scopes():
    """Second-axis entries for ``?scope_type=``.

    Duration slots for a consultation type, catalog items for ``service``.
    Both come back as ``{key, label, doctor_count}`` so the UI renders one card
    grid either way.
    """
    scope_type = (request.args.get('scope_type') or '').strip()
    if not scope_type:
        return error_response('scope_type is required')

    if scope_type == GROUP_SCOPE:
        return success_response(data=[
            {
                'key': str(p.id),
                'label': p.name,
                'sublabel': (
                    f'{p.category} · {p.duration_value} days · '
                    f'₹{float(p.patient_price or 0):,.2f} to patient'
                ),
                # One plan, one price — there is no per-doctor row to count,
                # so the chip reports the plan's own state instead.
                'doctor_count': None,
                'status': p.status,
                'is_active': bool(p.is_active),
            }
            for p in _group_offerings()
        ])

    if scope_type == SERVICE_SCOPE:
        listings = _listed_services()
        by_product = {}
        for m in listings:
            by_product.setdefault(str(m.product_id), set()).add(str(m.doctor_id))

        # Names come from the admin catalog, so a service the admin renamed
        # shows its current name here even for old listings. Only the three
        # display columns are selected — the catalog row carries a lot of
        # eligibility/tax config that pricing doesn't care about.
        catalog = {
            str(pid): (name, description)
            for pid, name, description in db.session.query(
                DoctorProduct.id, DoctorProduct.name, DoctorProduct.description,
            ).filter(
                DoctorProduct.tenant_id == current_tenant_id_strict(),
                DoctorProduct.is_deleted == False,  # noqa: E712
            ).all()
        }
        rows = [
            {
                'key': pid,
                'label': catalog[pid][0] if pid in catalog else 'Removed service',
                'sublabel': (catalog[pid][1] or '') if pid in catalog else '',
                'doctor_count': len(ids),
            }
            for pid, ids in by_product.items()
        ]
        rows.sort(key=lambda r: (r['label'] or '').lower())
        return success_response(data=rows)

    doctor_counts = {}
    for doctor in _tenant_doctors():
        for tier_type, key, _tier in _priced_tiers(doctor):
            if tier_type != scope_type:
                continue
            doctor_counts.setdefault(key, set()).add(str(doctor.id))

    return success_response(data=[
        {
            'key': key,
            'label': _slot_label(key),
            'sublabel': '',
            'doctor_count': len(ids),
        }
        for key, ids in sorted(doctor_counts.items(),
                               key=lambda kv: _slot_sort_key(kv[0]))
    ])


# ─── the membership tiers the rows table columns off ───────────────────────

@display_pricing_bp.route('/membership-plans', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_membership_plans():
    """The tenant's receiver membership tiers, one per column of the table.

    ``member_discount_pct`` here is the tier's CEILING — the most any single
    offering may take off for a holder of it — and the ``plan_discounts`` map
    on each row of ``/rows`` is where an admin dials one offering below it.
    Sending the ceiling alongside each tier is what lets the table render the
    "up to N%" header and refuse a number above it without a round-trip.

    Provider tiers are excluded: a doctor/clinic/hospital membership is
    something a practice sells *through*, so a discount there would mean the
    platform paying a provider to be a member. Receiver tiers granting 0% are
    kept, deliberately — an admin should see a tier that promises nothing
    rather than wonder where its column went.
    """
    plans = MembershipPlan.query.join(
        VerticalPlanType,
        MembershipPlan.vertical_plan_type_id == VerticalPlanType.id,
    ).filter(
        MembershipPlan.tenant_id == current_tenant_id_strict(),
        MembershipPlan.is_deleted == False,  # noqa: E712
        VerticalPlanType.is_receiver == True,  # noqa: E712
    ).order_by(
        MembershipPlan.sort_order.asc(), MembershipPlan.name.asc(),
    ).all()

    return success_response(data=[
        {
            'id': str(p.id),
            'code': p.code,
            'name': p.name,
            'tier': p.tier.value if p.tier is not None else None,
            # Through the same clamp ``plan_discount_caps`` applies, so the
            # ceiling the table renders and the ceiling the save path enforces
            # are the same number for a row that predates the CHECK constraint.
            'member_discount_pct': float(plan_discount_pct(p)),
        }
        for p in plans
    ])


# ─── level 3: per-doctor rows ──────────────────────────────────────────────

@display_pricing_bp.route('/rows', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_rows():
    """Per-doctor pricing rows for ``?scope_type=&scope_key=``.

    ``doctor_fee`` is the provider's own quoted price (their payout). The saved
    overlay and the resulting ``display_price`` — what the patient is quoted and
    charged — come back alongside it.

    ``plan_discounts`` comes back EFFECTIVE rather than as stored: every
    receiver tier is present, carrying the row's own override where it has one
    and the tier's ceiling where it doesn't. The stored map is sparse on
    purpose (see the model), so returning it raw would leave the table showing
    a blank cell for every offering nobody has dialled down — when what those
    offerings actually grant is the full ceiling.
    """
    scope_type = (request.args.get('scope_type') or '').strip()
    scope_key = (request.args.get('scope_key') or '').strip()
    if not scope_type or not scope_key:
        return error_response('scope_type and scope_key are required')

    rules = rules_for_scope(scope_type, scope_key)
    discounts = discount_amounts()
    tds_rates = _tds_rates_by_doctor()
    # Page-wide constant — the tiers are the table's columns, identical for
    # every row, so resolving them per row would re-run the same join once per
    # doctor on the page.
    plan_caps = plan_discount_caps()

    def _row(doctor, fee, description, extra=None, label=None, ref=None):
        """One table row. ``doctor`` is None for offerings priced per plan.

        ``row_id`` is what the UI keys and edits on: the doctor for per-doctor
        rows, the scope itself for a doctor-less one. Without it a group
        offering's single row would have no stable identity.
        """
        doctor_key = str(doctor.id) if doctor is not None else None
        rule = rules.get(doctor_key)
        parts = price_breakdown(fee, rule, discounts)
        row = {
            'row_id': doctor_key or scope_key,
            'doctor_id': doctor_key,
            'registration_number': doctor.registration_number if doctor else ref,
            'doctor_name': doctor.full_name if doctor else label,
            'doctor_fee': fee,
            'description': description or '',
            'increment_fixed': float(rule.increment_fixed or 0) if rule else 0,
            'increment_pct': float(rule.increment_pct or 0) if rule else 0,
            'overall_discount_pct': (
                float(rule.overall_discount_pct or 0) if rule else 0
            ),
            'voucher_ids': [str(v) for v in ((rule.voucher_ids if rule else None) or [])],
            'coupon_ids': [str(c) for c in ((rule.coupon_ids if rule else None) or [])],
            # What each membership tier actually grants on THIS offering, not
            # what was stored for it — an unconfigured row reads back as the
            # ceilings it is really honouring.
            'plan_discounts': {
                plan_id: float(offering_discount_pct(rule, plan_id=plan_id,
                                                     cap=cap))
                for plan_id, cap in plan_caps.items()
            },
            # The per-plan voucher / coupon picks, as STORED — unlike
            # ``plan_discounts`` there is no ceiling to fall back to, so an
            # absent entry really does mean "nothing selected" and an empty
            # list is the honest read of it.
            'plan_voucher_ids': {
                plan_id: _plan_ids(rule, 'plan_voucher_ids', plan_id)
                for plan_id in plan_caps
            },
            'plan_coupon_ids': {
                plan_id: _plan_ids(rule, 'plan_coupon_ids', plan_id)
                for plan_id in plan_caps
            },
            # What those picks come to in ₹, per plan — so the table can show
            # the deduction without re-summing the books client-side, exactly
            # as ``voucher_amount`` does for the everybody-gets-it lists.
            'plan_discount_amounts': {
                plan_id: float(plan_discount_amount(rule, plan_id, discounts))
                for plan_id in plan_caps
            },
            # Resolved ₹ totals so the table can show the deduction without
            # re-summing the picked rows client-side.
            'voucher_amount': float(parts['voucher_amount']) if parts else 0,
            'coupon_amount': float(parts['coupon_amount']) if parts else 0,
            # Fee + increment, before any discount comes off — the figure the
            # discounts are taken from.
            'pre_discount_price': float(parts['gross']) if parts else fee,
            'display_price': apply_rule(fee, rule, discounts),
            # This doctor's own TDS rate. The tax popover computes client-side
            # while the admin types, and the tax config it fetches only carries
            # the tenant flat rate — without this the popover would quote 10%
            # at a doctor the admin had put on 20%.
            'tds_rate': tds_rates.get(doctor_key) if doctor is not None else None,
        }
        row.update(extra or {})
        return row

    rows = []
    if scope_type == GROUP_SCOPE:
        # One plan, one price, one row — the overlay belongs to the offering,
        # not to any member of its team.
        for p in _group_offerings():
            if str(p.id) != scope_key:
                continue
            rows.append(_row(
                None, float(p.patient_price or 0), p.category,
                extra={'listing_active': bool(p.is_active),
                       'approval_status': p.status},
                label=p.name, ref=f'{p.duration_value} days',
            ))
        return success_response(data=rows)

    if scope_type == SERVICE_SCOPE:
        # One doctor lookup for the whole scope rather than per listing.
        doctors = {str(d.id): d for d in _tenant_doctors()}
        for m in _listed_services():
            if str(m.product_id) != scope_key:
                continue
            doctor = doctors.get(str(m.doctor_id))
            if doctor is None:
                continue
            try:
                fee = float(m.doctor_price)
            except (TypeError, ValueError):
                continue
            rows.append(_row(doctor, fee, m.doctor_description, {
                # Surfaced so the admin can see they're pricing a listing that
                # patients can't reach yet.
                'listing_active': bool(m.is_active),
                'approval_status': m.approval_status,
            }))
    else:
        for doctor in _tenant_doctors():
            for tier_type, key, tier in _priced_tiers(doctor):
                if tier_type != scope_type or key != scope_key:
                    continue
                try:
                    fee = float(tier.get('price'))
                except (TypeError, ValueError):
                    continue
                rows.append(_row(doctor, fee, tier.get('description')))
                break  # one tier per doctor per (type, slot)

    rows.sort(key=lambda r: (r['doctor_name'] or '').lower())
    return success_response(data=rows)


# ─── save ──────────────────────────────────────────────────────────────────

@display_pricing_bp.route('/rules', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def save_rules():
    """Bulk upsert the overlay for one (scope_type, scope_key).

    Body::

        {"scope_type": "video", "scope_key": "0-10",
         "rules": [{"doctor_id": "...", "increment_fixed": 20,
                    "increment_pct": 5, "overall_discount_pct": 10,
                    "voucher_ids": ["..."], "coupon_ids": [],
                    "plan_discounts": {"<membership_plan_id>": 5}}]}

    An entry that is zero on every number AND selects no voucher or coupon AND
    overrides no membership tier deletes the row rather than storing a no-op,
    keeping the table sparse so "no rule" and "explicitly zero" stay the same
    thing. A row that only selects a voucher, or only dials one tier down, is
    still a real rule and is kept.

    ``plan_discounts`` is stored sparse for a second reason: only values BELOW
    the tier's ``member_discount_pct`` ceiling are written. An entry sent at
    (or above, which clamps to) the ceiling is dropped, so it keeps riding on
    the tier — which is what makes lowering a tier's headline % lower every
    offering that never asked for anything different, instead of leaving a
    field of frozen copies of the old number. Sending ``null`` for a tier
    clears its override the same way; an explicit ``0`` is a real override
    meaning this offering grants that tier nothing.

    ``plan_voucher_ids`` / ``plan_coupon_ids`` are the same two books as
    ``voucher_ids`` / ``coupon_ids``, picked per membership tier::

        "plan_voucher_ids": {"<membership_plan_id>": ["<voucher_id>", ...]}

    Sparse the other way round from ``plan_discounts``: a tier picking nothing
    is dropped, and absence means it gets nothing extra. A percentage ceiling
    is a promise the tier already made, so absence there means "the full
    ceiling"; a voucher is a thing an admin has to actually choose, so absence
    here means none.
    """
    data = request.get_json() or {}
    scope_type = (data.get('scope_type') or '').strip()
    scope_key = (data.get('scope_key') or '').strip()
    entries = data.get('rules')

    if not scope_type or not scope_key:
        return error_response('scope_type and scope_key are required')
    if not isinstance(entries, list):
        return error_response('rules must be a list')

    tenant_id = current_tenant_id_strict()

    # Only doctors on this tenant may be targeted — the doctor_id comes from
    # the client, so an unfiltered upsert would let an admin write a rule
    # against another tenant's doctor.
    valid_ids = {
        str(d_id) for (d_id,) in db.session.query(Doctor.id).filter(
            Doctor.tenant_id == tenant_id, Doctor.is_deleted == False,  # noqa: E712
        ).all()
    }

    existing = {
        (str(r.doctor_id) if r.doctor_id is not None else None): r
        for r in DisplayPricingRule.query.filter_by(
            tenant_id=tenant_id, scope_type=scope_type, scope_key=scope_key,
        ).all()
    }

    def _num(value, field):
        if value in (None, ''):
            return 0.0
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError(f'{field} must be a number')
        if value < 0:
            raise ValueError(f'{field} cannot be negative')
        return value

    # Ids are client-supplied, so they're checked against this tenant's own
    # voucher/coupon books — otherwise a rule could reference another tenant's
    # row and quietly take its amount off the price.
    valid_vouchers = {
        str(v_id) for (v_id,) in db.session.query(Voucher.id).filter(
            Voucher.tenant_id == tenant_id, Voucher.is_deleted == False,  # noqa: E712
        ).all()
    }
    valid_coupons = {
        str(c_id) for (c_id,) in db.session.query(Coupon.id).filter(
            Coupon.tenant_id == tenant_id, Coupon.is_deleted == False,  # noqa: E712
        ).all()
    }

    def _ids(value, allowed, field):
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise ValueError(f'{field} must be a list')
        out = []
        for raw in value:
            raw = str(raw)
            if raw not in allowed:
                raise ValueError(f'Unknown {field[:-4]} for this tenant: {raw}')
            if raw not in out:
                out.append(raw)
        return out

    # Same reasoning as the voucher/coupon books: a plan id arrives from the
    # client, so it is checked against this tenant's own receiver tiers —
    # otherwise a rule could name another tenant's plan and quietly grant its
    # holders a discount nobody on this tenant configured. Doubles as the
    # ceiling table the values below are clamped to.
    plan_caps = plan_discount_caps(tenant_id)

    def _plan_discounts(value):
        """One entry's ``{plan_id: pct}`` map, clamped and stripped to overrides."""
        if value in (None, ''):
            return {}
        if not isinstance(value, dict):
            raise ValueError('plan_discounts must be an object')
        out = {}
        for raw_id, raw_pct in value.items():
            plan_id = str(raw_id)
            cap = plan_caps.get(plan_id)
            if cap is None:
                raise ValueError(
                    f'Unknown membership plan for this tenant: {plan_id}')
            # An empty value is "no override", NOT zero — unlike every other
            # number on this rule, where unset and 0 mean the same thing. Here
            # 0 means "this offering grants that tier nothing", so coercing a
            # cleared input to 0 would silently take a 40% benefit away from
            # every member of it.
            if raw_pct in (None, ''):
                continue
            field = f'plan_discounts[{plan_id}]'
            pct = Decimal(str(_num(raw_pct, field)))
            if pct > 100:
                raise ValueError(f'{field} must be ≤ 100')
            pct = min(pct, cap)
            # At (or above, hence clamped to) the ceiling is not an override —
            # dropping it is what keeps this offering tracking the tier if the
            # tier's headline % is later lowered.
            if pct >= cap:
                continue
            out[plan_id] = float(pct)
        return out

    def _plan_id_map(value, allowed, field):
        """One entry's ``{plan_id: [discount_id, ...]}`` map, validated.

        Both axes are client-supplied and both are checked: the plan against
        this tenant's receiver tiers (same reason as ``_plan_discounts``), and
        the ids against this tenant's own voucher / coupon book (same reason as
        ``_ids``) — otherwise a rule could hand another tenant's plan holders
        another tenant's voucher.

        Plans selecting nothing are dropped rather than stored as empty lists,
        which keeps "no entry" and "an empty entry" the same thing and lets the
        no-op check below see a genuinely empty rule.
        """
        if value in (None, ''):
            return {}
        if not isinstance(value, dict):
            raise ValueError(f'{field} must be an object')
        out = {}
        for raw_id, raw_ids in value.items():
            plan_id = str(raw_id)
            if plan_id not in plan_caps:
                raise ValueError(
                    f'Unknown membership plan for this tenant: {plan_id}')
            picked = _ids(raw_ids, allowed, field)
            if picked:
                out[plan_id] = picked
        return out

    saved = 0
    for entry in entries:
        if not isinstance(entry, dict):
            return error_response('Each rule must be an object')
        # A group offering is priced once for the whole plan, so its rule
        # legitimately carries no doctor. Every other scope must name one that
        # belongs to this tenant — the id comes from the client, and an
        # unfiltered upsert would let an admin write against another tenant's
        # doctor.
        raw_doctor = entry.get('doctor_id')
        if scope_type == GROUP_SCOPE and raw_doctor in (None, ''):
            doctor_id = None
        else:
            doctor_id = str(raw_doctor or '')
            if doctor_id not in valid_ids:
                return error_response(f'Unknown doctor for this tenant: {doctor_id}')
        try:
            fixed = _num(entry.get('increment_fixed'), 'increment_fixed')
            pct = _num(entry.get('increment_pct'), 'increment_pct')
            discount = _num(entry.get('overall_discount_pct'),
                            'overall_discount_pct')
            voucher_ids = _ids(entry.get('voucher_ids'), valid_vouchers,
                               'voucher_ids')
            coupon_ids = _ids(entry.get('coupon_ids'), valid_coupons,
                              'coupon_ids')
            plan_discounts = _plan_discounts(entry.get('plan_discounts'))
            plan_vouchers = _plan_id_map(
                entry.get('plan_voucher_ids'), valid_vouchers, 'plan_voucher_ids')
            plan_coupons = _plan_id_map(
                entry.get('plan_coupon_ids'), valid_coupons, 'plan_coupon_ids')
        except ValueError as exc:
            return error_response(str(exc))
        if pct > 1000 or discount > 100:
            return error_response(
                'increment_pct must be ≤ 1000 and overall_discount_pct ≤ 100')

        rule = existing.get(doctor_id)
        if (not fixed and not pct and not discount and not voucher_ids
                and not coupon_ids and not plan_discounts
                and not plan_vouchers and not plan_coupons):
            if rule:
                db.session.delete(rule)
            continue

        if rule is None:
            rule = DisplayPricingRule(
                tenant_id=tenant_id,
                doctor_id=doctor_id,
                scope_type=scope_type,
                scope_key=scope_key,
                created_by_id=current_user.id,
            )
            db.session.add(rule)
        rule.increment_fixed = fixed
        rule.increment_pct = pct
        rule.overall_discount_pct = discount
        rule.voucher_ids = voucher_ids
        rule.coupon_ids = coupon_ids
        rule.plan_discounts = plan_discounts
        rule.plan_voucher_ids = plan_vouchers
        rule.plan_coupon_ids = plan_coupons
        rule.updated_by_id = current_user.id
        saved += 1

    db.session.commit()
    logger.info(
        '[DISPLAY_PRICING] %s/%s saved %s rule(s) by user=%s',
        scope_type, scope_key, saved, current_user.id,
    )
    return success_response(
        data={'saved': saved},
        message='Display pricing saved. Patients now see the updated price.',
    )


# ─── voucher / coupon books ────────────────────────────────────────────────
#
# Two separate books, same shape. Each handler is registered under both static
# paths with ``defaults`` rather than behind a ``/<kind>`` converter: a
# converter at this level would sit alongside the static ``/rows`` / ``/scopes``
# / ``/rules`` rules and leave which-one-wins up to Werkzeug's precedence
# rules. Two explicit paths can't be ambiguous.

_BOOKS = {
    'vouchers': (Voucher, 'Voucher'),
    'coupons': (Coupon, 'Coupon'),
}


def _book(kind):
    """``(model, singular_label)`` for a book segment."""
    return _BOOKS[kind]


def _clean_discount_payload(data, model, tenant_id, label, current_id=None):
    """Validate a voucher/coupon body → ``(fields, error_response)``."""
    code = (data.get('code') or '').strip().upper()
    if not code:
        return None, error_response(f'{label} code is required')
    if len(code) > 40:
        return None, error_response(f'{label} code must be 40 characters or fewer')

    clash = model.query.filter(
        model.tenant_id == tenant_id,
        model.code == code,
        model.is_deleted == False,  # noqa: E712
    ).first()
    if clash is not None and str(clash.id) != str(current_id or ''):
        return None, error_response(f'{label} code "{code}" already exists')

    try:
        amount = float(data.get('amount') or 0)
    except (TypeError, ValueError):
        return None, error_response('amount must be a number')
    if amount < 0:
        return None, error_response('amount cannot be negative')

    return {
        'code': code,
        'label': (data.get('label') or '').strip() or None,
        'amount': amount,
        'is_active': bool(data.get('is_active', True)),
    }, None


@display_pricing_bp.route('/vouchers', methods=['GET'], defaults={'kind': 'vouchers'})
@display_pricing_bp.route('/coupons', methods=['GET'], defaults={'kind': 'coupons'})
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_discounts(kind):
    """The tenant's voucher or coupon book, newest first."""
    model, _label = _book(kind)
    rows = model.query.filter(
        model.tenant_id == current_tenant_id_strict(),
        model.is_deleted == False,  # noqa: E712
    ).order_by(model.created_at.desc()).all()
    return success_response(data=[r.to_dict() for r in rows])


@display_pricing_bp.route('/vouchers', methods=['POST'], defaults={'kind': 'vouchers'})
@display_pricing_bp.route('/coupons', methods=['POST'], defaults={'kind': 'coupons'})
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def create_discount(kind):
    model, label = _book(kind)
    tenant_id = current_tenant_id_strict()
    fields, err = _clean_discount_payload(
        request.get_json() or {}, model, tenant_id, label)
    if err:
        return err

    row = model(tenant_id=tenant_id, created_by_id=current_user.id, **fields)
    db.session.add(row)
    db.session.commit()
    return success_response(data=row.to_dict(), message=f'{label} created',
                            status_code=201)


@display_pricing_bp.route('/vouchers/<row_id>', methods=['PUT'], defaults={'kind': 'vouchers'})
@display_pricing_bp.route('/coupons/<row_id>', methods=['PUT'], defaults={'kind': 'coupons'})
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_discount(kind, row_id):
    model, label = _book(kind)
    tenant_id = current_tenant_id_strict()
    row = model.query.filter_by(
        id=row_id, tenant_id=tenant_id, is_deleted=False).first()
    if row is None:
        return error_response(f'{label} not found', status_code=404)

    fields, err = _clean_discount_payload(
        request.get_json() or {}, model, tenant_id, label, current_id=row.id)
    if err:
        return err

    for key, value in fields.items():
        setattr(row, key, value)
    row.updated_by_id = current_user.id
    db.session.commit()
    return success_response(data=row.to_dict(), message=f'{label} updated')


@display_pricing_bp.route('/vouchers/<row_id>', methods=['DELETE'], defaults={'kind': 'vouchers'})
@display_pricing_bp.route('/coupons/<row_id>', methods=['DELETE'], defaults={'kind': 'coupons'})
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def delete_discount(kind, row_id):
    """Soft-delete. Pricing rules may still name the id; the resolver skips
    ids it can't resolve, so the price falls back cleanly rather than erroring.
    """
    model, label = _book(kind)
    row = model.query.filter_by(
        id=row_id, tenant_id=current_tenant_id_strict(), is_deleted=False).first()
    if row is None:
        return error_response(f'{label} not found', status_code=404)

    from app.models._base import soft_delete_record
    soft_delete_record(row)
    row.updated_by_id = current_user.id
    db.session.commit()
    return success_response(data={'id': str(row.id)}, message=f'{label} deleted')
