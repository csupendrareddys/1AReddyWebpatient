"""
Doctor Routes
API endpoints for doctor-related operations

MVP endpoints:
- GET /doctor/list - List verified doctors (public)
- GET /doctor/<id>/public - Get doctor public info
- GET /doctor/appointments - Doctor's appointments
- POST /doctor/appointments/<id>/accept - Accept appointment
- POST /doctor/appointments/<id>/reject - Reject appointment
- POST /doctor/appointments/<id>/complete - Complete appointment
"""
import logging
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from . import doctor_bp
from .service import DoctorService
from app.common.decorators import feature_required, role_required
# Doctor resolution goes through these, not through current_user, so a doctor's
# assistant resolves to the doctor who employs them. Whether they may is decided
# in before_request — see staff_access.py.
from app.common.provider_access import acting_doctor, acting_doctor_user_id
from app.common.responses import success_response, error_response, validation_error_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole, AppointmentStatus, AvailabilityApprovalStatus

logger = logging.getLogger(__name__)


def _auto_create_payout(appointment):
    """
    Automatically create a pending payout when a prescription is pushed to the patient.
    Skips silently if a payout already exists for this appointment (idempotent).
    """
    from decimal import Decimal
    from datetime import datetime, timezone
    import random
    from app.models import (
        DoctorPayout, PayoutStatus, Payment, PaymentStatus,
        Doctor, ProfileBankAccount, BillingConfig, DocumentVerificationStatus,
    )

    try:
        # Appointment-scoped helpers always use the appointment's own
        # tenant_id rather than the request context, because the caller
        # may be a system task (commit-time hook) rather than a request.
        tid = appointment.tenant_id

        # Only once per appointment
        existing = DoctorPayout.query.filter_by(
            tenant_id=tid, appointment_id=appointment.id,
        ).first()
        if existing:
            logger.debug('[PAYOUT] Payout already exists for appointment=%s, skipping', appointment.id)
            return

        # Must have a successful payment
        payment = Payment.query.filter_by(
            tenant_id=tid,
            appointment_id=appointment.id, status=PaymentStatus.SUCCESS,
        ).first()
        if not payment:
            logger.warning('[PAYOUT] No successful payment for appointment=%s, skipping', appointment.id)
            return

        doctor = Doctor.query.filter_by(
            tenant_id=tid, id=appointment.doctor_id,
        ).first()
        if not doctor:
            logger.warning('[PAYOUT] Doctor not found for appointment=%s', appointment.id)
            return

        # Whether this appointment earns a per-patient payout is a property of
        # the doctor's compensation model, not a billing_type check scattered
        # here: salaried employees never earn one, consultants only earn above
        # their period target, plan doctors always do.
        from app.api.common.payment.compensation import resolve_strategy
        strategy = resolve_strategy(doctor)
        if not strategy.earns_per_appointment(appointment):
            logger.info(
                '[PAYOUT] Doctor %s is %s — skipping per-patient payout',
                doctor.id, strategy.name,
            )
            return

        # Check primary bank account (payout still created even without verified bank)
        primary_bank = ProfileBankAccount.query.filter_by(
            tenant_id=tid, doctor_id=doctor.id, order_index=0,
        ).first()
        bank_id = None
        bank_verified = False
        if primary_bank:
            bank_id = primary_bank.id
            bank_verified = primary_bank.verification_status == DocumentVerificationStatus.VERIFIED

        # Load billing config (per-tenant)
        config = BillingConfig.query.filter_by(
            tenant_id=tid, is_active=True,
        ).first()
        if not config:
            config = BillingConfig()

        payment_amount = Decimal(str(payment.amount or 0))
        consultation_fee = Decimal(str(appointment.consultation_fee or 0))

        # Two supplies, two taxable values (see app/common/tax.py): GST is
        # carved out of the doctor's own (tax-inclusive) fee, and the
        # platform's margin — what the patient paid over that fee — is taxed
        # separately rather than blended into one figure on payment.amount.
        from app.api.common.payment.billing_service import (
            compute_platform_charges, charges_snapshot_for, resolve_active_membership_plan,
            resolve_doctor_fee, resolve_per_patient_platform_fee,
        )
        from app.common.tax import compute_tax_breakdown
        _ctype = getattr(getattr(appointment, 'consultation_type', None), 'value', getattr(appointment, 'consultation_type', None))
        # main wanted the tax base to be the consultation charge rather than the
        # gross paid; ``compute_tax_breakdown`` below does exactly that and more
        # (it splits the doctor's supply from the platform's margin), so the
        # older resolve_gst_rates pair it used is dropped — its ``gst`` was
        # overwritten a few lines down anyway.
        doctor_fee = resolve_doctor_fee(doctor, appointment, fallback=payment_amount)
        # Commission is a cut of the doctor's earning, not of the patient total
        # (which already contains the platform's own markup).
        c1, c2, c3 = compute_platform_charges(doctor, doctor_fee)
        if resolve_active_membership_plan(doctor) is None:
            _plan_fee = resolve_per_patient_platform_fee(doctor, doctor_fee)
            if _plan_fee is not None:
                c1 = _plan_fee
        total_charges = c1 + c2 + c3
        # TDS (s.194J) is on the doctor's professional fee — per-doctor
        # override (DoctorBillingProfile.tds_rate_override) then tenant flat.
        tax = compute_tax_breakdown(
            doctor_fee, payment_amount, config=config, doctor=doctor,
            consultation_type=_ctype, platform_charges=total_charges,
        )
        gst = tax.doctor_gst_total
        tds = tax.tds_amount
        payout_amount = tax.net_to_doctor

        # Generate unique bill number
        def _gen():
            return f"JLH{random.randint(1000000, 9999999)}"

        bill_number = _gen()
        while DoctorPayout.query.filter_by(
            tenant_id=tid, bill_number=bill_number,
        ).first():
            bill_number = _gen()

        payout = DoctorPayout(
            tenant_id=tid,
            doctor_id=doctor.id,
            appointment_id=appointment.id,
            payment_id=payment.id,
            bill_number=bill_number,
            appointment_amount=consultation_fee,
            payment_amount=payment_amount,
            total_charges=total_charges,
            taxes_gst=gst,
            tds_amount=tds,
            razorpay_fee=Decimal('0'),
            payout_amount=payout_amount,
            charge1_amount=c1,
            charge2_amount=c2,
            charge3_amount=c3,
            charges_snapshot=charges_snapshot_for(doctor, doctor_fee, (c1, c2, c3)),
            bank_account_id=bank_id,
            # Column is a plain String — store the enum's value, not the
            # ConsultationType object (psycopg2 can't adapt the enum itself).
            consultation_type=getattr(
                getattr(appointment, 'consultation_type', None), 'value',
                getattr(appointment, 'consultation_type', None),
            ),
            status=PayoutStatus.PENDING,
            initiated_at=datetime.now(timezone.utc),
        )
        db.session.add(payout)
        # T-day hold (Phase 1): if the doctor's plan has a hold period, this
        # flips the payout to ON_HOLD with a hold_until + payout_mode snapshot.
        # Leaves it PENDING (today's behaviour) when the resolved hold is 0.
        from app.api.common.payment.billing_service import apply_hold
        apply_hold(payout, doctor)
        # Don't commit here — the caller will commit the whole transaction
        logger.info('[PAYOUT] Auto-created payout %s for appointment=%s doctor=%s status=%s',
                    bill_number, appointment.id, doctor.id, payout.status.value)

    except Exception as e:
        logger.exception('[PAYOUT] Failed to auto-create payout for appointment=%s: %s', appointment.id, e)
        # Don't block the prescription push — payout is secondary


def _enrich_attachments(record_dict, key='attachment_links'):
    """Add presigned S3 URLs to attachment entries in a record dict."""
    from app.services.s3_service import S3Service
    for att in (record_dict.get(key) or []):
        att['url'] = S3Service.get_signed_url(att.get('s3_key')) or ''
    return record_dict


def _refresh_snapshot_attachments(entries, tenant_id):
    """A shared health-records / surgeries snapshot freezes the patient's shared
    info at booking time — INCLUDING the attachment list and its short-lived
    signed URLs. Serving it verbatim means the doctor misses files the patient
    added after booking and gets expired URLs on the ones captured then.

    Re-resolve each entry's attachments from the LIVE health record (by id) so
    the doctor always sees the current files with a fresh signed URL. Entries
    are copied before enrichment so we never mutate — or accidentally persist
    onto — the stored snapshot / model JSON."""
    from app.models import HealthRecord  # local: not imported at module scope
    entries = entries or []
    ids = [e.get('id') for e in entries if e.get('id')]
    live = {}
    if ids:
        live = {
            str(r.id): r for r in HealthRecord.query.filter(
                HealthRecord.tenant_id == tenant_id,
                HealthRecord.id.in_(ids),
                HealthRecord.is_deleted == False,  # noqa: E712
            ).all()
        }
    for e in entries:
        rec = live.get(str(e.get('id'))) if e.get('id') else None
        # Prefer the live attachment list; fall back to whatever the snapshot
        # froze (so a record without a resolvable id still gets fresh URLs).
        src = (rec.attachment_links if rec is not None else e.get('attachments')) or []
        e['attachments'] = [dict(a) for a in src]
        _enrich_attachments(e, key='attachments')


def _consultation_types_payload(doctor, slot_counts_by_type, display_rules=None,
                                slot_counts_by_length=None):
    """Serialize the consultation types a doctor offers, with price + availability.

    Shape (one entry per type, cheapest type first):
        [{'type': 'video', 'price_min': 5.0, 'price_max': 15.0,
          'price_range': [{'range': '0-10', 'price': 5.0, 'description': '',
                           'available_slots': 4}],
          'available_slots': 12}]

    ``slot_counts_by_length`` (``{consultation_type: {'0-10': n}}``, from
    ``TimeSlotService.get_slot_counts_by_doctor_type_and_length``) puts an open
    count on each priced tier. Find-a-Doctor filters by slot length, and the
    type-level total counts lengths the patient just filtered out — the per-tier
    figure is the one that answers "can I book THIS length". Omitted → each
    tier reports 0, so a caller that doesn't pass it shows no per-length count
    rather than an inherited-and-wrong one.

    ``price_range`` mirrors the tier shape /api/patient/doctors/match already
    returns, so a card can render the same way in either flow. Sourced from
    ``slot_pricing`` (not ``approved_slot_pricing``) to match what the
    booking flow charges — if those two ever diverge the fix belongs in one
    place, not in a list endpoint quietly showing a different number.

    Prices are the patient-facing display prices (doctor fee + the admin's
    increment − discount). ``display_rules`` lets a list endpoint fetch the
    overlay once for the whole page instead of once per doctor.

    A discounted type additionally carries ``original_price_min`` /
    ``original_price_max`` / ``discount_pct`` (and ``original_price`` on the
    individual ``price_range`` rows) so the card can slash the range it was
    marked down from. Absent entirely when nothing is discounted — the card
    then renders exactly as it always has.
    """
    from app.common.display_pricing import markdown_range, slot_key, tier_card_extras

    grouped = DoctorService.offered_consultation_pricing(doctor, display_rules)
    length_counts = slot_counts_by_length or {}

    entries = []
    for ct, tiers in grouped.items():
        prices = []
        price_range = []
        ct_length_counts = length_counts.get(ct, {})
        for tier in tiers:
            try:
                price = float(tier.get('price'))
            except (TypeError, ValueError):
                continue
            prices.append(price)
            price_range.append({
                # Older tiers carry only ``duration``; newer ones ``range``.
                'range': tier.get('range') or tier.get('duration'),
                'price': price,
                'description': tier.get('description', '') or '',
                # Keyed off the canonical ladder key rather than the raw
                # ``range`` above, so a legacy duration-only tier still finds
                # its bucket.
                'available_slots': ct_length_counts.get(slot_key(tier), 0),
                # Includes this slot's own ``member_discount_pct`` — the exact
                # figure the buyer's tier grants HERE, which the card needs to
                # quote instead of the tier's blanket ceiling.
                **tier_card_extras(tier),
            })
        if not prices:
            continue
        price_range.sort(key=lambda t: t['price'])
        entries.append({
            'type': ct,
            'price_min': min(prices),
            'price_max': max(prices),
            'price_range': price_range,
            'available_slots': slot_counts_by_type.get(ct, 0),
            **markdown_range(tiers),
        })

    entries.sort(key=lambda e: e['price_min'])
    return entries


# --- Public Routes ---

@doctor_bp.route('/list', methods=['GET'])
def list_doctors():
    """
    List verified doctors with the consultation types they offer.

    Query Parameters:
        - page: Page number (default: 1)
        - per_page: Results per page (default: 20, max: 50)
        - name: Search by doctor name
        - specialization: Filter by specialization
        - with_slots: Only doctors with a bookable slot right now
        - consultation_type: Only doctors offering this type (audio/video/…)
        - duration: Comma-separated slot-length keys ('0-10,20-30'); doctors
          pricing at least one slot at one of those lengths (matches ANY)
        - language: Comma-separated languages (matches ANY)
        - gender: male / female / other
        - experience_min, experience_max: Years of experience band
        - price_min, price_max: Doctors with a priced slot inside this band

    The filter params mirror the ones the Book-a-Consultation flow sends to
    /api/patient/doctors/match, so Find-a-Doctor and that flow narrow the
    same roster the same way.

    Returns:
        List of doctors with basic info + ``consultation_types``: the types
        each doctor offers, with per-type price tiers and open-slot counts.
    """
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 50)
    name = request.args.get('name', '').strip()
    specialization = request.args.get('specialization', '').strip()
    with_slots = request.args.get('with_slots', 'false').lower() == 'true'
    consultation_type = request.args.get('consultation_type', '').strip()
    durations = [
        d.strip() for d in request.args.get('duration', '').split(',') if d.strip()
    ]
    language = request.args.get('language', '').strip()
    gender = request.args.get('gender', '').strip()
    experience_min = request.args.get('experience_min', type=int)
    experience_max = request.args.get('experience_max', type=int)
    price_min = request.args.get('price_min', type=float)
    price_max = request.args.get('price_max', type=float)
    logger.debug(
        f"[DOCTOR:LIST] page={page}, name={name}, spec={specialization}, "
        f"with_slots={with_slots}, ct={consultation_type}"
    )

    # Consultation type, slot length and price all live inside the
    # ``slot_pricing`` JSON, so they're resolved to an id whitelist first and
    # handed to the SQL query — that keeps pagination counts honest (filtering
    # after ``paginate()`` would report page sizes that don't match what's
    # shown).
    offering_ids = DoctorService.doctor_ids_offering(
        consultation_type=consultation_type or None,
        price_min=price_min,
        price_max=price_max,
        slot_ranges=durations,
    )

    doctors_pagination = DoctorService.search(
        name=name if name else None,
        specialization=specialization if specialization else None,
        page=page,
        per_page=per_page,
        with_slots=with_slots,
        doctor_ids=offering_ids,
        languages=language if language else None,
        gender=gender if gender else None,
        experience_min=experience_min,
        experience_max=experience_max,
    )

    # Single source of truth for "has a real, bookable slot right now" —
    # same TimeSlotService predicate /api/patient/slot-availability-summary
    # and /api/patient/doctors/search use, so this badge can't disagree
    # with those again. Batched for the whole page (one query, not N+1).
    from app.api.common.timeslot.service import TimeSlotService
    from app.common.tenant_context import current_tenant_id_or_default
    page_doctor_ids = [doctor.id for doctor in doctors_pagination.items]
    tenant_id = current_tenant_id_or_default()
    doctor_ids_with_slots = TimeSlotService.get_doctor_ids_with_open_slots(
        page_doctor_ids, tenant_id=tenant_id,
    )
    # Per-type counts for the same page, so each consultation-type chip on a
    # card can say whether that specific type is bookable — ``has_slots``
    # alone can't ("has video slots" ≠ "has slots").
    slot_counts_by_type = TimeSlotService.get_slot_counts_by_doctor_and_type(
        page_doctor_ids, tenant_id=tenant_id,
    )
    # The same counts one level finer, so each priced slot length can say
    # whether it is bookable. A patient filtering to "20–30 min" is shown a
    # type-level count that includes every other length otherwise.
    slot_counts_by_length = TimeSlotService.get_slot_counts_by_doctor_type_and_length(
        page_doctor_ids, tenant_id=tenant_id,
    )
    # Admin display-pricing overlay for the page — one query, applied to every
    # card's price so the browse list quotes what the patient will be charged.
    from app.common.display_pricing import rules_for_doctors
    display_rules = rules_for_doctors(page_doctor_ids, tenant_id=tenant_id)

    # Transform to minimal public info. Name + profile_image moved
    # to User in the shared-profile split — reading them off Doctor
    # AttributeError'd, taking down every public doctor browse.
    doctors_list = []
    for doctor in doctors_pagination.items:
        du = doctor.user
        first = getattr(du, 'first_name', None) if du else None
        last = getattr(du, 'last_name', None) if du else None
        doc_slot_counts = slot_counts_by_type.get(str(doctor.id), {})
        doc_length_counts = slot_counts_by_length.get(str(doctor.id), {})
        doctors_list.append({
            'id': str(doctor.id),
            'first_name': first,
            'last_name': last or '',
            'full_name': f"{first or ''} {last or ''}".strip(),
            'profile_image': getattr(du, 'profile_image', None) if du else None,
            'experience_years': doctor.experience_years,
            'languages_known': doctor.languages_known or [],
            'consultation_fee': str(doctor.consultation_fee) if doctor.consultation_fee else None,
            # Get primary specialization if exists
            'specializations': [
                spec.category.name for spec in doctor.specializations
                if spec.category
            ] if hasattr(doctor, 'specializations') else [],
            # Compact "MBBS, MS, DNB" line + location for the richer card.
            'highest_qualification': ', '.join(
                d['degree_name'] for d in _doctor_degrees(doctor)
                if d.get('degree_name')),
            'city': _doctor_city(doctor),
            'has_slots': str(doctor.id) in doctor_ids_with_slots,
            'consultation_types': _consultation_types_payload(
                doctor, doc_slot_counts, display_rules, doc_length_counts),
        })

    return success_response(data={
        'doctors': doctors_list,
        'pagination': {
            'page': doctors_pagination.page,
            'per_page': doctors_pagination.per_page,
            'total': doctors_pagination.total,
            'pages': doctors_pagination.pages,
            'has_next': doctors_pagination.has_next,
            'has_prev': doctors_pagination.has_prev,
        }
    })


def _doctor_degrees(doctor):
    """The doctor's degrees (MBBS / MS / DNB …) with institution + year, newest
    first — the Education & Fellowship list and the card's qualification line."""
    try:
        rows = doctor.qualifications.all()
    except Exception:  # noqa: BLE001 — tolerate a partially-set-up doctor
        return []
    out = []
    for q in rows:
        out.append({
            'degree_name': getattr(q, 'degree_name', None),
            'institution': getattr(q, 'institution', None),
            'passing_year': getattr(q, 'passing_year', None),
        })
    # Named degrees first, then by passing year descending.
    out.sort(key=lambda d: (d['passing_year'] or 0), reverse=True)
    return out


def _doctor_city(doctor):
    """Best-effort location — the first hospital affiliation's city."""
    try:
        aff = doctor.hospital_affiliations.first()
        return getattr(aff, 'city', None) if aff else None
    except Exception:  # noqa: BLE001
        return None


def _doctor_specialities(doctor):
    return [spec.category.name for spec in doctor.specializations
            if spec.category] if hasattr(doctor, 'specializations') else []


def doctor_full_profile(doctor):
    """The full patient-facing profile: identity, about, degrees (Education &
    Fellowship), registration/licence, specialities, languages, modes."""
    from app.models import ProfileAbout
    du = doctor.user
    first = getattr(du, 'first_name', None) if du else None
    last = getattr(du, 'last_name', None) if du else None
    about_row = ProfileAbout.query.filter_by(doctor_id=doctor.id).first()
    degrees = _doctor_degrees(doctor)
    return {
        'id': str(doctor.id),
        'first_name': first,
        'last_name': last or '',
        'full_name': f"{first or ''} {last or ''}".strip(),
        'profile_image': getattr(du, 'profile_image', None) if du else None,
        'experience_years': doctor.experience_years,
        'consultation_fee': str(doctor.consultation_fee) if doctor.consultation_fee else None,
        'languages_known': doctor.languages_known or [],
        'about': about_row.brief_about_text if about_row else None,
        'specializations': _doctor_specialities(doctor),
        # Degrees + a compact "MBBS, MS, DNB" line for the card header.
        'qualifications': degrees,
        'highest_qualification': ', '.join(
            d['degree_name'] for d in degrees if d.get('degree_name')),
        'registration': {
            'number': doctor.registration_number,
            'council': doctor.registration_council,
            'year': doctor.registration_year,
        },
        'city': _doctor_city(doctor),
        'consultation_types': doctor.offered_consultation_types or [],
        # No awards / professional-membership store yet — the UI shows
        # "No Information" for an empty list.
        'awards': [],
    }


@doctor_bp.route('/<doctor_id>/public', methods=['GET'])
def get_doctor_public(doctor_id):
    """Full patient-facing doctor profile — identity, about, education, licence,
    specialities. Tolerates missing related rows so a partially-set-up doctor
    still loads."""
    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    return success_response(data=doctor_full_profile(doctor))


@doctor_bp.route('/<doctor_id>/offerings', methods=['GET'])
def get_doctor_offerings(doctor_id):
    """The doctor's bookable SERVICES (marketplace products) + the CARE PLANS
    (group offerings) they serve on — surfaced on their profile so a patient can
    book them without leaving the page."""
    from app.models import (
        DoctorMarketplaceProduct, GroupOffering, GroupOfferingMember,
    )
    services = []
    for mp in DoctorMarketplaceProduct.query.filter_by(
            doctor_id=doctor_id, is_active=True, approval_status='approved').all():
        services.append({
            'id': str(mp.id),
            'product_id': str(mp.product_id) if mp.product_id else None,
            'name': mp.product.name if mp.product else None,
            'description': mp.product.description if mp.product else None,
            'price': float(mp.doctor_price or 0),
        })

    offering_ids = {
        m.offering_id for m in
        GroupOfferingMember.query.filter_by(doctor_id=doctor_id).all()
        if m.offering_id
    }
    group_offerings = []
    if offering_ids:
        for go in GroupOffering.query.filter(
                GroupOffering.id.in_(offering_ids),
                GroupOffering.status == 'published',
                GroupOffering.is_active.is_(True),
                GroupOffering.is_deleted.is_(False)).all():
            group_offerings.append({
                'id': str(go.id),
                'name': go.name,
                'price': float(go.patient_price or 0),
                'backing_product_id': str(go.backing_product_id) if go.backing_product_id else None,
            })

    return success_response(data={
        'services': services,
        'group_offerings': group_offerings,
    })


