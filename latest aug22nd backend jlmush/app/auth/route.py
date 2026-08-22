"""
Auth Routes
API endpoints for authentication with rate limiting.

Endpoints:
- POST /auth/signup - Register new user (any role)
- POST /auth/signin - Login (all roles)
- POST /auth/refresh - Refresh access token
- POST /auth/logout - Logout current session
- POST /auth/logout-all - Logout all devices
- POST /auth/logout-other - Logout other devices (keep current)
- GET /auth/me - Get current user profile
- GET /auth/sessions - List active sessions
- DELETE /auth/sessions/<id> - Remote logout specific session
- POST /auth/change-password - Change password

Rate Limits:
- Login: 5/min per IP
- Signup: 3/min per IP
- Refresh: 10/min
- General: 100/min
"""
import logging
from flask import request, jsonify, current_app
from flask_jwt_extended import (
    jwt_required, 
    current_user, 
    get_jwt,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies
)

from app.auth import auth_bp
from app.auth.service import AuthService
from app.common.responses import success_response, error_response, validation_error_response, service_error_response
from app.common.decorators import validate_json
from app.extensions import limiter, credential_key
from app.models import User
from .validators import SignupSchemaPatient, SignupSchemaDoctor, LoginSchema, ChangePasswordSchema, validate_password_strength

logger = logging.getLogger(__name__)

@auth_bp.route('/signup', methods=['POST'])
@limiter.limit("3 per minute")
@validate_json(['phone_number', 'password', 'first_name', 'state', 'role'])
def signup():
    """
    Register a new user.
    
    Request Body:
        {
            "email": "user@example.com",
            "phone_number": "9876543210",
            "password": "SecurePass123!",
            "first_name": "John",
            "last_name": "Doe",
            "role": "patient"  // optional, default: patient
        }
    
    Returns:
        201: User registered successfully
        400: Validation error or user already exists
    """
    data = request.get_json()
    logger.debug(f"[AUTH:SIGNUP] ▶ START — email={data.get('email')}, role={data.get('role')}")
    
    # Validate input
    schema = SignupSchemaPatient()
    errors = schema.validate(data)
    if errors:
        logger.debug(f"[AUTH:SIGNUP] ✗ Validation failed: {errors}")
        return validation_error_response(errors)
    
    try:
        user = AuthService.signup(data)
        logger.debug(f"[AUTH:SIGNUP] ✓ DONE — user_id={user.id}, email={user.email}")

        response_data = {
            'user_id': str(user.id),
            'email': user.email,
            'role': user.role.value,
            'email_verification_required': bool(user.email and not user.email_verified),
        }

        message = 'Registration successful.'
        if response_data['email_verification_required']:
            message = 'Registration successful. Please verify your email to continue.'

        return success_response(
            data=response_data,
            message=message,
            status_code=201
        )
    except ValueError as e:
        logger.debug(f"[AUTH:SIGNUP] ✗ FAIL — {e}")
        return service_error_response(e)


@auth_bp.route('/signup/doctor', methods=['POST'])
@limiter.limit("3 per minute")
def signup_doctor():
    """
    Register a new doctor with multipart/form-data.
    
    Form Fields:
        - first_name, last_name, email, phone_number, password
        - state, referral_code, aadhar_number, registration_number
        - qualifications (JSON string array)
    
    Files:
        - registration_certificate
        - aadhar_attachment
        - qualification_certificate_0, qualification_certificate_1, ...
    
    Returns:
        201: Doctor registered successfully (pending approval)
        400: Validation error
    """
    import os
    import json
    import uuid
    from werkzeug.utils import secure_filename
    logger.debug(f"[AUTH:SIGNUP_DOCTOR] ▶ START — email={request.form.get('email')}")
    
    # Get form data
    data = {
        'first_name': request.form.get('first_name'),
        'last_name': request.form.get('last_name'),
        'email': request.form.get('email'),
        'phone_number': request.form.get('phone_number'),
        'password': request.form.get('password'),
        'state': request.form.get('state'),
        'referral_code': request.form.get('referral_code'),
        'aadhar_number': request.form.get('aadhar_number'),
        'registration_number': request.form.get('registration_number'),
        'role': 'doctor',
        'phone_verification_token': request.form.get('phone_verification_token'),
        'email_verification_token': request.form.get('email_verification_token'),
        # Round 2 — marketplace plan selection. Optional during the
        # transition; once the marketplace pricing grid is the
        # dominant signup entry point we'll tighten the validator to
        # require it. Empty / missing value → no MembershipSubscription
        # row is created at signup (back-compat with the old direct-to-
        # signup-page link).
        'plan_code': (request.form.get('plan_code') or '').strip() or None,
        # Round 5 — in-tenant plan selection. Sent by the doctor-signup
        # form when running inside a non-apex tenant subdomain that has
        # authored ≥1 active provider plan. The service layer branches
        # on tenant kind: apex tenants use ``plan_code`` (marketplace
        # MembershipPlan), other tenants use this (TenantProviderPlan).
        # Empty value is fine — the service then verifies whether a plan
        # was required at all (quota-only tenants don't need one).
        'tenant_provider_plan_id': (
            request.form.get('tenant_provider_plan_id') or ''
        ).strip() or None,
    }
    
    # Parse qualifications JSON
    qualifications_json = request.form.get('qualifications', '[]')
    try:
        data['qualifications'] = json.loads(qualifications_json)
    except json.JSONDecodeError:
        logger.debug(f"[AUTH:SIGNUP_DOCTOR] ✗ Invalid qualifications JSON")
        return validation_error_response({'qualifications': 'Invalid JSON format'})
    
    logger.debug(f"[AUTH:SIGNUP_DOCTOR] Form data collected, qualifications={len(data.get('qualifications', []))}")
    
    # Validate with schema
    schema = SignupSchemaDoctor()
    errors = schema.validate(data)
    if errors:
        logger.debug(f"[AUTH:SIGNUP_DOCTOR] ✗ Validation failed: {errors}")
        return validation_error_response(errors)
    
    logger.debug(f"[AUTH:SIGNUP_DOCTOR] Validation passed")
    # Validate required files
    if 'registration_certificate' not in request.files:
        return validation_error_response({'registration_certificate': 'Registration certificate is required'})
    if 'aadhar_attachment' not in request.files:
        return validation_error_response({'aadhar_attachment': 'Aadhaar attachment is required'})
    
    # Validate qualification certificates
    for i in range(len(data['qualifications'])):
        if f'qualification_certificate_{i}' not in request.files:
            return validation_error_response({f'qualification_certificate_{i}': f'Certificate for qualification {i+1} is required'})
    
    try:
        # Upload files to S3 instead of local filesystem
        from app.services.s3_service import S3Service

        def upload_to_s3(file, asset_type):
            """Upload file to S3 and return the S3 key.

            Identity / verification documents go to the PRIVATE bucket
            under a dedicated ``doctor-documents/`` folder. Previously
            this defaulted to the PUBLIC bucket under ``page-config/``,
            which is wrong on two counts: (a) Aadhaar / certificates
            should not be world-readable, and (b) the admin
            ``View document`` button calls ``S3Service.get_signed_url``
            which targets the private bucket — so the URL 404'd on
            ``NoSuchKey`` despite the file having uploaded fine.
            """
            if not file or file.filename == '':
                return None
            result = S3Service.upload_file(
                file, asset_type, file.filename,
                is_private=True, folder='doctor-documents',
            )
            return result['s3_key']

        # Save files to S3
        file_paths = {
            'registration_certificate': upload_to_s3(request.files['registration_certificate'], 'registration_certificate'),
            'aadhar_attachment': upload_to_s3(request.files['aadhar_attachment'], 'aadhar_document'),
            'qualification_certificates': []
        }
        
        for i in range(len(data['qualifications'])):
            cert_file = request.files.get(f'qualification_certificate_{i}')
            cert_path = upload_to_s3(cert_file, 'doctor_certificate')
            file_paths['qualification_certificates'].append(cert_path)
        
        # Create doctor
        user, doctor = AuthService.signup_doctor(data, file_paths)
        logger.debug(f"[AUTH:SIGNUP_DOCTOR] ✓ DONE — user_id={user.id}, doctor_id={doctor.id}")

        # Live-notify the tenant's admins that a verification is waiting —
        # after the signup commit, best-effort.
        from app.common.notify import push_to_super_admins
        push_to_super_admins(
            tenant_id=user.tenant_id,
            type='doctor_pending_verification',
            title='New doctor awaiting verification',
            body=f'{user.full_name or "A new doctor"} signed up and is '
                 'waiting for document verification.',
            data={'kind': 'approvals', 'doctor_id': str(doctor.id),
                  'url': '/dashboard/admin/approvals'},
        )

        return success_response(
            data={
                'user_id': str(user.id),
                'doctor_id': str(doctor.id),
                'email': user.email,
                'status': 'pending_approval'
            },
            message='Doctor registration successful. Your account is pending admin approval.',
            status_code=201
        )
    except ValueError as e:
        logger.debug(f"[AUTH:SIGNUP_DOCTOR] ✗ FAIL — {e}")
        return service_error_response(e)


