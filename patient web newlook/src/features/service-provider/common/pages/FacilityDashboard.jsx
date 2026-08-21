/**
 * FacilityDashboard — shared welcome card for clinic + hospital
 * dashboard landing pages.
 *
 * Mirrors the doctor dashboard's hero pattern but pulls user info
 * from Redux directly (clinic + hospital don't have their own
 * dashboard hooks yet). Tile section shows a single "Your Plan"
 * card when a marketplace membership exists; otherwise the dashboard
 * just shows the welcome card.
 */
import {
    Alert, Avatar, Box, Card, CardContent, Chip, Grid, Typography,
} from '@mui/material';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

import {
    useGetMyMembershipQuery,
} from '../../Membership/api/myMembershipEndpoints';


export default function FacilityDashboard({
    portalLabel,        // 'Clinic Portal' / 'Hospital Portal'
    portalIcon: PortalIcon,
    accentGradient,     // CSS gradient string for the membership tile
    membershipPath,     // '/dashboard/clinic/membership' or analogue
    roleLabel,          // 'CLINIC' / 'HOSPITAL'
}) {
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);

    const {
        data: membership, error: membershipError,
    } = useGetMyMembershipQuery();
    const hasMembership = !!membership && !membershipError;
    const isInactive = (user?.status || '').toLowerCase() !== 'active';

    return (
        <>
            {isInactive && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    Your account is pending admin approval. Some features may be limited.
                </Alert>
            )}

            <Box className="admin-page-card" sx={{ p: 4, mb: 4, borderRadius: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main' }}>
                        {PortalIcon ? <PortalIcon sx={{ fontSize: 32 }} /> : null}
                    </Avatar>
                    <Box>
                        <Typography variant="h4">
                            Welcome, {user?.first_name} {user?.last_name}!
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                            <Chip
                                label={`Role: ${roleLabel || (user?.role || '').toUpperCase()}`}
                                size="small"
                                sx={{
                                    bgcolor: 'primary.light', color: 'primary.contrastText',
                                    fontWeight: 600,
                                }}
                            />
                            <Chip
                                label={`Status: ${(user?.status || 'PENDING').toUpperCase()}`}
                                size="small"
                                color={isInactive ? 'warning' : 'success'}
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
            </Box>

            <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
                Quick Actions
            </Typography>

            <Grid container spacing={3}>
                {hasMembership && (
                    <Grid item xs={12} md={4}>
                        <Card
                            onClick={() => navigate(membershipPath)}
                            sx={{
                                height: '100%', cursor: 'pointer',
                                borderRadius: 4,
                                boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                                '&:hover': {
                                    transform: 'translateY(-4px)',
                                    boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
                                },
                                transition: 'all 0.3s ease',
                            }}
                        >
                            <CardContent sx={{ textAlign: 'center', py: 4 }}>
                                <Box
                                    sx={{
                                        width: 64, height: 64, borderRadius: 3,
                                        background: accentGradient
                                            || 'linear-gradient(135deg, #7B1FA2, #4A148C)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        mx: 'auto', mb: 2,
                                    }}
                                >
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

            {!hasMembership && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    You haven't picked a marketplace plan yet. Once one is selected
                    and your account is approved, your tier will appear here.
                </Alert>
            )}
        </>
    );
}
