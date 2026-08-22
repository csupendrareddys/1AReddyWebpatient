"""CRUD for a tenant's own verticals.

Every handler scopes to ``current_tenant_id_strict()``, so a tenant can
only ever see and edit its own rows -- there is no id in these routes
that could point at somebody else's vertical.

PLATFORM_OWNER is deliberately absent from the role lists. This is a
tenant-admin surface; a vendor who genuinely needs to act here does so
through a support session (``app.common.support_access``), which is
recorded, rather than by virtue of the role.
"""
from flask import request
from flask_jwt_extended import jwt_required

from app.api.verticals import verticals_bp
from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response,
    validation_error_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole

_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]


def list_verticals():
    from app.models.membership import VerticalPlanType

    # Explicit tenant filter on top of RLS: the app connects as a Postgres
    # superuser in dev, which bypasses RLS, so without this a tenant would
    # see every tenant's verticals locally.
    rows = (
        VerticalPlanType.query
        .filter_by(tenant_id=current_tenant_id_strict())
        .order_by(VerticalPlanType.sort_order.asc(), VerticalPlanType.name.asc())
        .all()
    )
    return success_response([r.to_dict() for r in rows])


def create_vertical():
    from app.models.membership import VerticalPlanType

    data = request.get_json() or {}
    code = (data.get('code') or '').strip()
    name = (data.get('name') or '').strip()
    if not code or not name:
        return validation_error_response({'missing': ['code', 'name']})

    tenant_id = current_tenant_id_strict()
    # ``code`` is unique WITHIN a tenant, so both the conflict check and
    # the insert are tenant-scoped.
    if VerticalPlanType.query.filter_by(tenant_id=tenant_id, code=code).first():
        return error_response(
            'Vertical "%s" already exists.' % code, status_code=409,
        )

    row = VerticalPlanType(
        tenant_id=tenant_id,
        code=code,
        name=name,
        icon_key=(data.get('icon_key') or '').strip(),
        description=(data.get('description') or '').strip(),
        is_receiver=data.get('is_receiver') or False,
        sort_order=data.get('sort_order') or 0,
    )
    db.session.add(row)
    db.session.commit()
    return created_response(row.to_dict(), message='Vertical created')


def update_vertical(vertical_id):
    from app.models.membership import VerticalPlanType

    tenant_id = current_tenant_id_strict()
    row = VerticalPlanType.query.filter_by(
        id=vertical_id, tenant_id=tenant_id,
    ).first()
    if not row:
        return not_found_response('Vertical')

    data = request.get_json() or {}

    new_code = (data.get('code') or '').strip()
    if new_code and new_code != row.code:
        clash = VerticalPlanType.query.filter_by(
            tenant_id=tenant_id, code=new_code,
        ).first()
        if clash:
            return error_response(
                'Vertical "%s" already exists.' % new_code, status_code=409,
            )
        row.code = new_code

    for field in ('name', 'icon_key', 'description'):
        if field in data:
            setattr(row, field, (data.get(field) or '').strip())
    if 'is_receiver' in data:
        row.is_receiver = bool(data.get('is_receiver'))
    if 'sort_order' in data:
        row.sort_order = data.get('sort_order') or 0

    db.session.commit()
    return success_response(row.to_dict(), message='Vertical updated')


def delete_vertical(vertical_id):
    from app.models.membership import VerticalPlanType, MembershipPlan

    tenant_id = current_tenant_id_strict()
    row = VerticalPlanType.query.filter_by(
        id=vertical_id, tenant_id=tenant_id,
    ).first()
    if not row:
        return not_found_response('Vertical')

    # Refuse rather than orphan: membership plans carry a RESTRICT FK to
    # this row, so deleting would either fail at the DB or strand tiers
    # customers are actively subscribed to.
    # Count over the FK column only -- do NOT hydrate MembershipPlan. The
    # ORM entity selects every column, so any drift between the model and
    # the applied migrations turns this guard into a 500. Counting one
    # indexed column is both immune to that and cheaper.
    in_use = (
        db.session.query(db.func.count(MembershipPlan.id))
        .filter(
            MembershipPlan.tenant_id == tenant_id,
            MembershipPlan.vertical_plan_type_id == row.id,
            MembershipPlan.is_deleted.is_(False),
        )
        .scalar()
    ) or 0
    if in_use:
        return error_response(
            'This vertical still has %d plan(s). Move or remove them first.'
            % in_use,
            status_code=409,
        )

    # Bulk delete rather than session.delete(row): the latter makes
    # SQLAlchemy load the ``membership_plans`` relationship to process the
    # cascade, hydrating the same entity the guard above deliberately
    # avoided. The guard has already established there is nothing to
    # cascade to, and the filter stays tenant-scoped.
    VerticalPlanType.query.filter_by(
        id=row.id, tenant_id=tenant_id,
    ).delete(synchronize_session=False)
    db.session.commit()
    return success_response(message='Vertical deleted')


# ── Tenant-facing routes ────────────────────────────────────────────
verticals_bp.add_url_rule(
    '', view_func=jwt_required()(role_required(_ROLES)(list_verticals)),
    methods=['GET'], endpoint='list_verticals',
)
verticals_bp.add_url_rule(
    '', view_func=jwt_required()(role_required(_ROLES)(create_vertical)),
    methods=['POST'], endpoint='create_vertical',
)
verticals_bp.add_url_rule(
    '/<uuid:vertical_id>',
    view_func=jwt_required()(role_required(_ROLES)(update_vertical)),
    methods=['PUT'], endpoint='update_vertical',
)
verticals_bp.add_url_rule(
    '/<uuid:vertical_id>',
    view_func=jwt_required()(role_required(_ROLES)(delete_vertical)),
    methods=['DELETE'], endpoint='delete_vertical',
)
