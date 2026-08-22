"""
Admin Profile Configuration API Routes
Public endpoints for live config and Admin endpoints for CRUD operations.
Mirrors doctor_profile_config routes but scoped to admin_profile page type.
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user
from flask_cors import cross_origin

from app.api.admin_profile_config import admin_profile_config_bp
from app.api.admin_profile_config.service import (
    AdminProfileConfigService, SECTION_GROUPS
)
from app.common.decorators import role_required
from app.models import UserRole, get_or_create_profile_owner


def success_response(data, message=None, status_code=200):
    response = {'success': True, 'data': data}
    if message:
        response['message'] = message
    return jsonify(response), status_code


def error_response(message, status_code=400, error_type='Bad Request'):
    return jsonify({
        'success': False,
        'error': error_type,
        'message': message
    }), status_code


# ============== PUBLIC ENDPOINTS ==============

@admin_profile_config_bp.route('/public/admin_profile', methods=['GET', 'OPTIONS'])
@cross_origin(supports_credentials=True)
def get_public_config():
    """Get the LIVE admin profile page configuration for display. No auth required."""
    try:
        lang = request.args.get('lang', 'en')
        user_type = request.args.get('user_type')

        merged = AdminProfileConfigService.get_merged_config(lang=lang, user_type=user_type)
        return success_response(merged)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return error_response(f"Failed to load config: {str(e)}", status_code=500)


# ============== ADMIN ENDPOINTS ==============

@admin_profile_config_bp.route('/admin/admin_profile', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def admin_get_configs():
    """Get all configs (draft, preview, live) for admin profile."""
    configs = AdminProfileConfigService.get_all_configs()

    for key in ['draft', 'preview', 'live']:
        if configs[key]:
            config_id = configs[key]['id']
            fields = AdminProfileConfigService.get_field_configs(config_id)
            configs[key]['field_configs'] = [f.to_dict() for f in fields]

    return success_response(configs)


@admin_profile_config_bp.route('/admin/admin_profile/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_draft():
    """Get or create draft configuration."""
    try:
        user_id = str(current_user.id) if current_user else None
        section_group = request.args.get('section')

        draft = AdminProfileConfigService.get_or_create_draft(user_id)
        result = draft.to_dict(include_asset_urls=True)

        fields = AdminProfileConfigService.get_field_configs(draft.id, section_group=section_group)
        result['field_configs'] = [f.to_dict() for f in fields]

        if section_group and section_group not in ('page_settings', 'master_data'):
            section_keys = SECTION_GROUPS.get(section_group, [])
            if section_keys and isinstance(result.get('fields'), dict):
                all_sections = result['fields'].get('sections', [])
                result['fields']['sections'] = [
                    s for s in all_sections if s.get('key') in section_keys
                ]

        return success_response(result)
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft():
    """Update draft page-level configuration."""
    data = request.get_json()
    if not data:
        return error_response("Request body required")

    try:
        user_id = str(current_user.id) if current_user else None
        draft = AdminProfileConfigService.update_draft(data, user_id)
        result = draft.to_dict(include_asset_urls=True)
        fields = AdminProfileConfigService.get_field_configs(draft.id)
        result['field_configs'] = [f.to_dict() for f in fields]
        return success_response(result, message="Draft updated successfully")
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/draft/fields', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft_fields():
    """Update individual field configurations within the draft."""
    data = request.get_json()
    if not data or 'fields' not in data:
        return error_response("Request body must contain 'fields' array")

    try:
        user_id = str(current_user.id) if current_user else None
        updated = AdminProfileConfigService.update_field_configs(data['fields'], user_id)
        return success_response(updated, message="Field configs updated successfully")
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def promote_to_preview():
    """Promote draft to preview status."""
    try:
        user_id = str(current_user.id) if current_user else None
        preview = AdminProfileConfigService.promote_to_preview(user_id)
        return success_response(
            preview.to_dict(include_asset_urls=True),
            message="Draft promoted to preview"
        )
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/preview', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_preview():
    """Get preview configuration."""
    preview = AdminProfileConfigService.get_preview_config()
    if not preview:
        return error_response("No preview config found for admin_profile", status_code=404)
    result = preview.to_dict(include_asset_urls=True)
    fields = AdminProfileConfigService.get_field_configs(preview.id)
    result['field_configs'] = [f.to_dict() for f in fields]
    return success_response(result)


@admin_profile_config_bp.route('/admin/admin_profile/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def publish_config():
    """Publish preview to live."""
    try:
        user_id = str(current_user.id) if current_user else None
        live = AdminProfileConfigService.publish(user_id)
        return success_response(
            live.to_dict(include_asset_urls=True),
            message="Configuration published successfully"
        )
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_version_history():
    """Get version history for admin profile."""
    limit = request.args.get('limit', 10, type=int)
    versions = AdminProfileConfigService.get_version_history(limit)
    return success_response([v.to_dict() for v in versions])


@admin_profile_config_bp.route('/admin/admin_profile/restore/<version_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def restore_version(version_id):
    """Restore a specific version to a new draft."""
    try:
        user_id = str(current_user.id) if current_user else None
        draft = AdminProfileConfigService.restore_version(version_id, user_id)
        result = draft.to_dict(include_asset_urls=True)
        fields = AdminProfileConfigService.get_field_configs(draft.id)
        result['field_configs'] = [f.to_dict() for f in fields]
        return success_response(result, message="Version restored to draft successfully")
    except ValueError as e:
        return error_response(str(e))


@admin_profile_config_bp.route('/admin/admin_profile/audit-logs', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_audit_logs():
    """Get audit logs for admin profile config."""
    limit = request.args.get('limit', 50, type=int)
    logs = AdminProfileConfigService.get_audit_logs(limit)
    return success_response([log.to_dict() for log in logs])


# ============== SUB-ADMIN PROFILE DATA ENDPOINTS ==============
# These endpoints handle actual profile data CRUD for sub-admin users.
# Sub-admins use this page (like doctors use doctor profile).
# Super admins only configure the page layout — they don't have a profile page.

@admin_profile_config_bp.route('/profile/me', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_profile():
    """Get current sub-admin's extended profile."""
    from app.models import Admin, ProfileOwner, ProfileExtended

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    data = admin.to_dict()

    # Include extended profile — from the consolidated profile_extended table
    # reached via the admin's central profile_owner row.
    ext = (
        ProfileExtended.query
        .join(ProfileOwner, ProfileExtended.profile_owner_id == ProfileOwner.id)
        .filter(ProfileOwner.owner_type == 'admin', ProfileOwner.admin_id == admin.id)
        .first()
    )
    data['extended_profile'] = ext.to_dict() if ext else {}

    # Include user contact info
    data['phone'] = getattr(current_user, 'phone', None)
    data['email'] = getattr(current_user, 'email', None)

    return success_response(data)


