"""Second-opinion credit commission for family doctors.

When an empanelled patient's booking COMPLETES (consultation / service /
group), their family doctor earns health credits as a second-opinion
commission. The rate is the doctor's plan CreditPolicy.second_opinion_grant,
overridable per-doctor on DoctorBillingProfile.second_opinion_rate_override.
Awards are idempotent per (ref_type, ref_id) and never awarded to the doctor
who actually provided the booking.
"""
import logging

from app.extensions import db
from app.api.membership import credit_service

logger = logging.getLogger(__name__)

_REF_TYPE = 'second_opinion'


def _doctor_plan_policy(tenant_id, doctor):
    """The active-plan CreditPolicy for a doctor, or None."""
    from app.models import (
        MembershipSubscription, MembershipVertical,
        MembershipSubscriptionStatus, CreditPolicy,
    )
    sub = (MembershipSubscription.query
           .filter(MembershipSubscription.tenant_id == tenant_id,
                   MembershipSubscription.provider_type == MembershipVertical.DOCTOR,
                   MembershipSubscription.provider_id == doctor.id,
                   MembershipSubscription.is_deleted.is_(False),
                   MembershipSubscription.status.in_([
                       MembershipSubscriptionStatus.ACTIVE,
                       MembershipSubscriptionStatus.TRIAL,
                   ]))
           .order_by(MembershipSubscription.created_at.desc())
           .first())
    if not sub or not sub.membership_plan_id:
        return None
    return CreditPolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=sub.membership_plan_id,
    ).first()


# Source-table ref_type → per-type rate key.
_KIND_BY_REF = {'appointment': 'consultation', 'order': 'service', 'group_booking': 'group'}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def resolve_rate(tenant_id, doctor, kind=None, amount=0):
    """Credits granted for a completed booking of ``kind`` (consultation /
    service / group) with price ``amount``.

    The grant may be a FLAT number of credits and/or a PERCENTAGE of the
    booking price (1 credit = ₹1). When both apply, the doctor earns the MIN
    of the two. A per-doctor flat override (DoctorBillingProfile) beats the
    plan. Precedence for each of flat / pct: per-type → plan default.
    """
    from app.models import DoctorBillingProfile
    amount = float(amount or 0)

    # Per-doctor flat override wins outright (a fixed per-doctor arrangement).
    bp = DoctorBillingProfile.query.filter_by(
        tenant_id=tenant_id, doctor_id=doctor.id).first()
    if bp is not None and bp.second_opinion_rate_override is not None:
        return float(bp.second_opinion_rate_override)

    policy = _doctor_plan_policy(tenant_id, doctor)
    if policy is None:
        return 0.0

    # Flat credits: per-type → default.
    flat = None
    per_type = policy.second_opinion_grants or {}
    if kind and _num(per_type.get(kind)) is not None:
        flat = _num(per_type.get(kind))
    elif _num(policy.second_opinion_grant) is not None:
        flat = _num(policy.second_opinion_grant)

    # Percentage of price → credits: per-type → default.
    pct = None
    per_type_pct = policy.second_opinion_pcts or {}
    if kind and _num(per_type_pct.get(kind)) is not None:
        pct = _num(per_type_pct.get(kind))
    elif _num(policy.second_opinion_pct) is not None:
        pct = _num(policy.second_opinion_pct)
    pct_credits = (amount * pct / 100.0) if (pct and pct > 0) else None

    flat_credits = flat if (flat and flat > 0) else None
    candidates = [c for c in (flat_credits, pct_credits) if c is not None]
    if not candidates:
        return 0.0
    return min(candidates)


def resolve_threshold(tenant_id, doctor):
    """Minimum credits before this doctor may redeem to cash (plan, else 0)."""
    policy = _doctor_plan_policy(tenant_id, doctor)
    if policy is not None:
        return float(policy.second_opinion_redeem_threshold or 0)
    return 0.0


def award_for_booking(tenant_id, patient_id, provider_doctor_id, ref_type, ref_id,
                      label=None, amount=0):
    """Grant the patient's family doctor their second-opinion credits for a
    completed booking. No-op (and never raises) when there's no family doctor,
    the family doctor provided the booking, the rate is 0, or it was already
    awarded. ``ref_type``/``ref_id`` identify the source booking."""
    try:
        from app.models import (
            FamilyDoctorLink, Doctor, HealthCreditLedger,
        )
        if not patient_id:
            return None
        link = FamilyDoctorLink.query.filter_by(
            tenant_id=tenant_id, patient_id=patient_id, is_active=True,
        ).first()
        if not link:
            # A minor has no family doctor of their own — they INHERIT the
            # guardian's. A minor's bookings are created under the minor's OWN
            # (linked) patient id, so when that id has no link, resolve up to the
            # owning patient and credit THEIR family doctor for the child's
            # booking (the "second opinion doctor for minors" is the parent's).
            from app.models import HouseGroupMember
            member = HouseGroupMember.query.filter_by(
                tenant_id=tenant_id, linked_patient_id=patient_id,
                is_child_account=True, is_active=True,
            ).first()
            if member:
                link = FamilyDoctorLink.query.filter_by(
                    tenant_id=tenant_id, patient_id=member.patient_id, is_active=True,
                ).first()
        if not link:
            return None
        # No second-opinion commission when the family doctor is the one who
        # actually served the booking.
        if provider_doctor_id and str(link.doctor_id) == str(provider_doctor_id):
            return None

        # Idempotency — one award per source booking.
        already = HealthCreditLedger.query.filter_by(
            tenant_id=tenant_id, ref_type=_REF_TYPE, ref_id=ref_id,
        ).first()
        if already:
            return None

        doctor = Doctor.query.filter_by(
            id=link.doctor_id, is_deleted=False).first()
        if not doctor:
            return None
        rate = resolve_rate(tenant_id, doctor, _KIND_BY_REF.get(ref_type), amount)
        if rate <= 0:
            return None

        note = label or f'Second opinion — {ref_type}'
        wallet = credit_service.manual_grant(
            tenant_id, doctor.user_id, rate, note=note,
            ref_type=_REF_TYPE, ref_id=ref_id,
        )
        db.session.flush()
        logger.info('[SECOND_OPINION] granted %s credits to doctor=%s for %s=%s',
                    rate, doctor.id, ref_type, ref_id)
        return wallet
    except Exception:  # noqa: BLE001 — a credit-award failure must never break
        logger.exception('[SECOND_OPINION] award failed for %s=%s', ref_type, ref_id)
        return None
