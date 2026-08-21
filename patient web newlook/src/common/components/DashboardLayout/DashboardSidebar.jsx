/**
 * DashboardSidebar — Reusable collapsible sidebar navigation
 * Accepts role-specific config: navItems, branding, accent color
 */
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Tooltip } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { logoutUser } from '../../../features/auth/redux/authSlice';

const DashboardSidebar = ({
    isOpen,
    onToggle,
    config, // { portalName, portalIcon, accentColor, loginPath, navItems }
}) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const { user } = useSelector((state) => state.auth);
    // Which collapsible groups the user has explicitly opened or closed.
    // A group left untouched follows the route: it opens when the section it
    // belongs to is the one being viewed, so arriving by deep link or a
    // reload never hides the row you're standing on.
    const [openGroups, setOpenGroups] = useState({});

    const handleLogout = async () => {
        await dispatch(logoutUser());
        navigate(config.loginPath || '/');
    };

    const isActive = (item) => {
        if (!item.path) return false;

        // If the item path has query params (e.g., /dashboard/patient?view=doctors)
        if (item.path.includes('?')) {
            const [itemPathname, itemSearch] = item.path.split('?');
            if (location.pathname !== itemPathname) return false;
            const itemParams = new URLSearchParams(itemSearch);
            for (const [key, val] of itemParams.entries()) {
                if (searchParams.get(key) !== val) return false;
            }
            return true;
        }

        // Exact match: pathname must match AND none of the params that select a
        // sub-view are set. ``view`` drives the classic dashboard's modes and the
        // new-look Bookings stages; ``tab`` drives the Book Appointments
        // sub-heads. Without ``tab`` here, the default sub-head's row stayed lit
        // while a different sub-head was open.
        if (item.exact) {
            return location.pathname === item.path
                && !searchParams.has('view')
                && !searchParams.has('tab');
        }

        return location.pathname.startsWith(item.path);
    };

    /** A group is open when explicitly opened, or when it holds the active row. */
    const isGroupOpen = (groupKey) => {
        if (openGroups[groupKey] !== undefined) return openGroups[groupKey];
        const owner = config.navItems.find((i) => i.groupKey === groupKey);
        // A group marked ``defaultOpen`` starts expanded, so its sub-heads are
        // visible without a click; the user can still fold it away.
        if (owner?.defaultOpen) return true;
        return config.navItems.some(
            (i) => (i.groupKey === groupKey || i.parentKey === groupKey) && isActive(i),
        );
    };

    const toggleGroup = (groupKey) => {
        const currentlyOpen = isGroupOpen(groupKey);
        setOpenGroups((prev) => ({ ...prev, [groupKey]: !currentlyOpen }));
    };

    const handleNavClick = (item) => {
        if (item.disabled || !item.path) return;
        // If path contains ?, use navigate with pathname + search
        if (item.path.includes('?')) {
            const [pathname, search] = item.path.split('?');
            navigate({ pathname, search: `?${search}` });
        } else {
            navigate(item.path);
        }
    };

    const userInitials = user
        ? `${(user.first_name || user.name || '')[0] || ''}${(user.last_name || '')[0] || ''}`.toUpperCase()
        : '?';

    const userName = user?.first_name
        ? `${user.first_name} ${user.last_name || ''}`
        : user?.name || 'User';

    const PortalIcon = config.portalIcon;

    return (
        <aside className={`dashboard-sidebar ${!isOpen ? 'dashboard-sidebar--collapsed' : ''}`}>
            {/* Logo */}
            <div className="dashboard-sidebar__logo">
                <div
                    className="dashboard-sidebar__logo-icon"
                    style={{ background: `linear-gradient(135deg, ${config.accentColor}, ${config.accentDark || config.accentColor})`, boxShadow: `0 4px 12px ${config.accentColor}40` }}
                >
                    <PortalIcon fontSize="inherit" />
                </div>
                {isOpen && <span className="dashboard-sidebar__logo-text">{config.portalName}</span>}
            </div>

            {/* User Info */}
            {isOpen ? (
                <div className="dashboard-sidebar__user">
                    <div className="dashboard-sidebar__user-avatar" style={{ background: `linear-gradient(135deg, ${config.accentColor}, ${config.accentDark || config.accentColor})` }}>
                        {userInitials}
                    </div>
                    <div className="dashboard-sidebar__user-info">
                        <div className="dashboard-sidebar__user-name">{userName}</div>
                        <span
                            className="dashboard-sidebar__user-role"
                            style={{ background: `${config.accentColor}20`, color: config.accentColor }}
                        >
                            {config.roleLabel || user?.role?.toUpperCase() || 'USER'}
                        </span>
                    </div>
                </div>
            ) : (
                <div className="dashboard-sidebar__user-collapsed">
                    <Tooltip title={userName} placement="right">
                        <div className="dashboard-sidebar__user-avatar" style={{ background: `linear-gradient(135deg, ${config.accentColor}, ${config.accentDark || config.accentColor})` }}>
                            {userInitials}
                        </div>
                    </Tooltip>
                </div>
            )}

            {/* Navigation */}
            <nav className="dashboard-sidebar__nav">
                {config.navItems
                    .filter((item) => item.visible !== false)
                    .map((item, index) => {
                        if (item.type === 'divider') {
                            return <div key={`div-${index}`} className="dashboard-sidebar__divider" />;
                        }

                        // A caption over a run of items, for sidebars whose
                        // entries aren't all the same kind of thing. Hidden
                        // when collapsed — the rail has no room for a word, and
                        // a truncated one labels nothing.
                        if (item.type === 'header') {
                            return (
                                <div key={`hdr-${index}`} className="dashboard-sidebar__nav-header">
                                    {item.label}
                                </div>
                            );
                        }

                        // A child row is hidden while ANY ancestor is collapsed —
                        // walk the chain, so a grandchild folds away with its
                        // grandparent and not only with its own parent.
                        let ancestor = item.parentKey;
                        let hidden = false;
                        while (ancestor) {
                            if (!isGroupOpen(ancestor)) { hidden = true; break; }
                            const owner = config.navItems.find((i) => i.groupKey === ancestor);
                            ancestor = owner?.parentKey;
                        }
                        if (hidden) return null;

                        const Icon = item.icon;
                        const active = item.path && isActive(item);
                        const isParent = !!item.groupKey;
                        const groupOpen = isParent && isGroupOpen(item.groupKey);

                        // Keyed by path, not label: a sidebar may legitimately
                        // carry the same label twice (e.g. two "Home" entries in
                        // separate captioned groups), and a duplicate key makes
                        // React reuse the wrong row.
                        const key = item.path || `${item.label}-${index}`;

                        const button = (
                            <button
                                key={key}
                                className={`dashboard-sidebar__nav-item ${active ? 'dashboard-sidebar__nav-item--active' : ''}`}
                                onClick={() => {
                                    // Clicking the head opens its sub-heads AND
                                    // lands on the group's default page.
                                    if (isParent) {
                                        setOpenGroups((prev) => ({ ...prev, [item.groupKey]: true }));
                                    }
                                    handleNavClick(item);
                                }}
                                disabled={item.disabled}
                                style={{
                                    ...(item.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                                    ...(active ? { background: `${config.accentColor}15`, color: config.accentColor } : {}),
                                    // Sub-entries (e.g. a page's stages) sit
                                    // visibly under their parent when expanded.
                                    ...(item.indent && isOpen ? { paddingLeft: 34, fontSize: '0.85em' } : {}),
                                }}
                            >
                                <Icon
                                    className="dashboard-sidebar__nav-icon"
                                    style={active ? { color: config.accentColor } : {}}
                                />
                                {isOpen && <span>{item.label}</span>}
                                {/* Live count, when the config supplies one.
                                    Zero is shown too — "0 pending" is an answer,
                                    and a row that appears only sometimes is
                                    harder to find than one that's always there. */}
                                {isOpen && item.count != null ? (
                                    <span
                                        style={{
                                            marginLeft: 'auto',
                                            minWidth: 20,
                                            padding: '1px 6px',
                                            borderRadius: 10,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            textAlign: 'center',
                                            background: active ? `${config.accentColor}25` : '#eef1f4',
                                            color: active ? config.accentColor : '#5f6b7a',
                                        }}
                                    >
                                        {item.count}
                                    </span>
                                ) : null}
                                {isOpen && isParent ? (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label={groupOpen ? 'Collapse section' : 'Expand section'}
                                        // Stop the row's own navigation: the
                                        // chevron is for folding the section
                                        // away without leaving the page.
                                        onClick={(e) => { e.stopPropagation(); toggleGroup(item.groupKey); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                toggleGroup(item.groupKey);
                                            }
                                        }}
                                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}
                                    >
                                        {groupOpen
                                            ? <ExpandLessIcon style={{ fontSize: 18 }} />
                                            : <ExpandMoreIcon style={{ fontSize: 18 }} />}
                                    </span>
                                ) : null}
                                {active && (
                                    <span style={{
                                        position: 'absolute', left: 0, top: '20%', width: 3, height: '60%',
                                        background: config.accentColor, borderRadius: '0 3px 3px 0',
                                    }} />
                                )}
                            </button>
                        );

                        if (!isOpen) {
                            return (
                                <Tooltip key={key} title={item.label} placement="right" arrow>
                                    {button}
                                </Tooltip>
                            );
                        }
                        return button;
                    })}
            </nav>

            {/* Bottom: toggle + logout */}
            <div className="dashboard-sidebar__bottom">
                <button className="dashboard-sidebar__toggle-btn" onClick={onToggle}>
                    {isOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    {isOpen && <span>Collapse</span>}
                </button>
                <div className="dashboard-sidebar__divider" />
                {isOpen ? (
                    <button className="dashboard-sidebar__logout-btn" onClick={handleLogout}>
                        <LogoutIcon className="dashboard-sidebar__nav-icon" />
                        <span>Logout</span>
                    </button>
                ) : (
                    <Tooltip title="Logout" placement="right" arrow>
                        <button className="dashboard-sidebar__logout-btn" onClick={handleLogout}>
                            <LogoutIcon className="dashboard-sidebar__nav-icon" />
                        </button>
                    </Tooltip>
                )}
            </div>
        </aside>
    );
};

export default DashboardSidebar;
