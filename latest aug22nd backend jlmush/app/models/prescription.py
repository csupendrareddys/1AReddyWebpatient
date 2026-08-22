"""
Prescription models: Prescription, PrescriptionMedicine, PrescriptionTemplate,
MedicineBrand, Medicine, BannedMedicine.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import (
    PrescriptionStatus, FollowUpType, ConsultationType,
)


class MedicineBrand(TenantMixin, db.Model):
    """Medicine brand/manufacturer information."""
    __tablename__ = 'medicine_brands'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='brand_id')
    name = db.Column(db.String(200), nullable=False, index=True)
    manufacturer = db.Column(db.String(300), nullable=True)
    country = db.Column(db.String(100), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    medicines = db.relationship('Medicine', back_populates='brand', lazy='dynamic')

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'name', name='uq_medicine_brand_tenant_name'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'manufacturer': self.manufacturer,
        }

    def __repr__(self):
        return f"<MedicineBrand {self.name}>"


class Medicine(TenantMixin, db.Model):
    """Medicine catalog managed by admin."""
    __tablename__ = 'medicines'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='medicine_id')
    brand_id = db.Column(UUID(as_uuid=True), db.ForeignKey('medicine_brands.brand_id'), nullable=True, index=True)

    name = db.Column(db.String(300), nullable=False, index=True)
    generic_name = db.Column(db.String(300), nullable=True, index=True)
    composition = db.Column(db.Text, nullable=True)
    form = db.Column(db.String(100), nullable=True)
    strength = db.Column(db.String(100), nullable=True)
    requires_prescription = db.Column(db.Boolean, default=True, nullable=False)
    mrp = db.Column(db.Numeric(10, 2), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    brand = db.relationship('MedicineBrand', back_populates='medicines')
    prescription_medicines = db.relationship('PrescriptionMedicine', back_populates='medicine', lazy='dynamic')

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'generic_name': self.generic_name,
            'composition': self.composition,
            'form': self.form,
            'strength': self.strength,
            'mrp': str(self.mrp) if self.mrp else None,
            'brand': self.brand.to_dict() if self.brand else None,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<Medicine {self.name}>"


class Prescription(TenantMixin, db.Model):
    """Medical prescriptions issued by doctors."""
    __tablename__ = 'prescriptions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='prescription_id')

    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id'), nullable=True, index=True)
    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)

    # Clinical details
    diagnosis = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    allergies = db.Column(db.Text, nullable=True)
    diagnostic_tests = db.Column(db.Text, nullable=True)
    instructions = db.Column(db.Text, nullable=True)
    previous_medical_history = db.Column(db.Text, nullable=True)
    doctors_advice = db.Column(db.Text, nullable=True)
    follow_up = db.Column(db.Text, nullable=True)

    # Structured follow-up scheduling
    follow_up_type = db.Column(db.Enum(FollowUpType, values_callable=lambda x: [e.value for e in x], create_type=False), nullable=True)
    follow_up_consultation_type = db.Column(db.Enum(ConsultationType, values_callable=lambda x: [e.value for e in x], create_type=False), nullable=True)
    follow_up_date = db.Column(db.Date, nullable=True)
    follow_up_time_slot_id = db.Column(UUID(as_uuid=True), db.ForeignKey('time_slots.id', ondelete='SET NULL'), nullable=True)

    status = db.Column(db.Enum(PrescriptionStatus, values_callable=lambda x: [e.value for e in x]), default=PrescriptionStatus.DRAFT, nullable=False, index=True)

    parent_prescription_id = db.Column(UUID(as_uuid=True), db.ForeignKey('prescriptions.prescription_id'), nullable=True, index=True)
    revision_number = db.Column(db.Integer, default=1, nullable=False)

    issue_date = db.Column(db.Date, default=lambda: utcnow().date(), nullable=False)
    valid_until = db.Column(db.Date, nullable=True)
    pdf_link = db.Column(db.String(500), nullable=True)

    # Doctor credentials FROZEN at issue time (status -> ACTIVE). Live
    # qualification/specialization derive from the ProfileEducationDegree /
    # ProfileEducationSpecialization FK stores, which a doctor can now edit
    # (save_education write-through) and an admin can rename — so without a
    # snapshot an already-issued prescription's credentials would mutate
    # retroactively. NULL on legacy rows; to_dict + the PDF fall back to the
    # live value then.
    doctor_qualification_snapshot  = db.Column(db.String(500), nullable=True)
    doctor_specialization_snapshot = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    appointment = db.relationship('Appointment', back_populates='prescriptions', foreign_keys=[appointment_id])
    patient = db.relationship('Patient', back_populates='prescriptions')
    doctor = db.relationship('Doctor', back_populates='prescriptions')
    medicines = db.relationship('PrescriptionMedicine', back_populates='prescription', cascade="all, delete-orphan", lazy='dynamic')
    parent_prescription = db.relationship('Prescription', remote_side='Prescription.id', backref='revisions', uselist=False)
    follow_up_time_slot = db.relationship('TimeSlot', foreign_keys=[follow_up_time_slot_id], uselist=False)

    __table_args__ = (
        Index('ix_prescriptions_active', 'tenant_id', 'status', postgresql_where=text('is_deleted = FALSE')),
    )

    def _get_pdf_url(self):
        """Generate a fresh presigned URL from the stored private S3 key."""
        if not self.pdf_link:
            return None
        if '::' not in self.pdf_link:
            return self.pdf_link
        try:
            from app.services.s3_service import S3Service
            bucket, key = self.pdf_link.split('::', 1)
            return S3Service.generate_presigned_url(bucket, key, expiration=1800)
        except Exception:
            return None

    @staticmethod
    def compute_doctor_credentials(doc):
        """Live qualification + specialization strings for a doctor, from the
        ProfileEducationDegree / ProfileEducationSpecialization FK stores.
        Returns (qualification_str, specialization_str), each None if empty."""
        qual_str = None
        try:
            quals = list(doc.qualifications.all()) if hasattr(doc.qualifications, 'all') else []
            if quals:
                qual_str = ', '.join(q.degree_name for q in quals if q.degree_name) or None
        except Exception:
            qual_str = None
        spec_str = None
        try:
            specs = list(doc.specializations.all()) if hasattr(doc.specializations, 'all') else []
            if specs:
                spec_str = ', '.join(
                    s.category.name for s in specs if s.category and s.category.name
                ) or None
        except Exception:
            spec_str = None
        return qual_str, spec_str

    def capture_doctor_credentials(self):
        """Freeze the doctor's credentials onto this prescription. Call at the
        DRAFT -> ACTIVE (issue) transition so later education edits / master
        renames don't retroactively change an already-issued document."""
        if self.doctor is not None:
            q, s = Prescription.compute_doctor_credentials(self.doctor)
            self.doctor_qualification_snapshot = q
            self.doctor_specialization_snapshot = s

    def to_dict(self, include_patient=False, include_doctor=False):
        medicines = [med.to_dict() for med in self.medicines.all()]
        data = {
            'id': str(self.id),
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'patient_id': str(self.patient_id),
            'doctor_id': str(self.doctor_id),
            'diagnosis': self.diagnosis,
            'notes': self.notes,
            'allergies': self.allergies,
            'diagnostic_tests': self.diagnostic_tests,
            'instructions': self.instructions,
            'previous_medical_history': self.previous_medical_history,
            'doctors_advice': self.doctors_advice,
            'follow_up': self.follow_up,
            'follow_up_type': self.follow_up_type.value if self.follow_up_type else None,
            'follow_up_consultation_type': self.follow_up_consultation_type.value if self.follow_up_consultation_type else None,
            'follow_up_date': self.follow_up_date.isoformat() if self.follow_up_date else None,
            'follow_up_time_slot_id': str(self.follow_up_time_slot_id) if self.follow_up_time_slot_id else None,
            'follow_up_slot_details': self.follow_up_time_slot.to_dict() if self.follow_up_time_slot else None,
            'status': self.status.value,
            'issue_date': self.issue_date.isoformat() if self.issue_date else None,
            'valid_until': self.valid_until.isoformat() if self.valid_until else None,
            'pdf_link': self._get_pdf_url(),
            'parent_prescription_id': str(self.parent_prescription_id) if self.parent_prescription_id else None,
            'revision_number': self.revision_number or 1,
            'medicines': medicines,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_patient and self.patient:
            pat = self.patient
            _vitals = {}
            try:
                from app.models.health import HealthRecord
                _vr = HealthRecord.query.filter_by(
                    patient_id=pat.id, record_type='vitals', is_deleted=False
                ).order_by(HealthRecord.record_date.desc()).first()
                if _vr and _vr.details:
                    _vitals = _vr.details
            except Exception:
                pass

            # ``gender`` and ``dob`` were moved off Patient onto User by
            # the schema split (see patient.py docstring). Reading them
            # directly off ``pat`` raises AttributeError now — that's
            # the 500 the doctor hits the first time they PUT a
            # prescription that finalises and returns ``include_patient``.
            # Route through ``pat.user`` like every other call site in
            # the codebase.
            _pu = pat.user
            data['patient'] = {
                'id': str(pat.id),
                'full_name': pat.full_name,
                'gender': _pu.gender.value if (_pu and _pu.gender) else None,
                'dob': str(_pu.dob) if (_pu and _pu.dob) else None,
                'aadhar_number': pat.aadhar_number,
                'phone_number': _pu.phone_number if _pu else None,
                'blood_group': pat.blood_group.value if pat.blood_group else None,
                'height': _vitals.get('height_cm'),
                'weight': _vitals.get('weight_kg'),
            }
        if include_doctor and self.doctor:
            doc = self.doctor
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
                            sig_record.signature1_s3_bucket,
                            sig_record.signature1_s3_key,
                        )
                    elif sig_record.signature2_s3_key and sig_record.signature2_s3_bucket:
                        sig_url = S3Service.generate_presigned_url(
                            sig_record.signature2_s3_bucket,
                            sig_record.signature2_s3_key,
                        )
                except Exception:
                    sig_url = None
            # Prefer the frozen-at-issue snapshot so an already-issued
            # prescription's credentials never change when the doctor later
            # edits education or an admin renames a master row. Legacy rows
            # (snapshot NULL) fall back to the live FK-derived value.
            qual_str = self.doctor_qualification_snapshot
            spec_str = self.doctor_specialization_snapshot
            if qual_str is None and spec_str is None:
                qual_str, spec_str = Prescription.compute_doctor_credentials(doc)
            clinic_address = None
            comm_addr = getattr(doc, 'communication_address', None)
            if comm_addr and isinstance(comm_addr, dict):
                addr_parts = [
                    comm_addr.get('address_line1', ''),
                    comm_addr.get('address_line2', ''),
                    comm_addr.get('city', ''),
                    comm_addr.get('state', ''),
                    comm_addr.get('pincode', ''),
                ]
                clinic_address = ', '.join(p for p in addr_parts if p)
            data['doctor'] = {
                'id': str(doc.id),
                'full_name': doc.full_name,
                'qualification': qual_str,
                'specialization': spec_str,
                'registration_number': getattr(doc, 'registration_number', None),
                'clinic_address': clinic_address,
                'signature_url': sig_url,
                'profile_image': getattr(doc, 'profile_image', None),
            }
        return data

    def __repr__(self):
        return f"<Prescription {self.id} - {self.status.value}>"


