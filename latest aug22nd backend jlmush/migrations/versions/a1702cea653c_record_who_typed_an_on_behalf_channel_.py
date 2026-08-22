"""Record who typed an on-behalf channel message

Adds ``channel_messages.sent_on_behalf_kind`` — 'admin' | 'staff' | NULL.

``sent_by_admin_id`` already recorded WHO posted a message on a participant's
behalf; until now that could only be a platform operator, so no discriminator
was needed. A practice's support staff can now post in their doctor's threads,
and a reader has to be able to tell the two apart.

Stored rather than derived from the author's current role: a role can change,
and that must not silently relabel what someone said months ago. Existing rows
stay NULL and are read as 'admin' (``_on_behalf_kind``), which is what they
were — nothing else could write that column before this.

Hand-trimmed. Autogenerate also swept in unrelated drift already present in the
dev database (a charge_policies tenant FK and two feature_doctors index
renames); none of it belongs to this change, so none of it is here.

Revision ID: a1702cea653c
Revises: d93376d24abd
Create Date: 2026-08-07 04:17:09.217018
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1702cea653c'
down_revision = 'd93376d24abd'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('channel_messages', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('sent_on_behalf_kind', sa.String(length=16), nullable=True),
        )


def downgrade():
    with op.batch_alter_table('channel_messages', schema=None) as batch_op:
        batch_op.drop_column('sent_on_behalf_kind')
