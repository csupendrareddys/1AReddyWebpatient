"""
Doctor Document model: DoctorDocument.

A "Document" is the generic sibling of a Prescription — same authoring
hub, same draft → pending_approval → approved → active lifecycle, same
PDF render — but attached to a **purchased service** rather than a
consultation.

That is the one structural difference and it is deliberate: a
Prescription hangs off an ``Appointment``, a Document hangs off a
:class:`MarketplaceOrder`. The two flows are similar in shape but
completely isolated — a document is the deliverable for something the
patient bought, so there is no appointment in the picture at all and
nothing here should ever grow an ``appointment_id``.

Why a separate model instead of a ``kind`` column on ``Prescription``:
different parent entity, separate admin approval queue, separate patient
surface, and prescriptions carry regulatory weight documents don't.

**Content model — deliberately unlike Prescription.** A document has no
fixed clinical schema. It carries exactly three things:

  * ``description``   — the one fixed free-text field, always shown
  * ``attachment_*``  — one optional document-wide supporting file
  * ``custom_fields`` — a doctor-authored ``[{id, label, value}]`` list,
    each field optionally carrying its own files
    (:class:`DoctorDocumentFieldAttachment`)

There are no ``diagnosis`` / ``allergies`` / ``instructions`` columns and
no medicines table: a document is whatever the doctor sells, so the
section names are theirs to choose per document. Do not reintroduce
fixed clinical columns here — add a custom field instead. Prescriptions
keep the structured schema (and the medicines + follow-up machinery)
because they carry regulatory weight; documents do not.

Naming note: ``MarketplaceOrder.documents`` would collide conceptually
with the patient's uploaded order attachments, so the relationship on
the order / patient / doctor side is ``doctor_documents``. The HTTP
surface is ``/api/doctor/documents``.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import DocumentStatus


def _patient_block(pat):
    """Patient summary embedded in a document payload (mirrors Prescription)."""
    vitals = {}
    try:
        from app.models.health import HealthRecord
        rec = HealthRecord.query.filter_by(
            patient_id=pat.id, record_type='vitals', is_deleted=False
        ).order_by(HealthRecord.record_date.desc()).first()
        if rec and rec.details:
            vitals = rec.details
    except Exception:
        pass

    # gender/dob live on User, not Patient (schema split) — see the same
    # note in prescription.py; reading them off ``pat`` raises.
    user = pat.user
    return {
        'id': str(pat.id),
        'full_name': pat.full_name,
        'gender': user.gender.value if (user and user.gender) else None,
        'dob': str(user.dob) if (user and user.dob) else None,
        'aadhar_number': pat.aadhar_number,
        'phone_number': user.phone_number if user else None,
        'blood_group': pat.blood_group.value if pat.blood_group else None,
        'height': vitals.get('height_cm'),
        'weight': vitals.get('weight_kg'),
    }


def _doctor_block(doc):
    """Doctor summary (letterhead data) embedded in a document payload."""
    sig_url = None
    sig_record = getattr(doc, 'signature_record', None)
    if sig_record:
        try:
            from app.services.s3_service import S3Service
            if sig_record.digital_signature_s3_key and sig_record.digital_signature_s3_bucket:
                sig_url = S3Service.generate_presigned_url(
                    sig_record.digital_signature_s3_bucket,
                    sig_record.digital_signature_s3_key,
                )
            elif sig_record.signature1_s3_key and sig_record.signature1_s3_bucket:
                sig_url = S3Service.generate_presigned_url(
                    sig_record.signature1_s3_bucket, sig_record.signature1_s3_key,
                )
            elif sig_record.signature2_s3_key and sig_record.signature2_s3_bucket:
                sig_url = S3Service.generate_presigned_url(
                    sig_record.signature2_s3_bucket, sig_record.signature2_s3_key,
                )
        except Exception:
            sig_url = None

    qual_str = None
    try:
        quals = list(doc.qualifications.all()) if hasattr(doc.qualifications, 'all') else []
        if quals:
            qual_str = ', '.join(q.degree_name for q in quals if q.degree_name)
    except Exception:
        qual_str = None

    spec_str = None
    try:
        specs = list(doc.specializations.all()) if hasattr(doc.specializations, 'all') else []
        if specs:
            spec_str = ', '.join(s.category.name for s in specs if s.category and s.category.name)
    except Exception:
        spec_str = None

    clinic_address = None
    comm_addr = getattr(doc, 'communication_address', None)
    if comm_addr and isinstance(comm_addr, dict):
        parts = [
            comm_addr.get('address_line1', ''),
            comm_addr.get('address_line2', ''),
            comm_addr.get('city', ''),
            comm_addr.get('state', ''),
            comm_addr.get('pincode', ''),
        ]
        clinic_address = ', '.join(p for p in parts if p)

    return {
        'id': str(doc.id),
        'full_name': doc.full_name,
        'qualification': qual_str,
        'specialization': spec_str,
        'registration_number': getattr(doc, 'registration_number', None),
        'clinic_address': clinic_address,
        'signature_url': sig_url,
        'profile_image': getattr(doc, 'profile_image', None),
    }


class DoctorDocument(TenantMixin, db.Model):
    """Patient documents issued by doctors."""
    __tablename__ = 'doctor_documents'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='document_id')

    # What this document belongs to. Exactly one of order_id / group_booking_id
    # is set (enforced in the routes). A marketplace-service document hangs off
    # an order; a group-offering completion document hangs off a plan booking —
    # same table, same lifecycle, same "My Documents" hub.
    order_id = db.Column(UUID(as_uuid=True), db.ForeignKey('marketplace_orders.order_id', ondelete='CASCADE'), nullable=True, index=True)
    group_booking_id = db.Column(UUID(as_uuid=True), db.ForeignKey('group_offering_bookings.booking_id', ondelete='CASCADE'), nullable=True, index=True)
    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)

    # The one fixed content field. Doubles as the list-view summary, so
    # it is what the doctor sees in "My Documents" and the admin queue.
    description = db.Column(db.Text, nullable=True)

    # Doctor-authored sections: ``[{"id": str, "label": str, "value": str}]``,
    # render order = list order. Empty list rather than NULL so callers can
    # iterate without a None check.
    #
    # ``id`` is a stable per-field uuid and is NOT decorative: field
    # attachments are keyed to it (see DoctorDocumentFieldAttachment). The
    # form lets the doctor reorder and delete rows, so anything keyed to a
    # field by list position would silently follow the wrong field after a
    # move. Never renumber or drop these ids on update.
    custom_fields = db.Column(db.JSON, nullable=False, default=list, server_default='[]')

    # One optional document-wide supporting file, stored ``bucket::key`` like
    # pdf_link (private bucket — the URL is presigned on read, never
    # persisted). Deliberately a single fixed slot, distinct from the
    # per-field attachment lists: this one is about the document as a whole.
    attachment_link = db.Column(db.String(500), nullable=True)
    attachment_name = db.Column(db.String(255), nullable=True)

    status = db.Column(
        db.Enum(DocumentStatus, values_callable=lambda x: [e.value for e in x]),
        default=DocumentStatus.DRAFT, nullable=False, index=True,
    )

    # Why an admin sent this back. Admin-authored review metadata, kept out
    # of ``description`` so it can be shown (and cleared on resubmit)
    # independently of the doctor's own content.
    rejection_reason = db.Column(db.Text, nullable=True)

    parent_document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_documents.document_id'), nullable=True, index=True)
    revision_number = db.Column(db.Integer, default=1, nullable=False)

    issue_date = db.Column(db.Date, default=lambda: utcnow().date(), nullable=False)
    valid_until = db.Column(db.Date, nullable=True)
    pdf_link = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    order = db.relationship('MarketplaceOrder', backref=db.backref('doctor_documents', lazy='dynamic'), foreign_keys=[order_id])
    group_booking = db.relationship('GroupOfferingBooking', backref=db.backref('doctor_documents', lazy='dynamic'), foreign_keys=[group_booking_id])
    patient = db.relationship('Patient', back_populates='doctor_documents')
    doctor = db.relationship('Doctor', back_populates='doctor_documents')
    parent_document = db.relationship('DoctorDocument', remote_side='DoctorDocument.id', backref='revisions', uselist=False)
    field_attachments = db.relationship(
        'DoctorDocumentFieldAttachment', back_populates='document',
        cascade='all, delete-orphan', lazy='dynamic',
    )

    __table_args__ = (
        Index('ix_doctor_documents_active', 'tenant_id', 'status', postgresql_where=text('is_deleted = FALSE')),
    )

    @staticmethod
    def _presign(stored):
        """Generate a fresh presigned URL from a stored ``bucket::key``.

        Kept for server-side use (the PDF renderer embeds images this way).
        NOT for API payloads — see ``_file_url``.
        """
        if not stored:
            return None
        if '::' not in stored:
            return stored
        try:
            from app.services.s3_service import S3Service
            bucket, key = stored.split('::', 1)
            return S3Service.generate_presigned_url(bucket, key, expiration=1800)
        except Exception:
            return None

    def _file_url(self, suffix, stored):
        """Link to the authenticated download route for one of our files.

        Deliberately NOT a presigned S3 URL. A presigned link would put the
        signing identity and an HMAC in the browser, hand out bearer-less
        access to a medical record for the whole expiry window, and — since
        it is signed at serialisation time — go stale inside any cached API
        response. ``/api/document-files/*`` re-checks the session on every
        hit and is minted at click time, so none of that applies.
        """
        if not stored:
            return None
        return f'/api/v1/document-files/{self.id}/{suffix}'

    def _get_pdf_url(self):
        return self._file_url('pdf', self.pdf_link)

    def _fields_with_attachments(self):
        """``custom_fields`` with each field's attachment list folded in.

        One query for the whole document rather than one per field — the
        preview renders every section, so lazy-loading per field would be a
        guaranteed N+1.
        """
        by_field = {}
        for att in self.field_attachments.all():
            by_field.setdefault(str(att.field_id), []).append(att.to_dict())

        out = []
        for f in (self.custom_fields or []):
            field = dict(f)
            field['attachments'] = by_field.get(str(f.get('id')), [])
            out.append(field)
        return out

    def to_dict(self, include_patient=False, include_doctor=False):
        # A document belongs to either a marketplace order or a group-offering
        # booking. Surface a common "source" so the list view renders both.
        if self.group_booking_id:
            source_type = 'group_offering'
            source_name = self.group_booking.plan_name if self.group_booking else None
            source_status = self.group_booking.status if self.group_booking else None
        else:
            source_type = 'service_order'
            source_name = self.order.product.name if (self.order and self.order.product) else None
            source_status = self.order.status if self.order else None
        data = {
            'id': str(self.id),
            'order_id': str(self.order_id) if self.order_id else None,
            'group_booking_id': str(self.group_booking_id) if self.group_booking_id else None,
            'source_type': source_type,
            # Denormalised for the doctor's list view — it shows which
            # purchased service / plan the document belongs to.
            'product_name': source_name,
            'order_status': source_status,
            'patient_id': str(self.patient_id),
            'doctor_id': str(self.doctor_id),
            'description': self.description,
            'custom_fields': self._fields_with_attachments(),
            'attachment_url': self._file_url('attachment', self.attachment_link),
            'attachment_name': self.attachment_name,
            'status': self.status.value,
            'rejection_reason': self.rejection_reason,
            'issue_date': self.issue_date.isoformat() if self.issue_date else None,
            'valid_until': self.valid_until.isoformat() if self.valid_until else None,
            'pdf_link': self._get_pdf_url(),
            'parent_document_id': str(self.parent_document_id) if self.parent_document_id else None,
            'revision_number': self.revision_number or 1,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_patient and self.patient:
            data['patient'] = _patient_block(self.patient)
        if include_doctor and self.doctor:
            data['doctor'] = _doctor_block(self.doctor)
        return data

    def __repr__(self):
        return f"<DoctorDocument {self.id} - {self.status.value}>"


class DoctorDocumentFieldAttachment(TenantMixin, db.Model):
    """Files attached to one custom field of a document — many per field.

    Separate from ``DoctorDocument.attachment_link``, which is the single
    document-wide slot. This table is the per-field list, so a field like
    "Lab results" can carry several reports.

    ``field_id`` is not a foreign key: custom fields live inside the
    ``custom_fields`` JSON column, not in a table of their own. The routes
    are responsible for (a) rejecting an upload against a field id the
    document doesn't have and (b) deleting these rows when the field they
    belong to is removed on update — see ``update_document``.
    """
    __tablename__ = 'doctor_document_field_attachments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_documents.document_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # Matches ``custom_fields[i]['id']`` on the parent document.
    field_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)

    # ``bucket::key`` in a private bucket, presigned on read like every
    # other file reference on this model.
    s3_link = db.Column(db.String(500), nullable=False)
    file_name = db.Column(db.String(255), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    document = db.relationship('DoctorDocument', back_populates='field_attachments')

    __table_args__ = (
        Index('ix_doc_field_attachments_lookup', 'document_id', 'field_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'field_id': str(self.field_id),
            'name': self.file_name,
            # Authenticated download route, never a presigned S3 URL —
            # see DoctorDocument._file_url for why.
            'url': f'/api/v1/document-files/{self.document_id}/field-attachment/{self.id}',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<DoctorDocumentFieldAttachment {self.id} field={self.field_id}>"
