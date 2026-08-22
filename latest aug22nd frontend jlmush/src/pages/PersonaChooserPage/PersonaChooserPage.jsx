/**
 * PersonaChooserPage — persona tile picker, in two modes.
 *
 *   ``/login``     mode="login"     → each tile routes to that persona's sign-in
 *   ``/register``  mode="register"  → each tile routes to that vertical's funnel
 *
 * Where the navbar's Login / Register dropdowns are the shortcut for people
 * who already know which door is theirs, this is the unhurried version: one
 * tile per choice, each routing exactly where the dropdown would.
 *
 * Reached by clicking the navbar button itself (rather than picking from its
 * dropdown), and linkable directly.
 *
 * Both modes' tiles are whatever verticals the backend publishes — hence the
 * loading / error / empty states. See :file:`personas.js` for how each mode
 * turns a vertical into a route.
 */
import {
    Alert, Box, Card, CardActionArea, CircularProgress, Container,
    Grid2 as Grid, Stack, Typography,
} from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import useIsOnPlatformDomain from '../../common/hooks/useIsOnPlatformDomain';
import ChooserItemIcon from './ChooserItemIcon';
import { CHOOSER_MODES, useChooserItems } from './personas';

export default function PersonaChooserPage({ mode = 'login' }) {
    // The tiles are the APEX TENANT's marketplace personas — on the vendor
    // host, someone deep-linking /login or /register belongs at the vendor
    // doors instead (same split the nav makes).
    const isVendorHost = useIsOnPlatformDomain();
    if (isVendorHost) {
        return <Navigate to={mode === 'register' ? '/signup/tenant' : '/auth/admin/login'} replace />;
    }
    return (
        <PublicLandingLayout>
            {() => <PersonaChooserContent mode={mode} />}
        </PublicLandingLayout>
    );
}

function PersonaChooserContent({ mode }) {
    const navigate = useNavigate();
    const cfg = CHOOSER_MODES[mode] || CHOOSER_MODES.login;
    const { items, isLoading, error } = useChooserItems(mode);

    return (
        <Box
            sx={{
                py: { xs: 5, md: 8 },
                px: { xs: 2, sm: 3 },
                background: 'linear-gradient(180deg, #f8faff 0%, #fff 100%)',
                flex: 1,
            }}
        >
            <Container maxWidth="lg">
                <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2 }}
                    >
                        {cfg.overline}
                    </Typography>
                    <Typography
                        variant="h2"
                        sx={{
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            fontSize: { xs: '1.85rem', sm: '2.5rem', md: '3rem' },
                        }}
                    >
                        Which best describes you?
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680 }}>
                        {cfg.blurb}
                    </Typography>
                </Stack>

                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                    </Box>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {cfg.errorText}
                    </Alert>
                )}

                {!isLoading && !error && items.length === 0 && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        {cfg.emptyText}
                    </Alert>
                )}

                <Grid container spacing={{ xs: 2, md: 3 }} justifyContent="center">
                    {items.map((item) => (
                        <Grid key={item.key} size={{ xs: 12, sm: 6, md: 3 }} sx={{ display: 'flex' }}>
                            <Card
                                elevation={2}
                                sx={{
                                    flex: 1,
                                    borderRadius: 3,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                                    '&:hover': {
                                        transform: 'translateY(-4px)',
                                        boxShadow: 6,
                                        borderColor: 'primary.main',
                                    },
                                }}
                            >
                                <CardActionArea
                                    onClick={() => navigate(item.route)}
                                    sx={{ height: '100%', p: { xs: 2.5, md: 3 } }}
                                >
                                    <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
                                        <Box
                                            sx={{
                                                width: 64,
                                                height: 64,
                                                borderRadius: '50%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                bgcolor: 'primary.main',
                                                color: 'primary.contrastText',
                                            }}
                                        >
                                            <ChooserItemIcon item={item} sx={{ fontSize: 32 }} />
                                        </Box>
                                        <Typography
                                            variant="h6"
                                            sx={{ fontWeight: 800, letterSpacing: '0.02em' }}
                                        >
                                            {item.tileLabel}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {item.sub}
                                        </Typography>
                                    </Stack>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            </Container>
        </Box>
    );
}
