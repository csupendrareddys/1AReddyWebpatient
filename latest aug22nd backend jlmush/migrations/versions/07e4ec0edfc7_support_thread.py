"""support thread (superseded before shipping)

Revision ID: 07e4ec0edfc7
Revises: 658c596259cf
Create Date: 2026-08-21

Originally created a ``support_messages`` table for a text-only seller
support thread. The feature was rebuilt on the service-communication
CHANNEL stack (see bcaccfa0008d) before this ever shipped, so the
revision is a deliberate no-op kept only to preserve the local chain.
"""

# revision identifiers, used by Alembic.
revision = '07e4ec0edfc7'
down_revision = '658c596259cf'
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
