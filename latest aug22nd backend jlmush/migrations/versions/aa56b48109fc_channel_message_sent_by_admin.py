"""channel message sent_by_admin

Revision ID: aa56b48109fc
Revises: a353f578f7f7
Create Date: 2026-08-05 06:37:27.237402

Marks a chat message as posted by an operator through the Operations
act-on-behalf proxy, so the thread itself shows "sent by support" to both the
patient and the doctor. Nullable: every existing message, and every message a
member sends themselves, stays NULL.

Autogenerate also picked up unrelated index-rename drift on
``feature_doctors`` / ``platform_feature_doctors`` (``*_team`` →
``*_team_id``); that was stripped — it does not belong to this change.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'aa56b48109fc'
down_revision = 'a353f578f7f7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('channel_messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sent_by_admin_id', sa.UUID(), nullable=True))
        batch_op.create_foreign_key(
            'fk_channel_messages_sent_by_admin_id_users', 'users',
            ['sent_by_admin_id'], ['user_id'], ondelete='SET NULL',
        )


def downgrade():
    # Drop the FK by its ACTUAL name, whichever way the schema was built: a
    # migration upgrade names it 'fk_channel_messages_sent_by_admin_id_users',
    # but a db.create_all() bootstrap (no metadata naming convention) lets
    # Postgres auto-name it 'channel_messages_sent_by_admin_id_fkey'. Hardcoding
    # one name breaks the other path — look it up from the catalog instead.
    conn = op.get_bind()
    insp = sa.inspect(conn)
    for fk in insp.get_foreign_keys('channel_messages'):
        if 'sent_by_admin_id' in (fk.get('constrained_columns') or []) and fk.get('name'):
            op.drop_constraint(fk['name'], 'channel_messages', type_='foreignkey')
    op.drop_column('channel_messages', 'sent_by_admin_id')
