/**
 * HospitalLayout — sidebar shell for marketplace hospital admins.
 *
 * Same sidebar shape as ClinicLayout; different accent color and
 * portal label. Round 5+ may add hospital-only items (departments,
 * OP/IP management) once those features are built.
 */
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import SettingsIcon from '@mui/icons-material/Settings';
import GroupIcon from '@mui/icons-material/Group';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ApartmentIcon from '@mui/icons-material/Apartment';
import HandshakeIcon from '@mui/icons-material/Handshake';
import LoyaltyIcon from '@mui/icons-material/Loyalty';
import LinkIcon from '@mui/icons-material/Link';

const hospitalConfig = {
    portalName: 'Hospital Portal',
    portalIcon: ApartmentIcon,
    accentColor: '#6A1B9A',
    accentDark: '#4A148C',
    loginPath: '/auth/service-provider/login',
    profilePath: '/dashboard/hospital/settings',
    roleLabel: 'HOSPITAL',
    navItems: [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/hospital', exact: true },
        { label: 'My Membership', icon: CardMembershipIcon, path: '/dashboard/hospital/membership' },
        { label: 'Health Credits', icon: LoyaltyIcon, path: '/dashboard/hospital/health-credits' },
        { label: 'Settings', icon: SettingsIcon, path: '/dashboard/hospital/settings' },
        { type: 'divider' },
        { label: 'Manage Doctors', icon: GroupIcon, path: '/dashboard/hospital/doctors' },
        { label: 'Network Requests', icon: HandshakeIcon, path: '/dashboard/hospital/network-requests' },
        // Affiliations + the support staff who have no platform account
        // of their own — see MyLinkPage.
        { label: 'My Link', icon: LinkIcon, path: '/dashboard/hospital/my-link' },
        { label: 'Bills', icon: ReceiptLongIcon, path: '/dashboard/hospital/bills' },
    ],
};

const HospitalLayout = () => <DashboardLayout config={hospitalConfig} />;

export default HospitalLayout;
