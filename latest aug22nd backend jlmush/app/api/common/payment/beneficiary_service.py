"""Cashfree payout beneficiary lifecycle for a doctor's bank account.

Flow (per the product spec):
    1. register the beneficiary in Cashfree
    2. penny-drop ₹1 to the doctor's account
    3. the doctor confirms they received it  → account VERIFIED
    4. reuse the beneficiary for every payout; remove on bank change / offboard

Every function requires ``cashfree_payout.is_configured()``. Callers check first
and fall back to the existing manual verification / manual settle when Cashfree
isn't configured, so a no-cred deploy behaves exactly like today.
"""
import logging
import secrets
from decimal import Decimal
from datetime import datetime, timezone

from app.extensions import db
from app.api.common.payment import cashfree_payout as cf
from app.models import DocumentVerificationStatus

logger = logging.getLogger(__name__)

PENNY_DROP_AMOUNT = Decimal('1.00')


def _bene_id(bank_account):
    # Cashfree beneficiary_id: alphanumeric + underscore, deterministic per account.
    return f"doc_{bank_account.id.hex}"


def register_and_penny_drop(bank_account, *, name=None, phone=None, email=None):
    """Register the beneficiary (idempotent) and send a ₹1 penny drop. Sets
    beneficiary_status='penny_sent'. The doctor then confirms receipt."""
    if not (bank_account.account_number and bank_account.ifsc_code):
        raise ValueError('Bank account number and IFSC are required first')

    bene_id = _bene_id(bank_account)
    name = name or bank_account.account_name or 'Doctor'

    try:
        cf.create_beneficiary(
            beneficiary_id=bene_id, name=name,
            account_number=bank_account.account_number, ifsc=bank_account.ifsc_code,
            phone=phone, email=email,
        )
    except cf.CashfreePayoutError as e:
        # Already registered is fine — reuse it.
        if e.status not in (409,) and 'exist' not in str(e).lower():
            raise
    bank_account.cashfree_beneficiary_id = bene_id
    bank_account.beneficiary_status = 'registered'

    ref = f"pd{secrets.token_hex(10)}"
    resp = cf.standard_transfer(
        transfer_id=ref, amount=PENNY_DROP_AMOUNT, beneficiary_id=bene_id,
        remarks='Account verification',
    )
    bank_account.penny_drop_ref = ref
    bank_account.penny_drop_amount = PENNY_DROP_AMOUNT
    bank_account.beneficiary_status = 'penny_sent'
    db.session.commit()
    logger.info('[CASHFREE] penny-drop sent bank=%s ref=%s', bank_account.id, ref)
    return {'beneficiary_id': bene_id, 'penny_drop_ref': ref, 'transfer': resp}


def confirm_penny_drop(bank_account):
    """The doctor confirms they received the ₹1 → account VERIFIED."""
    if bank_account.beneficiary_status != 'penny_sent' or not bank_account.penny_drop_ref:
        raise ValueError('No penny drop is awaiting confirmation for this account')
    bank_account.beneficiary_status = 'verified'
    bank_account.doctor_confirmed_at = datetime.now(timezone.utc)
    bank_account.verification_status = DocumentVerificationStatus.VERIFIED
    db.session.commit()
    logger.info('[CASHFREE] penny-drop confirmed → verified bank=%s', bank_account.id)
    return bank_account


def remove_beneficiary(bank_account):
    """Remove the Cashfree beneficiary (bank change / offboarding) and clear the
    verification. Safe to call when nothing is registered."""
    bene_id = bank_account.cashfree_beneficiary_id
    if bene_id and cf.is_configured():
        try:
            cf.remove_beneficiary(bene_id)
        except cf.CashfreePayoutError as e:
            logger.warning('[CASHFREE] remove_beneficiary failed bank=%s: %s', bank_account.id, e)
    bank_account.cashfree_beneficiary_id = None
    bank_account.beneficiary_status = 'removed'
    bank_account.penny_drop_ref = None
    bank_account.doctor_confirmed_at = None
    if bank_account.verification_status == DocumentVerificationStatus.VERIFIED:
        bank_account.verification_status = DocumentVerificationStatus.PENDING
    return bank_account


def is_beneficiary_verified(bank_account):
    return bool(
        bank_account
        and bank_account.cashfree_beneficiary_id
        and bank_account.beneficiary_status == 'verified'
    )


def in_flight_payouts(bank_account):
    """Payouts against this account that are still moving (PENDING/PROCESSING).

    Suspending, editing or deleting the account underneath one of these would
    yank the destination while money is in flight and break reconciliation, so
    callers refuse the operation while this is non-zero.

    Counts BOTH rails: a salary transfer is just as real as a per-patient one,
    and counting only ``DoctorPayout`` meant an in-flight salary could not
    protect the account it was being paid into.
    """
    from app.models import DoctorPayout, SalaryPayout, PayoutStatus
    if not bank_account:
        return 0
    moving = [PayoutStatus.PENDING, PayoutStatus.PROCESSING]
    total = 0
    for model in (DoctorPayout, SalaryPayout):
        total += model.query.filter(
            model.tenant_id == bank_account.tenant_id,
            model.bank_account_id == bank_account.id,
            model.status.in_(moving),
        ).count()
    return total


def unlink_payouts(bank_account):
    """Clear the bank link on this account's settled payouts so the row can be
    deleted. ``DoctorPayout.bank_account_id`` has no ON DELETE rule, so a
    referencing payout would otherwise block the delete with an FK violation.
    The payout keeps its bill number, amounts and transfer id for audit.
    """
    from app.models import DoctorPayout
    return DoctorPayout.query.filter_by(
        tenant_id=bank_account.tenant_id, bank_account_id=bank_account.id,
    ).update({'bank_account_id': None}, synchronize_session=False)


def disburse_to_bank(bank_account, *, amount, transfer_id, remarks=None):
    """Send a real payout to a VERIFIED beneficiary. Returns the Cashfree
    response (async — final state arrives via webhook). Raises ValueError if the
    beneficiary isn't verified."""
    if not is_beneficiary_verified(bank_account):
        raise ValueError('Doctor bank account is not a verified Cashfree beneficiary')
    return cf.standard_transfer(
        transfer_id=transfer_id, amount=amount,
        beneficiary_id=bank_account.cashfree_beneficiary_id, remarks=remarks,
    )
