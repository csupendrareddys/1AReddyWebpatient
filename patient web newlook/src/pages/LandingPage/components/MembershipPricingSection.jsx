/**
 * MembershipPricingSection — marketplace membership tiers for the apex
 * pricing page (``larazen.in``).
 *
 * Different product line from the SaaS ``PricingSection`` that already
 * lives on the apex: those plans sell tenant subdomains, these tiers
 * sell *marketplace participation* — doctors / clinics / hospitals
 * register on the apex itself and pay for visibility, branding, and
 * feature access on the platform's own surface.
 *
 * Reads ``/api/public/membership-plans`` (ACTIVE rows only) and groups
 * them by vertical into one block per vertical.
 *
 * The verticals themselves come from ``/api/public/vertical-types`` — they
 * used to be a hardcoded doctor/clinic/hospital list here, keyed off a
 * ``plan.vertical`` string that no longer exists (a plan carries a
 * ``vertical_plan_type`` FK now, serialised nested on each row). The vertical
 * list drives the ORDER and the headings; the plans are bucketed by their own
 * nested vertical's code, so a plan whose vertical isn't published simply
 * doesn't render.
 *
 * Only provider verticals appear: this section sells marketplace
 * participation, and receivers (patients) don't join the network — their plans
 * live at /join_receiver.
 */
import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip, Container,
    Divider, Stack, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import StarIcon from '@mui/icons-material/Star';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    useListPublicMembershipPlansCatalogQuery,
} from '../../../features/admin/api/publicEndpoints';
import useVerticalTypes, {
    providerSignupRouteFor,
} from '../../../common/hooks/useVerticalTypes';
import {
    CUSTOM_PRICE, priceForPeriod,
} from '../../../common/components/PlanCard/planPricing';
import MemberDiscountBadge from '../../../common/components/PlanCard/MemberDiscountBadge';
import planLimitLines from '../../../utils/planLimits';


const TIER_ORDER = { basic: 0, growth: 1, pro: 2 };


// This grid only ever quotes the monthly rate — it has no billing toggle, so
// there's one period to speak for.
//
// Goes through ``priceForPeriod`` rather than reading ``pricing`` directly so
// the custom marker is read the same way as everywhere else: a raw read here
// would print the sentinel as a price ("₹-1"). Returns null when the plan
// doesn't price monthly at all, and the caller drops the card.
function priceLabel(plan) {
    const monthly = priceForPeriod(plan, 'monthly');
    if (monthly == null) return null;
    if (monthly === CUSTOM_PRICE) {
        return { top: 'Custom', bottom: 'Contact us', original: null, discount: null };
    }

    // The list price this is marked down from, if there is one. Same og_
    // -derived figure PlanCard shows; this grid used to quote the sale price
    // with nothing to compare it against.
    const og = plan.pricing?.og_price_inr_monthly;
    const hasDiscount = typeof og === 'number' && og > monthly;

    // 0 is a price the admin typed, not a missing one — give the tier away
    // rather than quoting "₹0/month". Keeps the struck-through list price if
    // there is one, but no "100% OFF" chip next to the word Free.
    if (monthly === 0) {
        return {
            top: 'Free',
            bottom: '',
            original: hasDiscount ? `₹${Math.round(og).toLocaleString()}` : null,
            discount: null,
        };
    }

    return {
        top: `₹${Math.round(monthly).toLocaleString()}`,
        bottom: '/month',
        original: hasDiscount ? `₹${Math.round(og).toLocaleString()}` : null,
        discount: hasDiscount ? Math.round(((og - monthly) / og) * 100) : null,
    };
}


function bulletList(plan) {
    // ``features`` is free-form in Round 1; the admin authoring UI
    // stores ``{ bullets: ["…"] }``. Fall back to an empty array if a
    // human (or an older format) stored something else.
    const bullets = plan?.features?.bullets;
    const authored = Array.isArray(bullets) ? bullets : [];
    // The capacity caps are appended, not authored — they're read live off
    // the plan's columns, so a card can't promise a number the server then
    // refuses. Last, because they qualify the offer rather than sell it.
    return [...authored, ...planLimitLines(plan).map((l) => l.text)];
}