# --------------------------------------------------------------------------- #
# Marketplace Clinic + Hospital signup (Round 3+4)
# --------------------------------------------------------------------------- #
# Both endpoints follow the doctor-signup pattern:
#   * multipart/form-data
#   * two file uploads (registration certificate + admin Aadhaar)
#   * phone + email OTP gating (mandatory)
#   * optional ``plan_code`` from the apex pricing card
#   * always returns 201 + pending_approval (admin must verify before
#     activation, same as doctor)
# Rate-limited to match doctor — same anti-spam profile.
# --------------------------------------------------------------------------- #

def _collect_facility_signup_data(role_label):
    """Pull form fields + parsed plan_code into a dict.

    Shared by clinic + hospital handlers. ``role_label`` is just used
    for log lines. Hospital adds ``hospital_type`` on top of this base
    set in the caller.
    """
    return {
        'first_name': request.form.get('first_name'),
        'last_name': request.form.get('last_name'),
        'email': request.form.get('email'),
        'phone_number': request.form.get('phone_number'),
        'password': request.form.get('password'),
        'state': request.form.get('state'),
        # Facility-level fields
        'name': request.form.get('name'),
        'registration_number': request.form.get('registration_number'),
        'address': request.form.get('address'),
        'city': request.form.get('city'),
        'pincode': request.form.get('pincode'),
        'phone': request.form.get('phone'),
        'website': request.form.get('website'),
        # OTP tokens (same shape as doctor)
        'phone_verification_token': request.form.get('phone_verification_token'),
        'email_verification_token': request.form.get('email_verification_token'),
        # Marketplace plan (optional — empty / missing means signup
        # without a tier; doctor signup uses the same convention).
        'plan_code': (request.form.get('plan_code') or '').strip() or None,
        # Entity (legal-entity) core fields — corporate facilities. Flat form
        # fields; AuthService._attach_entity_profile persists an EntityProfile
        # when entity_type is non-individual. Docs/logos/personnel come later
        # in the profile.
        'entity_type': request.form.get('entity_type'),
        'entity_name': request.form.get('entity_name'),
        'legal_name': request.form.get('legal_name'),
        'trade_name': request.form.get('trade_name'),
        'promoters': request.form.get('promoters'),
        'year_of_establishment': request.form.get('year_of_establishment'),
        'registration_license_number': request.form.get('registration_license_number'),
        'cin_number': request.form.get('cin_number'),
        'gst_number': request.form.get('gst_number'),
        'pan_number': request.form.get('pan_number'),
    }


def _upload_facility_files():
    """S3-upload the two required files for a facility signup.

    Returns ``file_paths`` dict in the same shape ``signup_clinic`` /
    ``signup_hospital`` expect. Raises ``validation_error_response``
    (via the caller) when required files are missing.
    """
    from app.services.s3_service import S3Service

    if 'registration_certificate' not in request.files:
        return None, validation_error_response({
            'registration_certificate': 'Registration certificate is required',
        })
    if 'admin_aadhaar_attachment' not in request.files:
        return None, validation_error_response({
            'admin_aadhaar_attachment': "Admin's Aadhaar attachment is required",
        })

    def upload_to_s3(file, asset_type):
        if not file or file.filename == '':
            return None
        # Identity / verification documents go to the PRIVATE bucket
        # under a dedicated ``facility-documents/`` folder. Previously
        # this defaulted to ``page-config/`` in the PUBLIC bucket,
        # which (a) leaked Aadhaar attachments to anyone with the URL
        # and (b) broke the admin's "View document" button because
        # the presigner targets the private bucket by default.
        result = S3Service.upload_file(
            file, asset_type, file.filename,
            is_private=True, folder='facility-documents',
        )
        return result['s3_key']

    file_paths = {
        'registration_certificate': upload_to_s3(
            request.files['registration_certificate'],
            'registration_certificate',
        ),
        'admin_aadhaar_attachment': upload_to_s3(
            request.files['admin_aadhaar_attachment'],
            'aadhar_document',
        ),
    }
    return file_paths, None


@auth_bp.route('/signup/clinic', methods=['POST'])
@limiter.limit("3 per minute")
def signup_clinic():
    """Register a marketplace clinic via multipart/form-data.

    Form fields (all required unless noted): first_name, last_name,
    email, phone_number, password, state, name, registration_number,
    address, city, pincode, phone (optional), website (optional),
    phone_verification_token, email_verification_token, plan_code
    (optional — from the apex pricing card).

    Files (both required): registration_certificate, admin_aadhaar_attachment.

    Returns 201 with ``status='pending_approval'`` — admin must
    verify before the account activates (and before the marketplace
    trial clock starts).
    """
    logger.debug(
        f"[AUTH:SIGNUP_CLINIC] ▶ START — email={request.form.get('email')}"
    )
    data = _collect_facility_signup_data('clinic')

    file_paths, file_err = _upload_facility_files()
    if file_err is not None:
        return file_err

    try:
        user, clinic = AuthService.signup_clinic(data, file_paths)
        logger.debug(
            f"[AUTH:SIGNUP_CLINIC] ✓ DONE — user_id={user.id}, clinic_id={clinic.id}"
        )
        from app.common.notify import push_to_super_admins
        push_to_super_admins(
            tenant_id=user.tenant_id,
            type='clinic_pending_verification',
            title='New clinic awaiting verification',
            body=f'{user.full_name or "A new clinic"} signed up and is '
                 'waiting for document verification.',
            data={'kind': 'approvals', 'clinic_id': str(clinic.id),
                  'url': '/dashboard/admin/approvals'},
        )
        return success_response(
            data={
                'user_id': str(user.id),
                'clinic_id': str(clinic.id),
                'email': user.email,
                'status': 'pending_approval',
            },
            message=(
                'Clinic registration successful. '
                'Your account is pending admin approval.'
            ),
            status_code=201,
        )
    except ValueError as e:
        logger.debug(f"[AUTH:SIGNUP_CLINIC] ✗ FAIL — {e}")
        return service_error_response(e)


