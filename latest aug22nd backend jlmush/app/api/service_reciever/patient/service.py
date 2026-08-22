"""
Patient Service
Business logic for patient-related operations
"""
from datetime import date
from sqlalchemy import or_, func
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import (
    Patient, User, HealthRecord, Prescription, Appointment, Doctor,
    ProfileEducationDegree, ProfileEducationSpecialization, Category,
    DoctorHospitalAffiliation, Hospital, DoctorService, Symptom,
    AppointmentSymptom, AppointmentRating, AppointmentDocument, Payment,
    ServiceName, AppointmentStatus, UserVerificationStatus, HouseGroupMember,
    PublishStatus, HouseGroupRequest, HouseGroupRequestStatus,
    Gender, BloodGroup
)
import random
import string
import json
from datetime import datetime, timedelta
from app.extensions import get_redis_client


class OTPService:
    """Service for OTP generation and verification backed by Redis."""

    OTP_EXPIRY_MINUTES = 10
    OTP_LENGTH = 6

    @staticmethod
    def _redis_key(purpose, identifier):
        return f"patient_otp:{purpose}:{identifier}"

    @staticmethod
    def generate_otp(identifier, purpose='phone_change'):
        """
        Generate a 6-digit OTP and store it in Redis with a TTL.

        Args:
            identifier: Phone number or email
            purpose: 'phone_change' or 'email_change'

        Returns:
            True if OTP stored successfully

        Raises:
            ValueError: If Redis is unavailable
        """
        redis = get_redis_client()
        if redis is None:
            raise ValueError("OTP service unavailable")

        otp = ''.join(random.choices(string.digits, k=OTPService.OTP_LENGTH))
        now = datetime.utcnow()
        expires_at = now + timedelta(minutes=OTPService.OTP_EXPIRY_MINUTES)

        payload = json.dumps({
            'otp': otp,
            'purpose': purpose,
            'created_at': now.isoformat(),
            'expires_at': expires_at.isoformat(),
        })

        redis_key = OTPService._redis_key(purpose, identifier)
        ttl_seconds = OTPService.OTP_EXPIRY_MINUTES * 60
        redis.setex(redis_key, ttl_seconds, payload)

        return True

    @staticmethod
    def verify_otp(identifier, otp, purpose='phone_change'):
        """
        Verify OTP. Deletes the entry from Redis on successful match (consume on use).

        Args:
            identifier: Phone number or email
            otp: OTP entered by user
            purpose: 'phone_change' or 'email_change'

        Returns:
            True if OTP is valid, False otherwise

        Raises:
            ValueError: If Redis is unavailable
        """
        redis = get_redis_client()
        if redis is None:
            raise ValueError("OTP service unavailable")

        redis_key = OTPService._redis_key(purpose, identifier)
        raw = redis.get(redis_key)

        if not raw:
            return False

        try:
            stored = json.loads(raw)
        except (ValueError, TypeError):
            return False

        if stored.get('otp') != otp:
            return False

        # Consume on success
        redis.delete(redis_key)
        return True

    @staticmethod
    def cleanup():
        """No-op: Redis TTL handles expiry automatically."""
        pass


