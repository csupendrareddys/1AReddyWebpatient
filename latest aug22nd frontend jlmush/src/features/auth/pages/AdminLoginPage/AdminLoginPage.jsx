import LoginForm from '../../components/LoginForm/LoginForm';
import { Box, Alert } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useLoginPageConfig } from '../../hooks/useLoginPageConfig';
import { useAuthLanguage } from '../../../../common/contexts/AuthLanguageContext';

const AdminLoginPage = () => {
    const lang = useAuthLanguage();
    const { config } = useLoginPageConfig('admin_login', lang);

    return (
        <Box>
            {/* Logo from published config, or default icon fallback */}
            {config?.logo_is_present && config?.logo_url ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <Box
                        component="img"
                        src={config.logo_url}
                        alt={config.logo_alt_text || 'Logo'}
                        sx={{ maxHeight: 80, maxWidth: 220, objectFit: 'contain' }}
                    />
                </Box>
            ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <Box
                        sx={{
                            p: 2,
                            borderRadius: '50%',
                            bgcolor: config?.primary_color || 'warning.light',
                            color: '#fff',
                        }}
                    >
                        <AdminPanelSettingsIcon sx={{ fontSize: 40 }} />
                    </Box>
                </Box>
            )}

            <LoginForm
                title="Admin Portal"
                subtitle="Authorized personnel only"
                userType="admin"
                configOverride={config}
            />

            <Alert severity="info" sx={{ mt: 2 }}>
                Admin accounts are created by the Super Administrator. If you need
                access, please contact your system administrator.
            </Alert>
        </Box>
    );
};

export default AdminLoginPage;
