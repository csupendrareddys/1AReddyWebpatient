"""Group service entitlements: per-doctor legs + shared group channel.

A group offering (``MarketplaceServiceGroup``) can now mint communication
channels the same way an individual service does. Activating one for a patient
creates, in one transaction, a 1:1 entitlement/channel per serving doctor PLUS
a single shared group channel holding the patient + every doctor.

This migration adds the schema that makes that possible:

  * ``purchased_services.service_group_id`` — nullable link to the group a leg
    belongs to (NULL for ordinary individual purchases). ``ON DELETE SET NULL``
    so deleting the group definition never orphans a live entitlement.
  * ``purchased_services.kind`` / ``service_channels.kind`` — discriminators
    (individual / group_per_doctor / group_shared ; single / group).
  * The single active-entitlement guard ``ux_purchased_services_active`` is
    replaced by TWO partial-unique indexes — one for individual purchases
    (``service_group_id IS NULL``) that preserves the old semantics exactly, and
    one for group purchases keyed additionally on ``service_group_id`` + ``kind``
    so the lead doctor's per-doctor leg and shared row (same provider_id) don't
    collide. A single index folding in a nullable ``service_group_id`` can't do
    this: Postgres treats each NULL as distinct, which would defeat the guard.

No backfill: server defaults set every existing row to
``kind='individual'`` / ``'single'`` and ``service_group_id=NULL`` — exactly the
pre-migration behaviour.

Revision ID: grpsvc4chan5comm6
Revises: 2fe35abefa01
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = 'grpsvc4chan5comm6'
down_revision = '2fe35abefa01'
branch_labels = None
depends_on = None


# Created/dropped explicitly (checkfirst) so a downgrade→upgrade round-trip
# doesn't fail on a leftover / duplicate TYPE — matching the module migration's
# handling of its own owned enum types.
_purchased_kind = postgresql.ENUM(
    'individual', 'group_per_doctor', 'group_shared',
    name='purchasedservicekind',
)
_channel_kind = postgresql.ENUM(
    'single', 'group', name='servicechannelkind',
)


def upgrade():
    bind = op.get_bind()
    _purchased_kind.create(bind, checkfirst=True)
    _channel_kind.create(bind, checkfirst=True)

    # ── purchased_services: group link + kind discriminator ──────────────
    op.add_column('purchased_services', sa.Column(
        'service_group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('purchased_services', sa.Column(
        'kind',
        sa.Enum('individual', 'group_per_doctor', 'group_shared',
                name='purchasedservicekind', create_type=False),
        nullable=False, server_default='individual'))
    op.create_index('ix_purchased_services_service_group_id',
                    'purchased_services', ['service_group_id'])
    op.create_index('ix_purchased_services_kind',
                    'purchased_services', ['kind'])
    op.create_foreign_key(
        'fk_purchased_services_service_group_id',
        'purchased_services', 'marketplace_service_groups',
        ['service_group_id'], ['group_id'], ondelete='SET NULL')

    # ── service_channels: kind discriminator ─────────────────────────────
    op.add_column('service_channels', sa.Column(
        'kind',
        sa.Enum('single', 'group', name='servicechannelkind', create_type=False),
        nullable=False, server_default='single'))
    op.create_index('ix_service_channels_kind', 'service_channels', ['kind'])

    # ── Split the active-entitlement guard ───────────────────────────────
    op.drop_index('ux_purchased_services_active',
                  table_name='purchased_services')
    op.create_index(
        'ux_purchased_services_active_individual', 'purchased_services',
        ['tenant_id', 'product_id', 'patient_id', 'provider_id'],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND is_deleted = false "
            "AND service_group_id IS NULL"))
    op.create_index(
        'ux_purchased_services_active_group', 'purchased_services',
        ['tenant_id', 'service_group_id', 'patient_id', 'kind', 'provider_id'],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND is_deleted = false "
            "AND service_group_id IS NOT NULL"))


def downgrade():
    op.drop_index('ux_purchased_services_active_group',
                  table_name='purchased_services')
    op.drop_index('ux_purchased_services_active_individual',
                  table_name='purchased_services')
    op.create_index(
        'ux_purchased_services_active', 'purchased_services',
        ['tenant_id', 'product_id', 'patient_id', 'provider_id'],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND is_deleted = false"))

    op.drop_index('ix_service_channels_kind', table_name='service_channels')
    op.drop_column('service_channels', 'kind')

    op.drop_index('ix_purchased_services_kind',
                  table_name='purchased_services')
    op.drop_index('ix_purchased_services_service_group_id',
                  table_name='purchased_services')
    op.drop_column('purchased_services', 'kind')
    # Dropping the column cascades its FK — don't drop it by name, because the
    # constraint name differs between a migration-built DB and a
    # db.create_all()-bootstrapped one (which the CI migration roundtrip uses).
    op.drop_column('purchased_services', 'service_group_id')

    _channel_kind.drop(op.get_bind(), checkfirst=True)
    _purchased_kind.drop(op.get_bind(), checkfirst=True)
