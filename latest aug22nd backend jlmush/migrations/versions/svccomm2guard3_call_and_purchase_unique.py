"""Race guards for Service Communication: partial-unique indexes.

An adversarial review of the call-billing path found two concurrency holes that
a Python-level check-then-insert can't close:

  * two raced joins from the SAME participant created two open ``CallSession``
    rows, so one human was billed as two connected participants;
  * two raced/retried activations both passed the "one active entitlement"
    check and minted duplicate channels.

These partial-unique indexes make the duplicate INSERT fail so the service
layer can fall back to the winner's row instead.

Chains onto this feature's own module migration (``7efb37d63ab0``) so the
Service Communication changes stay a coherent linear sub-chain — a sibling
branch to unrelated concurrent work off ``0389f9e1d9d3``, to be unified with a
merge revision when the branches merge.

Revision ID: svccomm2guard3
Revises: 7efb37d63ab0
Create Date: 2026-07-21
"""
import sqlalchemy as sa
from alembic import op


revision = 'svccomm2guard3'
down_revision = '7efb37d63ab0'
branch_labels = None
depends_on = None


def upgrade():
    # One OPEN session per participant per call.
    op.create_index(
        'ux_call_sessions_open', 'call_sessions',
        ['scheduled_call_id', 'participant_id'],
        unique=True, postgresql_where=sa.text('left_at IS NULL'),
    )
    # One ACTIVE entitlement per (patient, product, provider) per tenant.
    op.create_index(
        'ux_purchased_services_active', 'purchased_services',
        ['tenant_id', 'product_id', 'patient_id', 'provider_id'],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND is_deleted = false"),
    )


def downgrade():
    op.drop_index('ux_purchased_services_active', table_name='purchased_services')
    op.drop_index('ux_call_sessions_open', table_name='call_sessions')
