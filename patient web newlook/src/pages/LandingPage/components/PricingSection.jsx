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
function useVerticalPricingData(vertical) {
    const { data: plans = [], isLoading: plansLoading, error: plansError } =
        useListPublicPlansCatalogQuery(vertical, { skip: !vertical });
    const { data: addons = [] } = useListPublicAddonsCatalogQuery();

    return { plans, addons, isLoading: !vertical || plansLoading, error: plansError };
}

export default function PricingSection() {
    const navigate = useNavigate();
    const { data: allPlanTypes = [], isLoading: planTypesLoading } = useListPublicPlanTypesQuery();
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

    const { plans, addons, isLoading, error } = useVerticalPricingData(vertical);

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
                <Stack spacing={1.5} alignItems="center" sx={{ mb: 4, px: { xs: 2, sm: 0 }, textAlign: 'center' }}>
                    <Chip label="Pricing" size="small" color="primary" variant="outlined"/>
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
                        No published plans for this category yet — check back soon.
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
                                onSelect={(p) =>
                                    navigate(
                                        `/signup/tenant?plan=${encodeURIComponent(p.code)}`
                                        + `&vertical=${encodeURIComponent(vertical)}`
                                        + `&billing=${encodeURIComponent(billing)}`
                                    )
                                }
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