/**
 * useMyAccess — Hook for the My Access page
 * Reads the current user's permissions from the RBAC endpoint.
 */
import usePermissions from '../../../../common/hooks/usePermissions';

const useMyAccess = () => {
    const {
        isSuperAdmin,
        isPlatformOwner,
        hasFullAccess,
        permissions,
        assignedRoles,
        isLoading,
        isError,
    } = usePermissions();

    return {
        isSuperAdmin,
        isPlatformOwner,
        hasFullAccess,
        permissions,
        assignedRoles,
        isLoading,
        isError,
    };
};

export default useMyAccess;
