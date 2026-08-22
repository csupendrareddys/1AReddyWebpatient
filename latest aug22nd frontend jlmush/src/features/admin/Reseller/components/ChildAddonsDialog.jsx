/**
 * ChildAddonsDialog — the apex buys vendor add-ons FOR one child at
 * that child's tier price (subdomain vs custom-domain), and sees what
 * the child already holds. The vendor charges the apex on the vendor
 * rail; free terms activate instantly.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle,
    Divider, Stack, TextField, Typography,
} from '@mui/material';

import { runRazorpayCheckout } from '../../../../utils/runRazorpayCheckout';
import { useVerifySubscriptionPaymentMutation } from
    '../../api/billingEndpoints';
import {
    useCreateResellerChildAddonOrderMutation,
    useGetResellerChildAddonsQuery,
    useListResellerAddonCatalogueQuery,
} from '../api/resellerEndpoints';

const CYCLE_SHORT = {
    one_time: ' once', monthly: '/mo', quarterly: '/qtr',
    semi_annual: '/half-yr', annual: '/yr', biennial: '/2yr',
    triennial: '/3yr',
};

const GRANT_NAMES = {
    total: 'users', super_admin: 'super admins', sub_admin: 'sub admins',
    provider: 'providers', doctor: 'doctor entities',
    clinic: 'clinic entities', hospital: 'hospital entities',
};

const grantLabel = (limits, units = 1) => Object.entries(limits || {})
    .filter(([k, v]) => GRANT_NAMES[k] && Number(v) > 0)
    .map(([k, v]) => `+${Number(v) * units} ${GRANT_NAMES[k]}`)
    .join(', ');

export default function ChildAddonsDialog({ child, onClose }) {
    const open = Boolean(child);
    const { data: catalogue = [] } =
        useListResellerAddonCatalogueQuery(undefined, { skip: !open });
    const { data: current, refetch } =
        useGetResellerChildAddonsQuery(child?.id, { skip: !open });
    const [createOrder] = useCreateResellerChildAddonOrderMutation();
    const [verify] = useVerifySubscriptionPaymentMutation();
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);

    if (!open) return null;
    const tierKey = current?.tier_key || 'subdomain_child';
    const held = current?.addons || [];

    const buy = async (a, t) => {
        const quantity = Math.min(
            Math.max(Number(qty[a.code] || t.min_qty || 1), t.min_qty || 1),
            t.max_qty || 999,
        );
        setBusy(a.code);
        setNotice(null);
        try {
            if (!t.price_inr || Number(t.price_inr) === 0) {
                const res = await createOrder({
                    childId: child.id, addon_code: a.code, quantity,
                }).unwrap();
                if (!res?.data?.no_payment_needed) {
                    throw new Error('Unexpected response for a free add-on.');
                }
            } else {
                await runRazorpayCheckout({
                    createOrder: (args) => createOrder(args),
                    verify: (body) => verify(body),
                    createOrderArgs: {
                        childId: child.id, addon_code: a.code, quantity,
                    },
                    name: a.name,
                    description: `${quantity} × ${a.name} for ${child.name}`,
                });
            }
            setNotice({ severity: 'success',
                text: `"${a.name}" is now active on ${child.name}.` });
            refetch();
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || e?.message
                    || 'Purchase did not complete.' });
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Add-ons for {child.name}
                <Typography variant="caption" color="text.secondary"
                    sx={{ display: 'block' }}>
                    Priced at the {tierKey === 'custom_domain_child'
                        ? 'custom-domain' : 'subdomain'} child tier — you
                    pay your provider; the grant lands on this tenant.
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                {notice && (
                    <Alert severity={notice.severity} sx={{ mb: 1.5 }}
                        onClose={() => setNotice(null)}>
                        {notice.text}
                    </Alert>
                )}
                {held.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            Currently active
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap"
                            useFlexGap>
                            {held.map((r) => (
                                <Chip key={r.id} size="small" variant="outlined"
                                    label={`${r.addon_code} ×${r.quantity}`
                                        + `${r.current_period_end
                                            ? '' : ' (one-time)'}`}
                                    color={r.status === 'active'
                                        ? 'success' : 'default'} />
                            ))}
                        </Stack>
                    </Box>
                )}
                <Stack divider={<Divider />} spacing={1.5}>
                    {catalogue.map((a) => {
                        const t = a[tierKey];
                        if (!t) return null;
                        const grants = grantLabel(a.limits, t.units);
                        const priceText = t.price_inr && Number(t.price_inr) > 0
                            ? `₹${Number(t.price_inr).toLocaleString('en-IN')}`
                              + (CYCLE_SHORT[t.billing_cycle] || '')
                            : 'Free';
                        return (
                            <Stack key={a.code}
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={1.5} alignItems={{ sm: 'center' }}>
                                <Box sx={{ flex: 1 }}>
                                    <Typography variant="body2"
                                        sx={{ fontWeight: 600 }}>
                                        {a.name}
                                        <Chip size="small" label={priceText}
                                            sx={{ ml: 1 }} />
                                        {grants && (
                                            <Chip size="small" variant="outlined"
                                                label={`${grants} each`}
                                                sx={{ ml: 0.5 }} />
                                        )}
                                        {(t.min_qty > 1 || t.max_qty) && (
                                            <Chip size="small" variant="outlined"
                                                label={`buy ${t.min_qty || 1}–${t.max_qty ?? '∞'}`}
                                                sx={{ ml: 0.5 }} />
                                        )}
                                    </Typography>
                                    {a.description && (
                                        <Typography variant="caption"
                                            color="text.secondary">
                                            {a.description}
                                        </Typography>
                                    )}
                                </Box>
                                <TextField
                                    size="small" type="number" label="Qty"
                                    inputProps={{ min: t.min_qty || 1,
                                        max: t.max_qty || 999 }}
                                    value={qty[a.code] ?? (t.min_qty || 1)}
                                    onChange={(e) => setQty(
                                        { ...qty, [a.code]: e.target.value })}
                                    sx={{ width: 90 }}
                                />
                                <Button variant="outlined" size="small"
                                    disabled={busy === a.code}
                                    onClick={() => buy(a, t)}>
                                    {busy === a.code ? 'Processing…' : 'Buy'}
                                </Button>
                            </Stack>
                        );
                    })}
                    {catalogue.every((a) => !a[tierKey]) && (
                        <Typography variant="body2" color="text.secondary">
                            Your provider doesn&apos;t sell any add-ons for
                            this kind of tenant yet.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
        </Dialog>
    );
}
