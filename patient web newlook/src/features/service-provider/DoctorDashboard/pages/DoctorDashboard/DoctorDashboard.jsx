import {
    Box, Typography, Avatar, Chip, Grid, Card, CardContent, Alert,
} from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import StorefrontIcon from '@mui/icons-material/Storefront';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

import useDoctorDashboard from '../../hooks/useDoctorDashboard';
import {
    useGetMyMembershipQuery,
} from '../../../Membership/api/myMembershipEndpoints';

const DoctorDashboard = () => {
    const {
        user, isInactive, navigateTo,
    } = useDoctorDashboard();

    // Round 2 — tile only renders when the doctor has a marketplace
    // subscription. 404 hides cleanly so doctors who signed up before
    // the marketplace launched don't see a broken card.
    const {
        data: membership, error: membershipError,
    } = useGetMyMembershipQuery();
    const hasMembership = !!membership && !membershipError;

    return (
        <>
            {isInactive && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    Your account is pending admin approval. Some features may be limited.
                </Alert>
            )}

            <Box className="admin-page-card" sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: '#1565C0' }}>
                        <LocalHospitalIcon sx={{ fontSize: 32 }} />
                    </Avatar>
                    <Box>
                        <Typography variant="h4">
                            Welcome, Dr. {user?.first_name} {user?.last_name}!
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                            <Chip label={`Role: ${user?.role?.toUpperCase() || 'DOCTOR'}`} size="small"
                                sx={{ bgcolor: '#1565C020', color: '#1565C0', fontWeight: 600 }} />
                            <Chip label={`Status: ${user?.status?.toUpperCase() || 'PENDING'}`} color={isInactive ? 'warning' : 'success'} size="small" />
                        </Box>
                    </Box>
                </Box>
                <Typography variant="body1" color="text.secondary">Email: {user?.email || 'Not available'}</Typography>
                <Typography variant="body1" color="text.secondary">Phone: {user?.phone_number || 'Not available'}</Typography>
            </Box>

            <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>Quick Actions</Typography>

            <Grid container spacing={3}>
                <Grid item xs={12} md={3}>
                    <Card onClick={() => navigateTo('/dashboard/doctor/appointments')}
                        sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease' }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #1565C0, #0D47A1)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <CalendarMonthIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">My Appointments</Typography>
                            <Typography variant="body2" color="text.secondary">View and manage your appointments</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #2E7D32, #1B5E20)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <PeopleIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">My Patients</Typography>
                            <Typography variant="body2" color="text.secondary">View patient records and history</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card onClick={() => navigateTo('/dashboard/doctor/profile')}
                        sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease' }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #00838F, #006064)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <SettingsIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Profile Settings</Typography>
                            <Typography variant="body2" color="text.secondary">Update your profile and availability</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={3}>
                    <Card onClick={() => navigateTo('/dashboard/doctor/marketplace')}
                        sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease' }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #f57c00, #e65100)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <StorefrontIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">My Marketplace</Typography>
                            <Typography variant="body2" color="text.secondary">Manage your sellable products</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                {hasMembership && (
                    <Grid item xs={12} md={3}>
                        <Card onClick={() => navigateTo('/dashboard/doctor/membership')}
                            sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease' }}>
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #7B1FA2, #4A148C)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                    <WorkspacePremiumIcon sx={{ fontSize: 32, color: 'white' }} />
                                </Box>
                                <Typography variant="h6">
                                    {membership?.plan?.name || 'My Membership'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {membership?.subscription?.status
                                        ? `Status: ${membership.subscription.status.toUpperCase()}`
                                        : 'View your marketplace tier'}
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>
        </>
    );
};

export default DoctorDashboard;
