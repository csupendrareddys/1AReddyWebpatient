/**
 * PricingSection — SaaS tenant-subscription pricing, matching
 * JoinNetworkPage's persona-toggle → billing-toggle → plan-cards layout.
 *
 * `GET /plans?vertical=doctor|clinic|hospital` filters server-side and
 * returns a flat plan array (`_public_plan_payload` per plan). Pricing
 * comes entirely from `plan.pricing`, a flat `price_inr_<period>` /
 * `og_price_inr_<period>` map built by `_create_pricing_dict` across all
 * six BILLING_PERIODS keys — the legacy top-level price_inr_monthly /
 * og_price_inr_monthly / price_inr_annual columns are not read.
 *
 * Assumed: local (non-URL) state for vertical/billing, since this section
 * is embedded inside SaasPricingContent rather than owning the route.
 */
import { useMemo, useState, useEffect } from 'react';
import {
    Alert, Box, Chip, Container, Stack, ToggleButton, ToggleButtonGroup,
    Typography, CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import MuiIcon from '../../../common/components/MuiIcon/MuiIcon';
import PlanCard from '../../../common/components/PlanCard/PlanCard';
import useIsOnPlatformDomain from '../../../common/hooks/useIsOnPlatformDomain';
import BillingPeriodToggle from '../../../common/components/PlanCard/BillingPeriodToggle';
import {
    DEFAULT_BILLING, billingSavings, visibleBillingPeriods,
} from '../../../common/components/PlanCard/planPricing';
import {
    useListPublicPlansCatalogQuery,
    useListPublicAddonsCatalogQuery,
    useListPublicPlanTypesQuery,
} from '../../../features/admin/api/publicEndpoints';

// const VALID_VERTICALS = ['doctor', 'clinic', 'hospital'];
// const DEFAULT_VERTICAL = 'doctor';

// const VERTICAL_TABS = [
//     {
//         key: 'doctor',
//         label: 'For Doctors',
//         icon: LocalHospitalIcon,
//         sub: 'Running a solo practice? Get your own branded subdomain and patient portal.',
//     },
//     {
//         key: 'clinic',
//         label: 'For Clinics',
//         icon: StoreMallDirectoryIcon,
//         sub: 'Multi-doctor clinics — shared calendars, team roles, and unified billing under one subdomain.',
//     },
//     {
//         key: 'hospital',
//         label: 'For Hospitals',
//         icon: ApartmentIcon,
//         sub: 'Hospitals and networks — multi-department workflows and full-scale usage limits.',
//     },
// ];

// Billing periods, price maths and the plan card itself now live in
// ``common/components/PlanCard`` — shared with the ``/join_receiver``
// patient plans page so the two surfaces can't drift apart.

// Server filters by vertical, so this is just a passthrough — kept as its
// own hook only so the addons query (not vertical-filtered, per the route
// you shared) lives next to it and both loading/error states merge cleanly.
//
// Skipped until the toggle resolves a vertical: the endpoint drops its query
// string for a falsy arg, so firing early fetches the UNFILTERED catalog and
// would flash every plan — receiver plans included — onto this provider-only
// section. ``!vertical`` therefore reads as loading, not as "no plans".
function useVerticalPricingData(vertical, { noPlanTypes = false } = {}) {
    const {
        data: subscribedPlans = [], isLoading: plansLoading,
        error: plansError, refetch: refetchPlans,
    } = useListPublicPlansCatalogQuery(vertical, { skip: !vertical });
    const { data: addons = [] } = useListPublicAddonsCatalogQuery();

    // Same wedge as the plan-types query below: under StrictMode the
    // subscription can race on remount and never observe a response that
    // did arrive, pinning both `data` and `isLoading`. Priming from an
    // imperative unwrap gets the rows via a promise the stuck selector
    // can't swallow. See src/common/hooks/useSettledOrTimeout.js.
    const [primedPlans, setPrimedPlans] = useState(null);
    useEffect(() => {
        if (!vertical) { setPrimedPlans(null); return undefined; }
        let alive = true;
        refetchPlans().unwrap()
            .then((rows) => { if (alive) setPrimedPlans(rows || []); })
            .catch(() => { if (alive) setPrimedPlans([]); });
        return () => { alive = false; };
    }, [vertical, refetchPlans]);

    const plans = subscribedPlans.length ? subscribedPlans : (primedPlans || []);
    const plansSettled = !plansLoading || primedPlans !== null;

    // ``!vertical`` normally means "the toggle hasn't resolved yet", which
    // is genuinely still loading. But when the catalog has NO plan types at
    // all, no vertical will ever resolve — so that same condition would pin
    // isLoading true forever and the empty state below could never render.
    // A spinner that never stops reads as a broken page; "nothing published
    // yet" reads as an empty one, which is the truth.
    const waitingForVertical = !vertical && !noPlanTypes;

    return {
        plans,
        addons,
        isLoading: waitingForVertical || !plansSettled,
        error: plansError,
    };
}

export default function PricingSection({ category, hideHeading = false } = {}) {
    const navigate = useNavigate();
    // On an apex reseller's storefront the buyers are CHILD
    // tenants — the card obeys that audience's display flags.
    const isVendorHost = useIsOnPlatformDomain();
    const {
        data: subscribedPlanTypes = [], isLoading: planTypesRawLoading,
        refetch: refetchPlanTypes,
    } = useListPublicPlanTypesQuery(category);

    // The toggle is built from this list, so a wedged subscription here
    // hangs the whole section — which is exactly what it did: the request
    // returned 200 with both plan types and the component sat on a
    // spinner forever.
    const [primedPlanTypes, setPrimedPlanTypes] = useState(null);
    useEffect(() => {
        let alive = true;
        refetchPlanTypes().unwrap()
            .then((rows) => { if (alive) setPrimedPlanTypes(rows || []); })
            .catch(() => { if (alive) setPrimedPlanTypes([]); });
        return () => { alive = false; };
    }, [refetchPlanTypes]);

    const allPlanTypes = subscribedPlanTypes.length
        ? subscribedPlanTypes
        : (primedPlanTypes || []);
    const planTypesLoading = planTypesRawLoading && primedPlanTypes === null;
    const [billing, setBilling] = useState(DEFAULT_BILLING);

    // This section sells provider/org subscriptions, so the receiver
    // (patient) plan type is filtered out — it has its own page at
    // ``/join_receiver`` and would otherwise sit in this toggle next to
    // Doctor / Clinic / Hospital.
    const planTypes = useMemo(
        () => allPlanTypes.filter((pt) => !pt.is_receiver),
        [allPlanTypes],
    );

    const [vertical, setVertical] = useState(null);
    useEffect(() => {
        if (!vertical && planTypes.length > 0) {
            setVertical(planTypes[0].code);
        }
    }, [planTypes, vertical]);
    const setVerticalSafe = (next) => {
        if (!next || !planTypes.some((pt) => pt.code === next)) return;
        setVertical(next);
    };

    // Settled AND empty — distinct from "not fetched yet".
    const noPlanTypes = !planTypesLoading && planTypes.length === 0;
    const { plans, addons, isLoading, error } = useVerticalPricingData(
        vertical, { noPlanTypes },
    );

    // Only the periods these plans price, and "Save N%" measured off their own
    // numbers rather than a fixed table.
    const periods = useMemo(() => visibleBillingPeriods(plans), [plans]);
    const savings = useMemo(() => billingSavings(plans), [plans]);

    // ``billing`` is local state and survives a vertical switch, so it can be
    // left pointing at a period the new vertical doesn't price — which would
    // empty the grid. Clamp to what's on offer.
    const effectiveBilling = useMemo(() => {
        if (periods.some((p) => p.key === billing)) return billing;
        if (periods.some((p) => p.key === DEFAULT_BILLING)) return DEFAULT_BILLING;
        return periods[0]?.key ?? DEFAULT_BILLING;
    }, [periods, billing]);

    const activePlanType = useMemo(
        () => planTypes.find((pt) => pt.code === vertical),
        [planTypes, vertical],
    );

    const addonByCode = useMemo(() => {
        const m = {};
        for (const a of addons) m[a.code] = a;
        return m;
    }, [addons]);


    return (
        <Box component="section" id="pricing" sx={{ py: { xs: 6, md: 10 }, bgcolor: 'background.default' }}>
            <Container maxWidth="lg">
                {/* ``hideHeading``: the standalone /pricing page renders a
                    market-category hero right above this section, so its own
                    chip + static title would read as a second page heading.
                    The homepage embed keeps them — there they ARE the
                    section header. The plan-type description stays in both:
                    it belongs to the toggle below, not the page. */}
                <Stack spacing={1.5} alignItems="center" sx={{ mb: 4, px: { xs: 2, sm: 0 }, textAlign: 'center' }}>
                    {!hideHeading && (
                        <Chip label="Pricing" size="small" color="primary" variant="outlined"/>
                    )}
                    {!hideHeading && (
                        <Typography
                            variant="h3"
                            sx={{
                                fontWeight: 700,
                                fontSize: { xs: '1.75rem', sm: '2.25rem', md: '3rem' },
                                wordBreak: 'break-word',
                            }}
                        >
                            Simple, transparent plans for organizations
                        </Typography>
                    )}
                    {activePlanType?.description && (
                        <Typography variant="body1" color="text.secondary"
                         sx={{ maxWidth: 680, whiteSpace: 'pre-line', fontWeight: 700,}}>
                            {activePlanType.description}
                        </Typography>
                    )}
                </Stack>

                {/* ── Persona toggle (Doctor / Clinic / Hospital) ── */}
                <Stack alignItems="center" sx={{ mb: 3 }}>
                    {planTypesLoading ? (
                        <CircularProgress size={28} />
                    ) : (
                        <ToggleButtonGroup
                            exclusive
                            value={vertical}
                            onChange={(_, next) => setVerticalSafe(next)}
                            sx={{
                                // Three icon+label buttons don't fit a 360px
                                // viewport on one line — let them wrap.
                                flexWrap: 'wrap',
                                justifyContent: 'center',
                                maxWidth: '100%',
                                bgcolor: 'white',
                                borderRadius: 3,
                                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                                p: 0.5,
                                gap: 0.5,
                                '& .MuiToggleButton-root': {
                                    border: 'none',
                                    borderRadius: 2.5,
                                    px: { xs: 1.5, sm: 3 },
                                    py: 1,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    fontSize: { xs: '0.8rem', sm: '0.875rem' },
                                    color: 'text.secondary',
                                    gap: 1,
                                },
                                '& .Mui-selected, & .Mui-selected:hover': {
                                    bgcolor: '#1B3B8C !important',
                                    color: 'white !important',
                                },
                            }}
                        >
                            {planTypes.map((pt) => (
                                <ToggleButton key={pt.code} value={pt.code}>
                                    <MuiIcon name={pt.icon_key} fontSize="small" />
                                    {pt.name}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    )}
                </Stack>

                {/* ── Billing period toggle ── */}
                <BillingPeriodToggle
                    value={effectiveBilling}
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
                        Unable to load pricing plans. Please refresh.
                    </Alert>
                )}

                {!isLoading && !error && plans.length === 0 && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        {noPlanTypes
                            ? 'No plans are published yet — check back soon.'
                            : 'No published plans for this category yet — check back soon.'}
                    </Alert>
                )}

                {!isLoading && !error && plans.length > 0 && (
                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={3}
                        alignItems="stretch"
                        justifyContent="center"
                        sx={{ pt: 2.5 }}
                    >
                        {plans.map((plan) => (
                            <PlanCard
                                key={plan.code}
                                plan={plan}
                                billing={effectiveBilling}
                                addonByCode={addonByCode}
                                vertical={vertical}
                                audience={isVendorHost ? 'main' : 'subdomain_child'}
                                onSelect={(p, seatPicks = {}) => {
                                    const picks = Object.entries(seatPicks)
                                        .filter(([, q]) => q > 0)
                                        .map(([c, q]) => `${c}:${q}`)
                                        .join(',');
                                    navigate(
                                        `/signup/tenant?plan=${encodeURIComponent(p.code)}`
                                        + `&vertical=${encodeURIComponent(vertical)}`
                                        + `&billing=${encodeURIComponent(billing)}`
                                        + (picks ? `&addons=${encodeURIComponent(picks)}` : '')
                                    );
                                }}
                            />
                        ))}
                    </Stack>
                )}

                <Typography variant="caption" color="text.secondary" align="center" component="div" sx={{ display: 'block', mt: 4 }}>
                    Patients use the portal for free. Plans cover staff seats, workflows,
                    and metered usage. Add-ons stack additively on top of the plan default.
                </Typography>
            </Container>
        </Box>
    );
}