class PatientService:
    """Service class for patient operations."""
    
    @staticmethod
    def get_by_id(patient_id):
        """Get patient by ID."""
        return Patient.query.filter_by(id=patient_id, is_deleted=False).first()
    
    @staticmethod
    def get_by_user_id(user_id):
        """Get patient by user ID."""
        return Patient.query.filter_by(user_id=user_id, is_deleted=False).first()
    
    @staticmethod
    def create_profile(user_id, data):
        """
        Create a new patient profile.
        
        Args:
            user_id: UUID of the user
            data: Dictionary containing patient details
        
        Returns:
            Created Patient instance
        """
        # Schema split: first_name / middle_name / last_name / gender /
        # dob / profile_image moved off Patient onto User (see
        # ``app/models/patient.py`` docstring). Keep them as Patient
        # kwargs and the constructor raises
        # ``TypeError: '<name>' is an invalid keyword argument``.
        # Update the linked User row instead, then build Patient from
        # the health-attribute-only columns.
        from app.models import User
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if user is not None:
            user_field_updates = {
                k: data[k]
                for k in (
                    'first_name', 'middle_name', 'last_name',
                    'gender', 'dob', 'profile_image',
                )
                if k in data and data.get(k) is not None
            }
            for k, v in user_field_updates.items():
                setattr(user, k, v)
            db.session.add(user)

        patient = Patient(
            user_id=user_id,
            # TenantMixin makes tenant_id NOT NULL; not auto-populated
            # from g, so propagate from the linked User row.
            tenant_id=user.tenant_id if user is not None else None,
            blood_group=data.get('blood_group'),
            emergency_contact_name=data.get('emergency_contact_name'),
            emergency_contact_phone=data.get('emergency_contact_phone'),
            emergency_contact_relation=data.get('emergency_contact_relation'),
            insurance_provider=data.get('insurance_provider'),
            insurance_policy_number=data.get('insurance_policy_number'),
        )
        db.session.add(patient)
        db.session.commit()
        return patient
    
    # Fields that physically live on the User model after the
    # earlier User/Patient schema split (see app/models/patient.py:6
    # — "REMOVED: first_name, middle_name, last_name, gender, dob,
    # profile_image"). Writing these via setattr(patient, ...) is a
    # silent no-op (Python instance attribute, never reaches DB), and
    # READING patient.first_name now raises AttributeError — both
    # failure modes ended in 500s for the operator.
    # The six fields physically REMOVED from Patient and moved to
    # User: see the comment block atop ``app/models/patient.py``.
    # Everything else (including ``blood_group`` and
    # ``languages_known``) is still on Patient.
    _USER_OWNED_FIELDS = frozenset({
        'first_name', 'middle_name', 'last_name',
        'gender', 'dob', 'profile_image',
    })
    _PATIENT_OWNED_FIELDS = frozenset({
        'blood_group', 'languages_known',
        'emergency_contact_name', 'emergency_contact_phone',
        'emergency_contact_relation',
        'insurance_provider', 'insurance_policy_number',
        'caste', 'religion', 'citizenship',
        'pan_number', 'aadhar_number',
        'alternative_phone', 'alternative_email',
        'organization_details', 'female_health_details', 'address_details',
    })

    @staticmethod
    def _coerce_field(field, value):
        """Apply enum / date coercion for fields that need it. Empty
        string and unknown enum values fall back to ``None`` — that's
        the contract the route relies on (a malformed ``blood_group``
        nulls the field, never 400s)."""
        if value in (None, ''):
            # Treat empty string as "clear the field". Enums + dates
            # below have stricter handling; the rest just pass None.
            if field in ('gender', 'blood_group', 'dob'):
                return None
        if field == 'gender' and isinstance(value, str):
            try:
                return Gender(value)
            except ValueError:
                return None
        if field == 'blood_group' and isinstance(value, str):
            try:
                return BloodGroup(value)
            except ValueError:
                return None
        if field == 'dob' and isinstance(value, str):
            from datetime import date as _date
            try:
                return _date.fromisoformat(value)
            except (ValueError, AttributeError):
                return None
        return value

    @staticmethod
    def update_profile(user_id, data):
        """
        Update patient profile.

        Args:
            user_id: UUID of the user
            data: Dictionary containing updated patient details

        Returns:
            Updated Patient instance
        """
        patient = PatientService.get_by_user_id(user_id)
        if not patient:
            return None

        # Route fields to the right row based on the schema-split
        # ownership map. Anything outside both sets is silently
        # ignored — the route's own allowlist is the gate for what's
        # legal to send; this layer just routes it correctly.
        for field, raw_value in data.items():
            if field in PatientService._USER_OWNED_FIELDS:
                if patient.user is not None:
                    setattr(
                        patient.user, field,
                        PatientService._coerce_field(field, raw_value),
                    )
            elif field in PatientService._PATIENT_OWNED_FIELDS:
                setattr(
                    patient, field,
                    PatientService._coerce_field(field, raw_value),
                )

        # Update User model fields (phone, email) if provided
        # First check for duplicates to avoid constraint violation —
        # the DB-level uniques are (tenant_id, _phone_hash) and
        # (tenant_id, _email_hash), so the duplicate check has to be
        # scoped to the user's own tenant. Same email/phone existing
        # in OTHER tenants is by design and must NOT trigger a clash.
        if patient.user:
            from app.common.encryption import hash_for_search

            if 'phone_number' in data and data['phone_number']:
                new_phone = data['phone_number']
                phone_hash = hash_for_search(new_phone)
                existing = User.query.filter(
                    User._phone_hash == phone_hash,
                    User.tenant_id == patient.user.tenant_id,
                    User.id != patient.user.id,
                    User.is_deleted == False,
                ).first()
                if existing:
                    raise ValueError('Phone number already registered to another user in this tenant')
                patient.user.phone_number = new_phone

            if 'email' in data and data['email']:
                new_email = data['email']
                email_hash = hash_for_search(new_email)
                existing = User.query.filter(
                    User._email_hash == email_hash,
                    User.tenant_id == patient.user.tenant_id,
                    User.id != patient.user.id,
                    User.is_deleted == False,
                ).first()
                if existing:
                    raise ValueError('Email already registered to another user in this tenant')
                patient.user.email = new_email
        
        db.session.commit()
        return patient
    
    @staticmethod
    def get_health_records(patient_id, record_type=None, page=1, per_page=20):
        """
        Get patient's health records with optional filtering.
        
        Args:
            patient_id: UUID of the patient
            record_type: Optional filter by record type
            page: Page number
            per_page: Records per page
        
        Returns:
            Paginated health records
        """
        query = HealthRecord.query.filter_by(patient_id=patient_id, is_deleted=False)
        
        if record_type:
            query = query.filter_by(record_type=record_type)
        
        query = query.order_by(HealthRecord.record_date.desc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)
    
    @staticmethod
    def get_prescriptions(patient_id, status=None, page=1, per_page=20):
        """
        Get patient's prescriptions.
        
        Args:
            patient_id: UUID of the patient
            status: Optional filter by status
            page: Page number
            per_page: Records per page
        
        Returns:
            Paginated prescriptions
        """
        query = Prescription.query.filter_by(patient_id=patient_id, is_deleted=False)
        
        if status:
            query = query.filter_by(status=status)
        
        query = query.order_by(Prescription.issue_date.desc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)
    
    @staticmethod
    def get_appointments(patient_id, status=None, page=1, per_page=20):
        """
        Get patient's appointments.
        
        Args:
            patient_id: UUID of the patient
            status: Optional filter by status
            page: Page number
            per_page: Records per page
        
        Returns:
            Paginated appointments
        """
        query = Appointment.query.filter_by(patient_id=patient_id, is_deleted=False)
        
        if status:
            query = query.filter_by(status=status)
        
        query = query.order_by(Appointment.appointment_date.desc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)