@auth_bp.route('/signup/hospital', methods=['POST'])
@limiter.limit("3 per minute")
def signup_hospital():
    """Register a marketplace hospital via multipart/form-data.

    Same shape as ``signup_clinic`` plus an optional ``hospital_type``
    form field (e.g. ``'multi-speciality'``). Two file uploads
    (registration cert + admin Aadhaar) are required.
    """
    logger.debug(
        f"[AUTH:SIGNUP_HOSPITAL] ▶ START — email={request.form.get('email')}"
    )
    data = _collect_facility_signup_data('hospital')
    data['hospital_type'] = request.form.get('hospital_type')

    file_paths, file_err = _upload_facility_files()
    if file_err is not None:
        return file_err

    try:
        user, hospital = AuthService.signup_hospital(data, file_paths)
        logger.debug(
            f"[AUTH:SIGNUP_HOSPITAL] ✓ DONE — user_id={user.id}, hospital_id={hospital.id}"
        )
        from app.common.notify import push_to_super_admins
        push_to_super_admins(
            tenant_id=user.tenant_id,
            type='hospital_pending_verification',
            title='New hospital awaiting verification',
            body=f'{user.full_name or "A new hospital"} signed up and is '
                 'waiting for document verification.',
            data={'kind': 'approvals', 'hospital_id': str(hospital.id),
                  'url': '/dashboard/admin/approvals'},
        )
        return success_response(
            data={
                'user_id': str(user.id),
                'hospital_id': str(hospital.id),
                'email': user.email,
                'status': 'pending_approval',
            },
            message=(
                'Hospital registration successful. '
                'Your account is pending admin approval.'
            ),
            status_code=201,
        )
    except ValueError as e:
        logger.debug(f"[AUTH:SIGNUP_HOSPITAL] ✗ FAIL — {e}")
        return service_error_response(e)


@auth_bp.route('/pre-signup/send-phone-otp', methods=['POST'])
@limiter.limit("3 per minute")
@validate_json(['phone_number'])
def pre_signup_send_phone_otp():
    """
    Send OTP to phone number for pre-signup verification (Combirds SMS).
    Returns 400 if phone is already registered in this tenant.
    """
    data = request.get_json()
    phone_number = data.get('phone_number', '').strip()
    # ``first_name`` is optional. The DLT-approved signup_otp template
    # includes a ``Hi {first_name}.`` prefix, so when the frontend can
    # supply it (signup form already collected it before OTP step) we
    # render the personalized message; otherwise we fall back to "there".
    first_name = (data.get('first_name') or '').strip() or None
    logger.debug(f"[AUTH:PRE_SIGNUP_PHONE] Send OTP request")

    try:
        AuthService.send_pre_signup_phone_otp(phone_number, first_name=first_name)
        return success_response(message='OTP sent to your mobile number.')
    except ValueError as e:
        return service_error_response(e)


@auth_bp.route('/pre-signup/verify-phone-otp', methods=['POST'])
@limiter.limit("10 per minute")
@validate_json(['phone_number', 'otp'])
def pre_signup_verify_phone_otp():
    """
    Verify phone OTP and return a short-lived verification JWT.
    Frontend stores this token and sends it with the signup form as
    ``phone_verification_token``.
    """
    data = request.get_json()
    phone_number = data.get('phone_number', '').strip()
    otp = data.get('otp', '').strip()
    logger.debug(f"[AUTH:PRE_SIGNUP_PHONE] Verify OTP request")

    try:
        token = AuthService.verify_pre_signup_phone_otp(phone_number, otp)
        return success_response(data={'token': token}, message='Phone number verified successfully.')
    except ValueError as e:
        return service_error_response(e)


# Pre-signup EMAIL OTP — verifies the user actually owns the email
# *before* the signup row is written. Mirrors the phone OTP flow.
# Email is optional at signup; this endpoint is only called when an
# email was supplied on the signup form.

@auth_bp.route('/pre-signup/send-email-otp', methods=['POST'])
@limiter.limit("3 per minute")
@validate_json(['email'])
def pre_signup_send_email_otp():
    """Send a 6-digit OTP to the supplied email for pre-signup verification.

    Request Body:
        {"email": "user@example.com", "first_name": "John"}   # first_name optional

    Returns:
        200: OTP dispatched
        400: Email already registered in this tenant / send failed
    """
    data = request.get_json()
    email = (data.get('email') or '').strip()
    first_name = (data.get('first_name') or '').strip() or None
    logger.debug(f"[AUTH:PRE_SIGNUP_EMAIL] Send OTP request")
    try:
        AuthService.send_pre_signup_email_otp(email, first_name=first_name)
        return success_response(message='OTP sent to your email.')
    except ValueError as e:
        return service_error_response(e)


@auth_bp.route('/pre-signup/verify-email-otp', methods=['POST'])
@limiter.limit("10 per minute")
@validate_json(['email', 'otp'])
def pre_signup_verify_email_otp():
    """Verify the OTP and return a short-lived ``email_verification_token``.

    Request Body:
        {"email": "user@example.com", "otp": "123456"}

    Returns:
        200: { "token": "<jwt>" }
        400: Invalid / expired OTP
    """
    data = request.get_json()
    email = (data.get('email') or '').strip()
    otp = (data.get('otp') or '').strip()
    if not otp.isdigit() or len(otp) != 6:
        return error_response('OTP must be a 6-digit number.', status_code=400)
    logger.debug(f"[AUTH:PRE_SIGNUP_EMAIL] Verify OTP request")
    try:
        token = AuthService.verify_pre_signup_email_otp(email, otp)
        return success_response(data={'token': token}, message='Email verified successfully.')
    except ValueError as e:
        return service_error_response(e)


@auth_bp.route('/signin', methods=['POST'])
@limiter.limit("5 per minute")
# Second axis: per-target-credential, so a distributed brute-force of ONE
# account from many IPs is capped too (the IP limit above only stops one
# machine spraying). Looser than the IP limit — legit users retry.
@limiter.limit("15 per hour", key_func=credential_key)
@validate_json(['password'])
def signin():
    """
    Authenticate user and set HTTP-only cookies.
    
    Request Body:
        {
            "email": "user@example.com",  // OR
            "phone_number": "9876543210",  // OR
            "aadhar_number": "123456789012",
            "password": "SecurePass123!",
            "device_info": {}  // optional
        }
    
    Returns:
        200: Login successful with cookies set
        401: Invalid credentials
        403: Session limit reached
    """
    logger.debug(f"[AUTH:SIGNIN] ▶ START")
    data = request.get_json()
    
    # Determine identifier type
    id_type = 'email' if data.get('email') else ('phone' if data.get('phone_number') else 'aadhar')
    logger.debug(f"[AUTH:SIGNIN] Identifier type={id_type}")
    expected_role = data.get('expected_role')  # 'patient', 'doctor', 'admin', or None

    # Validate with LoginSchema (load to strip unknown fields)
    schema = LoginSchema()
    errors = schema.validate(data)
    if errors:
        logger.debug(f"[AUTH:SIGNIN] ✗ Validation failed: {errors}")
        logger.debug(f"[AUTH:SIGNIN]   payload keys: {list(data.keys())}")
        return validation_error_response(errors)
    
    try:
        user, access_token, refresh_token, session_id = AuthService.signin(
            identifier=data.get('email') or data.get('phone_number') or data.get('aadhar_number'),
            identifier_type=id_type,
            password=data['password'],
            device_info=data.get('device_info'),
            expected_role=expected_role,
            tenant_slug=data.get('tenant_slug'),
        )
        
        logger.debug(f"[AUTH:SIGNIN] ✓ DONE — user_id={user.id}, role={user.role.value}, session_id={session_id}")
        from app.common.client_context import audit_event
        audit_event('auth.signin_ok', user=str(user.id), role=user.role.value)

        # success_response returns (flask.Response, status); we still
        # need the Response object to attach HTTP-only auth cookies.
        # Tokens are ALSO returned in the response body so a cross-
        # site frontend (e.g. a tenant on a custom domain where
        # third-party cookies are blocked) can stash them in
        # localStorage and send them as ``Authorization: Bearer …``
        # on subsequent calls. JWT_TOKEN_LOCATION includes both
        # ``headers`` and ``cookies`` so either path authenticates.
        resp, status_code = success_response(
            data={
                'user': user.to_dict(),
                'session_id': session_id,
                'access_token': access_token,
                'refresh_token': refresh_token,
            },
            message='Login successful',
        )
        set_access_cookies(resp, access_token)
        set_refresh_cookies(resp, refresh_token)
        return resp, status_code
    except Exception as e:
        error_msg = str(e)
        logger.debug(f"[AUTH:SIGNIN] ✗ FAIL — {error_msg}")
        # Hash, never the raw identifier: the shipped log must not carry PII.
        import hashlib as _hl
        from app.common.client_context import audit_event
        _ident = str(data.get('email') or data.get('phone_number') or '').lower()
        audit_event('auth.signin_failed', reason=error_msg[:64],
                    ident_hash=_hl.sha256(_ident.encode()).hexdigest()[:16] if _ident else None)

        # Role mismatch — user trying to login from wrong page
        if error_msg == 'ROLE_MISMATCH':
            return error_response(
                'This account cannot be used to login from this page. '
                'Please use the correct login page for your account type.',
                status_code=403,
                code='ROLE_MISMATCH',
            )

        # Email not verified — frontend should redirect to verify flow.
        # Recommend phone login as the unblocked alternative.
        if error_msg == 'EMAIL_NOT_VERIFIED':
            return error_response(
                'Email not verified. Sign in with your phone number, then '
                'verify your email from your account settings.',
                status_code=403,
                code='EMAIL_NOT_VERIFIED',
            )

        # Round 8.5: invited doctors (admin-created accounts) must
        # walk through the activation link before they can sign in.
        if error_msg == 'PENDING_ACTIVATION':
            return error_response(
                'Your account was created by an admin and needs to be '
                'activated. Please open the activation link sent to your '
                'email or phone.',
                status_code=403,
                code='PENDING_ACTIVATION',
            )

        # Round 8.5: phone verification gate (mirror of email gate).
        if error_msg == 'PHONE_NOT_VERIFIED':
            return error_response(
                'Phone number not verified. Please complete phone '
                'verification before signing in.',
                status_code=403,
                code='PHONE_NOT_VERIFIED',
            )

        # Return 403 for session limit, 401 for invalid credentials.
        # Distinct codes: the mobile app shows the "manage sessions" sheet
        # for the first and a plain retry for the second.
        if 'session' in error_msg.lower():
            return error_response(error_msg, status_code=403,
                                  code='session_limit_reached')
        return error_response(error_msg, status_code=401,
                              code='invalid_credentials')


