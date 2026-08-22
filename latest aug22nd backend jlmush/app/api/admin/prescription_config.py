"""
Admin Prescription Template & Approval routes.
Manage the PDF template configuration and approve/reject doctor prescriptions.
"""
import logging
from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, feature_required
from app.common.responses import success_response, error_response, created_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole

logger = logging.getLogger(__name__)

prescription_config_bp = Blueprint('prescription_config', __name__)


# ═══════════════════════════════════════════════════════════════
#  TEMPLATE CRUD
# ═══════════════════════════════════════════════════════════════

@prescription_config_bp.route('/template', methods=['GET'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.DOCTOR])
def get_template():
    """Get the active prescription template (or create default if none exists)."""
    from app.models import PrescriptionTemplate
    tpl = PrescriptionTemplate.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).first()
    if not tpl:
        tpl = PrescriptionTemplate(name='Default Template', created_by=current_user.id)
        db.session.add(tpl)
        db.session.commit()
    return success_response(data=tpl.to_dict())


@prescription_config_bp.route('/template', methods=['PUT'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_template():
    """Update the active prescription template."""
    from app.models import PrescriptionTemplate
    tpl = PrescriptionTemplate.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).first()
    if not tpl:
        tpl = PrescriptionTemplate(name='Default Template', created_by=current_user.id)
        db.session.add(tpl)
        db.session.flush()

    data = request.get_json() or {}
    updatable = [
        'name', 'clinic_name', 'clinic_logo_url', 'header_subtitle',
        'show_doctor_name', 'show_doctor_qualification', 'show_doctor_specialization',
        'show_registration_number', 'show_patient_name', 'show_patient_age_gender',
        'show_patient_id', 'show_prescription_id', 'show_prescription_date',
        'sections_config', 'show_doctor_signature', 'signature_label',
        'disclaimer_text', 'disclaimer_title',
        'document_disclaimer_text', 'document_disclaimer_title',
        'rx_symbol_url', 'rx_symbol_text',
        'show_share_button', 'show_print_button', 'show_follow_up_button',
    ]
    for f in updatable:
        if f in data:
            setattr(tpl, f, data[f])
    db.session.commit()
    return success_response(data=tpl.to_dict(), message='Template updated')


@prescription_config_bp.route('/template/upload-logo', methods=['POST'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def upload_template_logo():
    """Upload clinic logo for prescription template."""
    from app.models import PrescriptionTemplate
    from app.services.s3_service import S3Service

    file = request.files.get('file')
    if not file:
        return error_response('No file provided', status_code=400)

    s3 = S3Service()
    result = s3.upload_file(file, 'prescription-logo', file.filename, is_private=False, folder='prescription-templates')
    logo_url = s3.get_public_url(result['s3_bucket'], result['s3_key'], result['s3_region'])

    tpl = PrescriptionTemplate.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).first()
    if tpl:
        tpl.clinic_logo_url = logo_url
        db.session.commit()

    return success_response(data={'logo_url': logo_url}, message='Logo uploaded')


@prescription_config_bp.route('/template/upload-rx-symbol', methods=['POST'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def upload_rx_symbol():
    """Upload a custom Rx symbol image for prescription template."""
    from app.models import PrescriptionTemplate
    from app.services.s3_service import S3Service

    file = request.files.get('file')
    if not file:
        return error_response('No file provided', status_code=400)

    s3 = S3Service()
    result = s3.upload_file(file, 'rx-symbol', file.filename, is_private=False, folder='prescription-templates')
    rx_url = s3.get_public_url(result['s3_bucket'], result['s3_key'], result['s3_region'])

    tpl = PrescriptionTemplate.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).first()
    if tpl:
        tpl.rx_symbol_url = rx_url
        tpl.rx_symbol_text = None   # clear text if image uploaded
        db.session.commit()

    return success_response(data={'rx_symbol_url': rx_url}, message='Rx symbol uploaded')


# ═══════════════════════════════════════════════════════════════
#  PRESCRIPTION APPROVAL (Admin side)
# ═══════════════════════════════════════════════════════════════

@prescription_config_bp.route('/pending-approvals', methods=['GET'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_pending_approvals():
    """List prescriptions in the admin approval queue.

    Originally pinned to PENDING_APPROVAL only — but an admin
    looking at the approvals page also wants to see what they
    *already* actioned (approved, rejected, the ones now ACTIVE
    after the doctor pushed them to the patient). Accepts an
    optional ``status`` query param to switch the bucket:
      * ``pending``  (default) — awaiting review
      * ``approved`` — admin OK'd. Covers both APPROVED and ACTIVE
                      because ACTIVE just means the doctor went on
                      to push an already-approved prescription
                      out to the patient; from the admin's POV
                      both are "I approved this".
      * ``rejected`` — admin rejected
      * ``all``      — every prescription that reached the admin
                      queue. Excludes DRAFT (still being authored,
                      doctor-private).
    Default stays ``pending`` so existing callers don't change
    behaviour.
    """
    from app.models import Prescription, PrescriptionStatus
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status_str = (request.args.get('status') or 'pending').strip().lower()

    if status_str == 'pending':
        extra = (Prescription.status == PrescriptionStatus.PENDING_APPROVAL,)
    elif status_str == 'approved':
        extra = (Prescription.status.in_([
            PrescriptionStatus.APPROVED,
            PrescriptionStatus.ACTIVE,
        ]),)
    elif status_str == 'rejected':
        extra = (Prescription.status == PrescriptionStatus.REJECTED,)
    elif status_str == 'all':
        extra = (Prescription.status != PrescriptionStatus.DRAFT,)
    else:
        # Unknown filter value — fall back to pending rather than
        # silently returning every row. Mirrors legacy behaviour.
        extra = (Prescription.status == PrescriptionStatus.PENDING_APPROVAL,)

    q = Prescription.query.filter(
        Prescription.is_deleted == False,
        *extra,
    ).order_by(Prescription.created_at.desc())

    paginated = q.paginate(page=page, per_page=per_page, error_out=False)
    return success_response(data={
        'prescriptions': [p.to_dict(include_patient=True, include_doctor=True) for p in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@prescription_config_bp.route('/prescription/<prescription_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_prescription(prescription_id):
    """Get a single prescription for admin review."""
    from app.models import Prescription
    p = Prescription.query.get(prescription_id)
    if not p:
        return not_found_response('Prescription not found')
    return success_response(data=p.to_dict(include_patient=True, include_doctor=True))


@prescription_config_bp.route('/approve/<prescription_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_prescription(prescription_id):
    """Approve a pending prescription — moves to APPROVED status.
    Doctor must still explicitly push to patient (APPROVED → ACTIVE)."""
    from app.models import Prescription, PrescriptionStatus

    p = Prescription.query.get(prescription_id)
    if not p:
        return not_found_response('Prescription not found')
    if p.status != PrescriptionStatus.PENDING_APPROVAL:
        return error_response('Prescription is not pending approval', status_code=400)

    p.status = PrescriptionStatus.APPROVED

    db.session.commit()
    return success_response(message='Prescription approved', data=p.to_dict(include_patient=True, include_doctor=True))


@prescription_config_bp.route('/reject/<prescription_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_prescription(prescription_id):
    """Reject a pending prescription — moves it back to REJECTED so doctor can fix."""
    from app.models import Prescription, PrescriptionStatus

    p = Prescription.query.get(prescription_id)
    if not p:
        return not_found_response('Prescription not found')
    if p.status != PrescriptionStatus.PENDING_APPROVAL:
        return error_response('Prescription is not pending approval', status_code=400)

    data = request.get_json() or {}
    p.status = PrescriptionStatus.REJECTED
    # Store rejection reason in notes or a separate field
    rejection_reason = data.get('reason', '')
    if rejection_reason:
        p.notes = (p.notes or '') + f'\n\n[Admin Rejection: {rejection_reason}]'

    db.session.commit()
    return success_response(message='Prescription rejected', data=p.to_dict(include_patient=True, include_doctor=True))
