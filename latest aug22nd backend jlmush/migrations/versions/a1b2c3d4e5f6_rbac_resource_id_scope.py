"""Add ``resource_id`` column to RBAC tables for per-instance ACL.

Introduces instance-scoped permissions alongside the existing module-wide
model. ``resource_id`` is a nullable UUID:

  * ``NULL`` means "module-wide" — this row applies to every instance of the
    module. Every row created before this migration is stamped NULL and keeps
    working unchanged.
  * non-NULL scopes the grant/override to a single resource instance (e.g. one
    landing-page module UUID).

Semantics enforced by :class:`app.models.PermissionService`: precise rows
(matching ``resource_id``) win over module-wide rows at each layer
(override → role). DENY still beats GRANT at the same specificity.

The unique constraint on ``role_permissions`` is widened from
``(role_id, module)`` to ``(role_id, module, resource_id)`` so a role can hold
both a module-wide row and per-instance rows for the same module.

Revision ID: a1b2c3d4e5f6
Revises: 7a3f1c8e9b22
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '7a3f1c8e9b22'
branch_labels = None
depends_on = None


def upgrade():
    # role_permissions
    op.add_column(
        'role_permissions',
        sa.Column('resource_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.drop_constraint('uq_role_module', 'role_permissions', type_='unique')
    op.create_unique_constraint(
        'uq_role_module_resource',
        'role_permissions',
        ['role_id', 'module', 'resource_id'],
    )
    op.create_index(
        'ix_role_permissions_resource',
        'role_permissions',
        ['role_id', 'module', 'resource_id'],
    )
    op.create_index(
        'ix_role_permissions_resource_id',
        'role_permissions',
        ['resource_id'],
    )

    # admin_permission_overrides
    op.add_column(
        'admin_permission_overrides',
        sa.Column('resource_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        'ix_admin_overrides_resource',
        'admin_permission_overrides',
        ['admin_id', 'module', 'resource_id'],
    )
    op.create_index(
        'ix_admin_overrides_resource_id',
        'admin_permission_overrides',
        ['resource_id'],
    )


def downgrade():
    op.drop_index('ix_admin_overrides_resource_id', table_name='admin_permission_overrides')
    op.drop_index('ix_admin_overrides_resource', table_name='admin_permission_overrides')
    op.drop_column('admin_permission_overrides', 'resource_id')

    op.drop_index('ix_role_permissions_resource_id', table_name='role_permissions')
    op.drop_index('ix_role_permissions_resource', table_name='role_permissions')
    op.drop_constraint('uq_role_module_resource', 'role_permissions', type_='unique')
    op.create_unique_constraint('uq_role_module', 'role_permissions', ['role_id', 'module'])
    op.drop_column('role_permissions', 'resource_id')
