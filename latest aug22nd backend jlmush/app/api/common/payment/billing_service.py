"""
Doctor billing-profile + payout hold/claim helpers (Phase 1).

Resolves the T-day hold, stamps a freshly-computed payout with the hold, and
promotes matured on-hold payouts. Promotion is done lazily on read (reliable
regardless of whether APScheduler is installed) and also by an optional
background job.
"""
import logging
from datetime import datetime, timezone, timedelta

from app.extensions import db

logger = logging.getLogger(__name__)


def get_or_create_billing_profile(doctor):
    """The doctor's DoctorBillingProfile, materialised with defaults (plan/autopay)."""
    from app.extensions import db
    from app.models import DoctorBillingProfile

    profile = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    if not profile:
        profile = DoctorBillingProfile(tenant_id=doctor.tenant_id, doctor_id=doctor.id)
        db.session.add(profile)
        db.session.flush()
    return profile


def resolve_active_plan(doctor):
    """The doctor's active in-tenant plan (TenantProviderPlan) or None.

    Billing-type-agnostic — keys on the subscription (provider_id == doctor.id),
    so plan / employee / consultant doctors all resolve the same way. Only
    TRIAL/ACTIVE subscriptions count (a PENDING request that admin hasn't
    approved yet must not drive fees or the hold). Single source of truth for
    every plan-driven billing value (hold days, per-patient fee, salary
    deduction).
    """
    try:
        from app.models import (
            TenantProviderSubscription, TenantProviderPlan,
            MembershipSubscriptionStatus,
        )
        sub = TenantProviderSubscription.query.filter(
            TenantProviderSubscription.tenant_id == doctor.tenant_id,
            TenantProviderSubscription.provider_id == doctor.id,
            TenantProviderSubscription.status.in_([
                MembershipSubscriptionStatus.TRIAL,
                MembershipSubscriptionStatus.ACTIVE,
            ]),
        ).order_by(TenantProviderSubscription.created_at.desc()).first()
        if sub and getattr(sub, 'tenant_provider_plan_id', None):
            return TenantProviderPlan.query.get(sub.tenant_provider_plan_id)
    except Exception:  # pragma: no cover — plan lookup is optional
        pass
    return None


def resolve_active_membership_plan(doctor):
    """The doctor's active marketplace membership plan (MembershipPlan) or None.

    Mirrors ``resolve_active_plan`` but for the ``MembershipSubscription``
    side — a doctor who pays the platform to list on its marketplace
    (rather than a ``TenantProviderSubscription`` doctor the platform pays)
    keeps their own appointment earnings; that plan's ``payout_hold_days``
    still needs to reach ``resolve_hold_days``. A doctor holds at most one
    of the two subscription types (mutually exclusive onboarding paths —
    see ``app/api/membership/service.py`` / ``app/api/tenant_provider_plan
    /service.py``, both reject a second active subscription), so this and
    ``resolve_active_plan`` never both return a row for the same doctor.
    """
    try:
        from app.models import (
            MembershipSubscription, MembershipPlan, MembershipSubscriptionStatus,
        )
        sub = MembershipSubscription.query.filter(
            MembershipSubscription.tenant_id == doctor.tenant_id,
            MembershipSubscription.provider_id == doctor.id,
            MembershipSubscription.status.in_([
                MembershipSubscriptionStatus.TRIAL,
                MembershipSubscriptionStatus.ACTIVE,
            ]),
        ).order_by(MembershipSubscription.created_at.desc()).first()
        if sub and getattr(sub, 'membership_plan_id', None):
            return MembershipPlan.query.get(sub.membership_plan_id)
    except Exception:  # pragma: no cover — plan lookup is optional
        pass
    return None


def _feature_path_enabled(feats, path):
    """Whether a dotted feature path is toggled on in a plan's features tree
    (the ``{category: {leaf: {enabled: true}}}`` shape the FeatureTreeEditor
    writes)."""
    node = feats or {}
    for part in path.split('.'):
        if not isinstance(node, dict):
            return False
        node = node.get(part)
    if isinstance(node, bool):
        return node
    if isinstance(node, dict):
        return bool(node.get('enabled'))
    return False


def _plan_uses_feature_gating(feats):
    """True once ANY whitelisted feature path is enabled on the plan — the
    signal the admin has adopted feature-path access control. Plans that predate
    the control (no enabled paths) stay unrestricted, so enforcement can't
    silently lock out existing providers."""
    try:
        from app.api.pricing.service import ALLOWED_FEATURE_PATHS
    except Exception:  # pragma: no cover — defensive import
        return False
    return any(_feature_path_enabled(feats, p) for p in ALLOWED_FEATURE_PATHS)


def plan_grants_offering(doctor, path):
    """Whether the doctor's active plan lets them offer a marketplace capability
    (``service.offer`` / ``group_offering.offer``).

    Sourced off whichever plan the doctor holds — provider plan or membership
    plan. Backward-compatible: no active plan, or a plan that never adopted the
    feature control, is unrestricted; once a plan uses feature gating, the
    specific path must be enabled.
    """
    plan = resolve_active_plan(doctor) or resolve_active_membership_plan(doctor)
    if not plan:
        return True
    feats = getattr(plan, 'features', None) or {}
    if not _plan_uses_feature_gating(feats):
        return True
    return _feature_path_enabled(feats, path)


