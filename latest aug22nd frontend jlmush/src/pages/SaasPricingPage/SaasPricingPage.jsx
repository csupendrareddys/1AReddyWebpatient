/**
 * SaasPricingPage — public pricing pages for the SaaS tenant-subscription
 * product, one per MARKET CATEGORY (industry segment).
 *
 * ``/pricing`` renders the default category (healthcare today);
 * ``/pricing/<code>`` renders that category — its own hero copy (authored
 * in the platform console's Market Categories section) and only its own
 * plan types/plans. This replaced a hardcoded healthcare hero: targeting
 * a new industry (legal firms, ...) is now console work, not a deploy.
 */
import { Box, Container, Stack, Typography, Chip } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import PricingSection from '../LandingPage/components/PricingSection';
import { useListPublicSaasCategoriesQuery } from '../../features/admin/api/publicEndpoints';
import useSellingStatus from '../../common/hooks/useSellingStatus';

// The seeded default-category copy, shown while categories load (and as
// the safety net if the catalog is ever empty) so the hero never flashes
// blank.
const FALLBACK = {
    tagline: 'For healthcare organizations',
    headline: 'Run your healthcare organization on your own branded portal',
    subheadline:
        'Get your own subdomain, branded patient portal, calendar, billing, '
        + 'and prescription workflows. Pick the bundle that matches your team '
        + 'size — upgrade or attach add-ons à la carte at any time.',
};

export default function SaasPricingPage() {
    return (
        <PublicLandingLayout>
            {({ isMarketingLanding, landingData }) => (
                <SaasPricingContent
                    isMarketingLanding={isMarketingLanding}
                    landingData={landingData}
                />
            )}
        </PublicLandingLayout>
    );
}


function SaasPricingContent({ isMarketingLanding, landingData }) {
    const navigate = useNavigate();
    const { categoryCode } = useParams();
    // An apex reseller's storefront (P3): same page, THEIR catalog. The
    // industry-segment machinery is the VENDOR's marketing taxonomy —
    // skip it entirely and render a brand-led hero instead.
    const { seller } = useSellingStatus();
    const isResellerHost = seller === 'reseller';
    const { data: categories = [] } = useListPublicSaasCategoriesQuery(
        undefined, { skip: isResellerHost });

    const active = isResellerHost ? [] : categories.filter((c) => c.is_active);
    const current = (categoryCode
        && active.find((c) => c.code === categoryCode.toLowerCase()))
        || active.find((c) => c.is_default)
        || active[0]
        || null;
    const brandName = landingData?.brand_name || '';
    const hero = isResellerHost
        ? {
            tagline: brandName || null,
            headline: 'Plans & pricing',
            subheadline: 'Run your organisation on your own branded portal'
                + (brandName ? ` powered by ${brandName}` : '')
                + '. Pick the plan that fits your team — you can upgrade '
                + 'at any time.',
        }
        : (current || FALLBACK);

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
                        {active.length > 1 && (
                            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                                {active.map((c) => (
                                    <Chip
                                        key={c.id}
                                        label={c.name}
                                        color={current?.id === c.id ? 'primary' : 'default'}
                                        variant={current?.id === c.id ? 'filled' : 'outlined'}
                                        onClick={() => navigate(
                                            c.is_default ? '/pricing' : `/pricing/${c.code}`
                                        )}
                                    />
                                ))}
                            </Stack>
                        )}
                        {hero.tagline && (
                            <Chip
                                label={hero.tagline}
                                size="small"
                                color="primary"
                                variant="outlined"
                            />
                        )}
                        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: { xs: '1.85rem', sm: '2.5rem', md: '3rem' } }}>
                            {hero.headline}
                        </Typography>
                        <Typography
                            variant="body1"
                            color="text.secondary"
                            sx={{ maxWidth: 720, fontSize: { xs: '0.95rem', md: '1.05rem' } }}
                        >
                            {hero.subheadline}
                        </Typography>
                        {/* No marketplace cross-sell here: /join is a
                            TENANT-only surface and /pricing is VENDOR-only,
                            so the old "Join our network — larazen.in" caption
                            linked to a page this host can never serve. The
                            marketplace pitch lives on the tenant apex. */}
                    </Stack>
                </Container>
            </Box>

            {/*
              * Cards render on SELLING contexts only: the vendor marketing
              * site, and an apex reseller's storefront (whose /plan-types +
              * /plans calls are host-scoped server-side to its own catalog,
              * so no category prop applies). An ordinary tenant subdomain
              * shouldn't promote platform subscriptions to its own patients.
              * ``key`` remounts the section on category change so its
              * internal plan-type toggle re-seeds from the new category.
              */}
            {(isMarketingLanding || isResellerHost) && (
                <PricingSection
                    key={current?.code || 'default'}
                    category={isResellerHost ? undefined : current?.code}
                    hideHeading
                />
            )}
        </Box>
    );
}
