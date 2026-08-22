"""add gst_by_consultation_type to billing_configs

Lets the CGST/SGST pair vary per consultation type (video/audio/chat/…) while
the existing flat ``cgst_rate``/``sgst_rate`` stay the DEFAULT fallback for any
type not explicitly configured. Stored as a nullable JSONB map, shape:
    {"video": {"cgst": 9, "sgst": 9}, "home_visit": {"cgst": 2.5, "sgst": 2.5}}
Non-breaking: an absent/empty map means every type uses the flat pair, exactly
as before this migration.

Revision ID: gst1bytype2cons3
Revises: mplan1charge2fee3
Create Date: 2026-07-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'gst1bytype2cons3'
down_revision = 'mplan1charge2fee3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('billing_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'gst_by_consultation_type', postgresql.JSONB(astext_type=sa.Text()),
            nullable=True))


def downgrade():
    with op.batch_alter_table('billing_configs', schema=None) as batch_op:
        batch_op.drop_column('gst_by_consultation_type')
