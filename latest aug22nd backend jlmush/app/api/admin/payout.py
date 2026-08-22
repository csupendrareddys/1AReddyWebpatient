"""
Admin Payout Routes
Manage doctor payouts — initiate, list, update status.
"""
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, rbac_required
from app.models import PermissionModule, PermissionAction
from app.common.responses import success_response, error_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    UserRole, DoctorPayout, PayoutStatus, Appointment, Payment, PaymentStatus,
    AppointmentStatus, Doctor, ProfileBankAccount, BillingConfig,
    DocumentVerificationStatus,
)

logger = logging.getLogger(__name__)

payout_bp = Blueprint('payout', __name__)


def _generate_bill_number():
    """Generate a unique bill number like JLH8796543."""
    import random
    num = random.randint(1000000, 9999999)
    return f"JLH{num}"


def _rate(config, attr):
    """A BillingConfig numeric as Decimal, treating None as 0.

    When a tenant has no active BillingConfig the callers fall back to a
    transient ``BillingConfig()``. Column defaults only materialise on INSERT,
    so every attribute on that instance is None — ``Decimal(str(None))`` then
    raises InvalidOperation and the whole payout creation fails. Default to 0.
    """
    val = getattr(config, attr, None)
    return Decimal(str(val)) if val is not None else Decimal('0')


def _compute_charge(charge_type, charge_value, base_amount):
    val = Decimal(str(charge_value)) if charge_value is not None else Decimal('0')
    if charge_type == 'percentage':
        return (base_amount * val / Decimal('100')).quantize(Decimal('0.01'))
    return val.quantize(Decimal('0.01'))


