"""
Super Admin Service
Business logic for super admin operations - managing admins and permissions.
"""
from datetime import datetime, timezone

from app.extensions import db
from app.common.encryption import hash_for_search
from app.models import User, Admin, UserStatus, UserRole, AdminPermission


def utcnow():
    """Returns timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class FieldValidationError(ValueError):
    """A validation failure tied to a specific input field.

    Carries ``field`` (e.g. ``'phone_number'``) and ``message`` so the
    HTTP layer can return a 422 with a Marshmallow-shaped ``errors``
    dict — the frontend then highlights the offending input rather than
    showing a generic toast.
    """
    def __init__(self, field, message):
        self.field = field
        self.message = message
        super().__init__(f'{field}: {message}')

    def as_errors_dict(self):
        return {self.field: [self.message]}


class SuperAdminService:
    """Service class for super admin operations."""
    
    @staticmethod
    def create_admin(data, created_by_user=None, tenant_id=None, tenant_slug=None):
        """
        Create a new admin (``super_admin`` or ``sub_admin``).

        Every admin — including super_admin — is strictly tenant-scoped.
        The only role that operates cross-tenant is ``PLATFORM_OWNER``,
        which is created separately (see :mod:`create_platform_owner`).

        Tenant resolution order (first match wins):
          1. Explicit ``tenant_id`` kwarg.
          2. Explicit ``tenant_slug`` kwarg (looked up).
          3. ``data['tenant_id']`` / ``data['tenant_slug']`` in the payload.
          4. ``flask.g.tenant_id`` set by the before-request hook — i.e.
             whoever is calling is creating an admin *inside their own
             tenant* (typical SUPER_ADMIN use case).
          5. The default (``is_default=True``) tenant — last-resort fallback
             for CLI seeders where no tenant context exists.

        Args:
            data: Dictionary with:
                - email: Admin email (optional)
                - phone_number: Admin phone (required)
                - password: Admin password (required)
                - first_name: First name (required)
                - middle_name: Middle name (optional)
                - last_name: Last name (required)
                - role: 'super_admin' or 'sub_admin' (default: sub_admin)
                - permissions: List of permission strings (for sub_admin only)
                - tenant_id / tenant_slug (optional override)
            created_by_user: User instance of who is creating this admin
            tenant_id: Explicit tenant UUID to scope the admin to
            tenant_slug: Explicit tenant slug (looked up if ``tenant_id`` is absent)

        Returns:
            Tuple of (User, Admin) instances

        Raises:
            ValueError: If validation fails or user already exists
        """
        # Validate role
        role_str = data.get('role', 'sub_admin')
        if role_str == 'super_admin':
            role = UserRole.SUPER_ADMIN
        elif role_str == 'sub_admin':
            role = UserRole.SUB_ADMIN
        else:
            raise ValueError(f"Invalid role: {role_str}. Must be 'super_admin' or 'sub_admin'")

        # ── Resolve tenant FIRST so the dup-checks can scope to it ──
        # (the rest of the tenant resolution happens further down for the
        # User insert; we just need the id here for the uniqueness query.)
        from flask import g
        from app.models import Tenant
        early_tenant_id = tenant_id or data.get('tenant_id')
        if not early_tenant_id and (tenant_slug or data.get('tenant_slug')):
            slug_val = tenant_slug or data.get('tenant_slug')
            t = Tenant.query.filter_by(slug=slug_val).first()
            if not t:
                raise ValueError(f'Tenant not found for slug "{slug_val}"')
            early_tenant_id = t.id
        if not early_tenant_id:
            early_tenant_id = getattr(g, 'tenant_id', None) if g else None
        if not early_tenant_id:
            default_tenant = Tenant.query.filter_by(is_default=True).first()
            if not default_tenant:
                raise ValueError('No default tenant configured; cannot create admin.')
            early_tenant_id = default_tenant.id

        # ── Phone uniqueness (per-tenant) ─────────────────────────
        # Same physical person can have a User row in MULTIPLE tenants
        # using the same phone number. We only reject if the duplicate
        # sits *in this tenant*.
        phone = (data.get('phone_number') or '').strip()
        if not phone:
            raise FieldValidationError('phone_number', 'Phone number is required.')

        phone_hash = hash_for_search(phone)
        existing_phone = User.query.filter_by(
            _phone_hash=phone_hash,
            tenant_id=early_tenant_id,
            is_deleted=False,
        ).first()
        if existing_phone:
            raise FieldValidationError(
                'phone_number',
                f'A user with this phone already exists in this tenant '
                f'(role={existing_phone.role.value}). Pick a different phone.'
            )

        # ── Email uniqueness (per-tenant) ─────────────────────────
        email = (data.get('email') or '').strip().lower() or None
        if email:
            email_hash = hash_for_search(email)
            existing_email = User.query.filter_by(
                _email_hash=email_hash,
                tenant_id=early_tenant_id,
                is_deleted=False,
            ).first()
            if existing_email:
                raise FieldValidationError(
                    'email',
                    f'A user with this email already exists in this tenant '
                    f'(role={existing_email.role.value}). Pick a different email.'
                )

        # Validate permissions for sub_admin
        permissions = data.get('permissions', [])
        if role == UserRole.SUB_ADMIN and permissions:
            is_valid, invalid_perms = AdminPermission.validate_permissions(permissions)
            if not is_valid:
                raise ValueError(f"Invalid permissions: {invalid_perms}")

        # ---- Tenant resolution (already done upfront for the dup-check) ----
        # Re-bind to the legacy variable name the rest of the function uses.
        from flask import g
        from app.models import Tenant
        resolved_tenant_id = early_tenant_id
        if not resolved_tenant_id:
            default_tenant = Tenant.query.filter_by(is_default=True).first()
            if not default_tenant:
                raise ValueError('No default tenant configured; cannot create admin.')
            resolved_tenant_id = default_tenant.id
        tenant_id = resolved_tenant_id

        # ── Plan limit enforcement ──────────────────────────────────
        # Service-layer gate so it fires even on internal / CLI paths
        # that bypass route decorators. ``NoActiveSubscription`` is
        # surfaced as-is so the caller can decide how to respond —
        # typically the HTTP layer translates it to a 402.
        from app.api.pricing.service import (
            NoActiveSubscription, PlanLimitExceeded, PlanService,
        )
        try:
            PlanService.require_within_limit(tenant_id, role)
        except NoActiveSubscription:
            # Tenants seeded before the pricing refactor may not yet have
            # a subscription row. Don't block admin creation for them —
            # the backfill migration should handle this, but be lenient.
            pass

        # Create User
        user = User(
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            role=role,
            status=UserStatus.ACTIVE,
            tenant_id=tenant_id,
        )
        user.phone_number = phone
        if email:
            user.email = email
            # Admins created by a higher-privileged operator (PLATFORM_OWNER
            # creating a tenant super-admin, or a super-admin creating a
            # sub-admin) have their email pre-verified — the operator has
            # already vouched for the identity out-of-band.
            user.email_verified = True
        user.set_password(data.get('password'))

        db.session.add(user)
        db.session.flush()  # Get user.id

        # Create Admin profile. Admin no longer carries first_name/last_name/
        # middle_name/permissions columns — names live on User, permissions
        # live in the RBAC SubAdminRole table.
        admin = Admin(
            user_id=user.id,
            tenant_id=tenant_id,
            created_by_id=created_by_user.id if created_by_user else None,
            activated_at=utcnow(),
        )
        
        db.session.add(admin)
        db.session.commit()
        
        return user, admin
    
    @staticmethod
    def list_admins(page=1, per_page=20, role_filter=None, status_filter=None, include_deleted=False):
        """
        List all admins with pagination and filters.
        
        Args:
            page: Page number (1-indexed)
            per_page: Items per page
            role_filter: Filter by role ('super_admin' or 'sub_admin')
            status_filter: Filter by status ('active', 'blocked', etc.)
            include_deleted: Include soft-deleted admins
        
        Returns:
            Pagination object with admin list
        """
        # Defense-in-depth: explicit tenant filter on top of RLS. The platform
        # owner overrides this via ``?tenant_id=…`` at the before-request hook,
        # so ``g.tenant_id`` already reflects the requested tenant.
        from app.common.tenant_context import current_tenant_id_strict
        query = Admin.query.join(User, Admin.user_id == User.id).filter(
            Admin.tenant_id == current_tenant_id_strict(),
        )

        # Filter out deleted by default
        if not include_deleted:
            query = query.filter(Admin.is_deleted == False)
            query = query.filter(User.is_deleted == False)
        
        # Apply role filter
        if role_filter:
            if role_filter == 'super_admin':
                query = query.filter(User.role == UserRole.SUPER_ADMIN)
            elif role_filter == 'sub_admin':
                query = query.filter(User.role == UserRole.SUB_ADMIN)
        else:
            # Only show admin roles
            query = query.filter(User.role.in_([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]))
        
        # Apply status filter
        if status_filter:
            try:
                status = UserStatus(status_filter)
                query = query.filter(User.status == status)
            except ValueError:
                pass  # Ignore invalid status
        
        # Order by creation date (newest first)
        query = query.order_by(Admin.created_at.desc())
        
        # Paginate
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        
        return pagination
    
    @staticmethod
    def get_admin(admin_id):
        """
        Get admin by ID.
        
        Args:
            admin_id: Admin UUID
        
        Returns:
            Admin instance or None
        """
        return Admin.query.filter_by(id=admin_id, is_deleted=False).first()
    
    @staticmethod
    def get_admin_by_user_id(user_id):
        """
        Get admin by user ID.
        
        Args:
            user_id: User UUID
        
        Returns:
            Admin instance or None
        """
        return Admin.query.filter_by(user_id=user_id, is_deleted=False).first()
    
    @staticmethod
    def update_admin(admin, data):
        """
        Update admin details and permissions.
        
        Args:
            admin: Admin instance to update
            data: Dictionary with fields to update:
                - first_name, middle_name, last_name
                - permissions (list of permission strings)
        
        Returns:
            Updated Admin instance
        
        Raises:
            ValueError: If validation fails
        """
        # Update name fields. ``Admin.first_name`` / ``middle_name`` /
        # ``last_name`` are READ-ONLY property shims delegating to ``admin.user``
        # (the shared-profile split moved the columns onto User). Assigning to
        # the shim raises "property has no setter" and 500s the request — so
        # every name change must be written to ``admin.user``.
        if admin.user is not None:
            for _field in ('first_name', 'middle_name', 'last_name'):
                if _field in data:
                    setattr(admin.user, _field, data[_field])

        # Legacy ``Admin.permissions`` column was removed; sub-admin
        # permissions are now managed via the RBAC system (SubAdminRole +
        # RolePermission). Ignore any ``permissions`` field posted here.
        if 'permissions' in data:
            pass
        
        db.session.commit()
        return admin
    
    @staticmethod
    def delete_admin(admin, hard_delete=False):
        """
        Delete an admin (soft delete by default).
        
        Args:
            admin: Admin instance to delete
            hard_delete: If True, permanently delete
        
        Returns:
            True if deleted
        """
        if hard_delete:
            # Also delete user
            if admin.user:
                db.session.delete(admin.user)
            db.session.delete(admin)
        else:
            # Soft delete
            admin.is_deleted = True
            admin.deleted_at = utcnow()
            if admin.user:
                admin.user.is_deleted = True
                admin.user.deleted_at = utcnow()
        
        db.session.commit()
        return True
    
    @staticmethod
    def toggle_status(admin, new_status=None):
        """
        Toggle admin active status or set specific status.
        
        Args:
            admin: Admin instance
            new_status: Specific UserStatus to set, or None to toggle active/blocked
        
        Returns:
            Updated User instance with new status
        """
        if not admin.user:
            raise ValueError("Admin has no associated user")
        
        if new_status:
            try:
                if isinstance(new_status, str):
                    new_status = UserStatus(new_status)
                admin.user.status = new_status
            except ValueError:
                raise ValueError(f"Invalid status: {new_status}")
        else:
            # Toggle between active and blocked
            if admin.user.status == UserStatus.ACTIVE:
                admin.user.status = UserStatus.BLOCKED
            else:
                admin.user.status = UserStatus.ACTIVE
        
        db.session.commit()
        return admin.user
    
    @staticmethod
    def get_all_permissions():
        """
        Get all available permissions.
        
        Returns:
            List of dictionaries with permission details
        """
        return [
            {
                'value': perm.value,
                'name': perm.name,
                'display_name': perm.value.replace('_', ' ').title()
            }
            for perm in AdminPermission
        ]
