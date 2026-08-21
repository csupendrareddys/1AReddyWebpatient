/**
 * DashboardTopBar — Reusable top action bar
 * Provides sidebar toggle, theme toggle, notifications, user avatar
 */
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconButton, Tooltip } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme, DARK_MODE_ENABLED } from '../../../features/auth/redux/themeSlice';
import PatientCreditChip from '../../../features/service-receiver/components/PatientCreditChip/PatientCreditChip';

const DashboardTopBar = ({ onToggleSidebar, sidebarOpen, accentColor }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    // In-app "Back" that goes up ONE logical level (parent route) instead of
    // navigate(-1). Multi-step flows (booking, act-on-behalf) push several
    // history entries per screen, so the browser Back jumps unpredictably;
    // walking one URL segment up is deterministic. Hidden at a role root
    // (``/dashboard/<role>``) where there's nothing above to go to.
    const segments = location.pathname.split('/').filter(Boolean);
    const canGoBack = segments.length > 2;
    const goBack = () => {
        if (segments.length > 2) navigate('/' + segments.slice(0, -1).join('/'));
    };

    const userInitials = user
        ? `${(user.first_name || user.name || '')[0] || ''}${(user.last_name || '')[0] || ''}`.toUpperCase()
        : '?';

    return (
        <div className="dashboard-topbar">
            <Tooltip title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
                <IconButton className="dashboard-topbar__icon-btn" size="small" onClick={onToggleSidebar}>
                    {sidebarOpen ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
                </IconButton>
            </Tooltip>

            {canGoBack && (
                <Tooltip title="Back">
                    <IconButton className="dashboard-topbar__icon-btn" size="small" onClick={goBack}>
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            <PatientCreditChip />

            <div style={{ flex: 1 }} />

            <div className="dashboard-topbar__actions">
                <Tooltip title="Search">
                    <IconButton className="dashboard-topbar__icon-btn" size="small">
                        <SearchIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Notifications">
                    <IconButton className="dashboard-topbar__icon-btn" size="small">
                        <NotificationsNoneIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                {DARK_MODE_ENABLED && (
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton
                            className="dashboard-topbar__icon-btn"
                            size="small"
                            onClick={() => dispatch(toggleTheme())}
                        >
                            {isDarkMode ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title={user?.first_name || 'Profile'}>
                    <div
                        className="dashboard-topbar__avatar"
                        style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)` }}
                    >
                        {userInitials}
                    </div>
                </Tooltip>
            </div>
        </div>
    );
};

export default DashboardTopBar;
