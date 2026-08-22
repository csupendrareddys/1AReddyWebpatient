import LoginForm from '../../components/LoginForm/LoginForm';
import { Box, Chip, Stack, Typography } from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import BiotechIcon from '@mui/icons-material/Biotech';
import BusinessIcon from '@mui/icons-material/Business';
import { Link as RouterLink } from 'react-router-dom';
import { useLoginPageConfig } from '../../hooks/useLoginPageConfig';
import { useAuthLanguage } from '../../../../common/contexts/AuthLanguageContext';

const ServiceProviderLoginPage = () => {
    const lang = useAuthLanguage();
    const { config } = useLoginPageConfig('doctor_login', lang);

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
                            bgcolor: config?.primary_color || 'secondary.light',
                            color: '#fff',
                        }}
                    >
                        <LocalHospitalIcon sx={{ fontSize: 40 }} />
                    </Box>
                </Box>
            )}

            <LoginForm
                title="Service Provider Login"
                subtitle="Login as Doctor, Hospital, Clinic, Pharmacy, or Diagnosis Center"
                userType="service_provider"
                configOverride={config}
            />

            <Box sx={{ mt: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                    Register as:
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Chip
                        icon={<LocalHospitalIcon />}
                        label="Doctor"
                        component={RouterLink}
                        to="/auth/service-provider/doctor/signup"
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                    <Chip
                        icon={<BusinessIcon />}
                        label="Hospital"
                        component={RouterLink}
                        to="/auth/service-provider/hospital/signup"
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                    <Chip
                        icon={<BusinessIcon />}
                        label="Clinic"
                        component={RouterLink}
                        to="/auth/service-provider/clinic/signup"
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                    <Chip
                        icon={<LocalPharmacyIcon />}
                        label="Pharmacy"
                        component={RouterLink}
                        to="/auth/service-provider/pharmacy/signup"
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                    <Chip
                        icon={<BiotechIcon />}
                        label="Diagnosis"
                        component={RouterLink}
                        to="/auth/service-provider/diagnosis/signup"
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                </Stack>
            </Box>
        </Box>
    );
};

export default ServiceProviderLoginPage;