@payout_bp.route('', methods=['GET'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_PAYOUT, PermissionAction.VIEW)
def list_payouts():
    """List all payouts with optional filters."""
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    status = request.args.get('status', None)
    doctor_id = request.args.get('doctor_id', None)
    # 'plan' | 'consultant' — the unified Payout Management UI splits this
    # per-patient rail into a Plan-Based section and a Consultancy section
    # (a consultant's above-target incentive payouts) by the doctor's CURRENT
    # billing type. Filtered server-side (not client-side) so pagination
    # totals stay correct per section — 'employee' is deliberately not a
    # valid value here since employees never earn a per-patient payout.
    billing_type_filter = request.args.get('billing_type', None)

    # Lazy promotion so autopay payouts whose T-day hold elapsed land in the
    # queue the moment the admin opens it (works without a running scheduler).
    from app.api.common.payment.billing_service import promote_matured_payouts
    promote_matured_payouts(current_tenant_id_strict())

    query = DoctorPayout.query.filter(
        DoctorPayout.tenant_id == current_tenant_id_strict(),
    )

    if status:
        try:
            query = query.filter(DoctorPayout.status == PayoutStatus(status))
        except ValueError:
            pass
    if doctor_id:
        query = query.filter(DoctorPayout.doctor_id == doctor_id)
    # Payout source tab: appointment (default consultancy), plan_installment
    # (Group Offering plans), service_order (individual services),
    # second_opinion (family-doctor credit redemptions).
    source_type_filter = request.args.get('source_type', None)
    if source_type_filter in ('appointment', 'plan_installment',
                              'service_order', 'second_opinion'):
        query = query.filter(DoctorPayout.source_type == source_type_filter)
    if billing_type_filter in ('plan', 'consultant'):
        from app.models import DoctorBillingProfile, DoctorBillingType
        if billing_type_filter == 'plan':
            # A doctor with no DoctorBillingProfile row defaults to PLAN (the
            # column default), so "plan" means "no profile row, or a profile
            # row explicitly set to PLAN" — expressed as NOT IN the other set
            # rather than a positive PLAN match, which would miss doctors
            # who never had a profile created.
            non_plan_ids = db.session.query(DoctorBillingProfile.doctor_id).filter(
                DoctorBillingProfile.tenant_id == current_tenant_id_strict(),
                DoctorBillingProfile.billing_type != DoctorBillingType.PLAN,
            )
            query = query.filter(~DoctorPayout.doctor_id.in_(non_plan_ids))
        else:
            matching_ids = db.session.query(DoctorBillingProfile.doctor_id).filter(
                DoctorBillingProfile.tenant_id == current_tenant_id_strict(),
                DoctorBillingProfile.billing_type == DoctorBillingType.CONSULTANT,
            )
            query = query.filter(DoctorPayout.doctor_id.in_(matching_ids))

    query = query.order_by(DoctorPayout.created_at.desc())
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    # Whether a "Complete" can actually disburse through Cashfree, or can only
    # ever be a manual ledger flip. The UI needs this to decide what to offer —
    # without it the admin is left guessing and hand-typing a transfer id, which
    # routes around Cashfree entirely.
    from app.api.common.payment import cashfree_payout as cf
    from app.api.common.payment import beneficiary_service as bene
    from app.models import ProfileBankAccount, DoctorBillingProfile
    cashfree_enabled = cf.is_configured()

    # Which compensation model each row's doctor is on (plan/employee/consultant).
    # The unified Payout Management UI splits per-patient rows into a
    # Plan-Based section and a Consultancy section (a consultant's
    # above-target incentive payouts) by this field — bulk-fetched once
    # rather than per row to avoid an N+1 query.
    doctor_ids = {p.doctor_id for p in paginated.items}
    billing_types = {
        bp.doctor_id: bp.billing_type.value if bp.billing_type else 'plan'
        for bp in DoctorBillingProfile.query.filter(
            DoctorBillingProfile.tenant_id == current_tenant_id_strict(),
            DoctorBillingProfile.doctor_id.in_(doctor_ids),
        ).all()
    } if doctor_ids else {}

    payouts = []
    for p in paginated.items:
        d = p.to_dict()
        # Include doctor name
        if p.doctor and p.doctor.user:
            d['doctor_name'] = f"{p.doctor.user.first_name or ''} {p.doctor.user.last_name or ''}".strip()
        d['billing_type'] = billing_types.get(p.doctor_id, 'plan')

        # Resolve the account this payout would actually pay into: the one
        # pinned on the row, else the doctor's primary.
        ba = None
        if p.bank_account_id:
            ba = ProfileBankAccount.query.get(p.bank_account_id)
        if ba is None:
            ba = ProfileBankAccount.query.filter_by(
                tenant_id=p.tenant_id, doctor_id=p.doctor_id, order_index=0,
            ).first()

        # ``bank_status`` is DOCUMENT verification; ``beneficiary_status`` is the
        # Cashfree state, and only the latter gates a real transfer.
        d['bank_status'] = ba.verification_status.value if ba and ba.verification_status else 'missing'
        d['beneficiary_status'] = (ba.beneficiary_status or 'none') if ba else 'none'
        d['payout_ready'] = bool(cashfree_enabled and bene.is_beneficiary_verified(ba))
        payouts.append(d)

    return success_response(data={
        'payouts': payouts,
        'cashfree_enabled': cashfree_enabled,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@payout_bp.route('/<payout_id>/push', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def push_payout(payout_id):
    """Release a held payout to the doctor — WITHOUT paying it.

    This is the admin's only lever on the money: it moves ON_HOLD/PENDING →
    CLAIMABLE so the doctor sees "Ready to Claim". The transfer itself only
    happens when the doctor claims it (or automatically at maturity for
    auto-pay doctors). The admin can never trigger a transfer.

    PENDING is accepted as well as ON_HOLD: a zero-hold payout (T==0) is left
    PENDING by design, and legacy rows created before the hold was stamped are
    stuck there too. Both mean "matured, not yet with the doctor", so both must
    be pushable — otherwise they have no reachable next state at all.
    """
    payout = DoctorPayout.query.filter_by(
        id=payout_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not payout:
        return not_found_response('Payout not found')
    if payout.status not in (PayoutStatus.ON_HOLD, PayoutStatus.PENDING, PayoutStatus.CLAIMABLE):
        return error_response(
            f'Only a held or pending payout can be pushed (this one is {payout.status.value}).',
        )
    if payout.status == PayoutStatus.CLAIMABLE:
        return error_response('This payout is already with the doctor to claim.')

    was_held = payout.status == PayoutStatus.ON_HOLD
    payout.status = PayoutStatus.CLAIMABLE
    payout.status_reason = (
        'Released early by admin' if was_held else 'Released to doctor by admin'
    )
    db.session.commit()
    logger.info('[PAYOUT] %s pushed to doctor by admin=%s', payout.bill_number, current_user.id)
    return success_response(
        data=payout.to_dict(),
        message=f'{payout.bill_number} pushed to the doctor — waiting for them to collect it.',
    )


@payout_bp.route('/reconcile', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def reconcile_payouts():
    """Ask Cashfree for the terminal state of every in-flight payout.

    Cashfree only guarantees the terminal state via the Check Status API or a
    webhook, so a missed webhook would otherwise strand a real transfer in
    PROCESSING forever.
    """
    from app.api.common.payment.billing_service import reconcile_processing_payouts
    stats = reconcile_processing_payouts(current_tenant_id_strict())
    return success_response(
        data=stats,
        message=(
            f"Checked {stats['checked']} in-flight payout(s): "
            f"{stats['completed']} completed, {stats['failed']} failed, "
            f"{stats['reversed']} reversed, {stats['in_flight']} still moving"
            + (f", {stats['errors']} could not be checked." if stats.get('errors') else ".")
        ),
    )


@payout_bp.route('/initiate', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def initiate_payout():
    """
    Create a payout record for a completed appointment.
    Validates doctor bank details are verified before allowing.

    Body: { "appointment_id": "uuid" }
    """
    data = request.get_json() or {}
    appointment_id = data.get('appointment_id')

    if not appointment_id:
        return error_response('appointment_id is required')

    # Check appointment (tenant-scoped)
    tenant_id = current_tenant_id_strict()
    appointment = Appointment.query.filter_by(
        id=appointment_id, tenant_id=tenant_id,
    ).first()
    if not appointment:
        return not_found_response('Appointment not found')
    if appointment.status != AppointmentStatus.COMPLETED:
        return error_response('Appointment is not completed')

    # Check if payout already exists
    existing = DoctorPayout.query.filter_by(
        appointment_id=appointment.id, tenant_id=tenant_id,
    ).first()
    if existing:
        return error_response(f'Payout already exists for this appointment (bill: {existing.bill_number}, status: {existing.status.value})')

    # Get payment
    payment = Payment.query.filter_by(
        appointment_id=appointment.id, status=PaymentStatus.SUCCESS
    ).first()
    if not payment:
        return error_response('No successful payment found for this appointment')

    # Get doctor
    doctor = Doctor.query.get(appointment.doctor_id)
    if not doctor:
        return error_response('Doctor not found')

    # Verify bank details
    force = data.get('force', False)  # Admin can force-create without verified bank
    primary_bank = ProfileBankAccount.query.filter_by(
        doctor_id=doctor.id, order_index=0
    ).first()
    if not primary_bank and not force:
        return error_response(
            'Doctor has not added primary bank account details. '
            'Pass "force": true to create payout anyway (admin can retry after bank is verified).',
        )
    if primary_bank and primary_bank.verification_status != DocumentVerificationStatus.VERIFIED and not force:
        return error_response(
            f'Doctor primary bank account is not verified (status: {primary_bank.verification_status.value}). '
            'Verify the bank first, or pass "force": true to create payout anyway.',
        )

    # Compute charges
    config = BillingConfig.query.filter_by(is_active=True).first()
    if not config:
        config = BillingConfig()

    payment_amount = Decimal(str(payment.amount or 0))
    consultation_fee = Decimal(str(appointment.consultation_fee or 0))

    # Two supplies, two taxable values (see app/common/tax.py):
    #   • the doctor's professional/healthcare service — their own quoted fee,
    #     tax-INCLUSIVE, so GST is carved out of it;
    #   • the platform's facilitation margin (what the patient paid minus that
    #     fee) — a separate supply at the platform rate.
    # GST is therefore NOT levied on ``payment.amount`` as one blob, and TDS
    # (s.194J) is on the doctor's professional fee, not on the patient's total
    # net of platform charges.
    from app.api.common.payment.billing_service import (
        compute_platform_charges, charges_snapshot_for, resolve_doctor_fee,
    )
    from app.common.tax import compute_tax_breakdown
    _ctype = getattr(getattr(appointment, 'consultation_type', None), 'value', getattr(appointment, 'consultation_type', None))
    doctor_fee = resolve_doctor_fee(doctor, appointment, fallback=payment_amount)
    # Plan commission is a cut of the DOCTOR's earning; billing it on the
    # patient's total would charge the doctor commission on the platform's own
    # markup.
    c1, c2, c3 = compute_platform_charges(doctor, doctor_fee)
    total_charges = c1 + c2 + c3
    tax = compute_tax_breakdown(
        doctor_fee, payment_amount, config=config, doctor=doctor,
        consultation_type=_ctype, platform_charges=total_charges,
    )
    # taxes_gst records the tax on what the DOCTOR supplied; the GST on the
    # platform's margin is the platform's own output tax, not a payout line.
    gst = tax.doctor_gst_total
    tds = tax.tds_amount
    razorpay_fee = Decimal(data.get('razorpay_fee', '0')).quantize(Decimal('0.01'))
    payout_amount = (tax.net_to_doctor - razorpay_fee).quantize(Decimal('0.01'))

    # Generate unique bill number
    bill_number = _generate_bill_number()
    while DoctorPayout.query.filter_by(bill_number=bill_number).first():
        bill_number = _generate_bill_number()

    payout = DoctorPayout(
        doctor_id=doctor.id,
        appointment_id=appointment.id,
        payment_id=payment.id,
        bill_number=bill_number,
        appointment_amount=consultation_fee,
        payment_amount=payment_amount,
        total_charges=total_charges,
        taxes_gst=gst,
        tds_amount=tds,
        razorpay_fee=razorpay_fee,
        payout_amount=payout_amount,
        charge1_amount=c1,
        charge2_amount=c2,
        charge3_amount=c3,
        charges_snapshot=charges_snapshot_for(doctor, doctor_fee, (c1, c2, c3)),
        bank_account_id=primary_bank.id if primary_bank else None,
        # Column is a plain String — store the enum's value, not the
        # ConsultationType object (psycopg2 can't adapt the enum itself).
        consultation_type=getattr(
            getattr(appointment, 'consultation_type', None), 'value',
            getattr(appointment, 'consultation_type', None),
        ),
        status=PayoutStatus.PENDING,
        initiated_by_id=current_user.id,
        initiated_at=datetime.now(timezone.utc),
    )
    db.session.add(payout)
    # Stamp the T-day hold + payout_mode, exactly as the doctor-side earning
    # path does. Without this the row lands in PENDING with hold_until/
    # payout_mode NULL, which no transition consumes — it can't be pushed
    # (needs ON_HOLD), can't mature (needs hold_until), and admins can't
    # complete it — so it would sit in the queue forever with no action.
    from app.api.common.payment.billing_service import apply_hold
    apply_hold(payout, doctor)
    db.session.commit()

    bank_warning = ''
    if not primary_bank:
        bank_warning = ' (WARNING: No bank account on file — payout will need retry after doctor adds bank details)'
    elif primary_bank.verification_status != DocumentVerificationStatus.VERIFIED:
        bank_warning = f' (WARNING: Bank not verified — status: {primary_bank.verification_status.value})'

    logger.info(f"[PAYOUT] Created payout {bill_number} for appointment={appointment_id} doctor={doctor.id}{bank_warning}")

    return success_response(data=payout.to_dict(), message=f'Payout {bill_number} created successfully{bank_warning}')


@payout_bp.route('/bulk-initiate', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def bulk_initiate_payouts():
    """Create payouts for all completed appointments without existing payouts."""
    from app.api.common.payment.billing_service import apply_hold

    data = request.get_json() or {}
    razorpay_fee = Decimal(data.get('razorpay_fee', '0')).quantize(Decimal('0.01'))

    # Find completed appointments without payouts
    subq = db.session.query(DoctorPayout.appointment_id)
    appointments = (
        db.session.query(Appointment, Payment)
        .join(Payment, Payment.appointment_id == Appointment.id)
        .filter(
            Appointment.status == AppointmentStatus.COMPLETED,
            Payment.status == PaymentStatus.SUCCESS,
            ~Appointment.id.in_(subq),
        )
        .all()
    )

    config = BillingConfig.query.filter_by(is_active=True).first()
    if not config:
        config = BillingConfig()

    created = 0
    skipped = 0
    for appointment, payment in appointments:
        doctor = Doctor.query.get(appointment.doctor_id)
        if not doctor:
            skipped += 1
            continue
        primary_bank = ProfileBankAccount.query.filter_by(doctor_id=doctor.id, order_index=0).first()
        if not primary_bank or primary_bank.verification_status != DocumentVerificationStatus.VERIFIED:
            skipped += 1
            continue

        payment_amount = Decimal(str(payment.amount or 0))
        consultation_fee = Decimal(str(appointment.consultation_fee or 0))
        # Same two-supply split as the single-initiate path above — GST on the
        # doctor's own (tax-inclusive) fee, the platform's margin taxed
        # separately, TDS on the doctor's professional fee.
        from app.api.common.payment.billing_service import (
            compute_platform_charges, charges_snapshot_for, resolve_doctor_fee,
        )
        from app.common.tax import compute_tax_breakdown
        _ctype = getattr(getattr(appointment, 'consultation_type', None), 'value', getattr(appointment, 'consultation_type', None))
        doctor_fee = resolve_doctor_fee(doctor, appointment, fallback=payment_amount)
        c1, c2, c3 = compute_platform_charges(doctor, doctor_fee)
        total_charges = c1 + c2 + c3
        tax = compute_tax_breakdown(
            doctor_fee, payment_amount, config=config, doctor=doctor,
            consultation_type=_ctype, platform_charges=total_charges,
        )
        gst = tax.doctor_gst_total
        tds = tax.tds_amount
        payout_amount = (tax.net_to_doctor - razorpay_fee).quantize(Decimal('0.01'))

        bill_number = _generate_bill_number()
        while DoctorPayout.query.filter_by(bill_number=bill_number).first():
            bill_number = _generate_bill_number()

        payout = DoctorPayout(
            doctor_id=doctor.id,
            appointment_id=appointment.id,
            payment_id=payment.id,
            bill_number=bill_number,
            appointment_amount=consultation_fee,
            payment_amount=payment_amount,
            total_charges=total_charges,
            taxes_gst=gst,
            tds_amount=tds,
            razorpay_fee=razorpay_fee,
            payout_amount=payout_amount,
            charge1_amount=c1,
            charge2_amount=c2,
            charge3_amount=c3,
            charges_snapshot=charges_snapshot_for(doctor, doctor_fee, (c1, c2, c3)),
            bank_account_id=primary_bank.id,
            status=PayoutStatus.PENDING,
            initiated_by_id=current_user.id,
            initiated_at=datetime.now(timezone.utc),
        )
        db.session.add(payout)
        # Same hold/mode stamp as the single-initiate path above — otherwise
        # every bulk-created payout is stranded in PENDING with no transition.
        apply_hold(payout, doctor)
        created += 1

    db.session.commit()
    return success_response(message=f'{created} payouts created, {skipped} skipped (unverified bank details)')


@payout_bp.route('/<payout_id>/status', methods=['PUT'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_PAYOUT, PermissionAction.EDIT)
def update_payout_status(payout_id):
    """
    Update payout status (processing → completed, or mark failed).
    Body: { "status": "processing|completed|failed", "razorpay_transfer_id": "...", "reason": "..." }
    """
    data = request.get_json() or {}
    new_status = data.get('status')

    if not new_status:
        return error_response('status is required')
    try:
        new_status_enum = PayoutStatus(new_status)
    except ValueError:
        return error_response(f'Invalid status: {new_status}')

    payout = DoctorPayout.query.get(payout_id)
    if not payout:
        return not_found_response('Payout not found')

    # Cashfree real disbursal (Phase B): when configured, "completing" a payout
    # actually sends the money. Status goes PROCESSING now; the payout webhook
    # flips it to COMPLETED/FAILED. Falls back to the manual flip below when
    # Cashfree isn't configured, or when the admin supplied a manual transfer id.
    # The admin must never move money. A payout is released by the doctor
    # claiming it, or automatically at maturity for auto-pay doctors — so
    # "Completed" is not an admin-settable state. Without this an admin could
    # both bypass the doctor's consent AND (by pasting a transfer id) mark a
    # payout paid when nothing was sent.
    if new_status_enum == PayoutStatus.COMPLETED:
        return error_response(
            'Payouts are not completed by an admin. Push the payout to the doctor '
            'and let them claim it — the transfer is sent then, and Cashfree marks '
            'it Completed once the bank confirms.',
            status_code=409,
        )

    payout.status = new_status_enum
    if data.get('razorpay_transfer_id'):
        payout.razorpay_transfer_id = data['razorpay_transfer_id']
    if data.get('razorpay_payout_id'):
        payout.razorpay_payout_id = data['razorpay_payout_id']
    if data.get('reason'):
        payout.status_reason = data['reason']
    if data.get('razorpay_fee'):
        payout.razorpay_fee = Decimal(data['razorpay_fee']).quantize(Decimal('0.01'))
        # Recalculate payout amount
        net = payout.payment_amount - payout.total_charges
        payout.payout_amount = net - payout.tds_amount - payout.razorpay_fee
    if new_status_enum == PayoutStatus.COMPLETED:
        payout.completed_at = datetime.now(timezone.utc)

    db.session.commit()
    logger.info(f"[PAYOUT] {payout.bill_number} status → {new_status} by user={current_user.id}")

    return success_response(data=payout.to_dict(), message=f'Payout status updated to {new_status}')


# ── Retry a failed payout or one with missing bank details ──

@payout_bp.route('/<payout_id>/retry', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def retry_payout(payout_id):
    """
    Retry a payout that failed or was created without verified bank details.
    Re-checks bank verification and resets status to PENDING.
    Optionally accepts razorpay_fee to recalculate.

    Body (all optional):
    { "razorpay_fee": "2.50" }
    """
    data = request.get_json() or {}

    payout = DoctorPayout.query.get(payout_id)
    if not payout:
        return not_found_response('Payout not found')

    if payout.status == PayoutStatus.COMPLETED:
        return error_response('Payout already completed — cannot retry')

    doctor = Doctor.query.get(payout.doctor_id)
    if not doctor:
        return error_response('Doctor not found')

    # Re-check bank details
    primary_bank = ProfileBankAccount.query.filter_by(
        doctor_id=doctor.id, order_index=0
    ).first()
    if not primary_bank:
        return error_response(
            'Doctor has not added primary bank account. Ask the doctor to fill bank details first.',
            data={'doctor_id': str(doctor.id), 'doctor_name': f"{doctor.user.first_name or ''} {doctor.user.last_name or ''}".strip() if doctor.user else ''},
        )
    if primary_bank.verification_status != DocumentVerificationStatus.VERIFIED:
        return error_response(
            f'Doctor bank account is not verified (status: {primary_bank.verification_status.value}). '
            'Verify the bank account first, then retry.',
            data={'bank_account_id': str(primary_bank.id), 'verification_status': primary_bank.verification_status.value},
        )

    # Update bank account reference and recalculate if needed
    payout.bank_account_id = primary_bank.id
    payout.status = PayoutStatus.PENDING
    payout.status_reason = f"Retried by admin on {datetime.now(timezone.utc).isoformat()}"
    payout.initiated_by_id = current_user.id
    payout.initiated_at = datetime.now(timezone.utc)
    # Re-stamp the hold/mode on retry too — resetting to PENDING without this
    # drops the payout back into the same no-transition dead end.
    payout.hold_until = None
    from app.api.common.payment.billing_service import apply_hold
    apply_hold(payout, doctor)

    if data.get('razorpay_fee'):
        payout.razorpay_fee = Decimal(data['razorpay_fee']).quantize(Decimal('0.01'))

    # Recalculate final payout
    net = payout.payment_amount - payout.total_charges
    payout.payout_amount = net - payout.tds_amount - payout.razorpay_fee

    db.session.commit()
    logger.info(f"[PAYOUT] Retried payout {payout.bill_number} by user={current_user.id}")

    return success_response(data=payout.to_dict(), message=f'Payout {payout.bill_number} reset to pending — ready for processing')


# ── List pending payouts without verified bank (for admin dashboard) ──

@payout_bp.route('/needs-bank', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_payouts_needing_bank():
    """List payouts where bank account is missing or not verified — needs admin action."""
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)

    query = DoctorPayout.query.filter(
        DoctorPayout.tenant_id == current_tenant_id_strict(),
        DoctorPayout.status.in_([PayoutStatus.PENDING, PayoutStatus.FAILED]),
        db.or_(
            DoctorPayout.bank_account_id.is_(None),
            ~DoctorPayout.bank_account_id.in_(
                db.session.query(ProfileBankAccount.id).filter(
                    ProfileBankAccount.verification_status == DocumentVerificationStatus.VERIFIED
                )
            ),
        ),
    ).order_by(DoctorPayout.created_at.desc())

    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    payouts = []
    for p in paginated.items:
        d = p.to_dict()
        if p.doctor and p.doctor.user:
            d['doctor_name'] = f"{p.doctor.user.first_name or ''} {p.doctor.user.last_name or ''}".strip()
            d['doctor_email'] = p.doctor.user.email
        # Bank info
        if p.bank_account_id:
            ba = ProfileBankAccount.query.get(p.bank_account_id)
            d['bank_status'] = ba.verification_status.value if ba else 'missing'
            d['bank_account_id'] = str(p.bank_account_id)
        else:
            d['bank_status'] = 'missing'
            # Check if doctor has any bank account at all
            primary = ProfileBankAccount.query.filter_by(doctor_id=p.doctor_id, order_index=0).first()
            if primary:
                d['bank_account_id'] = str(primary.id)
                d['bank_status'] = primary.verification_status.value
            else:
                d['bank_account_id'] = None
        payouts.append(d)

    return success_response(data={
        'payouts': payouts,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@payout_bp.route('/verified-banks', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_verified_bank_accounts():
    """Doctors whose bank account is verified — shown beside the "needs bank"
    list so the admin can see who is payout-ready at a glance."""
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)

    query = (ProfileBankAccount.query
             .filter(ProfileBankAccount.tenant_id == current_tenant_id_strict(),
                     ProfileBankAccount.verification_status == DocumentVerificationStatus.VERIFIED)
             .order_by(ProfileBankAccount.updated_at.desc()))
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    def _mask(acc):
        acc = str(acc or '')
        return ('•••• ' + acc[-4:]) if len(acc) >= 4 else acc

    out = []
    for ba in paginated.items:
        doc = Doctor.query.get(ba.doctor_id) if ba.doctor_id else None
        out.append({
            'id': str(ba.id),
            'doctor_id': str(ba.doctor_id) if ba.doctor_id else None,
            'doctor_name': (doc.full_name if doc else None),
            'account_holder': ba.account_name,
            'account_number': _mask(ba.account_number),
            'ifsc': ba.ifsc_code,
            'bank_name': ba.bank_name,
            'is_primary': ba.order_index == 0,
            'verification_status': ba.verification_status.value,
        })

    return success_response(data={
        'bank_accounts': out,
        'pagination': {
            'page': paginated.page, 'per_page': paginated.per_page,
            'total': paginated.total, 'pages': paginated.pages,
        },
    })