@auth_bp.route('/refresh', methods=['POST'])
@limiter.limit("10 per minute")
@jwt_required(refresh=True)
def refresh():
    """
    Refresh access token using Redis-backed single-use refresh tokens.
    
    SECURITY INVARIANTS:
    - Redis health check first (fail closed if unavailable)
    - Token is consumed atomically (single-use)
    - Always rotates to new token
    - All errors return 401 (no differentiation externally)
    
    Returns:
        200: New access and refresh tokens
        401: Any failure (session invalid, replay, Redis down)
    """
    from app.auth.session_store import SessionStore
    
    logger.debug(f"[AUTH:REFRESH] ▶ START — user={current_user.id if current_user else 'none'}")
    
    # FAIL CLOSED: Check Redis health first
    if not SessionStore.is_redis_healthy():
        logger.error("[AUTH:REFRESH] ✗ FAIL — Redis unavailable, failing closed")
        return error_response('Session invalid', status_code=401)
    
    jwt_data = get_jwt()
    session_id = jwt_data.get('session_id')

    # Refresh-token resolution. Cookies are first-party only on the
    # platform domain; cross-site frontends (tenant custom domains)
    # need an alternate source. Order:
    #   1. Cookie ``refresh_token`` (set by /auth/signin same-site).
    #   2. ``Authorization: Bearer <refresh_token>`` header — frontend
    #      sends the refresh JWT here on the /auth/refresh call.
    #   3. JSON body ``refresh_token`` (last-resort fallback for
    #      callers that already use Authorization for something else).
    refresh_token = request.cookies.get('refresh_token')
    if not refresh_token:
        auth_hdr = request.headers.get('Authorization', '')
        if auth_hdr.lower().startswith('bearer '):
            refresh_token = auth_hdr[7:].strip()
    if not refresh_token:
        body = request.get_json(silent=True) or {}
        refresh_token = body.get('refresh_token')

    if not refresh_token:
        logger.warning(
            '[AUTH:REFRESH] ✗ FAIL — No refresh token in cookies or body',
        )
        return error_response('Session invalid', status_code=401)

    logger.debug(f"[AUTH:REFRESH] session_id={session_id}")

    try:
        # Service layer handles all security logic
        new_access_token, new_refresh_token = AuthService.refresh_tokens(
            current_user,
            session_id,
            refresh_token
        )

        logger.debug(f"[AUTH:REFRESH] ✓ DONE — tokens rotated for session={session_id}")

        # Return tokens in body too — same rationale as signin: a
        # cross-site frontend keeps them in localStorage and replays
        # via ``Authorization: Bearer …`` going forward.
        response, status_code = success_response(
            data={
                'access_token': new_access_token,
                'refresh_token': new_refresh_token,
            },
            message='Token refreshed successfully',
        )
        set_access_cookies(response, new_access_token)
        set_refresh_cookies(response, new_refresh_token)
        return response, status_code
        
    except ValueError as e:
        # All errors return uniform 401 (no differentiation for security)
        logger.warning(f"[AUTH:REFRESH] ✗ FAIL — {str(e)}")
        return error_response('Session invalid', status_code=401)
    except Exception as e:
        # Unexpected errors also fail closed
        logger.error(f"[AUTH:REFRESH] ✗ ERROR (unexpected) — {str(e)}")
        return error_response('Session invalid', status_code=401)


