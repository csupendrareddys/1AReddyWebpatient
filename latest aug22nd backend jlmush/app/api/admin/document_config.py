"""
Admin Document Approval routes — /api/admin/document-config/*

The approval half of ``prescription_config.py``, for doctor Documents.
There is deliberately no template CRUD here: documents render with the
prescription template (one letterhead per tenant), so the existing
``/api/admin/prescription-config/template`` endpoints stay the single
place that is edited.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required, feature_required
from app.common.responses import success_response, error_response, not_found_response
from app.extensions import db
from app.models import UserRole

logger = logging.getLogger(__name__)

document_config_bp = Blueprint('document_config', __name__)


@document_config_bp.route('/pending-approvals', methods=['GET'])
@jwt_required()
@feature_required('doctor.prescriptions_pdf')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_pending_approvals():
    """List documents in the admin approval queue.

    ``status`` query param selects the bucket (same semantics as the
    prescription queue):
      * ``pending``  (default) — awaiting review
      * ``approved`` — admin OK'd; covers APPROVED and ACTIVE, since
                       ACTIVE just means the doctor went on to push an
                       already-approved document to the patient
      * ``rejected`` — admin rejected
      * ``all``      — everything that reached the queue (excludes DRAFT,
                       which is still doctor-private)
    """
    from app.models import DoctorDocument, DocumentStatus

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status_str = (request.args.get('status') or 'pending').strip().lower()

    if status_str == 'approved':
        extra = (DoctorDocument.status.in_([
            DocumentStatus.APPROVED, DocumentStatus.ACTIVE,
        ]),)
    elif status_str == 'rejected':
        extra = (DoctorDocument.status == DocumentStatus.REJECTED,)
    elif status_str == 'all':
        extra = (DoctorDocument.status != DocumentStatus.DRAFT,)
    else:
        # Unknown value falls back to pending rather than leaking every row.
        extra = (DoctorDocument.status == DocumentStatus.PENDING_APPROVAL,)

    q = DoctorDocument.query.filter(
        DoctorDocument.is_deleted == False,
        *extra,
    ).order_by(DoctorDocument.created_at.desc())

    paginated = q.paginate(page=page, per_page=per_page, error_out=False)
    return success_response(data={
        'documents': [
            d.to_dict(include_patient=True, include_doctor=True)
            for d in paginated.items
        ],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@document_config_bp.route('/document/<document_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_document(document_id):
    """Get a single document for admin review."""
    from app.models import DoctorDocument

    d = DoctorDocument.query.get(document_id)
    if not d:
        return not_found_response('Document not found')
    return success_response(data=d.to_dict(include_patient=True, include_doctor=True))


@document_config_bp.route('/approve/<document_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_document(document_id):
    """Approve a pending document — moves it to APPROVED.
    The doctor must still explicitly push it to the patient (APPROVED → ACTIVE)."""
    from app.models import DoctorDocument, DocumentStatus

    d = DoctorDocument.query.get(document_id)
    if not d:
        return not_found_response('Document not found')
    if d.status != DocumentStatus.PENDING_APPROVAL:
        return error_response('Document is not pending approval', status_code=400)

    d.status = DocumentStatus.APPROVED
    db.session.commit()
    return success_response(
        message='Document approved',
        data=d.to_dict(include_patient=True, include_doctor=True),
    )


@document_config_bp.route('/reject/<document_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_document(document_id):
    """Reject a pending document — back to REJECTED so the doctor can fix it."""
    from app.models import DoctorDocument, DocumentStatus

    d = DoctorDocument.query.get(document_id)
    if not d:
        return not_found_response('Document not found')
    if d.status != DocumentStatus.PENDING_APPROVAL:
        return error_response('Document is not pending approval', status_code=400)

    data = request.get_json() or {}
    d.status = DocumentStatus.REJECTED
    # Own column, not appended into ``description``: ``notes`` was dropped
    # from this table in f1a2b3c4d5e6 (documents went free-form), so the
    # prescription-style ``d.notes = (d.notes or '') + ...`` this route was
    # copied from raised AttributeError and 500'd every rejection that
    # carried a reason.
    d.rejection_reason = (data.get('reason') or '').strip() or None

    db.session.commit()
    return success_response(
        message='Document rejected',
        data=d.to_dict(include_patient=True, include_doctor=True),
    )
