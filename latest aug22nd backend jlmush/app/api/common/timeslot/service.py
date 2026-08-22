"""
TimeSlot Service
Business logic for time-slot CRUD and consultation-type mapping.
"""
import logging
from datetime import datetime, time, date as date_type, timezone, timedelta
from uuid import uuid4

from app.extensions import db
from sqlalchemy import update
from app.models import (
    TimeSlot, TimeSlotType, ConsultationType,
    Appointment, AppointmentStatus, Doctor,
    AvailabilityApprovalStatus, PublishStatus,
)
from sqlalchemy import func as sa_func, or_, and_

logger = logging.getLogger(__name__)


class TimeSlotService:
    """Concrete time-slot operations (DB-backed)."""

    # ──────────────────────────────────────────────────────────────────────
    # SLOT GENERATION
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def generate_slots(
        doctor_id,
        date_val: date_type,
        slots_data: list,
        consultation_types: list | None = None,
    ) -> list:
        """
        Materialise a list of slot dicts into TimeSlot + TimeSlotType rows.

        Args:
            doctor_id:  UUID of the doctor
            date_val:   The calendar date
            slots_data: List of dicts from the frontend calendar:
                        [{"start": "09:00", "end": "09:15", "duration": 15,
                          "consultation_types": ["video","audio"]}]
            consultation_types:
                        Fallback list applied when a slot dict lacks its own
                        consultation_types key (e.g. ["complete"]).

        Returns:
            List of created/updated TimeSlot.to_dict() objects.

        Normalization rule
        ──────────────────
        If a slot with the same (doctor_id, date, start_time) already exists,
        we *merge* the new consultation types into the existing slot rather
        than creating a duplicate row.
        """
        if consultation_types is None:
            consultation_types = [ConsultationType.COMPLETE.value]

        results = []

        for s in slots_data:
            start_str = s.get('start')
            end_str = s.get('end')
            if not start_str or not end_str:
                continue

            start_t = datetime.strptime(start_str, '%H:%M').time()
            end_t = datetime.strptime(end_str, '%H:%M').time()

            # Per-slot types take priority over the bulk fallback
            slot_types_raw = s.get('consultation_types') or consultation_types

            # Look for an existing slot at this exact (doctor, date, start)
            existing = TimeSlot.query.filter_by(
                doctor_id=doctor_id,
                date=date_val,
                start_time=start_t,
            ).first()

            if existing:
                slot = existing
                # Update end_time if it changed
                if slot.end_time != end_t:
                    slot.end_time = end_t
            else:
                slot = TimeSlot(
                    id=uuid4(),
                    doctor_id=doctor_id,
                    date=date_val,
                    start_time=start_t,
                    end_time=end_t,
                    is_booked=False,
                )
                db.session.add(slot)
                db.session.flush()  # ensure slot.id is available

            # Merge consultation types ─ only add types that don't already exist
            existing_types = {ct.consultation_type for ct in slot.consultation_types}

            for ct_val in slot_types_raw:
                try:
                    ct_enum = ConsultationType(ct_val)
                except (ValueError, KeyError):
                    logger.warning(f"[TIMESLOT] Unknown consultation type '{ct_val}', skipping")
                    continue

                if ct_enum not in existing_types:
                    db.session.add(TimeSlotType(
                        id=uuid4(),
                        time_slot_id=slot.id,
                        consultation_type=ct_enum,
                    ))

            results.append(slot)

        db.session.commit()
        return [ts.to_dict() for ts in results]

    # ──────────────────────────────────────────────────────────────────────
    # SLOT QUERIES
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def get_available_slots(
        doctor_id,
        date_val: date_type,
        consultation_type: str | None = None,
        requesting_patient_id=None,
    ) -> list:
        """
        Return unbooked TimeSlot dicts for a doctor on a date.
        Optionally filter by consultation_type.

        Soft reservation visibility:
          - If requesting_patient_id is provided: show slots reserved for this patient,
            hide slots reserved for other patients.
          - If requesting_patient_id is None: hide all soft-reserved slots.
        """
        # Lazy expiry: clear expired soft reservations for this doctor+date
        TimeSlotService._clear_expired_soft_reservations(doctor_id, date_val)

        query = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
        )

        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
            except (ValueError, KeyError):
                return []
            query = query.join(TimeSlotType).filter(
                TimeSlotType.consultation_type == ct_enum
            )

        # Soft reservation visibility filter
        if requesting_patient_id:
            query = query.filter(
                or_(
                    TimeSlot.soft_reserved_for_patient_id.is_(None),
                    TimeSlot.soft_reserved_for_patient_id == requesting_patient_id,
                )
            )
        else:
            query = query.filter(TimeSlot.soft_reserved_for_patient_id.is_(None))

        # Filter past slots if today
        now = datetime.now()
        slots = query.order_by(TimeSlot.start_time).all()

        if date_val == now.date():
            slots = [s for s in slots if s.start_time > now.time()]

        return [s.to_dict() for s in slots]

    @staticmethod
    def get_all_slots_for_date(doctor_id, date_val: date_type) -> list:
        """Return ALL TimeSlot dicts (booked and unbooked) for a doctor on a date."""
        slots = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
        ).order_by(TimeSlot.start_time).all()
        return [s.to_dict() for s in slots]

    @staticmethod
    def get_slot_summary(doctor_id, year: int, month: int, consultation_type: str = None) -> dict:
        """
        Return {date_str: available_count} for a month.
        Optionally filter by consultation_type.
        """
        from calendar import monthrange
        _, days_in_month = monthrange(year, month)
        today = date_type.today()

        ct_enum = None
        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
            except (ValueError, KeyError):
                pass

        now = datetime.now()

        summary = {}
        for day in range(1, days_in_month + 1):
            d = date_type(year, month, day)
            if d < today:
                continue

            query = TimeSlot.query.filter(
                TimeSlot.doctor_id == doctor_id,
                TimeSlot.date == d,
                TimeSlot.is_booked == False,
            )

            # For today, exclude past time slots
            if d == today:
                query = query.filter(TimeSlot.start_time > now.time())

            if ct_enum:
                query = query.join(TimeSlotType).filter(
                    TimeSlotType.consultation_type == ct_enum
                )

            count = query.count()
            if count > 0:
                summary[d.isoformat()] = count

        return summary

    @staticmethod
    def get_available_consultation_types(doctor_id):
        """
        Return the distinct consultation types that currently have at least
        one bookable slot (future, unbooked, not soft-reserved) for a doctor.

        Powers the patient "Choose Consultation Type" screen, which should
        only surface types the patient can actually book right now.

        Returns:
            list[str]  — consultation-type values (e.g. ["audio", "video"]).
                         May be empty when the doctor has materialized slots
                         but none are currently bookable.
            None       — the doctor has NO TimeSlot rows at all (legacy
                         JSON-only availability_config). Callers should treat
                         this as "unknown" and fall back to showing every
                         type rather than hiding the whole booking screen.
        """
        # Distinguish "legacy doctor, no DB slots" from "DB slots exist but
        # none bookable" — the two need different UX (show-all vs. empty).
        any_slot = db.session.query(TimeSlot.id).filter(
            TimeSlot.doctor_id == doctor_id,
        ).first()
        if any_slot is None:
            return None

        now = datetime.now()
        today = now.date()

        rows = (
            db.session.query(TimeSlotType.consultation_type)
            .join(TimeSlot, TimeSlot.id == TimeSlotType.time_slot_id)
            .filter(
                TimeSlot.doctor_id == doctor_id,
                TimeSlot.is_booked == False,
                TimeSlot.soft_reserved_for_patient_id.is_(None),
                or_(
                    TimeSlot.date > today,
                    and_(TimeSlot.date == today, TimeSlot.start_time > now.time()),
                ),
            )
            .distinct()
            .all()
        )
        return [r[0].value for r in rows]

    # ──────────────────────────────────────────────────────────────────────
    # BOOKING
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def book_slot(time_slot_id, consultation_type_str: str) -> TimeSlot:
        """
        Mark a slot as booked. Validates:
          1. Slot exists & is not already booked
          2. Requested consultation type is offered on this slot

        Returns:
            The booked TimeSlot

        Raises:
            ValueError on failure

        Concurrency: the slot row is locked ``FOR UPDATE`` and ``is_booked``
        re-checked while holding the lock, so two concurrent bookings of the
        same slot (e.g. a patient and an admin booking on their behalf) can't
        both win — the second blocks until the first commits, then sees
        ``is_booked=True`` and raises.
        """
        # ``of=TimeSlot`` locks only the time_slots row. TimeSlot eager-joins
        # time_slot_types (lazy='joined'), and a bare FOR UPDATE would try to
        # lock that nullable outer-joined side too — which Postgres rejects
        # ("FOR UPDATE cannot be applied to the nullable side of an outer
        # join"). Locking just time_slots is exactly what we need.
        slot = (
            TimeSlot.query
            .filter_by(id=time_slot_id)
            .with_for_update(of=TimeSlot)
            .first()
        )
        if not slot:
            raise ValueError("Time slot not found")
        if slot.is_booked:
            raise ValueError("This time slot has already been booked")

        # Validate consultation type is offered
        try:
            ct_enum = ConsultationType(consultation_type_str)
        except (ValueError, KeyError):
            raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        offered = {ct.consultation_type for ct in slot.consultation_types}
        if ct_enum not in offered:
            raise ValueError(
                f"Consultation type '{consultation_type_str}' is not available "
                f"for this slot. Available: {[t.value for t in offered]}"
            )

        slot.is_booked = True
        db.session.commit()
        return slot

    @staticmethod
    def release_slot(time_slot_id):
        """Un-book a slot (e.g. after cancellation or payment expiry)."""
        slot = TimeSlot.query.get(time_slot_id)
        if slot:
            slot.is_booked = False
            db.session.commit()
        return slot

    # ──────────────────────────────────────────────────────────────────────
    # SLOT DELETION
    # ──────────────────────────────────────────────────────────────────────

    # ──────────────────────────────────────────────────────────────────────
    # SOFT RESERVATION (follow-up option 2b)
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def soft_reserve_slot(time_slot_id, patient_id, expiry_datetime):
        """
        Soft-reserve a slot for a specific patient (follow-up option 2b).
        The slot is hidden from other patients but not hard-booked.
        """
        slot = TimeSlot.query.get(time_slot_id)
        if not slot:
            raise ValueError("Time slot not found")
        if slot.is_booked:
            raise ValueError("This time slot has already been booked")
        if slot.soft_reserved_for_patient_id:
            raise ValueError("This time slot is already soft-reserved")

        slot.soft_reserved_for_patient_id = patient_id
        slot.soft_reservation_expiry = expiry_datetime
        db.session.commit()
        return slot

    @staticmethod
    def release_soft_reservation(time_slot_id):
        """Clear soft reservation fields on a slot."""
        slot = TimeSlot.query.get(time_slot_id)
        if slot:
            slot.soft_reserved_for_patient_id = None
            slot.soft_reservation_expiry = None
            db.session.commit()
        return slot

    @staticmethod
    def _clear_expired_soft_reservations(doctor_id, date_val):
        """Lazy expiry: clear expired soft reservations for a doctor on a date."""
        now = datetime.now(timezone.utc)
        expired_slots = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
            TimeSlot.soft_reserved_for_patient_id.isnot(None),
            TimeSlot.soft_reservation_expiry < now,
        ).all()

        if expired_slots:
            from app.models import FollowUpInvite, FollowUpInviteStatus
            for slot in expired_slots:
                # Also expire associated invite
                invite = FollowUpInvite.query.filter_by(
                    reserved_time_slot_id=slot.id,
                    status=FollowUpInviteStatus.PENDING,
                ).first()
                if invite:
                    invite.status = FollowUpInviteStatus.EXPIRED

                slot.soft_reserved_for_patient_id = None
                slot.soft_reservation_expiry = None

            db.session.commit()
            logger.info(f"[TIMESLOT] Cleared {len(expired_slots)} expired soft reservations for doctor {doctor_id} on {date_val}")

    @staticmethod
    def check_demand_pressure(doctor_id, date_val, consultation_type_str=None):
        """
        Demand pressure: if all non-soft-reserved slots of a type+day are booked,
        release the soft reservations so those slots open to everyone.
        """
        from app.models import FollowUpInvite, FollowUpInviteStatus

        ct_enum = None
        if consultation_type_str:
            try:
                ct_enum = ConsultationType(consultation_type_str)
            except (ValueError, KeyError):
                return

        # Find soft-reserved unbooked slots for this doctor+date
        soft_query = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
            TimeSlot.soft_reserved_for_patient_id.isnot(None),
        )
        if ct_enum:
            soft_query = soft_query.join(TimeSlotType).filter(
                TimeSlotType.consultation_type == ct_enum
            )
        soft_reserved_slots = soft_query.all()

        if not soft_reserved_slots:
            return

        # Count non-soft-reserved, unbooked slots of same type+day
        free_query = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
            TimeSlot.soft_reserved_for_patient_id.is_(None),
        )
        if ct_enum:
            free_query = free_query.join(TimeSlotType).filter(
                TimeSlotType.consultation_type == ct_enum
            )
        free_count = free_query.count()

        if free_count == 0:
            # All other slots are booked — release soft reservations
            for slot in soft_reserved_slots:
                invite = FollowUpInvite.query.filter_by(
                    reserved_time_slot_id=slot.id,
                    status=FollowUpInviteStatus.PENDING,
                ).first()
                if invite:
                    invite.status = FollowUpInviteStatus.EXPIRED

                slot.soft_reserved_for_patient_id = None
                slot.soft_reservation_expiry = None

            db.session.commit()
            logger.info(f"[TIMESLOT] Demand pressure released {len(soft_reserved_slots)} soft reservations for doctor {doctor_id} on {date_val}")

    # ──────────────────────────────────────────────────────────────────────
    # SLOT DELETION
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def delete_slot(time_slot_id) -> bool:
        """Delete a slot if it is not booked."""
        slot = TimeSlot.query.get(time_slot_id)
        if not slot:
            raise ValueError("Time slot not found")
        if slot.is_booked:
            raise ValueError("Cannot delete a booked slot")

        # If soft-reserved, cancel the associated follow-up invite
        if slot.soft_reserved_for_patient_id:
            from app.models import FollowUpInvite, FollowUpInviteStatus
            invite = FollowUpInvite.query.filter_by(
                reserved_time_slot_id=slot.id,
                status=FollowUpInviteStatus.PENDING,
            ).first()
            if invite:
                invite.status = FollowUpInviteStatus.CANCELLED

        db.session.delete(slot)
        db.session.commit()
        return True

    @staticmethod
    def delete_slots_for_date(doctor_id, date_val: date_type) -> int:
        """Delete all unbooked slots for a doctor on a given date."""
        slots = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
        ).all()

        count = len(slots)
        for slot in slots:
            db.session.delete(slot)
        db.session.commit()
        return count

    @staticmethod
    def remove_consultation_type(time_slot_id, consultation_type_str: str) -> bool:
        """
        Remove a single consultation type from a slot.
        If no types remain, delete the slot entirely.
        """
        slot = TimeSlot.query.get(time_slot_id)
        if not slot:
            raise ValueError("Time slot not found")
        if slot.is_booked:
            raise ValueError("Cannot modify a booked slot")

        try:
            ct_enum = ConsultationType(consultation_type_str)
        except (ValueError, KeyError):
            raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        mapping = TimeSlotType.query.filter_by(
            time_slot_id=time_slot_id,
            consultation_type=ct_enum,
        ).first()

        if mapping:
            db.session.delete(mapping)

        # If no types left, remove the slot itself
        remaining = TimeSlotType.query.filter_by(time_slot_id=time_slot_id).count()
        if remaining <= 1:  # the one we just deleted
            db.session.delete(slot)

        db.session.commit()
        return True

    # ──────────────────────────────────────────────────────────────────────
    # MIGRATION HELPERS
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def materialize_day_overrides(doctor_id, day_overrides: dict = None, availability_config: dict = None):
        """
        Sync approved day_overrides into TimeSlot DB rows.

        Only ADMIN-APPROVED dated slots are materialised — callers pass the
        doctor's ``approved_day_overrides`` snapshot (per-slot approval), so
        pending/rejected draft edits never become bookable.

        For each date in the override map:
          - Slots present → upsert into time_slots + time_slot_types
          - Slots in DB but NOT present → delete (if not booked)

        Accepts either a ``day_overrides`` dict directly, or (legacy) an
        ``availability_config`` from which ``day_overrides`` is read.
        """
        if day_overrides is None:
            day_overrides = (availability_config or {}).get('day_overrides', {})
        day_overrides = day_overrides or {}
        today = date_type.today()

        for date_str, slots_list in day_overrides.items():
            try:
                d = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                continue

            if d < today:
                continue  # skip past dates

            if not slots_list:
                # Empty override = doctor blocked this day → delete unbooked slots
                TimeSlotService.delete_slots_for_date(doctor_id, d)
                continue

            # Upsert slots — extract consultation_types if present
            TimeSlotService.generate_slots(
                doctor_id=doctor_id,
                date_val=d,
                slots_data=slots_list,
                consultation_types=None,  # each slot should carry its own types
            )

            # Remove DB slots whose start_time no longer appears in the override
            override_starts = {
                datetime.strptime(s['start'], '%H:%M').time()
                for s in slots_list if s.get('start')
            }
            db_slots = TimeSlot.query.filter(
                TimeSlot.doctor_id == doctor_id,
                TimeSlot.date == d,
                TimeSlot.is_booked == False,
            ).all()
            for db_slot in db_slots:
                if db_slot.start_time not in override_starts:
                    db.session.delete(db_slot)

            db.session.commit()

    # ──────────────────────────────────────────────────────────────────────
    # AGGREGATE AVAILABILITY
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def open_slot_query(tenant_id, doctor_ids=None, consultation_type=None):
        """
        SINGLE SOURCE OF TRUTH for "is this a real, currently bookable slot":
        unbooked, today-or-later, belonging to a non-deleted, admin-approved,
        published doctor in the given tenant.

        Every "does/how many bookable slots exist" computation in the app —
        the landing/dashboard aggregate, per-doctor counts, and the
        ``has_slots`` flag on the doctor list — MUST be built from this one
        query so the definition can't drift between endpoints again. (It
        already had: ``/api/doctor/list`` computed ``has_slots`` from
        ``Doctor.availability_approval_status`` alone — an admin sign-off
        flag, not a real slot check — so a doctor with zero actual open
        slots still showed a green "Slots Available" badge while this
        query correctly reported zero.)

        Returns the unfiltered-by-caller join query (row shape:
        ``TimeSlot.doctor_id`` first) — callers add their own ``.filter``/
        ``.group_by``/projection on top.
        """
        query = (
            db.session.query(TimeSlot.doctor_id, TimeSlotType.consultation_type, TimeSlot.id)
            .join(TimeSlotType, TimeSlotType.time_slot_id == TimeSlot.id)
            .join(Doctor, TimeSlot.doctor_id == Doctor.id)
            .filter(
                TimeSlot.is_booked == False,
                TimeSlot.date >= date_type.today(),
                Doctor.is_deleted == False,
                # Per-slot approval: TimeSlot rows only ever come from the
                # doctor's APPROVED day_overrides snapshot, so their existence
                # already means admin-approved. The old doctor-wide
                # availability_approval_status gate is intentionally dropped so
                # a pending edit no longer hides already-approved slots.
                Doctor.tenant_id == tenant_id,
                or_(
                    Doctor.publish_status == PublishStatus.ACTIVE,
                    db.cast(Doctor.publish_status_by_type, db.Text).ilike('%"active"%'),
                ),
            )
        )
        if doctor_ids is not None:
            query = query.filter(TimeSlot.doctor_id.in_(doctor_ids))
        if consultation_type is not None:
            query = query.filter(TimeSlotType.consultation_type == consultation_type)
        return query

    @staticmethod
    def get_aggregate_availability_by_type(tenant_id=None) -> dict:
        """
        Return total available (unbooked, future) slot counts grouped by
        consultation type, scoped to the given tenant.

        ``tenant_id`` is REQUIRED in practice — same hard
        tenant-isolation rule as ``get_doctor_slot_count_by_type``.
        Without it the aggregate would count slots across every
        tenant on the platform (a jlmush.in patient seeing larazen's
        slot counts on their home page).

        Returns:
            dict keyed by consultation type value:
            {"video": {"count": 42, "status": "green"}, ...}

        Status thresholds:
            0     → "red"
            1-10  → "orange"
            11+   → "green"
        """
        if tenant_id is None:
            import logging
            logging.getLogger(__name__).warning(
                'get_aggregate_availability_by_type called without '
                'tenant_id — returning empty (zero) counts to avoid '
                'cross-tenant leak.'
            )
            # Return the empty shape the caller expects (zero counts +
            # red status) so the home page degrades cleanly rather
            # than 500'ing.
            allowed = {'video', 'audio', 'chat', 'complete', 'home_visit'}
            return {ct: {'count': 0, 'status': 'red'} for ct in allowed}

        results = (
            TimeSlotService.open_slot_query(tenant_id)
            .with_entities(TimeSlotType.consultation_type, sa_func.count(TimeSlot.id))
            .group_by(TimeSlotType.consultation_type)
            .all()
        )

        # Build response for schedulable types (exclude camp and marketplace)
        allowed = {'video', 'audio', 'chat', 'complete', 'home_visit'}
        counts = {}
        for ct_enum, count in results:
            val = ct_enum.value if hasattr(ct_enum, 'value') else ct_enum
            if val in allowed:
                counts[val] = count

        output = {}
        for ct_val in allowed:
            count = counts.get(ct_val, 0)
            if count == 0:
                status = 'red'
            elif count <= 10:
                status = 'orange'
            else:
                status = 'green'
            output[ct_val] = {'count': count, 'status': status}

        return output

    @staticmethod
    def get_doctor_slot_count_by_type(
        consultation_type: str, tenant_id=None,
    ) -> dict:
        """
        Return {doctor_id: available_slot_count} for a specific consultation type
        across approved, published doctors **in the given tenant**.

        ``tenant_id`` is REQUIRED in practice — without it this helper
        would return doctors across every tenant on the platform,
        which is a hard cross-tenant data leak (a jlmush.in patient
        was seeing larazen.in's Dr. Ankita in their matched-doctors
        list before this filter was added). Kept as a keyword arg
        with a None default so calling without it doesn't silently
        regress to "all tenants" — passing None now returns an empty
        dict and logs a warning rather than serving cross-tenant
        rows. Callers should always supply
        ``current_tenant_id_strict()`` (or the equivalent for their
        request context).
        """
        try:
            ct_enum = ConsultationType(consultation_type)
        except (ValueError, KeyError):
            return {}

        if tenant_id is None:
            import logging
            logging.getLogger(__name__).warning(
                'get_doctor_slot_count_by_type called without tenant_id — '
                'refusing to serve cross-tenant rows. Pass tenant_id.'
            )
            return {}

        results = (
            TimeSlotService.open_slot_query(tenant_id, consultation_type=ct_enum)
            .with_entities(TimeSlot.doctor_id, sa_func.count(TimeSlot.id))
            .group_by(TimeSlot.doctor_id)
            .all()
        )

        return {str(doc_id): count for doc_id, count in results}

    @staticmethod
    def get_doctor_ids_with_open_slots(doctor_ids, tenant_id=None) -> set:
        """
        Which of ``doctor_ids`` have at least one real, bookable slot right
        now (any consultation type) — the boolean counterpart of
        ``get_doctor_slot_count_by_type``, built on the same
        ``open_slot_query`` predicate so it can never disagree with the
        aggregate/per-type counts. Batched: one query for the whole
        candidate list (a page of doctors), not N+1.

        This is what ``has_slots`` on ``/api/doctor/list`` and the
        ``with_slots`` filter on ``DoctorService.search`` must be built
        from — previously both used ``Doctor.availability_approval_status``
        (an admin sign-off flag on the doctor's schedule template) as a
        stand-in for "has open slots", which is a different fact and let
        the two badges disagree in prod.
        """
        if not doctor_ids or tenant_id is None:
            return set()

        results = (
            TimeSlotService.open_slot_query(tenant_id, doctor_ids=doctor_ids)
            .with_entities(TimeSlot.doctor_id)
            .distinct()
            .all()
        )
        return {str(doc_id) for (doc_id,) in results}

    @staticmethod
    def get_slot_counts_by_doctor_and_type(doctor_ids, tenant_id=None) -> dict:
        """
        ``{doctor_id: {consultation_type: open_slot_count}}`` for a page of
        doctors — the two-dimensional counterpart of
        ``get_doctor_slot_count_by_type`` (one type, every doctor) and
        ``get_doctor_ids_with_open_slots`` (every type, boolean).

        Powers the per-consultation-type availability shown on the
        Find-a-Doctor cards, where one card lists several types at once and
        each needs its own count. Built on the same ``open_slot_query``
        predicate as its siblings, and batched into a single grouped query
        so rendering N cards stays 1 query rather than N.

        ``tenant_id`` is REQUIRED — same hard tenant-isolation rule as the
        sibling helpers; passing None returns an empty dict rather than
        silently serving cross-tenant rows.
        """
        if not doctor_ids or tenant_id is None:
            return {}

        results = (
            TimeSlotService.open_slot_query(tenant_id, doctor_ids=doctor_ids)
            .with_entities(
                TimeSlot.doctor_id,
                TimeSlotType.consultation_type,
                sa_func.count(TimeSlot.id),
            )
            .group_by(TimeSlot.doctor_id, TimeSlotType.consultation_type)
            .all()
        )

        counts = {}
        for doc_id, ct, count in results:
            counts.setdefault(str(doc_id), {})[ct.value] = count
        return counts

    @staticmethod
    def get_slot_counts_by_doctor_type_and_length(doctor_ids, tenant_id=None) -> dict:
        """
        ``{doctor_id: {consultation_type: {'10-20': count}}}`` — the same
        availability as ``get_slot_counts_by_doctor_and_type``, cut one level
        finer by how long each slot runs.

        Find-a-Doctor lets a patient filter by slot length, and a card that
        answered "12 slots" for the whole consultation type after such a
        filter would be counting the 10-minute slots the patient just excluded.
        The per-length row is what makes "20–30 min · ₹500" able to say whether
        that specific length is actually bookable.

        Length keys are the ``slot_pricing`` ladder ('0-10', '10-20', …) so a
        count can be looked up directly by a priced tier's own range, matched
        the same ``(min, max]`` way :func:`display_pricing.tier_for_duration`
        prices a booking — a 15-minute slot is a '10-20' slot in both places.

        Grouped by the distinct start/end pairs rather than by a SQL duration
        expression: a doctor's schedule has a handful of them, and bucketing in
        Python keeps this off dialect-specific interval arithmetic.

        ``tenant_id`` is REQUIRED — same hard tenant-isolation rule as the
        sibling helpers.
        """
        if not doctor_ids or tenant_id is None:
            return {}

        results = (
            TimeSlotService.open_slot_query(tenant_id, doctor_ids=doctor_ids)
            .with_entities(
                TimeSlot.doctor_id,
                TimeSlotType.consultation_type,
                TimeSlot.start_time,
                TimeSlot.end_time,
                sa_func.count(TimeSlot.id),
            )
            .group_by(
                TimeSlot.doctor_id, TimeSlotType.consultation_type,
                TimeSlot.start_time, TimeSlot.end_time,
            )
            .all()
        )

        counts = {}
        for doc_id, ct, start, end, count in results:
            key = TimeSlotService.slot_length_key(start, end)
            if not key:
                continue
            by_type = counts.setdefault(str(doc_id), {}).setdefault(ct.value, {})
            by_type[key] = by_type.get(key, 0) + count
        return counts

    @staticmethod
    def slot_length_key(start_time, end_time):
        """The ``slot_pricing`` range key a start/end pair falls in, or ``None``.

        Ten-minute steps, upper bound inclusive, so the bucket a slot lands in
        is the same tier :func:`display_pricing.tier_for_duration` would price
        it off — ranges match as ``(min, max]`` there, and a mismatch here would
        show a count under a length the booking never charges at.
        """
        if start_time is None or end_time is None:
            return None
        minutes = (
            (end_time.hour * 60 + end_time.minute)
            - (start_time.hour * 60 + start_time.minute)
        )
        # A slot ending past midnight wraps to a negative difference; it has no
        # sensible ladder position, so it is left out rather than bucketed at 0.
        if minutes <= 0:
            return None
        low = ((minutes - 1) // 10) * 10
        return f'{low}-{low + 10}'

    # ──────────────────────────────────────────────────────────────────────
    # PUBLIC ANONYMOUS BOOKING — slot lookup + pre-lock helpers
    # ──────────────────────────────────────────────────────────────────────
    #
    # The public-booking flow has three responsibilities not covered by the
    # patient-authenticated helpers above:
    #
    #   1. List slots that are free for an anonymous visitor — both the
    #      patient-side soft locks (``soft_reserved_for_patient_id`` set)
    #      AND any active anonymous pre-lock (``soft_reservation_expiry``
    #      in the future, even if patient_id is null) must be hidden.
    #
    #   2. Pre-lock a slot for 15 min while Razorpay checkout runs. We use
    #      a single conditional UPDATE so concurrent /initiate calls fail
    #      atomically — no row-level lock needed.
    #
    #   3. Hard-book the slot once payment verifies, releasing the
    #      pre-lock atomically.

    @staticmethod
    def get_available_slots_for_public(doctor_id, date_val, consultation_type=None):
        """Anonymous-visitor slot listing.

        Same shape as :meth:`get_available_slots` but treats ALL
        soft-reservations (with or without a patient_id) as "taken" until
        the expiry lapses. Used by ``GET /api/public/booking/...``.
        """
        now = datetime.now(timezone.utc)

        # Lazy expiry: clear stale patient-side soft locks first so they
        # show up as bookable. Anonymous pre-locks (patient_id IS NULL)
        # are filtered by expiry directly in the query below — they don't
        # need a sweep because nothing else references them.
        TimeSlotService._clear_expired_soft_reservations(doctor_id, date_val)

        query = TimeSlot.query.filter(
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date == date_val,
            TimeSlot.is_booked == False,
            # Hide ALL active soft-locks regardless of who holds them.
            or_(
                TimeSlot.soft_reservation_expiry.is_(None),
                TimeSlot.soft_reservation_expiry < now,
            ),
            # Belt + suspenders: a stale patient_id with null expiry would
            # otherwise leak through. Such rows shouldn't exist (the
            # patient-side helpers always set expiry) but we filter
            # defensively.
            TimeSlot.soft_reserved_for_patient_id.is_(None),
        )

        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
            except (ValueError, KeyError):
                return []
            query = query.join(TimeSlotType).filter(
                TimeSlotType.consultation_type == ct_enum
            )

        slots = query.order_by(TimeSlot.start_time).all()

        # Filter past slots when listing today's date.
        if date_val == datetime.now().date():
            now_t = datetime.now().time()
            slots = [s for s in slots if s.start_time > now_t]

        return [s.to_dict() for s in slots]

    @staticmethod
    def try_public_prelock(time_slot_id, ttl_minutes=15):
        """Attempt to pre-lock a slot for an anonymous booking.

        Atomic conditional UPDATE: succeeds only if the slot is currently
        free (``is_booked = False`` AND no active soft-lock). Returns the
        ``soft_reservation_expiry`` set on success, or ``None`` if the
        lock could not be acquired (slot is booked or someone else's
        pre-lock is still active).
        """
        now = datetime.now(timezone.utc)
        new_expiry = now + timedelta(minutes=ttl_minutes)

        # Single UPDATE … WHERE … so two concurrent /initiate requests
        # for the same slot can't both win. Whichever commits first
        # makes the WHERE-clause false for the other.
        result = db.session.execute(
            update(TimeSlot)
            .where(TimeSlot.id == time_slot_id)
            .where(TimeSlot.is_booked == False)
            .where(
                or_(
                    TimeSlot.soft_reservation_expiry.is_(None),
                    TimeSlot.soft_reservation_expiry < now,
                )
            )
            .where(TimeSlot.soft_reserved_for_patient_id.is_(None))
            .values(soft_reservation_expiry=new_expiry)
        )
        db.session.commit()
        return new_expiry if result.rowcount == 1 else None

    @staticmethod
    def confirm_public_booking(time_slot_id):
        """Hard-book a pre-locked slot.

        Caller is /verify after Razorpay signature has been validated.
        Returns the slot row on success, raises ``ValueError`` if the
        slot is no longer pre-locked (meaning someone else already
        confirmed it or the lock expired — should be impossible if
        Razorpay verified within 15 min, but we check defensively).
        """
        now = datetime.now(timezone.utc)
        slot = TimeSlot.query.get(time_slot_id)
        if not slot:
            raise ValueError('Time slot not found.')
        if slot.is_booked:
            raise ValueError('Time slot was already booked by someone else.')
        # An anonymous pre-lock looks like (patient_id NULL, expiry > now).
        # Patient-side soft-locks have patient_id set; we don't expect to
        # see those here (the public listing wouldn't have shown the slot
        # as available), but reject defensively.
        if slot.soft_reserved_for_patient_id is not None:
            raise ValueError('Time slot is held for a different reservation.')
        if slot.soft_reservation_expiry is None or slot.soft_reservation_expiry < now:
            raise ValueError('Public pre-lock expired before payment verification.')

        slot.is_booked = True
        slot.soft_reservation_expiry = None
        db.session.commit()
        return slot

    @staticmethod
    def release_public_prelock(time_slot_id):
        """Release a public pre-lock without booking the slot.

        Used when /verify fails (signature invalid, etc.) — we want the
        slot to immediately become bookable again rather than waiting
        15 min for the natural expiry.
        """
        slot = TimeSlot.query.get(time_slot_id)
        if slot and slot.soft_reserved_for_patient_id is None:
            slot.soft_reservation_expiry = None
            db.session.commit()
        return slot
