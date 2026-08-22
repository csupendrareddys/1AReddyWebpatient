"""Outbox delivery engine — enqueue, immediate attempt, sweep, backoff.

Three entry points:

* :func:`enqueue` — add a row to the CALLER's transaction (used inside
  flows that already commit, e.g. ``push_notification`` writing its
  Notification row: one commit covers both, so a crash can never persist
  the business change without its outbound side-effect or vice versa).
  The post-commit immediate attempt is wired via SQLAlchemy's
  ``after_commit`` event — never fired for rolled-back work.
* :func:`enqueue_now` — independent single-row INSERT on its own
  connection + immediate attempt. For best-effort call sites that run
  OUTSIDE any transaction of their own (``_send_safe``/``_notify_safe``
  style). Deliberately does NOT touch ``db.session`` — committing the
  caller's half-done session state from inside a notification helper
  would be a data-integrity landmine.
* :func:`run_outbox_sweep` — the APScheduler job: claims due rows and
  delivers them with exponential backoff; recovers rows stuck in
  'sending' after a crash; dead-letters on max attempts or expiry.

Delivery reconstructs the tenant's runtime context: ``g.tenant_id`` is
set (rail selection and company-name resolution read it — RLS's
``with_tenant_context`` alone is NOT enough) plus the RLS session var
for tenant-scoped reads.

Immediate attempts run on a daemon thread — under the production
eventlet worker ``threading`` is monkey-patched so this is a green
thread; locally/tests it's a real thread. In TESTING the immediate
attempt is disabled (rows deliver via explicit sweep calls only) so
background threads never race pytest's transaction fixtures.
"""
import logging
import threading
import uuid as _uuid
from datetime import timedelta

from flask import current_app, g
from sqlalchemy import event

from app.extensions import db
from app.models._base import utcnow

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 6
# Backoff: 1m, 4m, 16m, ~1h, then capped at 3h between tries.
BACKOFF_BASE_SECONDS = 60
BACKOFF_CAP_SECONDS = 3 * 60 * 60
# A row stuck in 'sending' longer than this was claimed by a process
# that died mid-delivery — the sweep reclaims it.
STUCK_SENDING_MINUTES = 10
SWEEP_BATCH = 50

# Purposes whose message stops being useful after a TTL (OTP-carrying
# emails). Delivering a reset code an hour late is worse than useless.
_PURPOSE_TTL_SECONDS = {
    'reset_pw_email': 600,
    'verify_email_otp': 600,
}


def _backoff_delay(attempts: int) -> int:
    return min(BACKOFF_BASE_SECONDS * (4 ** max(attempts - 1, 0)),
               BACKOFF_CAP_SECONDS)


def _expires_at_for(purpose):
    ttl = _PURPOSE_TTL_SECONDS.get(purpose)
    return (utcnow() + timedelta(seconds=ttl)) if ttl else None


# ── Enqueue ─────────────────────────────────────────────────────────────


def enqueue(*, tenant_id, channel, recipient, purpose, payload):
    """Join the CALLER's transaction; delivery kicks after ITS commit.

    Returns the row id. The caller owns the commit — if it rolls back,
    the row (and the kick) evaporate with it, which is the point.
    """
    from app.models import OutboundMessage

    row = OutboundMessage(
        id=_uuid.uuid4(),
        tenant_id=tenant_id,
        channel=channel,
        recipient=str(recipient),
        purpose=purpose,
        payload=payload or {},
        expires_at=_expires_at_for(purpose),
    )
    db.session.add(row)
    # after_commit (below) reads this list; session.info survives until
    # the transaction ends and is cleared on rollback with it.
    db.session.info.setdefault('outbox_kick', []).append(row.id)
    return row.id


@event.listens_for(db.session, 'after_commit')
def _kick_after_commit(session):
    ids = session.info.pop('outbox_kick', None)
    if not ids:
        return
    try:
        app = current_app._get_current_object()
    except RuntimeError:  # no app context — sweep will pick the rows up
        return
    if app.config.get('TESTING'):
        return
    for row_id in ids:
        _spawn_attempt(app, row_id)


