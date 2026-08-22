/**
 * DoctorProfileConfigLanding — Sub-module landing page for Doctor Profile controls.
 * Shows grouped sub-module cards matching the PageControls UI pattern.
 * Clicking a card navigates to the editor with that section's group expanded.
 */
import {
    Box, Typography, Paper, Grid, Breadcrumbs, Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import PersonIcon from '@mui/icons-material/Person';
import DrawIcon from '@mui/icons-material/Draw';
import InfoIcon from '@mui/icons-material/Info';
import SchoolIcon from '@mui/icons-material/School';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import GavelIcon from '@mui/icons-material/Gavel';
import StorageIcon from '@mui/icons-material/Storage';
import SettingsIcon from '@mui/icons-material/Settings';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useNavigate } from 'react-router-dom';

// Sub-modules mapping to the Doctor Profile's tab/section structure
const DOCTOR_PROFILE_SUBMODULES = {
    profile_details: {
        title: 'Profile Details Module',
        buttons: [
            { label: 'Personal & Professional Controls', section: 'personal_professional', icon: PersonIcon, color: '#2196F3' },
            { label: 'Signatures & Verification Controls', section: 'signatures', icon: DrawIcon, color: '#9C27B0' },
            { label: 'About Me Controls', section: 'about_me', icon: InfoIcon, color: '#4CAF50' },
            { label: 'Education Details Controls', section: 'education', icon: SchoolIcon, color: '#FF9800' },
            { label: 'Bank Details Controls', section: 'bank_details', icon: AccountBalanceIcon, color: '#3F51B5' },
            { label: 'Declaration & Documents Controls', section: 'declaration_documents', icon: GavelIcon, color: '#BF360C' },
        ],
    },
    scheduling: {
        title: 'Scheduling & Availability Module',
        buttons: [
            { label: 'Working Days & Hours Controls', section: 'working_hours', icon: ScheduleIcon, color: '#009688' },
            { label: 'Consultation Pricing Controls', section: 'pricing', icon: AttachMoneyIcon, color: '#E91E63' },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    analytics_attendance: {
        title: 'Analytics & Attendance Module',
        buttons: [
            { label: 'Analytics Controls', section: 'analytics', icon: AnalyticsIcon, color: '#0288D1' },
            { label: 'Attendance & Activity Controls', section: 'attendance_activity', icon: EventNoteIcon, color: '#558B2F' },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    master_data: {
        title: 'Master Data Module',
        buttons: [
            { label: 'Colleges & Specializations', section: 'master_data', icon: StorageIcon, color: '#607D8B' },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
            { label: 'Extra Buttons', section: null, disabled: true },
        ],
    },
    page_settings: {
        title: 'Page Settings Module',
        buttons: [
            { label: 'Page-Level Config (Title, Colors)', section: 'page_settings', icon: SettingsIcon, color: '#795548' },
            { label: 'Live Preview', section: 'preview', icon: null, color: '#3F51B5' },
            { label: 'Version History', section: 'history', icon: null, color: '#FF5722' },
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

const DoctorProfileConfigLanding = () => {
    const navigate = useNavigate();

    const handleNavigate = (section) => {
        if (!section) return;
        if (section === 'preview') {
            navigate('/dashboard/admin/doctor-profile-config/editor?tab=preview');
            return;
        }
        if (section === 'history') {
            navigate('/dashboard/admin/doctor-profile-config/editor?tab=history');
            return;
        }
        navigate(`/dashboard/admin/doctor-profile-config/editor?section=${section}`);
    };

    return (
        <Box>
            {/* Page Title */}
            <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                Doctor Profile Page Controls
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
                        Doctor Profile Module
                    </Typography>
                </Breadcrumbs>
            </Paper>

            {/* Sub-module Grid */}
            {Object.entries(DOCTOR_PROFILE_SUBMODULES).map(([moduleKey, module]) => (
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

export default DoctorProfileConfigLanding;
