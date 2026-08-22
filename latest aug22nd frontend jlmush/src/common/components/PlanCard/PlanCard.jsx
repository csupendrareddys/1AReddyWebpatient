/**
 * PlanCard — one SaaS plan tile: price, what the plan includes, monthly
 * limits, plus the CTA.
 *
 * Lifted out of ``PricingSection`` so ``/join_receiver`` renders the exact
 * same card rather than a lookalike copy that drifts.
 *
 * The "what you get" middle section has two mutually exclusive forms. A
 * plan carrying a free-text ``benefits`` list (receiver / patient plans)
 * renders that verbatim; anything else renders the derived core-feature
 * list plus included add-ons. Receiver plans save ``features`` and
 * ``default_addons`` empty, so without the benefits branch their cards
 * would show nothing but the provider-speak fallback line.
 *
 * ``vertical`` is only used to read ``plan.provider_entity_limits[vertical]``
 * ("Up to 3 clinics"); pass the plan-type code. Omit it on surfaces where
 * that line doesn't apply and it simply won't render.
 */
import {
    Box, Button, Card, CardActions, CardContent, Chip, Divider, Stack, Tooltip, Typography,
} from '@mui/material';
import { useState } from 'react';
import AdditionalSeatsPicker, { seatRowsFor } from './AdditionalSeatsPicker';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import StarOutlineIcon from '@mui/icons-material/StarOutline';
import DataUsageIcon from '@mui/icons-material/DataUsage';

import { BILLING_PERIODS, CORE_FEATURE_LABELS, enabledCorePaths, resolvePrice } from './planPricing';
import MemberDiscountBadge from './MemberDiscountBadge';
import { formatMetricName, summariseMetric } from '../../../features/admin/Pricing/utils/usageLabels';

