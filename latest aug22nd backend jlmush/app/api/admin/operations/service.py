"""Operations service — orchestration for act-on-behalf writes.

Reuses existing services (no duplicated validation): patient profile edits go
through ``PatientService.update_profile`` (keyed off the TARGET patient's
``user_id`` so tenant scoping derives from the target entity), bookings go
through ``AppointmentService.create`` (guards + slot booking) with an
``initiated_by_id`` audit stamp. Every write records an ``OperationsAuditLog``.
"""
from datetime import datetime
from decimal import Decimal

from app.extensions import db
from app.common.encryption import hash_for_search
from app.models import (
    Patient, User, Doctor, Admin, Clinic, Hospital, TimeSlot, Payment,
    Appointment, UserRole, AppointmentStatus, AppointmentType, PaymentStatus,
    Gender, record_ops_action,
)

# Provider FACILITIES — clinics and hospitals. One implementation for both:
# the two models are the same shape (own table, ``admin_user_id`` owner, an
# EntityProfile), and the Operations surface they expose is identical, so a
# vertical string picks the model rather than the code being written twice.
FACILITY_MODELS = {
    'clinic': (Clinic, UserRole.CLINIC),
    'hospital': (Hospital, UserRole.HOSPITAL),
}


# Per-section editable-field allowlists — kept in lock-step with the patient
# self-service section routes (app/api/service_reciever/patient/routes.py) so
# the two edit paths never diverge. ``contact-identity`` additionally allows
# phone/email here (IT-support fix-up); PatientService.update_profile does the
# tenant-scoped uniqueness check.
SECTION_ALLOWLISTS = {
    'personal-details': [
        'first_name', 'middle_name', 'last_name', 'gender', 'dob',
        'blood_group', 'profile_image', 'languages_known',
    ],
    'contact-identity': [
        'alternative_phone', 'alternative_email', 'aadhar_number', 'pan_number',
        'religion', 'caste', 'citizenship', 'phone_number', 'email',
    ],
    'address': [
        'address_line1', 'address_line2', 'city', 'state', 'pincode', 'country',
    ],
    'emergency-contact': [
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
    ],
    'insurance': ['insurance_provider', 'insurance_policy_number'],
}

# Doctor edit routes through DoctorService.update_profile (user personal fields
# + experience/fee). gender/dob are coerced before hand-off. ``about`` is
# intentionally excluded: Doctor.about is a read-only property shim (the text
# lives on ProfileAbout) with no setter, so it can't be written through here.
DOCTOR_SECTION_ALLOWLISTS = {
    'personal-details': ['first_name', 'middle_name', 'last_name', 'gender', 'dob'],
    'professional': ['experience_years', 'consultation_fee'],
}

# Admin edit routes through SuperAdminService.update_admin (name fields only).
ADMIN_SECTION_ALLOWLISTS = {
    'personal-details': ['first_name', 'middle_name', 'last_name'],
}


def _parse_date(v):
    return datetime.strptime(v, '%Y-%m-%d').date() if isinstance(v, str) else v


def _parse_time(v):
    if not isinstance(v, str):
        return v
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.strptime(v, fmt).time()
        except ValueError:
            continue
    raise ValueError(f'Invalid time: {v}')


