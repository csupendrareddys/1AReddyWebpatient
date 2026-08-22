/**
 * BuilderCart — the mock's "subscription builder": a working cart
 * simulation inside the plan dialog. Prices what a buyer on THIS plan
 * could add — per add-on quantity at the terms this plan resolves to
 * (plan overrides → tier → legacy) — and totals it with the plan
 * price as a monthly equivalent. Pure simulation: edits nothing.
 */
import { useMemo, useState } from 'react';
import {
    Box, Divider, Stack, TextField, Typography,
} from '@mui/material';

const MONTHS = {
    monthly: 1, quarterly: 3, semi_annual: 6, annual: 12,
    biennial: 24, triennial: 36,
};
const SHORT = {
    one_time: ' once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

const fmt = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// This plan's buying terms for one add-on (mirror of the server's
// resolution order, minus snapshots — the dialog previews the LIVE plan).
const termsFor = (planForm, addon) => {
    const pt = (planForm.addon_terms || {})[addon.code];
    if (pt === null) return null;
    if (pt && pt.active !== false) {
        return { price: Number(pt.price_inr || 0),
                 cycle: pt.billing_cycle || 'monthly',
                 units: pt.units || 1, max: pt.max_qty ?? null };
    }
    const t = addon.tiers?.main;
    if (t && t.active !== false) {
        return { price: Number(t.price_inr || 0),
                 cycle: t.billing_cycle || 'monthly',
                 units: t.units || 1, max: t.max_qty ?? null };
    }
    if (addon.tiers) return null;          // tiered but main switched off
    if (addon.price_inr_monthly != null) {
        return { price: Number(addon.price_inr_monthly), cycle: 'monthly',
                 units: 1, max: null };
    }
    return null;
};

export default function BuilderCart({ planForm, addons = [] }) {
    const [qty, setQty] = useState({});
    const rows = useMemo(() => addons
        .filter((a) => a.status === 'active')
        .map((a) => ({ addon: a, terms: termsFor(planForm, a) }))
        .filter((r) => r.terms), [addons, planForm]);

    if (rows.length === 0) return null;

    let monthlyEq = 0;
    let oneTime = 0;
    rows.forEach(({ addon, terms }) => {
        const q = Number(qty[addon.code] || 0);
        if (!q) return;
        const line = terms.price * q;
        if (terms.cycle === 'one_time') oneTime += line;
        else monthlyEq += line / (MONTHS[terms.cycle] || 1);
    });
    const planMonthly = Number(planForm.price_inr_monthly);
    const hasPlanMonthly = Number.isFinite(planMonthly) && planMonthly >= 0;

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Subscription builder (simulation)
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                What a buyer on this plan could add, at this plan&apos;s
                resolved terms. Changes nothing — it&apos;s the purchase
                screen the tenant will drive.
            </Typography>
            <Stack spacing={0.75}>
                {rows.map(({ addon, terms }) => (
                    <Stack key={addon.code} direction="row" spacing={1}
                        alignItems="center">
                        <Typography variant="body2" sx={{ flex: 1 }}>
                            {addon.name}
                            <Typography component="span" variant="caption"
                                color="text.secondary">
                                {' — '}
                                {terms.price > 0
                                    ? fmt(terms.price) + (SHORT[terms.cycle] || '')
                                    : 'free'}
                                {terms.units > 1 ? ` per ${terms.units}` : ''}
                            </Typography>
                        </Typography>
                        <TextField
                            size="small" type="number" label="Qty"
                            value={qty[addon.code] ?? 0}
                            inputProps={{ min: 0, max: terms.max || 99 }}
                            onChange={(e) => setQty({
                                ...qty,
                                [addon.code]: Math.max(0, Math.min(
                                    Number(e.target.value || 0),
                                    terms.max || 99)),
                            })}
                            sx={{ width: 84 }}
                        />
                    </Stack>
                ))}
            </Stack>
            <Divider sx={{ my: 1 }} />
            <Stack spacing={0.25}>
                <Typography variant="body2">
                    Add-ons, monthly equivalent: <b>{fmt(monthlyEq)}</b>
                </Typography>
                {oneTime > 0 && (
                    <Typography variant="body2">
                        Due once at purchase: <b>{fmt(oneTime)}</b>
                    </Typography>
                )}
                {hasPlanMonthly && (
                    <Typography variant="body2">
                        Plan + add-ons per month:{' '}
                        <b>{fmt(planMonthly + monthlyEq)}</b>
                    </Typography>
                )}
            </Stack>
        </Box>
    );
}
