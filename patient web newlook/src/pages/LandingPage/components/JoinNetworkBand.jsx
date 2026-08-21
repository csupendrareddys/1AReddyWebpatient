/**
 * JoinNetworkBand — single-band CTA on the apex landing that funnels
 * providers into the marketplace signup flow.
 *
 * Replaces the inline 9-tier ``MembershipPricingSection`` that lived on
 * the landing page. The full tier comparison now happens on the
 * dedicated ``/join`` → ``/join/<vertical>`` pages so the landing stays
 * patient-focused.
 */
import { Box, Button, Container, Stack, Typography, Chip } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GroupsIcon from '@mui/icons-material/Groups';
import { useNavigate } from 'react-router-dom';


export default function JoinNetworkBand() {
    const navigate = useNavigate();

    return (
        <Box
            component="section"
            id="join-network"
            sx={{
                py: { xs: 6, md: 8 },
                px: { xs: 2, sm: 3 },
                background: 'linear-gradient(135deg, rgba(25,118,210,0.06), rgba(92,107,192,0.10))',
            }}
        >
            <Container maxWidth="lg">
                <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={{ xs: 3, md: 4 }}
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                    justifyContent="space-between"
                >
                    <Stack spacing={1.5} sx={{ maxWidth: 720 }}>
                        <Chip
                            icon={<GroupsIcon />}
                            label="For healthcare providers"
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ alignSelf: 'flex-start' }}
                        />
                        <Typography
                            variant="h3"
                            sx={{
                                fontWeight: 800,
                                letterSpacing: '-0.02em',
                                fontSize: { xs: '1.5rem', sm: '1.85rem', md: '2.25rem' },
                            }}
                        >
                            Join the larazen network
                        </Typography>
                        <Typography
                            variant="body1"
                            color="text.secondary"
                            sx={{ fontSize: { xs: '0.95rem', md: '1.05rem' } }}
                        >
                            Whether you're a solo doctor, a multi-doctor clinic, or a hospital —
                            register on larazen, get discovered by patients, and grow your practice.
                            Pick the tier that matches you and start in minutes.
                        </Typography>
                    </Stack>
                    <Button
                        variant="contained"
                        size="large"
                        endIcon={<ArrowForwardIcon />}
                        onClick={() => navigate('/join')}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '1rem',
                            borderRadius: 3,
                            px: 3, py: 1.5,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                        }}
                    >
                        Join Our Network
                    </Button>
                </Stack>
            </Container>
        </Box>
    );
}
