"""
Payment Routes - Razorpay Integration (Full Implementation)

Flow:
  1. POST /api/payment/create-order  → Create RazorPay order, store CREATED payment
  2. Frontend opens Razorpay popup
  3. POST /api/payment/verify         → Verify HMAC signature, CONFIRM appointment
  4. POST /api/payment/webhook        → Server-side backup (handles browser close)
  5. GET  /api/payment/appointment/<id> → Check payment status

Environment variables required:
  RAZORPAY_KEY_ID        - your Razorpay key id (rzp_test_... / rzp_live_...)
  RAZORPAY_KEY_SECRET    - your Razorpay key secret
  RAZORPAY_WEBHOOK_SECRET - webhook secret from Razorpay dashboard
"""
import os
import hmac
import hashlib
import logging
import json
from datetime import datetime, timezone

from flask import request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy.exc import IntegrityError

from app.api.common.payment import payment_bp
from app.common.responses import success_response, error_response, forbidden_response
from app.extensions import db, limiter
from app.models import (
    Appointment, MarketplaceOrder, Payment, User,
    AppointmentStatus, PaymentStatus, UserRole,
    GroupOfferingBooking, GroupOfferingBookingInstallment,
)
from app.common.decorators import role_required

logger = logging.getLogger(__name__)


def _razorpay_client(binding):
    """Razorpay client for a resolved :class:`PaymentGatewayBinding` —
    the tenant's own keys on the collection rail, the vendor's env keys on
    the subscription rail. Raises RuntimeError if the binding is unusable."""
    try:
        import razorpay
    except ImportError:
        raise RuntimeError("razorpay package not installed. Run: pip install razorpay")

    if not binding or not binding.key_id or not binding.key_secret:
        raise RuntimeError("Payment gateway credentials are incomplete.")
    return razorpay.Client(auth=(binding.key_id, binding.key_secret))


def _tenant_binding_or_response(tenant_id):
    """Resolve the TENANT collection binding, or a ready-to-return error
    response. There is deliberately no platform-key fallback: a tenant
    without their own Razorpay keys cannot collect money at all."""
    from app.api.pricing.service import (
        FeatureDisabled, GatewayNotConfigured, NoActiveSubscription,
        PaymentResolver,
    )
    try:
        return PaymentResolver.resolve_gateway(tenant_id), None
    except FeatureDisabled:
        return None, error_response("Razorpay is not enabled on your plan", code='feature_disabled',
                                    status_code=403)
    except NoActiveSubscription:
        return None, error_response("Tenant has no active subscription", code='no_active_subscription',
                                    status_code=402)
    except GatewayNotConfigured:
        return None, error_response(
            "Online payment is not available yet — the organisation hasn't "
            "connected its payment gateway.",
            status_code=409, code='gateway_not_configured')


def _gateway_meta(binding, owner_tenant_id=None):
    """The binding snapshot stamped into ``payment_metadata['gateway']`` at
    order creation, so verify/webhook use the SAME credentials rail even if
    the tenant's config changes mid-checkout. Never contains secrets.

    ``owner_tenant_id`` — the tenant whose GATEWAY collects. For a
    sub-tenant's subscription this is the APEX parent (the plan owner),
    NOT the paying tenant, so verify/webhook must not derive the key
    owner from ``payment.tenant_id``.
    """
    meta = {
        'source': binding.credentials_source,
        'config_id': binding.credentials_ref,
        'key_id': binding.key_id,
    }
    if owner_tenant_id:
        meta['owner_tenant_id'] = str(owner_tenant_id)
    return meta


def _secret_for_payment(payment):
    """The key secret that signed this payment's order — resolved from the
    rail recorded at create-order time.

    * ``tenant_config`` → the config of the snapshot's ``owner_tenant_id``
      when present (reseller rail: an apex parent collecting a child's
      subscription), else the payment's own tenant (marketplace rail).
    * ``platform_env`` (vendor subscription rail) or missing (legacy rows
      created before tenant gateways existed) → the platform env secret.
    """
    gw = (payment.payment_metadata or {}).get('gateway') or {}
    if gw.get('source') == 'tenant_config':
        from app.models import TenantPaymentConfig
        owner_id = gw.get('owner_tenant_id') or payment.tenant_id
        config = TenantPaymentConfig.for_tenant(owner_id)
        return config.razorpay_key_secret if config else None
    return os.environ.get('RAZORPAY_KEY_SECRET', '') or None


def _patient_prefill(user):
    """Razorpay checkout prefill resolved from the logged-in patient's stored
    profile so the popup never re-asks for the phone/email/name.

    ``User.phone_number`` / ``User.email`` are decrypted properties; guard each
    access so a missing/undecryptable field just yields an empty string rather
    than blowing up order creation.
    """
    def _safe(attr):
        try:
            return (getattr(user, attr, None) or '') or ''
        except Exception:  # pragma: no cover - decryption edge
            return ''

    name = _safe('first_name')
    last = _safe('last_name')
    full = (name + ' ' + last).strip()
    return {
        'name': full or name or '',
        'email': _safe('email'),
        'contact': _safe('phone_number'),
    }


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str,
                               key_secret: str) -> bool:
    """Verify HMAC-SHA256 Razorpay payment signature against the key secret
    of whichever rail created the order (tenant config / platform env)."""
    if not key_secret:
        return False
    body = f"{order_id}|{payment_id}".encode('utf-8')
    expected = hmac.new(key_secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _confirm_payment(payment: Payment) -> None:
    """
    Idempotent: mark payment SUCCESS and settle whatever it paid for —
    an appointment (→ PENDING, awaiting doctor approval) or a marketplace order
    (→ under_process + open its communication channel). Safe to call multiple
    times (from verify + webhook).
    """
    if payment.status == PaymentStatus.SUCCESS:
        return  # already processed — idempotency guard

    payment.status = PaymentStatus.SUCCESS
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'confirmed_at': datetime.now(timezone.utc).isoformat(),
    }

    # Marketplace order (service / group-service purchase).
    if payment.order_id:
        _confirm_order_payment(payment)
        return

    # Group Offering plan booking installment.
    if payment.booking_installment_id:
        _confirm_booking_installment_payment(payment)
        return

    # SaaS add-on purchase (checked BEFORE the subscription branch —
    # add-on payments also carry tenant_subscription_id for bookkeeping).
    if (payment.payment_metadata or {}).get('saas_addon'):
        _confirm_addon_payment(payment)
        return

    # SaaS subscription period (tenant → vendor). Extends the paid window.
    if payment.tenant_subscription_id:
        _confirm_subscription_payment(payment)
        return

    # Appointment payment (unchanged).
    appointment = payment.appointment if hasattr(payment, 'appointment') else \
        Appointment.query.get(payment.appointment_id)
    if appointment and appointment.status in (
        AppointmentStatus.PENDING_PAYMENT, AppointmentStatus.PENDING
    ):
        appointment.status = AppointmentStatus.PENDING
        appointment.payment_expiry = None  # clear expiry once paid
        # Apply the doctor's effective acceptance mode (admin approval policy /
        # per-doctor override): auto_accept → CONFIRMED, auto_reject → CANCELLED
        # + refund, manual → stays PENDING. No-op commit here; caller commits.
        from app.api.common.appointment.service import AppointmentService
        AppointmentService.apply_acceptance_mode(appointment)


def _confirm_order_payment(payment: Payment) -> None:
    """Mark a marketplace order PAID and awaiting the provider's decision.

    The channel is NOT opened here — the patient pays at booking, then the
    provider accepts (which opens the channel) or rejects. So payment success
    only advances the order to ``paid``. Idempotent.
    """
    order = payment.order or MarketplaceOrder.query.get(payment.order_id)
    if order is None:
        logger.warning("[PAYMENT] order %s not found for payment %s",
                       payment.order_id, payment.id)
        return

    # paid = booked + paid, awaiting the provider's accept / reject. Don't
    # regress an order the provider already accepted (under_process/completed).
    if order.status in ('pending',):
        order.status = 'paid'
    order.payment_id = payment.transaction_id or str(payment.id)
    logger.info("[PAYMENT] order %s paid → awaiting provider decision", order.id)


def _confirm_booking_installment_payment(payment: Payment) -> None:
    """Mark a Group Offering booking installment PAID.

    When the booking (first) installment is paid, the whole booking activates.
    Idempotent.
    """
    inst = GroupOfferingBookingInstallment.query.get(payment.booking_installment_id)
    if inst is None:
        logger.warning("[PAYMENT] booking installment %s not found for payment %s",
                       payment.booking_installment_id, payment.id)
        return
    if inst.status != 'paid':
        inst.status = 'paid'
        inst.paid_at = datetime.now(timezone.utc)
        inst.payment_id = payment.id

    booking = inst.booking
    if booking is not None:
        # Payment does NOT open the channels — like a marketplace service order
        # going to 'paid', the booking now AWAITS the team lead's acceptance.
        # Channels, payouts and the lead's completion document are all created
        # on acceptance (see doctor accept_group_booking). Idempotent.
        if booking.status == 'pending_payment' and (booking.all_paid or inst.is_booking):
            booking.status = 'pending_acceptance'
            logger.info("[PLAN] booking %s paid → awaiting team-lead acceptance", booking.id)
    logger.info("[PAYMENT] booking installment %s paid", inst.id)


