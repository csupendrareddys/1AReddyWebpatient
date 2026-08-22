"""Drop the unwritable years_experience on profile_education_specialization

Nothing could ever set this column: its only writer (DoctorService
.add_specialization) has no route reaching it, and no frontend read it. Every
row was NULL. It looked like the source of truth for a doctor's experience,
which is exactly the danger — a product's experience rule was measured against
it and could never be satisfied. Doctors now state this on About-me
(profile_about.{ug,pg,super_speciality}_experience_years).

Revision ID: d3f7a1b45e29
Revises: c8e52d0f3a71
Create Date: 2026-07-17

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd3f7a1b45e29'
down_revision = 'c8e52d0f3a71'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('profile_education_specialization', schema=None) as batch_op:
        batch_op.drop_column('years_experience')


def downgrade():
    # Restores the column, not its contents — there were none to lose.
    with op.batch_alter_table('profile_education_specialization', schema=None) as batch_op:
        batch_op.add_column(sa.Column('years_experience', sa.Integer(), autoincrement=False, nullable=True))
