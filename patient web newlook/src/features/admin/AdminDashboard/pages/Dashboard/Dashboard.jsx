import { Box, Alert } from '@mui/material';
import useAdminDashboard from '../../hooks/useAdminDashboard';
import WelcomeCard from '../../components/WelcomeCard/WelcomeCard';
import ActionCardGrid from '../../components/ActionCardGrid/ActionCardGrid';

const AdminDashboard = () => {
    const {
        user,
        isSuperAdmin,
        isPlatformOwner,
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

            <ActionCardGrid actionCards={actionCards} />
        </Box>
    );
};

export default AdminDashboard;
