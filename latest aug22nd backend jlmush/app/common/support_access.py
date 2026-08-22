"""When may the SaaS vendor skip a tenant-scoped authorization gate?

``PLATFORM_OWNER`` used to pass every gate in ``app.common.decorators``
unconditionally. That made the role a master key: resolve into any
customer tenant and read anything, with nothing recording that it
happened. This module replaces the blanket answer with a narrow one.

Two legitimate cases:

1. **The resolved tenant IS the vendor's own row** (``is_platform``).
   Nothing to protect -- the vendor is operating its own control plane,
   and tenant scoping pins every query to vendor-owned data anyway. This
   is the case that keeps ``/api/platform/*`` working.

2. **An active** :class:`~app.models.support_session.SupportSession`
   **covers the resolved tenant.** A deliberate, time-boxed, reason-coded
   grant, recorded and self-expiring.

Anything else is a customer's data and gets the same 403 as any other
user who does not belong there.

Fail-closed by construction: every branch that cannot positively
establish one of the two cases returns False.
"""
import logging

logger = logging.getLogger(__name__)


def _resolved_tenant_id():
    """The tenant this request landed on, or None."""
    from app.common.tenant_context import current_tenant_id
    try:
        return current_tenant_id()
    except Exception:  # noqa: BLE001
        return None


def is_vendor_tenant(tenant_id) -> bool:
    from app.models import Tenant
    if not tenant_id:
        return False
    try:
        t = Tenant.query.get(tenant_id)
    except Exception:  # noqa: BLE001
        return False
    return bool(t and getattr(t, 'is_platform', False))


def active_support_session(user_id=None, tenant_id=None):
    """The live grant covering (user, tenant), or None."""
    from app.models.support_session import SupportSession
    from flask_jwt_extended import current_user

    if user_id is None:
        user_id = getattr(current_user, 'id', None)
    if tenant_id is None:
        tenant_id = _resolved_tenant_id()
    if not user_id or not tenant_id:
        return None
    try:
        return SupportSession.active_for(user_id, tenant_id)
    except Exception:  # noqa: BLE001
        # A lookup failure must not silently grant access.
        logger.exception('[SUPPORT] session lookup failed — denying')
        return None


def platform_owner_may_bypass(*, mark_used=True) -> bool:
    """True when the current PLATFORM_OWNER may skip a tenant-scoped gate.

    ``mark_used`` records that a support grant was actually exercised, so
    an opened-but-unused session stays distinguishable from one that read
    real data. Pass False from anywhere that is only *asking* rather than
    letting a request through.
    """
    from app.models import UserRole
    from flask_jwt_extended import current_user

    if not current_user or current_user.role != UserRole.PLATFORM_OWNER:
        return False

    tenant_id = _resolved_tenant_id()

    # Case 1 — the vendor's own tenant.
    if is_vendor_tenant(tenant_id):
        return True

    # Case 2 — an explicit, live grant for this customer tenant.
    session = active_support_session(
        user_id=getattr(current_user, 'id', None), tenant_id=tenant_id,
    )
    if session is None:
        logger.info(
            '[SUPPORT] PLATFORM_OWNER %s denied on tenant %s — no active '
            'support session', getattr(current_user, 'id', None), tenant_id,
        )
        return False

    if mark_used:
        try:
            from app.extensions import db
            session.touch()
            db.session.commit()
        except Exception:  # noqa: BLE001
            # Never fail the request because bookkeeping failed; the grant
            # itself is still valid and already recorded.
            logger.warning('[SUPPORT] could not record session use', exc_info=True)
            try:
                from app.extensions import db as _db
                _db.session.rollback()
            except Exception:  # noqa: BLE001
                pass

    return True
