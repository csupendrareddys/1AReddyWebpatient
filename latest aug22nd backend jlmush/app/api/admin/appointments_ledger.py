"""Admin Appointments Ledger — read-only.

Aggregates every booking across the three source tables (consultation
``Appointment``, individual-service ``MarketplaceOrder``, plan
``GroupOfferingBooking``) into one flat ledger row, left-joining the shared
``Payment`` + ``DoctorPayout`` satellites and computing the payout / margin
figures (N1..N3, B1..B4, PP1, F1..F3, G1..G5) the operations spec asks for.

Fetch-only: one GET, no mutations. Money math is deliberately defensive —
a booking with no payment/payout simply leaves those columns blank.
"""
import logging
from decimal import Decimal

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from app.common.decorators import rbac_required
from app.common.responses import success_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    PermissionModule, PermissionAction,
    Appointment, DoctorPayout, Payment, BillingConfig,
)

logger = logging.getLogger(__name__)

appointments_ledger_bp = Blueprint('appointments_ledger', __name__)

_D0 = Decimal('0')


def _dec(v):
    try:
        return Decimal(str(v)) if v is not None else _D0
    except Exception:  # noqa: BLE001
        return _D0


def _f(v):
    """Decimal → float for JSON, rounded to paise."""
    return float(_dec(v).quantize(Decimal('0.01')))


def _val(enum_or_str):
    return getattr(enum_or_str, 'value', enum_or_str)


def _dt(v):
    return v.isoformat() if v is not None and hasattr(v, 'isoformat') else (v or None)


def _tax_rate(cfg):
    """Combined platform GST rate as a fraction (e.g. 0.18)."""
    if not cfg:
        return _D0
    r = _dec(getattr(cfg, 'platform_fee_cgst_rate', 0)) + _dec(getattr(cfg, 'platform_fee_sgst_rate', 0))
    return r / Decimal('100')


# --------------------------------------------------------------------------- #
# Payout + margin math (shared by all three sources)
# --------------------------------------------------------------------------- #
def _payout_and_margin(payouts, rate):
    """Fold a list of DoctorPayout rows for one booking into the payout + margin
    columns. Multiple rows (a plan booking pays per member-installment) are
    summed."""
    out = {k: None for k in (
        'n1_gross', 'n2_taxes', 'n3_net', 'b1_doctor_fee', 'b2_service_fee',
        'b3_platform_fee', 'b4_other_fee', 'payout_basis', 'pp1', 'tds',
        'net_to_bank', 'eligibility_date', 'claim_date', 'payment_done_date',
        'amount_paid', 'gateway_payout', 'gateway_eligibility_date',
        'fee_f1', 'fee_tax_f2', 'fee_net_f3', 'gap_g1', 'gap_tax', 'gap_net_g3',
        'margin_net_g4', 'margin_taxes_t', 'margin_gross_g5',
    )}
    if not payouts:
        return out

    n1 = sum((_dec(p.payment_amount) for p in payouts), _D0)
    n2 = sum((_dec(p.taxes_gst) for p in payouts), _D0)
    appt_amt = sum((_dec(p.appointment_amount) for p in payouts), _D0)
    b2 = sum((_dec(p.charge1_amount) for p in payouts), _D0)
    b3 = sum((_dec(p.charge2_amount) for p in payouts), _D0)
    b4 = sum((_dec(p.charge3_amount) for p in payouts), _D0)
    tds = sum((_dec(p.tds_amount) for p in payouts), _D0)
    payout_amt = sum((_dec(p.payout_amount) for p in payouts), _D0)
    gateway = sum((_dec(p.razorpay_fee) for p in payouts), _D0)

    n3 = n1 - n2
    # B1 (doctor fee): appointment_amount for consultations; for service/plan
    # payouts that column is 0, so reconstruct the gross doctor fee.
    b1 = appt_amt if appt_amt > _D0 else (payout_amt + b2 + b3 + b4 + tds)
    pp1 = b1 - b2 - b3 - b4  # "for now only B1" basis

    # Margin
    f1 = b2 + b3 + b4
    f2 = (f1 * rate).quantize(Decimal('0.01'))
    f3 = f1 - f2
    g1 = pp1 - n3
    gap_tax = (g1 * rate).quantize(Decimal('0.01'))
    g3 = g1 - gap_tax
    g4 = g3 + f2
    t = f2 + gap_tax
    g5 = g4 + t

    # Representative dates come from the most recent payout row.
    last = max(payouts, key=lambda p: (p.created_at or p.initiated_at or 0) or 0)

    out.update({
        'n1_gross': _f(n1), 'n2_taxes': _f(n2), 'n3_net': _f(n3),
        'b1_doctor_fee': _f(b1), 'b2_service_fee': _f(b2),
        'b3_platform_fee': _f(b3), 'b4_other_fee': _f(b4),
        'payout_basis': 'B1', 'pp1': _f(pp1), 'tds': _f(tds),
        'net_to_bank': _f(payout_amt), 'amount_paid': _f(payout_amt),
        'gateway_payout': _f(gateway),
        'eligibility_date': _dt(getattr(last, 'hold_until', None)),
        'claim_date': _dt(getattr(last, 'claim_requested_at', None)),
        'payment_done_date': _dt(getattr(last, 'completed_at', None)),
        'gateway_eligibility_date': _dt(getattr(last, 'hold_until', None)),
        'fee_f1': _f(f1), 'fee_tax_f2': _f(f2), 'fee_net_f3': _f(f3),
        'gap_g1': _f(g1), 'gap_tax': _f(gap_tax), 'gap_net_g3': _f(g3),
        'margin_net_g4': _f(g4), 'margin_taxes_t': _f(t), 'margin_gross_g5': _f(g5),
    })
    return out


