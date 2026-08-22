"""merge main branch with display pricing chain

Revision ID: 34b3274d7b0c
Revises: 92dd8ecdb89f, grpoff1price2ovl3
Create Date: 2026-07-27 08:30:09.198057

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '34b3274d7b0c'
# Main-side parent re-pointed from ``eeaed1b27699`` to ``92dd8ecdb89f`` (main's
# head) when this branch was rebased. The alternative — leaving it on the older
# parent and merging the two resulting heads — puts a second two-parent revision
# on the chain, and the next migration generated off it inherits the ambiguity.
# Re-parenting keeps main's head an ancestor of everything on this branch, so
# the branch has exactly one head and appends linearly after main.
down_revision = ('92dd8ecdb89f', 'grpoff1price2ovl3')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
