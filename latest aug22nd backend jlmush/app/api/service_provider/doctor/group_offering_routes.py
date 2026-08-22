"""
Doctor-facing Group Offering plan teams.

  GET /api/doctor/group-offering-teams   the doctor's plan-team memberships

Read-only view scoped to the doctor's OWN fee + payout installment schedule
(never other members'). Actual payouts flow through Payout Management as
DoctorPayout rows; the doctor sees them on their My Bills page.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.service_provider.doctor import doctor_bp
from app.api.service_provider.doctor.service import DoctorService
from app.common.decorators import role_required
from app.common.provider_access import acting_doctor
from app.common.responses import success_response, error_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    UserRole, MarketplaceServiceGroup, MarketplaceServiceGroupMember, GroupOffering,
    GroupOfferingBooking,
)

logger = logging.getLogger(__name__)


def _plan_constraints(plan):
    """The admin-configured plan constraints the doctor is allowed to see —
    duration, working hours, description, and a per-slot projection (video /
    voice / chat enablement + min/max durations + consultation counts).

    Deliberately EXCLUDES money that isn't the doctor's own: no
    ``doctor_budget`` / ``allocated_budget`` / other members' fees. The
    doctor's own fee stays on ``my_fee`` / ``my_installments``.
    """
    if not plan:
        return None
    slots = []
    for gm in (plan.members or []):
        slots.append({
            'qualification_name': gm.qualification_name,
            'qualification_kind': getattr(gm, 'qualification_kind', None),
            'min_consultations': gm.min_consultations,
            'max_consultations': gm.max_consultations,
            'voice_enabled': bool(gm.voice_enabled),
            'voice_min_duration': gm.voice_min_duration,
            'voice_max_duration': gm.voice_max_duration,
            'video_enabled': bool(gm.video_enabled),
            'video_min_duration': gm.video_min_duration,
            'video_max_duration': gm.video_max_duration,
            'chat_enabled': bool(gm.chat_enabled),
        })
    return {
        'description': plan.description,
        'duration_type': plan.duration_type,
        'duration_value': plan.duration_value,
        'working_hours': plan.working_hours or {},
        'total_consultations': plan.total_consultations,
        'doctors_included': plan.doctors_included,
        'slots': slots,
    }


@doctor_bp.route('/group-offering-teams', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def my_group_offering_teams():
    """The doctor's plan-team memberships — ONLY their own fee + installment
    schedule (never other members'), plus the plan name + patient price and the
    admin-configured plan constraints (duration, working hours, per-slot
    video/voice/chat + consultation limits)."""
    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    tid = current_tenant_id_strict()
    rows = (
        MarketplaceServiceGroupMember.query
        .filter_by(tenant_id=tid, doctor_id=doctor.id)
        .join(MarketplaceServiceGroup,
              MarketplaceServiceGroup.id == MarketplaceServiceGroupMember.group_id)
        .filter(MarketplaceServiceGroup.group_offering_id.isnot(None))
        .all()
    )
    out = []
    for m in rows:
        team = m.group
        plan = GroupOffering.query.get(team.group_offering_id) if team else None
        out.append({
            'membership_id': str(m.id),
            'team_id': str(m.group_id),
            'plan_name': plan.name if plan else None,
            'patient_price': str(plan.patient_price) if plan else None,
            'role': m.role,
            'status': m.status,                       # invited | accepted | declined
            'team_status': team.approval_status if team else None,
            'my_fee': str(m.allocated_fee) if m.allocated_fee is not None else None,
            'my_installments': [i.to_dict() for i in m.payout_installments],
            # Admin-configured constraints (own fee stays on my_fee above).
            'plan_details': _plan_constraints(plan),
        })
    return success_response(data={'memberships': out})


@doctor_bp.route('/group-offering-bookings', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def my_group_offering_bookings_to_serve():
    """Active plan bookings the doctor serves (their team). The completion
    document rides the shared DoctorDocument flow — this list tells the UI
    whether the doctor has started/published their document for each booking,
    and hands back the document_id to deep-link into the My Documents editor."""
    from app.models import DoctorDocument, DocumentStatus
    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    tid = current_tenant_id_strict()
    team_ids = [
        m.group_id for m in MarketplaceServiceGroupMember.query
        .filter_by(tenant_id=tid, doctor_id=doctor.id, status='accepted').all()
    ]
    if not team_ids:
        return success_response(data={'bookings': []})
    bookings = (
        GroupOfferingBooking.query
        .filter(GroupOfferingBooking.tenant_id == tid,
                GroupOfferingBooking.team_id.in_(team_ids),
                GroupOfferingBooking.status.in_(('active', 'completed')))
        .order_by(GroupOfferingBooking.created_at.desc())
        .all()
    )
    out = []
    for b in bookings:
        my_doc = (
            DoctorDocument.query
            .filter_by(tenant_id=tid, group_booking_id=b.id,
                       doctor_id=doctor.id, is_deleted=False)
            .order_by(DoctorDocument.created_at.desc())
            .first()
        )
        out.append({
            'booking_id': str(b.id),
            'plan_name': b.plan_name,
            'patient_name': b.patient.full_name if b.patient else None,
            'status': b.status,
            'my_document_id': str(my_doc.id) if my_doc else None,
            'my_document_status': my_doc.status.value if my_doc else None,
            'i_have_delivered': bool(my_doc and my_doc.status == DocumentStatus.ACTIVE),
        })
    return success_response(data={'bookings': out})

# NOTE: the completion document is created/uploaded through the shared
# DoctorDocument flow — see ``document_routes.py``
# (``/group-offering-bookings/<id>/document`` + ``/document/upload``). The
# booking is auto-completed there when every accepted team doctor's document
# reaches ACTIVE.


def _lead_booking_or_error(doctor, booking_id):
    """Fetch a booking whose team THIS doctor leads. Returns (booking, err)."""
    tid = current_tenant_id_strict()
    booking = GroupOfferingBooking.query.filter_by(id=booking_id, tenant_id=tid).first()
    if not booking or not booking.team_id:
        return None, not_found_response('Booking')
    lead = MarketplaceServiceGroupMember.query.filter_by(
        tenant_id=tid, group_id=booking.team_id, role='lead',
    ).first()
    if not lead or str(lead.doctor_id) != str(doctor.id):
        return None, error_response('Only the team lead can act on this booking',
                                    status_code=403)
    return booking, None


@doctor_bp.route('/group-offering-bookings/incoming', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def incoming_group_offering_bookings():
    """Plan bookings on the TEAM LEAD's teams across their whole lifecycle —
    the plan equivalent of the marketplace Service List's status buckets
    (pending_acceptance ≈ To Review, active ≈ In process, completed, cancelled).
    Only paid bookings surface (the lead never sees unpaid pending_payment).
    Only the lead sees these; Accept/Reject act on the pending_acceptance ones."""
    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    tid = current_tenant_id_strict()
    lead_team_ids = [
        m.group_id for m in MarketplaceServiceGroupMember.query
        .filter_by(tenant_id=tid, doctor_id=doctor.id, role='lead').all()
    ]
    if not lead_team_ids:
        return success_response(data={'bookings': []})
    bookings = (
        GroupOfferingBooking.query
        .filter(GroupOfferingBooking.tenant_id == tid,
                GroupOfferingBooking.team_id.in_(lead_team_ids),
                GroupOfferingBooking.status.in_(
                    ('pending_acceptance', 'active', 'completed', 'cancelled')))
        .order_by(GroupOfferingBooking.created_at.desc())
        .all()
    )
    return success_response(data={'bookings': [{
        'booking_id': str(b.id),
        'plan_name': b.plan_name,
        'patient_name': b.patient.full_name if b.patient else None,
        'total_payable': str(b.total_payable),
        'status': b.status,
        'created_at': b.created_at.isoformat() if b.created_at else None,
    } for b in bookings]})


@doctor_bp.route('/group-offering-bookings/<booking_id>/accept', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def accept_group_booking(booking_id):
    """The team lead accepts a paid plan booking — this OPENS the team channels
    (group chat + per-doctor 1:1), generates the doctor payouts, and seeds the
    lead's completion document. Mirrors accepting a marketplace service order."""
    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    booking, err = _lead_booking_or_error(doctor, booking_id)
    if err:
        return err
    if booking.status != 'pending_acceptance':
        return error_response(
            f'Booking cannot be accepted from status "{booking.status}".',
            status_code=400,
        )
    from app.api.common.payment.routes import (
        _activate_plan_channels, _generate_plan_payouts, _create_lead_plan_document,
    )
    booking.status = 'active'
    _activate_plan_channels(booking)
    _generate_plan_payouts(booking)
    _create_lead_plan_document(booking)
    db.session.commit()
    return success_response(
        data={'booking_id': str(booking.id), 'status': booking.status},
        message='Booking accepted — team channels are now open',
    )


@doctor_bp.route('/group-offering-bookings/<booking_id>/reject', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def reject_group_booking(booking_id):
    """The team lead declines a paid plan booking. No channels open; the booking
    is cancelled (refunds are handled out-of-band, like a rejected order)."""
    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    booking, err = _lead_booking_or_error(doctor, booking_id)
    if err:
        return err
    if booking.status != 'pending_acceptance':
        return error_response(
            f'Booking cannot be rejected from status "{booking.status}".',
            status_code=400,
        )
    booking.status = 'cancelled'
    db.session.commit()
    return success_response(
        data={'booking_id': str(booking.id), 'status': booking.status},
        message='Booking rejected',
    )