class DoctorListService:
    """Service for listing doctors with filters."""
    
    @staticmethod
    def get_doctors(specialization=None, city=None, search=None, page=1, per_page=20):
        """
        Get list of doctors with optional filters.
        
        Args:
            specialization: Filter by specialization/category name
            city: Filter by city of hospital affiliation
            search: Search by doctor name
            page: Page number
            per_page: Results per page
        
        Returns:
            Paginated list of doctors with details
        """
        # Show doctor if global publish_status is ACTIVE, or if any
        # per-type publish_status_by_type entry is 'active'.
        query = Doctor.query.filter(
            Doctor.is_deleted == False,
            Doctor.verification_status == UserVerificationStatus.VERIFIED,
            or_(
                Doctor.publish_status == PublishStatus.ACTIVE,
                db.cast(Doctor.publish_status_by_type, db.Text).ilike('%"active"%'),
            ),
        )
        
        # Filter by search term (name)
        if search:
            # Names live on the related User row (consolidated in the
            # multi-profile refactor); Doctor.first_name/last_name are
            # read-only property shims, not columns, so filtering on them
            # raises "'property' object has no attribute 'ilike'". Join User
            # and filter there, mirroring booking_service.list_doctors.
            from app.models import User
            query = query.join(User, Doctor.user_id == User.id).filter(
                or_(
                    User.first_name.ilike(f'%{search}%'),
                    User.last_name.ilike(f'%{search}%')
                )
            )
        
        # Filter by specialization
        if specialization:
            query = query.join(ProfileEducationSpecialization).join(Category).filter(
                Category.name.ilike(f'%{specialization}%')
            )
        
        # Filter by city
        if city:
            query = query.join(DoctorHospitalAffiliation).join(Hospital).filter(
                Hospital.city.ilike(f'%{city}%'),
                DoctorHospitalAffiliation.is_active == True
            )
        
        query = query.order_by(Doctor.created_at.desc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)
    
    @staticmethod
    def get_doctor_detail(doctor_id):
        """Get detailed doctor information."""
        doctor = Doctor.query.filter_by(
            id=doctor_id,
            is_deleted=False
        ).first()
        
        if not doctor:
            return None
        
        return doctor
    
    @staticmethod
    def format_doctor_for_list(doctor):
        """Format doctor data for list response with all details."""
        # Get highest qualification
        highest_qual = doctor.qualifications.order_by(
            ProfileEducationDegree.passing_year.desc()
        ).first()
        
        # Get specializations
        specializations = [
            spec.category.name for spec in doctor.specializations.all()
            if spec.category
        ]
        
        # Get hospital affiliations
        affiliations = [
            {
                'hospital_name': aff.hospital.name if aff.hospital else None,
                'city': aff.hospital.city if aff.hospital else None,
            }
            for aff in doctor.hospital_affiliations.filter_by(is_active=True).all()
            if aff.hospital
        ]
        
        # Calculate average rating
        avg_rating = None
        total_reviews = 0
        appointments_with_ratings = Appointment.query.filter_by(
            doctor_id=doctor.id,
            is_deleted=False
        ).join(AppointmentRating).all()
        
        if appointments_with_ratings:
            ratings = [apt.rating.rating for apt in appointments_with_ratings if apt.rating]
            if ratings:
                avg_rating = sum(ratings) / len(ratings)
                total_reviews = len(ratings)
        
        # ``first_name`` / ``last_name`` / ``profile_image`` / ``about``
        # moved to User (and ProfileAbout for ``about``) when the
        # Doctor/Admin shared-profile tables were split. Reading them
        # off the Doctor row directly AttributeError'd, taking the
        # whole patient browse / detail flow down.
        doctor_user = doctor.user
        # ProfileAbout owns ``brief_about_text`` (the new home of
        # ``about``). Look it up explicitly — Doctor doesn't expose
        # a ``profile_about`` relationship by default.
        from app.models import ProfileAbout
        about_row = ProfileAbout.query.filter_by(doctor_id=doctor.id).first()
        about_text = about_row.brief_about_text if about_row else None

        return {
            'id': str(doctor.id),
            'full_name': doctor.full_name,
            'first_name': getattr(doctor_user, 'first_name', None) if doctor_user else None,
            'last_name': getattr(doctor_user, 'last_name', None) if doctor_user else None,
            'profile_image': getattr(doctor_user, 'profile_image', None) if doctor_user else None,
            'highest_qualification': highest_qual.degree_name if highest_qual else None,
            'specializations': specializations,
            'languages_known': doctor.languages_known or [],
            'experience_years': doctor.experience_years,
            'consultation_fee': str(doctor.consultation_fee) if doctor.consultation_fee else None,
            'verification_status': doctor.verification_status.value,
            'rating': round(avg_rating, 1) if avg_rating else None,
            'total_reviews': total_reviews,
            'hospital_affiliations': affiliations,
            'about': about_text,
        }


class SymptomService:
    """Service for symptom operations."""
    
    @staticmethod
    def get_all_symptoms(category=None):
        """
        Get all active symptoms.
        
        Args:
            category: Optional filter by category
        
        Returns:
            List of symptoms
        """
        query = Symptom.query.filter_by(is_active=True)
        
        if category:
            query = query.filter_by(category=category)
        
        return query.order_by(Symptom.category, Symptom.name).all()
    
    @staticmethod
    def get_symptom_categories():
        """Get distinct symptom categories."""
        categories = db.session.query(Symptom.category).filter(
            Symptom.is_active == True,
            Symptom.category.isnot(None)
        ).distinct().all()
        
        return [cat[0] for cat in categories]


class PlatformService:
    """Service for listing consultation platforms/services."""
    
    @staticmethod
    def get_platforms():
        """
        Get all available platforms (ServiceName enum values).
        
        Returns:
            List of platforms with descriptions
        """
        platform_descriptions = {
            ServiceName.ONLINE_CONSULTATION: {
                'name': 'Online Consultation',
                'description': 'Video call consultation with doctor from anywhere'
            },
            ServiceName.INSTANT_CONSULTATION: {
                'name': 'Instant Consultation',
                'description': 'Connect with an available doctor immediately'
            },
            ServiceName.CLINICAL_CONSULTATION: {
                'name': 'Clinic Visit',
                'description': 'Visit the doctor at their clinic for in-person consultation'
            },
            ServiceName.PATIENT_HOME_VISIT: {
                'name': 'Home Visit',
                'description': 'Doctor visits you at your home'
            },
            ServiceName.COUNSELING: {
                'name': 'Counseling',
                'description': 'Mental health and counseling sessions'
            },
            ServiceName.VACCINATION: {
                'name': 'Vaccination',
                'description': 'Vaccination services'
            },
        }
        
        platforms = []
        for service in ServiceName:
            if service.value not in ['other1', 'other2']:
                info = platform_descriptions.get(service, {
                    'name': service.value.replace('_', ' ').title(),
                    'description': ''
                })
                platforms.append({
                    'key': service.value,
                    'name': info['name'],
                    'description': info['description']
                })
        
        return platforms


