import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
    Link, Paper, Stack, TextField, Typography,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import usePrimedQuery from '../../../../common/hooks/usePrimedQuery';
import {
    useGetTenantDomainQuery,
    useSetMyDomainMutation,
    useVerifyMyDomainMutation,
    useCheckMyDomainCnameMutation,
    useClearMyDomainMutation,
} from '../../api/tenantDomainEndpoints';
import DnsRecordsTable from '../components/DnsRecordsTable';

const STATUS_COLOR = {
    verified: 'success',
    active: 'success',
    pending: 'warning',
    pending_validation: 'warning',
    pending_issuance: 'warning',
    failed: 'error',
    revoked: 'error',
    disabled: 'default',
};

const chipFor = (value, fallback = 'not set') => (
    <Chip
        size="small"
        label={value || fallback}
        color={STATUS_COLOR[value] || 'default'}
        variant={value ? 'filled' : 'outlined'}
    />
);

/**
 * A tenant manages its OWN domain here.
 *
 * This used to be impossible: the domain endpoints were PLATFORM_OWNER-only,
 * so a customer wanting their own domain had to ask the vendor and then had
 * no way to watch it progress. Custom domains are plan-gated, so a tenant
 * without the entitlement still sees its subdomain status and is told what
 * would unlock the rest, rather than being shown a control that 403s.
 */
