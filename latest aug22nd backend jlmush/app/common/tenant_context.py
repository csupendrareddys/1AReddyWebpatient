"""Tenant context helpers.

A single source of truth for "which tenant is this request for?".

The Flask :func:`register_tenant_context` :data:`before_request` hook
populates :data:`g.tenant_id` for every request based on (in order):

1. The ``tenant_id`` claim on a valid JWT.
2. The ``X-Tenant-Slug`` request header (used by unauthenticated requests
   coming from a tenant subdomain).
3. The default tenant (``Tenant.is_default = True``) as an anonymous-request
   fallback — so RLS-enabled tables don't starve public flows.

Platform-owner cross-tenant operations (seed a new tenant's landing config,
list another tenant's admins, etc.) do NOT flow through the before-request
hook. They use :func:`with_tenant_context` to briefly switch the session
tenant for the scope of one service call, then restore. This keeps the
platform owner tenant-isolated on every generic ``/api/admin/*`` endpoint —
they see only their own tenant's data, exactly like any other tenant
super-admin — while still enabling the explicit ``/api/platform/*`` UIs
(Tenants list, per-tenant admin list, per-tenant allocation grid, etc.) to
work.

Service code that needs the tenant id (for queries, uniqueness checks,
RLS-bypass paths, etc.) should call :func:`current_tenant_id` instead of
re-implementing the resolution chain. This guarantees every code path
agrees on which tenant the request belongs to and prevents the
"global lookup" bugs where the same email/phone gets matched against a
different tenant's user.
"""
from contextlib import contextmanager

from flask import abort, g, has_request_context
from sqlalchemy import text

from app.extensions import db


def current_tenant_id():
    """Return the tenant id for the current request, or ``None``.

    Reads from :data:`flask.g.tenant_id` which the global before_request
    hook populates. Returns ``None`` outside a request context (CLI,
    background jobs, tests) so callers can decide how to fall back.
    """
    if not has_request_context():
        return None
    return getattr(g, 'tenant_id', None)


@contextmanager
def with_tenant_context(target_tenant_id):
    """Temporarily flip the Postgres session's ``app.current_tenant_id`` so
    RLS policies resolve rows belonging to ``target_tenant_id`` instead of
    the caller's own tenant.

    Used exclusively by the platform-owner cross-tenant admin surface
    (``/api/platform/*``). Every ``/api/admin/*`` endpoint must use
    :func:`current_tenant_id_strict` and stay scoped to the caller's own
    tenant — no back door.

    The context manager restores whatever value was previously set (or
    unset) on exit, even when the wrapped block raises, so nested or
    concurrent usage can't leave the session pointing at a stale tenant.
    """
    previous = db.session.execute(
        text("SELECT current_setting('app.current_tenant_id', true)")
    ).scalar()
    try:
        db.session.execute(
            text("SET LOCAL app.current_tenant_id = :tid"),
            {'tid': str(target_tenant_id)},
        )
        yield
    finally:
        # ``RESET`` on a missing setting is a no-op; ``SET LOCAL`` with the
        # prior value restores it exactly. Both are safe.
        if previous:
            db.session.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {'tid': previous},
            )
        else:
            db.session.execute(text("RESET app.current_tenant_id"))


def current_tenant_id_strict():
    """Return the tenant id for the current request, or abort with HTTP 400.

    Used by admin endpoints that want a belt-and-suspenders tenant filter on
    top of Postgres RLS. A request reaching these endpoints must have a
    tenant resolved — the before-request hook already falls back to the
    default tenant for anonymous traffic, so the only way to hit the
    ``abort`` path is a misconfiguration (no default tenant seeded, tenant
    hook skipped by mistake, or the route being called outside a request
    context). Fail-closed is safer than silently returning cross-tenant rows.
    """
    tid = current_tenant_id()
    if not tid:
        abort(400, 'Tenant context missing.')
    return tid


@contextmanager
def with_background_tenant_context(app, tenant_id):
    """Like :func:`with_tenant_context` but for code that runs OUTSIDE a
    Flask request (APScheduler jobs, scripts, healthchecks).

    Two layers of context are pushed:

      * ``app.app_context()`` so ``flask.g`` is writable + ``db.session``
        binds to the right engine. Without this the
        ``@event.listens_for(db.session, 'before_flush')`` auto-fill
        hook in ``app/models/_base.py`` is a no-op
        (``has_app_context()`` returns False) and every TenantMixin
        insert from a background job 500s with NotNullViolation.
      * The Postgres ``SET LOCAL app.current_tenant_id`` so RLS resolves
        rows under ``tenant_id`` for the duration of the block.

    Usage from an APScheduler job::

        from app.common.tenant_context import with_background_tenant_context

        def sweep_subscriptions():
            with with_background_tenant_context(app, default_tenant_id):
                MembershipService.sweep_over_limit()

    The block restores everything on exit — Flask app context popped,
    Postgres session variable reset — so jobs can iterate across
    tenants without leaking state between iterations.
    """
    with app.app_context():
        g.tenant_id = str(tenant_id)
        previous = db.session.execute(
            text("SELECT current_setting('app.current_tenant_id', true)")
        ).scalar()
        try:
            db.session.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {'tid': str(tenant_id)},
            )
            yield
        finally:
            if previous:
                db.session.execute(
                    text("SET LOCAL app.current_tenant_id = :tid"),
                    {'tid': previous},
                )
            else:
                db.session.execute(text("RESET app.current_tenant_id"))


def current_tenant_id_or_default():
    """Return the tenant id for the current request, or the default tenant's id.

    Use this in auth lookup paths (forgot-password, OTP login, email
    verification) where the request *must* be tenant-scoped to avoid
    cross-tenant identity collisions, but the request may legitimately
    come from the apex / platform-owner domain (no X-Tenant-Slug header).

    Raises:
        RuntimeError: if no tenant can be resolved AND no default tenant
            row exists. This is a fatal misconfiguration — every install
            must have exactly one ``Tenant.is_default = True`` row.
    """
    tid = current_tenant_id()
    if tid:
        return tid

    # Lazy import — keeps this module import-cycle-free.
    from app.models import Tenant
    default_tenant = Tenant.query.filter_by(is_default=True).first()
    if not default_tenant:
        raise RuntimeError(
            'No tenant context on request and no default tenant configured. '
            'Either send X-Tenant-Slug, authenticate, or seed a default tenant.'
        )
    return str(default_tenant.id)