const MembershipPricingSection = () => {
    const navigate = useNavigate();
    const { data: plans = [], isLoading, error } =
        useListPublicMembershipPlansCatalogQuery();
    const {
        providerTypes,
        isLoading: verticalsLoading,
        error: verticalsError,
    } = useVerticalTypes();

    // Bucket by the plan's own nested vertical code. Keyed off the published
    // provider verticals, so a receiver plan — or one pointing at a vertical
    // that was never published — lands in no bucket and doesn't render.
    const grouped = useMemo(() => {
        const out = {};
        for (const vt of providerTypes) out[vt.code] = [];
        for (const p of plans) {
            const code = p.vertical_plan_type?.code;
            if (code && out[code]) out[code].push(p);
        }
        // Sort within each vertical by (sort_order asc, tier asc).
        for (const v of Object.keys(out)) {
            out[v].sort((a, b) => {
                if ((a.sort_order || 0) !== (b.sort_order || 0)) {
                    return (a.sort_order || 0) - (b.sort_order || 0);
                }
                return (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
            });
        }
        return out;
    }, [plans, providerTypes]);

    // Don't even render the section if the platform owner hasn't authored any
    // membership plans yet — empty pricing rails look unfinished. The SaaS
    // PricingSection below this stays visible. Same for no published provider
    // verticals: every block would be keyed on one, so there'd be nothing but
    // the heading.
    if (!isLoading && !error && plans.length === 0) {
        return null;
    }
    if (!verticalsLoading && !verticalsError && providerTypes.length === 0) {
        return null;
    }

    return (
        <Box
            component="section"
            id="membership-pricing"
            sx={{ py: { xs: 6, md: 10 }, bgcolor: 'background.paper' }}
        >
            <Container maxWidth="lg">
                <Stack spacing={1.5} alignItems="center" sx={{ mb: 5, textAlign: 'center' }}>
                    <Chip
                        label="Marketplace Membership"
                        size="small"
                        color="primary"
                        variant="outlined"
                    />
                    <Typography variant="h3" sx={{ fontWeight: 700 }}>
                        Join the larazen marketplace
                    </Typography>
                    <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{ maxWidth: 720 }}
                    >
                        Whether you're a solo doctor, a multi-practitioner clinic, or a hospital
                        network — pick the tier that matches your practice and start serving
                        patients who discover you on larazen.
                    </Typography>
                </Stack>

                {(error || verticalsError) && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        Unable to load membership plans. Please refresh.
                    </Alert>
                )}

                {(isLoading || verticalsLoading) && (
                    <Typography
                        color="text.secondary"
                        align="center"
                        sx={{ minHeight: 200 }}
                    >
                        Loading membership tiers…
                    </Typography>
                )}

                {!isLoading && providerTypes.map((vt) => {
                    const tiers = grouped[vt.code];
                    if (!tiers || tiers.length === 0) return null;
                    return (
                        <Box key={vt.code} sx={{ mb: { xs: 5, md: 7 } }}>
                            <Stack
                                spacing={0.75}
                                alignItems="center"
                                sx={{ mb: 3, textAlign: 'center' }}
                            >
                                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                    {vt.name}
                                </Typography>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ maxWidth: 680 }}
                                >
                                    {vt.description}
                                </Typography>
                            </Stack>

                            <Stack
                                direction={{ xs: 'column', md: 'row' }}
                                spacing={3}
                                alignItems="stretch"
                                justifyContent="center"
                            >
                                {tiers.map((plan) => {
                                    // Null = no monthly rate authored, and this
                                    // grid has no other period to fall back
                                    // to, so there's nothing to quote.
                                    const price = priceLabel(plan);
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
                                            }}
                                        >
                                            {featured && (
                                                <Chip
                                                    label="MOST POPULAR"
                                                    size="small"
                                                    color="primary"
                                                    icon={<StarIcon fontSize="small" />}
                                                    sx={{
                                                        position: 'absolute',
                                                        top: -12,
                                                        left: '50%',
                                                        transform: 'translateX(-50%)',
                                                        fontWeight: 600,
                                                    }}
                                                />
                                            )}
                                            <CardContent sx={{ flex: 1, p: 3 }}>
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

                                                {price.original && (
                                                    <Typography
                                                        variant="h6"
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

                                                <Stack
                                                    direction="row"
                                                    alignItems="baseline"
                                                    spacing={0.5}
                                                    sx={{ mb: 0.5 }}
                                                >
                                                    <Typography
                                                        variant="h3"
                                                        sx={{ fontWeight: 700 }}
                                                    >
                                                        {price.top}
                                                    </Typography>
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        {price.bottom}
                                                    </Typography>
                                                    {price.discount && (
                                                        <Chip
                                                            label={`${price.discount}% OFF`}
                                                            color="success"
                                                            size="small"
                                                        />
                                                    )}
                                                </Stack>
                                                {plan.trial_days > 0 && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {plan.trial_days}-day free trial
                                                    </Typography>
                                                )}

                                                <MemberDiscountBadge plan={plan} />

                                                <Divider sx={{ my: 2 }} />

                                                <Stack spacing={0.75} sx={{ mt: 1 }}>
                                                    {bullets.length === 0 && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                        >
                                                            Core membership benefits.
                                                        </Typography>
                                                    )}
                                                    {bullets.map((b) => (
                                                        <Stack
                                                            key={b}
                                                            direction="row"
                                                            spacing={1}
                                                            alignItems="flex-start"
                                                        >
                                                            <CheckCircleOutlineIcon
                                                                fontSize="small"
                                                                color="success"
                                                                sx={{ mt: '2px' }}
                                                            />
                                                            <Typography variant="body2">
                                                                {b}
                                                            </Typography>
                                                        </Stack>
                                                    ))}
                                                </Stack>
                                            </CardContent>
                                            <CardActions sx={{ p: 3, pt: 0 }}>
                                                {/* Routes through the vertical's
                                                    service-provider signup page with the
                                                    chosen plan in the query string. */}
                                                <Button
                                                    fullWidth
                                                    variant={featured ? 'contained' : 'outlined'}
                                                    size="large"
                                                    onClick={() =>
                                                        navigate(
                                                            providerSignupRouteFor(vt.code)
                                                            + `?plan=${encodeURIComponent(plan.code)}`
                                                        )
                                                    }
                                                >
                                                    {plan.trial_days > 0
                                                        ? `Start ${plan.trial_days}-day free trial`
                                                        : 'Get started'}
                                                </Button>
                                            </CardActions>
                                        </Card>
                                    );
                                })}
                            </Stack>
                        </Box>
                    );
                })}

                <Typography
                    variant="caption"
                    color="text.secondary"
                    align="center"
                    component="div"
                    sx={{ display: 'block', mt: 4 }}
                >
                    Larazen takes a per-booking platform fee + commission and pays out the
                    rest to providers on their preferred schedule. Distinct from our SaaS
                    plans below — those sell you your own subdomain to run your practice
                    independently.
                </Typography>
            </Container>
        </Box>
    );
};

export default MembershipPricingSection;
