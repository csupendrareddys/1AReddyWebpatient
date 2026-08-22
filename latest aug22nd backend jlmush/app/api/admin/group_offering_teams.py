"""
Admin team management for Group Offering plans.

A "team" is a MarketplaceServiceGroup linked to a plan (group_offering_id):
a lead + member doctors assigned to the plan's slots, each with their own
allocated fee and payout installment schedule. Reuses the existing group-service
consent (members invited → accept/reject) and, on booking, the existing group
chat + per-doctor channels. Multiple teams can fulfil one plan; each is a
bookable instance.

  GET    /admin/group-offerings/<offering_id>/teams
  POST   /admin/group-offerings/<offering_id>/teams
  GET    /admin/group-offerings/teams/<team_id>
  PUT    /admin/group-offerings/teams/<team_id>
  DELETE /admin/group-offerings/teams/<team_id>
  POST   /admin/group-offerings/teams/<team_id>/approve
"""
import logging

from flask import request, Blueprint
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    UserRole, GroupOffering, MarketplaceServiceGroup,
    MarketplaceServiceGroupMember, ServiceGroupMemberInstallment,
)
from app.extensions import db

logger = logging.getLogger(__name__)

group_offering_teams_bp = Blueprint('group_offering_teams_admin', __name__)

_MANAGE = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]


