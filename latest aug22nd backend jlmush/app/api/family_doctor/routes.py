"""Family Doctor / Empanelment endpoints.

A patient has at most ONE active family doctor; a doctor can have MANY
empanelled patients. Either side may request; the other accepts. Three
add-methods (mirroring the care-network flows): by name + phone, by invite
code, and by portal directory search.
"""
import secrets
from datetime import timedelta

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.family_doctor import family_doctor_bp
from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models._base import utcnow
from app.extensions import db
from app.models import (
    UserRole, User, Patient, Doctor,
    FamilyDoctorLink, FamilyDoctorRequest, HouseGroupRequestStatus,
)

_CODE_TTL_DAYS = 30


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _current_patient():
    return Patient.query.filter_by(
        user_id=current_user.id, tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()


def _current_doctor():
    return Doctor.query.filter_by(
        user_id=current_user.id, tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()


def _active_patient_link(patient_id):
    return FamilyDoctorLink.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        patient_id=patient_id, is_active=True,
    ).first()


def _user_by_phone(phone, role):
    """Phone is stored encrypted; look it up via the searchable hash."""
    from app.common.encryption import hash_for_search
    return User.query.filter_by(
        tenant_id=current_tenant_id_strict(), role=role, is_deleted=False,
        _phone_hash=hash_for_search(phone),
    ).first()


def _doctor_by_phone(phone):
    u = _user_by_phone(phone, UserRole.DOCTOR)
    if not u:
        return None
    return Doctor.query.filter_by(user_id=u.id, is_deleted=False).first()


def _patient_by_phone(phone):
    u = _user_by_phone(phone, UserRole.PATIENT)
    if not u:
        return None
    return Patient.query.filter_by(user_id=u.id, is_deleted=False).first()


def _create_link(patient_id, doctor_id, via):
    """Create the active link, enforcing one family doctor per patient."""
    if _active_patient_link(patient_id):
        return None, 'This patient already has a family doctor. Delink first.'
    link = FamilyDoctorLink(
        tenant_id=current_tenant_id_strict(),
        patient_id=patient_id, doctor_id=doctor_id,
        linked_via=via, is_active=True,
    )
    db.session.add(link)
    db.session.commit()
    return link, None


# --------------------------------------------------------------------------- #
# Patient side
# --------------------------------------------------------------------------- #
@family_doctor_bp.route('/me', methods=['GET'])
@jwt_required()
@role_required([UserRole.PATIENT])
def get_my_family_doctor():
    """The patient's current family doctor (or null)."""
    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    link = _active_patient_link(patient.id)
    return success_response(data={'family_doctor': link.to_dict() if link else None})


@family_doctor_bp.route('/doctors/search', methods=['GET'])
@jwt_required()
@role_required([UserRole.PATIENT])
def search_doctors():
    """Directory search by name (as per portal) — the 3rd add method."""
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return success_response(data={'doctors': []})
    tid = current_tenant_id_strict()
    rows = (
        db.session.query(Doctor, User)
        .join(User, Doctor.user_id == User.id)
        .filter(
            Doctor.tenant_id == tid,
            User.role == UserRole.DOCTOR,
            User.is_deleted == False,  # noqa: E712
            db.or_(User.first_name.ilike(f'%{q}%'), User.last_name.ilike(f'%{q}%')),
        )
        .limit(20)
        .all()
    )
    return success_response(data={'doctors': [
        {
            'doctor_id': str(d.id),
            'name': f'{u.first_name or ""} {u.last_name or ""}'.strip(),
            'registration_number': (
                '' if (d.registration_number or '').startswith('FACILITY-')
                else d.registration_number
            ),
        }
        for d, u in rows
    ]})


@family_doctor_bp.route('/request', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT])
def patient_send_request():
    """Patient requests a doctor as their family doctor — by ``doctor_id``
    (directory) or ``target_phone`` + ``target_name`` (name + phone)."""
    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    if _active_patient_link(patient.id):
        return error_response('You already have a family doctor. Delink first.', status_code=400)

    data = request.get_json() or {}
    doctor = None
    if data.get('doctor_id'):
        doctor = Doctor.query.filter_by(
            id=data['doctor_id'], tenant_id=current_tenant_id_strict(), is_deleted=False,
        ).first()
    elif data.get('target_phone'):
        doctor = _doctor_by_phone(data['target_phone'].strip())
    if not doctor:
        return error_response('No registered doctor found for the given details.', status_code=404)

    # Guard against a duplicate pending request to the same doctor.
    dup = FamilyDoctorRequest.query.filter_by(
        tenant_id=current_tenant_id_strict(), patient_id=patient.id,
        doctor_id=doctor.id, status=HouseGroupRequestStatus.PENDING,
    ).first()
    if dup:
        return error_response('You already have a pending request to this doctor.', status_code=400)

    req = FamilyDoctorRequest(
        tenant_id=current_tenant_id_strict(),
        patient_id=patient.id, doctor_id=doctor.id,
        initiated_by='patient', requested_by_user_id=current_user.id,
        target_user_id=doctor.user_id,
        status=HouseGroupRequestStatus.PENDING,
        expires_at=utcnow() + timedelta(days=_CODE_TTL_DAYS),
    )
    db.session.add(req)
    db.session.commit()
    return success_response(data=req.to_dict(), message='Request sent to the doctor.')


