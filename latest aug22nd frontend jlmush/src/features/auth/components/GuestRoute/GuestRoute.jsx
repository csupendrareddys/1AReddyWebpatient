import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { CircularProgress, Box } from '@mui/material';

const GuestRoute = ({ children }) => {
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
                    minHeight: '200px',
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    // If authenticated, redirect to appropriate dashboard
    if (isAuthenticated && user) {
        const dashboardRoutes = {
            patient: '/dashboard/patient',
            doctor: '/dashboard/doctor',
            pharmacy: '/dashboard/pharmacy',
            diagnosis: '/dashboard/diagnosis',
            // Marketplace facility admins (Round 3+4).
            clinic: '/dashboard/clinic',
            hospital: '/dashboard/hospital',
            // A practice's own staff — same portal as their practice, own shell.
            provider_staff: '/dashboard/staff',
            patient_staff: '/dashboard/patient-staff',
            super_admin: '/dashboard/admin',
            sub_admin: '/dashboard/admin',
            // The vendor's owner was missing here, so an already-authed
            // owner opening /auth/admin/login fell through to the
            // PATIENT dashboard, got bounced by its role guard, and
            // landed back on the login page — looking like "admin login
            // doesn't redirect".
            platform_owner: '/dashboard/platform',
        };

        // Honour a ?redirect= deep-link (e.g. an already-logged-in patient
        // clicking "Book Now" on a landing feature) so they land on the
        // linked product instead of the dashboard. Same-origin absolute
        // paths only, to avoid an open redirect.
        let redirectTo = dashboardRoutes[user.role] || '/dashboard/patient';
        if (user.role === 'patient') {
            try {
                const target = new URLSearchParams(location.search).get('redirect');
                if (target && target.startsWith('/') && !target.startsWith('//')) {
                    redirectTo = target;
                }
            } catch {
                /* malformed query — keep dashboard default */
            }
        }
        return <Navigate to={redirectTo} replace />;
    }

    return children;
};

export default GuestRoute;