def _notify_appointment_settled(payment: Payment) -> None:
    """AFTER the settlement commit: tell the provider (and, when auto-
    confirmed/rejected, the patient) about the paid booking/order.
    Callers pass only payments that actually transitioned to SUCCESS in
    this request, so verify + webhook can't double-notify. Best-effort."""
    try:
        if payment.order_id:
            # Marketplace service order paid → the provider decides next.
            from app.common.notify import notify_order_event
            order = MarketplaceOrder.query.get(payment.order_id)
            if order is not None:
                notify_order_event(order, 'paid')
            return
        if not payment.appointment_id:
            return
        from app.common.notify import notify_appointment_event
        appointment = Appointment.query.get(payment.appointment_id)
        if appointment is None:
            return
        if appointment.status == AppointmentStatus.CONFIRMED:
            notify_appointment_event(appointment, 'booked_auto_confirmed')
        elif appointment.status == AppointmentStatus.CANCELLED:
            notify_appointment_event(appointment, 'auto_cancelled')
        else:
            notify_appointment_event(appointment, 'booked')
    except Exception:  # noqa: BLE001 — settlement already succeeded
        logger.exception('[NOTIFY] settle notify failed')


def _confirm_addon_payment(payment: Payment) -> None:
    """Apply one paid add-on purchase. Reached from verify AND the
    webhook backup — the SUCCESS guard in :func:`_confirm_payment`
    makes the second arrival a no-op."""
    from app.api.pricing import subscription_billing as sbill
    from app.models import Addon, TenantSubscription

    meta = (payment.payment_metadata or {}).get('saas_addon') or {}
    sub = TenantSubscription.query.filter_by(
        id=payment.tenant_subscription_id, is_deleted=False).first()
    addon = Addon.query.filter_by(
        code=meta.get('code'), is_deleted=False).first()
    if sub is None or addon is None:
        logger.error('[PAYMENT] addon confirm missing sub/addon for '
                     'payment %s', payment.id)
        return
    # An apex buying FOR a child carries target_tenant_id + tier_key
    # in the metadata; the grant lands on the CHILD. Self-purchases
    # leave both absent and stay exactly as before.
    target = meta.get('target_tenant_id') or str(sub.tenant_id)
    tier_key = meta.get('tier_key') or 'main'
    try:
        if meta.get('resale_stock'):
            # Resale INVENTORY, not an entitlement: the units land in the
            # apex's pool for its children to draw from, and grant the
            # apex itself nothing.
            sbill.grant_resale_stock(
                str(sub.tenant_id), addon, tier_key,
                meta.get('quantity') or 1, actor_user_id=payment.user_id)
        else:
            sbill.apply_addon_purchase(
                target, addon,
                meta.get('period') or 'monthly',
                meta.get('quantity') or 1,
                actor_user_id=payment.user_id,
                tier_key=tier_key,
            )
    except sbill.SubscriptionBillingError:
        logger.exception('[PAYMENT] addon apply failed for payment %s',
                         payment.id)
        return
    logger.info('[PAYMENT] addon %s x%s applied tenant=%s tier=%s',
                meta.get('code'), meta.get('quantity'), target, tier_key)


def _confirm_subscription_payment(payment: Payment) -> None:
    """Apply one paid SaaS-subscription period (vendor rail). Reached from
    verify AND the webhook backup — the SUCCESS guard in
    :func:`_confirm_payment` makes the second arrival a no-op, so the
    period can never be applied twice for one payment."""
    from app.api.pricing import subscription_billing as sbill
    from app.models import TenantSubscription

    sub = TenantSubscription.query.filter_by(
        id=payment.tenant_subscription_id, is_deleted=False,
    ).first()
    if sub is None:
        logger.error("[PAYMENT] subscription %s not found for payment %s",
                     payment.tenant_subscription_id, payment.id)
        return

    meta = (payment.payment_metadata or {}).get('saas_subscription') or {}
    period = meta.get('period') or 'monthly'
    try:
        sbill.apply_paid_period(sub, period, actor_user_id=payment.user_id)
    except sbill.SubscriptionBillingError:
        logger.exception("[PAYMENT] period apply failed for payment %s",
                         payment.id)
        return

    # Receipt — best-effort, never blocks settlement.
    try:
        from app.models import User
        from app.services.email_service import EmailService
        payer = User.query.get(payment.user_id)
        if payer is not None:
            EmailService._send_safe(
                'saas_payment_received', payer,
                plan_name=sub.plan.name if sub.plan else sub.plan_id,
                amount_inr=f'{float(payment.amount):.2f}',
                period=period,
                period_end=sub.current_period_end.strftime('%d %b %Y'),
            )
    except Exception:  # noqa: BLE001
        logger.exception("[PAYMENT] receipt email failed (non-fatal)")

    # In-app leg of the receipt — the seller->tenant bell. Post-commit
    # (period apply committed above), best-effort like the email.
    try:
        from app.common.notify import notify_tenant_admins
        notify_tenant_admins(
            str(sub.tenant_id), type='saas_payment_received',
            title='Payment received',
            body='Your %s subscription is active. Thank you!'
                 % (sub.plan.name if sub.plan else 'plan'),
            data={'kind': 'subscription',
                  'url': '/dashboard/admin/subscription/my'},
        )
    except Exception:  # noqa: BLE001
        logger.exception("[PAYMENT] receipt in-app notify failed (non-fatal)")


def _create_lead_plan_document(booking) -> None:
    """Seed the completion document for the plan — one per booking, owned by the
    TEAM LEAD. It lands as a DRAFT in the lead's "My Documents" hub (the same
    place service documents live); the lead writes/uploads it there, and the
    booking completes when it is pushed. Idempotent; best-effort."""
    if not booking.team_id:
        return
    try:
        from app.models import (
            DoctorDocument, DocumentStatus, MarketplaceServiceGroupMember, Doctor,
        )
        lead = MarketplaceServiceGroupMember.query.filter_by(
            tenant_id=booking.tenant_id, group_id=booking.team_id, role='lead',
        ).first()
        if not lead or not lead.doctor_id:
            return
        exists = DoctorDocument.query.filter_by(
            tenant_id=booking.tenant_id, group_booking_id=booking.id, is_deleted=False,
        ).first()
        if exists:
            return
        db.session.add(DoctorDocument(
            tenant_id=booking.tenant_id,
            group_booking_id=booking.id,
            patient_id=booking.patient_id,
            doctor_id=lead.doctor_id,
            description=booking.plan_name,
            custom_fields=[],
            status=DocumentStatus.DRAFT,
        ))
        logger.info("[PLAN] booking %s → lead completion document seeded", booking.id)
    except Exception as e:  # noqa: BLE001
        logger.exception("[PLAN] booking %s lead document seed error: %s", booking.id, e)


def _activate_plan_channels(booking) -> None:
    """Open the team's channels (group chat + per-doctor 1:1) for a paid plan
    booking. Best-effort — reuses the group-service activation; never blocks."""
    if not booking.team_id:
        return
    try:
        from app.api.service_communication.service import (
            ActivationService, ServiceCommunicationError,
        )
        from app.models import MarketplaceServiceGroup
        # Older teams were created without the plan's backing product — backfill
        # it here so activate_group (which is product-scoped) can open channels.
        team = MarketplaceServiceGroup.query.get(booking.team_id)
        if team is not None and not team.product_id and booking.offering is not None:
            from app.api.admin.group_offerings import ensure_plan_product
            prod = ensure_plan_product(booking.tenant_id, booking.offering)
            team.product_id = prod.id
            db.session.flush()
        ActivationService.activate_group(
            group_id=booking.team_id, patient_id=booking.patient_id,
            tenant_id=booking.tenant_id,
        )
        logger.info("[PLAN] booking %s paid → team channels opened", booking.id)
    except ServiceCommunicationError as e:
        logger.info("[PLAN] booking %s no channel: %s", booking.id, getattr(e, 'message', e))
    except Exception as e:  # noqa: BLE001
        logger.exception("[PLAN] booking %s channel activation error: %s", booking.id, e)


def _plan_gst_rate(offering):
    if offering.tax_mode == 'intra_state':
        return float(offering.cgst_rate or 0) + float(offering.sgst_rate or 0)
    if offering.tax_mode == 'inter_state':
        return float(offering.igst_rate or 0)
    return 0.0


