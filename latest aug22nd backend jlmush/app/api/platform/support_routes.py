"""Vendor-side support access: open, list and revoke tenant grants.

Control-plane routes, so they live on ``platform_bp`` and are
PLATFORM_OWNER-only. What they grant is the *other* thing --
:class:`~app.models.support_session.SupportSession` is what
``app.common.support_access`` consults before letting the vendor past a
tenant-scoped gate.

  POST   /api/platform/support-sessions              open (reason required)
  GET    /api/platform/support-sessions              list (?tenant_id, ?active)
  DELETE /api/platform/support-sessions/<id>         revoke

A grant is not silent: the row records who, which tenant, why, when it
expires, and whether it was ever actually used.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.platform import platform_bp
from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.extensions import db
from app.models import UserRole, Tenant
from app.models.support_session import (
    SupportSession, DEFAULT_TTL_MINUTES, MAX_TTL_MINUTES,
)

# A reason has to actually say something. This is the whole audit value of
# the record -- "support" or "x" tells a reviewer nothing later.
MIN_REASON_LEN = 10


@platform_bp.route('/support-sessions', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def open_support_session():
    data = request.get_json(silent=True) or {}
    tenant_id = data.get('tenant_id')
    reason = (data.get('reason') or '').strip()
    minutes = data.get('minutes', DEFAULT_TTL_MINUTES)

    if not tenant_id:
        return error_response('tenant_id is required.', status_code=400)
    if len(reason) < MIN_REASON_LEN:
        return error_response(
            'A reason of at least %d characters is required — it is the '
            'record of why a customer\'s data was accessed.' % MIN_REASON_LEN,
            status_code=400,
        )

    tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
    if not tenant:
        return not_found_response('Tenant')
    if tenant.is_platform:
        return error_response(
            'The vendor tenant needs no support session.', status_code=400,
        )

    # Re-opening while one is live would silently extend access without a
    # new record. Make the caller revoke first, so every window of access
    # has its own row and its own stated reason.
    existing = SupportSession.active_for(current_user.id, tenant.id)
    if existing is not None:
        return error_response(
            'An active support session already exists for this tenant. '
            'Revoke it first if you need a new reason or window.',
            status_code=409, data={'session': existing.to_dict()},
        )

    session = SupportSession.open(
        platform_user_id=current_user.id,
        target_tenant_id=tenant.id,
        reason=reason,
        minutes=minutes,
    )
    db.session.add(session)
    db.session.commit()

    return created_response(
        session.to_dict(),
        message='Support session open until %s.' % session.expires_at.isoformat(),
    )


@platform_bp.route('/support-sessions', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def list_support_sessions():
    """History, not just live grants — the point is reviewability."""
    q = SupportSession.query

    tenant_id = request.args.get('tenant_id')
    if tenant_id:
        q = q.filter(SupportSession.target_tenant_id == tenant_id)

    rows = q.order_by(SupportSession.granted_at.desc()).limit(200).all()

    if (request.args.get('active') or '').lower() in ('1', 'true', 'yes'):
        rows = [r for r in rows if r.is_active]

    return success_response(data={
        'sessions': [r.to_dict() for r in rows],
        'default_minutes': DEFAULT_TTL_MINUTES,
        'max_minutes': MAX_TTL_MINUTES,
    })


@platform_bp.route('/support-sessions/<uuid:session_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def revoke_support_session(session_id):
    session = SupportSession.query.get(session_id)
    if not session:
        return not_found_response('SupportSession')

    # Revoke stamps a timestamp; it never deletes. The window of access
    # stays on the record along with whether it was used.
    session.revoke()
    db.session.commit()
    return success_response(
        data=session.to_dict(), message='Support session revoked.',
    )
