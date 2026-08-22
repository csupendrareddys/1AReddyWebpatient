/**
 * UserAvatarMenu — the profile-photo menu every post-login top bar
 * shares: click the avatar to see who you are (name, email, role) with
 * "Profile settings" and "Logout" right there. One component so the
 * admin console and every portal (doctor, clinic, hospital, patient,
 * caregiver, …) behave identically.
 */
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    Box, Divider, ListItemIcon, Menu, MenuItem, Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsOutlinedIcon from
    '@mui/icons-material/ManageAccountsOutlined';

import { logoutUser } from '../../../features/auth/redux/authSlice';

export default function UserAvatarMenu({
    className, style, profilePath, loginPath,
}) {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const [anchor, setAnchor] = useState(null);

    const initials = user
        ? `${(user.first_name || user.name || '')[0] || ''}`
          + `${(user.last_name || '')[0] || ''}`
        : '?';
    const fullName = user
        ? [user.first_name, user.last_name].filter(Boolean).join(' ')
          || user.name || 'Signed in'
        : 'Signed in';
    const roleLabel = (user?.role || '').replace(/_/g, ' ').toUpperCase();

    const close = () => setAnchor(null);

    const handleLogout = async () => {
        close();
        // Same semantics as the sidebar Logout buttons: end the session
        // server-side, then land on this portal's own door.
        await dispatch(logoutUser());
        navigate(loginPath || '/');
    };

    return (
        <>
            <Box
                component="button"
                type="button"
                aria-label="Account menu"
                className={className}
                style={{ cursor: 'pointer', border: 'none', ...style }}
                onClick={(e) => setAnchor(e.currentTarget)}
            >
                {initials.toUpperCase()}
            </Box>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <Box sx={{ px: 2, py: 1, maxWidth: 260 }}>
                    <Typography variant="subtitle2" noWrap>
                        {fullName}
                    </Typography>
                    {user?.email && (
                        <Typography variant="caption" color="text.secondary"
                            noWrap component="div">
                            {user.email}
                        </Typography>
                    )}
                    {roleLabel && (
                        <Typography variant="caption" color="primary"
                            sx={{ fontWeight: 700 }}>
                            {roleLabel}
                        </Typography>
                    )}
                </Box>
                <Divider />
                {profilePath && (
                    <MenuItem onClick={() => { close(); navigate(profilePath); }}>
                        <ListItemIcon>
                            <ManageAccountsOutlinedIcon fontSize="small" />
                        </ListItemIcon>
                        Profile settings
                    </MenuItem>
                )}
                <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                    <ListItemIcon>
                        <LogoutIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    Logout
                </MenuItem>
            </Menu>
        </>
    );
}