def _generate_plan_payouts(booking) -> None:
    """Create DoctorPayout rows for a fully-paid plan booking — one per team
    member per payout installment — through the real payout lifecycle
    (hold/claim/Cashfree). Tax is included in the fee, so GST + TDS are carved
    out. Each installment's ``hold_until`` is offset by its period so it matures
    on schedule. Idempotent (keyed on source_ref_id). No separate ledger.
    """
    from app.models import (
        DoctorPayout, Doctor, BillingConfig, MarketplaceServiceGroup, Payment as _P,
    )
    from app.api.admin.payout import _generate_bill_number
    from app.api.common.payment.billing_service import (
        apply_hold, resolve_tds_rate, compute_platform_charges,
        charges_snapshot_for,
    )
    from datetime import timedelta
    from decimal import Decimal as _D

    team = MarketplaceServiceGroup.query.get(booking.team_id) if booking.team_id else None
    offering = booking.offering
    if team is None or offering is None:
        logger.warning("[PAYOUT] booking %s missing team/offering — skipping", booking.id)
        return
    gst_rate = _plan_gst_rate(offering)
    config = BillingConfig.query.filter_by(tenant_id=booking.tenant_id).first() or BillingConfig()
    now = datetime.now(timezone.utc)

    from app.models import GroupOfferingMember
    for m in team.members:
        if m.status != 'accepted' or not m.doctor_id:
            continue
        doctor = Doctor.query.get(m.doctor_id)
        slot = (GroupOfferingMember.query.get(m.group_offering_member_id)
                if m.group_offering_member_id else None)
        slot_name = slot.qualification_name if slot else 'slot'
        for inst in m.payout_installments:
            if DoctorPayout.query.filter_by(
                tenant_id=booking.tenant_id, source_type='plan_installment',
                source_ref_id=inst.id,
            ).first():
                continue  # already generated
            gross = inst.resolved_amount
            if gross <= 0:
                continue
            gst = gross * gst_rate / 100
            # Platform charges from the doctor's plan (same source as a
            # consultation payout); tax stays offering-driven (gst_rate above).
            c1, c2, c3 = compute_platform_charges(doctor, _D(str(gross)))
            total_charges = float(c1 + c2 + c3)
            # GST is the doctor's own output tax — shown but NOT withheld; we
            # don't collect it, the doctor remits it themselves (Indian GST,
            # uniform with the consultation + service payouts). TDS (194J,
            # excludes GST) and platform charges are the only deductions.
            net_of_gst = gross - gst - total_charges
            tds = net_of_gst * float(resolve_tds_rate(doctor, config)) / 100
            payout_amount = gross - total_charges - tds
            label = (f"{offering.name} — {slot_name} "
                     f"(inst {inst.installment_no})")
            payout = DoctorPayout(
                tenant_id=booking.tenant_id,
                doctor_id=m.doctor_id,
                appointment_id=None,
                source_type='plan_installment',
                source_ref_id=inst.id,
                source_label=label[:200],
                bill_number=_generate_bill_number(),
                appointment_amount=0,
                payment_amount=gross,
                taxes_gst=gst,
                total_charges=total_charges,
                charge1_amount=c1, charge2_amount=c2, charge3_amount=c3,
                charges_snapshot=charges_snapshot_for(doctor, _D(str(gross)), (c1, c2, c3)),
                tds_amount=tds,
                payout_amount=payout_amount,
                consultation_type='plan',
            )
            apply_hold(payout, doctor)
            # Installment period: don't let it mature before its due date.
            due = now + timedelta(days=inst.due_after_days or 0)
            if payout.hold_until is None or payout.hold_until < due:
                payout.hold_until = due
                if due > now:
                    from app.models import PayoutStatus
                    payout.status = PayoutStatus.ON_HOLD
            db.session.add(payout)
    logger.info("[PAYOUT] generated plan DoctorPayouts for booking %s", booking.id)


def _create_booking_installment_payment(booking_installment_id, user, tenant_id,
                                        binding):
    """Create a Razorpay order for one pending booking installment.

    Amount comes from the installment snapshot in the DB, never the client.
    The booking installment must be paid before later ones (in order).
    """
    inst = (
        GroupOfferingBookingInstallment.query
        .filter_by(id=booking_installment_id, tenant_id=tenant_id)
        .first()
    )
    if not inst:
        return error_response("Installment not found", status_code=404)

    booking = inst.booking
    if not booking or booking.patient_id != user.patient_profile.id:
        return error_response("Installment not found", status_code=404)
    if inst.status == 'paid':
        return error_response("This installment is already paid.", status_code=400)

    # Enforce paying in order — no skipping ahead.
    nxt = booking.next_due_installment
    if nxt and nxt.id != inst.id:
        return error_response("Pay the earlier installment first.", status_code=400)

    amount_rupees = float(inst.amount or 0)
    if amount_rupees <= 0:
        return error_response("Installment amount is not set.", status_code=400)
    amount_paise = int(amount_rupees * 100)

    try:
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(inst.id)[:40],
            'notes': {'booking_installment_id': str(inst.id), 'booking_id': str(booking.id)},
        })
    except RuntimeError as e:
        logger.error("Razorpay config error: %s", e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception("Razorpay order creation failed")
        return error_response(f"Payment gateway error: {str(e)}", status_code=502)

    payment = Payment(
        booking_installment_id=inst.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={'razorpay_order': rz_order,
                          'gateway': _gateway_meta(binding)},
    )
    db.session.add(payment)
    db.session.commit()

    logger.info("[PAYMENT] Order created: %s for booking installment %s",
                rz_order['id'], inst.id)
    return success_response(message="Payment order created", data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'booking_installment_id': str(inst.id),
        'prefill': _patient_prefill(user),
    })


def _create_order_payment(order_id, user, tenant_id, binding):
    """Create a Razorpay order for a freshly-booked marketplace order.

    The patient pays at booking (like an appointment); the provider accepts or
    rejects afterwards. Only a ``pending`` (booked, unpaid) order can be paid.
    Amount comes from ``price_at_purchase`` in the DB, never the client.
    """
    order = MarketplaceOrder.query.filter_by(
        id=order_id, patient_id=user.patient_profile.id, tenant_id=tenant_id,
    ).first()
    if not order:
        return error_response("Order not found", status_code=404)
    if order.status != 'pending':
        return error_response(
            f"This order can't be paid (status: {order.status}).", status_code=400)

    amount_rupees = float(order.price_at_purchase or 0)
    if amount_rupees <= 0:
        return error_response("Order price is not set.", status_code=400)
    amount_paise = int(amount_rupees * 100)

    try:
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(order_id)[:40],
            'notes': {'order_id': str(order_id)},
        })
    except RuntimeError as e:
        logger.error("Razorpay config error: %s", e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception("Razorpay order creation failed")
        return error_response(f"Payment gateway error: {str(e)}", status_code=502)

    payment = Payment(
        order_id=order.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={'razorpay_order': rz_order,
                          'gateway': _gateway_meta(binding)},
    )
    db.session.add(payment)
    db.session.commit()

    logger.info("[PAYMENT] Order created: %s for marketplace order %s",
                rz_order['id'], order_id)
    return success_response(message="Payment order created", data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'order_id': str(order_id),
        'prefill': _patient_prefill(user),
    })


def _payable_patient_ids(user):
    """Patient ids this user may pay a booking for: their OWN patient, plus any
    managed minor sub-profiles they guardian. A minor's booking is created under
    the minor's patient_id (via the family "act as" scope), but the guardian
    funds it through their own gateway session — so both must be payable."""
    from app.models import HouseGroupMember
    ids = [user.patient_profile.id]
    minors = HouseGroupMember.query.filter_by(
        tenant_id=user.tenant_id, patient_id=user.patient_profile.id,
        is_child_account=True, is_active=True,
    ).all()
    ids += [m.linked_patient_id for m in minors if m.linked_patient_id]
    return ids


def _caregiver_payable_patient_ids(user):
    """Patient ids a support-staff CAREGIVER may pay a booking for: the patients
    whose active seat granted them ``can_pay_on_behalf``. The caregiver settles
    from their OWN gateway session (their card, not the patient's) — the booking
    stays the patient's. Empty for a caregiver nobody gave the flag to."""
    from app.models import PatientStaff, PatientStaffStatus
    seats = PatientStaff.query.filter_by(
        tenant_id=user.tenant_id, user_id=user.id,
        status=PatientStaffStatus.ACTIVE, is_deleted=False,
        can_pay_on_behalf=True,
    ).all()
    return [s.patient_id for s in seats]


# ── POST /api/payment/create-order ───────────────────────────────────────────

