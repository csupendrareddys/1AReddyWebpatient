"""
Patient-facing Group Offering (healthcare plan) browsing + booking.

  GET  /api/patient/group-offerings                    published plans
  GET  /api/patient/group-offerings/<id>               plan detail
  GET  /api/patient/group-offerings/<id>/teams         approved teams to pick
  POST /api/patient/group-offerings/<id>/book          book a plan + team
  GET  /api/patient/group-offerings/bookings           my bookings

The patient picks one approved TEAM (multiple can offer a plan) and pays the
full plan price ONCE (no patient-side installments — those are on the doctor
payout side). On payment the team's channels open (group chat + per-doctor)
and each doctor's payout installments are generated. The patient never sees
per-doctor fees.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.service_reciever.patient import patient_bp
from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.models import (
    UserRole, GroupOffering, GroupOfferingBooking, GroupOfferingBookingInstallment,
    MarketplaceServiceGroup,
)
from app.extensions import db

logger = logging.getLogger(__name__)


def _patient():
    return getattr(current_user, 'patient_profile', None)


def _patient_team_dict(team):
    """Team info safe for the patient — doctors + THIS team's listed price, but
    NO per-doctor fees. Each team sets its own price, so the patient sees a
    price per team, not one plan-wide figure."""
    return {
        'id': str(team.id),
        'lead_name': team.lead.full_name if team.lead else None,
        'description': team.group_description,
        # The team's own patient-facing price (before the buyer's tier discount,
        # which is settled at booking). Always set — defaults to the plan price.
        'patient_price': str(team.group_price) if team.group_price is not None else None,
        'doctors': [
            {'doctor_id': str(m.doctor_id), 'doctor_name': m.doctor_name, 'role': m.role}
            for m in team.members if m.status == 'accepted'
        ],
    }


def _group_rule(offering_id, tid):
    """The plan's ``DisplayPricingRule``, or ``None``.

    A group offering is priced once for the whole plan, so its rule carries no
    doctor and is keyed under ``None`` — see ``rules_for_scope``. Needed
    separately from the price because the rule also carries ``plan_discounts``,
    the per-membership-tier rate, which is applied at booking rather than baked
    into the quote.
    """
    from app.common.display_pricing import GROUP_SCOPE, rules_for_scope
    return rules_for_scope(GROUP_SCOPE, str(offering_id), tenant_id=tid).get(None)


def _final_price(offering, tid):
    """The plan's patient-facing price with the admin overlay applied.

    Falls back to the plan's own ``patient_price`` when no rule exists, which
    is the identity case. Deliberately NOT net of the buyer's membership
    discount: that depends on who is asking and is settled at booking, the
    same order every other priced offering follows.
    """
    from app.common.display_pricing import display_price_for_group_offering
    priced = display_price_for_group_offering(
        offering.id, offering.patient_price, tenant_id=tid)
    return float(priced if priced is not None else (offering.patient_price or 0))


def _team_price(offering, team, tid):
    """The patient-facing price for ONE team.

    Each team sets its own ``group_price`` — two teams of the same plan may
    charge differently — so that is the listed price when present. Falls back to
    the plan's overlaid price only when a team has no price of its own. The
    buyer's membership discount is still settled on top at booking, exactly as
    for the plan-wide price.
    """
    if team is not None and team.group_price is not None:
        return float(team.group_price)
    return _final_price(offering, tid)


def _priced(offering, tid):
    """``to_dict()`` with ``patient_price`` swapped for the final price.

    The plan's own figure is kept as ``plan_base_price`` so the doctor-budget
    and margin views still have the number the plan was authored with.

    A plan a signed-in member gets a benefit on also carries
    ``member_discount_pct`` — what THIS plan grants that member, which is the
    tier's ceiling unless an admin dialled this plan below it in the pricing
    table. Same key, same meaning and same corner chip as a consultation or a
    catalog service: a membership is claimable on a plan like on anything else.
    Absent for anonymous visitors, non-members, and plans dialled to nothing.

    A marked-down plan additionally carries ``original_price`` +
    ``discount_pct`` — the plan's price BEFORE the admin's Overall %, vouchers
    and coupons came off it — so the card can slash what it came down from,
    exactly as the consultation and marketplace cards do. Note this is not
    ``plan_base_price``: that is the figure the plan was authored with, before
    the platform's increment was added on top, and striking it would advertise
    a markdown the patient never had.
    """
    from app.common.member_discount import offering_discount_pct
    from app.common.display_pricing import markdown_fields, viewer_id

    d = offering.to_dict()
    base = float(offering.patient_price or 0)
    final = _final_price(offering, tid)
    rule = _group_rule(offering.id, tid)
    d['plan_base_price'] = str(base)
    d['patient_price'] = str(final)

    markdown = markdown_fields(offering.patient_price, rule, tenant_id=tid)
    if 'original_price' in markdown:
        # Stringified like the ``patient_price`` it renders beside, so a card
        # showing both doesn't print one as '8000.0' and the other as '7200'.
        d['original_price'] = str(markdown['original_price'])
        d['discount_pct'] = markdown['discount_pct']

    pct = offering_discount_pct(rule, viewer_id())
    if pct > 0:
        d['member_discount_pct'] = float(pct)
    return d


def _approved_teams(offering_id, tid):
    return MarketplaceServiceGroup.query.filter_by(
        tenant_id=tid, group_offering_id=offering_id,
        approval_status='approved', is_active=True,
    ).order_by(MarketplaceServiceGroup.created_at.desc()).all()


@patient_bp.route('/group-offerings', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def browse_group_offerings():
    """Published, active plans that have at least one approved team."""
    tid = current_user.tenant_id
    offerings = GroupOffering.query.filter_by(
        tenant_id=tid, status='published', is_active=True, is_deleted=False,
    ).order_by(GroupOffering.created_at.desc()).all()
    # Targeted ordering — plans whose targeting matches the browsing
    # patient surface first; untargeted plans score 0 and keep their
    # created_at order (stable sort).
    from app.common.targeting_rank import (
        patient_targeting_profile, targeting_score,
    )
    profile = patient_targeting_profile(current_user)
    offerings.sort(key=lambda o: -targeting_score(o.targeting, profile))
    out = []
    for o in offerings:
        d = _priced(o, tid)
        d['team_count'] = len(_approved_teams(o.id, tid))
        d['_targeting_score'] = targeting_score(o.targeting, profile)
        out.append(d)
    return success_response(data={'offerings': out})


@patient_bp.route('/group-offerings/bookings', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def my_group_offering_bookings():
    patient = _patient()
    if not patient:
        return not_found_response('Patient')
    bookings = GroupOfferingBooking.query.filter_by(
        tenant_id=current_user.tenant_id, patient_id=patient.id,
    ).order_by(GroupOfferingBooking.created_at.desc()).all()
    return success_response(data={'bookings': [b.to_dict() for b in bookings]})


@patient_bp.route('/group-offerings/<offering_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_group_offering_detail(offering_id):
    tid = current_user.tenant_id
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=tid, status='published',
        is_active=True, is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')
    d = _priced(offering, tid)
    d['teams'] = [_patient_team_dict(t) for t in _approved_teams(offering_id, tid)]
    return success_response(data=d)


@patient_bp.route('/group-offerings/<offering_id>/teams', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_group_offering_teams(offering_id):
    tid = current_user.tenant_id
    return success_response(data={
        'teams': [_patient_team_dict(t) for t in _approved_teams(offering_id, tid)],
    })


@patient_bp.route('/group-offerings/<offering_id>/book', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def book_group_offering(offering_id):
    """Book a plan with a chosen team. Patient pays the full price once."""
    patient = _patient()
    if not patient:
        return not_found_response('Patient')

    tid = current_user.tenant_id
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=tid, status='published',
        is_active=True, is_deleted=False,
    ).first()
    if not offering:
        return error_response('Plan not found or not available', status_code=404)

    data = request.get_json() or {}
    team_id = data.get('team_id')
    if not team_id:
        return error_response('team_id is required — pick a team', status_code=400)
    team = MarketplaceServiceGroup.query.filter_by(
        id=team_id, tenant_id=tid, group_offering_id=offering.id,
        approval_status='approved', is_active=True,
    ).first()
    if not team:
        return error_response('Team not found or not available', status_code=404)

    # The patient pays the CHOSEN TEAM's price — each team of a plan can charge
    # differently (falling back to the plan's overlaid price when a team has no
    # price of its own). The doctors' budget is unaffected.
    price = _team_price(offering, team, tid)

    # Then their own membership tier, on top, exactly as a consultation or a
    # catalog service settles it: the rate is per-offering (this plan's
    # ``plan_discounts`` entry, bounded by the tier's ceiling), so the rule is
    # passed rather than letting the charge fall back to the ceiling on a plan
    # an admin deliberately dialled below it. ``payable`` is what the patient
    # owes; ``price`` stays the plan's public figure so the booking still
    # records what it was listed at.
    from app.common.member_discount import discount_for_user
    payable, member_pct, member_flat = discount_for_user(
        price, current_user.id, rule=_group_rule(offering.id, tid))

    booking = GroupOfferingBooking(
        tenant_id=tid,
        offering_id=offering.id,
        team_id=team.id,
        patient_id=patient.id,
        plan_name=offering.name,
        # The team's listed price (what this booking was quoted), before the
        # buyer's tier discount — which ``total_payable`` reflects.
        plan_price=(team.group_price if team.group_price is not None
                    else offering.patient_price),
        tax_mode=offering.tax_mode,
        tax_amount=offering.tax_amount,       # sits inside the doctor fees
        total_payable=payable,                # the plan price less their tier
        status='pending_payment',
    )
    # One payment (no patient installments), for the same figure — the two must
    # agree or the patient is shown a total the schedule then contradicts.
    booking.installments.append(GroupOfferingBookingInstallment(
        tenant_id=tid, installment_no=1, amount=payable,
        due_after_days=0, due_label='Full payment', is_booking=True,
    ))
    logger.info(
        '[GROUP_OFFERING] booking plan=%s patient=%s listed=%s member_pct=%s '
        'member_vouchers=%s payable=%s',
        offering.id, patient.id, price, member_pct, member_flat, payable,
    )
    db.session.add(booking)
    db.session.flush()
    # Apply requested health credits (scope 'group'), keeping the single
    # installment in sync with the total. Server re-caps the request.
    try:
        req = float((request.get_json(silent=True) or {}).get('redeem_credits') or 0)
        if req > 0:
            from app.api.membership import credit_service
            applied = credit_service.redeem(
                tid, current_user.id, 'group',
                float(booking.total_payable or 0), req,
                ref_type='group_booking', ref_id=booking.id)
            if applied > 0:
                booking.total_payable = float(booking.total_payable or 0) - applied
                for inst in booking.installments:
                    inst.amount = float(inst.amount or 0) - applied
                    break  # single full-payment installment
    except Exception:  # noqa: BLE001
        logger.exception('[CREDIT] group booking redeem failed')
    db.session.commit()
    return created_response(
        booking.to_dict(),
        message='Plan booked. Complete the payment to activate your plan.',
    )
