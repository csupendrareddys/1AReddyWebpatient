import { Box, Alert } from '@mui/material';
import useAdminDashboard from '../../hooks/useAdminDashboard';
import WelcomeCard from '../../components/WelcomeCard/WelcomeCard';
import ActionCardGrid from '../../components/ActionCardGrid/ActionCardGrid';
import VendorOverview from '../../components/VendorOverview/VendorOverview';

const AdminDashboard = () => {
    const {
        user,
        isSuperAdmin,
        isPlatformOwner,
        showPlatformConsole,
        actionCards,
    } = useAdminDashboard();

    return (
        <Box>
            {!user && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    User information not loaded.
                </Alert>
            )}

            {/* WelcomeCard takes STRICT booleans for label rendering. */}
            <WelcomeCard
                user={user}
                isSuperAdmin={isSuperAdmin}
                isPlatformOwner={isPlatformOwner}
            />

            {/* The SaaS seller's business is tenants, not patients — its
                home leads with the customer book. Tenant admins keep the
                product dashboard below. */}
            {showPlatformConsole && <VendorOverview />}

            <ActionCardGrid actionCards={actionCards} />
        </Box>
    );
};

export default AdminDashboard;
