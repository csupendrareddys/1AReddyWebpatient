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
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme, DARK_MODE_ENABLED } from '../../../features/auth/redux/themeSlice';
import PatientCreditChip from '../../../features/service-receiver/components/PatientCreditChip/PatientCreditChip';
import NotificationsBell from '../../../features/notifications/NotificationsBell';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import UserAvatarMenu from '../UserAvatarMenu/UserAvatarMenu';
import backPathFor from '../../utils/backPath';

const DashboardTopBar = ({ onToggleSidebar, sidebarOpen, accentColor, profilePath, loginPath }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { isDarkMode } = useSelector((state) => state.theme);

    // In-app "Back" that goes up ONE logical level (parent route) instead of
    // navigate(-1). Multi-step flows (booking, act-on-behalf) push several
    // history entries per screen, so the browser Back jumps unpredictably;
    // walking one URL segment up is deterministic. Hidden at a role root
    // (``/dashboard/<role>``) where there's nothing above to go to.
    // Route-aware: skips record-id segments so Back never lands on a
    // non-route (e.g. /tenants/<uuid>, which has no page of its own).
    const backTo = backPathFor(location.pathname, 2);
    const canGoBack = Boolean(backTo);
    const goBack = () => { if (backTo) navigate(backTo); };

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
                {profilePath && (
                    <Tooltip title="Profile settings">
                        <IconButton
                            className="dashboard-topbar__icon-btn" size="small"
                            onClick={() => navigate(profilePath)}
                        >
                            <SettingsOutlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Search">
                    <IconButton className="dashboard-topbar__icon-btn" size="small">
                        <SearchIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <NotificationsBell className="dashboard-topbar__icon-btn" />
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
                <UserAvatarMenu
                    className="dashboard-topbar__avatar"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)` }}
                    profilePath={profilePath}
                    loginPath={loginPath}
                />
            </div>
        </div>
    );
};

export default DashboardTopBar;
