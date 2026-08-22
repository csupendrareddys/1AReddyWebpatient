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
import BiotechIcon from '@mui/icons-material/Biotech';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ScienceIcon from '@mui/icons-material/Science';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';

const DiagnosisDashboard = () => {
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
                    <BiotechIcon color="info" sx={{ fontSize: 32 }} />
                    <Typography variant="h5" color="info.main" fontWeight="bold">
                        Diagnosis Center Portal
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton onClick={() => dispatch(toggleTheme())}>
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                    <Chip
                        avatar={<Avatar><BiotechIcon /></Avatar>}
                        label={user?.name || user?.first_name || 'Diagnosis'}
                        color="info"
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
                        <Avatar sx={{ width: 64, height: 64, bgcolor: 'info.main' }}>
                            <BiotechIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="h4">
                                Welcome, {user?.name || user?.first_name || 'Diagnosis Center'}!
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <Chip
                                    label="DIAGNOSIS CENTER"
                                    color="info"
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
                                <ScienceIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                                <Typography variant="h6">Lab Tests</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Manage test services
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <AssignmentIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                                <Typography variant="h6">Reports</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View and upload results
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

export default DiagnosisDashboard;
