"""Indian GST/TDS — split the doctor's supply from the platform's supply

The patient pays one number (the display price) but that is two supplies under
GST: the doctor's professional/healthcare service (their quoted, tax-INCLUSIVE
fee) and the platform's facilitation margin (display price − doctor fee). They
have different taxable values and may have different rates, so ``BillingConfig``
grows a second, independent rate set plus the IGST leg that was missing
entirely.

Adds to ``billing_configs``:

  igst_rate                   doctor supply, inter-state (NULL ⇒ cgst+sgst)
  doctor_tax_mode             none|intra_state|inter_state|auto  (default auto)
  platform_fee_cgst_rate      platform supply, intra-state  (default 9.00)
  platform_fee_sgst_rate      platform supply, intra-state  (default 9.00)
  platform_fee_igst_rate      platform supply, inter-state (NULL ⇒ cgst+sgst)
  platform_tax_mode           none|intra_state|inter_state|auto  (default auto)
  platform_fee_tax_inclusive  is the platform GST carved out of the margin?
  tds_exclude_gst             CBDT Circular 23/2017 — TDS on the ex-GST value

No new table, so no RLS policy is needed: ``billing_configs`` is already
tenant-scoped (TenantMixin) and carries its policies from its own migration.
Every column is additive with a server_default, so existing rows keep working
and nothing needs backfilling.

Revision ID: tax1gst2india3
Revises: vouch1coup2disc3
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'tax1gst2india3'
down_revision = 'vouch1coup2disc3'
branch_labels = None
depends_on = None


NEW_COLUMNS = (
    # (name, type, nullable, server_default)
    ('igst_rate', sa.Numeric(5, 2), True, None),
    ('doctor_tax_mode', sa.String(20), False, 'auto'),
    ('platform_fee_cgst_rate', sa.Numeric(5, 2), False, '9.00'),
    ('platform_fee_sgst_rate', sa.Numeric(5, 2), False, '9.00'),
    ('platform_fee_igst_rate', sa.Numeric(5, 2), True, None),
    ('platform_tax_mode', sa.String(20), False, 'auto'),
    ('platform_fee_tax_inclusive', sa.Boolean(), False, 'true'),
    ('tds_exclude_gst', sa.Boolean(), False, 'true'),
)


def upgrade():
    for name, type_, nullable, default in NEW_COLUMNS:
        op.add_column(
            'billing_configs',
            sa.Column(name, type_, nullable=nullable, server_default=default),
        )


def downgrade():
    for name, _type, _nullable, _default in reversed(NEW_COLUMNS):
        op.drop_column('billing_configs', name)
