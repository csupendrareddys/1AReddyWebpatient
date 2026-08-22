"""
Patient Routes
API endpoints for patient-related operations
"""
import logging
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from app.api.service_reciever.patient import patient_bp
from app.api.service_reciever.patient.service import (
    PatientService, DoctorListService, SymptomService,
    PlatformService, PatientOrderService, RatingService, DocumentService,
    HouseGroupService, OTPService, HealthRecordService, HouseGroupRequestService
)
from app.common.decorators import feature_required, role_required
from app.common.responses import (
    success_response, error_response, paginated_response,
    not_found_response, validation_error_response, created_response,
    forbidden_response,
)
from app.extensions import db, limiter
from app.models import UserRole, Doctor, ProfileEducationSpecialization, Category, Gender

logger = logging.getLogger(__name__)


def _enrich_attachments(record_dict, key='attachment_links'):
    """Add presigned S3 URLs to attachment entries in a record dict."""
    from app.services.s3_service import S3Service
    for att in (record_dict.get(key) or []):
        att['url'] = S3Service.get_signed_url(att.get('s3_key')) or ''
    return record_dict


@patient_bp.after_request
def _stamp_profile_provenance(response):
    """Record who last edited this patient's profile, after a successful write.

    One hook instead of a ``stamp_profile_update`` call in each of the ~25
    write paths (profile sections, vitals, habits, surgeries, health records,
    attachments, house group) — those live across three service classes and a
    new one would be easy to forget.

    Only fires for requests this blueprint handled, so it does NOT double-fire
    for admin act-on-behalf writes: those are handled by the Operations
    blueprint, which stamps with the real admin as the actor. Best-effort —
    never converts a saved change into an error response.
    """
    from flask import request as _req
    from app.common.profile_audit import (
        PROFILE_WRITE_ENDPOINTS, ENDPOINT_SECTION,
        stamp_profile_update, stamp_section_update,
    )

    if (
        _req.method == 'GET'
        or response.status_code >= 400
        or _req.endpoint not in PROFILE_WRITE_ENDPOINTS
    ):
        return response
    try:
        patient = PatientService.get_by_user_id(current_user.id)
        stamp_profile_update(patient, commit=False)
        section = ENDPOINT_SECTION.get(_req.endpoint)
        if section:
            stamp_section_update(patient, section, commit=False)
        db.session.commit()
    except Exception:  # noqa: BLE001
        logger.exception('[PROFILE_AUDIT] after_request stamp failed')
    return response


# --- Public Routes ---

