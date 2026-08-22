"""separate the vendor flag from the fallback flag on tenants

Revision ID: b1p2l3a4t5f6
Revises: a1c7f3e9b2d4
Create Date: 2026-08-18 00:00:00.000000

``tenants.is_default`` was doing two unrelated jobs: marking the SaaS
vendor's own row (and thereby granting it a blanket entitlement/seat
bypass) AND marking where an unresolved anonymous request lands. This
adds ``is_platform`` so the two can be reasoned about — and later
separated onto two different rows — independently.

Behaviour-preserving on purpose: ``is_platform`` is backfilled from
``is_default``, so the tenant that was exempt before this migration is
still exempt after it. The actual apex split is a separate, deliberate
data step (``scripts/split_apex_tenant.py``).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1p2l3a4t5f6'
down_revision = 'a1c7f3e9b2d4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column(
            'is_platform',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )

    # Backfill: whoever was the default tenant was, in practice, the
    # vendor. Keeps every entitlement decision identical across this
    # migration so the schema change alone cannot change who is gated.
    op.execute('UPDATE tenants SET is_platform = is_default')

    # At most one vendor row, at most one fallback row. Partial uniques
    # so the DB refuses a second vendor outright — a silent duplicate
    # would hand a customer tenant the entitlement bypass.
    op.create_index(
        'ux_tenants_single_platform', 'tenants', ['is_platform'],
        unique=True, postgresql_where=sa.text('is_platform IS TRUE'),
    )
    op.create_index(
        'ux_tenants_single_default', 'tenants', ['is_default'],
        unique=True, postgresql_where=sa.text('is_default IS TRUE'),
    )


def downgrade():
    op.drop_index('ux_tenants_single_default', table_name='tenants')
    op.drop_index('ux_tenants_single_platform', table_name='tenants')
    op.drop_column('tenants', 'is_platform')
