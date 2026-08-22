import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    Paper,
    Avatar,
    Chip,
    IconButton,
    Tooltip,
    Grid,
    Card,
    CardContent,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import PeopleIcon from '@mui/icons-material/People';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import SettingsIcon from '@mui/icons-material/Settings';
import BarChartIcon from '@mui/icons-material/BarChart';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';

const AdminDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    const handleLogout = async () => {
        await dispatch(logoutUser());
        navigate('/auth/admin/login');
    };

    const isSuperAdmin = user?.role === 'super_admin';
    const isPlatformOwner = user?.role === 'platform_owner';
    const roleLabel = isPlatformOwner
        ? 'PLATFORM OWNER'
        : isSuperAdmin
            ? 'SUPER ADMIN'
            : 'SUB ADMIN';

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
            {/* Header */}
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
                        <IconButton onClick={() => dispatch(toggleTheme())} sx={{ color: 'white' }}>
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                    <Chip
                        avatar={<Avatar sx={{ bgcolor: 'warning.light' }}><AdminPanelSettingsIcon /></Avatar>}
                        label={user?.first_name || 'Admin'}
                        sx={{ bgcolor: 'white' }}
                    />
                    <Tooltip title="Logout">
                        <IconButton onClick={handleLogout} sx={{ color: 'white' }}>
                            <LogoutIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Paper>

            {/* Main Content */}
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Paper elevation={3} sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Avatar sx={{ width: 64, height: 64, bgcolor: 'warning.main' }}>
                            <AdminPanelSettingsIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="h4">
                                Welcome, {user?.first_name} {user?.last_name}!
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <Chip
                                    label={roleLabel}
                                    color="warning"
                                    size="small"
                                />
                            </Box>
                        </Box>
                    </Box>
                    <Typography variant="body1" color="text.secondary">
                        Email: {user?.email || 'Not available'}
                    </Typography>
                </Paper>

                <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
                    Admin Actions
                </Typography>

                <Grid container spacing={3}>
                    <Grid item xs={12} md={3}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <PeopleIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                                <Typography variant="h6">Manage Users</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View and manage all users
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <VerifiedUserIcon sx={{ fontSize: 48, color: 'success.main', mb: 2 }} />
                                <Typography variant="h6">Pending Approvals</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Approve service providers
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <BarChartIcon sx={{ fontSize: 48, color: 'info.main', mb: 2 }} />
                                <Typography variant="h6">Reports</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View system analytics
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <SettingsIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                                <Typography variant="h6">Settings</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    System configuration
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </Box>
    );
};

export default AdminDashboard;
