"""Public anonymous-booking service layer.

Three public methods called by the routes:

  * :meth:`PublicBookingService.list_specializations` — distinct primary
    specialization categories that have at least one platform doctor with
    bookable slots.
  * :meth:`PublicBookingService.list_doctors` — paginated, filterable
    public doctor listing (specialization + consultation_type).
  * :meth:`PublicBookingService.initiate` — atomic: pre-lock the slot,
    create a Razorpay order, persist a ``PendingPublicBooking`` row.
  * :meth:`PublicBookingService.verify_and_complete` — atomic: verify
    Razorpay signature, lookup-or-create User+Patient, create
    Appointment, hard-book the slot, send OTP for first login.

No User row is ever written until :meth:`verify_and_complete` succeeds —
abandoned checkouts leave only a transient ``PendingPublicBooking`` row
that auto-expires (status flips on next sweep; the slot's pre-lock
expires naturally without any cron).
"""
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from flask import g
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import (
    User, Patient, Doctor, ProfileEducationSpecialization,
    ProfileWorkQualification,
    Category, TimeSlot, Appointment, AppointmentStatus, AppointmentType,
    ConsultationType, UserRole, UserStatus, PublishStatus,
    PendingPublicBooking,
)
from app.api.common.timeslot.service import TimeSlotService
from app.common.encryption import hash_for_search

logger = logging.getLogger(__name__)


PUBLIC_BOOKING_LOCK_MINUTES = 15


# --------------------------------------------------------------------------- #
# Custom exceptions — service raises these so the route layer maps to HTTP
# --------------------------------------------------------------------------- #

class SlotUnavailable(Exception):
    """Slot is booked or already pre-locked by someone else."""


class BookingNotFound(Exception):
    """The pending_id doesn't exist or has already been consumed/expired."""


class SignatureInvalid(Exception):
    """Razorpay signature didn't verify."""


class PendingExpired(Exception):
    """The pre-lock expired before /verify arrived."""


# --------------------------------------------------------------------------- #
# Razorpay helpers — re-exported so routes don't import from the patient
# payment module (which would entangle the auth-required path).
# --------------------------------------------------------------------------- #

def _tenant_binding(tenant_id):
    """The TENANT's own Razorpay binding — public bookings are tenant
    marketplace money, so there is no platform-key fallback. Raises
    :class:`app.api.pricing.service.GatewayNotConfigured` (surfaced by the
    route as a friendly 409) when the tenant hasn't connected a gateway."""
    from app.api.pricing.service import PaymentResolver
    return PaymentResolver.resolve_gateway(tenant_id)


def _razorpay_client(binding):
    try:
        import razorpay
    except ImportError:
        raise RuntimeError("razorpay package not installed. Run: pip install razorpay")
    if not binding or not binding.key_id or not binding.key_secret:
        raise RuntimeError("Payment gateway credentials are incomplete.")
    return razorpay.Client(auth=(binding.key_id, binding.key_secret))


