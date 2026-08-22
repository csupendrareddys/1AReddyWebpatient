"""Add VIDEO and THUMBNAIL values to the AssetType enum.

The landing-page video gallery uploads mp4 / webm / mov clips and a square
thumbnail image alongside each clip. Both go through the existing
``page_config_assets`` table, so the ``asset_type`` enum needs two new
values:

  * ``video``     — the uploaded clip itself (5 MB cap enforced in
                    ``S3Service.upload_file``).
  * ``thumbnail`` — the square poster image (1 MB cap, same place).

Postgres ``ALTER TYPE ... ADD VALUE`` cannot run inside a transaction, so
we use Alembic's ``autocommit_block`` context. ``IF NOT EXISTS`` makes the
upgrade idempotent in case it was applied manually before the migration
landed.

Revision ID: i9d0e1f2a3b4
Revises: e2f3a4b5c6d7
Create Date: 2026-05-03
"""
from alembic import op


revision = 'i9d0e1f2a3b4'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    # SQLAlchemy ``db.Enum(AssetType)`` serialises the Python enum NAME
    # (``'VIDEO'``, ``'THUMBNAIL'``) by default — every existing
    # ``page_config_assets`` row was written with the uppercase form (LOGO,
    # FAVICON, etc.), so we add the same casing here. The lowercase values
    # are added as a belt-and-braces measure in case any code path uses
    # ``e.value`` instead of ``e.name``.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE assettype ADD VALUE IF NOT EXISTS 'VIDEO'")
        op.execute("ALTER TYPE assettype ADD VALUE IF NOT EXISTS 'THUMBNAIL'")
        op.execute("ALTER TYPE assettype ADD VALUE IF NOT EXISTS 'video'")
        op.execute("ALTER TYPE assettype ADD VALUE IF NOT EXISTS 'thumbnail'")


def downgrade():
    # Postgres does not support removing enum values without recreating the
    # type. Leaving the values in place is harmless — the downgrade would
    # only matter if a row already used one of the new values, in which case
    # we can't safely drop them anyway. No-op is the correct behaviour.
    pass
