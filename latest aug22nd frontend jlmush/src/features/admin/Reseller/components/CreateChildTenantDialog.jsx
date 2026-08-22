/**
 * CreateChildTenantDialog — an apex reseller provisions a tenant:
 * name + slug (their public subdomain), one of the RESELLER'S OWN plans,
 * billing cycle, and the first admin's credentials (delivered by the
 * backend's "workspace is live" email/SMS).
 *
 * Error surfacing mirrors the vendor dialogs: 402 child_quota_exceeded
 * (with used/allowed), 409 slug conflicts, 422 field errors.
 */
import { useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, MenuItem, Stack, TextField, Typography,
} from '@mui/material';

import { useListPlansQuery } from '../../api/pricingEndpoints';
import {
    useCreateResellerTenantMutation, useGetResellerDnsQuery,
} from '../api/resellerEndpoints';

const EMPTY = {
    name: '', slug: '', plan_code: '', billing_cycle: 'monthly',
    admin: { email: '', password: '', first_name: '', last_name: '',
             phone_number: '' },
};

export default function CreateChildTenantDialog({ open, onClose, notify }) {
    const { data: myPlans = [] } = useListPlansQuery('reseller', { skip: !open });
    // Which zone the new tenant's address lives under: the apex's own
    // connected zone (P4) or the platform base domain.
    const { data: dns } = useGetResellerDnsQuery(undefined, { skip: !open });
    const childBase = dns?.effective_child_base
        || import.meta.env?.VITE_PUBLIC_BASE_DOMAIN || 'localhost';
    const [createTenant, { isLoading }] = useCreateResellerTenantMutation();
    const [form, setForm] = useState(EMPTY);
    const [error, setError] = useState(null);

    const activePlans = myPlans.filter((p) => p.status === 'active');
    const setAdmin = (patch) => setForm(
        { ...form, admin: { ...form.admin, ...patch } });

    const handleCreate = async () => {
        setError(null);
        try {
            const res = await createTenant(form).unwrap();
            notify?.('success',
                `Tenant "${res?.data?.tenant?.slug || form.slug}" created — `
                + 'the admin got their sign-in email.');
            setForm(EMPTY);
            onClose();
        } catch (err) {
            const body = err?.data || {};
            if (body.code === 'child_quota_exceeded') {
                setError(`No tenant slots left (${body.data?.used}/${body.data?.allowed}). `
                    + 'Upgrade your plan to add more.');
            } else if (body.errors) {
                setError(Object.entries(body.errors)
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                    .join('; '));
            } else {
                setError(body.error || 'Could not create the tenant.');
            }
        }
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>New tenant</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    <Stack direction="row" spacing={1}>
                        <TextField
                            label="Organisation name"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            fullWidth
                        />
                        <TextField
                            label="Subdomain (slug)"
                            helperText={form.slug
                                ? `${form.slug}.${childBase}`
                                : 'lowercase, letters/digits/hyphens'}
                            value={form.slug}
                            onChange={(e) => setForm({
                                ...form,
                                slug: e.target.value.toLowerCase().trim(),
                            })}
                            fullWidth
                        />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                        <TextField
                            select fullWidth label="Plan"
                            value={form.plan_code}
                            onChange={(e) => setForm({ ...form, plan_code: e.target.value })}
                            helperText={activePlans.length === 0
                                ? 'Create an ACTIVE plan under My SaaS Plans first'
                                : 'One of your own plans'}
                        >
                            {activePlans.map((p) => (
                                <MenuItem key={p.code} value={p.code}>
                                    {p.name} ({p.code})
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select label="Billing" sx={{ minWidth: 140 }}
                            value={form.billing_cycle}
                            onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
                        >
                            <MenuItem value="monthly">Monthly</MenuItem>
                            <MenuItem value="quarterly">Quarterly</MenuItem>
                            <MenuItem value="semi_annual">Semi-annual</MenuItem>
                            <MenuItem value="annual">Annual</MenuItem>
                            <MenuItem value="biennial">2-yearly</MenuItem>
                            <MenuItem value="triennial">3-yearly</MenuItem>
                        </TextField>
                    </Stack>

                    <Divider>
                        <Typography variant="caption" color="text.secondary">
                            First administrator
                        </Typography>
                    </Divider>
                    <Stack direction="row" spacing={1}>
                        <TextField label="First name" fullWidth
                                   value={form.admin.first_name}
                                   onChange={(e) => setAdmin({ first_name: e.target.value })} />
                        <TextField label="Last name" fullWidth
                                   value={form.admin.last_name}
                                   onChange={(e) => setAdmin({ last_name: e.target.value })} />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                        <TextField label="Email" type="email" fullWidth
                                   value={form.admin.email}
                                   onChange={(e) => setAdmin({ email: e.target.value })} />
                        <TextField label="Phone" fullWidth
                                   value={form.admin.phone_number}
                                   onChange={(e) => setAdmin({ phone_number: e.target.value })} />
                    </Stack>
                    <TextField
                        label="Temporary password" type="password" fullWidth
                        helperText="They sign in with this at their new subdomain"
                        value={form.admin.password}
                        onChange={(e) => setAdmin({ password: e.target.value })}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleCreate}
                    disabled={isLoading || !form.name || !form.slug
                        || !form.plan_code || !form.admin.email
                        || !form.admin.password || !form.admin.first_name}
                >
                    Create tenant
                </Button>
            </DialogActions>
        </Dialog>
    );
}
