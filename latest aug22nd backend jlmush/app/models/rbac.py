"""
RBAC (Role-Based Access Control) Models.
Role, RolePermission, SubAdminRole, AdminPermissionOverride, PermissionService, seed_default_roles.
"""
import uuid
from datetime import timedelta

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, AuditMixin, TimestampMixin, SoftDeleteMixin, utcnow
from app.models._enums import (
    PermissionAction, PermissionModule, DataRange, RoleLevel, OverrideType,
)


# ============================================================================
# ROLE MODEL
# ============================================================================

class Role(TenantMixin,TimestampMixin,SoftDeleteMixin,AuditMixin, db.Model):
    """
    Named role with a description.
    Each role aggregates many RolePermission entries.
    A role can be cloned.
    """
    __tablename__ = 'roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='role_id')

    name = db.Column(db.String(200), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    level = db.Column(db.Integer, nullable=True)

    is_system = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    # Relationships
    permissions = db.relationship(
        'RolePermission',
        back_populates='role',
        cascade='all, delete-orphan',
        lazy='dynamic'
    )
    sub_admin_assignments = db.relationship(
        'SubAdminRole',
        back_populates='role',
        cascade='all, delete-orphan',
        lazy='dynamic'
    )
    # ``created_by_id`` comes from ``AuditMixin``; mixin attributes aren't
    # visible in this class body's local scope, so reference by string path.
    created_by = db.relationship('User', foreign_keys='Role.created_by_id')

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'name', name='uq_role_tenant_name'),
        Index('ix_roles_active', 'tenant_id', 'is_active', postgresql_where=text('is_deleted = FALSE')),
    )

    def has_permission(self, module, action, resource_id=None):
        """Check if this role grants ``action`` on ``module``.

        Instance-specific rows (``resource_id`` matches) take precedence over
        module-wide rows (``resource_id`` IS NULL). If no matching row is found
        at either specificity, returns False.
        """
        try:
            if not isinstance(module, PermissionModule):
                module = PermissionModule(module)
        except (ValueError, KeyError):
            return False

        action_val = action.value if isinstance(action, PermissionAction) else action

        perm = None
        if resource_id is not None:
            perm = self.permissions.filter_by(
                module=module, resource_id=resource_id, is_active=True,
            ).first()
        if perm is None:
            perm = self.permissions.filter_by(
                module=module, resource_id=None, is_active=True,
            ).first()

        if not perm:
            return False

        if perm.full_access:
            return True

        action_map = {
            'view': perm.can_view,
            'create': perm.can_create,
            'edit': perm.can_edit,
            'update': perm.can_update,
            'delete': perm.can_delete,
            'l1_verifier': perm.can_l1_verify,
            'l2_verifier': perm.can_l2_verify,
            'l3_verifier': perm.can_l3_verify,
            'lock': perm.can_lock,
            'unlock': perm.can_unlock,
            'full_access': perm.full_access,
        }
        return action_map.get(action_val, False)

    def get_data_range(self, module, resource_id=None):
        """Get the data range restriction for a module (optionally scoped to an instance)."""
        try:
            if not isinstance(module, PermissionModule):
                module = PermissionModule(module)
        except (ValueError, KeyError):
            return None

        perm = None
        if resource_id is not None:
            perm = self.permissions.filter_by(
                module=module, resource_id=resource_id, is_active=True,
            ).first()
        if perm is None:
            perm = self.permissions.filter_by(
                module=module, resource_id=None, is_active=True,
            ).first()
        return perm.data_range if perm else None

    def clone(self, new_name, created_by_id=None):
        """
        Clone this role with a new name.
        Returns a new unsaved Role instance.
        """
        new_role = Role(
            name=new_name,
            description=f"Cloned from: {self.name}",
            level=self.level,
            is_system=False,
            created_by_id=created_by_id,
        )
        for perm in self.permissions.filter_by(is_active=True).all():
            new_perm = RolePermission(
                module=perm.module,
                resource_id=perm.resource_id,
                full_access=perm.full_access,
                can_view=perm.can_view,
                can_create=perm.can_create,
                can_edit=perm.can_edit,
                can_update=perm.can_update,
                can_delete=perm.can_delete,
                can_l1_verify=perm.can_l1_verify,
                can_l2_verify=perm.can_l2_verify,
                can_l3_verify=perm.can_l3_verify,
                can_lock=perm.can_lock,
                can_unlock=perm.can_unlock,
                data_range=perm.data_range,
            )
            new_role.permissions.append(new_perm)
        return new_role

    def to_dict(self, include_permissions=False):
        data = {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'level': self.level,
            'is_system': self.is_system,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_permissions:
            data['permissions'] = [
                p.to_dict() for p in self.permissions.filter_by(is_active=True).all()
            ]
        return data

    def __repr__(self):
        return f"<Role {self.name} (Level {self.level})>"


# ============================================================================
# ROLE PERMISSION MODEL
# ============================================================================

class RolePermission(TenantMixin,TimestampMixin, db.Model):
    """One row per (role, module, resource_id) combination — the permission matrix.

    ``resource_id`` is nullable. ``NULL`` means "module-wide": this row grants the
    permission on every instance of the module. A non-NULL ``resource_id`` scopes
    the grant to a single resource instance (e.g. one dynamic landing module).
    Instance-specific rows take precedence over module-wide rows when both exist.
    """
    __tablename__ = 'role_permissions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='permission_id')
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('roles.role_id', ondelete='CASCADE'), nullable=False, index=True)

    module = db.Column(db.Enum(PermissionModule), nullable=False, index=True)
    resource_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)

    # Permission checkboxes
    full_access = db.Column(db.Boolean, default=False, nullable=False)
    can_view = db.Column(db.Boolean, default=False, nullable=False)
    can_create = db.Column(db.Boolean, default=False, nullable=False)
    can_edit = db.Column(db.Boolean, default=False, nullable=False)
    can_update = db.Column(db.Boolean, default=False, nullable=False)
    can_delete = db.Column(db.Boolean, default=False, nullable=False)

    # Verification level permissions
    can_l1_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l2_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l3_verify = db.Column(db.Boolean, default=False, nullable=False)

    # Account control
    can_lock = db.Column(db.Boolean, default=False, nullable=False)
    can_unlock = db.Column(db.Boolean, default=False, nullable=False)

    data_range = db.Column(db.Enum(DataRange), default=DataRange.ALL, nullable=False)

    field_restrictions = db.Column(JSON, nullable=True)
    updated_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    # Relationship
    role = db.relationship('Role', back_populates='permissions')
    updated_by = db.relationship('User', foreign_keys=[updated_by_id])

    __table_args__ = (
        db.UniqueConstraint('role_id', 'module', 'resource_id', name='uq_role_module_resource'),
        Index('ix_role_permissions_tenant_role_module', 'tenant_id', 'role_id', 'module'),
        Index('ix_role_permissions_resource', 'role_id', 'module', 'resource_id'),
    )

    def validate_dependencies(self):
        """
        Validate that permission combinations are logically consistent.
        Returns (is_valid, list_of_warnings).
        """
        if self.full_access:
            return True, []

        warnings = []

        if (self.can_edit or self.can_update or self.can_create or self.can_delete) and not self.can_view:
            warnings.append("edit/update/create/delete require view permission")
            self.can_view = True

        if self.can_update and not self.can_edit:
            warnings.append("update (sensitive fields) requires edit (basic fields)")
            self.can_edit = True

        if self.can_l2_verify and not self.can_l1_verify:
            warnings.append("L2 verification requires L1 verification")
            self.can_l1_verify = True
        if self.can_l3_verify and not self.can_l2_verify:
            warnings.append("L3 verification requires L2 verification")
            self.can_l2_verify = True
            if not self.can_l1_verify:
                self.can_l1_verify = True

        if (self.can_lock or self.can_unlock) and not self.can_view:
            warnings.append("lock/unlock require view permission")
            self.can_view = True

        return len(warnings) == 0, warnings

    def set_full_access(self, confirmed=False):
        """
        Require explicit confirmation before granting full_access.
        Usage: perm.set_full_access(confirmed=True)
        """
        if not confirmed:
            raise ValueError(
                "full_access grants ALL permissions on this module. "
                "Pass confirmed=True to confirm this is intentional."
            )
        self.full_access = True

    def to_dict(self):
        return {
            'id': str(self.id),
            'role_id': str(self.role_id),
            'module': self.module.value,
            'resource_id': str(self.resource_id) if self.resource_id else None,
            'full_access': self.full_access,
            'can_view': self.can_view,
            'can_create': self.can_create,
            'can_edit': self.can_edit,
            'can_update': self.can_update,
            'can_delete': self.can_delete,
            'can_l1_verify': self.can_l1_verify,
            'can_l2_verify': self.can_l2_verify,
            'can_l3_verify': self.can_l3_verify,
            'can_lock': self.can_lock,
            'can_unlock': self.can_unlock,
            'data_range': self.data_range.name if self.data_range else None,
            'data_range_days': self.data_range.value if self.data_range else None,
            'data_range_label': self.data_range.label if self.data_range else None,
            'field_restrictions': self.field_restrictions,
        }

    def __repr__(self):
        scope = f" resource={self.resource_id}" if self.resource_id else ""
        return f"<RolePermission {self.module.value}{scope} for role {self.role_id}>"


