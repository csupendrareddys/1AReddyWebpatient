"""Tenants: add ``amplify_app_id`` column for multi-Amplify-app pool.

Why
---
AWS Amplify enforces a HARD limit of 5 custom-domain associations
per app per region. The platform has already hit that ceiling and
provisioned 3 Amplify apps (all building from the same git repo)
to scale past it. The backend now treats the apps as a POOL and
picks whichever has free slots on each new tenant create.

To do that we need to remember WHICH app in the pool currently
hosts each tenant's custom-domain association, so subsequent
refresh / reset / delete calls target the right one. That's what
this column is for. The picker
(``AmplifyDomainService.pick_app_with_free_slot``) sets it on the
first successful ``CreateDomainAssociation``; every later call
reads it back via
``AmplifyDomainService._app_id_for_tenant(tenant)``.

Backfill
--------
Tenants that already had an Amplify association before this
migration ran are pinned to the FIRST entry in
``AMPLIFY_APP_IDS`` (or the legacy ``AMPLIFY_APP_ID`` if the new
plural env var isn't set yet — back-compat path). That's by
definition the original single-app and matches where AWS already
holds their CreateDomainAssociation. Zero re-association calls.

If neither env var is set at migration time we leave the column
NULL — the runtime service layer's
``_app_id_for_tenant`` fallback will still resolve it correctly
once the env is configured.

Revision ID: o5j6e7f8a9b0
Revises: n4i5d6e7f8a9
Create Date: 2026-05-08
"""
from __future__ import annotations

import os

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = 'o5j6e7f8a9b0'
down_revision = 'n4i5d6e7f8a9'
branch_labels = None
depends_on = None


def _first_pool_app_id() -> str | None:
    """Pick the original (single) Amplify app id for backfill.

    The new pool env is ``AMPLIFY_APP_IDS`` (comma-separated); the
    legacy env was ``AMPLIFY_APP_ID`` (single). We prefer the new one's
    FIRST entry — the operator is expected to put the original app id
    first in the list so existing rows land on the right app.
    """
    plural = (os.environ.get('AMPLIFY_APP_IDS') or '').strip()
    if plural:
        first = plural.split(',', 1)[0].strip()
        if first:
            return first
    legacy = (os.environ.get('AMPLIFY_APP_ID') or '').strip()
    return legacy or None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column('amplify_app_id', sa.String(length=40), nullable=True),
    )
    op.create_index(
        'ix_tenants_amplify_app_id',
        'tenants',
        ['amplify_app_id'],
    )

    # Backfill: every tenant that currently has an Amplify association
    # was provisioned on the original single-app. Pin them there.
    first_app_id = _first_pool_app_id()
    if first_app_id:
        # Parametrised, idempotent. Only touches rows that have an
        # Amplify state but no app_id yet.
        op.execute(
            sa.text(
                'UPDATE tenants '
                'SET amplify_app_id = :app_id '
                'WHERE amplify_domain_status IS NOT NULL '
                'AND amplify_app_id IS NULL'
            ).bindparams(app_id=first_app_id)
        )


def downgrade():
    op.drop_index('ix_tenants_amplify_app_id', table_name='tenants')
    op.drop_column('tenants', 'amplify_app_id')
