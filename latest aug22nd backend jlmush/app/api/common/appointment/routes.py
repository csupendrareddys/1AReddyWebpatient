"""
Appointment Routes
API endpoints for appointment scheduling and management

MVP endpoints:
- POST /appointment - Book appointment (patient)
- GET /appointment/<id> - Get appointment details
- GET /appointment/patient/upcoming - Patient's upcoming appointments
- GET /appointment/patient/history - Patient's past appointments
- POST /appointment/<id>/cancel - Cancel appointment
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user
from datetime import datetime, time as dt_time

from . import appointment_bp
from .service import AppointmentService
from app.common.decorators import role_required
from app.common.responses import success_response, error_response, validation_error_response
from app.models import UserRole, AppointmentStatus, AppointmentType, Patient, Doctor


@appointment_bp.route('', methods=['POST'], strict_slashes=False)
@jwt_required()
@role_required(UserRole.PATIENT)
def book_appointment():
    """
    Book a new appointment.

    Request Body:
        {
            "doctor_id": "uuid",
            "appointment_date": "2024-02-07",
            "start_time": "09:00",
            "end_time": "09:15",
            "appointment_type": "online" | "in_clinic" | "home_visit",
            "consultation_type": "video" | "audio" | "chat" | "complete",  (optional)
            "time_slot_id": "uuid",                                        (optional)
            "chief_complaint": "Brief description of symptoms",
            "consultation_fee": 500,       (optional)
            "slot_duration_minutes": 15    (optional, informational)
        }
    """
    data = request.get_json() or {}

    # --- Required fields ---
    from app.common.decorators import scalar_str
    doctor_id = scalar_str(data.get('doctor_id'))
    if not doctor_id:
        return validation_error_response({'doctor_id': 'Doctor ID is required'})

    # --- Verify doctor exists, is verified, AND belongs to the
    # ---  calling patient's tenant. Without the tenant filter an
    # ---  authenticated patient on tenant X could book an
    # ---  appointment with a doctor on tenant Y by passing that
    # ---  doctor's UUID — hard tenant-isolation violation.
    from app.models import UserVerificationStatus
    doctor = Doctor.query.filter_by(
        id=doctor_id,
        is_deleted=False,
        verification_status=UserVerificationStatus.VERIFIED,
        tenant_id=current_user.tenant_id,
    ).first()
    if not doctor:
        return error_response('Doctor not found or not available', status_code=404)

    # --- Parse appointment date ---
    from datetime import date
    date_str = data.get('appointment_date')
    if not date_str:
        return validation_error_response({'appointment_date': 'appointment_date is required (YYYY-MM-DD)'})
    try:
        appt_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return validation_error_response({'appointment_date': 'Invalid date format. Use YYYY-MM-DD'})

    if appt_date < date.today():
        return validation_error_response({'appointment_date': 'Cannot book appointments in the past'})

    # --- Parse start / end times ---
    start_str = data.get('start_time')
    end_str = data.get('end_time')
    if not start_str:
        return validation_error_response({'start_time': 'start_time is required (HH:MM)'})

    try:
        start_time = datetime.strptime(start_str, '%H:%M').time()
    except ValueError:
        return validation_error_response({'start_time': 'Invalid time format. Use HH:MM'})

    end_time = None
    if end_str:
        try:
            end_time = datetime.strptime(end_str, '%H:%M').time()
        except ValueError:
            return validation_error_response({'end_time': 'Invalid time format. Use HH:MM'})

    # --- Parse appointment type ---
    appt_type_str = data.get('appointment_type', 'online').lower()
    try:
        appt_type = AppointmentType(appt_type_str)
    except ValueError:
        appt_type = AppointmentType.ONLINE

    # --- Plan-feature gate for consultation modes ─────────────────
    # Mode (in_person / video / audio / chat / home_visit / camp) is
    # body-driven, so we can't apply a static @feature_required
    # decorator the way admin routes do. Resolve the path per-request
    # from (appointment_type, consultation_type) and hand it to the
    # FeatureGate explicitly. PLATFORM_OWNER bypasses (consistent
    # with the decorator's behaviour). Tenants without an active
    # subscription get 402; tenants whose plan doesn't enable the
    # mode get 403 ``feature_disabled`` with the path echoed in the
    # body so the frontend can route to an upgrade prompt.
    consultation_type_str = (data.get('consultation_type') or '').lower()
    if appt_type == AppointmentType.IN_CLINIC:
        feature_path = 'consultation.in_person'
    elif appt_type == AppointmentType.HOME_VISIT:
        feature_path = 'consultation.home_visit'
    elif consultation_type_str == 'audio':
        feature_path = 'consultation.audio'
    elif consultation_type_str == 'chat':
        feature_path = 'consultation.chat'
    else:
        # Default for ONLINE / unspecified consultation_type — video.
        feature_path = 'consultation.video'

    if current_user.role != UserRole.PLATFORM_OWNER:
        from app.api.pricing.service import (
            FeatureGate, FeatureDisabled, NoActiveSubscription,
        )
        from app.common.tenant_context import current_tenant_id
        tenant_id = current_tenant_id()
        if tenant_id:
            try:
                FeatureGate.require_feature(tenant_id, feature_path)
            except FeatureDisabled as exc:
                return error_response(
                    'Consultation mode not available on your tenant\'s plan',
                    code='feature_disabled',
                    status_code=403,
                    data={'feature': exc.feature_path},
                )
            except NoActiveSubscription:
                return error_response(
                    'Tenant has no active subscription',
                    code='no_active_subscription',
                    status_code=402,
                )

    appointment_data = {
        'doctor_id': doctor_id,
        'appointment_date': appt_date,
        'start_time': start_time,
        'end_time': end_time,
        'appointment_type': appt_type,
        'chief_complaint': data.get('chief_complaint', ''),
        'consultation_fee': data.get('consultation_fee') or doctor.consultation_fee,
        'time_slot_id': data.get('time_slot_id'),
        'consultation_type': data.get('consultation_type'),
        # Redemptions applied at booking (server re-validates + re-caps both).
        'redeemed_discount_ids': data.get('redeemed_discount_ids') or [],
        'redeem_credits': data.get('redeem_credits') or 0,
    }

    # Who initiated this booking, for accountability. On an act-on-behalf
    # booking (a support-staff caregiver, a linked family member, or an admin in
    # Operations) ``acting_admin()`` is the real caller — ``current_user`` here
    # is the impersonated patient. NULL means the patient booked it themselves.
    from app.common.profile_audit import acting_admin
    _actor = acting_admin()
    # A caregiver (PATIENT_STAFF) creating this booking cannot pay for it — the
    # patient settles it later from their own account — so it must not expire on
    # the 10-minute abandoned-checkout timer.
    _defer_payment = (
        _actor is not None
        and getattr(_actor, 'role', None) == UserRole.PATIENT_STAFF
    )
    try:
        appointment = AppointmentService.create(
            current_user.id, appointment_data,
            initiated_by_id=(_actor.id if _actor is not None else None),
            defer_payment=_defer_payment,
        )
        return success_response(
            message='Appointment request sent. Waiting for doctor confirmation.',
            data=appointment.to_dict(include_relations=True),
            status_code=201
        )
    except ValueError as e:
        # 409 Conflict for slot duplicates. Distinct codes because the app
        # reacts differently: slot_taken → refresh the grid and repick;
        # own_duplicate_booking → jump to the existing appointment.
        low = str(e).lower()
        if 'already have a pending' in low:
            code = 'own_duplicate_booking'
        elif 'already been booked' in low or 'already booked' in low:
            code = 'slot_taken'
        else:
            code = None  # status default: 'conflict'
        return error_response(str(e), status_code=409, code=code)


@appointment_bp.route('/<appointment_id>', methods=['GET'])
@jwt_required()
def get_appointment(appointment_id):
    """Get appointment details."""
    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment:
        return error_response('Appointment not found', status_code=404)
    
    # Check authorization
    is_patient = appointment.patient.user_id == current_user.id
    is_doctor = appointment.doctor.user_id == current_user.id
    is_admin = current_user.role in [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]
    
    if not (is_patient or is_doctor or is_admin):
        return error_response('Not authorized to view this appointment', status_code=403)
    
    # Build response with related data
    data = appointment.to_dict(include_relations=True)
    data['chief_complaint'] = appointment.chief_complaint
    data['notes'] = appointment.notes
    data['doctor'] = {
        'id': str(appointment.doctor.id),
        'full_name': appointment.doctor.full_name,
        'specializations': [
            s.category.name for s in appointment.doctor.specializations if s.category
        ] if hasattr(appointment.doctor, 'specializations') else []
    }
    data['patient'] = {
        'id': str(appointment.patient.id),
        'full_name': appointment.patient.full_name,
    }
    
    # Include prescription info if completed
    if appointment.status == AppointmentStatus.COMPLETED:
        data['prescriptions'] = [
            {'id': str(p.id), 'diagnosis': p.diagnosis, 'issue_date': p.issue_date.isoformat()}
            for p in appointment.prescriptions if not p.is_deleted
        ]
    
    return success_response(data=data)


def _enrich_patient_appt_row(appt, data):
    """Add the top-level doctor id, the editable intake-context reference (for
    the post-booking Edit-health-info action), and the latest payment summary to
    a patient appointment row."""
    from app.models import Payment, PaymentStatus
    data['doctor_id'] = str(appt.doctor.id) if appt.doctor else None
    ctx = getattr(appt, 'medical_context', None)
    data['medical_context'] = (
        {'id': str(ctx.id), 'is_editable': ctx.is_editable()} if ctx else None
    )
    # The reservation deadline for an unpaid booking — the main account renders a
    # live countdown from this and the slot is released when it passes. Top-level
    # (not under ``payment``) because a PENDING_PAYMENT row has no Payment yet.
    data['expires_at'] = (
        appt.payment_expiry.isoformat() if appt.payment_expiry else None
    )
    pay = (Payment.query
           .filter_by(appointment_id=appt.id)
           .order_by(Payment.created_at.desc())
           .first())
    data['payment'] = {
        'amount': str(pay.amount),
        'currency': pay.currency,
        'status': pay.status.value,
        'method': pay.payment_gateway,
        'date': pay.payment_date.isoformat() if pay.payment_date else None,
        'paid': pay.status == PaymentStatus.SUCCESS,
    } if pay is not None else None
    return data


@appointment_bp.route('/patient/upcoming', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_patient_upcoming():
    """Get patient's upcoming appointments — anything they've booked
    that isn't terminal (completed / cancelled / expired / no_show).

    Status set was too narrow (PENDING + CONFIRMED only) and was
    hiding three legitimate "upcoming" states from the patient:
      * PENDING_PAYMENT — patient just booked + paid via Razorpay
        but verify hasn't fired yet, so the appointment exists but
        isn't CONFIRMED. The patient would think the booking
        failed silently.
      * IN_PROGRESS — flipped when EITHER party joins the video
        call (Round-10 attendance gate). Appointment was vanishing
        from the upcoming list the moment the doctor clicked Join,
        so the patient lost their Join Call button mid-meeting.

    The date floor also used ``date.today()`` (server UTC), so an
    IST appointment on the early-morning-UTC-overflow boundary was
    excluded as "yesterday". Pin to IST wall-clock to match the
    booking flow's local time.
    """
    patient = Patient.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    from app.models import Appointment
    from datetime import datetime, timedelta, timezone as _tz
    IST = _tz(timedelta(hours=5, minutes=30))
    today_ist = datetime.now(IST).date()

    appointments = Appointment.query.filter(
        Appointment.patient_id == patient.id,
        Appointment.is_deleted == False,
        Appointment.status.in_([
            AppointmentStatus.PENDING_PAYMENT,
            AppointmentStatus.PENDING,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
        ]),
        Appointment.appointment_date >= today_ist,
    ).order_by(Appointment.appointment_date.asc()).all()
    
    result = []
    for appt in appointments:
        data = appt.to_dict(include_relations=True)
        data['doctor'] = {
            'id': str(appt.doctor.id),
            'full_name': appt.doctor.full_name,
        }
        data['chief_complaint'] = appt.chief_complaint
        # Documents the patient attached to this booking (post-booking uploads
        # too). The patient hub lists these + lets the patient attach more, so
        # the lean list has to carry them — otherwise a freshly-attached doc
        # never appears until the order-detail page is opened.
        data['documents'] = [
            d.to_dict() for d in appt.documents.filter_by(is_deleted=False).all()
        ]
        _enrich_patient_appt_row(appt, data)
        result.append(data)

    return success_response(data={'appointments': result})


@appointment_bp.route('/patient/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_patient_history():
    """Get patient's past appointments (completed or cancelled)."""
    patient = Patient.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    
    from app.models import Appointment
    
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 50)
    
    appointments = Appointment.query.filter(
        Appointment.patient_id == patient.id,
        Appointment.is_deleted == False,
        Appointment.status.in_([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED])
    ).order_by(Appointment.appointment_date.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    result = []
    for appt in appointments.items:
        data = appt.to_dict(include_relations=True)
        data['doctor'] = {
            'id': str(appt.doctor.id),
            'full_name': appt.doctor.full_name,
        }
        data['documents'] = [
            d.to_dict() for d in appt.documents.filter_by(is_deleted=False).all()
        ]
        # Include full prescription data for completed appointments
        if appt.status == AppointmentStatus.COMPLETED:
            rx = appt.prescriptions.filter_by(is_deleted=False).first()
            if rx:
                data['prescription'] = rx.to_dict()
            else:
                data['prescription'] = None
        _enrich_patient_appt_row(appt, data)
        result.append(data)
    
    return success_response(data={
        'appointments': result,
        'pagination': {
            'page': appointments.page,
            'per_page': appointments.per_page,
            'total': appointments.total,
            'pages': appointments.pages,
        }
    })


@appointment_bp.route('/<appointment_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_appointment(appointment_id):
    """Cancel an appointment."""
    try:
        # Approval-matrix gate on a DOCTOR-initiated cancel only (patients are
        # never gated — get_by_user_id returns None for them).
        from app.api.service_provider.doctor.service import DoctorService
        doctor = DoctorService.get_by_user_id(current_user.id)
        if doctor:
            from app.api.admin.doctor_action_gate import gate_action
            outcome, obj = gate_action(
                doctor, 'appointment_cancel', ref_type='appointment',
                ref_id=appointment_id, label='Cancel appointment',
                requested_by_id=current_user.id)
            if outcome == 'reject':
                return error_response(obj, status_code=403)
            if outcome == 'held':
                return success_response(
                    message='Cancellation submitted for admin approval.',
                    data={'held': True, 'action_id': str(obj.id)})

        appointment = AppointmentService.cancel(appointment_id, current_user.id)
        if not appointment:
            return error_response('Appointment not found', status_code=404)

        # Persist-first: tell the OTHER side live. ``doctor`` above tells
        # us who initiated — a doctor-initiated cancel notifies the
        # patient; a patient-initiated one notifies the doctor.
        from app.common.notify import notify_appointment_event
        notify_appointment_event(
            appointment,
            'cancelled_by_doctor' if doctor else 'cancelled_by_patient')

        return success_response(
            message='Appointment cancelled',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)


@appointment_bp.route('/<appointment_id>/reschedule', methods=['PUT'])
@jwt_required()
def reschedule_appointment(appointment_id):
    """Move an appointment to a different free slot of the same doctor.

    Body: ``{"time_slot_id": "<uuid>"}``. Allowed for the appointment's
    patient or doctor while it is PENDING/CONFIRMED and more than 24h
    before the start. Status is kept; the other side is notified live.
    """
    data = request.get_json() or {}
    new_slot_id = data.get('time_slot_id')
    if not new_slot_id:
        return error_response('time_slot_id is required', status_code=400)

    try:
        # Who is acting decides who gets notified (mirrors cancel).
        from app.api.service_provider.doctor.service import DoctorService
        doctor = DoctorService.get_by_user_id(current_user.id)

        appointment = AppointmentService.reschedule(
            appointment_id, current_user.id, new_slot_id)
        if not appointment:
            return error_response('Appointment not found', status_code=404)

        from app.common.notify import notify_appointment_event
        notify_appointment_event(
            appointment,
            'rescheduled_by_doctor' if doctor else 'rescheduled_by_patient')

        return success_response(
            message='Appointment rescheduled',
            data=appointment.to_dict(include_relations=True),
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        # Distinct codes: window_closed → hide the reschedule button;
        # slot_taken → refresh the slot grid and let the user repick.
        low = str(e).lower()
        if 'rescheduled up to' in low:
            code = 'reschedule_window_closed'
        elif 'already been booked' in low or 'already booked' in low:
            code = 'slot_taken'
        else:
            code = None  # status default: 'bad_request'
        return error_response(str(e), status_code=400, code=code)


# Doctor routes are in doctor blueprint
@appointment_bp.route('/<appointment_id>/confirm', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def confirm_appointment(appointment_id):
    """Confirm an appointment (doctor only)."""
    try:
        appointment = AppointmentService.confirm(appointment_id, current_user.id)
        if not appointment:
            return error_response('Appointment not found', status_code=404)

        # For ONLINE appointments: set meeting_link and pre-create Twilio room if starting soon
        from app.models import AppointmentType
        from app.api.common.video.service import VideoService
        from app.extensions import db as ext_db
        if appointment.appointment_type == AppointmentType.ONLINE:
            appointment.meeting_link = f"/meeting/{appointment.id}"
            VideoService.maybe_pre_create_room(appointment)
            ext_db.session.commit()

        return success_response(
            message='Appointment confirmed',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)


@appointment_bp.route('/<appointment_id>/complete', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def complete_appointment(appointment_id):
    """Mark appointment as completed (doctor only)."""
    data = request.get_json() or {}
    notes = data.get('notes', '')
    
    try:
        appointment = AppointmentService.complete(appointment_id, current_user.id, notes)
        if not appointment:
            return error_response('Appointment not found', status_code=404)
        
        return success_response(
            message='Appointment marked as complete',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)


@appointment_bp.route('/<appointment_id>/notes', methods=['PUT'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def update_notes(appointment_id):
    """Update appointment notes (doctor only)."""
    from app.extensions import db
    
    data = request.get_json() or {}
    notes = data.get('notes', '')
    
    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment:
        return error_response('Appointment not found', status_code=404)
    
    if appointment.doctor.user_id != current_user.id:
        return error_response('Not authorized', status_code=403)
    
    appointment.notes = notes
    db.session.commit()
    
    return success_response(
        message='Notes updated',
        data=appointment.to_dict(include_relations=True)
    )
