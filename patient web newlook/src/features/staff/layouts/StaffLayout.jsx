/**
 * StaffLayout — sidebar shell for provider staff: the people who work for a
 * doctor, clinic or hospital and now sign in through their practice's portal.
 *
 * The nav is derived, not declared. Which modules a staff member reaches is
 * decided by the roles their practice gave them, so a fixed list would promise
 * screens this person holds nothing for. Only groups with a ``can_view`` grant
 * get an entry — an entry is a way in to READ something, and a group they can
 * only (say) approve inside is not somewhere to send them.
 *
 * Two kinds of entry, and the difference is worth seeing. A module with a real
 * screen behind it (``staffModules.js``) links to that screen — the practice's
 * own Manage Doctors, not a staff-flavoured copy. A module without one links
 * back to the dashboard filtered to its group (``?view=``, the same pattern
 * PatientLayout uses), where it can at least be described.
 *
 * The screens come first because they are what the person came here to do; the
 * described-only groups follow under a heading that says what they are, rather
 * than sitting in the same list looking equally clickable.
 */
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import EventNoteIcon from '@mui/icons-material/EventNote';
import DescriptionIcon from '@mui/icons-material/Description';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ApartmentIcon from '@mui/icons-material/Apartment';
import GroupIcon from '@mui/icons-material/Group';
import GroupsIcon from '@mui/icons-material/Groups';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
// ApartmentIcon and ReceiptLongIcon are imported above for GROUP_ICONS and
// reused here — the group and its screen should not look like different things.

import { ROUTED_MODULES } from '../constants/staffModules';
import useStaffAccess from '../hooks/useStaffAccess';

// Keyed by the top-level keys of the doctor and facility trees in the backend
// catalog. The fallback matters: the catalog is server-owned, so a new group
// must be able to appear without a frontend deploy.
const GROUP_ICONS = {
    profile: BadgeOutlinedIcon,
    appointments: EventNoteIcon,
    records: DescriptionIcon,
    practice: LocalHospitalIcon,
    entity_profile: ApartmentIcon,
    doctors_network: GroupIcon,
    billing: ReceiptLongIcon,
    staff: GroupsIcon,
    overview: DashboardIcon,
};

// Sidebar icon per routed screen, keyed by the entry key in staffModules.js.
const SCREEN_ICONS = {
    doctors: GroupIcon,
    'network-requests': HubOutlinedIcon,
    practice: ApartmentIcon,
    billing: ReceiptLongIcon,
    team: GroupsIcon,
    roles: VerifiedUserOutlinedIcon,
    'doctor-profile': BadgeOutlinedIcon,
    'doctor-appointments': EventNoteIcon,
    'doctor-manage': EventNoteIcon,
    'doctor-records': DescriptionIcon,
    'doctor-chats': ForumOutlinedIcon,
    'doctor-patients': GroupIcon,
    'doctor-network': HubOutlinedIcon,
    'doctor-affiliations': LocalHospitalIcon,
    'doctor-teams': GroupsIcon,
    'doctor-billing': ReceiptLongIcon,
    'doctor-link': GroupsIcon,
};

const StaffLayout = () => {
    const { staff, provider, groups, screens } = useStaffAccess();

    // A group whose every granted leaf already has a screen in the sidebar
    // would otherwise appear twice — once as the page, once as a description of
    // the same page. Only groups with something left to describe are listed.
    const routedGroupKeys = new Set(
        screens.flatMap((screen) => screen.modules.map((module) => module.split('.')[0])),
    );
    const describedGroups = groups.filter(
        (group) => group.canView
            && !(routedGroupKeys.has(group.key)
                && group.leaves.every((leaf) => ROUTED_MODULES.has(leaf.path))),
    );

    // Built from whatever has arrived: while ``/me`` is in flight this is just
    // Dashboard, and the rest fills in. Blanking the whole shell behind a
    // spinner would flash the sidebar away on every cache refresh.
    // ``isIndex`` screens ARE the dashboard, so they'd be a second entry
    // pointing where the first one already goes.
    const linked = screens.filter((screen) => !screen.isIndex);

    const navItems = [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/staff', exact: true },
        ...(linked.length ? [{ type: 'divider' }] : []),
        ...linked.map((screen) => ({
            label: screen.label,
            icon: SCREEN_ICONS[screen.key] || FolderOutlinedIcon,
            path: `/dashboard/staff/${screen.path}`,
        })),
        ...(describedGroups.length
            ? [{ type: 'divider' }, { type: 'header', label: 'Also granted' }]
            : []),
        ...describedGroups.map((group) => ({
            label: group.label,
            icon: GROUP_ICONS[group.key] || FolderOutlinedIcon,
            path: `/dashboard/staff?view=${group.key}`,
        })),
    ];

    return (
        <DashboardLayout
            config={{
                // The practice, not the product: a receptionist thinks of
                // themselves as working for the clinic, not for "Staff Portal".
                portalName: provider?.name || 'Staff Portal',
                portalIcon: SupportAgentIcon,
                accentColor: '#00695C',
                accentDark: '#004D40',
                loginPath: '/auth/service-provider/login',
                roleLabel: (staff?.designation || 'Staff').toUpperCase(),
                navItems,
            }}
        />
    );
};

export default StaffLayout;