def enqueue_now(*, tenant_id, channel, recipient, purpose, payload):
    """Independent INSERT on its own connection + immediate attempt.

    Never touches ``db.session`` — safe to call from any code path
    regardless of what the caller's session has in flight. Returns the
    row id, or None if even the INSERT failed (logged; the send is lost
    exactly like the old fire-and-forget behavior, but this is a
    database-down situation where far worse is already happening).
    """
    from app.models import OutboundMessage

    row_id = _uuid.uuid4()
    try:
        with db.engine.begin() as conn:
            conn.execute(OutboundMessage.__table__.insert().values(
                id=row_id,
                tenant_id=tenant_id,
                channel=channel,
                recipient=str(recipient),
                purpose=purpose,
                payload=payload or {},
                status='pending',
                attempts=0,
                next_attempt_at=utcnow(),
                expires_at=_expires_at_for(purpose),
                created_at=utcnow(),
                updated_at=utcnow(),
            ))
    except Exception:  # noqa: BLE001 — notification loss, not request loss
        logger.exception('[OUTBOX] enqueue_now failed (%s:%s to %s)',
                         channel, purpose, recipient)
        return None
    try:
        app = current_app._get_current_object()
        if not app.config.get('TESTING'):
            _spawn_attempt(app, row_id)
    except RuntimeError:
        pass  # no app context (scripts) — the sweep delivers it
    return row_id


def _spawn_attempt(app, row_id):
    """Fire-and-forget delivery attempt. Green thread under eventlet."""
    def _run():
        try:
            with app.app_context():
                try:
                    deliver_one(row_id)
                finally:
                    db.session.remove()
        except Exception:  # noqa: BLE001 — the sweep retries; never crash
            logger.exception('[OUTBOX] immediate attempt crashed id=%s',
                             row_id)
    threading.Thread(target=_run, daemon=True,
                     name=f'outbox-{str(row_id)[:8]}').start()


# ── Delivery ────────────────────────────────────────────────────────────


def _claim(row_id):
    """Atomically move pending/failed → sending. False = lost the race
    (another deliverer owns it) or terminal state."""
    from app.models import OutboundMessage

    now = utcnow()
    claimed = (
        db.session.query(OutboundMessage)
        .filter(OutboundMessage.id == row_id,
                OutboundMessage.status.in_(('pending', 'failed')),
                OutboundMessage.next_attempt_at <= now)
        .update({'status': 'sending', 'updated_at': now},
                synchronize_session=False)
    )
    db.session.commit()
    return bool(claimed)


def _dispatch(row):
    """Do the provider call for one claimed row. Raises on failure.

    Runs inside an app context with g.tenant_id + the RLS var set, so
    template rails, company-name resolution and tenant-scoped reads all
    behave exactly as they would in-request.
    """
    payload = row.payload or {}
    if row.channel == 'sms':
        from app.services.sms_service import SMSService
        SMSService.send_sms(row.recipient, row.purpose,
                            **(payload.get('variables') or {}))
    elif row.channel == 'email':
        from app.services.email_service import EmailService
        EmailService.send_email(
            row.recipient, row.purpose,
            recipient_name=payload.get('recipient_name'),
            **(payload.get('variables') or {}))
    elif row.channel == 'push':
        from app.common.notify import send_device_push
        # send_device_push never raises and resolves tokens itself; a
        # user with zero devices still counts as delivered (the in-app
        # Notification row is the durable copy — this is only the buzz).
        send_device_push(
            tenant_id=str(row.tenant_id),
            user_id=payload.get('user_id') or row.recipient,
            title=payload.get('title') or row.purpose,
            body=payload.get('body'),
            data=payload.get('data'),
        )
    else:
        raise ValueError(f'unknown outbox channel {row.channel!r}')


