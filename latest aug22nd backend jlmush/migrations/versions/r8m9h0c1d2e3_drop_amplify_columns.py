"""Drop the Amplify columns + domain_provider discriminator.

Why
---
The Amplify-to-Cloudflare migration is complete: the Amplify app is
torn down, all live traffic flows through Cloudflare Pages + Workers,
and tenant custom-domain provisioning goes through Cloudflare for SaaS
Custom Hostnames. The discriminator column (``domain_provider``) and
the entire ``amplify_*`` state block become dead schema weight.

What
----
1. Flip every remaining row to Cloudflare semantics by clearing every
   ``amplify_*`` column. (Most should already be NULL since traffic
   has been on Cloudflare; this is the belt-and-braces backfill.)
2. Drop the ``domain_provider`` column — only one provider now.
3. Drop the six ``amplify_*`` columns.
4. Drop the index on ``amplify_app_id`` and ``amplify_domain_status``
   created by earlier revisions.

The ``tenant_domain_migration_audit`` table is KEPT — the audit
decorator in ``cloudflare_saas.py`` still writes general CF-operation
rows there. The ``phase`` column stays nullable; new rows just leave
it NULL.

Down-revision restores the schema only — the column data was already
gone before the upgrade landed, so a downgrade can't recover it. Live
data is on Cloudflare; rolling back this migration without first
spinning up an Amplify pool again would leave the columns NULL anyway.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'r8m9h0c1d2e3'
down_revision = 'q7l8g9b0c1d2'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. Idempotent backfill: clear every amplify_* column on every row.
    # Even tenants that haven't been touched by the platform owner since
    # the cutover will have stale amplify_* values from the original
    # Amplify provisioning; clearing them keeps the rows internally
    # consistent before the schema change in case anyone restores from
    # a pre-migration backup.
    op.execute("""
        UPDATE tenants
        SET amplify_app_id = NULL,
            amplify_domain_status = NULL,
            amplify_domain_error = NULL,
            amplify_subdomains = NULL,
            amplify_cert_validation_record = NULL,
            amplify_synced_at = NULL
        WHERE amplify_app_id IS NOT NULL
           OR amplify_domain_status IS NOT NULL
           OR amplify_domain_error IS NOT NULL
           OR amplify_subdomains IS NOT NULL
           OR amplify_cert_validation_record IS NOT NULL
           OR amplify_synced_at IS NOT NULL
    """)

    # ── 2. Drop the provider discriminator.
    # Drop the index first — Postgres lets you drop a column with an
    # index attached, but being explicit is cheaper to reason about
    # and works on more backends.
    try:
        op.drop_index('ix_tenants_domain_provider', table_name='tenants')
    except Exception:  # noqa: BLE001 — index may not exist on every deploy
        pass
    op.drop_column('tenants', 'domain_provider')

    # ── 3. Drop the amplify_* state columns + their indexes.
    for idx_name in (
        'ix_tenants_amplify_app_id',
        'ix_tenants_amplify_domain_status',
    ):
        try:
            op.drop_index(idx_name, table_name='tenants')
        except Exception:  # noqa: BLE001 — index may have been renamed manually
            pass
    op.drop_column('tenants', 'amplify_app_id')
    op.drop_column('tenants', 'amplify_domain_status')
    op.drop_column('tenants', 'amplify_domain_error')
    op.drop_column('tenants', 'amplify_subdomains')
    op.drop_column('tenants', 'amplify_cert_validation_record')
    op.drop_column('tenants', 'amplify_synced_at')


def downgrade():
    # Re-add the columns (data is lost — see module docstring).
    op.add_column(
        'tenants',
        sa.Column('amplify_synced_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_cert_validation_record', sa.Text(), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_subdomains', sa.JSON(), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_domain_error', sa.Text(), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_domain_status', sa.String(length=40), nullable=True),
    )
    op.create_index(
        'ix_tenants_amplify_domain_status', 'tenants',
        ['amplify_domain_status'],
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_app_id', sa.String(length=40), nullable=True),
    )
    op.create_index(
        'ix_tenants_amplify_app_id', 'tenants', ['amplify_app_id'],
    )
    # domain_provider: NOT NULL with default to match the original schema.
    op.add_column(
        'tenants',
        sa.Column(
            'domain_provider', sa.String(length=20),
            nullable=False, server_default='cloudflare',
        ),
    )
    op.create_index(
        'ix_tenants_domain_provider', 'tenants', ['domain_provider'],
    )
