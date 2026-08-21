/**
 * WelcomeCard — Greeting card showing admin info and role badge
 * Styled to match JLMUSH premium dashboard design
 */
import { Box, Typography, Avatar, Chip } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';

/**
 * ``isPlatformOwner`` is optional for back-compat with callers that
 * predate platform-owner support — they only passed ``isSuperAdmin``
 * (which was true for platform owners by virtue of the
 * ``usePermissions`` hook conflating both). When present, render the
 * platform-owner label literally.
 */
const WelcomeCard = ({ user, isSuperAdmin, isPlatformOwner = false }) => {
    const roleLabel = isPlatformOwner
        ? 'PLATFORM OWNER'
        : isSuperAdmin
            ? 'SUPER ADMIN'
            : 'SUB ADMIN';
    const roleColor = isPlatformOwner
        ? '#1a1a2e'                // platform owner: dark navy
        : isSuperAdmin
            ? '#E8833A'            // super admin: brand orange
            : '#4CAF50';           // sub admin: green
    return (
    <Box
        className="admin-page-card"
        sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2.5,
            p: 3,
            mb: 3,
            background: 'linear-gradient(135deg, #FFF3E8 0%, #FFFFFF 100%)',
        }}
    >
        <Avatar
            sx={{
                width: 56,
                height: 56,
                bgcolor: '#E8833A',
                boxShadow: '0 4px 12px rgba(232, 131, 58, 0.3)',
            }}
        >
            <AdminPanelSettingsIcon sx={{ fontSize: 28 }} />
        </Avatar>
        <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={600} color="#2D3436">
                Welcome, {user?.first_name} {user?.last_name}!
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                <Chip
                    label={roleLabel}
                    size="small"
                    sx={{
                        bgcolor: roleColor,
                        color: 'white',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                    }}
                />
                <Typography variant="body2" color="text.secondary">
                    {user?.email || ''}
                </Typography>
            </Box>
        </Box>
    </Box>
    );
};

export default WelcomeCard;
