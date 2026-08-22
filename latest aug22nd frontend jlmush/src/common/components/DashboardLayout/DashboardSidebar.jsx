/**
 * DashboardSidebar — Reusable collapsible sidebar navigation
 * Accepts role-specific config: navItems, branding, accent color
 */
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Tooltip } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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

        // Exact match: pathname must match AND no extra search params (like ?view=...)
        if (item.exact) {
            return location.pathname === item.path && !searchParams.has('view');
        }

        return location.pathname.startsWith(item.path);
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

                        const Icon = item.icon;
                        const active = item.path && isActive(item);

                        const button = (
                            <button
                                key={item.label}
                                className={`dashboard-sidebar__nav-item ${active ? 'dashboard-sidebar__nav-item--active' : ''}`}
                                onClick={() => handleNavClick(item)}
                                disabled={item.disabled}
                                style={{
                                    ...(item.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                                    ...(active ? { background: `${config.accentColor}15`, color: config.accentColor } : {}),
                                }}
                            >
                                <Icon
                                    className="dashboard-sidebar__nav-icon"
                                    style={active ? { color: config.accentColor } : {}}
                                />
                                {isOpen && <span>{item.label}</span>}
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
                                <Tooltip key={item.label} title={item.label} placement="right" arrow>
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
