/**
 * PageControls Page — Pure UI composition
 * All logic lives in usePageControls hook
 */
import {
    Box,
    Typography,
    Paper,
    Grid,
    Card,
    CardContent,
    CardActionArea,
    Breadcrumbs,
    Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';

import usePageControls, {
    PAGE_CONTROLS_CONFIG,
    moduleButtonStyle,
    disabledButtonStyle,
} from '../../hooks/usePageControls';
import './PageControls.css';

const PageControls = () => {
    const {
        hasFullAccess,
        hasViewAccess,
        hasEditAccess,
        selectedRole,
        setSelectedRole,
        goToConfig,
        handleBack,
    } = usePageControls();

    if (!hasViewAccess) {
        return (
            <Paper className="admin-page-card" sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" color="error">Access Denied</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    You do not have permission to access Page Controls.
                </Typography>
            </Paper>
        );
    }

    // Render Role Selection View
    const renderRoleSelection = () => (
        <Box>
            <Typography variant="h4" fontWeight="bold" textAlign="center" gutterBottom>
                Select User Type
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 4 }}>
                Choose the user type to configure page controls
            </Typography>

            <Grid container spacing={3} justifyContent="center">
                {Object.entries(PAGE_CONTROLS_CONFIG).map(([roleKey, roleConfig]) => {
                    const IconComponent = roleConfig.icon;
                    return (
                        <Grid item xs={12} sm={6} md={4} key={roleKey}>
                            <Card
                                className="admin-page-card"
                                sx={{
                                    height: '100%',
                                    transition: 'all 0.3s ease',
                                    border: '2px solid transparent',
                                    '&:hover': {
                                        borderColor: roleConfig.color,
                                        transform: 'translateY(-8px)',
                                    },
                                }}
                            >
                                <CardActionArea onClick={() => setSelectedRole(roleKey)} sx={{ height: '100%', p: 3 }}>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Box
                                            sx={{
                                                width: 80,
                                                height: 80,
                                                borderRadius: '50%',
                                                bgcolor: `${roleConfig.color}15`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                mx: 'auto',
                                                mb: 2,
                                            }}
                                        >
                                            <IconComponent sx={{ fontSize: 48, color: roleConfig.color }} />
                                        </Box>
                                        <Typography variant="h5" fontWeight="bold" gutterBottom>
                                            {roleConfig.label}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {roleConfig.description}
                                        </Typography>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    );
                })}
            </Grid>
        </Box>
    );

    // Render Module Grid View
    const renderModuleGrid = () => {
        const roleConfig = PAGE_CONTROLS_CONFIG[selectedRole];
        if (!roleConfig) return null;

        return (
            <Box>
                {Object.entries(roleConfig.modules).map(([moduleKey, module]) => (
                    <Box key={moduleKey} sx={{ mb: 4 }}>
                        <Typography variant="h6" fontWeight="bold" sx={{ mb: 2, color: 'text.primary' }}>
                            {module.title}
                        </Typography>
                        <Grid container spacing={2}>
                            {module.buttons.map((button, index) => (
                                <Grid item xs={6} sm={3} key={index}>
                                    <Box
                                        onClick={() => !button.disabled && goToConfig(button.pageType)}
                                        sx={button.disabled ? disabledButtonStyle : moduleButtonStyle}
                                    >
                                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                            <span>{button.label}</span>
                                            {button.comingSoon && (
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
            {/* Page Title */}
            <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                Page Controls
            </Typography>

            {/* Breadcrumbs */}
            <Paper className="admin-page-card" sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => goToConfig(null) || handleBack()}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        <HomeIcon fontSize="small" />
                        Dashboard
                    </Link>
                    <Link
                        component="button"
                        underline="hover"
                        color={selectedRole ? 'inherit' : 'primary'}
                        onClick={() => setSelectedRole(null)}
                    >
                        Page Controls
                    </Link>
                    {selectedRole && (
                        <Typography color="primary" fontWeight="bold">
                            {PAGE_CONTROLS_CONFIG[selectedRole]?.label}
                        </Typography>
                    )}
                </Breadcrumbs>
            </Paper>

            {/* Main Content */}
            {selectedRole ? renderModuleGrid() : renderRoleSelection()}
        </Box>
    );
};

export default PageControls;
