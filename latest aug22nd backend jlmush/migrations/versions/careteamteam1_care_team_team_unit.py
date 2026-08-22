"""Care-team rows can pin a whole team (group offerings), not just a doctor

Adds ``team_id`` to ``feature_doctors`` + ``platform_feature_doctors``, relaxes
``doctor_id`` to nullable (a row is now a doctor XOR a team), and adds a
per-(feature, team) unique constraint on each.

Revision ID: careteamteam1
Revises: platfeatprod1
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'careteamteam1'
down_revision = 'platfeatprod1'
branch_labels = None
depends_on = None


_TABLES = (
    ('feature_doctors', 'uq_feature_team', 'ix_feature_doctors_team'),
    ('platform_feature_doctors', 'uq_platform_feature_team',
     'ix_platform_feature_doctors_team'),
)


def upgrade():
    for table, uq, ix in _TABLES:
        op.add_column(
            table, sa.Column('team_id', UUID(as_uuid=True), nullable=True))
        op.alter_column(table, 'doctor_id', existing_type=UUID(as_uuid=True),
                        nullable=True)
        op.create_foreign_key(
            f'{table}_team_id_fkey', table, 'marketplace_service_groups',
            ['team_id'], ['group_id'], ondelete='CASCADE',
        )
        op.create_index(ix, table, ['team_id'])
        op.create_unique_constraint(uq, table, ['feature_id', 'team_id'])


def downgrade():
    for table, uq, ix in _TABLES:
        op.drop_constraint(uq, table, type_='unique')
        op.drop_index(ix, table_name=table)
        op.drop_constraint(f'{table}_team_id_fkey', table, type_='foreignkey')
        # Existing team rows would violate NOT NULL — drop them first.
        op.execute(sa.text(
            f"DELETE FROM {table} WHERE doctor_id IS NULL"))
        op.alter_column(table, 'doctor_id', existing_type=UUID(as_uuid=True),
                        nullable=False)
        op.drop_column(table, 'team_id')
