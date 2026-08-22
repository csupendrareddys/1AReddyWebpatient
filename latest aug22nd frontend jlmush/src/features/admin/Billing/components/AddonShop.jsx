/**
 * AddonShop — self-serve add-on purchases on the Billing page.
 *
 * Lists the seller's active add-ons with their prices; seat add-ons
 * (those carrying limit deltas) get a quantity picker, so "2 extra
 * provider seats" is one purchase priced per seat per period. The
 * order → Razorpay checkout → verify loop is the same rail the
 * subscription renewal uses; free add-ons activate instantly.
 * Vendor-direct tenants only — a reseller's child sees the "arranged
 * through your provider" refusal from the backend.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, Divider, Paper, Stack, TextField,
    Typography,
} from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';

import { runRazorpayCheckout } from '../../../../utils/runRazorpayCheckout';
import {
    useCreateAddonOrderMutation,
    useListBuyableAddonsQuery,
    useVerifySubscriptionPaymentMutation,
} from '../../api/billingEndpoints';

const seatLabel = (limits, units = 1) => {
    const names = {
        total: 'users', super_admin: 'super admins',
        sub_admin: 'sub admins', provider: 'providers',
        doctor: 'doctor entities', clinic: 'clinic entities',
        hospital: 'hospital entities',
    };
    return Object.entries(limits || {})
        .filter(([k, v]) => names[k] && Number(v) > 0)
        .map(([k, v]) => `+${Number(v) * units} ${names[k]}`)
        .join(', ');
};

const CYCLE_SHORT = {
    one_time: ' once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

// The buyer-facing terms, resolved server-side per THIS tenant's plan
// (/pricing/my-addons). pick_period marks a legacy add-on where the
// buyer still chooses monthly/annual from the scalars.
const termsOf = (a) => {
    const t = a.terms;
    if (t && !a.pick_period) {
        return {
            unit: t.price_inr, cycle: t.billing_cycle,
            units: t.units || 1, min: t.min_qty || 1, max: t.max_qty,
            period: null,
        };
    }
    const period = a.price_inr_monthly != null ? 'monthly' : 'annual';
    return {
        unit: period === 'monthly' ? a.price_inr_monthly : a.price_inr_annual,
        cycle: period, units: 1, min: 1, max: null, period,
    };
};

const AddonShop = ({ onPurchased }) => {
    const { data: addons = [], isLoading } = useListBuyableAddonsQuery();
    const [createOrder] = useCreateAddonOrderMutation();
    const [verify] = useVerifySubscriptionPaymentMutation();
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);

    if (isLoading || addons.length === 0) return null;

    const buy = async (addon) => {
        const t = termsOf(addon);
        const quantity = Math.min(
            Math.max(Number(qty[addon.code] || t.min), t.min),
            t.max || 999,
        );
        // Legacy add-ons still need a period; tiered ones carry their
        // own cycle server-side and ignore it.
        const period = t.period || 'monthly';
        const unit = t.unit;
        setBusy(addon.code);
        setNotice(null);
        try {
            if (!unit || Number(unit) === 0) {
                const res = await createOrder(
                    { addon_code: addon.code, period, quantity }).unwrap();
                if (!res?.data?.no_payment_needed) {
                    throw new Error('Unexpected response for a free add-on.');
                }
            } else {
                await runRazorpayCheckout({
                    createOrder,
                    verify: (body) => verify(body),
                    createOrderArgs:
                        { addon_code: addon.code, period, quantity },
                    name: addon.name,
                    description: `${quantity} × ${addon.name}`,
                });
            }
            setNotice({ severity: 'success',
                text: `"${addon.name}" is now active on your workspace.` });
            onPurchased?.();
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || e?.message
                    || 'Purchase did not complete.' });
        } finally {
            setBusy(null);
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <ExtensionIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Add-ons
                </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Extend your plan — extra seats and features, active for the
                period you pay. Held while your plan is unpaid; lapsed
                add-ons must be purchased again.
            </Typography>
            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 1.5 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}
            <Stack divider={<Divider />} spacing={1.5}>
                {addons.map((a) => {
                    const t = termsOf(a);
                    const seats = seatLabel(a.limits, t.units);
                    const priceText = t.unit != null && Number(t.unit) > 0
                        ? `₹${Number(t.unit).toLocaleString('en-IN')}`
                          + (CYCLE_SHORT[t.cycle] || '')
                        : 'Free';
                    const boundsText = (t.min > 1 || t.max)
                        ? `buy ${t.min}–${t.max || '∞'}`
                        : null;
                    return (
                        <Stack
                            key={a.code}
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1.5}
                            alignItems={{ sm: 'center' }}
                        >
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {a.name}
                                    <Chip size="small" label={priceText} sx={{ ml: 1 }} />
                                    {seats && (
                                        <Chip size="small" variant="outlined"
                                            label={`${seats} each`} sx={{ ml: 0.5 }} />
                                    )}
                                    {boundsText && (
                                        <Chip size="small" variant="outlined"
                                            label={boundsText} sx={{ ml: 0.5 }} />
                                    )}
                                </Typography>
                                {a.description && (
                                    <Typography variant="caption" color="text.secondary">
                                        {a.description}
                                    </Typography>
                                )}
                            </Box>
                            {seats && (
                                <TextField
                                    size="small" type="number" label="Qty"
                                    inputProps={{ min: t.min, max: t.max || 999 }}
                                    value={qty[a.code] ?? t.min}
                                    onChange={(e) => setQty(
                                        { ...qty, [a.code]: e.target.value })}
                                    sx={{ width: 90 }}
                                />
                            )}
                            <Button
                                variant="outlined" size="small"
                                disabled={busy === a.code}
                                onClick={() => buy(a)}
                            >
                                {busy === a.code ? 'Processing…' : 'Buy'}
                            </Button>
                        </Stack>
                    );
                })}
            </Stack>
        </Paper>
    );
};

export default AddonShop;
