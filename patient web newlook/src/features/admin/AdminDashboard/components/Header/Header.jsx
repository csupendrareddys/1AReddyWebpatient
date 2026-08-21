/**
 * Header — Admin Dashboard top bar with theme toggle, user info, and logout
 */
import {
    Paper,
    Box,
    Typography,
    IconButton,
    Tooltip,
    Chip,
    Avatar,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';

const Header = ({ userName, isDarkMode, onToggleTheme, onLogout }) => (
    <Paper
        elevation={2}
        sx={{
            p: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderRadius: 0,
            bgcolor: 'warning.dark',
        }}
    >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <AdminPanelSettingsIcon sx={{ fontSize: 32, color: 'white' }} />
            <Typography variant="h5" fontWeight="bold" color="white">
                Admin Portal
            </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                <IconButton onClick={onToggleTheme} sx={{ color: 'white' }}>
                    {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                </IconButton>
            </Tooltip>
            <Chip
                avatar={
                    <Avatar sx={{ bgcolor: 'warning.light' }}>
                        <AdminPanelSettingsIcon />
                    </Avatar>
                }
                label={userName || 'Admin'}
                sx={{ bgcolor: 'white' }}
            />
            <Tooltip title="Logout">
                <IconButton onClick={onLogout} sx={{ color: 'white' }}>
                    <LogoutIcon />
                </IconButton>
            </Tooltip>
        </Box>
    </Paper>
);

export default Header;