def resolve_hold_days(doctor):
    """T-day hold: per-doctor override → membership/provider plan → tenant default → 0."""
    from app.models import DoctorBillingProfile, BillingConfig

    profile = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    if profile and profile.hold_days_override is not None:
        return max(0, int(profile.hold_days_override))

    membership_plan = resolve_active_membership_plan(doctor)
    if membership_plan and membership_plan.payout_hold_days is not None:
        return max(0, int(membership_plan.payout_hold_days))

    plan = resolve_active_plan(doctor)
    if plan:
        hd = plan.billing_terms()['payout_hold_days']
        if hd is not None:
            return max(0, int(hd))

    cfg = BillingConfig.query.filter_by(tenant_id=doctor.tenant_id, is_active=True).first()
    if cfg and cfg.default_hold_days is not None:
        return max(0, int(cfg.default_hold_days))
    return 0


def resolve_per_patient_platform_fee(doctor, base_amount):
    """Plan-driven platform fee (charge1) for one per-patient payout.

    Returns a Decimal when the doctor's active plan defines a per-patient fee,
    else None so the caller falls back to the tenant BillingConfig charge1.
    Applies to Plan doctors and Consultant above-minimum per-patient earnings.
    """
    from decimal import Decimal
    plan = resolve_active_plan(doctor)
    if not plan:
        return None
    fee = plan.billing_terms()['per_patient_fee']
    if fee['mode'] == 'percentage':
        return (Decimal(str(base_amount)) * Decimal(str(fee['value'])) / Decimal('100')).quantize(Decimal('0.01'))
    if fee['mode'] == 'flat':
        return Decimal(str(fee['value'])).quantize(Decimal('0.01'))
    return None


def _compute_one_charge(charge_type, charge_value, base_amount):
    """One platform charge → Decimal. ``percentage`` of base, else a flat ₹."""
    from decimal import Decimal
    val = Decimal(str(charge_value or 0))
    if charge_type == 'percentage':
        return (Decimal(str(base_amount)) * val / Decimal('100')).quantize(Decimal('0.01'))
    return val.quantize(Decimal('0.01'))


def _charge_inclusive_of_tax(charge_type, charge_value, tax_type, tax_value, base_amount):
    """One platform charge INCLUSIVE of its per-charge tax.

    The tax is ``percentage`` OF THE CHARGE or a flat ₹, and is folded into the
    charge so the caller deducts a single (charge + tax) figure — the rest of
    the GST/TDS breakdown is untouched. Tax value 0 ⇒ just the charge.
    """
    from decimal import Decimal
    charge = _compute_one_charge(charge_type, charge_value, base_amount)
    tax = _compute_one_charge(tax_type, tax_value, charge)
    return (charge + tax).quantize(Decimal('0.01'))


def _provider_plan_charge_specs(plan):
    """The three charge specs off a ``TenantProviderPlan``'s features JSONB.

    Stored under ``features['charges']`` as up to three
    ``{type, value, tax_type, tax_value}`` dicts (mirrors the membership-plan
    columns). Returns a list of 3 tuples, padding missing entries with zeros.
    """
    feats = getattr(plan, 'features', None) or {}
    rows = feats.get('charges') if isinstance(feats, dict) else None
    out = []
    for i in range(3):
        c = rows[i] if isinstance(rows, list) and i < len(rows) and isinstance(rows[i], dict) else {}
        out.append((
            c.get('type', 'percentage'), c.get('value', 0),
            c.get('tax_type', 'percentage'), c.get('tax_value', 0),
        ))
    return out


def resolve_active_charge_policy(doctor):
    """The live :class:`ChargePolicy` for the doctor's active membership plan,
    or ``None`` when the doctor has no membership plan / no policy row.

    The policy lives in its own table so an admin can retune charges without
    re-versioning the plan; it is read here at payout time, so an edit is live
    on the very next payout (existing payouts snapshot their own amounts)."""
    try:
        from app.models import ChargePolicy
        mp = resolve_active_membership_plan(doctor)
        if mp is None:
            return None
        return ChargePolicy.query.filter_by(
            tenant_id=doctor.tenant_id, plan_id=mp.id).first()
    except Exception:  # pragma: no cover — optional lookup
        return None


def _doctor_charge_specs(doctor):
    """The three ``(type, value, tax_type, tax_value)`` charge specs for a
    doctor, sourced with this precedence:

    1. the live ``ChargePolicy`` for their membership plan (the new home);
    2. the ``MembershipPlan`` charge columns (legacy fallback until the policy
       row exists — the migration backfills one, so this rarely fires);
    3. the ``TenantProviderPlan`` ``features['charges']`` for a tenant-paid
       doctor.

    ``None`` when the doctor has no plan at all.
    """
    policy = resolve_active_charge_policy(doctor)
    if policy is not None:
        return policy.charge_specs()
    mp = resolve_active_membership_plan(doctor)
    if mp:
        return [
            (mp.charge1_type, mp.charge1_value, mp.charge1_tax_type, mp.charge1_tax_value),
            (mp.charge2_type, mp.charge2_value, mp.charge2_tax_type, mp.charge2_tax_value),
            (mp.charge3_type, mp.charge3_value, mp.charge3_tax_type, mp.charge3_tax_value),
        ]
    pp = resolve_active_plan(doctor)
    return _provider_plan_charge_specs(pp) if pp else None