@payment_bp.route('/create-order', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.PATIENT_STAFF])
def create_payment_order():
    """
    Create a Razorpay order for a PENDING_PAYMENT appointment OR an accepted
    marketplace order (service / group-service). Amount is always read from the
    DB — never trusted from frontend.

    Body: { appointment_id }  OR  { order_id }
    """
    from app.common.tenant_context import current_tenant_id_strict

    # Collection rail: the TENANT's own Razorpay keys, or no payment at all.
    binding, err = _tenant_binding_or_response(current_tenant_id_strict())
    if err:
        return err

    data = request.get_json() or {}
    appointment_id = data.get('appointment_id')
    order_id = data.get('order_id')
    booking_installment_id = data.get('booking_installment_id')
    if not appointment_id and not order_id and not booking_installment_id:
        return error_response(
            "appointment_id, order_id or booking_installment_id is required", status_code=400)

    identity = get_jwt_identity()
    user = User.query.filter_by(id=identity, is_deleted=False).first()
    if not user:
        return error_response("User not found", status_code=404)

    # A support-staff CAREGIVER with can_pay_on_behalf may settle an appointment
    # for the patient they serve — from their OWN gateway session (the patient's
    # card is never charged). They can pay ONLY appointments, and ONLY for
    # patients who granted them the flag; everything else stays the patient's.
    is_caregiver = getattr(user, 'role', None) == UserRole.PATIENT_STAFF
    if is_caregiver:
        if order_id or booking_installment_id:
            return forbidden_response("A caregiver can only pay for appointment bookings.")
        payable_ids = _caregiver_payable_patient_ids(user)
        if not payable_ids:
            return forbidden_response(
                "You don't have permission to pay on this patient's behalf.")
    else:
        if not user.patient_profile:
            return error_response("Patient profile not found", status_code=404)

        # ── Marketplace order (service / group-service) payment ───────────────
        if order_id:
            return _create_order_payment(
                order_id, user, current_tenant_id_strict(), binding)

        # ── Group Offering plan booking installment ───────────────────────────
        if booking_installment_id:
            return _create_booking_installment_payment(
                booking_installment_id, user, current_tenant_id_strict(), binding)

        payable_ids = _payable_patient_ids(user)

    appointment = Appointment.query.filter(
        Appointment.id == appointment_id,
        Appointment.patient_id.in_(payable_ids),
        Appointment.is_deleted == False,  # noqa: E712
    ).first()
    if not appointment:
        return error_response("Appointment not found", status_code=404)

    if appointment.status not in (AppointmentStatus.PENDING_PAYMENT, AppointmentStatus.PENDING):
        return error_response(
            f"Cannot create payment for appointment in status: {appointment.status.value}",
            status_code=400,
        )

    # Check expiry. An Operations "booked on your behalf, pay later" booking is
    # exempt — the 10-minute window exists to stop an abandoned checkout holding
    # a slot, which is not what that is, and enforcing it here would fail the
    # patient's Pay button AND cancel the admin's booking. Same predicate the
    # reaper uses, so the two can't drift apart again.
    from app.api.common.payment.expiry_job import is_expiry_exempt
    if (
        appointment.payment_expiry
        and datetime.now(timezone.utc) > appointment.payment_expiry.replace(tzinfo=timezone.utc)
        and not is_expiry_exempt(appointment)
    ):
        appointment.status = AppointmentStatus.EXPIRED
        # Free the held slot too (mirrors expire_unpaid_appointments) so an
        # expired reservation doesn't hold its time slot forever.
        if appointment.time_slot_id:
            from app.models import TimeSlot
            slot = TimeSlot.query.get(appointment.time_slot_id)
            if slot and slot.is_booked:
                slot.is_booked = False
        db.session.commit()
        return error_response("Payment window expired. Please book again.", status_code=400)

    # Amount lives in DB
    amount_rupees = float(appointment.consultation_fee or 0)
    if amount_rupees <= 0:
        return error_response("Consultation fee not set for this appointment.", status_code=400)

    amount_paise = int(amount_rupees * 100)

    try:
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(appointment_id)[:40],
            'notes': {'appointment_id': str(appointment_id)},
        })
    except RuntimeError as e:
        logger.error("Razorpay config error: %s", e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception("Razorpay order creation failed")
        return error_response(f"Payment gateway error: {str(e)}", status_code=502)

    # Persist payment record with CREATED status
    payment = Payment(
        appointment_id=appointment.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={'razorpay_order': rz_order,
                          'gateway': _gateway_meta(binding)},
    )
    db.session.add(payment)
    db.session.commit()

    logger.info("[PAYMENT] Order created: %s for appointment %s", rz_order['id'], appointment_id)
    return success_response(message="Payment order created", data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'appointment_id': str(appointment_id),
        # Prefill the checkout from our stored profile so Razorpay never
        # re-asks for the patient's phone/email.
        'prefill': _patient_prefill(user),
    })


# ── POST /api/payment/verify ─────────────────────────────────────────────────

@payment_bp.route('/verify', methods=['POST'])
@jwt_required()
@role_required([UserRole.PATIENT, UserRole.PATIENT_STAFF])
def verify_payment():
    """
    Verify Razorpay signature after client-side checkout success.
    Called by frontend immediately after Razorpay popup closes with success.

    Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_id }
    """
    data = request.get_json() or {}
    rz_order_id = data.get('razorpay_order_id')
    rz_payment_id = data.get('razorpay_payment_id')
    rz_signature = data.get('razorpay_signature')
    payment_id = data.get('payment_id')

    if not all([rz_order_id, rz_payment_id, rz_signature, payment_id]):
        return error_response(
            "razorpay_order_id, razorpay_payment_id, razorpay_signature, and payment_id are required",
            status_code=400,
        )

    payment = Payment.query.filter_by(id=payment_id).first()
    if not payment:
        return error_response("Payment record not found", status_code=404)

    if payment.gateway_order_id != rz_order_id:
        return error_response("Order ID mismatch", status_code=400)

    # Idempotency: already confirmed by webhook?
    if payment.status == PaymentStatus.SUCCESS:
        return success_response(message="Payment already verified", data={
            'payment_id': str(payment.id),
            'status': payment.status.value,
        })

    # Verify HMAC signature with the key secret of the rail that created
    # this order (the tenant's own gateway config).
    if not _verify_razorpay_signature(rz_order_id, rz_payment_id, rz_signature,
                                      _secret_for_payment(payment)):
        payment.status = PaymentStatus.FAILED
        payment.payment_metadata = {**(payment.payment_metadata or {}), 'failure_reason': 'signature_mismatch'}
        db.session.commit()
        return error_response("Payment verification failed: invalid signature", status_code=400, code='signature_invalid')

    # Mark SUCCESS and settle whatever it paid for (appointment or order).
    payment.transaction_id = rz_payment_id
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'razorpay_payment_id': rz_payment_id,
        'razorpay_signature': rz_signature,
    }
    is_order = payment.order_id is not None
    _confirm_payment(payment)
    db.session.commit()
    # Persist-first: notify only after the settlement is committed.
    _notify_appointment_settled(payment)

    if is_order:
        logger.info("[PAYMENT] Verified: payment=%s order=%s", payment_id, payment.order_id)
        return success_response(
            message="Payment successful! Your service is now active.", data={
                'payment_id': str(payment.id),
                'status': payment.status.value,
                'order_id': str(payment.order_id),
            })

    logger.info("[PAYMENT] Verified: payment=%s appointment=%s", payment_id, payment.appointment_id)
    return success_response(message="Payment successful! Awaiting doctor approval.", data={
        'payment_id': str(payment.id),
        'status': payment.status.value,
        'appointment_id': str(payment.appointment_id),
    })


# ── Membership plan payment (members: plan-based providers AND patients) ──────
#
# A member pays to ACTIVATE / RENEW / UPGRADE their membership tier — a
# plan-based doctor on the provider side, or a patient on their marketplace
# tier (Care free / Plus / premium). Amount is ALWAYS priced server-side by the
# proration engine — never trusted from the client. A fully-credited upgrade
# (amount 0) activates without a gateway round-trip. Downgrades are refused
# mid-cycle by the pricing engine.

_PROVIDER_ROLES = [UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL]
_MEMBER_ROLES = _PROVIDER_ROLES + [UserRole.PATIENT]


def _resolve_provider_subscription(user, subscription_id, tenant_id):
    """The membership subscription for ``subscription_id`` IF it belongs to the
    authenticated member (provider or patient) — else (None, error_response)."""
    from app.models import MembershipSubscription, Doctor, MembershipVertical
    sub = MembershipSubscription.query.filter_by(
        id=subscription_id, tenant_id=tenant_id, is_deleted=False).first()
    if not sub:
        return None, error_response("Membership subscription not found", status_code=404)
    # Ownership: the row's provider_id must be one of the caller's profiles.
    owned = False
    if sub.provider_type == MembershipVertical.DOCTOR:
        doc = Doctor.query.filter_by(
            id=sub.provider_id, tenant_id=tenant_id, user_id=user.id).first()
        owned = doc is not None
    elif sub.provider_type == MembershipVertical.PATIENT:
        prof = getattr(user, 'patient_profile', None)
        owned = prof is not None and str(prof.id) == str(sub.provider_id)
    if not owned:
        return None, error_response("This membership isn't yours to pay for", status_code=403)
    return sub, None