def _verify_signature(order_id: str, payment_id: str, signature: str,
                      tenant_id) -> bool:
    """Verify against the tenant's own key secret (the rail that created
    the order)."""
    import hashlib
    import hmac
    from app.models import TenantPaymentConfig
    config = TenantPaymentConfig.for_tenant(tenant_id)
    key_secret = config.razorpay_key_secret if config else None
    if not key_secret:
        return False
    body = f"{order_id}|{payment_id}".encode('utf-8')
    expected = hmac.new(key_secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# --------------------------------------------------------------------------- #
# PublicBookingService
# --------------------------------------------------------------------------- #

class PublicBookingService:

    # ─── catalog reads ──────────────────────────────────────────────── #

    @staticmethod
    def list_specializations():
        """Distinct ``Category`` rows that have at least one *visible*
        doctor IN THE CALLING TENANT with their ``is_primary=True``
        specialization pointing at the category. Returns
        ``[{id, name, doctor_count}]``.

        Tenant scope: resolved via ``current_tenant_id_or_default()``
        from the request host. Without this filter every tenant's
        public landing page would show every other tenant's
        specializations + doctor counts (cross-tenant leak — same
        shape as the /doctors/match leak fixed earlier).
        """
        from sqlalchemy import func
        from app.common.tenant_context import current_tenant_id_or_default

        tenant_id = current_tenant_id_or_default()

        rows = (
            db.session.query(
                Category.id,
                Category.name,
                func.count(Doctor.id.distinct()).label('doctor_count'),
            )
            .join(
                ProfileWorkQualification,
                ProfileWorkQualification.category_id == Category.id,
            )
            .join(
                Doctor,
                Doctor.id == ProfileWorkQualification.doctor_id,
            )
            .filter(
                # Group by WORK QUALIFICATION (a doctor may hold several, so
                # no is_primary filter — they count under each). Only
                # published + landing-curated ("popular") doctors count.
                Doctor.is_deleted.is_(False),
                Doctor.tenant_id == tenant_id,
                Doctor.publish_status == PublishStatus.ACTIVE,
                Doctor.is_popular.is_(True),
            )
            .group_by(Category.id, Category.name)
            .order_by(Category.name)
            .all()
        )
        return [
            {'id': str(r.id), 'name': r.name, 'doctor_count': int(r.doctor_count)}
            for r in rows
        ]

    @staticmethod
    def list_doctors(specialization_id=None, consultation_type=None, name=None,
                     page=1, per_page=20):
        """Paginated public doctor listing.

        Filters:
          * ``specialization_id`` — UUID of a ``Category``; matches any
            doctor whose primary specialization points there.
          * ``consultation_type`` — ConsultationType value; matches any
            doctor with at least one TimeSlotType row of that consultation
            type (across any non-booked slot).
          * ``name`` — case-insensitive substring on first/last name.
        """
        from sqlalchemy import or_

        from app.common.tenant_context import current_tenant_id_or_default
        tenant_id = current_tenant_id_or_default()

        # ``first_name`` / ``last_name`` live on the related ``User``
        # row (the project deduped name fields onto User in the
        # multi-profile refactor). Join + filter through there.
        # Tenant filter is mandatory — without it the public landing
        # page on a subscriber tenant returned doctors from every
        # other tenant on the platform.
        query = Doctor.query.join(User, Doctor.user_id == User.id).filter(
            Doctor.is_deleted.is_(False),
            User.is_deleted.is_(False),
            Doctor.tenant_id == tenant_id,
            # Exclude placeholder Doctor rows that back clinic/hospital manager
            # profiles — only real DOCTOR-role users are bookable providers.
            User.role == UserRole.DOCTOR,
            # Landing widget = published + admin-curated ("popular") only. The
            # full published directory is bookable via the post-login flow.
            Doctor.publish_status == PublishStatus.ACTIVE,
            Doctor.is_popular.is_(True),
        )

        if name:
            like = f'%{name}%'
            query = query.filter(
                or_(User.first_name.ilike(like), User.last_name.ilike(like))
            )

        if specialization_id:
            # ``specialization_id`` is a work-qualification Category id now.
            query = query.join(ProfileWorkQualification).filter(
                ProfileWorkQualification.category_id == specialization_id,
            )

        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
            except (ValueError, KeyError):
                return {'items': [], 'page': page, 'per_page': per_page, 'total': 0}

            from app.models import TimeSlotType
            # Correlated EXISTS instead of join + DISTINCT. A join+.distinct()
            # emits SELECT DISTINCT over the whole Doctor row, which Postgres
            # rejects because several Doctor columns are JSON (no equality
            # operator: "could not identify an equality operator for type json").
            # EXISTS de-duplicates without any DISTINCT, sidestepping the issue.
            slot_match = (
                db.session.query(TimeSlot.id)
                .join(TimeSlotType, TimeSlotType.time_slot_id == TimeSlot.id)
                .filter(
                    TimeSlot.doctor_id == Doctor.id,
                    TimeSlotType.consultation_type == ct_enum,
                    TimeSlot.is_booked.is_(False),
                    TimeSlot.date >= datetime.now().date(),
                )
            )
            query = query.filter(slot_match.exists())

        # Count BEFORE pagination — same query without limit/offset.
        total = query.count()

        items = (
            query.order_by(User.first_name)
            .offset((page - 1) * per_page).limit(per_page).all()
        )

        return {
            'items': [
                PublicBookingService._serialize_doctor_card(d, consultation_type)
                for d in items
            ],
            'page': page,
            'per_page': per_page,
            'total': total,
        }

    @staticmethod
    def _serialize_doctor_card(doctor: Doctor, consultation_type=None):
        # Show the doctor's WORK QUALIFICATION (primary first, else any) —
        # the public booking groups by these now, not education specialty.
        primary_spec = (
            ProfileWorkQualification.query
            .filter_by(doctor_id=doctor.id)
            .order_by(ProfileWorkQualification.is_primary.desc())
            .first()
        )
        # Names live on the related User, not on Doctor — see
        # ``app/models/doctor.py`` (the project consolidated name
        # fields onto User in the multi-profile refactor).
        u = doctor.user
        first_name = (u.first_name if u else '') or ''
        last_name = (u.last_name if u else '') or ''
        profile_image = (u.profile_image if u else None)
        return {
            'id': str(doctor.id),
            'first_name': first_name,
            'last_name': last_name,
            'full_name': f'{first_name} {last_name}'.strip(),
            'profile_image': profile_image,
            'experience_years': doctor.experience_years,
            'specialization_id': str(primary_spec.category_id) if primary_spec else None,
            'specialization_name': (
                primary_spec.category.name if primary_spec and primary_spec.category else None
            ),
            'consultation_fee': (
                float(doctor.consultation_fee) if doctor.consultation_fee is not None else None
            ),
            # Per-slot pricing tiers — SAME shape/source as the after-login
            # booking (``Doctor.slot_pricing`` filtered to this consultation
            # type). Each tier = {range (duration), price, description}. Lets a
            # doctor offer several slots at different prices.
            **PublicBookingService._slot_pricing_fields(doctor, consultation_type),
        }

    @staticmethod
    def _slot_pricing_fields(doctor: Doctor, consultation_type=None):
        """Build ``price_range`` / ``price_min`` / ``price_max`` from
        ``Doctor.slot_pricing`` (mirrors the authenticated doctor-match).
        Empty dict when the doctor has no slot pricing for this type — the
        card falls back to the single ``consultation_fee``.

        Prices carry the admin display-pricing overlay, so the public card
        quotes the same number ``initiate`` will charge. When that overlay
        marks the offering down, ``original_price_min`` / ``original_price_max``
        / ``discount_pct`` come along so the card can slash the pre-discount
        range; they're absent when there's nothing to slash."""
        from app.common.display_pricing import (
            decorate_tiers, markdown_range, tier_card_extras,
        )
        all_pricing = decorate_tiers(doctor.id, doctor.slot_pricing)
        ct_pricing = [
            p for p in all_pricing
            if not consultation_type
            or p.get('consultation_type', 'complete') == consultation_type
        ]
        prices = [float(p['price']) for p in ct_pricing if p.get('price') is not None]
        if not prices:
            return {}
        return {
            'price_min': min(prices),
            'price_max': max(prices),
            'price_range': [
                {
                    'range': p.get('range') or p.get('duration'),
                    'price': float(p.get('price', 0)),
                    'description': p.get('description', ''),
                    **tier_card_extras(p),
                }
                for p in ct_pricing if p.get('price') is not None
            ],
            **markdown_range(ct_pricing),
        }

    @staticmethod
    def _chargeable_fee(doctor: Doctor, slot, consultation_type, tenant_id=None):
        """What the patient actually pays for ``slot`` — display price, in ₹.

        Prefers the ``slot_pricing`` tier matching this consultation type and
        the slot's length (that's the price the card quoted), falling back to
        the flat ``Doctor.consultation_fee`` for doctors who never filled the
        per-slot table in. Either way the admin's display-pricing overlay is
        applied, so re-pricing a slot in
        ``/dashboard/admin/pricing-config`` changes the Razorpay amount too.

        ``None`` when the doctor has no price at all.
        """
        from app.common.display_pricing import resolve_booking_fee

        duration = None
        if slot and slot.start_time and slot.end_time:
            duration = (
                (slot.end_time.hour * 60 + slot.end_time.minute)
                - (slot.start_time.hour * 60 + slot.start_time.minute)
            ) or None

        return resolve_booking_fee(
            doctor, consultation_type, duration, tenant_id=tenant_id,
        )

    # ─── booking initiate / verify ──────────────────────────────────── #

    @staticmethod
    def initiate(payload):
        """Atomic: pre-lock the slot, create a Razorpay order, persist a
        ``PendingPublicBooking``. Returns
        ``{razorpay_order_id, key_id, amount_paise, pending_id}``.

        Raises :class:`SlotUnavailable` if the slot is already booked or
        held by someone else; the route maps it to ``409``.
        """
        tenant_id = g.get('tenant_id')
        if not tenant_id:
            raise RuntimeError(
                'Public booking requires tenant context — request hostname '
                'must resolve to a configured tenant.'
            )

        # Validate the slot exists, belongs to the calling tenant,
        # and matches the doctor in the payload. Without the
        # ``tenant_id`` filter an attacker could pre-lock a
        # competitor's slot by guessing the UUID — TimeSlot rows are
        # not auth-gated, so the public-booking endpoint MUST scope
        # the lookup to the request's tenant.
        slot = TimeSlot.query.filter_by(
            id=payload['time_slot_id'], tenant_id=tenant_id,
        ).first()
        if not slot or slot.doctor_id != payload['doctor_id']:
            raise SlotUnavailable('Slot not found for this doctor.')

        # Pre-lock — atomic conditional UPDATE. Raises if the slot is
        # already booked or someone else's pre-lock is still active.
        new_expiry = TimeSlotService.try_public_prelock(
            slot.id, ttl_minutes=PUBLIC_BOOKING_LOCK_MINUTES,
        )
        if new_expiry is None:
            raise SlotUnavailable('Slot is no longer available.')

        # Look up the doctor for the consultation fee. We read the
        # amount on the server — the client never tells us the price.
        # Tenant-scoped to make absolutely sure we can't accidentally
        # charge a patient on tenant A for a doctor on tenant B
        # (would mis-attribute revenue + violate isolation).
        doctor = Doctor.query.filter_by(
            id=payload['doctor_id'], tenant_id=tenant_id,
        ).first()
        fee = PublicBookingService._chargeable_fee(
            doctor, slot, payload['consultation_type'], tenant_id,
        ) if doctor else None
        if fee is None:
            # Release the lock we just acquired so the slot is bookable
            # again; refusing the order without doing this would leave
            # the slot held for 15 minutes for nothing.
            TimeSlotService.release_public_prelock(slot.id)
            raise SlotUnavailable(
                'Doctor has no consultation fee configured — cannot accept booking.'
            )

        amount_paise = int(Decimal(str(fee)) * 100)

        # Create the Razorpay order. If this throws (e.g. credentials
        # misconfigured) we release the pre-lock so the slot returns to
        # the bookable pool immediately rather than after 15 min.
        try:
            binding = _tenant_binding(tenant_id)
            client = _razorpay_client(binding)
            order = client.order.create({
                'amount': amount_paise,
                'currency': 'INR',
                'payment_capture': 1,
                'notes': {
                    'flow': 'public_booking',
                    'doctor_id': str(doctor.id),
                    'time_slot_id': str(slot.id),
                    'tenant_id': str(tenant_id),
                },
            })
        except Exception:
            TimeSlotService.release_public_prelock(slot.id)
            logger.exception('[PUBLIC_BOOKING] razorpay order create failed')
            raise

        pending = PendingPublicBooking(
            tenant_id=tenant_id,
            doctor_id=doctor.id,
            time_slot_id=slot.id,
            consultation_type=payload['consultation_type'],
            name=payload['name'].strip(),
            phone_number=payload['phone_number'].strip(),
            email=(payload.get('email') or '').strip() or None,
            dob=payload.get('dob'),
            description=(payload.get('description') or '').strip() or None,
            razorpay_order_id=order['id'],
            amount_paise=amount_paise,
            status='pending',
            expires_at=new_expiry,
        )
        db.session.add(pending)
        db.session.commit()

        return {
            'pending_id': str(pending.id),
            'razorpay_order_id': order['id'],
            'key_id': binding.key_id,
            'amount_paise': amount_paise,
            'currency': 'INR',
            'name': pending.name,
            'phone_number': pending.phone_number,
            'email': pending.email,
        }

    @staticmethod
    def verify_and_complete(payload):
        """Atomic: verify Razorpay signature, lookup-or-create User,
        create Appointment, hard-book slot. Returns
        ``{phone_number, account_existed, must_set_password,
        appointment_id}``.

        Raises:
          * :class:`BookingNotFound` if pending_id is unknown / consumed.
          * :class:`SignatureInvalid` if Razorpay's HMAC doesn't match.
          * :class:`PendingExpired` if the pre-lock lapsed.
          * :class:`SlotUnavailable` if the slot was hard-booked by another flow.
        """
        tenant_id = g.get('tenant_id')
        pending = PendingPublicBooking.query.filter_by(
            id=payload['pending_id'],
            tenant_id=tenant_id,
            status='pending',
        ).first()
        if not pending:
            raise BookingNotFound('Pending booking not found or already consumed.')

        # Did the pre-lock lapse before payment came back?
        if datetime.now(timezone.utc) > pending.expires_at.replace(tzinfo=timezone.utc):
            pending.status = 'expired'
            db.session.commit()
            raise PendingExpired('Booking window expired before payment verification.')

        # Razorpay signature check (tenant's own key secret).
        if not _verify_signature(
            payload['razorpay_order_id'],
            payload['razorpay_payment_id'],
            payload['razorpay_signature'],
            tenant_id,
        ):
            pending.status = 'failed'
            pending.razorpay_payment_id = payload['razorpay_payment_id']
            db.session.commit()
            # Release pre-lock so the slot returns to the pool.
            TimeSlotService.release_public_prelock(pending.time_slot_id)
            raise SignatureInvalid('Razorpay signature did not verify.')

        # Sanity: the order ID Razorpay returned must match the one we
        # stored when we created the order. Defends against a forged
        # ``pending_id + someone-else's-payment`` payload.
        if payload['razorpay_order_id'] != pending.razorpay_order_id:
            pending.status = 'failed'
            db.session.commit()
            TimeSlotService.release_public_prelock(pending.time_slot_id)
            raise SignatureInvalid('Order ID does not match this booking.')

        # ── lookup-or-create User by phone_hash, scoped to tenant ── #
        phone_hash = hash_for_search(pending.phone_number)
        user = User.query.filter_by(
            tenant_id=tenant_id,
            _phone_hash=phone_hash,
            is_deleted=False,
        ).first()

        account_existed = user is not None

        if not user:
            # Auto-create a passwordless account. ``password_hash`` is a
            # random unguessable string so the row passes its NOT NULL
            # constraint; the patient has no way to know it. They log
            # in with phone OTP and then set a real password via
            # ``/auth/set-initial-password`` (the route guard forces this
            # before the dashboard renders).
            user = User(
                tenant_id=tenant_id,
                role=UserRole.PATIENT,
                status=UserStatus.ACTIVE,
                first_name=(pending.name.split() or ['Patient'])[0],
                last_name=(' '.join(pending.name.split()[1:]) or None),
                dob=pending.dob,
                must_set_password=True,
                email_verified=False,
                password_hash=generate_password_hash(secrets.token_urlsafe(48)),
            )
            user.email = pending.email  # property handles encryption + hash
            user.phone_number = pending.phone_number
            db.session.add(user)
            db.session.flush()  # populate user.id

            # Schema split: first_name / last_name / dob live on User
            # now (see ``app/models/patient.py`` docstring). The User
            # constructor above already sets first_name/last_name/dob,
            # so we don't need to repeat them on Patient — Patient.user
            # reads them off the linked row.
            patient = Patient(
                tenant_id=tenant_id,
                user_id=user.id,
            )
            db.session.add(patient)
            db.session.flush()
        else:
            patient = user.patient_profile
            if not patient:
                # Edge case: phone matches a non-patient user (admin /
                # doctor / etc.). Refuse the booking — this would otherwise
                # silently attach a patient appointment to a non-patient.
                pending.status = 'failed'
                db.session.commit()
                TimeSlotService.release_public_prelock(pending.time_slot_id)
                raise SlotUnavailable(
                    'This phone is registered as a non-patient account; '
                    'please contact support.'
                )

        # ── the doctor must be free then (no scheduled service/group call
        # overlapping this consultation) ── #
        from app.common.scheduling_conflicts import find_conflict_local
        from app.models import TimeSlot
        _slot = TimeSlot.query.get(pending.time_slot_id)
        if _slot is not None:
            conflict = find_conflict_local(
                pending.doctor_id, tenant_id,
                _slot.date, _slot.start_time, _slot.end_time,
            )
            if conflict:
                TimeSlotService.release_public_prelock(pending.time_slot_id)
                pending.status = 'failed'
                db.session.commit()
                raise SlotUnavailable(conflict)

        # ── hard-book the slot ── #
        try:
            slot = TimeSlotService.confirm_public_booking(pending.time_slot_id)
        except ValueError as e:
            pending.status = 'failed'
            db.session.commit()
            raise SlotUnavailable(str(e))

        # ── create the Appointment ── #
        appointment_type = AppointmentType.ONLINE
        try:
            ct_enum = ConsultationType(pending.consultation_type)
        except (ValueError, KeyError):
            ct_enum = ConsultationType.VIDEO

        # In-clinic / home-visit / camp consultation types are physical.
        if ct_enum in (ConsultationType.HOME_VISIT, ConsultationType.CAMP):
            appointment_type = AppointmentType.HOME_VISIT
        elif ct_enum == ConsultationType.COMPLETE:
            appointment_type = AppointmentType.IN_CLINIC

        appointment = Appointment(
            tenant_id=tenant_id,
            patient_id=patient.id,
            doctor_id=pending.doctor_id,
            time_slot_id=slot.id,
            appointment_date=slot.date,
            start_time=slot.start_time,
            consultation_type=ct_enum,
            appointment_type=appointment_type,
            status=AppointmentStatus.PENDING,  # paid → awaiting doctor confirm
            chief_complaint=pending.description,
        )
        db.session.add(appointment)
        db.session.flush()

        # ── record the payment + finalise ── #
        from app.models import Payment, PaymentStatus
        payment = Payment(
            tenant_id=tenant_id,
            appointment_id=appointment.id,
            amount=Decimal(pending.amount_paise) / 100,
            currency='INR',
            status=PaymentStatus.SUCCESS,
            razorpay_order_id=pending.razorpay_order_id,
            razorpay_payment_id=payload['razorpay_payment_id'],
            payment_metadata={'flow': 'public_booking'},
        )
        db.session.add(payment)

        pending.status = 'consumed'
        pending.razorpay_payment_id = payload['razorpay_payment_id']
        pending.consumed_user_id = user.id
        pending.consumed_appointment_id = appointment.id

        db.session.commit()

        # ── trigger first-login OTP (best-effort, don't fail booking) ── #
        # Reuses the SMS helper that powers the existing
        # ``/auth/send-phone-otp`` endpoint. ``purpose`` must be
        # 'login_otp' — the template registry key (with a
        # signup_otp fallback); the auth route fixed the same
        # 'login'-vs-'login_otp' mismatch once already (route.py
        # comment near send-phone-otp). 'login' has no template row
        # and no fallback, so this send failed silently on every
        # public booking. The Redis OTP key is purpose-independent
        # (PHONE_OTP_PREFIX), so verification on the
        # ``/book/first-login`` page is unchanged.
        try:
            from app.services.sms_service import SMSService
            SMSService.send_phone_otp(pending.phone_number,
                                      purpose='login_otp')
        except Exception:
            logger.exception('[PUBLIC_BOOKING] OTP dispatch failed for %s', pending.phone_number)

        return {
            'phone_number': pending.phone_number,
            'account_existed': account_existed,
            'must_set_password': bool(user.must_set_password),
            'appointment_id': str(appointment.id),
        }