def compute_platform_charges(doctor, base_amount):
    """The doctor's three platform charges (c1, c2, c3) as Decimals, each
    INCLUSIVE of its per-charge tax. Read live from the doctor's ChargePolicy
    (see :func:`_doctor_charge_specs`); no plan ⇒ **zero** on all three."""
    from decimal import Decimal
    specs = _doctor_charge_specs(doctor)
    if not specs:
        z = Decimal('0.00')
        return z, z, z
    return tuple(
        _charge_inclusive_of_tax(ct, cv, tt, tv, base_amount)
        for (ct, cv, tt, tv) in specs
    )


def compute_platform_charges_detail(doctor, base_amount):
    """Per-charge breakdown for a payout snapshot / display: a list of three
    ``{name, base_charge, tax, total}`` dicts (strings, 2dp). ``total`` matches
    the corresponding value from :func:`compute_platform_charges`, so the two
    always agree — this just exposes the tax split the inclusive figure hides.
    """
    from decimal import Decimal
    CENT = Decimal('0.01')
    specs = _doctor_charge_specs(doctor)
    names = resolve_charge_names(doctor)
    out = []
    for i in range(3):
        if not specs:
            out.append({'name': names[i], 'base_charge': '0.00', 'tax': '0.00', 'total': '0.00'})
            continue
        ct, cv, tt, tv = specs[i]
        base = _compute_one_charge(ct, cv, base_amount)
        tax = _compute_one_charge(tt, tv, base)
        out.append({
            'name': names[i],
            'base_charge': str(base.quantize(CENT)),
            'tax': str(tax.quantize(CENT)),
            'total': str((base + tax).quantize(CENT)),
        })
    return out


def charges_snapshot_for(doctor, base_amount, finals=None):
    """The per-charge breakdown to snapshot on a payout row.

    Starts from :func:`compute_platform_charges_detail` and, when ``finals``
    (the actual ``(c1, c2, c3)`` amounts stored on the payout) is given,
    reconciles each entry's ``total`` to it — so a site that overrides a charge
    (e.g. the per-patient platform fee for a doctor with no membership plan)
    still gets a snapshot that agrees with the stored amount.
    """
    from decimal import Decimal
    CENT = Decimal('0.01')
    detail = compute_platform_charges_detail(doctor, base_amount)
    if finals is None:
        return detail
    for i, amt in enumerate(list(finals)[:3]):
        amt_s = str(Decimal(str(amt or 0)).quantize(CENT))
        if detail[i]['total'] != amt_s:
            detail[i] = {'name': detail[i]['name'], 'base_charge': amt_s,
                         'tax': '0.00', 'total': amt_s}
    return detail


def resolve_doctor_fee(doctor, appointment=None, fallback=None):
    """The doctor's OWN quoted fee for an appointment — the taxable value of
    *their* supply, and the base for TDS.

    ``Appointment.consultation_fee`` (and therefore ``Payment.amount``) is the
    **display price** — ``AppointmentService._resolve_consultation_fee`` runs
    the SUPER_ADMIN overlay before storing it — so the doctor's own number is
    not on the appointment and has to be resolved back from their
    ``slot_pricing`` tier. The delta between the two is the platform's margin.

    Falls back to the doctor's flat ``consultation_fee``, then to ``fallback``
    (normally the display price) so a doctor with no tier table still pays out;
    in that degenerate case the platform margin computes as zero, which is the
    honest answer — we cannot prove a margin exists.
    """
    from decimal import Decimal
    from app.common.display_pricing import tier_for_duration

    if doctor is None:
        return Decimal(str(fallback or 0))

    duration = None
    ctype = None
    if appointment is not None:
        ctype = getattr(getattr(appointment, 'consultation_type', None), 'value',
                        getattr(appointment, 'consultation_type', None))
        start, end = (getattr(appointment, 'start_time', None),
                      getattr(appointment, 'end_time', None))
        if start is not None and end is not None:
            try:
                duration = ((end.hour * 60 + end.minute)
                            - (start.hour * 60 + start.minute))
                if duration <= 0:
                    duration = None
            except AttributeError:
                duration = None

    tier = tier_for_duration(getattr(doctor, 'slot_pricing', None), ctype, duration)
    if tier is not None and tier.get('price') is not None:
        return Decimal(str(tier['price']))

    flat = getattr(doctor, 'consultation_fee', None)
    if flat is not None:
        return Decimal(str(flat))
    return Decimal(str(fallback or 0))