@payment_bp.route('/membership/create-order', methods=['POST'])
@jwt_required()
@role_required(_MEMBER_ROLES)
def create_membership_payment_order():
    """Create a Razorpay order to activate/renew/upgrade a membership tier.

    Body: { subscription_id, plan_id, period }
    """
    from app.api.membership.service import MembershipSubscriptionService as MSS
    from app.api.membership import proration
    from app.common.tenant_context import current_tenant_id_strict

    data = request.get_json() or {}
    subscription_id = data.get('subscription_id')
    plan_id = data.get('plan_id')
    period = data.get('period') or 'monthly'
    if not subscription_id or not plan_id:
        return error_response("subscription_id and plan_id are required", status_code=400)

    identity = get_jwt_identity()
    user = User.query.filter_by(id=identity, is_deleted=False).first()
    if not user:
        return error_response("User not found", status_code=404)

    tenant_id = current_tenant_id_strict()
    sub, err = _resolve_provider_subscription(user, subscription_id, tenant_id)
    if err:
        return err

    # Membership money is the tenant's marketplace revenue — tenant rail.
    binding, err = _tenant_binding_or_response(tenant_id)
    if err:
        return err

    try:
        _sub, new_plan, quote = MSS.quote_change(
            tenant_id, subscription_id, plan_id, period)
    except proration.PlanChangeError as e:
        return error_response(str(e), status_code=400)
    except (LookupError, ValueError) as e:
        return error_response(str(e), status_code=400)

    base_amount = float(quote['amount_inr'])

    # Health credits — a member (incl. doctors) may spend wallet credits toward
    # their own renewal, capped by the plan's ``membership`` scope policy. Apply
    # BEFORE deciding whether a gateway hop is needed; the actual spend is
    # committed only once payment settles (below / at verify).
    from app.api.membership import credit_service
    redeem_req = float(data.get('redeem_credits') or 0)
    credit_applied = 0.0
    if redeem_req > 0 and base_amount > 0:
        cq = credit_service.quote_redeemable(
            tenant_id, user.id, 'membership', base_amount)
        credit_applied = min(redeem_req, cq['max_redeemable'])
    amount_rupees = max(0.0, base_amount - credit_applied)

    # Fully credited (or free) — no gateway needed; spend the credits, activate.
    if amount_rupees <= 0:
        if credit_applied > 0:
            credit_service.redeem(
                tenant_id, user.id, 'membership', base_amount, credit_applied,
                ref_type='membership_subscription', ref_id=sub.id)
            db.session.commit()
        MSS.apply_paid_activation(
            tenant_id, subscription_id, plan_id, period,
            actor_user_id=user.id)
        return success_response(message="Plan activated.", data={
            'no_payment_needed': True,
            'amount': 0,
            'credit_applied': credit_applied,
            'kind': quote['kind'],
        })

    amount_paise = int(round(amount_rupees * 100))
    try:
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(subscription_id)[:40],
            'notes': {'membership_subscription_id': str(subscription_id),
                      'plan_id': str(plan_id), 'period': period},
        })
    except RuntimeError as e:
        logger.error("Razorpay config error: %s", e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception("Razorpay order creation failed (membership)")
        return error_response(f"Payment gateway error: {str(e)}", status_code=502)

    payment = Payment(
        membership_subscription_id=sub.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={
            'razorpay_order': rz_order,
            'gateway': _gateway_meta(binding),
            'membership': {
                'plan_id': str(plan_id), 'period': period,
                'kind': quote['kind'], 'credit_inr': quote['credit_inr'],
                # Health-credit wallet applied to this renewal — spent on verify.
                'redeem_inr': credit_applied,
                'base_amount_inr': base_amount,
            },
        },
    )
    db.session.add(payment)
    db.session.commit()

    logger.info("[PAYMENT] Membership order created: %s sub=%s plan=%s (%s)",
                rz_order['id'], subscription_id, plan_id, quote['kind'])
    return success_response(message="Payment order created", data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'kind': quote['kind'],
        'credit_inr': quote['credit_inr'],
        'prefill': _patient_prefill(user),
    })


@payment_bp.route('/membership/verify', methods=['POST'])
@jwt_required()
@role_required(_MEMBER_ROLES)
def verify_membership_payment():
    """Verify the Razorpay signature for a membership payment, then activate.

    Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_id }
    """
    from app.api.membership.service import MembershipSubscriptionService as MSS
    from app.common.tenant_context import current_tenant_id_strict

    data = request.get_json() or {}
    rz_order_id = data.get('razorpay_order_id')
    rz_payment_id = data.get('razorpay_payment_id')
    rz_signature = data.get('razorpay_signature')
    payment_id = data.get('payment_id')
    if not all([rz_order_id, rz_payment_id, rz_signature, payment_id]):
        return error_response("razorpay_order_id, razorpay_payment_id, "
                              "razorpay_signature and payment_id are required", status_code=400)

    payment = Payment.query.filter_by(id=payment_id).first()
    if not payment or payment.membership_subscription_id is None:
        return error_response("Membership payment not found", status_code=404)
    if payment.gateway_order_id != rz_order_id:
        return error_response("Order ID mismatch", status_code=400)

    if payment.status == PaymentStatus.SUCCESS:
        return success_response(message="Payment already verified", data={
            'payment_id': str(payment.id), 'status': payment.status.value})

    if not _verify_razorpay_signature(rz_order_id, rz_payment_id, rz_signature,
                                      _secret_for_payment(payment)):
        payment.status = PaymentStatus.FAILED
        payment.payment_metadata = {**(payment.payment_metadata or {}),
                                    'failure_reason': 'signature_mismatch'}
        db.session.commit()
        return error_response("Payment verification failed: invalid signature", status_code=400, code='signature_invalid')

    payment.status = PaymentStatus.SUCCESS
    payment.transaction_id = rz_payment_id
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'razorpay_payment_id': rz_payment_id,
        'razorpay_signature': rz_signature,
    }
    db.session.commit()

    meta = (payment.payment_metadata or {}).get('membership') or {}
    tenant_id = current_tenant_id_strict()

    # Spend any wallet credits applied to this renewal BEFORE activation (a paid
    # activation re-grants — i.e. resets — the wallet, so the spend must land on
    # the old balance first). Capped live by the policy, never blocks activation.
    redeem_inr = float(meta.get('redeem_inr') or 0)
    if redeem_inr > 0:
        try:
            from app.api.membership import credit_service
            credit_service.redeem(
                tenant_id, payment.user_id, 'membership',
                float(meta.get('base_amount_inr') or 0), redeem_inr,
                ref_type='membership_subscription',
                ref_id=payment.membership_subscription_id)
            db.session.commit()
        except Exception:  # noqa: BLE001 — never block activation on credit spend
            logger.exception('[CREDIT] membership redeem on verify failed')

    try:
        sub = MSS.apply_paid_activation(
            tenant_id, str(payment.membership_subscription_id),
            meta.get('plan_id'), meta.get('period') or 'monthly',
            actor_user_id=payment.user_id)
    except (LookupError, ValueError) as e:
        logger.exception("Membership activation after payment failed")
        return error_response(f"Payment captured but activation failed: {e}", status_code=500)

    logger.info("[PAYMENT] Membership verified + activated: sub=%s status=%s",
                sub.id, sub.status.value)
    return success_response(message="Plan activated.", data={
        'payment_id': str(payment.id),
        'status': payment.status.value,
        'subscription': sub.to_dict(),
    })


# ── SaaS subscription billing (tenant → VENDOR; Phase 5) ─────────────────────
#
# The one place money moves on the vendor's own Razorpay keys
# (``PaymentResolver.vendor_gateway``) — a tenant SUPER_ADMIN paying for the
# tenant's SaaS subscription, one period at a time. Never the tenant's keys:
# the two rails must not cross.

@payment_bp.route('/subscription', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_saas_subscription():
    """The tenant's own subscription + what each period costs + payment
    history — everything the billing page renders."""
    from app.api.pricing import subscription_billing as sbill
    from app.common.tenant_context import current_tenant_id_strict

    tenant_id = current_tenant_id_strict()
    try:
        sbill.assert_billable_tenant(tenant_id)
        sub = sbill.get_subscription(tenant_id)
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400)

    plan = sub.plan
    pricing = {}
    for period in sbill.PERIOD_DAYS:
        price = sbill.price_for(plan, period)
        if price is not None and price >= 0:
            pricing[period] = price

    history = (
        Payment.query
        .filter_by(tenant_subscription_id=sub.id)
        .order_by(Payment.created_at.desc())
        .limit(12)
        .all()
    )
    return success_response(data={
        'subscription': sub.to_dict(),
        'plan': {
            'code': plan.code,
            'name': plan.name,
            'trial_days': plan.trial_days,
        } if plan else None,
        'pricing': pricing,
        'payments': [p.to_dict() for p in history],
    })


@payment_bp.route('/subscription/create-order', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_saas_subscription_order():
    """Create a Razorpay order (VENDOR keys) for one period of the tenant's
    current plan. Body: ``{period: 'monthly' | 'annual'}``. Amount is priced
    server-side from the plan — never trusted from the client."""
    from app.api.pricing import subscription_billing as sbill
    from app.api.pricing.service import PaymentResolver
    from app.common.tenant_context import current_tenant_id_strict

    data = request.get_json() or {}
    period = data.get('period') or 'monthly'
    tenant_id = current_tenant_id_strict()

    try:
        sbill.assert_billable_tenant(tenant_id)
        sub = sbill.get_subscription(tenant_id)
        quote = sbill.quote(sub, period)
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400)

    identity = get_jwt_identity()
    user = User.query.filter_by(id=identity, is_deleted=False).first()
    if not user:
        return error_response("User not found", status_code=404)

    amount_rupees = float(quote['amount_inr'])

    # A free plan (price 0) activates without a gateway round-trip.
    if amount_rupees <= 0:
        sbill.apply_paid_period(sub, period, actor_user_id=user.id)
        db.session.commit()
        return success_response(message="Plan renewed.", data={
            'no_payment_needed': True,
            'amount': 0,
            'subscription': sub.to_dict(),
        })

    # Rail selection by PLAN OWNER (invariant I1): a vendor-catalog plan
    # bills on the vendor's env keys; an apex-authored plan bills on the
    # APEX tenant's own Razorpay via the existing tenant rail — money for
    # a reseller's tenants lands in the reseller's account, never ours,
    # and there is deliberately NO fallback when their gateway is unset.
    owner_tenant_id = sub.plan.owner_tenant_id
    amount_paise = int(round(amount_rupees * 100))
    try:
        if owner_tenant_id:
            from app.api.pricing.service import GatewayNotConfigured
            try:
                binding = PaymentResolver.resolve_gateway(owner_tenant_id)
            except GatewayNotConfigured:
                return error_response(
                    "Your provider hasn't connected their payment gateway "
                    "yet — subscription payment is unavailable.",
                    status_code=503, code='reseller_gateway_not_configured',
                )
        else:
            binding = PaymentResolver.vendor_gateway()
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(sub.id)[:40],
            'notes': {'tenant_subscription_id': str(sub.id),
                      'tenant_id': str(tenant_id), 'period': period},
        })
    except RuntimeError as e:
        logger.error("Razorpay config error (vendor rail): %s", e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception("Razorpay order creation failed (subscription)")
        return error_response(f"Payment gateway error: {str(e)}",
                              status_code=502)

    payment = Payment(
        tenant_subscription_id=sub.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={
            'razorpay_order': rz_order,
            'gateway': _gateway_meta(binding, owner_tenant_id=owner_tenant_id),
            'saas_subscription': {
                'period': period,
                'plan_code': quote['plan_code'],
                'amount_inr': amount_rupees,
            },
        },
    )
    db.session.add(payment)
    db.session.commit()

    logger.info("[PAYMENT] SaaS subscription order created: %s tenant=%s "
                "period=%s", rz_order['id'], tenant_id, period)
    return success_response(message="Payment order created", data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'period': period,
        'prefill': _patient_prefill(user),
    })


