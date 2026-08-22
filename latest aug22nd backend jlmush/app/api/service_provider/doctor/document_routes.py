"""
Doctor Document routes — /api/doctor/documents/*

Shaped like the prescription endpoints in ``routes.py``, but attached to
a **purchased service** (:class:`MarketplaceOrder`) instead of an
appointment. The two flows are similar and completely isolated — nothing
here touches appointments. Powers the doctor's "My Documents" hub, the
same seven-tab workflow as "My Prescriptions":

    Pending (To Generate) → Drafts → Awaiting Approval →
    Pending to Push → Completed / Rejected / Revised

"Pending (To Generate)" therefore lists **orders** the doctor has sold
that don't have a document yet, not appointments.

Deliberate differences from the prescription flow (do not "fix" these
back into parity without a product decision):

  * **No payout side effect.** Pushing a prescription to the patient
    auto-creates the doctor's payout because that's the billable
    consultation artefact. Marketplace orders are paid at purchase, so a
    document must not generate any money movement.
  * **No order status mutation.** Issuing or pushing a document does not
    advance the order's lifecycle — the doctor still marks the order
    completed explicitly via the marketplace sales screen.
  * **No fixed clinical schema, no medicines, no follow-up.** A document
    is ``description`` + one optional attachment + doctor-authored
    ``custom_fields``. Prescriptions own the structured clinical model;
    documents deliberately do not mirror it. See ``models/document.py``.

Ownership follows the same rule as the marketplace sales list: the
doctor who owns the order (``doctor_id``) OR any member of the group the
order was placed against, so co-doctors on a group offering can both
author and read its documents.

The PDF renderer is shared: ``generate_prescription_pdf`` duck-types on
the model's attributes and skips the sections a document has no columns
for, and the admin-configured ``PrescriptionTemplate`` is reused as the
letterhead.
"""
import logging
import uuid as _uuid

from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from . import doctor_bp
from .routes import _get_doctor_for_request
from app.common.decorators import feature_required, role_required
from app.common.responses import success_response, error_response
from app.extensions import db
from app.models import UserRole

logger = logging.getLogger(__name__)

# Documents ride on the same entitlement as prescriptions for now. Split
# this to 'doctor.documents' once the plan catalog grows a separate flag.
DOCUMENT_FEATURE = 'doctor.prescriptions'

_DOC_ROLES = [UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL]

# Order statuses a document may be written against. 'pending' is excluded
# on purpose — the doctor hasn't accepted the order yet, so there is no
# service being delivered. 'paid' is the legacy alias of 'under_process'.
DOCUMENTABLE_ORDER_STATUSES = ('under_process', 'paid', 'completed')


def _doctor_order_filter(doctor):
    """Orders this doctor may document: their own sales + group offerings.

    Mirrors ``get_marketplace_sales`` so a co-doctor on a group order sees
    exactly the same order set here as on the sales screen.
    """
    from app.models import MarketplaceOrder, MarketplaceServiceGroupMember

    member_group_ids = db.session.query(MarketplaceServiceGroupMember.group_id).filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).subquery()

    return db.or_(
        MarketplaceOrder.doctor_id == doctor.id,
        MarketplaceOrder.group_id.in_(db.session.query(member_group_ids)),
    )


def _doctor_team_booking_ids(doctor):
    """Group-offering bookings this doctor may document — those on a team the
    doctor is an ACCEPTED member of. Returns a subquery of booking ids."""
    from app.models import GroupOfferingBooking, MarketplaceServiceGroupMember

    accepted_team_ids = db.session.query(MarketplaceServiceGroupMember.group_id).filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id, status='accepted',
    ).subquery()

    return db.session.query(GroupOfferingBooking.id).filter(
        GroupOfferingBooking.tenant_id == doctor.tenant_id,
        GroupOfferingBooking.team_id.in_(db.session.query(accepted_team_ids)),
    ).subquery()


def _get_booking_for_doctor(doctor, booking_id):
    """A plan booking the doctor is on the team for (accepted member)."""
    from app.models import GroupOfferingBooking, MarketplaceServiceGroupMember

    booking = GroupOfferingBooking.query.filter_by(
        tenant_id=doctor.tenant_id, id=booking_id,
    ).first()
    if not booking or not booking.team_id:
        return None
    member = MarketplaceServiceGroupMember.query.filter_by(
        tenant_id=doctor.tenant_id, group_id=booking.team_id,
        doctor_id=doctor.id, status='accepted',
    ).first()
    return booking if member else None