class OperationsService:
    """Business logic for the super-admin Operations module."""

    # ── Patient list ──────────────────────────────────────────────────────
    @staticmethod
    def list_patients(tenant_id, page=1, per_page=20, search=''):
        """Same shape/logic as the admin patient list, scoped to the tenant."""
        query = (
            db.session.query(Patient)
            .join(User, Patient.user_id == User.id)
            .filter(
                Patient.tenant_id == tenant_id,
                User.is_deleted == False,   # noqa: E712
                User.role == UserRole.PATIENT,
            )
        )
        if search:
            search_hash = hash_for_search(search)
            query = query.filter(
                db.or_(
                    User.first_name.ilike(f'%{search}%'),
                    User.last_name.ilike(f'%{search}%'),
                    User._phone_hash == search_hash,
                )
            )
        pagination = query.order_by(Patient.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False,
        )
        items = [{
            'id': str(p.id),
            'user_id': str(p.user_id),
            'first_name': p.user.first_name if p.user else None,
            'last_name': p.user.last_name if p.user else None,
            'email': p.user.email if p.user else None,
            'phone_number': p.user.phone_number if p.user else None,
            'status': p.user.status.value if p.user and p.user.status else None,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        } for p in pagination.items]
        return {
            'patients': items,
            'pagination': {
                'page': pagination.page, 'per_page': pagination.per_page,
                'total': pagination.total, 'pages': pagination.pages,
            },
        }

    # ── Patient resolution (tenant-scoped) ────────────────────────────────
    @staticmethod
    def get_patient(tenant_id, patient_id):
        return (
            Patient.query
            .filter_by(id=patient_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )

    # ── Booking context (doctors + slots) ─────────────────────────────────
    @staticmethod
    def list_bookable_doctors(tenant_id, search=''):
        from app.models import UserVerificationStatus, PublishStatus
        q = (
            db.session.query(Doctor)
            .join(User, Doctor.user_id == User.id)
            .filter(
                Doctor.tenant_id == tenant_id,
                Doctor.is_deleted == False,   # noqa: E712
                User.is_deleted == False,     # noqa: E712
                Doctor.verification_status == UserVerificationStatus.VERIFIED,
                Doctor.publish_status == PublishStatus.ACTIVE,
            )
        )
        if search:
            q = q.filter(db.or_(
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%'),
            ))
        docs = q.order_by(User.first_name).limit(100).all()
        out = []
        for d in docs:
            u = d.user
            name = f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
            out.append({
                'id': str(d.id),
                'name': name or '(no name)',
                'consultation_fee': str(d.consultation_fee) if d.consultation_fee else None,
            })
        return out

    @staticmethod
    def get_doctor_slots(doctor_id, date_str, consultation_type=None):
        from app.api.common.timeslot.service import TimeSlotService
        d = _parse_date(date_str)
        return TimeSlotService.get_available_slots(doctor_id, d, consultation_type or None)

    # ── Profile GET (combined sections) ───────────────────────────────────
    @staticmethod
    def build_patient_profile(patient):
        u = patient.user
        addr = patient.address_details or {}
        sections = {
            'personal-details': {
                'first_name': u.first_name if u else None,
                'middle_name': u.middle_name if u else None,
                'last_name': u.last_name if u else None,
                'gender': u.gender.value if u and u.gender else None,
                'dob': u.dob.isoformat() if u and u.dob else None,
                'profile_image': u.profile_image if u else None,
                'blood_group': patient.blood_group.value if patient.blood_group else None,
                'languages_known': patient.languages_known,
            },
            'contact-identity': {
                'phone_number': u.phone_number if u else '',
                'alternative_phone': patient.alternative_phone,
                'email': u.email if u else '',
                'alternative_email': patient.alternative_email,
                'aadhar_number': patient.aadhar_number,
                'pan_number': patient.pan_number,
                'religion': patient.religion,
                'caste': patient.caste,
                'citizenship': patient.citizenship,
            },
            'address': {
                'address_line1': addr.get('address_line1', ''),
                'address_line2': addr.get('address_line2', ''),
                'city': addr.get('city', ''),
                'state': addr.get('state', ''),
                'pincode': addr.get('pincode', ''),
                'country': addr.get('country', 'India'),
            },
            'emergency-contact': {
                'emergency_contact_name': patient.emergency_contact_name,
                'emergency_contact_phone': patient.emergency_contact_phone,
                'emergency_contact_relation': patient.emergency_contact_relation,
            },
            'insurance': {
                'insurance_provider': patient.insurance_provider,
                'insurance_policy_number': patient.insurance_policy_number,
            },
        }
        full_name = (
            f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
            if u else None
        ) or '(no name)'
        return {
            'sections': sections,
            'meta': {
                'patient_id': str(patient.id),
                'patient_name': full_name,
                'editable_sections': list(sections.keys()),
                'last_updated_at': (
                    patient.updated_at.isoformat()
                    if getattr(patient, 'updated_at', None) else None
                ),
            },
        }

    # ── Profile edit (reuses PatientService.update_profile) ───────────────
    @staticmethod
    def update_patient_section(patient, section, data, actor_id):
        from app.api.service_reciever.patient.service import PatientService

        if section not in SECTION_ALLOWLISTS:
            raise ValueError(f'Unknown section: {section}')
        allowed = SECTION_ALLOWLISTS[section]
        filtered = {k: v for k, v in (data or {}).items() if k in allowed}
        if not filtered:
            raise ValueError('No editable fields supplied for this section.')

        payload = {'address_details': filtered} if section == 'address' else filtered
        # update_profile derives tenant from the TARGET patient's user row, so
        # passing the target user_id keeps tenant isolation correct.
        updated = PatientService.update_profile(patient.user_id, payload)
        if not updated:
            raise ValueError('Patient profile not found.')

        record_ops_action(
            actor_id, 'patient', patient.id, 'profile_edit',
            {'section': section, 'fields': list(filtered.keys())},
        )
        db.session.commit()
        return list(filtered.keys())

    # ── Book on behalf ────────────────────────────────────────────────────
    @staticmethod
    def book_on_behalf(patient, data, actor_user):
        """Create an appointment for ``patient`` on their behalf.

        Requires a ``time_slot_id`` (the UI always picks a published slot);
        date/time/doctor are derived from the slot to avoid client mismatch.
        ``mark_as_paid`` decides the payment branch.
        """
        from app.api.common.appointment.service import AppointmentService

        time_slot_id = data.get('time_slot_id')
        if not time_slot_id:
            raise ValueError('time_slot_id is required.')
        slot = TimeSlot.query.filter_by(
            id=time_slot_id, tenant_id=patient.tenant_id,
        ).first()
        if not slot:
            raise ValueError('Time slot not found.')

        doctor = Doctor.query.filter_by(
            id=slot.doctor_id, tenant_id=patient.tenant_id, is_deleted=False,
        ).first()
        if not doctor:
            raise ValueError('Doctor not found for this slot.')

        consultation_type = data.get('consultation_type') or 'complete'
        fee = data.get('consultation_fee')
        fee = Decimal(str(fee)) if fee not in (None, '') else (doctor.consultation_fee or Decimal('0'))

        appt_data = {
            'doctor_id': slot.doctor_id,
            'appointment_date': slot.date,
            'start_time': slot.start_time,
            'end_time': slot.end_time,
            'appointment_type': AppointmentType(data.get('appointment_type') or 'online'),
            'consultation_type': consultation_type,
            'time_slot_id': slot.id,
            'chief_complaint': data.get('chief_complaint'),
            'consultation_fee': fee,
        }
        # Reuses the same-patient/slot-taken guards + hardened book_slot.
        appt = AppointmentService.create(
            patient.user_id, appt_data, initiated_by_id=actor_user.id,
        )

        mark_as_paid = bool(data.get('mark_as_paid'))
        meta = {
            'flow': 'ops_book_on_behalf',
            'recorded_by': str(actor_user.id),
            'mode': 'offline',
        }
        if mark_as_paid:
            # Record it as already paid → straight to awaiting-doctor-accept.
            appt.status = AppointmentStatus.PENDING
            payment = Payment(
                tenant_id=patient.tenant_id, appointment_id=appt.id,
                user_id=patient.user_id, amount=fee, currency='INR',
                status=PaymentStatus.SUCCESS, payment_gateway='offline_admin',
                payment_metadata=meta,
            )
        else:
            # Leave unpaid → patient pays later. Tag the payment expiry-exempt so
            # the 10-min expiry job doesn't auto-cancel the admin's booking.
            payment = Payment(
                tenant_id=patient.tenant_id, appointment_id=appt.id,
                user_id=patient.user_id, amount=fee, currency='INR',
                status=PaymentStatus.PENDING, payment_gateway='offline_admin',
                payment_metadata={**meta, 'expiry_exempt': True},
            )
        db.session.add(payment)

        record_ops_action(
            actor_user.id, 'patient', patient.id, 'book_on_behalf',
            {
                'appointment_id': str(appt.id), 'doctor_id': str(slot.doctor_id),
                'mark_as_paid': mark_as_paid, 'amount': str(fee),
            },
        )
        db.session.commit()
        return appt

    # ══════════════════════════════════════════════════════════════════════
    # DOCTOR members
    # ══════════════════════════════════════════════════════════════════════
    @staticmethod
    def list_doctor_members(tenant_id, page=1, per_page=20, search=''):
        q = (
            db.session.query(Doctor)
            .join(User, Doctor.user_id == User.id)
            .filter(
                Doctor.tenant_id == tenant_id,
                Doctor.is_deleted == False,   # noqa: E712
                User.is_deleted == False,     # noqa: E712
                User.role == UserRole.DOCTOR,
            )
        )
        if search:
            sh = hash_for_search(search)
            q = q.filter(db.or_(
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%'),
                User._phone_hash == sh,
            ))
        pg = q.order_by(Doctor.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False,
        )
        members = [{
            'id': str(d.id), 'user_id': str(d.user_id),
            'first_name': d.user.first_name if d.user else None,
            'last_name': d.user.last_name if d.user else None,
            'email': d.user.email if d.user else None,
            'phone_number': d.user.phone_number if d.user else None,
            'status': d.user.status.value if d.user and d.user.status else None,
            'created_at': d.created_at.isoformat() if d.created_at else None,
        } for d in pg.items]
        return {
            'members': members,
            'pagination': {'page': pg.page, 'per_page': pg.per_page,
                           'total': pg.total, 'pages': pg.pages},
        }

    @staticmethod
    def get_doctor_member(tenant_id, doctor_id):
        return Doctor.query.filter_by(
            id=doctor_id, tenant_id=tenant_id, is_deleted=False,
        ).first()

    # ── Provider facilities (clinic | hospital) ──────────────────────────
    # Unlike a doctor, a facility has no doctor-shaped profile to summarise:
    # everything an operator can edit about it lives on its EntityProfile,
    # which the frontend drives through the act-on-behalf proxy against the
    # facility's OWN ``/api/entity-profile/me``. So there is a lister and a
    # resolver here, and deliberately no ``build_*_profile`` / section
    # updater — adding those would fork the validation the entity-profile
    # route already owns, which is the drift this whole module avoids.

    @staticmethod
    def list_facility_members(tenant_id, vertical, page=1, per_page=20, search=''):
        model, role = FACILITY_MODELS[vertical]
        q = (
            db.session.query(model)
            .outerjoin(User, model.admin_user_id == User.id)
            .filter(
                model.tenant_id == tenant_id,
                model.is_deleted == False,   # noqa: E712
            )
        )
        if search:
            # The facility's OWN name is the useful search key here — an
            # operator looks up "City Hospital", not the person who signed it
            # up. Owner name/phone are matched too, so the same box works
            # when all they have is the contact.
            sh = hash_for_search(search)
            q = q.filter(db.or_(
                model.name.ilike(f'%{search}%'),
                User.first_name.ilike(f'%{search}%'),
                User.last_name.ilike(f'%{search}%'),
                User._phone_hash == sh,
            ))
        pg = q.order_by(model.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False,
        )
        members = [{
            'id': str(f.id),
            'user_id': str(f.admin_user_id) if f.admin_user_id else None,
            # The list is generic over member type, so the facility's name
            # rides in the same first/last columns the doctor and patient
            # lists use. Second line stays empty rather than repeating it.
            'first_name': f.name,
            'last_name': '',
            'email': f.user.email if f.user else None,
            'phone_number': f.user.phone_number if f.user else None,
            'status': f.user.status.value if f.user and f.user.status else None,
            'verification_status': (
                f.verification_status.value if f.verification_status else None
            ),
            'created_at': f.created_at.isoformat() if f.created_at else None,
        } for f in pg.items]
        return {
            'members': members,
            'pagination': {'page': pg.page, 'per_page': pg.per_page,
                           'total': pg.total, 'pages': pg.pages},
        }

    @staticmethod
    def get_facility_member(tenant_id, vertical, facility_id):
        model, _role = FACILITY_MODELS[vertical]
        return model.query.filter_by(
            id=facility_id, tenant_id=tenant_id, is_deleted=False,
        ).first()

    @staticmethod
    def build_doctor_profile(doctor):
        u = doctor.user
        sections = {
            'personal-details': {
                'first_name': u.first_name if u else None,
                'middle_name': u.middle_name if u else None,
                'last_name': u.last_name if u else None,
                'gender': u.gender.value if u and u.gender else None,
                'dob': u.dob.isoformat() if u and u.dob else None,
            },
            'professional': {
                'experience_years': doctor.experience_years,
                'consultation_fee': (
                    str(doctor.consultation_fee) if doctor.consultation_fee is not None else None
                ),
                'about': getattr(doctor, 'about', None),
                'registration_number': doctor.registration_number,
                'verification_status': (
                    doctor.verification_status.value if doctor.verification_status else None
                ),
            },
        }
        name = (
            f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
            if u else None
        ) or '(no name)'
        return {
            'sections': sections,
            'meta': {
                'member_id': str(doctor.id), 'member_name': name,
                'editable_sections': list(sections.keys()),
            },
        }

    @staticmethod
    def update_doctor_section(doctor, section, data, actor_id):
        from app.api.service_provider.doctor.service import DoctorService

        if section not in DOCTOR_SECTION_ALLOWLISTS:
            raise ValueError(f'Unknown section: {section}')
        allowed = DOCTOR_SECTION_ALLOWLISTS[section]
        filtered = {k: v for k, v in (data or {}).items() if k in allowed}
        if not filtered:
            raise ValueError('No editable fields supplied for this section.')

        # Coerce enum/date fields DoctorService.update_profile sets raw.
        if filtered.get('gender'):
            filtered['gender'] = Gender(filtered['gender'])
        if filtered.get('dob'):
            filtered['dob'] = datetime.strptime(filtered['dob'], '%Y-%m-%d').date()

        updated = DoctorService.update_profile(doctor.user_id, filtered)
        if not updated:
            raise ValueError('Doctor profile not found.')

        record_ops_action(
            actor_id, 'doctor', doctor.id, 'profile_edit',
            {'section': section, 'fields': [k for k in filtered]},
        )
        db.session.commit()
        return [k for k in filtered]

    # ══════════════════════════════════════════════════════════════════════
    # ADMIN members
    # ══════════════════════════════════════════════════════════════════════
    @staticmethod
    def list_admin_members(tenant_id, page=1, per_page=50, search=''):
        from app.api.admin.super_admin.service import SuperAdminService
        pg = SuperAdminService.list_admins(page=page, per_page=per_page)
        members = []
        for a in pg.items:
            u = a.user
            members.append({
                'id': str(a.id),
                'user_id': str(a.user_id) if a.user_id else None,
                'first_name': u.first_name if u else None,
                'last_name': u.last_name if u else None,
                'email': u.email if u else None,
                'phone_number': u.phone_number if u else None,
                'status': u.status.value if u and u.status else None,
                'role': u.role.value if u and u.role else None,
                'created_at': a.created_at.isoformat() if a.created_at else None,
            })
        if search:
            s = search.lower()
            members = [
                m for m in members
                if s in f"{m['first_name'] or ''} {m['last_name'] or ''}".lower()
                or s in (m['phone_number'] or '')
            ]
        return {
            'members': members,
            'pagination': {'page': pg.page, 'per_page': pg.per_page,
                           'total': pg.total, 'pages': pg.pages},
        }

    @staticmethod
    def get_admin_member(tenant_id, admin_id):
        return Admin.query.filter_by(
            id=admin_id, tenant_id=tenant_id, is_deleted=False,
        ).first()

    @staticmethod
    def build_admin_profile(admin):
        u = admin.user
        sections = {
            'personal-details': {
                'first_name': u.first_name if u else None,
                'middle_name': u.middle_name if u else None,
                'last_name': u.last_name if u else None,
                'email': u.email if u else '',
                'phone_number': u.phone_number if u else '',
                'role': u.role.value if u and u.role else None,
                'status': u.status.value if u and u.status else None,
            },
        }
        name = (
            f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
            if u else None
        ) or '(no name)'
        return {
            'sections': sections,
            'meta': {
                'member_id': str(admin.id), 'member_name': name,
                # Only name fields are editable via SuperAdminService.update_admin.
                'editable_sections': ['personal-details'],
                'readonly_fields': ['email', 'phone_number', 'role', 'status'],
            },
        }

    @staticmethod
    def update_admin_section(admin, section, data, actor_id):
        if section not in ADMIN_SECTION_ALLOWLISTS:
            raise ValueError(f'Unknown section: {section}')
        allowed = ADMIN_SECTION_ALLOWLISTS[section]
        filtered = {k: v for k, v in (data or {}).items() if k in allowed}
        if not filtered:
            raise ValueError('No editable fields supplied for this section.')

        # Names live on the linked User row (Admin.first_name/last_name are
        # read-only property shims). Write there directly — do NOT go through
        # SuperAdminService.update_admin, which assigns to the shim and 500s.
        user = admin.user
        if user is None:
            raise ValueError('Admin has no linked user.')
        for f in ('first_name', 'middle_name', 'last_name'):
            if f in filtered:
                setattr(user, f, filtered[f] or None)
        db.session.add(user)

        record_ops_action(
            actor_id, 'admin', admin.id, 'profile_edit',
            {'section': section, 'fields': [k for k in filtered]},
        )
        db.session.commit()
        return [k for k in filtered]