@payment_bp.route('/subscription/addon-order', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_saas_addon_order():
    """Create a Razorpay order (VENDOR keys) for an add-on purchase.
    Body: ``{addon_code, period: 'monthly'|'annual', quantity}``.
    Amount = the add-on's period price x quantity, priced server-side.
    Free add-ons activate without a gateway round-trip. Vendor-direct
    tenants only — a reseller's child arranges add-ons with its apex.
    """
    from app.api.pricing import subscription_billing as sbill
    from app.api.pricing.service import (
        AddonPrerequisiteMissing, PaymentResolver,
        assert_prerequisites_active,
    )
    from app.common.tenant_context import current_tenant_id_strict
    from app.models import Addon, AddonStatus, TenantAddon
    from app.models._enums import AddonSubscriptionStatus

    data = request.get_json() or {}
    code = (data.get('addon_code') or '').strip()
    period = data.get('period') or 'monthly'
    try:
        quantity = max(int(data.get('quantity', 1)), 1)
    except (TypeError, ValueError):
        return error_response('quantity must be a number', status_code=400)
    if quantity > 999:
        return error_response('quantity too large', status_code=400)
    # Period only matters for legacy add-ons without tier terms; a tier
    # with its own billing_cycle overrides it. Validated after the
    # add-on is loaded (resolve_addon_terms).
    tenant_id = current_tenant_id_strict()

    try:
        sbill.assert_billable_tenant(tenant_id)
        sub = sbill.get_subscription(tenant_id)
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400)
    # A reseller's child may self-buy ONLY what its apex has put on its
    # plan (addon_terms = the apex's resale offer); payment then routes
    # to the APEX's own gateway, exactly like plan renewals. Without an
    # offer the historical refusal stands.
    owner_tenant_id = sub.plan.owner_tenant_id if sub.plan else None
    if owner_tenant_id:
        offered = sbill._plan_addon_terms(sub, code)
        if not isinstance(offered, dict):
            return error_response(
                'Add-ons for your workspace are arranged through your '
                'provider.', status_code=400, code='reseller_child_addon')

    addon = Addon.query.filter_by(
        code=code, is_deleted=False, status=AddonStatus.ACTIVE).first()
    if addon is None:
        return error_response('Add-on not found', status_code=404)
    try:
        assert_prerequisites_active(tenant_id, addon)
    except AddonPrerequisiteMissing as e:
        return error_response(str(e), status_code=409,
                              code='prerequisite_missing',
                              data={'missing': e.missing})

    identity = get_jwt_identity()
    user = User.query.filter_by(id=identity, is_deleted=False).first()
    if not user:
        return error_response('User not found', status_code=404)

    # Commercial terms: the add-on's 'main' tier when it has one (its
    # billing cycle then governs), else the legacy per-period scalars.
    # Snapshot the honest buyer tier on the purchase row: a child buys
    # as a child of its hosting kind, a direct tenant as 'main'. (With
    # plan terms present the tier only labels the row; without them it
    # also picks the fallback tier.)
    if owner_tenant_id:
        from app.models import Tenant
        me = Tenant.query.filter_by(id=tenant_id).first()
        tier_key = ('custom_domain_child'
                    if getattr(me, 'domain', None) else 'subdomain_child')
    else:
        tier_key = 'main'
    try:
        terms = sbill.resolve_addon_terms(addon, period, tier_key, sub=sub)
        existing = TenantAddon.query.filter_by(
            tenant_id=tenant_id, addon_id=addon.id, is_deleted=False,
        ).first()
        live_qty = 0
        if existing is not None and \
                existing.status != AddonSubscriptionStatus.CANCELLED:
            end = existing.current_period_end
            if end is None:
                live_qty = existing.quantity or 0
            else:
                if end.tzinfo is None:
                    from datetime import timezone as _tz
                    end = end.replace(tzinfo=_tz.utc)
                if end > sbill.utcnow():
                    live_qty = existing.quantity or 0
        sbill.check_addon_quantity(addon, terms, live_qty, quantity)
        # Reseller inventory: a child may only take what its apex bought.
        if owner_tenant_id:
            sbill.assert_resale_stock(
                owner_tenant_id, addon, quantity * int(terms['units'] or 1))
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400,
                              code='addon_terms')

    if terms['price_inr'] is not None:
        unit = terms['price_inr']
    else:
        unit = (addon.price_inr_annual if period == 'annual'
                else addon.price_inr_monthly)
    amount_rupees = float(unit or 0) * quantity

    if amount_rupees <= 0:
        row = sbill.apply_addon_purchase(
            tenant_id, addon, period, quantity, actor_user_id=user.id,
            tier_key=tier_key)
        db.session.commit()
        return success_response(message='Add-on activated.', data={
            'no_payment_needed': True, 'amount': 0,
            'addon': row.to_dict(),
        })

    amount_paise = int(round(amount_rupees * 100))
    if owner_tenant_id:
        # Money follows the plan owner: a child pays its APEX's gateway,
        # a direct tenant pays the vendor's — the same routing the
        # subscription rail uses.
        try:
            binding = PaymentResolver.resolve_gateway(owner_tenant_id)
        except Exception:  # noqa: BLE001 — any resolver miss reads the same
            return error_response(
                'Your provider has not set up payment collection yet — '
                'contact them to complete this purchase.',
                status_code=503, code='provider_gateway_missing')
    try:
        if not owner_tenant_id:
            binding = PaymentResolver.vendor_gateway()
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(sub.id)[:40],
            'notes': {'tenant_id': str(tenant_id), 'addon_code': code,
                      'quantity': str(quantity), 'period': period},
        })
    except RuntimeError as e:
        logger.error('Razorpay config error (addon order): %s', e)
        return error_response(str(e), status_code=503)
    except Exception as e:
        logger.exception('Razorpay order creation failed (addon)')
        return error_response(f'Payment gateway error: {str(e)}',
                              status_code=502)

    payment = Payment(
        tenant_subscription_id=sub.id,
        user_id=user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={
            'razorpay_order': rz_order,
            'gateway': _gateway_meta(binding,
                                     owner_tenant_id=owner_tenant_id),
            'saas_addon': {
                'code': code, 'period': period, 'quantity': quantity,
                'amount_inr': amount_rupees,
                'tier_key': tier_key,
            },
        },
    )
    db.session.add(payment)
    db.session.commit()
    logger.info('[PAYMENT] SaaS addon order created: %s tenant=%s %sx%s',
                rz_order['id'], tenant_id, code, quantity)
    return success_response(message='Payment order created', data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
        'prefill': _patient_prefill(user),
    })


