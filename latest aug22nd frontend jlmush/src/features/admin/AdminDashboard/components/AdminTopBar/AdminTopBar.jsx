/**
 * AdminTopBar — Top action bar with hamburger menu, search, notifications, theme toggle, user avatar
 */
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconButton, Tooltip } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme, DARK_MODE_ENABLED } from '../../../../auth/redux/themeSlice';
import NotificationsBell from '../../../../notifications/NotificationsBell';
import UserAvatarMenu from '../../../../../common/components/UserAvatarMenu/UserAvatarMenu';
import backPathFor from '../../../../../common/utils/backPath';

const AdminTopBar = ({ onToggleSidebar, sidebarOpen }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { isDarkMode } = useSelector((state) => state.theme);

    // In-app "Back" — one logical level up (parent route), deterministic where
    // the browser Back jumps multiple pushed history entries. Hidden at the
    // ``/dashboard/admin`` root.
    // Route-aware: skips record-id segments so Back never lands on a
    // non-route (e.g. /tenants/<uuid>, which has no page of its own).
    const backTo = backPathFor(location.pathname, 2);
    const canGoBack = Boolean(backTo);
    const goBack = () => { if (backTo) navigate(backTo); };

    return (
        <div className="admin-topbar">
            {/* Sidebar toggle */}
            <Tooltip title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
                <IconButton className="admin-topbar__icon-btn" size="small" onClick={onToggleSidebar}>
                    {sidebarOpen ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
                </IconButton>
            </Tooltip>

            {canGoBack && (
                <Tooltip title="Back">
                    <IconButton className="admin-topbar__icon-btn" size="small" onClick={goBack}>
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            <div style={{ flex: 1 }} />

            <div className="admin-topbar__actions">
                <Tooltip title="Profile settings">
                    <IconButton
                        className="admin-topbar__icon-btn" size="small"
                        onClick={() => navigate('/dashboard/admin/profile')}
                    >
                        <SettingsOutlinedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Search">
                    <IconButton className="admin-topbar__icon-btn" size="small">
                        <SearchIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <NotificationsBell className="admin-topbar__icon-btn" />
                {DARK_MODE_ENABLED && (
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton
                            className="admin-topbar__icon-btn"
                            size="small"
                            onClick={() => dispatch(toggleTheme())}
                        >
                            {isDarkMode ? (
                                <Brightness7Icon fontSize="small" />
                            ) : (
                                <Brightness4Icon fontSize="small" />
                            )}
                        </IconButton>
                    </Tooltip>
                )}
                <UserAvatarMenu
                    className="admin-topbar__avatar"
                    profilePath="/dashboard/admin/profile"
                    loginPath="/auth/admin/login"
                />
            </div>
        </div>
    );
};

export default AdminTopBar;