def _payment_cols(payment):
    if not payment:
        return {'payment_tried': 'No', 'payment_status': None,
                'payment_id': None, 'payment_date': None}
    return {
        'payment_tried': 'Yes',
        'payment_status': _val(payment.status),
        'payment_id': str(payment.id),
        'payment_date': _dt(payment.payment_date),
    }


def _presc_cols(doc):
    """Prescription / DoctorDocument columns as DATES (when each milestone was
    reached) rather than Yes/No. Generated = row created; pending = last update
    while pending admin approval; published = last update once active/approved.
    (The models don't stamp a per-status timestamp, so updated_at is the best
    available signal for the current-state milestones.)"""
    if doc is None:
        return {'presc_status': None, 'presc_generated': None,
                'presc_pending_admin': None, 'presc_published': None}
    s = _val(getattr(doc, 'status', None))
    created = _dt(getattr(doc, 'created_at', None))
    updated = _dt(getattr(doc, 'updated_at', None))
    return {
        'presc_status': s,
        'presc_generated': created if s not in ('draft',) else None,
        'presc_pending_admin': updated if s == 'pending_approval' else None,
        'presc_published': updated if s in ('active', 'approved') else None,
    }


# --------------------------------------------------------------------------- #
# Per-source normalisation
# --------------------------------------------------------------------------- #
def _norm_appointment(a, rate):
    doctor_name = None
    try:
        doctor_name = a.doctor.full_name if a.doctor else None
    except Exception:  # noqa: BLE001
        pass
    patient_name = None
    try:
        patient_name = a.patient.full_name if a.patient else None
    except Exception:  # noqa: BLE001
        pass

    payment = (Payment.query.filter_by(appointment_id=a.id)
               .order_by(Payment.created_at.desc()).first())
    payouts = DoctorPayout.query.filter_by(appointment_id=a.id).all()

    presc = None
    try:
        presc = a.prescriptions.order_by(None).first() if hasattr(a.prescriptions, 'order_by') else None
    except Exception:  # noqa: BLE001
        presc = None

    row = {
        '_sort': a.booking_date or a.created_at,
        'booking_date': _dt(a.booking_date or a.created_at),
        'booking_id': str(a.id),
        'booking_kind': ('Follow-up' if getattr(a, 'is_follow_up', False)
                         else ('Rescheduled' if getattr(a, 'is_rescheduled', False) else 'First')),
        'status': _val(a.status),
        'accepted_date': _dt(getattr(a, 'doctor_accepted_at', None)),
        'accepted_by': ('Auto' if _val(getattr(a, 'acceptance_method', None)) == 'auto_approved'
                        else ('Admin/Support' if getattr(a, 'initiated_by_id', None) else 'Doctor')),
        'exec_started': _dt(getattr(a, 'doctor_joined_at', None)),
        'exec_progress': 'Yes' if _val(a.status) == 'in_progress' else 'No',
        'exec_completed': _dt(getattr(a, 'completed_at', None)) if _val(a.status) == 'completed' else None,
        'patient_id': str(a.patient_id) if a.patient_id else None,
        'patient_name': patient_name,
        'product_type': _val(getattr(a, 'consultation_type', None)) or 'consultation',
        'provider_id': str(a.doctor_id) if a.doctor_id else None,
        'provider_name': doctor_name,
        'view_link': f'/dashboard/admin/appointments?id={a.id}',
    }
    row.update(_payment_cols(payment))
    row.update(_presc_cols(presc))
    row.update({
        'display_price': _f(getattr(a, 'consultation_fee', 0)),
        'price_after_dis': _f(getattr(a, 'consultation_fee', 0)),
        'plan_name': None, 'plan_discount': None, 'plan_coupon': None,
        'coupon': None, 'plan_voucher': None, 'voucher': None,
    })
    row.update(_payout_and_margin(payouts, rate))
    return row