@auth_bp.route('/force-logout-all', methods=['POST'])
@limiter.limit("5 per minute")
@validate_json(['password'])
def force_logout_all():
    """
    Force logout from all devices using credentials (no JWT required).
    Used when session limit is reached and user can't login.
    
    Request Body:
        {
            "email": "user@example.com",  // OR phone_number OR aadhar_number
            "password": "SecurePass123!"
        }
    
    Returns:
        200: All sessions logged out
        401: Invalid credentials
    """
    from app.common.encryption import hash_for_search
    from app.common.tenant_context import current_tenant_id_or_default

    data = request.get_json()

    # Find user
    identifier = data.get('email') or data.get('phone_number') or data.get('aadhar_number')
    logger.debug(f"[AUTH:FORCE_LOGOUT_ALL] ▶ START — identifier_present={bool(identifier)}")

    if not identifier:
        return error_response('Email, phone number, or Aadhaar required', status_code=400)

    identifier_hash = hash_for_search(identifier)
    # Lookup MUST be tenant-scoped — the same email/phone/aadhaar can
    # legitimately exist in N tenants (one row per tenant). Without the
    # filter we'd act on whichever tenant happened to insert first.
    tenant_id = current_tenant_id_or_default()

    if data.get('email'):
        user = User.query.filter_by(
            _email_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    elif data.get('phone_number'):
        user = User.query.filter_by(
            _phone_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    else:
        # Aadhaar lookup: aadhar_number is stored as plain text on the Doctor model
        from app.models.doctor import Doctor
        doctor = Doctor.query.filter_by(
            aadhar_number=identifier, tenant_id=tenant_id, is_deleted=False,
        ).first()
        user = doctor.user if doctor else None

    if not user or not user.check_password(data['password']):
        logger.debug(f"[AUTH:FORCE_LOGOUT_ALL] ✗ Invalid credentials")
        return error_response('Invalid credentials', status_code=401)
    
    # Logout all sessions
    AuthService.logout_all(user.id)
    logger.debug(f"[AUTH:FORCE_LOGOUT_ALL] ✓ DONE — user_id={user.id}")
    
    return success_response(
        message='All sessions logged out. You can now login.',
        data={'logged_out': True}
    )


@auth_bp.route('/active-sessions', methods=['POST'])
@limiter.limit("10 per minute")
@validate_json(['password'])
def list_active_sessions_by_credentials():
    """
    List active sessions using credentials (no JWT required).
    Used to show session list on login page when session limit is reached.
    
    Request Body:
        {
            "email": "user@example.com",  // OR phone_number
            "password": "SecurePass123!"
        }
    
    Returns:
        200: List of active sessions
        401: Invalid credentials
    """
    from app.common.encryption import hash_for_search
    from app.common.tenant_context import current_tenant_id_or_default

    data = request.get_json()

    # Find user
    identifier = data.get('email') or data.get('phone_number') or data.get('aadhar_number')
    if not identifier:
        return error_response('Email, phone number, or Aadhaar required', status_code=400)

    identifier_hash = hash_for_search(identifier)
    tenant_id = current_tenant_id_or_default()

    if data.get('email'):
        user = User.query.filter_by(
            _email_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    elif data.get('phone_number'):
        user = User.query.filter_by(
            _phone_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    else:
        user = None

    if not user or not user.check_password(data['password']):
        return error_response('Invalid credentials', status_code=401)

    sessions = AuthService.get_active_sessions(user.id)

    return success_response(data={'sessions': sessions})


@auth_bp.route('/force-logout-session', methods=['POST'])
@limiter.limit("10 per minute")
@validate_json(['password', 'session_id'])
def force_logout_session():
    """
    Force logout a specific session using credentials (no JWT required).
    
    Request Body:
        {
            "email": "user@example.com",  // OR phone_number
            "password": "SecurePass123!",
            "session_id": "uuid-of-session"
        }
    
    Returns:
        200: Session logged out
        401: Invalid credentials
        404: Session not found
    """
    from app.common.encryption import hash_for_search
    from app.common.tenant_context import current_tenant_id_or_default

    data = request.get_json()

    # Find user
    identifier = data.get('email') or data.get('phone_number') or data.get('aadhar_number')
    if not identifier:
        return error_response('Email, phone number, or Aadhaar required', status_code=400)

    identifier_hash = hash_for_search(identifier)
    tenant_id = current_tenant_id_or_default()

    if data.get('email'):
        user = User.query.filter_by(
            _email_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    elif data.get('phone_number'):
        user = User.query.filter_by(
            _phone_hash=identifier_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
    else:
        user = None

    if not user or not user.check_password(data['password']):
        return error_response('Invalid credentials', status_code=401)

    session_id = data['session_id']
    success = AuthService.remote_logout(user.id, session_id)
    
    if success:
        return success_response(message='Session logged out successfully')
    else:
        return error_response('Session not found', status_code=404)


@auth_bp.route('/account/delete', methods=['POST'])
@jwt_required()
@limiter.limit("3 per minute")
def delete_account():
    """Self-serve account deletion: deactivate + anonymize.

    Clinical records are retained (statutory retention) — only the AUTH
    identity is anonymized: email/phone/names wiped, password unusable,
    status INACTIVE + soft-deleted, every session revoked. The real phone
    number becomes free for a future fresh registration.

    Request Body:
        {"password": "<current password>", "reason": "optional free text"}

    Returns:
        200: Account deleted (cookies cleared)
        401: Password incorrect
        409: Deletion blocked (code says why: owner_account /
             facility_account / last_super_admin / managed_minors /
             upcoming_appointments / managed_account)
    """
    from app.auth.service import AccountDeletionBlocked, InvalidPassword

    data = request.get_json() or {}
    password = data.get('password') or ''
    if not password:
        return error_response('Your current password is required.', status_code=400)

    logger.info(f"[AUTH:DELETE_ACCOUNT] ▶ user_id={current_user.id} "
                f"role={current_user.role.value}")
    try:
        AuthService.delete_account(
            current_user, password, reason=data.get('reason'))
    except InvalidPassword:
        return error_response('Password is incorrect.', status_code=401)
    except AccountDeletionBlocked as e:
        return error_response(str(e), status_code=409, code=e.code)

    from app.common.client_context import audit_event
    audit_event('auth.account_deleted', user=str(current_user.id))
    response, status_code = success_response(
        message='Your account has been deleted. Your medical records are '
                'retained as required by law, but they are no longer '
                'linked to a login or to your contact details.')
    unset_jwt_cookies(response)
    return response, status_code


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """
    Logout current session.
    Clears cookies, deletes refresh token from Redis, marks session revoked in DB.
    
    Returns:
        200: Logged out successfully
    """
    jwt_data = get_jwt()
    session_id = jwt_data.get('session_id')
    refresh_jti = jwt_data.get('refresh_jti')  # jti stored in access token
    
    logger.debug(f"[AUTH:LOGOUT] ▶ user_id={current_user.id}, session_id={session_id}")
    AuthService.logout(session_id, str(current_user.id), refresh_jti)
    logger.debug(f"[AUTH:LOGOUT] ✓ DONE")
    
    response, status_code = success_response(message='Logged out successfully')
    unset_jwt_cookies(response)
    return response, status_code


@auth_bp.route('/logout-all', methods=['POST'])
@jwt_required()
def logout_all():
    """
    Logout from all devices.

    Returns:
        200: Logged out from all devices
    """
    logger.debug(f"[AUTH:LOGOUT_ALL] ▶ user_id={current_user.id}")
    AuthService.logout_all(current_user.id)
    logger.debug(f"[AUTH:LOGOUT_ALL] ✓ DONE")

    # Best-effort multi-channel security notification.
    try:
        from app.services.email_service import EmailService
        from app.services.sms_service import SMSService
        from datetime import datetime, timezone
        timestamp = datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')
        EmailService.send_logout_all_email(current_user, timestamp=timestamp)
        SMSService.send_logout_all_sms(current_user)
    except Exception as e:
        logger.warning(f"[AUTH:LOGOUT_ALL] notification failed: {e}")

    response, status_code = success_response(message='Logged out from all devices')
    unset_jwt_cookies(response)
    return response, status_code


@auth_bp.route('/logout-other', methods=['POST'])
@jwt_required()
def logout_other():
    """
    Logout from all other devices except current session.
    
    Returns:
        200: Number of sessions logged out
    """
    jwt_data = get_jwt()
    session_id = jwt_data.get('session_id')
    
    count = AuthService.logout_other_sessions(current_user.id, session_id)
    
    return success_response(
        data={'logged_out_count': count},
        message=f'Logged out from {count} other device(s)'
    )


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_profile():
    """
    Get current user profile + tenant context.

    The ``tenant_context`` block is the BACKEND-AUTHORITATIVE answer
    to "is this request on the platform host?" — it's computed from
    the request's actual host (resolved server-side in
    ``before_request``), not a frontend build-time env var. The
    frontend uses this to decide whether to show platform-owner
    sidebar items (Tenants / Plans / Add-ons).

    Why this matters: build-time env vars (``VITE_PUBLIC_BASE_DOMAIN``)
    can drift from the actual runtime host on a deploy where the
    operator forgot to set the var. The backend always knows the
    real host. Frontend reads ``user.tenant_context.is_platform_host``
    and never has to guess.

    Note: this is purely UI gating. Authorization (role checks) is
    enforced separately at every ``/api/platform/*`` endpoint via
    ``@role_required(UserRole.PLATFORM_OWNER)``. A client that
    fakes ``is_platform_host=true`` to itself can show the items
    in its UI but will still hit 403 when it calls the actual API.

    Returns:
        200: User profile data + tenant_context
    """
    logger.debug(f"[AUTH:PROFILE] ▶ user_id={current_user.id}")
    from flask import g

    # Tenant + platform-host context — already computed by
    # before_request and stashed on g. We just look up the slug/
    # domain for display.
    tenant_id = getattr(g, 'tenant_id', None)
    is_platform_host = bool(getattr(g, 'is_platform_host', False))
    tenant_slug = None
    tenant_domain = None
    is_default_tenant = False
    is_platform_tenant = False
    # Super-admin provider-directory visibility (doctors/hospitals/clinics).
    # Doctors read this to decide which "Discover" directories to show.
    provider_visibility = {'doctors': False, 'hospitals': False, 'clinics': False}
    if tenant_id:
        from app.models import Tenant
        t = Tenant.query.filter_by(id=tenant_id).first()
        if t:
            tenant_slug = t.slug
            tenant_domain = t.domain
            is_default_tenant = bool(t.is_default)
            is_platform_tenant = bool(t.is_platform)
            _vis = (t.settings or {}).get('provider_visibility', {})
            provider_visibility = {k: bool(_vis.get(k, False))
                                   for k in ('doctors', 'hospitals', 'clinics')}

    # Resolved plan + feature set. The frontend uses this to gate
    # sidebar items and admin sub-pages — same data the backend's
    # ``@feature_required`` decorator checks at request time, so the
    # two surfaces can never disagree.
    plan_code = None
    feature_paths = []  # flat list: ['admin.landing_builder', ...]
    plan_limits = {}
    plan_features_tree = {}  # nested dict for advanced UI use
    plan_addons = []
    subscription_info = None
    if tenant_id and not is_platform_tenant:
        try:
            from app.api.pricing.service import (
                PlanService, ALLOWED_FEATURE_PATHS, _walk_to_leaf,
            )
            from app.models import SubscriptionStatus
            resolved = PlanService.resolve(tenant_id)
            plan_code = resolved.plan_code
            plan_limits = dict(resolved.limits or {})
            plan_features_tree = resolved.to_dict().get('features') or {}
            plan_addons = list(resolved.active_addons or [])
            # A SUSPENDED subscription keeps no features (same rule the
            # backend's FeatureGate enforces) — the empty list makes the
            # sidebar collapse to the role-gated pages (billing, gateway).
            if resolved.subscription_status == SubscriptionStatus.SUSPENDED:
                feature_paths = []
            else:
                feature_paths = sorted(
                    p for p in ALLOWED_FEATURE_PATHS
                    if _walk_to_leaf(resolved.features, p)
                )
            # Billing surface: status + the dates the banner/billing page
            # need. Kept beside plan_code rather than a second endpoint so
            # the frontend learns about suspension on the first request.
            from app.models import TenantSubscription
            sub_row = TenantSubscription.query.filter_by(
                tenant_id=tenant_id, is_deleted=False,
            ).first()
            if sub_row is not None:
                subscription_info = {
                    'status': sub_row.status.value,
                    'billing_cycle': sub_row.billing_cycle.value,
                    'trial_ends_at': (
                        sub_row.trial_ends_at.isoformat()
                        if sub_row.trial_ends_at else None),
                    'current_period_end': (
                        sub_row.current_period_end.isoformat()
                        if sub_row.current_period_end else None),
                    'suspend_after': (
                        sub_row.suspend_after.isoformat()
                        if sub_row.suspend_after else None),
                }
        except Exception as exc:  # pragma: no cover — telemetry, never break /me
            logger.warning(
                '[AUTH:PROFILE] plan resolution failed for tenant=%s: %s',
                tenant_id, exc,
            )

    # Reseller entitlement — quotas only when apex (one children count);
    # vendor and sub-tenants read {'is_apex': False}. Same never-break-/me
    # discipline as the plan block above.
    reseller_info = {'is_apex': False}
    if tenant_id and not is_platform_tenant:
        try:
            from app.api.pricing.service import ResellerPolicy
            if ResellerPolicy.is_apex(tenant_id):
                quotas = ResellerPolicy.child_quotas(tenant_id)
                counts = ResellerPolicy.child_counts(tenant_id)
                reseller_info = {
                    'is_apex': True,
                    'quotas': {
                        'subdomains': {'used': counts['subdomains'],
                                       'allowed': quotas['subdomains']},
                        'custom_domains': {'used': counts['custom_domains'],
                                           'allowed': quotas['custom_domains']},
                    },
                }
        except Exception as exc:  # pragma: no cover
            logger.warning(
                '[AUTH:PROFILE] reseller resolution failed for tenant=%s: %s',
                tenant_id, exc,
            )

    body = current_user.to_dict()
    # The USER's own organisation — distinct from ``is_platform_host``
    # (the request's host). True for the vendor's staff wherever they
    # browse from; drives platform-console visibility for non-owner
    # staff, and ``platform_access`` re-checks the same fact server-side
    # on every console request.
    from app.models import Tenant as _UserTenant
    _own = (_UserTenant.query.filter_by(id=current_user.tenant_id).first()
            if current_user.tenant_id else None)
    body['is_platform_staff'] = bool(_own is not None and _own.is_platform)
    body['tenant_context'] = {
        'tenant_id': str(tenant_id) if tenant_id else None,
        'tenant_slug': tenant_slug,
        'tenant_domain': tenant_domain,
        'is_default_tenant': is_default_tenant,
        # Source of truth for "should the platform-owner console show".
        # Frontend MUST gate UI on this, NOT on a build-time env var.
        'is_platform_host': is_platform_host,
        # Plan resolution. ``feature_paths`` is the flat enabled list
        # — frontend just does ``feature_paths.includes('admin.x')``.
        # The nested ``features_tree`` is preserved for any UI that
        # needs the full structure (limits, sub-flags, etc).
        'plan_code': plan_code,
        'feature_paths': feature_paths,
        'plan_features_tree': plan_features_tree,
        'plan_limits': plan_limits,
        'plan_addons': plan_addons,
        # SaaS billing state (None for the vendor tenant / on failure).
        'subscription': subscription_info,
        # Super-admin toggle: which provider directories doctors may browse.
        'provider_visibility': provider_visibility,
        # Reseller entitlement (plan.kind='apex') — gates the frontend's
        # Reseller menu; the backend re-checks on every reseller request.
        'reseller': reseller_info,
    }
    return success_response(data=body)


@auth_bp.route('/sessions', methods=['GET'])
@jwt_required()
def list_sessions():
    """
    List all active sessions for current user.
    
    Returns:
        200: List of active sessions
    """
    sessions = AuthService.get_active_sessions(current_user.id)
    jwt_data = get_jwt()
    current_session_id = jwt_data.get('session_id')
    
    # Mark current session
    for session in sessions:
        session['is_current'] = session['session_id'] == current_session_id
    
    return success_response(data={'sessions': sessions})


@auth_bp.route('/sessions/<session_id>', methods=['DELETE'])
@jwt_required()
def remote_logout(session_id):
    """
    Remote logout a specific session.
    
    Path Parameters:
        session_id: UUID of the session to logout
    
    Returns:
        200: Session logged out
        404: Session not found
    """
    jwt_data = get_jwt()
    current_session_id = jwt_data.get('session_id')
    
    # Cannot remote logout current session
    if session_id == current_session_id:
        return error_response('Cannot remote logout current session. Use /logout instead.', status_code=400)
    
    success = AuthService.remote_logout(current_user.id, session_id)
    
    if success:
        return success_response(message='Session logged out successfully')
    else:
        return error_response('Session not found', status_code=404)


@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
@validate_json(['current_password', 'new_password'])
def change_password():
    """
    Change user password.
    Logs out all sessions after password change.
    
    Request Body:
        {
            "current_password": "OldPass123!",
            "new_password": "NewPass456!"
        }
    
    Returns:
        200: Password changed, user logged out
        400: Validation error or incorrect current password
    """
    data = request.get_json()
    
    # Validate using ChangePasswordSchema
    schema = ChangePasswordSchema()
    errors = schema.validate(data)
    if errors:
        return validation_error_response(errors)
    
    try:
        AuthService.change_password(
            current_user,
            data['current_password'],
            data['new_password']
        )

        # Best-effort security notification — log but never break the
        # response if the email provider is down. ``change_password`` has
        # already committed by the time we get here, so we use a freshly
        # captured timestamp formatted for end-user display.
        try:
            from app.services.email_service import EmailService
            from datetime import datetime, timezone
            timestamp = datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')
            EmailService.send_password_changed_email(current_user, timestamp=timestamp)
        except Exception as e:
            logger.warning(f"[AUTH:CHANGE_PW] notification failed: {e}")

        response, status_code = success_response(
            message='Password changed successfully. Please login again.'
        )
        unset_jwt_cookies(response)
        return response, status_code

    except ValueError as e:
        return service_error_response(e)


# ─── Post-login email verification ────────────────────────────────────
#
# Closes the security hole where ``email_verified`` was auto-set to True
# at signup, letting an attacker squat someone else's email and then log
# in / reset password as them. After signin, the frontend prompts the
# user to verify their email; these two endpoints handle the OTP send
# and check.

@auth_bp.route('/email/send-verification', methods=['POST'])
@limiter.limit("3 per minute")
@jwt_required()
def send_email_verification():
    """Send a 6-digit verification OTP to the logged-in user's email.

    Returns:
        200: OTP dispatched
        400: No email on file, or already verified, or send failed
    """
    logger.debug(f"[AUTH:EMAIL_VERIFY] ▶ send user_id={current_user.id}")
    try:
        AuthService.send_email_verification_otp(current_user)
        return success_response(
            message='Verification code sent. Check your inbox (and spam).'
        )
    except ValueError as e:
        return service_error_response(e)


@auth_bp.route('/email/verify', methods=['POST'])
@limiter.limit("10 per minute")
@jwt_required()
@validate_json(['otp'])
def verify_email_otp():
    """Confirm the OTP and flip ``email_verified`` to True.

    Request Body:
        {"otp": "123456"}

    Returns:
        200: Email verified
        400: Invalid / expired OTP
    """
    data = request.get_json()
    otp = (data.get('otp') or '').strip()
    if not otp.isdigit() or len(otp) != 6:
        return error_response('OTP must be a 6-digit number.', status_code=400)

    logger.debug(f"[AUTH:EMAIL_VERIFY] ▶ verify user_id={current_user.id}")
    try:
        AuthService.verify_email_otp(current_user, otp)

        # Best-effort: now that the email is provably owned, fire the
        # welcome email that was suppressed at signup time.
        try:
            from app.services.email_service import EmailService
            EmailService.send_welcome_email(current_user)
        except Exception as e:
            logger.warning(f"[AUTH:EMAIL_VERIFY] post-verify welcome failed: {e}")

        return success_response(message='Email verified successfully.')
    except ValueError as e:
        return service_error_response(e)


@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit("3 per minute")
def forgot_password():
    """
    Request password reset OTP. Accepts an EMAIL or a PHONE NUMBER
    as the identifier — the service finds the user in the current
    tenant by either hash, then delivers the same OTP via SMS
    (always) and email (if verified). Earlier versions only
    accepted ``{email}`` via a hard validator, which made the
    SMS-only / phone-first path inaccessible from the frontend
    forgot-password UI.

    Request Body (any one form):
        {"email": "user@example.com"}
        {"phone_number": "9876543210"}
        {"identifier": "user@example.com"}        # generic alias
        {"identifier": "9876543210"}

    Returns:
        200: Always returns success (prevents enumeration).
    """
    data = request.get_json(silent=True) or {}
    from app.common.decorators import scalar_str
    identifier = (
        scalar_str(data.get('identifier'))
        or scalar_str(data.get('email'))
        or scalar_str(data.get('phone_number'))
    )
    if not identifier:
        return validation_error_response({
            'identifier': 'Provide email or phone_number.',
        })

    # Previous behaviour returned 200 + a "if an account matches"
    # message regardless of whether the identifier actually mapped
    # to a real user — enumeration-safe but unhelpful: the operator
    # tested with a typo, got a success snackbar, no SMS ever
    # arrived, and there was no way from the UI to tell whether the
    # account existed at all. Per the user's preference, surface a
    # 404 with a clear message when no account matches.
    try:
        AuthService.request_password_reset(identifier)
    except ValueError as e:
        return error_response(str(e), status_code=404)

    return success_response(
        message='A reset code has been sent via SMS (and email if available).',
    )


@auth_bp.route('/verify-reset-otp', methods=['POST'])
@limiter.limit("5 per minute")
def verify_reset_otp():
    """
    Verify the 6-digit OTP for password reset.

    Same identifier flexibility as ``/forgot-password`` — accepts
    email, phone_number, or a generic ``identifier`` key. The
    service hashes whichever was provided and looks up the OTP in
    Redis under the matching key.

    Request Body (any one form):
        {"email": "user@example.com", "otp": "123456"}
        {"phone_number": "9876543210", "otp": "123456"}
        {"identifier": "...", "otp": "123456"}

    Returns:
        200: {"token": "..."} — use this token to call /reset-password
        400: Invalid or expired OTP / missing identifier / missing otp
    """
    data = request.get_json(silent=True) or {}
    from app.common.decorators import scalar_str
    identifier = (
        scalar_str(data.get('identifier'))
        or scalar_str(data.get('email'))
        or scalar_str(data.get('phone_number'))
    )
    otp = scalar_str(data.get('otp'))
    errs = {}
    if not identifier:
        errs['identifier'] = 'Provide email or phone_number.'
    if not otp:
        errs['otp'] = 'OTP is required.'
    if errs:
        return validation_error_response(errs)

    try:
        token = AuthService.verify_reset_otp(identifier, otp)
        return success_response(data={'token': token}, message='OTP verified successfully.')
    except ValueError as e:
        return service_error_response(e)



@auth_bp.route('/reset-password', methods=['POST'])
@limiter.limit("5 per minute")
@validate_json(['token', 'new_password'])
def reset_password():
    """
    Reset password using token.
    
    Request Body:
        {
            "token": "reset-token-from-email",
            "new_password": "NewSecurePass123!"
        }
    
    Returns:
        200: Password reset successful
        400: Invalid token or validation error
    """
    data = request.get_json()
    
    # Validate password strength
    is_valid, password_errors = validate_password_strength(data['new_password'])
    if not is_valid:
        return validation_error_response({'new_password': password_errors[0]})
    
    try:
        AuthService.reset_password(data['token'], data['new_password'])
        return success_response(message='Password reset successful. Please login.')
    except ValueError as e:
        return service_error_response(e)


# --- Phone OTP Verification & Passwordless Login Endpoints ---

@auth_bp.route('/send-phone-otp', methods=['POST'])
@limiter.limit("3 per minute")
@validate_json(['phone_number'])
def send_phone_otp():
    """
    Send OTP to mobile number for verification or passwordless login (Combirds SMS).

    Request Body:
        {"phone_number": "9876543210", "expected_role": "patient"}

    When ``expected_role`` is provided we resolve the user FIRST and
    refuse to send the OTP if the matched account belongs to a
    different role. This stops the wasted-OTP user experience where a
    doctor entered their phone on the patient portal, got a code,
    spent 20 seconds typing it, and only THEN saw the role mismatch.
    Now they get the error before the SMS even fires.

    Returns:
        200: OTP sent
        400: Invalid phone / role mismatch / no account
        429: Rate limit exceeded
    """
    from app.services.sms_service import SMSService
    from app.common.encryption import hash_for_search
    from app.common.tenant_context import current_tenant_id_or_default
    from app.models import User

    data = request.get_json()
    phone_number = (data.get('phone_number') or '').strip()
    expected_role = (data.get('expected_role') or '').strip() or None

    logger.debug(f"[AUTH:SEND_PHONE_OTP] ▶ phone={phone_number} expected_role={expected_role}")

    if not phone_number:
        return error_response('Phone number is required', status_code=400)

    # Pre-flight role check. Mirrors the gate inside ``signin_via_otp``
    # so we fail at Send-OTP time instead of letting the user discover
    # the mismatch only after entering the code. Doctor on the patient
    # portal => clear message + no SMS sent.
    if expected_role:
        tenant_id = current_tenant_id_or_default()
        phone_hash = hash_for_search(phone_number)
        user = User.query.filter_by(
            _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if not user:
            return error_response(
                'No account is registered with this mobile number on this site.',
                status_code=400,
                code='account_not_found',
            )
        user_role = user.role.value if user.role else None
        allowed_roles = {expected_role}
        if expected_role == 'service_provider':
            # Must list exactly what ``signin_via_otp`` accepts — this is a
            # pre-flight for that gate, and a narrower set here would refuse
            # to send an OTP the verify side would have honoured. Staff with
            # only a placeholder phone simply never match the lookup above.
            allowed_roles = {'doctor', 'hospital', 'clinic', 'pharmacy',
                             'diagnosis', 'provider_staff'}
        elif expected_role == 'service_receiver':
            allowed_roles = {'patient'}
        elif expected_role in ('admin', 'super_admin'):
            allowed_roles = {'super_admin', 'sub_admin'}
        if user_role not in allowed_roles:
            # Generic copy — don't leak the role the matched account
            # actually has. Same wording as the verify-side gate in
            # signin_via_otp and the password-login ROLE_MISMATCH UX.
            pretty_expected = expected_role.replace('_', ' ')
            # Same frozen code the password-login path uses — the web
            # frontend already branches on ROLE_MISMATCH.
            return error_response(
                f"This mobile number is not registered as a "
                f"{pretty_expected} on this site. Please use the "
                f"matching login portal.",
                status_code=400,
                code='ROLE_MISMATCH',
            )

    try:
        # ``purpose`` must match the template registry key ('login_otp')
        # AND the SMSService.send_phone_otp branch — the bare string
        # 'login' silently fell through to the non-login_otp path which
        # then failed template lookup, so no SMS ever went out and the
        # frontend's "Code sent" snackbar lied to the user.
        # 'login_otp' also has a fallback to 'signup_otp' in
        # SMSService._PURPOSE_FALLBACKS, so tenants without an explicit
        # login OTP template still get the OTP delivered.
        SMSService.send_phone_otp(phone_number, purpose='login_otp')
        return success_response(
            message='Verification code sent. Code expires in 10 minutes.',
            data={'phone_number': phone_number},
        )
    except ValueError as e:
        logger.error(f"[AUTH:SEND_PHONE_OTP] ✗ {e}")
        return error_response(str(e), status_code=500)


@auth_bp.route('/resend-phone-otp', methods=['POST'])
@limiter.limit("2 per minute")
@validate_json(['phone_number'])
def resend_phone_otp():
    """Resend OTP to phone (stricter rate limit)."""
    return send_phone_otp()


# Email OTP endpoints are disabled while email is bypassed — return 410.
@auth_bp.route('/send-email-otp', methods=['POST'])
@auth_bp.route('/verify-email-otp', methods=['POST'])
@auth_bp.route('/resend-email-otp', methods=['POST'])
def _email_otp_disabled():
    return error_response(
        'Email OTP is temporarily disabled. Please use mobile number OTP.',
        status_code=410,
        code='EMAIL_OTP_DISABLED',
    )


@auth_bp.route('/login-via-otp', methods=['POST'])
@limiter.limit("5 per minute")
# Per-target-phone cap — same rationale as signin's credential limit.
@limiter.limit("15 per hour", key_func=credential_key)
@validate_json(['phone_number', 'otp'])
def login_via_otp():
    """
    Passwordless login using phone OTP (Combirds SMS).
    Verifies OTP, authenticates user, and returns session cookies.

    Request Body:
        {
            "phone_number": "9876543210",
            "otp": "123456",
            "device_info": {}
        }

    Returns:
        200: Login successful with cookies set
        401: Invalid OTP or user not found
        403: Session limit reached
    """
    data = request.get_json()
    phone_number = (data.get('phone_number') or '').strip()
    otp = (data.get('otp') or '').strip()

    if not phone_number:
        return error_response('Phone number is required', status_code=400)
    if not otp:
        return error_response('OTP is required', status_code=400)

    logger.debug(f"[AUTH:LOGIN_OTP] ▶ phone={phone_number}")

    try:
        user, access_token, refresh_token, session_id = AuthService.signin_via_otp(
            phone_number=phone_number,
            otp=otp,
            device_info=data.get('device_info'),
            # Mirror the password-login portal-scoping: patient login
            # passes 'patient', doctor login 'service_provider'/'doctor',
            # etc. so an account of the wrong role can't slip through.
            expected_role=data.get('expected_role') or None,
        )

        logger.debug(f"[AUTH:LOGIN_OTP] ✓ DONE — user_id={user.id}, session_id={session_id}")

        # Tokens in the BODY as well as cookies, mirroring /auth/signin:
        # web keeps using cookies, while Bearer-token clients (the mobile
        # apps) read the body — without this, OTP login was cookie-only
        # and a mobile client could never complete it.
        response, status_code = success_response(
            data={
                'user': user.to_dict(),
                'session_id': session_id,
                'access_token': access_token,
                'refresh_token': refresh_token,
            },
            message='Login successful',
        )
        set_access_cookies(response, access_token)
        set_refresh_cookies(response, refresh_token)
        return response, status_code
    except Exception as e:
        error_msg = str(e)
        logger.debug(f"[AUTH:LOGIN_OTP] ✗ FAIL — {error_msg}")
        status = 403 if 'session' in error_msg.lower() else 401
        return error_response(error_msg, status_code=status)


# ── POST /auth/set-initial-password ──────────────────────────────────
# Used by accounts auto-created via the public booking flow. The User
# row was written with a random unguessable ``password_hash`` and
# ``must_set_password=True``; the patient first logs in via OTP, then
# must call this endpoint before the route guard releases them to the
# rest of the dashboard. Once set, the flag flips off and the user
# behaves like any other patient.
@auth_bp.route('/set-initial-password', methods=['POST'])
@jwt_required()
@limiter.limit("5 per minute")
@validate_json(['new_password'])
def set_initial_password():
    """
    Set the patient's password for the first time after OTP login.

    Request Body:
        {"new_password": "Strong#Pass1"}

    Returns:
        200 — Password set; ``must_set_password`` flipped to False.
        403 — Caller does not have ``must_set_password=True`` (use the
              normal change-password flow instead).
        400 — Validation (weak password).
    """
    if not getattr(current_user, 'must_set_password', False):
        return error_response(
            'Initial password is already set; use change-password instead.',
            status_code=403,
            code='PASSWORD_ALREADY_SET',
        )

    data = request.get_json() or {}
    new_password = (data.get('new_password') or '').strip()

    # Reuse the existing strength validator so the policy stays in
    # one place (length + character classes).
    err = validate_password_strength(new_password)
    if err:
        return error_response(err, status_code=400, code='WEAK_PASSWORD')

    current_user.set_password(new_password)
    current_user.must_set_password = False
    from app.extensions import db
    db.session.commit()

    logger.debug(f"[AUTH:SET_INITIAL_PASSWORD] ✓ user_id={current_user.id}")
    return success_response(
        message='Password set successfully.',
        data={'must_set_password': False},
    )