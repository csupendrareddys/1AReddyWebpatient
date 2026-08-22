/**
 * ClinicLayout — sidebar shell for marketplace clinic admins.
 *
 * Round 3+4 ships the full sidebar shape (Dashboard / My Membership /
 * Settings / Manage Doctors / Bills) so a clinic admin sees what's
 * coming next. Non-membership entries route to `ComingSoonPage`
 * placeholders until the corresponding features land.
 */
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import SettingsIcon from '@mui/icons-material/Settings';
import GroupIcon from '@mui/icons-material/Group';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import HandshakeIcon from '@mui/icons-material/Handshake';
import LoyaltyIcon from '@mui/icons-material/Loyalty';
import LinkIcon from '@mui/icons-material/Link';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

const clinicConfig = {
    portalName: 'Clinic Portal',
    portalIcon: MedicalServicesIcon,
    accentColor: '#0277BD',
    accentDark: '#01579B',
    loginPath: '/auth/service-provider/login',
    profilePath: '/dashboard/clinic/settings',
    roleLabel: 'CLINIC',
    navItems: [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/clinic', exact: true },
        { label: 'My Membership', icon: CardMembershipIcon, path: '/dashboard/clinic/membership' },
        { label: 'Health Credits', icon: LoyaltyIcon, path: '/dashboard/clinic/health-credits' },
        { label: 'Settings', icon: SettingsIcon, path: '/dashboard/clinic/settings' },
        { type: 'divider' },
        { label: 'Manage Doctors', icon: GroupIcon, path: '/dashboard/clinic/doctors' },
        { label: 'Branches', icon: AccountTreeIcon, path: '/dashboard/clinic/branches' },
        { label: 'Network Requests', icon: HandshakeIcon, path: '/dashboard/clinic/network-requests' },
        // Affiliations + the support staff who have no platform account
        // of their own — see MyLinkPage.
        { label: 'My Link', icon: LinkIcon, path: '/dashboard/clinic/my-link' },
        { label: 'Bills', icon: ReceiptLongIcon, path: '/dashboard/clinic/bills' },
    ],
};

const ClinicLayout = () => <DashboardLayout config={clinicConfig} />;

export default ClinicLayout;
