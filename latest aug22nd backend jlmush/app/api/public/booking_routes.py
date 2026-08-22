"""Public anonymous-booking routes.

Five endpoints under ``/api/public/booking/``. All are anonymous; tenant
context comes from the request hostname via the global
``before_request`` middleware. Auth-gating for non-platform tenants would
go through the ``public_booking`` add-on (out of scope for this PR;
platform tenant always passes).
"""
import logging
from datetime import date as date_type, datetime

from marshmallow import ValidationError

from app.api.public import public_bp
from app.api.public.booking_validators import (
    InitiateBookingSchema, VerifyBookingSchema,
)
from app.api.public.booking_service import (
    PublicBookingService,
    BookingNotFound, PendingExpired, SignatureInvalid, SlotUnavailable,
)
from app.api.common.timeslot.service import TimeSlotService
from app.common.responses import (
    success_response, error_response, validation_error_response, not_found_response,
)

logger = logging.getLogger(__name__)


def _parse_date(s, default=None):
    """Tolerant ISO-date parser. Returns ``default`` on bad input."""
    if not s:
        return default
    try:
        return date_type.fromisoformat(s)
    except (ValueError, TypeError):
        return default


def _load(schema_cls):
    """Validate the request body or return a 422 response."""
    from flask import request
    try:
        return schema_cls().load(request.get_json() or {}), None
    except ValidationError as err:
        return None, validation_error_response(err.messages)


# --------------------------------------------------------------------------- #
# Catalog reads (anonymous)
# --------------------------------------------------------------------------- #

@public_bp.route('/booking/specializations', methods=['GET'])
def public_booking_specializations():
    """List specialization categories with at least one bookable doctor."""
    items = PublicBookingService.list_specializations()
    return success_response(data=items)


@public_bp.route('/booking/doctors', methods=['GET'])
def public_booking_doctors():
    """Paginated public doctor listing.

    Query params:
        ?specialization_id=&consultation_type=&name=&page=&per_page=
    """
    from flask import request
    try:
        page = max(1, int(request.args.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        per_page = min(50, max(1, int(request.args.get('per_page', 20))))
    except (TypeError, ValueError):
        per_page = 20

    payload = PublicBookingService.list_doctors(
        specialization_id=request.args.get('specialization_id') or None,
        consultation_type=request.args.get('consultation_type') or None,
        name=request.args.get('name') or None,
        page=page, per_page=per_page,
    )
    return success_response(data=payload)


@public_bp.route('/booking/doctors/<doctor_id>/timeslots', methods=['GET'])
def public_booking_doctor_timeslots(doctor_id):
    """Slot list for a doctor on a given date.

    Query params:
        ?date=YYYY-MM-DD (required)
        ?consultation_type=video|audio|... (optional)

    Hides slots that are booked OR currently held under any soft-lock
    (anonymous pre-lock or patient-side lock). Past slots on today's
    date are also excluded.
    """
    from flask import request
    date_val = _parse_date(request.args.get('date'))
    if not date_val:
        return error_response('Query param ?date=YYYY-MM-DD is required.', status_code=400)
    if date_val < datetime.now().date():
        # Don't waste a DB hit on past dates; the listing helper already
        # skips them, but be explicit.
        return success_response(data=[])

    consultation_type = request.args.get('consultation_type') or None
    slots = TimeSlotService.get_available_slots_for_public(
        doctor_id, date_val, consultation_type=consultation_type,
    )
    return success_response(data=slots)


# --------------------------------------------------------------------------- #
# Booking transaction (initiate → verify)
# --------------------------------------------------------------------------- #

@public_bp.route('/booking/initiate', methods=['POST'])
def public_booking_initiate():
    """Pre-lock the slot, create a Razorpay order, persist a pending row.

    Returns ``{pending_id, razorpay_order_id, key_id, amount_paise,
    currency, name, phone_number, email}``.

    Errors:
      * 422 — validation
      * 409 — slot taken (booked or someone else's pre-lock)
      * 500 — Razorpay misconfiguration
    """
    data, err = _load(InitiateBookingSchema)
    if err:
        return err
    from app.api.pricing.service import GatewayNotConfigured
    try:
        result = PublicBookingService.initiate(data)
    except SlotUnavailable as e:
        return error_response(str(e), status_code=409, code='SLOT_TAKEN')
    except GatewayNotConfigured:
        # No platform-key fallback by design — the clinic must connect its
        # own Razorpay account before it can take online bookings.
        return error_response(
            'Online payment is not available yet — the organisation has not '
            'connected its payment gateway.',
            status_code=409, code='gateway_not_configured')
    return success_response(data=result, status_code=201)


@public_bp.route('/booking/verify', methods=['POST'])
def public_booking_verify():
    """Verify Razorpay payment + atomically create User/Appointment.

    Returns ``{phone_number, account_existed, must_set_password,
    appointment_id}``.

    Errors:
      * 422 — validation
      * 404 — pending_id not found
      * 410 — pre-lock expired before verify (booking voided)
      * 401 — Razorpay signature invalid
      * 409 — slot taken between initiate and verify
    """
    data, err = _load(VerifyBookingSchema)
    if err:
        return err
    try:
        result = PublicBookingService.verify_and_complete(data)
    except BookingNotFound as e:
        return not_found_response(str(e))
    except PendingExpired as e:
        return error_response(str(e), status_code=410, code='BOOKING_EXPIRED')
    except SignatureInvalid as e:
        return error_response(str(e), status_code=401, code='SIGNATURE_INVALID')
    except SlotUnavailable as e:
        return error_response(str(e), status_code=409, code='SLOT_TAKEN')
    return success_response(data=result)