def resolve_gst_rates(config, consultation_type):
    """The (cgst, sgst) Decimal pair for one appointment's consultation type.

    Looks up ``config.gst_by_consultation_type[consultation_type]`` — a per-type
    override map, shape ``{"video": {"cgst": 9, "sgst": 9}, ...}``. When the type
    is present its cgst/sgst win; otherwise (unknown type, ``None`` type, or no
    map at all) it falls back to the flat ``config.cgst_rate`` / ``config.sgst_rate``,
    exactly as before this feature — so unlisted types are non-breaking.

    None-safe on a transient ``BillingConfig()`` (some call sites build one when
    no row exists, so every column is ``None``): mirrors ``payout._rate`` and
    treats a missing flat rate as 0.
    """
    from decimal import Decimal

    def _dec(val):
        return Decimal(str(val)) if val is not None else Decimal('0')

    by_type = getattr(config, 'gst_by_consultation_type', None) or {}
    if consultation_type is not None:
        entry = by_type.get(consultation_type)
        if isinstance(entry, dict) and entry.get('cgst') is not None and entry.get('sgst') is not None:
            return _dec(entry.get('cgst')), _dec(entry.get('sgst'))
    return _dec(getattr(config, 'cgst_rate', None)), _dec(getattr(config, 'sgst_rate', None))


def resolve_tds_rate(doctor, config):
    """The TDS rate (%) as a Decimal for one doctor.

    Per-doctor ``DoctorBillingProfile.tds_rate_override`` wins; otherwise the
    tenant-wide flat ``config.tds_rate``. This is a one-per-doctor knob (mirrors
    ``hold_days_override``), so most doctors have ``None`` and ride the flat
    default — non-breaking. None-safe on a transient ``BillingConfig()``.
    """
    from decimal import Decimal
    from app.models import DoctorBillingProfile

    profile = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    if profile is not None and profile.tds_rate_override is not None:
        return Decimal(str(profile.tds_rate_override))
    rate = getattr(config, 'tds_rate', None)
    return Decimal(str(rate)) if rate is not None else Decimal('0')


def resolve_charge_names(doctor):
    """(name1, name2, name3) for the doctor's charges — read live from the
    ChargePolicy, then the membership plan, then generic labels.

    Falls back to generic labels when the doctor has no active plan — the
    charge amounts are zero in that case, but the invoice/table still needs a
    column header.
    """
    policy = resolve_active_charge_policy(doctor)
    if policy is not None:
        n1, n2, n3 = policy.charge_names()
        return (n1, n2, n3)
    plan = resolve_active_membership_plan(doctor)
    if not plan:
        return ('Charge 1', 'Charge 2', 'Charge 3')
    return (
        plan.charge1_name or 'Charge 1',
        plan.charge2_name or 'Charge 2',
        plan.charge3_name or 'Charge 3',
    )


def apply_hold(payout, doctor, profile=None):
    """Stamp a freshly-built payout with the T-day hold (if T>0) + mode snapshot.

    Called right after the charge/TDS math, before commit. Leaves the payout
    as PENDING (today's behaviour) when T==0.
    """
    from app.models import PayoutStatus

    profile = profile or get_or_create_billing_profile(doctor)
    payout.payout_mode = profile.payout_mode.value if profile.payout_mode else 'autopay'
    hold_days = resolve_hold_days(doctor)
    if hold_days > 0:
        payout.status = PayoutStatus.ON_HOLD
        payout.hold_until = datetime.now(timezone.utc) + timedelta(days=hold_days)
    return payout


def _is_salary(payout):
    """True for a SalaryPayout, False for a per-patient DoctorPayout.

    The two share the state machine and the money path but differ in three
    places only — transfer-ref prefix, which column holds the payable amount,
    and the transfer remark — so they are kept as small helpers rather than
    duplicating the disbursal logic per type.
    """
    from app.models import SalaryPayout
    return isinstance(payout, SalaryPayout)


def payable_amount(payout):
    """The amount actually sent for this payout, whichever rail it is on."""
    return payout.net_amount if _is_salary(payout) else payout.payout_amount


def _transfer_remarks(payout):
    if _is_salary(payout):
        return f'{payout.kind} {payout.period_start}'
    return payout.bill_number


def recompute_salary_net(sp):
    """net = original gross + adjustments + incentives − deductions.

    ``gross_salary`` is never touched, so the expected figure and the approved
    one stay independently visible.
    """
    from decimal import Decimal
    total_adj = sum((Decimal(str(a.amount)) for a in sp.adjustments), Decimal('0'))
    sp.adjustments_total = total_adj
    sp.net_amount = (
        Decimal(str(sp.gross_salary or 0))
        + total_adj
        + Decimal(str(sp.incentive_total or 0))
        - Decimal(str(sp.deductions or 0))
    ).quantize(Decimal('0.01'))
    return sp.net_amount


# Once the doctor can see a figure, it must not move under them.
_ADJUSTABLE_STATUSES = ('on_hold', 'pending')


