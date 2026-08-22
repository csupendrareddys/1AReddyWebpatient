/**
 * AdminSidebar — Persistent sidebar navigation for admin dashboard
 * Supports collapsed state — shows only icons when closed
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Tooltip } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import LanguageIcon from '@mui/icons-material/Language';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import EventIcon from '@mui/icons-material/Event';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import LogoutIcon from '@mui/icons-material/Logout';
import TuneIcon from '@mui/icons-material/Tune';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import BadgeIcon from '@mui/icons-material/Badge';
import GavelIcon from '@mui/icons-material/Gavel';
import HistoryIcon from '@mui/icons-material/History';
import SecurityIcon from '@mui/icons-material/Security';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ScheduleIcon from '@mui/icons-material/Schedule';
import MedicationIcon from '@mui/icons-material/Medication';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ReceiptIcon from '@mui/icons-material/Receipt';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import PaymentsIcon from '@mui/icons-material/Payments';
import EventNoteIcon from '@mui/icons-material/EventNote';
import WebIcon from '@mui/icons-material/Web';
import BusinessIcon from '@mui/icons-material/Business';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import PriceChangeIcon from '@mui/icons-material/PriceChange';
import LinkIcon from '@mui/icons-material/Link';
import { logoutUser } from '../../../../auth/redux/authSlice';
import usePermissions from '../../../../../common/hooks/usePermissions';
import useIsOnPlatformDomain from '../../../../../common/hooks/useIsOnPlatformDomain';

const AdminSidebar = ({ isOpen, onToggle }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useSelector((state) => state.auth);

    // Use the real RBAC permissions hook. ``hasFullAccess`` is the
    // visibility-gate boolean (super_admin OR platform_owner);
    // ``isSuperAdmin`` and ``isPlatformOwner`` are STRICT — only true
    // for the literal role — so the chip below shows the right label.
    // ``hasFeature(path)`` consults the tenant's resolved subscription
    // plan + add-ons (server-authoritative via /auth/me); used to hide
    // sidebar items the tenant's plan doesn't include. Backend's
    // @feature_required is the security boundary; this hook is UX.
    const {
        hasFullAccess, isSuperAdmin, isPlatformOwner, can, hasFeature,
        isApexReseller,
    } = usePermissions();
    // Cross-tenant management items (Tenants / Plans / Add-ons) only
    // make sense on the platform's own domain. A platform owner who
    // visits a tenant's domain is in tenant-admin context for that
    // tenant — show them the per-tenant items, not the catalog.
    const isOnPlatformDomain = useIsOnPlatformDomain();
    // Vendor staff — the platform tenant's OWN super/sub-admins
    // (``is_platform_staff`` is the user's organisation from /auth/me,
    // not the browsing host). They get the console shell; per-item
    // ``can(...)`` below narrows sub-admins to the modules their role
    // grants, and every console API re-checks server-side.
    const isVendorStaff = Boolean(user?.is_platform_staff)
        && ['super_admin', 'sub_admin'].includes(user?.role);
    const showPlatformConsole =
        (isPlatformOwner || isVendorStaff) && isOnPlatformDomain;
    const roleLabelText = isPlatformOwner
        ? 'PLATFORM OWNER'
        : isSuperAdmin
            ? 'SUPER ADMIN'
            : 'SUB ADMIN';

    const handleLogout = async () => {
        await dispatch(logoutUser());
        navigate('/auth/admin/login');
    };

    const navItems = [
        {
            label: 'Dashboard',
            icon: DashboardIcon,
            path: '/dashboard/admin',
            exact: true,
            visible: true,
        },
        {
            label: 'My Access',
            icon: VpnKeyIcon,
            path: '/dashboard/admin/my-access',
            visible: true,  // visible to ALL admins
        },
        {
            label: 'Profile Settings',
            icon: AccountCircleIcon,
            path: '/dashboard/admin/profile',
            visible: !hasFullAccess,  // visible to ALL sub-admins only
        },
        {
            // Renamed from "View Patients" — now a Customer View with
            // Patient + Corporate sub-sections and per-customer analytics.
            label: 'Customer View',
            icon: PeopleIcon,
            path: '/dashboard/admin/customers',
            visible: !showPlatformConsole && (hasFullAccess || can('patient_list', 'view')),
        },
        {
            // The read-only aggregated Appointments ledger replaces the old
            // "View Appointments" list (which duplicated the same concept).
            label: 'Appointments',
            icon: EventNoteIcon,
            path: '/dashboard/admin/appointments-ledger',
            visible: !showPlatformConsole && (hasFullAccess || can('appointment_list', 'view')),
        },
        {
            // Unified vendor surface — Doctors / Hospitals / Clinics in one
            // page with a type selector. Replaces the three former separate
            // entries. Visible if the admin can see ANY of the three lists;
            // the in-page selector still only shows what each is allowed.
            // Backend RBAC (verify_hospitals etc.) continues to gate the
            // underlying endpoints regardless of this nav visibility.
            label: 'View Vendor',
            icon: BusinessIcon,
            path: '/dashboard/admin/vendors',
            visible: !showPlatformConsole && (
                hasFullAccess
                || can('doctor_list', 'view')
                || can('hospital_list', 'view')
                || can('clinic_list', 'view')
            ),
        },
        {
            label: 'Roles & Permissions',
            icon: SecurityIcon,
            path: '/dashboard/admin/roles',
            visible: hasFullAccess,
        },
        {
            label: 'Sub-Admins',
            icon: BadgeIcon,
            path: '/dashboard/admin/sub-admins',
            visible: hasFullAccess,
        },
        {
            label: 'Approvals',
            icon: GavelIcon,
            path: '/dashboard/admin/approvals',
            // Visible to full-access + any sub-admin holding an approval scope
            // (approval_requests or any of the per-module approve_* permissions).
            visible:
                !showPlatformConsole
                && (hasFullAccess
                    || can('approval_requests', 'view')
                    || can('approve_registration', 'view')
                    || can('approve_appointment', 'view')
                    || can('approve_profile', 'view')
                    || can('approve_working_days', 'view')
                    || can('approve_education', 'view')
                    || can('approve_bank', 'view')
                    || can('approve_bank_account', 'view')
                    || can('approve_payout', 'view'))
                && hasFeature('admin.field_approval'),
        },
        { type: 'divider', visible: hasFullAccess },
        {
            label: 'Pending Approvals',
            icon: VerifiedUserIcon,
            path: '/dashboard/admin/pending-approvals',
            // Consolidated under the Approvals hub (Appointment → Slot Visibility / Gaps).
            visible: false,
        },
        {
            label: 'Manage Admins',
            icon: SupervisorAccountIcon,
            path: '/dashboard/admin/manage-admins',
            // Plan-gated. Tenants without admin.manage_users in their
            // plan can't create sub-admins.
            visible: hasFullAccess && hasFeature('admin.manage_users'),
        },
        {
            label: 'Page Controls',
            icon: TuneIcon,
            path: '/dashboard/admin/page-controls',
            visible:
                (hasFullAccess || can('login_page_config', 'view'))
                && hasFeature('admin.page_configuration'),
        },
        {
            // IT-support: act on behalf of members. super_admin AND
            // platform_owner (hasFullAccess) — the platform owner sees the same
            // IT operations the tenant super-admin has — plus any sub-admin
            // granted either operations module. Two checks, not one: the desks
            // are separately grantable, and an operator who holds only the
            // provider desk still needs the entry to reach it.
            //
            // Visibility only. The backend decides what they can actually
            // reach, and separately whether their edits apply on the spot or
            // queue for review (profile_audit.self_approving_admin).
            label: 'Operations',
            icon: SupportAgentIcon,
            path: '/dashboard/admin/operations',
            visible: !showPlatformConsole && (
                hasFullAccess
                || can('operations_patient', 'view')
                || can('operations_doctor', 'view')
            ),
        },
        // (No platform-owner Landing Page sidebar entry — it's already
        //  surfaced as a dashboard module tile. Adding it here would
        //  duplicate the same destination in two places.)
        // Each tenant super-admin edits THEIR clinic landing — the page
        // visitors see at ``<slug>.larazen.in``. Renamed from "Tenants Deemed
        // Landing Page" to "My Landing Page" to disambiguate from the
        // platform-owner's "Tenants Landing Page Configuration" entry above
        // (which edits the default template, not a specific tenant).
        // Hidden from platform_owner — they don't have a clinic of their own.
        {
            label: 'My Landing Page',
            icon: WebIcon,
            path: '/dashboard/admin/tenant-landing',
            visible:
                user?.role !== 'platform_owner'
                && hasFeature('admin.landing_builder')
                && (
                    hasFullAccess
                    || can('landing_config', 'view')
                    || can('landing_module', 'view')
                    // Back-compat: legacy perms keep the link visible until roles
                    // are re-seeded against the new landing_config/landing_module keys.
                    || can('landing_hero', 'view')
                    || can('landing_nav', 'view')
                    || can('landing_features', 'view')
                ),
        },
        {
            label: 'Tenants',
            icon: BusinessIcon,
            path: '/dashboard/platform/tenants',
            visible: showPlatformConsole
                && (isPlatformOwner || can('tenant_management', 'view')),
        },
        {
            label: 'Support Inbox',
            icon: SupportAgentIcon,
            path: '/dashboard/platform/support',
            visible: showPlatformConsole
                && (isPlatformOwner || can('support_chat', 'view')),
        },
        // ── Vendor console: the SaaS seller's own product surfaces. ──
        // Direct links, because the tenant-facing Subscription hub (which
        // used to reach these) is hidden on the console — the vendor has
        // no subscription of its own to anchor that hub on.
        {
            label: 'Plans & Pricing',
            icon: PriceChangeIcon,
            path: '/dashboard/platform/plans',
            visible: showPlatformConsole
                && (isPlatformOwner || can('plan_catalog', 'view')),
        },
        {
            label: 'Add-ons',
            icon: CardMembershipIcon,
            path: '/dashboard/platform/addons',
            visible: showPlatformConsole
                && (isPlatformOwner || can('addon_catalog', 'view')),
        },
        {
            label: 'SaaS Subscriptions',
            icon: ReceiptLongIcon,
            path: '/dashboard/platform/subscriptions',
            visible: showPlatformConsole
                && (isPlatformOwner || can('plan_subscription', 'view')),
        },
        {
            label: 'Platform Landing',
            icon: WebIcon,
            path: '/dashboard/platform/landing-config',
            visible: showPlatformConsole
                && (isPlatformOwner || can('landing_config', 'view')
                    || can('landing_hero', 'view')),
        },
        // ── Reseller console: an APEX tenant operating its own child
        // tenants and authoring its own SaaS plans. Entitlement comes
        // from the tenant's apex-kind subscription (/auth/me), so no
        // FeatureGuard — the backend's not_apex_tenant 403 is the wall.
        {
            label: 'My Tenants',
            icon: BusinessIcon,
            path: '/dashboard/admin/reseller/tenants',
            visible: hasFullAccess && !showPlatformConsole && isApexReseller,
        },
        {
            label: 'My SaaS Plans',
            icon: PriceChangeIcon,
            path: '/dashboard/admin/reseller/plans',
            visible: hasFullAccess && !showPlatformConsole && isApexReseller,
        },
        {
            label: 'My DNS Zone',
            icon: LanguageIcon,
            path: '/dashboard/admin/reseller/dns',
            visible: hasFullAccess && !showPlatformConsole && isApexReseller,
        },
        {
            label: 'Tenant Support',
            icon: SupportAgentIcon,
            path: '/dashboard/admin/reseller/support',
            visible: !showPlatformConsole && isApexReseller
                && (hasFullAccess || can('support_chat', 'view')),
        },
        {
            // Every tenant's line to its SELLER — deliberately visible
            // even when the plan is suspended (it's how they fix that).
            label: 'Support',
            icon: SupportAgentIcon,
            path: '/dashboard/admin/support',
            visible: !showPlatformConsole
                && (hasFullAccess || can('support_chat', 'view')),
        },
        {
            // Plans, Add-ons and Membership Plans (the platform catalog) are
            // now reached through the Subscription hub
            // (/dashboard/admin/subscription → SaaS / Marketplace sections),
            // alongside the tenant's own subscription and the in-tenant
            // provider plans. Their routes still exist under
            // /dashboard/platform/*; only the standalone sidebar links were
            // folded into the hub.
            label: 'Product Catalog',
            icon: StorefrontIcon,
            path: '/dashboard/admin/products',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Availability Approvals',
            icon: ScheduleIcon,
            path: '/dashboard/admin/availability-approvals',
            // Consolidated under the Approvals hub (Appointment / Working Days).
            visible: false,
        },
        {
            label: 'Group Offering Approvals',
            icon: GroupsIcon,
            path: '/dashboard/admin/service-group-approvals',
            // Consolidated under the Approvals hub (Other Approvals).
            visible: false,
        },
        {
            label: 'Service / Product Approvals',
            icon: GroupsIcon,
            path: '/dashboard/admin/service-product-approvals',
            // Consolidated under the Approvals hub (Other Approvals).
            visible: false,
        },
        {
            label: 'Group Offerings',
            icon: GroupsIcon,
            path: '/dashboard/admin/group-offerings',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Provider Visibility',
            icon: VisibilityIcon,
            path: '/dashboard/admin/provider-visibility',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Pricing Configuration',
            icon: PriceChangeIcon,
            path: '/dashboard/admin/pricing-config',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Feature-Product Linking',
            icon: LinkIcon,
            path: '/dashboard/admin/feature-product-linking',
            visible: hasFullAccess,
        },
        {
            label: 'Medicine Catalog',
            icon: MedicationIcon,
            path: '/dashboard/admin/medicine-catalog',
            visible: !showPlatformConsole && (hasFullAccess || can('manage_medicine_catalog', 'view')),
        },
        {
            label: 'Prescription / Document PDF Editor',
            icon: DescriptionIcon,
            path: '/dashboard/admin/prescription-template',
            visible: hasFullAccess && !showPlatformConsole && hasFeature('doctor.prescriptions_pdf'),
        },
        {
            label: 'Prescription Approvals',
            icon: AssignmentTurnedInIcon,
            path: '/dashboard/admin/prescription-approvals',
            // Consolidated under the Approvals hub (Other Approvals).
            visible: false,
        },
        {
            label: 'Document Approvals',
            icon: AssignmentTurnedInIcon,
            path: '/dashboard/admin/document-approvals',
            // Same as above — reached via Approvals → Other Approvals.
            visible: false,
        },
        {
            label: 'Billing Config',
            icon: ReceiptIcon,
            path: '/dashboard/admin/billing-config',
            visible: hasFullAccess && !showPlatformConsole && hasFeature('admin.billing_config'),
        },
        {
            // First-run setup. Kept visible after completion because it is
            // also the only place a tenant can see whether its own portal
            // is actually reachable.
            //
            // Hidden from the platform owner on the vendor host: the vendor
            // sells the product rather than running one, so a checklist
            // telling it to "add the people who deliver your service" would
            // be nonsense.
            label: 'Getting Started',
            icon: RocketLaunchIcon,
            path: '/dashboard/admin/getting-started',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            // The tenant's OWN routing. Distinct from the platform console's
            // Tenants page, which manages *other* tenants' domains.
            label: 'Domain',
            icon: LanguageIcon,
            path: '/dashboard/admin/domain',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            // Phase 5: pay for / renew the tenant's own SaaS subscription.
            // Role-gated only (never hasFeature) — a suspended tenant has
            // no features left but must still reach this page to pay.
            label: 'Billing',
            icon: ReceiptLongIcon,
            path: '/dashboard/admin/billing',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            // The tenant's OWN Razorpay/Cashfree keys + DLT/SMS config.
            // Collections have no platform fallback, so this is part of
            // go-live. Same role-only gating rationale as Billing.
            label: 'Payments & SMS',
            icon: AccountBalanceIcon,
            path: '/dashboard/admin/payment-gateway',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            // Single entry point for every subscription surface. Opens the
            // Page-Controls-style Subscription hub, which drills into three
            // product-axis sections — SaaS Subscription (My Subscription +
            // platform Plans/Add-ons), Marketplace Membership (Membership
            // Plans), and In-Tenant Provider (Provider Plans + Provider
            // Subscriptions). The hub filters cards by role/entitlement, so
            // the standalone Provider Plans / Provider Subscriptions /
            // platform-catalog links that used to live here are folded in.
            label: 'Subscription',
            icon: CardMembershipIcon,
            path: '/dashboard/admin/subscription',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Payout Management',
            icon: PaymentsIcon,
            path: '/dashboard/admin/payout-management',
            visible: hasFullAccess && !showPlatformConsole,
        },
        {
            label: 'Onboarding / Holding Chats',
            icon: SupportAgentIcon,
            path: '/dashboard/admin/holding-chats',
            visible: hasFullAccess && !showPlatformConsole,
        },
        { type: 'divider', visible: hasFullAccess },
        {
            label: 'Audit Logs',
            icon: HistoryIcon,
            path: '/dashboard/admin/audit-logs',
            visible:
                (hasFullAccess || can('audit_logs', 'view'))
                && hasFeature('admin.audit_logs'),
        },
        {
            label: 'Reports',
            icon: BarChartIcon,
            path: null,
            visible: hasFullAccess && !showPlatformConsole,
            disabled: true,
        },
        {
            label: 'Settings',
            icon: SettingsIcon,
            path: null,
            visible: hasFullAccess,
            disabled: true,
        },
    ];

    const isActive = (item) => {
        if (item.exact) return location.pathname === item.path;
        return location.pathname.startsWith(item.path);
    };

    const userInitials = user
        ? `${(user.first_name || '')[0] || ''}${(user.last_name || '')[0] || ''}`.toUpperCase()
        : 'A';

    return (
        <aside className={`admin-sidebar ${!isOpen ? 'admin-sidebar--collapsed' : ''}`}>
            {/* Logo */}
            <div className="admin-sidebar__logo">
                <div className="admin-sidebar__logo-icon">
                    <AdminPanelSettingsIcon fontSize="inherit" />
                </div>
                {isOpen && <span className="admin-sidebar__logo-text">JLMUSH</span>}
            </div>

            {/* User Info */}
            {isOpen ? (
                <div className="admin-sidebar__user">
                    <div className="admin-sidebar__user-avatar">{userInitials}</div>
                    <div className="admin-sidebar__user-info">
                        <div className="admin-sidebar__user-name">
                            {user?.first_name} {user?.last_name}
                        </div>
                        <span
                            className={`admin-sidebar__user-role ${
                                hasFullAccess || isPlatformOwner
                                    ? 'admin-sidebar__user-role--super'
                                    : 'admin-sidebar__user-role--sub'
                            }`}
                        >
                            {roleLabelText}
                        </span>
                    </div>
                </div>
            ) : (
                <div className="admin-sidebar__user-collapsed">
                    <Tooltip title={`${user?.first_name || ''} ${user?.last_name || ''}`} placement="right">
                        <div className="admin-sidebar__user-avatar">{userInitials}</div>
                    </Tooltip>
                </div>
            )}

            {/* Navigation */}
            <nav className="admin-sidebar__nav">
                {navItems
                    .filter((item) => item.visible)
                    .map((item, index) => {
                        if (item.type === 'divider') {
                            return <div key={`div-${index}`} className="admin-sidebar__divider" />;
                        }

                        const Icon = item.icon;
                        const active = item.path && isActive(item);

                        const button = (
                            <button
                                key={item.label}
                                className={`admin-sidebar__nav-item ${
                                    active ? 'admin-sidebar__nav-item--active' : ''
                                }`}
                                onClick={() => {
                                    if (!item.disabled && item.path) navigate(item.path);
                                }}
                                disabled={item.disabled}
                                style={item.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                            >
                                <Icon className="admin-sidebar__nav-icon" />
                                {isOpen && <span>{item.label}</span>}
                            </button>
                        );

                        // Show tooltip when collapsed
                        if (!isOpen) {
                            return (
                                <Tooltip key={item.label} title={item.label} placement="right" arrow>
                                    {button}
                                </Tooltip>
                            );
                        }

                        return button;
                    })}
            </nav>

            {/* Bottom section: collapse toggle + logout */}
            <div className="admin-sidebar__bottom">
                {/* Collapse Toggle */}
                <button className="admin-sidebar__toggle-btn" onClick={onToggle}>
                    {isOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    {isOpen && <span>Collapse</span>}
                </button>

                <div className="admin-sidebar__divider" />

                {/* Logout */}
                {isOpen ? (
                    <button className="admin-sidebar__logout-btn" onClick={handleLogout}>
                        <LogoutIcon className="admin-sidebar__nav-icon" />
                        <span>Logout</span>
                    </button>
                ) : (
                    <Tooltip title="Logout" placement="right" arrow>
                        <button className="admin-sidebar__logout-btn" onClick={handleLogout}>
                            <LogoutIcon className="admin-sidebar__nav-icon" />
                        </button>
                    </Tooltip>
                )}
            </div>
        </aside>
    );
};

export default AdminSidebar;
