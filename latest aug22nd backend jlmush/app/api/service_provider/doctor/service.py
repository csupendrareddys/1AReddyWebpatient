"""
Doctor Service
Business logic for doctor-related operations
"""
import math
from decimal import Decimal
from datetime import datetime, date as date_type, time, timezone
from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    Doctor, DoctorService as DoctorServiceModel,
    ProfileEducationDegree, ProfileEducationSpecialization,
    DoctorHospitalAffiliation, Appointment, Category,
    AvailabilityApprovalStatus, AppointmentStatus,
    Payment, PaymentStatus, BillingConfig,
    get_or_create_profile_owner,
)


def _ceil_time_to_boundary(t: time, ceiling: int) -> time:
    """
    Apply start-time ceiling.

    ceiling = 0  → no change
    ceiling = 5  → if minute == 0 keep it; if minute > 0 ceil to next :05/:10/:15...
    ceiling = 10 → if minute == 0 keep it; if minute > 0 ceil to next :10/:20/:30...

    Examples (ceiling=5):
        09:00 → 09:00  (exact boundary: keep)
        09:01 → 09:05  (past boundary: ceil)
        09:05 → 09:05  (exact: keep)
        09:06 → 09:10  (past: ceil)
    """
    if ceiling <= 0:
        return t

    m = t.hour * 60 + t.minute
    if m % ceiling == 0:
        # Exact boundary — keep as-is
        ceiled_m = m
    else:
        # Past a boundary — ceil to next one
        ceiled_m = math.ceil(m / ceiling) * ceiling

    new_hour = ceiled_m // 60
    new_min = ceiled_m % 60
    if new_hour >= 24:
        return time(23, 59)
    return time(new_hour, new_min)


