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
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';

const DoctorDashboard = () => {
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
                    <LocalHospitalIcon color="secondary" sx={{ fontSize: 32 }} />
                    <Typography variant="h5" color="secondary" fontWeight="bold">
                        Doctor Portal
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton onClick={() => dispatch(toggleTheme())}>
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                    <Chip
                        avatar={<Avatar><LocalHospitalIcon /></Avatar>}
                        label={`Dr. ${user?.first_name || 'Doctor'}`}
                        color="secondary"
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
                        <Avatar sx={{ width: 64, height: 64, bgcolor: 'secondary.main' }}>
                            <LocalHospitalIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="h4">
                                Welcome, Dr. {user?.first_name} {user?.last_name}!
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <Chip
                                    label={`Role: ${user?.role?.toUpperCase() || 'DOCTOR'}`}
                                    color="secondary"
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
                    <Typography variant="body1" color="text.secondary">
                        Phone: {user?.phone_number || 'Not available'}
                    </Typography>
                </Paper>

                <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
                    Quick Actions
                </Typography>

                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card 
                            onClick={() => navigate('/dashboard/doctor/appointments')}
                            sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}
                        >
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <CalendarMonthIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                                <Typography variant="h6">My Appointments</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View and manage your appointments
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <PeopleIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                                <Typography variant="h6">My Patients</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    View patient records and history
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '100%', cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.2s' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <SettingsIcon sx={{ fontSize: 48, color: 'info.main', mb: 2 }} />
                                <Typography variant="h6">Profile Settings</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Update your profile and availability
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </Box>
    );
};

export default DoctorDashboard;