def _get_document_for_doctor(doctor, document_id):
    """Fetch a non-deleted document this doctor is allowed to act on.

    Ownership is the owner entity's, not the author's: on a group offering /
    group order any team member may keep editing the shared document, so a
    co-doctor doesn't get locked out because someone else created the draft.
    Covers both order-owned and group-booking-owned documents.
    """
    from app.models import DoctorDocument

    doc = DoctorDocument.query.filter(
        DoctorDocument.tenant_id == doctor.tenant_id,
        DoctorDocument.id == document_id,
        DoctorDocument.is_deleted == False,
    ).first()
    if not doc:
        return None
    if doc.group_booking_id is not None:
        return doc if _get_booking_for_doctor(doctor, doc.group_booking_id) else None
    # Order-owned: reuse the sales-list ownership rule.
    from app.models import DoctorDocument as DD, MarketplaceOrder
    owned = DD.query.join(
        MarketplaceOrder, DD.order_id == MarketplaceOrder.id,
    ).filter(
        DD.id == document_id, DD.tenant_id == doctor.tenant_id,
        _doctor_order_filter(doctor),
    ).first()
    return owned


def _parse_custom_fields(raw):
    """Normalise the doctor-authored sections into ``[{id, label, value}]``.

    Rows with a blank label AND a blank value are dropped — the form always
    ships one empty row for the doctor to type into, and persisting it would
    render as a headless empty section on the document. A label with no value
    is kept: an intentionally blank section (e.g. "Notes:" left for the
    patient to fill in by hand) is a legitimate thing to issue.

    Each field keeps a stable ``id``. The client mints it so it can stage
    attachments against a field that has not been saved yet; we accept the
    client's value only if it parses as a UUID and is unique within this
    document, and mint one otherwise. Anything keyed to a field by list
    position would break the first time the doctor reorders the rows.

    Returns ``(fields, error)``.
    """
    if raw is None:
        return None, None
    if not isinstance(raw, list):
        return None, 'custom_fields must be a list'

    fields = []
    seen_ids = set()
    for i, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            return None, f'custom_fields[{i}] must be an object'
        label = (item.get('label') or '').strip()
        value = (item.get('value') or '').strip()
        if not label and not value:
            continue
        if not label:
            return None, f'custom_fields[{i}]: a field with content needs a name'
        if len(label) > 200:
            return None, f'custom_fields[{i}]: field name is too long (max 200)'

        try:
            field_id = str(_uuid.UUID(str(item.get('id'))))
        except (ValueError, TypeError, AttributeError):
            field_id = str(_uuid.uuid4())
        if field_id in seen_ids:
            field_id = str(_uuid.uuid4())
        seen_ids.add(field_id)

        fields.append({'id': field_id, 'label': label, 'value': value})
    return fields, None


def _prune_orphan_field_attachments(document):
    """Delete attachments whose field no longer exists on the document.

    ``field_id`` cannot be a foreign key — custom fields live in a JSON
    column — so removing a field on update would otherwise strand its files
    as rows nothing renders and nothing ever cleans up.
    """
    from app.models import DoctorDocumentFieldAttachment

    live_ids = {str(f.get('id')) for f in (document.custom_fields or [])}
    for att in document.field_attachments.all():
        if str(att.field_id) not in live_ids:
            db.session.delete(att)


# ═══════════════════════════════════════════════════════════════
#  LIST / SUMMARY
# ═══════════════════════════════════════════════════════════════

