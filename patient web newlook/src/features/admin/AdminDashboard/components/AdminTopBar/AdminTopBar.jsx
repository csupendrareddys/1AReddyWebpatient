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
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme, DARK_MODE_ENABLED } from '../../../../auth/redux/themeSlice';

const AdminTopBar = ({ onToggleSidebar, sidebarOpen }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    const userInitials = user
        ? `${(user.first_name || '')[0] || ''}${(user.last_name || '')[0] || ''}`.toUpperCase()
        : 'A';

    // In-app "Back" — one logical level up (parent route), deterministic where
    // the browser Back jumps multiple pushed history entries. Hidden at the
    // ``/dashboard/admin`` root.
    const segments = location.pathname.split('/').filter(Boolean);
    const canGoBack = segments.length > 2;
    const goBack = () => {
        if (segments.length > 2) navigate('/' + segments.slice(0, -1).join('/'));
    };

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
                <Tooltip title="Settings">
                    <IconButton className="admin-topbar__icon-btn" size="small">
                        <SettingsOutlinedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Search">
                    <IconButton className="admin-topbar__icon-btn" size="small">
                        <SearchIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Notifications">
                    <IconButton className="admin-topbar__icon-btn" size="small">
                        <NotificationsNoneIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
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
                <Tooltip title={user?.first_name || 'Profile'}>
                    <div className="admin-topbar__avatar">{userInitials}</div>
                </Tooltip>
            </div>
        </div>
    );
};

export default AdminTopBar;
