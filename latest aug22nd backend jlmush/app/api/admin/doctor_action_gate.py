"""Gate a doctor-initiated action on the approval-matrix action mode.

Used for the 3-way gated actions ``appointment_cancel`` / ``payments`` (payout
claim). ``appointment_reschedule`` shares the plumbing but the app has no
reschedule action to hold yet.

  * ``auto_accept`` → apply immediately (call ``apply_fn``)
  * ``auto_reject`` → deny outright (no state change)
  * ``manual``      → HOLD: write a PendingDoctorAction and DON'T apply; an admin
                      approves (executes it) or rejects it from the queue.

Keeping the "apply" logic behind an executor keyed by ``kind`` means the admin
approve path re-runs the exact same effect the doctor's action would have had.
"""
from datetime import datetime, timezone

from app.extensions import db
from app.models import PendingDoctorAction
from app.models.pending_doctor_action import PENDING, APPROVED, REJECTED
from app.api.admin.approval_policy_service import effective_action_mode


def gate_action(doctor, kind, *, ref_type=None, ref_id=None, payload=None,
                label=None, requested_by_id=None):
    """Resolve the gate for a doctor action.

    Returns ``(outcome, obj)`` where outcome is:
      * ``'auto'``   — the caller should proceed and apply the action now.
      * ``'reject'`` — obj is a user-facing denial message.
      * ``'held'``   — obj is the created PendingDoctorAction (already committed).
    """
    mode = effective_action_mode(doctor, kind)
    if mode == 'auto_reject':
        return 'reject', 'This action is not permitted (auto-rejected by the approval policy).'
    if mode == 'manual':
        row = PendingDoctorAction(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id, kind=kind,
            ref_type=ref_type, ref_id=ref_id, payload=payload or {}, label=label,
            status=PENDING, requested_by_id=requested_by_id)
        db.session.add(row)
        db.session.commit()
        return 'held', row
    return 'auto', None


# ── admin approve / reject ────────────────────────────────────────────────────

def _execute(row):
    """Run the held action's effect. Raises on failure so the caller can report."""
    from app.models import Doctor
    doctor = Doctor.query.get(row.doctor_id)
    user_id = doctor.user_id if doctor else None

    if row.kind == 'appointment_cancel':
        from app.api.common.appointment.service import AppointmentService
        AppointmentService.cancel(row.ref_id, user_id)
        return 'Appointment cancelled.'

    if row.kind == 'payments':
        from app.models import DoctorPayout, PayoutStatus
        from app.api.common.payment.billing_service import disburse_payout
        payout = DoctorPayout.query.filter_by(
            tenant_id=row.tenant_id, id=row.ref_id).first()
        if not payout or payout.status != PayoutStatus.CLAIMABLE:
            raise ValueError('Payout is no longer claimable.')
        payout.claim_requested_at = datetime.now(timezone.utc)
        payout.claimed_by_id = (row.payload or {}).get('claimed_by_id') or row.requested_by_id
        db.session.flush()
        ok, msg = disburse_payout(payout)
        if not ok:
            raise ValueError(msg)
        return msg

    if row.kind == 'appointment_reschedule':
        # No reschedule action implemented in the app yet — approving is a no-op
        # beyond clearing the request.
        return 'Reschedule approved (no-op — reschedule not implemented).'

    raise ValueError(f'Unknown held action kind: {row.kind}')


def approve_pending_action(action_id, reviewer_id, comment=None):
    """Execute a held action and mark it APPROVED. Returns (row, message) or
    (None, error)."""
    from app.common.tenant_context import current_tenant_id_strict
    row = PendingDoctorAction.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=action_id).first()
    if not row or row.status != PENDING:
        return None, 'No pending action found'
    try:
        message = _execute(row)
    except Exception as exc:  # noqa: BLE001 — surface the failure, don't 500
        db.session.rollback()
        return None, f'Could not apply the action: {exc}'
    row.status = APPROVED
    row.reviewed_by_id = reviewer_id
    row.reviewed_at = datetime.now(timezone.utc)
    row.review_comment = comment
    db.session.commit()
    return row, message


def reject_pending_action(action_id, reviewer_id, comment=None):
    """Discard a held action, marking it REJECTED (the doctor's action never
    takes effect)."""
    from app.common.tenant_context import current_tenant_id_strict
    row = PendingDoctorAction.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=action_id).first()
    if not row or row.status != PENDING:
        return None
    row.status = REJECTED
    row.reviewed_by_id = reviewer_id
    row.reviewed_at = datetime.now(timezone.utc)
    row.review_comment = comment
    db.session.commit()
    return row