def _time_to_minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def _minutes_to_time(m: int) -> time:
    return time(m // 60, m % 60)


class DoctorService:
    """Service class for doctor operations."""

    # --------------- Basic lookups ---------------

    @staticmethod
    def get_by_id(doctor_id):
        return Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=doctor_id, is_deleted=False,
        ).first()

    @staticmethod
    def get_by_user_id(user_id):
        doc = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            user_id=user_id, is_deleted=False,
        ).first()
        if doc:
            return doc
        # Facility (clinic / hospital) managers reuse the doctor profile page
        # for their OWN details (the person handling the facility). They have
        # no Doctor row, so the profile endpoints used to 404 ("Doctor profile
        # not found") and the whole page failed to save. Auto-provision a
        # backing Doctor row for those accounts so every profile section can
        # store data. Facility managers never surface in doctor listings —
        # those filter on ``User.role == DOCTOR`` — so this is invisible
        # elsewhere. Required-without-default columns get safe placeholders;
        # ``registration_number`` is tenant-unique so it's keyed to the user.
        from app.models import User, UserRole
        tid = current_tenant_id_strict()
        user = User.query.filter_by(id=user_id, tenant_id=tid).first()
        if user and user.role in (UserRole.CLINIC, UserRole.HOSPITAL):
            doc = Doctor(
                user_id=user.id, tenant_id=tid,
                aadhar_number='', aadhar_attachment='',
                registration_number=f'FACILITY-{user.id}',
                registration_certificate='',
            )
            db.session.add(doc)
            db.session.commit()
            return doc
        return None

    # --------------- Search ---------------

    @staticmethod
    def search(specialization=None, city=None, name=None, page=1, per_page=20,
               with_slots=False, doctor_ids=None, languages=None, gender=None,
               experience_min=None, experience_max=None):
        """
        Browse verified, published doctors for the current tenant.

        ``doctor_ids`` pre-narrows the result set to an id whitelist — used
        by the consultation-type / price filters on ``/api/doctor/list``,
        which have to be evaluated against the ``slot_pricing`` JSON in
        Python (see ``doctor_ids_offering``) and so can't be expressed as a
        SQL predicate here. Pass ``None`` for "no id filter"; an empty
        collection legitimately means "nothing matched" and yields no rows.
        """
        from app.models import UserVerificationStatus, PublishStatus, User, Gender
        from sqlalchemy import or_, cast, Text
        from app.common.tenant_context import current_tenant_id_or_default
        # Search is reachable from public booking flow as well as admin
        # surfaces — fall back to default tenant for anonymous traffic so
        # the landing-page doctor search keeps working.
        query = Doctor.query.filter_by(
            tenant_id=current_tenant_id_or_default(),
            is_deleted=False,
        )
        query = query.filter_by(verification_status=UserVerificationStatus.VERIFIED)

        # Show doctors that are globally live OR have any per-type active status
        query = query.filter(
            or_(
                Doctor.is_live == True,
                cast(Doctor.publish_status_by_type, Text).ilike('%"active"%'),
            )
        )

        if with_slots:
            # "Has slots" means a real, currently bookable TimeSlot exists —
            # not merely that admin approved the doctor's schedule template
            # (those are different facts; conflating them let this filter
            # disagree with the aggregate/per-type slot-count endpoints).
            # Single source of truth: TimeSlotService.open_slot_query.
            from app.api.common.timeslot.service import TimeSlotService
            from app.models import TimeSlot
            slot_doctor_ids = (
                TimeSlotService.open_slot_query(current_tenant_id_or_default())
                .with_entities(TimeSlot.doctor_id)
                .subquery()
            )
            query = query.filter(Doctor.id.in_(db.session.query(slot_doctor_ids.c.doctor_id)))

        if doctor_ids is not None:
            query = query.filter(Doctor.id.in_(list(doctor_ids)))

        # ``Doctor.first_name`` / ``.gender`` are read-only Python property
        # shims over ``User`` (see app/models/doctor.py) — they have no SQL
        # expression, so ``Doctor.first_name.ilike(...)`` raised
        # ``AttributeError: 'property' object has no attribute 'ilike'`` and
        # 500'd every name search on /api/doctor/list. Join User and filter
        # the real columns. One join covers both name and gender.
        if name or gender:
            query = query.join(User, Doctor.user_id == User.id)

        if name:
            search_term = f'%{name}%'
            query = query.filter(
                or_(
                    User.first_name.ilike(search_term),
                    User.last_name.ilike(search_term),
                    (User.first_name + ' ' + db.func.coalesce(User.last_name, '')).ilike(search_term),
                )
            )
        if gender:
            raw = gender if isinstance(gender, (list, tuple)) else [
                g.strip() for g in str(gender).split(',') if g.strip()
            ]
            wanted = []
            for g in raw:
                # The filter UI labels the third option "Others" while the
                # enum value is "other" — normalise so picking it isn't a
                # silent no-op.
                key = str(g).strip().lower().rstrip('s') if str(g).strip().lower() == 'others' else str(g).strip().lower()
                try:
                    wanted.append(Gender(key))
                except (ValueError, KeyError):
                    continue  # unknown value → ignore rather than return nothing
            if wanted:
                query = query.filter(User.gender.in_(wanted))

        if languages:
            langs = languages if isinstance(languages, (list, tuple)) else [
                l.strip() for l in str(languages).split(',') if l.strip()
            ]
            if langs:
                # OR, not AND: a checkbox group of languages reads as "speaks
                # any of these". languages_known is a JSON array, so match on
                # its text form.
                query = query.filter(or_(*[
                    cast(Doctor.languages_known, Text).ilike(f'%{lang}%') for lang in langs
                ]))

        if experience_min is not None:
            query = query.filter(Doctor.experience_years >= experience_min)
        if experience_max is not None:
            query = query.filter(Doctor.experience_years <= experience_max)

        if specialization:
            # Accepts a comma-separated list so a multi-select filter can be
            # passed straight through ("any of these specialities").
            specs = specialization if isinstance(specialization, (list, tuple)) else [
                s.strip() for s in str(specialization).split(',') if s.strip()
            ]
            if specs:
                query = query.join(ProfileEducationSpecialization).join(Category)
                query = query.filter(or_(*[Category.name.ilike(f'%{s}%') for s in specs]))

        return query.paginate(page=page, per_page=per_page, error_out=False)

    # --------------- Consultation types offered / pricing ---------------
    #
    # A doctor's per-consultation-type price lives in the ``slot_pricing``
    # JSON column as a flat list of tiers:
    #     [{range, duration, price, description, consultation_type}, ...]
    # There is no pricing table, so "which types does this doctor offer and
    # at what price" can only be answered by grouping that list. Both the
    # doctor-card serializer and the consultation-type/price filters go
    # through the helpers below so the two can never disagree — a bubble
    # that filters doctors in must also render a price on the card.

    #: Tiers written before per-type pricing existed carry no
    #: ``consultation_type``; every reader in the codebase treats those as
    #: in-person ("complete").
    DEFAULT_PRICING_TYPE = 'complete'

    @staticmethod
    def _offered_pricing(slot_pricing, offered_types, publish_by_type,
                         doctor_id=None, display_rules=None):
        """Group raw ``slot_pricing`` into ``{consultation_type: [tier, ...]}``,
        dropping types the doctor has switched off or an admin has unpublished.

        Kept on the raw column values (rather than a Doctor instance) so the
        id-filter scan can call it without loading whole ORM objects.

        When ``doctor_id`` is given, each tier's ``price`` is swapped for the
        patient-facing display price (the SUPER_ADMIN increment/discount from
        ``/dashboard/admin/pricing-config`` applied over the doctor's quoted
        fee, which is preserved as ``doctor_fee``). Every patient-facing reader
        goes through here, so the card, the filter band and the amount charged
        all move together when an admin re-prices a slot.
        """
        from app.common.display_pricing import decorate_tiers

        if doctor_id is not None:
            slot_pricing = decorate_tiers(doctor_id, slot_pricing, display_rules)

        grouped = {}
        for tier in (slot_pricing or []):
            if not isinstance(tier, dict) or tier.get('price') is None:
                continue
            ct = tier.get('consultation_type') or DoctorService.DEFAULT_PRICING_TYPE
            grouped.setdefault(ct, []).append(tier)

        # ``offered_consultation_types`` NULL/empty means "all" (legacy rows).
        offered = offered_types or []
        if offered:
            grouped = {ct: tiers for ct, tiers in grouped.items() if ct in offered}

        # Admin can unpublish individual types. When the map exists it is
        # authoritative per type; when absent, fall back to "published"
        # (the doctor-level publish check already ran in ``search``).
        psbt = publish_by_type or {}
        if psbt:
            grouped = {
                ct: tiers for ct, tiers in grouped.items()
                if str(psbt.get(ct, 'active')).lower() == 'active'
            }
        return grouped

    @staticmethod
    def offered_consultation_pricing(doctor, display_rules=None):
        """``{consultation_type: [tier, ...]}`` for a loaded Doctor, priced as
        the patient sees it. Pass ``display_rules`` from
        ``display_pricing.rules_for_doctors`` when serializing a list so the
        overlay is fetched once for the whole page instead of per doctor."""
        return DoctorService._offered_pricing(
            doctor.slot_pricing,
            doctor.offered_consultation_types,
            doctor.publish_status_by_type,
            doctor_id=doctor.id,
            display_rules=display_rules,
        )

    @staticmethod
    def doctor_ids_offering(consultation_type=None, price_min=None,
                            price_max=None, slot_ranges=None):
        """Ids of tenant doctors offering ``consultation_type`` within a price
        band, at one of ``slot_ranges``. Returns ``None`` when no constraint is
        set (= no filter).

        ``slot_ranges`` is a collection of ``slot_pricing`` range keys
        ('0-10', '20-30', …); a doctor matches when they price at least ONE
        tier at one of those lengths, same "has something for you" rule the
        price band uses rather than "every tier fits".

        Evaluated in Python because the constraint lives inside a JSON array
        whose tier objects have inconsistent key order — a ``LIKE`` over the
        serialized JSON would miss rows. Only four columns are pulled, and
        the scan is tenant-scoped, so this stays cheap relative to the
        per-doctor work the route already does.
        """
        wanted_ranges = {str(r).strip() for r in (slot_ranges or []) if str(r).strip()}
        if (not consultation_type and price_min is None and price_max is None
                and not wanted_ranges):
            return None

        from app.common.tenant_context import current_tenant_id_or_default
        from app.common.display_pricing import rules_for_doctors, slot_key
        rows = db.session.query(
            Doctor.id, Doctor.slot_pricing,
            Doctor.offered_consultation_types, Doctor.publish_status_by_type,
        ).filter(
            Doctor.tenant_id == current_tenant_id_or_default(),
            Doctor.is_deleted == False,
        ).all()

        # The band the patient typed is against the price they'd be quoted, so
        # the filter has to run on display prices — one lookup for the scan.
        display_rules = rules_for_doctors([r[0] for r in rows])

        matched = set()
        for doc_id, slot_pricing, offered_types, psbt in rows:
            grouped = DoctorService._offered_pricing(
                slot_pricing, offered_types, psbt,
                doctor_id=doc_id, display_rules=display_rules,
            )
            if consultation_type:
                grouped = {k: v for k, v in grouped.items() if k == consultation_type}
            prices = []
            for tiers in grouped.values():
                for tier in tiers:
                    # ``slot_key`` derives the range from a legacy tier that
                    # carries only ``duration``, so a doctor priced the old way
                    # is filtered on the same ladder as everyone else instead
                    # of dropping out of every length.
                    if wanted_ranges and slot_key(tier) not in wanted_ranges:
                        continue
                    try:
                        prices.append(float(tier.get('price')))
                    except (TypeError, ValueError):
                        continue
            if not prices:
                continue
            # "In band" = the doctor has at least one tier the patient can
            # afford / is looking for, not that every tier fits.
            if price_min is not None and max(prices) < price_min:
                continue
            if price_max is not None and min(prices) > price_max:
                continue
            matched.add(doc_id)
        return matched

    # --------------- Profile ---------------

    @staticmethod
    def create_profile(user_id, data):
        # Schema split: first_name / middle_name / last_name / gender /
        # dob / profile_image moved off Doctor onto User (see
        # ``app/models/doctor.py`` docstring). Update the linked User
        # row, then build Doctor from the practice-specific columns.
        from app.models import User
        user = User.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=user_id, is_deleted=False,
        ).first()
        if user is not None:
            for k in ('first_name', 'middle_name', 'last_name',
                      'gender', 'dob', 'profile_image'):
                if k in data and data.get(k) is not None:
                    setattr(user, k, data[k])
            db.session.add(user)

        doctor = Doctor(
            user_id=user_id,
            # TenantMixin makes tenant_id NOT NULL; propagate from the
            # linked User row (TenantMixin doesn't auto-fill from g).
            tenant_id=user.tenant_id if user is not None else None,
            registration_number=data.get('registration_number'),
            registration_council=data.get('registration_council'),
            registration_year=data.get('registration_year'),
            experience_years=data.get('experience_years'),
            consultation_fee=data.get('consultation_fee'),
            about=data.get('about'),
        )
        db.session.add(doctor)
        db.session.commit()
        return doctor

    @staticmethod
    def update_profile(user_id, data):
        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None

        # Schema split. The first six fields LIVE ON USER now —
        # writing them on Doctor used to silently no-op (or AttributeError
        # in strict mode); we route them to the User row explicitly.
        from app.models import User
        user_owned_fields = (
            'first_name', 'middle_name', 'last_name', 'gender', 'dob',
            'profile_image',
        )
        doctor_owned_fields = (
            'experience_years', 'consultation_fee',
            'about', 'signature_image', 'accepting_appointments',
            'languages_known', 'slot_pricing',
        )
        user = User.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=user_id, is_deleted=False,
        ).first()
        for field in user_owned_fields:
            if field in data:
                value = data[field]
                if value == '':
                    value = None
                if user is not None:
                    setattr(user, field, value)
        for field in doctor_owned_fields:
            if field in data:
                value = data[field]
                if value == '':
                    value = None
                setattr(doctor, field, value)

        db.session.commit()
        return doctor

    # --------------- Qualifications / Specializations ---------------

    @staticmethod
    def add_qualification(doctor_id, data):
        tid = current_tenant_id_strict()
        qualification = ProfileEducationDegree(
            tenant_id=tid,
            profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, tid).id,
            doctor_id=doctor_id,
            degree_name=data.get('degree_name'),
            institution=data.get('institution'),
            passing_year=data.get('passing_year'),
            certificate_link=data.get('certificate_link'),
        )
        db.session.add(qualification)
        db.session.commit()
        return qualification

    @staticmethod
    def add_specialization(doctor_id, category_id, data):
        tid = current_tenant_id_strict()
        specialization = ProfileEducationSpecialization(
            tenant_id=tid,
            profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, tid).id,
            doctor_id=doctor_id,
            category_id=category_id,
            is_primary=data.get('is_primary', False),
        )
        db.session.add(specialization)
        db.session.commit()
        return specialization

    # --------------- Services ---------------

    @staticmethod
    def add_service(doctor_id, data):
        service = DoctorServiceModel(
            tenant_id=current_tenant_id_strict(),
            doctor_id=doctor_id,
            service_name=data.get('service_name'),
            price=data.get('price'),
            duration_minutes=data.get('duration_minutes'),
            description=data.get('description'),
            is_available=data.get('is_available', True),
        )
        db.session.add(service)
        db.session.commit()
        return service

    # --------------- Appointments ---------------

    @staticmethod
    def get_appointments(doctor_id, status=None, date_from=None, date_to=None, page=1, per_page=20):
        query = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            doctor_id=doctor_id, is_deleted=False,
        )
        if status:
            # The doctor's "Upcoming" tab on the frontend passes
            # ``status=confirmed``. Once *anyone* joins the video
            # call, ``video/service.py`` flips CONFIRMED → IN_PROGRESS
            # so the live-call indicator works for everyone else.
            # Filtering strictly by CONFIRMED then makes the live
            # appointment vanish from every doctor tab — the doctor
            # can no longer re-enter their own consultation, and the
            # "Mark Complete" button is unreachable too. Treat
            # CONFIRMED as "Upcoming OR Live" so the call stays
            # visible from booking right up to completion.
            if status == AppointmentStatus.CONFIRMED:
                query = query.filter(Appointment.status.in_([
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.IN_PROGRESS,
                ]))
            else:
                query = query.filter_by(status=status)
        if date_from:
            query = query.filter(Appointment.appointment_date >= date_from)
        if date_to:
            query = query.filter(Appointment.appointment_date <= date_to)
        query = query.order_by(Appointment.appointment_date.desc())
        return query.paginate(page=page, per_page=per_page, error_out=False)

    @staticmethod
    def get_calendar_appointments(doctor_id, year, month):
        """Get confirmed/in_progress appointments for a specific month for calendar view."""
        from calendar import monthrange
        from datetime import date
        
        _, last_day = monthrange(year, month)
        start_date = date(year, month, 1)
        end_date = date(year, month, last_day)
        
        query = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            doctor_id=doctor_id, is_deleted=False,
        )
        query = query.filter(
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.status.in_([
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.IN_PROGRESS,
                AppointmentStatus.COMPLETED
            ])
        )
        return query.all()

    # --------------- Schedule / Availability ---------------

    @staticmethod
    def get_schedule(user_id):
        """Return full schedule data including availability_config, slot_pricing, and granular approval status."""
        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None

        # Build granular status tree from active requests
        from app.models import ApprovalRequest, ApprovalEntityType, ApprovalRequestStatus, ApprovalAction
        
        granular_status = {
            'pricing': {},
            'working_hours': {},
            'calendar': {'status': 'approved', 'reason': None}, 
            'global_config': {'status': 'approved', 'reason': None}
        }
        
        # We query both PENDING and REJECTED requests to construct the current state.
        reqs = ApprovalRequest.query.filter(
            ApprovalRequest.tenant_id == doctor.tenant_id,
            ApprovalRequest.entity_id == doctor.id,
            ApprovalRequest.entity_type.in_([ApprovalEntityType.DOCTOR_AVAILABILITY, ApprovalEntityType.DOCTOR_FEE]),
            ApprovalRequest.status.in_([ApprovalRequestStatus.PENDING, ApprovalRequestStatus.REJECTED])
        ).order_by(ApprovalRequest.created_at.asc()).all()

        for req in reqs:
            if not req.changes: continue
            meta = req.changes.get('_meta')
            if not meta: continue
            
            cat = meta.get('category')
            typ = meta.get('type')
            
            # Get the exact rejection reason if rejected (from the latest action)
            reason = None
            if req.status == ApprovalRequestStatus.REJECTED:
                latest_action = req.actions.order_by(ApprovalAction.created_at.desc()).first()
                if latest_action: reason = latest_action.comments
            
            payload = {'status': req.status.value, 'reason': reason}
            
            if cat in ['pricing', 'working_hours']:
                granular_status[cat][typ] = payload
            elif cat in ['calendar', 'global_config']:
                granular_status[cat] = payload

        # Default approved for items that aren't pending or rejected
        for ct in set(p.get('consultation_type', 'complete') for p in (doctor.slot_pricing or [])):
            if ct not in granular_status['pricing']:
                granular_status['pricing'][ct] = {'status': 'approved', 'reason': None}
                
        if doctor.availability_config and 'working_days' in doctor.availability_config:
            wh = doctor.availability_config['working_days']
            for ct in wh.keys():
                if ct in ["video", "audio", "chat", "home_visit", "clinic_visit", "camp"]:
                    if ct not in granular_status['working_hours']:
                        granular_status['working_hours'][ct] = {'status': 'approved', 'reason': None}

        return {
            'granular_status': granular_status,
            'availability_config': doctor.availability_config or {},
            'slot_pricing': doctor.slot_pricing or [],
            'availability_approval_status': doctor.availability_approval_status.value,
            'availability_rejection_reason': doctor.availability_rejection_reason,
            'availability_approval_requested_at': (
                doctor.availability_approval_requested_at.isoformat()
                if doctor.availability_approval_requested_at else None
            ),
            'availability_approved_at': (
                doctor.availability_approved_at.isoformat()
                if doctor.availability_approved_at else None
            ),
            # Approved snapshots — these are the ONLY source of truth for
            # what the doctor is allowed to generate slots for.
            'approved_slot_pricing': doctor.approved_slot_pricing or [],
            'approved_working_days': doctor.approved_working_days or {},
            'approved_day_overrides': doctor.approved_day_overrides or {},
            # Slot visibility window
            'slot_visibility_gap': doctor.slot_visibility_gap or {},
            'slot_visibility_approval_status': doctor.slot_visibility_approval_status.value,
            'slot_visibility_approved_gap': doctor.slot_visibility_approved_gap or {},
            'slot_visibility_approval_requested_at': (
                doctor.slot_visibility_approval_requested_at.isoformat()
                if doctor.slot_visibility_approval_requested_at else None
            ),
            'slot_visibility_approved_at': (
                doctor.slot_visibility_approved_at.isoformat()
                if doctor.slot_visibility_approved_at else None
            ),
            'slot_visibility_rejection_reason': doctor.slot_visibility_rejection_reason,
        }

    @staticmethod
    def update_schedule(user_id, data):
        """
        Save availability_config and/or slot_pricing.
        Creates a single unified ApprovalRequest (DOCTOR_AVAILABILITY) per save that covers
        both availability_config and slot_pricing changes, avoiding duplicate queue entries.
        Approval status only resets when something actually changed.
        """
        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None

        import logging, json
        logger = logging.getLogger(__name__)
        logger.debug(f"[DOCTOR:SCHEDULE] Updating for doctor={doctor.id}, keys={list(data.keys())}")
        from sqlalchemy.orm.attributes import flag_modified

        changed = False
        need_approval_reset = False
        combined_changes = {}

        # ── Validate day_overrides against approved pricing & working hours ──
        # Only validates NEWLY added/changed slots — pre-existing (unchanged) overrides pass through.
        # Skips validation entirely if admin hasn't approved anything yet (first-time setup).
        if 'availability_config' in data:
            new_config = data['availability_config']
            day_overrides = new_config.get('day_overrides', {})
            approved_pricing = doctor.approved_slot_pricing or []
            approved_wh = doctor.approved_working_days or {}

            # Only enforce validation when admin has approved at least once
            has_any_approval = bool(approved_pricing) or bool(approved_wh)

            if day_overrides and has_any_approval:
                old_config = doctor.availability_config or {}
                old_overrides = old_config.get('day_overrides', {})

                # Build lookup: which consultation types have approved pricing ranges?
                approved_type_ranges = {}
                for sp in approved_pricing:
                    ct = sp.get('consultation_type', 'complete')
                    price = sp.get('price')
                    range_str = sp.get('range', '')
                    if price and float(price) > 0 and range_str:
                        parts = range_str.split('-')
                        if len(parts) == 2:
                            try:
                                range_min, range_max = int(parts[0]), int(parts[1])
                                approved_type_ranges.setdefault(ct, []).append((range_min, range_max))
                            except (ValueError, TypeError):
                                pass

                # Build lookup: which consultation types have approved working hours?
                # approved_wh can be per-type: { "video": {"Monday": [...]}, ... }
                # or legacy flat:             { "Monday": [...] }
                from app.models import SCHEDULABLE_CONSULTATION_TYPES
                is_per_type_wh = any(k in SCHEDULABLE_CONSULTATION_TYPES for k in approved_wh)

                validation_errors = []
                for date_str, slots_list in day_overrides.items():
                    if not slots_list:
                        continue

                    # Compare with existing: only validate if this date's slots actually changed
                    old_slots = old_overrides.get(date_str, [])
                    if json.dumps(slots_list, sort_keys=True) == json.dumps(old_slots, sort_keys=True):
                        continue  # Unchanged — skip validation

                    for slot in slots_list:
                        slot_types = slot.get('consultation_types', [])
                        # Skip legacy slots without explicit consultation_types
                        if not slot_types:
                            continue
                        slot_size = slot.get('size', 0)

                        for ct in slot_types:
                            # 1. Check consultation type has approved pricing
                            if ct not in approved_type_ranges:
                                validation_errors.append(
                                    f"Consultation type '{ct}' has no approved pricing. "
                                    f"Set pricing and get admin approval first."
                                )
                                continue

                            # 2. Check slot duration falls within an approved pricing range
                            if slot_size:
                                sz = int(slot_size)
                                ranges = approved_type_ranges[ct]
                                if not any(r[0] <= sz <= r[1] for r in ranges):
                                    validation_errors.append(
                                        f"Slot duration {slot_size}min for '{ct}' on {date_str} "
                                        f"does not fall within any approved pricing range: "
                                        f"{[f'{r[0]}-{r[1]}' for r in ranges]}"
                                    )

                            # 3. Check consultation type has approved working hours
                            if is_per_type_wh:
                                type_wh = approved_wh.get(ct, {})
                            else:
                                type_wh = approved_wh  # legacy flat

                            if not type_wh or not any(type_wh.get(d, []) for d in type_wh):
                                validation_errors.append(
                                    f"Consultation type '{ct}' has no approved working hours. "
                                    f"Set working hours and get admin approval first."
                                )

                if validation_errors:
                    # Deduplicate
                    unique_errors = list(dict.fromkeys(validation_errors))
                    raise ValueError('; '.join(unique_errors[:5]))  # return max 5 errors

        # ── Modular Approval Request Generation ──────────────────────────────
        changed = False
        from app.models import ApprovalRequest, ApprovalEntityType, ApprovalRequestStatus, utcnow as rbac_utcnow

        # Track the _meta of every per-slot request we create/update this save so
        # stale pending requests (e.g. a slot reverted to its approved state) can
        # be cancelled afterwards.
        active_meta_keys = set()
        # The requests this save actually created or changed. A senior admin
        # saving from Operations reviews exactly these — not every pending row
        # for the doctor, which would silently clear submissions the admin
        # never looked at. See ``_review_support_schedule`` below.
        touched_requests = []

        def create_or_update_request(entity_type, meta_tag, payload_data, reason):
            nonlocal changed
            active_meta_keys.add(json.dumps(meta_tag, sort_keys=True))

            # Approval matrix: when this doctor's mode for the section is 'auto',
            # apply the change straight into the APPROVED snapshot (no pending
            # request) — the same promotion an admin approval performs.
            _cat = (meta_tag or {}).get('category')
            # Dated day-overrides ('calendar') and slot sizing ('global_config')
            # are part of the schedule, so they follow the doctor's
            # 'working_hours' auto-approval mode — otherwise an auto-approval
            # doctor's slot/calendar edits still sat in the admin queue.
            _section = {'pricing': 'consultation_pricing',
                        'working_hours': 'working_hours',
                        'calendar': 'working_hours',
                        'global_config': 'working_hours'}.get(_cat)
            if _section:
                from app.api.admin.approval_policy_service import effective_permission_mode
                if effective_permission_mode(doctor, _section) == 'auto':
                    from app.api.common.timeslot.slot_approval import promote_availability_change
                    promote_availability_change(doctor, meta_tag, payload_data)
                    # Cancel any earlier pending request for this exact meta so it
                    # doesn't linger in the admin queue after auto-apply.
                    for _r in ApprovalRequest.query.filter_by(
                            tenant_id=doctor.tenant_id, entity_id=doctor.id,
                            entity_type=entity_type,
                            status=ApprovalRequestStatus.PENDING).all():
                        if _r.changes and _r.changes.get('_meta') == meta_tag:
                            _r.status = ApprovalRequestStatus.CANCELLED
                            _r.completed_at = rbac_utcnow()
                    changed = True
                    return

            existing_reqs = ApprovalRequest.query.filter_by(
                tenant_id=doctor.tenant_id,
                entity_id=doctor.id,
                entity_type=entity_type,
                status=ApprovalRequestStatus.PENDING
            ).all()

            existing_req = next((r for r in existing_reqs if r.changes and r.changes.get('_meta') == meta_tag), None)
            payload = {"_meta": meta_tag, "data": payload_data}

            if existing_req:
                if json.dumps(existing_req.changes, sort_keys=True) != json.dumps(payload, sort_keys=True):
                    existing_req.changes = payload
                    flag_modified(existing_req, 'changes')
                    changed = True
                    touched_requests.append(existing_req)
                    logger.debug(f"[DOCTOR:SCHEDULE] Updated granular ApprovalRequest {existing_req.id} for {meta_tag}")
            else:
                new_req = ApprovalRequest(
                    tenant_id=doctor.tenant_id,
                    requested_by_id=user_id,
                    entity_type=entity_type,
                    entity_id=doctor.id,
                    changes=payload,
                    reason=reason,
                    status=ApprovalRequestStatus.PENDING,
                    required_level=1
                )
                db.session.add(new_req)
                changed = True
                touched_requests.append(new_req)
                logger.debug(f"[DOCTOR:SCHEDULE] Created new granular ApprovalRequest for {meta_tag}")

        if 'slot_pricing' in data:
            new_pricing = data['slot_pricing'] or []
            old_pricing = doctor.slot_pricing or []
            
            if json.dumps(old_pricing, sort_keys=True) != json.dumps(new_pricing, sort_keys=True):
                doctor.slot_pricing = new_pricing
                flag_modified(doctor, 'slot_pricing')
                changed = True
            
            # Generate modular approval requests per consultation type
            types_in_pricing = set([p.get('consultation_type', 'complete') for p in new_pricing] + 
                                   [p.get('consultation_type', 'complete') for p in old_pricing])
                                   
            for t in types_in_pricing:
                old_p = [p for p in doctor.approved_slot_pricing or [] if p.get('consultation_type', 'complete') == t]
                new_p = [p for p in new_pricing if p.get('consultation_type', 'complete') == t]
                
                # Compare against APPROVED pricing to see if a request is needed
                if json.dumps(old_p, sort_keys=True) != json.dumps(new_p, sort_keys=True):
                    create_or_update_request(ApprovalEntityType.DOCTOR_FEE, {'category': 'pricing', 'type': t}, new_p, f"Updated {t} pricing")
                else:
                    # Cancel pending request if it matches the approved state
                    stale_reqs = ApprovalRequest.query.filter_by(
                        tenant_id=doctor.tenant_id,
                        entity_id=doctor.id, entity_type=ApprovalEntityType.DOCTOR_FEE, status=ApprovalRequestStatus.PENDING
                    ).all()
                    for r in stale_reqs:
                        if r.changes and r.changes.get('_meta') == {'category': 'pricing', 'type': t}:
                            r.status = ApprovalRequestStatus.CANCELLED
                            r.completed_at = rbac_utcnow()

        if 'availability_config' in data:
            from app.api.common.timeslot.slot_approval import diff_slot_lists

            SCHED_TYPES = ["video", "audio", "chat", "home_visit", "clinic_visit", "camp"]
            new_config = data['availability_config'] or {}
            old_config = doctor.availability_config or {}
            approved_wh = doctor.approved_working_days or {}
            approved_do = doctor.approved_day_overrides or {}

            # ── Working hours: iterate the union of (type, day) keys across the
            # draft and the approved snapshot, diffing each slot list. ──────────
            new_wh = new_config.get('working_days', {}) or {}

            def _wh_is_modular(wh):
                return any(k in SCHED_TYPES for k in (wh or {}).keys())

            def _wh_keys(wh):
                keys = set()
                if _wh_is_modular(wh):
                    for t, days in (wh or {}).items():
                        if t in SCHED_TYPES and isinstance(days, dict):
                            for day in days:
                                keys.add((t, day))
                else:
                    for day in (wh or {}):
                        keys.add(('global', day))
                return keys

            def _wh_get(wh, t, day):
                if t == 'global':
                    return wh.get(day, []) if not _wh_is_modular(wh) else []
                return (wh.get(t, {}) or {}).get(day, [])

            for (t, day) in _wh_keys(new_wh) | _wh_keys(approved_wh):
                live_slots = _wh_get(new_wh, t, day)
                appr_slots = _wh_get(approved_wh, t, day)
                diff = diff_slot_lists(live_slots, appr_slots)
                for slot in diff['changed']:
                    meta = {'category': 'working_hours', 'type': t, 'day': day, 'slot_id': slot['id']}
                    create_or_update_request(
                        ApprovalEntityType.DOCTOR_AVAILABILITY, meta, slot,
                        f"Updated {t} {day} slot {slot.get('start')}-{slot.get('end')}")
                for slot in diff['removed']:
                    meta = {'category': 'working_hours', 'type': t, 'day': day, 'slot_id': slot['id']}
                    create_or_update_request(
                        ApprovalEntityType.DOCTOR_AVAILABILITY, meta,
                        {'id': slot['id'], '_deleted': True},
                        f"Removed {t} {day} slot {slot.get('start')}-{slot.get('end')}")

            # ── Calendar day_overrides: diff each date's slot list per slot. ────
            new_do = new_config.get('day_overrides', {}) or {}
            for date_str in set(new_do.keys()) | set(approved_do.keys()):
                live_slots = new_do.get(date_str, [])
                appr_slots = approved_do.get(date_str, [])
                diff = diff_slot_lists(live_slots, appr_slots)
                for slot in diff['changed']:
                    meta = {'category': 'calendar', 'type': 'global', 'date': date_str, 'slot_id': slot['id']}
                    create_or_update_request(
                        ApprovalEntityType.DOCTOR_AVAILABILITY, meta, slot,
                        f"Updated {date_str} slot {slot.get('start')}-{slot.get('end')}")
                for slot in diff['removed']:
                    meta = {'category': 'calendar', 'type': 'global', 'date': date_str, 'slot_id': slot['id']}
                    create_or_update_request(
                        ApprovalEntityType.DOCTOR_AVAILABILITY, meta,
                        {'id': slot['id'], '_deleted': True, 'date': date_str},
                        f"Removed {date_str} slot {slot.get('start')}-{slot.get('end')}")

            # Persist the draft config with slot ids/statuses stamped by the diffs.
            if json.dumps(old_config, sort_keys=True) != json.dumps(new_config, sort_keys=True):
                doctor.availability_config = new_config
                flag_modified(doctor, 'availability_config')
                changed = True

            # Compare Global Configurations (slot sizing — not a per-slot concern).
            global_keys = ['slot_size', 'slot_gap', 'start_ceiling', 'exceptions']
            old_glob = {k: old_config.get(k) for k in global_keys}
            new_glob = {k: new_config.get(k) for k in global_keys}
            if json.dumps(old_glob, sort_keys=True) != json.dumps(new_glob, sort_keys=True):
                create_or_update_request(
                    ApprovalEntityType.DOCTOR_AVAILABILITY,
                    {'category': 'global_config', 'type': 'global'}, new_glob,
                    "Updated global availability settings")

            # ── Cancel stale per-slot requests (slot reverted to approved). ─────
            pending_av = ApprovalRequest.query.filter_by(
                tenant_id=doctor.tenant_id, entity_id=doctor.id,
                entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
                status=ApprovalRequestStatus.PENDING,
            ).all()
            for r in pending_av:
                m = (r.changes or {}).get('_meta') or {}
                if m.get('category') in ('working_hours', 'calendar') and m.get('slot_id'):
                    if json.dumps(m, sort_keys=True) not in active_meta_keys:
                        r.status = ApprovalRequestStatus.CANCELLED
                        r.completed_at = rbac_utcnow()
                        changed = True

        if not changed:
            schedule_data = DoctorService.get_schedule(user_id)
            schedule_data['_no_changes'] = True
            schedule_data['_message'] = "No changes detected or modifications match already approved settings."
            return schedule_data

        # Doctor-wide rollup flag is now informational only (no longer gates
        # patient visibility — that follows per-slot approval). PENDING while any
        # availability/fee request is still open, else APPROVED.
        still_pending = ApprovalRequest.query.filter(
            ApprovalRequest.tenant_id == doctor.tenant_id,
            ApprovalRequest.entity_id == doctor.id,
            ApprovalRequest.entity_type.in_([
                ApprovalEntityType.DOCTOR_AVAILABILITY, ApprovalEntityType.DOCTOR_FEE,
            ]),
            ApprovalRequest.status == ApprovalRequestStatus.PENDING,
        ).count()
        if still_pending:
            doctor.availability_approval_status = AvailabilityApprovalStatus.PENDING
            doctor.availability_approval_requested_at = rbac_utcnow()
        else:
            doctor.availability_approval_status = AvailabilityApprovalStatus.APPROVED

        if changed:
            db.session.commit()

            # ── Materialize APPROVED day_overrides → TimeSlot DB rows ──────────
            # Only admin-approved dated slots become bookable. The doctor's draft
            # (pending/rejected) edits never reach patients until approved.
            if 'availability_config' in data:
                try:
                    from app.api.common.timeslot.service import TimeSlotService
                    TimeSlotService.materialize_day_overrides(
                        doctor_id=doctor.id,
                        day_overrides=doctor.approved_day_overrides or {},
                    )
                    logger.debug("[DOCTOR:SCHEDULE] Materialized approved day_overrides → time_slots")
                except Exception as e:
                    db.session.rollback()
                    logger.error(f"[DOCTOR:SCHEDULE] Failed to materialize slots: {e}", exc_info=True)
                    # Non-fatal — JSON-based compute_slots still works as fallback

            DoctorService._review_support_schedule(touched_requests)

        return DoctorService.get_schedule(user_id)

    @staticmethod
    def _review_support_schedule(requests):
        """Review, on the spot, schedule requests a senior admin raised from
        Operations — the availability counterpart of
        :meth:`~app.api.field_approval.service.FieldApprovalService
        ._review_support_edit`.

        A no-op outside the act-on-behalf proxy, and for an operator junior to
        ``SELF_APPROVE_MIN_ROLE_LEVEL``, so a doctor editing their own working
        hours still waits for a reviewer exactly as before.

        Availability doesn't use ``FieldApprovalRequest`` — it raises one
        ``ApprovalRequest`` per slot, mirrored onto the doctor's approved
        snapshot on review — so it needs its own call here, but the bargain is
        identical: the row is written in full and then reviewed by the admin who
        raised it, rather than skipped. It goes through the same
        ``process_action`` + ``apply_doctor_availability_sync`` pair the admin
        availability screen uses, which is what re-materialises ``time_slots``
        so the newly-approved slots are actually bookable.

        Only the requests THIS save created or changed are reviewed. Approving
        everything pending for the doctor would clear submissions the admin
        never looked at.

        Per-request failures are logged and skipped, matching the batch-approve
        route: the save itself already committed, and one bad row leaving a
        slot pending is recoverable from the approvals screen.
        """
        from app.common.profile_audit import self_approving_admin

        admin = self_approving_admin()
        if admin is None or not requests:
            return

        from app.api.admin.rbac.services import ApprovalService
        from app.models import ApprovalRequestStatus

        for req in requests:
            if req.status != ApprovalRequestStatus.PENDING:
                continue
            try:
                approval = ApprovalService.process_action(
                    str(req.id), 'approve', admin.id,
                    'Raised from Operations by an admin acting on this '
                    "doctor's behalf, and reviewed by them on submission.",
                )
                ApprovalService.apply_doctor_availability_sync(approval, admin.id)
            except Exception as e:  # noqa: BLE001 — one bad row must not abort
                logger.error(
                    '[DOCTOR:SCHEDULE] support review failed for request %s: %s',
                    req.id, e, exc_info=True,
                )

    # --------------- Slot Visibility Window ---------------

    @staticmethod
    def get_slot_visibility(user_id):
        """Return slot visibility gap config and its approval state."""
        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None
        return {
            'slot_visibility_gap': doctor.slot_visibility_gap or {},
            'slot_visibility_approval_status': doctor.slot_visibility_approval_status.value,
            'slot_visibility_approved_gap': doctor.slot_visibility_approved_gap or {},
            'slot_visibility_approval_requested_at': (
                doctor.slot_visibility_approval_requested_at.isoformat()
                if doctor.slot_visibility_approval_requested_at else None
            ),
            'slot_visibility_approved_at': (
                doctor.slot_visibility_approved_at.isoformat()
                if doctor.slot_visibility_approved_at else None
            ),
            'slot_visibility_rejection_reason': doctor.slot_visibility_rejection_reason,
        }

    @staticmethod
    def update_slot_visibility(user_id, gap_by_type: dict):
        """
        Doctor submits a new per-type slot visibility gap for admin approval.

        gap_by_type: { "video": 10, "audio": 0, "chat": 5, ... }
        All values must be non-negative integers (minutes). 0 = emergency.
        Allowed values: 0, 5, 10, 15, …, 120 (multiples of 5 up to 120).
        """
        from app.models import SCHEDULABLE_CONSULTATION_TYPES, AvailabilityApprovalStatus
        from sqlalchemy.orm.attributes import flag_modified

        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None, 'Doctor not found'

        # Validate values
        valid_gaps = {0} | set(range(5, 125, 5))
        for ct, gap in gap_by_type.items():
            if ct not in SCHEDULABLE_CONSULTATION_TYPES:
                return None, f"Unknown consultation type: '{ct}'"
            if not isinstance(gap, int) or gap not in valid_gaps:
                return None, f"Gap for '{ct}' must be 0 or a multiple of 5 up to 120, got {gap}"

        doctor.slot_visibility_gap = gap_by_type
        flag_modified(doctor, 'slot_visibility_gap')
        doctor.slot_visibility_approval_requested_at = datetime.now(timezone.utc)
        doctor.slot_visibility_rejection_reason = None

        # Approval matrix: when this doctor's slot_visibility mode is 'auto', apply
        # the change live immediately (mirror approve_slot_visibility) instead of
        # queuing it for admin approval. 'manual' keeps today's PENDING behaviour.
        from app.api.admin.approval_policy_service import effective_permission_mode
        if effective_permission_mode(doctor, 'slot_visibility') == 'auto':
            doctor.slot_visibility_approved_gap = dict(gap_by_type)
            flag_modified(doctor, 'slot_visibility_approved_gap')
            doctor.slot_visibility_approval_status = AvailabilityApprovalStatus.APPROVED
            doctor.slot_visibility_approved_at = datetime.now(timezone.utc)
        else:
            doctor.slot_visibility_approval_status = AvailabilityApprovalStatus.PENDING
            doctor.slot_visibility_approved_at = None

        db.session.commit()
        return DoctorService.get_slot_visibility(user_id), None

    @staticmethod
    def approve_slot_visibility(doctor_id, reviewer_id):
        """Super admin approves the submitted slot visibility gap."""
        from app.models import AvailabilityApprovalStatus
        from sqlalchemy.orm.attributes import flag_modified

        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        if not doctor:
            return None, 'Doctor not found'
        if doctor.slot_visibility_approval_status != AvailabilityApprovalStatus.PENDING:
            return None, 'No pending slot visibility request'

        doctor.slot_visibility_approved_gap = dict(doctor.slot_visibility_gap or {})
        flag_modified(doctor, 'slot_visibility_approved_gap')
        doctor.slot_visibility_approval_status = AvailabilityApprovalStatus.APPROVED
        doctor.slot_visibility_approved_at = datetime.now(timezone.utc)

        db.session.commit()
        return {'approved': True, 'slot_visibility_approved_gap': doctor.slot_visibility_approved_gap}, None

    @staticmethod
    def reject_slot_visibility(doctor_id, reviewer_id, reason: str = ''):
        """Super admin rejects the submitted slot visibility gap."""
        from app.models import AvailabilityApprovalStatus

        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        if not doctor:
            return None, 'Doctor not found'

        doctor.slot_visibility_approval_status = AvailabilityApprovalStatus.REJECTED
        doctor.slot_visibility_rejection_reason = reason

        db.session.commit()
        return {'rejected': True, 'reason': reason}, None

    # --------------- Admin Request (Raise a Request) ---------------

    @staticmethod
    def create_admin_request(user_id, consultation_type, remarks, attachment_paths: list = None):
        """Doctor raises a request / complaint to admin."""
        from app.models import DoctorAdminRequest

        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return None, 'Doctor not found'
        if not remarks or not remarks.strip():
            return None, 'Remarks are required'

        req = DoctorAdminRequest(
            tenant_id=doctor.tenant_id,
            doctor_id=doctor.id,
            consultation_type=consultation_type or None,
            remarks=remarks.strip(),
            attachments=attachment_paths or [],
            status='pending',
        )
        db.session.add(req)
        db.session.commit()
        return req, None

    @staticmethod
    def get_admin_requests(user_id, status=None, page=1, per_page=20):
        """Get admin requests raised by this doctor."""
        from app.models import DoctorAdminRequest

        doctor = DoctorService.get_by_user_id(user_id)
        if not doctor:
            return {'requests': [], 'total': 0}

        q = DoctorAdminRequest.query.filter_by(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id,
        )
        if status:
            q = q.filter_by(status=status)
        q = q.order_by(DoctorAdminRequest.created_at.desc())
        page_obj = q.paginate(page=page, per_page=per_page, error_out=False)

        return {
            'requests': [r.to_dict() for r in page_obj.items],
            'total': page_obj.total,
            'page': page_obj.page,
            'pages': page_obj.pages,
        }

    # --------------- Admin-side: Slot Visibility Pending Requests ---------------

    @staticmethod
    def get_pending_slot_visibility_requests():
        """
        Super admin: list all doctors who have submitted slot visibility requests
        with status 'pending'.
        """
        from app.models import AvailabilityApprovalStatus

        doctors = Doctor.query.filter(
            Doctor.tenant_id == current_tenant_id_strict(),
            Doctor.slot_visibility_approval_status == AvailabilityApprovalStatus.PENDING,
            Doctor.is_deleted == False,
        ).order_by(Doctor.slot_visibility_approval_requested_at.asc()).all()

        result = []
        for d in doctors:
            # Convert enum to plain string to avoid JSON serialization errors
            status = d.slot_visibility_approval_status
            if hasattr(status, 'value'):
                status_str = status.value
            elif status is not None:
                status_str = str(status)
            else:
                status_str = 'not_submitted'

            result.append({
                'doctor_id': str(d.id),
                'full_name': f"{d.first_name or ''} {d.last_name or ''}".strip(),
                'requested_at': d.slot_visibility_approval_requested_at.isoformat()
                    if d.slot_visibility_approval_requested_at else None,
                'requested_gap': dict(d.slot_visibility_gap) if d.slot_visibility_gap else {},
                'currently_approved_gap': dict(d.slot_visibility_approved_gap) if d.slot_visibility_approved_gap else {},
                'approval_status': status_str,
            })
        return result

    # --------------- Admin-side: All Doctor Admin Requests ---------------

    @staticmethod
    def get_all_admin_requests(status=None, page=1, per_page=20):
        """Super admin: list admin requests raised by all doctors."""
        from app.models import DoctorAdminRequest

        q = DoctorAdminRequest.query
        if status:
            q = q.filter_by(status=status)
        q = q.order_by(DoctorAdminRequest.created_at.desc())
        page_obj = q.paginate(page=page, per_page=per_page, error_out=False)

        items = []
        for r in page_obj.items:
            d = r.doctor
            item = r.to_dict()
            item['doctor_name'] = f"{d.first_name or ''} {d.last_name or ''}".strip() if d else ''
            items.append(item)

        return {
            'requests': items,
            'total': page_obj.total,
            'page': page_obj.page,
            'pages': page_obj.pages,
        }

    @staticmethod
    def respond_admin_request(request_id, new_status, admin_response, reviewer_id):
        """Super admin responds to a doctor's admin request."""
        from app.models import DoctorAdminRequest
        from datetime import datetime, timezone

        req = DoctorAdminRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=request_id,
        ).first()
        if not req:
            return None, 'Request not found'

        valid_statuses = ('pending', 'in_review', 'resolved', 'rejected')
        if new_status not in valid_statuses:
            return None, f'Invalid status. Must be one of: {", ".join(valid_statuses)}'

        req.status = new_status
        req.admin_response = admin_response
        req.reviewed_by_id = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        db.session.commit()
        return req, None

    # --------------- Compute Slots ---------------

    @staticmethod
    def approved_availability_config(doctor) -> dict:
        """Build a patient-facing availability config from APPROVED snapshots.

        Per-slot approval keeps the doctor's live ``availability_config`` as a
        draft (pending/rejected edits live there). Patient-facing slot
        computation must instead read the admin-approved snapshots:
          * ``day_overrides`` ← ``approved_day_overrides``
          * ``working_days``  ← ``approved_working_days``
        Global sizing keys (slot_size/slot_gap/start_ceiling/exceptions) are
        taken from the live config — they are approved in place via the
        ``global_config`` request path.
        """
        cfg = dict(doctor.availability_config or {})
        cfg['day_overrides'] = doctor.approved_day_overrides or {}
        cfg['working_days'] = doctor.approved_working_days or {}
        return cfg

    @staticmethod
    def compute_slots(date_str: str, availability_config: dict, doctor_id=None) -> list:
        """
        Compute available slot start times for a given date.

        Steps:
          1. Check exceptions → if 'blocked', return [].
          2. Get day-of-week from date_str (e.g. 'Monday').
          3. Look up duty hours for that day.
          4. For each {start, end} block:
             a. Apply start_ceiling to the block start.
             b. Iterate: emit slot every (slot_size + slot_gap) minutes
                while slot_start + slot_size <= block_end.
          5. Optionally filter already-booked slots if doctor_id given.

        Ceiling rule:
          - If start time is on an exact boundary → keep it.
          - If start time is past a boundary → ceil up to next boundary.

        Returns:
          List of dicts: [{"start": "09:00", "end": "09:15", "duration": 15}]
        """
        if not availability_config:
            return []

        from datetime import date as date_type
        try:
            d = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return []

        # 1. Check Day Overrides (Manual edits from calendar)
        day_overrides = availability_config.get('day_overrides', {})
        if date_str in day_overrides:
            # Overrides take precedence. If list is empty, it means day is blocked.
            slots = [dict(s) for s in day_overrides[date_str]]
            # Ensure duration is present (frontend might not send it for every slot)
            slot_size = int(availability_config.get('slot_size', 15))
            for s in slots:
                if 'duration' not in s:
                    s['duration'] = s.get('size', slot_size)
        else:
            # No day_override — compute slots from working_days config
            day_name = d.strftime('%A')  # e.g. 'Monday'
            working_days = availability_config.get('working_days', {})
            slot_size = int(availability_config.get('slot_size', 15))
            slot_gap = int(availability_config.get('slot_gap', 0))

            # working_days can be per-type: { "video": {"Monday": [...]}, ... }
            # or legacy flat: { "Monday": [{start, end}] }
            from app.models import SCHEDULABLE_CONSULTATION_TYPES
            is_per_type = any(k in SCHEDULABLE_CONSULTATION_TYPES for k in working_days)

            duty_windows = []
            if is_per_type:
                # Merge windows from all types for this day
                for type_key in SCHEDULABLE_CONSULTATION_TYPES:
                    type_days = working_days.get(type_key, {})
                    for w in type_days.get(day_name, []):
                        duty_windows.append((w, [type_key]))
            else:
                for w in working_days.get(day_name, []):
                    duty_windows.append((w, ['complete']))

            if not duty_windows:
                return []

            slots = []
            for window, consultation_types in duty_windows:
                start_str = window.get('start', '00:00')
                end_str = window.get('end', '00:00')
                start_parts = start_str.split(':')
                end_parts = end_str.split(':')
                start_min = int(start_parts[0]) * 60 + int(start_parts[1])
                end_min = int(end_parts[0]) * 60 + int(end_parts[1])
                step = slot_size + slot_gap
                cursor = start_min
                while cursor + slot_size <= end_min:
                    s_h, s_m = divmod(cursor, 60)
                    e_h, e_m = divmod(cursor + slot_size, 60)
                    slots.append({
                        'start': f'{s_h:02d}:{s_m:02d}',
                        'end': f'{e_h:02d}:{e_m:02d}',
                        'duration': slot_size,
                        'size': slot_size,
                        'gap': slot_gap,
                        'consultation_types': consultation_types,
                    })
                    cursor += step

        # 5. Filter booked slots if doctor_id provided
        if doctor_id and slots:
            booked = Appointment.query.filter(
                Appointment.tenant_id == current_tenant_id_strict(),
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == d,
                Appointment.status.in_([
                    AppointmentStatus.PENDING_PAYMENT,
                    AppointmentStatus.PENDING,
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.IN_PROGRESS,
                ]),
                Appointment.is_deleted == False,
            ).all()

            booked_starts = {a.start_time.strftime('%H:%M') for a in booked if a.start_time}
            slots = [s for s in slots if s['start'] not in booked_starts]

        # 6. Filter past slots if the date is today
        now = datetime.now()
        if d == now.date():
            current_time = now.time()
            # s['start'] is in 'HH:MM' format, time.fromisoformat parses it to a time object
            slots = [s for s in slots if time.fromisoformat(s['start']) > current_time]

        return slots

    # --------------- Marketplace ---------------

    @staticmethod
    def get_marketplace_products(doctor_id):
        from app.models import DoctorMarketplaceProduct
        products = DoctorMarketplaceProduct.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).all()
        return [p.to_dict() for p in products]

    @staticmethod
    def select_marketplace_product(doctor_id, data):
        from app.models import DoctorMarketplaceProduct, DoctorProduct
        tid = current_tenant_id_strict()
        product_id = data.get('product_id')
        doctor_price = data.get('doctor_price')
        doctor_description = data.get('doctor_description')

        if not product_id or doctor_price is None:
            raise ValueError("product_id and doctor_price are required")

        # Validate product exists and is active in admin catalog
        admin_product = DoctorProduct.query.filter_by(
            tenant_id=tid, id=product_id, is_active=True, is_deleted=False,
        ).first()
        if not admin_product:
            raise ValueError("Invalid or inactive product")

        # Eligibility criteria the admin set on the catalog item (required
        # degrees / work qualification / experience). A product with no
        # criteria stays offerable by anyone.
        from app.api.admin.product_eligibility import check_product_eligibility
        eligible, reason = check_product_eligibility(admin_product, doctor_id, tid)
        if not eligible:
            raise ValueError(reason)

        # Validate price range
        try:
            price = float(doctor_price)
        except (TypeError, ValueError):
            raise ValueError("Price must be a number")

        if price < float(admin_product.min_price) or price > float(admin_product.max_price):
            raise ValueError(f"Price must be between {admin_product.min_price} and {admin_product.max_price}")

        # Re-submitting a listing sends it back through admin approval — unless
        # a senior admin is the one submitting it from Operations, in which case
        # it is approved on the spot. Same bargain as the doctor's profile
        # edits; see ``profile_audit.listing_approval_status_on_submit``.
        from app.common.profile_audit import listing_approval_status_on_submit
        from app.models import Doctor
        status = listing_approval_status_on_submit(
            Doctor.query.get(doctor_id), 'group_plan')

        # Check if already selected
        existing = DoctorMarketplaceProduct.query.filter_by(
            tenant_id=tid, doctor_id=doctor_id, product_id=product_id,
        ).first()
        if existing:
            existing.doctor_price = price
            existing.doctor_description = doctor_description
            existing.is_active = True
            existing.approval_status = status
            existing.rejection_reason = None
            db.session.commit()
            return existing

        new_mp_product = DoctorMarketplaceProduct(
            tenant_id=tid,
            doctor_id=doctor_id,
            product_id=product_id,
            doctor_price=price,
            doctor_description=doctor_description,
            approval_status=status,
        )
        db.session.add(new_mp_product)
        db.session.commit()
        return new_mp_product

    @staticmethod
    def update_marketplace_product(doctor_id, mp_product_id, data):
        from app.models import DoctorMarketplaceProduct
        mp_product = DoctorMarketplaceProduct.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=mp_product_id, doctor_id=doctor_id,
        ).first()
        if not mp_product:
            return None

        if 'doctor_price' in data:
            price = float(data['doctor_price'])
            admin_product = mp_product.product
            if price < float(admin_product.min_price) or price > float(admin_product.max_price):
                raise ValueError(f"Price must be between {admin_product.min_price} and {admin_product.max_price}")
            mp_product.doctor_price = price

        if 'doctor_description' in data:
            mp_product.doctor_description = data['doctor_description']

        if 'is_active' in data:
            mp_product.is_active = bool(data['is_active'])

        # A change to price / description needs re-approval (the admin-imposed
        # tax + consultation details live on the base product, not here) —
        # already granted when a senior admin made the change from Operations.
        if 'doctor_price' in data or 'doctor_description' in data:
            from app.common.profile_audit import listing_approval_status_on_submit
            from app.models import Doctor
            mp_product.approval_status = listing_approval_status_on_submit(
                Doctor.query.get(doctor_id), 'group_plan')
            mp_product.rejection_reason = None

        db.session.commit()
        return mp_product

    @staticmethod
    def remove_marketplace_product(doctor_id, mp_product_id):
        from app.models import DoctorMarketplaceProduct
        mp_product = DoctorMarketplaceProduct.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=mp_product_id, doctor_id=doctor_id,
        ).first()
        if not mp_product:
            return False

        db.session.delete(mp_product)
        db.session.commit()
        return True

    # --------------- Signatures ---------------

    @staticmethod
    def get_signatures(doctor_id):
        """Get doctor's signature records."""
        from app.models import ProfileSignature
        return ProfileSignature.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()

    @staticmethod
    def save_signatures(doctor_id, user_id, files):
        """
        Upload and save signature files. Creates or updates the ProfileSignature record.
        Returns the updated ProfileSignature instance.
        """
        import logging
        from app.models import ProfileSignature, DocumentVerificationStatus
        from app.services.s3_service import S3Service

        logger = logging.getLogger(__name__)

        record = ProfileSignature.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()
        if not record:
            record = ProfileSignature(
                tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
                profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, current_tenant_id_strict()).id,
            )
            db.session.add(record)

        # Helper to upload a file and update the corresponding columns
        def _upload_and_set(file_obj, attr_prefix):
            result = S3Service.upload_file(
                file_obj, attr_prefix, file_obj.filename,
                is_private=True,
                folder=f'doctors/signatures/{user_id}'
            )
            setattr(record, f'{attr_prefix}_url', S3Service.generate_presigned_url(result['s3_bucket'], result['s3_key']))
            setattr(record, f'{attr_prefix}_s3_key', result['s3_key'])
            setattr(record, f'{attr_prefix}_s3_bucket', result['s3_bucket'])
            setattr(record, f'{attr_prefix}_verification_status', DocumentVerificationStatus.PENDING)

        if 'signature1' in files:
            _upload_and_set(files['signature1'], 'signature1')

        if 'signature2' in files:
            _upload_and_set(files['signature2'], 'signature2')

        if 'digitalSignature' in files:
            _upload_and_set(files['digitalSignature'], 'digital_signature')

        db.session.commit()

        # Create an approval request for admin review
        DoctorService._create_approval_request(
            user_id=user_id,
            doctor_id=doctor_id,
            entity_type_value='DOCTOR_SIGNATURE',
            changes={'signatures_updated': True},
            reason='Doctor uploaded new signature files',
        )

        # Refresh presigned URLs before returning
        record = DoctorService._refresh_signature_urls(record)

        return record

    @staticmethod
    def _refresh_signature_urls(record):
        """No-op, kept for call-site compatibility.

        ``ProfileSignature.to_response_dict`` now signs fresh from the
        ``*_s3_key`` at read time. The old body ASSIGNED presigned URLs to
        the model — dirtying the session, so any later commit persisted a
        1-hour URL into the ``*_url`` column and every read after that
        hour served a dead link.
        """
        return record

    # --------------- About ---------------

    @staticmethod
    def get_about(doctor_id):
        """Get doctor's about info record."""
        from app.models import ProfileAbout
        return ProfileAbout.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()

    @staticmethod
    def get_work_qualifications(doctor_id):
        """Doctor's work qualifications (multi), primary-first. Lives on the
        profile_owner, so it's returned independent of whether a ProfileAbout
        record exists yet — the profile multi-select needs it on first open."""
        from app.models.profile_shared import ProfileWorkQualification
        rows = (
            ProfileWorkQualification.query
            .filter_by(tenant_id=current_tenant_id_strict(), doctor_id=doctor_id)
            .order_by(ProfileWorkQualification.is_primary.desc())
            .all()
        )
        return [w.to_dict() for w in rows]

    @staticmethod
    def save_about(doctor_id, user_id, form_data, files):
        """
        Save/update doctor about info (text fields + optional attachments).
        Returns the updated ProfileAbout instance.
        """
        from app.models import ProfileAbout, DocumentVerificationStatus
        from app.services.s3_service import S3Service

        record = ProfileAbout.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()
        if not record:
            record = ProfileAbout(
                tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
                profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, current_tenant_id_strict()).id,
            )
            db.session.add(record)

        # Map of form field name → (text attr, attachment url attr, attachment s3 key attr, attachment bucket attr, verification attr)
        field_map = {
            'briefAbout': ('brief_about_text', 'brief_about_attachment_url', 'brief_about_attachment_s3_key', 'brief_about_attachment_s3_bucket', 'brief_about_verification_status'),
            'natureOfWork': ('nature_of_work_text', 'nature_of_work_attachment_url', 'nature_of_work_attachment_s3_key', 'nature_of_work_attachment_s3_bucket', 'nature_of_work_verification_status'),
            'currentlyWorkingWith': ('currently_working_with_text', 'currently_working_with_attachment_url', 'currently_working_with_attachment_s3_key', 'currently_working_with_attachment_s3_bucket', 'currently_working_with_verification_status'),
        }

        # Approval-queue field labels (what the admin queue + doctor chips key
        # on). Collected per changed field so update_about can raise an
        # about_me FieldApprovalRequest for each.
        about_labels = {
            'briefAbout': 'brief_about',
            'natureOfWork': 'nature_of_work',
            'currentlyWorkingWith': 'currently_working_with',
        }
        about_changes = []

        changed = False
        for form_key, (text_attr, url_attr, s3_key_attr, s3_bucket_attr, verif_attr) in field_map.items():
            # Handle text field
            if form_key in form_data:
                new_text = form_data[form_key]
                old_text = getattr(record, text_attr)
                # The About form posts all three text fields on every save, so
                # normalise None/'' to avoid a no-op (untouched empty field)
                # being treated as a change — which would raise a spurious
                # PENDING + approval request for a field the doctor never edited.
                if (old_text or '') != (new_text or ''):
                    setattr(record, text_attr, new_text)
                    setattr(record, verif_attr, DocumentVerificationStatus.PENDING)
                    changed = True
                    about_changes.append({
                        'field': about_labels[form_key],
                        'old': old_text, 'new': new_text, 'is_file': False,
                    })

            # Handle attachment file
            attachment_key = f'{form_key}Attachment'
            if attachment_key in files:
                file_obj = files[attachment_key]
                result = S3Service.upload_file(
                    file_obj, form_key, file_obj.filename,
                    is_private=True,
                    folder=f'doctors/about/{user_id}'
                )
                setattr(record, url_attr, S3Service.generate_presigned_url(result['s3_bucket'], result['s3_key']))
                setattr(record, s3_key_attr, result['s3_key'])
                setattr(record, s3_bucket_attr, result['s3_bucket'])
                setattr(record, verif_attr, DocumentVerificationStatus.PENDING)
                changed = True
                about_changes.append({
                    'field': f'{about_labels[form_key]}_attachment',
                    'old': None, 'new': file_obj.filename, 'is_file': True,
                })

        # Work qualification — a single pick from the admin-curated master list.
        # Goes through the same PENDING + approval-request path as the blocks
        # above; '' clears it.
        if 'workQualification' in form_data:
            from app.models import Category
            from app.models.catalog import CATEGORY_TYPE_WORK_QUALIFICATION

            raw = (form_data.get('workQualification') or '').strip()
            new_id = None
            if raw:
                choice = Category.query.filter_by(
                    tenant_id=current_tenant_id_strict(),
                    id=raw,
                    category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
                    is_active=True,
                ).first()
                if not choice:
                    raise ValueError('Invalid work qualification')
                new_id = choice.id

            if record.work_qualification_id != new_id:
                record.work_qualification_id = new_id
                record.work_qualification_verification_status = DocumentVerificationStatus.PENDING
                changed = True

        # Work qualifications — MULTI. A doctor may hold several; the public
        # booking widget groups / filters by these (supersedes the single
        # pick above). Sent as a JSON array of work-qualification Category
        # ids; the FIRST id is the primary (shown on the doctor card). Syncs
        # the ``ProfileWorkQualification`` link rows to match the list.
        if 'workQualifications' in form_data:
            import json as _json
            from app.models import Category
            from app.models.catalog import CATEGORY_TYPE_WORK_QUALIFICATION
            from app.models.profile_shared import ProfileWorkQualification

            raw = form_data.get('workQualifications')
            if isinstance(raw, str):
                try:
                    ids = _json.loads(raw) if raw.strip() else []
                except ValueError:
                    raise ValueError('workQualifications must be a JSON array')
            else:
                ids = list(raw or [])
            ids = [str(x) for x in ids if x]

            tid = current_tenant_id_strict()
            valid = {}
            if ids:
                rows = Category.query.filter(
                    Category.tenant_id == tid,
                    Category.id.in_(ids),
                    Category.category_type == CATEGORY_TYPE_WORK_QUALIFICATION,
                    Category.is_active.is_(True),
                ).all()
                valid = {str(c.id): c for c in rows}
                if [i for i in ids if i not in valid]:
                    raise ValueError('Invalid work qualification(s)')

            existing_rows = ProfileWorkQualification.query.filter_by(
                tenant_id=tid, profile_owner_id=record.profile_owner_id,
            ).all()
            existing = {str(w.category_id): w for w in existing_rows}

            # Old set as human-readable names (primary first), for the approval
            # queue's old→new display, captured before the sync mutates rows.
            old_wq_names = ', '.join(
                (w.category.name if w.category else str(w.category_id))
                for w in sorted(existing_rows, key=lambda x: (not x.is_primary))
            )

            wq_changed = False
            for cid, w in existing.items():
                if cid not in valid:
                    db.session.delete(w)
                    changed = True
                    wq_changed = True
            for idx, cid in enumerate(ids):
                w = existing.get(cid)
                if w is None:
                    db.session.add(ProfileWorkQualification(
                        tenant_id=tid,
                        profile_owner_id=record.profile_owner_id,
                        doctor_id=record.doctor_id,
                        category_id=valid[cid].id,
                        is_primary=(idx == 0),
                    ))
                    changed = True
                    wq_changed = True
                elif w.is_primary != (idx == 0):
                    w.is_primary = (idx == 0)
                    changed = True
                    wq_changed = True

            if wq_changed:
                new_wq_names = ', '.join(valid[cid].name for cid in ids)
                about_changes.append({
                    'field': 'work_qualifications',
                    'old': old_wq_names or None,
                    'new': new_wq_names or None,
                    'is_file': False,
                })

        # Work experience per education level. '' clears a level back to
        # "not stated", which a product's experience rule treats as unmet —
        # deliberately distinct from an explicit 0.
        experience_keys = {
            'ugExperienceYears': 'ug_experience_years',
            'pgExperienceYears': 'pg_experience_years',
            'superSpecialityExperienceYears': 'super_speciality_experience_years',
        }
        experience_changed = False
        for form_key, attr in experience_keys.items():
            if form_key not in form_data:
                continue
            raw = (form_data.get(form_key) or '').strip()
            if raw == '':
                new_years = None
            else:
                try:
                    new_years = int(raw)
                except (TypeError, ValueError):
                    raise ValueError(f'{form_key}: years must be a whole number')
                if new_years < 0:
                    raise ValueError(f'{form_key}: years cannot be negative')
                if new_years > 80:
                    raise ValueError(f'{form_key}: {new_years} years is not a plausible career length')
            if getattr(record, attr) != new_years:
                setattr(record, attr, new_years)
                experience_changed = True

        if experience_changed:
            record.experience_verification_status = DocumentVerificationStatus.PENDING
            changed = True

        if changed:
            db.session.commit()
            DoctorService._create_approval_request(
                user_id=user_id,
                doctor_id=doctor_id,
                entity_type_value='DOCTOR_ABOUT',
                changes={'about_updated': True},
                reason='Doctor updated about information',
            )

        # Refresh presigned URLs before returning
        record = DoctorService._refresh_about_urls(record)

        # ``about_changes`` drives the field-approval queue: update_about raises
        # one about_me FieldApprovalRequest per entry so the admin can review.
        return record, about_changes

    @staticmethod
    def _refresh_about_urls(record):
        """Regenerate presigned URLs for about attachment files."""
        from app.services.s3_service import S3Service
        if record.brief_about_attachment_s3_key:
            record.brief_about_attachment_url = S3Service.generate_presigned_url(record.brief_about_attachment_s3_bucket, record.brief_about_attachment_s3_key)
        if record.nature_of_work_attachment_s3_key:
            record.nature_of_work_attachment_url = S3Service.generate_presigned_url(record.nature_of_work_attachment_s3_bucket, record.nature_of_work_attachment_s3_key)
        if record.currently_working_with_attachment_s3_key:
            record.currently_working_with_attachment_url = S3Service.generate_presigned_url(record.currently_working_with_attachment_s3_bucket, record.currently_working_with_attachment_s3_key)
        return record

    # --------------- Education ---------------

    @staticmethod
    def get_education(doctor_id):
        """Get doctor's education record."""
        from app.models import ProfileEducation
        return ProfileEducation.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()

    @staticmethod
    def save_education(doctor_id, user_id, form_data, files):
        """
        Save/update doctor education info (JSON text fields + optional file uploads).
        Sections: graduation, postGraduation, superSpeciality, otherCertification.

        form_data keys (all optional):
            graduation_data (JSON string), post_graduation_data, super_speciality_data, other_certification_data
        files keys (all optional):
            graduation_certificate, graduation_marksheet,
            post_graduation_certificate, post_graduation_marksheet,
            super_speciality_certificate, super_speciality_marksheet,
            other_certification_certificate, other_certification_marksheet
        """
        import json as _json
        import logging
        from app.models import ProfileEducation, DocumentVerificationStatus
        from app.services.s3_service import S3Service

        _logger = logging.getLogger(__name__)

        record = ProfileEducation.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).first()
        if not record:
            record = ProfileEducation(
                tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
                profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, current_tenant_id_strict()).id,
            )
            db.session.add(record)

        changed = False
        # Per sub-section change capture for the field-approval queue (one row
        # per sub-section — graduation / post_graduation / super_speciality /
        # other_certification). Mirrors the About-Me pattern: the value is saved
        # now and the admin verifies afterward.
        changes_by_sub = {}
        s3_folder = f'doctors/education/{user_id}'

        # ── Helper: upload a file and update record attrs ────────────────────
        def _upload(file_obj, attr_prefix, subfolder):
            try:
                result = S3Service.upload_file(
                    file_obj, subfolder, file_obj.filename,
                    is_private=True,
                    folder=f'{s3_folder}/{subfolder}'
                )
                presigned = S3Service.generate_presigned_url(
                    result['s3_bucket'], result['s3_key']
                )
                setattr(record, f'{attr_prefix}_url', presigned)
                setattr(record, f'{attr_prefix}_s3_key', result['s3_key'])
                setattr(record, f'{attr_prefix}_s3_bucket', result['s3_bucket'])
                setattr(record, f'{attr_prefix}_verification_status', DocumentVerificationStatus.PENDING)
            except Exception as _e:
                _logger.warning(f'[EDUCATION] upload failed for {attr_prefix}: {_e}')

        # ── Section JSON data fields ─────────────────────────────────────────
        # Both spellings are accepted: the snake_case ``*_data`` keys this
        # endpoint documents, and the camelCase keys the web client actually
        # sends (see Frontend useEducationDetails.js). They were mismatched,
        # so every submit silently no-op'd — nothing matched, ``changed``
        # stayed False, and the commit below never ran.
        section_map = {
            'graduation_data':          'graduation_data',
            'graduation':               'graduation_data',
            'post_graduation_data':     'post_graduation_data',
            'postGraduation':           'post_graduation_data',
            'super_speciality_data':    'super_speciality_data',
            'superSpeciality':          'super_speciality_data',
            'other_certification_data': 'other_certification_data',
            'otherCertification':       'other_certification_data',
        }
        for form_key, model_attr in section_map.items():
            if form_key in form_data:
                try:
                    parsed = _json.loads(form_data[form_key])
                except (ValueError, TypeError):
                    _logger.warning(f'[EDUCATION] malformed JSON for {form_key}')
                    continue
                sub = model_attr[:-len('_data')]  # graduation_data -> graduation
                entry = changes_by_sub.setdefault(
                    sub, {'field': sub, 'old': None, 'new': None, 'is_file': False})
                entry['old'] = getattr(record, model_attr, None)
                entry['new'] = parsed
                setattr(record, model_attr, parsed)
                changed = True

        # ── File uploads ─────────────────────────────────────────────────────
        # ``attr_prefix`` is also the S3 subfolder, so both key spellings land
        # in the same place and existing objects stay reachable.
        file_map = {
            'graduation_certificate':            'graduation_certificate',
            'graduation_marksheet':              'graduation_marksheet',
            'post_graduation_certificate':       'post_graduation_certificate',
            'postGraduation_certificate':        'post_graduation_certificate',
            'post_graduation_marksheet':         'post_graduation_marksheet',
            'postGraduation_marksheet':          'post_graduation_marksheet',
            'super_speciality_certificate':      'super_speciality_certificate',
            'superSpeciality_certificate':       'super_speciality_certificate',
            'super_speciality_marksheet':        'super_speciality_marksheet',
            'superSpeciality_marksheet':         'super_speciality_marksheet',
            'other_certification_certificate':   'other_certification_certificate',
            'otherCertification_certificate':    'other_certification_certificate',
            'other_certification_marksheet':     'other_certification_marksheet',
            'otherCertification_marksheet':      'other_certification_marksheet',
        }
        for file_key, attr_prefix in file_map.items():
            if file_key in files:
                _upload(files[file_key], attr_prefix, attr_prefix)
                changed = True
                # graduation_certificate -> graduation, post_graduation_marksheet
                # -> post_graduation, etc.
                sub = attr_prefix.rsplit('_', 1)[0]
                entry = changes_by_sub.setdefault(
                    sub, {'field': sub, 'old': None, 'new': None, 'is_file': False})
                entry['is_file'] = True

        if changed:
            db.session.commit()
            # Write-through: sync the queryable FK stores
            # (ProfileEducationSpecialization + ProfileEducationDegree) that
            # patient search, doctor cards, appointment/prescription rendering
            # and product-gating actually read, from the JSON we just saved.
            # Runs in its own transaction and is best-effort — a name-resolution
            # or DB hiccup here must never fail the doctor's education save.
            try:
                DoctorService._sync_education_fk_from_json(record)
                db.session.commit()
            except Exception as _sync_err:
                db.session.rollback()
                _logger.warning(f'[EDUCATION] FK write-through skipped (non-fatal): {_sync_err}')
            DoctorService._create_approval_request(
                user_id=user_id,
                doctor_id=doctor_id,
                entity_type_value='DOCTOR_EDUCATION',
                changes={'education_updated': True},
                reason='Doctor updated education details',
            )
        else:
            # Nothing recognised in the payload — drop the pending row so we
            # don't leave a half-built object in the session, and let the
            # caller report the failure instead of claiming success.
            db.session.rollback()
            return None, False, []

        # Refresh presigned URLs before returning
        record = DoctorService._refresh_education_urls(record)
        return record, True, list(changes_by_sub.values())

    @staticmethod
    def _sync_education_fk_from_json(record):
        """Write-through the education JSON snapshots to the queryable FK stores.

        The profile Education form persists name strings in
        ``ProfileEducation.*_data``. Patient search, doctor cards, appointment /
        prescription rendering and product-gating all read the FK tables
        ``ProfileEducationSpecialization`` (JOIN categories) and
        ``ProfileEducationDegree`` instead. This keeps those in step with the
        form so an edit is reflected everywhere.

        Best-effort by design:
          * Names resolve to Category ids case-insensitively.
          * A DEACTIVATED category still matches, so a doctor's saved value is
            never silently dropped on re-save (unlike save_about, which hard-
            fails on a deactivated id).
          * Names that resolve to no Category (free-text / default fallbacks)
            are skipped; the JSON keeps them regardless.
          * Specializations dedupe by category_id (the table's UNIQUE key is
            tenant+owner+category); first level wins, graduation is primary.
          * Rows are only reconciled (delete-missing) when the form actually
            carries at least one specialization / degree, so an incidental save
            of an empty form never wipes signup-seeded rows.
        """
        from app.models import Category
        from app.models.catalog import (
            CATEGORY_TYPE_SPECIALIZATION, CATEGORY_TYPE_DEGREE,
        )
        from app.models.profile_shared import (
            ProfileEducationSpecialization, ProfileEducationDegree,
        )

        tid = record.tenant_id
        owner_id = record.profile_owner_id
        doctor_id = record.doctor_id

        def _txt(v):
            if v is None:
                return ''
            return v.strip() if isinstance(v, str) else str(v).strip()

        def _resolve(name, ctype):
            n = _txt(name)
            if not n:
                return None
            row = (Category.query
                   .filter(Category.tenant_id == tid,
                           Category.category_type == ctype,
                           db.func.lower(Category.name) == n.lower())
                   .order_by(Category.is_active.desc())
                   .first())
            return row.id if row else None

        # (json_attr, qualification_level, is_primary)
        sections = [
            ('graduation_data', 'ug', True),
            ('post_graduation_data', 'pg', False),
            ('super_speciality_data', 'super_speciality', False),
            ('other_certification_data', None, False),
        ]

        # ---- Specializations (dedupe by category_id) ----
        any_spec = any(
            _txt((getattr(record, a, None) or {}).get('specialization'))
            for a, _, _ in sections
        )
        if any_spec:
            desired = {}  # str(category_id) -> (level, is_primary)
            for attr, level, primary in sections:
                data = getattr(record, attr, None) or {}
                cid = _resolve(data.get('specialization'), CATEGORY_TYPE_SPECIALIZATION)
                if cid and str(cid) not in desired:
                    desired[str(cid)] = (level, primary)
            existing = {
                str(r.category_id): r
                for r in ProfileEducationSpecialization.query.filter_by(
                    tenant_id=tid, profile_owner_id=owner_id,
                ).all()
            }
            for cid, r in existing.items():
                if cid not in desired:
                    db.session.delete(r)
            for cid, (level, primary) in desired.items():
                r = existing.get(cid)
                if r is None:
                    db.session.add(ProfileEducationSpecialization(
                        tenant_id=tid, profile_owner_id=owner_id, doctor_id=doctor_id,
                        category_id=cid, qualification_level=level, is_primary=primary,
                    ))
                else:
                    r.qualification_level = level
                    r.is_primary = primary

        # ---- Degrees (no UNIQUE key: reconcile the 3 leveled sections) ----
        desired_deg = []
        for attr, level, primary in sections[:3]:
            data = getattr(record, attr, None) or {}
            dname = _txt(data.get('degree'))
            if not dname:
                continue
            raw_year = data.get('yearOfGraduation') or data.get('year_of_graduation')
            try:
                year = int(_txt(raw_year)) if _txt(raw_year) else None
            except (ValueError, TypeError):
                year = None
            desired_deg.append({
                'degree_name': dname,
                'institution': _txt(data.get('institute')) or None,
                'passing_year': year,
                'degree_category_id': _resolve(dname, CATEGORY_TYPE_DEGREE),
            })
        if desired_deg:
            for r in ProfileEducationDegree.query.filter_by(
                tenant_id=tid, profile_owner_id=owner_id,
            ).all():
                db.session.delete(r)
            db.session.flush()
            for d in desired_deg:
                db.session.add(ProfileEducationDegree(
                    tenant_id=tid, profile_owner_id=owner_id, doctor_id=doctor_id,
                    degree_name=d['degree_name'], institution=d['institution'],
                    passing_year=d['passing_year'],
                    degree_category_id=d['degree_category_id'],
                ))

    @staticmethod
    def _refresh_education_urls(record):
        """Regenerate presigned S3 URLs for all education file fields."""
        from app.services.s3_service import S3Service
        file_attrs = [
            ('graduation_certificate_s3_bucket',          'graduation_certificate_s3_key',          'graduation_certificate_url'),
            ('graduation_marksheet_s3_bucket',             'graduation_marksheet_s3_key',             'graduation_marksheet_url'),
            ('post_graduation_certificate_s3_bucket',     'post_graduation_certificate_s3_key',     'post_graduation_certificate_url'),
            ('post_graduation_marksheet_s3_bucket',        'post_graduation_marksheet_s3_key',        'post_graduation_marksheet_url'),
            ('super_speciality_certificate_s3_bucket',    'super_speciality_certificate_s3_key',    'super_speciality_certificate_url'),
            ('super_speciality_marksheet_s3_bucket',       'super_speciality_marksheet_s3_key',       'super_speciality_marksheet_url'),
            ('other_certification_certificate_s3_bucket', 'other_certification_certificate_s3_key', 'other_certification_certificate_url'),
            ('other_certification_marksheet_s3_bucket',   'other_certification_marksheet_s3_key',   'other_certification_marksheet_url'),
        ]
        for bucket_attr, key_attr, url_attr in file_attrs:
            bucket = getattr(record, bucket_attr, None)
            key = getattr(record, key_attr, None)
            if bucket and key:
                setattr(record, url_attr, S3Service.generate_presigned_url(bucket, key))
        return record

    @staticmethod
    def get_education_dropdowns():
        """
        Return dropdown option lists for the Education Details form.
        Options are loaded from admin-configured field configs (live or draft).
        Falls back to hardcoded defaults if not configured.
        Returns keys matching the frontend Redux slice: degrees, pgSpecializations,
        superSpecialitySpecializations, specializations, states, universities,
        institutes, evaluationCriteria.
        """
        from app.api.doctor_profile_config.service import DoctorProfileConfigService
        from app.api.doctor_profile_config.data_resolver import resolve_data_source
        from app.models import PageFieldConfig

        # --- Fallback defaults ---
        DEFAULT_DEGREES = [
            'MBBS', 'BDS', 'BAMS', 'BHMS', 'BUMS', 'BNYS', 'BPT',
            'B.Sc Nursing', 'B.Sc MLT', 'B.Pharm', 'BOT', 'B.Sc (Optometry)',
            'MD', 'MS', 'DNB', 'MDS', 'MCh', 'DM', 'MPT', 'M.Sc Nursing',
            'MBA (Healthcare)', 'MHA', 'M.Pharm', 'Fellowship',
        ]
        DEFAULT_SPECIALIZATIONS = [
            'General Medicine', 'General Surgery', 'Cardiology', 'Neurology',
            'Orthopedics', 'Pediatrics', 'Gynecology & Obstetrics',
            'Dermatology', 'Ophthalmology', 'ENT', 'Psychiatry',
            'Radiology', 'Anesthesiology', 'Pathology', 'Microbiology',
            'Nephrology', 'Gastroenterology', 'Pulmonology', 'Endocrinology',
            'Oncology', 'Rheumatology', 'Urology', 'Neurosurgery',
            'Emergency Medicine', 'Family Medicine', 'Sports Medicine',
            'Critical Care Medicine', 'Community Medicine', 'Other',
        ]
        DEFAULT_STATES = [
            'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
            'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
            'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
            'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
            'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
            'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi',
            'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
            'Andaman and Nicobar Islands', 'Lakshadweep',
            'Dadra and Nagar Haveli and Daman and Diu',
        ]
        DEFAULT_EVAL = ['Percentage', 'CGPA', 'GPA', 'Class / Division', 'Grade']

        def _resolve_field(field_configs_map, field_key, data_source_fallback):
            """Get options from field config or resolve from data_source."""
            field = field_configs_map.get(field_key)
            if field:
                if field.options:
                    # Admin has set custom options
                    return field.options
                if field.data_source:
                    items = resolve_data_source(field.data_source)
                    return [o['name'] if isinstance(o, dict) else o for o in items]
            # Fallback: resolve from data_source string directly
            if data_source_fallback:
                items = resolve_data_source(data_source_fallback)
                return [o['name'] if isinstance(o, dict) else o for o in items]
            return []

        # Per-level degree / university / institute lists. They default to
        # the same fallback as their UG counterparts and are overridden
        # below when a live/draft config exists. Previously these three
        # lists were UG-only and reused for PG + Super-Speciality, so every
        # education level showed the UG dropdown regardless of what the
        # admin configured per level.
        pg_degrees = ss_degrees = DEFAULT_DEGREES
        pg_universities = ss_universities = []
        pg_institutes = ss_institutes = []

        try:
            # Get live config, fall back to draft
            config = DoctorProfileConfigService.get_live_config()
            if not config:
                config = DoctorProfileConfigService.get_draft_config()

            if config:
                edu_sections = [
                    'education_graduation', 'education_post_graduation',
                    'education_super_speciality', 'education_other_certification'
                ]
                fields = PageFieldConfig.query.filter(
                    PageFieldConfig.tenant_id == current_tenant_id_strict(),
                    PageFieldConfig.config_id == config.id,
                    PageFieldConfig.section.in_(edu_sections)
                ).all()
                # Build lookup by field_key (first match wins)
                fc_map = {}
                for f in fields:
                    if f.field_key not in fc_map:
                        fc_map[f.field_key] = f

                degrees = _resolve_field(fc_map, 'ug_degree', 'master_degrees') or DEFAULT_DEGREES
                # Specialization lists are level-scoped so a UG-only
                # specialization doesn't leak into the PG dropdown (and
                # vice versa). The level-scoped ``master_specializations:<level>``
                # source matches rows tagged with that level OR legacy
                # NULL-level rows. ``category:specialization`` (no level)
                # would return every specialization regardless of level.
                ug_specializations = _resolve_field(fc_map, 'ug_specialization', 'master_specializations:ug') or DEFAULT_SPECIALIZATIONS
                pg_specializations = _resolve_field(fc_map, 'pg_specialization', 'master_specializations:pg') or DEFAULT_SPECIALIZATIONS
                states = _resolve_field(fc_map, 'ug_state', 'master_states') or DEFAULT_STATES
                universities = _resolve_field(fc_map, 'ug_university', 'master_universities') or []
                institutes = _resolve_field(fc_map, 'ug_institute', 'master_colleges') or []
                evaluation_criteria = _resolve_field(fc_map, 'ug_evaluation_criteria', 'master_evaluation_criteria') or DEFAULT_EVAL
                ss_specializations = _resolve_field(fc_map, 'ss_specialization', 'master_specializations:super_speciality') or DEFAULT_SPECIALIZATIONS
                # Per-level degree / university / institute — read the
                # pg_* / ss_* field configs (each carries its own
                # ``master_<x>:<level>`` data_source) instead of reusing
                # the UG list for every level.
                pg_degrees = _resolve_field(fc_map, 'pg_degree', 'master_degrees:pg') or DEFAULT_DEGREES
                ss_degrees = _resolve_field(fc_map, 'ss_degree', 'master_degrees:super_speciality') or DEFAULT_DEGREES
                pg_universities = _resolve_field(fc_map, 'pg_university', 'master_universities:pg') or []
                ss_universities = _resolve_field(fc_map, 'ss_university', 'master_universities:super_speciality') or []
                pg_institutes = _resolve_field(fc_map, 'pg_institute', 'master_colleges:pg') or []
                ss_institutes = _resolve_field(fc_map, 'ss_institute', 'master_colleges:super_speciality') or []
            else:
                degrees = DEFAULT_DEGREES
                ug_specializations = DEFAULT_SPECIALIZATIONS
                pg_specializations = DEFAULT_SPECIALIZATIONS
                states = DEFAULT_STATES
                universities = []
                institutes = []
                evaluation_criteria = DEFAULT_EVAL
                ss_specializations = DEFAULT_SPECIALIZATIONS
        except Exception:
            degrees = DEFAULT_DEGREES
            ug_specializations = DEFAULT_SPECIALIZATIONS
            pg_specializations = DEFAULT_SPECIALIZATIONS
            states = DEFAULT_STATES
            universities = []
            institutes = []
            evaluation_criteria = DEFAULT_EVAL
            ss_specializations = DEFAULT_SPECIALIZATIONS

        return {
            # Keys matching frontend Redux slice setEducationDropdownOptions.
            # ``degrees`` / ``universities`` / ``institutes`` stay the UG
            # lists for back-compat (Graduation + Other-Certification read
            # them); the ``pg*`` / ``superSpeciality*`` keys are the
            # per-level lists so each education level shows what the admin
            # configured for that level.
            'degrees': degrees,
            'ugDegrees': degrees,
            'pgDegrees': pg_degrees,
            'superSpecialityDegrees': ss_degrees,
            'ugSpecializations': ug_specializations,
            'pgSpecializations': pg_specializations,
            'superSpecialitySpecializations': ss_specializations,
            'states': states,
            'universities': universities,
            'ugUniversities': universities,
            'pgUniversities': pg_universities,
            'superSpecialityUniversities': ss_universities,
            'institutes': institutes,
            'ugInstitutes': institutes,
            'pgInstitutes': pg_institutes,
            'superSpecialityInstitutes': ss_institutes,
            'evaluationCriteria': evaluation_criteria,
        }

    # --------------- Bank Account Methods ---------------

    @staticmethod
    def get_bank_accounts(doctor_id):
        """Get all bank accounts for a doctor, ordered by order_index."""
        from app.models import ProfileBankAccount
        return ProfileBankAccount.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).order_by(
            ProfileBankAccount.order_index
        ).all()

    @staticmethod
    def save_bank_accounts(doctor_id, user_id, accounts_json, files):
        """
        Save/update doctor bank accounts.
        accounts_json: list of { orderIndex, bankName, accountName, accountNumber, ifscCode, branch }
        files: dict with keys like account_0_passbook, account_0_check_leaf, account_0_bank_statement
        """
        import json as _json
        import logging
        from app.models import ProfileBankAccount, DocumentVerificationStatus
        from app.services.s3_service import S3Service

        _logger = logging.getLogger(__name__)
        s3_folder = f'doctors/bank-accounts/{user_id}'

        accounts_data = _json.loads(accounts_json) if isinstance(accounts_json, str) else accounts_json

        # Get existing accounts
        tid = current_tenant_id_strict()
        existing = {a.order_index: a for a in ProfileBankAccount.query.filter_by(
            tenant_id=tid, doctor_id=doctor_id,
        ).all()}

        for acct_data in accounts_data:
            idx = acct_data.get('orderIndex', 0)
            record = existing.get(idx)
            if not record:
                record = ProfileBankAccount(
                    tenant_id=tid, doctor_id=doctor_id, order_index=idx,
                    profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, tid).id,
                )
                db.session.add(record)

            # Detect if any critical field changed → reset verification
            new_bank_name = acct_data.get('bankName', '')
            new_account_number = acct_data.get('accountNumber', '')
            new_ifsc = acct_data.get('ifscCode', '')
            new_account_name = acct_data.get('accountName', '')
            new_branch = acct_data.get('branch', '')

            details_changed = (
                record.account_number != new_account_number or
                record.ifsc_code != new_ifsc or
                record.bank_name != new_bank_name or
                record.account_name != new_account_name or
                record.branch != new_branch
            )

            record.bank_name = new_bank_name
            record.account_name = new_account_name
            record.account_number = new_account_number
            record.ifsc_code = new_ifsc
            record.branch = new_branch

            # Reset overall verification to pending if details changed
            if details_changed:
                record.verification_status = DocumentVerificationStatus.PENDING
                _logger.info(f'[BANK] Account {record.id or "new"} details changed for doctor={doctor_id} — verification reset to PENDING')

            # Handle file uploads for this account
            file_map = {
                f'account_{idx}_passbook': 'passbook',
                f'account_{idx}_check_leaf': 'check_leaf',
                f'account_{idx}_bank_statement': 'bank_statement',
            }
            for file_key, attr_prefix in file_map.items():
                if file_key in files:
                    try:
                        f = files[file_key]
                        result = S3Service.upload_file(
                            f, file_key, f.filename,
                            is_private=True,
                            folder=f'{s3_folder}/{attr_prefix}'
                        )
                        presigned = S3Service.generate_presigned_url(
                            result['s3_bucket'], result['s3_key']
                        )
                        setattr(record, f'{attr_prefix}_url', presigned)
                        setattr(record, f'{attr_prefix}_s3_key', result['s3_key'])
                        setattr(record, f'{attr_prefix}_s3_bucket', result['s3_bucket'])
                        setattr(record, f'{attr_prefix}_verification_status', DocumentVerificationStatus.PENDING)
                    except Exception as _e:
                        _logger.warning(f'[BANK] upload failed for {file_key}: {_e}')

        db.session.commit()

        # NOTE: bank-detail changes are NOT tracked via ApprovalRequest — the
        # account's own ``verification_status`` (reset to PENDING above when
        # details change) is the source of truth, reviewed through the admin
        # Bank Accounts dialog and surfaced in the View-Doctors approvals
        # drill-down (see admin/routes.py::get_doctor_approval_history). The old
        # ``_create_approval_request('DOCTOR_BANK_DETAILS', …)`` call here was
        # dead — there is no such ApprovalEntityType member, so it raised
        # ValueError on every save and was swallowed, creating nothing.

        # Return refreshed accounts
        accounts = ProfileBankAccount.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id,
        ).order_by(
            ProfileBankAccount.order_index
        ).all()
        return [DoctorService._refresh_bank_account_urls(a) for a in accounts]

    @staticmethod
    def delete_bank_account(doctor_id, account_id):
        """Delete one of the doctor's own bank accounts — any account, including
        the primary. Detaches the Cashfree beneficiary first, and refuses while a
        payout to this account is still in flight.
        """
        from app.models import ProfileBankAccount
        from app.api.common.payment import beneficiary_service as bene

        record = ProfileBankAccount.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=account_id, doctor_id=doctor_id,
        ).first()
        if not record:
            return False, 'Bank account not found'

        n = bene.in_flight_payouts(record)
        if n:
            return False, (
                f'{n} payout(s) to this account are still in progress. '
                'Wait for them to complete or fail before removing it.'
            )

        # Detach at Cashfree (best-effort, no-op when nothing is registered),
        # then clear the bank link on settled payouts so the FK doesn't block us.
        bene.remove_beneficiary(record)
        unlinked = bene.unlink_payouts(record)
        db.session.delete(record)
        db.session.commit()

        msg = 'Bank account removed.'
        if unlinked:
            msg += f' {unlinked} past payout record(s) kept for audit.'
        msg += ' Payouts are on hold until you add and verify a new account.'
        return True, msg

    @staticmethod
    def suspend_bank_account(doctor_id, account_id):
        """Pause payouts to one of the doctor's own accounts: detach the Cashfree
        beneficiary and reset verification. The account stays and can be verified
        again with a fresh ₹1 penny drop. Refused while a payout is in flight.
        """
        from app.models import ProfileBankAccount
        from app.api.common.payment import beneficiary_service as bene

        record = ProfileBankAccount.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=account_id, doctor_id=doctor_id,
        ).first()
        if not record:
            return False, 'Bank account not found'

        n = bene.in_flight_payouts(record)
        if n:
            return False, (
                f'{n} payout(s) to this account are still in progress. '
                'Wait for them to complete or fail before suspending it.'
            )

        bene.remove_beneficiary(record)
        db.session.commit()
        return True, (
            'Payouts to this account are suspended. Re-verify it with a ₹1 '
            'penny drop to start receiving payouts again.'
        )

    @staticmethod
    def _refresh_bank_account_urls(record):
        """Regenerate presigned S3 URLs for a bank account's document fields."""
        from app.services.s3_service import S3Service
        file_attrs = [
            ('passbook_s3_bucket', 'passbook_s3_key', 'passbook_url'),
            ('check_leaf_s3_bucket', 'check_leaf_s3_key', 'check_leaf_url'),
            ('bank_statement_s3_bucket', 'bank_statement_s3_key', 'bank_statement_url'),
        ]
        for bucket_attr, key_attr, url_attr in file_attrs:
            bucket = getattr(record, bucket_attr, None)
            key = getattr(record, key_attr, None)
            if bucket and key:
                setattr(record, url_attr, S3Service.generate_presigned_url(bucket, key))
        return record

    # --------------- Declaration Methods ---------------

    @staticmethod
    def get_declarations(doctor_id):
        """
        Get merged declaration config + doctor's responses.
        Returns { questions: [...], documentTypes: [...], selfDeclaration: {...} }
        """
        from app.models import DeclarationConfig, ProfileDeclarationResponse, ProfileDocument, Doctor
        from app.services.s3_service import S3Service

        # Get active configs
        tid = current_tenant_id_strict()
        questions_cfg = DeclarationConfig.query.filter_by(
            tenant_id=tid, config_type='question', is_active=True,
        ).order_by(DeclarationConfig.display_order).all()

        documents_cfg = DeclarationConfig.query.filter_by(
            tenant_id=tid, config_type='document', is_active=True,
        ).order_by(DeclarationConfig.display_order).all()

        # Get doctor's existing responses
        responses = {str(r.config_id): r for r in
                     ProfileDeclarationResponse.query.filter_by(
                         tenant_id=tid, doctor_id=doctor_id,
                     ).all()}
        doc_uploads = {str(d.config_id): d for d in
                       ProfileDocument.query.filter_by(
                           tenant_id=tid, doctor_id=doctor_id,
                       ).all()}

        # Merge questions with responses
        merged_questions = []
        for cfg in questions_cfg:
            cfg_id = str(cfg.id)
            resp = responses.get(cfg_id)
            attachment_url = None
            if resp and resp.attachment_s3_bucket and resp.attachment_s3_key:
                attachment_url = S3Service.generate_presigned_url(
                    resp.attachment_s3_bucket, resp.attachment_s3_key
                )
            merged_questions.append({
                **cfg.to_response_dict(),
                'answer': resp.answer if resp else None,
                'explanation': resp.explanation if resp else '',
                'attachmentUrl': attachment_url,
            })

        # Merge document types with uploads
        merged_documents = []
        for cfg in documents_cfg:
            cfg_id = str(cfg.id)
            doc = doc_uploads.get(cfg_id)
            file_url = None
            if doc and doc.file_s3_bucket and doc.file_s3_key:
                file_url = S3Service.generate_presigned_url(
                    doc.file_s3_bucket, doc.file_s3_key
                )
            merged_documents.append({
                **cfg.to_response_dict(),
                'fileUrl': file_url,
                'verificationStatus': doc.verification_status.value if doc else 'pending',
            })

        # Get self-declaration data
        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        self_decl = doctor.self_declaration_data or {}

        return {
            'questions': merged_questions,
            'documentTypes': merged_documents,
            'selfDeclaration': {
                'termsAccepted': self_decl.get('termsAccepted', False),
                'policiesAccepted': self_decl.get('policiesAccepted', False),
            },
        }

    @staticmethod
    def save_declarations(doctor_id, user_id, responses_json, self_declaration_json, files):
        """
        Save doctor's declaration responses, self-declaration, and document uploads.
        responses_json: list of { configId, answer, explanation }
        self_declaration_json: { termsAccepted, policiesAccepted }
        files: question_{configId}_attachment, document_{configId}_file
        """
        import json as _json
        import logging
        from app.models import (
            ProfileDeclarationResponse, ProfileDocument, Doctor,
            DocumentVerificationStatus, DeclarationConfig,
        )
        from app.services.s3_service import S3Service

        _logger = logging.getLogger(__name__)
        s3_folder = f'doctors/declarations/{user_id}'

        # Parse responses
        responses_data = _json.loads(responses_json) if isinstance(responses_json, str) else (responses_json or [])

        # Save question responses
        tid = current_tenant_id_strict()
        for resp_data in responses_data:
            config_id = resp_data.get('configId')
            if not config_id:
                continue

            record = ProfileDeclarationResponse.query.filter_by(
                tenant_id=tid, doctor_id=doctor_id, config_id=config_id,
            ).first()
            if not record:
                record = ProfileDeclarationResponse(
                    tenant_id=tid, doctor_id=doctor_id, config_id=config_id,
                    profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, tid).id,
                )
                db.session.add(record)

            record.answer = resp_data.get('answer')
            record.explanation = resp_data.get('explanation', '')

            # Handle question attachment
            file_key = f'question_{config_id}_attachment'
            if file_key in files:
                try:
                    f = files[file_key]
                    result = S3Service.upload_file(
                        f, file_key, f.filename,
                        is_private=True,
                        folder=f'{s3_folder}/questions'
                    )
                    presigned = S3Service.generate_presigned_url(
                        result['s3_bucket'], result['s3_key']
                    )
                    record.attachment_url = presigned
                    record.attachment_s3_key = result['s3_key']
                    record.attachment_s3_bucket = result['s3_bucket']
                except Exception as _e:
                    _logger.warning(f'[DECLARATION] upload failed for {file_key}: {_e}')

        # Save document uploads
        active_doc_configs = DeclarationConfig.query.filter_by(
            tenant_id=tid, config_type='document', is_active=True,
        ).all()
        for cfg in active_doc_configs:
            file_key = f'document_{cfg.id}_file'
            if file_key not in files:
                continue

            record = ProfileDocument.query.filter_by(
                tenant_id=tid, doctor_id=doctor_id, config_id=cfg.id,
            ).first()
            if not record:
                record = ProfileDocument(
                    tenant_id=tid, doctor_id=doctor_id, config_id=cfg.id,
                    profile_owner_id=get_or_create_profile_owner('doctor', doctor_id, tid).id,
                )
                db.session.add(record)

            try:
                f = files[file_key]
                result = S3Service.upload_file(
                    f, file_key, f.filename,
                    is_private=True,
                    folder=f'{s3_folder}/documents'
                )
                presigned = S3Service.generate_presigned_url(
                    result['s3_bucket'], result['s3_key']
                )
                record.file_url = presigned
                record.file_s3_key = result['s3_key']
                record.file_s3_bucket = result['s3_bucket']
                record.verification_status = DocumentVerificationStatus.PENDING
            except Exception as _e:
                _logger.warning(f'[DECLARATION] upload failed for {file_key}: {_e}')

        # Save self-declaration
        self_decl = _json.loads(self_declaration_json) if isinstance(self_declaration_json, str) else (self_declaration_json or {})
        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        if doctor:
            from datetime import datetime, timezone
            doctor.self_declaration_data = {
                'termsAccepted': self_decl.get('termsAccepted', False),
                'policiesAccepted': self_decl.get('policiesAccepted', False),
                'acceptedAt': datetime.now(timezone.utc).isoformat() if (
                    self_decl.get('termsAccepted') or self_decl.get('policiesAccepted')
                ) else None,
            }

        db.session.commit()

        DoctorService._create_approval_request(
            user_id=user_id,
            doctor_id=doctor_id,
            entity_type_value='DOCTOR_DECLARATION',
            changes={'declaration_updated': True},
            reason='Doctor updated declarations and documents',
        )

        return DoctorService.get_declarations(doctor_id)

    # --------------- Approval Helpers ---------------

    @staticmethod
    def _create_approval_request(user_id, doctor_id, entity_type_value, changes, reason):
        """Create or update an approval request for admin review."""
        import logging
        logger = logging.getLogger(__name__)
        try:
            from app.models import ApprovalRequest, ApprovalEntityType, ApprovalRequestStatus
            from sqlalchemy.orm.attributes import flag_modified

            entity_type = ApprovalEntityType(entity_type_value.lower())

            existing = ApprovalRequest.query.filter_by(
                tenant_id=current_tenant_id_strict(),
                entity_id=doctor_id,
                entity_type=entity_type,
                status=ApprovalRequestStatus.PENDING,
            ).first()

            if existing:
                merged = dict(existing.changes or {})
                merged.update(changes)
                existing.changes = merged
                flag_modified(existing, 'changes')
            else:
                new_req = ApprovalRequest(
                    tenant_id=current_tenant_id_strict(),
                    requested_by_id=user_id,
                    entity_type=entity_type,
                    entity_id=doctor_id,
                    changes=changes,
                    reason=reason,
                    status=ApprovalRequestStatus.PENDING,
                    required_level=1,
                )
                db.session.add(new_req)

            db.session.commit()
        except Exception as e:
            logger.warning(f"[DOCTOR] Failed to create approval request: {e}")
            # Non-fatal — the data is saved, admin can still find it

    # --------------- Billing ---------------

    @staticmethod
    def get_doctor_billing(doctor_id, page=1, per_page=20, date_from=None, date_to=None):
        """
        Build billing rows for completed appointments with successful payments.
        Computes charges, GST, TDS, and final payout from active BillingConfig.
        """
        # Fetch active billing config (BillingConfig is TenantMixin — each
        # tenant has its own billing rules; fall back to an in-memory
        # defaults instance if none configured for this tenant yet).
        tid = current_tenant_id_strict()
        config = BillingConfig.query.filter_by(
            tenant_id=tid, is_active=True,
        ).first()
        if not config:
            config = BillingConfig()  # use defaults

        # Build query: completed appointments with payments
        query = (
            db.session.query(Appointment, Payment)
            .join(Payment, Payment.appointment_id == Appointment.id)
            .filter(
                Appointment.tenant_id == tid,
                Payment.tenant_id == tid,
                Appointment.doctor_id == doctor_id,
                Appointment.status == AppointmentStatus.COMPLETED,
                Payment.status == PaymentStatus.SUCCESS,
            )
        )

        # Date filters
        if date_from:
            try:
                d = datetime.strptime(date_from, '%Y-%m-%d').date()
                query = query.filter(Appointment.appointment_date >= d)
            except ValueError:
                pass
        if date_to:
            try:
                d = datetime.strptime(date_to, '%Y-%m-%d').date()
                query = query.filter(Appointment.appointment_date <= d)
            except ValueError:
                pass

        query = query.order_by(Appointment.appointment_date.desc(), Payment.payment_date.desc())
        paginated = query.paginate(page=page, per_page=per_page, error_out=False)

        # Platform charges are now per marketplace membership plan (zero if the
        # doctor has no active plan). Resolve the Doctor once for both the
        # per-row charge math and the column labels below.
        from app.models import Doctor
        from app.api.common.payment.billing_service import (
            compute_platform_charges, compute_platform_charges_detail,
            resolve_charge_names, resolve_gst_rates, resolve_tds_rate,
        )
        _doctor = Doctor.query.filter_by(tenant_id=tid, id=doctor_id).first()
        _charge_names = resolve_charge_names(_doctor) if _doctor else (
            'Charge 1', 'Charge 2', 'Charge 3')
        # TDS is a per-doctor rate (override → tenant flat), so resolve it once
        # for this doctor rather than per row.
        _tds_rate = resolve_tds_rate(_doctor, config) if _doctor else (
            Decimal(str(config.tds_rate)) if config.tds_rate is not None else Decimal('0'))

        bills = []
        for idx, (appt, payment) in enumerate(paginated.items):
            payment_amount = Decimal(str(payment.amount or 0))
            consultation_fee = Decimal(str(appt.consultation_fee or 0))

            # Compute GST — rates can vary per consultation type; unlisted
            # types fall back to the flat cgst_rate/sgst_rate.
            _ctype = getattr(getattr(appt, 'consultation_type', None), 'value', getattr(appt, 'consultation_type', None))
            cgst, sgst = resolve_gst_rates(config, _ctype)
            gst = (payment_amount * (cgst + sgst) / Decimal('100')).quantize(Decimal('0.01'))

            # Compute charges from the doctor's active membership plan
            # (zero when there's no active plan).
            if _doctor:
                c1, c2, c3 = compute_platform_charges(_doctor, payment_amount)
            else:
                c1 = c2 = c3 = Decimal('0.00')
            sum_charges = c1 + c2 + c3

            # Net after charges
            net = payment_amount - sum_charges

            # TDS — per-doctor effective rate resolved above.
            tds = (net * _tds_rate / Decimal('100')).quantize(Decimal('0.01'))

            # Final payout
            final_payment = net - tds

            bills.append({
                'sno': (page - 1) * per_page + idx + 1,
                'appointment_date': appt.appointment_date.isoformat() if appt.appointment_date else None,
                'appointment_id': str(appt.id),
                'patient_id': str(appt.patient_id),
                'appointment_amount': str(consultation_fee),
                'payment_date': payment.payment_date.isoformat() if payment.payment_date else None,
                'payment_id': str(payment.id),
                'payment_amount': str(payment_amount),
                'taxes_gst': str(gst),
                'charge1': str(c1),
                'charge2': str(c2),
                'charge3': str(c3),
                # Per-charge breakdown incl. the tax portion of each charge.
                'charges_detail': (compute_platform_charges_detail(_doctor, payment_amount)
                                   if _doctor else []),
                'summation_of_charges': str(sum_charges),
                'payment_minus_charges': str(net),
                'tds': str(tds),
                'final_payment': str(final_payment),
            })

        return {
            'bills': bills,
            'pagination': {
                'page': paginated.page,
                'per_page': paginated.per_page,
                'total': paginated.total,
                'pages': paginated.pages,
            },
            'config': {
                'charge1_name': _charge_names[0],
                'charge2_name': _charge_names[1],
                'charge3_name': _charge_names[2],
                'cgst_rate': str(config.cgst_rate),
                'sgst_rate': str(config.sgst_rate),
                # The doctor's effective TDS (per-doctor override → tenant flat).
                'tds_rate': str(_tds_rate),
            },
        }