class PatientOrderService:
    """Service for patient orders (appointments)."""
    
    @staticmethod
    def get_upcoming_orders(patient_id, page=1, per_page=20):
        """
        Get upcoming orders/appointments for patient.
        
        Args:
            patient_id: Patient ID
            page: Page number
            per_page: Results per page
        
        Returns:
            Paginated list of upcoming appointments
        """
        today = date.today()
        
        query = Appointment.query.filter(
            Appointment.patient_id == patient_id,
            Appointment.is_deleted == False,
            Appointment.appointment_date >= today,
            Appointment.status.notin_([
                AppointmentStatus.COMPLETED,
                AppointmentStatus.CANCELLED
            ])
        ).order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)
    
    @staticmethod
    def get_previous_orders(patient_id, page=1, per_page=20):
        """
        Get previous/completed orders/appointments for patient.
        
        Args:
            patient_id: Patient ID
            page: Page number
            per_page: Results per page
        
        Returns:
            Paginated list of previous appointments
        """
        today = date.today()
        
        query = Appointment.query.filter(
            Appointment.patient_id == patient_id,
            Appointment.is_deleted == False,
            or_(
                Appointment.appointment_date < today,
                Appointment.status.in_([
                    AppointmentStatus.COMPLETED,
                    AppointmentStatus.CANCELLED
                ])
            )
        ).order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        
        return query.paginate(page=page, per_page=per_page, error_out=False)
    
    @staticmethod
    def get_order_by_id(order_id, patient_id):
        """Get order by ID with patient verification."""
        return Appointment.query.filter_by(
            id=order_id,
            patient_id=patient_id,
            is_deleted=False
        ).first()
    
    @staticmethod
    def format_order(appointment):
        """Format appointment data for response."""
        # Get doctor details
        doctor = appointment.doctor
        doctor_data = None
        if doctor:
            highest_qual = doctor.qualifications.order_by(
                ProfileEducationDegree.passing_year.desc()
            ).first()
            specializations = [
                spec.category.name for spec in doctor.specializations.all()
                if spec.category
            ]
            doctor_data = {
                'id': str(doctor.id),
                'full_name': doctor.full_name,
                # profile_image lives on User (was moved off Doctor
                # in the shared-profile split); ``doctor.profile_image``
                # AttributeError'd on every order-list call.
                'profile_image': (
                    getattr(doctor.user, 'profile_image', None)
                    if doctor.user else None
                ),
                'highest_qualification': highest_qual.degree_name if highest_qual else None,
                'languages_known': doctor.languages_known or [],
                'specializations': specializations,
            }
        
        # Get hospital details
        hospital = appointment.hospital
        hospital_data = None
        if hospital:
            hospital_data = {
                'id': str(hospital.id),
                'name': hospital.name,
                'address': hospital.address,
                'city': hospital.city,
                'state': hospital.state,
                'pincode': hospital.pincode,
                'latitude': float(hospital.latitude) if hospital.latitude else None,
                'longitude': float(hospital.longitude) if hospital.longitude else None,
            }
        
        # Get symptoms
        symptoms_data = [symptom.to_dict() for symptom in appointment.symptoms.all()]
        
        # Get invoice/payment
        payment = appointment.payments.order_by(Payment.payment_date.desc()).first()
        invoice_data = None
        if payment:
            invoice_data = {
                'payment_id': str(payment.id),
                'amount': str(payment.amount),
                'currency': payment.currency,
                'status': payment.status.value,
                'payment_date': payment.payment_date.isoformat() if payment.payment_date else None,
                'payment_gateway': payment.payment_gateway,
                'transaction_id': payment.transaction_id,
            }
        
        # Get prescription
        prescription = appointment.prescriptions.filter_by(is_deleted=False).first()
        prescription_data = None
        if prescription:
            medicines_data = [
                {
                    'name': med.medicine.name if med.medicine else None,
                    'dosage': med.dosage,
                    'frequency': med.frequency,
                    'duration': med.duration,
                    'timing': med.timing,
                    'instructions': med.special_instructions,
                }
                for med in prescription.medicines.all()
            ]
            prescription_data = {
                'id': str(prescription.id),
                'diagnosis': prescription.diagnosis,
                'notes': prescription.notes,
                'issue_date': prescription.issue_date.isoformat() if prescription.issue_date else None,
                'pdf_link': prescription.pdf_link,
                'medicines': medicines_data,
            }
        
        # Get follow-up appointment
        follow_up_data = None
        if appointment.follow_up:
            follow_up_data = {
                'id': str(appointment.follow_up.id),
                'appointment_date': appointment.follow_up.appointment_date.isoformat() if appointment.follow_up.appointment_date else None,
                'start_time': appointment.follow_up.start_time.isoformat() if appointment.follow_up.start_time else None,
            }
        
        # Get rating
        rating_data = None
        if appointment.rating:
            rating_data = appointment.rating.to_dict()
        
        # Get documents
        documents_data = [
            doc.to_dict() for doc in appointment.documents.filter_by(is_deleted=False).all()
        ]
        
        return {
            'id': str(appointment.id),
            'appointment_date': appointment.appointment_date.isoformat() if appointment.appointment_date else None,
            'start_time': appointment.start_time.isoformat() if appointment.start_time else None,
            'end_time': appointment.end_time.isoformat() if appointment.end_time else None,
            'appointment_type': appointment.appointment_type.value,
            'status': appointment.status.value,
            'consultation_fee': str(appointment.consultation_fee) if appointment.consultation_fee else None,
            'meeting_link': appointment.meeting_link,
            'chief_complaint': appointment.chief_complaint,
            'doctor': doctor_data,
            'patient': {
                'full_name': appointment.patient.full_name if appointment.patient else None
            },
            'hospital': hospital_data,
            'symptoms': symptoms_data,
            'invoice': invoice_data,
            'prescription': prescription_data,
            'follow_up_appointment': follow_up_data,
            'rating': rating_data,
            'documents': documents_data,
        }