def adjust_salary_payout(sp, *, amount, kind, reason, actor_id=None):
    """Record an admin correction (leave-without-pay, penalty, bonus, fix).

    Appends an immutable adjustment row and recomputes ``net_amount``. The
    original ``gross_salary`` is deliberately left alone — see
    :class:`SalaryPayoutAdjustment`.

    Refused once the payout has been pushed: from CLAIMABLE onward the doctor
    has been shown an amount they can claim, and silently changing it would
    break the promise the push made. Correct a pushed payout through the
    dispute flow instead.
    """
    from decimal import Decimal, InvalidOperation
    # Import from the module rather than the app.models re-export: the shared
    # models/__init__.py currently also carries another feature's in-progress
    # imports, so this keeps the payout work independent of that file.
    from app.models.doctor_billing import SalaryPayoutAdjustment

    reason = (reason or '').strip()
    if not reason:
        raise ValueError('A reason is required for every salary adjustment.')
    if kind not in SalaryPayoutAdjustment.VALID_KINDS:
        raise ValueError(
            f"kind must be one of {', '.join(SalaryPayoutAdjustment.VALID_KINDS)}")
    try:
        amount = Decimal(str(amount))
    except (TypeError, ValueError, InvalidOperation):
        raise ValueError('amount must be a number')
    if amount == 0:
        raise ValueError('A zero adjustment changes nothing.')

    status = sp.status.value if sp.status else ''
    if status not in _ADJUSTABLE_STATUSES:
        raise ValueError(
            f'This payout can no longer be adjusted (it is {status}). '
            f'Adjust before pushing it to the doctor.'
        )

    adj = SalaryPayoutAdjustment(
        tenant_id=sp.tenant_id, salary_payout_id=sp.id,
        amount=amount, kind=kind, reason=reason, created_by_id=actor_id,
    )
    db.session.add(adj)
    db.session.flush()          # so sp.adjustments includes it
    db.session.refresh(sp)
    new_net = recompute_salary_net(sp)
    if new_net < 0:
        db.session.rollback()
        raise ValueError('That adjustment would make the payout negative.')
    db.session.commit()
    logger.info('[SALARY] adjustment %s %s on %s by %s', kind, amount, sp.id, actor_id)
    return adj


def _next_transfer_ref(payout):
    """Cashfree rejects a duplicate transfer_id, so a deterministic ref means a
    genuinely FAILED payout could never be retried. Keep the first attempt
    deterministic (that is what protects against double-click double-pay) and
    suffix each subsequent attempt.

    The ``po``/``sp`` prefix is what the webhook uses to route an event back to
    the right table, so it must match ``_handle_cashfree_payout_event``.
    """
    base = f'{"sp" if _is_salary(payout) else "po"}{payout.id.hex}'
    prev = payout.razorpay_transfer_id or ''
    if not prev:
        return base
    if prev == base:
        return f'{base}r2'
    if prev.startswith(f'{base}r'):
        try:
            return f'{base}r{int(prev[len(base) + 1:]) + 1}'
        except ValueError:
            pass
    return base


def disburse_payout(payout):
    """Fire the real Cashfree transfer for one payout. Single path used by every
    trigger (doctor claim, autopay maturity) and by BOTH rails — per-patient
    ``DoctorPayout`` and ``SalaryPayout`` — so the money rules live in one
    place. Returns ``(ok, message)``; commits either way.

    The payout lands in PROCESSING, never COMPLETED — only Cashfree's webhook
    or the reconciler may declare a terminal state.
    """
    from decimal import Decimal
    from app.extensions import db
    from app.models import PayoutStatus, ProfileBankAccount
    from app.api.common.payment import cashfree_payout as cf
    from app.api.common.payment import beneficiary_service as bene

    if not cf.is_configured():
        return False, 'Cashfree payouts are not configured on this environment.'

    bank = None
    if payout.bank_account_id:
        bank = ProfileBankAccount.query.get(payout.bank_account_id)
    if bank is None:
        bank = ProfileBankAccount.query.filter_by(
            tenant_id=payout.tenant_id, doctor_id=payout.doctor_id, order_index=0,
        ).first()
    if not bene.is_beneficiary_verified(bank):
        return False, (
            'Bank account is not a verified Cashfree beneficiary. Send a ₹1 penny '
            'drop and have the doctor confirm it first.'
        )

    amount = payable_amount(payout)
    if amount is None or Decimal(str(amount)) <= 0:
        return False, 'Nothing to pay — the payable amount is zero or negative.'

    tref = _next_transfer_ref(payout)
    try:
        bene.disburse_to_bank(
            bank, amount=amount, transfer_id=tref,
            remarks=_transfer_remarks(payout),
        )
    except Exception as e:  # noqa: BLE001 — surface any Cashfree failure
        payout.status = PayoutStatus.FAILED
        payout.status_reason = f'Cashfree transfer failed: {e}'
        db.session.commit()
        logger.warning('[PAYOUT] cashfree transfer failed payout=%s: %s', payout.id, e)
        return False, f'Cashfree transfer failed: {e}'

    payout.bank_account_id = bank.id
    payout.razorpay_transfer_id = tref
    payout.status = PayoutStatus.PROCESSING
    payout.status_reason = None
    db.session.commit()
    logger.info('[PAYOUT] cashfree transfer sent payout=%s ref=%s', payout.id, tref)
    return True, 'Payout sent via Cashfree — it settles when Cashfree confirms.'


# Cashfree transfer states → our terminal states. Anything not listed (RECEIVED,
# APPROVAL_PENDING, PENDING) is still in flight and left alone.
_CF_TERMINAL = {
    'SUCCESS': 'COMPLETED',
    'FAILED': 'FAILED',
    'REJECTED': 'FAILED',
    'REVERSED': 'REVERSED',
}


