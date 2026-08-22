/**
 * BillingPeriodToggle — the Monthly … Triennial pill row with "Save N%" chips.
 *
 * Shared by ``PricingSection`` and ``/join_receiver`` so both rows stay
 * pixel-identical. (JoinNetworkPage still carries its own copy — it belongs to
 * the separate membership-plans funnel and wasn't in scope to move.)
 *
 * ``periods`` narrows the row to what the current plans actually offer — pass
 * ``visibleBillingPeriods(plans)``. Defaults to all six for callers that want
 * the full row.
 *
 * A lone surviving period still renders, even though there's nothing to
 * choose: the pill is the only place the billing cadence is named, so hiding
 * it would leave "₹5,000/month" on an annual-only plan with nothing but the
 * card's fine print to say you're buying a year.
 *
 * ``savings`` is ``{periodKey: percent}`` from ``billingSavings(plans)`` —
 * measured off the plans on screen. Pass it or the chips don't render; there
 * are no default percentages any more, because the old hardcoded ones claimed
 * discounts the prices didn't back up.
 */
import { Chip, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { BILLING_PERIODS } from './planPricing';

export default function BillingPeriodToggle({
    value, onChange, sx, periods = BILLING_PERIODS, savings = {},
}) {
    if (periods.length === 0) return null;

    return (
        <Stack alignItems="center" sx={sx}>
            <ToggleButtonGroup
                exclusive
                value={value}
                onChange={(_, next) => { if (next) onChange(next); }}
                sx={{
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    bgcolor: 'white',
                    borderRadius: 3,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                    p: 0.5,
                    gap: 0.5,
                    '& .MuiToggleButton-root': {
                        border: 'none',
                        borderRadius: 2.5,
                        px: 2,
                        py: 1,
                        textTransform: 'none',
                        fontWeight: 600,
                        color: 'text.secondary',
                        gap: 1,
                    },
                    '& .Mui-selected, & .Mui-selected:hover': {
                        bgcolor: '#1B3B8C !important',
                        color: 'white !important',
                    },
                }}
            >
                {periods.map((p) => (
                    <ToggleButton key={p.key} value={p.key}>
                        {p.label}
                        {savings[p.key] > 0 && (
                            <Chip
                                label={`Save ${savings[p.key]}%`}
                                size="small"
                                sx={{
                                    height: 20,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    bgcolor: value === p.key ? 'rgba(255,255,255,0.25)' : 'success.light',
                                    color: value === p.key ? 'white' : 'success.dark',
                                }}
                            />
                        )}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
        </Stack>
    );
}