@doctor_bp.route('/search', methods=['GET'])
def search_doctors():
    """Search doctors - redirect to list with same functionality."""
    return list_doctors()


@doctor_bp.route('/<doctor_id>', methods=['GET'])
def get_doctor(doctor_id):
    """Get doctor details by ID."""
    return get_doctor_public(doctor_id)


@doctor_bp.route('/<doctor_id>/services', methods=['GET'])
def get_doctor_services(doctor_id):
    """Get services offered by a doctor."""
    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    
    services = []
    for service in doctor.services:
        if service.is_available:
            services.append(service.to_dict())
    
    return success_response(data={'services': services})


# --- Doctor Authenticated Routes ---

@doctor_bp.route('/profile', methods=['GET'])
@jwt_required()
@feature_required('doctor.profile')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_profile():
    """Get current doctor's full profile (also the clinic/hospital head)."""
    logger.debug(f"[DOCTOR:PROFILE] user_id={current_user.id}")
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    data = doctor.to_dict()
    # Hide the internal placeholder registration number used when a facility
    # manager's Doctor row is auto-provisioned, so the form shows an empty
    # editable field rather than "FACILITY-<uuid>".
    if isinstance(data.get('registration_number'), str) and \
            data['registration_number'].startswith('FACILITY-'):
        data['registration_number'] = ''
    # Primary phone + email live on the User (shared-profile split), so
    # doctor.to_dict() omits them. The profile form reads them from
    # ``user_details`` (read-only, "contact admin to change") — expose them here
    # so the fields aren't blank.
    u = getattr(doctor, 'user', None) or current_user
    data['user_details'] = {
        'phone_number': getattr(u, 'phone_number', None),
        'email': getattr(u, 'email', None),
    }
    return success_response(data=data)


