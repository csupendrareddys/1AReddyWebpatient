"""Marshmallow schemas for the public anonymous-booking endpoints.

Anonymous traffic — the schemas below are the only thing standing between
unfiltered request bodies and the service layer. Every field is validated
explicitly; ``unknown=EXCLUDE`` is *not* used on these schemas because we
want a 422 if the client sends a typo'd field name (much better signal
than silently dropping the value).
"""
from marshmallow import Schema, fields, validate

from app.models import ConsultationType


# Allowed consultation type values mirror the enum on the model side.
_VALID_CONSULTATION_TYPES = [c.value for c in ConsultationType]


class InitiateBookingSchema(Schema):
    """``POST /api/public/booking/initiate`` body.

    All five booking-form fields plus the slot the visitor picked. The
    server reads the slot's price from the DB; the client never gets to
    quote a price.
    """
    name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    phone_number = fields.Str(
        required=True,
        validate=validate.Regexp(
            r'^\+?[0-9\s-]{8,20}$',
            error='Phone number must be 8–20 digits (optional + and separators).',
        ),
    )
    email = fields.Email(allow_none=True)
    dob = fields.Date(allow_none=True)
    description = fields.Str(allow_none=True, validate=validate.Length(max=2000))

    doctor_id = fields.UUID(required=True)
    time_slot_id = fields.UUID(required=True)
    consultation_type = fields.Str(
        required=True,
        validate=validate.OneOf(_VALID_CONSULTATION_TYPES),
    )


class VerifyBookingSchema(Schema):
    """``POST /api/public/booking/verify`` body — Razorpay's standard payload."""
    pending_id = fields.UUID(required=True)
    razorpay_order_id = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    razorpay_payment_id = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    razorpay_signature = fields.Str(required=True, validate=validate.Length(min=1, max=200))


class SetInitialPasswordSchema(Schema):
    """``POST /auth/set-initial-password`` body.

    Mirrors the password policy the existing signup uses — minimum 8
    characters, at least one digit, at least one letter. Tightened
    further if/when the project adopts a stronger requirement.
    """
    new_password = fields.Str(
        required=True,
        validate=[
            validate.Length(min=8, max=128),
            validate.Regexp(
                r'^(?=.*[A-Za-z])(?=.*\d).+$',
                error='Password must contain at least one letter and one digit.',
            ),
        ],
    )