@patient_bp.route('/doctors', methods=['GET'])
def get_doctors():
    """
    Get list of doctors with optional filters.
    
    Query params:
        - specialization: Filter by specialization
        - city: Filter by city
        - search: Search by name
        - page: Page number (default 1)
        - per_page: Results per page (default 20)
    """
    specialization = request.args.get('specialization')
    city = request.args.get('city')
    search = request.args.get('search')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    logger.debug(f"[PATIENT:DOCTORS] page={page}, spec={specialization}, city={city}, search={search}")
    
    # Limit per_page
    per_page = min(per_page, 100)
    
    pagination = DoctorListService.get_doctors(
        specialization=specialization,
        city=city,
        search=search,
        page=page,
        per_page=per_page
    )
    
    doctors = [
        DoctorListService.format_doctor_for_list(doctor)
        for doctor in pagination.items
    ]
    
    return success_response(data={
        'doctors': doctors,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/doctors/<doctor_id>', methods=['GET'])
def get_doctor_detail(doctor_id):
    """Get detailed information about a specific doctor."""
    doctor = DoctorListService.get_doctor_detail(doctor_id)
    
    if not doctor:
        return not_found_response('Doctor')
    
    return success_response(data=DoctorListService.format_doctor_for_list(doctor))


@patient_bp.route('/symptoms', methods=['GET'])
def get_symptoms():
    """
    Get list of all active symptoms.
    
    Query params:
        - category: Filter by symptom category
    """
    category = request.args.get('category')
    
    symptoms = SymptomService.get_all_symptoms(category=category)
    
    return success_response(data={
        'symptoms': [symptom.to_dict() for symptom in symptoms],
        'categories': SymptomService.get_symptom_categories()
    })


@patient_bp.route('/platforms', methods=['GET'])
def get_platforms():
    """Get list of available consultation platforms/services."""
    platforms = PlatformService.get_platforms()
    
    return success_response(data={
        'platforms': platforms
    })


# --- Authenticated Patient Routes ---

@patient_bp.route('/profile', methods=['GET'])
@jwt_required()
@feature_required('patient.basic_info')
@role_required(UserRole.PATIENT)
def get_profile():
    """Get current patient's profile. Creates one if it doesn't exist."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        # Auto-create patient profile for existing users who don't
        # have one. Post-schema-split, Patient no longer carries
        # first_name/last_name — those live on User; the
        # ``Patient.user`` relationship reads them off the linked
        # row. We DO need to populate ``tenant_id`` explicitly though
        # — TenantMixin makes it NOT NULL but doesn't auto-fill from
        # ``g.tenant_id`` at INSERT time, so a bare ``Patient(user_id=...)``
        # raises ``IntegrityError: tenant_id null`` on commit.
        from app.models import Patient
        from app.extensions import db

        patient = Patient(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
        )
        db.session.add(patient)
        db.session.commit()
        logger.debug(f"[PATIENT:PROFILE] Auto-created Patient profile for user={current_user.id}")
    
    return success_response(data=patient.to_dict(include_user=True))


@patient_bp.route('/profile', methods=['PUT'])
@jwt_required()
@feature_required('patient.basic_info')
@role_required(UserRole.PATIENT)
def update_profile():
    """Update current patient's profile."""
    data = request.get_json()
    logger.debug(f"[PATIENT:UPDATE_PROFILE] user_id={current_user.id}, keys={list(data.keys()) if data else None}")
    
    if not data:
        return error_response('Request body required')
    
    try:
        patient = PatientService.update_profile(current_user.id, data)
        
        if not patient:
            return not_found_response('Patient profile')
        
        return success_response(data=patient.to_dict(), message='Profile updated successfully')
    except ValueError as e:
        return error_response(str(e), status_code=400)


@patient_bp.route('/profile/last-update', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_profile_last_update():
    """Who last changed this profile, and when — for accountability.

    Both write surfaces stamp ``Patient.profile_updated_*``; this reads it back
    and classifies the actor as ``owner`` (the patient's own account), ``linked``
    (a family member acting on their behalf), ``staff`` (a support-staff
    caregiver), ``admin`` or ``doctor``. Reached through the act-on-behalf proxy
    too, where ``current_user`` is the patient being managed — so a caregiver or
    a linked adult sees exactly what the patient sees, which is the point.
    """
    from app.common.profile_audit import describe_last_update
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    return success_response(data=describe_last_update(patient))


@patient_bp.route('/profile/section-updates', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_profile_section_updates():
    """Per-section 'who last changed this', for the profile page.

    A map keyed by section (personal_details, vitals, insurance, …), each with
    the actor classified owner / linked / staff / admin / doctor. Reached through
    the act proxy too, so a caregiver or linked adult sees the same per-section
    accountability the patient does.
    """
    from app.common.profile_audit import describe_section_updates
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    return success_response(data=describe_section_updates(patient))


# ── Section-specific Profile Endpoints ──────────────────────────────────

@patient_bp.route('/profile/personal-details', methods=['GET'])
@jwt_required()
@feature_required('patient.basic_info')
@role_required(UserRole.PATIENT)
def get_personal_details():
    """Get only personal details section.

    Name / gender / dob / profile_image were moved from Patient → User
    by the schema split — read those off ``patient.user``. Reading
    them off ``patient`` raises AttributeError (the columns are gone)
    and 500s the entire request.
    ``blood_group`` and ``languages_known`` are STILL on Patient.
    """
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    u = patient.user
    data = {
        'first_name': u.first_name if u else None,
        'middle_name': u.middle_name if u else None,
        'last_name': u.last_name if u else None,
        'gender': u.gender.value if u and u.gender else None,
        'dob': u.dob.isoformat() if u and u.dob else None,
        'profile_image': u.profile_image if u else None,
        'blood_group': patient.blood_group.value if patient.blood_group else None,
        'languages_known': patient.languages_known,
    }
    return success_response(data=data)


@patient_bp.route('/profile/personal-details', methods=['PUT'])
@jwt_required()
@feature_required('patient.basic_info')
@role_required(UserRole.PATIENT)
def update_personal_details():
    """Update only personal details section."""
    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    allowed = ['first_name', 'middle_name', 'last_name', 'gender', 'dob', 'blood_group', 'profile_image', 'languages_known']
    filtered = {k: v for k, v in req_data.items() if k in allowed}
    try:
        patient = PatientService.update_profile(current_user.id, filtered)
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': list(filtered.keys())}, message='Personal details updated')
    except ValueError as e:
        return error_response(str(e))
    except Exception as exc:  # noqa: BLE001 — surface unexpected failures
        # Without this catch the route 500s with no clue what went
        # wrong (RLS, FK constraint, dirty session, encryption error).
        # Log the traceback and return the real error so the operator
        # can fix it instead of guessing.
        from flask import current_app as _ca
        _ca.logger.exception(
            '[PATIENT] update_personal_details failed user=%s', current_user.id,
        )
        try:
            from app.extensions import db as _db
            _db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return error_response(f'Failed to update personal details: {exc}', status_code=500)


@patient_bp.route('/profile/contact-identity', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_contact_identity():
    """Get contact & identity section."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    data = {
        'phone_number': patient.user.phone_number if patient.user else '',
        'alternative_phone': patient.alternative_phone,
        'email': patient.user.email if patient.user else '',
        'alternative_email': patient.alternative_email,
        'aadhar_number': patient.aadhar_number,
        'pan_number': patient.pan_number,
        'religion': patient.religion,
        'caste': patient.caste,
        'citizenship': patient.citizenship,
    }
    return success_response(data=data)


@patient_bp.route('/profile/contact-identity', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_contact_identity():
    """Update contact & identity section."""
    from app.api.admin.operations.act_on_behalf import ops_acting_on_behalf

    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    allowed = ['alternative_phone', 'alternative_email', 'aadhar_number', 'pan_number', 'religion', 'caste', 'citizenship']
    # Patients must go through the OTP flow to change their login phone/email,
    # so those stay read-only here. A super-admin acting on behalf from
    # Operations is the IT-support fix-up path (wrong number at signup) and may
    # set them directly — PatientService.update_profile still runs the
    # tenant-scoped uniqueness check. Same allowance the pre-existing
    # ``/operations/patients/<id>/profile/contact-identity`` editor had.
    if ops_acting_on_behalf():
        allowed += ['phone_number', 'email']
    filtered = {k: v for k, v in req_data.items() if k in allowed}
    try:
        patient = PatientService.update_profile(current_user.id, filtered)
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': list(filtered.keys())}, message='Contact & identity updated')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/profile/address', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_address():
    """Get address section."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    addr = patient.address_details or {}
    data = {
        'address_line1': addr.get('address_line1', ''),
        'address_line2': addr.get('address_line2', ''),
        'city': addr.get('city', ''),
        'state': addr.get('state', ''),
        'pincode': addr.get('pincode', ''),
        'country': addr.get('country', 'India'),
    }
    return success_response(data=data)


@patient_bp.route('/profile/address', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_address():
    """Update address section."""
    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    allowed_keys = ['address_line1', 'address_line2', 'city', 'state', 'pincode', 'country']
    address_data = {k: v for k, v in req_data.items() if k in allowed_keys}
    try:
        patient = PatientService.update_profile(current_user.id, {'address_details': address_data})
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': list(address_data.keys())}, message='Address updated')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/profile/emergency-contact', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_emergency_contact():
    """Get emergency contact section."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    data = {
        'emergency_contact_name': patient.emergency_contact_name,
        'emergency_contact_phone': patient.emergency_contact_phone,
        'emergency_contact_relation': patient.emergency_contact_relation,
    }
    return success_response(data=data)


@patient_bp.route('/profile/emergency-contact', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_emergency_contact():
    """Update emergency contact section."""
    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    allowed = ['emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation']
    filtered = {k: v for k, v in req_data.items() if k in allowed}
    try:
        patient = PatientService.update_profile(current_user.id, filtered)
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': list(filtered.keys())}, message='Emergency contact updated')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/profile/insurance', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_insurance():
    """Get insurance section."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    data = {
        'insurance_provider': patient.insurance_provider,
        'insurance_policy_number': patient.insurance_policy_number,
    }
    return success_response(data=data)


@patient_bp.route('/profile/insurance', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_insurance():
    """Update insurance section."""
    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    allowed = ['insurance_provider', 'insurance_policy_number']
    filtered = {k: v for k, v in req_data.items() if k in allowed}
    try:
        patient = PatientService.update_profile(current_user.id, filtered)
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': list(filtered.keys())}, message='Insurance updated')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/profile/female-health', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_female_health():
    """Get female health section."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    fh = patient.female_health_details or {}
    # ``gender`` lives on User post-split — same fix as the
    # personal-details GET above.
    u = patient.user
    data = {
        'gender': u.gender.value if u and u.gender else None,
        'lmp_date': fh.get('lmp_date'),
        'lmp_remarks': fh.get('lmp_remarks', ''),
        'pregnancy_status': fh.get('pregnancy_status', ''),
        'pregnancy_remarks': fh.get('pregnancy_remarks', ''),
    }
    return success_response(data=data)


@patient_bp.route('/profile/female-health', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_female_health():
    """Update female health section."""
    req_data = request.get_json()
    if not req_data:
        return error_response('Request body required')
    try:
        patient = PatientService.update_profile(current_user.id, {'female_health_details': req_data})
        if not patient:
            return not_found_response('Patient profile')
        return success_response(data={'updated': ['female_health_details']}, message='Female health updated')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def get_house_group_members():
    """Get all house group members."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    members = HouseGroupService.get_members(patient.id)
    
    return success_response(data={
        'members': [member.to_dict() for member in members]
    })


@patient_bp.route('/house-group', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def add_house_group_member():
    """Add a new house group member."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    data = request.get_json()
    
    if not data or not data.get('first_name') or not data.get('relation'):
        return error_response('First name and relation are required')
    
    member = HouseGroupService.add_member(patient.id, data)

    return created_response(data=member.to_dict(), message='Family member added successfully')


@patient_bp.route('/family/minors', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def list_minors():
    """The guardian's minor sub-profiles (login-less managed patients)."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    minors = HouseGroupService.get_minors(patient.id)
    return success_response(data={'minors': [m.to_dict() for m in minors]})


@patient_bp.route('/family/minors', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def create_minor():
    """Create a MINOR sub-profile: a credential-less Patient the guardian
    switches into. Guardian-only."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    data = request.get_json() or {}
    if not data.get('first_name'):
        return error_response('First name is required')
    from app.api.patient_family.quota import assert_quota_available, PatientQuotaExceeded
    try:
        assert_quota_available(patient, 'minors')
    except PatientQuotaExceeded as e:
        return error_response(str(e), status_code=403)
    member, minor = HouseGroupService.add_minor(patient, data)
    out = member.to_dict()
    out['minor_patient_id'] = str(minor.id)
    return created_response(data=out, message='Minor profile created')


@patient_bp.route('/family/<member_id>/act/<path:subpath>',
                  methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def family_act_on_behalf(member_id, subpath):
    """Act on a family member's behalf. Two cases, one route:

      * a GUARDIAN operating their own MINOR sub-profile — full access; and
      * a LINKED ADULT operating a patient who granted them a role — bounded by
        that role (GET needs ``view``, writes need ``manage``; fail closed).

    Both run one patient self-service endpoint AS the target, reusing the exact
    act-on-behalf machinery + patient allowlist as Operations
    (`_proxy`/`_COMPILED_PATHS`) — no per-route forking, and money/OTP paths stay
    off the allowlist."""
    from app.models import HouseGroupMember, Patient as _Patient
    from app.api.admin.operations.act_on_behalf import (
        _proxy, _COMPILED_PATHS, _COMPILED_MINOR_PATHS,
    )

    caller = PatientService.get_by_user_id(current_user.id)
    if not caller:
        return not_found_response('Patient profile')
    member = HouseGroupMember.query.filter_by(id=member_id, is_active=True).first()
    if not member:
        return not_found_response('Family member')

    # Case 1 — guardian acting on their OWN minor (full access).
    if member.is_child_account and str(member.patient_id) == str(caller.id):
        if not member.linked_patient_id:
            return not_found_response('Minor profile')
        minor = _Patient.query.get(member.linked_patient_id)
        if not minor:
            return not_found_response('Minor profile')
        # The guardian runs the FULL minor replica (profile / prescriptions /
        # service chats / contact-OTP), so the minor gets the extended allowlist.
        return _proxy(minor, 'patient', 'Minor', _COMPILED_MINOR_PATHS, subpath,
                      stamp_provenance=True)

    # Case 2 — a linked ADULT acting on the patient who granted them a role.
    # The member row belongs to that patient (``patient_id``) and lists the
    # caller as the linked person (``linked_user_id``); its ``role_id`` bounds
    # what the caller may do.
    if (not member.is_child_account and member.role_id
            and str(member.linked_user_id) == str(current_user.id)):
        from app.api.patient_family.service import PatientRoleService
        from app.api.patient_family.rules import linked_adult_allowed
        grants = PatientRoleService.effective_for_member(member)
        if not linked_adult_allowed(subpath, request.method, grants):
            return forbidden_response('Your role does not permit this action.')
        owner = _Patient.query.get(member.patient_id)
        if not owner:
            return not_found_response('Patient profile')
        return _proxy(owner, 'patient', 'Family member', _COMPILED_PATHS, subpath,
                      stamp_provenance=True)

    return not_found_response('Family member')


@patient_bp.route('/house-group/<member_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def update_house_group_member(member_id):
    """Update a house group member."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    data = request.get_json()
    
    member = HouseGroupService.update_member(member_id, patient.id, data)
    
    if not member:
        return not_found_response('Family member')
    
    return success_response(data=member.to_dict(), message='Family member updated successfully')


@patient_bp.route('/house-group/<member_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def delete_house_group_member(member_id):
    """Delete a house group member."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    member = HouseGroupService.delete_member(member_id, patient.id)
    
    if not member:
        return not_found_response('Family member')
    
    return success_response(message='Family member deleted successfully')


# --- OTP Routes for Phone/Email Change ---

@patient_bp.route('/send-otp', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def send_otp():
    """Send an OTP to the patient's NEW phone/email to verify a contact change.

    Request body: ``identifier`` (the new value), ``purpose``
    ('phone_change' | 'email_change'). Delivers a real SMS/email and guards
    per-tenant uniqueness before sending.
    """
    from app.services.contact_change_service import ContactChangeService
    data = request.get_json() or {}
    identifier = data.get('identifier')
    purpose = data.get('purpose')
    if not identifier or purpose not in ('phone_change', 'email_change'):
        return error_response('identifier and a valid purpose are required')
    channel = 'phone' if purpose == 'phone_change' else 'email'
    try:
        ContactChangeService.send_otp(current_user, channel, identifier)
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(message=f'A verification code was sent to {identifier}.')


@patient_bp.route('/verify-and-update', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def verify_and_update():
    """Verify the OTP and apply the patient's new phone/email IMMEDIATELY
    (patients don't need admin approval). Request body: ``identifier``, ``otp``,
    ``purpose`` ('phone_change' | 'email_change')."""
    from app.services.contact_change_service import ContactChangeService
    from app.extensions import db

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient or not patient.user:
        return not_found_response('Patient profile')

    data = request.get_json() or {}
    identifier = data.get('identifier')
    otp = data.get('otp')
    purpose = data.get('purpose')
    if not identifier or not otp or purpose not in ('phone_change', 'email_change'):
        return error_response('identifier, otp and a valid purpose are required')
    channel = 'phone' if purpose == 'phone_change' else 'email'

    if not ContactChangeService.verify_otp(channel, identifier, otp):
        return error_response('Invalid or expired OTP', status_code=400)

    # Re-check uniqueness at apply time (guards a race between send and verify).
    try:
        ContactChangeService.assert_unique(patient.user, channel, identifier)
    except ValueError as e:
        return error_response(str(e), status_code=400)

    normalized = ContactChangeService.normalize(channel, identifier)
    if channel == 'phone':
        patient.user.phone_number = normalized
    else:
        patient.user.email = normalized
    db.session.commit()

    return success_response(
        data=patient.to_dict(),
        message=f'Your {"phone number" if channel == "phone" else "email"} has been updated.',
    )
# --- Order Routes ---

@patient_bp.route('/orders/upcoming', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_upcoming_orders():
    """
    Get upcoming orders/appointments for current patient.
    
    Query params:
        - page: Page number (default 1)
        - per_page: Results per page (default 20)
    """
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    per_page = min(per_page, 100)
    
    pagination = PatientOrderService.get_upcoming_orders(
        patient_id=patient.id,
        page=page,
        per_page=per_page
    )
    
    orders = [
        PatientOrderService.format_order(appointment)
        for appointment in pagination.items
    ]
    
    return success_response(data={
        'orders': orders,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/orders/previous', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_previous_orders():
    """
    Get previous/completed orders/appointments for current patient.
    
    Query params:
        - page: Page number (default 1)
        - per_page: Results per page (default 20)
    """
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    per_page = min(per_page, 100)
    
    pagination = PatientOrderService.get_previous_orders(
        patient_id=patient.id,
        page=page,
        per_page=per_page
    )
    
    orders = [
        PatientOrderService.format_order(appointment)
        for appointment in pagination.items
    ]
    
    return success_response(data={
        'orders': orders,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/orders/<order_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_order_detail(order_id):
    """Get detailed information about a specific order."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    order = PatientOrderService.get_order_by_id(order_id, patient.id)
    
    if not order:
        return not_found_response('Order')
    
    return success_response(data=PatientOrderService.format_order(order))


# --- Rating Routes ---

@patient_bp.route('/orders/<order_id>/rating', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_order_rating(order_id):
    """Get rating for a specific order."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    order = PatientOrderService.get_order_by_id(order_id, patient.id)
    
    if not order:
        return not_found_response('Order')
    
    rating = RatingService.get_rating(order_id)
    
    if not rating:
        return success_response(data={'rating': None}, message='No rating found for this order')
    
    return success_response(data={'rating': rating.to_dict()})


@patient_bp.route('/orders/<order_id>/rating', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def submit_order_rating(order_id):
    """
    Submit rating for an order.
    
    Request body:
        - rating: Required, integer 1-5
        - review: Optional, string
        - is_anonymous: Optional, boolean (default false)
    """
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    order = PatientOrderService.get_order_by_id(order_id, patient.id)
    
    if not order:
        return not_found_response('Order')
    
    data = request.get_json()
    
    if not data:
        return error_response('Request body required')
    
    # Validate rating
    rating_value = data.get('rating')
    if not rating_value:
        return validation_error_response({'rating': 'Rating is required'})
    
    try:
        rating_value = int(rating_value)
        if rating_value < 1 or rating_value > 5:
            raise ValueError()
    except (ValueError, TypeError):
        return validation_error_response({'rating': 'Rating must be an integer between 1 and 5'})
    
    rating, error = RatingService.create_rating(
        appointment_id=order_id,
        rating=rating_value,
        review=data.get('review'),
        is_anonymous=data.get('is_anonymous', False)
    )
    
    if error:
        return error_response(error, status_code=409)
    
    return created_response(data=rating.to_dict(), message='Rating submitted successfully')


# --- Document Routes ---

@patient_bp.route('/orders/<order_id>/documents', methods=['GET'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def get_order_documents(order_id):
    """Get all documents for a specific order."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    order = PatientOrderService.get_order_by_id(order_id, patient.id)
    
    if not order:
        return not_found_response('Order')
    
    documents = DocumentService.get_documents(order_id)
    
    return success_response(data={
        'documents': [doc.to_dict() for doc in documents]
    })


@patient_bp.route('/orders/<order_id>/documents', methods=['POST'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def add_order_document(order_id):
    """
    Add a document to an order.
    
    Request body:
        - document_name: Required, string
        - attachment_link: Required, string (URL to document)
        - description: Optional, string
        - document_type: Optional, string (report, prescription, lab_result, etc.)
    """
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    order = PatientOrderService.get_order_by_id(order_id, patient.id)
    
    if not order:
        return not_found_response('Order')
    
    data = request.get_json()
    
    if not data:
        return error_response('Request body required')
    
    # Validate required fields
    errors = {}
    if not data.get('document_name'):
        errors['document_name'] = 'Document name is required'
    if not data.get('attachment_link'):
        errors['attachment_link'] = 'Attachment link is required'
    
    if errors:
        return validation_error_response(errors)
    
    document = DocumentService.add_document(
        appointment_id=order_id,
        document_name=data['document_name'],
        attachment_link=data['attachment_link'],
        uploaded_by='patient',
        description=data.get('description'),
        document_type=data.get('document_type')
    )
    
    return created_response(data=document.to_dict(), message='Document added successfully')


@patient_bp.route('/appointments/<appointment_id>/documents/upload', methods=['POST'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def upload_appointment_document(appointment_id):
    """Attach a document FILE to an appointment (e.g. during a video/audio call).

    Multipart ``file`` upload — mirrors the service-channel document upload so
    the in-call Documents panel behaves the same for consultancy and services.
    (``add_order_document`` above takes a pre-uploaded ``attachment_link``; this
    handles the S3 upload itself.)
    """
    from app.services.s3_service import S3Service

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')
    order = PatientOrderService.get_order_by_id(appointment_id, patient.id)
    if not order:
        return not_found_response('Appointment')

    if 'file' not in request.files:
        return error_response('No file provided', status_code=400)
    file_obj = request.files['file']
    if not file_obj.filename:
        return error_response('Empty filename', status_code=400)

    try:
        result = S3Service.upload_file(
            file_obj=file_obj,
            asset_type='appointment-document',
            original_filename=file_obj.filename,
            is_private=True,
            folder=f'appointments/{appointment_id}/documents',
        )
    except Exception as e:
        logger.error(f'S3 upload failed for appointment document: {e}')
        return error_response('File upload failed', status_code=500)

    link = S3Service.get_signed_url(result['s3_key']) or result['s3_key']
    document = DocumentService.add_document(
        appointment_id=appointment_id,
        document_name=file_obj.filename,
        attachment_link=link,
        uploaded_by='patient',
        description=request.form.get('description'),
    )
    return created_response(data=document.to_dict(), message='Document attached')


# --- Health Records Routes (keeping existing placeholder) ---

@patient_bp.route('/health-records', methods=['GET'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def get_health_records():
    """Get patient's health records."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    record_type = request.args.get('record_type')
    
    pagination = PatientService.get_health_records(
        patient_id=patient.id,
        record_type=record_type,
        page=page,
        per_page=per_page
    )
    
    return success_response(data={
        'health_records': [_enrich_attachments(record.to_dict()) for record in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/health-records', methods=['POST'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def add_health_record():
    """
    Add a new health record.

    Request body:
        - record_type: Required (vitals, lab_report, imaging, surgery_record, allergy, etc.)
        - record_date: Required (YYYY-MM-DD)
        - details: Required (JSON object with type-specific data)
        - notes: Optional
        - attachment_links: Optional (list of URLs)
    """
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    errors = {}
    if not data.get('record_type'):
        errors['record_type'] = 'Record type is required'
    if not data.get('record_date'):
        errors['record_date'] = 'Record date is required'
    if not data.get('details'):
        errors['details'] = 'Details are required'
    if errors:
        return validation_error_response(errors)

    record = HealthRecordService.create_record(patient.id, current_user.id, data)
    return created_response(data=record.to_dict(), message='Health record added successfully')


@patient_bp.route('/health-records/<record_id>', methods=['GET'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def get_health_record(record_id):
    """Get a specific health record."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    record = HealthRecordService.get_record(record_id, patient.id)
    if not record:
        return not_found_response('Health record')

    return success_response(data=record.to_dict())


@patient_bp.route('/health-records/<record_id>', methods=['PUT'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def update_health_record(record_id):
    """Update a health record."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    record = HealthRecordService.update_record(record_id, patient.id, data)
    if not record:
        return not_found_response('Health record')

    return success_response(data=record.to_dict(), message='Health record updated successfully')


@patient_bp.route('/health-records/<record_id>', methods=['DELETE'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def delete_health_record(record_id):
    """Soft-delete a health record."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    record = HealthRecordService.delete_record(record_id, patient.id)
    if not record:
        return not_found_response('Health record')

    return success_response(message='Health record deleted successfully')


@patient_bp.route('/health-records/by-type/<record_type>', methods=['GET'])
@jwt_required()
@feature_required('patient.health_records')
@role_required(UserRole.PATIENT)
def get_health_records_by_type(record_type):
    """Get health records by type (vitals, surgeries, habits, etc.)."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    records = HealthRecordService.get_records_by_type(patient.id, record_type)
    return success_response(data={
        'records': [r.to_dict() for r in records],
        'record_type': record_type,
    })


@patient_bp.route('/vitals', methods=['GET'])
@jwt_required()
@feature_required('patient.vitals')
@role_required(UserRole.PATIENT)
def get_vitals():
    """Get latest vitals snapshot."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    vitals = HealthRecordService.get_latest_vitals(patient.id)
    return success_response(data={'vitals': vitals})


@patient_bp.route('/vitals', methods=['PUT'])
@jwt_required()
@feature_required('patient.vitals')
@role_required(UserRole.PATIENT)
def update_vitals():
    """Save or update current vitals snapshot."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    record = HealthRecordService.save_vitals(patient.id, current_user.id, data)
    return success_response(data=record.to_dict(), message='Vitals saved successfully')


@patient_bp.route('/habits', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_habits():
    """Get current habits."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    habits = HealthRecordService.get_latest_habits(patient.id)
    return success_response(data={'habits': habits})


@patient_bp.route('/habits', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_habits():
    """Save or update habits."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    record = HealthRecordService.save_habits(patient.id, current_user.id, data)
    return success_response(data=record.to_dict(), message='Habits saved successfully')


@patient_bp.route('/surgeries', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_surgeries():
    """Get surgery records."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    records = HealthRecordService.get_records_by_type(patient.id, 'surgery_record')
    return success_response(data={
        'surgeries': [_enrich_attachments(r.to_dict()) for r in records],
    })


@patient_bp.route('/surgeries', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def add_surgery():
    """Add a surgery record."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    record = HealthRecordService.create_record(patient.id, current_user.id, {
        'record_type': 'surgery_record',
        'record_date': data.get('surgery_date', data.get('record_date')),
        'details': data,
        'notes': data.get('notes'),
    })
    return created_response(data=record.to_dict(), message='Surgery record added')


# ─────────────────────────────────────────────
#  Health Record Attachments
# ─────────────────────────────────────────────

@patient_bp.route('/health-records/<record_id>/attachments', methods=['POST'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def upload_health_record_attachment(record_id):
    """
    Upload an attachment to a health record (multipart form).

    Form fields:
        - file: Required – the file to upload
        - description: Optional – a text description for the attachment
    """
    from app.services.s3_service import S3Service
    import uuid as uuid_mod
    from datetime import datetime as dt

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    record = HealthRecordService.get_record(record_id, patient.id)
    if not record:
        return not_found_response('Health record')

    if 'file' not in request.files:
        return error_response('No file provided', status_code=400)

    file_obj = request.files['file']
    if not file_obj.filename:
        return error_response('Empty filename', status_code=400)

    description = request.form.get('description', '')

    try:
        result = S3Service.upload_file(
            file_obj=file_obj,
            asset_type='health-record-attachment',
            original_filename=file_obj.filename,
            is_private=True,
            folder='patients/health-records',
        )
    except Exception as e:
        logger.error(f'S3 upload failed for health record attachment: {e}')
        return error_response('File upload failed', status_code=500)

    attachment_entry = {
        'id': uuid_mod.uuid4().hex,
        'filename': file_obj.filename,
        's3_key': result['s3_key'],
        's3_bucket': result['s3_bucket'],
        'content_type': result.get('content_type', 'application/octet-stream'),
        'file_size_bytes': result.get('file_size_bytes', 0),
        'description': description,
        'uploaded_at': dt.utcnow().isoformat(),
    }

    # Append to existing attachment_links list
    from app.extensions import db
    existing = record.attachment_links or []
    existing.append(attachment_entry)
    record.attachment_links = existing
    # Force SQLAlchemy to detect the JSON mutation
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(record, 'attachment_links')
    db.session.commit()

    # Return attachment with a presigned URL so the frontend can display it
    attachment_entry['url'] = S3Service.get_signed_url(result['s3_key']) or ''

    return created_response(
        data={'attachment': attachment_entry, 'record': record.to_dict()},
        message='Attachment uploaded successfully',
    )


@patient_bp.route('/health-records/<record_id>/attachments/<attachment_id>', methods=['DELETE'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def delete_health_record_attachment(record_id, attachment_id):
    """Delete a specific attachment from a health record."""
    from app.services.s3_service import S3Service

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    record = HealthRecordService.get_record(record_id, patient.id)
    if not record:
        return not_found_response('Health record')

    existing = record.attachment_links or []
    target = None
    remaining = []
    for att in existing:
        if att.get('id') == attachment_id:
            target = att
        else:
            remaining.append(att)

    if not target:
        return not_found_response('Attachment')

    # Delete from S3
    s3_key = target.get('s3_key')
    s3_bucket = target.get('s3_bucket')
    if s3_key and s3_bucket:
        S3Service.delete_file(s3_bucket, s3_key)

    from app.extensions import db
    from sqlalchemy.orm.attributes import flag_modified
    record.attachment_links = remaining
    flag_modified(record, 'attachment_links')
    db.session.commit()

    return success_response(data=record.to_dict(), message='Attachment deleted successfully')


@patient_bp.route('/health-records/<record_id>/attachments', methods=['GET'])
@jwt_required()
@feature_required('patient.documents')
@role_required(UserRole.PATIENT)
def get_health_record_attachments(record_id):
    """Get all attachments for a health record with presigned URLs."""
    from app.services.s3_service import S3Service

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    record = HealthRecordService.get_record(record_id, patient.id)
    if not record:
        return not_found_response('Health record')

    attachments = record.attachment_links or []
    # Enrich each attachment with a presigned URL
    for att in attachments:
        att['url'] = S3Service.get_signed_url(att.get('s3_key')) or ''

    return success_response(data={'attachments': attachments})


# ─────────────────────────────────────────────
#  House Group Request System
# ─────────────────────────────────────────────

@patient_bp.route('/house-group/requests', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_house_group_requests():
    """Get all sent and received group requests."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    sent = HouseGroupRequestService.get_sent_requests(patient.id)
    received = HouseGroupRequestService.get_received_requests(current_user.id)

    return success_response(data={
        'sent_requests': [r.to_dict() for r in sent],
        'received_requests': [r.to_dict() for r in received],
    })


@patient_bp.route('/house-group/requests', methods=['POST'])
@limiter.limit("5 per minute;20 per hour")
@jwt_required()
@role_required(UserRole.PATIENT)
def send_house_group_request():
    """
    Send a request to add someone to house/family group.

    Request body:
        - target_phone: Phone number of person to invite (or)
        - target_user_id: User ID to invite
        - relation: Required (Spouse, Father, Mother, etc.)
        - group_type: 'family' or 'house' (default: 'family')
        - target_name: Display name for invite
        - permissions: Optional {visible, appointments, prescriptions}
    """
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    if not data.get('relation'):
        return error_response('Relation is required')
    if not data.get('target_phone') and not data.get('target_user_id'):
        return error_response('Either target_phone or target_user_id is required')

    try:
        req = HouseGroupRequestService.send_request(patient.id, data)
        return created_response(data=req.to_dict(), message='Request sent successfully')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/requests/<request_id>/accept', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def accept_house_group_request(request_id):
    """Accept a received house group request."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json() or {}
    receiver_relation = data.get('receiver_relation', '').strip()

    from app.api.patient_family.quota import PatientQuotaExceeded
    try:
        member = HouseGroupRequestService.accept_request(
            request_id, current_user.id, patient.id, receiver_relation=receiver_relation
        )
        return success_response(data=member.to_dict(), message='Request accepted')
    except PatientQuotaExceeded as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/requests/<request_id>/reject', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def reject_house_group_request(request_id):
    """Reject a received house group request."""
    try:
        req = HouseGroupRequestService.reject_request(request_id, current_user.id)
        return success_response(data=req.to_dict(), message='Request rejected')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/requests/<request_id>/cancel', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def cancel_house_group_request(request_id):
    """Cancel a sent house group request."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    try:
        req = HouseGroupRequestService.cancel_request(request_id, patient.id)
        return success_response(data=req.to_dict(), message='Request cancelled')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/generate-invite', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def generate_house_group_invite():
    """
    Generate a shareable invite code for house/family group.

    No target phone or user ID required -- the code is shared manually
    (WhatsApp, SMS, etc.) and the recipient joins via the code.

    Request body:
        - relation: Required (Spouse, Father, Mother, etc.)
        - group_type: 'family' or 'house' (default: 'family')
        - permissions: Optional {visible, appointments, prescriptions}
    """
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    if not data.get('relation'):
        return error_response('Relation is required')

    try:
        req = HouseGroupRequestService.generate_invite(patient.id, data)
        return created_response(data=req.to_dict(), message='Invite code generated successfully')
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/join/<invite_code>', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def join_by_invite_code(invite_code):
    """Join a house group using an invite code."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json() or {}
    receiver_relation = data.get('receiver_relation', '').strip()

    from app.api.patient_family.quota import PatientQuotaExceeded
    try:
        member = HouseGroupRequestService.join_by_invite_code(
            invite_code, current_user.id, patient.id, receiver_relation=receiver_relation
        )
        return success_response(data=member.to_dict(), message='Joined group successfully')
    except PatientQuotaExceeded as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e))


@patient_bp.route('/house-group/<member_id>/permissions', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
def update_member_permissions(member_id):
    """Update permissions for a house group member."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    data = request.get_json()
    if not data or 'permissions' not in data:
        return error_response('Permissions object is required')

    member = HouseGroupService.update_member_permissions(member_id, patient.id, data['permissions'])
    if not member:
        return not_found_response('Family member')

    return success_response(data=member.to_dict(), message='Permissions updated')


@patient_bp.route('/prescriptions', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_prescriptions():
    """Get patient's prescriptions."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = request.args.get('status')
    
    pagination = PatientService.get_prescriptions(
        patient_id=patient.id,
        status=status,
        page=page,
        per_page=per_page
    )
    
    return success_response(data={
        'prescriptions': [rx.to_dict(include_doctor=True) for rx in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/appointments/<appointment_id>/prescriptions', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_appointment_prescriptions(appointment_id):
    """The prescription(s) issued for one of the patient's appointments.

    Powers the "View prescription" link on a completed appointment. Scoped to
    the caller's own appointments, so a patient can only read prescriptions
    tied to their bookings.
    """
    from app.models import Appointment, Prescription

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    appt = Appointment.query.filter_by(
        id=appointment_id, patient_id=patient.id, is_deleted=False,
    ).first()
    if not appt:
        return not_found_response('Appointment')

    rows = (Prescription.query
            .filter_by(appointment_id=appt.id, is_deleted=False)
            .order_by(Prescription.created_at.desc())
            .all())
    return success_response(data={
        'appointment_id': str(appt.id),
        'prescriptions': [rx.to_dict(include_doctor=True) for rx in rows],
    })


def _concise_feature(f):
    """A booking-surface-sized slice of a landing feature: only benefits, how it
    works, and a couple of essential details — each shown only when the admin
    left its section enabled and it has content."""
    sec = getattr(f, 'sections_enabled_json', None) or {}
    def on(key):
        return sec.get(key, True)
    out = {'slug': f.slug, 'title': f.title}
    if on('benefits') and f.benefits:
        out['benefits'] = [b for b in (f.benefits or []) if b]
    if on('how_it_works') and f.process:
        out['how_it_works'] = f.process           # [{title, desc}]
    if on('what_is') and f.what_is:
        out['what_is'] = f.what_is
    if on('whats_included') and f.whats_included:
        out['whats_included'] = f.whats_included   # [{title, desc}]
    return out


def _resolve_offering_features(tenant_id, *, offering_key=None, product_id=None,
                               doctor_id=None, team_id=None):
    """The landing features linked to a booking offering, via the Feature-Product
    Linking store. Collect the feature TITLES admins picked for this
    offering/product (narrowed to the doctor/team when given), resolve them to
    the tenant's (or the apex/platform) landing features, then fall back to any
    landing feature that directly markets this product."""
    from app.models import (
        FeatureProductLink, LandingFeature, PlatformLandingFeature,
    )

    q = FeatureProductLink.query.filter_by(tenant_id=tenant_id)
    if offering_key:
        q = q.filter_by(offering_key=offering_key)
    if product_id:
        q = q.filter_by(product_id=product_id)
    rows = q.order_by(FeatureProductLink.display_order).all()

    def _applies(r):
        # A row scoped to a specific doctor/team only applies to that one; a
        # null scope applies broadly.
        if doctor_id and r.doctor_id and str(r.doctor_id) != str(doctor_id):
            return False
        if team_id and r.team_id and str(r.team_id) != str(team_id):
            return False
        return True

    titles = []
    for r in rows:
        if not _applies(r):
            continue
        for t in (r.features or []):
            if t and t not in titles:
                titles.append(t)

    def _visible(rowset):
        return [f for f in rowset if getattr(f, 'is_visible', True)]

    feats = []
    if titles:
        # Tenant features first, then apex/platform features; keep the admin's
        # chosen order, de-duped by title.
        by_title = {}
        for f in _visible(LandingFeature.query.filter(
                LandingFeature.tenant_id == tenant_id,
                LandingFeature.title.in_(titles)).all()):
            by_title.setdefault(f.title, f)
        for f in _visible(PlatformLandingFeature.query.filter(
                PlatformLandingFeature.title.in_(titles)).all()):
            by_title.setdefault(f.title, f)
        feats = [by_title[t] for t in titles if t in by_title]

    if not feats and product_id:
        feats = _visible(LandingFeature.query.filter_by(
            tenant_id=tenant_id, product_id=product_id).all())
        if not feats:
            feats = _visible(PlatformLandingFeature.query.filter_by(
                product_id=product_id).all())

    out = []
    for f in feats:
        cf = _concise_feature(f)
        # Only include a feature that actually has something to show.
        if cf.get('benefits') or cf.get('how_it_works') or cf.get('what_is') \
                or cf.get('whats_included'):
            out.append(cf)
    return out


@patient_bp.route('/credits', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_credits():
    """The patient's health-credit wallet — balance, expiry, and recent
    movements."""
    from app.common.tenant_context import current_tenant_id_or_default
    from app.api.membership import credit_service
    from app.models import HealthCreditLedger
    tid = current_tenant_id_or_default()
    wallet = credit_service.get_wallet(tid, current_user.id)
    ledger = []
    if wallet is not None:
        ledger = [x.to_dict() for x in (
            HealthCreditLedger.query
            .filter_by(tenant_id=tid, user_id=current_user.id)
            .order_by(HealthCreditLedger.created_at.desc())
            .limit(20).all())]
    return success_response(data={
        'wallet': wallet.to_dict() if wallet else None,
        'available': wallet.available() if wallet else 0.0,
        'ledger': ledger,
    })


@patient_bp.route('/credits/quote', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def quote_credits():
    """How many credits the patient may redeem on a booking of ``price`` for the
    given ``offering`` scope (a consultation type, ``service`` or ``group``)."""
    from app.common.tenant_context import current_tenant_id_or_default
    from app.api.membership import credit_service
    tid = current_tenant_id_or_default()
    offering = (request.args.get('offering') or '').strip()
    try:
        price = float(request.args.get('price') or 0)
    except (TypeError, ValueError):
        price = 0.0
    q = credit_service.quote_redeemable(tid, current_user.id, offering, price)
    return success_response(data=q)


@patient_bp.route('/spending', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_spending():
    """The patient's spending — every payment they made (consultation, service,
    health-plan installment, membership), labelled by what it was for, plus the
    total actually paid (successful payments)."""
    from app.common.tenant_context import current_tenant_id_or_default
    from app.models import (
        Payment, PaymentStatus, Appointment, MarketplaceOrder,
        GroupOfferingBookingInstallment, MembershipSubscription, MembershipPlan,
    )
    tid = current_tenant_id_or_default()
    rows = (Payment.query
            .filter_by(tenant_id=tid, user_id=current_user.id)
            .filter(Payment.status != PaymentStatus.CREATED)
            .order_by(Payment.payment_date.desc())
            .all())

    items, total = [], 0.0
    for p in rows:
        kind, label = 'other', 'Payment'
        try:
            if p.appointment_id:
                appt = Appointment.query.get(p.appointment_id)
                kind = 'consultation'
                dn = (getattr(appt, 'doctor_name', None)
                      or (appt.doctor.full_name if appt and appt.doctor else None))
                ct = getattr(appt, 'consultation_type', None)
                ct = getattr(ct, 'value', ct)
                label = (str(ct or 'consultation').replace('_', ' ').title()
                         + (f' · Dr. {dn}' if dn else ''))
            elif p.order_id:
                order = MarketplaceOrder.query.get(p.order_id)
                kind = 'service'
                label = (getattr(order, 'product_name', None)
                         or getattr(order, 'plan_name', None) or 'Service order')
            elif p.booking_installment_id:
                inst = GroupOfferingBookingInstallment.query.get(p.booking_installment_id)
                kind = 'health_plan'
                booking = getattr(inst, 'booking', None)
                label = ((getattr(booking, 'plan_name', None) or 'Health plan')
                         + ' · installment')
            elif p.membership_subscription_id:
                sub = MembershipSubscription.query.get(p.membership_subscription_id)
                kind = 'membership'
                pn = None
                if sub and getattr(sub, 'membership_plan_id', None):
                    pl = MembershipPlan.query.get(sub.membership_plan_id)
                    pn = pl.name if pl else None
                label = 'Membership' + (f' · {pn}' if pn else '')
        except Exception:  # noqa: BLE001 — labelling is best-effort
            pass

        if p.status == PaymentStatus.SUCCESS:
            total += float(p.amount or 0)
        items.append({
            'id': str(p.id),
            'kind': kind,
            'label': label,
            'amount': str(p.amount),
            'currency': p.currency,
            'status': p.status.value,
            'method': p.payment_gateway,
            'transaction_id': p.transaction_id,
            'date': p.payment_date.isoformat() if p.payment_date else None,
        })

    return success_response(data={
        'payments': items,
        'total_spent': round(total, 2),
        'currency': 'INR',
    })


@patient_bp.route('/offerings/features', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_offering_features():
    """Landing features (benefits / how it works / essentials) linked to a
    booking offering — a health plan, a service, or a consultation — via the
    Feature-Product Linking store.

    Query: ``offering`` (offering_key: group|service|<consultation type>),
    ``product_id``, ``doctor_id``, ``team_id`` — pass whatever the surface has.
    """
    from app.common.tenant_context import current_tenant_id_or_default
    tid = current_tenant_id_or_default()
    feats = _resolve_offering_features(
        tid,
        offering_key=(request.args.get('offering') or None),
        product_id=(request.args.get('product_id') or None),
        doctor_id=(request.args.get('doctor_id') or None),
        team_id=(request.args.get('team_id') or None),
    )
    return success_response(data={'features': feats})


@patient_bp.route('/documents', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_documents():
    """Get documents the doctor has pushed to this patient.

    Only ACTIVE documents are visible — drafts, items awaiting admin
    approval and rejected ones are doctor-side state. ``status=all``
    lifts that (used by the patient's history view) but still never
    exposes DRAFT.
    """
    from app.models import DoctorDocument, DocumentStatus

    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = (request.args.get('status') or 'active').strip().lower()

    q = DoctorDocument.query.filter_by(patient_id=patient.id, is_deleted=False)

    # Documents are deliverables of a purchased service, so the order
    # detail page fetches just that order's documents.
    order_id = (request.args.get('order_id') or '').strip()
    if order_id:
        q = q.filter(DoctorDocument.order_id == order_id)

    if status == 'all':
        q = q.filter(DoctorDocument.status.in_([
            DocumentStatus.ACTIVE, DocumentStatus.REVISED, DocumentStatus.EXPIRED,
        ]))
    else:
        q = q.filter(DoctorDocument.status == DocumentStatus.ACTIVE)

    pagination = q.order_by(DoctorDocument.issue_date.desc()).paginate(
        page=page, per_page=per_page, error_out=False,
    )

    return success_response(data={
        'documents': [d.to_dict(include_doctor=True) for d in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


@patient_bp.route('/appointments', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_appointments():
    """Get patient's appointments (legacy endpoint - use /orders instead)."""
    patient = PatientService.get_by_user_id(current_user.id)
    
    if not patient:
        return not_found_response('Patient profile')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = request.args.get('status')
    
    pagination = PatientService.get_appointments(
        patient_id=patient.id,
        status=status,
        page=page,
        per_page=per_page
    )
    
    return success_response(data={
        'appointments': [apt.to_dict(include_relations=True) for apt in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


# ─────────────────────────────────────────────
#  Marketplace (Independent Products)
# ─────────────────────────────────────────────

@patient_bp.route('/marketplace/products', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def browse_marketplace():
    """Browse marketplace products from all doctors."""
    from app.models import DoctorMarketplaceProduct
    
    # Filter by doctor_id if provided
    doctor_id = request.args.get('doctor_id')
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 50)
    
    # Tenant scope — the patient must only see marketplace products
    # from doctors in their OWN tenant. Without this filter a jlmush
    # patient was seeing larazen's marketplace catalog (same shape as
    # the /doctors/match cross-tenant leak fixed earlier).
    query = DoctorMarketplaceProduct.query.filter_by(
        is_active=True, approval_status='approved',
        tenant_id=current_user.tenant_id,
    )
    if doctor_id:
        query = query.filter_by(doctor_id=doctor_id)

    # Targeted ordering — score every matching listing against the browsing
    # patient (its CATALOG product's ``targeting``), then paginate the
    # score-sorted set in Python. The catalog is small (tens of rows), so
    # fetching the filtered set to rank it beats pushing the score into SQL;
    # untargeted listings score 0 and keep their created_at order.
    from app.common.targeting_rank import (
        patient_targeting_profile, targeting_score,
    )
    from app.models import DoctorProduct
    profile = patient_targeting_profile(current_user)
    rows = query.order_by(DoctorMarketplaceProduct.created_at.desc()).all()
    catalog_targeting = {}
    catalog_ids = {p.product_id for p in rows if p.product_id}
    if catalog_ids:
        for dp_id, dp_targeting in (
            db.session.query(DoctorProduct.id, DoctorProduct.targeting)
            .filter(DoctorProduct.id.in_(catalog_ids)).all()
        ):
            catalog_targeting[dp_id] = dp_targeting
    rows.sort(  # stable — equal scores keep the created_at order above
        key=lambda p: -targeting_score(catalog_targeting.get(p.product_id), profile),
    )
    total = len(rows)
    page_rows = rows[(page - 1) * per_page: (page - 1) * per_page + per_page]

    # Admin display-pricing overlay for the page in one query, so each card
    # quotes what the order will actually be created at.
    from app.common.display_pricing import (
        _whole_pct, decorate_marketplace_product, rules_for_doctors,
    )
    from app.common.platform_discount import apply_platform_discount
    display_rules = rules_for_doctors(
        [p.doctor_id for p in page_rows], tenant_id=current_user.tenant_id,
    )

    products = []
    for p in page_rows:
        product_data = decorate_marketplace_product(
            p.to_dict(), p.doctor_id, str(p.product_id), display_rules,
        )
        product_data['doctor_name'] = p.doctor.full_name if p.doctor else 'Unknown'
        product_data['offering_type'] = 'individual'
        product_data['_targeting_score'] = targeting_score(
            catalog_targeting.get(p.product_id), profile,
        )
        products.append(product_data)

    # Approved group offerings — several doctors serving one service together.
    # Only surfaced on the first page (they aren't part of the individual
    # pagination) and only when not filtering by a single doctor.
    if not doctor_id and page == 1:
        from app.models import MarketplaceServiceGroup
        groups = MarketplaceServiceGroup.query.filter_by(
            tenant_id=current_user.tenant_id, approval_status='approved', is_active=True,
        ).order_by(MarketplaceServiceGroup.created_at.desc()).all()
        # Plan-level targeting for the groups' rank, one query (no
        # relationship exists on MarketplaceServiceGroup).
        from app.models import GroupOffering
        plan_targeting = {}
        go_ids = {g.group_offering_id for g in groups if g.group_offering_id}
        if go_ids:
            for go_id, go_t in (
                db.session.query(GroupOffering.id, GroupOffering.targeting)
                .filter(GroupOffering.id.in_(go_ids)).all()
            ):
                plan_targeting[go_id] = go_t
        for g in groups:
            doctors = [{'id': m.doctor_id and str(m.doctor_id), 'name': m.doctor_name}
                       for m in g.members if m.doctor_name]
            names = [d['name'] for d in doctors]
            # A group offering is priced as a whole and never appears in the
            # per-doctor pricing table, so there is no overlay to apply — but
            # the tenant's site-wide discount still has to reach it, or a sale
            # would visibly skip the group cards sitting beside the individual
            # ones. Quoted here and re-applied at purchase from the same
            # helper, so the card and the charge agree.
            group_net = apply_platform_discount(
                g.group_price, tenant_id=current_user.tenant_id,
            )
            entry = {
                'id': str(g.id),
                'offering_type': 'group',
                'product_id': str(g.product_id),
                'product_name': g.product.name if g.product else None,
                'product_description': g.product.description if g.product else None,
                'doctor_description': g.group_description,
                'doctor_price': str(group_net),
                'doctor_name': ', '.join(names) if names else 'Care team',
                'doctors': doctors,
            }
            if group_net is not None and float(g.group_price or 0) > group_net:
                entry['original_price'] = str(float(g.group_price))
                entry['discount_pct'] = _whole_pct(float(g.group_price), group_net)
            # Group cards rank by their plan's targeting (fallback: the
            # backing catalog product's), same scale as individual cards.
            g_targeting = plan_targeting.get(g.group_offering_id)
            if not g_targeting and g.product_id:
                g_targeting = catalog_targeting.get(g.product_id)
                if g_targeting is None and g.product is not None:
                    g_targeting = g.product.targeting
            entry['_targeting_score'] = targeting_score(g_targeting, profile)
            products.append(entry)

        # Re-rank the combined page so targeted plans surface above
        # untargeted individual cards too (stable — ties keep order).
        products.sort(key=lambda e: -e.get('_targeting_score', 0))

    return success_response(data={
        'products': products,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page if per_page else 1,
        }
    })


@patient_bp.route('/recommended', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def recommended_for_you():
    """The "Recommended for you" rail (rendered by the mobile app; the web
    patient UI has no such section).

    Union of the admin-set ``targeting.recommended`` lists across the
    tenant's active catalog products — three independent lists, deduped,
    resolved to display objects, and ordered by the fixed display
    priority: doctors first, then products, then specializations.
    """
    from app.models import DoctorProduct, Doctor, Category
    tid = current_user.tenant_id
    rows = db.session.query(DoctorProduct.targeting).filter(
        DoctorProduct.tenant_id == tid,
        DoctorProduct.is_active.is_(True),
        DoctorProduct.is_deleted.is_(False),
        DoctorProduct.targeting.isnot(None),
    ).all()

    doctor_ids, product_ids, spec_ids = [], [], []

    def _extend(dst, vals):
        for v in vals or []:
            if v not in dst:
                dst.append(v)

    for (t,) in rows:
        rec = (t or {}).get('recommended') or {}
        _extend(doctor_ids, rec.get('doctor_ids'))
        _extend(product_ids, rec.get('product_ids'))
        _extend(spec_ids, rec.get('specialization_ids'))

    items = []
    if doctor_ids:
        docs = {str(d.id): d for d in Doctor.query.filter(
            Doctor.tenant_id == tid, Doctor.id.in_(doctor_ids),
            Doctor.is_deleted.is_(False),
        ).all()}
        for did in doctor_ids:
            d = docs.get(did)
            if d:
                items.append({
                    'kind': 'doctor', 'id': did, 'name': d.full_name,
                    'profile_image': getattr(d, 'profile_image', None),
                })
    if product_ids:
        prods = {str(p.id): p for p in DoctorProduct.query.filter(
            DoctorProduct.tenant_id == tid, DoctorProduct.id.in_(product_ids),
            DoctorProduct.is_active.is_(True), DoctorProduct.is_deleted.is_(False),
        ).all()}
        for pid in product_ids:
            p = prods.get(pid)
            if p:
                items.append({
                    'kind': 'product', 'id': pid, 'name': p.name,
                    'min_price': float(p.min_price or 0),
                    'max_price': float(p.max_price or 0),
                })
    if spec_ids:
        specs = {str(c.id): c for c in Category.query.filter(
            Category.tenant_id == tid, Category.id.in_(spec_ids),
        ).all()}
        for sid in spec_ids:
            c = specs.get(sid)
            if c:
                items.append({'kind': 'specialization', 'id': sid, 'name': c.name})

    return success_response(data={'recommended': items})


def _redeem_order_credits(order, offering_scope):
    """Apply requested health credits to a freshly-created marketplace order,
    lowering ``price_at_purchase``. Server re-caps by the plan's per-offering
    rule + balance. Best-effort — never blocks the purchase."""
    try:
        req = float((request.get_json(silent=True) or {}).get('redeem_credits') or 0)
        if req <= 0:
            return
        from app.api.membership import credit_service
        applied = credit_service.redeem(
            order.tenant_id, current_user.id, offering_scope,
            float(order.price_at_purchase or 0), req,
            ref_type='order', ref_id=order.id)
        if applied > 0:
            order.price_at_purchase = float(order.price_at_purchase or 0) - applied
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception('[CREDIT] order redeem failed')


@patient_bp.route('/marketplace/purchase', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def purchase_marketplace_product():
    """
    Purchase a product from the marketplace.
    In MVP: Create a pending MarketplaceOrder.
    """
    from app.models import (
        DoctorMarketplaceProduct, MarketplaceOrder, Patient, MarketplaceServiceGroup,
    )
    from app.extensions import db

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    data = request.get_json() or {}
    group_id = data.get('group_id')
    mp_product_id = data.get('mp_product_id')
    # The patient's note captured at booking (shown to the doctor before they
    # accept / reject). The attachment is uploaded separately after the order is
    # created (see /marketplace/orders/<id>/attachment).
    description = (data.get('description') or '').strip() or None

    # ── Group offering purchase ──
    if group_id:
        group = MarketplaceServiceGroup.query.filter_by(
            id=group_id, tenant_id=current_user.tenant_id,
            approval_status='approved', is_active=True,
        ).first()
        if not group:
            return error_response('Group offering not found or not available', status_code=404)
        # doctor_id = lead (order.group_id lets every member see it).
        from app.common.member_discount import discount_for_user
        from app.common.platform_discount import apply_platform_discount
        order = MarketplaceOrder(
            patient_id=patient.id,
            doctor_id=group.created_by_doctor_id,
            product_id=group.product_id,
            group_id=group.id,
            # Site-wide discount first (it's in the price the card quoted),
            # then the patient's own membership tier on top of that — the
            # same order every other priced offering follows.
            #
            # No rule to pass: a doctor-authored group is priced as a whole and
            # never appears in the per-doctor pricing table, so there is no
            # ``plan_discounts`` row that could dial the tier down and the
            # ceiling IS this offering's rate — which is exactly what the group
            # card quotes.
            price_at_purchase=discount_for_user(
                apply_platform_discount(
                    group.group_price, tenant_id=current_user.tenant_id,
                ),
                current_user.id,
            )[0],
            patient_data=description,
            status='pending',
        )
        db.session.add(order)
        db.session.flush()
        _redeem_order_credits(order, 'group')
        db.session.commit()
        return success_response(
            message='Order placed. Complete payment to send it to the care team.',
            data=order.to_dict(), status_code=201,
        )

    # ── Individual product purchase ──
    if not mp_product_id:
        return error_response('mp_product_id or group_id is required', status_code=400)

    # Tenant scope on the lookup — refuses to fetch a product from
    # another tenant even if the patient knows the UUID. Without this
    # an authenticated jlmush patient could place an order against
    # a larazen product by guessing / scraping the id.
    mp_product = DoctorMarketplaceProduct.query.filter_by(
        id=mp_product_id, is_active=True, approval_status='approved',
        tenant_id=current_user.tenant_id,
    ).first()
    if not mp_product:
        return error_response('Marketplace product not found or inactive', status_code=404)

    # The patient pays the display price (doctor's fee + the admin's increment
    # − discount), not the doctor's own figure — same number the marketplace
    # card quoted. The doctor's payout still tracks ``doctor_price``.
    #
    # Their membership tier comes off last, on top of the display price: it
    # depends on who is buying, so it can't be baked into the quote the way the
    # admin's overlay is. How much of the tier this service grants is on the
    # service's own rule (``plan_discounts``) — the same row the card badged —
    # so the rule is passed in rather than letting the charge fall back to the
    # tier's ceiling on a service an admin dialled below it.
    from app.common.display_pricing import (
        SERVICE_SCOPE, display_price_for_service, rule_for, rules_for_doctors,
    )
    from app.common.member_discount import discount_for_user, redeemed_amount
    from decimal import Decimal

    # Keyed on the CATALOG product id, not the per-doctor listing — see
    # ``display_price_for_service``, which the price beside it resolves the
    # same way. One lookup serves both.
    product_key = str(mp_product.product_id)
    rules = rules_for_doctors(
        [mp_product.doctor_id], tenant_id=current_user.tenant_id,
    )
    service_rule = rule_for(
        mp_product.doctor_id, SERVICE_SCOPE, product_key, rules)
    net = discount_for_user(
        display_price_for_service(
            mp_product.doctor_id, product_key,
            mp_product.doctor_price, rules,
            tenant_id=current_user.tenant_id,
        ),
        current_user.id,
        rule=service_rule,
    )[0]
    # Then whatever the buyer chose to spend. Re-validated against the same
    # rule, so an id they were never offered buys nothing.
    redeemed = (request.get_json() or {}).get('redeemed_discount_ids') or []
    if net is not None and redeemed:
        spent = redeemed_amount(service_rule, redeemed, user_id=current_user.id)
        net = float(max(Decimal(str(net)) - spent, Decimal('0')))

    order = MarketplaceOrder(
        patient_id=patient.id,
        doctor_id=mp_product.doctor_id,
        product_id=mp_product.product_id,
        price_at_purchase=net,
        patient_data=description,
        status='pending'
    )
    db.session.add(order)
    db.session.flush()
    _redeem_order_credits(order, 'service')
    db.session.commit()

    return success_response(
        message='Order placed. Complete payment to send it to the provider.',
        data=order.to_dict(),
        status_code=201
    )


@patient_bp.route('/marketplace/orders/<order_id>/attachment', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def upload_order_attachment(order_id):
    """Attach one file to a marketplace order while booking (multipart ``file``).

    Stored on the order so the doctor can review it before accepting/rejecting.
    """
    from app.models import MarketplaceOrder, Patient
    from app.services.s3_service import S3Service
    from app.extensions import db

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
    order = MarketplaceOrder.query.filter_by(
        id=order_id, patient_id=patient.id, tenant_id=current_user.tenant_id,
    ).first()
    if not order:
        return error_response('Order not found', status_code=404)

    if 'file' not in request.files:
        return error_response('No file provided', status_code=400)
    file_obj = request.files['file']
    if not file_obj.filename:
        return error_response('Empty filename', status_code=400)

    try:
        result = S3Service.upload_file(
            file_obj=file_obj,
            asset_type='marketplace-order-attachment',
            original_filename=file_obj.filename,
            is_private=True,
            folder=f'marketplace/orders/{order_id}',
        )
    except Exception as e:
        logger.error(f'S3 upload failed for order attachment: {e}')
        return error_response('File upload failed', status_code=500)

    order.patient_attachment_link = S3Service.get_signed_url(result['s3_key']) or result['s3_key']
    db.session.commit()
    return success_response(data=order.to_dict(), message='Attachment added')


@patient_bp.route('/marketplace/orders', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_marketplace_orders():
    """List all marketplace orders for the current patient."""
    from app.models import MarketplaceOrder, Patient
    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)
        
    orders = MarketplaceOrder.query.filter_by(patient_id=patient.id).order_by(MarketplaceOrder.created_at.desc()).all()
    return success_response(data={'orders': [o.to_dict() for o in orders]})


# ==========================================================================
# APPOINTMENT BOOKING FLOW — Consultation-Type-First Path
# ==========================================================================

def _offering_rule_from(source):
    """``(rule, error_response)`` for the offering named in ``source``.

    ``source`` is a query-args mapping or a parsed JSON body — the two
    checkout reads take the same fields and must resolve the identical row, so
    they share this rather than each doing their own lookup.

    A consultation is named by ``doctor_id`` + ``consultation_type`` +
    ``duration``; a catalog service by ``doctor_id`` + ``product_id``. Both are
    exactly what picks the pricing rule the purchase charges from.
    """
    from app.api.service_provider.doctor.service import DoctorService
    from app.common.display_pricing import (
        SERVICE_SCOPE, rule_for, rule_for_booking, rules_for_doctors,
    )

    doctor_id = str(source.get('doctor_id') or '').strip()
    if not doctor_id:
        return None, error_response('doctor_id is required')

    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return None, error_response('Doctor not found', status_code=404)

    product_id = str(source.get('product_id') or '').strip()
    if product_id:
        # Keyed on the CATALOG product id, matching
        # ``display_price_for_service`` — the rule survives a doctor
        # de-listing and re-listing the service.
        return rule_for(
            doctor_id, SERVICE_SCOPE, product_id,
            rules_for_doctors([doctor_id], tenant_id=current_user.tenant_id),
        ), None

    consultation_type = str(source.get('consultation_type') or '').strip() or None
    raw_duration = source.get('duration')
    try:
        duration = int(raw_duration) if raw_duration not in (None, '') else None
    except (TypeError, ValueError):
        duration = None
    return rule_for_booking(doctor, consultation_type, duration), None


@patient_bp.route('/member-offers', methods=['GET'])
@jwt_required()
def get_member_offers():
    """The vouchers/coupons the caller's tier lets them REDEEM on one slot.

    Two shapes, one per kind of offering, each naming exactly what picks the
    pricing rule the purchase will charge from — so the list rendered at
    checkout is resolved off the very row the charge re-validates against:

      * a consultation — ``?doctor_id=&consultation_type=&duration=``
      * a catalog service — ``?doctor_id=&product_id=``

    ``[]`` for a patient with no membership, or an offering no admin has
    attached an offer to. Empty is a normal answer, not an error: the booking
    summary simply renders no redeem section.

    Deliberately not folded into the slots payload. That one is public and
    prices a whole day; this is per-buyer, per-slot, and only meaningful once
    the patient has picked a time.
    """
    from app.common.member_discount import plan_offers

    rule, err = _offering_rule_from(request.args)
    if err:
        return err
    return success_response(data=plan_offers(rule, user_id=current_user.id))


@patient_bp.route('/redeem-code', methods=['POST'])
@jwt_required()
def verify_redeem_code():
    """Check one typed code against this purchase, and price it.

    Body: ``{code, kind: 'voucher'|'coupon'}`` plus the same offering fields
    :func:`_offering_rule_from` reads — ``doctor_id`` with either
    ``consultation_type`` + ``duration`` or ``product_id``.

    A code has to clear three things, and the error says which failed so the
    patient can act on it: it must exist and be live in this tenant's book of
    that kind, and an admin must have attached it to THIS offering for the
    buyer's own membership tier. The last check is the whole point — the same
    voucher can be valid on one doctor's video slot and meaningless on another.

    Vouchers and coupons are separate books and separate fields, so ``kind``
    is required rather than inferred: a code that exists in both would
    otherwise resolve to whichever was searched first.
    """
    from app.common.member_discount import plan_offers

    data = request.get_json() or {}
    code = (data.get('code') or '').strip().upper()
    kind = (data.get('kind') or '').strip().lower()
    if not code:
        return error_response('Enter a code')
    if kind not in ('voucher', 'coupon'):
        return error_response('kind must be voucher or coupon')

    rule, err = _offering_rule_from(data)
    if err:
        return err

    for offer in plan_offers(rule, user_id=current_user.id):
        if offer['kind'] == kind and (offer['code'] or '').upper() == code:
            return success_response(data=offer)

    label = 'Coupon' if kind == 'coupon' else 'Voucher'
    return error_response(
        f'{label} "{code}" is not valid for this purchase.', status_code=404)


@patient_bp.route('/slot-availability-summary', methods=['GET'])
def get_slot_availability_summary():
    """
    Aggregate slot availability by consultation type across the
    CALLER'S TENANT's doctors. Tenant resolved from the request host
    (or the apex default tenant for anonymous calls without host).
    Returns counts and status (red/orange/green) per type.
    No auth required — public info for landing page.

    Earlier versions returned counts across every tenant, so a
    jlmush.in patient's home page reflected larazen's slot inventory.
    Same root cause + fix as /doctors/match + /doctors/search.
    """
    from app.api.common.timeslot.service import TimeSlotService
    from app.common.tenant_context import current_tenant_id_or_default
    data = TimeSlotService.get_aggregate_availability_by_type(
        tenant_id=current_tenant_id_or_default(),
    )
    return success_response(data=data)


@patient_bp.route('/doctors/search', methods=['GET'])
def search_doctors_by_type():
    """
    Search doctors filtered by consultation type and optional criteria.

    Query params:
        - consultation_type (required): video, audio, chat, complete, home_visit
        - language: Comma-separated language filter
        - specialization: Comma-separated specialization filter
        - experience_min / experience_max: Years range
        - gender: male, female, other
        - price_min / price_max: Consultation fee range
        - rating_min: Minimum average rating
        - page, per_page: Pagination
    """
    from app.api.common.timeslot.service import TimeSlotService
    from app.common.tenant_context import current_tenant_id_or_default

    consultation_type = request.args.get('consultation_type')
    if not consultation_type:
        return validation_error_response({'consultation_type': 'Required'})

    # Tenant scope — same fix as /doctors/match (POST sibling).
    # Without this, the slot subquery + the Doctor.query.filter
    # below both returned rows from every tenant, leaking
    # cross-tenant doctors into the patient's search results.
    tenant_id = current_tenant_id_or_default()

    # Get doctors who have available slots for this consultation type,
    # scoped to the resolved tenant.
    doctor_slot_counts = TimeSlotService.get_doctor_slot_count_by_type(
        consultation_type, tenant_id=tenant_id,
    )
    if not doctor_slot_counts:
        return success_response(data={'doctors': [], 'pagination': {
            'page': 1, 'per_page': 20, 'total': 0, 'pages': 0,
            'has_next': False, 'has_prev': False,
        }})

    doctor_ids_with_slots = list(doctor_slot_counts.keys())

    # Build base query for those doctors — explicit tenant filter
    # as defence-in-depth (slot subquery is already tenant-scoped).
    query = Doctor.query.filter(
        Doctor.id.in_(doctor_ids_with_slots),
        Doctor.is_deleted == False,
        Doctor.tenant_id == tenant_id,
    )

    # Apply filters
    language = request.args.get('language')
    if language:
        langs = [l.strip() for l in language.split(',')]
        for lang in langs:
            query = query.filter(
                db.cast(Doctor.languages_known, db.Text).ilike(f'%{lang}%')
            )

    specialization = request.args.get('specialization')
    if specialization:
        specs = [s.strip() for s in specialization.split(',')]
        query = query.join(ProfileEducationSpecialization).join(Category).filter(
            db.func.lower(Category.name).in_([s.lower() for s in specs])
        )

    experience_min = request.args.get('experience_min', type=int)
    experience_max = request.args.get('experience_max', type=int)
    if experience_min is not None:
        query = query.filter(Doctor.experience_years >= experience_min)
    if experience_max is not None:
        query = query.filter(Doctor.experience_years <= experience_max)

    gender = request.args.get('gender')
    if gender:
        try:
            gender_enum = Gender(gender.lower())
            query = query.filter(Doctor.gender == gender_enum)
        except (ValueError, KeyError):
            pass

    price_min = request.args.get('price_min', type=float)
    price_max = request.args.get('price_max', type=float)
    if price_min is not None:
        query = query.filter(Doctor.consultation_fee >= price_min)
    if price_max is not None:
        query = query.filter(Doctor.consultation_fee <= price_max)

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)

    query = query.order_by(Doctor.created_at.desc())
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    # Format results with slot counts
    rating_min = request.args.get('rating_min', type=float)
    doctors = []
    for doctor in pagination.items:
        doc_data = DoctorListService.format_doctor_for_list(doctor)
        slot_count = doctor_slot_counts.get(str(doctor.id), 0)
        doc_data['available_slots'] = slot_count
        if slot_count == 0:
            doc_data['slot_status'] = 'red'
        elif slot_count <= 10:
            doc_data['slot_status'] = 'orange'
        else:
            doc_data['slot_status'] = 'green'

        # Filter by rating if requested
        if rating_min and doc_data.get('rating') and doc_data['rating'] < rating_min:
            continue
        if rating_min and not doc_data.get('rating'):
            continue

        doctors.append(doc_data)

    return success_response(data={
        'doctors': doctors,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


# ==========================================================================
# DOCTOR MATCH — Search doctors by symptoms + filters
# ==========================================================================

@patient_bp.route('/doctors/match', methods=['POST'])
def match_doctors_by_symptoms():
    """
    Match doctors based on selected symptoms AND filter preferences.
    Unlike /doctors/search (GET), this accepts a POST body with symptom IDs
    and returns doctors ranked by symptom match count.

    Body JSON:
        - symptom_ids: list of symptom UUIDs (optional, empty = no symptom filter)
        - custom_symptoms: list of free-text symptom strings (stored for context, not matched)
        - consultation_type (required): video, audio, chat, complete, home_visit
        - filters: { language, specialization, experience_min, experience_max,
                     gender, price_min, price_max, rating_min, category }
        - page, per_page: Pagination
    """
    from app.api.common.timeslot.service import TimeSlotService
    from app.common.tenant_context import current_tenant_id_or_default
    from app.models import DoctorSymptom

    data = request.get_json() or {}
    consultation_type = data.get('consultation_type')
    if not consultation_type:
        return validation_error_response({'consultation_type': 'Required'})

    # Tenant scope. This endpoint is public (no @jwt_required) so
    # we can't read tenant_id from the JWT; resolve from the request
    # host instead (``before_request`` populates g.tenant_id from
    # X-Tenant-Host / Origin / Tenant.domain). A jlmush.in patient
    # browsing /book-by-type resolves to jlmush's tenant_id;
    # ``current_tenant_id_or_default`` falls back to the apex
    # (``is_default=True``) tenant when no host is resolvable so a
    # raw curl from a script doesn't 500 — that path is fine because
    # the apex IS a tenant with its own roster.
    #
    # Without this scope, the BOTH the slot-count subquery AND the
    # Doctor.query.filter chain returned doctors from EVERY tenant —
    # surfaced in prod as a jlmush.in patient seeing larazen's
    # Dr. Ankita Doctor in their matched-doctors list. Hard
    # cross-tenant isolation violation; fixed by passing tenant_id
    # to the slot helper + adding the same filter to the
    # Doctor.query.filter chain below.
    tenant_id = current_tenant_id_or_default()

    symptom_ids = data.get('symptom_ids', [])
    filters = data.get('filters', {})
    page = data.get('page', 1)
    per_page = min(data.get('per_page', 20), 100)

    # Get doctors who have available slots for this consultation type,
    # scoped to the resolved tenant.
    doctor_slot_counts = TimeSlotService.get_doctor_slot_count_by_type(
        consultation_type, tenant_id=tenant_id,
    )
    if not doctor_slot_counts:
        return success_response(data={'doctors': [], 'pagination': {
            'page': 1, 'per_page': per_page, 'total': 0, 'pages': 0,
            'has_next': False, 'has_prev': False,
        }})

    doctor_ids_with_slots = list(doctor_slot_counts.keys())

    # If symptom_ids provided, find doctors who treat those symptoms and rank by match count
    symptom_match_counts = {}
    if symptom_ids:
        matches = db.session.query(
            DoctorSymptom.doctor_id,
            db.func.count(DoctorSymptom.symptom_id).label('match_count')
        ).filter(
            DoctorSymptom.symptom_id.in_(symptom_ids),
            DoctorSymptom.doctor_id.in_(doctor_ids_with_slots),
        ).group_by(DoctorSymptom.doctor_id).all()

        for row in matches:
            symptom_match_counts[str(row.doctor_id)] = row.match_count

        # Only include doctors who match at least one symptom
        if symptom_match_counts:
            doctor_ids_with_slots = [did for did in doctor_ids_with_slots if did in symptom_match_counts]
        # If no matches at all, still show all available doctors (fallback)

    # Build base query — explicit tenant filter is defence-in-depth.
    # The slot-count subquery above is already tenant-scoped, so
    # ``doctor_ids_with_slots`` only contains in-tenant doctor ids;
    # this filter would only ever trip if a future refactor broke
    # the slot-count helper's scoping. Belt + suspenders for a hard
    # isolation invariant.
    query = Doctor.query.filter(
        Doctor.id.in_(doctor_ids_with_slots),
        Doctor.is_deleted == False,
        Doctor.tenant_id == tenant_id,
    )

    # Apply filters
    language = filters.get('language', [])
    if language:
        langs = language if isinstance(language, list) else [l.strip() for l in language.split(',')]
        for lang in langs:
            query = query.filter(
                db.cast(Doctor.languages_known, db.Text).ilike(f'%{lang}%')
            )

    specialization = filters.get('specialization', [])
    if specialization:
        specs = specialization if isinstance(specialization, list) else [s.strip() for s in specialization.split(',')]
        query = query.join(ProfileEducationSpecialization).join(Category).filter(
            db.func.lower(Category.name).in_([s.lower() for s in specs])
        )

    experience_min = filters.get('experience_min')
    experience_max = filters.get('experience_max')
    if experience_min is not None and experience_min > 0:
        query = query.filter(Doctor.experience_years >= experience_min)
    if experience_max is not None and experience_max < 50:
        query = query.filter(Doctor.experience_years <= experience_max)

    gender = filters.get('gender', [])
    if gender:
        gender_val = gender[0] if isinstance(gender, list) else gender
        try:
            gender_enum = Gender(gender_val.lower())
            query = query.filter(Doctor.gender == gender_enum)
        except (ValueError, KeyError):
            pass

    price_min = filters.get('price_min')
    price_max = filters.get('price_max')
    if price_min is not None and price_min > 200:
        query = query.filter(Doctor.consultation_fee >= price_min)
    if price_max is not None and price_max < 2500:
        query = query.filter(Doctor.consultation_fee <= price_max)

    query = query.order_by(Doctor.created_at.desc())
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    # Format results with slot counts and symptom match info
    rating_min = filters.get('rating_min')
    # Admin display-pricing overlay for the whole page in one query — pulling
    # it per doctor inside the loop would be an N+1 on every search.
    from app.common.display_pricing import rules_for_doctors
    display_rules = rules_for_doctors([d.id for d in pagination.items])
    doctors = []
    for doctor in pagination.items:
        doc_data = DoctorListService.format_doctor_for_list(doctor)
        slot_count = doctor_slot_counts.get(str(doctor.id), 0)
        doc_data['available_slots'] = slot_count
        if slot_count == 0:
            doc_data['slot_status'] = 'red'
        elif slot_count <= 10:
            doc_data['slot_status'] = 'orange'
        else:
            doc_data['slot_status'] = 'green'

        # Extract consultation-type-specific pricing from slot_pricing.
        # ``decorate_tiers`` swaps the doctor's quoted fee for the admin
        # display price, so this card quotes what booking will charge.
        from app.common.display_pricing import (
            decorate_tiers, markdown_range, tier_card_extras,
        )
        all_pricing = decorate_tiers(doctor.id, doctor.slot_pricing, display_rules)
        ct_pricing = [
            p for p in all_pricing
            if p.get('consultation_type', 'complete') == consultation_type
        ]
        if ct_pricing:
            prices = [float(p.get('price', 0)) for p in ct_pricing if p.get('price') is not None]
            if prices:
                doc_data['price_min'] = min(prices)
                doc_data['price_max'] = max(prices)
                doc_data['consultation_fee'] = str(min(prices))
                doc_data['price_range'] = [
                    {'range': p.get('range'), 'price': float(p.get('price', 0)),
                     'description': p.get('description', ''),
                     **tier_card_extras(p)}
                    for p in ct_pricing
                ]
                # What the range was marked down FROM, so the card can slash
                # it. Only present when the admin overlay actually discounts
                # something — see ``display_pricing.markdown_range``.
                markdown = markdown_range(ct_pricing)
                doc_data.update(markdown)
                if markdown:
                    # ``consultation_fee`` is the headline number on this
                    # payload's card, and it tracks ``price_min`` — so its
                    # struck counterpart has to track the same end of the
                    # range, not the range as a whole.
                    doc_data['original_consultation_fee'] = str(
                        markdown['original_price_min'])

        # Symptom match score
        doc_data['symptom_match_count'] = symptom_match_counts.get(str(doctor.id), 0)
        doc_data['total_symptoms_searched'] = len(symptom_ids)

        if rating_min and doc_data.get('rating') and doc_data['rating'] < rating_min:
            continue
        if rating_min and not doc_data.get('rating'):
            continue

        doctors.append(doc_data)

    # Sort by symptom match count (descending) if symptoms were provided
    if symptom_ids:
        doctors.sort(key=lambda d: d['symptom_match_count'], reverse=True)

    return success_response(data={
        'doctors': doctors,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })


# ==========================================================================
# APPOINTMENT MEDICAL CONTEXT — CRUD for booking wizard state
# ==========================================================================

@patient_bp.route('/appointment-context', methods=['POST'])
@jwt_required()
@feature_required('patient.intake_forms')
@role_required(UserRole.PATIENT)
def create_appointment_context():
    """Create a draft medical context for a booking session."""
    from app.models import AppointmentMedicalContext, Patient
    from datetime import timedelta

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    data = request.get_json() or {}
    consultation_type = data.get('consultation_type')
    if not consultation_type:
        return validation_error_response({'consultation_type': 'Required'})

    from app.models import utcnow
    ctx = AppointmentMedicalContext(
        patient_id=patient.id,
        consultation_type=consultation_type,
        booking_for_id=data.get('booking_for_id'),
        house_group_member_id=data.get('house_group_member_id'),
        status='draft',
        expires_at=utcnow() + timedelta(hours=24),
    )
    db.session.add(ctx)
    db.session.commit()

    return created_response(data=ctx.to_dict(), message='Medical context created')


@patient_bp.route('/appointment-context/<context_id>', methods=['GET'])
@jwt_required()
@feature_required('patient.intake_forms')
@role_required(UserRole.PATIENT)
def get_appointment_context(context_id):
    """Get a medical context by ID."""
    from app.models import AppointmentMedicalContext, Patient

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    ctx = AppointmentMedicalContext.query.filter_by(
        id=context_id,
        patient_id=patient.id,
    ).first()
    if not ctx:
        return not_found_response('Medical context not found')

    data = ctx.to_dict()
    # The snapshots froze each shared record's attachment URLs at booking time
    # with a ~1-hour signed-URL expiry, so by the time the patient reopens the
    # booking the links are dead and "open" fails. Re-sign every attachment from
    # its stored s3_key on read so the file always opens (mirrors the doctor
    # side's snapshot refresh).
    for snap_key in ('records_snapshot', 'surgeries_snapshot'):
        for entry in (data.get(snap_key) or []):
            _enrich_attachments(entry, key='attachments')

    return success_response(data=data)


@patient_bp.route('/appointment-context/<context_id>', methods=['PUT'])
@jwt_required()
@feature_required('patient.intake_forms')
@role_required(UserRole.PATIENT)
def update_appointment_context(context_id):
    """
    Update a draft medical context (sharing toggles, symptoms, etc.).
    Also resolves and stores DATA SNAPSHOTS of the patient's actual vitals,
    habits, health records, and surgeries so the doctor sees real values.
    """
    from app.models import AppointmentMedicalContext, Patient, HealthRecord, Symptom
    from app.api.service_reciever.patient.service import HealthRecordService

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    ctx = AppointmentMedicalContext.query.filter_by(
        id=context_id,
        patient_id=patient.id,
    ).first()
    if not ctx:
        return not_found_response('Medical context not found')
    # Editable while a draft OR while its booking is still live — the patient
    # can revise what they shared right up until the service is completed /
    # cancelled. Once the booking is done the shared info is frozen.
    if not ctx.is_editable():
        return error_response(
            'This booking is already completed — the shared health information '
            'can no longer be changed.', status_code=409)

    data = request.get_json() or {}

    # Update booking target
    if 'booking_for_id' in data:
        ctx.booking_for_id = data['booking_for_id']
    if 'house_group_member_id' in data:
        ctx.house_group_member_id = data['house_group_member_id']

    # Update sharing toggles (keep raw toggles for audit)
    if 'shared_health_records' in data:
        ctx.shared_health_records = data['shared_health_records']
    if 'shared_vitals' in data:
        ctx.shared_vitals = data['shared_vitals']
    if 'shared_habits' in data:
        ctx.shared_habits = data['shared_habits']
    if 'shared_prescriptions' in data:
        ctx.shared_prescriptions = data['shared_prescriptions']

    # Update additional data
    if 'additional_vitals' in data:
        ctx.additional_vitals = data['additional_vitals']
    if 'additional_habits' in data:
        ctx.additional_habits = data['additional_habits']
    if 'additional_records' in data:
        ctx.additional_records = data['additional_records']
    if 'additional_prescriptions' in data:
        ctx.additional_prescriptions = data['additional_prescriptions']

    # Handle additional_details (description/remarks from booking wizard)
    if 'additional_details' in data:
        ctx.patient_notes = data['additional_details']

    # Update symptoms
    if 'selected_symptoms' in data:
        ctx.selected_symptoms = data['selected_symptoms']
    if 'selected_custom_symptoms' in data:
        ctx.selected_custom_symptoms = data['selected_custom_symptoms']

    # Update filter preferences
    if 'filter_preferences' in data:
        ctx.filter_preferences = data['filter_preferences']

    # ═══════════════════════════════════════════════════════════════════════
    # RESOLVE & STORE DATA SNAPSHOTS — capture actual patient data right now
    # so the doctor sees real values, not toggles.
    # ═══════════════════════════════════════════════════════════════════════
    target_patient_id = ctx.booking_for_id or ctx.patient_id

    # ── Vitals snapshot ──
    vitals_toggles = ctx.shared_vitals or {}
    if vitals_toggles and any(v for v in vitals_toggles.values()):
        all_vitals = HealthRecordService.get_latest_vitals(target_patient_id)
        resolved = {}
        if all_vitals:
            for key, is_shared in vitals_toggles.items():
                if is_shared and key in all_vitals:
                    resolved[key] = all_vitals[key]
        # Merge additional vitals provided during booking
        if ctx.additional_vitals:
            for key, val in ctx.additional_vitals.items():
                if val is not None and val != '':
                    resolved[key] = val
        ctx.vitals_snapshot = resolved if resolved else None
    else:
        # No toggles but there might be additional vitals
        if ctx.additional_vitals:
            ctx.vitals_snapshot = {k: v for k, v in ctx.additional_vitals.items() if v is not None and v != ''}
        else:
            ctx.vitals_snapshot = None

    # ── Habits snapshot ──
    habits_config = ctx.shared_habits or []
    visible_habit_keys = []
    if isinstance(habits_config, list):
        visible_habit_keys = [
            h.get('habit_key') for h in habits_config
            if h.get('visible', True) and h.get('habit_key')
        ]
    elif isinstance(habits_config, dict):
        visible_habit_keys = [k for k, v in habits_config.items() if v]

    if visible_habit_keys:
        all_habits = HealthRecordService.get_latest_habits(target_patient_id)
        resolved_habits = {}
        if all_habits:
            for hk in visible_habit_keys:
                if hk in all_habits:
                    resolved_habits[hk] = all_habits[hk]
        ctx.habits_snapshot = resolved_habits if resolved_habits else None
    else:
        ctx.habits_snapshot = None

    # ── Health records snapshot ──
    records_config = ctx.shared_health_records or []
    visible_record_ids = [
        r.get('record_id') for r in records_config
        if r.get('visible', True) and r.get('record_id')
    ]
    if visible_record_ids:
        records = HealthRecord.query.filter(
            HealthRecord.id.in_(visible_record_ids),
            HealthRecord.is_deleted == False,
        ).all()
        records_snap = []
        for rec in records:
            details = rec.details or {}
            record_entry = {
                'id': str(rec.id),
                'record_type': rec.record_type,
                'title': details.get('title', (rec.record_type or '').replace('_', ' ').title()),
                'record_date': str(rec.record_date) if rec.record_date else None,
                'notes': rec.notes,
                'details': details,
                'attachments': rec.attachment_links or [],
            }
            _enrich_attachments(record_entry, key='attachments')
            records_snap.append(record_entry)
        ctx.records_snapshot = records_snap if records_snap else None
    else:
        ctx.records_snapshot = None

    # ── Surgeries snapshot (shared_prescriptions holds surgery toggles) ──
    surgery_config = ctx.shared_prescriptions or []
    visible_surgery_ids = [
        s.get('prescription_id') for s in surgery_config
        if s.get('visible', True) and s.get('prescription_id')
    ]
    if visible_surgery_ids:
        surgery_records = HealthRecord.query.filter(
            HealthRecord.id.in_(visible_surgery_ids),
            HealthRecord.is_deleted == False,
        ).all()
        surgeries_snap = []
        for rec in surgery_records:
            details = rec.details or {}
            surgery_entry = {
                'id': str(rec.id),
                'surgery_type': details.get('surgery_type', rec.record_type or ''),
                'surgery_date': str(rec.record_date) if rec.record_date else None,
                'hospital': details.get('hospital', ''),
                'surgeon_name': details.get('surgeon_name', ''),
                'notes': rec.notes or details.get('notes', ''),
                'attachments': rec.attachment_links or [],
            }
            _enrich_attachments(surgery_entry, key='attachments')
            surgeries_snap.append(surgery_entry)
        ctx.surgeries_snapshot = surgeries_snap if surgeries_snap else None
    else:
        ctx.surgeries_snapshot = None

    db.session.commit()
    return success_response(data=ctx.to_dict(), message='Medical context updated')


@patient_bp.route('/appointment-context/<context_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PATIENT)
def delete_appointment_context(context_id):
    """Delete a draft medical context."""
    from app.models import AppointmentMedicalContext, Patient

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    ctx = AppointmentMedicalContext.query.filter_by(
        id=context_id,
        patient_id=patient.id,
        status='draft',
    ).first()
    if not ctx:
        return not_found_response('Draft medical context not found')

    db.session.delete(ctx)
    db.session.commit()
    return success_response(message='Medical context deleted')


@patient_bp.route('/appointment-context/<context_id>/link', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def link_appointment_context(context_id):
    """Link a medical context to a finalized booking.

    Accepts exactly one of ``appointment_id`` (consultation), ``marketplace_order_id``
    (a service/marketplace purchase), or ``group_offering_booking_id`` (a health
    plan / group offering) so the same intake object serves every booking flow.
    """
    from app.models import (
        AppointmentMedicalContext, Patient, Appointment, MarketplaceOrder,
        GroupOfferingBooking,
    )

    patient = Patient.query.filter_by(user_id=current_user.id).first()
    if not patient:
        return error_response('Patient profile not found', status_code=404)

    ctx = AppointmentMedicalContext.query.filter_by(
        id=context_id,
        patient_id=patient.id,
    ).first()
    if not ctx:
        return not_found_response('Medical context not found')

    data = request.get_json() or {}
    appointment_id = data.get('appointment_id')
    order_id = data.get('marketplace_order_id')
    group_booking_id = data.get('group_offering_booking_id')

    if appointment_id:
        appointment = Appointment.query.filter_by(
            id=appointment_id, patient_id=patient.id, is_deleted=False,
        ).first()
        if not appointment:
            return not_found_response('Appointment not found')
        ctx.appointment_id = appointment.id
    elif order_id:
        order = MarketplaceOrder.query.filter_by(
            id=order_id, patient_id=patient.id,
        ).first()
        if not order:
            return not_found_response('Order not found')
        ctx.marketplace_order_id = order.id
    elif group_booking_id:
        booking = GroupOfferingBooking.query.filter_by(
            id=group_booking_id, patient_id=patient.id,
        ).first()
        if not booking:
            return not_found_response('Group booking not found')
        ctx.group_offering_booking_id = booking.id
    else:
        return validation_error_response({
            'booking': 'One of appointment_id, marketplace_order_id or '
                       'group_offering_booking_id is required'})

    ctx.status = 'linked'
    db.session.commit()

    return success_response(data=ctx.to_dict(), message='Medical context linked to booking')


# ==========================================================================
# FOLLOW-UP INVITES
# ==========================================================================

@patient_bp.route('/follow-up-invites', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_follow_up_invites():
    """Get pending follow-up invites for the patient."""
    patient = PatientService.get_by_user_id(current_user.id)
    if not patient:
        return not_found_response('Patient profile')

    from app.api.common.follow_up.service import FollowUpService
    invites = FollowUpService.get_patient_invites(patient.id)

    return success_response(data={
        'invites': [inv.to_dict() for inv in invites],
    })


@patient_bp.route('/follow-up-invites/<invite_id>/book', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
def book_follow_up(invite_id):
    """
    Patient books a follow-up appointment from an invite.

    Body for paid_patient_picks:
        { "time_slot_id": "uuid" }

    Body for paid_doctor_picks:
        {} (uses pre-reserved slot)

    Returns appointment (status=PENDING_PAYMENT) for Razorpay payment flow.
    """
    from app.api.common.follow_up.service import FollowUpService

    data = request.get_json() or {}
    time_slot_id = data.get('time_slot_id')

    try:
        appointment = FollowUpService.book_from_invite(
            invite_id=invite_id,
            patient_user_id=current_user.id,
            time_slot_id=time_slot_id,
        )
        return success_response(
            message='Follow-up appointment created. Please proceed to payment.',
            data=appointment.to_dict(include_relations=True),
            status_code=201,
        )
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except PermissionError as e:
        return error_response(str(e), status_code=403)
