/**
 * Read-only add-on catalogue summary on the plan dialog — the mock's
 * per-tier table: each cell shows price·billing, then the min–max
 * purchase range. Edited in the Add-ons page; this is a reference so
 * the operator prices the plan with the catalogue in view.
 */
import {
    Box, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';

const TIERS = [
    ['main', 'Main tenant'],
    ['subdomain_child', 'Subdomain child'],
    ['custom_domain_child', 'Custom-domain child'],
];

const SHORT = {
    one_time: 'once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

const cell = (addon, tierKey) => {
    const tiers = addon.tiers;
    if (!tiers) {
        if (tierKey !== 'main') return '—';
        const m = addon.price_inr_monthly;
        const a = addon.price_inr_annual;
        if (m == null && a == null) return 'Free';
        return m != null ? `₹${m}/mo` : `₹${a}/yr`;
    }
    const t = tiers[tierKey];
    if (!t || t.active === false) return '—';
    const price = t.price_inr == null || Number(t.price_inr) === 0
        ? 'Free' : `₹${t.price_inr}${SHORT[t.billing_cycle] || ''}`;
    const range = `${t.min_qty || 1}–${t.max_qty ?? '∞'}`;
    const units = (t.units || 1) > 1 ? ` ×${t.units}` : '';
    return `${price}${units} · buy ${range}`;
};

export default function AddonCatalogueSummary({ addons = [] }) {
    const active = addons.filter((a) => a.status === 'active');
    if (active.length === 0) return null;
    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Add-on catalogue (read-only)
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                Prices, purchase ranges and billing are set in the Add-ons
                page; buyers on this plan shop from these terms.
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Add-on</TableCell>
                            {TIERS.map(([k, label]) => (
                                <TableCell key={k}>{label}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {active.map((a) => (
                            <TableRow key={a.code}>
                                <TableCell sx={{ fontWeight: 600 }}>
                                    {a.name}
                                </TableCell>
                                {TIERS.map(([k]) => (
                                    <TableCell key={k}>{cell(a, k)}</TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
        </Box>
    );
}
