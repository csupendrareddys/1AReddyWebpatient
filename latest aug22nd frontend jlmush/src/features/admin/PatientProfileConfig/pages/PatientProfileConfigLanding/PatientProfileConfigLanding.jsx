/**
 * PatientProfileConfigLanding — Sub-module landing page for Patient Profile controls.
 * Shows grouped sub-module cards matching the PageControls UI pattern.
 * Clicking a card navigates to the editor with that section's group expanded.
 */
import {
    Box, Typography, Paper, Grid, Breadcrumbs, Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import PersonIcon from '@mui/icons-material/Person';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import HealingIcon from '@mui/icons-material/Healing';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import GroupIcon from '@mui/icons-material/Group';
import PregnantWomanIcon from '@mui/icons-material/PregnantWoman';
import SettingsIcon from '@mui/icons-material/Settings';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';
import SecurityIcon from '@mui/icons-material/Security';
import { useNavigate } from 'react-router-dom';

// Sub-modules mapping to the Patient Profile's tab/section structure
const PATIENT_PROFILE_SUBMODULES = {
    personal_module: {
        title: 'Personal & Contact Module',
        buttons: [
            { label: 'Personal Details Controls', section: 'personal_details', icon: PersonIcon, color: '#2196F3' },
            { label: 'Contact & Identity Controls', section: 'contact_identity', icon: ContactPhoneIcon, color: '#9C27B0' },
            { label: 'Address Controls', section: 'address', icon: HomeWorkIcon, color: '#4CAF50' },
            { label: 'Emergency Contact Controls', section: 'emergency_contact', icon: LocalHospitalIcon, color: '#FF9800' },
            { label: 'Insurance Controls', section: 'insurance', icon: SecurityIcon, color: '#3F51B5' },
            { label: 'Female Health Controls', section: 'female_health', icon: PregnantWomanIcon, color: '#E91E63' },
        ],
    },
    health_module: {
        title: 'Health & Vitals Module',
        buttons: [
            { label: 'Vitals Controls', section: 'vitals', icon: MonitorHeartIcon, color: '#009688' },
            { label: 'Habits & Lifestyle Controls', section: 'habits', icon: FitnessCenterIcon, color: '#FF5722' },
            { label: 'Surgeries Controls', section: 'surgeries', icon: HealingIcon, color: '#795548' },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    records_module: {
        title: 'Records & Prescriptions Module',
        buttons: [
            { label: 'Health Records Controls', section: 'health_records', icon: FolderSharedIcon, color: '#607D8B' },
            { label: 'Previous Prescriptions Controls', section: 'prescriptions', icon: ReceiptLongIcon, color: '#0288D1' },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    family_module: {
        title: 'Family & Group Module',
        buttons: [
            { label: 'House / Family Group Controls', section: 'family_group', icon: GroupIcon, color: '#558B2F' },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    page_settings: {
        title: 'Page Settings Module',
        buttons: [
            { label: 'Page-Level Config (Title, Colors)', section: 'page_settings', icon: SettingsIcon, color: '#795548' },
            { label: 'Live Preview', section: 'preview', icon: VisibilityIcon, color: '#3F51B5' },
            { label: 'Version History', section: 'history', icon: HistoryIcon, color: '#FF5722' },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
};

const moduleButtonStyle = {
    py: 1.5,
    px: 2,
    border: '1px solid #4CAF50',
    borderRadius: 2,
    bgcolor: 'white',
    color: '#4CAF50',
    textTransform: 'none',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    minHeight: 48,
    '&:hover': {
        bgcolor: '#E8F5E9',
        borderColor: '#388E3C',
    },
};

const disabledButtonStyle = {
    ...moduleButtonStyle,
    color: '#9E9E9E',
    borderColor: '#E0E0E0',
    cursor: 'default',
    '&:hover': {
        bgcolor: 'white',
        borderColor: '#E0E0E0',
    },
};

const PatientProfileConfigLanding = () => {
    const navigate = useNavigate();

    const handleNavigate = (section) => {
        if (!section) return;
        if (section === 'preview') {
            navigate('/dashboard/admin/patient-profile-config/editor?tab=preview');
            return;
        }
        if (section === 'history') {
            navigate('/dashboard/admin/patient-profile-config/editor?tab=history');
            return;
        }
        navigate(`/dashboard/admin/patient-profile-config/editor?section=${section}`);
    };

    return (
        <Box>
            {/* Page Title */}
            <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                Patient Profile Page Controls
            </Typography>

            {/* Breadcrumbs */}
            <Paper className="admin-page-card" sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => navigate('/dashboard/admin')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        <HomeIcon fontSize="small" />
                        Dashboard
                    </Link>
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => navigate('/dashboard/admin/page-controls')}
                    >
                        Page Controls
                    </Link>
                    <Typography color="primary" fontWeight="bold">
                        Patient Profile Module
                    </Typography>
                </Breadcrumbs>
            </Paper>

            {/* Sub-module Grid */}
            {Object.entries(PATIENT_PROFILE_SUBMODULES).map(([moduleKey, module]) => (
                <Box key={moduleKey} sx={{ mb: 4 }}>
                    <Typography variant="h6" fontWeight="bold" sx={{ mb: 2, color: 'text.primary' }}>
                        {module.title}
                    </Typography>
                    <Grid container spacing={2}>
                        {module.buttons.map((button, index) => {
                            const IconComp = button.icon;
                            return (
                                <Grid item xs={6} sm={3} key={index}>
                                    <Box
                                        onClick={() => !button.disabled && handleNavigate(button.section)}
                                        sx={button.disabled ? disabledButtonStyle : {
                                            ...moduleButtonStyle,
                                            borderColor: button.color || '#4CAF50',
                                            color: button.color || '#4CAF50',
                                            '&:hover': {
                                                bgcolor: `${button.color || '#4CAF50'}15`,
                                                borderColor: button.color || '#388E3C',
                                            },
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                            {IconComp && <IconComp sx={{ fontSize: 20, mb: 0.5 }} />}
                                            <span>{button.label}</span>
                                            {button.comingSoon && (
                                                <Typography variant="caption" sx={{ color: '#FF9800', fontStyle: 'italic', fontSize: '0.7rem' }}>
                                                    Coming Soon
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                </Grid>
                            );
                        })}
                    </Grid>
                </Box>
            ))}
        </Box>
    );
};

export default PatientProfileConfigLanding;