@doctor_bp.route('/appointments', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_appointments():
    """
    Get doctor's appointments.
    
    Query Parameters:
        - status: Filter by status (pending, confirmed, completed, cancelled)
        - page: Page number
        - per_page: Results per page
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 50)
    status_str = request.args.get('status', '').lower()
    logger.debug(f"[DOCTOR:APPOINTMENTS] page={page}, status={status_str}")
    
    # Convert status string to enum if provided
    status = None
    if status_str:
        try:
            status = AppointmentStatus(status_str)
        except ValueError:
            pass
    
    appointments = DoctorService.get_appointments(
        doctor_id=doctor.id,
        status=status,
        page=page,
        per_page=per_page
    )
    
    result = []
    for appt in appointments.items:
        appt_data = appt.to_dict(include_relations=True)
        appt_data['patient'] = {
            'id': str(appt.patient.id),
            'full_name': appt.patient.full_name,
        }
        appt_data['chief_complaint'] = appt.chief_complaint
        result.append(appt_data)
    
    return success_response(data={
        'appointments': result,
        'pagination': {
            'page': appointments.page,
            'per_page': appointments.per_page,
            'total': appointments.total,
            'pages': appointments.pages,
        }
    })


@doctor_bp.route('/appointments/<appointment_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_appointment_by_id(appointment_id):
    """Get a single appointment by ID (must belong to the requesting doctor)."""
    from app.models import Appointment
    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    appointment = Appointment.query.filter_by(
        tenant_id=doctor.tenant_id,
        id=appointment_id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if not appointment:
        return not_found_response('Appointment not found')
    return success_response(data=appointment.to_dict(include_relations=True))


@doctor_bp.route('/appointments/calendar', methods=['GET'])
@jwt_required()
@feature_required('doctor.calendar')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_calendar_appointments():
    """Get appointments for calendar view (by month)."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    month_str = request.args.get('month', '').strip() # YYYY-MM
    if not month_str:
        from datetime import datetime
        month_str = datetime.now().strftime('%Y-%m')
        
    try:
        year, month = map(int, month_str.split('-'))
    except (ValueError, IndexError):
        return error_response('Invalid month format. Use YYYY-MM', status_code=400)
    
    appointments = DoctorService.get_calendar_appointments(doctor.id, year, month)
    
    result = []
    for appt in appointments:
        result.append({
            'id': str(appt.id),
            'appointment_date': appt.appointment_date.isoformat(),
            'start_time': appt.start_time.isoformat(),
            'end_time': appt.end_time.isoformat() if appt.end_time else None,
            'status': appt.status.value,
            'patient_name': appt.patient.full_name if appt.patient else 'Unknown',
            'chief_complaint': appt.chief_complaint,
        })
    
    return success_response(data={'appointments': result})


@doctor_bp.route('/appointments/<appointment_id>/accept', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def accept_appointment(appointment_id):
    """Accept a pending appointment."""
    from app.api.common.appointment.service import AppointmentService
    
    try:
        logger.debug(f"[DOCTOR:ACCEPT] appointment_id={appointment_id}")
        appointment = AppointmentService.confirm(appointment_id, current_user.id)
        if not appointment:
            return error_response('Appointment not found', status_code=404)

        # Persist-first: the confirm above committed — tell the patient live.
        from app.common.notify import notify_appointment_event
        notify_appointment_event(appointment, 'confirmed')

        return success_response(
            message='Appointment accepted',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/appointments/<appointment_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def reject_appointment(appointment_id):
    """Reject/cancel a pending appointment."""
    from app.api.common.appointment.service import AppointmentService

    try:
        logger.debug(f"[DOCTOR:REJECT] appointment_id={appointment_id}")
        # Approval-matrix gate on a doctor-initiated cancel: auto → proceed,
        # auto_reject → denied, manual → held for admin approval.
        doctor = DoctorService.get_by_user_id(current_user.id)
        if doctor:
            from app.api.admin.doctor_action_gate import gate_action
            outcome, obj = gate_action(
                doctor, 'appointment_cancel', ref_type='appointment',
                ref_id=appointment_id, label='Cancel / reject appointment',
                requested_by_id=current_user.id)
            if outcome == 'reject':
                return error_response(obj, status_code=403)
            if outcome == 'held':
                return success_response(
                    message='Cancellation submitted for admin approval.',
                    data={'held': True, 'action_id': str(obj.id)})

        appointment = AppointmentService.cancel(appointment_id, current_user.id)
        if not appointment:
            return error_response('Appointment not found', status_code=404)

        from app.common.notify import notify_appointment_event
        notify_appointment_event(appointment, 'cancelled_by_doctor')

        return success_response(
            message='Appointment rejected',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/appointments/<appointment_id>/complete', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def complete_appointment(appointment_id):
    """Mark a confirmed appointment as complete."""
    from app.api.common.appointment.service import AppointmentService
    
    data = request.get_json() or {}
    notes = data.get('notes', '')
    
    try:
        appointment = AppointmentService.complete(appointment_id, current_user.id, notes)
        if not appointment:
            return error_response('Appointment not found', status_code=404)
        
        return success_response(
            message='Appointment marked as complete',
            data=appointment.to_dict(include_relations=True)
        )
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/appointments/<appointment_id>/patient-context', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_appointment_patient_context(appointment_id):
    """
    Get the medical context a patient shared for this appointment.
    Returns everything the patient chose to share during the booking wizard.
    """
    from app.models import (
        AppointmentMedicalContext, Appointment, Doctor,
        HealthRecord, Symptom,
    )

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = Appointment.query.filter_by(
        tenant_id=doctor.tenant_id,
        id=appointment_id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if not appointment:
        return not_found_response('Appointment not found')

    # Get the linked medical context
    ctx = AppointmentMedicalContext.query.filter_by(
        tenant_id=appointment.tenant_id,
        appointment_id=appointment.id,
    ).first()

    # Fallback: if no linked context, find the most recent context created by this
    # patient for the same consultation_type around the appointment creation time.
    # This handles cases where the link call failed or wasn't made.
    if not ctx and appointment.patient_id:
        from datetime import timedelta
        appt_created = appointment.created_at

        # Try 1: Same patient, same consultation_type, within 24-hour window
        if appt_created:
            window_start = appt_created - timedelta(hours=24)
            window_end = appt_created + timedelta(minutes=10)

            fallback_q = AppointmentMedicalContext.query.filter(
                AppointmentMedicalContext.tenant_id == appointment.tenant_id,
                AppointmentMedicalContext.patient_id == appointment.patient_id,
                AppointmentMedicalContext.appointment_id.is_(None),  # not yet linked
                AppointmentMedicalContext.created_at.between(window_start, window_end),
            )
            if appointment.consultation_type:
                ct_str = appointment.consultation_type.value if hasattr(appointment.consultation_type, 'value') else str(appointment.consultation_type)
                fallback_q = fallback_q.filter(
                    AppointmentMedicalContext.consultation_type == ct_str,
                )
            ctx = fallback_q.order_by(AppointmentMedicalContext.created_at.desc()).first()

        # Try 2: If still not found, look for ANY unlinked context by this patient
        # (covers edge cases like consultation_type mismatch)
        if not ctx:
            ctx = AppointmentMedicalContext.query.filter(
                AppointmentMedicalContext.tenant_id == appointment.tenant_id,
                AppointmentMedicalContext.patient_id == appointment.patient_id,
                AppointmentMedicalContext.appointment_id.is_(None),
            ).order_by(AppointmentMedicalContext.created_at.desc()).first()

        # Auto-link if found so future lookups are instant
        if ctx:
            ctx.appointment_id = appointment.id
            ctx.status = 'completed'
            db.session.commit()

    # Basic patient identity (always shown)
    patient = appointment.patient
    patient_info = {}
    if patient:
        # Schema split: ``gender`` and ``dob`` moved from Patient → User
        # (read off ``patient.user``). ``blood_group`` and
        # ``languages_known`` remain on Patient. The previous code read
        # all four off ``patient`` and 500'd on AttributeError for the
        # first two.
        u = patient.user
        raw_langs = patient.languages_known or []
        languages = []
        for lang in raw_langs:
            if isinstance(lang, str):
                languages.append(lang)
            elif isinstance(lang, dict):
                languages.append(lang.get('name') or lang.get('native') or str(lang))
            else:
                languages.append(str(lang))

        patient_info = {
            'full_name': patient.full_name,
            'gender': u.gender.value if u and u.gender else None,
            'date_of_birth': str(u.dob) if u and u.dob else None,
            'blood_group': patient.blood_group.value if patient.blood_group else None,
            'languages_known': languages,
        }

    if not ctx:
        return success_response(data={
            'patient_info': patient_info,
            'context': None,
        })

    # ── Resolve symptom names ──
    symptom_data = []
    selected_symptoms = ctx.selected_symptoms or []
    symptom_ids = [s.get('symptom_id') for s in selected_symptoms if s.get('symptom_id')]
    symptom_map = {}
    if symptom_ids:
        symptoms_q = Symptom.query.filter(
            Symptom.tenant_id == appointment.tenant_id,
            Symptom.id.in_(symptom_ids),
        ).all()
        symptom_map = {str(s.id): s.name for s in symptoms_q}
    for s in selected_symptoms:
        symptom_data.append({
            'name': symptom_map.get(str(s.get('symptom_id', '')), 'Unknown'),
            'severity': s.get('severity'),
            'notes': s.get('notes', ''),
        })

    # ── Read snapshots directly (captured at booking time) ──
    # If snapshots exist, use them. Otherwise fall back to resolving from
    # toggles (for contexts created before the snapshot feature).
    vitals_data = ctx.vitals_snapshot or {}
    habits_data = ctx.habits_snapshot or {}
    records_data = ctx.records_snapshot or []
    surgeries_data = ctx.surgeries_snapshot or []
    patient_notes = ctx.patient_notes or {}

    # Fallback: resolve from toggles if snapshots are empty but toggles exist
    if not vitals_data and ctx.shared_vitals:
        from app.api.service_reciever.patient.service import HealthRecordService
        target_pid = ctx.booking_for_id or ctx.patient_id
        all_vitals = HealthRecordService.get_latest_vitals(target_pid)
        if all_vitals:
            for key, is_shared in (ctx.shared_vitals or {}).items():
                if is_shared and key in all_vitals:
                    vitals_data[key] = all_vitals[key]
        # Also merge additional vitals
        if ctx.additional_vitals:
            for k, v in ctx.additional_vitals.items():
                if v is not None and v != '':
                    vitals_data[k] = v

    if not habits_data and ctx.shared_habits:
        from app.api.service_reciever.patient.service import HealthRecordService
        target_pid = ctx.booking_for_id or ctx.patient_id
        all_habits = HealthRecordService.get_latest_habits(target_pid)
        if all_habits:
            habits_config = ctx.shared_habits
            visible_keys = []
            if isinstance(habits_config, list):
                visible_keys = [h.get('habit_key') for h in habits_config if h.get('visible', True) and h.get('habit_key')]
            elif isinstance(habits_config, dict):
                visible_keys = [k for k, v in habits_config.items() if v]
            for hk in visible_keys:
                if hk in all_habits:
                    habits_data[hk] = all_habits[hk]

    if not records_data and ctx.shared_health_records:
        visible_ids = [r.get('record_id') for r in ctx.shared_health_records if r.get('visible', True) and r.get('record_id')]
        if visible_ids:
            recs = HealthRecord.query.filter(HealthRecord.tenant_id == appointment.tenant_id, HealthRecord.id.in_(visible_ids), HealthRecord.is_deleted == False).all()
            for rec in recs:
                d = rec.details or {}
                entry = {
                    'id': str(rec.id), 'record_type': rec.record_type,
                    'title': d.get('title', (rec.record_type or '').replace('_', ' ').title()),
                    'record_date': str(rec.record_date) if rec.record_date else None,
                    'notes': rec.notes, 'details': d, 'attachments': rec.attachment_links or [],
                }
                _enrich_attachments(entry, key='attachments')
                records_data.append(entry)

    if not surgeries_data and ctx.shared_prescriptions:
        visible_ids = [s.get('prescription_id') for s in ctx.shared_prescriptions if s.get('visible', True) and s.get('prescription_id')]
        if visible_ids:
            recs = HealthRecord.query.filter(HealthRecord.tenant_id == appointment.tenant_id, HealthRecord.id.in_(visible_ids), HealthRecord.is_deleted == False).all()
            for rec in recs:
                d = rec.details or {}
                entry = {
                    'id': str(rec.id), 'surgery_type': d.get('surgery_type', rec.record_type or ''),
                    'surgery_date': str(rec.record_date) if rec.record_date else None,
                    'hospital': d.get('hospital', ''), 'surgeon_name': d.get('surgeon_name', ''),
                    'notes': rec.notes or d.get('notes', ''), 'attachments': rec.attachment_links or [],
                }
                _enrich_attachments(entry, key='attachments')
                surgeries_data.append(entry)

    # Snapshots froze each record's attachments (and their short-lived signed
    # URLs) at booking time. Re-resolve them from the LIVE health record so the
    # doctor sees files the patient added after booking and always gets a fresh,
    # non-expired URL — the whole reason an attachment was "missing" before.
    _refresh_snapshot_attachments(records_data, appointment.tenant_id)
    _refresh_snapshot_attachments(surgeries_data, appointment.tenant_id)

    # Legacy fallback for patient_notes from old additional_records field
    if not patient_notes:
        raw_add = ctx.additional_records or {}
        if isinstance(raw_add, dict):
            patient_notes = raw_add.get('additional_details', {})

    context_data = {
        'id': str(ctx.id),
        'consultation_type': ctx.consultation_type,
        'symptoms': symptom_data,
        'custom_symptoms': ctx.selected_custom_symptoms or [],
        'shared_vitals': vitals_data,
        'additional_vitals': ctx.additional_vitals or {},
        'shared_habits': habits_data,
        'shared_health_records': records_data,
        'shared_surgeries': surgeries_data,
        'additional_details': patient_notes,
    }

    # ── Follow-up: include previous prescription if this is a follow-up appointment ──
    previous_prescription = None
    if appointment.is_follow_up:
        from app.api.common.follow_up.service import FollowUpService
        prev_rx = FollowUpService.get_previous_prescription(appointment)
        if prev_rx:
            previous_prescription = prev_rx.to_dict(include_patient=True, include_doctor=True)

    return success_response(data={
        'patient_info': patient_info,
        'context': context_data,
        'is_follow_up': appointment.is_follow_up,
        'follow_up_type': appointment.follow_up_type.value if appointment.follow_up_type else None,
        'previous_prescription': previous_prescription,
    })


# ═══════════════════════════════════════════════════════════════════════
#  PATIENT VITALS UPDATE (during consultation)
# ═══════════════════════════════════════════════════════════════════════

@doctor_bp.route('/appointments/<appointment_id>/patient-vitals', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
@feature_required('patient.vitals')
def update_patient_vitals(appointment_id):
    """
    Doctor updates patient vitals during a consultation.
    Height, weight, and allergies are also saved to the patient profile.
    All vitals are saved to the health_records table.

    Body:
    {
      "height_cm": "175",
      "weight_kg": "70",
      "blood_pressure_systolic": "120",
      "blood_pressure_diastolic": "80",
      "heart_rate": "72",
      "spo2": "98",
      "temperature": "98.6",
      "blood_sugar_fasting": "90",
      "blood_sugar_pp": "120",
      "bmi": "22.9",
      "allergies": "Penicillin, Dust"
    }
    """
    from app.models import Doctor, Appointment, Patient
    from app.api.service_reciever.patient.service import HealthRecordService

    data = request.get_json() or {}
    if not data:
        return error_response('No vitals data provided')

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = Appointment.query.filter_by(
        tenant_id=doctor.tenant_id,
        id=appointment_id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if not appointment:
        return not_found_response('Appointment not found')

    patient = Patient.query.filter_by(
        tenant_id=appointment.tenant_id, id=appointment.patient_id,
    ).first()
    if not patient:
        return not_found_response('Patient not found')

    # ── Save full vitals to health_records (record_type='vitals') ──
    vitals_data = {}
    vitals_keys = [
        'height_cm', 'weight_kg', 'bmi',
        'blood_pressure_systolic', 'blood_pressure_diastolic',
        'heart_rate', 'spo2', 'temperature',
        'blood_sugar_fasting', 'blood_sugar_pp',
    ]
    for key in vitals_keys:
        if key in data and data[key] is not None and str(data[key]).strip():
            vitals_data[key] = str(data[key]).strip()

    if vitals_data:
        # Merge with existing vitals (don't overwrite fields not sent)
        existing = HealthRecordService.get_latest_vitals(patient.id) or {}
        existing.update(vitals_data)
        HealthRecordService.save_vitals(patient.id, current_user.id, existing)

    # ── Update patient profile for key fields (allergies) ──
    # Allergies stored on the prescription model, not patient profile directly
    # But we can update the medical context snapshot if needed

    db.session.commit()

    logger.info(f"[DOCTOR] Vitals updated for patient={patient.id} by doctor={doctor.id} appt={appointment_id}")

    return success_response(
        data={'vitals': vitals_data},
        message='Patient vitals updated successfully'
    )


# ═══════════════════════════════════════════════════════════════════════
#  PRESCRIPTION MANAGEMENT (doctor endpoints)
# ═══════════════════════════════════════════════════════════════════════

def _get_doctor_for_request():
    """Helper: return the Doctor row this request acts for, or None.

    For a doctor that is their own row. For a doctor's assistant it is the
    doctor who employs them — which is why every route below serves staff
    without being edited. The decision about whether they may was already made
    in ``before_request``; see ``staff_access.py``.
    """
    from app.common.provider_access import acting_doctor
    return acting_doctor()


def _is_medicine_row_empty(med_data):
    """Return True if a medicine payload row is completely blank — no
    catalog selection, no custom generic/brand, no dosage info, no
    frequency, no duration, and no M/A/E/N values.

    The "Add Medicine" button on the prescription form pre-creates an
    empty row in the form state. If the doctor adds the row, decides
    not to use it, and submits anyway, that blank row was being
    persisted and showing up in the preview + PDF as a row of dashes
    (the symptom the doctor reported). Treat empty rows as
    "doctor changed their mind" and skip them silently instead of
    persisting or 4xx-ing the whole save.
    """
    if not isinstance(med_data, dict):
        return True
    # Empty if EVERY meaningful field is blank. "Blank" = falsy after
    # ``.strip()`` for strings, or None / 0 / '' for numerics.
    keys_that_matter = (
        'medicine_id', 'custom_generic_name', 'custom_brand_name',
        'dosage', 'frequency', 'duration',
        'morning', 'afternoon', 'evening', 'night',
        'quantity', 'instructions', 'special_instructions',
    )
    for k in keys_that_matter:
        v = med_data.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if v == 0 or v == '0':
            # Numeric zero is meaningless on its own
            continue
        return False
    return True


def _build_medicine_row(med_data, idx, tenant_id):
    """
    Build a PrescriptionMedicine from request payload.
    Validates against the banned list when a custom generic name is used.

    Returns:
        (row, err) tuple where:
          * (PrescriptionMedicine, None) — built successfully
          * (None, 'Row X: ...')         — validation error
          * (None, None)                 — row was empty, skip silently
    """
    from app.models import Medicine, BannedMedicine, PrescriptionMedicine

    # Skip-silently sentinel for empty form rows (see helper docstring).
    if _is_medicine_row_empty(med_data):
        return None, None

    medicine_id = med_data.get('medicine_id')
    custom_generic = (med_data.get('custom_generic_name') or '').strip()
    custom_brand = (med_data.get('custom_brand_name') or '').strip()

    # If doctor picked from catalog
    if medicine_id:
        med = Medicine.query.filter_by(tenant_id=tenant_id, id=medicine_id).first()
        if not med:
            return None, f'Row {idx}: medicine not found in catalog'
    else:
        med = None

    # Exhaustive banned-list check for custom generic name
    if custom_generic:
        banned = _check_banned_exhaustive(custom_generic)
        if banned:
            return None, f'Row {idx}: "{custom_generic}" matches banned substance "{banned.generic_name}". Reason: {banned.reason or "N/A"}'

    row = PrescriptionMedicine(
        tenant_id=tenant_id,
        medicine_id=med.id if med else None,
        custom_generic_name=custom_generic or None,
        custom_brand_name=custom_brand or None,
        quantity=med_data.get('quantity'),
        quantity_unit=med_data.get('quantity_unit'),
        medicine_type=med_data.get('medicine_type', 'solid'),
        dosage=med_data.get('dosage'),
        frequency=med_data.get('frequency'),
        duration=med_data.get('duration'),
        morning=med_data.get('morning'),
        afternoon=med_data.get('afternoon'),
        evening=med_data.get('evening'),
        night=med_data.get('night'),
        timing=med_data.get('timing'),
        morning_timing=med_data.get('morning_timing'),
        afternoon_timing=med_data.get('afternoon_timing'),
        evening_timing=med_data.get('evening_timing'),
        night_timing=med_data.get('night_timing'),
        morning_instructions=med_data.get('morning_instructions'),
        afternoon_instructions=med_data.get('afternoon_instructions'),
        evening_instructions=med_data.get('evening_instructions'),
        night_instructions=med_data.get('night_instructions'),
        custom_dose_unit=med_data.get('custom_dose_unit'),
        special_instructions=med_data.get('instructions') or med_data.get('special_instructions'),
        serial_no=med_data.get('serial_no', idx),
    )
    return row, None


@doctor_bp.route('/prescriptions', methods=['GET'])
@jwt_required()
@feature_required('doctor.prescriptions')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def list_prescriptions():
    """
    List doctor's prescriptions.
    Query params:
        status = draft | active | all (default: all)
        page, per_page
    """
    from app.models import Prescription, PrescriptionStatus, Doctor

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    status_filter = request.args.get('status', 'all').strip().lower()
    appointment_id_filter = request.args.get('appointment_id', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    q = Prescription.query.filter_by(tenant_id=doctor.tenant_id, doctor_id=doctor.id, is_deleted=False)
    if appointment_id_filter:
        q = q.filter(Prescription.appointment_id == appointment_id_filter)
    if status_filter == 'draft':
        q = q.filter(Prescription.status == PrescriptionStatus.DRAFT)
    elif status_filter == 'approved':
        q = q.filter(Prescription.status == PrescriptionStatus.APPROVED)
    elif status_filter == 'active':
        q = q.filter(Prescription.status == PrescriptionStatus.ACTIVE)
    elif status_filter == 'completed':
        q = q.filter(Prescription.status == PrescriptionStatus.ACTIVE)
    elif status_filter == 'revised':
        q = q.filter(Prescription.status == PrescriptionStatus.REVISED)
    elif status_filter == 'pending_approval':
        q = q.filter(Prescription.status == PrescriptionStatus.PENDING_APPROVAL)
    elif status_filter == 'rejected':
        q = q.filter(Prescription.status == PrescriptionStatus.REJECTED)
    q = q.order_by(Prescription.updated_at.desc())
    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    return success_response(data={
        'prescriptions': [p.to_dict(include_patient=True) for p in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@doctor_bp.route('/prescriptions/summary', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def prescriptions_progress_summary():
    """Counts that drive the doctor's "My Prescriptions" progress bar.

    Two actionable buckets the doctor still has to clear:
      * ``pending_to_write``  — CONFIRMED / IN_PROGRESS / COMPLETED
        appointments that have NO prescription yet (same rule as the
        "Pending (To Generate)" tab).
      * ``yet_to_publish``    — prescriptions written but not yet pushed
        to the patient: DRAFT + PENDING_APPROVAL + APPROVED (everything
        before ACTIVE). ACTIVE = already pushed to the patient.

    ``all_done`` is True when both buckets are empty, so the UI can flip
    the bar green.
    """
    from app.models import Appointment, Prescription, PrescriptionStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    # ── pending_to_write: appointments needing a prescription ──────────
    prescribed_appt_ids = db.session.query(Prescription.appointment_id).filter(
        Prescription.doctor_id == doctor.id,
        Prescription.is_deleted == False,
        Prescription.appointment_id.isnot(None),
    ).subquery()

    pending_to_write = Appointment.query.filter(
        Appointment.tenant_id == doctor.tenant_id,
        Appointment.doctor_id == doctor.id,
        Appointment.status.in_([
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
            AppointmentStatus.COMPLETED,
        ]),
        ~Appointment.id.in_(db.session.query(prescribed_appt_ids)),
    ).count()

    # ── prescription status breakdown (this doctor, non-deleted) ───────
    def _count(*statuses):
        return Prescription.query.filter(
            Prescription.tenant_id == doctor.tenant_id,
            Prescription.doctor_id == doctor.id,
            Prescription.is_deleted == False,
            Prescription.status.in_(statuses),
        ).count()

    drafts = _count(PrescriptionStatus.DRAFT)
    awaiting_approval = _count(PrescriptionStatus.PENDING_APPROVAL)
    approved = _count(PrescriptionStatus.APPROVED)
    published = _count(PrescriptionStatus.ACTIVE)

    # Everything written but not yet pushed to the patient.
    yet_to_publish = drafts + awaiting_approval + approved

    total_outstanding = pending_to_write + yet_to_publish
    # Denominator for the bar: outstanding work + work already completed
    # (published). Guard against divide-by-zero when the doctor is brand new.
    total_tasks = total_outstanding + published
    completed_pct = (
        round(published / total_tasks * 100) if total_tasks else 100
    )

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


@doctor_bp.route('/appointments/pending-prescriptions', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_appointments_pending_prescriptions():
    """
    Get confirmed/completed appointments that do NOT have a prescription yet.
    These appear in the doctor's "Pending (To Generate)" tab.
    """
    from app.models import Appointment, Prescription

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    # Subquery: appointment IDs that already have a prescription (non-deleted)
    prescribed_appt_ids = db.session.query(Prescription.appointment_id).filter(
        Prescription.doctor_id == doctor.id,
        Prescription.is_deleted == False,
        Prescription.appointment_id.isnot(None),
    ).subquery()

    # Confirmed or completed appointments without a prescription
    q = Appointment.query.filter(
        Appointment.tenant_id == doctor.tenant_id,
        Appointment.doctor_id == doctor.id,
        Appointment.status.in_([
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
            AppointmentStatus.COMPLETED,
        ]),
        ~Appointment.id.in_(db.session.query(prescribed_appt_ids)),
    ).order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())

    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    result = []
    for appt in paginated.items:
        appt_data = appt.to_dict(include_relations=True)
        appt_data['patient'] = {
            'id': str(appt.patient.id),
            'full_name': appt.patient.full_name,
        }
        appt_data['chief_complaint'] = appt.chief_complaint
        result.append(appt_data)

    return success_response(data={
        'appointments': result,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@doctor_bp.route('/prescriptions/<prescription_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_prescription(prescription_id):
    """Get a single prescription with full details."""
    from app.models import Prescription
    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    p = Prescription.query.filter_by(tenant_id=doctor.tenant_id, id=prescription_id, doctor_id=doctor.id, is_deleted=False).first()
    if not p:
        return error_response('Prescription not found', status_code=404)

    return success_response(data=p.to_dict(include_patient=True, include_doctor=True))


@doctor_bp.route('/appointments/<appointment_id>/prescription', methods=['POST'])
@jwt_required()
@feature_required('doctor.prescriptions')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def create_prescription(appointment_id):
    """
    Create (or save-as-draft) a prescription for an appointment.

    Body:
    {
      "status": "draft" | "active",  // default "draft"
      "notes": "...", "allergies": "...",
      "diagnosis": "...", "diagnostic_tests": "...",
      "instructions": "...", "doctors_advice": "...", "follow_up": "...",
      "medicines": [
        {
          "medicine_id": "uuid" | null,
          "custom_generic_name": "...", "custom_brand_name": "...",
          "quantity": 50, "quantity_unit": "No",
          "dosage": "1 tab", "frequency": "Twice a day", "duration": "3 days",
          "morning": "1", "afternoon": null, "evening": "1/2", "night": "1/4",
          "timing": "after food", "instructions": "..."
        }
      ]
    }
    """
    from app.api.common.appointment.service import AppointmentService
    from app.models import Prescription, PrescriptionMedicine, Medicine, PrescriptionStatus
    from app.extensions import db

    data = request.get_json() or {}

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment:
        return error_response('Appointment not found', status_code=404)
    if appointment.doctor_id != doctor.id:
        return error_response('Unauthorized', status_code=403)

    # ── Consultation must be at least in-progress before
    # writing a prescription. The original gate required
    # COMPLETED, which contradicted the intended workflow:
    # finalizing a prescription (status=ACTIVE) is what flips
    # the appointment to COMPLETED (see the auto-complete
    # block lower down). Requiring COMPLETED first forces the
    # doctor to explicitly mark-complete on a separate screen
    # before they can even open the prescription form — which
    # is the symptom the user reported here.
    #
    # IN_PROGRESS = call is live (or just ended; the doctor
    # may not have hit the End button yet but the consultation
    # really happened — that's what the join_at timestamps
    # prove). COMPLETED = explicit complete already happened.
    # CONFIRMED / PENDING / cancelled are still rejected: the
    # consultation never started in those states so there is
    # nothing to prescribe against.
    if appointment.status not in (
        AppointmentStatus.IN_PROGRESS,
        AppointmentStatus.COMPLETED,
    ):
        return error_response(
            'Prescription can only be written once the consultation '
            'has started. Join the call first.',
            status_code=400,
            data={'appointment_status': appointment.status.value},
        )

    # Check for existing draft
    existing = Prescription.query.filter_by(
        tenant_id=doctor.tenant_id,
        appointment_id=appointment.id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if existing:
        return jsonify({
            'success': False,
            'message': 'Prescription already exists for this appointment. Use PUT to update.',
            'existing_prescription_id': str(existing.id),
        }), 409

    target_status = data.get('status', 'draft').lower()
    presc_status = PrescriptionStatus.ACTIVE if target_status == 'active' else PrescriptionStatus.DRAFT

    try:
        # Parse structured follow-up fields
        from app.models import FollowUpType, ConsultationType as CT
        fu_type_raw = data.get('follow_up_type')
        fu_ct_raw = data.get('follow_up_consultation_type')
        fu_type = FollowUpType(fu_type_raw) if fu_type_raw else None
        fu_ct = CT(fu_ct_raw) if fu_ct_raw else None
        fu_date_str = data.get('follow_up_date')
        fu_date = None
        if fu_date_str:
            from datetime import datetime as _dt
            fu_date = _dt.strptime(fu_date_str, '%Y-%m-%d').date()
        fu_slot_id = data.get('follow_up_time_slot_id') or None

        prescription = Prescription(
            tenant_id=doctor.tenant_id,
            appointment_id=appointment.id,
            patient_id=appointment.patient_id,
            doctor_id=doctor.id,
            notes=data.get('notes'),
            allergies=data.get('allergies'),
            diagnosis=data.get('diagnosis'),
            diagnostic_tests=data.get('diagnostic_tests'),
            instructions=data.get('instructions'),
            previous_medical_history=data.get('previous_medical_history'),
            doctors_advice=data.get('doctors_advice'),
            follow_up=data.get('follow_up'),
            follow_up_type=fu_type,
            follow_up_consultation_type=fu_ct,
            follow_up_date=fu_date,
            follow_up_time_slot_id=fu_slot_id,
            status=presc_status,
        )
        db.session.add(prescription)
        db.session.flush()

        # Freeze the doctor's credentials onto the document at issue time so
        # later education edits / master renames don't mutate it retroactively.
        if presc_status == PrescriptionStatus.ACTIVE:
            prescription.capture_doctor_credentials()

        # Add medicines. ``(None, None)`` from the builder means the
        # form row was empty (doctor added it then left it blank);
        # skip silently rather than persisting a row of NULL columns
        # that later renders as a row of dashes in the prescription
        # preview + PDF.
        errors = []
        for i, med_data in enumerate(data.get('medicines', []), start=1):
            row, err = _build_medicine_row(med_data, i, doctor.tenant_id)
            if err:
                errors.append(err)
                continue
            if row is None:
                continue  # empty row, skip
            row.prescription_id = prescription.id
            db.session.add(row)

        if errors:
            db.session.rollback()
            return error_response('Validation errors in medicines', status_code=400, data=errors)

        # If finalizing, mark appointment completed. Route
        # through AppointmentService.complete so the round-10
        # attendance gate (both doctor + patient must have
        # joined the video call) still fires — otherwise a
        # doctor could write a prescription on a no-show
        # patient and the appointment would silently flip to
        # COMPLETED without the call ever happening, which
        # was the whole point of the attendance gate.
        #
        # If the appointment is already COMPLETED (e.g. doctor
        # marked complete manually first, then opened the
        # prescription form), skip the service call — complete
        # raises on terminal states.
        if presc_status == PrescriptionStatus.ACTIVE:
            if appointment.status != AppointmentStatus.COMPLETED:
                try:
                    AppointmentService.complete(
                        appointment.id, current_user.id, notes=None,
                    )
                except ValueError as ce:
                    # Attendance gate or status gate. Roll back
                    # the prescription so the doctor isn't left
                    # with a half-saved row tied to a still-
                    # in-progress appointment.
                    db.session.rollback()
                    return error_response(str(ce), status_code=400)
            # Auto-create payout (only once per appointment)
            _auto_create_payout(appointment)

        db.session.commit()

        # Persist-first: a prescription created straight to ACTIVE is
        # already in the patient's hands — tell them live.
        if presc_status == PrescriptionStatus.ACTIVE:
            from app.common.notify import notify_prescription_pushed
            notify_prescription_pushed(prescription)

        msg = 'Prescription saved as draft' if presc_status == PrescriptionStatus.DRAFT else 'Prescription created and appointment completed'
        return success_response(message=msg, data=prescription.to_dict(include_patient=True))

    except Exception as e:
        db.session.rollback()
        logger.exception('Failed to create prescription')
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/prescriptions/<prescription_id>', methods=['PUT'])
@jwt_required()
@feature_required('doctor.prescriptions')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_prescription(prescription_id):
    """
    Update an existing prescription (draft or active).
    Replaces all medicines if 'medicines' key is present.
    """
    from app.models import Prescription, PrescriptionMedicine, PrescriptionStatus
    from app.extensions import db

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    prescription = Prescription.query.filter_by(
        tenant_id=doctor.tenant_id,
        id=prescription_id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if not prescription:
        return error_response('Prescription not found', status_code=404)

    # For the push notification below: notify only on the actual
    # APPROVED→ACTIVE transition, not on later edits of an active one.
    _was_active = prescription.status == PrescriptionStatus.ACTIVE

    data = request.get_json() or {}

    # Update text fields
    for field in ('notes', 'allergies', 'diagnosis', 'diagnostic_tests',
                  'instructions', 'previous_medical_history', 'doctors_advice',
                  'follow_up', 'valid_until'):
        if field in data:
            setattr(prescription, field, data[field])

    # Update structured follow-up fields
    from app.models import FollowUpType, ConsultationType as CT
    if 'follow_up_type' in data:
        fu_raw = data['follow_up_type']
        prescription.follow_up_type = FollowUpType(fu_raw) if fu_raw else None
    if 'follow_up_consultation_type' in data:
        fu_ct_raw = data['follow_up_consultation_type']
        prescription.follow_up_consultation_type = CT(fu_ct_raw) if fu_ct_raw else None
    if 'follow_up_date' in data:
        fu_date_str = data['follow_up_date']
        if fu_date_str:
            from datetime import datetime as _dt
            prescription.follow_up_date = _dt.strptime(fu_date_str, '%Y-%m-%d').date()
        else:
            prescription.follow_up_date = None
    if 'follow_up_time_slot_id' in data:
        prescription.follow_up_time_slot_id = data['follow_up_time_slot_id'] or None

    # Replace medicines if provided
    if 'medicines' in data:
        # Delete existing
        PrescriptionMedicine.query.filter_by(
            tenant_id=doctor.tenant_id, prescription_id=prescription.id,
        ).delete()

        errors = []
        for i, med_data in enumerate(data['medicines'], start=1):
            row, err = _build_medicine_row(med_data, i, doctor.tenant_id)
            if err:
                errors.append(err)
                continue
            if row is None:
                continue  # empty row, skip silently
            row.prescription_id = prescription.id
            db.session.add(row)

        if errors:
            db.session.rollback()
            return error_response('Validation errors in medicines', status_code=400, data=errors)

    # Status transitions:
    # - Doctor can move draft/rejected → pending_approval (send for admin approval)
    # - Doctor can move approved → active (push to patient, after admin approved)
    # - Doctor CANNOT skip approval (draft → active is blocked)
    target_status = data.get('status', '').lower()
    # Approval matrix: when this doctor's 'prescription' mode is 'auto', a
    # submit-for-approval pushes straight to the patient — mark it APPROVED and
    # retarget to 'active' so the tested activation path below runs in full
    # (PDF, credential freeze, appointment completion, follow-up, payout).
    # 'manual' keeps the mandatory admin gate (today's behaviour).
    if target_status == 'pending_approval' and prescription.status in (
        PrescriptionStatus.DRAFT, PrescriptionStatus.REJECTED,
    ):
        from app.api.admin.approval_policy_service import effective_permission_mode
        if effective_permission_mode(doctor, 'prescription') == 'auto':
            prescription.status = PrescriptionStatus.APPROVED
            target_status = 'active'

    if target_status == 'pending_approval' and prescription.status in (
        PrescriptionStatus.DRAFT, PrescriptionStatus.REJECTED,
    ):
        prescription.status = PrescriptionStatus.PENDING_APPROVAL
    elif target_status == 'active' and prescription.status == PrescriptionStatus.APPROVED:
        # Push to patient — only allowed after admin approved
        # Generate PDF for the patient (permanent public URL, no expiring components)
        from app.services.prescription_pdf_service import generate_prescription_pdf
        from app.models import PrescriptionTemplate
        tpl = PrescriptionTemplate.query.filter_by(
            tenant_id=doctor.tenant_id, is_active=True,
        ).first()
        pdf_url = generate_prescription_pdf(prescription, template=tpl)
        if pdf_url:
            prescription.pdf_link = pdf_url

        prescription.capture_doctor_credentials()
        prescription.status = PrescriptionStatus.ACTIVE
        # Complete the appointment
        if prescription.appointment:
            from app.models import AppointmentStatus
            if prescription.appointment.status != AppointmentStatus.COMPLETED:
                prescription.appointment.status = AppointmentStatus.COMPLETED

        # ── Activate embedded follow-up (if configured) ──
        if prescription.follow_up_type:
            try:
                from app.api.common.follow_up.service import FollowUpService
                fu_type = prescription.follow_up_type.value
                fu_ct_str = prescription.follow_up_consultation_type.value if prescription.follow_up_consultation_type else 'video'
                if fu_type == 'free_doctor' and prescription.follow_up_time_slot_id:
                    FollowUpService.create_free_follow_up(
                        str(prescription.doctor_id),
                        str(prescription.id),
                        str(prescription.follow_up_time_slot_id),
                        fu_ct_str,
                    )
                elif fu_type == 'paid_patient_picks':
                    FollowUpService.create_paid_patient_picks(
                        str(prescription.doctor_id),
                        str(prescription.id),
                        fu_ct_str,
                        prescription.follow_up_date,  # date object, not string
                    )
                elif fu_type == 'paid_doctor_picks' and prescription.follow_up_time_slot_id:
                    FollowUpService.create_paid_doctor_picks(
                        str(prescription.doctor_id),
                        str(prescription.id),
                        str(prescription.follow_up_time_slot_id),
                        fu_ct_str,
                    )
                logger.info('Follow-up activated for prescription %s (type=%s)', prescription.id, fu_type)
            except Exception as fu_err:
                logger.warning('Failed to activate follow-up for prescription %s: %s', prescription.id, fu_err)
                # Don't block the prescription push — follow-up is secondary

        # ── Auto-create payout (only once per appointment) ──
        if prescription.appointment:
            _auto_create_payout(prescription.appointment)

    elif target_status == 'active':
        return error_response(
            'Doctors cannot directly activate prescriptions. Submit for admin approval first.',
            status_code=403,
        )

    db.session.commit()

    # Persist-first: the APPROVED→ACTIVE transition above committed — the
    # prescription is now visible to the patient, so tell them live.
    if not _was_active and prescription.status == PrescriptionStatus.ACTIVE:
        from app.common.notify import notify_prescription_pushed
        notify_prescription_pushed(prescription)

    # Family-doctor second-opinion commission. Finalizing a prescription is one
    # of the ways an appointment reaches COMPLETED, and this path sets the status
    # directly (it does NOT route through AppointmentService.complete), so the
    # award must fire here too — otherwise the patient's family doctor never
    # earns their commission for a consultation completed this way. Defensive +
    # idempotent (award_for_booking no-ops if already granted).
    from app.models import AppointmentStatus as _ApptStatus
    if prescription.appointment and prescription.appointment.status == _ApptStatus.COMPLETED:
        try:
            from app.api.family_doctor.credit_service import award_for_booking
            appt = prescription.appointment
            award_for_booking(
                appt.tenant_id, appt.patient_id, appt.doctor_id,
                'appointment', appt.id,
                label='Second opinion — consultation',
                amount=float(getattr(appt, 'consultation_fee', 0) or 0),
            )
            db.session.commit()
        except Exception:  # noqa: BLE001 — never block the prescription push
            db.session.rollback()

    return success_response(
        message='Prescription updated',
        data=prescription.to_dict(include_patient=True),
    )


@doctor_bp.route('/prescriptions/<prescription_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def delete_prescription(prescription_id):
    """Soft-delete a prescription (only drafts)."""
    from app.models import Prescription, PrescriptionStatus
    from datetime import datetime

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    p = Prescription.query.filter_by(tenant_id=doctor.tenant_id, id=prescription_id, doctor_id=doctor.id, is_deleted=False).first()
    if not p:
        return error_response('Prescription not found', status_code=404)
    if p.status != PrescriptionStatus.DRAFT:
        return error_response('Only draft prescriptions can be deleted', status_code=400)

    p.is_deleted = True
    p.deleted_at = datetime.utcnow()
    db.session.commit()
    return success_response(message='Prescription deleted')


@doctor_bp.route('/prescriptions/<prescription_id>/revise', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def revise_prescription(prescription_id):
    """
    Revise a completed (active) prescription.
    Creates a NEW prescription as a revision; the old one gets status=REVISED
    but is NOT deleted. Both old and new remain visible to the doctor.
    """
    from app.models import Prescription, PrescriptionMedicine, PrescriptionStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    original = Prescription.query.filter_by(
        tenant_id=doctor.tenant_id,
        id=prescription_id, doctor_id=doctor.id, is_deleted=False,
    ).first()
    if not original:
        return error_response('Prescription not found', status_code=404)
    if original.status not in (PrescriptionStatus.ACTIVE, PrescriptionStatus.REVISED):
        return error_response('Only completed prescriptions can be revised', status_code=400)

    data = request.get_json() or {}

    # Calculate revision number
    rev_num = (original.revision_number or 1) + 1
    # If original is itself a revision, find the root
    root_id = original.parent_prescription_id or original.id

    # Build medicines for the new revision
    med_errors = []
    med_rows = []
    for i, med_data in enumerate(data.get('medicines', []), start=1):
        row, err = _build_medicine_row(med_data, i, doctor.tenant_id)
        if err:
            med_errors.append(err)
            continue
        med_rows.append(row)

    if med_errors:
        return error_response('Validation errors in medicines', status_code=400, data=med_errors)

    # Create the new revision prescription
    revised = Prescription(
        tenant_id=doctor.tenant_id,
        appointment_id=original.appointment_id,
        patient_id=original.patient_id,
        doctor_id=doctor.id,
        parent_prescription_id=root_id,
        revision_number=rev_num,
        diagnosis=data.get('diagnosis', original.diagnosis),
        notes=data.get('notes', original.notes),
        allergies=data.get('allergies', original.allergies),
        diagnostic_tests=data.get('diagnostic_tests', original.diagnostic_tests),
        instructions=data.get('instructions', original.instructions),
        previous_medical_history=data.get('previous_medical_history', original.previous_medical_history),
        doctors_advice=data.get('doctors_advice', original.doctors_advice),
        follow_up=data.get('follow_up', original.follow_up),
        status=PrescriptionStatus.ACTIVE,
    )
    db.session.add(revised)
    db.session.flush()  # Get revised.id

    for row in med_rows:
        row.prescription_id = revised.id
        db.session.add(row)

    # Mark the original as REVISED (not deleted)
    original.status = PrescriptionStatus.REVISED

    db.session.commit()
    return success_response(
        message=f'Prescription revised (v{rev_num})',
        data=revised.to_dict(include_patient=True),
    )


@doctor_bp.route('/prescriptions/<prescription_id>/follow-up', methods=['POST'])
@jwt_required()
@feature_required('doctor.follow_up')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def initiate_follow_up(prescription_id):
    """
    Doctor initiates a follow-up from a prescription.

    Body:
        type: "free" | "paid_patient_picks" | "paid_doctor_picks"
        consultation_type: "video" | "audio" | "chat" | "complete" | "home_visit"
        time_slot_id: UUID (required for free + paid_doctor_picks)
        suggested_date: "YYYY-MM-DD" (required for paid_patient_picks)
        reservation_hours: int (optional, default 48, for paid_doctor_picks)
    """
    from app.api.common.follow_up.service import FollowUpService

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    data = request.get_json() or {}
    follow_up_type = data.get('type', '').strip().lower()
    consultation_type = data.get('consultation_type', '').strip().lower()
    time_slot_id = data.get('time_slot_id')
    suggested_date_str = data.get('suggested_date')
    reservation_hours = data.get('reservation_hours', 48)

    if not follow_up_type:
        return validation_error_response({'type': 'Follow-up type is required'})
    if not consultation_type:
        return validation_error_response({'consultation_type': 'Consultation type is required'})

    try:
        if follow_up_type == 'free':
            if not time_slot_id:
                return validation_error_response({'time_slot_id': 'Time slot is required for free follow-up'})
            appointment = FollowUpService.create_free_follow_up(
                doctor_id=doctor.id,
                prescription_id=prescription_id,
                time_slot_id=time_slot_id,
                consultation_type_str=consultation_type,
            )
            return success_response(
                message='Free follow-up appointment created',
                data={'appointment': appointment.to_dict(include_relations=True)},
                status_code=201,
            )

        elif follow_up_type == 'paid_patient_picks':
            if not suggested_date_str:
                return validation_error_response({'suggested_date': 'Suggested date is required'})
            from datetime import datetime as dt_cls
            try:
                suggested_date = dt_cls.strptime(suggested_date_str, '%Y-%m-%d').date()
            except ValueError:
                return validation_error_response({'suggested_date': 'Invalid date format. Use YYYY-MM-DD'})

            invite = FollowUpService.create_paid_patient_picks(
                doctor_id=doctor.id,
                prescription_id=prescription_id,
                consultation_type_str=consultation_type,
                suggested_date=suggested_date,
            )
            return success_response(
                message='Follow-up invite sent to patient',
                data={'invite': invite.to_dict()},
                status_code=201,
            )

        elif follow_up_type == 'paid_doctor_picks':
            if not time_slot_id:
                return validation_error_response({'time_slot_id': 'Time slot is required'})
            invite = FollowUpService.create_paid_doctor_picks(
                doctor_id=doctor.id,
                prescription_id=prescription_id,
                time_slot_id=time_slot_id,
                consultation_type_str=consultation_type,
                reservation_hours=reservation_hours,
            )
            return success_response(
                message='Follow-up invite sent. Slot reserved for patient.',
                data={'invite': invite.to_dict()},
                status_code=201,
            )

        else:
            return validation_error_response({'type': 'Must be one of: free, paid_patient_picks, paid_doctor_picks'})

    except ValueError as e:
        return error_response(str(e), status_code=400)
    except PermissionError as e:
        return error_response(str(e), status_code=403)


@doctor_bp.route('/medicines/search', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def search_medicines():
    """
    Typeahead search for medicines while prescribing.
    ?q=para&limit=15
    """
    from app.models import Medicine

    q = (request.args.get('q') or request.args.get('search', '')).strip()
    limit = request.args.get('limit', 15, type=int)

    if len(q) < 2:
        return success_response(data={'medicines': []})

    like = f'%{q}%'
    results = Medicine.query.filter(
        Medicine.tenant_id == current_tenant_id_strict(),
        Medicine.is_active == True,
        db.or_(
            Medicine.generic_name.ilike(like),
            Medicine.name.ilike(like),
        ),
    ).order_by(Medicine.generic_name).limit(limit).all()

    return success_response(data={
        'medicines': [m.to_dict() for m in results],
    })


def _normalize_generic_name(name):
    """
    Normalize a generic medicine name for fuzzy banned-list matching.
    Strips case, hyphens, parentheses, spaces, dots, commas and other
    non-alphanumeric characters so that 'Para-cetamol', 'paracetamol',
    'Para Ceta Mol', 'para(cetamol)' all match.
    """
    import re
    if not name:
        return ''
    return re.sub(r'[^a-z0-9]', '', name.lower())


def _check_banned_exhaustive(generic_name):
    """
    Exhaustive banned-list check. Compares normalized forms of the input
    against every active banned entry. Returns the matched BannedMedicine
    or None.
    """
    from app.models import BannedMedicine
    if not generic_name:
        return None

    norm_input = _normalize_generic_name(generic_name)
    if not norm_input:
        return None

    # Fetch all active banned entries and compare normalized forms
    banned_entries = BannedMedicine.query.filter(
        BannedMedicine.tenant_id == current_tenant_id_strict(),
        BannedMedicine.is_active == True,
    ).all()

    for b in banned_entries:
        if _normalize_generic_name(b.generic_name) == norm_input:
            return b
        # Also check if input CONTAINS the banned formula or vice-versa
        norm_banned = _normalize_generic_name(b.generic_name)
        if norm_banned and (norm_banned in norm_input or norm_input in norm_banned):
            return b

    return None


@doctor_bp.route('/banned-check', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def check_banned():
    """
    Check if a generic name is banned. ?generic_name=xyz
    Uses exhaustive fuzzy matching: ignores case, hyphens, parentheses,
    spaces, and special chars. Also catches partial containment.
    """
    name = (request.args.get('generic_name') or '').strip()
    if not name:
        return success_response(data={'is_banned': False})

    banned = _check_banned_exhaustive(name)
    return success_response(data={
        'is_banned': banned is not None,
        'banned_name': banned.generic_name if banned else None,
        'reason': banned.reason if banned else None,
    })


# --- Placeholder routes (not needed for MVP) ---

@doctor_bp.route('/<doctor_id>/slots', methods=['GET'])
@jwt_required(optional=True)
def get_available_slots(doctor_id):
    """
    Get available appointment slots for a doctor on a given date.

    Query Parameters:
        - date: YYYY-MM-DD (required)
        - consultation_type: video|audio|chat|complete (optional filter)

    Returns list of slot objects:
        [{"start": "09:00", "end": "09:15", "duration": 15,
          "consultationTypes": ["video","audio"], "id": "uuid"}, ...]
    """
    date_str = request.args.get('date', '').strip()
    if not date_str:
        return error_response('date query parameter is required (YYYY-MM-DD)', status_code=400)

    consultation_type_filter = request.args.get('consultation_type', '').strip() or None

    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    # Per-slot approval: visibility is no longer gated on the doctor-wide
    # availability_approval_status. Only admin-approved slots reach patients —
    # DB TimeSlot rows are materialised solely from approved_day_overrides, and
    # the compute_slots fallback below reads the approved snapshots. A never-
    # approved doctor simply has empty approved snapshots → no slots.

    # ── Try DB-backed slots first (TimeSlot table) ──────────────────────
    from datetime import datetime as _dt
    try:
        _date = _dt.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return error_response('Invalid date format', status_code=400)

    from app.api.common.timeslot.service import TimeSlotService

    # Determine requesting patient ID for soft reservation visibility
    _requesting_patient_id = None
    if current_user and hasattr(current_user, 'role'):
        from app.models import Patient as _Patient
        if current_user.role == UserRole.PATIENT:
            _pat = _Patient.query.filter_by(
                tenant_id=current_tenant_id_strict(),
                user_id=current_user.id, is_deleted=False,
            ).first()
            if _pat:
                _requesting_patient_id = _pat.id

    # Check if ANY DB-backed slots exist for this date (unfiltered)
    all_db_slots = TimeSlotService.get_available_slots(
        doctor_id=doctor.id,
        date_val=_date,
        consultation_type=None,
        requesting_patient_id=_requesting_patient_id,
    )

    if all_db_slots:
        # DB slots exist — use DB as authoritative source.
        logger.info("[SLOTS] doctor=%s date=%s: found %d DB-backed slots", doctor_id, date_str, len(all_db_slots))
        # Apply consultation_type filter if requested.
        if consultation_type_filter:
            slots = TimeSlotService.get_available_slots(
                doctor_id=doctor.id,
                date_val=_date,
                consultation_type=consultation_type_filter,
                requesting_patient_id=_requesting_patient_id,
            )
        else:
            slots = all_db_slots
    else:
        # No DB slots — fallback to JSON-based compute_slots (backward compat)
        logger.info(
            "[SLOTS] doctor=%s date=%s: no DB slots, falling back to compute_slots "
            "(availability_config keys=%s, working_days keys=%s)",
            doctor_id, date_str,
            list((doctor.availability_config or {}).keys()),
            list((doctor.availability_config or {}).get('working_days', {}).keys()),
        )
        try:
            slots = DoctorService.compute_slots(
                date_str=date_str,
                availability_config=DoctorService.approved_availability_config(doctor),
                doctor_id=doctor.id
            )
            logger.info("[SLOTS] doctor=%s date=%s: compute_slots returned %d slots", doctor_id, date_str, len(slots))
            # Add default consultation_types for legacy slots
            for s in slots:
                if 'consultationTypes' not in s:
                    s['consultationTypes'] = s.get('consultation_types', ['complete'])
            # Apply consultation_type filter for legacy slots too
            if consultation_type_filter:
                slots = [s for s in slots
                         if consultation_type_filter in s.get('consultationTypes', s.get('consultation_types', ['complete']))]
        except Exception as e:
            logger.error(f"[SLOTS] compute_slots error for doctor={doctor_id} date={date_str}: {e}", exc_info=True)
            return error_response('An internal error occurred', status_code=500)

    # Compute booked start times for the response
    from app.models import Appointment, AppointmentStatus
    booked_starts = []
    pending_starts = []

    try:
        active_statuses = [
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.PENDING,
            AppointmentStatus.IN_PROGRESS,
        ]
        try:
            active_statuses.append(AppointmentStatus.PENDING_PAYMENT)
        except AttributeError:
            pass

        appts = Appointment.query.filter(
            Appointment.tenant_id == doctor.tenant_id,
            Appointment.doctor_id == doctor.id,
            Appointment.appointment_date == _date,
            Appointment.status.in_(active_statuses),
            Appointment.is_deleted == False,
        ).all()
        for a in appts:
            t_str = a.start_time.strftime('%H:%M') if a.start_time else None
            if t_str:
                booked_starts.append(t_str)
    except Exception as e:
        logger.warning(f"[SLOTS] Could not load booked slots for doctor={doctor_id} date={date_str}: {e}")

    # ── Apply slot-visibility gap filter ────────────────────────────────────
    # Only enforce when the doctor's slot_visibility_approved_gap has been approved.
    approved_gap = doctor.slot_visibility_approved_gap or {}
    if approved_gap:
        from datetime import datetime as _dt2, timezone as _tz
        now_local = _dt2.now(_tz.utc)

        def _slot_still_visible(slot):
            ct = (slot.get('consultation_type') or
                  (slot.get('consultation_types') or slot.get('consultationTypes') or ['complete'])[0])
            gap_minutes = approved_gap.get(ct, approved_gap.get('default', 0))
            if not gap_minutes:
                return True
            slot_start_str = slot.get('start') or slot.get('start_time')
            if not slot_start_str:
                return True
            try:
                slot_dt = _dt2.combine(_date, _dt2.strptime(slot_start_str[:5], '%H:%M').time())
                from datetime import timedelta
                cutoff = slot_dt - timedelta(minutes=gap_minutes)
                # compare naively (server local)
                return _dt2.now() <= cutoff
            except Exception:
                return True

        slots = [s for s in slots if _slot_still_visible(s)]

    # Return pricing filtered to the requested consultation type. This is the
    # list the booking dialog prices a slot from, so it carries the admin
    # display-pricing overlay — the quote here and the amount the appointment
    # is created with come from the same numbers.
    from app.common.display_pricing import decorate_tiers
    all_pricing = decorate_tiers(doctor.id, doctor.slot_pricing)
    if consultation_type_filter and isinstance(all_pricing, list):
        filtered_pricing = [
            p for p in all_pricing
            if p.get('consultation_type', 'complete') == consultation_type_filter
        ]
    else:
        filtered_pricing = all_pricing

    return success_response(data={
        'slots': slots,
        'slot_pricing': filtered_pricing,
        'approved': True,
        'booked_slots': booked_starts,
        'pending_slots': pending_starts,
    })



@doctor_bp.route('/<doctor_id>/slot-summary', methods=['GET'])
def get_slot_summary(doctor_id):
    """
    Return available slot counts per day for a given month.

    Query Parameters:
        - month: YYYY-MM  (required)

    Response:
        {
          "dates": {
            "2026-02-23": 14,
            "2026-02-24": 3,
            "2026-02-25": 0,
            ...
          },
          "approved": true
        }

    Slot count reflects AVAILABLE slots (total generated minus already-booked/confirmed/in-progress).
    Days not in the doctor's working schedule are omitted from the response.
    """
    from calendar import monthrange
    from datetime import date as _date_type

    month_str = request.args.get('month', '').strip()
    if not month_str:
        return error_response('month query parameter is required (YYYY-MM)', status_code=400)

    try:
        year, month = [int(x) for x in month_str.split('-')]
    except (ValueError, AttributeError):
        return error_response('Invalid month format. Use YYYY-MM', status_code=400)

    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    # Per-slot approval: no doctor-wide gate. Approved snapshots drive the
    # counts (DB TimeSlots are approved-only; compute_slots fallback uses the
    # approved config). Never-approved doctors yield empty counts naturally.
    consultation_type_filter = request.args.get('consultation_type', '').strip() or None

    # ── Try DB-backed summary first (TimeSlot table) ──────────────────────
    from app.api.common.timeslot.service import TimeSlotService
    # Check if ANY DB slots exist this month (unfiltered)
    all_db_summary = TimeSlotService.get_slot_summary(doctor.id, year, month)

    if all_db_summary:
        # DB slots exist — use DB as authoritative source, apply filter if set
        if consultation_type_filter:
            db_summary = TimeSlotService.get_slot_summary(
                doctor.id, year, month,
                consultation_type=consultation_type_filter,
            )
        else:
            db_summary = all_db_summary
        return success_response(data={'dates': db_summary, 'approved': True})

    # ── Fallback to JSON-based compute_slots (backward compat) ────────────
    config = DoctorService.approved_availability_config(doctor)
    _, days_in_month = monthrange(year, month)
    today = _date_type.today()

    dates_summary = {}
    for day in range(1, days_in_month + 1):
        d = _date_type(year, month, day)
        if d < today:
            continue

        date_str = d.strftime('%Y-%m-%d')
        slots = DoctorService.compute_slots(
            date_str=date_str,
            availability_config=config,
            doctor_id=doctor.id,
        )
        if slots:
            # If consultation_type filter is set, filter legacy slots client-side
            if consultation_type_filter:
                slots = [s for s in slots
                         if consultation_type_filter in s.get('consultationTypes', s.get('consultation_types', ['complete']))]
            if slots:
                dates_summary[date_str] = len(slots)

    return success_response(data={'dates': dates_summary, 'approved': True})


@doctor_bp.route('/<doctor_id>/available-consultation-types', methods=['GET'])
def get_available_consultation_types(doctor_id):
    """
    Return the consultation types that currently have bookable slots.

    Powers the patient "Choose Consultation Type" screen, which only shows
    types with real availability (and skips straight to the calendar when a
    single type is bookable).

    Response:
        { "types": ["audio", "video"], "approved": true }
    """
    doctor = DoctorService.get_by_id(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    from app.models import AvailabilityApprovalStatus, SCHEDULABLE_CONSULTATION_TYPES

    # Schedulable (slot-based) types are only bookable once the doctor's
    # availability schedule is approved.
    approved = doctor.availability_approval_status == AvailabilityApprovalStatus.APPROVED
    types = []
    if approved:
        from app.api.common.timeslot.service import TimeSlotService
        slot_types = TimeSlotService.get_available_consultation_types(doctor.id)
        # ``None`` = legacy doctor with no materialized TimeSlot rows —
        # don't hide the whole screen, fall back to every schedulable type.
        types = list(SCHEDULABLE_CONSULTATION_TYPES) if slot_types is None else slot_types

    # Marketplace is a status-only (non-schedulable) offering — independent
    # of the slot schedule. It shows only when an admin has activated it for
    # this doctor (publish_status_by_type['marketplace'] == 'active'),
    # mirroring the patient doctor-list visibility rule.
    psbt = doctor.publish_status_by_type or {}
    if str(psbt.get('marketplace', '')).lower() == 'active':
        types.append('marketplace')

    return success_response(data={'types': types, 'approved': approved})


@doctor_bp.route('/profile/contact/send-otp', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def doctor_contact_send_otp():
    """Send an OTP to the doctor's NEW phone/email. The change is NOT applied
    here — after verification it goes to the admin approval queue.

    Body: ``channel`` ('phone' | 'email'), ``value`` (the new contact)."""
    from app.services.contact_change_service import ContactChangeService
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    channel = (data.get('channel') or '').strip().lower()
    value = data.get('value')
    if channel not in ('phone', 'email') or not value:
        return error_response('channel ("phone" | "email") and value are required')
    try:
        ContactChangeService.send_otp(current_user, channel, value)
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(message=f'A verification code was sent to {value}.')


@doctor_bp.route('/profile/contact/verify', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def doctor_contact_verify():
    """Verify the OTP, then SUBMIT the new phone/email to the admin approval
    queue (section 'contact'). It only takes effect once an admin approves.

    Body: ``channel`` ('phone' | 'email'), ``value``, ``otp``."""
    from app.services.contact_change_service import ContactChangeService
    from app.api.field_approval.service import FieldApprovalService
    from app.models import FieldApprovalStatus

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    channel = (data.get('channel') or '').strip().lower()
    value = data.get('value')
    otp = data.get('otp')
    if channel not in ('phone', 'email') or not value or not otp:
        return error_response('channel, value and otp are required')

    if not ContactChangeService.verify_otp(channel, value, otp):
        return error_response('Invalid or expired OTP', status_code=400)
    try:
        ContactChangeService.assert_unique(current_user, channel, value)
    except ValueError as e:
        return error_response(str(e), status_code=400)

    field_name = 'phone_number' if channel == 'phone' else 'email'
    normalized = ContactChangeService.normalize(channel, value)
    requests_created = FieldApprovalService.submit_changes(
        submitted_by_id=current_user.id,
        entity_type='doctor',
        entity_id=str(doctor.id),
        section='contact',
        changes={field_name: normalized},
    )
    if not requests_created:
        return error_response('This is already your current value.', status_code=400)
    # A super-admin acting on behalf is the approver, so their request comes
    # back already applied; the doctor's own request stays PENDING.
    applied = all(r.status == FieldApprovalStatus.APPROVED for r in requests_created)
    label = 'phone number' if channel == 'phone' else 'email'
    return success_response(
        data={'pending': not applied},
        message=(f'Your {label} was updated.' if applied
                 else f'Your new {label} was verified and sent to the admin for approval.'),
    )


@doctor_bp.route('/profile', methods=['PUT'])
@jwt_required()
@feature_required('doctor.profile')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_profile():
    """Update current doctor's profile — submits changes for approval."""
    try:
        data = request.get_json() or {}
        doctor = acting_doctor()
        if not doctor:
            return error_response('Doctor profile not found', status_code=404)

        # Route through field approval workflow
        from app.api.field_approval.service import FieldApprovalService

        allowed_fields = [
            'first_name', 'middle_name', 'last_name', 'gender', 'dob',
            'profile_image', 'experience_years', 'consultation_fee',
            'about', 'signature_image', 'accepting_appointments',
            'languages_known', 'slot_pricing'
        ]
        changes = {}
        for field in allowed_fields:
            if field in data:
                value = data[field]
                if value == '':
                    value = None
                changes[field] = value

        if changes:
            requests_created = FieldApprovalService.submit_changes(
                submitted_by_id=current_user.id,
                entity_type='doctor',
                entity_id=str(doctor.id),
                section='personal_details',
                changes=changes,
            )
            # A super-admin editing from Operations is the approver, so their
            # requests come back already reviewed and applied — don't tell them
            # the change is waiting on someone.
            from app.models import FieldApprovalStatus
            pending = [
                r for r in requests_created
                if r.status != FieldApprovalStatus.APPROVED
            ]
            return success_response(
                message=(
                    f'{len(requests_created)} field change(s) submitted for approval'
                    if pending else
                    f'{len(requests_created)} field change(s) applied'
                ),
                data={
                    'submitted': True,
                    'applied': not pending,
                    'pending_fields': [r.field_name for r in pending],
                    'doctor': doctor.to_dict(),
                }
            )
        else:
            return success_response(message='No changes detected', data=doctor.to_dict())
    except Exception as e:
        logger.error(f"[DOCTOR:UPDATE_PROFILE] Error: {str(e)}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/profile/extended', methods=['GET'])
@jwt_required()
@feature_required('doctor.profile')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_extended_profile():
    """
    GET /api/doctor/profile/extended
    Returns the extended profile fields stored directly on the Doctor record:
    documents (aadhar, pan), female health data, addresses, and extra contact info.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    female_raw = doctor.female_health_details or {}
    data = {
        # Personal extras (match Redux formData keys)
        'alternate_phone_number': doctor.alternative_phone or '',
        'alternate_email': doctor.alternative_email or '',
        'height': str(doctor.height) if doctor.height else '',
        'weight': str(doctor.weight) if doctor.weight else '',
        'category': doctor.category or '',
        'religion': doctor.religion or '',
        'citizenship': doctor.citizenship or '',
        'languages_known': doctor.languages_known or [],

        # Name-as-per-KYC (entered on the Documents section).
        'name_as_per_aadhaar': doctor.name_as_per_aadhaar or '',
        'name_as_per_pan': doctor.name_as_per_pan or '',

        # Registration + Certificate-of-Practice (COP) details.
        'registration_details': {
            'registration_name': doctor.registration_name or '',
            'registration_date': doctor.registration_date.isoformat() if doctor.registration_date else '',
            'registration_expiry': doctor.registration_expiry.isoformat() if doctor.registration_expiry else '',
            'registration_board': doctor.registration_board or '',
            'registration_state': doctor.registration_state or '',
            'cop_number': doctor.cop_number or '',
            'cop_name': doctor.cop_name or '',
            'cop_date': doctor.cop_date.isoformat() if doctor.cop_date else '',
            'cop_expiry': doctor.cop_expiry.isoformat() if doctor.cop_expiry else '',
            'cop_board': doctor.cop_board or '',
            'cop_state': doctor.cop_state or '',
            # Certificate attachments + their admin-verification state.
            'registration_certificate': doctor.registration_certificate or '',
            'has_registration_certificate': bool(doctor.registration_certificate),
            'registration_certificate_verification_status': (
                doctor.registration_certificate_verification_status.value
                if doctor.registration_certificate_verification_status else 'PENDING'
            ),
            'cop_attachment': doctor.cop_attachment or '',
            'has_cop_attachment': bool(doctor.cop_attachment),
            'cop_attachment_verification_status': (
                doctor.cop_attachment_verification_status.value
                if doctor.cop_attachment_verification_status else 'PENDING'
            ),
        },

        # Documents — nested under 'documents' key so populateFormFromProfile can read it
        'documents': {
            'aadhar_number': doctor.aadhar_number or '',
            'aadhar_attachment': doctor.aadhar_attachment or '',
            'pan_number': doctor.pan_number or '',
            'pan_attachment': doctor.pan_attachment or '',
            'registration_certificate': doctor.registration_certificate or '',
            'cop_attachment': doctor.cop_attachment or '',
        },

        # Female data — nested under 'female_data' key so populateFormFromProfile can read it
        'female_data': {
            'LMP_calender': female_raw.get('LMP_calender', ''),
            'LMP_remarks': female_raw.get('LMP_remarks', ''),
            'pregnancy_status': female_raw.get('pregnancy_status', ''),
            'pregnancy_status_remarks': female_raw.get('pregnancy_status_remarks', ''),
        },

        # Addresses — populateFormFromProfile spreads these directly
        'communication_address': doctor.communication_address or {},
        'permanent_address': doctor.permanent_address or {},
    }

    return success_response(data=data)

@doctor_bp.route('/profile/documents/presign', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def presign_document():
    """
    GET /api/doctor/profile/documents/presign?field=<field_name>
    Returns a URL that can be used to preview a private document.

    - Old local-disk documents (stored as 'uploads/...' paths):
        Returns full backend URL so the browser hits Flask at :5001/uploads/...
    - New S3 documents (stored as S3 keys starting with 'page-config/'):
        Generates a presigned S3 URL valid for 15 minutes.
    """
    from flask import request as _req, current_app
    from app.services.s3_service import S3Service

    # Whitelist of allowed document fields to prevent arbitrary S3 key fishing
    ALLOWED_FIELDS = {
        'aadhar_attachment',
        'pan_attachment',
        'comm_address_id_proof_attachment',
        'perm_address_id_proof_attachment',
        'graduation_certificate',
        'graduation_marksheet',
        'post_graduation_certificate',
        'post_graduation_marksheet',
        'super_speciality_certificate',
        'super_speciality_marksheet',
        'other_certification_certificate',
        'other_certification_marksheet',
        'registration_certificate',
        'cop_attachment',
    }

    field = _req.args.get('field', '').strip()
    if field not in ALLOWED_FIELDS:
        return error_response(f"Unknown document field: '{field}'", status_code=400)

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    # Resolve the stored value for the requested field
    if field == 'aadhar_attachment':
        stored = doctor.aadhar_attachment
    elif field == 'pan_attachment':
        stored = doctor.pan_attachment
    elif field == 'registration_certificate':
        stored = doctor.registration_certificate
    elif field == 'cop_attachment':
        stored = doctor.cop_attachment
    elif field == 'comm_address_id_proof_attachment':
        stored = (doctor.communication_address or {}).get('address_id_proof_attachment')
    elif field == 'perm_address_id_proof_attachment':
        stored = (doctor.permanent_address or {}).get('address_id_proof_attachment')
    else:
        stored = None

    if not stored:
        return error_response('No document uploaded for this field', status_code=404)

    # ── Case 1: S3 key (stored by new upload_file flow) ──────────────────
    if stored.startswith('doctors/documents/') or stored.startswith('page-config/'):
        try:
            bucket = current_app.config.get('AWS_S3_PRIVATE_BUCKET', '')
            presigned = S3Service.generate_presigned_url(bucket, stored, expiration=900)
            if not presigned:
                return error_response('Could not generate presigned URL', status_code=500)
            return success_response(data={'url': presigned, 'expires_in': 900})
        except Exception as e:
            logger.error(f"[PRESIGN] S3 error for field={field}: {e}", exc_info=True)
            return error_response('An internal error occurred', status_code=500)

    # ── Case 2: Local uploads path (legacy disk storage) ─────────────────
    # Normalise: strip leading slash or 'uploads/'
    local_path = stored.lstrip('/')
    if not local_path.startswith('uploads/'):
        local_path = f'uploads/{local_path}'

    # Build absolute URL pointing to Flask backend (not Vite frontend)
    from flask import request as flask_req
    backend_origin = f"{flask_req.scheme}://{flask_req.host}"  # e.g. http://localhost:5001
    url = f"{backend_origin}/{local_path}"
    return success_response(data={'url': url, 'expires_in': None})


@doctor_bp.route('/profile/extended', methods=['PUT'])
@jwt_required()
@feature_required('doctor.profile')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_extended_profile():
    """
    PUT /api/doctor/profile/extended
    Accepts multipart/form-data (to support file uploads for Aadhar/PAN proofs).
    All fields are optional — only present fields are updated.
    """
    import json as _json
    from app.extensions import db
    from app.services.s3_service import S3Service

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    form = request.form
    files = request.files

    try:
        # ── Personal extra fields ────────────────────────────────────────
        if 'alternate_phone_number' in form:
            doctor.alternative_phone = form.get('alternate_phone_number') or None
        if 'alternate_email' in form:
            doctor.alternative_email = form.get('alternate_email') or None
        if 'height' in form:
            val = form.get('height', '').strip()
            doctor.height = float(val) if val else None
        if 'weight' in form:
            val = form.get('weight', '').strip()
            doctor.weight = float(val) if val else None
        if 'category' in form:
            doctor.category = form.get('category') or None
        if 'religion' in form:
            doctor.religion = form.get('religion') or None
        if 'citizenship' in form:
            doctor.citizenship = form.get('citizenship') or None
        if 'languages_known' in form:
            try:
                doctor.languages_known = _json.loads(form.get('languages_known') or '[]')
            except Exception:
                pass

        # ── Document text fields ─────────────────────────────────────────
        if 'aadhar_number' in form:
            doctor.aadhar_number = form.get('aadhar_number') or doctor.aadhar_number
        if 'pan_number' in form:
            doctor.pan_number = form.get('pan_number') or None
        if 'name_as_per_aadhaar' in form:
            doctor.name_as_per_aadhaar = form.get('name_as_per_aadhaar') or None
        if 'name_as_per_pan' in form:
            doctor.name_as_per_pan = form.get('name_as_per_pan') or None

        # ── Registration + Certificate-of-Practice (COP) details ──────────
        for _k in ('registration_name', 'registration_board', 'registration_state',
                   'cop_number', 'cop_name', 'cop_board', 'cop_state'):
            if _k in form:
                setattr(doctor, _k, form.get(_k) or None)
        from datetime import datetime as _dt
        for _dk in ('registration_date', 'registration_expiry', 'cop_date', 'cop_expiry'):
            if _dk in form:
                _v = (form.get(_dk) or '').strip()
                try:
                    setattr(doctor, _dk, _dt.strptime(_v, '%Y-%m-%d').date() if _v else None)
                except ValueError:
                    pass

        # ── Document file uploads (S3) ──────────────────────────────────
        user_folder = str(current_user.id)  # e.g. doctors/documents/{user_id}/aadhar/

        if 'aadhar_attachment' in files:
            file_obj = files['aadhar_attachment']
            try:
                result = S3Service.upload_file(
                    file_obj, 'aadhar', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                doctor.aadhar_attachment = result.get('s3_key') or doctor.aadhar_attachment
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] aadhar upload failed: {e}")

        if 'pan_attachment' in files:
            file_obj = files['pan_attachment']
            try:
                result = S3Service.upload_file(
                    file_obj, 'pan', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                doctor.pan_attachment = result.get('s3_key') or doctor.pan_attachment
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] pan upload failed: {e}")

        # ── Registration certificate + COP attachment (S3) ────────────────
        # A fresh upload resets the doc to PENDING so an admin re-verifies it.
        from app.models import DocumentVerificationStatus as _DVS
        if 'registration_certificate' in files:
            file_obj = files['registration_certificate']
            try:
                result = S3Service.upload_file(
                    file_obj, 'registration_certificate', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                if result.get('s3_key'):
                    doctor.registration_certificate = result['s3_key']
                    doctor.registration_certificate_verification_status = _DVS.PENDING
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] registration cert upload failed: {e}")

        if 'cop_attachment' in files:
            file_obj = files['cop_attachment']
            try:
                result = S3Service.upload_file(
                    file_obj, 'cop', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                if result.get('s3_key'):
                    doctor.cop_attachment = result['s3_key']
                    doctor.cop_attachment_verification_status = _DVS.PENDING
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] cop upload failed: {e}")

        # ── Female health data ────────────────────────────────────────────
        female_fields = ['LMP_calender', 'LMP_remarks', 'pregnancy_status', 'pregnancy_status_remarks']
        female_updates = {f: form.get(f) for f in female_fields if f in form}
        if female_updates:
            current_female = dict(doctor.female_health_details or {})
            current_female.update({k: v for k, v in female_updates.items()})
            doctor.female_health_details = current_female

        # ── Communication address (comm_* keys) ──────────────────────────
        comm_updates = {
            k[len('comm_'):]: v
            for k, v in form.items()
            if k.startswith('comm_')
        }
        if comm_updates:
            current_comm = dict(doctor.communication_address or {})
            current_comm.update({k: v for k, v in comm_updates.items()})
            doctor.communication_address = current_comm

        # ── Communication address proof attachment (file upload) ──────────
        if 'comm_address_id_proof_attachment' in files:
            file_obj = files['comm_address_id_proof_attachment']
            try:
                result = S3Service.upload_file(
                    file_obj, 'address_proof', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                current_comm = dict(doctor.communication_address or {})
                current_comm['address_id_proof_attachment'] = result.get('s3_key') or current_comm.get('address_id_proof_attachment')
                doctor.communication_address = current_comm
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] comm address proof upload failed: {e}")

        # ── Permanent address (perm_* keys) ──────────────────────────────
        perm_updates = {
            k[len('perm_'):]: v
            for k, v in form.items()
            if k.startswith('perm_')
        }
        if perm_updates:
            current_perm = dict(doctor.permanent_address or {})
            current_perm.update({k: v for k, v in perm_updates.items()})
            doctor.permanent_address = current_perm

        # ── Permanent address proof attachment (file upload) ──────────────
        if 'perm_address_id_proof_attachment' in files:
            file_obj = files['perm_address_id_proof_attachment']
            try:
                result = S3Service.upload_file(
                    file_obj, 'address_proof', file_obj.filename,
                    is_private=True, folder=f'doctors/documents/{user_folder}'
                )
                current_perm = dict(doctor.permanent_address or {})
                current_perm['address_id_proof_attachment'] = result.get('s3_key') or current_perm.get('address_id_proof_attachment')
                doctor.permanent_address = current_perm
            except Exception as e:
                logger.warning(f"[EXTENDED_PROFILE] perm address proof upload failed: {e}")

        # Collect all changed fields for approval tracking
        from app.api.field_approval.service import FieldApprovalService
        extended_changes = {}
        for field_key in ['alternative_phone', 'alternative_email', 'height', 'weight',
                          'category', 'religion', 'citizenship', 'aadhar_number', 'pan_number']:
            if hasattr(doctor, field_key):
                val = getattr(doctor, field_key)
                extended_changes[field_key] = str(val) if val is not None else None

        # Submit approval requests for the changed fields
        if extended_changes:
            FieldApprovalService.submit_changes(
                submitted_by_id=current_user.id,
                entity_type='doctor',
                entity_id=str(doctor.id),
                section='extended_profile',
                changes=extended_changes,
            )

        from sqlalchemy.orm.attributes import flag_modified
        from sqlalchemy import inspect as sa_inspect
        loaded_attrs = sa_inspect(doctor).dict.keys()
        for attr in ('languages_known', 'female_health_details', 'communication_address', 'permanent_address'):
            if attr in loaded_attrs:
                flag_modified(doctor, attr)
        db.session.commit()

        logger.debug(f"[DOCTOR:EXTENDED_PROFILE] Updated extended profile for user={current_user.id}")
        return success_response(
            message='Extended profile changes submitted for approval',
            data={
                'submitted': True,
                'alternate_phone_number': doctor.alternative_phone,
                'alternate_email': doctor.alternative_email,
                'height': str(doctor.height) if doctor.height else '',
                'weight': str(doctor.weight) if doctor.weight else '',
                'category': doctor.category or '',
                'religion': doctor.religion or '',
                'citizenship': doctor.citizenship or '',
                'aadhar_number': doctor.aadhar_number or '',
                'aadhar_attachment': doctor.aadhar_attachment or '',
                'pan_number': doctor.pan_number or '',
                'pan_attachment': doctor.pan_attachment or '',
                'female_health_details': doctor.female_health_details or {},
                'communication_address': doctor.communication_address or {},
                'permanent_address': doctor.permanent_address or {},
            }
        )

    except Exception as e:
        db.session.rollback()
        logger.error(f"[DOCTOR:EXTENDED_PROFILE] Error: {e}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/qualifications', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_qualifications():
    """Get doctor's qualifications."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    return success_response(data={
        'degrees': [q.to_dict() for q in doctor.qualifications],
        'specializations': [s.to_dict() for s in doctor.specializations]
    })


@doctor_bp.route('/qualifications', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def add_qualification():
    """Add a qualification."""
    return error_response('Not implemented in MVP', status_code=501)


@doctor_bp.route('/services', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_my_services():
    """Get services offered by current doctor."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    return success_response(data={
        'services': [s.to_dict() for s in doctor.services]
    })


@doctor_bp.route('/services', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def add_service():
    """Add a new service."""
    return error_response('Not implemented in MVP', status_code=501)


def _doctor_specialization_ids(doctor):
    """Set of the doctor's specialization category ids (as strings) — Item 3C."""
    from app.models import ProfileEducationSpecialization
    rows = ProfileEducationSpecialization.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).all()
    return {str(r.category_id) for r in rows}


def _doctor_can_offer_product(product, spec_ids):
    """A doctor may offer a product if it has no specialization restriction, or
    the doctor holds one of the allowed specializations (Item 3C)."""
    allowed = getattr(product, 'allowed_specialization_ids', None)
    if not allowed:
        return True
    return bool(spec_ids & {str(a) for a in allowed})


@doctor_bp.route('/products', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def list_products_for_doctor():
    """List active admin-defined products the doctor can pick from.

    Returns the FULL active catalog (so the doctor always SEES what's on offer),
    each item annotated with ``eligible`` + ``ineligible_reason`` — the
    specialization gate (Item 3C) plus the degree / work-qualification /
    experience criteria. Previously this hard-filtered to eligible-only, so a
    doctor whose specialization didn't match any product saw an empty catalog
    with no explanation.
    """
    from app.models import DoctorProduct
    from app.api.admin.product_eligibility import check_product_eligibility
    tid = current_tenant_id_strict()
    doctor = acting_doctor()
    spec_ids = _doctor_specialization_ids(doctor) if doctor else set()
    products = DoctorProduct.query.filter_by(
        tenant_id=tid, is_deleted=False, is_active=True,
    ).order_by(DoctorProduct.name).all()
    rows = []
    for p in products:
        item = p.to_dict()
        # Specialization gate (the one the add endpoint enforces) first, then
        # the degree / qualification / experience criteria.
        if not _doctor_can_offer_product(p, spec_ids):
            item['eligible'] = False
            item['ineligible_reason'] = 'Your specialization is not among those allowed to offer this service.'
        elif doctor:
            ok, reason = check_product_eligibility(p, doctor.id, tid)
            item['eligible'] = ok
            item['ineligible_reason'] = reason
        else:
            item['eligible'] = True
            item['ineligible_reason'] = None
        rows.append(item)
    return success_response(data={'products': rows})


@doctor_bp.route('/products/<product_id>/features', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def product_linked_features(product_id):
    """Landing features an admin linked to this catalog product (Feature-Product
    Linking) — shown in the doctor-side service details view. Reuses the same
    resolver the patient booking flow uses."""
    from app.api.service_reciever.patient.routes import _resolve_offering_features
    tid = current_tenant_id_strict()
    feats = _resolve_offering_features(tid, product_id=product_id)
    return success_response(data={'features': feats})


@doctor_bp.route('/service-interest', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def my_service_interests():
    """The product ids the doctor has already registered interest in — so the
    catalog can show 'Interested' and avoid duplicate submissions."""
    from app.models import ServiceInterest
    tid = current_tenant_id_strict()
    doctor = DoctorService.get_by_user_id(current_user.id)
    if not doctor:
        return success_response(data={'interests': [], 'product_ids': []})
    rows = ServiceInterest.query.filter_by(tenant_id=tid, doctor_id=doctor.id).all()
    return success_response(data={
        'interests': [r.to_dict() for r in rows],
        'product_ids': [str(r.product_id) for r in rows],
    })


@doctor_bp.route('/service-interest', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def express_service_interest():
    """Register the doctor's INTEREST in a catalog service / group plan. Doctors
    don't create group offerings — an admin assigns the plan; this just records
    that they'd like to be considered. Idempotent per (doctor, product)."""
    from app.models import ServiceInterest, DoctorProduct
    from sqlalchemy.orm.attributes import flag_modified  # noqa: F401 (parity)
    tid = current_tenant_id_strict()
    doctor = DoctorService.get_by_user_id(current_user.id)
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    product_id = data.get('product_id')
    if not product_id:
        return error_response('product_id is required', status_code=400)
    product = DoctorProduct.query.filter_by(
        id=product_id, tenant_id=tid, is_deleted=False).first()
    if not product:
        return error_response('Service not found', status_code=404)
    row = ServiceInterest.query.filter_by(
        tenant_id=tid, doctor_id=doctor.id, product_id=product_id).first()
    if row is None:
        row = ServiceInterest(tenant_id=tid, doctor_id=doctor.id, product_id=product_id)
        db.session.add(row)
    row.note = (data.get('note') or '').strip() or None
    row.status = 'new'
    db.session.commit()
    return success_response(
        data=row.to_dict(),
        message='Interest registered — an admin will review and assign the plan.')


@doctor_bp.route('/appointments/<appointment_id>/product', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def add_appointment_product(appointment_id):
    """
    Attach a single product to an appointment.
    Only one product is allowed per appointment.

    Payload:
    {
        "product_id": "<uuid>",
        "doctor_price": 350,
        "doctor_description": "Standard medical certificate for employment"
    }
    """
    from app.api.common.appointment.service import AppointmentService
    from app.models import DoctorProduct, AppointmentProduct

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment or appointment.doctor_id != doctor.id:
        return error_response('Appointment not found or unauthorized', status_code=404)

    # Check if product already attached
    if appointment.appointment_product:
        return error_response(
            'This appointment already has a product. Use PUT to update it.',
            status_code=400
        )

    data = request.get_json() or {}
    product_id = data.get('product_id')
    doctor_price = data.get('doctor_price')
    doctor_description = data.get('doctor_description', '')

    if not product_id:
        return error_response('product_id is required', status_code=400)
    if doctor_price is None:
        return error_response('doctor_price is required', status_code=400)

    product = DoctorProduct.query.filter_by(
        tenant_id=doctor.tenant_id, id=product_id, is_deleted=False, is_active=True,
    ).first()
    if not product:
        return error_response('Product not found', status_code=404)

    # Validate price is within admin-defined range
    try:
        price = float(doctor_price)
    except (TypeError, ValueError):
        return error_response('doctor_price must be a number', status_code=400)

    if price < float(product.min_price) or price > float(product.max_price):
        return error_response(
            f'Price must be between {product.min_price} and {product.max_price}',
            status_code=400
        )

    ap = AppointmentProduct(
        tenant_id=appointment.tenant_id,
        appointment_id=appointment.id,
        product_id=product.id,
        doctor_price=price,
        doctor_description=doctor_description.strip() or None,
    )
    from app.extensions import db
    db.session.add(ap)
    db.session.commit()

    return success_response(message='Product added to appointment', data=ap.to_dict(), status_code=201)


@doctor_bp.route('/appointments/<appointment_id>/product', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_appointment_product(appointment_id):
    """
    Update the product attached to an appointment (price or description).

    Payload: {"doctor_price": 400, "doctor_description": "Updated notes"}
    """
    from app.api.common.appointment.service import AppointmentService
    from app.models import DoctorProduct

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment or appointment.doctor_id != doctor.id:
        return error_response('Appointment not found or unauthorized', status_code=404)

    ap = appointment.appointment_product
    if not ap:
        return error_response('No product attached to this appointment', status_code=404)

    data = request.get_json() or {}

    if 'doctor_price' in data:
        try:
            price = float(data['doctor_price'])
        except (TypeError, ValueError):
            return error_response('doctor_price must be a number', status_code=400)
        product = ap.product
        if price < float(product.min_price) or price > float(product.max_price):
            return error_response(
                f'Price must be between {product.min_price} and {product.max_price}',
                status_code=400
            )
        ap.doctor_price = price

    if 'doctor_description' in data:
        ap.doctor_description = data['doctor_description']

    from app.extensions import db
    db.session.commit()
    return success_response(message='Product updated', data=ap.to_dict())


@doctor_bp.route('/appointments/<appointment_id>/product/complete', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def complete_appointment_product(appointment_id):
    """Mark the product/service attached to an appointment as completed."""
    from app.api.common.appointment.service import AppointmentService
    from datetime import datetime, timezone

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    appointment = AppointmentService.get_by_id(appointment_id)
    if not appointment or appointment.doctor_id != doctor.id:
        return error_response('Appointment not found or unauthorized', status_code=404)

    ap = appointment.appointment_product
    if not ap:
        return error_response('No product attached to this appointment', status_code=404)

    if ap.is_completed:
        return error_response('Product already marked as completed', status_code=400)

    ap.is_completed = True
    ap.completed_at = datetime.now(timezone.utc)

    from app.extensions import db
    db.session.commit()
    return success_response(message='Product marked as completed', data=ap.to_dict())


@doctor_bp.route('/schedule', methods=['GET'])
@jwt_required()
@feature_required('doctor.calendar')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_schedule():
    """
    Get doctor's full availability config.

    Returns:
        availability_config, slot_pricing, approval_status, rejection_reason, timestamps
    """
    schedule = DoctorService.get_schedule(acting_doctor_user_id())
    if schedule is None:
        return error_response('Doctor profile not found', status_code=404)

    return success_response(data=schedule)


@doctor_bp.route('/schedule', methods=['PUT'])
@jwt_required()
@feature_required('doctor.calendar')
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_schedule():
    """
    Update doctor's availability config and/or slot pricing.

    Payload (all optional, send only what you want to change):
    {
        "availability_config": {
            "slot_size": 15,
            "slot_gap": 5,
            "start_ceiling": 5,
            "working_days": {"Monday": [{"start": "09:00", "end": "17:00"}]},
            "exceptions": {"2026-03-01": "blocked"}
        },
        "slot_pricing": [
            {"label": "Regular", "duration": 15, "fee": 500}
        ]
    }

    Saving availability_config automatically sets approval_status to 'pending'.
    """
    data = request.get_json() or {}
    try:
        updated = DoctorService.update_schedule(acting_doctor_user_id(), data)
    except ValueError as e:
        return error_response(str(e), status_code=400)

    if updated is None:
        return error_response('Doctor profile not found', status_code=404)

    # Check if service indicated no changes were made
    no_changes_msg = updated.pop('_message', None)
    no_changes = updated.pop('_no_changes', False)

    if no_changes:
        return success_response(
            message=no_changes_msg or 'No changes detected.',
            data=updated
        )

    # Report what actually happened. Saved from Operations by an admin senior
    # enough to approve it, the schedule is already live — telling them it's
    # awaiting an approval that already happened sends them to an empty queue.
    from app.models import AvailabilityApprovalStatus
    pending = (
        updated.get('availability_approval_status')
        != AvailabilityApprovalStatus.APPROVED.value
    )
    return success_response(
        message=('Schedule updated. Awaiting admin approval to go live.'
                 if pending else 'Schedule updated and approved — it is live.'),
        data=updated
    )


# ─────────────────────────────────────────────
#  Marketplace Management (Independent Products)
# ─────────────────────────────────────────────

@doctor_bp.route('/marketplace/my-products', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_my_marketplace_products():
    """List products this doctor has chosen to sell."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    products = DoctorService.get_marketplace_products(doctor.id)
    return success_response(data={'products': products})


@doctor_bp.route('/marketplace/my-products', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def select_marketplace_product():
    """Add or update a product in doctor's marketplace."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    data = request.get_json() or {}
    # Plan access control — the doctor's plan must grant ``service.offer`` once
    # it uses feature gating (a plan that never adopted the control is allowed).
    from app.api.common.payment.billing_service import plan_grants_offering
    if not plan_grants_offering(doctor, 'service.offer'):
        return error_response(
            'Your plan does not include offering marketplace services.',
            status_code=403,
        )
    # Specialization gate (Item 3C) — block adding a service the doctor's
    # specialization isn't allowed to offer.
    from app.models import DoctorProduct
    prod = DoctorProduct.query.filter_by(
        id=data.get('product_id'), tenant_id=doctor.tenant_id, is_deleted=False,
    ).first()
    if prod and not _doctor_can_offer_product(prod, _doctor_specialization_ids(doctor)):
        return error_response(
            'This service is restricted to specific specializations you do not hold.',
            status_code=403,
        )
    try:
        product = DoctorService.select_marketplace_product(doctor.id, data)
        return success_response(
            message='Product added to your marketplace',
            data=product.to_dict(),
            status_code=201
        )
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/marketplace/my-products/<mp_product_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_marketplace_product(mp_product_id):
    """Update price or status of a marketplace product."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    data = request.get_json() or {}
    try:
        product = DoctorService.update_marketplace_product(doctor.id, mp_product_id, data)
        if not product:
            return error_response('Product not found in your marketplace', status_code=404)
        
        return success_response(message='Product updated', data=product.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/marketplace/my-products/<mp_product_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def remove_marketplace_product(mp_product_id):
    """Remove a product from doctor's marketplace."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    
    if DoctorService.remove_marketplace_product(doctor.id, mp_product_id):
        return success_response(message='Product removed from your marketplace')
    else:
        return error_response('Product not found in your marketplace', status_code=404)


@doctor_bp.route('/marketplace/sales', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_marketplace_sales():
    """List products sold by this doctor to patients.

    Includes orders the doctor owns directly (doctor_id) AND orders placed
    against a group offering the doctor is a member of — so every co-doctor
    in a group sees the shared order.
    """
    from app.models import MarketplaceOrder, MarketplaceServiceGroupMember
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    member_group_ids = db.session.query(MarketplaceServiceGroupMember.group_id).filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).subquery()

    sales = MarketplaceOrder.query.filter(
        MarketplaceOrder.tenant_id == doctor.tenant_id,
        db.or_(
            MarketplaceOrder.doctor_id == doctor.id,
            MarketplaceOrder.group_id.in_(db.session.query(member_group_ids)),
        ),
    ).order_by(MarketplaceOrder.created_at.desc()).all()
    return success_response(data={'sales': [s.to_dict() for s in sales]})


# ─────────────────────────────────────────────
#  Signatures & About Endpoints
# ─────────────────────────────────────────────

ALLOWED_SIGNATURE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
ALLOWED_ABOUT_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx'}


def _allowed_file(filename, allowed_extensions):
    """Check if file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


@doctor_bp.route('/profile/signatures/presign', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def presign_signature():
    """
    GET /api/doctor/profile/signatures/presign?field=<signature1|signature2|digitalSignature>
    Returns a presigned/direct URL so the frontend can preview an uploaded signature.
    """
    from flask import request as _req, current_app
    from app.services.s3_service import S3Service

    ALLOWED_SIG_FIELDS = {'signature1', 'signature2', 'digitalSignature'}
    field = _req.args.get('field', '').strip()
    if field not in ALLOWED_SIG_FIELDS:
        return error_response(f"Unknown signature field: '{field}'", status_code=400)

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    sig_record = DoctorService.get_signatures(doctor.id)
    if not sig_record:
        return error_response('No signatures uploaded yet', status_code=404)

    field_map = {
        'signature1': sig_record.signature1_s3_key,
        'signature2': sig_record.signature2_s3_key,
        'digitalSignature': sig_record.digital_signature_s3_key,
    }
    stored = field_map.get(field)
    if not stored:
        return error_response('No file uploaded for this signature field', status_code=404)

    try:
        bucket = current_app.config.get('AWS_S3_PRIVATE_BUCKET', '')
        presigned = S3Service.generate_presigned_url(bucket, stored, expiration=900)
        if not presigned:
            return error_response('Could not generate presigned URL', status_code=500)
        return success_response(data={'url': presigned, 'expires_in': 900})
    except Exception as e:
        logger.error(f"[PRESIGN_SIG] S3 error for field={field}: {e}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/profile/about/presign', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def presign_about():
    """
    GET /api/doctor/profile/about/presign?field=<briefAboutAttachment|natureOfWorkAttachment|currentlyWorkingWithAttachment>
    Returns a presigned URL to preview an about-me attachment.
    """
    from flask import request as _req, current_app
    from app.services.s3_service import S3Service
    from app.models import ProfileAbout

    ALLOWED_ABOUT_FIELDS = {'briefAboutAttachment', 'natureOfWorkAttachment', 'currentlyWorkingWithAttachment'}
    field = _req.args.get('field', '').strip()
    if field not in ALLOWED_ABOUT_FIELDS:
        return error_response(f"Unknown about field: '{field}'", status_code=400)

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    about_record = ProfileAbout.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    if not about_record:
        return error_response('No about info uploaded yet', status_code=404)

    # Correct model attribute names
    field_map = {
        'briefAboutAttachment': about_record.brief_about_attachment_s3_key,
        'natureOfWorkAttachment': about_record.nature_of_work_attachment_s3_key,
        'currentlyWorkingWithAttachment': about_record.currently_working_with_attachment_s3_key,
    }
    stored = field_map.get(field)
    if not stored:
        return error_response('No file uploaded for this about field', status_code=404)

    try:
        bucket = current_app.config.get('AWS_S3_PRIVATE_BUCKET', '')
        presigned = S3Service.generate_presigned_url(bucket, stored, expiration=900)
        if not presigned:
            return error_response('Could not generate presigned URL', status_code=500)
        return success_response(data={'url': presigned, 'expires_in': 900})
    except Exception as e:
        logger.error(f"[PRESIGN_ABOUT] S3 error for field={field}: {e}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)



@doctor_bp.route('/profile/signatures', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_signatures():
    """Get current doctor's saved signatures."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    record = DoctorService.get_signatures(doctor.id)
    if not record:
        return success_response(data={})

    # Refresh presigned URLs
    record = DoctorService._refresh_signature_urls(record)
    return success_response(data=record.to_response_dict())


@doctor_bp.route('/profile/signatures', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def upload_signatures():
    """Upload doctor signature files (multipart/form-data)."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    files = request.files

    # Require at least one signature file
    sig_keys = ['signature1', 'signature2', 'digitalSignature']
    if not any(k in files for k in sig_keys):
        return error_response('At least one signature file is required', status_code=400)

    # Validate file types
    for field_name in ['signature1', 'signature2', 'digitalSignature']:
        if field_name in files:
            f = files[field_name]
            if not _allowed_file(f.filename, ALLOWED_SIGNATURE_EXTENSIONS):
                return error_response(
                    f'{field_name}: Invalid file type. Allowed: {", ".join(ALLOWED_SIGNATURE_EXTENSIONS)}',
                    status_code=400
                )

    try:
        record = DoctorService.save_signatures(doctor.id, current_user.id, files)
        return success_response(
            message='Signatures uploaded. Pending admin verification.',
            data=record.to_response_dict()
        )
    except Exception as e:
        logger.error(f"[DOCTOR:SIGNATURES] Upload error: {str(e)}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/profile/about', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_about():
    """Get current doctor's about info."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    record = DoctorService.get_about(doctor.id)
    data = {}
    if record:
        # Refresh presigned URLs
        record = DoctorService._refresh_about_urls(record)
        data = record.to_response_dict()
    # Work qualifications live on the profile_owner (multi), independent of
    # whether an About record exists — always surface for the multi-select.
    data['work_qualifications'] = DoctorService.get_work_qualifications(doctor.id)
    return success_response(data=data)


@doctor_bp.route('/profile/about', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_about():
    """Update doctor about info (multipart/form-data with text + optional attachments)."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    form_data = request.form
    files = request.files

    # Validate attachment file types
    for field_name in ['briefAboutAttachment', 'natureOfWorkAttachment', 'currentlyWorkingWithAttachment']:
        if field_name in files:
            f = files[field_name]
            if not _allowed_file(f.filename, ALLOWED_ABOUT_EXTENSIONS):
                return error_response(
                    f'{field_name}: Invalid file type. Allowed: {", ".join(ALLOWED_ABOUT_EXTENSIONS)}',
                    status_code=400
                )

    try:
        record, about_changes = DoctorService.save_about(doctor.id, current_user.id, form_data, files)
        # Raise a field-approval request per changed About field so the change
        # surfaces in the admin approval queue (section 'about_me'). Without
        # this the record is marked PENDING but the admin never sees it.
        from app.api.field_approval.service import FieldApprovalService
        FieldApprovalService.submit_about_changes(
            submitted_by_id=current_user.id,
            entity_id=doctor.id,
            changes=about_changes,
        )
        data = record.to_response_dict()
        # Mirror GET /profile/about: the MULTI work-qualifications live on the
        # profile_owner (not on ProfileAbout), so ``to_response_dict()`` omits
        # them. Without this the frontend's ``populateAboutFromProfile`` sees no
        # ``work_qualifications`` key and resets the just-saved selection to [],
        # making the update look like it didn't persist until a full reload.
        data['work_qualifications'] = DoctorService.get_work_qualifications(doctor.id)
        return success_response(
            message='About info updated. Pending admin verification.',
            data=data,
        )
    except ValueError as e:
        # Bad input (e.g. an unknown work qualification), not a server fault —
        # reporting it as 500 would hide a fixable mistake from the doctor.
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"[DOCTOR:ABOUT] Update error: {str(e)}", exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/marketplace/sales/<order_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_marketplace_order(order_id):
    """Update status or notes for a marketplace order."""
    from app.models import MarketplaceOrder
    from app.extensions import db
    
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
        
    order = MarketplaceOrder.query.filter_by(
        tenant_id=doctor.tenant_id, id=order_id, doctor_id=doctor.id,
    ).first()
    if not order:
        return error_response('Order not found', status_code=404)
        
    data = request.get_json() or {}

    if 'status' in data:
        # Lifecycle (matches the appointment flow): pending → paid (patient paid
        # at booking) → under_process (provider ACCEPTED — opens the channel) OR
        # rejected (provider declined) → completed. 'accepted'/'paid' kept for
        # back-compat.
        valid_statuses = ['pending', 'accepted', 'paid', 'under_process',
                          'completed', 'cancelled', 'rejected']
        new_status = data['status']
        if new_status in valid_statuses:
            was = order.status
            order.status = new_status
            # Accepting a paid order opens its communication channel(s).
            # Best-effort — a product without communication simply has no
            # channel, and it must never block the accept. Idempotent.
            if new_status == 'under_process' and was != 'under_process':
                _activate_order_channel(order)
            # Completing an order generates the doctor's payout ledger entry.
            if new_status == 'completed' and was != 'completed':
                _generate_order_payout(order)

    if 'doctor_notes' in data:
        order.doctor_notes = data['doctor_notes']

    db.session.commit()

    # Persist-first: the status change committed — tell the patient live.
    if 'status' in data:
        from app.common.notify import notify_order_event
        _ORDER_EVENTS = {'under_process': 'accepted', 'accepted': 'accepted',
                         'rejected': 'rejected', 'completed': 'completed'}
        if data['status'] in _ORDER_EVENTS and was != order.status:
            notify_order_event(order, _ORDER_EVENTS[data['status']])

    # Family-doctor second-opinion commission on a completed service order.
    if data.get('status') == 'completed':
        try:
            from app.api.family_doctor.credit_service import award_for_booking
            award_for_booking(
                order.tenant_id, order.patient_id, order.doctor_id,
                'order', order.id, label='Second opinion — service',
                amount=float(getattr(order, 'price_at_purchase', 0) or 0),
            )
            db.session.commit()
        except Exception:  # noqa: BLE001
            db.session.rollback()
    return success_response(message='Order updated', data=order.to_dict())


def _order_tds_rate(tenant_id):
    """Tenant TDS rate for service payouts (BillingConfig; default 10%)."""
    from app.models import BillingConfig
    cfg = BillingConfig.query.filter_by(tenant_id=tenant_id).first()
    try:
        return float(cfg.tds_rate) if cfg and cfg.tds_rate is not None else 10.0
    except (TypeError, ValueError):
        return 10.0


def _generate_order_payout(order):
    """Create the doctor's payout ledger entry/entries for a completed service order.

    One row per admin-set payout installment (or a single row when none), each
    taxed independently on its slice: the doctor's GST is shown but not withheld
    (they remit it), platform charges come from their plan, TDS is per
    doctor/plan. Idempotent (keyed on the order).
    """
    from app.models import (
        DoctorPayout, DoctorMarketplaceProduct, Doctor, BillingConfig,
    )
    from app.extensions import db
    from app.api.admin.payout import _generate_bill_number
    # ``compute_platform_charges`` is still needed (main moved service-order
    # commission onto the doctor's plan); ``resolve_tds_rate`` is not — TDS is
    # resolved inside compute_tax_breakdown, per-doctor override included.
    from app.api.common.payment.billing_service import (
        apply_hold, compute_platform_charges, charges_snapshot_for,
    )
    from app.common.tax import SERVICE_SCOPE, compute_tax_breakdown
    # Idempotent on the order (a service_order payout already exists).
    if DoctorPayout.query.filter_by(
        tenant_id=order.tenant_id, source_type='service_order', source_ref_id=order.id,
    ).first():
        return
    gross = float(order.price_at_purchase or 0)
    if gross <= 0:
        return
    from decimal import Decimal as _D
    doctor = Doctor.query.get(order.doctor_id)
    config = BillingConfig.query.filter_by(tenant_id=order.tenant_id).first() or BillingConfig()
    # The doctor's own listing price is their fee; ``price_at_purchase`` is
    # what the patient paid (the display-priced number), so the delta is the
    # platform's margin and is taxed as a separate supply. Tax on the doctor's
    # supply is admin-imposed on the base catalog product, not the listing —
    # ``product=`` makes that precedence explicit in app/common/tax.py, which
    # is where main's per-product rate logic now lives.
    listing = DoctorMarketplaceProduct.query.filter_by(
        tenant_id=order.tenant_id, doctor_id=order.doctor_id,
        product_id=order.product_id,
    ).first()
    doctor_fee = float(listing.doctor_price) if listing and listing.doctor_price else gross
    base_name = (order.product.name if order.product else 'Service order')

    # Admin-set payout schedule on the catalog item → release the doctor's fee
    # in installments, each matured after its own period. Each slice is taxed
    # INDEPENDENTLY on its own portion (its own row on the payout/bill), because:
    #   • GST is the doctor's own output tax — we don't collect it. It is shown
    #     on every slice but NOT withheld from the payout; the doctor remits it
    #     themselves (Indian tax). → platform_remits_doctor_gst=False.
    #   • Platform charges come from the doctor's plan (compute_platform_charges).
    #   • TDS is resolved per doctor/plan inside compute_tax_breakdown.
    # No schedule → a single implicit 100% settlement due now (unchanged path).
    from datetime import datetime, timezone, timedelta
    from app.models import PayoutStatus
    schedule = list(order.product.payout_installments) if order.product else []
    # A per-vendor override the admin set at listing approval wins over the
    # catalog product's schedule.
    vendor_insts = getattr(listing, 'payout_installments', None) if listing else None
    if vendor_insts:
        slices = []
        for i in vendor_insts:
            pct = i.get('payment_type') == 'percentage'
            fee_slice = (doctor_fee * float(i.get('percentage') or 0) / 100.0) if pct \
                else float(i.get('amount') or 0)
            slices.append((fee_slice, int(i.get('due_after_days') or 0), i.get('installment_no')))
    elif schedule:
        slices = [(inst.resolved_amount(doctor_fee), inst.due_after_days or 0,
                   inst.installment_no) for inst in schedule]
    else:
        slices = [(doctor_fee, 0, None)]
    n = len(slices)
    now = datetime.now(timezone.utc)

    made = 0
    for slice_fee, due_days, inst_no in slices:
        slice_fee = max(0.0, float(slice_fee))
        if slice_fee <= 0:
            continue
        # Proportional slice of the patient total so the platform margin (the
        # gross-vs-fee delta, a separate supply) is apportioned with the fee.
        slice_gross = gross * (slice_fee / doctor_fee) if doctor_fee > 0 else slice_fee
        c1, c2, c3 = compute_platform_charges(doctor, _D(str(slice_fee)))
        total_charges = float(c1 + c2 + c3)
        tax = compute_tax_breakdown(
            slice_fee, slice_gross, config=config, doctor=doctor,
            consultation_type=SERVICE_SCOPE, product=order.product,
            platform_charges=_D(str(total_charges)),
            platform_remits_doctor_gst=False,
        )
        gst = float(tax.doctor_gst_total)
        tds = float(tax.tds_amount)
        net = float(tax.net_to_doctor)
        label = base_name if inst_no is None else f'{base_name} (inst {inst_no}/{n})'
        payout = DoctorPayout(
            tenant_id=order.tenant_id, doctor_id=order.doctor_id,
            appointment_id=None, source_type='service_order', source_ref_id=order.id,
            source_label=label[:200], bill_number=_generate_bill_number(),
            appointment_amount=0, payment_amount=slice_gross, taxes_gst=gst,
            total_charges=total_charges, charge1_amount=c1, charge2_amount=c2, charge3_amount=c3,
            charges_snapshot=charges_snapshot_for(doctor, _D(str(slice_fee)), (c1, c2, c3)),
            tds_amount=tds, payout_amount=net, consultation_type='service',
        )
        apply_hold(payout, doctor)
        # Don't let an installment mature before its scheduled period.
        if due_days:
            due = now + timedelta(days=due_days)
            if payout.hold_until is None or payout.hold_until < due:
                payout.hold_until = due
                if due > now:
                    payout.status = PayoutStatus.ON_HOLD
        db.session.add(payout)
        made += 1
    logger.info('[MARKETPLACE] order %s completed → %s DoctorPayout(s)', order.id, made)


def _activate_order_channel(order):
    """Open the service communication channel(s) for an accepted order.

    Individual → one channel; group → group chat + a channel per doctor. Never
    raises: a product without communication just has no channel, and activation
    must not block the provider accepting the order.
    """
    try:
        from app.api.service_communication.service import (
            ActivationService, ServiceCommunicationError,
        )
        from app.models import MembershipVertical
        if order.group_id:
            ActivationService.activate_group(
                group_id=order.group_id, patient_id=order.patient_id,
                tenant_id=order.tenant_id, order_id=order.id,
            )
        else:
            ActivationService.activate(
                product_id=order.product_id, patient_id=order.patient_id,
                provider_type=MembershipVertical.DOCTOR,
                provider_id=order.doctor_id,
                tenant_id=order.tenant_id, order_id=order.id,
            )
        logger.info('[MARKETPLACE] order %s accepted → channel opened', order.id)
    except ServiceCommunicationError as e:
        logger.info('[MARKETPLACE] order %s accepted; no channel opened: %s',
                    order.id, getattr(e, 'message', e))
    except Exception as e:  # noqa: BLE001
        logger.exception('[MARKETPLACE] order %s accept activation error: %s',
                         order.id, e)


# ─────────────────────────────────────────────
#  Education Endpoints
# ─────────────────────────────────────────────

ALLOWED_EDUCATION_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png'}


@doctor_bp.route('/profile/education/dropdowns', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_education_dropdowns():
    """
    GET /api/doctor/profile/education/dropdowns
    Returns dropdown option lists for the Education Details form:
    ugDegrees, pgDegrees, superSpecialityDegrees, specializations, states,
    evaluationCriteria, universities.

    The data here is admin-curated reference data (tenant-scoped master
    tables + page-config-backed options) — NOT doctor-personal. Admins
    need to read it to render the Doctor Profile config editor's Live
    Preview tab. Without this gate widening, the platform-owner /
    super-admin preview 403s and the dropdowns appear empty, which the
    operator perceives as "colleges disappear after publish".
    SUPER_ADMIN and SUB_ADMIN are explicitly listed so the
    PLATFORM_OWNER role_required bypass kicks in.
    """
    data = DoctorService.get_education_dropdowns()
    return success_response(data=data)


@doctor_bp.route('/profile/education', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_education():
    """
    GET /api/doctor/profile/education
    Returns the doctor's saved education details for all 4 sections.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    record = DoctorService.get_education(doctor.id)
    if not record:
        return success_response(data={})

    # Refresh presigned S3 URLs before returning
    record = DoctorService._refresh_education_urls(record)
    return success_response(data=record.to_response_dict())


@doctor_bp.route('/profile/education', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def submit_education():
    """
    POST /api/doctor/profile/education
    Accepts multipart/form-data.

    Form fields (all optional — submit only what changed):
        graduation_data          (JSON string)
        post_graduation_data     (JSON string)
        super_speciality_data    (JSON string)
        other_certification_data (JSON string)

    File fields (all optional — PDF/JPEG/PNG only):
        graduation_certificate, graduation_marksheet
        post_graduation_certificate, post_graduation_marksheet
        super_speciality_certificate, super_speciality_marksheet
        other_certification_certificate, other_certification_marksheet
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    form_data = request.form
    files = request.files

    # Validate file types for all uploaded certificate/marksheet files
    for field_name in files:
        f = files[field_name]
        if f.filename and not _allowed_file(f.filename, ALLOWED_EDUCATION_EXTENSIONS):
            return error_response(
                f'{field_name}: Invalid file type. Allowed: {", ".join(ALLOWED_EDUCATION_EXTENSIONS)}',
                status_code=400
            )

    try:
        record, changed, changes = DoctorService.save_education(doctor.id, current_user.id, form_data, files)
        if not changed:
            # Nothing in the payload matched a known section/file field, so
            # nothing was saved. Fail loudly — silently returning success here
            # is what hid the frontend/backend field-name mismatch.
            logger.warning(
                f'[DOCTOR:EDUCATION] No recognised fields in submit; '
                f'form keys={list(form_data.keys())} file keys={list(files.keys())}'
            )
            return error_response(
                'No education details were supplied.', status_code=400
            )
        # Queue one field-approval request per changed sub-section so the edit
        # lands in the admin "Education Approvals" queue (the value is already
        # saved — Pattern B, like About Me).
        from app.api.field_approval.service import FieldApprovalService
        FieldApprovalService.submit_education_changes(
            current_user.id, doctor.id, changes,
        )
        return success_response(
            message='Education details saved. Pending admin verification.',
            data=record.to_response_dict()
        )
    except Exception as e:
        logger.error(f'[DOCTOR:EDUCATION] Save error: {str(e)}', exc_info=True)
        return error_response('An internal error occurred', status_code=500)


# ─────────────────────────────────────────────
# Bank Account Endpoints
# ─────────────────────────────────────────────

ALLOWED_BANK_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png'}


def _plan_consult_ceiling(doctor):
    """The plan's allowed consultation-type set (Item 2E ceiling), or None."""
    from app.api.common.payment.billing_service import resolve_active_plan
    plan = resolve_active_plan(doctor)
    if plan:
        oct_ = plan.billing_terms().get('offered_consultation_types')
        if oct_:
            return set(oct_)
    return None


@doctor_bp.route('/appointment-settings', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_appointment_settings():
    """Doctor's master appointments switch + offered consultation types (Item 3B),
    limited to the plan's allowed consultation types (Item 2E)."""
    from app.models import SCHEDULABLE_CONSULTATION_TYPES
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    from app.api.admin.tenant_settings import tenant_enabled_appointment_types
    ceiling = _plan_consult_ceiling(doctor)
    tenant_enabled = tenant_enabled_appointment_types(doctor.tenant_id)
    # Allowed = schedulable ∩ tenant-global switch ∩ plan ceiling.
    allowed = [t for t in SCHEDULABLE_CONSULTATION_TYPES
               if (ceiling is None or t in ceiling) and t in tenant_enabled]
    offered = doctor.offered_consultation_types
    offered_list = [t for t in (offered if offered is not None else allowed) if t in allowed]
    return success_response(data={
        'appointments_enabled': doctor.appointments_enabled,
        'offered_consultation_types': offered_list,
        # Ceiling-limited: the UI shows only these as selectable.
        'all_consultation_types': allowed,
        'plan_limited': ceiling is not None,
    })


@doctor_bp.route('/appointment-settings', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_appointment_settings():
    """Update the doctor's master appointments switch / offered consultation types."""
    from app.models import SCHEDULABLE_CONSULTATION_TYPES
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    if 'appointments_enabled' in data:
        doctor.appointments_enabled = bool(data['appointments_enabled'])
    if 'offered_consultation_types' in data:
        types = data['offered_consultation_types']
        if not isinstance(types, list):
            return error_response('offered_consultation_types must be a list', status_code=400)
        # Clamp to schedulable types, the tenant-global switch, and the plan ceiling.
        from app.api.admin.tenant_settings import tenant_enabled_appointment_types
        ceiling = _plan_consult_ceiling(doctor)
        tenant_enabled = tenant_enabled_appointment_types(doctor.tenant_id)
        doctor.offered_consultation_types = [
            t for t in types
            if t in SCHEDULABLE_CONSULTATION_TYPES
            and (ceiling is None or t in ceiling)
            and t in tenant_enabled
        ]
    db.session.commit()
    return success_response(
        data={
            'appointments_enabled': doctor.appointments_enabled,
            'offered_consultation_types': doctor.offered_consultation_types,
        },
        message='Appointment settings updated',
    )


@doctor_bp.route('/profile/bank-accounts', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_bank_accounts():
    """
    GET /api/doctor/profile/bank-accounts
    Returns all bank accounts for the current doctor.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    accounts = DoctorService.get_bank_accounts(doctor.id)
    return success_response(data={
        'accounts': [a.to_response_dict() for a in accounts]
    })


@doctor_bp.route('/profile/bank-accounts/<account_id>/confirm-penny-drop', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def confirm_bank_penny_drop(account_id):
    """Doctor confirms they received the ₹1 Cashfree penny drop → account
    VERIFIED (Phase B)."""
    from app.models import ProfileBankAccount
    from app.api.common.payment import beneficiary_service as bene
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    bank = ProfileBankAccount.query.filter_by(
        id=account_id, doctor_id=doctor.id, tenant_id=doctor.tenant_id,
    ).first()
    if not bank:
        return error_response('Bank account not found', status_code=404)
    try:
        bene.confirm_penny_drop(bank)
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=bank.to_response_dict(), message='Bank account verified')


@doctor_bp.route('/profile/bank-accounts', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def submit_bank_accounts():
    """
    POST /api/doctor/profile/bank-accounts
    Accepts multipart/form-data.

    Form fields:
        accounts (JSON string) — array of account objects

    File fields:
        account_{orderIndex}_passbook
        account_{orderIndex}_check_leaf
        account_{orderIndex}_bank_statement
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    accounts_json = request.form.get('accounts')
    if not accounts_json:
        return error_response('accounts field is required', status_code=400)

    files = request.files

    # Validate file types
    for field_name in files:
        f = files[field_name]
        if f.filename and not _allowed_file(f.filename, ALLOWED_BANK_EXTENSIONS):
            return error_response(
                f'{field_name}: Invalid file type. Allowed: {", ".join(ALLOWED_BANK_EXTENSIONS)}',
                status_code=400
            )

    try:
        accounts = DoctorService.save_bank_accounts(doctor.id, current_user.id, accounts_json, files)
        return success_response(
            message='Bank account details saved. Pending admin verification.',
            data={'accounts': [a.to_response_dict() for a in accounts]}
        )
    except Exception as e:
        logger.error(f'[DOCTOR:BANK] Save error: {str(e)}', exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/profile/bank-accounts/<account_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def delete_bank_account(account_id):
    """
    DELETE /api/doctor/profile/bank-accounts/<account_id>

    Removes one of the doctor's own accounts — any account, including the
    primary. Detaches the Cashfree beneficiary and keeps past payouts for
    audit. Refused (400) while a payout to this account is in flight.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    ok, msg = DoctorService.delete_bank_account(doctor.id, account_id)
    if not ok:
        return error_response(msg, status_code=400)
    return success_response(message=msg)


@doctor_bp.route('/profile/bank-accounts/<account_id>/suspend', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def suspend_bank_account(account_id):
    """
    POST /api/doctor/profile/bank-accounts/<account_id>/suspend

    Pauses payouts to this account: detaches the Cashfree beneficiary and
    resets verification. The account stays and can be re-verified with a
    fresh ₹1 penny drop. Refused (400) while a payout is in flight.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    ok, msg = DoctorService.suspend_bank_account(doctor.id, account_id)
    if not ok:
        return error_response(msg, status_code=400)
    return success_response(message=msg)


@doctor_bp.route('/profile/bank-accounts/presign', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def bank_account_presign():
    """
    GET /api/doctor/profile/bank-accounts/presign?accountId=<uuid>&field=<passbook|checkLeaf|bankStatement>
    Returns a presigned URL for previewing a bank account document.
    """
    from app.models import ProfileBankAccount
    from app.services.s3_service import S3Service

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    account_id = request.args.get('accountId')
    field = request.args.get('field')

    if not account_id or not field:
        return error_response('accountId and field are required', status_code=400)

    field_map = {
        'passbook': ('passbook_s3_bucket', 'passbook_s3_key'),
        'checkLeaf': ('check_leaf_s3_bucket', 'check_leaf_s3_key'),
        'bankStatement': ('bank_statement_s3_bucket', 'bank_statement_s3_key'),
    }
    if field not in field_map:
        return error_response(f'Invalid field: {field}', status_code=400)

    account = ProfileBankAccount.query.filter_by(
        tenant_id=doctor.tenant_id, id=account_id, doctor_id=doctor.id,
    ).first()
    if not account:
        return error_response('Bank account not found', status_code=404)

    bucket_attr, key_attr = field_map[field]
    bucket = getattr(account, bucket_attr, None)
    key = getattr(account, key_attr, None)
    if not bucket or not key:
        return error_response('No document found for this field', status_code=404)

    url = S3Service.generate_presigned_url(bucket, key)
    return success_response(data={'url': url})


# ─────────────────────────────────────────────
# Declaration & Documents Endpoints
# ─────────────────────────────────────────────

ALLOWED_DECLARATION_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'}


@doctor_bp.route('/profile/declarations', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_declarations():
    """
    GET /api/doctor/profile/declarations
    Returns merged declaration config + doctor's responses + self-declaration.
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    data = DoctorService.get_declarations(doctor.id)
    return success_response(data=data)


@doctor_bp.route('/profile/declarations', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def submit_declarations():
    """
    POST /api/doctor/profile/declarations
    Accepts multipart/form-data.

    Form fields:
        responses (JSON string) — array of { configId, answer, explanation }
        selfDeclaration (JSON string) — { termsAccepted, policiesAccepted }

    File fields:
        question_{configId}_attachment
        document_{configId}_file
    """
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    responses_json = request.form.get('responses', '[]')
    self_declaration_json = request.form.get('selfDeclaration', '{}')
    files = request.files

    # Validate file types
    for field_name in files:
        f = files[field_name]
        if f.filename and not _allowed_file(f.filename, ALLOWED_DECLARATION_EXTENSIONS):
            return error_response(
                f'{field_name}: Invalid file type. Allowed: {", ".join(ALLOWED_DECLARATION_EXTENSIONS)}',
                status_code=400
            )

    try:
        data = DoctorService.save_declarations(
            doctor.id, current_user.id, responses_json, self_declaration_json, files
        )
        return success_response(
            message='Declarations saved. Pending admin verification.',
            data=data
        )
    except Exception as e:
        logger.error(f'[DOCTOR:DECLARATION] Save error: {str(e)}', exc_info=True)
        return error_response('An internal error occurred', status_code=500)


@doctor_bp.route('/profile/declarations/presign', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def declaration_presign():
    """
    GET /api/doctor/profile/declarations/presign?type=<question|document>&configId=<uuid>
    Returns a presigned URL for previewing a declaration attachment or document.
    """
    from app.models import ProfileDeclarationResponse, ProfileDocument
    from app.services.s3_service import S3Service

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    doc_type = request.args.get('type')
    config_id = request.args.get('configId')

    if not doc_type or not config_id:
        return error_response('type and configId are required', status_code=400)

    if doc_type == 'question':
        record = ProfileDeclarationResponse.query.filter_by(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id, config_id=config_id,
        ).first()
        if not record or not record.attachment_s3_bucket or not record.attachment_s3_key:
            return error_response('No attachment found', status_code=404)
        url = S3Service.generate_presigned_url(record.attachment_s3_bucket, record.attachment_s3_key)
    elif doc_type == 'document':
        record = ProfileDocument.query.filter_by(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id, config_id=config_id,
        ).first()
        if not record or not record.file_s3_bucket or not record.file_s3_key:
            return error_response('No document found', status_code=404)
        url = S3Service.generate_presigned_url(record.file_s3_bucket, record.file_s3_key)
    else:
        return error_response(f'Invalid type: {doc_type}', status_code=400)

    return success_response(data={'url': url})


# =============================================================================
# Slot Visibility Window
# =============================================================================

@doctor_bp.route('/slot-visibility', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_slot_visibility():
    """Return current slot-visibility gap config and approval state."""
    data = DoctorService.get_slot_visibility(current_user.id)
    if not data:
        return error_response('Doctor not found', status_code=404)
    return success_response(data=data)


@doctor_bp.route('/slot-visibility', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_slot_visibility():
    """
    Submit a new per-type slot-visibility gap for admin approval.

    Body: { "gap_by_type": { "video": 10, "audio": 0, "chat": 5, ... } }
    """
    body = request.get_json(silent=True) or {}
    gap_by_type = body.get('gap_by_type')
    if not isinstance(gap_by_type, dict) or not gap_by_type:
        return error_response('gap_by_type dict is required', status_code=400)

    result, err = DoctorService.update_slot_visibility(current_user.id, gap_by_type)
    if err:
        return error_response(err, status_code=400)
    return success_response(data=result, message='Slot visibility submitted for admin approval')


@doctor_bp.route('/consultation-targeting', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_consultation_targeting():
    """Per-consultation-type audience targeting (Slot Visibility tab)."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    return success_response(data={
        'targeting_by_type': doctor.consultation_targeting or {},
    })


@doctor_bp.route('/consultation-targeting', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_consultation_targeting():
    """Replace the doctor's per-consultation-type targeting in ONE call.

    Body: { "targeting_by_type": { "video": {...}, "audio": {...} } } —
    the whole map at once (the UI batches per-type edits client-side).
    Each value uses the canonical ``clean_targeting`` shape; empty values
    drop the type. Config-only for now (no approval flow).
    """
    from sqlalchemy.orm.attributes import flag_modified
    from app.models import SCHEDULABLE_CONSULTATION_TYPES
    from app.api.admin.product_eligibility import (
        clean_targeting, EligibilityRuleError,
    )

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor not found', status_code=404)

    body = request.get_json(silent=True) or {}
    raw_map = body.get('targeting_by_type')
    if not isinstance(raw_map, dict):
        return error_response('targeting_by_type dict is required', status_code=400)

    cleaned = {}
    for ctype, cfg in raw_map.items():
        if ctype not in SCHEDULABLE_CONSULTATION_TYPES:
            return error_response(f"Unknown consultation type: '{ctype}'", status_code=400)
        try:
            c = clean_targeting(cfg)
        except EligibilityRuleError as e:
            return error_response(f'{ctype}: {e}', status_code=400)
        if c:
            cleaned[ctype] = c

    doctor.consultation_targeting = cleaned
    flag_modified(doctor, 'consultation_targeting')
    db.session.commit()
    return success_response(
        data={'targeting_by_type': cleaned},
        message='Consultation targeting saved',
    )


@doctor_bp.route('/product-categories', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def list_product_categories_for_doctor():
    """Active product categories — powers the targeting form's category
    dropdown on the provider side (the admin twin lives under
    /api/admin/products/product_category)."""
    from app.models import Product_Category
    rows = (Product_Category.query
            .filter_by(tenant_id=current_tenant_id_strict(), is_active=True)
            .order_by(Product_Category.name)
            .all())
    return success_response(data={
        'product_categories': [
            {'id': str(r.id), 'name': r.name, 'category_types': r.category_types or []}
            for r in rows
        ],
    })


@doctor_bp.route('/slot-visibility/<doctor_id>/approve', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def approve_slot_visibility(doctor_id):
    """Super admin approves a doctor's slot-visibility gap request."""
    result, err = DoctorService.approve_slot_visibility(doctor_id, current_user.id)
    if err:
        return error_response(err, status_code=400)
    return success_response(data=result, message='Slot visibility approved')


@doctor_bp.route('/slot-visibility/<doctor_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def reject_slot_visibility(doctor_id):
    """Super admin rejects a doctor's slot-visibility gap request."""
    body = request.get_json(silent=True) or {}
    reason = body.get('reason', '')
    result, err = DoctorService.reject_slot_visibility(doctor_id, current_user.id, reason)
    if err:
        return error_response(err, status_code=400)
    return success_response(data=result, message='Slot visibility rejected')


# =============================================================================
# Admin Request (Raise a Request to Admin)
# =============================================================================

@doctor_bp.route('/admin-requests', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def create_admin_request():
    """
    Doctor raises a request / complaint to admin.

    Body:
        consultation_type: str | null   — which type the request is about
        remarks:           str          — required
        attachments:       [str]        — optional file paths/URLs
    """
    body = request.get_json(silent=True) or {}
    remarks = body.get('remarks', '').strip()
    if not remarks:
        return error_response('remarks is required', status_code=400)

    req, err = DoctorService.create_admin_request(
        user_id=current_user.id,
        consultation_type=body.get('consultation_type'),
        remarks=remarks,
        attachment_paths=body.get('attachments', []),
    )
    if err:
        return error_response(err, status_code=400)
    return success_response(data=req.to_dict(), message='Request sent to admin'), 201


@doctor_bp.route('/admin-requests', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_admin_requests():
    """List admin requests raised by the current doctor."""
    status = request.args.get('status', '').strip() or None
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = DoctorService.get_admin_requests(
        user_id=current_user.id,
        status=status,
        page=page,
        per_page=per_page,
    )
    return success_response(data=result)


# =============================================================================
# Super Admin — Slot Visibility Pending List
# =============================================================================

@doctor_bp.route('/slot-visibility/pending', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def get_pending_slot_visibility_requests():
    """Super admin: list all doctors with pending slot visibility approval requests."""
    requests = DoctorService.get_pending_slot_visibility_requests()
    return success_response(data={'requests': requests})


# =============================================================================
# Super Admin — All Doctor Admin Requests
# =============================================================================

@doctor_bp.route('/admin-requests/all', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_all_admin_requests():
    """Super admin: list admin requests raised by all doctors."""
    status = request.args.get('status', '').strip() or None
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = DoctorService.get_all_admin_requests(status=status, page=page, per_page=per_page)
    return success_response(data=result)


@doctor_bp.route('/admin-requests/<request_id>/respond', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def respond_admin_request(request_id):
    """Super admin responds to a doctor admin request."""
    body = request.get_json(silent=True) or {}
    new_status = body.get('status', '').strip()
    admin_response = body.get('admin_response', '').strip()

    if not new_status:
        return error_response('status is required', status_code=400)

    req, err = DoctorService.respond_admin_request(
        request_id=request_id,
        new_status=new_status,
        admin_response=admin_response,
        reviewer_id=current_user.id,
    )
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, status_code=code)
    return success_response(data=req.to_dict(), message='Request updated')


# ==========================================================================
# DOCTOR TREATABLE SYMPTOMS
# ==========================================================================

@doctor_bp.route('/symptoms', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_doctor_symptoms():
    """Get symptoms the current doctor can treat."""
    from app.models import Doctor, DoctorSymptom
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    symptoms = [ds.to_dict() for ds in doctor.treatable_symptoms.all()]
    return success_response(data={'symptoms': symptoms})


@doctor_bp.route('/symptoms', methods=['PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def update_doctor_symptoms():
    """
    Replace the doctor's treatable symptoms list.
    Body: { "symptom_ids": ["uuid1", "uuid2", ...] }
    """
    from app.models import Doctor, DoctorSymptom, Symptom
    from app.extensions import db
    from uuid import uuid4

    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    data = request.get_json() or {}
    symptom_ids = data.get('symptom_ids', [])

    # Validate all symptom IDs exist
    valid_symptoms = Symptom.query.filter(
        Symptom.tenant_id == doctor.tenant_id,
        Symptom.id.in_(symptom_ids),
        Symptom.is_active == True,
    ).all()
    valid_ids = {str(s.id) for s in valid_symptoms}

    # Remove existing
    DoctorSymptom.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).delete()

    # Add new
    for sid in symptom_ids:
        if sid in valid_ids:
            db.session.add(DoctorSymptom(
                id=uuid4(),
                tenant_id=doctor.tenant_id,
                doctor_id=doctor.id,
                symptom_id=sid,
            ))

    db.session.commit()

    symptoms = [ds.to_dict() for ds in doctor.treatable_symptoms.all()]
    return success_response(data={'symptoms': symptoms}, message='Treatable symptoms updated')


@doctor_bp.route('/symptoms/available', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_available_symptoms():
    """Get all active symptoms the doctor can choose from (master list)."""
    from app.models import Symptom
    symptoms = Symptom.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).order_by(Symptom.category, Symptom.name).all()
    categories = list({s.category for s in symptoms if s.category})
    categories.sort()
    return success_response(data={
        'symptoms': [s.to_dict() for s in symptoms],
        'categories': categories,
    })


# ═══════════════════════════════════════════════════════════════════════
#  BILLING
# ═══════════════════════════════════════════════════════════════════════

@doctor_bp.route('/billing', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_doctor_billing():
    """
    Get billing details for completed appointments.
    Computes charges, GST, TDS, and final payout based on active BillingConfig.

    Query Parameters:
        - page: Page number (default: 1)
        - per_page: Results per page (default: 20)
        - date_from: Filter from date (YYYY-MM-DD)
        - date_to: Filter to date (YYYY-MM-DD)
    """
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    date_from = request.args.get('date_from', None)
    date_to = request.args.get('date_to', None)

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    result = DoctorService.get_doctor_billing(
        doctor_id=doctor.id,
        page=page,
        per_page=per_page,
        date_from=date_from,
        date_to=date_to,
    )

    return success_response(data=result)


# ═══════════════════════════════════════════════════════════════════════
#  PAYOUTS (doctor's own payout records)
# ═══════════════════════════════════════════════════════════════════════

@doctor_bp.route('/payouts', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_doctor_payouts():
    """
    List the current doctor's payouts with optional filters.

    Query Parameters:
        - page: Page number (default: 1)
        - per_page: Results per page (default: 20)
        - status: Filter by payout status (pending/processing/completed/failed)
    """
    from app.models import DoctorPayout, PayoutStatus, BillingConfig, DoctorBillingProfile

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    status = request.args.get('status', None)

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    # The doctor's own billing type (plan / employee / consultant) for display.
    _bprofile = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    billing_type = _bprofile.billing_type.value if _bprofile else 'plan'

    # Lazy promotion: any ON_HOLD payout whose T-day hold has elapsed becomes
    # PENDING (autopay) or CLAIMABLE (claim) the moment the doctor opens My Bills.
    from app.api.common.payment.billing_service import promote_matured_payouts
    promote_matured_payouts(doctor.tenant_id)

    query = DoctorPayout.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    )

    if status:
        try:
            query = query.filter(DoctorPayout.status == PayoutStatus(status))
        except ValueError:
            pass

    query = query.order_by(DoctorPayout.created_at.desc())
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    # Get billing config for bill template info
    config = BillingConfig.query.filter_by(
        tenant_id=doctor.tenant_id, is_active=True,
    ).first()
    bill_config = {}
    if config:
        bill_config = {
            'bill_company_name': config.bill_company_name,
            'bill_company_tagline': config.bill_company_tagline,
            'bill_pan': config.bill_pan,
            'bill_gst_reg': config.bill_gst_reg,
            'bill_cin': config.bill_cin,
            'bill_sac': config.bill_sac,
            'bill_support_email': config.bill_support_email,
            'bill_footer_note': config.bill_footer_note,
            'bill_logo_url': config.bill_logo_url,
        }
    # Charge labels now come from the doctor's active membership plan, not the
    # tenant BillingConfig — set even when no BillingConfig row exists so the
    # My Bills table always has column headers.
    from app.api.common.payment.billing_service import resolve_charge_names
    _cn = resolve_charge_names(doctor)
    bill_config['charge1_name'] = _cn[0]
    bill_config['charge2_name'] = _cn[1]
    bill_config['charge3_name'] = _cn[2]

    payouts = []
    for p in paginated.items:
        d = p.to_dict()
        # Include appointment date
        if p.appointment:
            d['appointment_date'] = p.appointment.appointment_date.isoformat() if p.appointment.appointment_date else None
            d['consultation_type'] = p.appointment.consultation_type if hasattr(p.appointment, 'consultation_type') else None
        # Include patient info
        if p.appointment and p.appointment.patient and p.appointment.patient.user:
            pu = p.appointment.patient.user
            d['patient_name'] = f"{pu.first_name or ''} {pu.last_name or ''}".strip()
        payouts.append(d)

    return success_response(data={
        'payouts': payouts,
        'bill_config': bill_config,
        'billing_type': billing_type,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@doctor_bp.route('/payouts/<payout_id>/claim', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def claim_payout(payout_id):
    """Claim a CLAIMABLE payout (claim-mode doctors).

    The claim IS the release: it sends the money to the doctor's verified bank
    via Cashfree. The admin never triggers a transfer — they can only push a
    held payout to the doctor, who decides when to take it.
    """
    from datetime import datetime, timezone
    from app.models import DoctorPayout, PayoutStatus
    from app.api.common.payment.billing_service import disburse_payout

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    payout = DoctorPayout.query.filter_by(
        tenant_id=doctor.tenant_id, id=payout_id, doctor_id=doctor.id,
    ).first()
    if not payout:
        return error_response('Payout not found', status_code=404)
    if payout.status != PayoutStatus.CLAIMABLE:
        return error_response('This payout is not available to claim yet', status_code=400)

    # Approval-matrix gate on the payout claim (which IS the disbursement):
    # auto → proceed, auto_reject → denied, manual → held for admin approval
    # (the admin's approval re-runs this same claim+disburse).
    from app.api.admin.doctor_action_gate import gate_action
    outcome, obj = gate_action(
        doctor, 'payments', ref_type='payout', ref_id=payout_id,
        label=f'Claim payout {payout.bill_number}',
        payload={'claimed_by_id': str(current_user.id)},
        requested_by_id=current_user.id)
    if outcome == 'reject':
        return error_response(obj, status_code=403)
    if outcome == 'held':
        return success_response(
            message='Payout claim submitted for admin approval.',
            data={'held': True, 'action_id': str(obj.id)})

    # Record the claim before attempting the transfer, so a Cashfree failure
    # still leaves an audit trail of who asked for the money and when.
    payout.claim_requested_at = datetime.now(timezone.utc)
    payout.claimed_by_id = current_user.id
    db.session.commit()

    ok, msg = disburse_payout(payout)
    if not ok:
        return error_response(msg, status_code=502, data=payout.to_dict())
    return success_response(message=msg, data=payout.to_dict())


@doctor_bp.route('/payouts/preference', methods=['GET', 'PUT'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def payout_preference():
    """Read / set the doctor's own auto-receive preference.

    autopay — a payout is sent automatically once it matures (or once an admin
              pushes it); the doctor does nothing.
    claim   — the doctor collects each payout by hand.

    This is the doctor's money, so the choice is theirs. An admin can still set
    the same field (doctor_analytics) when a doctor asks them to. Only payouts
    created after the change pick it up: payout_mode is snapshotted at creation
    so a payout can't change its rules once it is already on hold.
    """
    from app.models import PayoutMode
    from app.api.common.payment.billing_service import get_or_create_billing_profile

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    bp = get_or_create_billing_profile(doctor)

    if request.method == 'GET':
        return success_response(data={
            'payout_mode': bp.payout_mode.value if bp.payout_mode else 'autopay',
        })

    data = request.get_json(silent=True) or {}
    mode = data.get('payout_mode')
    try:
        bp.payout_mode = PayoutMode(mode)
    except ValueError:
        return error_response(
            "payout_mode must be 'autopay' (send it to me automatically) or "
            "'claim' (I will collect each payout myself)",
            status_code=400,
        )
    db.session.commit()
    logger.info('[PAYOUT] doctor=%s set payout_mode=%s', doctor.id, bp.payout_mode.value)
    return success_response(
        data={'payout_mode': bp.payout_mode.value},
        message=(
            'Future payouts will be sent to your bank automatically once they mature.'
            if bp.payout_mode == PayoutMode.AUTOPAY else
            'You will collect each future payout yourself.'
        ),
    )


@doctor_bp.route('/payouts/claim-all', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def claim_all_payouts():
    """Claim every CLAIMABLE payout for the doctor at once."""
    from datetime import datetime, timezone
    from app.models import DoctorPayout, PayoutStatus

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    claimable = DoctorPayout.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id, status=PayoutStatus.CLAIMABLE,
    ).all()
    now = datetime.now(timezone.utc)
    for p in claimable:
        p.status = PayoutStatus.PENDING
        p.claim_requested_at = now
        p.claimed_by_id = current_user.id
    if claimable:
        db.session.commit()
    return success_response(message=f'Claimed {len(claimable)} payout(s)', data={'claimed': len(claimable)})


@doctor_bp.route('/salary-payouts', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_doctor_salary_payouts():
    """The doctor's salary/retainer payouts (employee / consultant)."""
    from app.models import SalaryPayout
    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    rows = SalaryPayout.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).order_by(SalaryPayout.period_start.desc()).all()
    return success_response(data={'salary_payouts': [s.to_dict() for s in rows]})


@doctor_bp.route('/salary-payouts/<salary_payout_id>/claim', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def claim_salary_payout(salary_payout_id):
    """Claim a CLAIMABLE salary/retainer — the claim IS the release.

    Mirrors the per-patient ``claim_payout`` and reuses the same
    ``disburse_payout`` money path.

    The row is locked FOR UPDATE and its status re-asserted inside the
    transaction: without that, two concurrent claims (a double-clicked button,
    or a retried request) could both read CLAIMABLE and both fire a transfer.
    The lock makes the second one see PROCESSING and refuse.
    """
    from datetime import datetime, timezone
    from app.models import SalaryPayout, PayoutStatus
    from app.api.common.payment.billing_service import disburse_payout

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    payout = (
        SalaryPayout.query
        .filter_by(tenant_id=doctor.tenant_id, id=salary_payout_id, doctor_id=doctor.id)
        .with_for_update()
        .first()
    )
    if not payout:
        return error_response('Salary payout not found', status_code=404)
    if payout.compliance_withheld:
        db.session.rollback()
        return error_response('This payout is withheld — contact your admin.', status_code=409)
    if payout.status != PayoutStatus.CLAIMABLE:
        db.session.rollback()
        return error_response('This payout is not available to claim yet', status_code=400)

    payout.claim_requested_at = datetime.now(timezone.utc)
    payout.claimed_by_id = current_user.id
    db.session.commit()  # releases the lock with the claim recorded

    ok, msg = disburse_payout(payout)
    if not ok:
        return error_response(msg, status_code=502, data=payout.to_dict())
    return success_response(message=msg, data=payout.to_dict())


@doctor_bp.route('/payouts/<payout_id>/bill', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_payout_bill(payout_id):
    """
    Get full bill/invoice details for a specific payout.
    Only the doctor who owns the payout can view it.
    """
    from app.models import DoctorPayout, BillingConfig

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    payout = DoctorPayout.query.filter_by(
        tenant_id=doctor.tenant_id, id=payout_id,
    ).first()
    if not payout:
        return not_found_response('Payout not found')
    if str(payout.doctor_id) != str(doctor.id):
        return error_response('Unauthorized', status_code=403)

    config = BillingConfig.query.filter_by(
        tenant_id=doctor.tenant_id, is_active=True,
    ).first()

    bill_data = payout.to_dict()

    # Doctor info
    if doctor.user:
        bill_data['doctor_name'] = f"{doctor.user.first_name or ''} {doctor.user.last_name or ''}".strip()
        bill_data['doctor_email'] = doctor.user.email

    # Appointment + patient info
    if payout.appointment:
        appt = payout.appointment
        bill_data['appointment_date'] = appt.appointment_date.isoformat() if appt.appointment_date else None
        bill_data['appointment_time'] = str(appt.start_time) if hasattr(appt, 'start_time') and appt.start_time else None
        if appt.patient and appt.patient.user:
            pu = appt.patient.user
            bill_data['patient_name'] = f"{pu.first_name or ''} {pu.last_name or ''}".strip()
            bill_data['patient_id'] = str(appt.patient.id)

    # Bank info
    if payout.bank_account:
        ba = payout.bank_account
        bill_data['bank_name'] = ba.bank_name
        bill_data['account_holder'] = ba.account_holder_name
        bill_data['account_number_last4'] = ba.account_number[-4:] if ba.account_number else None

    # Bill template config
    if config:
        bill_data['company'] = {
            'name': config.bill_company_name,
            'tagline': config.bill_company_tagline,
            'pan': config.bill_pan,
            'gst_reg': config.bill_gst_reg,
            'cin': config.bill_cin,
            'sac': config.bill_sac,
            'support_email': config.bill_support_email,
            'footer_note': config.bill_footer_note,
            'logo_url': config.bill_logo_url,
        }
    # Charge labels resolve from the doctor's active membership plan (see
    # resolve_charge_names); the amounts on the payout row are already stored.
    from app.api.common.payment.billing_service import resolve_charge_names
    _cn = resolve_charge_names(doctor)
    bill_data['charge1_name'] = _cn[0]
    bill_data['charge2_name'] = _cn[1]
    bill_data['charge3_name'] = _cn[2]

    return success_response(data=bill_data)


@doctor_bp.route('/payouts/<payout_id>/bill-pdf', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def get_payout_bill_pdf(payout_id):
    """
    Generate and return a PDF invoice for a specific payout.
    Returns a presigned S3 URL for the generated PDF.
    """
    from app.models import DoctorPayout
    from app.services.bill_pdf_service import generate_bill_pdf

    doctor = _get_doctor_for_request()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    payout = DoctorPayout.query.filter_by(
        tenant_id=doctor.tenant_id, id=payout_id,
    ).first()
    if not payout:
        return not_found_response('Payout not found')
    if str(payout.doctor_id) != str(doctor.id):
        return error_response('Unauthorized', status_code=403)

    pdf_url = generate_bill_pdf(payout)
    if not pdf_url:
        return error_response('Failed to generate bill PDF', status_code=500)

    return success_response(data={'pdf_url': pdf_url})


# --------------------------------------------------------------------------- #
# Round 9 — doctor invites a patient
# --------------------------------------------------------------------------- #
# Same shape as ``/admin/patients/invite``: doctor enters the patient's
# contact details, backend creates a User+Patient in pending-activation
# state, dispatches the activation link via email + SMS. The patient
# is scoped to the doctor's tenant (no cross-tenant patient invites).
# --------------------------------------------------------------------------- #

@doctor_bp.route('/patients/invite', methods=['POST'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
@feature_required('admin.invite_patient')
def doctor_invite_patient():
    """Doctor invites a patient onto the doctor's tenant.

    JSON body (same shape as admin invite-patient):
      {
        "first_name": "...", "last_name": "...",
        "email": "...", "phone_number": "...",
        "dob": "1990-01-01" (optional),
        "gender": "M"|"F" (optional)
      }
    """
    from app.api.affiliation.service import (
        AffiliationService, AffiliationError, AffiliationForbidden,
    )

    data = request.get_json(silent=True) or {}
    try:
        result = AffiliationService.doctor_invite_patient(current_user, data)
        return success_response(
            result,
            message='Patient invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden) as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/patients', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def doctor_list_invited_patients():
    """The doctor's "My Patients": patients they INVITED onto the tenant
    UNION patients they've had a COMPLETED appointment with.

    Query params (all optional):
      * ``search``            — substring match on name / email / phone.
      * ``source``            — ``all`` | ``invited`` | ``consulted``.
      * ``consultation_type`` — video | audio | chat | … (from completed
                                appointments); filters to patients seen
                                via that mode.
      * ``sort``              — ``recent`` (last visit, default) | ``name``
                                | ``oldest`` (added date).
      * ``page`` / ``per_page`` — pagination.

    Each row carries ``source`` (invited | consulted | both),
    ``last_appointment_date`` and ``consultation_types`` so the UI can
    show how the patient is linked and offer the filters/sort above.
    Tenant-scoped; a doctor never sees another doctor's patients.
    """
    from datetime import date
    from app.common.tenant_context import current_tenant_id_strict
    from app.models import Patient, User, Appointment, AppointmentStatus

    tenant_id = current_tenant_id_strict()
    doctor = _get_doctor_for_request()

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = (request.args.get('search') or '').strip().lower()
    source = (request.args.get('source') or 'all').strip().lower()
    consultation_type = (request.args.get('consultation_type') or '').strip().lower()
    sort = (request.args.get('sort') or 'recent').strip().lower()

    # Merge both sources into one dict keyed by patient id. A doctor's own
    # roster is bounded (tens–hundreds), so building the union in Python and
    # paginating the result is simpler and correct vs a windowed SQL UNION.
    acc = {}

    # 1. Invited patients.
    invited_rows = (
        db.session.query(Patient, User)
        .join(User, Patient.user_id == User.id)
        .filter(
            Patient.tenant_id == tenant_id,
            Patient.is_deleted.is_(False),
            Patient.invited_by_user_id == current_user.id,
        )
        .all()
    )
    for p, u in invited_rows:
        acc[p.id] = {
            'patient': p, 'user': u, 'invited': True, 'consulted': False,
            'last_appt': None, 'cons_types': set(),
        }

    # 2. Patients with a COMPLETED appointment with this doctor.
    if doctor:
        appt_rows = (
            db.session.query(Appointment, Patient, User)
            .join(Patient, Appointment.patient_id == Patient.id)
            .join(User, Patient.user_id == User.id)
            .filter(
                Appointment.tenant_id == tenant_id,
                Appointment.doctor_id == doctor.id,
                Appointment.status == AppointmentStatus.COMPLETED,
                Patient.is_deleted.is_(False),
            )
            .all()
        )
        for appt, p, u in appt_rows:
            entry = acc.get(p.id)
            if entry is None:
                entry = {
                    'patient': p, 'user': u, 'invited': False,
                    'consulted': False, 'last_appt': None, 'cons_types': set(),
                }
                acc[p.id] = entry
            entry['consulted'] = True
            ad = appt.appointment_date
            if ad and (entry['last_appt'] is None or ad > entry['last_appt']):
                entry['last_appt'] = ad
            ct = appt.consultation_type
            if ct is not None:
                entry['cons_types'].add(getattr(ct, 'value', str(ct)))

    entries = list(acc.values())

    # Filters.
    if source == 'invited':
        entries = [e for e in entries if e['invited']]
    elif source == 'consulted':
        entries = [e for e in entries if e['consulted']]
    if consultation_type:
        entries = [e for e in entries if consultation_type in e['cons_types']]
    if search:
        def _match(e):
            u = e['user']
            name = f"{u.first_name or ''} {u.last_name or ''}".lower()
            return (
                search in name
                or search in (u.email or '').lower()
                or search in (u.phone_number or '').lower()
            )
        entries = [e for e in entries if _match(e)]

    # Sort.
    def _name(e):
        u = e['user']
        return f"{u.first_name or ''} {u.last_name or ''}".strip().lower()

    def _created(e):
        ca = e['patient'].created_at
        return ca.date() if ca else date.min

    if sort == 'name':
        entries.sort(key=_name)
    elif sort == 'oldest':
        entries.sort(key=_created)
    else:  # 'recent' — most recent visit first, then most recently added
        entries.sort(key=lambda e: (e['last_appt'] or date.min, _created(e)), reverse=True)

    # Paginate the merged list.
    total = len(entries)
    per_page = max(1, per_page)
    start = (max(1, page) - 1) * per_page
    page_items = entries[start:start + per_page]
    pages = (total + per_page - 1) // per_page

    def _serialize(e):
        p, u = e['patient'], e['user']
        fn = (u.first_name or '').strip()
        ln = (u.last_name or '').strip()
        full_name = f'{fn} {ln}'.strip() or '(no name)'
        pending = bool(
            u.must_set_password or not u.email_verified or not u.phone_verified
        )
        src = ('both' if e['invited'] and e['consulted']
               else 'invited' if e['invited'] else 'consulted')
        return {
            'patient_id': str(p.id),
            'user_id': str(u.id),
            'full_name': full_name,
            'email': u.email,
            'phone_number': u.phone_number,
            'created_at': p.created_at.isoformat() if p.created_at else None,
            'source': src,
            'invited': e['invited'],
            'consulted': e['consulted'],
            'last_appointment_date': (
                e['last_appt'].isoformat() if e['last_appt'] else None
            ),
            'consultation_types': sorted(e['cons_types']),
            'must_set_password': bool(u.must_set_password),
            'email_verified': bool(u.email_verified),
            'phone_verified': bool(u.phone_verified),
            'pending_activation': pending,
        }

    return success_response(data={
        'patients': [_serialize(e) for e in page_items],
        'pagination': {
            'page': page, 'per_page': per_page, 'total': total, 'pages': pages,
        },
    })

