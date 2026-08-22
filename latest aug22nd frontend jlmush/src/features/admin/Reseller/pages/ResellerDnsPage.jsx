/**
 * ResellerDnsPage — "My DNS Zone": the apex reseller connects its OWN
 * Cloudflare zone so its child tenants live at <child>.<their-zone>
 * instead of the platform's base domain.
 *
 * Same write-only-secret contract as the Payments & SMS page: the API
 * token is never echoed back; leaving the field empty keeps the stored
 * one, typing rotates it. The whole page primes its query imperatively
 * (RTK selector wedge) like the reseller tenants page's siblings.
 */
import { useEffect, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, Container, Divider,
    FormControlLabel, Stack, Switch, TextField, Typography,
} from '@mui/material';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useGetResellerDnsQuery, useSaveResellerDnsMutation,
    useTestResellerDnsMutation, useDisconnectResellerDnsMutation,
} from '../api/resellerEndpoints';

const EMPTY_FORM = {
    base_domain: '', zone_id: '', api_token: '', ingress_target: '',
    proxied: false,
};

export default function ResellerDnsPage() {
    const dispatch = useDispatch();
    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    const q = useGetResellerDnsQuery();
    const { refetch } = q;
    const [primed, setPrimed] = useState(null);
    const reprime = () => {
        Promise.resolve(refetch())
            .then((r) => (r && typeof r.unwrap === 'function' ? r.unwrap() : r))
            .then((d) => setPrimed(d || null))
            .catch(() => {});
    };
    useEffect(() => { reprime(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
    const dns = q.data ?? primed;

    const [saveDns, { isLoading: saving }] = useSaveResellerDnsMutation();
    const [testDns, { isLoading: testing }] = useTestResellerDnsMutation();
    const [disconnectDns] = useDisconnectResellerDnsMutation();

    const [form, setForm] = useState(EMPTY_FORM);
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        if (hydrated || !dns) return;
        const cfg = dns.config;
        if (cfg) {
            setForm({
                base_domain: cfg.base_domain || '',
                zone_id: cfg.zone_id || '',
                api_token: '',        // write-only — empty means "keep"
                ingress_target: cfg.ingress_target || '',
                proxied: !!cfg.proxied,
            });
        }
        setHydrated(true);
    }, [dns, hydrated]);

    const err403 = q.error?.status === 403;
    if (err403) {
        return (
            <Container maxWidth="md" sx={{ py: 6 }}>
                <Alert severity="info">
                    Reselling isn&apos;t included in your plan.
                </Alert>
            </Container>
        );
    }

    const cfg = dns?.config;
    const ready = !!dns?.ready;
    const zones = dns?.children_zones || { apex_zone: [], platform_zone: [] };

    const handleSave = async () => {
        try {
            const payload = {
                base_domain: form.base_domain.trim().toLowerCase(),
                zone_id: form.zone_id.trim(),
                ingress_target: form.ingress_target.trim() || null,
                proxied: form.proxied,
            };
            // Write-only token: only send when the operator typed one.
            if (form.api_token) payload.api_token = form.api_token;
            await saveDns(payload).unwrap();
            setForm((f) => ({ ...f, api_token: '' }));
            notify('success', 'DNS settings saved');
            reprime();
        } catch (err) {
            const body = err?.data || {};
            const fieldErrs = body.errors
                ? Object.entries(body.errors)
                    .map(([k, v]) => `${k}: ${v}`).join('; ')
                : null;
            notify('error', fieldErrs || body.error || 'Save failed');
        }
    };

    const handleTest = async () => {
        try {
            const res = await testDns().unwrap();
            notify('success', res?.message || 'Zone connected');
            reprime();
        } catch (err) {
            notify('error', err?.data?.error || 'Connection test failed');
        }
    };

    const handleDisconnect = async () => {
        try {
            await disconnectDns().unwrap();
            notify('success', 'Zone disconnected — children fall back to '
                + 'the platform domain for NEW provisioning.');
            reprime();
        } catch (err) {
            notify('error', err?.data?.error || 'Disconnect failed');
        }
    };

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
                <Typography variant="h4">My DNS Zone</Typography>
                {cfg && (
                    <Chip
                        size="small"
                        icon={ready ? <CloudDoneIcon /> : <CloudOffIcon />}
                        color={ready ? 'success' : 'default'}
                        label={ready
                            ? (cfg.verified_at ? 'Connected · verified' : 'Connected')
                            : 'Not connected'}
                    />
                )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Bring your own Cloudflare zone and your tenants get addresses
                under <b>your</b> domain
                {form.base_domain ? <> (e.g. <code>clinic.{form.base_domain}</code>)</> : null}
                &nbsp;instead of the platform&apos;s. You need a Cloudflare API
                token scoped to <i>Zone → DNS → Edit</i> for that zone only.
            </Typography>

            <Card variant="outlined" sx={{ mb: 3 }}>
                <CardContent>
                    <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                                label="Zone apex (base domain)" fullWidth
                                placeholder="example.in"
                                value={form.base_domain}
                                onChange={(e) => setForm({ ...form, base_domain: e.target.value })}
                                helperText="Tenants live at <name>.<this domain>"
                            />
                            <TextField
                                label="Cloudflare zone ID" fullWidth
                                value={form.zone_id}
                                onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
                                helperText="Cloudflare dashboard → your zone → Overview"
                            />
                        </Stack>
                        <TextField
                            label="API token" type="password" fullWidth
                            value={form.api_token}
                            onChange={(e) => setForm({ ...form, api_token: e.target.value })}
                            placeholder={cfg?.has_api_token ? '•••••••• (stored — type to replace)' : ''}
                            helperText={cfg?.has_api_token
                                ? 'A token is stored. Leave empty to keep it.'
                                : 'Zone:DNS:Edit scope only — never shown again after saving.'}
                        />
                        <Divider>
                            <Typography variant="caption" color="text.secondary">
                                Advanced
                            </Typography>
                        </Divider>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
                               alignItems={{ sm: 'center' }}>
                            <TextField
                                label="Ingress target (optional)" fullWidth
                                value={form.ingress_target}
                                onChange={(e) => setForm({ ...form, ingress_target: e.target.value })}
                                helperText="Where records point. Leave empty to use the platform edge."
                            />
                            <FormControlLabel
                                control={(
                                    <Switch
                                        checked={form.proxied}
                                        onChange={(e) => setForm({ ...form, proxied: e.target.checked })}
                                    />
                                )}
                                label="Proxied (orange cloud)"
                                sx={{ whiteSpace: 'nowrap' }}
                            />
                        </Stack>
                        <Stack direction="row" spacing={1}>
                            <Button
                                variant="contained" onClick={handleSave}
                                disabled={saving || !form.base_domain || !form.zone_id
                                    || (!form.api_token && !cfg?.has_api_token)}
                            >
                                Save
                            </Button>
                            <Button
                                variant="outlined" onClick={handleTest}
                                disabled={testing || !ready}
                            >
                                Test connection
                            </Button>
                            {cfg?.is_active && (
                                <Button color="error" onClick={handleDisconnect}>
                                    Disconnect
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            {dns && (
                <Card variant="outlined">
                    <CardContent>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                            Where your tenants live
                        </Typography>
                        {zones.apex_zone.length > 0 && (
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="body2" fontWeight={600}>
                                    On your zone ({cfg?.base_domain}):
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {zones.apex_zone.join(', ')}
                                </Typography>
                            </Box>
                        )}
                        {zones.platform_zone.length > 0 && (
                            <Box>
                                <Typography variant="body2" fontWeight={600}>
                                    On the platform domain
                                    {dns.platform_base_domain ? ` (${dns.platform_base_domain})` : ''}:
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {zones.platform_zone.join(', ')}
                                </Typography>
                                {ready && (
                                    <Alert severity="info" sx={{ mt: 1.5 }}>
                                        These tenants were created before the zone was
                                        connected. Ask your platform operator to run the
                                        zone migration to move them — their current
                                        addresses keep working until then.
                                    </Alert>
                                )}
                            </Box>
                        )}
                        {zones.apex_zone.length === 0
                            && zones.platform_zone.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                No tenants yet — newly created ones will use
                                {ready ? ` ${cfg?.base_domain}` : ' the platform domain'}.
                            </Typography>
                        )}
                    </CardContent>
                </Card>
            )}
        </Container>
    );
}