export default function DomainSettings() {
    const q = useGetTenantDomainQuery();
    const { data, settled, reprime } = usePrimedQuery(q);

    const [setDomain, setDomainState] = useSetMyDomainMutation();
    const [verifyDomain, verifyState] = useVerifyMyDomainMutation();
    const [checkCname, checkState] = useCheckMyDomainCnameMutation();
    // Last routing-probe result — {matches, reason, resolved_chain}.
    const [cnameProbe, setCnameProbe] = useState(null);

    const onCheckCname = async () => {
        setNotice(null);
        try {
            const res = await checkCname().unwrap();
            const report = res?.data || res;
            setCnameProbe(report);
            setNotice({
                severity: report?.matches ? 'success' : 'warning',
                text: report?.matches
                    ? 'Your domain points at us — routing looks good.'
                    : (report?.reason
                        || 'The routing record does not point at us yet.'),
            });
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || 'Could not check the record.' });
        }
    };
    const [clearDomain, clearState] = useClearMyDomainMutation();

    const [draft, setDraft] = useState('');
    const [confirmRelease, setConfirmRelease] = useState(false);
    const [notice, setNotice] = useState(null);

    if (!settled) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!data) {
        return (
            <Container maxWidth="md" sx={{ mt: 4 }}>
                <Alert severity="error">Unable to load domain settings.</Alert>
            </Container>
        );
    }

    const { subdomain, custom_domain: custom, records_to_publish: records,
        live_url: liveUrl, can_set_custom_domain: canSetCustom } = data;
    const busy = setDomainState.isLoading || verifyState.isLoading
        || clearState.isLoading;
    const verified = custom?.verification_status === 'verified';

    const errText = (e) => e?.data?.error || e?.data?.message
        || 'Something went wrong. Please try again.';

    const onSet = async () => {
        setNotice(null);
        try {
            await setDomain(draft.trim()).unwrap();
            reprime();
            setDraft('');
            setNotice({
                severity: 'info',
                text: 'Domain claimed. Publish the record below, then verify.',
            });
        } catch (e) {
            setNotice({ severity: 'error', text: errText(e) });
        }
    };

    const onVerify = async () => {
        setNotice(null);
        try {
            const res = await verifyDomain().unwrap();
            reprime();
            const ok = res?.result?.verified;
            setNotice({
                severity: ok ? 'success' : 'warning',
                text: ok
                    ? 'Verified. Your domain is being routed now.'
                    : 'We could not find the record yet. DNS can take a while '
                      + '— leave it published and try again shortly.',
            });
        } catch (e) {
            setNotice({ severity: 'error', text: errText(e) });
        }
    };

    const onRelease = async () => {
        setConfirmRelease(false);
        setNotice(null);
        try {
            await clearDomain().unwrap();
            reprime();
            setNotice({
                severity: 'info',
                text: 'Custom domain released. Your subdomain still works.',
            });
        } catch (e) {
            setNotice({ severity: 'error', text: errText(e) });
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
                <LanguageIcon color="primary" />
                <Typography variant="h5">Domain</Typography>
            </Stack>

            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 3 }}>{notice.text}</Alert>
            )}

            {/* ── Always-on subdomain ───────────────────────────── */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" gutterBottom>Your portal address</Typography>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }} spacing={2}
                    alignItems={{ sm: 'center' }}
                >
                    <Box component="code" sx={{ fontSize: '1rem' }}>
                        {subdomain?.fqdn || subdomain?.slug}
                    </Box>
                    {chipFor(subdomain?.status)}
                    {liveUrl && (
                        <Link
                            href={liveUrl} target="_blank" rel="noreferrer"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                        >
                            Open <OpenInNewIcon fontSize="inherit" />
                        </Link>
                    )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    This address is included with your plan and always works.
                    A custom domain is an addition to it, not a replacement.
                </Typography>
            </Paper>

            {/* ── Custom domain ─────────────────────────────────── */}
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Your own domain</Typography>

                {!canSetCustom && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Custom domains aren&apos;t included in your current plan.
                        Everything above keeps working — talk to us about
                        upgrading if you&apos;d like to use your own domain.
                    </Alert>
                )}

                {custom?.domain ? (
                    <>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }} spacing={2}
                            alignItems={{ sm: 'center' }} sx={{ mb: 2 }}
                        >
                            <Box component="code" sx={{ fontSize: '1rem' }}>
                                {custom.domain}
                            </Box>
                            {chipFor(custom.verification_status, 'pending')}
                            {custom.ssl_status && (
                                <Chip
                                    size="small" variant="outlined"
                                    label={`TLS: ${custom.ssl_status}`}
                                    color={STATUS_COLOR[custom.ssl_status] || 'default'}
                                />
                            )}
                        </Stack>

                        {custom.has_provisioning_issue && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                We hit a problem finishing the setup on our
                                side. Your records below are still correct
                                &mdash; we&apos;re looking into it, and your
                                portal address keeps working meanwhile.
                            </Alert>
                        )}

                        {/* Shown even after verification: the routing CNAME must stay
                            published forever, and the list is the tenant's only
                            reference for it. */}
                        <DnsRecordsTable records={records} />

                        {cnameProbe && !cnameProbe.matches
                            && cnameProbe.resolved_chain?.length > 0 && (
                            <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', mt: 1 }}>
                                Currently resolving to:{' '}
                                <code>
                                    {cnameProbe.resolved_chain
                                        .map((h) => (Array.isArray(h.target)
                                            ? h.target.join(', ') : h.target))
                                        .join(' → ')}
                                </code>
                            </Typography>
                        )}

                        <Divider sx={{ my: 3 }} />
                        <Stack direction="row" spacing={2}>
                            <Button
                                variant="outlined" onClick={onCheckCname}
                                disabled={busy || checkState.isLoading}
                            >
                                {checkState.isLoading
                                    ? 'Checking…' : 'Check record'}
                            </Button>
                            {!verified && canSetCustom && (
                                <Button
                                    variant="contained" onClick={onVerify}
                                    disabled={busy}
                                >
                                    {verifyState.isLoading
                                        ? 'Checking…' : 'Check now'}
                                </Button>
                            )}
                            <Button
                                color="error" variant="outlined" disabled={busy}
                                onClick={() => setConfirmRelease(true)}
                            >
                                Release domain
                            </Button>
                        </Stack>
                    </>
                ) : (
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                            Point a domain you already own at your portal.
                            We&apos;ll give you a record to publish, then check it.
                        </Typography>
                        <TextField
                            label="Domain"
                            placeholder="clinic.example.com"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value.toLowerCase())}
                            disabled={!canSetCustom || busy}
                            fullWidth
                            helperText="Without www — add that as a redirect at your DNS provider."
                        />
                        <Box>
                            <Button
                                variant="contained" onClick={onSet}
                                disabled={!canSetCustom || busy || !draft.trim()}
                            >
                                {setDomainState.isLoading ? 'Saving…' : 'Add domain'}
                            </Button>
                        </Box>
                    </Stack>
                )}
            </Paper>

            <Dialog open={confirmRelease} onClose={() => setConfirmRelease(false)}>
                <DialogTitle>Release this domain?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {custom?.domain} will stop routing to your portal, and
                        anyone visiting it will no longer reach you. Your
                        subdomain keeps working, so your portal stays online.
                        You can add the domain again later.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmRelease(false)}>Cancel</Button>
                    <Button color="error" onClick={onRelease}>Release</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
