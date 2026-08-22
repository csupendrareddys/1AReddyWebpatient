/**
 * DoctorLayout — Doctor role layout configuration
 * Wraps DashboardLayout with Doctor-specific sidebar config
 */
import { Box, CircularProgress } from '@mui/material';
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import useSettledOrTimeout from '../../../common/hooks/useSettledOrTimeout';
import { useGetAccountStateQuery } from '../api/doctorEndpoints';
import VendorHoldingPage from '../pages/VendorHoldingPage/VendorHoldingPage';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import TuneIcon from '@mui/icons-material/Tune';
import DescriptionIcon from '@mui/icons-material/Description';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GroupsIcon from '@mui/icons-material/Groups';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import LinkIcon from '@mui/icons-material/Link';
import HubIcon from '@mui/icons-material/Hub';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import ApartmentIcon from '@mui/icons-material/Apartment';
import LoyaltyIcon from '@mui/icons-material/Loyalty';

const doctorConfig = {
    portalName: 'Doctor Portal',
    portalIcon: LocalHospitalIcon,
    accentColor: '#1565C0',
    accentDark: '#0D47A1',
    // Logout redirects to the public landing ('/') — the previous
    // '/login' was a stale path from before the multi-role login
    // restructure and 404s in production.
    loginPath: '/',
    profilePath: '/dashboard/doctor/settings',
    roleLabel: 'DOCTOR',
    navItems: [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/doctor', exact: true },
        // Split into a tracking view (upcoming appointments + active service
        // orders) and a management area (service catalog + availability).
        { label: 'My Appointments / Service List', icon: CalendarMonthIcon, path: '/dashboard/doctor/appointments' },
        { label: 'Manage Appointments / Services', icon: TuneIcon, path: '/dashboard/doctor/manage' },
        { label: 'My Bills', icon: ReceiptLongIcon, path: '/dashboard/doctor/billing' },
        // Prescriptions + Documents are one page with a top toggle now
        // (mirrors "Appointments / Service List"), so one sidebar entry.
        { label: 'Prescriptions / Documents', icon: DescriptionIcon, path: '/dashboard/doctor/records' },
        // Service Communication — channels for communication-enabled services
        // this doctor delivers (chat + scheduled calls with the patient).
        { label: 'Service Chats', icon: ForumOutlinedIcon, path: '/dashboard/doctor/service-chats' },
        { label: 'My Plan Teams', icon: GroupsIcon, path: '/dashboard/doctor/plan-teams' },
        { label: 'Profile & Schedule', icon: SettingsIcon, path: '/dashboard/doctor/profile' },
        // My Membership — marketplace tier the doctor chose at signup
        // (apex larazen.in pricing card). Hidden gracefully when the
        // doctor has no MembershipSubscription row (back-compat with
        // doctors who signed up before the marketplace launched —
        // the page itself renders a friendly empty state).
        { label: 'My Membership', icon: CardMembershipIcon, path: '/dashboard/doctor/membership' },
        // Health-credit wallet — balance + ledger. Backend grants credits
        // to providers too, so surface a dedicated section.
        { label: 'Health Credits', icon: LoyaltyIcon, path: '/dashboard/doctor/health-credits' },
        { label: 'Hospital Affiliations', icon: ApartmentIcon, path: '/dashboard/doctor/affiliations' },
        { label: 'My Link', icon: LinkIcon, path: '/dashboard/doctor/my-link' },
        { label: 'My Network', icon: HubIcon, path: '/dashboard/doctor/my-network' },
        { type: 'divider' },
        { label: 'My Patients', icon: PeopleIcon, path: '/dashboard/doctor/patients' },
        { label: 'Panel Patients', icon: PeopleIcon, path: '/dashboard/doctor/panel-patients' },
    ],
};

const DoctorLayout = () => {
    // A held vendor (pending verification / inactive / trial expired) gets the
    // holding page in place of the whole dashboard — no other route mounts.
    //
    // The hold check must never brick the dashboard. Under React-18 StrictMode
    // the RTK-Query subscription can race on remount and pin `isLoading` true
    // forever even though the request returned 200, which used to freeze the
    // app on a spinner. Cap the wait: spinner only while genuinely in flight,
    // then fall through to the dashboard rather than hang. A confirmed hold
    // still diverts.
    const { data: state, isLoading } = useGetAccountStateQuery();
    const gateReady = useSettledOrTimeout(!isLoading);
    if (!gateReady) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <CircularProgress />
            </Box>
        );
    }
    if (state?.held) {
        return <VendorHoldingPage />;
    }
    return <DashboardLayout config={doctorConfig} />;
};

export default DoctorLayout;
