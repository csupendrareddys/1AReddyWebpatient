"""Add patient profile-change provenance columns

Records who last edited a patient's profile and when, so the profile header
can say "Last updated on X by <name> (Admin/Patient)". ``updated_at`` alone
can't answer that: the profile is writable both by the patient (their settings
page) and by a super-admin (Operations act-on-behalf), and support needs to
tell the two apart.

``profile_updated_by_role`` is a deliberate snapshot rather than a join — it
must keep reading "an admin did this" even after that person's role changes or
their user row is deleted (the FK is ON DELETE SET NULL).

Autogenerate also picked up unrelated pre-existing drift on ``feature_doctors``
/ ``platform_feature_doctors`` (an ``ix_*_team`` → ``ix_*_team_id`` index
rename). That was removed from this revision — it belongs to whatever change
introduced it, not here.

Revision ID: 9383fc38cf53
Revises: memberpay1
Create Date: 2026-07-30 19:34:18.641455

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9383fc38cf53'
down_revision = 'memberpay1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('patients', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('profile_updated_at', sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.add_column(sa.Column('profile_updated_by_id', sa.UUID(), nullable=True))
        batch_op.add_column(
            sa.Column('profile_updated_by_role', sa.String(length=30), nullable=True),
        )
        batch_op.create_index(
            batch_op.f('ix_patients_profile_updated_by_id'),
            ['profile_updated_by_id'], unique=False,
        )
        batch_op.create_foreign_key(
            'fk_patients_profile_updated_by_id', 'users',
            ['profile_updated_by_id'], ['user_id'], ondelete='SET NULL',
        )


def downgrade():
    with op.batch_alter_table('patients', schema=None) as batch_op:
        batch_op.drop_constraint('fk_patients_profile_updated_by_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_patients_profile_updated_by_id'))
        batch_op.drop_column('profile_updated_by_role')
        batch_op.drop_column('profile_updated_by_id')
        batch_op.drop_column('profile_updated_at')
