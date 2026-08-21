/**
 * PermissionGate — Conditionally renders children based on RBAC permissions.
 * Usage:
 *   <PermissionGate module="patient_list" action="view">
 *     <SomeProtectedComponent />
 *   </PermissionGate>
 */
import usePermissions from '../../hooks/usePermissions';

const PermissionGate = ({ module, action, fallback = null, children }) => {
    const { can, isLoading } = usePermissions();

    if (isLoading) return null;
    if (!can(module, action)) return fallback;
    return children;
};

export default PermissionGate;