def _norm_order(o, rate):
    payment = (Payment.query.filter_by(order_id=o.id)
               .order_by(Payment.created_at.desc()).first())
    payouts = DoctorPayout.query.filter_by(source_ref_id=o.id).all()
    doc = None
    try:
        docs = list(getattr(o, 'doctor_documents', []) or [])
        doc = docs[-1] if docs else None
    except Exception:  # noqa: BLE001
        doc = None
    row = {
        '_sort': o.created_at,
        'booking_date': _dt(o.created_at),
        'booking_id': str(o.id),
        'booking_kind': 'First',
        'status': _val(o.status),
        'accepted_date': None, 'accepted_by': None,
        'exec_started': None,
        'exec_progress': 'Yes' if _val(o.status) in ('under_process',) else 'No',
        'exec_completed': _dt(o.updated_at) if _val(o.status) == 'completed' else None,
        'patient_id': str(o.patient_id) if o.patient_id else None,
        'patient_name': (o.patient.full_name if getattr(o, 'patient', None) else None),
        'product_type': 'group_plan' if getattr(o, 'group_id', None) else 'service_plan',
        'provider_id': str(getattr(o, 'group_id', None) or o.doctor_id) if (getattr(o, 'group_id', None) or o.doctor_id) else None,
        'provider_name': (o.doctor.full_name if getattr(o, 'doctor', None) else None),
        'view_link': f'/dashboard/admin/products?order={o.id}',
    }
    row.update(_payment_cols(payment))
    row.update(_presc_cols(doc))
    row.update({
        'display_price': _f(getattr(o, 'price_at_purchase', 0)),
        'price_after_dis': _f(getattr(o, 'price_at_purchase', 0)),
        'plan_name': None, 'plan_discount': None, 'plan_coupon': None,
        'coupon': None, 'plan_voucher': None, 'voucher': None,
    })
    row.update(_payout_and_margin(payouts, rate))
    return row