class RatingService:
    """Service for appointment ratings."""
    
    @staticmethod
    def create_rating(appointment_id, rating, review=None, is_anonymous=False):
        """
        Create a rating for an appointment.
        
        Args:
            appointment_id: UUID of the appointment
            rating: Rating value (1-5)
            review: Optional review text
            is_anonymous: Whether rating is anonymous
        
        Returns:
            Created AppointmentRating instance
        """
        # Check if rating already exists
        existing = AppointmentRating.query.filter_by(
            appointment_id=appointment_id
        ).first()
        
        if existing:
            return None, 'Rating already exists for this appointment'
        
        appointment_rating = AppointmentRating(
            appointment_id=appointment_id,
            rating=rating,
            review=review,
            is_anonymous=is_anonymous
        )
        
        db.session.add(appointment_rating)
        db.session.commit()
        
        return appointment_rating, None
    
    @staticmethod
    def get_rating(appointment_id):
        """Get rating for an appointment."""
        return AppointmentRating.query.filter_by(
            appointment_id=appointment_id
        ).first()


class DocumentService:
    """Service for appointment documents."""
    
    @staticmethod
    def add_document(appointment_id, document_name, attachment_link, 
                     uploaded_by='patient', description=None, document_type=None):
        """
        Add a document to an appointment.
        
        Args:
            appointment_id: UUID of the appointment
            document_name: Name of the document
            attachment_link: URL/path to the document
            uploaded_by: 'patient' or 'doctor'
            description: Optional description
            document_type: Optional document type
        
        Returns:
            Created AppointmentDocument instance
        """
        document = AppointmentDocument(
            appointment_id=appointment_id,
            document_name=document_name,
            attachment_link=attachment_link,
            uploaded_by=uploaded_by,
            description=description,
            document_type=document_type
        )
        
        db.session.add(document)
        db.session.commit()
        
        return document
    
    @staticmethod
    def get_documents(appointment_id):
        """Get all documents for an appointment."""
        return AppointmentDocument.query.filter_by(
            appointment_id=appointment_id,
            is_deleted=False
        ).order_by(AppointmentDocument.created_at.desc()).all()
    
    @staticmethod
    def delete_document(document_id, appointment_id):
        """Soft delete a document."""
        document = AppointmentDocument.query.filter_by(
            id=document_id,
            appointment_id=appointment_id,
            is_deleted=False
        ).first()
        
        if not document:
            return None
        
        document.is_deleted = True
        db.session.commit()
        
        return document


class HouseGroupService:
    """Service for managing house group (family) members."""
    
    @staticmethod
    def get_members(patient_id):
        """Get all house group members for a patient."""
        return HouseGroupMember.query.filter_by(
            patient_id=patient_id,
            is_active=True
        ).order_by(HouseGroupMember.created_at.asc()).all()
    
    @staticmethod
    def add_member(patient_id, data):
        """Add a new house group member."""
        member = HouseGroupMember(
            patient_id=patient_id,
            relation=data.get('relation', 'Other'),
            first_name=data.get('first_name'),
            last_name=data.get('last_name'),
            gender=data.get('gender'),
            dob=data.get('dob'),
            blood_group=data.get('blood_group'),
            phone_number=data.get('phone_number'),
            email=data.get('email'),
        )
        db.session.add(member)
        db.session.commit()
        return member

    @staticmethod
    def add_minor(guardian_patient, data):
        """Create a MINOR sub-profile: a credential-less Patient (the minor's own
        data home) + a house-group member row that links it to the guardian and
        drives the profile switcher. Guardian-only (enforced at the route). The
        guardian operates the minor through the patient-family "act as" scope.
        """
        from app.common.managed_patient import create_managed_patient
        from app.models._enums import Gender

        gender = data.get('gender')
        if gender and isinstance(gender, str):
            try:
                gender = Gender(gender)
            except ValueError:
                gender = None

        minor = create_managed_patient(
            tenant_id=guardian_patient.tenant_id,
            first_name=data.get('first_name'),
            last_name=data.get('last_name'),
            dob=data.get('dob'),
            gender=gender,
        )
        member = HouseGroupMember(
            patient_id=guardian_patient.id,
            relation=data.get('relation') or 'Child',
            first_name=data.get('first_name'),
            last_name=data.get('last_name') or '',
            gender=gender,
            dob=data.get('dob'),
            blood_group=data.get('blood_group'),
            group_type='family',
            is_child_account=True,
            linked_user_id=minor.user_id,
            linked_patient_id=minor.id,
            permissions={'visible': True, 'appointments': 'manage', 'prescriptions': 'manage'},
        )
        db.session.add(member)
        db.session.commit()
        return member, minor

    @staticmethod
    def _assert_link_quota(owner_patient_id):
        """Raise if the owner's plan has no room for one more linked adult.
        Translated to HTTP by the calling route (PatientQuotaExceeded → 403)."""
        owner = Patient.query.get(owner_patient_id)
        if not owner:
            return
        from app.api.patient_family.quota import assert_quota_available
        assert_quota_available(owner, 'links')

    @staticmethod
    def get_minors(patient_id):
        """The guardian's minor sub-profiles (house-group members that own a
        managed patient)."""
        return (HouseGroupMember.query
                .filter_by(patient_id=patient_id, is_child_account=True, is_active=True)
                .order_by(HouseGroupMember.created_at.asc()).all())

    @staticmethod
    def update_member(member_id, patient_id, data):
        """Update a house group member."""
        member = HouseGroupMember.query.filter_by(
            id=member_id,
            patient_id=patient_id,
            is_active=True
        ).first()
        
        if not member:
            return None
            
        allowed_fields = [
            'relation', 'first_name', 'last_name', 'gender', 'dob',
            'blood_group', 'phone_number', 'email', 'profile_image'
        ]
        
        for field in allowed_fields:
            if field in data:
                setattr(member, field, data[field])
                
        db.session.commit()
        return member

    @staticmethod
    def delete_member(member_id, patient_id):
        """Soft delete a house group member."""
        member = HouseGroupMember.query.filter_by(
            id=member_id,
            patient_id=patient_id,
            is_active=True
        ).first()
        
        if not member:
            return None
            
        member.is_active = False
        db.session.commit()
        return member

    @staticmethod
    def update_member_permissions(member_id, patient_id, permissions):
        """Update permissions for a house group member."""
        member = HouseGroupMember.query.filter_by(
            id=member_id,
            patient_id=patient_id,
            is_active=True
        ).first()
        if not member:
            return None
        member.permissions = permissions
        db.session.commit()
        return member