# ============================================================================
# SUB-ADMIN ROLE ASSIGNMENT
# ============================================================================

class SubAdminRole(TenantMixin, db.Model):
    """Links an Admin user to one or more Roles."""
    __tablename__ = 'sub_admin_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id = db.Column(UUID(as_uuid=True), db.ForeignKey('admins.admin_id', ondelete='CASCADE'), nullable=False, index=True)
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('roles.role_id', ondelete='CASCADE'), nullable=False, index=True)

    assigned_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    assigned_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    deactivated_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    admin = db.relationship('Admin', backref=db.backref('role_assignments', lazy='dynamic', cascade='all, delete-orphan'))
    role = db.relationship('Role', back_populates='sub_admin_assignments')
    assigned_by = db.relationship('User', foreign_keys=[assigned_by_id])

    __table_args__ = (
        db.UniqueConstraint('admin_id', 'role_id', name='uq_admin_role'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'admin_id': str(self.admin_id),
            'role_id': str(self.role_id),
            'name': self.role.name if self.role else None,
            'role_name': self.role.name if self.role else None,
            'role_level': self.role.level if self.role else None,
            'assigned_at': self.assigned_at.isoformat() if self.assigned_at else None,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<SubAdminRole admin={self.admin_id} role={self.role_id}>"


# ============================================================================
# ADMIN PERMISSION OVERRIDE
# ============================================================================

class AdminPermissionOverride(TenantMixin, db.Model):
    """
    Per-admin permission overrides that sit ON TOP of role-based permissions.

    Resolution order (checked by PermissionService):
        1. DENY overrides → blocked (regardless of role)
        2. GRANT overrides → allowed (regardless of role)
        3. Fall back to role-based check
    """
    __tablename__ = 'admin_permission_overrides'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='override_id')
    admin_id = db.Column(UUID(as_uuid=True), db.ForeignKey('admins.admin_id', ondelete='CASCADE'), nullable=False, index=True)

    module = db.Column(db.Enum(PermissionModule), nullable=False, index=True)
    resource_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    override_type = db.Column(db.Enum(OverrideType), nullable=False)

    full_access = db.Column(db.Boolean, default=False, nullable=False)
    can_view = db.Column(db.Boolean, default=False, nullable=False)
    can_create = db.Column(db.Boolean, default=False, nullable=False)
    can_edit = db.Column(db.Boolean, default=False, nullable=False)
    can_update = db.Column(db.Boolean, default=False, nullable=False)
    can_delete = db.Column(db.Boolean, default=False, nullable=False)
    can_l1_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l2_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l3_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_lock = db.Column(db.Boolean, default=False, nullable=False)
    can_unlock = db.Column(db.Boolean, default=False, nullable=False)

    data_range = db.Column(db.Enum(DataRange), nullable=True)

    reason = db.Column(db.Text, nullable=False)
    created_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    deactivated_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    admin = db.relationship('Admin', backref=db.backref('permission_overrides', lazy='dynamic', cascade='all, delete-orphan'))
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    __table_args__ = (
        Index('ix_admin_overrides_tenant_admin_module', 'tenant_id', 'admin_id', 'module'),
        Index('ix_admin_overrides_tenant_active', 'tenant_id', 'admin_id', 'is_active'),
        Index('ix_admin_overrides_resource', 'admin_id', 'module', 'resource_id'),
    )

    def is_expired(self):
        """Check if this override has expired."""
        if not self.expires_at:
            return False
        expiry = self.expires_at
        if expiry.tzinfo is None:
            from datetime import timezone
            expiry = expiry.replace(tzinfo=timezone.utc)
        return utcnow() > expiry

    def is_effective(self):
        """Check if this override is currently in effect."""
        return self.is_active and not self.is_expired()

    def get_action_value(self, action_key):
        """Get the boolean value for a specific action."""
        action_map = {
            'view': self.can_view,
            'create': self.can_create,
            'edit': self.can_edit,
            'update': self.can_update,
            'delete': self.can_delete,
            'l1_verifier': self.can_l1_verify,
            'l2_verifier': self.can_l2_verify,
            'l3_verifier': self.can_l3_verify,
            'lock': self.can_lock,
            'unlock': self.can_unlock,
            'full_access': self.full_access,
        }
        return action_map.get(action_key, False)

    def deactivate(self):
        """Deactivate this override."""
        self.is_active = False
        self.deactivated_at = utcnow()

    def to_dict(self):
        return {
            'id': str(self.id),
            'admin_id': str(self.admin_id),
            'module': self.module.value,
            'resource_id': str(self.resource_id) if self.resource_id else None,
            'override_type': self.override_type.value,
            'full_access': self.full_access,
            'can_view': self.can_view,
            'can_create': self.can_create,
            'can_edit': self.can_edit,
            'can_update': self.can_update,
            'can_delete': self.can_delete,
            'can_l1_verify': self.can_l1_verify,
            'can_l2_verify': self.can_l2_verify,
            'can_l3_verify': self.can_l3_verify,
            'can_lock': self.can_lock,
            'can_unlock': self.can_unlock,
            'data_range': self.data_range.name if self.data_range else None,
            'data_range_days': self.data_range.value if self.data_range else None,
            'reason': self.reason,
            'created_by_id': str(self.created_by_id) if self.created_by_id else None,
            'is_active': self.is_active,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'is_expired': self.is_expired(),
            'is_effective': self.is_effective(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        scope = f" resource={self.resource_id}" if self.resource_id else ""
        return f"<AdminPermissionOverride {self.override_type.value} {self.module.value}{scope} for admin={self.admin_id}>"


# ============================================================================
# PERMISSION SERVICE
# ============================================================================

class PermissionService:
    """
    Service class for checking permissions.

    Resolution order:
        1. Super admin → always True
        2. DENY overrides → if active DENY override exists → False
        3. GRANT overrides → if active GRANT override exists → True
        4. Role-based check → union of all assigned roles

    DENY always wins over GRANT.
    """

    _ACTION_TO_COLUMN = {
        'view': 'can_view',
        'create': 'can_create',
        'edit': 'can_edit',
        'update': 'can_update',
        'delete': 'can_delete',
        'l1_verifier': 'can_l1_verify',
        'l2_verifier': 'can_l2_verify',
        'l3_verifier': 'can_l3_verify',
        'lock': 'can_lock',
        'unlock': 'can_unlock',
        'full_access': 'full_access',
    }

    @staticmethod
    def _get_active_overrides(admin, module, resource_id=None):
        """Get active, non-expired overrides for an admin on a specific module.

        Returns two lists of (override, is_precise) tuples where ``is_precise``
        indicates the override was matched on ``resource_id`` (rather than being
        a module-wide fallback). Instance-specific matches are returned first in
        each list so callers can short-circuit on the most specific rule.
        """
        q = admin.permission_overrides.filter_by(module=module, is_active=True)
        if resource_id is not None:
            q = q.filter(
                db.or_(
                    AdminPermissionOverride.resource_id == resource_id,
                    AdminPermissionOverride.resource_id.is_(None),
                )
            )
        else:
            q = q.filter(AdminPermissionOverride.resource_id.is_(None))

        deny = []
        grant = []
        for ov in q.all():
            if ov.is_expired():
                continue
            is_precise = (resource_id is not None and ov.resource_id == resource_id)
            bucket = deny if ov.override_type == OverrideType.DENY else grant
            if ov.override_type not in (OverrideType.DENY, OverrideType.GRANT):
                continue
            bucket.append((ov, is_precise))

        # precise rules first
        deny.sort(key=lambda t: not t[1])
        grant.sort(key=lambda t: not t[1])
        return deny, grant

    @staticmethod
    def check(admin, module, action, resource_id=None):
        """
        Check if an admin has permission for ``module`` + ``action``.

        When ``resource_id`` is given, instance-specific rows win over module-wide
        rows at each layer (override → role). At the override layer, DENY beats
        GRANT at the *same* specificity; a precise GRANT can still override a
        module-wide DENY. Role-based evaluation uses precise rows first, else the
        module-wide row.

        Args:
            admin: Admin model instance
            module: PermissionModule enum (or string value)
            action: PermissionAction enum (or string value)
            resource_id: Optional UUID of a specific resource instance
        Returns:
            bool
        """
        from app.models._enums import UserRole

        if admin.user and admin.user.role in (UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER):
            return True

        action_val = action.value if hasattr(action, 'value') else action
        col_name = PermissionService._ACTION_TO_COLUMN.get(action_val)
        if not col_name:
            return False

        deny_overrides, grant_overrides = PermissionService._get_active_overrides(
            admin, module, resource_id=resource_id,
        )

        def _matches(ov):
            return getattr(ov, col_name, False) or ov.full_access

        precise_deny = any(_matches(ov) for ov, is_precise in deny_overrides if is_precise)
        if precise_deny:
            return False
        precise_grant = any(_matches(ov) for ov, is_precise in grant_overrides if is_precise)
        if precise_grant:
            return True
        module_deny = any(_matches(ov) for ov, is_precise in deny_overrides if not is_precise)
        if module_deny:
            return False
        module_grant = any(_matches(ov) for ov, is_precise in grant_overrides if not is_precise)
        if module_grant:
            return True

        for assignment in admin.role_assignments.filter_by(is_active=True).all():
            if assignment.role and assignment.role.is_active and not assignment.role.is_deleted:
                if assignment.role.has_permission(module, action, resource_id=resource_id):
                    return True

        return False

    @staticmethod
    def get_effective_permissions(admin):
        """
        Get the merged/effective permissions for an admin across all assigned roles,
        WITH overrides applied on top.
        """
        from app.models._enums import UserRole

        effective = {}

        if admin.user and admin.user.role in (UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER):
            source_label = 'platform_owner' if admin.user.role == UserRole.PLATFORM_OWNER else 'super_admin'
            for mod in PermissionModule:
                effective[mod.value] = {
                    'full_access': True,
                    'can_view': True, 'can_create': True, 'can_edit': True,
                    'can_update': True, 'can_delete': True,
                    'can_l1_verify': True, 'can_l2_verify': True, 'can_l3_verify': True,
                    'can_lock': True, 'can_unlock': True,
                    'data_range': DataRange.ALL,
                    'data_range_label': 'All Time',
                    'source': source_label,
                    'overrides': {'has_grants': False, 'has_denies': False},
                }
            return effective

        def _blank_entry(data_range=None, source='role'):
            return {
                'full_access': False,
                'can_view': False, 'can_create': False, 'can_edit': False,
                'can_update': False, 'can_delete': False,
                'can_l1_verify': False, 'can_l2_verify': False, 'can_l3_verify': False,
                'can_lock': False, 'can_unlock': False,
                'data_range': data_range if data_range else DataRange.ALL,
                'data_range_label': data_range.label if data_range else 'All Time',
                'source': source,
                'overrides': {'has_grants': False, 'has_denies': False,
                              'grant_details': [], 'deny_details': []},
            }

        def _target_entry(mod_key, perm_resource_id):
            """Resolve the module-wide entry or the instance sub-entry for this row."""
            if mod_key not in effective:
                effective[mod_key] = _blank_entry()
                effective[mod_key]['instances'] = {}
            ex = effective[mod_key]
            ex.setdefault('instances', {})
            if perm_resource_id is None:
                return ex
            key = str(perm_resource_id)
            if key not in ex['instances']:
                ex['instances'][key] = _blank_entry(source='role')
            return ex['instances'][key]

        # Step 1: Build base from roles (union) — module-wide and per-instance
        for assignment in admin.role_assignments.filter_by(is_active=True).all():
            if not assignment.role or not assignment.role.is_active:
                continue
            for perm in assignment.role.permissions.filter_by(is_active=True).all():
                target = _target_entry(perm.module.value, perm.resource_id)
                target['full_access'] = target['full_access'] or perm.full_access
                for col in ('can_view', 'can_create', 'can_edit', 'can_update', 'can_delete',
                            'can_l1_verify', 'can_l2_verify', 'can_l3_verify', 'can_lock', 'can_unlock'):
                    target[col] = target[col] or getattr(perm, col, False) or perm.full_access
                target['data_range'] = PermissionService._wider_range(
                    target['data_range'],
                    perm.data_range if perm.data_range else DataRange.ALL,
                )
                target['data_range_label'] = (
                    target['data_range'].label
                    if isinstance(target['data_range'], DataRange) else 'All Time'
                )

        # Step 2: Apply overrides on top (also scoped)
        for ov in admin.permission_overrides.filter_by(is_active=True).all():
            if ov.is_expired():
                continue

            target = _target_entry(ov.module.value, ov.resource_id)
            ov_summary = {
                'id': str(ov.id),
                'reason': ov.reason,
                'expires_at': ov.expires_at.isoformat() if ov.expires_at else None,
                'resource_id': str(ov.resource_id) if ov.resource_id else None,
            }

            if ov.override_type == OverrideType.GRANT:
                target['overrides']['has_grants'] = True
                target['overrides'].setdefault('grant_details', []).append(ov_summary)
                for col in ('full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                            'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify',
                            'can_lock', 'can_unlock'):
                    if getattr(ov, col, False):
                        target[col] = True
                if ov.data_range:
                    target['data_range'] = PermissionService._wider_range(target['data_range'], ov.data_range)
                    target['data_range_label'] = (
                        target['data_range'].label
                        if isinstance(target['data_range'], DataRange) else 'All Time'
                    )

            elif ov.override_type == OverrideType.DENY:
                target['overrides']['has_denies'] = True
                target['overrides'].setdefault('deny_details', []).append(ov_summary)
                for col in ('full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                            'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify',
                            'can_lock', 'can_unlock'):
                    if getattr(ov, col, False):
                        target[col] = False

        return effective

    @staticmethod
    def get_date_filter(admin, module):
        """
        Get the earliest date this admin can access data for a module.
        Returns a datetime or None (no restriction).
        """
        from app.models._enums import UserRole

        if admin.user and admin.user.role in (UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER):
            return None

        widest_range = None

        for assignment in admin.role_assignments.filter_by(is_active=True).all():
            if not assignment.role or not assignment.role.is_active:
                continue
            dr = assignment.role.get_data_range(module)
            if dr:
                widest_range = PermissionService._wider_range(widest_range, dr)

        _, grant_overrides = PermissionService._get_active_overrides(admin, module)
        for ov in grant_overrides:
            if ov.data_range:
                widest_range = PermissionService._wider_range(widest_range, ov.data_range)

        return PermissionService._range_to_date(widest_range)

    @staticmethod
    def get_override_summary(admin):
        """Get a summary of all active overrides for an admin."""
        overrides = admin.permission_overrides.filter_by(is_active=True).all()
        active = [ov.to_dict() for ov in overrides if ov.is_effective()]
        expired = [ov.to_dict() for ov in overrides if ov.is_expired()]
        return {
            'active_count': len(active),
            'expired_count': len(expired),
            'active': active,
            'expired': expired,
        }

    @staticmethod
    def _wider_range(range_a, range_b):
        """Compare two DataRange values and return the wider one."""
        if range_a is None:
            return range_b
        if range_b is None:
            return range_a

        days_a = range_a.value if isinstance(range_a, DataRange) else (range_a if isinstance(range_a, int) else DataRange.ALL.value)
        days_b = range_b.value if isinstance(range_b, DataRange) else (range_b if isinstance(range_b, int) else DataRange.ALL.value)

        return range_a if days_a >= days_b else range_b

    @staticmethod
    def _range_to_date(range_value):
        """Convert a DataRange to a cutoff datetime. Returns None for ALL."""
        if range_value is None:
            return None

        if isinstance(range_value, DataRange):
            days = range_value.value
        elif isinstance(range_value, int):
            days = range_value
        else:
            return None

        if days >= 99999:
            return None

        return utcnow() - timedelta(days=days)


# ============================================================================
# SEED DATA HELPER
# ============================================================================

def seed_default_roles():
    """
    Create the 5 default role levels if they don't exist.
    Call this in your app initialization or migration script.
    """
    defaults = [
        {
            'name': 'Data Analysis Team',
            'description': 'Level 1 – View-only access for data analysis',
            'level': 1,
            'is_system': True,
            'actions': {'can_view': True},
        },
        {
            'name': 'Operational Team Junior',
            'description': 'Level 2 – View + Edit basic fields, L1 verification',
            'level': 2,
            'is_system': True,
            'actions': {'can_view': True, 'can_edit': True, 'can_l1_verify': True},
        },
        {
            'name': 'Operational Team Senior',
            'description': 'Level 3 – View + Edit + Update sensitive fields, L2 verification',
            'level': 3,
            'is_system': True,
            'actions': {'can_view': True, 'can_edit': True, 'can_update': True, 'can_l2_verify': True},
        },
        {
            'name': 'Senior Manager',
            'description': 'Level 4 – View + Edit + Update + Create, L3 verification',
            'level': 4,
            'is_system': True,
            'actions': {'can_view': True, 'can_edit': True, 'can_update': True, 'can_create': True, 'can_l3_verify': True},
        },
        {
            'name': 'Full Access Admin',
            'description': 'Level 5 – Full access including delete',
            'level': 5,
            'is_system': True,
            'actions': {'full_access': True},
        },
    ]

    created_roles = []
    for role_data in defaults:
        existing = Role.query.filter_by(name=role_data['name']).first()
        if existing:
            created_roles.append(existing)
            continue

        role = Role(
            name=role_data['name'],
            description=role_data['description'],
            level=role_data['level'],
            is_system=role_data['is_system'],
        )
        db.session.add(role)
        db.session.flush()

        actions = role_data['actions']
        for module in PermissionModule:
            perm = RolePermission(
                role_id=role.id,
                module=module,
                full_access=actions.get('full_access', False),
                can_view=actions.get('can_view', False),
                can_create=actions.get('can_create', False),
                can_edit=actions.get('can_edit', False),
                can_update=actions.get('can_update', False),
                can_delete=actions.get('can_delete', False),
                can_l1_verify=actions.get('can_l1_verify', False),
                can_l2_verify=actions.get('can_l2_verify', False),
                can_l3_verify=actions.get('can_l3_verify', False),
                can_lock=actions.get('can_lock', False),
                can_unlock=actions.get('can_unlock', False),
                data_range=DataRange.ALL,
            )
            db.session.add(perm)

        created_roles.append(role)

    db.session.commit()
    return created_roles
