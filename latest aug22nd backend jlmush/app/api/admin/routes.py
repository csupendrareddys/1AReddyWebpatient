"""
Admin Routes
API endpoints for admin operations
"""
import logging
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from app.api.admin import admin_bp
from app.common.decorators import role_required, permission_required, feature_required, rbac_required
from app.models import PermissionModule, PermissionAction
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, User, Patient, Doctor, AdminPermission
from app.extensions import db
from app.services.s3_service import S3Service

logger = logging.getLogger(__name__)


# --- Permission-Based View Endpoints ---

@admin_bp.route('/patients', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_PATIENTS)
def list_patients():
    """
    List all patients with pagination.
    Requires: view_patients permission (or super_admin)
    """
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = request.args.get('search', '', type=str)
    logger.debug(f"[ADMIN:LIST_PATIENTS] page={page}, per_page={per_page}, search={search}")
    
    # Query patients with user relationship. Tenant filter is defense-in-depth
    # on top of Postgres RLS — either layer alone stops cross-tenant reads.
    #
    # ``.join(User)`` was unambiguous until Patient grew a SECOND FK to
    # User (``invited_by_user_id``, added in the Round-10 followup so the
    # doctor's "My Patients" page can filter by inviter). SQLAlchemy now
    # raises ``AmbiguousForeignKeysError`` because it can't pick between
    # ``user_id`` and ``invited_by_user_id``. Pin the join to the identity
    # FK explicitly — we want the patient's OWN user row, not the inviter's.
    tenant_id = current_tenant_id_strict()
    query = db.session.query(Patient).join(User, Patient.user_id == User.id).filter(
        Patient.tenant_id == tenant_id,
        User.is_deleted == False,
        User.role == UserRole.PATIENT,
    )
    
    # Search by name or phone
    if search:
        from app.common.encryption import hash_for_search
        search_hash = hash_for_search(search)
        query = query.filter(
            db.or_(
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%'),
                User._phone_hash == search_hash
            )
        )
    
    # Paginate
    pagination = query.order_by(Patient.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    patients = []
    for patient in pagination.items:
        patients.append({
            'id': str(patient.id),
            'user_id': str(patient.user_id),
            'first_name': patient.user.first_name if patient.user else None,
            'last_name': patient.user.last_name if patient.user else None,
            'email': patient.user.email if patient.user else None,
            'phone_number': patient.user.phone_number if patient.user else None,
            'status': patient.user.status.value if patient.user else None,
            'created_at': patient.created_at.isoformat() if patient.created_at else None,
        })
    
    return success_response(data={
        'patients': patients,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages
        }
    })


@admin_bp.route('/corporate-customers', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_PATIENTS)
def list_corporate_customers():
    """List corporate customers — patients that carry a non-individual
    EntityProfile (proprietorship / partnership / private_limited / …).
    Same basic-info shape as ``list_patients`` plus the entity fields, for
    the admin Customer View's Corporate sub-section."""
    from app.models import EntityProfile, EntityType
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = request.args.get('search', '', type=str)
    tenant_id = current_tenant_id_strict()

    query = (
        db.session.query(Patient, EntityProfile)
        .join(User, Patient.user_id == User.id)
        .join(EntityProfile, EntityProfile.patient_id == Patient.id)
        .filter(
            Patient.tenant_id == tenant_id,
            User.is_deleted == False,  # noqa: E712
            User.role == UserRole.PATIENT,
            EntityProfile.entity_type != EntityType.INDIVIDUAL,
            EntityProfile.is_deleted == False,  # noqa: E712
        )
    )

    if search:
        from app.common.encryption import hash_for_search
        search_hash = hash_for_search(search)
        query = query.filter(
            db.or_(
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%'),
                User._phone_hash == search_hash,
                EntityProfile.entity_name.ilike(f'%{search}%'),
            )
        )

    pagination = query.order_by(Patient.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False,
    )

    customers = []
    for patient, entity in pagination.items:
        u = patient.user
        customers.append({
            'id': str(patient.id),
            'user_id': str(patient.user_id),
            'first_name': u.first_name if u else None,
            'last_name': u.last_name if u else None,
            'email': u.email if u else None,
            'phone_number': u.phone_number if u else None,
            'status': u.status.value if u and u.status else None,
            'created_at': patient.created_at.isoformat() if patient.created_at else None,
            # Entity (corporate) fields.
            'entity_type': (
                entity.entity_type.value if entity.entity_type else None
            ),
            'entity_name': entity.entity_name,
            'legal_name': entity.legal_name,
            'trade_name': entity.trade_name,
        })

    return success_response(data={
        'customers': customers,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
        },
    })