@admin_profile_config_bp.route('/profile/me', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_profile():
    """Update current admin's basic profile."""
    from app.models import Admin
    from app.extensions import db

    req_data = request.get_json()
    if not req_data:
        return error_response("Request body required")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    # Update basic admin fields
    if 'first_name' in req_data:
        admin.first_name = req_data['first_name']
    if 'middle_name' in req_data:
        admin.middle_name = req_data['middle_name']
    if 'last_name' in req_data:
        admin.last_name = req_data['last_name']

    db.session.commit()
    return success_response(admin.to_dict(), message="Profile updated successfully")


@admin_profile_config_bp.route('/profile/me/extended', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_extended_profile():
    """Update current admin's extended profile (identity, address, health, etc.)."""
    from app.models import Admin, ProfileExtended, get_or_create_profile_owner
    from app.extensions import db

    req_data = request.get_json()
    if not req_data:
        return error_response("Request body required")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    owner = get_or_create_profile_owner('admin', admin.id, admin.tenant_id)
    ext = ProfileExtended.query.filter_by(profile_owner_id=owner.id).first()
    if not ext:
        ext = ProfileExtended(tenant_id=admin.tenant_id, profile_owner_id=owner.id)
        db.session.add(ext)

    # aadhar_* (client) -> aadhaar_* (canonical column).
    if 'aadhar_number' in req_data:
        ext.aadhaar_number = req_data['aadhar_number']
    if 'aadhar_attachment' in req_data:
        ext.aadhaar_attachment = req_data['aadhar_attachment']

    # Fields that map 1:1 onto profile_extended columns (incl. the JSON ones
    # absorbed from admin_profiles_extended so nothing is lost).
    simple_fields = [
        'pan_number', 'pan_attachment', 'registration_number',
        'experience_years', 'alternative_phone', 'alternative_email',
        'height', 'weight', 'category', 'religion', 'citizenship',
        'languages_known', 'consultation_fee', 'slot_pricing',
        'female_health_details', 'communication_address', 'permanent_address',
        'self_declaration_data',
    ]
    for field in simple_fields:
        if field in req_data:
            setattr(ext, field, req_data[field])

    db.session.commit()
    return success_response(ext.to_dict(), message="Extended profile updated successfully")


@admin_profile_config_bp.route('/profile/me/signatures', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_signatures():
    """Get current admin's signatures."""
    from app.models import Admin, ProfileSignature
    from app.services.s3_service import S3Service

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    sig = ProfileSignature.query.filter_by(admin_id=admin.id).first()
    if not sig:
        return success_response({})

    # No URL "refresh" here anymore: to_response_dict signs fresh from the
    # s3_key at read time. The old pattern PERSISTED 1-hour presigned URLs
    # into the *_url columns — every read a day later served a dead link.
    return success_response(sig.to_response_dict())


@admin_profile_config_bp.route('/profile/me/signatures', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_signatures():
    """Update current admin's signatures. Accepts multipart/form-data with file uploads."""
    from app.models import Admin, ProfileSignature, DocumentVerificationStatus
    from app.extensions import db
    from app.services.s3_service import S3Service

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    sig = ProfileSignature.query.filter_by(admin_id=admin.id).first()
    if not sig:
        sig = ProfileSignature(
            tenant_id=admin.tenant_id, admin_id=admin.id,
            profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
        )
        db.session.add(sig)

    user_id = str(current_user.id)
    files = request.files
    updated = False

    def _upload_and_set(file_obj, attr_prefix):
        result = S3Service.upload_file(
            file_obj, attr_prefix, file_obj.filename,
            is_private=True,
            folder=f'admins/signatures/{user_id}'
        )
        setattr(sig, f'{attr_prefix}_url', S3Service.generate_presigned_url(result['s3_bucket'], result['s3_key']))
        setattr(sig, f'{attr_prefix}_s3_key', result['s3_key'])
        setattr(sig, f'{attr_prefix}_s3_bucket', result['s3_bucket'])
        setattr(sig, f'{attr_prefix}_verification_status', DocumentVerificationStatus.PENDING)

    if 'signature1' in files:
        _upload_and_set(files['signature1'], 'signature1')
        updated = True

    if 'signature2' in files:
        _upload_and_set(files['signature2'], 'signature2')
        updated = True

    if 'digitalSignature' in files:
        _upload_and_set(files['digitalSignature'], 'digital_signature')
        updated = True

    # Also support JSON body for URL-based updates (e.g. from admin tools)
    if not updated and request.is_json:
        req_data = request.get_json()
        sig_fields = [
            'signature1_url', 'signature1_s3_key', 'signature1_s3_bucket',
            'signature2_url', 'signature2_s3_key', 'signature2_s3_bucket',
            'digital_signature_url', 'digital_signature_s3_key', 'digital_signature_s3_bucket',
        ]
        for field in sig_fields:
            if field in req_data:
                setattr(sig, field, req_data[field])

    # to_response_dict signs fresh from s3_key — never persist presigned
    # URLs (they die in an hour and the *_url columns kept the corpse).
    db.session.commit()
    return success_response(sig.to_response_dict(), message="Signatures updated successfully")


@admin_profile_config_bp.route('/profile/me/about', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_about():
    """Get current admin's about info."""
    from app.models import Admin, ProfileAbout

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    about = ProfileAbout.query.filter_by(admin_id=admin.id).first()
    return success_response(about.to_response_dict() if about else {})


@admin_profile_config_bp.route('/profile/me/about', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_about():
    """Update current admin's about info."""
    from app.models import Admin, ProfileAbout
    from app.extensions import db

    req_data = request.get_json()
    if not req_data:
        return error_response("Request body required")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    about = ProfileAbout.query.filter_by(admin_id=admin.id).first()
    if not about:
        about = ProfileAbout(
            tenant_id=admin.tenant_id, admin_id=admin.id,
            profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
        )
        db.session.add(about)

    about_fields = [
        'brief_about_text', 'brief_about_attachment_url', 'brief_about_attachment_s3_key', 'brief_about_attachment_s3_bucket',
        'nature_of_work_text', 'nature_of_work_attachment_url', 'nature_of_work_attachment_s3_key', 'nature_of_work_attachment_s3_bucket',
        'currently_working_with_text', 'currently_working_with_attachment_url', 'currently_working_with_attachment_s3_key', 'currently_working_with_attachment_s3_bucket',
    ]
    for field in about_fields:
        if field in req_data:
            setattr(about, field, req_data[field])

    db.session.commit()
    return success_response(about.to_response_dict(), message="About info updated successfully")


@admin_profile_config_bp.route('/profile/me/education', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_education():
    """Get current admin's education details."""
    from app.models import Admin, ProfileEducation

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    # Serve the same master-data-driven, per-level dropdown options the doctor
    # education form uses (degrees / specializations / universities / institutes
    # per UG/PG/SS). Previously the admin endpoint returned none, so the admin
    # form fell back to hardcoded lists disconnected from the tenant's master
    # data.
    from app.api.service_provider.doctor.service import DoctorService
    dropdown_options = DoctorService.get_education_dropdowns()

    edu = ProfileEducation.query.filter_by(admin_id=admin.id).first()
    if not edu:
        return success_response({'dropdownOptions': dropdown_options})

    return success_response({
        'dropdownOptions': dropdown_options,
        'graduation': {
            'data': edu.graduation_data,
            'certificate_url': edu.graduation_certificate_url,
            'certificate_verification_status': edu.graduation_certificate_verification_status.value,
            'marksheet_url': edu.graduation_marksheet_url,
            'marksheet_verification_status': edu.graduation_marksheet_verification_status.value,
        },
        'post_graduation': {
            'data': edu.post_graduation_data,
            'certificate_url': edu.post_graduation_certificate_url,
            'certificate_verification_status': edu.post_graduation_certificate_verification_status.value,
            'marksheet_url': edu.post_graduation_marksheet_url,
            'marksheet_verification_status': edu.post_graduation_marksheet_verification_status.value,
        },
        'super_speciality': {
            'data': edu.super_speciality_data,
            'certificate_url': edu.super_speciality_certificate_url,
            'certificate_verification_status': edu.super_speciality_certificate_verification_status.value,
            'marksheet_url': edu.super_speciality_marksheet_url,
            'marksheet_verification_status': edu.super_speciality_marksheet_verification_status.value,
        },
        'other_certification': {
            'data': edu.other_certification_data,
            'certificate_url': edu.other_certification_certificate_url,
            'certificate_verification_status': edu.other_certification_certificate_verification_status.value,
            'marksheet_url': edu.other_certification_marksheet_url,
            'marksheet_verification_status': edu.other_certification_marksheet_verification_status.value,
        },
    })


@admin_profile_config_bp.route('/profile/me/education', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_education():
    """Update current admin's education details."""
    from app.models import Admin, ProfileEducation
    from app.extensions import db

    req_data = request.get_json()
    if not req_data:
        return error_response("Request body required")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    edu = ProfileEducation.query.filter_by(admin_id=admin.id).first()
    if not edu:
        edu = ProfileEducation(
            tenant_id=admin.tenant_id, admin_id=admin.id,
            profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
        )
        db.session.add(edu)

    sections = ['graduation', 'post_graduation', 'super_speciality', 'other_certification']
    for section in sections:
        if section in req_data:
            section_data = req_data[section]
            if 'data' in section_data:
                setattr(edu, f'{section}_data', section_data['data'])
            for doc_type in ['certificate', 'marksheet']:
                for suffix in ['url', 's3_key', 's3_bucket']:
                    key = f'{doc_type}_{suffix}'
                    if key in section_data:
                        setattr(edu, f'{section}_{key}', section_data[key])

    db.session.commit()
    return success_response({'message': 'Education updated successfully'})


@admin_profile_config_bp.route('/profile/me/bank-accounts', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_bank_accounts():
    """Get current admin's bank accounts."""
    from app.models import Admin, ProfileBankAccount

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    accounts = ProfileBankAccount.query.filter_by(admin_id=admin.id).order_by(ProfileBankAccount.order_index).all()
    return success_response([a.to_response_dict() for a in accounts])


@admin_profile_config_bp.route('/profile/me/bank-accounts', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_bank_accounts():
    """Update current admin's bank accounts (upsert pattern)."""
    from app.models import Admin, ProfileBankAccount
    from app.extensions import db

    req_data = request.get_json()
    if not req_data or 'accounts' not in req_data:
        return error_response("Request body must contain 'accounts' array")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    # Delete existing and recreate
    ProfileBankAccount.query.filter_by(admin_id=admin.id).delete()

    for idx, acct_data in enumerate(req_data['accounts']):
        acct = ProfileBankAccount(
            tenant_id=admin.tenant_id,
            admin_id=admin.id,
            profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
            order_index=idx,
            bank_name=acct_data.get('bank_name'),
            account_name=acct_data.get('account_name'),
            account_number=acct_data.get('account_number'),
            ifsc_code=acct_data.get('ifsc_code'),
            branch=acct_data.get('branch'),
            passbook_url=acct_data.get('passbook_url'),
            passbook_s3_key=acct_data.get('passbook_s3_key'),
            passbook_s3_bucket=acct_data.get('passbook_s3_bucket'),
            check_leaf_url=acct_data.get('check_leaf_url'),
            check_leaf_s3_key=acct_data.get('check_leaf_s3_key'),
            check_leaf_s3_bucket=acct_data.get('check_leaf_s3_bucket'),
            bank_statement_url=acct_data.get('bank_statement_url'),
            bank_statement_s3_key=acct_data.get('bank_statement_s3_key'),
            bank_statement_s3_bucket=acct_data.get('bank_statement_s3_bucket'),
        )
        db.session.add(acct)

    db.session.commit()
    accounts = ProfileBankAccount.query.filter_by(admin_id=admin.id).order_by(ProfileBankAccount.order_index).all()
    return success_response([a.to_response_dict() for a in accounts], message="Bank accounts updated successfully")


@admin_profile_config_bp.route('/profile/me/declarations', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_declarations():
    """Get current admin's declaration responses."""
    from app.models import Admin, ProfileDeclarationResponse

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    responses = ProfileDeclarationResponse.query.filter_by(admin_id=admin.id).all()
    return success_response([r.to_response_dict() for r in responses])


@admin_profile_config_bp.route('/profile/me/declarations', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_declarations():
    """Update current admin's declaration responses."""
    from app.models import Admin, ProfileDeclarationResponse
    from app.extensions import db

    req_data = request.get_json()
    if not req_data or 'responses' not in req_data:
        return error_response("Request body must contain 'responses' array")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    for resp_data in req_data['responses']:
        config_id = resp_data.get('configId')
        if not config_id:
            continue

        existing = ProfileDeclarationResponse.query.filter_by(
            admin_id=admin.id, config_id=config_id
        ).first()

        if not existing:
            existing = ProfileDeclarationResponse(
                tenant_id=admin.tenant_id,
                admin_id=admin.id,
                config_id=config_id,
                profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
            )
            db.session.add(existing)

        if 'answer' in resp_data:
            existing.answer = resp_data['answer']
        if 'explanation' in resp_data:
            existing.explanation = resp_data['explanation']
        if 'attachmentUrl' in resp_data:
            existing.attachment_url = resp_data['attachmentUrl']
        if 'attachment_s3_key' in resp_data:
            existing.attachment_s3_key = resp_data['attachment_s3_key']
        if 'attachment_s3_bucket' in resp_data:
            existing.attachment_s3_bucket = resp_data['attachment_s3_bucket']

    db.session.commit()

    responses = ProfileDeclarationResponse.query.filter_by(admin_id=admin.id).all()
    return success_response([r.to_response_dict() for r in responses], message="Declarations updated successfully")


@admin_profile_config_bp.route('/profile/me/documents', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def get_my_documents():
    """Get current admin's uploaded documents."""
    from app.models import Admin, ProfileDocument

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    docs = ProfileDocument.query.filter_by(admin_id=admin.id).all()
    return success_response([d.to_response_dict() for d in docs])


@admin_profile_config_bp.route('/profile/me/documents', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUB_ADMIN)
def update_my_documents():
    """Update current admin's uploaded documents."""
    from app.models import Admin, ProfileDocument
    from app.extensions import db

    req_data = request.get_json()
    if not req_data or 'documents' not in req_data:
        return error_response("Request body must contain 'documents' array")

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response("Admin profile not found", status_code=404)

    for doc_data in req_data['documents']:
        config_id = doc_data.get('configId')
        if not config_id:
            continue

        existing = ProfileDocument.query.filter_by(
            admin_id=admin.id, config_id=config_id
        ).first()

        if not existing:
            existing = ProfileDocument(
                tenant_id=admin.tenant_id,
                admin_id=admin.id,
                config_id=config_id,
                profile_owner_id=get_or_create_profile_owner('admin', admin.id, admin.tenant_id).id,
            )
            db.session.add(existing)

        if 'fileUrl' in doc_data:
            existing.file_url = doc_data['fileUrl']
        if 'file_s3_key' in doc_data:
            existing.file_s3_key = doc_data['file_s3_key']
        if 'file_s3_bucket' in doc_data:
            existing.file_s3_bucket = doc_data['file_s3_bucket']

    db.session.commit()

    docs = ProfileDocument.query.filter_by(admin_id=admin.id).all()
    return success_response([d.to_response_dict() for d in docs], message="Documents updated successfully")


# ============== PER-MODULE ENDPOINTS (Round 9, Phase 3) ==============
# See app/common/module_routes.py for the shared route bodies.

from app.api.admin_profile_config.module_service import (
    for_module as _ap_for_module,
    list_modules as _ap_list_modules,
)
from app.api.doctor_profile_config.data_resolver import resolve_data_source as _ap_resolve_ds
from app.common.module_routes import register_module_routes as _register_module_routes


_register_module_routes(
    blueprint=admin_profile_config_bp,
    url_prefix='admin/admin_profile',
    for_module=_ap_for_module,
    list_modules=_ap_list_modules,
    resolve_data_source=_ap_resolve_ds,
)
