"""Add product_links_json to landing + platform landing features

Back-office "product & provider linking" per feature — records which offering
(consultation type / service / group offering), which product, and which
teams/doctors this feature routes to. NOT rendered on the public page.

Revision ID: prodlink1
Revises: 90d6f95d0e03
Create Date: 2026-07-29

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "prodlink1"
down_revision = "90d6f95d0e03"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("landing_features", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("product_links_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
        )
    with op.batch_alter_table("platform_landing_features", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("product_links_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
        )


def downgrade():
    with op.batch_alter_table("landing_features", schema=None) as batch_op:
        batch_op.drop_column("product_links_json")
    with op.batch_alter_table("platform_landing_features", schema=None) as batch_op:
        batch_op.drop_column("product_links_json")