export default function PlanCard({
    plan, billing, addonByCode = {}, vertical, onSelect,
    audience = 'main',
}) {
    // Display-only flag from the plan: hide the add-on blocks for this
    // audience (main buyer vs a reseller's child). Default = shown.
    const showAddonLines = (plan.card_display || {})[
        `show_addons_${audience}`] !== false;
    // Signup-time "additional team members" picks, {addon_code: qty}.
    // Only trial plans offer them (the grant rides the trial window).
    const [seatPicks, setSeatPicks] = useState({});
    const seatRows = plan.trial_days > 0
        ? seatRowsFor(plan, addonByCode) : [];
    // Receiver (patient) plans sell a free-text ``benefits`` list and save
    // ``features`` / ``default_addons`` empty; provider plans are the
    // mirror image. Branching on the benefits list rather than on
    // ``plan_type.is_receiver`` keeps this card working for any plan that
    // fills one side or the other, without a plan-type lookup here.
    const benefits = (plan.benefits || []).filter(Boolean);
    const showBenefits = benefits.length > 0;
    const corePaths = enabledCorePaths(plan.features || {})
        .filter((p) => CORE_FEATURE_LABELS[p]);
    const includedAddons = (plan.default_addons || [])
        .map((code) => addonByCode[code])
        .filter(Boolean);
    const price = resolvePrice(plan, billing);
    const isRecommended = plan.is_default;
    const usageRows = Object.entries(plan.usage_limits || {})
        .map(([metric, w]) => ({ metric, summary: summariseMetric(metric, w) }))
        .filter((r) => r.summary);
    const entityLimit = vertical ? plan.provider_entity_limits?.[vertical] : null;

    // Null = this plan doesn't offer the selected period (no price, no custom
    // marker). Render nothing rather than a card with an invented label —
    // callers only ever offer periods some plan has, so this is the backstop
    // for a plan pricing a different set than its neighbours.
    if (!price) return null;

    // A free tier has nothing to trial, and a quote-only one has nothing to
    // start — only a genuinely priced plan gets the trial CTA. A priced
    // plan that declares NO trial (trial_days 0) starts paid on day one:
    // advertising a "0-day free trial" would be nonsense.
    const ctaLabel = price.isCustom
        ? 'Contact sales'
        : price.isFree || !(plan.trial_days > 0)
            ? 'Get started'
            : `Start ${plan.trial_days}-day free trial`;

    return (
        <Card
            elevation={isRecommended ? 6 : 2}
            sx={{
                flex: 1,
                maxWidth: 400,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 3,
                border: isRecommended ? '2px solid' : '1px solid',
                borderColor: isRecommended ? 'primary.main' : 'divider',
                position: 'relative',
                overflow: 'visible',
            }}
        >
            <CardContent sx={{ flex: 1, p: 3 }}>
                {isRecommended && (
                    <Chip
                        label="Recommended"
                        size="small"
                        color="primary"
                        icon={<StarOutlineIcon fontSize="small" />}
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            fontWeight: 600,
                            zIndex: 2,
                        }}
                    />
                )}
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {plan.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                    {plan.description || ' '}
                </Typography>

                <Stack spacing={0.5} sx={{ mb: 1 }}>
                    {price.original && (
                        <Typography
                            variant="h5"
                            color="text.secondary"
                            sx={{ fontWeight: 600, textDecoration: 'line-through', lineHeight: 1 }}
                        >
                            {price.original}
                        </Typography>
                    )}

                    <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography
                            variant="h3"
                            sx={{ fontWeight: 700, lineHeight: 1, width: 'fit-content' }}
                        >
                            {price.current}
                        </Typography>

                        {price.bottom && (
                            <Typography variant="body2" color="text.secondary">
                                {price.bottom}
                            </Typography>
                        )}

                        {price.discount && (
                            <Chip label={`${price.discount}% OFF`} color="success" size="small" />
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

                {plan.user_limits && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                        {plan.user_limits.total} team users · {plan.user_limits.per_role?.provider} providers
                    </Typography>
                )}

                {entityLimit != null && (
                    <Typography variant="caption" color="text.secondary" component="div">
                        Up to {entityLimit} {vertical}{entityLimit === 1 ? '' : 's'}
                    </Typography>
                )}

                {/* Marketplace membership tiers only — SaaS plans carry no
                    ``member_discount_pct``, so the badge self-hides there. */}
                <MemberDiscountBadge plan={plan} />

                <Divider sx={{ my: 2 }} />

                {showBenefits ? (
                    <>
                        <Typography variant="overline" color="text.secondary">
                            What&apos;s included
                        </Typography>
                        <Stack spacing={0.75} sx={{ mt: 1, mb: 2 }}>
                            {benefits.map((b) => (
                                <Stack key={b} direction="row" spacing={1} alignItems="flex-start">
                                    <CheckCircleOutlineIcon
                                        fontSize="small"
                                        color="success"
                                        sx={{ mt: '2px', flexShrink: 0 }}
                                    />
                                    <Typography variant="body2">{b}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </>
                ) : (
                    <>
                        <Typography variant="overline" color="text.secondary">
                            Core features
                        </Typography>
                        <Stack spacing={0.75} sx={{ mt: 1, mb: 2 }}>
                            {corePaths.length === 0 && (
                                <Typography variant="caption" color="text.secondary">
                                    Core platform access (subdomain, email, payments)
                                </Typography>
                            )}
                            {corePaths.slice(0, 6).map((path) => (
                                <Stack key={path} direction="row" spacing={1} alignItems="center">
                                    <CheckCircleOutlineIcon fontSize="small" color="success" />
                                    <Typography variant="body2">
                                        {CORE_FEATURE_LABELS[path]}
                                    </Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </>
                )}

                {!showBenefits && showAddonLines && includedAddons.length > 0 && (
                    <>
                        <Typography variant="overline" color="text.secondary">
                            Included add-ons ({includedAddons.length})
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1, mb: 2 }}>
                            {includedAddons.slice(0, 8).map((a) => (
                                <Tooltip key={a.code} title={a.description || ''}>
                                    <Chip label={a.name} size="small" variant="outlined" sx={{ mb: 0.5 }} />
                                </Tooltip>
                            ))}
                            {includedAddons.length > 8 && (
                                <Chip label={`+ ${includedAddons.length - 8} more`} size="small" sx={{ mb: 0.5 }} />
                            )}
                        </Stack>
                    </>
                )}

                {usageRows.length > 0 && (
                    <>
                        <Typography variant="overline" color="text.secondary">
                            Monthly limits
                        </Typography>
                        <Stack spacing={0.5} sx={{ mt: 1 }}>
                            {usageRows.map(({ metric, summary }) => (
                                <Stack key={metric} direction="row" spacing={1} alignItems="center">
                                    <DataUsageIcon fontSize="small" color="action" />
                                    <Typography variant="caption">
                                        <strong>{formatMetricName(metric)}:</strong> {summary}
                                    </Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </>
                )}
                <AdditionalSeatsPicker
                    rows={showAddonLines ? seatRows : []}
                    picks={seatPicks}
                    onChange={setSeatPicks}
                />
            </CardContent>
            <CardActions sx={{ p: 3, pt: 0 }}>
                <Button
                    fullWidth
                    variant={isRecommended ? 'contained' : 'outlined'}
                    size="large"
                    onClick={() => onSelect(plan, seatPicks)}
                >
                    {ctaLabel}
                </Button>
            </CardActions>
        </Card>
    );
}
