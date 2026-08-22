/**
 * Operations hub — super-admin IT-support surface.
 * Section buttons → role cards → module grid → navigates into the member flow.
 * Mirrors PageControls; reuses its module-button styles, including for the
 * entry level so a Coming-Soon section reads the same as a Coming-Soon module.
 */
import {
    Box, Typography, Paper, Grid, Card, CardContent, CardActionArea,
    Breadcrumbs, Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import { useNavigate } from 'react-router-dom';

import BackButton from '../../../../../common/components/BackButton/BackButton';
import useOperations, {
    OPERATIONS_SECTIONS, RBAC_SECTION,
} from '../../hooks/useOperations';
import {
    moduleButtonStyle, disabledButtonStyle,
} from '../../../PageControls/hooks/usePageControls';

const Operations = () => {
    const navigate = useNavigate();
    const {
        hasViewAccess, step, selectedSection, activeConfig, openSection, goToEntry,
        selectedRole, setSelectedRole, goToOp, goToRbac, handleBack,
    } = useOperations();

    // Both sections walk user type → entity; only the last hop differs, so
    // that's the only thing branching here.
    const isRbac = selectedSection === RBAC_SECTION;
    const openModule = (button, module) => (isRbac
        ? goToRbac(button.entity)
        : goToOp(button.opType, module.memberType));

    const sectionLabel = OPERATIONS_SECTIONS
        .find((section) => section.key === selectedSection)?.label;

    if (!hasViewAccess) {
        return (
            <Paper sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" color="error">Access Denied</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    Operations is available to super admins only.
                </Typography>
            </Paper>
        );
    }

    // Entry level. Same button treatment as the module grid on purpose: a
    // super-admin learns "amber italic = not built yet" once and it holds at
    // every depth of this module.
    const renderSectionSelection = () => (
        <Box>
            <Typography variant="h4" fontWeight="bold" textAlign="center" gutterBottom>
                Select Section
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 4 }}>
                Choose which part of Operations to work in
            </Typography>
            <Grid container spacing={2} justifyContent="center">
                {OPERATIONS_SECTIONS.map((section) => (
                    <Grid item xs={6} sm={3} key={section.key}>
                        <Box
                            onClick={() => !section.disabled && openSection(section.key)}
                            sx={section.disabled ? disabledButtonStyle : moduleButtonStyle}
                        >
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                <span>{section.label}</span>
                                {section.comingSoon && (
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
    );

    const renderRoleSelection = () => (
        <Box>
            <Typography variant="h4" fontWeight="bold" textAlign="center" gutterBottom>
                Select User Type
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 4 }}>
                {isRbac
                    ? 'Choose the user type whose roles and permissions you want to edit'
                    : 'Choose the user type to run operations on their behalf'}
            </Typography>
            <Grid container spacing={3} justifyContent="center">
                {Object.entries(activeConfig).map(([roleKey, roleConfig]) => {
                    const IconComponent = roleConfig.icon;
                    return (
                        <Grid item xs={12} sm={6} md={4} key={roleKey}>
                            <Card sx={{
                                height: '100%', transition: 'all 0.3s ease',
                                border: '2px solid transparent',
                                '&:hover': { borderColor: roleConfig.color, transform: 'translateY(-8px)' },
                            }}>
                                <CardActionArea onClick={() => setSelectedRole(roleKey)} sx={{ height: '100%', p: 3 }}>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Box sx={{
                                            width: 80, height: 80, borderRadius: '50%',
                                            bgcolor: `${roleConfig.color}15`, display: 'flex',
                                            alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
                                        }}>
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

    const renderModuleGrid = () => {
        const roleConfig = activeConfig[selectedRole];
        // Unreachable while ``step`` is derived from the same lookup, but a
        // dead end here would be a blank page rather than an error — fall back
        // to the cards instead.
        if (!roleConfig) return renderRoleSelection();
        return (
            <Box>
                {Object.entries(roleConfig.modules).map(([moduleKey, module]) => (
                    <Box key={moduleKey} sx={{ mb: 4 }}>
                        <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>
                            {module.title}
                        </Typography>
                        <Grid container spacing={2}>
                            {module.buttons.map((button, index) => (
                                <Grid item xs={6} sm={3} key={index}>
                                    <Box
                                        onClick={() => !button.disabled && openModule(button, module)}
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                {/* The hub's levels live in local state, not in history, so
                    "back" here has to be the state step — a plain
                    ``navigate(-1)`` would jump straight out of the module from
                    the third level. ``to`` still covers a cold load. */}
                <BackButton to="/dashboard/admin" onBack={handleBack} />
                <Typography variant="h5" fontWeight={600}>Operations</Typography>
            </Box>
            <Paper sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    {/* Goes where it says it goes. It used to call
                        ``handleBack``, so the crumb labelled Dashboard walked
                        up one level instead — invisible while it was the only
                        control, confusing beside a real Back button. */}
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    {/* One crumb per level of the step state: Operations is
                        the entry, the section name appears once you're past
                        it, the role once you're inside a section. Whichever is
                        last is the current position and isn't a link. */}
                    <Link component="button" underline="hover"
                        color={step === 'entry' ? 'primary' : 'inherit'}
                        onClick={goToEntry}>
                        Operations
                    </Link>
                    {step !== 'entry' && (
                        step === 'role' ? (
                            <Typography color="primary" fontWeight="bold">{sectionLabel}</Typography>
                        ) : (
                            <Link component="button" underline="hover" color="inherit"
                                onClick={() => setSelectedRole(null)}>
                                {sectionLabel}
                            </Link>
                        )
                    )}
                    {step === 'module' && (
                        <Typography color="primary" fontWeight="bold">
                            {activeConfig[selectedRole]?.label}
                        </Typography>
                    )}
                </Breadcrumbs>
            </Paper>
            {step === 'entry' && renderSectionSelection()}
            {step === 'role' && renderRoleSelection()}
            {step === 'module' && renderModuleGrid()}
        </Box>
    );
};

export default Operations;