class HealthRecordService:
    """Service for managing patient health records (vitals, habits, surgeries, etc.)."""

    @staticmethod
    def create_record(patient_id, user_id, data):
        """Create a new health record."""
        from datetime import date as date_type
        record_date = data.get('record_date')
        if isinstance(record_date, str):
            record_date = date_type.fromisoformat(record_date)
        elif not record_date:
            record_date = date.today()

        record = HealthRecord(
            patient_id=patient_id,
            record_type=data['record_type'],
            record_date=record_date,
            details=data.get('details', {}),
            notes=data.get('notes'),
            attachment_links=data.get('attachment_links'),
            uploaded_by=user_id,
            appointment_id=data.get('appointment_id'),
        )
        db.session.add(record)
        db.session.commit()
        return record

    @staticmethod
    def get_record(record_id, patient_id):
        """Get a specific health record."""
        return HealthRecord.query.filter_by(
            id=record_id,
            patient_id=patient_id,
            is_deleted=False
        ).first()

    @staticmethod
    def update_record(record_id, patient_id, data):
        """Update a health record."""
        record = HealthRecord.query.filter_by(
            id=record_id,
            patient_id=patient_id,
            is_deleted=False
        ).first()
        if not record:
            return None

        allowed = ['record_type', 'details', 'notes', 'attachment_links']
        for f in allowed:
            if f in data:
                setattr(record, f, data[f])

        if 'record_date' in data:
            from datetime import date as date_type
            rd = data['record_date']
            record.record_date = date_type.fromisoformat(rd) if isinstance(rd, str) else rd

        db.session.commit()
        return record

    @staticmethod
    def delete_record(record_id, patient_id):
        """Soft delete a health record."""
        record = HealthRecord.query.filter_by(
            id=record_id,
            patient_id=patient_id,
            is_deleted=False
        ).first()
        if not record:
            return None

        record.is_deleted = True
        record.deleted_at = datetime.utcnow()
        db.session.commit()
        return record

    @staticmethod
    def get_records_by_type(patient_id, record_type):
        """Get all health records of a specific type."""
        return HealthRecord.query.filter_by(
            patient_id=patient_id,
            record_type=record_type,
            is_deleted=False
        ).order_by(HealthRecord.record_date.desc()).all()

    @staticmethod
    def get_latest_vitals(patient_id):
        """Get the latest vitals snapshot."""
        record = HealthRecord.query.filter_by(
            patient_id=patient_id,
            record_type='vitals',
            is_deleted=False
        ).order_by(HealthRecord.record_date.desc()).first()
        return record.details if record else {}

    @staticmethod
    def save_vitals(patient_id, user_id, data):
        """Create or update the latest vitals record for today."""
        today = date.today()
        record = HealthRecord.query.filter_by(
            patient_id=patient_id,
            record_type='vitals',
            record_date=today,
            is_deleted=False
        ).first()

        if record:
            record.details = data
            db.session.commit()
            return record

        return HealthRecordService.create_record(patient_id, user_id, {
            'record_type': 'vitals',
            'record_date': today.isoformat(),
            'details': data,
        })

    @staticmethod
    def get_latest_habits(patient_id):
        """Get the latest habits snapshot."""
        record = HealthRecord.query.filter_by(
            patient_id=patient_id,
            record_type='habits',
            is_deleted=False
        ).order_by(HealthRecord.record_date.desc()).first()
        return record.details if record else {}

    @staticmethod
    def save_habits(patient_id, user_id, data):
        """Create or update the latest habits record for today."""
        today = date.today()
        record = HealthRecord.query.filter_by(
            patient_id=patient_id,
            record_type='habits',
            record_date=today,
            is_deleted=False
        ).first()

        if record:
            record.details = data
            db.session.commit()
            return record

        return HealthRecordService.create_record(patient_id, user_id, {
            'record_type': 'habits',
            'record_date': today.isoformat(),
            'details': data,
        })


# Valid complementary relation pairs for invite code validation
RELATION_PAIRS = {
    'father': {'son', 'daughter'},
    'mother': {'son', 'daughter'},
    'son': {'father', 'mother'},
    'daughter': {'father', 'mother'},
    'husband': {'wife', 'spouse'},
    'wife': {'husband', 'spouse'},
    'spouse': {'husband', 'wife', 'spouse'},
    'brother': {'brother', 'sister'},
    'sister': {'brother', 'sister'},
    'grandfather': {'grandson', 'granddaughter'},
    'grandmother': {'grandson', 'granddaughter'},
    'grandson': {'grandfather', 'grandmother'},
    'granddaughter': {'grandfather', 'grandmother'},
    'uncle': {'nephew', 'niece'},
    'aunt': {'nephew', 'niece'},
    'nephew': {'uncle', 'aunt'},
    'niece': {'uncle', 'aunt'},
    'father-in-law': {'daughter-in-law', 'son-in-law'},
    'mother-in-law': {'daughter-in-law', 'son-in-law'},
    'son-in-law': {'father-in-law', 'mother-in-law'},
    'daughter-in-law': {'father-in-law', 'mother-in-law'},
    'cousin': {'cousin'},
    'guardian': {'ward'},
    'ward': {'guardian'},
    'friend': {'friend'},
    'other': None,  # 'other' matches with anything
}