@doctor_bp.route('/documents', methods=['GET'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def list_documents():
    """
    List the doctor's documents.
    Query params:
        status = draft | pending_approval | approved | active | completed
                 | rejected | revised | all  (default: all)
        order_id, page, per_page
    """
    from app.models import DoctorDocument, DocumentStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    status_filter = request.args.get('status', 'all').strip().lower()
    order_id_filter = request.args.get('order_id', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    from app.models import MarketplaceOrder
    # Order-owned docs the doctor may see (their sales + group orders).
    order_owned_ids = db.session.query(DoctorDocument.id).join(
        MarketplaceOrder, DoctorDocument.order_id == MarketplaceOrder.id,
    ).filter(
        DoctorDocument.tenant_id == doctor.tenant_id,
        _doctor_order_filter(doctor),
    ).subquery()
    # Plus group-offering completion docs on the doctor's teams.
    q = DoctorDocument.query.filter(
        DoctorDocument.tenant_id == doctor.tenant_id,
        DoctorDocument.is_deleted == False,
        db.or_(
            DoctorDocument.id.in_(db.session.query(order_owned_ids)),
            DoctorDocument.group_booking_id.in_(db.session.query(_doctor_team_booking_ids(doctor))),
        ),
    )
    if order_id_filter:
        q = q.filter(DoctorDocument.order_id == order_id_filter)

    status_map = {
        'draft': DocumentStatus.DRAFT,
        'approved': DocumentStatus.APPROVED,
        'active': DocumentStatus.ACTIVE,
        'completed': DocumentStatus.ACTIVE,
        'revised': DocumentStatus.REVISED,
        'pending_approval': DocumentStatus.PENDING_APPROVAL,
        'rejected': DocumentStatus.REJECTED,
    }
    if status_filter in status_map:
        q = q.filter(DoctorDocument.status == status_map[status_filter])

    q = q.order_by(DoctorDocument.updated_at.desc())
    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    return success_response(data={
        'documents': [d.to_dict(include_patient=True) for d in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@doctor_bp.route('/documents/summary', methods=['GET'])
@jwt_required()
@role_required(_DOC_ROLES)
def documents_progress_summary():
    """Counts that drive the "My Documents" progress bar.

    ``pending_to_write`` — accepted/completed orders with no document yet
    (same rule as the "Pending (To Generate)" tab).
    ``yet_to_publish`` — DRAFT + PENDING_APPROVAL + APPROVED, i.e. written
    but not yet pushed to the patient.
    """
    from app.models import MarketplaceOrder, DoctorDocument, DocumentStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    documented_order_ids = db.session.query(DoctorDocument.order_id).filter(
        DoctorDocument.tenant_id == doctor.tenant_id,
        DoctorDocument.is_deleted == False,
    ).subquery()

    pending_to_write = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        _doctor_order_filter(doctor),
        MarketplaceOrder.status.in_(DOCUMENTABLE_ORDER_STATUSES),
        ~MarketplaceOrder.id.in_(db.session.query(documented_order_ids)),
    ).count()

    def _count(*statuses):
        return DoctorDocument.query.join(
            MarketplaceOrder, DoctorDocument.order_id == MarketplaceOrder.id,
        ).filter(
            DoctorDocument.tenant_id == doctor.tenant_id,
            DoctorDocument.is_deleted == False,
            _doctor_order_filter(doctor),
            DoctorDocument.status.in_(statuses),
        ).count()

    drafts = _count(DocumentStatus.DRAFT)
    awaiting_approval = _count(DocumentStatus.PENDING_APPROVAL)
    approved = _count(DocumentStatus.APPROVED)
    published = _count(DocumentStatus.ACTIVE)

    yet_to_publish = drafts + awaiting_approval + approved
    total_outstanding = pending_to_write + yet_to_publish
    total_tasks = total_outstanding + published
    completed_pct = round(published / total_tasks * 100) if total_tasks else 100

    return success_response(data={
        'pending_to_write': pending_to_write,
        'yet_to_publish': yet_to_publish,
        'breakdown': {
            'drafts': drafts,
            'awaiting_approval': awaiting_approval,
            'approved': approved,
        },
        'published': published,
        'total_outstanding': total_outstanding,
        'total_tasks': total_tasks,
        'completed_pct': completed_pct,
        'all_done': total_outstanding == 0,
    })


@doctor_bp.route('/orders/pending-documents', methods=['GET'])
@jwt_required()
@role_required(_DOC_ROLES)
def get_orders_pending_documents():
    """Purchased services (orders) this doctor is serving that have NO
    document yet — the "Pending (To Generate)" tab."""
    from app.models import MarketplaceOrder, DoctorDocument

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    documented_order_ids = db.session.query(DoctorDocument.order_id).filter(
        DoctorDocument.tenant_id == doctor.tenant_id,
        DoctorDocument.is_deleted == False,
    ).subquery()

    q = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        _doctor_order_filter(doctor),
        MarketplaceOrder.status.in_(DOCUMENTABLE_ORDER_STATUSES),
        ~MarketplaceOrder.id.in_(db.session.query(documented_order_ids)),
    ).order_by(MarketplaceOrder.created_at.desc())

    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    result = []
    for order in paginated.items:
        order_data = order.to_dict()
        order_data['patient'] = {
            'id': str(order.patient.id),
            'full_name': order.patient.full_name,
        } if order.patient else None
        result.append(order_data)

    return success_response(data={
        'orders': result,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@doctor_bp.route('/orders/<order_id>', methods=['GET'])
@jwt_required()
@role_required(_DOC_ROLES)
def get_order_for_document(order_id):
    """One order the doctor is serving, with its document if it has one.

    The document form needs the order header (which service, which patient)
    without pulling the doctor's entire sales list. Scoped by the same
    ownership rule as everything else in this module.
    """
    from app.models import MarketplaceOrder, DoctorDocument

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    order = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        MarketplaceOrder.id == order_id,
        _doctor_order_filter(doctor),
    ).first()
    if not order:
        return error_response('Order not found', status_code=404)

    data = order.to_dict()
    data['patient'] = {
        'id': str(order.patient.id),
        'full_name': order.patient.full_name,
    } if order.patient else None

    existing = DoctorDocument.query.filter_by(
        tenant_id=doctor.tenant_id, order_id=order.id, is_deleted=False,
    ).order_by(DoctorDocument.created_at.desc()).first()
    data['document_id'] = str(existing.id) if existing else None
    data['can_write_document'] = order.status in DOCUMENTABLE_ORDER_STATUSES

    return success_response(data=data)


@doctor_bp.route('/documents/<document_id>', methods=['GET'])
@jwt_required()
@role_required(_DOC_ROLES)
def get_document(document_id):
    """Get a single document with full details."""
    from app.models import DoctorDocument

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    d = _get_document_for_doctor(doctor, document_id)
    if not d:
        return error_response('Document not found', status_code=404)

    return success_response(data=d.to_dict(include_patient=True, include_doctor=True))


# ═══════════════════════════════════════════════════════════════
#  CREATE / UPDATE / DELETE / REVISE
# ═══════════════════════════════════════════════════════════════

@doctor_bp.route('/orders/<order_id>/document', methods=['POST'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def create_document(order_id):
    """
    Create (or save-as-draft) a document for a purchased service (order).

    Body: ``description`` (free text) and ``custom_fields`` (a
    ``[{label, value}]`` list the doctor names themselves). The optional
    attachment is uploaded separately once the document has an id — see
    ``upload_document_attachment``. ``status`` may only be ``draft`` here
    — unlike prescriptions there is no direct-activate path at all;
    publishing always goes through admin approval (PUT with
    status=pending_approval, then approved → active).
    """
    from app.models import MarketplaceOrder, DoctorDocument, DocumentStatus

    data = request.get_json() or {}

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    order = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        MarketplaceOrder.id == order_id,
        _doctor_order_filter(doctor),
    ).first()
    if not order:
        return error_response('Order not found', status_code=404)

    # The doctor must have accepted the order before there is a service to
    # document. 'pending' = not accepted yet; cancelled/rejected are dead.
    if order.status not in DOCUMENTABLE_ORDER_STATUSES:
        return error_response(
            'Document can only be written once the order has been accepted.',
            status_code=400,
            data={'order_status': order.status},
        )

    existing = DoctorDocument.query.filter_by(
        tenant_id=doctor.tenant_id, order_id=order.id, is_deleted=False,
    ).first()
    if existing:
        return jsonify({
            'success': False,
            'message': 'Document already exists for this order. Use PUT to update.',
            'existing_document_id': str(existing.id),
        }), 409

    fields, field_err = _parse_custom_fields(data.get('custom_fields'))
    if field_err:
        return error_response(field_err, status_code=400)

    try:
        document = DoctorDocument(
            tenant_id=doctor.tenant_id,
            order_id=order.id,
            patient_id=order.patient_id,
            doctor_id=doctor.id,
            description=data.get('description'),
            custom_fields=fields or [],
            status=DocumentStatus.DRAFT,
        )
        db.session.add(document)
        db.session.commit()
        return success_response(
            message='Document saved as draft',
            data=document.to_dict(include_patient=True),
        )

    except ValueError as ve:
        db.session.rollback()
        return error_response(str(ve), status_code=400)
    except Exception:
        db.session.rollback()
        logger.exception('Failed to create document')
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/orders/<order_id>/document/upload', methods=['POST'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def upload_document(order_id):
    """Create a document from a manually-uploaded PDF instead of generating one.

    The ONLY difference from ``create_document``: the doctor supplies a ready
    PDF (multipart ``file``) rather than clinical form fields that get rendered
    into one. Everything downstream is identical — it lands as a DRAFT and
    follows the same submit → admin-approve → push-to-patient lifecycle; the
    push step just keeps this uploaded PDF instead of regenerating.
    """
    from app.models import MarketplaceOrder, DoctorDocument, DocumentStatus
    from app.services.s3_service import S3Service

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    order = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        MarketplaceOrder.id == order_id,
        _doctor_order_filter(doctor),
    ).first()
    if not order:
        return error_response('Order not found', status_code=404)
    if order.status not in DOCUMENTABLE_ORDER_STATUSES:
        return error_response(
            'Document can only be uploaded once the order has been accepted.',
            status_code=400, data={'order_status': order.status},
        )

    existing = DoctorDocument.query.filter_by(
        tenant_id=doctor.tenant_id, order_id=order.id, is_deleted=False,
    ).first()
    if existing:
        return jsonify({
            'success': False,
            'message': 'Document already exists for this order. Use PUT to update.',
            'existing_document_id': str(existing.id),
        }), 409

    file_obj = request.files.get('file')
    if file_obj is None or not file_obj.filename:
        return error_response('No PDF file provided.', status_code=400)

    try:
        # 'medical_document' keys the 5 MB cap + PDF/image allowlist in
        # S3Service. Private bucket; stored as ``bucket::key`` in pdf_link,
        # the same shape the generated flow uses so the reader is unchanged.
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='medical_document',
            original_filename=file_obj.filename, is_private=True,
            folder='doctor-documents',
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    document = DoctorDocument(
        tenant_id=doctor.tenant_id, order_id=order.id,
        patient_id=order.patient_id, doctor_id=doctor.id,
        description=(request.form.get('title') or file_obj.filename),
        custom_fields=[],
        pdf_link=f"{result['s3_bucket']}::{result['s3_key']}",
        status=DocumentStatus.DRAFT,
    )
    db.session.add(document)
    db.session.commit()
    return success_response(
        message='PDF uploaded as draft document',
        data=document.to_dict(include_patient=True),
    )


# ===============================================================
#  GROUP-OFFERING BOOKING DOCUMENTS
#
#  A plan's completion document rides the exact same DoctorDocument model +
#  DRAFT->approve->push lifecycle as a marketplace-service document; the only
#  difference is the owner (a plan booking instead of an order). Once every
#  accepted team doctor's document reaches ACTIVE the booking auto-completes.
# ===============================================================

# Booking statuses a document may be written against.
DOCUMENTABLE_BOOKING_STATUSES = ('active', 'completed')


def _existing_booking_document(doctor, booking):
    """This doctor's non-deleted document for the booking, if any."""
    from app.models import DoctorDocument
    return DoctorDocument.query.filter_by(
        tenant_id=doctor.tenant_id, group_booking_id=booking.id,
        doctor_id=doctor.id, is_deleted=False,
    ).first()


@doctor_bp.route('/group-offering-bookings/<booking_id>/document', methods=['POST'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def create_booking_document(booking_id):
    """Create (save-as-draft) the doctor's completion document for a plan
    booking. Same content model + lifecycle as ``create_document`` -- a
    ``description`` plus doctor-authored ``custom_fields`` -- just owned by
    the booking instead of an order."""
    from app.models import DoctorDocument, DocumentStatus

    data = request.get_json() or {}
    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    booking = _get_booking_for_doctor(doctor, booking_id)
    if not booking:
        return error_response('Booking not found', status_code=404)
    if booking.status not in DOCUMENTABLE_BOOKING_STATUSES:
        return error_response(
            'Document can only be written once the plan is active.',
            status_code=400, data={'booking_status': booking.status},
        )
    existing = _existing_booking_document(doctor, booking)
    if existing:
        return jsonify({
            'success': False,
            'message': 'You already have a document for this plan. Use PUT to update.',
            'existing_document_id': str(existing.id),
        }), 409

    fields, field_err = _parse_custom_fields(data.get('custom_fields'))
    if field_err:
        return error_response(field_err, status_code=400)

    try:
        document = DoctorDocument(
            tenant_id=doctor.tenant_id,
            group_booking_id=booking.id,
            patient_id=booking.patient_id,
            doctor_id=doctor.id,
            description=data.get('description'),
            custom_fields=fields or [],
            status=DocumentStatus.DRAFT,
        )
        db.session.add(document)
        db.session.commit()
        return success_response(
            message='Document saved as draft',
            data=document.to_dict(include_patient=True),
        )
    except ValueError as ve:
        db.session.rollback()
        return error_response(str(ve), status_code=400)
    except Exception:
        db.session.rollback()
        logger.exception('Failed to create booking document')
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/group-offering-bookings/<booking_id>/document/upload', methods=['POST'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def upload_booking_document(booking_id):
    """Create the doctor's completion document for a plan booking from a
    ready-made PDF (multipart ``file``). Same lifecycle as the order upload."""
    from app.models import DoctorDocument, DocumentStatus
    from app.services.s3_service import S3Service

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    booking = _get_booking_for_doctor(doctor, booking_id)
    if not booking:
        return error_response('Booking not found', status_code=404)
    if booking.status not in DOCUMENTABLE_BOOKING_STATUSES:
        return error_response(
            'Document can only be uploaded once the plan is active.',
            status_code=400, data={'booking_status': booking.status},
        )
    existing = _existing_booking_document(doctor, booking)
    if existing:
        return jsonify({
            'success': False,
            'message': 'You already have a document for this plan. Use PUT to update.',
            'existing_document_id': str(existing.id),
        }), 409

    file_obj = request.files.get('file')
    if file_obj is None or not file_obj.filename:
        return error_response('No PDF file provided.', status_code=400)

    try:
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='medical_document',
            original_filename=file_obj.filename, is_private=True,
            folder='doctor-documents',
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    document = DoctorDocument(
        tenant_id=doctor.tenant_id, group_booking_id=booking.id,
        patient_id=booking.patient_id, doctor_id=doctor.id,
        description=(request.form.get('title') or file_obj.filename),
        custom_fields=[],
        pdf_link=f"{result['s3_bucket']}::{result['s3_key']}",
        status=DocumentStatus.DRAFT,
    )
    db.session.add(document)
    db.session.commit()
    return success_response(
        message='PDF uploaded as draft document',
        data=document.to_dict(include_patient=True),
    )


@doctor_bp.route('/documents/<document_id>/attachment', methods=['POST', 'DELETE'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def document_attachment(document_id):
    """Attach (POST multipart ``file``) or clear (DELETE) the document's one
    supporting file.

    Distinct from ``upload_document``: that one IS the document (a ready-made
    PDF replacing the rendered output), this one rides alongside generated
    content as a supplement. Only editable while the doctor still owns the
    document -- once it is in the approval queue or published, the content is
    frozen, same rule the text fields follow.
    """
    from app.models import DoctorDocument, DocumentStatus
    from app.services.s3_service import S3Service

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    document = _get_document_for_doctor(doctor, document_id)
    if not document:
        return error_response('Document not found', status_code=404)
    if document.status not in (DocumentStatus.DRAFT, DocumentStatus.REJECTED):
        return error_response(
            'The attachment can only be changed while the document is a draft.',
            status_code=400, data={'status': document.status.value},
        )

    if request.method == 'DELETE':
        document.attachment_link = None
        document.attachment_name = None
        db.session.commit()
        return success_response(
            message='Attachment removed',
            data=document.to_dict(include_patient=True),
        )

    file_obj = request.files.get('file')
    if file_obj is None or not file_obj.filename:
        return error_response('No file provided.', status_code=400)

    try:
        # Same asset_type as the manual-PDF path: 5 MB cap + PDF/image
        # allowlist enforced inside S3Service, private bucket.
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='medical_document',
            original_filename=file_obj.filename, is_private=True,
            folder='doctor-document-attachments',
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    document.attachment_link = f"{result['s3_bucket']}::{result['s3_key']}"
    document.attachment_name = file_obj.filename[:255]
    db.session.commit()
    return success_response(
        message='Attachment uploaded',
        data=document.to_dict(include_patient=True),
    )


def _editable_document_for_attachment(document_id):
    """Shared guard for the field-attachment routes.

    Returns ``(document, error_response)`` -- exactly one is None.
    """
    from app.models import DocumentStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return None, error_response('Doctor profile not found', status_code=404)

    document = _get_document_for_doctor(doctor, document_id)
    if not document:
        return None, error_response('Document not found', status_code=404)
    if document.status not in (DocumentStatus.DRAFT, DocumentStatus.REJECTED):
        return None, error_response(
            'Attachments can only be changed while the document is a draft.',
            status_code=400, data={'status': document.status.value},
        )
    return document, None


@doctor_bp.route('/documents/<document_id>/fields/<field_id>/attachment', methods=['POST'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def add_field_attachment(document_id, field_id):
    """Add one file (multipart ``file``) to a single custom field.

    A field holds a list, so this appends rather than replaces -- the
    document-wide slot on ``document_attachment`` is the one that replaces.
    """
    from app.models import DoctorDocumentFieldAttachment
    from app.services.s3_service import S3Service

    document, err = _editable_document_for_attachment(document_id)
    if err:
        return err

    # The field must actually exist on this document -- otherwise the row
    # would be invisible (nothing renders it) and never cleaned up, since
    # field_id has no foreign key to enforce it.
    if str(field_id) not in {str(f.get('id')) for f in (document.custom_fields or [])}:
        return error_response(
            'That field does not exist on this document. Save the document first.',
            status_code=404,
        )

    file_obj = request.files.get('file')
    if file_obj is None or not file_obj.filename:
        return error_response('No file provided.', status_code=400)

    try:
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='medical_document',
            original_filename=file_obj.filename, is_private=True,
            folder='doctor-document-attachments',
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    db.session.add(DoctorDocumentFieldAttachment(
        tenant_id=document.tenant_id,
        document_id=document.id,
        field_id=field_id,
        s3_link=f"{result['s3_bucket']}::{result['s3_key']}",
        file_name=file_obj.filename[:255],
    ))
    db.session.commit()
    return success_response(
        message='Attachment added',
        data=document.to_dict(include_patient=True),
    )


@doctor_bp.route(
    '/documents/<document_id>/fields/<field_id>/attachment/<attachment_id>',
    methods=['DELETE'],
)
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def delete_field_attachment(document_id, field_id, attachment_id):
    """Remove one file from a custom field."""
    from app.models import DoctorDocumentFieldAttachment

    document, err = _editable_document_for_attachment(document_id)
    if err:
        return err

    att = DoctorDocumentFieldAttachment.query.filter_by(
        tenant_id=document.tenant_id,
        document_id=document.id,
        field_id=field_id,
        id=attachment_id,
    ).first()
    if not att:
        return error_response('Attachment not found', status_code=404)

    db.session.delete(att)
    db.session.commit()
    return success_response(
        message='Attachment removed',
        data=document.to_dict(include_patient=True),
    )


@doctor_bp.route('/documents/<document_id>', methods=['PUT'])
@jwt_required()
@feature_required(DOCUMENT_FEATURE)
@role_required(_DOC_ROLES)
def update_document(document_id):
    """
    Update an existing document. ``custom_fields``, when present, REPLACES
    the whole section list — the form always submits the full set.

    Status transitions the doctor may drive:
      * draft / rejected → pending_approval  (submit for admin review)
      * approved         → active            (push to patient, renders PDF)
    draft → active is blocked; admin approval is mandatory.
    """
    from app.models import (
        DoctorDocument, DocumentStatus,
    )

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    document = _get_document_for_doctor(doctor, document_id)
    if not document:
        return error_response('Document not found', status_code=404)

    data = request.get_json() or {}

    for field in ('description', 'valid_until'):
        if field in data:
            setattr(document, field, data[field])

    if 'custom_fields' in data:
        fields, field_err = _parse_custom_fields(data['custom_fields'])
        if field_err:
            return error_response(field_err, status_code=400)
        document.custom_fields = fields or []
        _prune_orphan_field_attachments(document)

    target_status = data.get('status', '').lower()
    # Approval matrix: when this doctor's 'document' (or 'group_plan' for a
    # group-booking completion doc) mode is 'auto', a submit-for-approval pushes
    # straight to the patient — mark APPROVED + retarget to 'active' so the
    # tested activation path below runs (PDF render, group-booking completion).
    # 'manual' keeps the mandatory admin gate.
    if target_status == 'pending_approval' and document.status in (
        DocumentStatus.DRAFT, DocumentStatus.REJECTED,
    ):
        from app.api.admin.approval_policy_service import effective_permission_mode
        _sec = 'group_plan' if document.group_booking_id else 'document'
        if effective_permission_mode(doctor, _sec) == 'auto':
            document.status = DocumentStatus.APPROVED
            target_status = 'active'

    if target_status == 'pending_approval' and document.status in (
        DocumentStatus.DRAFT, DocumentStatus.REJECTED,
    ):
        document.status = DocumentStatus.PENDING_APPROVAL
        # Resubmitting answers the previous rejection — clear it so the
        # admin queue doesn't show a stale reason against a fresh request.
        document.rejection_reason = None

    elif target_status == 'active' and document.status == DocumentStatus.APPROVED:
        # Push to patient — only after admin approval. A manually-uploaded PDF
        # already carries its file (``pdf_link`` set at upload time and has no
        # structured content to render), so we keep it as-is; only the
        # generated-content flow renders a PDF here. The prescription PDF
        # renderer duck-types on these attributes, and the admin-configured
        # prescription template doubles as the letterhead for documents.
        if not document.pdf_link:
            from app.services.prescription_pdf_service import generate_prescription_pdf
            from app.models import PrescriptionTemplate
            from app.models.prescription import DEFAULT_DOCUMENT_DISCLAIMER
            tpl = PrescriptionTemplate.query.filter_by(
                tenant_id=doctor.tenant_id, is_active=True,
            ).first()
            # Document-side disclaimer, not the prescription one — see
            # PrescriptionTemplate.document_disclaimer_text.
            disclaimer = (getattr(tpl, 'document_disclaimer_text', None)
                          or DEFAULT_DOCUMENT_DISCLAIMER)
            disclaimer_title = (getattr(tpl, 'document_disclaimer_title', None)
                                or 'DISCLAIMER;')
            try:
                pdf_url = generate_prescription_pdf(
                    document, template=tpl,
                    disclaimer=disclaimer, disclaimer_title=disclaimer_title,
                )
                if pdf_url:
                    document.pdf_link = pdf_url
            except Exception as pdf_err:
                # A failed render must not strand the document in APPROVED —
                # the patient still gets the structured record either way.
                logger.warning('Document PDF render failed for %s: %s', document.id, pdf_err)

        document.status = DocumentStatus.ACTIVE

        # Group-offering booking: the plan is delivered once EVERY accepted
        # team doctor's document has been pushed. Mirrors the individual
        # service's completion, but gated on all team members.
        if document.group_booking_id and document.group_booking:
            booking = document.group_booking
            db.session.flush()  # so all_docs_uploaded sees this ACTIVE doc
            if booking.status == 'active' and booking.all_docs_uploaded:
                booking.status = 'completed'
                # Family-doctor second-opinion commission on the completed plan
                # booking (no single provider doctor → no self-skip). Flushed
                # here; persisted by the commit below.
                try:
                    from app.api.family_doctor.credit_service import award_for_booking
                    award_for_booking(
                        booking.tenant_id, booking.patient_id, None,
                        'group_booking', booking.id, label='Second opinion — health plan',
                        amount=float(getattr(booking, 'plan_price', 0)
                                     or getattr(booking, 'total_payable', 0) or 0),
                    )
                except Exception:  # noqa: BLE001
                    pass

        # NOTE: for order documents, intentionally no order-status mutation
        # and no payout creation here — see the module docstring.

    elif target_status == 'active':
        return error_response(
            'Doctors cannot directly activate documents. Submit for admin approval first.',
            status_code=403,
        )

    db.session.commit()
    return success_response(
        message='Document updated',
        data=document.to_dict(include_patient=True),
    )


@doctor_bp.route('/documents/<document_id>', methods=['DELETE'])
@jwt_required()
@role_required(_DOC_ROLES)
def delete_document(document_id):
    """Soft-delete a document (drafts only)."""
    from app.models import DoctorDocument, DocumentStatus
    from app.models._base import utcnow

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    d = _get_document_for_doctor(doctor, document_id)
    if not d:
        return error_response('Document not found', status_code=404)
    if d.status != DocumentStatus.DRAFT:
        return error_response('Only draft documents can be deleted', status_code=400)

    d.is_deleted = True
    d.deleted_at = utcnow()
    db.session.commit()
    return success_response(message='Document deleted')


@doctor_bp.route('/documents/<document_id>/revise', methods=['POST'])
@jwt_required()
@role_required(_DOC_ROLES)
def revise_document(document_id):
    """
    Revise a completed (active) document.

    Creates a NEW document as a revision; the old one becomes REVISED but
    is NOT deleted, so both stay visible to the doctor. The revision starts
    as a DRAFT — unlike the prescription revise path, which republishes
    straight to ACTIVE and thereby bypasses the admin queue. A revised
    document must be re-approved before the patient sees it.
    """
    from app.models import DoctorDocument, DocumentStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    original = _get_document_for_doctor(doctor, document_id)
    if not original:
        return error_response('Document not found', status_code=404)
    if original.status not in (DocumentStatus.ACTIVE, DocumentStatus.REVISED):
        return error_response('Only completed documents can be revised', status_code=400)

    data = request.get_json() or {}

    rev_num = (original.revision_number or 1) + 1
    root_id = original.parent_document_id or original.id

    if 'custom_fields' in data:
        fields, field_err = _parse_custom_fields(data['custom_fields'])
        if field_err:
            return error_response(field_err, status_code=400)
    else:
        # Carry the original's sections forward so a revision starts from
        # what was published, not from a blank form.
        fields = list(original.custom_fields or [])

    revised = DoctorDocument(
        tenant_id=doctor.tenant_id,
        order_id=original.order_id,
        group_booking_id=original.group_booking_id,
        patient_id=original.patient_id,
        doctor_id=doctor.id,
        parent_document_id=root_id,
        revision_number=rev_num,
        description=data.get('description', original.description),
        custom_fields=fields or [],
        # The attachment is part of the content being revised — copy the
        # pointer, not the object; S3 keys are immutable so both revisions
        # can safely reference the same file.
        attachment_link=original.attachment_link,
        attachment_name=original.attachment_name,
        status=DocumentStatus.DRAFT,
    )
    db.session.add(revised)
    db.session.flush()   # need revised.id before pointing attachments at it

    # Same reasoning as the document-wide attachment above: copy the row,
    # share the S3 object. Only for fields the revision actually kept — if
    # the caller sent a new custom_fields set that dropped a field, its
    # files go with it.
    from app.models import DoctorDocumentFieldAttachment
    kept_field_ids = {str(f.get('id')) for f in (revised.custom_fields or [])}
    for att in original.field_attachments.all():
        if str(att.field_id) not in kept_field_ids:
            continue
        db.session.add(DoctorDocumentFieldAttachment(
            tenant_id=revised.tenant_id,
            document_id=revised.id,
            field_id=att.field_id,
            s3_link=att.s3_link,
            file_name=att.file_name,
        ))

    original.status = DocumentStatus.REVISED

    db.session.commit()
    return success_response(
        message=f'Document revised (v{rev_num}) — submit it for approval to publish',
        data=revised.to_dict(include_patient=True),
    )
