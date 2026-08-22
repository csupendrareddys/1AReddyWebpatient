/**
 * Per-plan add-on terms — "different plans, different add-on price and
 * capacity". One row per catalogue add-on with three states:
 *   inherit (absent)  → the add-on's own tier terms apply,
 *   override (dict)   → this plan's price/units/bounds/cycle apply,
 *   withhold (null)   → this plan does not offer the add-on.
 * On an apex-authored child plan these are the RESALE terms its
 * children pay.
 */
import {
    Box, MenuItem, Stack, TextField, Typography,
} from '@mui/material';

const CYCLES = [
    ['one_time', 'One-time'], ['monthly', 'Monthly'],
    ['quarterly', 'Quarterly'], ['semi_annual', 'Half-yearly'],
    ['annual', 'Yearly'], ['biennial', '2-yearly'], ['triennial', '3-yearly'],
];

const MODES = [
    ['inherit', 'Catalogue terms'],
    ['override', 'This plan’s terms'],
    ['withhold', 'Not offered'],
];

const BLANK = {
    active: true, units: 1, price_inr: null, og_price_inr: null,
    min_qty: 1, max_qty: null, billing_cycle: 'monthly',
};

export default function PlanAddonTermsEditor({ value, onChange, addons = [],
    title = 'Add-on terms on this plan', costOf }) {
    const terms = value || {};
    const active = addons.filter((a) => a.status === 'active');
    if (active.length === 0) return null;

    const modeOf = (code) => {
        if (!(code in terms)) return 'inherit';
        return terms[code] === null ? 'withhold' : 'override';
    };

    const setMode = (code, mode) => {
        const next = { ...terms };
        if (mode === 'inherit') delete next[code];
        else if (mode === 'withhold') next[code] = null;
        else next[code] = { ...BLANK, ...(next[code] || {}) };
        onChange(Object.keys(next).length ? next : null);
    };

    const setField = (code, field, raw) => {
        const t = { ...(terms[code] || BLANK) };
        t[field] = raw === '' ? null : raw;
        onChange({ ...terms, [code]: t });
    };

    const num = (code, t, field, label, min = 0) => (
        <TextField
            key={field} label={label} type="number" size="small"
            value={t[field] ?? ''}
            onChange={(e) => setField(code, field,
                e.target.value === '' ? '' : Number(e.target.value))}
            inputProps={{ min }}
            sx={{ width: 104 }}
        />
    );

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {title}
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                Buyers on this plan get these terms instead of the
                catalogue&apos;s. &quot;Not offered&quot; hides the add-on
                from this plan entirely. Existing subscribers keep their
                subscription-time terms.
            </Typography>
            <Stack spacing={1}>
                {active.map((a) => {
                    const mode = modeOf(a.code);
                    const t = terms[a.code] || BLANK;
                    return (
                        <Box key={a.code} sx={{
                            border: 1, borderRadius: 1, p: 1.25,
                            borderColor: mode === 'override'
                                ? 'primary.main' : 'divider',
                            opacity: mode === 'withhold' ? 0.65 : 1,
                        }}>
                            <Stack direction="row" spacing={1.5}
                                alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="body2"
                                    sx={{ fontWeight: 600, minWidth: 160 }}>
                                    {a.name}
                                    {costOf && costOf(a) && (
                                        <Typography variant="caption"
                                            color="text.secondary"
                                            sx={{ display: 'block' }}>
                                            {costOf(a)}
                                        </Typography>
                                    )}
                                </Typography>
                                <TextField
                                    select size="small" value={mode}
                                    onChange={(e) => setMode(a.code,
                                        e.target.value)}
                                    sx={{ width: 170 }}
                                >
                                    {MODES.map(([v, l]) => (
                                        <MenuItem key={v} value={v}>{l}</MenuItem>
                                    ))}
                                </TextField>
                                {mode === 'override' && (
                                    <>
                                        {num(a.code, t, 'units', 'Units', 1)}
                                        {num(a.code, t, 'price_inr', 'Price ₹')}
                                        {num(a.code, t, 'min_qty', 'Min', 1)}
                                        {num(a.code, t, 'max_qty', 'Max')}
                                        <TextField
                                            select size="small" label="Billing"
                                            value={t.billing_cycle || 'monthly'}
                                            onChange={(e) => setField(a.code,
                                                'billing_cycle', e.target.value)}
                                            sx={{ width: 130 }}
                                        >
                                            {CYCLES.map(([v, l]) => (
                                                <MenuItem key={v} value={v}>
                                                    {l}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                    </>
                                )}
                            </Stack>
                        </Box>
                    );
                })}
            </Stack>
        </Box>
    );
}
