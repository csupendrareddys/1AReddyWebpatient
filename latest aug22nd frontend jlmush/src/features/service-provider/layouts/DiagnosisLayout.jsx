/**
 * DiagnosisLayout — Diagnosis Center role layout configuration
 * Wraps DashboardLayout with Diagnosis-specific sidebar config
 */
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ScienceIcon from '@mui/icons-material/Science';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import BiotechIcon from '@mui/icons-material/Biotech';

const diagnosisConfig = {
    portalName: 'Diagnosis Center',
    portalIcon: BiotechIcon,
    accentColor: '#00838F',
    accentDark: '#006064',
    loginPath: '/',  // Stale '/login' 404s — redirect to public landing
    roleLabel: 'DIAGNOSIS',
    navItems: [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/diagnosis', exact: true },
        { type: 'divider' },
        { label: 'Lab Tests', icon: ScienceIcon, path: '/dashboard/diagnosis/lab-tests', disabled: true },
        { label: 'Reports', icon: AssignmentIcon, path: '/dashboard/diagnosis/reports', disabled: true },
        { label: 'Settings', icon: SettingsIcon, path: '/dashboard/diagnosis/settings', disabled: true },
    ],
};

const DiagnosisLayout = () => <DashboardLayout config={diagnosisConfig} />;

export default DiagnosisLayout;
