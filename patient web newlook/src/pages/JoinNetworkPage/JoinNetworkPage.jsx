/**
 * JoinNetworkPage — single-page persona + tier picker at ``/join``.
 *
 *  1. /join?vertical=doctor|clinic|hospital  →  pick persona (tab) + tier, all on one screen
 *
 * The vertical lives in the query string so the page is linkable/shareable
 * and back/forward-nav-able without a route change (?vertical=doctor vs
 * ?vertical=clinic just swaps the toggle + refetches plans, no page jump).
 *
 * 2. CTA still routes to
 *   /auth/service-provider/<vertical>/signup?plan=<code>
 *
 */
import { useMemo } from 'react';
import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip, Container,
    Divider, Stack, ToggleButton, ToggleButtonGroup, Typography, CircularProgress,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import StarIcon from '@mui/icons-material/Star';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import { useNavigate, useSearchParams } from 'react-router-dom';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import MuiIcon from '../../common/components/MuiIcon/MuiIcon';
// The billing row + price maths are shared with /pricing and /join_receiver.
// This page used to carry its own copy of both, which is exactly how the
// "Custom means unpriced" rule ended up living in two places and drifting.
import BillingPeriodToggle from '../../common/components/PlanCard/BillingPeriodToggle';
import MemberDiscountBadge from '../../common/components/PlanCard/MemberDiscountBadge';
import {
    BILLING_PERIODS, DEFAULT_BILLING, billingSavings, resolvePrice,
    visibleBillingPeriods,
} from '../../common/components/PlanCard/planPricing';
import {
    useListPublicMembershipPlansCatalogQuery,
} from '../../features/admin/api/publicEndpoints';
import useVerticalTypes, {
    resolveVertical, providerSignupRouteFor,
} from '../../common/hooks/useVerticalTypes';
import planLimitLines from '../../utils/planLimits';

const TIER_ORDER = { basic: 0, growth: 1, pro: 2 };

function bulletList(plan) {
    const bullets = plan?.features?.bullets;
    const authored = Array.isArray(bullets) ? bullets : [];
    // Appended live from the plan's caps rather than typed by an operator —
    // see ``utils/planLimits``. This is the page somebody picks a tier on, so
    // "Up to 3 support staff" belongs on the card they're comparing.
    return [...authored, ...planLimitLines(plan).map((l) => l.text)];
}


export default function JoinNetworkPage() {
    return (
        <PublicLandingLayout>
            {() => <JoinNetworkContent />}
        </PublicLandingLayout>
    );
}