def deliver_one(row_id):
    """Claim + deliver + record the outcome for one row.

    Returns 'sent' | 'failed' | 'dead' | 'skipped' (lost claim/missing).
    """
    from app.models import OutboundMessage

    if not _claim(row_id):
        return 'skipped'
    row = OutboundMessage.query.get(row_id)
    if row is None:  # claimed then vanished — tenant hard-delete cascade
        return 'skipped'

    now = utcnow()
    if row.expires_at and row.expires_at <= now:
        row.status = 'dead'
        row.last_error = 'expired before delivery'
        db.session.commit()
        logger.warning('[OUTBOX] expired id=%s %s:%s', row.id,
                       row.channel, row.purpose)
        return 'dead'

    row.attempts = (row.attempts or 0) + 1
    try:
        g.tenant_id = str(row.tenant_id)
        from app.common.tenant_context import with_tenant_context
        with with_tenant_context(str(row.tenant_id)):
            _dispatch(row)
        row.status = 'sent'
        row.sent_at = utcnow()
        row.last_error = None
        db.session.commit()
        logger.info('[OUTBOX] sent id=%s %s:%s to=%s attempt=%s',
                    row.id, row.channel, row.purpose, row.recipient,
                    row.attempts)
        return 'sent'
    except Exception as exc:  # noqa: BLE001 — every failure becomes data
        db.session.rollback()
        # Re-load post-rollback and record the failure in a clean tx.
        row = OutboundMessage.query.get(row_id)
        if row is None:
            return 'skipped'
        row.attempts = (row.attempts or 0) + 1
        row.last_error = str(exc)[:1000]
        if row.attempts >= MAX_ATTEMPTS:
            row.status = 'dead'
            logger.error('[OUTBOX] DEAD id=%s %s:%s after %s attempts: %s',
                         row.id, row.channel, row.purpose, row.attempts,
                         row.last_error)
        else:
            row.status = 'failed'
            row.next_attempt_at = utcnow() + timedelta(
                seconds=_backoff_delay(row.attempts))
            logger.warning('[OUTBOX] failed id=%s %s:%s attempt=%s '
                           'retry_at=%s: %s', row.id, row.channel,
                           row.purpose, row.attempts, row.next_attempt_at,
                           row.last_error)
        db.session.commit()
        return row.status
    finally:
        g.pop('tenant_id', None)


# ── The scheduler sweep ────────────────────────────────────────────────


def sweep(limit=SWEEP_BATCH):
    """Deliver every due row; reclaim stuck 'sending' rows. Returns
    counts for the log line."""
    from app.models import OutboundMessage

    now = utcnow()
    # Crash recovery: a row 'sending' for >10min was claimed by a dead
    # process — put it back in play (its attempt was already counted or
    # not; either way the claim gate makes redelivery safe to retry).
    (db.session.query(OutboundMessage)
     .filter(OutboundMessage.status == 'sending',
             OutboundMessage.updated_at
             <= now - timedelta(minutes=STUCK_SENDING_MINUTES))
     .update({'status': 'failed', 'next_attempt_at': now},
             synchronize_session=False))
    db.session.commit()

    due = (OutboundMessage.query
           .filter(OutboundMessage.status.in_(('pending', 'failed')),
                   OutboundMessage.next_attempt_at <= now)
           .order_by(OutboundMessage.next_attempt_at.asc())
           .limit(limit)
           .all())
    counts = {'sent': 0, 'failed': 0, 'dead': 0, 'skipped': 0}
    for row in due:
        outcome = deliver_one(row.id)
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def run_outbox_sweep(app):
    """APScheduler entry point — house pattern: own app context, per-run
    redis mutex, broad except so a bad sweep never kills the scheduler."""
    with app.app_context():
        redis = None
        try:
            from app.extensions import get_redis_client
            redis = get_redis_client()
            if redis is not None and not redis.set(
                    'job:outbox_sweep:lock', '1', nx=True, ex=120):
                return
        except Exception:  # noqa: BLE001 — no redis, run anyway
            redis = None
        try:
            counts = sweep()
            if any(counts.values()):
                logger.info('[SCHED] outbox sweep: %s', counts)
        except Exception:  # noqa: BLE001
            logger.exception('[SCHED] outbox sweep failed')
        finally:
            try:
                if redis is not None:
                    redis.delete('job:outbox_sweep:lock')
            except Exception:  # noqa: BLE001
                pass
            db.session.remove()
