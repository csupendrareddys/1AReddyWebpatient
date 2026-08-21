/**
 * SubscriptionHub — Page-Controls-style organizer for all admin subscription
 * surfaces. Sections (SaaS / Marketplace / In-Tenant Provider) → module cards →
 * each card opens its management page. Cards are filtered by role/entitlement in
 * useSubscriptionHub, so a tenant admin sees only their own items while the
 * platform owner also sees the cross-tenant catalog cards.
 */
import {
    Box, Typography, Paper, Grid2 as Grid, Card, CardContent, CardActionArea,
    Breadcrumbs, Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';

import useSubscriptionHub, { moduleButtonStyle, disabledButtonStyle } from '../../hooks/useSubscriptionHub';

const SubscriptionHub = () => {
    const {
        hasViewAccess, visibleConfig, selectedSection, setSelectedSection, goTo, handleBack,
    } = useSubscriptionHub();

    if (!hasViewAccess) {
        return (
            <Paper sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" color="error">Access Denied</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    You do not have permission to manage subscriptions.
                </Typography>
            </Paper>
        );
    }

    const renderSectionSelection = () => (
        <Box>
            <Typography variant="h4" fontWeight="bold" textAlign="center" gutterBottom>
                Select Section
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 4 }}>
                Choose which subscription area to manage
            </Typography>
            <Grid container spacing={3} justifyContent="center">
                {Object.entries(visibleConfig).map(([sectionKey, section]) => {
                    const IconComponent = section.icon;
                    return (
                        <Grid item xs={12} sm={6} md={4} key={sectionKey}>
                            <Card sx={{
                                height: '100%', transition: 'all 0.3s ease', border: '2px solid transparent',
                                '&:hover': { borderColor: section.color, transform: 'translateY(-8px)' },
                            }}>
                                <CardActionArea onClick={() => setSelectedSection(sectionKey)} sx={{ height: '100%', p: 3 }}>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Box sx={{
                                            width: 80, height: 80, borderRadius: '50%', bgcolor: `${section.color}15`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
                                        }}>
                                            <IconComponent sx={{ fontSize: 48, color: section.color }} />
                                        </Box>
                                        <Typography variant="h5" fontWeight="bold" gutterBottom>{section.label}</Typography>
                                        <Typography variant="body2" color="text.secondary">{section.description}</Typography>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    );
                })}
            </Grid>
        </Box>
    );

    const renderModuleGrid = () => {
        const section = visibleConfig[selectedSection];
        if (!section) return null;
        return (
            <Box>
                {Object.entries(section.modules).map(([moduleKey, module]) => (
                    <Box key={moduleKey} sx={{ mb: 4 }}>
                        <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>{module.title}</Typography>
                        <Grid container spacing={2}>
                            {module.cards.map((card, index) => (
                                <Grid item xs={6} sm={3} key={index}>
                                    <Box onClick={() => goTo(card)} sx={card.disabled ? disabledButtonStyle : moduleButtonStyle}>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                            <span>{card.label}</span>
                                            {card.comingSoon && (
                                                <Typography variant="caption" sx={{ color: '#FF9800', fontStyle: 'italic', fontSize: '0.7rem' }}>
                                                    Coming Soon
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                </Grid>
                            ))}
                        </Grid>
                    </Box>
                ))}
            </Box>
        );
    };

    return (
        <Box>
            <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Subscription</Typography>
            <Paper sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit" onClick={handleBack}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    <Link component="button" underline="hover" color={selectedSection ? 'inherit' : 'primary'}
                        onClick={() => setSelectedSection(null)}>
                        Subscription
                    </Link>
                    {selectedSection && (
                        <Typography color="primary" fontWeight="bold">{visibleConfig[selectedSection]?.label}</Typography>
                    )}
                </Breadcrumbs>
            </Paper>
            {selectedSection ? renderModuleGrid() : renderSectionSelection()}
        </Box>
    );
};

export default SubscriptionHub;
