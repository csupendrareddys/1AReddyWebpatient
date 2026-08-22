"""Public anonymous-booking transient state.

The public landing page lets a visitor book a slot WITHOUT logging in. The
flow is two-phase:

  1. ``POST /api/public/booking/initiate`` — captures the form data, creates
     a Razorpay order, and **soft-locks the chosen TimeSlot** (sets
     ``soft_reservation_expiry`` 15 minutes from now). NO ``User`` or
     ``Appointment`` row is written yet — those exist only for paying
     customers.

  2. ``POST /api/public/booking/verify`` — verifies the Razorpay signature,
     then in one transaction looks up the patient by phone-hash (or creates
     a new ``User`` + ``Patient``), books the slot, records the payment,
     and triggers an OTP for the first login.

This model holds the form payload between (1) and (2) so we never persist a
half-baked ``User`` if the patient abandons checkout.

Auto-cleanup
------------
``status = 'pending'`` rows are valid for 15 minutes (``expires_at``); after
that the row is treated as ``expired`` even if the column hasn't been
updated yet. The matching ``TimeSlot.soft_reservation_expiry`` lapses at
the same moment, so the slot becomes bookable again with no cron sweep
required. ``status`` exists mainly as an audit trail.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, utcnow


class PendingPublicBooking(TenantMixin,TimestampMixin, db.Model):
    """Transient row that holds an in-flight anonymous booking.

    Lifecycle: ``pending → consumed`` on successful verify; ``pending →
    expired`` after 15 minutes if verify never arrives; ``pending → failed``
    on Razorpay verify failure.
    """
    __tablename__ = 'pending_public_bookings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The slot the visitor picked. We hold a soft-lock on this slot via
    # ``TimeSlot.soft_reservation_expiry`` for the lifetime of this row.
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    time_slot_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('time_slots.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    consultation_type = db.Column(db.String(30), nullable=False)

    # Form data captured from the visitor — everything we'll need to create
    # the User + Patient + Appointment when /verify lands.
    name = db.Column(db.String(200), nullable=False) # encrypt it later
    phone_number = db.Column(db.String(20), nullable=False, index=True) # encrypt it later
    email = db.Column(db.String(320), nullable=True) # encrypt it later
    dob = db.Column(db.Date, nullable=True) # encrypt it later
    description = db.Column(db.Text, nullable=True) # encrypt it later

    # Razorpay
    razorpay_order_id = db.Column(db.String(100), nullable=False, unique=True, index=True)
    razorpay_payment_id = db.Column(db.String(100), nullable=True)
    amount_paise = db.Column(db.Integer, nullable=False)

    # Lifecycle. Strings (not enum) so a future product decision to add a
    # new state ("refunded", "manual_review") doesn't require an enum
    # migration.
    status = db.Column(
        db.String(20), nullable=False, default='pending', server_default='pending', index=True,
    )

    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)

    # If /verify ends up resolving to an existing user, link it for audit.
    consumed_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    consumed_appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='SET NULL'),
        nullable=True,
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'time_slot_id': str(self.time_slot_id),
            'consultation_type': self.consultation_type,
            'name': self.name,
            'phone_number': self.phone_number,
            'email': self.email,
            'dob': self.dob.isoformat() if self.dob else None,
            'description': self.description,
            'razorpay_order_id': self.razorpay_order_id,
            'amount_paise': self.amount_paise,
            'status': self.status,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    def __repr__(self):
        return (
            f"<PendingPublicBooking {self.id} status={self.status} "
            f"slot={self.time_slot_id} order={self.razorpay_order_id}>"
        )
