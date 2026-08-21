/**
 * LandingBookingSection — public-landing "Book a slot" widget.
 *
 * Two-column section embedded above the doctors carousel. Left column is
 * a brief copy block + a single primary CTA; right column is a grid of
 * consultation-type cards. Clicking any card navigates the visitor into
 * the public booking funnel at ``/book/<consultation_type>``.
 *
 * Hidden when no specializations exist — a tenant who hasn't seeded
 * their doctors yet shouldn't show a booking widget that lands on an
 * empty doctor list.
 */
import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Grid2 as Grid, Stack, Button, Card, CardActionArea,
    CardContent, useTheme, alpha,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { CONSULTATION_TYPES } from '../../features/service-provider/ProfileSetting/constants/consultationTypes';
import { useGetPublicSpecializationsQuery } from '../../features/publicBooking/publicBookingApi';

// Mirror of the existing BookByType filter — show schedulable booking
// types only. ``camp`` and ``marketplace`` are non-bookable for the public
// flow.
const BOOKABLE_TYPES = CONSULTATION_TYPES.filter((ct) =>
    ['video', 'audio', 'chat', 'complete', 'home_visit'].includes(ct.value),
);

export default function LandingBookingSection() {
    const navigate = useNavigate();
    const theme = useTheme();
    const { data: specializations = [], isLoading } = useGetPublicSpecializationsQuery();

    // Hide the entire section when no specializations are available.
    // Showing the widget on a tenant with no doctors would land visitors
    // on an empty list and signal "broken site". Seed via
    // ``Backend/scripts/seed_demo_doctors.py`` to make this section
    // appear in dev / preview environments.
    if (!isLoading && specializations.length === 0) return null;

    return (
        <Box
            component="section"
            sx={{
                py: { xs: 6, md: 10 },
                px: { xs: 2, sm: 3 },
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                overflow: 'hidden',
            }}
        >
            <Container maxWidth="lg">
                <Grid container spacing={{ xs: 4, md: 6 }} alignItems="stretch">
                    {/* ── LEFT: copy + primary CTA ─────────────────────── */}
                    <Grid size={{ xs: 12, md: 5 }}>
                        <Stack spacing={2} sx={{ height: '100%', justifyContent: 'center' }}>
                            <Typography
                                variant="overline"
                                sx={{
                                    color: 'primary.main', fontWeight: 700,
                                    letterSpacing: 2, fontSize: '0.7rem',
                                }}
                            >
                                Book a slot
                            </Typography>
                            <Typography
                                variant="h3"
                                fontWeight={800}
                                sx={{
                                    letterSpacing: '-0.02em',
                                    fontSize: { xs: '1.85rem', sm: '2.25rem', md: '2.75rem' },
                                    lineHeight: 1.15,
                                    wordBreak: 'break-word',
                                }}
                            >
                                Talk to a{' '}
                                <Box component="span" sx={{ color: 'primary.main' }}>doctor</Box>{' '}
                                in minutes
                            </Typography>
                            <Typography
                                variant="body1" color="text.secondary"
                                sx={{ fontSize: { xs: '0.95rem', md: '1.05rem' }, lineHeight: 1.7 }}
                            >
                                Pick the consultation type that suits you, browse verified
                                doctors by specialty, and book a slot — pay once, no signup
                                form to fill upfront. Your account is created automatically
                                after payment.
                            </Typography>
                            <Box sx={{ pt: 1 }}>
                                <Button
                                    variant="contained"
                                    size="large"
                                    endIcon={<ArrowForwardIcon />}
                                    onClick={() => navigate('/book/video')}
                                    sx={{
                                        fontWeight: 700,
                                        textTransform: 'none',
                                        px: 4, py: 1.25,
                                        borderRadius: 2,
                                    }}
                                >
                                    Find a doctor now
                                </Button>
                            </Box>
                        </Stack>
                    </Grid>

                    {/* ── RIGHT: consultation-type cards ──────────────── */}
                    <Grid size={{ xs: 12, md: 7 }}>
                        <Grid container spacing={2}>
                            {BOOKABLE_TYPES.map((ct) => (
                                <Grid size={{ xs: 12, sm: 6 }} key={ct.value}>
                                    <ConsultationTypeCard ct={ct} navigate={navigate} theme={theme} />
                                </Grid>
                            ))}
                        </Grid>
                    </Grid>
                </Grid>
            </Container>
        </Box>
    );
}

// ---------------------------------------------------------------------------

function ConsultationTypeCard({ ct, navigate, theme }) {
    return (
        <Card
            elevation={0}
            sx={{
                height: '100%',
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'grey.100',
                transition: 'all 0.25s',
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    boxShadow: `0 12px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
                    transform: 'translateY(-3px)',
                },
            }}
        >
            <CardActionArea
                onClick={() => navigate(`/book/${ct.value}`)}
                sx={{ height: '100%', p: 0 }}
            >
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                        <Box
                            sx={{
                                width: 48, height: 48, borderRadius: 2,
                                bgcolor: alpha(ct.color || theme.palette.primary.main, 0.12),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '1.5rem',
                                flexShrink: 0,
                            }}
                        >
                            {ct.icon}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.25 }}>
                                {ct.label}
                            </Typography>
                            <Typography
                                variant="body2" color="text.secondary"
                                sx={{ lineHeight: 1.5 }}
                            >
                                {ct.description}
                            </Typography>
                        </Box>
                    </Stack>
                </CardContent>
            </CardActionArea>
        </Card>
    );
}