def reconcile_processing_payouts(tenant_id=None):
    """Ask Cashfree for the terminal state of every PROCESSING payout.

    Cashfree is explicit that a transfer's terminal state can only be learned
    from the Check Status API or a webhook. Without this, a missed webhook
    leaves money that has actually moved sitting in PROCESSING forever.
    Returns a dict of what changed.
    """
    from app.extensions import db
    from app.models import DoctorPayout, SalaryPayout, PayoutStatus
    from app.api.common.payment import cashfree_payout as cf

    stats = {'checked': 0, 'completed': 0, 'failed': 0, 'reversed': 0, 'in_flight': 0, 'errors': 0}
    if not cf.is_configured():
        return stats

    def _in_flight(model):
        q = model.query.filter(model.status == PayoutStatus.PROCESSING)
        if tenant_id:
            q = q.filter(model.tenant_id == tenant_id)
        return q.all()

    # Salary transfers are real money on the same rail; omitting them meant a
    # missed webhook stranded a salary in PROCESSING with no way back.
    for p in _in_flight(DoctorPayout) + _in_flight(SalaryPayout):
        stats['checked'] += 1
        ref = p.razorpay_transfer_id or _next_transfer_ref(p)
        try:
            resp = cf.get_transfer_status(ref) or {}
        except Exception as e:  # noqa: BLE001 — a lookup failure must not poison the sweep
            # Money may or may not have moved; we simply don't know. Counting these
            # keeps the caller's arithmetic honest instead of silently losing rows.
            stats['errors'] += 1
            logger.warning('[PAYOUT_RECONCILE] status lookup failed payout=%s ref=%s: %s', p.id, ref, e)
            continue
        data = resp.get('data') or resp
        cf_status = (data.get('status') or '').upper()
        terminal = _CF_TERMINAL.get(cf_status)
        if not terminal:
            stats['in_flight'] += 1
            continue
        if terminal == 'COMPLETED':
            p.status = PayoutStatus.COMPLETED
            p.completed_at = datetime.now(timezone.utc)
            p.status_reason = None
            stats['completed'] += 1
        elif terminal == 'REVERSED':
            p.status = PayoutStatus.REVERSED
            p.status_reason = data.get('status_description') or 'Reversed at Cashfree'
            stats['reversed'] += 1
        else:
            p.status = PayoutStatus.FAILED
            p.status_reason = data.get('status_description') or f'Cashfree: {cf_status}'
            stats['failed'] += 1
        logger.info('[PAYOUT_RECONCILE] payout=%s ref=%s cf=%s -> %s', p.id, ref, cf_status, terminal)

    if stats['completed'] or stats['failed'] or stats['reversed']:
        db.session.commit()
    return stats


def promote_matured_payouts(tenant_id):
    """Promote matured ON_HOLD payouts for one tenant. Commits if anything changed.

    claim   → CLAIMABLE (the doctor's Claim is what releases the money).
    autopay → disbursed via Cashfree immediately, no human in the loop. It only
              falls back to CLAIMABLE when the transfer can't be sent (Cashfree
              off, or the beneficiary isn't verified) so the money is never
              silently dropped — the doctor can still claim it once fixed.
    """
    from app.extensions import db
    from app.models import DoctorPayout, PayoutStatus

    from app.models import SalaryPayout

    now = datetime.now(timezone.utc)
    matured = DoctorPayout.query.filter(
        DoctorPayout.tenant_id == tenant_id,
        DoctorPayout.status == PayoutStatus.ON_HOLD,
        DoctorPayout.hold_until.isnot(None),
        DoctorPayout.hold_until < now,
    ).all()
    # Salary/retainer rows mature on the same sweep — they share the state
    # machine, so leaving them out would strand them ON_HOLD forever.
    matured += SalaryPayout.query.filter(
        SalaryPayout.tenant_id == tenant_id,
        SalaryPayout.status == PayoutStatus.ON_HOLD,
        SalaryPayout.hold_until.isnot(None),
        SalaryPayout.hold_until < now,
    ).all()

    autopaid = 0
    for p in matured:
        if p.payout_mode == 'claim':
            p.status = PayoutStatus.CLAIMABLE
            continue
        # autopay — hands-off disbursal.
        ok, msg = disburse_payout(p)
        if ok:
            autopaid += 1
        elif p.status == PayoutStatus.ON_HOLD:
            # Couldn't send (not a hard Cashfree failure) — park it as claimable
            # rather than leaving it stuck on hold forever.
            p.status = PayoutStatus.CLAIMABLE
            p.status_reason = f'Auto-pay unavailable: {msg}'
    if matured:
        db.session.commit()
        logger.info(
            '[PAYOUT_HOLD] promoted %d matured payout(s) for tenant %s (%d auto-paid)',
            len(matured), tenant_id, autopaid,
        )
    return len(matured)


# ── Phase 2: employment agreements + salary ──────────────────────────────