@family_doctor_bp.route('/join', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT])
def patient_join_by_code():
    """Patient empanels by a doctor's invite code (immediate link)."""
    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    if _active_patient_link(patient.id):
        return error_response('You already have a family doctor. Delink first.', status_code=400)

    code = (request.get_json() or {}).get('code', '').strip()
    if not code:
        return error_response('Invite code is required.', status_code=400)

    invite = FamilyDoctorRequest.query.filter_by(
        tenant_id=current_tenant_id_strict(), invite_code=code,
        initiated_by='doctor', status=HouseGroupRequestStatus.PENDING,
    ).filter(FamilyDoctorRequest.patient_id.is_(None)).first()
    if not invite or not invite.doctor_id:
        return error_response('Invalid or expired invite code.', status_code=404)
    if invite.expires_at and invite.expires_at < utcnow():
        return error_response('This invite code has expired.', status_code=400)

    link, err = _create_link(patient.id, invite.doctor_id, 'code')
    if err:
        return error_response(err, status_code=400)
    return success_response(data=link.to_dict(), message='Family doctor linked.')


@family_doctor_bp.route('/me', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.PATIENT])
def patient_delink():
    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    link = _active_patient_link(patient.id)
    if not link:
        return error_response('You have no family doctor to delink.', status_code=404)
    link.is_active = False
    db.session.commit()
    return success_response(data={'id': str(link.id)}, message='Family doctor removed.')


