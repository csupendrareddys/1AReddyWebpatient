/**
 * SaasPricingPage — dedicated public page at ``/pricing`` for the SaaS
 * tenant-subscription product (plan1 / plan2 / plan3 / affordable).
 *
 * Lifted out of the apex landing page so the marketing surface stays
 * focused on the marketplace ("Join Our Network") and patient-facing
 * services. Organizations (clinics, hospitals, solo doctor practices)
 * that want their own subdomain still discover this
 * page via the top-nav "Pricing" link or the footer.
 */
import { Box, Container, Stack, Typography, Chip } from '@mui/material';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import PricingSection from '../LandingPage/components/PricingSection';

export default function SaasPricingPage() {
    return (
        <PublicLandingLayout>
            {({ isMarketingLanding }) => (
                <SaasPricingContent isMarketingLanding={isMarketingLanding} />
            )}
        </PublicLandingLayout>
    );
}


function SaasPricingContent({ isMarketingLanding }) {
    return (
        <Box>
            <Box
                sx={{
                    py: { xs: 5, md: 8 },
                    px: { xs: 2, sm: 3 },
                    background: 'linear-gradient(180deg, #f8faff 0%, #fff 100%)',
                }}
            >
                <Container maxWidth="lg">
                    <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
                        <Chip
                            label="For healthcare organizations"
                            size="small"
                            color="primary"
                            variant="outlined"
                        />
                        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: { xs: '1.85rem', sm: '2.5rem', md: '3rem' } }}>
                            Run your own organization on larazen
                        </Typography>
                        <Typography
                            variant="body1"
                            color="text.secondary"
                            sx={{ maxWidth: 720, fontSize: { xs: '0.95rem', md: '1.05rem' } }}
                        >
                            Get your own subdomain, branded patient portal, calendar, billing,
                            and prescription workflows. Pick the bundle that matches your team
                            size — upgrade or attach add-ons à la carte at any time.
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                            Looking for marketplace membership instead?{' '}
                            <Box
                                component="a"
                                href="/join"
                                sx={{ color: 'primary.main', textDecoration: 'underline' }}
                            >
                                Join our network
                            </Box>{' '}
                            — list your practice on larazen.in.
                        </Typography>
                    </Stack>
                </Container>
            </Box>

            {/*
              * Only render the cards on the apex marketing context — on a
              * tenant subdomain an organization shouldn't be promoting platform
              * subscriptions to its own patients. The PublicLandingLayout
              * already gates ``isMarketingLanding``; the section also
              * self-skips when no SaaS plans exist (graceful empty state).
              */}
            {isMarketingLanding && <PricingSection />}
        </Box>
    );
}