@payment_bp.route('/subscription/verify', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def verify_saas_subscription_payment():
    """Verify the Razorpay signature (VENDOR keys) and extend the paid
    period. Body: ``{razorpay_order_id, razorpay_payment_id,
    razorpay_signature, payment_id}``."""
    from app.models import TenantSubscription

    data = request.get_json() or {}
    rz_order_id = data.get('razorpay_order_id')
    rz_payment_id = data.get('razorpay_payment_id')
    rz_signature = data.get('razorpay_signature')
    payment_id = data.get('payment_id')
    if not all([rz_order_id, rz_payment_id, rz_signature, payment_id]):
        return error_response("razorpay_order_id, razorpay_payment_id, "
                              "razorpay_signature and payment_id are required",
                              status_code=400)

    payment = Payment.query.filter_by(id=payment_id).first()
    if not payment or payment.tenant_subscription_id is None:
        return error_response("Subscription payment not found", status_code=404)
    if payment.gateway_order_id != rz_order_id:
        return error_response("Order ID mismatch", status_code=400)

    if payment.status == PaymentStatus.SUCCESS:
        sub = TenantSubscription.query.get(payment.tenant_subscription_id)
        return success_response(message="Payment already verified", data={
            'payment_id': str(payment.id), 'status': payment.status.value,
            'subscription': sub.to_dict() if sub else None})

    if not _verify_razorpay_signature(rz_order_id, rz_payment_id, rz_signature,
                                      _secret_for_payment(payment)):
        payment.status = PaymentStatus.FAILED
        payment.payment_metadata = {**(payment.payment_metadata or {}),
                                    'failure_reason': 'signature_mismatch'}
        db.session.commit()
        return error_response("Payment verification failed: invalid signature",
                              status_code=400, code='signature_invalid')

    payment.transaction_id = rz_payment_id
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'razorpay_payment_id': rz_payment_id,
        'razorpay_signature': rz_signature,
    }
    try:
        _confirm_payment(payment)
        db.session.commit()
    except IntegrityError:
        # ``uq_payment_tenant_transaction_id``: this razorpay_payment_id
        # already settled another Payment row. Razorpay ids are unique, so
        # a collision is a replayed verify — refuse it instead of 500ing.
        db.session.rollback()
        return error_response(
            "This payment was already used to settle a different order.",
            status_code=409, code='duplicate_transaction')

    sub = TenantSubscription.query.get(payment.tenant_subscription_id)
    logger.info("[PAYMENT] SaaS subscription verified: payment=%s sub=%s",
                payment_id, payment.tenant_subscription_id)
    return success_response(message="Payment successful! Your subscription "
                                    "has been extended.", data={
        'payment_id': str(payment.id),
        'status': payment.status.value,
        'subscription': sub.to_dict() if sub else None,
    })


# ── POST /api/payment/webhook ─────────────────────────────────────────────────

@payment_bp.route('/subscription/reconcile', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
@limiter.limit('10 per minute')
def reconcile_saas_subscription_payment():
    """Ask Razorpay what really happened to an unsettled order, and act
    on the answer.

    Both settle paths can miss: the browser's verify call never fires if
    the tab dies mid-checkout, and the webhook never arrives if it is
    unconfigured (or points at another environment). That leaves a
    payment stuck at CREATED with no explanation — indistinguishable, from
    our side, between "customer paid and we lost it" and "customer never
    paid". Razorpay knows; this asks.

    Body: ``{payment_id}`` (ours), or nothing to sweep this tenant's
    unsettled subscription payments.
    """
    from app.api.pricing.service import PaymentResolver
    from app.common.tenant_context import current_tenant_id_strict
    from app.models import TenantSubscription

    tenant_id = current_tenant_id_strict()
    data = request.get_json(silent=True) or {}

    sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if sub is None:
        return error_response('No subscription.', status_code=404)

    q = Payment.query.filter(
        Payment.tenant_subscription_id == sub.id,
        Payment.status.in_((PaymentStatus.CREATED, PaymentStatus.PENDING)),
    )
    if data.get('payment_id'):
        q = q.filter(Payment.payment_id == data['payment_id'])
    rows = q.order_by(Payment.created_at.desc()).limit(10).all()
    if not rows:
        return success_response(
            {'checked': 0, 'settled': 0, 'failed': 0},
            message='Nothing waiting to be reconciled.')

    checked = settled = failed = 0
    notes = []
    for payment in rows:
        checked += 1
        order_id = payment.gateway_order_id
        if not order_id:
            continue
        try:
            binding = PaymentResolver.vendor_gateway()
            client = _razorpay_client(binding)
            order = client.order.fetch(order_id)
            attempts = client.order.payments(order_id)
        except Exception as e:  # noqa: BLE001 — gateway down is not fatal
            logger.warning('[RECONCILE] gateway fetch failed order=%s: %s',
                           order_id, e)
            # Distinguish "that order isn't there" from "we couldn't
            # reach Razorpay" — an operator reads these and they mean
            # very different things.
            if isinstance(e, (NameError, AttributeError, TypeError)):
                # Ours, not theirs — never dress a bug up as an outage.
                raise
            text = str(e).lower()
            if 'does not exist' in text or 'not found' in text                     or 'bad request' in text or '400' in text:
                notes.append(
                    'The payment gateway has no record of this order — it '
                    'was never completed, so nothing was charged.')
            else:
                notes.append('Could not reach the payment gateway. Try '
                             'again in a moment.')
            continue

        items = (attempts or {}).get('items') or []
        captured = next(
            (i for i in items
             if i.get('status') == 'captured' or i.get('captured')), None)

        if captured:
            # Real money moved and we missed it — settle now. Same
            # idempotent path verify and the webhook use.
            payment.transaction_id = captured.get('id')
            payment.payment_metadata = {
                **(payment.payment_metadata or {}),
                'reconciled': True,
                'razorpay_payment_id': captured.get('id'),
            }
            try:
                _confirm_payment(payment)
                db.session.commit()
                settled += 1
            except IntegrityError:
                db.session.rollback()
                notes.append('That gateway payment already settled '
                             'another order.')
            continue

        last = items[0] if items else None
        if order.get('status') in ('paid',):
            notes.append('Gateway says paid but exposed no capture — '
                         'contact support.')
            continue

        # Nothing captured. Record WHY so the customer sees a reason
        # instead of a silent dead end.
        reason = (last or {}).get('error_description') if last else None
        if last and last.get('status') == 'failed':
            payment.status = PaymentStatus.FAILED
            payment.payment_metadata = {
                **(payment.payment_metadata or {}),
                'failure_reason': reason or 'failed_at_gateway',
                'reconciled': True,
            }
            db.session.commit()
            failed += 1
            if reason:
                notes.append(reason)
        else:
            notes.append('No payment was completed for this order — '
                         'you have not been charged.')

    db.session.refresh(sub)
    message = ('Payment confirmed — your subscription is up to date.'
               if settled else
               (notes[0] if notes else 'No completed payment found.'))
    return success_response({
        'checked': checked, 'settled': settled, 'failed': failed,
        'notes': notes,
        'subscription': sub.to_dict(),
    }, message=message)


@payment_bp.route('/webhook', methods=['POST'])
def payment_webhook():
    """
    Razorpay webhook endpoint (no JWT — Razorpay calls this server-to-server).

    Configure in Razorpay Dashboard → Webhooks:
      URL: https://your-domain/api/v1/payment/webhook
      Events: payment.captured, payment.failed
      Secret: RAZORPAY_WEBHOOK_SECRET

    Idempotent — safe to receive duplicates.

    Two Razorpay accounts can legitimately call this endpoint:

      * a TENANT's account — the tenant configured this URL (on their own
        host) in their Razorpay dashboard; verified with the webhook secret
        from their :class:`TenantPaymentConfig`, and allowed to touch ONLY
        that tenant's tenant-rail payments;
      * the VENDOR's account (SaaS subscription billing) — verified with the
        ``RAZORPAY_WEBHOOK_SECRET`` env var, and allowed to touch only
        payments NOT created on a tenant's gateway.
    """
    from flask import g
    from app.models import TenantPaymentConfig

    received_sig = request.headers.get('X-Razorpay-Signature', '')
    raw_body = request.get_data()

    def _sig_ok(secret):
        if not secret:
            return False
        expected = hmac.new(
            secret.encode('utf-8'), raw_body, hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, received_sig)

    # Candidate secrets, most specific first. The tenant candidate only
    # exists when the request's HOST resolved a real tenant (the URL the
    # tenant pasted into their dashboard is on their own domain).
    verified_source = None
    verified_tenant_id = None

    if getattr(g, 'tenant_source', None) in ('host_match',):
        config = TenantPaymentConfig.for_tenant(getattr(g, 'tenant_id', None))
        if config is not None and _sig_ok(config.razorpay_webhook_secret):
            verified_source = 'tenant_config'
            verified_tenant_id = str(config.tenant_id)

    if verified_source is None:
        env_secret = os.environ.get('RAZORPAY_WEBHOOK_SECRET', '')
        if env_secret and _sig_ok(env_secret):
            verified_source = 'platform_env'

    if verified_source is None:
        # Fail CLOSED. This endpoint is unauthenticated by design, so an
        # unverifiable event must be refused — anyone could POST a forged
        # payment.captured for a known gateway_order_id and walk away with
        # a SUCCESS payment and a confirmed appointment, with no money
        # received.
        logger.warning("[WEBHOOK] Signature did not verify against any "
                       "configured secret (tenant=%s)",
                       getattr(g, 'tenant_id', None))
        from app.common.client_context import audit_event
        audit_event('payment.webhook_rejected', reason='bad_signature')
        return error_response("Invalid webhook signature", status_code=400)

    payload = request.get_json() or {}
    event = payload.get('event')
    logger.info("[WEBHOOK] Received event: %s (verified via %s)",
                event, verified_source)
    from app.common.client_context import audit_event
    audit_event('payment.webhook_verified', event=event, source=verified_source)

    try:
        if event == 'payment.captured':
            _handle_payment_captured(payload, verified_source, verified_tenant_id)
        elif event == 'payment.failed':
            _handle_payment_failed(payload, verified_source, verified_tenant_id)
        else:
            logger.info("[WEBHOOK] Unhandled event: %s", event)
    except Exception as e:
        logger.exception("[WEBHOOK] Error processing event %s: %s", event, e)
        return error_response("Webhook processing error", status_code=500)

    return success_response("Webhook received")


def _webhook_payment_allowed(payment, verified_source, verified_tenant_id) -> bool:
    """May the account whose secret verified this event settle this payment?

    A tenant's secret only vouches for that tenant's own tenant-rail
    payments; the vendor's env secret only vouches for payments NOT created
    on a tenant's gateway (subscription rail + pre-gateway legacy rows).
    Anything else is a cross-account forgery attempt — refuse it.
    """
    gw = (payment.payment_metadata or {}).get('gateway') or {}
    gw_source = gw.get('source')
    if verified_source == 'tenant_config':
        # The KEY OWNER is who the secret vouches for. For reseller
        # subscription payments the snapshot's owner_tenant_id is the
        # APEX parent — the payer (payment.tenant_id) is its child, so
        # comparing the payer would wrongly refuse the apex's own webhook.
        key_owner = gw.get('owner_tenant_id') or payment.tenant_id
        return (
            gw_source == 'tenant_config'
            and str(key_owner) == str(verified_tenant_id)
        )
    return gw_source != 'tenant_config'


def _handle_payment_captured(payload: dict, verified_source: str,
                             verified_tenant_id) -> None:
    """Handle payment.captured webhook event."""
    payment_entity = payload.get('payload', {}).get('payment', {}).get('entity', {})
    rz_order_id = payment_entity.get('order_id')
    rz_payment_id = payment_entity.get('id')

    if not rz_order_id or not rz_payment_id:
        logger.warning("[WEBHOOK] Captured event missing order_id or payment_id")
        return

    payment = Payment.query.filter_by(gateway_order_id=rz_order_id).first()
    if not payment:
        logger.warning("[WEBHOOK] Payment not found for order_id: %s", rz_order_id)
        return
    if not _webhook_payment_allowed(payment, verified_source, verified_tenant_id):
        logger.warning(
            "[WEBHOOK] Refusing captured event: verifier %s/%s does not vouch "
            "for payment %s (tenant %s)",
            verified_source, verified_tenant_id, payment.id, payment.tenant_id,
        )
        return

    was_settled = payment.status == PaymentStatus.SUCCESS
    payment.transaction_id = rz_payment_id
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'razorpay_payment_id': rz_payment_id,
        'webhook_captured_at': datetime.now(timezone.utc).isoformat(),
    }
    _confirm_payment(payment)
    db.session.commit()
    if not was_settled:
        # This webhook did the settling (browser closed before verify) —
        # it owns the notification too.
        _notify_appointment_settled(payment)
    logger.info("[WEBHOOK] Payment captured: %s → settled", rz_payment_id)


