/**
 * useAdminDashboard — Custom hook for the main AdminDashboard page
 * Extracts logout logic, permission checks, and action card configuration
 */
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import PeopleIcon from '@mui/icons-material/People';
import EventIcon from '@mui/icons-material/Event';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import WebIcon from '@mui/icons-material/Web';
import LanguageIcon from '@mui/icons-material/Language';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import BusinessIcon from '@mui/icons-material/Business';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';
import usePermissions from '../../../../common/hooks/usePermissions';
import useIsOnPlatformDomain from '../../../../common/hooks/useIsOnPlatformDomain';

const useAdminDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    // Use the real RBAC permissions hook. ``hasFullAccess`` powers
    // visibility gates below; ``isSuperAdmin`` and ``isPlatformOwner``
    // are STRICT and only used for label rendering downstream
    // (WelcomeCard etc.).
    const { hasFullAccess, isSuperAdmin, isPlatformOwner, can } = usePermissions();
    // Cross-tenant cards (Tenants, Our Platform Landing, Tenants
    // Default Landing) only render on the platform's own host. A
    // platform owner browsing a tenant's domain shouldn't see those —
    // they're in tenant-admin context there.
    const isOnPlatformDomain = useIsOnPlatformDomain();
    const showPlatformConsole = isPlatformOwner && isOnPlatformDomain;

    const handleLogout = async () => {
        await dispatch(logoutUser());
        navigate('/auth/admin/login');
    };

    const handleToggleTheme = () => dispatch(toggleTheme());

    // Dashboard action cards with real RBAC permission-based visibility
    const actionCards = [
        {
            title: 'My Access',
            description: 'View your permissions & roles',
            icon: VpnKeyIcon,
            iconColor: '#E8833A',
            onClick: () => navigate('/dashboard/admin/my-access'),
            visible: true,  // Always visible to all admins
        },
        // ── Product cards — the tenant's business, not the vendor's. ──
        // The vendor tenant bypasses every feature gate, so without the
        // explicit ``!showPlatformConsole`` the SaaS seller's dashboard
        // filled up with patient/appointment controls it can't use.
        {
            title: 'View Patients',
            description: 'Browse patient records',
            icon: PeopleIcon,
            iconColor: 'primary.main',
            onClick: () => navigate('/dashboard/admin/patients'),
            visible: !showPlatformConsole
                && (hasFullAccess || can('patient_list', 'view')),
        },
        {
            title: 'View Appointments',
            description: 'Browse appointments',
            icon: EventIcon,
            iconColor: 'success.main',
            onClick: () => navigate('/dashboard/admin/appointments'),
            visible: !showPlatformConsole
                && (hasFullAccess || can('appointment_list', 'view')),
        },
        {
            title: 'View Doctors',
            description: 'Browse doctor profiles',
            icon: LocalHospitalIcon,
            iconColor: 'info.main',
            onClick: () => navigate('/dashboard/admin/doctors'),
            visible: !showPlatformConsole
                && (hasFullAccess || can('doctor_list', 'view')),
        },
        {
            title: 'Pending Approvals',
            description: 'Approve service providers',
            icon: VerifiedUserIcon,
            iconColor: 'warning.light',
            onClick: () => navigate('/dashboard/admin/pending-approvals'),
            visible: !showPlatformConsole && hasFullAccess,
        },
        {
            title: 'Reports',
            description: 'View system analytics',
            icon: BarChartIcon,
            iconColor: 'secondary.main',
            onClick: () => {},
            visible: !showPlatformConsole && hasFullAccess,
        },
        {
            title: 'Settings',
            description: 'System configuration',
            icon: SettingsIcon,
            iconColor: 'grey.600',
            onClick: () => {},
            visible: hasFullAccess,
        },
        {
            title: 'Manage Admins',
            description: 'Create and manage admin accounts',
            icon: SupervisorAccountIcon,
            iconColor: 'warning.main',
            onClick: () => navigate('/dashboard/admin/manage-admins'),
            visible: hasFullAccess,
        },
        {
            title: 'Page Controls',
            description: 'Configure login & signup pages',
            icon: SettingsIcon,
            iconColor: 'primary.main',
            onClick: () => navigate('/dashboard/admin/page-controls'),
            visible: hasFullAccess || can('login_page_config', 'view'),
        },
        {
            title: 'Operations',
            description: 'Edit member details & book on their behalf (IT support)',
            icon: SupportAgentIcon,
            iconColor: 'warning.main',
            onClick: () => navigate('/dashboard/admin/operations'),
            // Kept in step with the sidebar entry — either desk (patient or
            // doctor) is enough to need the tile.
            visible: !showPlatformConsole && (
                hasFullAccess
                || can('operations_patient', 'view')
                || can('operations_doctor', 'view')
            ),
        },
        // Tenant landing — visible to tenant super-admins / sub-admins
        // editing their own clinic landing page.
        {
            title: 'Landing Page',
            description: 'Hero, dynamic modules, features, FAQ',
            icon: WebIcon,
            iconColor: 'info.main',
            onClick: () => navigate('/dashboard/admin/tenant-landing'),
            // Show on tenant context (not on the platform console). A
            // platform owner *visiting* a tenant's domain is in tenant-
            // admin context for that tenant, so they should see this
            // too — hence we gate on ``!showPlatformConsole`` rather
            // than ``role !== 'platform_owner'``.
            visible:
                !showPlatformConsole && (
                    hasFullAccess
                    || can('landing_config', 'view')
                    || can('landing_module', 'view')
                    // Back-compat: legacy perms keep the tile visible for tenants
                    // still on the v1 ``landing_hero``/``landing_nav``/``landing_features`` keys.
                    || can('landing_hero', 'view')
                    || can('landing_nav', 'view')
                    || can('landing_features', 'view')
                ),
        },
        // Platform owner — apex marketing site (larazen.in).
        {
            title: 'Our Platform Landing',
            description: 'Apex marketing site for new tenant signups',
            icon: LanguageIcon,
            iconColor: 'info.main',
            onClick: () => navigate('/dashboard/platform/landing-config'),
            visible: showPlatformConsole,
        },
        // Platform owner — seed template copied to every newly-onboarded tenant.
        {
            title: 'Tenants Default Landing',
            description: 'Default template seeded to every new tenant',
            icon: ContentCopyIcon,
            iconColor: 'success.main',
            onClick: () => navigate('/dashboard/platform/landing-config?scope=default_template'),
            visible: showPlatformConsole,
        },
        {
            title: 'Tenants',
            description: 'Manage tenants & allocate permissions',
            icon: BusinessIcon,
            iconColor: 'secondary.main',
            onClick: () => navigate('/dashboard/platform/tenants'),
            // Only the PLATFORM_OWNER owns cross-tenant management.
            visible: showPlatformConsole,
        },
        // ── The rest of the vendor's actual product: the SaaS catalog. ──
        {
            title: 'Plans & Pricing',
            description: 'SaaS plans, prices, limits & features',
            icon: BarChartIcon,
            iconColor: 'primary.main',
            onClick: () => navigate('/dashboard/platform/plans'),
            visible: showPlatformConsole,
        },
        {
            title: 'Add-ons',
            description: 'Feature & capacity packs tenants can attach',
            icon: SettingsIcon,
            iconColor: 'success.main',
            onClick: () => navigate('/dashboard/platform/addons'),
            visible: showPlatformConsole,
        },
        {
            title: 'SaaS Subscriptions',
            description: 'Every tenant subscription across the platform',
            icon: VerifiedUserIcon,
            iconColor: 'warning.main',
            onClick: () => navigate('/dashboard/platform/subscriptions'),
            visible: showPlatformConsole,
        },
    ];

    return {
        user,
        isDarkMode,
        hasFullAccess,
        isSuperAdmin,
        isPlatformOwner,
        // True only for the PLATFORM_OWNER on the vendor host — the
        // dashboard home swaps to the tenants overview on it.
        showPlatformConsole,
        actionCards,
        handleLogout,
        handleToggleTheme,
    };
};

export default useAdminDashboard;