class PrescriptionMedicine(TenantMixin, db.Model):
    """Medicines in a prescription — one row per medicine line item."""
    __tablename__ = 'prescription_medicines'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prescription_id = db.Column(UUID(as_uuid=True), db.ForeignKey('prescriptions.prescription_id', ondelete='CASCADE'), nullable=False, index=True)
    medicine_id = db.Column(UUID(as_uuid=True), db.ForeignKey('medicines.medicine_id'), nullable=True, index=True)

    custom_generic_name = db.Column(db.String(300), nullable=True)
    custom_brand_name = db.Column(db.String(300), nullable=True)

    quantity = db.Column(db.Integer, nullable=True)
    quantity_unit = db.Column(db.String(50), nullable=True)

    dosage = db.Column(db.String(200), nullable=True)
    frequency = db.Column(db.String(200), nullable=True)
    duration = db.Column(db.String(200), nullable=True)

    morning = db.Column(db.String(10), nullable=True)
    afternoon = db.Column(db.String(10), nullable=True)
    evening = db.Column(db.String(10), nullable=True)
    night = db.Column(db.String(10), nullable=True)

    medicine_type = db.Column(db.String(20), nullable=True, default='solid')

    timing = db.Column(db.String(200), nullable=True)
    morning_timing = db.Column(db.String(100), nullable=True)
    afternoon_timing = db.Column(db.String(100), nullable=True)
    evening_timing = db.Column(db.String(100), nullable=True)
    night_timing = db.Column(db.String(100), nullable=True)

    morning_instructions = db.Column(db.Text, nullable=True)
    afternoon_instructions = db.Column(db.Text, nullable=True)
    evening_instructions = db.Column(db.Text, nullable=True)
    night_instructions = db.Column(db.Text, nullable=True)

    custom_dose_unit = db.Column(db.String(50), nullable=True)

    special_instructions = db.Column(db.Text, nullable=True)
    serial_no = db.Column(db.Integer, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    prescription = db.relationship('Prescription', back_populates='medicines')
    medicine = db.relationship('Medicine', back_populates='prescription_medicines')

    def to_dict(self):
        med = self.medicine
        return {
            'id': str(self.id),
            'serial_no': self.serial_no,
            'medicine_id': str(self.medicine_id) if self.medicine_id else None,
            'medicine_name': med.name if med else self.custom_brand_name,
            'generic_name': med.generic_name if med else self.custom_generic_name,
            'brand_name': med.name if med else self.custom_brand_name,
            'form': med.form if med else None,
            'strength': med.strength if med else None,
            'quantity': self.quantity,
            'quantity_unit': self.quantity_unit,
            'dosage': self.dosage,
            'frequency': self.frequency,
            'duration': self.duration,
            'medicine_type': self.medicine_type or 'solid',
            'morning': self.morning,
            'afternoon': self.afternoon,
            'evening': self.evening,
            'night': self.night,
            'timing': self.timing,
            'morning_timing': self.morning_timing,
            'afternoon_timing': self.afternoon_timing,
            'evening_timing': self.evening_timing,
            'night_timing': self.night_timing,
            'morning_instructions': self.morning_instructions,
            'afternoon_instructions': self.afternoon_instructions,
            'evening_instructions': self.evening_instructions,
            'night_instructions': self.night_instructions,
            'custom_dose_unit': self.custom_dose_unit,
            'instructions': self.special_instructions,
        }

    def __repr__(self):
        name = self.medicine.name if self.medicine else self.custom_generic_name or 'N/A'
        return f"<PrescriptionMedicine {name}>"


class BannedMedicine(TenantMixin, db.Model):
    """Banned / non-permissible generic formulae maintained by admin."""
    __tablename__ = 'banned_medicines'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    generic_name = db.Column(db.String(300), nullable=False, index=True)
    reason = db.Column(db.Text, nullable=True)
    banned_by = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    def to_dict(self):
        return {
            'id': str(self.id),
            'generic_name': self.generic_name,
            'reason': self.reason,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<BannedMedicine {self.generic_name}>"


# Fallback disclaimer for documents when the admin hasn't set one. Kept as a
# constant (not a column default) so existing tenants pick it up without a
# data backfill, and so tweaking the wording doesn't need a migration.
DEFAULT_DOCUMENT_DISCLAIMER = (
    "1. This document is issued for the service purchased by the patient and is based on the "
    "information they provided. It is not a prescription.\n"
    "2. The information is confidential in nature and for the recipient's use only\n"
    "3. The patient is advised to consult a doctor in person for any medical concern\n"
    "4. Valid in India only"
)


class PrescriptionTemplate(TenantMixin, db.Model):
    """Admin-configurable prescription PDF template."""
    __tablename__ = 'prescription_templates'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.String(200), nullable=False, default='Default Template')
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    # Header
    clinic_name = db.Column(db.String(300), nullable=True)
    clinic_logo_url = db.Column(db.String(500), nullable=True)
    header_subtitle = db.Column(db.Text, nullable=True)
    show_doctor_name = db.Column(db.Boolean, default=True)
    show_doctor_qualification = db.Column(db.Boolean, default=True)
    show_doctor_specialization = db.Column(db.Boolean, default=True)
    show_registration_number = db.Column(db.Boolean, default=True)

    # Patient Info Section
    show_patient_name = db.Column(db.Boolean, default=True)
    show_patient_age_gender = db.Column(db.Boolean, default=True)
    show_patient_id = db.Column(db.Boolean, default=True)
    show_prescription_id = db.Column(db.Boolean, default=True)
    show_prescription_date = db.Column(db.Boolean, default=True)

    # Body Sections
    sections_config = db.Column(db.JSON, nullable=True, default=lambda: [
        {'key': 'notes', 'label': 'Chief Complaint', 'visible': True, 'order': 1},
        {'key': 'previous_medical_history', 'label': 'Previous Medical History', 'visible': True, 'order': 2},
        {'key': 'allergies', 'label': 'Allergies', 'visible': True, 'order': 3},
        {'key': 'diagnosis', 'label': 'Provisional Diagnosis', 'visible': True, 'order': 4},
        {'key': 'diagnostic_tests', 'label': 'Diagnostic Tests', 'visible': True, 'order': 5},
        {'key': 'instructions', 'label': 'Instructions', 'visible': True, 'order': 6},
        {'key': 'medicines', 'label': 'Medicines', 'visible': True, 'order': 7},
        {'key': 'doctors_advice', 'label': "Doctor's Advice", 'visible': True, 'order': 8},
        {'key': 'follow_up', 'label': 'Follow-up', 'visible': True, 'order': 9},
    ])

    # Footer / Disclaimer
    show_doctor_signature = db.Column(db.Boolean, default=True)
    signature_label = db.Column(db.String(200), default='Sign')
    disclaimer_text = db.Column(db.Text, nullable=True, default=(
        "1. This Prescription is based on the information provided by You in an Online Consultation and not on any Physical verification. Visit Doctor in case of Emergency. This Prescription is valid in India Only.\n"
        "2. The information and advice provided here is provisional in nature as it is based on limited information Made available by the Patient\n"
        "3. The patient is advised to visit in person for thorough examination at the earliest\n"
        "4. The information is confidential in nature and for recipient's use only\n"
        "5. The prescription is generated on a Teleconsultation\n"
        "6. Not valid for Medico - Legal Purpose"
    ))
    disclaimer_title = db.Column(db.String(200), default='DISCLAIMER;')

    # Documents reuse this template for the letterhead, but the disclaimer
    # above is prescription-specific ("teleconsultation", "not valid for
    # medico-legal purpose"), which reads wrong on a purchased-service
    # deliverable. These two are the document-side override; when NULL the
    # renderer falls back to DEFAULT_DOCUMENT_DISCLAIMER rather than to the
    # prescription text.
    document_disclaimer_text = db.Column(db.Text, nullable=True)
    document_disclaimer_title = db.Column(db.String(200), nullable=True)

    rx_symbol_url = db.Column(db.String(500), nullable=True)
    rx_symbol_text = db.Column(db.String(20), nullable=True)

    show_share_button = db.Column(db.Boolean, default=True)
    show_print_button = db.Column(db.Boolean, default=True)
    show_follow_up_button = db.Column(db.Boolean, default=True)

    created_by = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'is_active': self.is_active,
            'clinic_name': self.clinic_name,
            'clinic_logo_url': self.clinic_logo_url,
            'header_subtitle': self.header_subtitle,
            'show_doctor_name': self.show_doctor_name,
            'show_doctor_qualification': self.show_doctor_qualification,
            'show_doctor_specialization': self.show_doctor_specialization,
            'show_registration_number': self.show_registration_number,
            'show_patient_name': self.show_patient_name,
            'show_patient_age_gender': self.show_patient_age_gender,
            'show_patient_id': self.show_patient_id,
            'show_prescription_id': self.show_prescription_id,
            'show_prescription_date': self.show_prescription_date,
            'sections_config': self.sections_config,
            'show_doctor_signature': self.show_doctor_signature,
            'signature_label': self.signature_label,
            'disclaimer_text': self.disclaimer_text,
            'disclaimer_title': self.disclaimer_title,
            'document_disclaimer_text': self.document_disclaimer_text or DEFAULT_DOCUMENT_DISCLAIMER,
            'document_disclaimer_title': self.document_disclaimer_title or 'DISCLAIMER;',
            'rx_symbol_url': self.rx_symbol_url,
            'rx_symbol_text': self.rx_symbol_text,
            'show_share_button': self.show_share_button,
            'show_print_button': self.show_print_button,
            'show_follow_up_button': self.show_follow_up_button,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
