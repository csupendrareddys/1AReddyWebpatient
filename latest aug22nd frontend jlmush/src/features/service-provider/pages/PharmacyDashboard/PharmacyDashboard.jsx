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
    Alert,
} from '@mui/material';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import InventoryIcon from '@mui/icons-material/Inventory';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SettingsIcon from '@mui/icons-material/Settings';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';

const PharmacyDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    const handleLogout = async () => {
        await dispatch(logoutUser());
        navigate('/auth/service-provider/login');
    };

    const isInactive = user?.status === 'inactive' || user?.status === 'pending';

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
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <LocalPharmacyIcon color="success" sx={{ fontSize: 32 }} />
                    <Typography variant="h5" color="success.main" fontWeight="bold">
                        Pharmacy Portal
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton onClick={() => dispatch(toggleTheme())}>
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                    <Chip
                        avatar={<Avatar><LocalPharmacyIcon /></Avatar>}
                        label={user?.name || user?.first_name || 'Pharmacy'}
                        color="success"
                        variant="outlined"
                    />
                    <Tooltip title="Logout">
                        <IconButton onClick={handleLogout} color="error">
                            <LogoutIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Paper>

            {/* Main Content */}
            <Container maxWidth="lg" sx={{ py: 4 }}>
                {isInactive && (
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        Your account is pending admin approval. Some features may be limited.
                    </Alert>
                )}

                <Paper elevation={3} sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Avatar sx={{ width: 64, height: 64, bgcolor: 'success.main' }}>
                            <LocalPharmacyIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="h4">
                                Welcome, {user?.name || user?.first_name || 'Pharmacy'}!
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <Chip
                                    label="PHARMACY"
                                    color="success"
                                    size="small"
                                />
                                <Chip
                                    label={`Status: ${user?.status?.toUpperCase() || 'PENDING'}`}
                                    color={isInactive ? 'warning' : 'success'}
                                    size="small"
                                />
                            </Box>
                        </Box>
                    </Box>
                    <Typography variant="body1" color="text.secondary">
                        Email: {user?.email || 'Not available'}
                    </Typography>
                </Paper>

                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <InventoryIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                                <Typography variant="h6">Inventory</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Manage medicine stock
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <ShoppingCartIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                                <Typography variant="h6">Orders</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View prescription orders
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <SettingsIcon sx={{ fontSize: 48, color: 'info.main', mb: 2 }} />
                                <Typography variant="h6">Settings</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Update profile
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </Box>
    );
};

export default PharmacyDashboard;
