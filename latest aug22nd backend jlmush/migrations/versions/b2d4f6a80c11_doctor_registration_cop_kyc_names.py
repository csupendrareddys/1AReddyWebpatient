"""doctor: registration/COP details + KYC names

Revision ID: b2d4f6a80c11
Revises: a1c2e5f70b34
Create Date: 2026-08-01 13:10:00.000000

Adds the extended Practice-section fields the admin View-Doctors table shows:
name-as-per-Aadhaar / -PAN, the richer registration block (name / date / expiry /
board / state) and a full Certificate-of-Practice (COP) block. All nullable.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b2d4f6a80c11'
down_revision = 'a1c2e5f70b34'
branch_labels = None
depends_on = None


_COLS = [
    ('name_as_per_aadhaar', sa.String(length=200)),
    ('name_as_per_pan', sa.String(length=200)),
    ('registration_name', sa.String(length=200)),
    ('registration_date', sa.Date()),
    ('registration_expiry', sa.Date()),
    ('registration_board', sa.String(length=200)),
    ('registration_state', sa.String(length=100)),
    ('cop_number', sa.String(length=100)),
    ('cop_name', sa.String(length=200)),
    ('cop_date', sa.Date()),
    ('cop_expiry', sa.Date()),
    ('cop_board', sa.String(length=200)),
    ('cop_state', sa.String(length=100)),
    ('cop_attachment', sa.String(length=500)),
]


def upgrade():
    with op.batch_alter_table('doctors', schema=None) as batch_op:
        for name, col_type in _COLS:
            batch_op.add_column(sa.Column(name, col_type, nullable=True))


def downgrade():
    with op.batch_alter_table('doctors', schema=None) as batch_op:
        for name, _ in reversed(_COLS):
            batch_op.drop_column(name)
