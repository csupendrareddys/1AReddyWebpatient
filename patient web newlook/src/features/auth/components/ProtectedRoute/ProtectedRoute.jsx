import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { CircularProgress, Box } from '@mui/material';

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
    const { isAuthenticated, isLoading, isInitialized, user } = useSelector((state) => state.auth);
    const location = useLocation();

    // Show loading while checking auth status
    if (isLoading || !isInitialized) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '100vh',
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    // Not authenticated, redirect to login
    if (!isAuthenticated) {
        // Determine which login page to redirect to based on current location
        let loginPath = '/auth/service-receiver/login';
        if (location.pathname.includes('/dashboard/admin')) {
            loginPath = '/auth/admin/login';
        } else if (
            location.pathname.includes('/dashboard/doctor') ||
            location.pathname.includes('/dashboard/pharmacy') ||
            location.pathname.includes('/dashboard/diagnosis') ||
            // Provider staff come through the same door as the practice they
            // work for — there is no separate staff portal.
            location.pathname.includes('/dashboard/staff')
        ) {
            loginPath = '/auth/service-provider/login';
        }

        return <Navigate to={loginPath} state={{ from: location }} replace />;
    }

    // First-login password gate. Auto-created accounts (the public
    // booking flow) carry ``must_set_password=true``; until they set
    // a real password we force them through ``/book/set-password``,
    // overriding any other route they tried. Skipping this only for
    // the set-password screen itself avoids an infinite redirect.
    if (user?.must_set_password && location.pathname !== '/book/set-password') {
        return <Navigate to="/book/set-password" replace />;
    }

    // Check role authorization
    if (allowedRoles.length > 0 && user && !allowedRoles.includes(user.role)) {
        // User doesn't have required role, redirect to their dashboard
        const dashboardRoutes = {
            patient: '/dashboard/patient',
            doctor: '/dashboard/doctor',
            pharmacy: '/dashboard/pharmacy',
            diagnosis: '/dashboard/diagnosis',
            provider_staff: '/dashboard/staff',
            patient_staff: '/dashboard/patient-staff',
            super_admin: '/dashboard/admin',
            sub_admin: '/dashboard/admin',
        };

        const redirectTo = dashboardRoutes[user.role] || '/';
        return <Navigate to={redirectTo} replace />;
    }

    return children;
};

export default ProtectedRoute;
