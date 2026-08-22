"""Tenants: backfill ``domain`` to lowercase.

Why
---
The host resolver in ``app/__init__.py`` lowercases the incoming
``X-Tenant-Host`` header before issuing
``Tenant.query.filter(Tenant.domain.in_(candidates))``. Postgres
``IN`` is case-sensitive, so a mixed-case stored value (e.g.
``TenantA.com``) silently misses against the lowercased lookup
key and the request falls through to the default-tenant fallback
(or 404 on strict paths).

The fix is to normalize on write: a ``@validates('domain')`` hook
on :class:`app.models.tenant.Tenant` lowercases new/updated values.
This migration backfills any existing rows whose ``domain`` is not
already lowercase so the read side starts matching.

Revision ID: n4i5d6e7f8a9
Revises: m3h4c5d6e7f8
Create Date: 2026-05-07
"""
from __future__ import annotations

from alembic import op


revision = 'n4i5d6e7f8a9'
down_revision = 'm3h4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE tenants SET domain = lower(domain) "
        "WHERE domain IS NOT NULL AND domain <> lower(domain);"
    )


def downgrade():
    # Lowercasing is lossy — original casing cannot be restored.
    pass