@admin_bp.route('/patients/<patient_id>/status', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.EDIT_PATIENT_STATUS)
def update_patient_status(patient_id):
    """
    Update patient status (activate/block).
    Requires: edit_patient_status permission (or super_admin)
    
    Request Body:
        {"status": "active" | "blocked" | "inactive"}
    """
    from app.models import UserStatus
    
    data = request.get_json()
    logger.debug(f"[ADMIN:UPDATE_PATIENT_STATUS] patient_id={patient_id}, new_status={data.get('status') if data else None}")
    if not data or 'status' not in data:
        return error_response('Status is required', status_code=400)
    
    new_status = data['status']
    
    # Validate status value
    valid_statuses = ['active', 'blocked', 'inactive']
    if new_status not in valid_statuses:
        return error_response(f'Invalid status. Must be one of: {", ".join(valid_statuses)}', status_code=400)
    
    # Find patient (tenant-scoped)
    patient = Patient.query.filter_by(
        id=patient_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not patient:
        return error_response('Patient not found', status_code=404)

    # Get the associated user
    user = patient.user
    if not user:
        return error_response('User not found for patient', status_code=404)
    
    # Update status
    try:
        user.status = UserStatus(new_status)
        db.session.commit()

        return success_response(
            data={
                'patient_id': str(patient.id),
                'user_id': str(user.id),
                'new_status': user.status.value
            },
            message=f'Patient status updated to {new_status}'
        )
    except Exception as e:
        logger.error(f"Failed to update patient status: {e}")
        db.session.rollback()
        return error_response('An internal error occurred', status_code=500)

@admin_bp.route('/appointments', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_APPOINTMENTS)
def list_appointments():
    """
    List all appointments with pagination.
    Requires: view_appointments permission (or super_admin)
    """
    from app.models import Appointment
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = request.args.get('status', None, type=str)
    logger.debug(f"[ADMIN:LIST_APPOINTMENTS] page={page}, per_page={per_page}, status={status}")
    
    # Query appointments (tenant-scoped; defense-in-depth with RLS).
    query = Appointment.query.filter(
        Appointment.tenant_id == current_tenant_id_strict(),
        Appointment.is_deleted == False,
    )
    
    # Filter by status if provided
    if status:
        from app.models import AppointmentStatus
        try:
            status_enum = AppointmentStatus(status)
            query = query.filter(Appointment.status == status_enum)
        except ValueError:
            pass
    
    # Paginate
    pagination = query.order_by(Appointment.appointment_date.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    appointments = []
    for appt in pagination.items:
        appointments.append({
            'id': str(appt.id),
            'patient_id': str(appt.patient_id) if appt.patient_id else None,
            'doctor_id': str(appt.doctor_id) if appt.doctor_id else None,
            'status': appt.status.value if appt.status else None,
            'appointment_date': appt.appointment_date.isoformat() if appt.appointment_date else None,
            'start_time': appt.start_time.isoformat() if appt.start_time else None,
            'created_at': appt.created_at.isoformat() if appt.created_at else None,
        })
    
    return success_response(data={
        'appointments': appointments,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages
        }
    })


@admin_bp.route('/doctors', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def list_doctors():
    """
    List all doctors with pagination.
    Requires: view_doctors permission (or super_admin)
    """
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = request.args.get('search', '', type=str)
    approval_status = request.args.get('approval_status', None, type=str)
    logger.debug(f"[ADMIN:LIST_DOCTORS] page={page}, search={search}, approval={approval_status}")
    
    # Query doctors with user relationship (tenant-scoped).
    query = db.session.query(Doctor).join(User, Doctor.user_id == User.id).filter(
        Doctor.tenant_id == current_tenant_id_strict(),
        User.is_deleted == False,
        User.role == UserRole.DOCTOR,
    )
    
    # Filter by verification status
    if approval_status:
        from app.models import UserVerificationStatus
        try:
            status_enum = UserVerificationStatus(approval_status)
            query = query.filter(Doctor.verification_status == status_enum)
        except ValueError:
            pass
    
    # Search by name
    if search:
        query = query.filter(
            db.or_(
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%')
            )
        )

    # Filter to doctors linked to a given hospital/clinic via the "My Link"
    # care-network (context='link', status='active'). Powers the admin
    # "View Vendor" drill — clicking a facility shows all its linked
    # doctors at once. relationship_type is stored title-case.
    hospital_id = request.args.get('hospital_id', None, type=str)
    clinic_id = request.args.get('clinic_id', None, type=str)
    if hospital_id or clinic_id:
        from app.models import CareNetworkConnection
        conn_type = 'hospital' if hospital_id else 'clinic'
        target_col = (
            CareNetworkConnection.target_hospital_id if hospital_id
            else CareNetworkConnection.target_clinic_id
        )
        # IN (subquery) rather than a JOIN — avoids duplicate rows without
        # DISTINCT (which Postgres can't apply over Doctor's JSON columns).
        linked_ids = db.session.query(CareNetworkConnection.doctor_id).filter(
            CareNetworkConnection.tenant_id == current_tenant_id_strict(),
            CareNetworkConnection.status == 'active',
            CareNetworkConnection.connection_type == conn_type,
            CareNetworkConnection.context == 'link',
            target_col == (hospital_id or clinic_id),
        )
        query = query.filter(Doctor.id.in_(linked_ids))

    # Paginate
    pagination = query.order_by(Doctor.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    # Batch-load per-doctor context for the page (avoids N+1 queries): the
    # billing profile (type + salary / retainer), and the live membership
    # subscription (plan name + holding flag). Absent profile → 'plan' default.
    from app.models import (
        DoctorBillingProfile, MembershipSubscription, MembershipPlan,
    )
    from app.models._enums import MembershipVertical, MembershipSubscriptionStatus
    from app.models._base import utcnow as _utcnow
    tid = current_tenant_id_strict()
    doc_ids = [d.id for d in pagination.items]
    billing_by_doc = {}
    sub_by_doc = {}
    if doc_ids:
        for bp in DoctorBillingProfile.query.filter(
                DoctorBillingProfile.tenant_id == tid,
                DoctorBillingProfile.doctor_id.in_(doc_ids)).all():
            billing_by_doc[str(bp.doctor_id)] = bp
        # Latest non-cancelled membership subscription per doctor.
        subs = (MembershipSubscription.query
                .filter(MembershipSubscription.tenant_id == tid,
                        MembershipSubscription.provider_type == MembershipVertical.DOCTOR,
                        MembershipSubscription.provider_id.in_([str(i) for i in doc_ids]),
                        MembershipSubscription.is_deleted.is_(False),
                        MembershipSubscription.status != MembershipSubscriptionStatus.CANCELLED)
                .order_by(MembershipSubscription.created_at.desc()).all())
        for s in subs:
            sub_by_doc.setdefault(str(s.provider_id), s)

    # Health-credit wallet balance (by user) + pending field-approval counts
    # (by doctor) — batched to keep the list a single round of queries.
    from app.models import HealthCreditWallet, HealthCreditLedger, FieldApprovalRequest
    from app.models._enums import FieldApprovalStatus
    user_ids = [d.user_id for d in pagination.items if d.user_id]
    wallet_by_user = {}
    used_by_user = {}
    if user_ids:
        for w in HealthCreditWallet.query.filter(
                HealthCreditWallet.tenant_id == tid,
                HealthCreditWallet.user_id.in_(user_ids)).all():
            wallet_by_user[str(w.user_id)] = w
        # Total credits spent (ledger 'spend' rows are negative — negate to sum).
        used_rows = (db.session.query(
                        HealthCreditLedger.user_id,
                        db.func.coalesce(db.func.sum(-HealthCreditLedger.amount), 0))
                     .filter(HealthCreditLedger.tenant_id == tid,
                             HealthCreditLedger.user_id.in_(user_ids),
                             HealthCreditLedger.kind == 'spend')
                     .group_by(HealthCreditLedger.user_id).all())
        used_by_user = {str(uid): float(s or 0) for uid, s in used_rows}
    pending_by_doc = {}
    if doc_ids:
        rows = (db.session.query(FieldApprovalRequest.entity_id,
                                 db.func.count(FieldApprovalRequest.id))
                .filter(FieldApprovalRequest.tenant_id == tid,
                        FieldApprovalRequest.entity_type == 'doctor',
                        FieldApprovalRequest.entity_id.in_([str(i) for i in doc_ids]),
                        FieldApprovalRequest.status.in_([
                            FieldApprovalStatus.PENDING, FieldApprovalStatus.QUERY]))
                .group_by(FieldApprovalRequest.entity_id).all())
        pending_by_doc = {str(eid): int(cnt) for eid, cnt in rows}

        # Include pending bank-account verifications so the roster's "N pending"
        # chip matches the approvals drill-down (which now surfaces them too).
        from app.models import ProfileBankAccount
        from app.models._enums import DocumentVerificationStatus
        brows = (db.session.query(ProfileBankAccount.doctor_id,
                                  db.func.count(ProfileBankAccount.id))
                 .filter(ProfileBankAccount.tenant_id == tid,
                         ProfileBankAccount.doctor_id.in_([str(i) for i in doc_ids]),
                         ProfileBankAccount.verification_status
                         == DocumentVerificationStatus.PENDING)
                 .group_by(ProfileBankAccount.doctor_id).all())
        for did, cnt in brows:
            pending_by_doc[str(did)] = pending_by_doc.get(str(did), 0) + int(cnt)

    now = _utcnow()

    def _plan_name(plan_id):
        if not plan_id:
            return None
        p = MembershipPlan.query.get(plan_id)
        return p.name if p else None

    def _num(v):
        return float(v) if v is not None else None

    def _state(addr):
        return (addr or {}).get('state') if isinstance(addr, dict) else None

    doctors = []
    for doctor in pagination.items:
        bp = billing_by_doc.get(str(doctor.id))
        btype = (bp.billing_type.value if bp and bp.billing_type else 'plan')
        sub = sub_by_doc.get(str(doctor.id))
        # Holding = a live sub that's lapsed/suspended, or past its paid period.
        on_holding = False
        if sub is not None:
            st = sub.status
            if st in (MembershipSubscriptionStatus.PAST_DUE,
                      MembershipSubscriptionStatus.SUSPENDED):
                on_holding = True
            elif (st == MembershipSubscriptionStatus.ACTIVE
                  and sub.current_period_end and sub.current_period_end < now):
                on_holding = True

        doctors.append({
            'id': str(doctor.id),
            'user_id': str(doctor.user_id),
            'first_name': doctor.user.first_name if doctor.user else None,
            'last_name': doctor.user.last_name if doctor.user else None,
            'email': doctor.user.email if doctor.user else None,
            'phone_number': doctor.user.phone_number if doctor.user else None,
            # Current (approved) profile photo — the admin sees the doctor's
            # face in the roster; the Approvals drill-down shows any pending
            # photo change alongside this one.
            'profile_image': getattr(doctor.user, 'profile_image', None) if doctor.user else None,
            'registration_number': doctor.registration_number,
            'verification_status': doctor.verification_status.value if doctor.verification_status else None,
            'status': doctor.user.status.value if doctor.user else None,
            'publish_status': doctor.publish_status.value if doctor.publish_status else 'inactive',
            'publish_status_by_type': doctor.publish_status_by_type or {},
            'is_popular': bool(doctor.is_popular),
            'created_at': doctor.created_at.isoformat() if doctor.created_at else None,

            # ── Health credits + approvals ─────────────────────────────────
            'health_credits': (
                float(wallet_by_user[str(doctor.user_id)].available(now))
                if str(doctor.user_id) in wallet_by_user else 0.0
            ),
            'credits_used': used_by_user.get(str(doctor.user_id), 0.0),
            'pending_approvals': pending_by_doc.get(str(doctor.id), 0),

            # ── Engagement (Employee / Consultant / Plan) ──────────────────
            'billing_type': btype,
            'plan_name': _plan_name(sub.membership_plan_id) if (btype == 'plan' and sub) else None,
            'salary': _num(bp.salary_override) if bp else None,
            'retainer': _num(bp.retainer_override) if bp else None,
            'on_holding': on_holding,

            # ── Basic details ──────────────────────────────────────────────
            'category': doctor.category,
            'religion': doctor.religion,
            'citizenship': doctor.citizenship,
            'languages_known': doctor.languages_known or [],
            'alternative_phone': doctor.alternative_phone,
            'alternative_email': doctor.alternative_email,
            'aadhar_number': doctor.aadhar_number,
            'pan_number': doctor.pan_number,
            'name_as_per_aadhaar': doctor.name_as_per_aadhaar,
            'name_as_per_pan': doctor.name_as_per_pan,
            'state': _state(doctor.communication_address) or _state(doctor.permanent_address),
            'communication_address': doctor.communication_address or {},
            'permanent_address': doctor.permanent_address or {},

            # ── Practice details ───────────────────────────────────────────
            # Registration block + a separate Certificate-of-Practice (COP) block.
            'registration_council': doctor.registration_council,
            'registration_year': doctor.registration_year,
            'has_registration_certificate': bool(doctor.registration_certificate),
            'registration': {
                'number': doctor.registration_number,
                'name': doctor.registration_name,
                'date': doctor.registration_date.isoformat() if doctor.registration_date else None,
                'expiry': doctor.registration_expiry.isoformat() if doctor.registration_expiry else None,
                'board': doctor.registration_board or doctor.registration_council,
                'state': doctor.registration_state,
                'has_attachment': bool(doctor.registration_certificate),
            },
            'cop': {
                'number': doctor.cop_number,
                'name': doctor.cop_name,
                'date': doctor.cop_date.isoformat() if doctor.cop_date else None,
                'expiry': doctor.cop_expiry.isoformat() if doctor.cop_expiry else None,
                'board': doctor.cop_board,
                'state': doctor.cop_state,
                'has_attachment': bool(doctor.cop_attachment),
            },
        })
    
    return success_response(data={
        'doctors': doctors,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages
        }
    })


@admin_bp.route('/doctors/<doctor_id>/payouts', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def list_doctor_payouts(doctor_id):
    """Per-appointment payout ledger for a doctor — powers the View-Doctors
    Payments drill-down (payable, charges, TDS, paid, and the eligible / claimed
    / paid dates)."""
    from app.models import DoctorPayout
    tid = current_tenant_id_strict()
    rows = (DoctorPayout.query
            .filter(DoctorPayout.tenant_id == tid,
                    DoctorPayout.doctor_id == doctor_id)
            .order_by(DoctorPayout.created_at.desc())
            .limit(100).all())

    def _f(v):
        return float(v) if v is not None else None

    def _iso(dt):
        return dt.isoformat() if dt else None

    payouts = [{
        'id': str(p.id),
        'appointment_id': str(p.appointment_id) if p.appointment_id else None,
        'bill_number': p.bill_number,
        'consultation_type': p.consultation_type,
        'appointment_date': _iso(p.created_at),
        'eligible_date': _iso(p.hold_until),
        'claimed_date': _iso(p.claim_requested_at),
        'paid_date': _iso(p.completed_at),
        'amount_payable': _f(p.appointment_amount) if p.appointment_amount is not None else _f(p.payment_amount),
        'charges': _f(p.total_charges),
        # Per-charge breakdown incl. each charge's tax (snapshotted at creation).
        'charges_snapshot': p.charges_snapshot or [],
        'tds': _f(p.tds_amount),
        'amount_paid': _f(p.payout_amount),
        'status': p.status.value if hasattr(p.status, 'value') else p.status,
    } for p in rows]
    return success_response(data={'payouts': payouts})


@admin_bp.route('/doctors/<doctor_id>/credit-ledger', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_doctor_credit_ledger(doctor_id):
    """A doctor's health-credit usage ledger — grants, spends and refunds — for
    the View-Doctors credit-usage drill-down."""
    from app.models import Doctor, HealthCreditWallet, HealthCreditLedger
    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(id=doctor_id, tenant_id=tid).first()
    if not doctor or not doctor.user_id:
        return not_found_response('Doctor')

    wallet = HealthCreditWallet.query.filter_by(
        tenant_id=tid, user_id=doctor.user_id).first()
    rows = (HealthCreditLedger.query
            .filter_by(tenant_id=tid, user_id=doctor.user_id)
            .order_by(HealthCreditLedger.created_at.desc())
            .limit(100).all())
    total_spent = sum(-float(r.amount) for r in rows if r.kind == 'spend')
    return success_response(data={
        'available': float(wallet.available()) if wallet else 0.0,
        'total_spent': total_spent,
        'ledger': [r.to_dict() for r in rows],
    })


@admin_bp.route('/doctors/<doctor_id>/approval-history', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_doctor_approval_history(doctor_id):
    """The FULL field-approval history for a doctor — every request across all
    statuses and all time (not just the recent/pending ones the profile
    status endpoint returns), newest first. Backs the View-Doctors approvals
    drill-down when the admin wants the complete record."""
    from app.models import Doctor, FieldApprovalRequest, ProfileBankAccount
    from app.models._enums import FieldApprovalStatus, DocumentVerificationStatus
    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(id=doctor_id, tenant_id=tid).first()
    if not doctor:
        return not_found_response('Doctor')

    rows = (FieldApprovalRequest.query
            .filter(FieldApprovalRequest.tenant_id == tid,
                    FieldApprovalRequest.entity_type == 'doctor',
                    FieldApprovalRequest.entity_id == str(doctor_id))
            .order_by(FieldApprovalRequest.created_at.desc())
            .all())
    requests = [r.to_dict() for r in rows]
    pending = sum(1 for r in rows if r.status in (
        FieldApprovalStatus.PENDING, FieldApprovalStatus.QUERY))

    # Bank-account verification lives in its OWN gateway-aware flow
    # (ProfileBankAccount + the Bank Accounts dialog / penny-drop), not the
    # field-approval table — so a pending bank change never surfaced in this
    # drill-down. Append each account still awaiting admin verification as a
    # synthetic 'bank' row so "view vendor approvals" is complete; the row
    # carries kind='bank_account' + bank_account_id so the UI routes its action
    # to the Bank Accounts dialog (the real reviewer surface), never the
    # field-approval approve endpoint.
    bank_accounts = (ProfileBankAccount.query
                     .filter_by(tenant_id=tid, doctor_id=str(doctor_id))
                     .order_by(ProfileBankAccount.order_index)
                     .all())
    for acc in bank_accounts:
        if acc.verification_status != DocumentVerificationStatus.PENDING:
            continue
        last4 = (acc.account_number or '')[-4:]
        summary = ' · '.join(p for p in [
            acc.bank_name or 'Bank',
            (f'A/c ••••{last4}' if last4 else None),
            (f'IFSC {acc.ifsc_code}' if acc.ifsc_code else None),
        ] if p)
        ts = acc.updated_at or acc.created_at
        requests.append({
            'id': f'bank:{acc.id}',
            'section': 'bank',
            'field_name': 'Bank account' + (f' #{acc.order_index + 1}' if acc.order_index else ''),
            'old_value': None,
            'new_value': summary,
            'is_file_field': False,
            'status': 'pending',
            'created_at': ts.isoformat() if ts else None,
            'reviewer_name': None,
            'reviewed_at': None,
            'kind': 'bank_account',
            'bank_account_id': str(acc.id),
        })
        pending += 1

    return success_response(data={
        'requests': requests,
        'pending_count': pending,
        'total': len(requests),
    })


# --- Approval matrix (auto-approval settings) ---
# Configure, per section/action, whether a doctor's change/action is auto-approved
# or needs manual admin approval. Global default (ApprovalPolicy) + per-doctor
# override; read live by FieldApprovalService / appointment flow. Separate from
# the approve/reject queue.

_STATUS_TO_COUNT = {'pending': 'pending', 'approved': 'accepted',
                    'rejected': 'rejected', 'query': 'query'}


def _blank_counts():
    return {'pending': 0, 'accepted': 0, 'rejected': 0, 'query': 0}


def _approval_counts_by_section(tid, entity_id=None):
    """{section: {pending, accepted, rejected, query}} across ALL the approval
    mechanisms the matrix covers, tenant-wide or for one doctor (entity_id):

      * profile sections (personal_details/signatures/about_me/education/bank)
        → FieldApprovalRequest
      * slot_visibility → Doctor.slot_visibility_approval_status
      * consultation_pricing / working_hours → ApprovalRequest rows
      * prescription → Prescription.status; document / group_plan → DoctorDocument
    """
    from app.models import FieldApprovalRequest
    out = {}

    # ── profile field-approval sections ──
    q = (db.session.query(FieldApprovalRequest.section,
                          FieldApprovalRequest.status,
                          db.func.count(FieldApprovalRequest.id))
         .filter(FieldApprovalRequest.tenant_id == tid,
                 FieldApprovalRequest.entity_type == 'doctor'))
    if entity_id:
        q = q.filter(FieldApprovalRequest.entity_id == entity_id)
    for section, status, cnt in q.group_by(FieldApprovalRequest.section, FieldApprovalRequest.status).all():
        sval = status.value if hasattr(status, 'value') else status
        key = _STATUS_TO_COUNT.get(sval)
        if key:
            out.setdefault(section, _blank_counts())[key] += int(cnt)

    try:
        _recurring_and_clinical_counts(tid, entity_id, out)
    except Exception:  # pragma: no cover — counts are best-effort, never fatal
        logger.exception('[APPROVAL_COUNTS] extra-section counts failed')
    return out


def _recurring_and_clinical_counts(tid, entity_id, out):
    """Fold slot_visibility / pricing / working_hours / prescription / document /
    group_plan pending (+ resolved where cheap) counts into ``out``."""
    from app.models import (
        Doctor, AvailabilityApprovalStatus, ApprovalRequest, ApprovalRequestStatus,
        ApprovalEntityType, Prescription, PrescriptionStatus, DoctorDocument, DocumentStatus,
    )

    # slot_visibility — column-state on Doctor
    sv = db.session.query(Doctor.slot_visibility_approval_status,
                          db.func.count(Doctor.id)).filter(Doctor.tenant_id == tid)
    if entity_id:
        sv = sv.filter(Doctor.id == entity_id)
    sv_map = {AvailabilityApprovalStatus.PENDING: 'pending',
              AvailabilityApprovalStatus.APPROVED: 'accepted',
              AvailabilityApprovalStatus.REJECTED: 'rejected'}
    for st, cnt in sv.group_by(Doctor.slot_visibility_approval_status).all():
        key = sv_map.get(st)
        if key:
            out.setdefault('slot_visibility', _blank_counts())[key] += int(cnt)

    # consultation_pricing — ApprovalRequest DOCTOR_FEE
    pr = (db.session.query(db.func.count(ApprovalRequest.id))
          .filter(ApprovalRequest.tenant_id == tid,
                  ApprovalRequest.entity_type == ApprovalEntityType.DOCTOR_FEE,
                  ApprovalRequest.status == ApprovalRequestStatus.PENDING))
    if entity_id:
        pr = pr.filter(ApprovalRequest.entity_id == entity_id)
    out.setdefault('consultation_pricing', _blank_counts())['pending'] += int(pr.scalar() or 0)

    # working_hours — ApprovalRequest DOCTOR_AVAILABILITY filtered by _meta.category
    wh = (db.session.query(ApprovalRequest.changes)
          .filter(ApprovalRequest.tenant_id == tid,
                  ApprovalRequest.entity_type == ApprovalEntityType.DOCTOR_AVAILABILITY,
                  ApprovalRequest.status == ApprovalRequestStatus.PENDING))
    if entity_id:
        wh = wh.filter(ApprovalRequest.entity_id == entity_id)
    wh_pending = 0
    for (changes,) in wh.all():
        meta = (changes or {}).get('_meta') or {}
        if meta.get('category') == 'working_hours':
            wh_pending += 1
    out.setdefault('working_hours', _blank_counts())['pending'] += wh_pending

    # prescription — Prescription.status
    pq = db.session.query(Prescription.status, db.func.count(Prescription.id)).filter(
        Prescription.tenant_id == tid, Prescription.is_deleted.is_(False))
    if entity_id:
        pq = pq.filter(Prescription.doctor_id == entity_id)
    ps_map = {PrescriptionStatus.PENDING_APPROVAL: 'pending',
              PrescriptionStatus.APPROVED: 'accepted', PrescriptionStatus.ACTIVE: 'accepted',
              PrescriptionStatus.REJECTED: 'rejected'}
    for st, cnt in pq.group_by(Prescription.status).all():
        key = ps_map.get(st)
        if key:
            out.setdefault('prescription', _blank_counts())[key] += int(cnt)

    # document + group_plan — DoctorDocument.status split by group_booking_id
    dq = db.session.query(DoctorDocument.status,
                          DoctorDocument.group_booking_id.isnot(None),
                          db.func.count(DoctorDocument.id)).filter(
        DoctorDocument.tenant_id == tid, DoctorDocument.is_deleted.is_(False))
    if entity_id:
        dq = dq.filter(DoctorDocument.doctor_id == entity_id)
    ds_map = {DocumentStatus.PENDING_APPROVAL: 'pending',
              DocumentStatus.APPROVED: 'accepted', DocumentStatus.ACTIVE: 'accepted',
              DocumentStatus.REJECTED: 'rejected'}
    for st, is_group, cnt in dq.group_by(DoctorDocument.status, DoctorDocument.group_booking_id.isnot(None)).all():
        key = ds_map.get(st)
        if key:
            section = 'group_plan' if is_group else 'document'
            out.setdefault(section, _blank_counts())[key] += int(cnt)

    # held doctor actions (appointment_cancel / appointment_reschedule / payments)
    from app.models import PendingDoctorAction
    pda = db.session.query(PendingDoctorAction.kind, PendingDoctorAction.status,
                           db.func.count(PendingDoctorAction.id)).filter(
        PendingDoctorAction.tenant_id == tid)
    if entity_id:
        pda = pda.filter(PendingDoctorAction.doctor_id == entity_id)
    pda_map = {'pending': 'pending', 'approved': 'accepted', 'rejected': 'rejected'}
    for kind, st, cnt in pda.group_by(PendingDoctorAction.kind, PendingDoctorAction.status).all():
        key = pda_map.get(st)
        if key and kind:
            out.setdefault(kind, _blank_counts())[key] += int(cnt)


@admin_bp.route('/approval-policy', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_approval_policy():
    """The tenant-wide default approval modes + the canonical section/action keys."""
    from app.api.admin.approval_policy_service import get_or_create_policy
    from app.models.approval_policy import (
        PERMISSION_SECTIONS, ACTION_KEYS, DEFAULT_PERMISSION_MODE, DEFAULT_ACTION_MODE)
    tid = current_tenant_id_strict()
    policy = get_or_create_policy(tid)
    return success_response(data={
        'policy': policy.to_dict(),
        'permission_sections': list(PERMISSION_SECTIONS),
        'action_keys': list(ACTION_KEYS),
        'defaults': {'permission': DEFAULT_PERMISSION_MODE, 'action': DEFAULT_ACTION_MODE},
    })


@admin_bp.route('/approval-policy', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def update_approval_policy():
    """Update tenant-wide defaults. Body: {permission_modes, action_modes, is_active}."""
    from app.api.admin.approval_policy_service import (
        get_or_create_policy, sanitize_permission_modes, sanitize_action_modes)
    tid = current_tenant_id_strict()
    data = request.get_json() or {}
    policy = get_or_create_policy(tid)
    if 'permission_modes' in data:
        policy.permission_modes = sanitize_permission_modes(data.get('permission_modes'))
    if 'action_modes' in data:
        policy.action_modes = sanitize_action_modes(data.get('action_modes'))
    if 'is_active' in data:
        policy.is_active = bool(data.get('is_active'))
    db.session.commit()
    return success_response(
        data={'policy': policy.to_dict()},
        message='Approval policy saved — live for new submissions.')


@admin_bp.route('/approval-policy/counts', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_approval_counts():
    """Aggregate Pending/Accepted/Rejected/Query by section across all doctors."""
    return success_response(data={'counts': _approval_counts_by_section(current_tenant_id_strict())})


@admin_bp.route('/doctors/<doctor_id>/approval-modes', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_doctor_approval_modes(doctor_id):
    """A doctor's effective modes (resolved) + their raw overrides + per-section counts."""
    from app.models import Doctor
    from app.api.admin.approval_policy_service import (
        effective_permission_mode, effective_action_mode)
    from app.models.approval_policy import PERMISSION_SECTIONS, ACTION_KEYS
    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(id=doctor_id, tenant_id=tid).first()
    if not doctor:
        return not_found_response('Doctor')
    return success_response(data={
        'effective': {
            'permission_modes': {k: effective_permission_mode(doctor, k) for k in PERMISSION_SECTIONS},
            'action_modes': {k: effective_action_mode(doctor, k) for k in ACTION_KEYS},
        },
        'override': {
            'permission_modes': getattr(doctor, 'approval_permission_modes', None) or {},
            'action_modes': getattr(doctor, 'approval_action_modes', None) or {},
        },
        'counts': _approval_counts_by_section(tid, str(doctor_id)),
    })


@admin_bp.route('/doctors/<doctor_id>/approval-modes', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def update_doctor_approval_modes(doctor_id):
    """Set/clear a doctor's overrides. Body: {permission_modes, action_modes}. A
    value of null / '' / 'default' clears that key (falls back to global default)."""
    from app.models import Doctor
    from app.api.admin.approval_policy_service import (
        sanitize_permission_modes, sanitize_action_modes)
    from sqlalchemy.orm.attributes import flag_modified
    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(id=doctor_id, tenant_id=tid).first()
    if not doctor:
        return not_found_response('Doctor')
    data = request.get_json() or {}

    def _merge(existing, incoming):
        merged = dict(existing or {})
        for k, v in (incoming or {}).items():
            if v in (None, '', 'default'):
                merged.pop(k, None)
            else:
                merged[k] = v
        return merged

    if 'permission_modes' in data:
        doctor.approval_permission_modes = sanitize_permission_modes(
            _merge(getattr(doctor, 'approval_permission_modes', None), data.get('permission_modes')))
        flag_modified(doctor, 'approval_permission_modes')
    if 'action_modes' in data:
        doctor.approval_action_modes = sanitize_action_modes(
            _merge(getattr(doctor, 'approval_action_modes', None), data.get('action_modes')))
        flag_modified(doctor, 'approval_action_modes')
    db.session.commit()
    return success_response(message='Per-doctor approval overrides saved — live for new submissions.')


# --- Held doctor actions (cancel / reschedule / payout-claim awaiting approval) ---

@admin_bp.route('/pending-actions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def list_pending_doctor_actions():
    """Doctor-initiated actions held pending admin approval (status pending by
    default). Each carries the doctor name + a human label for the queue."""
    from app.models import PendingDoctorAction, Doctor
    tid = current_tenant_id_strict()
    status = request.args.get('status', 'pending')
    q = PendingDoctorAction.query.filter_by(tenant_id=tid)
    if status and status != 'all':
        q = q.filter(PendingDoctorAction.status == status)
    rows = q.order_by(PendingDoctorAction.created_at.desc()).limit(200).all()
    doc_names = {}
    for r in rows:
        if r.doctor_id not in doc_names:
            d = Doctor.query.filter_by(id=r.doctor_id).first()
            doc_names[r.doctor_id] = (f'{d.user.first_name or ""} {d.user.last_name or ""}'.strip()
                                      if d and d.user else None)
    out = []
    for r in rows:
        item = r.to_dict()
        item['doctor_name'] = doc_names.get(r.doctor_id)
        out.append(item)
    return success_response(data={'actions': out})


@admin_bp.route('/pending-actions/<action_id>/approve', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def approve_pending_doctor_action(action_id):
    """Approve a held doctor action — executes its effect (cancel the
    appointment / disburse the claimed payout)."""
    from app.api.admin.doctor_action_gate import approve_pending_action
    comment = (request.get_json() or {}).get('comment')
    row, message = approve_pending_action(action_id, current_user.id, comment)
    if row is None:
        return error_response(message or 'Could not approve', status_code=400)
    return success_response(data=row.to_dict(), message=message or 'Action approved and applied.')


@admin_bp.route('/pending-actions/<action_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def reject_pending_doctor_action(action_id):
    """Reject a held doctor action — it never takes effect."""
    from app.api.admin.doctor_action_gate import reject_pending_action
    comment = (request.get_json() or {}).get('comment')
    row = reject_pending_action(action_id, current_user.id, comment)
    if row is None:
        return error_response('No pending action found', status_code=404)
    return success_response(data=row.to_dict(), message='Action rejected.')


@admin_bp.route('/service-interests', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def list_service_interests():
    """Doctors who've expressed interest in a catalog service / group plan, so
    the admin can review and assign accordingly."""
    from app.models import ServiceInterest, Doctor, DoctorProduct
    tid = current_tenant_id_strict()
    rows = (ServiceInterest.query.filter_by(tenant_id=tid)
            .order_by(ServiceInterest.created_at.desc()).limit(300).all())
    doc_names, prod_names = {}, {}
    for r in rows:
        if r.doctor_id not in doc_names:
            d = Doctor.query.filter_by(id=r.doctor_id).first()
            doc_names[r.doctor_id] = (f'{d.user.first_name or ""} {d.user.last_name or ""}'.strip()
                                      if d and d.user else None)
        if r.product_id not in prod_names:
            p = DoctorProduct.query.filter_by(id=r.product_id).first()
            prod_names[r.product_id] = p.name if p else None
    out = []
    for r in rows:
        item = r.to_dict()
        item['doctor_name'] = doc_names.get(r.doctor_id)
        item['product_name'] = prod_names.get(r.product_id)
        out.append(item)
    return success_response(data={'interests': out})


# --- User Management ---

@admin_bp.route('/users', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_users():
    """List all users with filters."""
    # TODO: Implement user listing
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


@admin_bp.route('/users/<user_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_user(user_id):
    """Get user details."""
    # TODO: Implement get user
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


@admin_bp.route('/users/<user_id>/status', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_user_status(user_id):
    """Update user status (activate/block/etc.)."""
    # TODO: Implement status update
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


# --- Doctor Verification ---

@admin_bp.route('/doctors/<doctor_id>/status', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.EDIT_DOCTOR_STATUS)
def update_doctor_status(doctor_id):
    """
    Update doctor user status (activate/block).
    Requires: edit_doctor_status permission (or super_admin)
    
    Request Body:
        {"status": "active" | "blocked" | "inactive"}
    """
    from app.models import UserStatus
    
    data = request.get_json()
    logger.debug(f"[ADMIN:UPDATE_DOCTOR_STATUS] doctor_id={doctor_id}, new_status={data.get('status') if data else None}")
    if not data or 'status' not in data:
        return error_response('Status is required', status_code=400)
    
    new_status = data['status']
    
    # Validate status value
    valid_statuses = ['active', 'blocked', 'inactive']
    if new_status not in valid_statuses:
        return error_response(f'Invalid status. Must be one of: {", ".join(valid_statuses)}', status_code=400)
    
    # Find doctor (tenant-scoped)
    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    
    # Get the associated user
    user = doctor.user
    if not user:
        return error_response('User not found for doctor', status_code=404)
    
    # Update status
    try:
        user.status = UserStatus(new_status)
        db.session.commit()

        return success_response(
            data={
                'doctor_id': str(doctor.id),
                'user_id': str(user.id),
                'new_status': user.status.value
            },
            message=f'Doctor status updated to {new_status}'
        )
    except Exception as e:
        logger.error(f"Failed to update doctor status: {e}")
        db.session.rollback()
        return error_response('An internal error occurred', status_code=500)


@admin_bp.route('/doctors/<doctor_id>/landing-popular', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.EDIT_DOCTOR_STATUS)
def update_doctor_landing_popular(doctor_id):
    """Toggle whether a doctor appears on the public landing booking widget.

    The landing widget shows only ``is_popular`` doctors (a curated subset);
    the full published directory is bookable after login. Independent of
    ``publish_status`` — a doctor must be BOTH popular AND publish_status=active
    to surface publicly.

    Body: ``{"is_popular": true | false}``
    """
    data = request.get_json() or {}
    if 'is_popular' not in data:
        return error_response('is_popular is required', status_code=400)

    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    doctor.is_popular = bool(data['is_popular'])
    db.session.commit()
    return success_response(
        data={'doctor_id': str(doctor.id), 'is_popular': doctor.is_popular},
        message=('Doctor shown on landing' if doctor.is_popular
                 else 'Doctor hidden from landing'),
    )


@admin_bp.route('/doctors/<doctor_id>/verification', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(PermissionModule.APPROVE_REGISTRATION, PermissionAction.EDIT)
def update_doctor_verification(doctor_id):
    """
    Update doctor verification status (approve/reject).
    Requires: verify_doctors permission (or super_admin)
    
    Request Body:
        {"verification_status": "pending" | "verified" | "rejected"}
    """
    from app.models import UserVerificationStatus

    data = request.get_json()
    logger.debug(f"[ADMIN:VERIFY_DOCTOR] doctor_id={doctor_id}, new_status={data.get('verification_status') if data else None}")
    if not data or 'verification_status' not in data:
        return error_response('verification_status is required', status_code=400)
    
    new_status = data['verification_status']
    rejection_reason = (data.get('reason') or '').strip() or None

    # Validate verification status value
    valid_statuses = ['pending', 'verified', 'rejected']
    if new_status not in valid_statuses:
        return error_response(f'Invalid verification_status. Must be one of: {", ".join(valid_statuses)}', status_code=400)

    # Find doctor (tenant-scoped)
    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    # Snapshot before mutation so we only notify on real transitions
    # (e.g. pending → verified, pending → rejected). Idempotent re-saves
    # of the same status do NOT re-fire the email.
    prev_status = doctor.verification_status

    # Update verification status
    try:
        doctor.verification_status = UserVerificationStatus(new_status)

        # ── Activate / deactivate the doctor's User row ────────────
        # Same fix as the facility-verification path: a doctor's
        # User row starts at status=PENDING after signup and isn't
        # flipped by verification. Without this, an approved doctor
        # still saw "Account is not active" on signin until the
        # separate /admin/doctors/<id>/status endpoint was hit too.
        # Tie the User status to the verification outcome:
        #   VERIFIED  → ACTIVE
        #   REJECTED  → INACTIVE
        #   PENDING   → leave alone (re-review of a previously
        #               ACTIVE doctor shouldn't lock them out)
        from app.models import UserStatus
        if doctor.user:
            if doctor.verification_status == UserVerificationStatus.VERIFIED:
                doctor.user.status = UserStatus.ACTIVE
            elif doctor.verification_status == UserVerificationStatus.REJECTED:
                doctor.user.status = UserStatus.INACTIVE

        db.session.commit()

        # ── Marketplace membership trial activation (Round 2) ──────
        # Doctors who picked a marketplace plan at signup have a
        # PENDING ``MembershipSubscription`` row with a NULL trial
        # clock. Approval is the moment the clock starts — burning
        # trial days while waiting on credential review would be a
        # bad UX. ``activate_trial`` is idempotent so re-firing the
        # approval (admin edits, etc.) doesn't reset the clock.
        if (
            prev_status != doctor.verification_status
            and doctor.verification_status == UserVerificationStatus.VERIFIED
        ):
            try:
                from app.api.membership.service import (
                    MembershipSubscriptionService,
                )
                user_for_trial = doctor.user
                if user_for_trial:
                    sub = MembershipSubscriptionService.get_active_for_user(
                        user_for_trial.id,
                    )
                    if sub is not None:
                        MembershipSubscriptionService.activate_trial(sub)
            except Exception as e:  # noqa: BLE001
                # Membership wiring must never block doctor approval —
                # log loud and let the admin's primary action succeed.
                logger.warning(
                    f"[ADMIN:VERIFY_DOCTOR] membership trial activation failed: {e}"
                )

            # ── In-tenant TenantProviderSubscription activation (Round 5) ─
            # Doctors signed up inside a non-apex tenant subdomain may
            # have a PENDING ``TenantProviderSubscription`` row instead
            # of (or alongside, but never both for the same approval)
            # the apex membership above. Same idempotent activate-on-
            # approval semantics — the trial clock starts when the
            # tenant admin verifies the doctor, not at signup.
            try:
                from app.api.tenant_provider_plan.service import (
                    TenantProviderSubscriptionService,
                )
                from app.models import MembershipVertical
                pending = (
                    TenantProviderSubscriptionService
                    .get_pending_for_provider(
                        tenant_id=doctor.tenant_id,
                        vertical=MembershipVertical.DOCTOR,
                        provider_id=doctor.id,
                    )
                )
                if pending is not None:
                    TenantProviderSubscriptionService.activate_trial(pending)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"[ADMIN:VERIFY_DOCTOR] tenant-provider trial "
                    f"activation failed: {e}"
                )

        # ── Best-effort applicant notification ──────────────────────
        # Only fire on the meaningful transitions; no email for
        # verified→pending or rejected→pending edits, those are admin
        # bookkeeping actions.
        try:
            from app.services.email_service import EmailService
            from app.services.sms_service import SMSService
            from app.api.affiliation.service import build_login_url
            user = doctor.user
            if user and prev_status != doctor.verification_status:
                if doctor.verification_status == UserVerificationStatus.VERIFIED:
                    # Per-tenant, per-role sign-in URL. The legacy
                    # ``FRONTEND_URL + '/auth/login'`` construction
                    # was wrong on both counts: FRONTEND_URL is the
                    # apex (not the doctor's tenant), and
                    # ``/auth/login`` doesn't exist (frontend uses
                    # ``/auth/service-provider/login`` for doctors).
                    # build_login_url reads X-Tenant-Host / Origin
                    # from the verification request so the link
                    # lands on the same tenant the admin verified
                    # from, and routes the role to the right portal.
                    login_url = build_login_url(
                        role=user.role, tenant_id=user.tenant_id,
                    )
                    EmailService.send_doctor_approved_email(user, login_url=login_url)
                    SMSService.send_doctor_approved_sms(user)
                    from app.common.notify import push_notification
                    push_notification(
                        tenant_id=user.tenant_id, user_id=user.id,
                        type='doctor_approved',
                        title='Your profile is approved',
                        body='Your verification is complete — patients can '
                             'now find and book you.',
                        data={'kind': 'doctor_verification',
                              'url': '/dashboard/doctor'},
                    )
                elif doctor.verification_status == UserVerificationStatus.REJECTED:
                    EmailService.send_doctor_rejected_email(user, reason=rejection_reason)
                    # SMS body has no {reason} slot — reason ships in the email only.
                    SMSService.send_doctor_rejected_sms(user)
                    from app.common.notify import push_notification
                    push_notification(
                        tenant_id=user.tenant_id, user_id=user.id,
                        type='doctor_rejected',
                        title='Your profile needs changes',
                        body=(rejection_reason or 'Your verification was not '
                              'approved. Check your email for details.'),
                        data={'kind': 'doctor_verification',
                              'url': '/dashboard/doctor'},
                    )
        except Exception as e:
            logger.warning(f"[ADMIN:VERIFY_DOCTOR] notification failed: {e}")

        return success_response(
            data={
                'doctor_id': str(doctor.id),
                'new_verification_status': doctor.verification_status.value
            },
            message=f'Doctor verification status updated to {new_status}'
        )
    except Exception as e:
        logger.error(f"Failed to update verification status: {e}")
        db.session.rollback()
        return error_response('An internal error occurred', status_code=500)


# --------------------------------------------------------------------------- #
# Marketplace facility verification — Round 3+4
# --------------------------------------------------------------------------- #
# Two new endpoints, both modelled on ``update_doctor_verification``:
#   PUT /admin/clinics/<id>/verification   — gated on VERIFY_CLINICS
#   PUT /admin/hospitals/<id>/verification — gated on VERIFY_HOSPITALS
# Each flips the facility's ``verification_status`` and, on
# PENDING → VERIFIED, activates the marketplace membership trial.
# Notification emails are best-effort: if the template helper is
# absent we just log warn (keeps Round 3+4 self-contained — the
# template registry work is a separate doc-side task).
# --------------------------------------------------------------------------- #


def _update_facility_verification(*, vertical, model, facility_id, request_data):
    """Shared core for clinic + hospital verification endpoints.

    Returns a Flask response tuple. Splitting it into a helper avoids
    duplicating ~40 lines of identical logic between the two routes.
    """
    from app.api.membership.service import MembershipSubscriptionService
    from app.models import UserVerificationStatus

    if not request_data or 'verification_status' not in request_data:
        return error_response(
            'verification_status is required', status_code=400,
        )
    new_status_raw = request_data['verification_status']
    valid_statuses = ['pending', 'verified', 'rejected']
    if new_status_raw not in valid_statuses:
        return error_response(
            f'Invalid verification_status. Must be one of: '
            f'{", ".join(valid_statuses)}',
            status_code=400,
        )

    facility = model.query.filter_by(
        id=facility_id,
        tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()
    if not facility:
        return error_response(f'{vertical.title()} not found', status_code=404)

    prev_status = facility.verification_status
    try:
        facility.verification_status = UserVerificationStatus(new_status_raw)

        # ── Activate / deactivate the facility admin User ────────────
        # The admin user that registered the facility lands at
        # status=PENDING (see auth.service.signup_hospital /
        # signup_clinic). Marking the facility VERIFIED here also
        # flips the admin to ACTIVE so they can actually sign in
        # immediately — previously the admin verified the hospital
        # and the admin user still saw "Account is not active"
        # because nothing ever toggled user.status. Mirror the same
        # rules on the reverse direction so REJECTED facilities lose
        # their admin's sign-in access.
        from app.models import User, UserStatus
        if facility.admin_user_id:
            admin_user = User.query.get(facility.admin_user_id)
            if admin_user:
                if facility.verification_status == UserVerificationStatus.VERIFIED:
                    admin_user.status = UserStatus.ACTIVE
                elif facility.verification_status == UserVerificationStatus.REJECTED:
                    admin_user.status = UserStatus.INACTIVE
                # PENDING — leave the admin user wherever they were
                # so a re-review doesn't disturb a previously-ACTIVE
                # admin (rare but possible when an admin rolls a
                # facility back for re-checking).

        db.session.commit()

        # ── Marketplace trial activation on PENDING → VERIFIED ────
        # Mirrors the doctor approval handler. Wrapped in its own
        # try/except so a membership-side problem can't block the
        # admin's primary action.
        if (
            prev_status != facility.verification_status
            and facility.verification_status == UserVerificationStatus.VERIFIED
        ):
            try:
                owner_user_id = facility.admin_user_id
                if owner_user_id:
                    sub = MembershipSubscriptionService.get_active_for_user(
                        owner_user_id,
                    )
                    if sub is not None:
                        MembershipSubscriptionService.activate_trial(sub)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"[ADMIN:VERIFY_{vertical.upper()}] "
                    f"membership trial activation failed: {e}"
                )

            # In-tenant provider subscription trial activation — Round
            # 10 followup. The doctor branch of this same handler
            # already flips a PENDING TenantProviderSubscription to
            # TRIAL on verification; hospital + clinic verifications
            # were missing the same wiring, so an admin-invited
            # facility stayed in PENDING forever after verification.
            # Mirror the doctor logic verbatim.
            try:
                from app.api.tenant_provider_plan.service import (
                    TenantProviderSubscriptionService,
                )
                from app.models import MembershipVertical
                v_enum = MembershipVertical(vertical)
                pending = (
                    TenantProviderSubscriptionService
                    .get_pending_for_provider(
                        tenant_id=facility.tenant_id,
                        vertical=v_enum,
                        provider_id=facility.id,
                    )
                )
                if pending is not None:
                    TenantProviderSubscriptionService.activate_trial(pending)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"[ADMIN:VERIFY_{vertical.upper()}] "
                    f"in-tenant trial activation failed: {e}"
                )

        # ── Best-effort applicant notification ──────────────────────
        # The clinic / hospital email + SMS templates are part of a
        # separate doc-registry round. Until those land we log if the
        # helper isn't present, rather than 500ing the admin action.
        try:
            from app.services.email_service import EmailService
            user = (
                facility.admin_user_id
                and __import__(
                    'app.models', fromlist=['User'],
                ).User.query.get(facility.admin_user_id)
            )
            if user and prev_status != facility.verification_status:
                if facility.verification_status == UserVerificationStatus.VERIFIED:
                    # Reuse the doctor template until vertical-specific
                    # templates exist — same "approved, log in" message
                    # body works for facility admins too.
                    send_fn = getattr(
                        EmailService,
                        f'send_{vertical}_approved_email',
                        None,
                    ) or getattr(
                        EmailService, 'send_doctor_approved_email', None,
                    )
                    if send_fn:
                        # Per-tenant, per-role sign-in URL — see
                        # the parallel comment in _update_facility's
                        # doctor branch for why FRONTEND_URL + '/auth/login'
                        # was wrong on two counts (apex host + dead path).
                        from app.api.affiliation.service import build_login_url
                        login_url = build_login_url(
                            role=user.role, tenant_id=user.tenant_id,
                        )
                        send_fn(user, login_url=login_url)
        except Exception as e:
            logger.warning(
                f"[ADMIN:VERIFY_{vertical.upper()}] notification failed: {e}"
            )

        return success_response(
            data={
                f'{vertical}_id': str(facility.id),
                'new_verification_status': facility.verification_status.value,
            },
            message=(
                f'{vertical.title()} verification status updated '
                f'to {new_status_raw}'
            ),
        )
    except Exception as e:
        logger.error(
            f"Failed to update {vertical} verification status: {e}"
        )
        db.session.rollback()
        return error_response('An internal error occurred', status_code=500)


# ────────────────────────────────────────────────────────────────────
# Hospital + Clinic list/detail endpoints (Round 10).
#
# Existed previously only as PUT /<id>/verification — admins couldn't
# enumerate facilities to figure out which ones still need verifying.
# Both endpoints are gated on the same permission as the verification
# PUT (no separate VIEW_HOSPITALS / VIEW_CLINICS to avoid permission-
# matrix bloat — an admin who can verify a hospital can also see the
# list of hospitals).
# ────────────────────────────────────────────────────────────────────

def _list_facilities(*, model, vertical):
    """Shared list query for hospitals + clinics. Filters:

      * ?verification_status=pending|verified|rejected — exact match
      * ?search=foo — case-insensitive name / registration_number
      * ?page=N&per_page=N — pagination, defaults page=1, per_page=20
    """
    from app.models import (
        UserVerificationStatus, User, CareNetworkConnection,
    )
    tid = current_tenant_id_strict()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status_str = (request.args.get('verification_status') or '').strip().lower()
    search = (request.args.get('search') or '').strip()

    query = db.session.query(model).filter(
        model.tenant_id == tid, model.is_deleted == False,  # noqa: E712
    )

    if status_str in {'pending', 'verified', 'rejected'}:
        status_enum = {
            'pending':  UserVerificationStatus.PENDING,
            'verified': UserVerificationStatus.VERIFIED,
            'rejected': UserVerificationStatus.REJECTED,
        }[status_str]
        query = query.filter(model.verification_status == status_enum)
    if search:
        like = f'%{search.lower()}%'
        query = query.filter(
            db.or_(
                db.func.lower(model.name).like(like),
                db.func.lower(model.registration_number).like(like),
            )
        )

    pagination = query.order_by(model.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False,
    )

    # Per-facility "My Link" analytics for the current page, in one grouped
    # query (by relationship) rather than N per-row queries. Links live in
    # care_network_connections (connection_type='hospital'/'clinic',
    # context='link', status='active'); relationship_type is stored
    # title-case (Partner / Associate / Employee).
    page_ids = [f.id for f in pagination.items]
    target_col = (
        CareNetworkConnection.target_hospital_id if vertical == 'hospital'
        else CareNetworkConnection.target_clinic_id
    )

    def _blank_analytics():
        return {'total': 0, 'by_relationship': {}}

    analytics = {}
    if page_ids:
        for fid, rel, cnt in (
            db.session.query(
                target_col, CareNetworkConnection.relationship_type,
                db.func.count(CareNetworkConnection.id),
            )
            .filter(
                CareNetworkConnection.tenant_id == tid,
                CareNetworkConnection.connection_type == vertical,
                CareNetworkConnection.context == 'link',
                CareNetworkConnection.status == 'active',
                target_col.in_(page_ids),
            )
            .group_by(target_col, CareNetworkConnection.relationship_type)
            .all()
        ):
            a = analytics.setdefault(str(fid), _blank_analytics())
            rkey = rel or 'Unspecified'
            a['by_relationship'][rkey] = a['by_relationship'].get(rkey, 0) + cnt
            a['total'] += cnt

    rows = []
    for f in pagination.items:
        admin_user = User.query.get(f.admin_user_id) if f.admin_user_id else None
        rows.append({
            'id': str(f.id),
            'name': f.name,
            'registration_number': f.registration_number,
            'address': getattr(f, 'address', None),
            'city': getattr(f, 'city', None),
            'state': getattr(f, 'state', None),
            'verification_status': (
                f.verification_status.value if f.verification_status else None
            ),
            'admin_user': {
                'id': str(admin_user.id),
                'first_name': admin_user.first_name,
                'last_name': admin_user.last_name,
                'email': admin_user.email,
                'phone_number': admin_user.phone_number,
            } if admin_user else None,
            # "My Link" analytics — powers the inline per-row breakdown in
            # the admin "View Vendor" facility table. ``doctor_count`` is
            # the total active linked doctors; ``analytics`` carries the
            # per-relationship breakdown (Partner / Associate / Employee).
            'doctor_count': analytics.get(str(f.id), {}).get('total', 0),
            'analytics': analytics.get(str(f.id)) or {
                'total': 0, 'by_relationship': {},
            },
            'created_at': f.created_at.isoformat() if f.created_at else None,
        })
    return success_response(data={
        f'{vertical}s': rows,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
        },
    })


def _facility_detail(*, model, vertical, facility_id):
    """Shared detail query — returns the row + admin user + presigned URLs
    for the two attachment columns (admin_aadhaar_attachment +
    registration_certificate). Used by the verification UI to render
    the documents alongside the verify/reject buttons."""
    from app.models import User
    tid = current_tenant_id_strict()
    f = model.query.filter_by(
        tenant_id=tid, id=facility_id, is_deleted=False,
    ).first()
    if not f:
        return error_response(f'{vertical.title()} not found', status_code=404)

    admin_user = User.query.get(f.admin_user_id) if f.admin_user_id else None

    # Document keys vary slightly between Hospital + Clinic; only
    # request the ones that the model declares so a future column
    # rename doesn't AttributeError.
    docs = {}
    if hasattr(f, 'admin_aadhaar_attachment'):
        docs['admin_aadhaar_attachment'] = S3Service.get_signed_url(
            f.admin_aadhaar_attachment, 'aadhar_document',
        ) if f.admin_aadhaar_attachment else None
    if hasattr(f, 'registration_certificate'):
        docs['registration_certificate'] = S3Service.get_signed_url(
            f.registration_certificate, 'registration_certificate',
        ) if f.registration_certificate else None

    return success_response(data={
        'id': str(f.id),
        'name': f.name,
        'registration_number': f.registration_number,
        'address': getattr(f, 'address', None),
        'city': getattr(f, 'city', None),
        'state': getattr(f, 'state', None),
        'pincode': getattr(f, 'pincode', None),
        'hospital_type': getattr(f, 'hospital_type', None),
        'verification_status': (
            f.verification_status.value if f.verification_status else None
        ),
        'admin_user': {
            'id': str(admin_user.id),
            'first_name': admin_user.first_name,
            'last_name': admin_user.last_name,
            'email': admin_user.email,
            'phone_number': admin_user.phone_number,
            # The dialog's Activate / Deactivate / Block buttons key
            # off this so the operator sees the current state and
            # the right button is highlighted.
            'status': (
                admin_user.status.value if admin_user.status else None
            ),
        } if admin_user else None,
        'documents': docs,
        'created_at': f.created_at.isoformat() if f.created_at else None,
        'updated_at': f.updated_at.isoformat() if f.updated_at else None,
    })


def _facility_doctors(*, model, vertical, facility_id):
    """Roster of doctors linked to one hospital/clinic via the "My Link"
    care-network, for the admin "View Vendor" drill-down. Each linked
    doctor carries their relationship (Partner / Associate / Employee).

    Tenant-scoped; the facility must belong to the caller's tenant. Links
    live in care_network_connections (connection_type=vertical,
    context='link', status='active', target_{hospital,clinic}_id).
    """
    from app.models import CareNetworkConnection
    tid = current_tenant_id_strict()
    f = model.query.filter_by(
        tenant_id=tid, id=facility_id, is_deleted=False,
    ).first()
    if not f:
        return error_response(f'{vertical.title()} not found', status_code=404)

    target_col = (
        CareNetworkConnection.target_hospital_id if vertical == 'hospital'
        else CareNetworkConnection.target_clinic_id
    )
    conns = (
        CareNetworkConnection.query
        .filter(
            CareNetworkConnection.tenant_id == tid,
            CareNetworkConnection.connection_type == vertical,
            CareNetworkConnection.context == 'link',
            CareNetworkConnection.status == 'active',
            target_col == facility_id,
        )
        .order_by(CareNetworkConnection.created_at.desc())
        .all()
    )

    doctors, by_relationship = [], {}
    for c in conns:
        rel = c.relationship_type or 'Unspecified'
        by_relationship[rel] = by_relationship.get(rel, 0) + 1
        doc = c.doctor
        doctors.append({
            'connection_id': str(c.id),
            'doctor_id': str(c.doctor_id),
            'doctor_name': doc.full_name if doc else None,
            'relationship_type': rel,
            'status': c.status,
        })

    return success_response(data={
        'facility': {'id': str(f.id), 'name': f.name, 'kind': vertical},
        'doctors': doctors,
        'counts': {
            'total': len(conns),
            'by_relationship': by_relationship,
        },
    })


@admin_bp.route('/hospitals', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_HOSPITALS)
def list_hospitals():
    """List hospitals (paginated, filterable by verification_status + search)."""
    from app.models import Hospital
    return _list_facilities(model=Hospital, vertical='hospital')


@admin_bp.route('/hospitals/<hospital_id>/doctors', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_HOSPITALS)
def list_hospital_doctors(hospital_id):
    """Doctors affiliated to one hospital (name + relation type + status)."""
    from app.models import Hospital
    return _facility_doctors(
        model=Hospital, vertical='hospital', facility_id=hospital_id,
    )


@admin_bp.route('/hospitals/<hospital_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_HOSPITALS)
def get_hospital_detail(hospital_id):
    """Get one hospital with its admin user + presigned document URLs."""
    from app.models import Hospital
    return _facility_detail(
        model=Hospital, vertical='hospital', facility_id=hospital_id,
    )


@admin_bp.route('/clinics', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_CLINICS)
def list_clinics():
    """List clinics (paginated, filterable by verification_status + search)."""
    from app.models import Clinic
    return _list_facilities(model=Clinic, vertical='clinic')


@admin_bp.route('/clinics/<clinic_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_CLINICS)
def get_clinic_detail(clinic_id):
    """Get one clinic with its admin user + presigned document URLs."""
    from app.models import Clinic
    return _facility_detail(
        model=Clinic, vertical='clinic', facility_id=clinic_id,
    )


@admin_bp.route('/clinics/<clinic_id>/doctors', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_CLINICS)
def list_clinic_doctors(clinic_id):
    """Doctors affiliated to one clinic (name + relation type + status)."""
    from app.models import Clinic
    return _facility_doctors(
        model=Clinic, vertical='clinic', facility_id=clinic_id,
    )


@admin_bp.route('/clinics/<clinic_id>/verification', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(PermissionModule.APPROVE_REGISTRATION, PermissionAction.EDIT)
def update_clinic_verification(clinic_id):
    """Update clinic verification status (approve / reject).

    Requires: ``verify_clinics`` permission (or super_admin). On
    PENDING → VERIFIED, kicks the marketplace membership trial clock
    by calling ``MembershipSubscriptionService.activate_trial``.

    Request Body:
        {"verification_status": "pending" | "verified" | "rejected"}
    """
    from app.models import Clinic
    data = request.get_json()
    logger.debug(
        f"[ADMIN:VERIFY_CLINIC] clinic_id={clinic_id}, "
        f"new_status={data.get('verification_status') if data else None}"
    )
    return _update_facility_verification(
        vertical='clinic', model=Clinic,
        facility_id=clinic_id, request_data=data,
    )


@admin_bp.route('/hospitals/<hospital_id>/verification', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(PermissionModule.APPROVE_REGISTRATION, PermissionAction.EDIT)
def update_hospital_verification(hospital_id):
    """Update hospital verification status (approve / reject).

    Requires: ``verify_hospitals`` permission (or super_admin). Same
    trial-on-approval semantics as the clinic and doctor endpoints.

    Request Body:
        {"verification_status": "pending" | "verified" | "rejected"}
    """
    from app.models import Hospital
    data = request.get_json()
    logger.debug(
        f"[ADMIN:VERIFY_HOSPITAL] hospital_id={hospital_id}, "
        f"new_status={data.get('verification_status') if data else None}"
    )
    return _update_facility_verification(
        vertical='hospital', model=Hospital,
        facility_id=hospital_id, request_data=data,
    )


# --------------------------------------------------------------------------- #
# Facility admin-user status toggle.
# Mirrors ``update_doctor_status``: lets a SUPER_ADMIN / SUB_ADMIN with the
# right permission flip the underlying admin User's ``status`` independent
# of the facility's verification_status. This is the escape hatch for the
# "facility is VERIFIED but the admin user can't sign in" case (e.g. row
# was verified before the activate-on-verify code shipped, or someone
# manually deactivated the user) — and the inverse, deactivating an
# admin without un-verifying the facility itself.
# --------------------------------------------------------------------------- #


def _update_facility_admin_status(*, vertical, model, facility_id, request_data):
    """Shared core: flip the admin User's status on a facility."""
    from app.models import User, UserStatus
    if not request_data or 'status' not in request_data:
        return error_response('status is required', status_code=400)
    new_status_raw = request_data['status']
    valid_statuses = ['active', 'inactive', 'blocked']
    if new_status_raw not in valid_statuses:
        return error_response(
            f'Invalid status. Must be one of: {", ".join(valid_statuses)}',
            status_code=400,
        )

    facility = model.query.filter_by(
        id=facility_id,
        tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()
    if not facility:
        return error_response(f'{vertical.title()} not found', status_code=404)
    if not facility.admin_user_id:
        return error_response(
            f'{vertical.title()} has no admin user on record.',
            status_code=400,
        )

    admin_user = User.query.get(facility.admin_user_id)
    if not admin_user:
        return error_response(
            f'Admin user for this {vertical} no longer exists.',
            status_code=404,
        )

    try:
        admin_user.status = UserStatus(new_status_raw)
        db.session.commit()
        logger.info(
            f"[ADMIN:FACILITY_ADMIN_STATUS] {vertical}={facility_id} "
            f"user={admin_user.id} -> {new_status_raw}"
        )
        return success_response(
            data={
                f'{vertical}_id': str(facility.id),
                'user_id': str(admin_user.id),
                'new_status': admin_user.status.value,
            },
            message=f"{vertical.title()} admin user status updated to {new_status_raw}",
        )
    except Exception as e:  # noqa: BLE001
        db.session.rollback()
        logger.error(
            f"[ADMIN:FACILITY_ADMIN_STATUS] {vertical}={facility_id} "
            f"failed: {e}"
        )
        return error_response('Failed to update admin status', status_code=500)


@admin_bp.route('/hospitals/<hospital_id>/admin-status', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_HOSPITALS)
def update_hospital_admin_status(hospital_id):
    """Flip the hospital admin user's account status."""
    from app.models import Hospital
    return _update_facility_admin_status(
        vertical='hospital', model=Hospital,
        facility_id=hospital_id, request_data=request.get_json(),
    )


@admin_bp.route('/clinics/<clinic_id>/admin-status', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_CLINICS)
def update_clinic_admin_status(clinic_id):
    """Flip the clinic admin user's account status."""
    from app.models import Clinic
    return _update_facility_admin_status(
        vertical='clinic', model=Clinic,
        facility_id=clinic_id, request_data=request.get_json(),
    )


@admin_bp.route('/doctors/<doctor_id>/documents', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_doctor_documents(doctor_id):
    """
    Get doctor's documents for verification.

    Aggregates every uploaded file the verifier needs to see:
      * Core identity — registration certificate + aadhar attachment
        (Doctor model, has been there since day 1).
      * Profile image + signature(s) — these moved to User /
        ProfileSignature when the doctor / admin shared profile tables
        were split. Earlier the endpoint read them off ``doctor.*``
        directly and returned ``None`` for every doctor (the columns
        no longer exist on Doctor), which surfaced to the operator as
        "I can't see any documents".
      * Education certificates + marksheets per level — UG / PG /
        super-speciality / other-cert. ProfileEducation row.
      * Brief-about attachment — ProfileAbout row.
      * Declaration documents — ProfileDeclarationResponse rows.
      * Bank account attachments — ProfileBankAccount rows.

    Each document is returned as a presigned S3 URL valid for the
    S3Service's default TTL. Missing files are returned as ``None``
    rather than omitted so the frontend can render a "not yet
    uploaded" placeholder consistently.

    Requires: view_doctors permission (or super_admin).
    """
    from app.models import (
        ProfileSignature, ProfileAbout, ProfileEducation,
        ProfileDeclarationResponse, ProfileBankAccount, ProfileDocument,
    )

    logger.debug(f"[ADMIN:GET_DOCTOR_DOCS] doctor_id={doctor_id}")
    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(
        tenant_id=tid,
        id=doctor_id,
        is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    def _sign(s3_key, asset_type='profile_document'):
        """Return a presigned URL for an S3 key, or None when empty.

        Wrapped so the row stays readable when a doctor has only
        partially uploaded their documents — the verifier sees the
        same envelope shape for every doctor and the frontend
        renders "Not uploaded" for the None fields.
        """
        if not s3_key:
            return None
        return S3Service.get_signed_url(s3_key, asset_type)

    def _full_url_or_signed(url, s3_key, asset_type='profile_document'):
        """Some legacy rows persist a full presigned URL in the ``*_url``
        column AND the s3_key separately. Prefer the s3_key path
        (fresh presigned URL) when both exist; fall back to the saved
        URL otherwise."""
        if s3_key:
            return S3Service.get_signed_url(s3_key, asset_type)
        return url or None

    # ── Signatures (ProfileSignature) ─────────────────────────────────
    sig = ProfileSignature.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).first()
    signatures_block = {
        'signature1': _full_url_or_signed(
            getattr(sig, 'signature1_url', None) if sig else None,
            getattr(sig, 'signature1_s3_key', None) if sig else None,
        ),
        'signature2': _full_url_or_signed(
            getattr(sig, 'signature2_url', None) if sig else None,
            getattr(sig, 'signature2_s3_key', None) if sig else None,
        ),
        'digital_signature': _full_url_or_signed(
            getattr(sig, 'digital_signature_url', None) if sig else None,
            getattr(sig, 'digital_signature_s3_key', None) if sig else None,
        ),
    }

    # ── About (ProfileAbout) ─────────────────────────────────────────
    about = ProfileAbout.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).first()
    about_block = {
        'brief_about_attachment': _full_url_or_signed(
            getattr(about, 'brief_about_attachment_url', None) if about else None,
            getattr(about, 'brief_about_attachment_s3_key', None) if about else None,
        ),
        'brief_about_text': getattr(about, 'brief_about_text', None) if about else None,
        'nature_of_work_text': getattr(about, 'nature_of_work_text', None) if about else None,
    }

    # ── Education (ProfileEducation) ─────────────────────────────────
    edu = ProfileEducation.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).first()
    edu_block = {}
    if edu:
        for level in ('graduation', 'post_graduation', 'super_speciality',
                      'other_certification'):
            edu_block[level] = {
                'certificate': _full_url_or_signed(
                    getattr(edu, f'{level}_certificate_url', None),
                    getattr(edu, f'{level}_certificate_s3_key', None),
                ),
                'marksheet': _full_url_or_signed(
                    getattr(edu, f'{level}_marksheet_url', None),
                    getattr(edu, f'{level}_marksheet_s3_key', None),
                ),
            }

    # ── Declarations (ProfileDeclarationResponse rows) ───────────────
    declarations = ProfileDeclarationResponse.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).all()
    declarations_block = []
    for d in declarations:
        declarations_block.append({
            'id': str(d.id),
            'config_id': str(d.config_id) if getattr(d, 'config_id', None) else None,
            'answer': getattr(d, 'answer', None),
            'explanation': getattr(d, 'explanation', None),
            'attachment': _full_url_or_signed(
                getattr(d, 'attachment_url', None),
                getattr(d, 'attachment_s3_key', None),
                'declaration_document',
            ),
        })

    # ── Bank accounts (ProfileBankAccount rows) ──────────────────────
    bank_accounts = ProfileBankAccount.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).order_by(ProfileBankAccount.order_index).all()
    bank_block = []
    for b in bank_accounts:
        bank_block.append({
            'id': str(b.id),
            'bank_name': b.bank_name,
            'account_number_masked': (
                f"****{b.account_number[-4:]}"
                if getattr(b, 'account_number', None) else None
            ),
            'ifsc_code': getattr(b, 'ifsc_code', None),
            'passbook': _full_url_or_signed(
                getattr(b, 'passbook_url', None),
                getattr(b, 'passbook_s3_key', None),
                'bank_document',
            ),
            'check_leaf': _full_url_or_signed(
                getattr(b, 'check_leaf_url', None),
                getattr(b, 'check_leaf_s3_key', None),
                'bank_document',
            ),
            'bank_statement': _full_url_or_signed(
                getattr(b, 'bank_statement_url', None),
                getattr(b, 'bank_statement_s3_key', None),
                'bank_document',
            ),
        })

    # ── Generic profile documents (ProfileDocument rows) ─────────────
    # ProfileDocument holds any extra uploads the editor allows past
    # the fixed-field set above — typically signatures-of-record,
    # custom declaration uploads, etc. Surface them under a generic
    # ``other_documents`` array so the verifier sees everything.
    other_docs = ProfileDocument.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id,
    ).all() if ProfileDocument is not None else []
    other_block = []
    for d in other_docs:
        other_block.append({
            'id': str(d.id),
            'doc_type': getattr(d, 'doc_type', None),
            'label': getattr(d, 'label', None) or getattr(d, 'name', None),
            'url': _full_url_or_signed(
                getattr(d, 'file_url', None),
                getattr(d, 'file_s3_key', None),
                'profile_document',
            ),
        })

    documents = {
        'doctor_id': str(doctor.id),
        'doctor_name': doctor.full_name,
        'registration_number': doctor.registration_number,
        'registration_council': doctor.registration_council,
        'registration_year': doctor.registration_year,
        # COP + registration certificate approval state, so the admin UI can
        # show status and approve/reject.
        'certificate_verification': {
            'registration_certificate': (
                doctor.registration_certificate_verification_status.value
                if doctor.registration_certificate_verification_status else 'PENDING'
            ),
            'cop_attachment': (
                doctor.cop_attachment_verification_status.value
                if doctor.cop_attachment_verification_status else 'PENDING'
            ),
        },
        'documents': {
            # Core identity
            'registration_certificate': _sign(
                doctor.registration_certificate, 'registration_certificate',
            ),
            'cop_attachment': _sign(
                doctor.cop_attachment, 'cop_document',
            ),
            'aadhar_attachment': _sign(
                doctor.aadhar_attachment, 'aadhar_document',
            ),
            # Profile image lives on User now (not Doctor) — was
            # returning None unconditionally before this fix because
            # the old code read ``doctor.profile_image`` which has
            # been removed from the model.
            'profile_image': _sign(
                getattr(doctor.user, 'profile_image', None) if doctor.user else None,
                'profile_document',
            ),
            # Signatures live in ProfileSignature now (not Doctor).
            # The old code's ``doctor.signature_image`` always
            # returned None too.
            **signatures_block,
            # About attachment
            'about': about_block,
            # Education certificates + marksheets per level
            'education': edu_block,
        },
        'qualifications': [q.to_dict() for q in doctor.qualifications.all()],
        'declarations': declarations_block,
        'bank_accounts': bank_block,
        'other_documents': other_block,
    }

    return success_response(data=documents)


@admin_bp.route('/doctors/<doctor_id>/certificate-verification', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VERIFY_DOCTORS)
def verify_doctor_certificate(doctor_id):
    """Approve / reject a doctor's registration or COP certificate.

    Body: {"field": "registration_certificate" | "cop_attachment",
           "status": "verified" | "rejected" | "pending"}
    """
    from app.models import Doctor, DocumentVerificationStatus
    data = request.get_json() or {}
    field = (data.get('field') or '').strip()
    status = (data.get('status') or '').strip().lower()

    allowed_fields = {'registration_certificate', 'cop_attachment'}
    if field not in allowed_fields:
        return error_response(
            f'field must be one of {sorted(allowed_fields)}.', status_code=400)
    try:
        status_enum = DocumentVerificationStatus(status)
    except ValueError:
        return error_response(
            'status must be verified / rejected / pending.', status_code=400)

    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=current_tenant_id_strict()).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    if not getattr(doctor, field):
        return error_response('No certificate uploaded for this field.', status_code=400)

    setattr(doctor, f'{field}_verification_status', status_enum)
    db.session.commit()
    return success_response(
        data={'field': field, 'status': status_enum.value},
        message='Certificate verification updated.',
    )


@admin_bp.route('/doctors/pending', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_pending_doctors():
    """Get doctors pending verification."""
    from app.models import UserVerificationStatus

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    logger.debug(f"[ADMIN:PENDING_DOCTORS] page={page}, per_page={per_page}")
    
    query = db.session.query(Doctor).join(User, Doctor.user_id == User.id).filter(
        Doctor.tenant_id == current_tenant_id_strict(),
        User.is_deleted == False,
        User.role == UserRole.DOCTOR,
        Doctor.verification_status == UserVerificationStatus.PENDING,
    )
    
    pagination = query.order_by(Doctor.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    doctors = []
    for doctor in pagination.items:
        doctors.append({
            'id': str(doctor.id),
            'user_id': str(doctor.user_id),
            'first_name': doctor.user.first_name if doctor.user else None,
            'last_name': doctor.user.last_name if doctor.user else None,
            'email': doctor.user.email if doctor.user else None,
            'phone_number': doctor.user.phone_number if doctor.user else None,
            'registration_number': doctor.registration_number,
            'verification_status': doctor.verification_status.value if doctor.verification_status else None,
            'created_at': doctor.created_at.isoformat() if doctor.created_at else None,
        })
    
    return success_response(data={
        'doctors': doctors,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages
        }
    })




@admin_bp.route('/categories', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_categories():
    """List all medical categories."""
    # TODO: Implement
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


@admin_bp.route('/categories', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_category():
    """Create a new category."""
    # TODO: Implement
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


# --- Doctor Bank Accounts ---

@admin_bp.route('/doctors/<doctor_id>/bank-accounts', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_DOCTORS)
def get_doctor_bank_accounts(doctor_id):
    """
    Get all bank accounts for a doctor with verification statuses.
    """
    from app.models import ProfileBankAccount

    tenant_id = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    accounts = ProfileBankAccount.query.filter_by(
        doctor_id=doctor.id, tenant_id=tenant_id,
    ).order_by(ProfileBankAccount.order_index).all()

    return success_response(data={
        'doctor_id': str(doctor.id),
        'doctor_name': f"{doctor.user.first_name or ''} {doctor.user.last_name or ''}".strip() if doctor.user else '',
        'accounts': [_bank_account_detail(acc) for acc in accounts],
    })


def _bank_account_detail(acc):
    """Build a detailed bank account dict with signed document URLs."""
    d = acc.to_response_dict()
    # Add signed URLs for documents
    if acc.passbook_s3_key:
        d['passbook']['signedUrl'] = S3Service.get_signed_url(acc.passbook_s3_key)
    if acc.check_leaf_s3_key:
        d['checkLeaf']['signedUrl'] = S3Service.get_signed_url(acc.check_leaf_s3_key)
    if acc.bank_statement_s3_key:
        d['bankStatement']['signedUrl'] = S3Service.get_signed_url(acc.bank_statement_s3_key)
    return d


@admin_bp.route('/doctors/<doctor_id>/bank-accounts/<bank_id>/verify', methods=['PUT'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_BANK_ACCOUNT, PermissionAction.EDIT)
def verify_doctor_bank_account(doctor_id, bank_id):
    """
    Validate / verify / reject a doctor's bank account.

    Body: {
        "action": "validate" | "manual_verify" | "reject"
                  | "remove_beneficiary" | "remove_account",
        "reason": "optional rejection reason"
    }

    Actions:
    - validate:           Cashfree beneficiary + ₹1 penny drop (preferred), else
                          Razorpay Bank Account Validation. The DOCTOR then
                          confirms receipt to reach beneficiary_status='verified',
                          which is what unlocks real Cashfree disbursal.
    - manual_verify:      Force-verify the DOCUMENTS without a gateway (admin's
                          judgement call). NOTE: this does NOT make the account a
                          verified Cashfree beneficiary — auto-payout still needs
                          the penny drop + doctor confirmation.
    - reject:             Reject with a reason.
    - remove_beneficiary: SUSPEND — detach from Cashfree and reset verification.
                          The account row stays and can be re-verified.
    - remove_account:     REMOVE — detach from Cashfree AND delete the account
                          row. Past payouts are kept (bank link cleared).
                          Payouts are held until a new account is verified.
    """
    import os
    from app.models import ProfileBankAccount, DocumentVerificationStatus

    tenant_id = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(
        id=doctor_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    bank = ProfileBankAccount.query.filter_by(
        id=bank_id, doctor_id=doctor.id, tenant_id=tenant_id,
    ).first()
    if not bank:
        return error_response('Bank account not found', status_code=404)

    data = request.get_json() or {}
    action = data.get('action', 'validate')

    # ── Razorpay Bank Account Validation (penny drop via RazorpayX) ──
    if action == 'validate':
        if not bank.account_number or not bank.ifsc_code:
            return error_response(
                'Bank account number and IFSC code are required for validation. '
                'Ask the doctor to fill in the details.',
                status_code=400,
            )

        # Cashfree beneficiary + penny-drop (Phase B) — preferred when
        # configured. Registers the beneficiary and sends ₹1; the DOCTOR then
        # confirms receipt (POST /doctor/bank-accounts/<id>/confirm-penny-drop)
        # to complete verification. Falls back to RazorpayX below otherwise.
        from app.api.common.payment import cashfree_payout as cf
        from app.api.common.payment import beneficiary_service as bene
        if cf.is_configured():
            # Penny drop is sent ONCE — don't fire another ₹1 while one is
            # already awaiting the doctor's confirmation.
            if bank.beneficiary_status == 'penny_sent':
                return error_response(
                    'A ₹1 penny drop was already sent to this account — waiting for the '
                    'doctor to confirm receipt. Use Manual Verify to override, or Remove '
                    'beneficiary to start over.',
                    status_code=400,
                )
            beneficiary = bank.account_name or (
                f"{doctor.user.first_name or ''} {doctor.user.last_name or ''}".strip()
                if doctor.user else 'Doctor'
            )
            try:
                res = bene.register_and_penny_drop(
                    bank, name=beneficiary,
                    phone=doctor.user.phone_number if doctor.user else None,
                    email=doctor.user.email if doctor.user else None,
                )
            except Exception as e:  # noqa: BLE001
                return error_response(f'Cashfree penny drop failed: {e}', status_code=502)
            return success_response(
                data={'bank_account': bank.to_response_dict(), 'penny_drop': res},
                message='₹1 penny drop sent. The doctor confirms receipt to verify the account.',
            )

        try:
            import razorpay
        except ImportError:
            return error_response('Razorpay package not installed on server', status_code=500)

        key_id = os.environ.get('RAZORPAY_KEY_ID', '')
        key_secret = os.environ.get('RAZORPAY_KEY_SECRET', '')
        if not key_id or not key_secret:
            return error_response('Razorpay credentials not configured on server', status_code=500)

        client = razorpay.Client(auth=(key_id, key_secret))
        beneficiary = bank.account_name or (
            f"{doctor.user.first_name or ''} {doctor.user.last_name or ''}".strip()
            if doctor.user else 'Doctor'
        )

        try:
            # RazorpayX APIs use client.post() directly (SDK v1.4.x)

            # Step 1: Create a Contact
            contact_payload = {
                'name': beneficiary,
                'type': 'vendor',
                'reference_id': str(doctor.id),
            }
            if doctor.user and doctor.user.email:
                contact_payload['email'] = doctor.user.email
            if doctor.user and doctor.user.phone_number:
                contact_payload['contact'] = doctor.user.phone_number

            contact = client.post('/v1/contacts', contact_payload)
            contact_id = contact.get('id')
            logger.info(f"[BANK] Created Razorpay contact {contact_id} for doctor={doctor_id}")

            # Step 2: Create Fund Account linked to the contact
            fund_account = client.post('/v1/fund_accounts', {
                'contact_id': contact_id,
                'account_type': 'bank_account',
                'bank_account': {
                    'ifsc': bank.ifsc_code,
                    'name': beneficiary,
                    'account_number': bank.account_number,
                },
            })
            fund_account_id = fund_account.get('id')
            logger.info(f"[BANK] Created Razorpay fund account {fund_account_id} for bank={bank_id}")

            # Step 3: Request validation (penny drop — Re 1 sent and auto-reversed)
            validation = client.post('/v1/fund_accounts/validations', {
                'fund_account': {
                    'id': fund_account_id,
                },
                'amount': 100,           # 100 paise = Re 1
                'currency': 'INR',
                'notes': {
                    'doctor_id': str(doctor.id),
                    'bank_account_id': str(bank.id),
                    'purpose': 'bank_account_verification',
                },
            })

            val_status = validation.get('status', '')
            logger.info(f"[BANK] Razorpay validation response: status={val_status} id={validation.get('id')}")

            if val_status == 'completed':
                # Account is valid — mark verified
                bank.verification_status = DocumentVerificationStatus.VERIFIED
                db.session.commit()
                return success_response(
                    data=_bank_account_detail(bank),
                    message='Bank account validated successfully via Razorpay (penny drop confirmed)',
                )
            elif val_status in ('created', 'initiated'):
                # Validation in progress — typically completes in seconds
                db.session.commit()
                return success_response(
                    data=_bank_account_detail(bank),
                    message=(
                        f'Razorpay validation initiated (status: {val_status}). '
                        'The penny drop is in progress — it typically completes in a few seconds. '
                        'Refresh to check the updated status, or check Razorpay dashboard.'
                    ),
                )
            else:
                # Failed or unknown
                bank.verification_status = DocumentVerificationStatus.REJECTED
                db.session.commit()
                failure = validation.get('failure_reason', 'unknown')
                return error_response(
                    f'Razorpay bank validation failed (status: {val_status}). '
                    f'Reason: {failure}. The account may have incorrect details.',
                )

        except Exception as e:
            logger.exception(f"[BANK] Razorpay validation error for bank={bank_id}: {e}")
            error_msg = str(e)
            # Parse Razorpay error body if present
            if hasattr(e, 'args') and e.args:
                try:
                    if isinstance(e.args[0], dict):
                        err_body = e.args[0]
                        desc = err_body.get('error', {}).get('description', str(e))
                        error_msg = desc
                    else:
                        error_msg = str(e.args[0])
                except Exception:
                    pass
            return error_response(f'Razorpay API error: {error_msg}', status_code=400)

    # ── Manual Verify (admin override — use with caution) ──
    elif action == 'manual_verify':
        bank.verification_status = DocumentVerificationStatus.VERIFIED
        db.session.commit()
        logger.info(f"[BANK] Account {bank_id} MANUALLY verified by admin={current_user.id} for doctor={doctor_id}")
        return success_response(
            data=_bank_account_detail(bank),
            message='Bank account manually verified by admin (no Razorpay validation)',
        )

    # ── Reject ──
    elif action == 'reject':
        bank.verification_status = DocumentVerificationStatus.REJECTED
        db.session.commit()
        reason = data.get('reason', '')
        logger.info(f"[BANK] Account {bank_id} rejected by admin={current_user.id} for doctor={doctor_id}: {reason}")
        return success_response(
            data=_bank_account_detail(bank),
            message=f'Bank account rejected. {reason}',
        )

    # ── Remove Cashfree payout beneficiary (bank change / offboarding) ──
    # ── Suspend: detach from Cashfree, keep the account so it can be
    #    re-verified later (bank details changed, re-run the penny drop, …).
    elif action == 'remove_beneficiary':
        from app.api.common.payment import beneficiary_service as bene
        bene.remove_beneficiary(bank)
        db.session.commit()
        logger.info(f"[BANK] Beneficiary suspended for account {bank_id} by admin={current_user.id} for doctor={doctor_id}")
        return success_response(
            data=_bank_account_detail(bank),
            message='Payout beneficiary suspended. The account must be re-verified before payouts.',
        )

    # ── Remove: detach from Cashfree AND delete the account row entirely.
    #    Payouts are held until the doctor adds + verifies a new account.
    elif action == 'remove_account':
        from app.api.common.payment import beneficiary_service as bene
        from app.models import DoctorPayout

        # Detach at Cashfree first (best-effort; safe when nothing is registered).
        bene.remove_beneficiary(bank)

        # DoctorPayout.bank_account_id has no ON DELETE rule, so a referencing
        # payout would block the delete with an FK violation. Clear the link —
        # the payout keeps its bill number, amounts and transfer id for audit.
        unlinked = DoctorPayout.query.filter_by(
            tenant_id=bank.tenant_id, bank_account_id=bank.id,
        ).update({'bank_account_id': None}, synchronize_session=False)

        db.session.delete(bank)
        db.session.commit()
        logger.info(
            f"[BANK] Account {bank_id} REMOVED (row deleted, {unlinked} payout(s) unlinked) "
            f"by admin={current_user.id} for doctor={doctor_id}"
        )
        msg = 'Bank account removed from Cashfree and deleted.'
        if unlinked:
            msg += f' {unlinked} past payout record(s) kept for audit with the bank link cleared.'
        msg += ' Payouts are on hold until the doctor adds and verifies a new account.'
        return success_response(message=msg)

    else:
        return error_response(
            f'Invalid action: {action}. Use "validate" (penny drop), '
            '"manual_verify" (admin override), "reject", '
            '"remove_beneficiary" (suspend), or "remove_account" (delete)'
        )


# --- Analytics ---

@admin_bp.route('/dashboard', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_dashboard():
    """Get admin dashboard stats."""
    # TODO: Implement
    return jsonify({'success': False, 'error': 'Not implemented'}), 501


# --------------------------------------------------------------------------- #
# Admin / Platform-owner invite flows (Round 9 — admin tooling)
# --------------------------------------------------------------------------- #
# Mirror of the facility ``/affiliation/facility/doctors/invite`` route,
# but callable by tenant SUPER_ADMIN or PLATFORM_OWNER instead of a
# hospital/clinic admin. Lets the operator add doctors and patients
# directly to their tenant roster without going through the public
# signup form. The invitee gets the same activation link + email +
# SMS as the facility flow — they set their own password and verify
# both contacts before they can sign in.
# --------------------------------------------------------------------------- #

@admin_bp.route('/doctors/invite', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER])
@feature_required('admin.invite_doctor')
@permission_required(AdminPermission.INVITE_DOCTORS)
def admin_invite_doctor():
    """Tenant admin invites a doctor onto their roster.

    Multipart form data (same shape as facility invite):
      first_name, last_name, email, phone_number, state,
      registration_number, aadhar_number,
      qualifications (JSON string),
      files: registration_certificate, aadhar_attachment,
             qualification_certificate_<i>
    """
    from app.api.affiliation.service import (
        AffiliationService, AffiliationError, AffiliationForbidden,
    )
    from app.api.affiliation.routes import _save_upload
    import json

    try:
        form = request.form
        if not form:
            return error_response(
                'Multipart form data required.', status_code=400,
            )

        qualifications = form.get('qualifications', '[]')
        try:
            qualifications = json.loads(qualifications)
        except json.JSONDecodeError:
            return error_response(
                'qualifications must be valid JSON.', status_code=400,
            )

        data = {
            'first_name': form.get('first_name'),
            'last_name': form.get('last_name'),
            'email': form.get('email'),
            'phone_number': form.get('phone_number'),
            'state': form.get('state'),
            'registration_number': form.get('registration_number'),
            'aadhar_number': form.get('aadhar_number'),
            'qualifications': qualifications,
        }

        files = request.files
        reg_cert = _save_upload(
            files.get('registration_certificate'), prefix='regcert',
        )
        aadhar = _save_upload(
            files.get('aadhar_attachment'), prefix='aadhar',
        )
        if not reg_cert:
            return error_response(
                'registration_certificate file is required.',
                status_code=400,
            )
        if not aadhar:
            return error_response(
                'aadhar_attachment file is required.', status_code=400,
            )

        qual_paths: list[str] = []
        i = 0
        while True:
            f = files.get(f'qualification_certificate_{i}')
            if f is None:
                break
            qual_paths.append(_save_upload(f, prefix=f'ugcert_{i}') or '')
            i += 1

        file_paths = {
            'registration_certificate': reg_cert,
            'aadhar_attachment': aadhar,
            'qualification_certificates': qual_paths,
        }

        result = AffiliationService.admin_invite_doctor(
            current_user, data, file_paths,
        )
        return success_response(
            result,
            message='Doctor invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden) as e:
        return error_response(str(e), status_code=400)


@admin_bp.route('/patients/invite', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER])
@feature_required('admin.invite_patient')
@permission_required(AdminPermission.INVITE_PATIENTS)
def admin_invite_patient():
    """Tenant admin invites a patient onto their roster.

    JSON body:
      {
        "first_name": "...", "last_name": "...",
        "email": "...", "phone_number": "...",
        "dob": "1990-01-01"  (optional, ISO date),
        "gender": "M" / "F"   (optional)
      }
    """
    from app.api.affiliation.service import (
        AffiliationService, AffiliationError, AffiliationForbidden,
    )

    data = request.get_json(silent=True) or {}
    try:
        result = AffiliationService.admin_invite_patient(current_user, data)
        return success_response(
            result,
            message='Patient invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden) as e:
        return error_response(str(e), status_code=400)


def _facility_invite_form_to_data(form):
    """Pull the shared facility fields out of a multipart form into a
    dict the service layer accepts. Used by both invite-hospital and
    invite-clinic routes."""
    return {
        'first_name': form.get('first_name'),
        'last_name': form.get('last_name'),
        'email': form.get('email'),
        'phone_number': form.get('phone_number'),
        'state': form.get('state'),
        'name': form.get('name'),
        'registration_number': form.get('registration_number'),
        'address': form.get('address'),
        'city': form.get('city'),
        'pincode': form.get('pincode'),
        'phone': form.get('phone'),
        'website': form.get('website'),
        # Optional plan attached to the new facility's
        # TenantSubscription / MembershipPlan. ``None`` means the
        # operator didn't pick a plan — facility lands without a
        # marketplace tier (existing public signup behaves the same).
        'plan_code': (form.get('plan_code') or '').strip() or None,
        # Hospital-only — ignored by the clinic branch.
        'hospital_type': form.get('hospital_type'),
    }


def _facility_invite_files():
    """Load + persist the two required facility-signup files."""
    from app.api.affiliation.routes import _save_upload
    files = request.files
    reg_cert = _save_upload(
        files.get('registration_certificate'), prefix='regcert',
    )
    aadhar = _save_upload(
        files.get('admin_aadhaar_attachment'), prefix='admin_aadhaar',
    )
    return {
        'registration_certificate': reg_cert,
        'admin_aadhaar_attachment': aadhar,
    }, reg_cert, aadhar


@admin_bp.route('/hospitals/invite', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER])
@feature_required('admin.invite_hospital')
@permission_required(AdminPermission.INVITE_HOSPITALS)
def admin_invite_hospital():
    """Tenant admin invites a hospital onto their tenant.

    Multipart form data (same field shape as the public hospital
    signup, plus optional ``plan_code`` for marketplace attachment):
      first_name, last_name, email, phone_number, state,
      name (hospital name), registration_number, hospital_type,
      address, city, pincode, phone (facility phone), website,
      plan_code (optional marketplace plan to attach),
      files: registration_certificate, admin_aadhaar_attachment
    """
    from app.api.affiliation.service import (
        AffiliationService, AffiliationError, AffiliationForbidden,
    )

    try:
        form = request.form
        if not form:
            return error_response(
                'Multipart form data required.', status_code=400,
            )
        data = _facility_invite_form_to_data(form)
        file_paths, reg_cert, aadhar = _facility_invite_files()
        if not reg_cert:
            return error_response(
                'registration_certificate file is required.',
                status_code=400,
            )
        if not aadhar:
            return error_response(
                'admin_aadhaar_attachment file is required.',
                status_code=400,
            )

        result = AffiliationService.admin_invite_hospital(
            current_user, data, file_paths,
        )
        return success_response(
            result,
            message='Hospital invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden) as e:
        return error_response(str(e), status_code=400)


@admin_bp.route('/clinics/invite', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER])
@feature_required('admin.invite_clinic')
@permission_required(AdminPermission.INVITE_CLINICS)
def admin_invite_clinic():
    """Tenant admin invites a clinic onto their tenant.

    Same multipart payload shape as ``admin_invite_hospital``,
    minus the hospital-only ``hospital_type`` field.
    """
    from app.api.affiliation.service import (
        AffiliationService, AffiliationError, AffiliationForbidden,
    )

    try:
        form = request.form
        if not form:
            return error_response(
                'Multipart form data required.', status_code=400,
            )
        data = _facility_invite_form_to_data(form)
        file_paths, reg_cert, aadhar = _facility_invite_files()
        if not reg_cert:
            return error_response(
                'registration_certificate file is required.',
                status_code=400,
            )
        if not aadhar:
            return error_response(
                'admin_aadhaar_attachment file is required.',
                status_code=400,
            )

        result = AffiliationService.admin_invite_clinic(
            current_user, data, file_paths,
        )
        return success_response(
            result,
            message='Clinic invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden) as e:
        return error_response(str(e), status_code=400)
