"""
Shared base classes, mixins, and utility functions for all models.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import event, text
from sqlalchemy.dialects.postgresql import UUID
from app.extensions import db


logger = logging.getLogger(__name__)


def utcnow():
    """Returns timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class TenantMixin:
    """Adds tenant_id FK to any model. Every table except 'tenants' uses this."""
    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )


class TimestampMixin:
    """Adds created_at / updated_at with timezone=True."""
    created_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class SoftDeleteMixin:
    """Adds is_deleted / deleted_at for soft delete.

    ``server_default`` paired with the Python ``default`` so ``db.create_all()``
    AND Alembic-generated DDL both produce a Postgres-level ``DEFAULT FALSE``.
    Without the server default, raw-SQL ``INSERT`` statements (e.g. seed
    rows in migrations) that omit ``is_deleted`` fail with a NOT NULL
    violation on tables built via ``db.create_all()``.
    """
    is_deleted = db.Column(
        db.Boolean,
        default=False,
        server_default=db.text('false'),
        nullable=False,
        index=True,
    )
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)


def soft_delete_record(record):
    """Soft delete a record by setting is_deleted=True and deleted_at=now."""
    if hasattr(record, 'is_deleted') and hasattr(record, 'deleted_at'):
        record.is_deleted = True
        record.deleted_at = utcnow()
    else:
        raise AttributeError(
            f"{record.__class__.__name__} doesn't support soft delete"
        )


def restore_record(record):
    """Restore a soft-deleted record."""
    if hasattr(record, 'is_deleted') and hasattr(record, 'deleted_at'):
        record.is_deleted = False
        record.deleted_at = None
    else:
        raise AttributeError(
            f"{record.__class__.__name__} doesn't support restore"
        )


class AuditMixin:
    """Tracks who created and last modified a record. Healthcare compliance requirement."""
    created_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    updated_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )


# ────────────────────────────────────────────────────────────────────
# Defensive auto-fill — populate ``tenant_id`` on pending inserts
# whenever a TenantMixin row is being added without one.
#
# Why this exists:
#   The ORM doesn't infer ``tenant_id`` from RLS context. Models that
#   inherit ``TenantMixin`` declare ``tenant_id`` as ``nullable=False``
#   but have NO column-level default. Construction sites that forget
#   to pass ``tenant_id=...`` blow up with NotNullViolation on commit
#   (psycopg2.errors.NotNullViolation — see the approval-action 500
#   that triggered this hook). An audit found 36 such sites across 19
#   models; fixing each by hand is error-prone and we'd regress every
#   time a new TenantMixin model is added.
#
# Behaviour:
#   * Fires on ``before_flush`` of the shared session.
#   * For every pending NEW row whose class inherits ``TenantMixin``:
#       - if ``tenant_id`` is None AND ``flask.g.tenant_id`` is set,
#         stamp the row with the request's tenant.
#       - if ``tenant_id`` is already set, leave it alone (explicit
#         assignments — e.g. cross-tenant operator flows where the
#         action's tenant is taken from the parent record, not the
#         operator's session — keep winning).
#   * Skips when there's no Flask app/request context (Alembic
#     migrations, scripts, tests outside a request) — those callers
#     are responsible for setting tenant_id explicitly, and we don't
#     want to stamp ``None`` blindly.
#
# Caveat — cross-tenant operator flows:
#   When PLATFORM_OWNER acts on another tenant's data from the apex,
#   ``g.tenant_id`` is the platform tenant, NOT the target tenant.
#   This hook would stamp the WRONG tenant for those rows. The
#   caller MUST set ``tenant_id`` explicitly (from the parent record)
#   in those cases — see ``ApprovalRequest.approve_level`` for the
#   canonical example. The hook only kicks in when the caller didn't
#   set anything, so explicit assignments are safe.
@event.listens_for(db.session, 'before_flush')
def _auto_fill_tenant_id_on_insert(session, flush_context, instances):
    try:
        from flask import g, has_app_context
    except ImportError:
        return
    if not has_app_context():
        return
    tenant_id = getattr(g, 'tenant_id', None)
    if not tenant_id:
        return
    try:
        tenant_uuid = uuid.UUID(str(tenant_id))
    except (ValueError, TypeError):
        # Malformed g.tenant_id — leave the row untouched and let the
        # NOT-NULL constraint fail loudly so the caller sees it.
        return
    for obj in session.new:
        # ``isinstance(obj, TenantMixin)`` works because every model
        # that inherits the mixin carries it in its MRO. Skip the
        # ``tenants`` table itself (Tenant doesn't inherit TenantMixin
        # for obvious reasons), and any row that already has tenant_id
        # set — the second guard is what protects cross-tenant operator
        # flows that explicitly pin tenant from a parent record.
        if not isinstance(obj, TenantMixin):
            continue
        if getattr(obj, 'tenant_id', None) is not None:
            continue
        obj.tenant_id = tenant_uuid


