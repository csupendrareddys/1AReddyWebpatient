/**
 * JoinReceiverPage — service-receiver (patient) plans at ``/join_receiver``.
 *
 * Receivers don't "join the network" the way providers do, so this is
 * deliberately NOT the ``/join`` marketplace funnel — no membership/commission
 * framing. It's the same pricing furniture as ``/pricing`` (shared
 * ``PlanCard`` + ``BillingPeriodToggle``) with receiver copy around it.
 *
 * Data flow — the marketplace catalog, narrowed to receiver verticals:
 *   1. ``GET /api/public/vertical-types``          → keep the is_receiver ones
 *   2. ``GET /api/public/membership-plans?vertical=`` → selected one's plans
 *
 * This page reads VERTICAL types, not PLAN types. Those are different axes and
 * it used to conflate them: it listed ``plan-types`` with ``is_receiver`` and
 * fetched the SaaS ``/plans`` catalog, which sells tenant subdomains — the
 * wrong product line for a patient entirely.
 *
 * ``?vertical=<code>`` drives the selected tab, so the /register tiles can
 * link straight to a vertical and the page is shareable / back-nav-able. It's
 * on the query string rather than the route for the same reason /join does it:
 * switching tabs swaps the plans without a page jump.
 *
 * Multiple receiver verticals get a toggle, exactly like ``/join``; a single
 * one skips it (a one-option picker is just noise). The plans query stays
 * skipped until the vertical resolves — firing it with an undefined code would
 * fetch the UNFILTERED catalog (the endpoint drops the query string when the
 * arg is falsy) and briefly render every provider plan on the patient page.
 */