function JoinNetworkContent() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // The provider verticals, from the backend — this page and the /register
    // tiles that feed it have to agree on which exist, so neither hardcodes
    // them. Null until they land; an unknown / receiver / hand-typed code
    // resolves to the first provider vertical.
    const {
        providerTypes,
        isLoading: verticalsLoading,
        error: verticalsError,
    } = useVerticalTypes();
    const vertical = resolveVertical(providerTypes, searchParams.get('vertical'));

    // Resolved once the plans land — see ``billing`` below, which can only
    // settle after we know which periods these plans actually offer.
    const rawBilling = searchParams.get('billing');

    const setVertical = (next) => {
        if (!next || next === vertical) return;
        const params = new URLSearchParams(searchParams);
        params.set('vertical', next);
        setSearchParams(params, { replace: true });
    };

    const setBilling = (next) => {
        if (!next || next === billing) return;
        const params = new URLSearchParams(searchParams);
        params.set('billing', next);
        setSearchParams(params, { replace: true });
    };

    // MEMBERSHIP plans for every host — apex and subscriber tenants alike.
    //
    // This used to switch on the host: apex read the membership catalog while
    // a tenant subdomain read that tenant's PROVIDER plans. That conflated the
    // two product lines. They are distinct:
    //   * MembershipPlan      — "who pays us". Tenant-isolated, and the
    //                           publicly browsable catalog every tenant
    //                           publishes for providers joining its network.
    //                           This page sells exactly that.
    //   * TenantProviderPlan  — "who we pay". Also tenant-isolated, but NOT
    //                           public: an admin assigns it to a specific
    //                           doctor / clinic / hospital. It must never
    //                           drive a public /join grid.
    // ``membership_plans`` is tenant-scoped server-side (the public endpoint
    // filters on the resolved tenant), so one query serves both cases and each
    // tenant's /join renders its own tiers.
    //
    // Stays skipped until the vertical resolves — membership-plans drops its
    // query string on a falsy arg and would answer with the UNFILTERED
    // catalog, flashing every vertical's tiers before the real fetch lands.
    const planQuery = useListPublicMembershipPlansCatalogQuery(vertical, { skip: !vertical });

    // ``providerTypes.length && !vertical`` is the frame between the verticals
    // landing and the plans query unskipping; guarded on the length so the
    // no-provider-verticals case falls through to its empty state below
    // instead of spinning forever.
    const isLoading = verticalsLoading
        || (providerTypes.length > 0 && !vertical)
        || planQuery.isLoading;
    const error = verticalsError || planQuery.error;

    // The public payload blanks legacy plans to ``{}`` rather than omitting
    // them, so drop those here — otherwise they render as empty cards.
    const plans = useMemo(
        () => (planQuery.data || []).filter((p) => p && p.code),
        [planQuery.data],
    );

    const sortedPlans = useMemo(() => {
        return [...plans].sort((a, b) => {
            if ((a.sort_order || 0) !== (b.sort_order || 0)) {
                return (a.sort_order || 0) - (b.sort_order || 0);
            }
            return (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
        });
    }, [plans]);

    const activeVertical = providerTypes.find((vt) => vt.code === vertical);
    const signupRoute = vertical ? providerSignupRouteFor(vertical) : null;

    // Only the periods these plans offer — one is shown if some plan prices it
    // or marks it Custom. An unpriced period isn't rendered, so it can't be
    // selected, so every card can answer for whatever is selected.
    const periods = useMemo(() => visibleBillingPeriods(sortedPlans), [sortedPlans]);
    // "Save N%" measured off these plans' own prices, not a fixed table.
    const savings = useMemo(() => billingSavings(sortedPlans), [sortedPlans]);

    // ``?billing=`` is honoured only if these plans offer it — a link to
    // ?billing=triennial for a vertical priced monthly-only would otherwise
    // select a period no card can price and empty the grid. Falls back to the
    // annual default when offered, else the first period there is.
    const billing = useMemo(() => {
        if (periods.some((p) => p.key === rawBilling)) return rawBilling;
        if (periods.some((p) => p.key === DEFAULT_BILLING)) return DEFAULT_BILLING;
        return periods[0]?.key ?? DEFAULT_BILLING;
    }, [periods, rawBilling]);

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
                    <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', mb: 4 }}>
                        <Typography
                            variant="overline"
                            sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2 }}
                        >
                            Join our network
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
                            {activeVertical?.description || ' '}
                        </Typography>
                    </Stack>

                    {/* ── Persona toggle — one tab per published provider vertical ── */}
                    {providerTypes.length > 1 && (
                    <Stack alignItems="center" sx={{ mb: 3 }}>
                        <ToggleButtonGroup
                            exclusive
                            value={vertical}
                            onChange={(_, next) => setVertical(next)}
                            sx={{
                                bgcolor: 'white',
                                borderRadius: 3,
                                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                                p: 0.5,
                                '& .MuiToggleButton-root': {
                                    border: 'none',
                                    borderRadius: 2.5,
                                    px: { xs: 2, sm: 3 },
                                    py: 1,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    color: 'text.secondary',
                                    gap: 1,
                                },
                                '& .Mui-selected, & .Mui-selected:hover': {
                                    bgcolor: '#1B3B8C !important',
                                    color: 'white !important',
                                },
                            }}
                        >
                            {providerTypes.map((vt) => (
                                <ToggleButton key={vt.code} value={vt.code}>
                                    <MuiIcon name={vt.icon_key} fontSize="small" />
                                    {vt.name}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Stack>
                    )}

                    {/* ── Billing period toggle ── */}
                    <BillingPeriodToggle
                        value={billing}
                        periods={periods}
                        savings={savings}
                        onChange={setBilling}
                        sx={{ mb: 5 }}
                    />

                    {isLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {error && (
                        <Alert severity="error" sx={{ mb: 3 }}>
                            Couldn't load the tiers. Please refresh the page.
                        </Alert>
                    )}

                    {!isLoading && !error && sortedPlans.length === 0 && (
                        <Alert severity="info" sx={{ mb: 3 }}>
                            No published tiers for this category yet — check back soon.
                        </Alert>
                    )}

                    {!isLoading && !error && sortedPlans.length > 0 && (
                        <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={3}
                            alignItems="stretch"
                            justifyContent="center"
                        >
                            {sortedPlans.map((plan) => {
                                // Null = this plan doesn't offer the selected
                                // period. Render nothing rather than a card
                                // with an invented label — the toggle only
                                // offers periods some plan has, so this is the
                                // backstop for a plan pricing a different set
                                // than its neighbours.
                                const price = resolvePrice(plan, billing);
                                if (!price) return null;

                                const bullets = bulletList(plan);
                                const featured = !!plan.is_featured;

                                return (
                                    <Card
                                        key={plan.id || plan.code}
                                        elevation={featured ? 6 : 2}
                                        sx={{
                                            flex: 1,
                                            maxWidth: 400,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            borderRadius: 3,
                                            border: featured ? '2px solid' : '1px solid',
                                            borderColor: featured ? 'primary.main' : 'divider',
                                            position: 'relative',
                                            mt: featured ? { xs: 2, md: 0 } : 0,
                                            overflow: 'visible',
                                        }}
                                    >
                                        <CardContent sx={{ flex: 1, p: 3}}>
                                            {featured && (
                                            <Chip
                                                label="RECOMMENDED"
                                                size="small"
                                                color="primary"
                                                icon={<StarIcon fontSize="small" />}
                                                sx={{
                                                    position: 'absolute',
                                                    top: -12,
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    fontWeight: 700,
                                                }}
                                            />
                                            )}

                                            <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                                {plan.name}
                                            </Typography>
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                sx={{ mb: 2, minHeight: 40 }}
                                            >
                                                {plan.description || ' '}
                                            </Typography>

                                            <Stack spacing={0.5} sx={{ mb: 1 }}>
                                                {price.original && (
                                                    <Typography
                                                        variant="h5"
                                                        color="text.secondary"
                                                        sx={{
                                                            fontWeight: 600,
                                                            textDecoration: 'line-through',
                                                            lineHeight: 1,
                                                        }}
                                                    >
                                                        {price.original}
                                                    </Typography>
                                                )}

                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Typography
                                                        variant="h3"
                                                        sx={{
                                                            fontWeight: 700,
                                                            lineHeight: 1,
                                                            width: 'fit-content',
                                                        }}
                                                    >
                                                        {price.current}
                                                    </Typography>

                                                    <Typography variant="body2" color="text.secondary">
                                                        {price.bottom}
                                                    </Typography>

                                                    {/* The discount the plan's own og_ price
                                                        implies, same as PlanCard. This card
                                                        struck through the original but never
                                                        named the percentage — which read as
                                                        "no discount on monthly", since the
                                                        toggle's Save chips skip the baseline. */}
                                                    {price.discount && (
                                                        <Chip
                                                            label={`${price.discount}% OFF`}
                                                            color="success"
                                                            size="small"
                                                        />
                                                    )}
                                                </Stack>
                                            </Stack>
                                            {price.totalForPeriod != null && billing !== 'monthly' && (
                                                <Typography variant="caption" color="text.secondary">
                                                    Billed ₹{price.totalForPeriod.toLocaleString()} per {
                                                        BILLING_PERIODS.find((p) => p.key === billing)?.label.toLowerCase()
                                                    }
                                                </Typography>
                                            )}
                                            {plan.trial_days > 0 && (
                                                <Typography variant="caption" color="text.secondary" component="div">
                                                    {plan.trial_days}-day free trial
                                                </Typography>
                                            )}

                                            <MemberDiscountBadge plan={plan} />

                                            {plan.credits_per_month != null && (
                                                <Chip
                                                    label={`${plan.credits_per_month} Credits per month`}
                                                    size="small"
                                                    sx={{ mt: 1.5, bgcolor: 'success.light', color: 'success.dark', fontWeight: 600 }}
                                                />
                                            )}

                                            {plan.team_users_included != null && (
                                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                                                    <GroupsOutlinedIcon fontSize="small" color="action" />
                                                    <Typography variant="body2" color="text.secondary">
                                                        Up to {plan.team_users_included} team users included
                                                    </Typography>
                                                </Stack>
                                            )}

                                            <Divider sx={{ my: 2 }} />

                                            <Stack spacing={0.75} sx={{ mt: 1 }}>
                                                {bullets.length === 0 && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        Core membership benefits.
                                                    </Typography>
                                                )}
                                                {bullets.map((b) => (
                                                    <Stack key={b} direction="row" spacing={1} alignItems="flex-start">
                                                        <CheckCircleOutlineIcon
                                                            fontSize="small"
                                                            color="success"
                                                            sx={{ mt: '2px' }}
                                                        />
                                                        <Typography variant="body2">{b}</Typography>
                                                    </Stack>
                                                ))}
                                            </Stack>
                                        </CardContent>
                                        <CardActions sx={{ p: 3, pt: 0 }}>
                                            {signupRoute ? (
                                                <Button
                                                    fullWidth
                                                    variant={featured ? 'contained' : 'outlined'}
                                                    size="large"
                                                    onClick={() =>
                                                        navigate(
                                                            `${signupRoute}?plan=${encodeURIComponent(plan.code)}`
                                                            + `&billing=${encodeURIComponent(billing)}`
                                                        )
                                                    }
                                                >
                                                    {plan.trial_days > 0
                                                        ? `Start ${plan.trial_days}-day free trial`
                                                        : 'Get started'}
                                                </Button>
                                            ) : (
                                                <Button fullWidth variant={featured ? 'contained' : 'outlined'} size="large" disabled>
                                                    Coming soon
                                                </Button>
                                            )}
                                        </CardActions>
                                    </Card>
                                );
                            })}
                        </Stack>
                    )}

                    <Typography
                        variant="caption"
                        color="text.secondary"
                        align="center"
                        component="div"
                        sx={{ display: 'block', mt: 5 }}
                    >
                        Larazen collects a per-booking platform fee + commission and pays out
                        the rest to providers. Distinct from our{' '}
                        <Box component="a" href="/pricing" sx={{ color: 'primary.main', textDecoration: 'underline' }}>
                            SaaS plans
                        </Box>{' '}
                        — those sell you your own subdomain to run your practice independently.
                        <br />
                        Already have an account?{' '}
                        <Box component="a" href="/auth/service-provider/login" sx={{ color: 'primary.main', textDecoration: 'underline' }}>
                            Log in
                        </Box>
                    </Typography>
                </Container>
            </Box>
        </Box>
    );
}