def _apply_agreement_fields(agr, data):
    """Map an agreement payload dict onto a DoctorEmploymentAgreement."""
    from datetime import datetime as _dt
    from app.models import SalaryCadence, PlatformFeeMode

    def _blank(v):
        return None if v in (None, '') else v

    def _time(v):
        return _dt.strptime(v, '%H:%M').time() if v else None

    def _date(v):
        return _dt.strptime(v, '%Y-%m-%d').date() if v else None

    if 'effective_from' in data:
        agr.effective_from = _date(data['effective_from'])
    if 'effective_to' in data:
        agr.effective_to = _date(data['effective_to'])
    for f in ('min_hours_per_day', 'min_hours_per_week', 'min_hours_per_month',
              'monthly_salary', 'platform_fee_value', 'base_retainer_amount'):
        if f in data:
            setattr(agr, f, _blank(data[f]))
    if 'monthly_salary' in data and _blank(data['monthly_salary']) is None:
        agr.monthly_salary = 0
    if 'day_window_start' in data:
        agr.day_window_start = _time(data['day_window_start'])
    if 'day_window_end' in data:
        agr.day_window_end = _time(data['day_window_end'])
    if 'per_type_minimums' in data:
        agr.per_type_minimums = data['per_type_minimums'] or {}
    if 'notes' in data:
        agr.notes = data['notes']
    for field, enum_cls in (('payment_cadence', SalaryCadence),
                            ('retainer_cadence', SalaryCadence),
                            ('platform_fee_mode', PlatformFeeMode)):
        if field in data and data[field]:
            try:
                setattr(agr, field, enum_cls(data[field]))
            except ValueError:
                pass
    return agr


def get_active_agreement(doctor):
    from app.models import DoctorEmploymentAgreement
    return DoctorEmploymentAgreement.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id, is_active=True,
    ).order_by(DoctorEmploymentAgreement.created_at.desc()).first()


def current_billing_type(doctor):
    """The doctor's billing bucket (PLAN / EMPLOYEE / CONSULTANT) without
    materialising a profile row. Defaults to PLAN when none exists."""
    from app.models import DoctorBillingProfile, DoctorBillingType
    p = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    return p.billing_type if p and p.billing_type else DoctorBillingType.PLAN


def _cancel_conflicting_engagements(doctor, new_type):
    """Enforce the one-engagement rule: a doctor is EXACTLY one of PLAN /
    EMPLOYEE / CONSULTANT at a time. When their billing type changes, cancel the
    live subscription that belongs to the OTHER world so they never hold both.

      * → PLAN            : cancel any live TenantProviderSubscription
                            (employee/consultant engagement).
      * → EMPLOYEE/CONSULTANT: cancel any live MembershipSubscription
                            (plan-based membership tier).
    """
    from app.models import (
        DoctorBillingType, MembershipSubscription, TenantProviderSubscription,
        MembershipSubscriptionStatus, MembershipVertical,
    )
    from app.models._base import utcnow
    live = (MembershipSubscriptionStatus.PENDING,
            MembershipSubscriptionStatus.TRIAL,
            MembershipSubscriptionStatus.ACTIVE,
            MembershipSubscriptionStatus.PAST_DUE)
    Model = (TenantProviderSubscription if new_type == DoctorBillingType.PLAN
             else MembershipSubscription)
    rows = (Model.query
            .filter_by(tenant_id=doctor.tenant_id,
                       provider_type=MembershipVertical.DOCTOR,
                       provider_id=doctor.id, is_deleted=False)
            .filter(Model.status.in_(live)).all())
    for s in rows:
        s.status = MembershipSubscriptionStatus.CANCELLED
        if hasattr(s, 'cancelled_at'):
            s.cancelled_at = utcnow()
        logger.info('[BILLING] doctor=%s → %s: cancelled conflicting %s %s',
                    doctor.id, new_type.value, Model.__name__, s.id)


def convert_doctor(doctor, billing_type_str, agreement_data, actor_id=None):
    """Set the doctor's billing type; create/deactivate the employment agreement.

    The three billing types are MUTUALLY EXCLUSIVE — switching type cancels the
    live subscription from the type being left, so a doctor is never both
    plan-based and employed at once."""
    from app.models import DoctorBillingType, DoctorEmploymentAgreement

    try:
        bt = DoctorBillingType(billing_type_str)
    except ValueError:
        raise ValueError('Invalid billing type')

    profile = get_or_create_billing_profile(doctor)
    prev = profile.billing_type
    profile.billing_type = bt
    if prev != bt:
        _cancel_conflicting_engagements(doctor, bt)

    if bt == DoctorBillingType.PLAN:
        # Revert to plan — deactivate any active agreement.
        DoctorEmploymentAgreement.query.filter_by(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id, is_active=True,
        ).update({'is_active': False}, synchronize_session=False)
        profile.active_agreement_id = None
    else:
        agr = DoctorEmploymentAgreement(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id, billing_type=bt,
            created_by_id=actor_id, updated_by_id=actor_id,
        )
        _apply_agreement_fields(agr, agreement_data or {})
        db.session.add(agr)
        db.session.flush()
        DoctorEmploymentAgreement.query.filter(
            DoctorEmploymentAgreement.tenant_id == doctor.tenant_id,
            DoctorEmploymentAgreement.doctor_id == doctor.id,
            DoctorEmploymentAgreement.id != agr.id,
            DoctorEmploymentAgreement.is_active.is_(True),
        ).update({'is_active': False}, synchronize_session=False)
        profile.active_agreement_id = agr.id

    db.session.commit()
    return profile


