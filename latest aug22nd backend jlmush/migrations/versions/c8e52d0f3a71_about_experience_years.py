"""Doctor work experience per education level, on About-me

The product experience rule was measured against
ProfileEducationSpecialization.years_experience, but nothing ever wrote it:
its only setter has no route, and it never set qualification_level either, so
every real row was NULL/NULL and no doctor could satisfy a rule. This gives
the doctor somewhere to actually state it, next to the work qualification they
already pick on About-me.

Nullable on purpose: NULL means "not stated", which a rule treats as unmet
rather than as zero years served.

Revision ID: c8e52d0f3a71
Revises: b7d41c9e2f60
Create Date: 2026-07-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'c8e52d0f3a71'
down_revision = 'b7d41c9e2f60'
branch_labels = None
depends_on = None


# Shared with profile_about's other status columns — reference it, don't
# recreate it.
_doc_verification_status = postgresql.ENUM(
    'PENDING', 'VERIFIED', 'REJECTED',
    name='documentverificationstatus',
    create_type=False,
)


def upgrade():
    with op.batch_alter_table('profile_about', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ug_experience_years', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('pg_experience_years', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('super_speciality_experience_years', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column(
            'experience_verification_status',
            _doc_verification_status,
            nullable=False,
            server_default='PENDING',
        ))


def downgrade():
    with op.batch_alter_table('profile_about', schema=None) as batch_op:
        batch_op.drop_column('experience_verification_status')
        batch_op.drop_column('super_speciality_experience_years')
        batch_op.drop_column('pg_experience_years')
        batch_op.drop_column('ug_experience_years')
