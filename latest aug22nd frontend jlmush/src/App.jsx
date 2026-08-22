import { ThemeProvider, CssBaseline } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { lightTheme, darkTheme } from './theme/theme';
import AppRoutes from './route';
import SessionLimitDialog from './features/auth/components/SessionLimitDialog/SessionLimitDialog';
import VerifyEmailBanner from './features/auth/components/VerifyEmailBanner/VerifyEmailBanner';
import SocketManager from './realtime/SocketManager';
import NotificationToaster from './features/notifications/NotificationToaster';
import TenantStandingGate from './common/components/TenantStandingGate/TenantStandingGate';
import SharedSnackbar from './features/admin/AdminDashboard/components/SharedSnackbar/SharedSnackbar';
import { login, clearSessionLimit } from './features/auth/redux/authSlice';

function GlobalSessionLimitDialog() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const sessionLimitCredentials = useSelector((state) => state.auth.sessionLimitCredentials);

    const handleSessionFreed = async () => {
        if (!sessionLimitCredentials) return;
        try {
            const result = await dispatch(login(sessionLimitCredentials)).unwrap();
            dispatch(clearSessionLimit());
            // Must list every role that can sign in, not just the ones that
            // existed when this dialog was written: the fallback is the
            // PATIENT dashboard, so a missing entry doesn't fail loudly — it
            // drops the user somewhere plausible and wrong. clinic, hospital
            // and platform_owner were already missing before provider_staff
            // was added.
            const dashboardRoutes = {
                patient: '/dashboard/patient',
                doctor: '/dashboard/doctor',
                clinic: '/dashboard/clinic',
                hospital: '/dashboard/hospital',
                pharmacy: '/dashboard/pharmacy',
                diagnosis: '/dashboard/diagnosis',
                provider_staff: '/dashboard/staff',
                patient_staff: '/dashboard/patient-staff',
                super_admin: '/dashboard/admin',
                sub_admin: '/dashboard/admin',
                platform_owner: '/dashboard/admin',
            };
            navigate(dashboardRoutes[result.user.role] || '/dashboard/patient');
        } catch {
            // Let the form handle the error after dialog closes
        }
    };

    return (
        <SessionLimitDialog
            open={!!sessionLimitCredentials}
            onClose={() => dispatch(clearSessionLimit())}
            credentials={sessionLimitCredentials}
            onSuccess={handleSessionFreed}
        />
    );
}

function App() {
    const { isDarkMode } = useSelector((state) => state.theme);
    const theme = isDarkMode ? darkTheme : lightTheme;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* Real-time channel: connects on auth, drives cache refresh. Renders nothing. */}
            <SocketManager />
            {/* Corner toast for incoming in-app notifications (all roles). */}
            <NotificationToaster />
            <VerifyEmailBanner />
            {/* Whole-site wall for suspended/inactive tenants — auth +
                admin dashboard stay reachable so the admin can pay. */}
            <TenantStandingGate>
                <AppRoutes />
            </TenantStandingGate>
            {/* App-wide, not admin-only: public pages (signup, login,
                pricing) dispatch setSnackbar too, and before this was
                mounted here those errors went nowhere — a failed
                "Send code" looked like nothing happened. */}
            <SharedSnackbar />
            <GlobalSessionLimitDialog />
        </ThemeProvider>
    );
}

export default App;
