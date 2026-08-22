/**
 * PatientLayout — Patient / Service Receiver role layout configuration
 * Wraps DashboardLayout with Patient-specific sidebar config
 */
import { Box, CircularProgress } from '@mui/material';
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import useSettledOrTimeout from '../../../common/hooks/useSettledOrTimeout';
import { useGetHoldingAccountStateQuery } from '../../admin/api/serviceCommunicationEndpoints';
import VendorHoldingPage from '../../service-provider/pages/VendorHoldingPage/VendorHoldingPage';
import HomeIcon from '@mui/icons-material/Home';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import SickIcon from '@mui/icons-material/Sick';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import PsychologyIcon from '@mui/icons-material/Psychology';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import PersonIcon from '@mui/icons-material/Person';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import SettingsIcon from '@mui/icons-material/Settings';
import FavoriteIcon from '@mui/icons-material/Favorite';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PaymentsIcon from '@mui/icons-material/Payments';
import DescriptionIcon from '@mui/icons-material/Description';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';

const patientConfig = {
    portalName: 'Healthcare',
    portalIcon: FavoriteIcon,
    accentColor: '#E8833A',
    accentDark: '#D4702E',
    // After logout, the patient lands here. ``/login`` was never a
    // valid React Router path (it 404s); the real patient login lives
    // at the service-receiver portal.
    loginPath: '/auth/service-receiver/login',
    profilePath: '/dashboard/patient/profile',
    roleLabel: 'PATIENT',
    navItems: [
        { label: 'Home', icon: HomeIcon, path: '/dashboard/patient', exact: true },
        { label: 'Book Consultation', icon: EventAvailableIcon, path: '/dashboard/patient/book-by-type' },
        { label: 'Find a Doctor', icon: MedicalServicesIcon, path: '/dashboard/patient/find-doctors' },
        { label: 'Services', icon: StorefrontIcon, path: '/dashboard/patient/marketplace' },
        { label: 'Health Plans', icon: GroupsIcon, path: '/dashboard/patient/health-plans' },
        { label: 'My Membership', icon: WorkspacePremiumIcon, path: '/dashboard/patient/my-membership' },
        { type: 'divider' },
        { label: 'My Appointments / Services', icon: EventNoteIcon, path: '/dashboard/patient/my-appointments' },
        { label: 'My Spending', icon: PaymentsIcon, path: '/dashboard/patient/spending' },
        // Prescriptions + Documents unified into one page with a top toggle.
        { label: 'Prescriptions / Documents', icon: DescriptionIcon, path: '/dashboard/patient/my-records' },
        { label: 'Health Records', icon: MonitorHeartIcon, path: '/dashboard/patient/health-records' },
        { label: 'Family Doctor', icon: MedicalServicesIcon, path: '/dashboard/patient/family-doctor' },
        { label: 'Family', icon: FamilyRestroomIcon, path: '/dashboard/patient/family' },
        { label: 'Support Staff', icon: BadgeOutlinedIcon, path: '/dashboard/patient/support-staff' },
        { label: 'My Services', icon: ForumOutlinedIcon, path: '/dashboard/patient/my-services' },
        { type: 'divider' },
        { label: 'Book by Symptoms', icon: SickIcon, path: '/dashboard/patient?view=symptoms' },
        { label: 'Instant Consultation', icon: FlashOnIcon, path: '/dashboard/patient?view=instant' },
        { label: 'Clinical Visit', icon: LocalHospitalIcon, path: '/dashboard/patient?view=clinic' },
        { label: 'Counselling', icon: PsychologyIcon, path: '/dashboard/patient?view=counselling' },
        { label: 'Vaccination', icon: VaccinesIcon, path: '/dashboard/patient?view=vaccination' },
        { type: 'divider' },
        { label: 'Profile Settings', icon: SettingsIcon, path: '/dashboard/patient/profile' },
    ],
};

const PatientLayout = () => {
    // A held patient (inactive / disciplinary hold) is routed to the holding
    // page (admin chat) instead of their dashboard.
    //
    // This "is the account held?" check must never brick the dashboard. Under
    // React-18 StrictMode the RTK-Query subscription can race on remount and
    // pin `isLoading` true forever even though the request returned 200, which
    // used to freeze the whole app on a spinner. Cap the wait: show the spinner
    // only while the check is genuinely in flight, but fall through to the
    // dashboard if it hasn't settled in time rather than hang. A confirmed hold
    // still diverts.
    const { data: state, isLoading } = useGetHoldingAccountStateQuery();
    const gateReady = useSettledOrTimeout(!isLoading);
    if (!gateReady) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }
    if (state?.held) return <VendorHoldingPage stateOverride={state} />;
    return <DashboardLayout config={patientConfig} />;
};

export default PatientLayout;
