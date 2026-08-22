"""Add custom-domain TXT-challenge verification columns to tenants.

Adds three columns + an index used by
:mod:`app.services.domain_verification`:

  * ``domain_verification_token`` — the random secret operators publish
    in the tenant's DNS as a TXT record value.
  * ``domain_verification_status`` — pending|verified|failed|revoked.
  * ``domain_verified_at`` — wall-clock timestamp of the most recent
    successful verification.

Backfill: any pre-existing tenants without a custom domain (or the
default platform tenant) are stamped ``verified`` so the gating logic in
:meth:`CloudflareDnsService.sync_tenant` doesn't accidentally tear down
their (non-existent) custom-domain CNAMEs on the first deploy after the
upgrade.

Revision ID: 7a3f1c8e9b22
Revises: 498582224941
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7a3f1c8e9b22'
down_revision = '498582224941'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column('domain_verification_token', sa.String(length=80), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('domain_verification_status', sa.String(length=20), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('domain_verified_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        'ix_tenants_domain_verification_status',
        'tenants',
        ['domain_verification_status'],
    )

    # Backfill — see module docstring.
    op.execute(
        "UPDATE tenants "
        "SET domain_verification_status = 'verified' "
        "WHERE domain IS NULL OR is_default = TRUE"
    )


def downgrade():
    op.drop_index('ix_tenants_domain_verification_status', table_name='tenants')
    op.drop_column('tenants', 'domain_verified_at')
    op.drop_column('tenants', 'domain_verification_status')
    op.drop_column('tenants', 'domain_verification_token')
