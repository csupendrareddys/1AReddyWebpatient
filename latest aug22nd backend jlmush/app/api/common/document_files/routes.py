"""
Authenticated downloads for document files — /api/document-files/*.

Why this exists instead of handing presigned S3 URLs to the browser:

  * A presigned URL puts the signing identity and an HMAC in the address
    bar, and grants anyone holding it bearer-less access to a medical
    record for the whole expiry window.
  * It is signed when the document is *serialised*, so a cached API
    response hands the UI a link that is already dead — the user clicks
    and gets an ``AccessDenied`` XML page.

These routes stream the object through the session instead: nothing
S3-shaped reaches the client, access is re-checked on every hit, and
there is no expiry to outlive because the fetch happens at click time.

Auth comes from the cookie as well as the header (``JWT_TOKEN_LOCATION``
includes both), so a plain ``<a href>`` works — no JS fetch dance needed
to attach a bearer token. GET is not CSRF-protected, by design.
"""
import io
import logging

from flask import send_file
from flask_jwt_extended import jwt_required, current_user

from app.api.common.document_files import document_files_bp
from app.common.responses import error_response
from app.models import UserRole

logger = logging.getLogger(__name__)

# Roles that may read any document inside their own tenant.
_ADMIN_ROLES = (UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN)


def _load_document(document_id):
    """Fetch a non-deleted document, or None."""
    from app.models import DoctorDocument

    return DoctorDocument.query.filter(
        DoctorDocument.id == document_id,
        DoctorDocument.is_deleted == False,  # noqa: E712
    ).first()


def _may_read(document):
    """Is ``current_user`` allowed to read this document's files?

    Three audiences, one rule each:
      * admins  — any document in their own tenant
      * doctor  — documents against an order they serve (same ownership
                  test the authoring routes use, so a co-doctor on a group
                  offering is included)
      * patient — their own documents, and only once published; a draft
                  or a rejected revision is not theirs to see yet
    """
    from app.models import Doctor, Patient, DocumentStatus, MarketplaceOrder
    from app.api.service_provider.doctor.document_routes import _doctor_order_filter

    if current_user.tenant_id != document.tenant_id:
        return False

    if current_user.role in _ADMIN_ROLES:
        return True

    if current_user.role in (UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL):
        doctor = Doctor.query.filter_by(user_id=current_user.id).first()
        if not doctor:
            return False
        return MarketplaceOrder.query.filter(
            MarketplaceOrder.id == document.order_id,
            _doctor_order_filter(doctor),
        ).first() is not None

    if current_user.role == UserRole.PATIENT:
        patient = Patient.query.filter_by(user_id=current_user.id).first()
        if not patient or patient.id != document.patient_id:
            return False
        # Mirrors the patient list endpoint's 'all' filter: unpublished
        # states are the doctor's working copy, not something the patient
        # may pull. REVISED/EXPIRED stay readable — the patient was already
        # shown them, and losing access to a superseded record is worse
        # than keeping it.
        return document.status in (
            DocumentStatus.ACTIVE, DocumentStatus.REVISED, DocumentStatus.EXPIRED,
        )

    return False


def _stream(stored_ref, download_name, mimetype=None):
    """Stream a ``bucket::key`` object back to the caller."""
    from app.services.s3_service import S3Service

    if not stored_ref or '::' not in stored_ref:
        return error_response('File not available', status_code=404)

    bucket, key = stored_ref.split('::', 1)
    try:
        # Bucket-aware client: a bare get_client() always returns the AWS
        # one and fails on MinIO-backed buckets.
        obj = S3Service.get_client(bucket).get_object(Bucket=bucket, Key=key)
        body = obj['Body'].read()
    except Exception:
        logger.exception('Document file fetch failed for %s', stored_ref)
        return error_response('Could not read the file', status_code=502)

    return send_file(
        io.BytesIO(body),
        mimetype=mimetype or obj.get('ContentType') or 'application/octet-stream',
        as_attachment=False,   # let the browser preview PDFs/images inline
        download_name=download_name or 'document',
    )


def _guard(document_id):
    """Returns ``(document, error_response)`` — exactly one is None."""
    document = _load_document(document_id)
    if not document:
        return None, error_response('Document not found', status_code=404)
    if not _may_read(document):
        # 404 rather than 403: whether a document exists is itself
        # information a stranger shouldn't get.
        return None, error_response('Document not found', status_code=404)
    return document, None


@document_files_bp.route('/<document_id>/pdf', methods=['GET'])
@jwt_required()
def download_document_pdf(document_id):
    """The document's rendered (or manually uploaded) PDF."""
    document, err = _guard(document_id)
    if err:
        return err
    return _stream(
        document.pdf_link,
        f'document-{str(document.id)[:8]}.pdf',
        mimetype='application/pdf',
    )


@document_files_bp.route('/<document_id>/attachment', methods=['GET'])
@jwt_required()
def download_document_attachment(document_id):
    """The single document-wide supporting file."""
    document, err = _guard(document_id)
    if err:
        return err
    return _stream(document.attachment_link, document.attachment_name)


@document_files_bp.route('/<document_id>/field-attachment/<attachment_id>', methods=['GET'])
@jwt_required()
def download_field_attachment(document_id, attachment_id):
    """One file belonging to one of the document's custom fields."""
    from app.models import DoctorDocumentFieldAttachment

    document, err = _guard(document_id)
    if err:
        return err

    att = DoctorDocumentFieldAttachment.query.filter_by(
        id=attachment_id, document_id=document.id,
    ).first()
    if not att:
        return error_response('Attachment not found', status_code=404)

    return _stream(att.s3_link, att.file_name)
