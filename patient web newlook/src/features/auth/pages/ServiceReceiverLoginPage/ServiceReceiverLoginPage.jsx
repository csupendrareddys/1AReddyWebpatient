import LoginForm from '../../components/LoginForm/LoginForm';
import { Box } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { useLoginPageConfig } from '../../hooks/useLoginPageConfig';
import { useAuthLanguage } from '../../../../common/contexts/AuthLanguageContext';

const ServiceReceiverLoginPage = () => {
    const lang = useAuthLanguage();
    const { config } = useLoginPageConfig('patient_login', lang);

    return (
        <Box>
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
                            bgcolor: config?.primary_color || 'primary.light',
                            color: '#fff',
                        }}
                    >
                        <PersonIcon sx={{ fontSize: 40 }} />
                    </Box>
                </Box>
            )}

            <LoginForm
                title="Patient Login"
                subtitle="Access your health records and appointments"
                signupLink={config?.register_link_url || '/auth/service-receiver/signup'}
                signupLinkText="New patient? Create an account"
                userType="patient"
                configOverride={config}
            />
        </Box>
    );
};

export default ServiceReceiverLoginPage;