def _handle_payment_failed(payload: dict, verified_source: str,
                           verified_tenant_id) -> None:
    """Handle payment.failed webhook event."""
    payment_entity = payload.get('payload', {}).get('payment', {}).get('entity', {})
    rz_order_id = payment_entity.get('order_id')
    rz_payment_id = payment_entity.get('id')
    error_desc = payment_entity.get('error_description', 'Unknown error')

    if not rz_order_id:
        return

    payment = Payment.query.filter_by(gateway_order_id=rz_order_id).first()
    if not payment or payment.status == PaymentStatus.SUCCESS:
        return  # already succeeded, don't override
    if not _webhook_payment_allowed(payment, verified_source, verified_tenant_id):
        logger.warning(
            "[WEBHOOK] Refusing failed event: verifier %s/%s does not vouch "
            "for payment %s", verified_source, verified_tenant_id, payment.id,
        )
        return

    payment.status = PaymentStatus.FAILED
    payment.payment_metadata = {
        **(payment.payment_metadata or {}),
        'failure_reason': error_desc,
        'razorpay_payment_id': rz_payment_id,
    }
    # Appointment stays PENDING_PAYMENT so user can retry
    db.session.commit()
    logger.info("[WEBHOOK] Payment failed for order: %s — %s", rz_order_id, error_desc)


# ── Cashfree Payouts webhook (platform → doctor disbursal status) ─────────────

@payment_bp.route('/cashfree/payout-webhook', methods=['POST'])
def cashfree_payout_webhook():
    """Cashfree Payouts webhook (no JWT — Cashfree calls server-to-server).

    Configure in Cashfree Dashboard → Payouts → Webhooks:
      URL: https://your-domain/api/payment/cashfree/payout-webhook
      Signed with your Payouts client secret.

    Idempotent — safe to receive duplicates.
    """
    from app.api.common.payment import cashfree_payout as cf
    if not cf.is_configured():
        logger.warning('[CF-WEBHOOK] Cashfree not configured — ignoring')
        return success_response('ignored')

    raw = request.get_data()
    sig = request.headers.get('x-webhook-signature', '')
    ts = request.headers.get('x-webhook-timestamp', '')
    if not cf.verify_webhook_signature(raw, sig, ts):
        logger.warning('[CF-WEBHOOK] invalid signature')
        return error_response('Invalid webhook signature', status_code=400)

    payload = request.get_json(silent=True) or {}
    try:
        _handle_cashfree_payout_event(payload)
    except Exception as e:  # noqa: BLE001
        logger.exception('[CF-WEBHOOK] error: %s', e)
        return error_response('Webhook processing error', status_code=500)
    return success_response('ok')


def _handle_cashfree_payout_event(payload: dict) -> None:
    """Map a Cashfree transfer event onto the DoctorPayout / SalaryPayout whose
    transfer_id is ``po<payout-hex>`` / ``sp<salary-hex>``."""
    from uuid import UUID
    from app.models import DoctorPayout, SalaryPayout, PayoutStatus
    from app.api.common.payment import cashfree_payout as cf

    etype = (payload.get('type') or payload.get('event') or '').upper()
    data = payload.get('data') or {}
    transfer = data.get('transfer') or data
    transfer_id = transfer.get('transfer_id') or data.get('transfer_id')
    status = (transfer.get('status') or data.get('status') or '').upper()
    if not status:
        if 'SUCCESS' in etype:
            status = 'SUCCESS'
        elif 'FAIL' in etype or 'REJECT' in etype:
            status = 'FAILED'
        elif 'REVERS' in etype:
            status = 'REVERSED'
    if not transfer_id:
        logger.info('[CF-WEBHOOK] no transfer_id (%s)', etype)
        return

    rec = None
    try:
        rec_id = UUID(transfer_id[2:])
        if transfer_id.startswith('po'):
            rec = DoctorPayout.query.get(rec_id)
        elif transfer_id.startswith('sp'):
            rec = SalaryPayout.query.get(rec_id)
    except (ValueError, IndexError):
        rec = None
    if rec is None:
        logger.info('[CF-WEBHOOK] no payout for %s (%s) — likely a penny drop', transfer_id, status)
        return

    # The signature was verified with the HOST-resolved tenant's Cashfree
    # secret — that secret only vouches for that tenant's own payouts.
    from flask import g
    verified_tenant = getattr(g, 'tenant_id', None)
    if verified_tenant and str(rec.tenant_id) != str(verified_tenant):
        logger.warning(
            '[CF-WEBHOOK] refusing: transfer %s belongs to tenant %s but the '
            'verifying secret is tenant %s', transfer_id, rec.tenant_id,
            verified_tenant,
        )
        return
    if rec.status == PayoutStatus.COMPLETED:
        return  # idempotent

    if status in cf.SUCCESS_STATES:
        rec.status = PayoutStatus.COMPLETED
        rec.completed_at = datetime.now(timezone.utc)
    elif status in cf.FAILED_STATES:
        rec.status = PayoutStatus.FAILED
        rec.status_reason = f'Cashfree: {status}'
    elif status in cf.REVERSED_STATES:
        rec.status = PayoutStatus.REVERSED
        rec.status_reason = 'Cashfree: reversed'
    else:
        logger.info('[CF-WEBHOOK] %s still pending (%s)', transfer_id, status)
        return
    db.session.commit()
    # Persist-first: a landed doctor payout is worth a live ping.
    if transfer_id.startswith('po') and rec.status == PayoutStatus.COMPLETED:
        from app.common.notify import notify_payout_completed
        notify_payout_completed(rec)
    logger.info('[CF-WEBHOOK] %s → %s', transfer_id, rec.status.value)


# ── GET /api/payment/appointment/<id> ────────────────────────────────────────

@payment_bp.route('/appointment/<appointment_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
def get_payment_status(appointment_id):
    """Get the latest payment status for an appointment."""
    identity = get_jwt_identity()
    user = User.query.filter_by(id=identity, is_deleted=False).first()
    if not user or not user.patient_profile:
        return error_response("Patient profile not found", status_code=404)

    appointment = Appointment.query.filter(
        Appointment.id == appointment_id,
        Appointment.patient_id.in_(_payable_patient_ids(user)),
        Appointment.is_deleted == False,  # noqa: E712
    ).first()
    if not appointment:
        return error_response("Appointment not found", status_code=404)

    payment = Payment.query.filter_by(
        appointment_id=appointment_id
    ).order_by(Payment.created_at.desc()).first()

    if not payment:
        return success_response(message="No payment found", data={'status': None})

    return success_response(message="Payment status fetched", data={
        'payment_id': str(payment.id),
        'amount': str(payment.amount),
        'currency': payment.currency,
        'status': payment.status.value,
        'transaction_id': payment.transaction_id,
        'payment_date': payment.created_at.isoformat() if payment.created_at else None,
        'appointment_status': appointment.status.value,
    })
