"""
Common Decorators
Reusable decorators for route access control and validation
"""
import logging
from functools import wraps
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, current_user

from app.common.responses import (
    unauthorized_response, forbidden_response, error_response,
    validation_error_response,
)

logger = logging.getLogger(__name__)


def role_required(roles):
    """
    Decorator to restrict access to specific user roles.
    
    Args:
        roles: Single UserRole or list of UserRoles allowed to access
    
    Usage:
        @role_required(UserRole.DOCTOR)
        def doctor_only_route():
            ...
        
        @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
        def admin_route():
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from app.models import UserRole

            # Ensure user is authenticated
            if not current_user:
                logger.debug(f"[AUTH] role_required: No authenticated user")
                return unauthorized_response('Authentication required')

            # Handle both single role and list of roles
            allowed_roles = roles if isinstance(roles, list) else [roles]

            # PLATFORM_OWNER may stand in for SUPER_ADMIN / SUB_ADMIN, but
            # only on the vendor's own tenant or under an active support
            # session — see app.common.support_access. The role alone is no
            # longer a key to every customer's data.
            if (
                current_user.role == UserRole.PLATFORM_OWNER
                and (UserRole.SUPER_ADMIN in allowed_roles or UserRole.SUB_ADMIN in allowed_roles)
            ):
                from app.common.support_access import platform_owner_may_bypass
                if platform_owner_may_bypass():
                    logger.debug(
                        f"[AUTH] role_required BYPASS: user={current_user.id} "
                        "is PLATFORM_OWNER (vendor tenant or support session)"
                    )
                    return fn(*args, **kwargs)
                return forbidden_response(
                    'Platform access to this tenant requires an active support '
                    'session.'
                )

            # A staff member whose request already cleared a staff gate acts as
            # their practice, so the role the route asks for is the practice's,
            # not theirs. Without this every delegated route would have to be
            # edited to name PROVIDER_STAFF, and naming it would ALSO admit the
            # ones no gate ever checked. The gate is what makes this safe: it
            # runs in before_request, denies anything it has no rule for, and
            # only then sets this.
            from app.common.provider_access import delegated_role
            if delegated_role() is not None and delegated_role() in allowed_roles:
                return fn(*args, **kwargs)

            # Check if user's role is in allowed roles
            if current_user.role not in allowed_roles:
                logger.debug(
                    f"[AUTH] role_required DENIED: user={current_user.id} "
                    f"role={current_user.role.value} "
                    f"required={[r.value for r in allowed_roles]}"
                )
                return forbidden_response(
                    f'Access denied. Required roles: {[r.value for r in allowed_roles]}'
                )

            logger.debug(f"[AUTH] role_required OK: user={current_user.id} role={current_user.role.value}")
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def permission_required(permissions, require_all=False, resource_id_kwarg=None):
    """
    Decorator to require specific permissions for sub-admins.
    Super admins and platform owners bypass this check entirely.
    Must be used AFTER @jwt_required() and ideally after @role_required().

    Now uses the RBAC PermissionService.check() which queries the actual
    role_permissions table (via assigned roles + overrides), instead of
    the legacy Admin.permissions JSON list.

    Args:
        permissions: Single AdminPermission or list of AdminPermission values
        require_all: If True, ALL permissions required. If False (default), ANY permission is sufficient.
        resource_id_kwarg: Optional name of a URL kwarg whose value becomes the
            ``resource_id`` passed to ``PermissionService.check``. Use this for
            instance-scoped routes (e.g. ``'module_id'`` on a landing-module
            route). When omitted, the check is module-wide.

    Usage:
        @permission_required(AdminPermission.VIEW_PATIENTS)
        def view_patients():
            ...

        @permission_required([AdminPermission.VIEW_PATIENTS, AdminPermission.VIEW_DOCTORS])
        def view_patients_or_doctors():  # User needs ANY of these
            ...

        @permission_required(AdminPermission.EDIT_LANDING_MODULE, resource_id_kwarg='module_id')
        def edit_module(module_id):  # Instance-scoped check
            ...
    """
    # Mapping from legacy AdminPermission enum values to (PermissionModule, PermissionAction)
    _LEGACY_TO_RBAC = {
        'view_patients':       ('patient_list',        'view'),
        'edit_patient_status': ('patient_list',        'edit'),
        'view_appointments':   ('appointment_list',    'view'),
        'view_doctors':        ('doctor_list',         'view'),
        'edit_doctor_status':  ('doctor_list',         'edit'),
        'verify_doctors':      ('doctor_verification', 'view'),
        'manage_login_config': ('login_page_config',   'edit'),
        'approve_field_changes': ('field_approval',    'edit'),
        'manage_publish_status': ('publish_status',    'edit'),
        # Round 9 invite add-ons. CREATE on the corresponding
        # list module — semantic: "lets the operator add new
        # rows to that list." The plan-tree gate
        # (``admin.invite_*``) runs in parallel via
        # ``@feature_required`` so a subscriber tenant whose plan
        # doesn't include the add-on is rejected by FeatureGate
        # before the permission check even runs.
        'invite_doctors':      ('doctor_list',         'create'),
        'invite_patients':     ('patient_list',        'create'),
        'invite_hospitals':    ('hospital_list',       'create'),
        'invite_clinics':      ('clinic_list',         'create'),
        # Round 10 provider-subscription management. Tenant
        # SUPER_ADMIN can delegate either capability to a
        # sub_admin via ManageSubAdmins. VIEW is read-only roster
        # visibility; MANAGE adds change-plan + cancel.
        'view_provider_subscriptions':   ('provider_subscription_list', 'view'),
        'manage_provider_subscriptions': ('provider_subscription_list', 'edit'),
    }

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from app.models import UserRole
            
            if not current_user:
                logger.debug(f"[AUTH] permission_required: No authenticated user")
                return unauthorized_response('Authentication required')

            # SUPER_ADMIN bypasses permission checks within their OWN tenant.
            # PLATFORM_OWNER additionally needs the vendor tenant or a live
            # support session. Per-tenant allocation
            # (TenantPermissionAllocation) is enforced at service-call time by
            # ``enforce_tenant_allocation`` for the modules that need it.
            if current_user.role == UserRole.PLATFORM_OWNER:
                from app.common.support_access import platform_owner_may_bypass
                if platform_owner_may_bypass():
                    logger.debug(
                        f"[AUTH] permission_required BYPASS: user={current_user.id}"
                        " is PLATFORM_OWNER (vendor tenant or support session)"
                    )
                    return fn(*args, **kwargs)
                return forbidden_response(
                    'Platform access to this tenant requires an active support '
                    'session.'
                )
            if current_user.role == UserRole.SUPER_ADMIN:
                logger.debug(f"[AUTH] permission_required BYPASS: user={current_user.id} is SUPER_ADMIN")
                return fn(*args, **kwargs)

            # For sub-admins, check admin_profile exists
            if not current_user.admin_profile:
                logger.debug(f"[AUTH] permission_required DENIED: user={current_user.id} no admin_profile")
                return forbidden_response('Admin profile not found')
            
            # Handle both single permission and list of permissions
            perm_list = permissions if isinstance(permissions, list) else [permissions]
            
            # Use the real RBAC PermissionService for checking
            from app.models import PermissionService, PermissionModule, PermissionAction
            admin_profile = current_user.admin_profile
            
            resource_id = kwargs.get(resource_id_kwarg) if resource_id_kwarg else None

            results = []
            for perm in perm_list:
                perm_value = perm.value if hasattr(perm, 'value') else perm
                mapping = _LEGACY_TO_RBAC.get(perm_value)
                if mapping:
                    module_str, action_str = mapping
                    try:
                        mod = PermissionModule(module_str)
                        act = PermissionAction(action_str)
                        results.append(PermissionService.check(
                            admin_profile, mod, act, resource_id=resource_id,
                        ))
                    except (ValueError, KeyError):
                        logger.warning(f"[AUTH] permission_required: Invalid RBAC mapping for {perm_value}")
                        results.append(False)
                else:
                    # No RBAC mapping exists for this permission — the legacy Admin.permissions
                    # column has been removed, so deny access and log an error.
                    logger.error(f"[AUTH] permission_required: No RBAC mapping for {perm_value}, denying access")
                    results.append(False)
            
            # Check based on require_all flag
            if require_all:
                has_access = all(results)
            else:
                has_access = any(results)
            
            if not has_access:
                perm_names = [p.value if hasattr(p, 'value') else p for p in perm_list]
                mode = 'all of' if require_all else 'any of'
                logger.debug(f"[AUTH] permission_required DENIED: user={current_user.id} perms={perm_names} mode={mode}")
                return forbidden_response(f'Access denied. Requires {mode}: {perm_names}')
            
            logger.debug(f"[AUTH] permission_required OK: user={current_user.id}")
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def scalar_str(value):
    """A JSON value as a stripped string, or '' when it isn't a scalar.

    For routes that read optional fields with ``(data.get(x) or '').strip()``
    — that idiom raises AttributeError (→ 500) when a client sends a
    dict/list. Use this instead: structured garbage reads as absent.
    """
    if value is None or isinstance(value, (dict, list, bool)):
        return ''
    return str(value).strip()


def validate_json(required_fields=None):
    """
    Decorator to validate request has JSON body with required fields.
    
    Args:
        required_fields: List of required field names
    
    Usage:
        @validate_json(['email', 'password'])
        def login():
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from flask import request
            
            if not request.is_json:
                logger.debug(f"[VALIDATE] validate_json FAIL: Content-Type is not application/json")
                return error_response(
                    'Content-Type must be application/json', status_code=400,
                )

            data = request.get_json()
            if not data:
                logger.debug(f"[VALIDATE] validate_json FAIL: Empty or invalid JSON body")
                return error_response(
                    'Request body must be valid JSON', status_code=400,
                )

            if required_fields:
                missing = [f for f in required_fields if f not in data or data[f] is None or data[f] == '']
                if missing:
                    logger.debug(f"[VALIDATE] validate_json FAIL: Missing fields={missing}")
                    return validation_error_response({'missing': missing})
                # Refuse structured values where a scalar belongs. Route
                # bodies do ``data.get('x', '').strip()`` everywhere — a
                # dict/list here raised AttributeError and 500'd (found by
                # the contract harness's wrong-type cases).
                non_scalar = [f for f in required_fields
                              if isinstance(data.get(f), (dict, list))]
                if non_scalar:
                    logger.debug(f"[VALIDATE] validate_json FAIL: non-scalar fields={non_scalar}")
                    return validation_error_response(
                        {f: 'Must be a string or number' for f in non_scalar})

            logger.debug(f"[VALIDATE] validate_json OK: fields={list(data.keys())}")
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def rbac_required(module, action, resource_id_kwarg=None):
    """RBAC gate that talks to :class:`PermissionService` directly.

    Unlike :func:`permission_required` (which still carries a legacy
    ``AdminPermission`` → ``PermissionModule`` mapping), this decorator takes
    the new RBAC enum values straight. Use it on new routes (landing modules,
    features) where per-instance ACL matters.

    SUPER_ADMIN bypasses within their own tenant. PLATFORM_OWNER bypasses
    only on the vendor tenant or under an active support session (see
    :mod:`app.common.support_access`). Sub-admins pass through
    :meth:`PermissionService.check` which understands instance-scoped rows.

    Args:
        module: :class:`PermissionModule` member or string
        action: :class:`PermissionAction` member or string
        resource_id_kwarg: Optional name of a route kwarg whose value is passed
            as ``resource_id`` to the permission check. When the kwarg is
            missing or falsy the check falls back to module-wide.

    Usage::

        @rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.EDIT,
                       resource_id_kwarg='module_id')
        def update_module(module_id):
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from app.models import UserRole, PermissionModule, PermissionAction, PermissionService

            if not current_user:
                return unauthorized_response('Authentication required')

            # SUPER_ADMIN is unconditional inside their own tenant. The
            # vendor is not: same support-session rule as everywhere else.
            if current_user.role == UserRole.SUPER_ADMIN:
                return fn(*args, **kwargs)
            if current_user.role == UserRole.PLATFORM_OWNER:
                from app.common.support_access import platform_owner_may_bypass
                if platform_owner_may_bypass():
                    return fn(*args, **kwargs)
                return forbidden_response(
                    'Platform access to this tenant requires an active support '
                    'session.'
                )

            if not current_user.admin_profile:
                return forbidden_response('Admin profile not found')

            try:
                mod_enum = module if isinstance(module, PermissionModule) else PermissionModule(module)
                act_enum = action if isinstance(action, PermissionAction) else PermissionAction(action)
            except (ValueError, KeyError):
                logger.error(f"[AUTH] rbac_required: invalid module/action: {module}/{action}")
                return forbidden_response('Invalid permission configuration')

            resource_id = kwargs.get(resource_id_kwarg) if resource_id_kwarg else None
            allowed = PermissionService.check(
                current_user.admin_profile, mod_enum, act_enum, resource_id=resource_id,
            )
            if not allowed:
                logger.debug(
                    f"[AUTH] rbac_required DENIED: user={current_user.id} "
                    f"module={mod_enum.value} action={act_enum.value} resource={resource_id}"
                )
                return forbidden_response(
                    f'Access denied for {mod_enum.value}:{act_enum.value}'
                    + (f' on resource {resource_id}' if resource_id else '')
                )
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def feature_required(path):
    """Ensure the caller's tenant has the given feature enabled on their plan.

    Thin wrapper around :class:`app.api.pricing.service.FeatureGate`. Limit
    checks are a separate thing — use
    :meth:`app.api.pricing.service.PlanService.require_within_limit` in
    service-layer code for seat caps.

    There is deliberately NO role-level bypass. The vendor's own tenant is
    auto-entitled inside :class:`FeatureGate` via ``Tenant.is_platform``, and
    a vendor inside a support session is held to the customer's own plan --
    support should see the product the customer actually bought.

    Returns HTTP 403 ``{"error": "feature_disabled", "feature": "..."}`` on
    deny so the frontend can route to an upgrade prompt.

    Usage::

        @patient_bp.route('/house-group', methods=['GET'])
        @jwt_required()
        @feature_required('patient.family')
        def list_family():
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from app.models import UserRole
            from app.api.pricing.service import (
                FeatureDisabled, FeatureGate, NoActiveSubscription,
            )
            from app.common.tenant_context import current_tenant_id
            from app.common.responses import error_response

            if not current_user:
                return unauthorized_response('Authentication required')

            # NO role-level bypass here, deliberately. The vendor's own
            # tenant is already auto-entitled inside FeatureGate via
            # ``Tenant.is_platform``, so the control plane still works.
            # And when the vendor is inside a support session on a customer
            # tenant, that customer's plan is exactly what should apply --
            # support should see the product the customer actually bought,
            # not a superset of it.
            tenant_id = current_tenant_id()
            if not tenant_id:
                logger.warning(
                    '[FEATURE_GATE] %s: no tenant context on request', path,
                )
                return forbidden_response('Tenant context missing')

            try:
                FeatureGate.require_feature(tenant_id, path)
            except FeatureDisabled as exc:
                return error_response(
                    'Feature disabled on your plan',
                    code='feature_disabled',
                    status_code=403,
                    data={'feature': exc.feature_path},
                )
            except NoActiveSubscription:
                return error_response(
                    'Tenant has no active subscription',
                    code='no_active_subscription',
                    status_code=402,
                )
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def tenant_allocation_required(module, action):
    """Ensure the current tenant has been allocated ``module+action`` by the
    PLATFORM_OWNER. Use this *after* @jwt_required() and @role_required() on
    endpoints under :mod:`app.api.landing_page_config` so a tenant SUPER_ADMIN
    cannot edit sections the PLATFORM_OWNER has not authorised.

    PLATFORM_OWNER passes only on the vendor tenant or under an active
    support session -- granting an allocation is a control-plane act and
    does not by itself confer access to the tenant's data.

    Args:
        module: :class:`PermissionModule` enum member or its string value.
        action: :class:`PermissionAction` enum member or its string value.
    """
    module_value = module.value if hasattr(module, 'value') else module
    action_value = action.value if hasattr(action, 'value') else action

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from app.models import UserRole, TenantPermissionAllocation

            if not current_user:
                return unauthorized_response('Authentication required')

            if current_user.role == UserRole.PLATFORM_OWNER:
                from app.common.support_access import platform_owner_may_bypass
                if platform_owner_may_bypass():
                    return fn(*args, **kwargs)
                return forbidden_response(
                    'Platform access to this tenant requires an active support '
                    'session.'
                )

            tenant_id = getattr(current_user, 'tenant_id', None)
            if not tenant_id:
                logger.warning(
                    f"[AUTH] tenant_allocation_required: user={current_user.id} has no tenant_id"
                )
                return forbidden_response('Tenant context missing')

            allocation = TenantPermissionAllocation.query.filter_by(
                tenant_id=tenant_id,
                module=module_value,
                action=action_value,
            ).first()

            if not allocation or not allocation.allowed:
                logger.debug(
                    f"[AUTH] tenant_allocation_required DENIED: tenant={tenant_id} "
                    f"module={module_value} action={action_value}"
                )
                return forbidden_response(
                    f'Your tenant is not allocated {module_value}:{action_value} '
                    f'by the platform owner.'
                )

            return fn(*args, **kwargs)
        return wrapper
    return decorator