def _to_float(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _to_int(v, d=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


def _refresh_team_status(team):
    """awaiting_members until every member accepted, then pending (admin review)."""
    if team.approval_status in ('approved', 'rejected'):
        return
    all_accepted = bool(team.members) and all(m.status == 'accepted' for m in team.members)
    team.approval_status = 'pending' if all_accepted else 'awaiting_members'


def _build_member_installments(tid, member, payload):
    """Replace a member's payout installment schedule; each ≤ their fee."""
    member.payout_installments.clear()
    for idx, i in enumerate(payload or []):
        ptype = i.get('payment_type', 'fixed')
        ptype = ptype if ptype in ('fixed', 'percentage') else 'fixed'
        member.payout_installments.append(ServiceGroupMemberInstallment(
            tenant_id=tid,
            installment_no=_to_int(i.get('installment_no'), idx + 1),
            payment_type=ptype,
            amount=(None if ptype == 'percentage' else max(0.0, _to_float(i.get('amount'), 0))),
            percentage=(max(0.0, _to_float(i.get('percentage'), 0)) if ptype == 'percentage' else None),
            period_label=(i.get('period_label') or None),
            due_after_days=max(0, _to_int(i.get('due_after_days'), 0)),
        ))


def _member_installment_total(member):
    total = 0.0
    fee = float(member.allocated_fee or 0)
    for i in member.payout_installments:
        total += fee * float(i.percentage or 0) / 100 if i.payment_type == 'percentage' else float(i.amount or 0)
    return total


def _apply_members(tid, team, members_payload, lead_doctor_id):
    """(Re)build a team's members from the payload. Lead auto-accepted; the rest
    invited (they must accept). Each member carries fee + installment schedule."""
    team.members.clear()
    for m in members_payload or []:
        doctor_id = m.get('doctor_id')
        if not doctor_id:
            continue
        is_lead = str(doctor_id) == str(lead_doctor_id)
        mem = MarketplaceServiceGroupMember(
            tenant_id=tid,
            doctor_id=doctor_id,
            role='lead' if is_lead else 'member',
            status='accepted' if is_lead else 'invited',
            group_offering_member_id=m.get('group_offering_member_id') or None,
            allocated_fee=max(0.0, _to_float(m.get('allocated_fee'), 0)),
        )
        team.members.append(mem)
        _build_member_installments(tid, mem, m.get('payout_installments'))


def _validate_team(team, offering):
    errors = []
    if not team.members:
        errors.append('Add at least one doctor.')
    if not any(m.role == 'lead' for m in team.members):
        errors.append('A lead doctor is required.')
    # Fees must stay within their slot budget + the plan's total.
    slot_budget = {str(s.id): float(s.allocated_budget or 0) for s in offering.members}
    fee_total = 0.0
    for m in team.members:
        fee = float(m.allocated_fee or 0)
        fee_total += fee
        if m.group_offering_member_id:
            cap = slot_budget.get(str(m.group_offering_member_id))
            if cap is not None and fee > cap + 1e-6:
                errors.append(f'{m.doctor_name}: fee exceeds the slot budget (₹{cap:g}).')
        inst_total = _member_installment_total(m)
        if inst_total > fee + 1e-6:
            errors.append(f'{m.doctor_name}: installments exceed their fee.')
    # A team can't pay its doctors more than it charges the patient — cap the
    # total against THIS team's price (falling back to the plan's).
    team_price = float(team.group_price if team.group_price is not None
                       else (offering.patient_price or 0))
    if fee_total > team_price + 1e-6:
        errors.append("Total team fees exceed this team's patient price.")
    return errors


def _team_dict(team):
    d = team.to_dict()
    for m, src in zip(d['members'], team.members):
        m['installment_total'] = _member_installment_total(src)
    return d


def _get_offering(offering_id, tid):
    return GroupOffering.query.filter_by(id=offering_id, tenant_id=tid, is_deleted=False).first()


def _get_team(team_id, tid):
    return MarketplaceServiceGroup.query.filter_by(id=team_id, tenant_id=tid).first()


@group_offering_teams_bp.route('/<offering_id>/teams', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_teams(offering_id):
    tid = current_tenant_id_strict()
    teams = MarketplaceServiceGroup.query.filter_by(
        tenant_id=tid, group_offering_id=offering_id,
    ).order_by(MarketplaceServiceGroup.created_at.desc()).all()
    return success_response(data={'teams': [_team_dict(t) for t in teams]})


@group_offering_teams_bp.route('/<offering_id>/teams', methods=['POST'])
@jwt_required()
@role_required(_MANAGE)
def create_team(offering_id):
    tid = current_tenant_id_strict()
    offering = _get_offering(offering_id, tid)
    if not offering:
        return not_found_response('GroupOffering')
    data = request.get_json() or {}
    lead_id = data.get('lead_doctor_id')
    if not lead_id:
        return error_response('lead_doctor_id is required', status_code=400)

    # The team's channels open against the plan's hidden backing product, so
    # the plan must have one before a bookable team exists.
    from app.api.admin.group_offerings import ensure_plan_product
    plan_product = ensure_plan_product(tid, offering)

    # Each team sets its OWN patient-facing price — two teams of the same plan
    # may charge differently. Defaults to the plan's price when not supplied.
    raw_price = data.get('group_price')
    group_price = (_to_float(raw_price, offering.patient_price)
                   if raw_price not in (None, '') else offering.patient_price)
    team = MarketplaceServiceGroup(
        tenant_id=tid,
        group_offering_id=offering.id,
        product_id=plan_product.id,
        created_by_doctor_id=lead_id,
        group_price=group_price,
        group_description=(data.get('description') or offering.name),
        approval_status='awaiting_members',
    )
    _apply_members(tid, team, data.get('members'), lead_id)
    _refresh_team_status(team)
    db.session.add(team)
    db.session.commit()
    return created_response(_team_dict(team), message='Team created; doctors invited')


@group_offering_teams_bp.route('/teams/<team_id>', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def get_team(team_id):
    team = _get_team(team_id, current_tenant_id_strict())
    if not team:
        return not_found_response('Team')
    return success_response(data=_team_dict(team))


@group_offering_teams_bp.route('/teams/<team_id>', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE)
def update_team(team_id):
    tid = current_tenant_id_strict()
    team = _get_team(team_id, tid)
    if not team:
        return not_found_response('Team')
    data = request.get_json() or {}
    lead_id = data.get('lead_doctor_id', team.created_by_doctor_id)
    if 'description' in data:
        team.group_description = data['description']
    if 'group_price' in data and data['group_price'] not in (None, ''):
        team.group_price = _to_float(data['group_price'], team.group_price)
    if 'lead_doctor_id' in data:
        team.created_by_doctor_id = lead_id
    if 'members' in data:
        _apply_members(tid, team, data.get('members'), lead_id)
        _refresh_team_status(team)
    db.session.commit()
    return success_response(_team_dict(team), message='Team updated')


@group_offering_teams_bp.route('/teams/<team_id>/approve', methods=['POST'])
@jwt_required()
@role_required(_MANAGE)
def approve_team(team_id):
    tid = current_tenant_id_strict()
    team = _get_team(team_id, tid)
    if not team:
        return not_found_response('Team')
    offering = _get_offering(team.group_offering_id, tid) if team.group_offering_id else None
    if not offering:
        return error_response('Team is not linked to a plan', status_code=400)
    if not all(m.status == 'accepted' for m in team.members):
        return error_response('All doctors must accept before approval', status_code=400)
    errors = _validate_team(team, offering)
    if errors:
        return error_response('Cannot approve: ' + ' '.join(errors),
                              status_code=400, errors={'validation': errors})
    team.approval_status = 'approved'
    team.rejection_reason = None
    db.session.commit()
    return success_response(_team_dict(team), message='Team approved — now bookable')


@group_offering_teams_bp.route('/teams/<team_id>', methods=['DELETE'])
@jwt_required()
@role_required(_MANAGE)
def delete_team(team_id):
    team = _get_team(team_id, current_tenant_id_strict())
    if not team:
        return not_found_response('Team')
    db.session.delete(team)
    db.session.commit()
    return success_response(message='Team deleted')
