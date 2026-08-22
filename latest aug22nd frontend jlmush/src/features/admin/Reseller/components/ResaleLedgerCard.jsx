/**
 * ResaleLedgerCard — cost vs sell vs margin for every add-on the apex
 * resells, one row per (child plan, offer), with how many units its
 * children currently hold. Read-only; prices are edited on the plan.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell,
    TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';

import { runRazorpayCheckout } from '../../../../utils/runRazorpayCheckout';
import { useVerifySubscriptionPaymentMutation } from
    '../../api/billingEndpoints';
import {
    useBuyResaleStockMutation, useGetResaleLedgerQuery,
} from '../api/resellerEndpoints';

const SHORT = {
    one_time: ' once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

const inr = (v) => (v == null ? '—'
    : `₹${Number(v).toLocaleString('en-IN')}`);

export default function ResaleLedgerCard() {
    const { data: rows = [], refetch } = useGetResaleLedgerQuery();
    const [buyStock, { isLoading: buying }] = useBuyResaleStockMutation();
    const [verify] = useVerifySubscriptionPaymentMutation();
    const [dialog, setDialog] = useState(null);   // the row being stocked
    const [qty, setQty] = useState(1);
    const [tier, setTier] = useState('subdomain_child');
    const [notice, setNotice] = useState(null);

    const purchase = async () => {
        setNotice(null);
        const args = {
            addon_code: dialog.addon_code, quantity: Number(qty) || 1, tier,
        };
        try {
            const probe = await buyStock(args).unwrap();
            if (!probe?.data?.no_payment_needed) {
                // Paid stock: the first call already created the order,
                // so hand that same response to the checkout.
                await runRazorpayCheckout({
                    // The order already exists from the call above —
                    // hand it straight back (wrapped the way the helper
                    // expects) so we never create a second one.
                    createOrder: () => ({ unwrap: async () => probe }),
                    verify: (body) => verify(body),
                    createOrderArgs: args,
                    name: dialog.addon_name,
                    description: `${args.quantity} × ${dialog.addon_name} (stock)`,
                });
            }
            setNotice({ severity: 'success',
                text: `Added ${args.quantity} unit(s) of `
                    + `${dialog.addon_name} to your stock.` });
            setDialog(null);
            refetch();
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || e?.message || 'Could not buy stock.' });
        }
    };

    if (rows.length === 0) return null;
    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                Resale ledger
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                What you pay your provider vs what your tenants pay you,
                per offer. Margin is per unit, per billing cycle.
                <b> Stock</b> is what you have bought from your provider
                to sell on. <b>Available</b> is how much of it nobody has
                taken yet — your tenants can only buy while some is left,
                so top up before it reaches zero.
            </Typography>
            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 1.5 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}
            <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Plan</TableCell>
                            <TableCell>Add-on</TableCell>
                            <TableCell align="right">You pay</TableCell>
                            <TableCell align="right">You charge</TableCell>
                            <TableCell align="right">Margin / unit</TableCell>
                            <TableCell align="right">Held by tenants</TableCell>
                            <TableCell align="center">Stock available</TableCell>
                            <TableCell align="right" />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((r) => (
                            <TableRow key={`${r.plan_code}:${r.addon_code}`}>
                                <TableCell>{r.plan_name}</TableCell>
                                <TableCell>{r.addon_name}</TableCell>
                                <TableCell align="right">
                                    {inr(r.cost_subdomain)}
                                    {r.cost_custom_domain != null
                                        && r.cost_custom_domain
                                            !== r.cost_subdomain
                                        && ` / ${inr(r.cost_custom_domain)}`}
                                </TableCell>
                                <TableCell align="right">
                                    {inr(r.you_charge)}
                                    {SHORT[r.billing_cycle] || ''}
                                </TableCell>
                                <TableCell align="right" sx={{
                                    color: r.margin_per_unit == null ? 'inherit'
                                        : r.margin_per_unit >= 0
                                            ? 'success.main' : 'error.main',
                                    fontWeight: 600,
                                }}>
                                    {r.margin_per_unit == null ? '—'
                                        : inr(r.margin_per_unit)}
                                </TableCell>
                                <TableCell align="right">
                                    {r.units_held_by_children}
                                </TableCell>
                                <TableCell align="center">
                                    <Tooltip title={`${r.stock_bought ?? 0} bought `
                                        + `· ${r.stock_allocated ?? 0} taken by `
                                        + 'your tenants'}>
                                        <Chip
                                            size="small"
                                            label={`${r.stock_free ?? 0} available`}
                                            color={(r.stock_free ?? 0) > 0
                                                ? 'success' : 'error'}
                                            variant={(r.stock_free ?? 0) > 0
                                                ? 'outlined' : 'filled'}
                                        />
                                    </Tooltip>
                                </TableCell>
                                <TableCell align="right">
                                    <Button size="small"
                                        onClick={() => {
                                            setDialog(r); setQty(1);
                                            setTier('subdomain_child');
                                        }}>
                                        Buy stock
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>

            <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)}
                fullWidth maxWidth="xs">
                <DialogTitle>Buy stock — {dialog?.addon_name}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                            You buy these units from your provider and sell
                            them on. Your tenants can only purchase while
                            some are still available.
                        </Typography>
                        <TextField
                            select size="small" label="Price tier" value={tier}
                            onChange={(e) => setTier(e.target.value)}
                            helperText="Which of your provider's child prices
                                this stock is bought at."
                        >
                            <MenuItem value="subdomain_child">
                                Subdomain child
                                {dialog?.cost_subdomain != null
                                    && ` — ₹${dialog.cost_subdomain}`}
                            </MenuItem>
                            <MenuItem value="custom_domain_child">
                                Custom-domain child
                                {dialog?.cost_custom_domain != null
                                    && ` — ₹${dialog.cost_custom_domain}`}
                            </MenuItem>
                        </TextField>
                        <TextField
                            type="number" size="small" label="Units"
                            value={qty} inputProps={{ min: 1, max: 999 }}
                            onChange={(e) => setQty(e.target.value)}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                    <Button variant="contained" disabled={buying}
                        onClick={purchase}>
                        {buying ? 'Buying…' : 'Buy stock'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
