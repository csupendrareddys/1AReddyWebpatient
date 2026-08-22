"""doctor cop/registration cert verification status

Revision ID: f3e5a28c97b5
Revises: 70a6ac254957
Create Date: 2026-08-06 15:44:16.570346

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f3e5a28c97b5'
down_revision = '70a6ac254957'
branch_labels = None
depends_on = None


def upgrade():
    # Reuse the existing PG enum type (do not re-create it), and give the
    # NOT NULL columns a temporary PENDING server_default so existing doctor
    # rows backfill, then drop the default to match the model.
    doc_status = sa.Enum(
        'PENDING', 'VERIFIED', 'REJECTED',
        name='documentverificationstatus', create_type=False,
    )
    for col in ('registration_certificate_verification_status',
                'cop_attachment_verification_status'):
        op.add_column('doctors', sa.Column(
            col, doc_status, nullable=False, server_default='PENDING'))
        op.alter_column('doctors', col, server_default=None)


def downgrade():
    with op.batch_alter_table('doctors', schema=None) as batch_op:
        batch_op.drop_column('cop_attachment_verification_status')
        batch_op.drop_column('registration_certificate_verification_status')
