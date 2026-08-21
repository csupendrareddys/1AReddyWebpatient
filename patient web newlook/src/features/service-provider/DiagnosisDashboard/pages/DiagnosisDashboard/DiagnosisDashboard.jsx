import {
    Box, Typography, Avatar, Chip, Grid, Card, CardContent, Alert,
} from '@mui/material';
import BiotechIcon from '@mui/icons-material/Biotech';
import ScienceIcon from '@mui/icons-material/Science';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';

import useDiagnosisDashboard from '../../hooks/useDiagnosisDashboard';

const DiagnosisDashboard = () => {
    const {
        user, isInactive,
    } = useDiagnosisDashboard();

    return (
        <>
            {isInactive && (<Alert severity="warning" sx={{ mb: 3 }}>Your account is pending admin approval. Some features may be limited.</Alert>)}

            <Box className="admin-page-card" sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: '#00838F' }}><BiotechIcon sx={{ fontSize: 32 }} /></Avatar>
                    <Box>
                        <Typography variant="h4">Welcome, {user?.name || user?.first_name || 'Diagnosis Center'}!</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                            <Chip label="DIAGNOSIS CENTER" size="small" sx={{ bgcolor: '#00838F20', color: '#00838F', fontWeight: 600 }} />
                            <Chip label={`Status: ${user?.status?.toUpperCase() || 'PENDING'}`} color={isInactive ? 'warning' : 'success'} size="small" />
                        </Box>
                    </Box>
                </Box>
                <Typography variant="body1" color="text.secondary">Email: {user?.email || 'Not available'}</Typography>
            </Box>

            <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #1565C0, #0D47A1)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <ScienceIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Lab Tests</Typography>
                            <Typography variant="body2" color="text.secondary">Manage test services</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #00838F, #006064)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <AssignmentIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Reports</Typography>
                            <Typography variant="body2" color="text.secondary">View and upload results</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #2E7D32, #1B5E20)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <SettingsIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Settings</Typography>
                            <Typography variant="body2" color="text.secondary">Update profile</Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </>
    );
};

export default DiagnosisDashboard;