def set_tenant_context(session, tenant_id):
    """
    Set the current tenant context on a database session.
    Must be called at the start of each request so PostgreSQL RLS policies
    can enforce tenant isolation at the database level.

    Usage in a Flask before_request hook:
        @app.before_request
        def set_tenant():
            tenant_id = resolve_tenant_from_request(request)
            set_tenant_context(db.session, tenant_id)
    """
    if tenant_id:
        session.execute(
            text("SET LOCAL app.current_tenant_id = :tid"),
            {'tid': str(tenant_id)}
        )


def generate_rls_sql(table_name):
    """
    Generate SQL statements to enable Row-Level Security on a table.
    Returns a list of SQL strings to be executed in an Alembic migration.

    The policies consult ``current_setting('app.current_tenant_id', true)`` —
    the second argument turns the setting lookup into a nullable read (returns
    NULL instead of raising when the variable has never been SET on this
    session). Flask's before-request hook always calls ``set_tenant_context``
    for tenant-scoped traffic, but background workers, healthcheck pings and
    raw psql sessions may not. With the strict form those sessions would
    crash on the first query; with the nullable form the policy denies the
    row (fail-closed) and the caller sees "no data" rather than a 500.

    Strict tenant isolation — NO cross-tenant bypass. Platform-owner
    cross-tenant operations use ``with_tenant_context(target_tenant_id)``
    (see ``app/common/tenant_context.py``) to briefly switch the session
    tenant for the scope of one service call. That keeps the explicit
    ``/api/platform/*`` UIs working WITHOUT giving PLATFORM_OWNER blanket
    cross-tenant authority on every generic ``/api/admin/*`` endpoint.

    Example usage in a migration:
        from app.models._base import generate_rls_sql
        for stmt in generate_rls_sql('users'):
            op.execute(stmt)
    """
    _var = "current_setting('app.current_tenant_id', true)"
    return [
        f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation_{table_name} ON {table_name} "
        f"USING (tenant_id = {_var}::uuid)",
        f"CREATE POLICY tenant_insert_{table_name} ON {table_name} "
        f"FOR INSERT WITH CHECK (tenant_id = {_var}::uuid)",
    ]


def create_profile_for_user(user, **profile_data):
    """
    Factory function to create the appropriate profile model based on user role.
    Note: first_name/last_name/middle_name now live on User, not on profiles.
    """
    # Lazy imports to avoid circular dependency
    from app.models._enums import UserRole
    from app.models.doctor import Doctor
    from app.models.patient import Patient
    from app.models.pharmacy import Pharmacy
    from app.models.admin import Admin

    profile_map = {
        UserRole.PATIENT: Patient,
        UserRole.DOCTOR: Doctor,
        UserRole.PHARMACY: Pharmacy,
        UserRole.SUPER_ADMIN: Admin,
        UserRole.SUB_ADMIN: Admin,
    }

    profile_class = profile_map.get(user.role)
    if not profile_class:
        raise ValueError(f"No profile class found for role: {user.role}")

    # Name fields live on User now, not on profile models
    default_data = {'user_id': user.id}
    if hasattr(user, 'tenant_id') and user.tenant_id:
        default_data['tenant_id'] = user.tenant_id

    final_data = {**default_data, **profile_data}
    profile = profile_class(**final_data)
    db.session.add(profile)
    return profile


def get_or_create_profile_owner(owner_type, owner_id, tenant_id):
    """Return the ``ProfileOwner`` row for an actor, creating it if absent.

    ``owner_type`` is one of 'doctor' | 'admin' | 'clinic' | 'hospital' |
    'authorized_personnel'. Every per-actor profile-detail row references its
    owner through this table (see docs/profile-owner-centralization.md), so
    writers call this to obtain a ``profile_owner_id``.
    """
    from app.models.profile_shared import ProfileOwner
    fk = f'{owner_type}_id'
    po = ProfileOwner.query.filter_by(tenant_id=tenant_id, **{fk: owner_id}).first()
    if po is None:
        po = ProfileOwner(owner_type=owner_type, tenant_id=tenant_id, **{fk: owner_id})
        db.session.add(po)
        db.session.flush()
    return po