def _norm_group(b, rate):
    inst_ids = []
    try:
        inst_ids = [i.id for i in (b.installments or [])]
    except Exception:  # noqa: BLE001
        inst_ids = []
    payment = None
    if inst_ids:
        payment = (Payment.query.filter(Payment.booking_installment_id.in_(inst_ids))
                   .order_by(Payment.created_at.desc()).first())
    # plan_installment payouts key source_ref_id to a ServiceGroupMemberInstallment
    # id (team.members[].payout_installments), with no booking_id — so reach them
    # through the booking's team. (Best-effort: a team shared across bookings can
    # over-attribute; the data model has no payout→booking link for plans.)
    team_inst_ids = []
    try:
        from app.models import MarketplaceServiceGroup
        team = MarketplaceServiceGroup.query.get(b.team_id) if getattr(b, 'team_id', None) else None
        if team is not None:
            for m in team.members:
                team_inst_ids += [i.id for i in (getattr(m, 'payout_installments', None) or [])]
    except Exception:  # noqa: BLE001
        team_inst_ids = []
    ref_ids = [b.id] + inst_ids + team_inst_ids
    payouts = (DoctorPayout.query.filter(DoctorPayout.source_ref_id.in_(ref_ids)).all()
               if ref_ids else [])
    doc = None
    try:
        docs = list(getattr(b, 'doctor_documents', []) or [])
        doc = docs[-1] if docs else None
    except Exception:  # noqa: BLE001
        doc = None
    row = {
        '_sort': b.created_at,
        'booking_date': _dt(b.created_at),
        'booking_id': str(b.id),
        'booking_kind': 'First',
        'status': _val(b.status),
        'accepted_date': None, 'accepted_by': None,
        'exec_started': None,
        'exec_progress': 'Yes' if _val(b.status) in ('active',) else 'No',
        'exec_completed': _dt(b.updated_at) if _val(b.status) == 'completed' else None,
        'patient_id': str(b.patient_id) if b.patient_id else None,
        'patient_name': (b.patient.full_name if getattr(b, 'patient', None) else None),
        'product_type': 'group_plan',
        'provider_id': str(getattr(b, 'team_id', None)) if getattr(b, 'team_id', None) else None,
        'provider_name': getattr(b, 'plan_name', None),
        'view_link': f'/dashboard/admin/group-offerings?booking={b.id}',
    }
    row.update(_payment_cols(payment))
    row.update(_presc_cols(doc))
    row.update({
        'display_price': _f(getattr(b, 'plan_price', 0) or getattr(b, 'total_payable', 0)),
        'price_after_dis': _f(getattr(b, 'total_payable', 0) or getattr(b, 'plan_price', 0)),
        'plan_name': getattr(b, 'plan_name', None),
        'plan_discount': None, 'plan_coupon': None, 'coupon': None,
        'plan_voucher': None, 'voucher': None,
    })
    row.update(_payout_and_margin(payouts, rate))
    return row


def _total_days(booking_date, completed_date):
    """Whole days from booking to completion (None until completed)."""
    if not booking_date or not completed_date:
        return None
    try:
        from datetime import datetime
        b = datetime.fromisoformat(booking_date)
        c = datetime.fromisoformat(completed_date)
        return max((c - b).days, 0)
    except Exception:  # noqa: BLE001
        return None


