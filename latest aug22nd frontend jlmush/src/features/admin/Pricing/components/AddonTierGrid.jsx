/**
 * AddonTierGrid — the whole add-on catalogue priced in one place: one
 * table per buyer tier, one row per add-on, every commercial term
 * editable inline. This is the bulk-pricing surface; an add-on's
 * identity, features and limit deltas are still edited in its own
 * dialog (that is what makes a row appear here at all).
 *
 * Rows are GROUPED by what the add-on actually grants — read from its
 * limits rather than a hardcoded list — so a new add-on files itself
 * under the right heading the moment it is created.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, MenuItem, Paper, Select, Stack, Table,
    TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';

const TIERS = [
    ['main', 'Main tenant',
     'What the subscriber buys for their own tenant.'],
    ['subdomain_child', 'Subdomain child',
     'What an apex buys for a child on <slug>.<apex-domain>.'],
    ['custom_domain_child', 'Custom-domain child',
     'What an apex buys for a child on its own domain.'],
];

const CYCLES = [
    ['one_time', 'One-time'], ['monthly', 'Monthly'],
    ['quarterly', 'Quarterly'], ['semi_annual', 'Half-yearly'],
    ['annual', 'Yearly'], ['biennial', '2-yearly'], ['triennial', '3-yearly'],
];

const SEAT_KEYS = ['total', 'super_admin', 'sub_admin', 'provider'];
const ENTITY_KEYS = ['doctor', 'clinic', 'hospital'];
const TENANCY_KEYS = ['child_subdomain', 'child_custom_domain'];

const GROUPS = [
    ['seats', 'Team seats', "Counted against the tenant's seat limits."],
    ['entities', 'Provider entities',
     'Counted against the provider-entity quotas, not the team seats.'],
    ['tenancies', 'Child tenancies',
     'Extra workspaces a reseller may create, on top of what its plan '
     + 'includes. Only an apex can use these.'],
    ['other', 'Other add-ons',
     'Features and usage capacity — no seat, entity or tenancy grant.'],
];

const groupOf = (addon) => {
    const limits = addon.limits || {};
    const has = (keys) => keys.some((k) => Number(limits[k]) > 0);
    if (has(TENANCY_KEYS)) return 'tenancies';
    if (has(ENTITY_KEYS)) return 'entities';
    if (has(SEAT_KEYS)) return 'seats';
    return 'other';
};

const BLANK = {
    active: true, units: 1, price_inr: null, og_price_inr: null,
    min_qty: 1, max_qty: null, billing_cycle: 'monthly',
};

// The row's terms for one tier: an explicit tier, else the legacy
// scalars shown as a main-tier equivalent so nothing looks empty.
const readTier = (addon, tierKey) => {
    const t = (addon.tiers || {})[tierKey];
    if (t) return { ...BLANK, ...t };
    if (addon.tiers) return null;              // tiered, this one is off
    if (tierKey !== 'main') return null;
    return {
        ...BLANK,
        price_inr: addon.price_inr_monthly ?? null,
        og_price_inr: addon.og_price_inr_monthly ?? null,
    };
};

export default function AddonTierGrid({ addons = [], onSave, saving }) {
    // {code: tiers-object} for rows the operator has touched.
    const [draft, setDraft] = useState({});
    const [notice, setNotice] = useState(null);

    const rows = useMemo(
        () => addons.filter((a) => a.status !== 'archived'),
        [addons],
    );

    const tiersOf = (addon) => (draft[addon.code] !== undefined
        ? draft[addon.code]
        : (addon.tiers || null));

    const setTier = (addon, tierKey, patch) => {
        const current = tiersOf(addon) || {};
        const existing = current[tierKey] ?? readTier(addon, tierKey);
        const next = {
            ...current,
            [tierKey]: patch === null ? null : { ...BLANK, ...existing, ...patch },
        };
        setDraft((d) => ({ ...d, [addon.code]: next }));
    };

    const dirty = Object.keys(draft);

    const rowError = (t) => {
        if (!t) return null;
        if (!(Number(t.units) >= 1)) return 'Units must be 1 or more.';
        if (!(Number(t.min_qty) >= 1)) return 'Min must be 1 or more.';
        if (t.max_qty != null && t.max_qty !== ''
            && Number(t.max_qty) < Number(t.min_qty)) {
            return 'Max must be at least Min.';
        }
        if (t.price_inr != null && Number(t.price_inr) < 0) {
            return 'Price cannot be negative.';
        }
        return null;
    };

    const firstError = (() => {
        for (const code of dirty) {
            for (const [tierKey] of TIERS) {
                const err = rowError((draft[code] || {})[tierKey]);
                if (err) return `${code} · ${tierKey}: ${err}`;
            }
        }
        return null;
    })();

    const save = async () => {
        setNotice(null);
        try {
            await onSave(dirty.map((code) => ({ code, tiers: draft[code] })));
            setDraft({});
            setNotice({ severity: 'success',
                text: `Saved ${dirty.length} add-on(s).` });
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || 'Could not save.' });
        }
    };

    const numCell = (addon, tierKey, t, field, width = 78, min = 0) => (
        <TableCell align="center" sx={{ px: 0.5 }}>
            <TextField
                size="small" type="number"
                value={t[field] ?? ''}
                disabled={t.active === false}
                inputProps={{ min, style: { textAlign: 'right', padding: 6 } }}
                onChange={(e) => setTier(addon, tierKey, {
                    [field]: e.target.value === '' ? null
                        : Number(e.target.value),
                })}
                sx={{ width }}
            />
        </TableCell>
    );

    return (
        <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
                One table per tier. <b>Units</b> is how many seats or entities
                a single purchase grants, <b>Price</b> is what that purchase
                costs, and <b>Min</b>–<b>Max</b> are the purchase limits every
                plan enforces — a buyer cannot step below the min or past the
                max. Leave <b>Max</b> empty for no cap. Turning <b>On sale</b>
                off withdraws the add-on from that tier without losing its
                numbers. <b>Billing</b> sets how often it is charged —
                one-time (charged once, kept while the buyer stays active on
                the main plan), or recurring.
            </Alert>

            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 2 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}

            {TIERS.map(([tierKey, tierLabel, tierHint]) => (
                <Paper key={tierKey} variant="outlined"
                    sx={{ mb: 3, overflow: 'hidden' }}>
                    <Box sx={{ px: 2, pt: 1.5 }}>
                        <Typography variant="subtitle1"
                            sx={{ fontWeight: 700 }}>
                            {tierLabel}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {tierHint}
                        </Typography>
                    </Box>
                    <Box sx={{ overflowX: 'auto' }}>
                        <Table size="small" sx={{ minWidth: 780 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ minWidth: 220 }}>
                                        Add-on
                                    </TableCell>
                                    <TableCell align="center">On sale</TableCell>
                                    <TableCell align="center">Units</TableCell>
                                    <TableCell align="center">Price ₹</TableCell>
                                    <TableCell align="center">Min</TableCell>
                                    <TableCell align="center">Max</TableCell>
                                    <TableCell align="center">Billing</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {GROUPS.map(([gKey, gLabel, gNote]) => {
                                    const inGroup = rows.filter(
                                        (a) => groupOf(a) === gKey);
                                    if (inGroup.length === 0) return null;
                                    return [
                                        <TableRow key={`${gKey}-h`}>
                                            <TableCell colSpan={7} sx={{
                                                bgcolor: 'action.hover',
                                                py: 0.75,
                                            }}>
                                                <Typography variant="caption"
                                                    sx={{ fontWeight: 700,
                                                        letterSpacing: '.05em',
                                                        textTransform: 'uppercase' }}>
                                                    {gLabel}
                                                </Typography>
                                                <Typography variant="caption"
                                                    color="text.secondary"
                                                    sx={{ ml: 1 }}>
                                                    {gNote}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>,
                                        ...inGroup.map((addon) => {
                                            const tiers = tiersOf(addon);
                                            const t = tiers
                                                ? (tiers[tierKey] ?? null)
                                                : readTier(addon, tierKey);
                                            const on = Boolean(t
                                                && t.active !== false);
                                            const err = rowError(t);
                                            return (
                                                <TableRow key={`${gKey}-${addon.code}`}
                                                    hover>
                                                    <TableCell>
                                                        <Typography variant="body2"
                                                            sx={{ fontWeight: 600 }}>
                                                            {addon.name}
                                                        </Typography>
                                                        <Typography variant="caption"
                                                            color="text.secondary">
                                                            {addon.description
                                                                || addon.code}
                                                        </Typography>
                                                        {err && (
                                                            <Typography variant="caption"
                                                                color="error"
                                                                sx={{ display: 'block' }}>
                                                                {err}
                                                            </Typography>
                                                        )}
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Checkbox size="small"
                                                            checked={on}
                                                            onChange={(e) => setTier(
                                                                addon, tierKey,
                                                                e.target.checked
                                                                    ? { active: true }
                                                                    : null)}
                                                        />
                                                    </TableCell>
                                                    {on ? (
                                                        <>
                                                            {numCell(addon, tierKey, t, 'units', 72, 1)}
                                                            {numCell(addon, tierKey, t, 'price_inr', 96)}
                                                            {numCell(addon, tierKey, t, 'min_qty', 68, 1)}
                                                            {numCell(addon, tierKey, t, 'max_qty', 72)}
                                                            <TableCell align="center" sx={{ px: 0.5 }}>
                                                                <Select size="small"
                                                                    value={t.billing_cycle || 'monthly'}
                                                                    onChange={(e) => setTier(
                                                                        addon, tierKey,
                                                                        { billing_cycle: e.target.value })}
                                                                    sx={{ width: 132 }}
                                                                >
                                                                    {CYCLES.map(([v, l]) => (
                                                                        <MenuItem key={v} value={v}>
                                                                            {l}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                        </>
                                                    ) : (
                                                        <TableCell colSpan={5}
                                                            align="center">
                                                            <Typography variant="caption"
                                                                color="text.secondary"
                                                                sx={{ fontStyle: 'italic' }}>
                                                                not offered to this buyer
                                                            </Typography>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            );
                                        }),
                                    ];
                                })}
                            </TableBody>
                        </Table>
                    </Box>
                </Paper>
            ))}

            <Stack direction="row" spacing={2} alignItems="center"
                sx={{ position: 'sticky', bottom: 0, py: 1.5,
                    bgcolor: 'background.paper', borderTop: 1,
                    borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary"
                    sx={{ flex: 1 }}>
                    {firstError
                        ? firstError
                        : dirty.length
                            ? `${dirty.length} add-on(s) changed.`
                            : 'No changes yet.'}
                </Typography>
                <Button variant="contained"
                    disabled={saving || !dirty.length || Boolean(firstError)}
                    onClick={save}>
                    {saving ? 'Saving…' : 'Save add-ons'}
                </Button>
            </Stack>
        </Box>
    );
}