def update_agreement(doctor, data, actor_id=None):
    agr = get_active_agreement(doctor)
    if not agr:
        raise ValueError('No active agreement to update')
    _apply_agreement_fields(agr, data)
    agr.updated_by_id = actor_id
    db.session.commit()
    return agr


def generate_salary_payout(doctor, period_start, period_end, kind='salary'):
    """Create a salary/retainer SalaryPayout for a pay period (admin then settles).

    Item 2C — amount = per-doctor override (DoctorBillingProfile) → plan default
    (TenantProviderPlan employment terms) → legacy DoctorEmploymentAgreement.
    Fee deduction comes from the plan's salary_deduction when the fee mode is
    'plan', or the legacy agreement's custom value.
    """
    from decimal import Decimal
    from app.models import (
        SalaryPayout, PayoutStatus, DoctorBillingProfile, DoctorBillingType,
    )

    if kind not in ('salary', 'retainer'):
        raise ValueError("kind must be 'salary' or 'retainer'")

    plan = resolve_active_plan(doctor)
    terms = plan.billing_terms()['employment'] if plan else None
    profile = DoctorBillingProfile.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
    ).first()
    agr = get_active_agreement(doctor)  # legacy fallback

    # Salary belongs to EMPLOYEE, retainer to CONSULTANT. Without this the only
    # gate is "is an amount configured anywhere", so a PLAN doctor — who already
    # earns a per-patient DoctorPayout for every appointment — could also be
    # issued a salary/retainer the moment a plan default or override existed,
    # paying them twice for the same work. EMPLOYEE is excluded from per-patient
    # payouts precisely because salary replaces them; CONSULTANT keeps both, but
    # its second rail is the retainer, not a salary.
    expected = (DoctorBillingType.CONSULTANT if kind == 'retainer'
                else DoctorBillingType.EMPLOYEE)
    actual = profile.billing_type if profile else DoctorBillingType.PLAN
    if actual != expected:
        raise ValueError(
            f"A {kind} payout is only valid for a {expected.value} doctor — "
            f"this one is billed as '{actual.value}'. Convert the doctor's "
            f"billing type first, or use the "
            f"{'salary' if kind == 'retainer' else 'retainer'} kind."
        )

    if kind == 'retainer':
        override = profile.retainer_override if profile else None
        plan_default = terms['default_base_retainer'] if terms else None
        legacy = agr.base_retainer_amount if agr else None
    else:
        override = profile.salary_override if profile else None
        plan_default = terms['default_monthly_salary'] if terms else None
        legacy = agr.monthly_salary if agr else None

    gross_val = override if override is not None else (
        plan_default if plan_default is not None else legacy)
    if gross_val is None:
        raise ValueError(
            'No salary/retainer configured — assign the doctor a plan with a '
            'default amount, or set a per-doctor amount.')
    gross = Decimal(str(gross_val or 0))

    # Deduction: plan fee mode → plan salary_deduction; legacy custom → agreement %.
    deductions = Decimal('0')
    fee_mode = (terms['platform_fee_mode'] if terms else None) \
        or (agr.platform_fee_mode.value if agr and agr.platform_fee_mode else 'zero')
    if fee_mode == 'plan' and plan:
        sd = plan.billing_terms()['salary_deduction']
        if sd['mode'] == 'percentage':
            deductions = (gross * Decimal(str(sd['value'])) / Decimal('100')).quantize(Decimal('0.01'))
        elif sd['mode'] == 'flat':
            deductions = Decimal(str(sd['value'])).quantize(Decimal('0.01'))
    elif fee_mode == 'custom' and agr and agr.platform_fee_value:
        deductions = (gross * Decimal(str(agr.platform_fee_value)) / Decimal('100')).quantize(Decimal('0.01'))
    net = gross - deductions

    dup = SalaryPayout.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
        period_start=period_start, period_end=period_end, kind=kind,
    ).first()
    if dup:
        raise ValueError('A salary payout already exists for this period')

    from app.models import ProfileBankAccount
    bank = ProfileBankAccount.query.filter_by(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id, order_index=0,
    ).first()

    sp = SalaryPayout(
        tenant_id=doctor.tenant_id, doctor_id=doctor.id,
        agreement_id=agr.id if agr else None,
        period_start=period_start, period_end=period_end, kind=kind,
        gross_salary=gross, deductions=deductions, net_amount=net,
        status=PayoutStatus.PENDING,
        # Pin the destination now rather than resolving it at transfer time, so
        # swapping the primary account mid-flight can't silently redirect money.
        bank_account_id=bank.id if bank else None,
    )
    db.session.add(sp)
    # Same T-day hold + mode snapshot the per-patient rail gets, so salary flows
    # through the one ON_HOLD → push → CLAIMABLE → claim machine.
    apply_hold(sp, doctor, profile=profile)
    db.session.commit()
    return sp