@appointments_ledger_bp.route('/customer/<patient_id>', methods=['GET'])
@jwt_required()
@rbac_required(PermissionModule.APPOINTMENT_LIST, PermissionAction.VIEW)
def customer_ledger(patient_id):
    """Per-customer booking history — every consultation / service / group
    booking for one patient, normalised to the same shape as the main
    ledger, plus a payments roll-up. Powers the admin Customer View's
    View 1 (appointments + prescriptions) and View 2 (lifecycle +
    payments)."""
    from app.models import MarketplaceOrder, GroupOfferingBooking

    tid = current_tenant_id_strict()
    cfg = BillingConfig.query.filter_by(tenant_id=tid, is_active=True).first()
    rate = _tax_rate(cfg)

    rows = []
    for a in (Appointment.query
              .filter(Appointment.tenant_id == tid,
                      Appointment.patient_id == patient_id,
                      Appointment.is_deleted == False)  # noqa: E712
              .all()):
        rows.append(_norm_appointment(a, rate))
    for o in (MarketplaceOrder.query
              .filter(MarketplaceOrder.tenant_id == tid,
                      MarketplaceOrder.patient_id == patient_id)
              .all()):
        rows.append(_norm_order(o, rate))
    for b in (GroupOfferingBooking.query
              .filter(GroupOfferingBooking.tenant_id == tid,
                      GroupOfferingBooking.patient_id == patient_id)
              .all()):
        rows.append(_norm_group(b, rate))

    rows.sort(key=lambda r: (r.get('_sort') is not None, r.get('_sort')), reverse=True)

    # Payments roll-up across this customer's bookings.
    total_paid = _D0
    for idx, r in enumerate(rows):
        r['total_days'] = _total_days(r.get('booking_date'), r.get('exec_completed'))
        r.pop('_sort', None)
        r['sno'] = idx + 1
        if r.get('payment_status') == 'success':
            total_paid += _dec(r.get('display_price'))

    counts = {}
    for r in rows:
        s = r.get('status') or 'unknown'
        counts[s] = counts.get(s, 0) + 1

    return success_response(data={
        'patient_id': str(patient_id),
        'rows': rows,
        'summary': {
            'total_bookings': len(rows),
            'by_status': counts,
            'total_paid': _f(total_paid),
        },
    })


@appointments_ledger_bp.route('', methods=['GET'])
@jwt_required()
@rbac_required(PermissionModule.APPOINTMENT_LIST, PermissionAction.VIEW)
def list_ledger():
    """Aggregated, read-only booking ledger. Optional repeated ``?type=`` filter
    (service_plan, group_plan, video, audio, chat, voice, home_visit, …)."""
    from app.models import MarketplaceOrder, GroupOfferingBooking

    tid = current_tenant_id_strict()
    types = set(request.args.getlist('type'))
    page = max(request.args.get('page', 1, type=int), 1)
    per_page = min(max(request.args.get('per_page', 50, type=int), 1), 200)

    cfg = BillingConfig.query.filter_by(tenant_id=tid, is_active=True).first()
    rate = _tax_rate(cfg)

    def want(tok):
        return not types or tok in types

    rows = []

    # 1) Consultation appointments
    appt_tokens = {'video', 'audio', 'chat', 'voice', 'complete', 'home_visit', 'camp', 'consultation'}
    if not types or (types & appt_tokens):
        for a in (Appointment.query
                  .filter(Appointment.tenant_id == tid, Appointment.is_deleted == False)  # noqa: E712
                  .all()):
            ctype = _val(getattr(a, 'consultation_type', None)) or 'consultation'
            if types and ctype not in types:
                continue
            rows.append(_norm_appointment(a, rate))

    # 2) Individual service orders (+ any legacy group orders)
    if want('service_plan') or want('group_plan'):
        for o in MarketplaceOrder.query.filter(MarketplaceOrder.tenant_id == tid).all():
            ptype = 'group_plan' if getattr(o, 'group_id', None) else 'service_plan'
            if types and ptype not in types:
                continue
            rows.append(_norm_order(o, rate))

    # 3) Group / plan bookings (no soft-delete column on this model)
    if want('group_plan'):
        for b in (GroupOfferingBooking.query
                  .filter(GroupOfferingBooking.tenant_id == tid)
                  .all()):
            rows.append(_norm_group(b, rate))

    # Sort newest-first, paginate over the combined list.
    rows.sort(key=lambda r: (r.get('_sort') is not None, r.get('_sort')), reverse=True)
    total = len(rows)
    start = (page - 1) * per_page
    page_rows = rows[start:start + per_page]

    # S.No + strip internal keys.
    out = []
    for idx, r in enumerate(page_rows):
        r.pop('_sort', None)
        r['sno'] = start + idx + 1
        out.append(r)

    return success_response(data={
        'rows': out,
        'pagination': {'total': total, 'page': page, 'per_page': per_page},
    })