import { useMemo } from 'react';
import {
    Alert, Box, Container, Stack, ToggleButton, ToggleButtonGroup,
    Typography, CircularProgress,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import MuiIcon from '../../common/components/MuiIcon/MuiIcon';
import PlanCard from '../../common/components/PlanCard/PlanCard';
import BillingPeriodToggle from '../../common/components/PlanCard/BillingPeriodToggle';
import {
    DEFAULT_BILLING, billingSavings, visibleBillingPeriods,
} from '../../common/components/PlanCard/planPricing';
import useVerticalTypes, { resolveVertical } from '../../common/hooks/useVerticalTypes';
import {
    useListPublicMembershipPlansCatalogQuery,
    useListPublicAddonsCatalogQuery,
} from '../../features/admin/api/publicEndpoints';

/**
 * Membership plan → the shape ``PlanCard`` reads.
 *
 * Most of it already lines up: both catalogs carry ``benefits`` (the free-text
 * list a receiver plan sells, which the admin authors only for is_receiver
 * verticals), the flat ``pricing.price_inr_<period>`` map, ``name``,
 * ``description`` and ``trial_days``.
 *
 * The one mismatch is the highlighted tier: membership plans call it
 * ``is_featured``, the SaaS plans PlanCard was built for call it
 * ``is_default``. Renaming here rather than teaching PlanCard a second shape
 * keeps the card on one input contract.
 */
const toPlanCardShape = (plan) => ({
    ...plan,
    is_default: !!plan.is_featured,
    // Provider-catalog concepts with no receiver equivalent. Passed empty so
    // PlanCard skips those sections rather than reading a stray key off the
    // spread above — in particular ``features``, which on a membership plan
    // holds marketing bullets, NOT the feature tree PlanCard would try to
    // walk for its core-features list.
    features: {},
    default_addons: [],
    usage_limits: {},
});

export default function JoinReceiverPage() {
    return (
        <PublicLandingLayout>
            {() => <JoinReceiverContent />}
        </PublicLandingLayout>
    );
}

function JoinReceiverContent() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const {
        receiverTypes,
        isLoading: verticalsLoading,
        error: verticalsError,
    } = useVerticalTypes();

    // Null until the vertical types land. An unknown / provider / hand-typed
    // code falls back to the first receiver vertical rather than an empty page.
    const vertical = resolveVertical(receiverTypes, searchParams.get('vertical'));
    const activeVertical = receiverTypes.find((vt) => vt.code === vertical);

    // Resolved after the plans land — see ``billing`` below, which can only
    // settle once we know which periods are actually offered.
    const rawBilling = searchParams.get('billing');

    const setParam = (key, next) => {
        if (!next) return;
        const params = new URLSearchParams(searchParams);
        params.set(key, next);
        setSearchParams(params, { replace: true });
    };

    const {
        data: plans = [],
        isLoading: plansLoading,
        error: plansError,
    } = useListPublicMembershipPlansCatalogQuery(vertical, { skip: !vertical });

    const cardPlans = useMemo(() => {
        return [...plans]
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map(toPlanCardShape);
    }, [plans]);

    // Only the periods these plans actually offer. An unpriced period isn't
    // rendered, so it can't be selected — which is what keeps every card able
    // to answer for whatever's selected.
    const periods = useMemo(() => visibleBillingPeriods(cardPlans), [cardPlans]);
    // "Save N%" measured off these plans' own prices, not a fixed table.
    const savings = useMemo(() => billingSavings(cardPlans), [cardPlans]);

    // ``?billing=`` is honoured only if these plans offer it — a link to
    // ?billing=triennial for a vertical priced monthly-only would otherwise
    // select a period no card can price and empty the grid. Falls back to the
    // annual default when offered, else the first period there is.
    const billing = useMemo(() => {
        if (periods.some((p) => p.key === rawBilling)) return rawBilling;
        if (periods.some((p) => p.key === DEFAULT_BILLING)) return DEFAULT_BILLING;
        return periods[0]?.key ?? DEFAULT_BILLING;
    }, [periods, rawBilling]);

    const { data: addons = [] } = useListPublicAddonsCatalogQuery();
    const addonByCode = useMemo(() => {
        const m = {};
        for (const a of addons) m[a.code] = a;
        return m;
    }, [addons]);

    // ``receiverTypes.length && !vertical`` is the gap between the types
    // landing and the plans query unskipping — the query is still skipped
    // there, so without this it reads as "no plans" for a frame. Guarded on
    // the length so the none-are-receivers case below falls through to its
    // own message instead of spinning forever.
    const isLoading = verticalsLoading || (receiverTypes.length > 0 && !vertical) || plansLoading;
    const error = verticalsError || plansError;

    // Verticals loaded but none is flagged is_receiver — a backend config gap,
    // not a network failure, so it gets its own message rather than an empty
    // "no plans" state that reads like the tiers just aren't live.
    const noReceiverVertical = !verticalsLoading && !verticalsError && receiverTypes.length === 0;

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
                <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', mb: 4 }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2 }}
                    >
                        Patient plans
                    </Typography>
                    <Typography
                        variant="h2"
                        sx={{
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            fontSize: { xs: '1.85rem', sm: '2.5rem', md: '3rem' },
                        }}
                    >
                        Choose your plan
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680 }}>
                        {activeVertical?.description
                            || 'Book appointments, consult online, and keep your health records in one place.'}
                    </Typography>
                </Stack>

                {/* ── Receiver vertical toggle ──
                    Only worth rendering with something to choose between; a
                    single receiver vertical goes straight to its plans. Same
                    styling as the persona toggle on /join. */}
                {receiverTypes.length > 1 && (
                    <Stack alignItems="center" sx={{ mb: 3 }}>
                        <ToggleButtonGroup
                            exclusive
                            value={vertical}
                            onChange={(_, next) => setParam('vertical', next)}
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
                            {receiverTypes.map((vt) => (
                                <ToggleButton key={vt.code} value={vt.code}>
                                    <MuiIcon name={vt.icon_key} fontSize="small" />
                                    {vt.name}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Stack>
                )}

                <BillingPeriodToggle
                    value={billing}
                    periods={periods}
                    savings={savings}
                    onChange={(next) => setParam('billing', next)}
                    sx={{ mb: 5 }}
                />

                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                    </Box>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        Unable to load plans. Please refresh.
                    </Alert>
                )}

                {noReceiverVertical && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        Patient plans aren&apos;t available yet — check back soon.
                    </Alert>
                )}

                {!isLoading && !error && activeVertical && cardPlans.length === 0 && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        No published patient plans yet — check back soon.
                    </Alert>
                )}

                {!isLoading && !error && cardPlans.length > 0 && (
                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={3}
                        alignItems="stretch"
                        justifyContent="center"
                        sx={{ pt: 2.5 }}
                    >
                        {cardPlans.map((plan) => (
                            <PlanCard
                                key={plan.code}
                                plan={plan}
                                billing={billing}
                                addonByCode={addonByCode}
                                onSelect={(p) =>
                                    navigate(
                                        `/auth/service-receiver/signup?plan=${encodeURIComponent(p.code)}`
                                        + `&billing=${encodeURIComponent(billing)}`
                                        + `&vertical=${encodeURIComponent(vertical)}`
                                    )
                                }
                            />
                        ))}
                    </Stack>
                )}

                <Typography
                    variant="caption"
                    color="text.secondary"
                    align="center"
                    component="div"
                    sx={{ display: 'block', mt: 4 }}
                >
                    Already have an account?{' '}
                    <Box
                        component="a"
                        href="/auth/service-receiver/login"
                        sx={{ color: 'primary.main', textDecoration: 'underline' }}
                    >
                        Log in
                    </Box>
                </Typography>
            </Container>
        </Box>
    );
}
