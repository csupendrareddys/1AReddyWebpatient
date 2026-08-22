/**
 * Per-buyer-tier commercial terms for one add-on — the mock's
 * "Add-ons" screen, one block per tier instead of three giant tables.
 *
 * value shape (mirrors Addon.tiers server-side):
 *   { main:                {active, units, price_inr, og_price_inr,
 *                           min_qty, max_qty, billing_cycle},
 *     subdomain_child:     {...} | null,
 *     custom_domain_child: {...} | null }
 * A null value entirely = legacy add-on (scalar monthly/annual prices
 * keep selling); flipping any tier on starts the tiered shape.
 */
import {
    Box, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';

const TIERS = [
    ['main', 'Main tenant', 'What a tenant buys for itself.'],
    ['subdomain_child', 'Subdomain child',
     'What an apex buys for a child on its own zone.'],
    ['custom_domain_child', 'Custom-domain child',
     'What an apex buys for a child on its own domain.'],
];

const CYCLES = [
    ['one_time', 'One-time'], ['monthly', 'Monthly'],
    ['quarterly', 'Quarterly'], ['semi_annual', 'Half-yearly'],
    ['annual', 'Yearly'], ['biennial', '2-yearly'], ['triennial', '3-yearly'],
];

const BLANK_TIER = {
    active: true, units: 1, price_inr: null, og_price_inr: null,
    min_qty: 1, max_qty: null, billing_cycle: 'monthly',
};

export default function AddonTierEditor({ value, onChange }) {
    const tiers = value || {};

    const setTier = (key, tier) => onChange({ ...tiers, [key]: tier });

    const numField = (key, tier, field, label, opts = {}) => (
        <TextField
            label={label}
            type="number"
            size="small"
            value={tier[field] ?? ''}
            onChange={(e) => setTier(key, {
                ...tier,
                [field]: e.target.value === '' ? null : Number(e.target.value),
            })}
            sx={{ width: 110 }}
            inputProps={{ min: opts.min ?? 0 }}
        />
    );

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Commercial terms per buyer
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                Units = how much one purchase grants (grant = deltas ×
                units × quantity). Min–Max bound the total a buyer can
                hold; blank max = uncapped. One-time = charged once, kept
                while the buyer&apos;s plan stays active. A tier switched
                off is simply not offered to that buyer.
            </Typography>
            <Stack spacing={1.5}>
                {TIERS.map(([key, label, hint]) => {
                    const tier = tiers[key];
                    const on = Boolean(tier && tier.active !== false);
                    return (
                        <Box key={key} sx={{
                            border: 1, borderColor: on ? 'primary.main' : 'divider',
                            borderRadius: 1, p: 1.5,
                        }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <FormControlLabel
                                    control={(
                                        <Switch
                                            size="small"
                                            checked={on}
                                            onChange={(e) => setTier(key,
                                                e.target.checked
                                                    ? { ...BLANK_TIER, ...(tier || {}), active: true }
                                                    : null)}
                                        />
                                    )}
                                    label={label}
                                    slotProps={{ typography: { fontWeight: 600, fontSize: 14 } }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                    {hint}
                                </Typography>
                            </Stack>
                            {on && (
                                <Stack direction="row" spacing={1} flexWrap="wrap"
                                    useFlexGap sx={{ mt: 1 }}>
                                    {numField(key, tier, 'units', 'Units', { min: 1 })}
                                    {numField(key, tier, 'price_inr', 'Price ₹')}
                                    {numField(key, tier, 'og_price_inr', 'Was ₹')}
                                    {numField(key, tier, 'min_qty', 'Min', { min: 1 })}
                                    {numField(key, tier, 'max_qty', 'Max')}
                                    <TextField
                                        label="Billing"
                                        select
                                        size="small"
                                        value={tier.billing_cycle || 'monthly'}
                                        onChange={(e) => setTier(key,
                                            { ...tier, billing_cycle: e.target.value })}
                                        sx={{ width: 140 }}
                                    >
                                        {CYCLES.map(([v, l]) => (
                                            <MenuItem key={v} value={v}>{l}</MenuItem>
                                        ))}
                                    </TextField>
                                </Stack>
                            )}
                        </Box>
                    );
                })}
            </Stack>
        </Box>
    );
}
