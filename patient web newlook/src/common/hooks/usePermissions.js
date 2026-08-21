/**
 * usePermissions — Hook for checking RBAC permissions.
 * Reads from the RTK Query cache (getMyPermissions endpoint).
 *
 * Role semantics (strict — no shortcuts):
 *   * ``isPlatformOwner``  — true ONLY for users whose role is literally
 *                            ``platform_owner``.
 *   * ``isSuperAdmin``     — true ONLY for users whose role is literally
 *                            ``super_admin`` (or whom the backend
 *                            ``is_super_admin`` flag explicitly tags).
 *   * ``hasFullAccess``    — derived: ``isSuperAdmin || isPlatformOwner``.
 *                            This is the boolean to use for visibility
 *                            gates and "treat as full access" semantics.
 *
 * Why the split:
 *   Conflating the two booleans bled the wrong **labels** (e.g. "SUPER ADMIN")
 *   onto platform owners across the dashboard. Now every gate that needs
 *   "full access regardless of which role provides it" uses
 *   ``hasFullAccess``; every label uses the literal ``isSuperAdmin`` /
 *   ``isPlatformOwner`` directly.
 */
import { useGetMyPermissionsQuery } from '../../features/admin/api/rbacEndpoints';
import { useSelector } from 'react-redux';

const ACTION_MAP = {
    view: 'can_view',
    create: 'can_create',
    edit: 'can_edit',
    update: 'can_update',
    delete: 'can_delete',
    l1_verifier: 'can_l1_verify',
    l2_verifier: 'can_l2_verify',
    l3_verifier: 'can_l3_verify',
    lock: 'can_lock',
    unlock: 'can_unlock',
    full_access: 'full_access',
};

const usePermissions = () => {
    const { user } = useSelector((state) => state.auth);
    const isPlatformOwner = user?.role === 'platform_owner';
    const isAdmin = isPlatformOwner
        || user?.role === 'super_admin'
        || user?.role === 'sub_admin';

    // Skip the RBAC fetch for platform owners (they don't have rows in
    // the per-tenant permissions tables) and non-admins.
    const {
        data: permData,
        isLoading,
        isError,
    } = useGetMyPermissionsQuery(undefined, { skip: !isAdmin || isPlatformOwner });

    // STRICT — only the literal super_admin role.
    const isSuperAdmin =
        permData?.is_super_admin || user?.role === 'super_admin';

    // Use this for "full access regardless of role" gates.
    const hasFullAccess = isSuperAdmin || isPlatformOwner;

    const permissions = permData?.permissions || {};
    const assignedRoles = permData?.assigned_roles || [];

    /**
     * Check if user has a specific permission.
     * PLATFORM_OWNER and SUPER_ADMIN always pass (via hasFullAccess).
     *
     * Instance-specific rows win over module-wide rows when both exist. The
     * backend serializes instance-scoped permissions under
     * ``permissions[module].instances[resource_id]`` (shape parallel to the
     * module-wide row). If ``instanceId`` is provided and no instance-specific
     * row exists, we fall back to the module-wide row.
     *
     * @param {string} module    - e.g. 'patient_list' or 'landing_module'
     * @param {string} action    - e.g. 'view', 'edit', 'delete'
     * @param {string} [instanceId] - Optional resource UUID for instance-scoped modules
     * @returns {boolean}
     */
    const can = (module, action, instanceId) => {
        if (hasFullAccess) return true;
        const field = ACTION_MAP[action] || `can_${action}`;
        const modulePerms = permissions[module];
        if (!modulePerms) return false;
        if (instanceId) {
            const instancePerms = modulePerms.instances?.[instanceId];
            if (instancePerms && instancePerms[field] !== undefined) {
                return !!instancePerms[field];
            }
        }
        return !!modulePerms[field];
    };

    /**
     * Check if user has any of the specified actions on a module.
     * @param {string} module
     * @param {string[]} actions
     * @param {string} [instanceId] - Optional resource UUID for instance-scoped modules
     * @returns {boolean}
     */
    const canAny = (module, actions, instanceId) => {
        if (hasFullAccess) return true;
        return actions.some((action) => can(module, action, instanceId));
    };

    /**
     * Get data range for a specific module.
     * @param {string} module
     * @returns {string|null}
     */
    const getDataRange = (module) => {
        if (hasFullAccess) return 'ALL';
        return permissions[module]?.data_range || null;
    };

    /**
     * Check whether the tenant's resolved subscription plan + add-ons
     * include a specific feature path. Backend-authoritative — values
     * come from ``/auth/me``'s ``tenant_context.feature_paths`` array,
     * which the backend computes via ``PlanService.resolve(tenant_id)``
     * and the same data drives ``@feature_required`` route decorators.
     *
     * Rules:
     *   * PLATFORM_OWNER always passes (they administer plans; gating
     *     them out would be self-defeating).
     *   * Default-tenant context has no plan resolution — we treat it
     *     as "all features allowed" so the platform-owner UI on the
     *     default tenant works normally.
     *   * Otherwise consult the resolved feature_paths list. Missing
     *     list (older /auth/me, hop in flight) → fail-OPEN so we don't
     *     accidentally lock everyone out of admin during a deploy.
     *     Backend's @feature_required is the actual security boundary;
     *     this is UX gating only.
     *
     * Usage::
     *
     *     const { hasFeature } = usePermissions();
     *     visible: hasFeature('admin.landing_builder')
     *
     * @param {string} featurePath  e.g. 'admin.landing_builder'
     * @returns {boolean}
     */
    const hasFeature = (featurePath) => {
        if (isPlatformOwner) return true;
        const ctx = user?.tenant_context;
        if (!ctx) return true;                      // no /auth/me yet
        if (ctx.is_default_tenant) return true;     // platform-default tenant
        const list = ctx.feature_paths;
        if (!Array.isArray(list)) return true;      // missing → fail-open
        if (list.includes(featurePath)) return true;
        // Legacy ``clinic.*`` ↔ new ``organization.*`` alias bridge.
        // The backend resolver mirrors truthy leaves between the two
        // prefixes (see PlanService._apply_organization_clinic_alias),
        // so under normal operation either spelling is present in the
        // resolved feature_paths array. This second check is belt-and-
        // suspenders for the deploy-hop window when the backend hasn't
        // been bumped yet but the frontend already reads the new path.
        if (featurePath.startsWith('organization.')) {
            const aliased = 'clinic.' + featurePath.slice('organization.'.length);
            if (list.includes(aliased)) return true;
        } else if (featurePath.startsWith('clinic.')) {
            const aliased = 'organization.' + featurePath.slice('clinic.'.length);
            if (list.includes(aliased)) return true;
        }
        return false;
    };

    return {
        can,
        canAny,
        getDataRange,
        hasFeature,
        isSuperAdmin,
        isPlatformOwner,
        hasFullAccess,
        permissions,
        assignedRoles,
        featurePaths: user?.tenant_context?.feature_paths || [],
        planCode: user?.tenant_context?.plan_code || null,
        isLoading,
        isError,
    };
};

export default usePermissions;
