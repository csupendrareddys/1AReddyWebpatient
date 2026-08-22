"""Offline settlement for bookings an admin made on a patient's behalf.

Why this exists separately from :mod:`act_on_behalf`
----------------------------------------------------
Every patient booking flow ends at a Razorpay checkout popup. An admin
booking *for* a patient cannot complete that — they aren't holding the
patient's card — so the act-on-behalf proxy deliberately refuses
``/api/payment/*``. A proxy that could reach it would be a proxy that can
charge someone else's card.

What an admin CAN legitimately record is the offline half of the same
transaction, which is what an IT-support desk actually does:

* **Leave unpaid** — the booking exists, the patient pays later from their own
  app with their own card. Nothing is asserted about money.
* **Mark as paid (offline)** — the patient already paid at the counter / by
  bank transfer, and the admin is recording that fact.

Both branches mirror :meth:`OperationsService.book_on_behalf`, which has
recorded appointment payments this way since before the booking screens were
unified — this module just generalises it to the other two booking kinds.

How settlement stays consistent with a real payment
---------------------------------------------------
The paid branch does NOT set statuses itself. It writes a ``Payment`` row and
hands it to :func:`app.api.common.payment.routes._confirm_payment`, the exact
function Razorpay's verify + webhook call. So an offline-paid appointment goes
to PENDING, an order to ``paid``, and a plan installment to ``paid`` with its
booking moving to ``pending_acceptance`` — including every downstream effect
(payouts, channels, documents) — with no second implementation to drift.

The unpaid branch tags the payment ``expiry_exempt`` so the 10-minute
unpaid-appointment reaper doesn't quietly cancel a booking the admin made for
a patient who is going to pay tomorrow.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.operations import operations_bp
from app.api.admin.operations.service import OperationsService
from app.common.decorators import role_required, rbac_required
from app.common.responses import (
    success_response, error_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    UserRole, PermissionModule, PermissionAction, record_ops_action,
    Payment, PaymentStatus, Appointment, AppointmentStatus, MarketplaceOrder,
    GroupOfferingBookingInstallment,
)

logger = logging.getLogger(__name__)

_OPS = PermissionModule.OPERATIONS_PATIENT

# The gateway name every offline admin settlement carries. Reporting reads this
# to tell counter cash from a Razorpay capture; it is also what
# ``book_on_behalf`` has always written, so the two stay one bucket.
OFFLINE_GATEWAY = 'offline_admin'

# What each ``kind`` settles: the model, the Payment FK column, and a
# resolver returning ``(row, amount, error)``. Keeping them in one table is
# what stops a fourth booking kind from being half-wired.
KINDS = ('appointment', 'order', 'booking_installment')


def _resolve_appointment(patient, tenant_id, target_id):
    appt = Appointment.query.filter_by(
        id=target_id, patient_id=patient.id, tenant_id=tenant_id,
        is_deleted=False,
    ).first()
    if not appt:
        return None, None, 'Appointment not found for this patient.'
    if appt.status not in (AppointmentStatus.PENDING_PAYMENT, AppointmentStatus.PENDING):
        return None, None, (
            f"This appointment can't be settled (status: {appt.status.value})."
        )
    amount = float(appt.consultation_fee or 0)
    if amount <= 0:
        return None, None, 'This appointment has no consultation fee set.'
    return appt, amount, None


def _resolve_order(patient, tenant_id, target_id):
    order = MarketplaceOrder.query.filter_by(
        id=target_id, patient_id=patient.id, tenant_id=tenant_id,
    ).first()
    if not order:
        return None, None, 'Order not found for this patient.'
    if order.status != 'pending':
        return None, None, (
            f"This order can't be settled (status: {order.status})."
        )
    amount = float(order.price_at_purchase or 0)
    if amount <= 0:
        return None, None, 'This order has no price set.'
    return order, amount, None


def _resolve_installment(patient, tenant_id, target_id):
    inst = GroupOfferingBookingInstallment.query.filter_by(
        id=target_id, tenant_id=tenant_id,
    ).first()
    if not inst:
        return None, None, 'Installment not found.'
    booking = inst.booking
    if not booking or booking.patient_id != patient.id:
        return None, None, 'Installment not found for this patient.'
    if inst.status == 'paid':
        return None, None, 'This installment is already paid.'
    # Same in-order rule the patient's own checkout enforces — an admin
    # shouldn't be able to settle installment 3 while 2 is outstanding.
    nxt = booking.next_due_installment
    if nxt and nxt.id != inst.id:
        return None, None, 'Settle the earlier installment first.'
    amount = float(inst.amount or 0)
    if amount <= 0:
        return None, None, 'This installment has no amount set.'
    return inst, amount, None


_RESOLVERS = {
    'appointment': (_resolve_appointment, 'appointment_id'),
    'order': (_resolve_order, 'order_id'),
    'booking_installment': (_resolve_installment, 'booking_installment_id'),
}


@operations_bp.route('/patients/<patient_id>/settle-payment', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.EDIT)
def ops_settle_payment(patient_id):
    """Record the offline payment state of one booking made for a patient.

    Body::

        {
          "kind": "appointment" | "order" | "booking_installment",
          "id": "<uuid of that row>",
          "mark_as_paid": false      // default: leave unpaid
        }

    The amount is always read from the row — never from the body — so an
    admin can record *that* a patient paid, never *how much*.
    """
    body = request.get_json(silent=True) or {}
    kind = (body.get('kind') or '').strip()
    target_id = body.get('id')
    mark_as_paid = bool(body.get('mark_as_paid'))

    if kind not in _RESOLVERS:
        return error_response(
            f"kind must be one of: {', '.join(KINDS)}.", status_code=400)
    if not target_id:
        return error_response('id is required.', status_code=400)

    tenant_id = current_tenant_id_strict()
    patient = OperationsService.get_patient(tenant_id, patient_id)
    if not patient:
        return not_found_response('Patient')
    if not patient.user:
        return error_response('Patient has no linked user account.', status_code=400)

    resolve, fk_column = _RESOLVERS[kind]
    try:
        row, amount, err = resolve(patient, tenant_id, target_id)
    except Exception:  # noqa: BLE001 — a malformed uuid shouldn't 500
        logger.exception('[OPS_SETTLE] resolve failed kind=%s id=%s', kind, target_id)
        return error_response('Could not resolve that booking.', status_code=400)
    if err:
        return error_response(err, status_code=400)

    actor = current_user
    fk_filter = {fk_column: row.id, 'tenant_id': patient.tenant_id}

    # Never record the same money twice. An appointment stays settleable at
    # status PENDING (that's how the patient's own retry works), so without
    # this a second click would write a second full-price payment and double
    # the patient's ledger. The order and installment resolvers already refuse
    # on their own status, but the guard belongs in one place for all three.
    if Payment.query.filter_by(status=PaymentStatus.SUCCESS, **fk_filter).first():
        return error_response(
            'This booking is already paid — nothing to settle.', status_code=400)

    meta = {
        'flow': 'ops_settle_payment',
        'recorded_by': str(actor.id),
        'mode': 'offline',
        'kind': kind,
    }
    if not mark_as_paid:
        # The unpaid-appointment reaper cancels PENDING_PAYMENT bookings after
        # ~10 minutes. An admin booking for a patient who pays tomorrow is
        # exactly the case that shouldn't be reaped.
        meta['expiry_exempt'] = True

    # "Booked unpaid, patient paid at the counter the next day" is the normal
    # support sequence, and it's one payment, not two — so a second call
    # completes the pending offline row rather than adding another.
    payment = Payment.query.filter_by(
        status=PaymentStatus.PENDING, payment_gateway=OFFLINE_GATEWAY, **fk_filter,
    ).first()
    if payment is not None:
        payment.amount = amount
        payment.payment_metadata = {**(payment.payment_metadata or {}), **meta}
        if mark_as_paid:
            payment.payment_metadata.pop('expiry_exempt', None)
    else:
        payment = Payment(
            tenant_id=patient.tenant_id,
            user_id=patient.user_id,
            amount=amount,
            currency='INR',
            payment_gateway=OFFLINE_GATEWAY,
            # PENDING either way. The paid branch flips it via _confirm_payment,
            # which is a no-op on a row already marked SUCCESS — creating it as
            # SUCCESS would make that guard swallow the settlement entirely.
            status=PaymentStatus.PENDING,
            payment_metadata=meta,
            **{fk_column: row.id},
        )
        db.session.add(payment)
    db.session.flush()

    if mark_as_paid:
        # The same function Razorpay's verify + webhook call. Everything that
        # follows a real payment follows this one.
        from app.api.common.payment.routes import _confirm_payment
        _confirm_payment(payment)

    record_ops_action(
        actor.id, 'patient', patient.id, 'settle_payment',
        {
            'kind': kind, 'target_id': str(row.id),
            'mark_as_paid': mark_as_paid, 'amount': str(amount),
            'payment_id': str(payment.id),
        },
    )
    db.session.commit()

    logger.info(
        '[OPS_SETTLE] patient=%s kind=%s id=%s paid=%s amount=%s actor=%s',
        patient.id, kind, row.id, mark_as_paid, amount, actor.id,
    )
    return success_response(
        message=('Recorded as paid offline.' if mark_as_paid
                 else 'Booked. The patient can pay from their own app.'),
        data={
            'payment_id': str(payment.id),
            'kind': kind,
            'target_id': str(row.id),
            'amount': amount,
            'paid': mark_as_paid,
        },
    )