# --------------------------------------------------------------------------- #
# Doctor side
# --------------------------------------------------------------------------- #
@family_doctor_bp.route('/patients', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def list_empanelled_patients():
    """The doctor's empanelled (active-link) patients."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    links = (FamilyDoctorLink.query
             .filter_by(tenant_id=current_tenant_id_strict(),
                        doctor_id=doctor.id, is_active=True)
             .order_by(FamilyDoctorLink.created_at.desc())
             .all())
    return success_response(data={'patients': [l.to_dict() for l in links]})


def _collect_completed_bookings(tid, patient_id, exclude_doctor_id):
    """A patient's COMPLETED consultations + services + group bookings, each
    with its prescription, newest first. ``exclude_doctor_id`` drops bookings
    the family doctor personally provided (a second opinion is only ever on
    ANOTHER doctor's booking) — pass None to keep everything.

    Shared by the doctor's "empanelled patient bookings" view and the
    patient's own "second opinion" table so both stay in lock-step."""
    from app.models import (
        Appointment, MarketplaceOrder, GroupOfferingBooking, AppointmentStatus,
    )

    def _v(x):
        return getattr(x, 'value', x)

    def _dt(x):
        return x.isoformat() if x is not None and hasattr(x, 'isoformat') else None

    rows = []

    # Consultations (completed) + their prescription.
    appt_q = (Appointment.query
              .filter(Appointment.tenant_id == tid,
                      Appointment.patient_id == patient_id,
                      Appointment.status == AppointmentStatus.COMPLETED,
                      Appointment.is_deleted == False))  # noqa: E712
    if exclude_doctor_id is not None:
        appt_q = appt_q.filter(Appointment.doctor_id != exclude_doctor_id)
    for a in appt_q.all():
        presc = None
        try:
            p = a.prescriptions.first() if hasattr(a.prescriptions, 'first') else None
            if p:
                # Full final prescription so the reader can see the diagnosis +
                # medicines (not just its status), for the second opinion.
                presc = p.to_dict(include_doctor=True)
        except Exception:  # noqa: BLE001
            presc = None
        rows.append({
            'booking_id': str(a.id),
            'kind': 'consultation',
            'type': _v(getattr(a, 'consultation_type', None)) or 'consultation',
            'provider_name': (a.doctor.full_name if getattr(a, 'doctor', None) else None),
            'booked_date': _dt(getattr(a, 'booking_date', None) or a.created_at),
            'completed_date': _dt(a.updated_at),
            'status': _v(a.status),
            'prescription': presc,
        })

    # Individual service orders (completed).
    order_q = (MarketplaceOrder.query
               .filter(MarketplaceOrder.tenant_id == tid,
                       MarketplaceOrder.patient_id == patient_id,
                       MarketplaceOrder.status == 'completed'))
    if exclude_doctor_id is not None:
        order_q = order_q.filter(MarketplaceOrder.doctor_id != exclude_doctor_id)
    for o in order_q.all():
        rows.append({
            'booking_id': str(o.id),
            'kind': 'group_service' if getattr(o, 'group_id', None) else 'service',
            'type': 'group_plan' if getattr(o, 'group_id', None) else 'service_plan',
            'provider_name': (o.doctor.full_name if getattr(o, 'doctor', None) else None),
            'booked_date': _dt(o.created_at),
            'completed_date': _dt(o.updated_at),
            'status': o.status,
            'prescription': None,
        })

    # Group / plan bookings (completed).
    for b in (GroupOfferingBooking.query
              .filter(GroupOfferingBooking.tenant_id == tid,
                      GroupOfferingBooking.patient_id == patient_id,
                      GroupOfferingBooking.status == 'completed')
              .all()):
        rows.append({
            'booking_id': str(b.id),
            'kind': 'group_plan',
            'type': 'group_plan',
            'provider_name': getattr(b, 'plan_name', None),
            'booked_date': _dt(b.created_at),
            'completed_date': _dt(b.updated_at),
            'status': b.status,
            'prescription': None,
        })

    rows.sort(key=lambda r: r.get('completed_date') or '', reverse=True)
    return rows


@family_doctor_bp.route('/patients/<patient_id>/bookings', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def empanelled_patient_bookings(patient_id):
    """An empanelled patient's COMPLETED consultations + services, each with
    its prescription. Details are only visible AFTER a booking is completed
    ("the date of done") — pending/upcoming bookings are never returned. The
    doctor must have an active family-doctor link with the patient."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    tid = current_tenant_id_strict()
    link = FamilyDoctorLink.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id, patient_id=patient_id, is_active=True,
    ).first()
    if not link:
        return error_response('You are not this patient\'s family doctor.', status_code=403)

    rows = _collect_completed_bookings(tid, patient_id, exclude_doctor_id=doctor.id)
    return success_response(data={
        'patient_id': str(patient_id),
        'patient_name': (link.patient.full_name if link.patient else None),
        'bookings': rows,
    })


@family_doctor_bp.route('/me/bookings', methods=['GET'])
@jwt_required()
@role_required([UserRole.PATIENT])
def my_second_opinion_bookings():
    """The current patient's OWN completed bookings + prescriptions — the same
    table the family doctor sees, so the patient can review and request a
    second opinion from their family doctor. Bookings the family doctor
    personally provided are excluded (no self second opinion). Empty when the
    patient has no family doctor."""
    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    tid = current_tenant_id_strict()
    link = _active_patient_link(patient.id)
    if not link:
        return success_response(data={
            'has_family_doctor': False, 'doctor_name': None, 'bookings': [],
        })

    rows = _collect_completed_bookings(tid, patient.id, exclude_doctor_id=link.doctor_id)
    return success_response(data={
        'has_family_doctor': True,
        'doctor_name': (link.doctor.full_name if link.doctor else None),
        'bookings': rows,
    })


@family_doctor_bp.route('/me/second-opinion', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT])
def start_my_second_opinion():
    """Patient opens (or reuses) the second-opinion chat/call channel with
    THEIR family doctor for one of their prescriptions. Returns the patient's
    Service-Chats deep-link (chat max 5 messages, calls ≤5 minutes)."""
    from app.models import Prescription
    from app.api.service_communication.service import SecondOpinionService

    patient = _current_patient()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    tid = current_tenant_id_strict()
    link = _active_patient_link(patient.id)
    if not link:
        return error_response('You do not have a family doctor yet.', status_code=400)

    data = request.get_json() or {}
    prescription_id = data.get('prescription_id')
    if not prescription_id:
        return error_response('prescription_id is required.', status_code=400)
    presc = Prescription.query.filter_by(
        id=prescription_id, tenant_id=tid, patient_id=patient.id).first()
    if not presc:
        return error_response('Prescription not found.', status_code=404)

    doctor = Doctor.query.filter_by(
        id=link.doctor_id, tenant_id=tid, is_deleted=False).first()
    if not doctor:
        return error_response('Family doctor not found.', status_code=404)

    channel = SecondOpinionService.get_or_create(tid, doctor, patient, presc)
    return success_response(data={
        'channel_id': str(channel.id),
        'redirect': f'/dashboard/patient/my-services?channel={channel.id}',
    }, message='Second-opinion channel ready.')


@family_doctor_bp.route('/second-opinion/wallet', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def second_opinion_wallet():
    """The doctor's second-opinion credit wallet: balance, redeem threshold,
    current per-booking rate, eligibility, and the second-opinion ledger."""
    from app.models import HealthCreditWallet, HealthCreditLedger
    from app.api.family_doctor.credit_service import resolve_rate, resolve_threshold
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    tid = current_tenant_id_strict()
    wallet = HealthCreditWallet.query.filter_by(tenant_id=tid, user_id=doctor.user_id).first()
    available = float(wallet.available(utcnow())) if wallet else 0.0
    threshold = resolve_threshold(tid, doctor)
    rows = (HealthCreditLedger.query
            .filter(HealthCreditLedger.tenant_id == tid,
                    HealthCreditLedger.user_id == doctor.user_id,
                    HealthCreditLedger.ref_type.in_(['second_opinion', 'second_opinion_redeem']))
            .order_by(HealthCreditLedger.created_at.desc())
            .limit(50).all())
    return success_response(data={
        'balance': available,
        'threshold': threshold,
        'rate': resolve_rate(tid, doctor),
        'eligible': available >= threshold and available > 0,
        'ledger': [{
            'amount': float(r.amount), 'kind': r.kind, 'ref_type': r.ref_type,
            'note': r.note, 'date': r.created_at.isoformat() if r.created_at else None,
        } for r in rows],
    })


@family_doctor_bp.route('/second-opinion/redeem', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def redeem_second_opinion():
    """Redeem second-opinion credits to cash (1 credit = ₹1). Allowed once the
    balance meets the plan's threshold. Spends the credits and mints a
    DoctorPayout (source_type='second_opinion') that flows through the normal
    claim/disburse pipeline — visible in the doctor's My Bills and the admin's
    Payout Management."""
    from app.models import HealthCreditWallet, HealthCreditLedger, DoctorPayout
    from app.api.family_doctor.credit_service import resolve_threshold
    from app.api.admin.payout import _generate_bill_number
    from app.api.common.payment.billing_service import apply_hold

    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    tid = current_tenant_id_strict()
    wallet = HealthCreditWallet.query.filter_by(tenant_id=tid, user_id=doctor.user_id).first()
    available = float(wallet.available(utcnow())) if wallet else 0.0
    threshold = resolve_threshold(tid, doctor)

    if available <= 0:
        return error_response('You have no second-opinion credits to redeem.', status_code=400)
    if available < threshold:
        return error_response(
            f'You need at least {threshold:g} credits to redeem (you have {available:g}).',
            status_code=400)

    data = request.get_json() or {}
    try:
        amount = float(data.get('amount') or available)
    except (TypeError, ValueError):
        return error_response('amount must be a number.', status_code=400)
    if amount <= 0 or amount > available:
        return error_response('amount must be between 1 and your balance.', status_code=400)

    # Spend the credits.
    wallet.balance = float(wallet.balance) - amount
    ledger = HealthCreditLedger(
        tenant_id=tid, wallet_id=wallet.id, user_id=doctor.user_id,
        amount=-amount, kind='spend', ref_type='second_opinion_redeem',
        note='Redeemed to cash',
    )
    db.session.add(ledger)
    db.session.flush()

    # Mint the payout (1 credit = ₹1) → normal claim/disburse pipeline.
    payout = DoctorPayout(
        tenant_id=tid, doctor_id=doctor.id, bill_number=_generate_bill_number(),
        source_type='second_opinion', source_ref_id=ledger.id,
        source_label='Second opinion credit redemption',
        payout_amount=amount, payout_mode='autopay',
    )
    apply_hold(payout, doctor)
    db.session.add(payout)
    db.session.commit()
    return success_response(data={
        'redeemed': amount, 'new_balance': float(wallet.balance),
        'payout_id': str(payout.id), 'bill_number': payout.bill_number,
        'payout_status': payout.status.value if payout.status else None,
    }, message='Redemption submitted — it will appear in your bills and be paid out.')


@family_doctor_bp.route('/second-opinion', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def start_second_opinion():
    """Open (or reuse) the second-opinion chat/call channel for a prescription
    of an empanelled patient. Returns the Service-Chats deep-link where the
    family doctor can chat (max 5 messages) or start a ≤5-minute call."""
    from app.models import Prescription
    from app.api.service_communication.service import SecondOpinionService

    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    prescription_id = data.get('prescription_id')
    if not prescription_id:
        return error_response('prescription_id is required.', status_code=400)

    tid = current_tenant_id_strict()
    presc = Prescription.query.filter_by(id=prescription_id, tenant_id=tid).first()
    if not presc:
        return error_response('Prescription not found.', status_code=404)
    patient = Patient.query.filter_by(id=presc.patient_id, is_deleted=False).first()
    if not patient:
        return error_response('Patient not found.', status_code=404)

    link = FamilyDoctorLink.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id, patient_id=patient.id, is_active=True,
    ).first()
    if not link:
        return error_response('You are not this patient\'s family doctor.', status_code=403)

    channel = SecondOpinionService.get_or_create(tid, doctor, patient, presc)
    return success_response(data={
        'channel_id': str(channel.id),
        'redirect': f'/dashboard/doctor/service-chats?channel={channel.id}',
    }, message='Second-opinion channel ready.')


@family_doctor_bp.route('/generate-code', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def generate_empanel_code():
    """Generate (or regenerate) the doctor's open empanelment invite code.
    Patients redeem it via POST /join. Reusable by many patients until
    regenerated."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    tid = current_tenant_id_strict()
    # Retire any prior open invites for this doctor.
    (FamilyDoctorRequest.query
     .filter_by(tenant_id=tid, doctor_id=doctor.id, initiated_by='doctor',
                status=HouseGroupRequestStatus.PENDING)
     .filter(FamilyDoctorRequest.patient_id.is_(None))
     .update({'status': HouseGroupRequestStatus.CANCELLED}))
    code = secrets.token_urlsafe(8)
    invite = FamilyDoctorRequest(
        tenant_id=tid, doctor_id=doctor.id, initiated_by='doctor',
        requested_by_user_id=current_user.id, invite_code=code,
        status=HouseGroupRequestStatus.PENDING,
        expires_at=utcnow() + timedelta(days=_CODE_TTL_DAYS),
    )
    db.session.add(invite)
    db.session.commit()
    return success_response(data={'code': code, 'expires_at': invite.expires_at.isoformat()})


@family_doctor_bp.route('/patients/request', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def doctor_send_request():
    """Doctor requests a patient — by ``patient_id`` or ``target_phone`` +
    ``target_name``."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    patient = None
    if data.get('patient_id'):
        patient = Patient.query.filter_by(
            id=data['patient_id'], tenant_id=current_tenant_id_strict(), is_deleted=False,
        ).first()
    elif data.get('target_phone'):
        patient = _patient_by_phone(data['target_phone'].strip())
    if not patient:
        return error_response('No registered patient found for the given details.', status_code=404)

    if _active_patient_link(patient.id):
        return error_response('This patient already has a family doctor.', status_code=400)
    dup = FamilyDoctorRequest.query.filter_by(
        tenant_id=current_tenant_id_strict(), patient_id=patient.id,
        doctor_id=doctor.id, status=HouseGroupRequestStatus.PENDING,
    ).first()
    if dup:
        return error_response('You already have a pending request to this patient.', status_code=400)

    req = FamilyDoctorRequest(
        tenant_id=current_tenant_id_strict(),
        patient_id=patient.id, doctor_id=doctor.id,
        initiated_by='doctor', requested_by_user_id=current_user.id,
        target_user_id=patient.user_id,
        target_phone=data.get('target_phone'), target_name=data.get('target_name'),
        status=HouseGroupRequestStatus.PENDING,
        expires_at=utcnow() + timedelta(days=_CODE_TTL_DAYS),
    )
    db.session.add(req)
    db.session.commit()
    return success_response(data=req.to_dict(), message='Request sent to the patient.')


@family_doctor_bp.route('/patients/<patient_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def doctor_delink(patient_id):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    link = FamilyDoctorLink.query.filter_by(
        tenant_id=current_tenant_id_strict(), doctor_id=doctor.id,
        patient_id=patient_id, is_active=True,
    ).first()
    if not link:
        return error_response('No active link with this patient.', status_code=404)
    link.is_active = False
    db.session.commit()
    return success_response(data={'id': str(link.id)}, message='Patient delinked.')


# --------------------------------------------------------------------------- #
# Shared: requests inbox + accept / reject / cancel
# --------------------------------------------------------------------------- #
@family_doctor_bp.route('/requests', methods=['GET'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.DOCTOR])
def list_requests():
    """Pending requests I sent + those addressed to me (excludes open
    invite-code rows, which have no target)."""
    tid = current_tenant_id_strict()
    sent = (FamilyDoctorRequest.query
            .filter_by(tenant_id=tid, requested_by_user_id=current_user.id,
                       status=HouseGroupRequestStatus.PENDING)
            .filter(FamilyDoctorRequest.target_user_id.isnot(None))
            .order_by(FamilyDoctorRequest.created_at.desc()).all())
    received = (FamilyDoctorRequest.query
                .filter_by(tenant_id=tid, target_user_id=current_user.id,
                           status=HouseGroupRequestStatus.PENDING)
                .order_by(FamilyDoctorRequest.created_at.desc()).all())
    return success_response(data={
        'sent': [r.to_dict() for r in sent],
        'received': [r.to_dict() for r in received],
    })


def _load_request(request_id):
    return FamilyDoctorRequest.query.filter_by(
        id=request_id, tenant_id=current_tenant_id_strict(),
    ).first()


@family_doctor_bp.route('/requests/<request_id>/accept', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.DOCTOR])
def accept_request(request_id):
    req = _load_request(request_id)
    if not req or req.status != HouseGroupRequestStatus.PENDING:
        return error_response('Request not found or already handled.', status_code=404)
    if str(req.target_user_id) != str(current_user.id):
        return error_response('This request is not addressed to you.', status_code=403)
    if not req.patient_id or not req.doctor_id:
        return error_response('Request is missing a party.', status_code=400)

    link, err = _create_link(req.patient_id, req.doctor_id,
                             'patient' if req.initiated_by == 'doctor' else 'doctor')
    if err:
        return error_response(err, status_code=400)
    req.status = HouseGroupRequestStatus.ACCEPTED
    db.session.commit()
    return success_response(data=link.to_dict(), message='Family doctor linked.')


@family_doctor_bp.route('/requests/<request_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.DOCTOR])
def reject_request(request_id):
    req = _load_request(request_id)
    if not req or req.status != HouseGroupRequestStatus.PENDING:
        return error_response('Request not found or already handled.', status_code=404)
    if str(req.target_user_id) != str(current_user.id):
        return error_response('This request is not addressed to you.', status_code=403)
    req.status = HouseGroupRequestStatus.REJECTED
    db.session.commit()
    return success_response(data={'id': str(req.id)}, message='Request rejected.')


@family_doctor_bp.route('/requests/<request_id>/cancel', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.DOCTOR])
def cancel_request(request_id):
    req = _load_request(request_id)
    if not req or req.status != HouseGroupRequestStatus.PENDING:
        return error_response('Request not found or already handled.', status_code=404)
    if str(req.requested_by_user_id) != str(current_user.id):
        return error_response('You can only cancel requests you sent.', status_code=403)
    req.status = HouseGroupRequestStatus.CANCELLED
    db.session.commit()
    return success_response(data={'id': str(req.id)}, message='Request cancelled.')
