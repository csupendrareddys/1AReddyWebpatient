/**
 * usePageControls — Custom hook for PageControls page
 * Manages role selection state and navigation logic
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import PersonIcon from '@mui/icons-material/Person';
import usePermissions from '../../../../common/hooks/usePermissions';

// Page types supported by the backend PageType enum
const SUPPORTED_PAGE_TYPES = [
    'patient_login', 'doctor_login', 'admin_login',
    'patient_signup', 'doctor_signup', 'pharmacy_signup', 'diagnosis_signup',
    'doctor_profile', 'patient_profile',
    'patient_appointment_filter', 'patient_appointment_symptoms',
];

// Full page controls configuration organized by role and module
// Buttons whose pageType is NOT in SUPPORTED_PAGE_TYPES are marked disabled + comingSoon
export const PAGE_CONTROLS_CONFIG = {
    admin: {
        label: 'Admin',
        description: 'Configure pages for system administrators',
        icon: AdminPanelSettingsIcon,
        color: '#FF9800',
        modules: {
            login: {
                title: 'Login Module',
                buttons: [
                    { label: 'Login Page Controls', pageType: 'admin_login' },
                    { label: 'Forgot Password Controls', pageType: 'admin_forgot_password', disabled: true, comingSoon: true },
                    { label: 'Terms & Conditions Controls', pageType: 'admin_terms', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            profile: {
                title: 'Profile Settings Module',
                buttons: [
                    { label: 'Admin Profile Module', pageType: 'admin_profile' },
                    { label: 'User Admin Profile Module', pageType: 'user_admin_profile', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
        },
    },
    service_provider: {
        label: 'Service Provider',
        description: 'Configure pages for doctors, pharmacy, and diagnosis centers',
        icon: LocalHospitalIcon,
        color: '#2196F3',
        modules: {
            login: {
                title: 'Login Module',
                buttons: [
                    { label: 'Login Page Controls', pageType: 'doctor_login' },
                    { label: 'Doctor Registration Controls', pageType: 'doctor_signup' },
                    { label: 'Pharmacy Registration Controls', pageType: 'pharmacy_signup' },
                    { label: 'Diagnosis Registration Controls', pageType: 'diagnosis_signup' },
                    { label: 'Forgot Password Controls', pageType: 'doctor_forgot_password', disabled: true, comingSoon: true },
                    { label: 'Terms & Conditions Controls', pageType: 'doctor_terms', disabled: true, comingSoon: true },
                    { label: 'Landing Page Controls', pageType: 'doctor_landing', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            profile: {
                title: 'Profile Settings Module',
                buttons: [
                    { label: 'Doctor Profile Module', pageType: 'doctor_profile' },
                    { label: 'Pharmacy Profile Module', pageType: 'pharmacy_profile', disabled: true, comingSoon: true },
                    { label: 'Diagnosis Profile Module', pageType: 'diagnosis_profile', disabled: true, comingSoon: true },
                    { label: 'Schedule Settings', pageType: 'doctor_schedule', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            appointments: {
                title: 'Appointments Module',
                buttons: [
                    { label: 'Appointment List Controls', pageType: 'doctor_appointments', disabled: true, comingSoon: true },
                    { label: 'Appointment Details Controls', pageType: 'doctor_appointment_detail', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
        },
    },
    service_receiver: {
        label: 'Service Receiver',
        description: 'Configure pages for patients and customers',
        icon: PersonIcon,
        color: '#4CAF50',
        modules: {
            login: {
                title: 'Login Module',
                buttons: [
                    { label: 'Login Page Controls', pageType: 'patient_login' },
                    { label: 'Registration Page Controls', pageType: 'patient_signup' },
                    { label: 'Forgot Password Controls', pageType: 'patient_forgot_password', disabled: true, comingSoon: true },
                    { label: 'Terms & Conditions Controls', pageType: 'patient_terms', disabled: true, comingSoon: true },
                    { label: 'Landing Page Controls', pageType: 'patient_landing', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            profile: {
                title: 'Profile Settings Module',
                buttons: [
                    { label: 'Patient Profile Module', pageType: 'patient_profile' },
                    { label: 'Manage Family Members', pageType: 'patient_family', disabled: true, comingSoon: true },
                    { label: 'Health Records Controls', pageType: 'patient_health_records', disabled: true, comingSoon: true },
                    { label: 'Notification Settings', pageType: 'patient_notifications', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            appointments: {
                title: 'Appointments Module',
                buttons: [
                    { label: 'Appointment Filter Config', pageType: 'patient_appointment_filter' },
                    { label: 'Appointment Symptoms Config', pageType: 'patient_appointment_symptoms' },
                    { label: 'Book Appointment Controls', pageType: 'patient_book_appointment', disabled: true, comingSoon: true },
                    { label: 'Appointment History Controls', pageType: 'patient_appointments', disabled: true, comingSoon: true },
                    { label: 'Doctor Search Controls', pageType: 'patient_doctor_search', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
            meetings: {
                title: 'Meetings Module',
                buttons: [
                    { label: 'Video Call Controls', pageType: 'patient_video_call', disabled: true, comingSoon: true },
                    { label: 'Chat Controls', pageType: 'patient_chat', disabled: true, comingSoon: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                    { label: 'Extra Buttons', pageType: null, disabled: true },
                ],
            },
        },
    },
};

// Button styles
export const moduleButtonStyle = {
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

export const disabledButtonStyle = {
    ...moduleButtonStyle,
    color: '#9E9E9E',
    borderColor: '#E0E0E0',
    cursor: 'default',
    '&:hover': {
        bgcolor: 'white',
        borderColor: '#E0E0E0',
    },
};

const usePageControls = () => {
    const navigate = useNavigate();
    const { hasFullAccess, can } = usePermissions();

    // Sub-admins with login_page_config view can access this page
    const hasViewAccess = hasFullAccess || can('login_page_config', 'view');
    const hasEditAccess = hasFullAccess || can('login_page_config', 'edit');

    const [selectedRole, setSelectedRole] = useState(null);

    const goToConfig = (pageType) => {
        if (pageType === 'doctor_profile') {
            navigate('/dashboard/admin/doctor-profile-config');
            return;
        }
        if (pageType === 'admin_profile') {
            navigate('/dashboard/admin/admin-profile-config');
            return;
        }
        if (pageType === 'patient_profile') {
            navigate('/dashboard/admin/patient-profile-config');
            return;
        }
        if (pageType === 'patient_appointment_filter') {
            navigate('/dashboard/admin/patient-appointment-config/patient_appointment_filter');
            return;
        }
        if (pageType === 'patient_appointment_symptoms') {
            navigate('/dashboard/admin/patient-appointment-config/patient_appointment_symptoms');
            return;
        }
        if (pageType) {
            navigate(`/dashboard/admin/page-config?type=${pageType}`);
        }
    };

    const handleBack = () => {
        if (selectedRole) {
            setSelectedRole(null);
        } else {
            navigate('/dashboard/admin');
        }
    };

    return {
        hasFullAccess,
        hasViewAccess,
        hasEditAccess,
        selectedRole,
        setSelectedRole,
        goToConfig,
        handleBack,
    };
};

export default usePageControls;