# Best-effort inverse of a family relation, used to label the reciprocal member
# created when a request is accepted. Symmetric relations map to themselves;
# gender-ambiguous inverses (Father → Son/Daughter) pick one and rely on the
# acceptor editing it if needed.
_INVERSE_RELATION = {
    'Father': 'Son', 'Mother': 'Son',
    'Son': 'Father', 'Daughter': 'Father',
    'Husband': 'Wife', 'Wife': 'Husband',
    'Spouse': 'Spouse', 'Brother': 'Brother', 'Sister': 'Sister',
    'Grandfather': 'Grandson', 'Grandmother': 'Grandson',
    'Grandson': 'Grandfather', 'Granddaughter': 'Grandmother',
    'Uncle': 'Nephew', 'Aunt': 'Nephew',
    'Nephew': 'Uncle', 'Niece': 'Aunt',
    'Guardian': 'Ward', 'Ward': 'Guardian',
    'Father-in-law': 'Son-in-law', 'Mother-in-law': 'Daughter-in-law',
    'Friend': 'Friend', 'Cousin': 'Cousin',
}


class HouseGroupRequestService:
    """Service for house group invitation/request system."""

    @staticmethod
    def send_request(requester_patient_id, data):
        """Send an invitation request to join house group."""
        import secrets
        from app.models import User, Patient

        target_phone = data.get('target_phone')
        target_user_id = data.get('target_user_id')

        # Validate required fields for direct invitation
        if not target_phone and not target_user_id:
            raise ValueError('Phone number is required')
        if target_phone and not data.get('target_name', '').strip():
            raise ValueError('First name is required')
        if target_phone and not data.get('target_last_name', '').strip():
            raise ValueError('Last name is required')
        if not data.get('relation'):
            raise ValueError('Relation is required')

        # If target_phone provided, look up the user to resolve target_user_id.
        # Phone numbers are stored hashed (``_phone_hash``), so match on the
        # search hash — never the ``phone_number`` property (not a column) — and
        # scope to the requester's tenant. ``User`` has no ``is_active`` column;
        # active is expressed via ``status`` / ``is_deleted``.
        requester_patient = Patient.query.get(requester_patient_id)
        req_tenant_id = (requester_patient.user.tenant_id
                         if requester_patient and requester_patient.user else None)
        if target_phone and not target_user_id:
            from app.common.encryption import hash_for_search
            phone_hash = hash_for_search(target_phone)
            q = User.query.filter_by(_phone_hash=phone_hash, is_deleted=False)
            if req_tenant_id:
                q = q.filter_by(tenant_id=req_tenant_id)
            target_user = q.first()
            if not target_user:
                raise ValueError(
                    f'No registered user found with phone number {target_phone}. '
                    'The person must have an account to be invited.'
                )
            # Don't allow inviting yourself
            if requester_patient and str(target_user.id) == str(requester_patient.user_id):
                raise ValueError('You cannot send a request to yourself')
            target_user_id = target_user.id

        # If target_user_id provided, validate it exists
        if target_user_id:
            target_user = User.query.filter_by(id=target_user_id, is_deleted=False).first()
            if not target_user:
                raise ValueError('Target user not found')

        # Check for duplicate pending request
        existing = HouseGroupRequest.query.filter_by(
            requester_patient_id=requester_patient_id,
            status=HouseGroupRequestStatus.PENDING,
        )
        if target_phone:
            existing = existing.filter_by(target_phone=target_phone)
        elif target_user_id:
            existing = existing.filter_by(target_user_id=target_user_id)
        if existing.first():
            raise ValueError('A pending request already exists for this person')

        invite_code = secrets.token_urlsafe(8)

        req = HouseGroupRequest(
            requester_patient_id=requester_patient_id,
            target_user_id=target_user_id,
            target_phone=target_phone,
            target_name=data.get('target_name', '').strip(),
            target_last_name=data.get('target_last_name', '').strip(),
            invite_code=invite_code,
            relation=data['relation'],
            group_type=data.get('group_type', 'family'),
            permissions=data.get('permissions'),
        )
        db.session.add(req)
        db.session.commit()
        return req

    @staticmethod
    def get_sent_requests(patient_id):
        """Get requests sent by the patient."""
        return HouseGroupRequest.query.filter_by(
            requester_patient_id=patient_id,
        ).order_by(HouseGroupRequest.created_at.desc()).all()

    @staticmethod
    def get_received_requests(user_id):
        """Get requests received by a user (by user_id or by phone number)."""
        from app.models import User
        from sqlalchemy import or_

        user = User.query.get(user_id)
        if not user:
            return []

        # Match by target_user_id OR by target_phone (for older requests
        # that were created before phone→user resolution was added)
        filters = [HouseGroupRequest.target_user_id == user_id]
        if user.phone_number:
            filters.append(HouseGroupRequest.target_phone == user.phone_number)

        return HouseGroupRequest.query.filter(
            or_(*filters),
            HouseGroupRequest.status == HouseGroupRequestStatus.PENDING,
        ).order_by(HouseGroupRequest.created_at.desc()).all()

    @staticmethod
    def accept_request(request_id, user_id, acceptor_patient_id, receiver_relation=None):
        """Accept a house group request and create the member link."""
        from app.models import User

        req = HouseGroupRequest.query.get(request_id)
        if not req:
            raise ValueError('Request not found')
        if req.status != HouseGroupRequestStatus.PENDING:
            raise ValueError('Request is no longer pending')

        # Verify the request is addressed to this user (by user_id or phone)
        is_target = False
        if req.target_user_id and str(req.target_user_id) == str(user_id):
            is_target = True
        elif req.target_phone:
            user = User.query.get(user_id)
            if user and user.phone_number == req.target_phone:
                is_target = True
                # Backfill target_user_id for older requests
                req.target_user_id = user_id
        if not is_target:
            raise ValueError('This request is not addressed to you')
        if not receiver_relation:
            raise ValueError('Please select your relation to complete acceptance')

        # Both sides gain a linked-adult member here, so both owners' plan link
        # quotas must have room before the reciprocal pair is created.
        HouseGroupService._assert_link_quota(req.requester_patient_id)
        HouseGroupService._assert_link_quota(acceptor_patient_id)

        req.status = HouseGroupRequestStatus.ACCEPTED
        req.receiver_relation = receiver_relation
        req.updated_at = datetime.utcnow()

        default_perms = {'visible': True, 'appointments': False, 'prescriptions': False}

        # 1) Member on the REQUESTER's group — the acceptor, labelled by what the
        #    acceptor is to the requester (receiver's perspective).
        member = HouseGroupMember(
            patient_id=req.requester_patient_id,
            relation=receiver_relation,
            first_name=req.target_name or '',
            last_name=req.target_last_name or '',
            linked_user_id=user_id,
            linked_patient_id=acceptor_patient_id,
            group_type=req.group_type,
            permissions=req.permissions or dict(default_perms),
        )
        db.session.add(member)

        # 2) Reciprocal member on the ACCEPTOR's group so BOTH sides see the
        #    link (previously only the requester's group got a member, leaving
        #    the acceptor with an empty list after accepting). Relation is the
        #    best-effort inverse of the acceptor→requester relation; asymmetric
        #    pairs (Father/Son) can't infer gender, so the acceptor can edit it.
        requester_patient = Patient.query.get(req.requester_patient_id)
        r_user = requester_patient.user if requester_patient else None
        reciprocal_relation = _INVERSE_RELATION.get(receiver_relation, receiver_relation)
        reciprocal = HouseGroupMember(
            patient_id=acceptor_patient_id,
            relation=reciprocal_relation,
            first_name=(r_user.first_name if r_user else '') or '',
            last_name=(r_user.last_name if r_user else '') or '',
            linked_user_id=(r_user.id if r_user else None),
            linked_patient_id=req.requester_patient_id,
            group_type=req.group_type,
            permissions=dict(default_perms),
        )
        db.session.add(reciprocal)

        db.session.commit()
        return member

    @staticmethod
    def reject_request(request_id, user_id):
        """Reject a house group request."""
        req = HouseGroupRequest.query.get(request_id)
        if not req:
            raise ValueError('Request not found')
        if req.status != HouseGroupRequestStatus.PENDING:
            raise ValueError('Request is no longer pending')
        if req.target_user_id and str(req.target_user_id) != str(user_id):
            raise ValueError('This request is not addressed to you')

        req.status = HouseGroupRequestStatus.REJECTED
        req.updated_at = datetime.utcnow()
        db.session.commit()
        return req

    @staticmethod
    def cancel_request(request_id, patient_id):
        """Cancel a sent request."""
        req = HouseGroupRequest.query.filter_by(
            id=request_id,
            requester_patient_id=patient_id,
            status=HouseGroupRequestStatus.PENDING,
        ).first()
        if not req:
            raise ValueError('Pending request not found')

        req.status = HouseGroupRequestStatus.CANCELLED
        req.updated_at = datetime.utcnow()
        db.session.commit()
        return req

    @staticmethod
    def generate_invite(requester_patient_id, data):
        """Generate a shareable invite code (no target required)."""
        import secrets

        if not data.get('relation'):
            raise ValueError('Relation is required')

        invite_code = secrets.token_urlsafe(8)

        req = HouseGroupRequest(
            requester_patient_id=requester_patient_id,
            target_user_id=None,
            target_phone=None,
            target_name=None,
            invite_code=invite_code,
            relation=data['relation'],
            group_type=data.get('group_type', 'family'),
            permissions=data.get('permissions'),
        )
        db.session.add(req)
        db.session.commit()
        return req

    @staticmethod
    def join_by_invite_code(invite_code, user_id, patient_id, receiver_relation=None):
        """Join a group using an invite code."""
        if not receiver_relation:
            raise ValueError('Please select your relation to join')

        req = HouseGroupRequest.query.filter_by(
            invite_code=invite_code,
            status=HouseGroupRequestStatus.PENDING,
        ).first()
        if not req:
            raise ValueError('Invalid or expired invite code')

        # Validate relation pair
        sender_relation = (req.relation or '').lower().strip()
        recv_relation = receiver_relation.lower().strip()
        allowed = RELATION_PAIRS.get(sender_relation)
        if allowed is not None and recv_relation not in allowed:
            # Also check reverse: maybe receiver's key maps back to sender
            reverse_allowed = RELATION_PAIRS.get(recv_relation)
            if reverse_allowed is None or sender_relation not in reverse_allowed:
                raise ValueError(
                    f'Relation mismatch: the code was generated by someone who is "{req.relation}". '
                    f'Your selection "{receiver_relation}" does not match. '
                    f'Expected one of: {", ".join(allowed)}'
                )

        from app.models import User, Patient

        # Both sides gain a linked-adult member — enforce both link quotas first.
        HouseGroupService._assert_link_quota(req.requester_patient_id)
        HouseGroupService._assert_link_quota(patient_id)

        req.status = HouseGroupRequestStatus.ACCEPTED
        req.receiver_relation = receiver_relation
        req.target_user_id = user_id
        req.updated_at = datetime.utcnow()

        default_perms = {'visible': True, 'appointments': False, 'prescriptions': False}
        joiner = User.query.get(user_id)
        requester_patient = Patient.query.get(req.requester_patient_id)
        r_user = requester_patient.user if requester_patient else None

        # 1) Member on the REQUESTER's group — the joiner (name resolved from the
        #    joining user, since an invite code carries no target name).
        member = HouseGroupMember(
            patient_id=req.requester_patient_id,
            relation=receiver_relation,
            first_name=(joiner.first_name if joiner else '') or '',
            last_name=(joiner.last_name if joiner else '') or '',
            linked_user_id=user_id,
            linked_patient_id=patient_id,
            group_type=req.group_type,
            permissions=req.permissions or dict(default_perms),
        )
        db.session.add(member)

        # 2) Reciprocal member on the JOINER's group so both sides see the link.
        reciprocal = HouseGroupMember(
            patient_id=patient_id,
            relation=_INVERSE_RELATION.get(receiver_relation, receiver_relation),
            first_name=(r_user.first_name if r_user else '') or '',
            last_name=(r_user.last_name if r_user else '') or '',
            linked_user_id=(r_user.id if r_user else None),
            linked_patient_id=req.requester_patient_id,
            group_type=req.group_type,
            permissions=dict(default_perms),
        )
        db.session.add(reciprocal)

        db.session.commit()
        return member
