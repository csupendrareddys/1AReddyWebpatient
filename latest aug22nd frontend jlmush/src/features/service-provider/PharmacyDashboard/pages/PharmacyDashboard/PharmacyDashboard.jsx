import {
    Box, Typography, Avatar, Chip, Grid, Card, CardContent, Alert,
} from '@mui/material';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import InventoryIcon from '@mui/icons-material/Inventory';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SettingsIcon from '@mui/icons-material/Settings';

import usePharmacyDashboard from '../../hooks/usePharmacyDashboard';

const PharmacyDashboard = () => {
    const {
        user, isInactive,
    } = usePharmacyDashboard();

    return (
        <>
            {isInactive && (<Alert severity="warning" sx={{ mb: 3 }}>Your account is pending admin approval. Some features may be limited.</Alert>)}

            <Box className="admin-page-card" sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: '#2E7D32' }}><LocalPharmacyIcon sx={{ fontSize: 32 }} /></Avatar>
                    <Box>
                        <Typography variant="h4">Welcome, {user?.name || user?.first_name || 'Pharmacy'}!</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                            <Chip label="PHARMACY" size="small" sx={{ bgcolor: '#2E7D3220', color: '#2E7D32', fontWeight: 600 }} />
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
                                <InventoryIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Inventory</Typography>
                            <Typography variant="body2" color="text.secondary">Manage medicine stock</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #2E7D32, #1B5E20)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                <ShoppingCartIcon sx={{ fontSize: 32, color: 'white' }} />
                            </Box>
                            <Typography variant="h6">Orders</Typography>
                            <Typography variant="body2" color="text.secondary">View prescription orders</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%', cursor: 'pointer', borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }, transition: 'all 0.3s ease', opacity: 0.6 }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                            <Box sx={{ width: 64, height: 64, borderRadius: 3, background: 'linear-gradient(135deg, #00838F, #006064)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
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

export default PharmacyDashboard;
