/**
 * AdditionalSeatsPicker — the competitor-style "Additional Team Users"
 * steppers on the public plan card, per ROLE (we price seats per
 * role). Each stepper maps to the first active seat add-on granting
 * that role, priced through the plan's own terms when it has them
 * (plan.addon_terms → the add-on's main tier → legacy monthly).
 *
 * Picks are granted for the TRIAL window at signup and must be bought
 * for real when the trial converts — so the picker only renders on
 * plans with a trial.
 */
import {
    Box, IconButton, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

const ROLES = [
    ['super_admin', 'Additional Super admins'],
    ['sub_admin', 'Additional Sub-admins'],
    ['provider', 'Additional Providers'],
];

const CYCLE_SHORT = {
    one_time: ' once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

// The buyer-facing terms for one add-on ON this plan.
const termsFor = (plan, addon) => {
    const planTerm = (plan.addon_terms || {})[addon.code];
    if (planTerm === null) return null;          // withheld from this plan
    if (planTerm && planTerm.active !== false) {
        return {
            price: planTerm.price_inr, cycle: planTerm.billing_cycle || 'monthly',
            units: planTerm.units || 1, max: planTerm.max_qty ?? null,
        };
    }
    const t = addon.main_tier;
    if (t && t.billing_cycle) {
        return {
            price: t.price_inr, cycle: t.billing_cycle,
            units: t.units || 1, max: t.max_qty ?? null,
        };
    }
    if (addon.price_inr_monthly != null) {
        return { price: addon.price_inr_monthly, cycle: 'monthly',
                 units: 1, max: null };
    }
    return null;
};

export const seatRowsFor = (plan, addonByCode) => {
    const rows = [];
    for (const [role, label] of ROLES) {
        const addon = Object.values(addonByCode || {}).find((a) => {
            const grant = (a.limits || {})[role];
            return Number.isInteger(grant) && grant > 0;
        });
        if (!addon) continue;
        const terms = termsFor(plan, addon);
        if (!terms) continue;
        rows.push({ role, label, addon, terms });
    }
    return rows;
};

export default function AdditionalSeatsPicker({ rows, picks, onChange }) {
    if (!rows.length) return null;
    const step = (code, delta, max) => {
        const cur = picks[code] || 0;
        const next = Math.max(0, Math.min(cur + delta, max || 99));
        onChange({ ...picks, [code]: next });
    };
    return (
        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
            {rows.map(({ role, label, addon, terms }) => (
                <Stack key={role} direction="row" alignItems="center"
                    spacing={1} sx={{ py: 0.4 }}>
                    <Typography variant="caption" sx={{ flex: 1 }}>
                        {label}
                        <Typography variant="caption" color="text.secondary"
                            component="span">
                            {terms.price != null && Number(terms.price) > 0
                                ? ` — ₹${Number(terms.price)
                                    .toLocaleString('en-IN')}`
                                  + `${CYCLE_SHORT[terms.cycle] || ''}`
                                  + `${terms.units > 1
                                      ? ` per ${terms.units}` : ''}`
                                : ' — free'}
                        </Typography>
                    </Typography>
                    <IconButton size="small" aria-label={`fewer ${role}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            step(addon.code, -1, terms.max);
                        }}>
                        <RemoveIcon fontSize="inherit" />
                    </IconButton>
                    <Typography variant="body2" sx={{
                        minWidth: 22, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        {picks[addon.code] || 0}
                    </Typography>
                    <IconButton size="small" aria-label={`more ${role}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            step(addon.code, 1, terms.max);
                        }}>
                        <AddIcon fontSize="inherit" />
                    </IconButton>
                </Stack>
            ))}
            <Typography variant="caption" color="text.secondary">
                Included free during your trial; buy them from Billing when
                the trial converts.
            </Typography>
        </Box>
    );
}
