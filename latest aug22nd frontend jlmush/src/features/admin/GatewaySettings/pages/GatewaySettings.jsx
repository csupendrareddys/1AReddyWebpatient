/**
 * GatewaySettings — the tenant connects its OWN money + messaging accounts.
 *
 *   * Razorpay (collection): patient payments settle into the tenant's own
 *     Razorpay account. There is NO platform fallback — until keys are
 *     saved here, every online checkout on this tenant is refused, so this
 *     page is part of go-live, not an optional extra.
 *   * Cashfree Payouts (disbursal): doctor payouts leave from the tenant's
 *     own Cashfree account; unconfigured tenants settle manually.
 *   * SMS / DLT: plan-gated switch from the vendor's shared DLT templates
 *     to the tenant's own DLT registration (their sender header, their
 *     approved bodies).
 *
 * Role-gated (SUPER_ADMIN), deliberately NOT feature-gated — a suspended
 * tenant must still be able to reach billing + gateway pages.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
    IconButton, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SmsIcon from '@mui/icons-material/Sms';

import usePrimedQuery from '../../../../common/hooks/usePrimedQuery';
import EmailSettingsCard from '../components/EmailSettingsCard';
import {
    useGetGatewayConfigQuery,
    useSaveGatewayConfigMutation,
    useTestGatewayRailMutation,
    useDisableGatewayMutation,
    useGetSmsConfigQuery,
    useSaveSmsConfigMutation,
    useDisableSmsConfigMutation,
} from '../../api/gatewayEndpoints';

const errText = (e) => e?.data?.error || e?.data?.message
    || 'Something went wrong. Please try again.';

function CopyField({ label, value }) {
    const [copied, setCopied] = useState(false);
    if (!value) return null;
    return (
        <Stack direction="row" spacing={1} alignItems="center">
            <TextField fullWidth size="small" label={label} value={value}
                InputProps={{ readOnly: true }} />
            <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                <IconButton size="small" onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(value);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    } catch { /* clipboard unavailable */ }
                }}>
                    <ContentCopyIcon fontSize="small" />
                </IconButton>
            </Tooltip>
        </Stack>
    );
}

const readyChip = (ready, verifiedAt) => (
    <Chip size="small"
        label={ready ? (verifiedAt ? 'connected · verified' : 'connected') : 'not connected'}
        color={ready ? 'success' : 'default'}
        variant={ready ? 'filled' : 'outlined'} />
);

export default function GatewaySettings() {
    const gwQ = useGetGatewayConfigQuery();
    const { data: gw, settled: gwSettled, reprime: reprimeGw } = usePrimedQuery(gwQ);
    const smsQ = useGetSmsConfigQuery();
    const { data: sms, settled: smsSettled, reprime: reprimeSms } = usePrimedQuery(smsQ);

    const [saveGateway, saveState] = useSaveGatewayConfigMutation();
    const [testRail, testState] = useTestGatewayRailMutation();
    const [disableGateway, disableState] = useDisableGatewayMutation();
    const [saveSms, saveSmsState] = useSaveSmsConfigMutation();
    const [disableSms] = useDisableSmsConfigMutation();

    // Write-only secret drafts — empty string means "leave unchanged".
    const [rzDraft, setRzDraft] = useState({ key_id: null, key_secret: '', webhook_secret: '' });
    const [cfDraft, setCfDraft] = useState({ env: null, client_id: null, client_secret: '' });
    const [smsDraft, setSmsDraft] = useState({ sender_id: null, api_key: '' });
    const [tplDraft, setTplDraft] = useState({});    // purpose -> {template_id, body_template}
    const [tplOpen, setTplOpen] = useState(null);    // purpose being edited
    const [confirmDisable, setConfirmDisable] = useState(false);
    const [notice, setNotice] = useState(null);

    const busy = saveState.isLoading || testState.isLoading || disableState.isLoading
        || saveSmsState.isLoading;

    const razorpay = gw?.razorpay || {};
    const cashfree = gw?.cashfree || {};
    const hooks = gw?.webhook_urls || {};
    const smsAllowed = !!sms?.own_dlt_allowed;
    const overrides = sms?.templates || {};
    const purposes = useMemo(() => sms?.common_purposes || [], [sms]);

    if (!gwSettled || !smsSettled) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    const flash = (severity, text) => setNotice({ severity, text });

    const onSaveRazorpay = async () => {
        setNotice(null);
        const body = { razorpay: {} };
        if (rzDraft.key_id !== null) body.razorpay.key_id = rzDraft.key_id;
        if (rzDraft.key_secret) body.razorpay.key_secret = rzDraft.key_secret;
        if (rzDraft.webhook_secret) body.razorpay.webhook_secret = rzDraft.webhook_secret;
        try {
            await saveGateway(body).unwrap();
            reprimeGw();
            setRzDraft({ key_id: null, key_secret: '', webhook_secret: '' });
            flash('success', 'Razorpay settings saved.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onSaveCashfree = async () => {
        setNotice(null);
        const body = { cashfree: {} };
        if (cfDraft.env !== null) body.cashfree.env = cfDraft.env;
        if (cfDraft.client_id !== null) body.cashfree.client_id = cfDraft.client_id;
        if (cfDraft.client_secret) body.cashfree.client_secret = cfDraft.client_secret;
        try {
            await saveGateway(body).unwrap();
            reprimeGw();
            setCfDraft({ env: null, client_id: null, client_secret: '' });
            flash('success', 'Cashfree settings saved.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onTest = async (rail) => {
        setNotice(null);
        try {
            await testRail(rail).unwrap();
            reprimeGw();
            flash('success', rail === 'razorpay'
                ? 'Razorpay credentials verified.' : 'Cashfree credentials verified.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onDisable = async () => {
        setConfirmDisable(false);
        setNotice(null);
        try {
            await disableGateway().unwrap();
            reprimeGw();
            flash('info', 'Gateway disabled — online payments are now refused.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onToggleOwnDlt = async (checked) => {
        setNotice(null);
        try {
            if (checked) {
                await saveSms({ use_own_dlt: true }).unwrap();
            } else {
                await disableSms().unwrap();
            }
            reprimeSms();
        } catch (e) { flash('error', errText(e)); }
    };

    const onSaveSmsCreds = async () => {
        setNotice(null);
        const body = {};
        if (smsDraft.sender_id !== null) body.sender_id = smsDraft.sender_id;
        if (smsDraft.api_key) body.api_key = smsDraft.api_key;
        try {
            await saveSms(body).unwrap();
            reprimeSms();
            setSmsDraft({ sender_id: null, api_key: '' });
            flash('success', 'SMS settings saved.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onSaveTemplate = async (purpose) => {
        setNotice(null);
        const entry = tplDraft[purpose] || {};
        try {
            await saveSms({ templates: { [purpose]: {
                template_id: entry.template_id || '',
                body_template: entry.body_template || '',
                variable_names: (purposes.find((p) => p.purpose === purpose)
                    ?.variable_names) || [],
            } } }).unwrap();
            reprimeSms();
            setTplOpen(null);
            flash('success', `Template for ${purpose} saved.`);
        } catch (e) { flash('error', errText(e)); }
    };

    const onRemoveTemplate = async (purpose) => {
        setNotice(null);
        try {
            await saveSms({ templates: { [purpose]: null } }).unwrap();
            reprimeSms();
            flash('info', `Template override for ${purpose} removed.`);
        } catch (e) { flash('error', errText(e)); }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                <AccountBalanceIcon color="primary" />
                <Typography variant="h5">Payments &amp; SMS</Typography>
            </Stack>

            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 2 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}

            {!razorpay.ready && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Online payments are <b>off</b> for your organisation until you
                    connect your Razorpay account below. Patient money always
                    settles into <i>your</i> account — never the platform's.
                </Alert>
            )}

            {/* ── Razorpay (collection) ─────────────────────────────── */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                    <Typography variant="h6">Razorpay — collections</Typography>
                    {readyChip(razorpay.ready, razorpay.verified_at)}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    From your Razorpay dashboard → Settings → API keys. The key
                    secret is stored encrypted and never shown again.
                </Typography>
                <Stack spacing={2}>
                    <TextField size="small" label="Key ID" placeholder="rzp_live_…"
                        value={rzDraft.key_id ?? (razorpay.key_id || '')}
                        onChange={(e) => setRzDraft((d) => ({ ...d, key_id: e.target.value }))} />
                    <TextField size="small" type="password" label="Key secret"
                        placeholder={razorpay.has_key_secret
                            ? `saved (${razorpay.key_secret_masked || '••••'}) — enter to rotate`
                            : 'enter your key secret'}
                        value={rzDraft.key_secret}
                        onChange={(e) => setRzDraft((d) => ({ ...d, key_secret: e.target.value }))} />
                    <TextField size="small" type="password" label="Webhook secret"
                        placeholder={razorpay.has_webhook_secret
                            ? 'saved — enter to rotate' : 'the secret you set on the webhook'}
                        value={rzDraft.webhook_secret}
                        onChange={(e) => setRzDraft((d) => ({ ...d, webhook_secret: e.target.value }))} />
                    <CopyField label="Webhook URL (paste into Razorpay → Webhooks; events: payment.captured, payment.failed)"
                        value={hooks.razorpay} />
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" disabled={busy} onClick={onSaveRazorpay}>
                            Save
                        </Button>
                        <Button variant="outlined" disabled={busy || !razorpay.ready}
                            onClick={() => onTest('razorpay')}>
                            Test connection
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            {/* ── Cashfree (payouts) ────────────────────────────────── */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                    <Typography variant="h6">Cashfree — doctor payouts</Typography>
                    {readyChip(cashfree.ready, cashfree.verified_at)}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Payouts to your doctors leave from your own Cashfree Payouts
                    account. Without it, earnings are settled manually.
                </Typography>
                <Stack spacing={2}>
                    <TextField select size="small" label="Environment"
                        value={cfDraft.env ?? (cashfree.env || 'sandbox')}
                        onChange={(e) => setCfDraft((d) => ({ ...d, env: e.target.value }))}>
                        <MenuItem value="sandbox">Sandbox (test)</MenuItem>
                        <MenuItem value="production">Production</MenuItem>
                    </TextField>
                    <TextField size="small" label="Client ID"
                        value={cfDraft.client_id ?? (cashfree.client_id || '')}
                        onChange={(e) => setCfDraft((d) => ({ ...d, client_id: e.target.value }))} />
                    <TextField size="small" type="password" label="Client secret"
                        placeholder={cashfree.has_client_secret
                            ? 'saved — enter to rotate' : 'enter your client secret'}
                        value={cfDraft.client_secret}
                        onChange={(e) => setCfDraft((d) => ({ ...d, client_secret: e.target.value }))} />
                    <CopyField label="Payout webhook URL (paste into Cashfree → Payouts → Webhooks)"
                        value={hooks.cashfree} />
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" disabled={busy} onClick={onSaveCashfree}>
                            Save
                        </Button>
                        <Button variant="outlined" disabled={busy || !cashfree.ready}
                            onClick={() => onTest('cashfree')}>
                            Test connection
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            {/* ── SMS / DLT ─────────────────────────────────────────── */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                    <SmsIcon fontSize="small" color="action" />
                    <Typography variant="h6">SMS — DLT templates</Typography>
                    <Chip size="small"
                        label={sms?.use_own_dlt ? 'your own DLT' : 'shared templates'}
                        color={sms?.use_own_dlt ? 'success' : 'default'}
                        variant="outlined" />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    By default SMS goes out on the platform's shared DLT
                    registration with your organisation's name in the message.
                    With your own DLT account, messages carry <i>your</i> sender
                    header and your approved wording.
                </Typography>

                {!smsAllowed && (
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                        Your current plan uses the shared SMS templates. Upgrade
                        your plan to send from your own DLT account.
                    </Alert>
                )}

                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <Switch checked={!!sms?.use_own_dlt}
                        disabled={!smsAllowed || busy}
                        onChange={(e) => onToggleOwnDlt(e.target.checked)} />
                    <Typography variant="body2">
                        Use my own DLT account
                    </Typography>
                </Stack>

                {sms?.use_own_dlt && (
                    <Stack spacing={2}>
                        <TextField size="small" label="Sender header (DLT-approved)"
                            placeholder="e.g. ACMEHC"
                            value={smsDraft.sender_id ?? (sms?.sender_id || '')}
                            onChange={(e) => setSmsDraft((d) => ({ ...d, sender_id: e.target.value }))} />
                        <TextField size="small" type="password" label="Combirds API key"
                            placeholder={sms?.has_api_key
                                ? 'saved — enter to rotate' : 'your SMS provider API key'}
                            value={smsDraft.api_key}
                            onChange={(e) => setSmsDraft((d) => ({ ...d, api_key: e.target.value }))} />
                        <Box>
                            <Button variant="contained" disabled={busy}
                                onClick={onSaveSmsCreds}>
                                Save SMS settings
                            </Button>
                        </Box>

                        <Divider />
                        <Typography variant="subtitle2">
                            Message templates ({Object.keys(overrides).length} of{' '}
                            {purposes.length} overridden — the rest use the shared
                            templates)
                        </Typography>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Purpose</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell align="right" />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {purposes.map((p) => {
                                        const ov = overrides[p.purpose];
                                        return (
                                            <TableRow key={p.purpose}>
                                                <TableCell>
                                                    <Typography variant="body2">{p.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {p.purpose}
                                                        {p.variable_names?.length
                                                            ? ` · vars: ${p.variable_names.join(', ')}` : ''}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small"
                                                        label={ov ? 'your template' : 'shared'}
                                                        color={ov ? 'success' : 'default'}
                                                        variant="outlined" />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => {
                                                        setTplDraft((d) => ({ ...d, [p.purpose]: {
                                                            template_id: ov?.template_id || '',
                                                            body_template: ov?.body_template || p.common_body || '',
                                                        } }));
                                                        setTplOpen(p.purpose);
                                                    }}>
                                                        {ov ? 'Edit' : 'Override'}
                                                    </Button>
                                                    {ov && (
                                                        <Button size="small" color="warning" disabled={busy}
                                                            onClick={() => onRemoveTemplate(p.purpose)}>
                                                            Remove
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Stack>
                )}
            </Paper>

            {/* ── Email — sender identity + templates ───────────────── */}
            <EmailSettingsCard flash={flash} busy={busy} />

            {/* ── Danger zone ───────────────────────────────────────── */}
            {gw?.is_active && (razorpay.key_id || cashfree.client_id) && (
                <Paper variant="outlined" sx={{ p: 3, borderColor: 'error.light' }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Disable payment gateway
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Online collections stop immediately; payouts fall back to
                        manual settlement. Your keys stay stored (encrypted) so
                        re-enabling is a single save.
                    </Typography>
                    <Button color="error" variant="outlined" disabled={busy}
                        onClick={() => setConfirmDisable(true)}>
                        Disable
                    </Button>
                </Paper>
            )}

            <Dialog open={confirmDisable} onClose={() => setConfirmDisable(false)}>
                <DialogTitle>Disable online payments?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Every checkout on your site will be refused until you
                        save the gateway settings again.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDisable(false)}>Cancel</Button>
                    <Button color="error" onClick={onDisable}>Disable</Button>
                </DialogActions>
            </Dialog>

            {/* ── Template editor dialog ────────────────────────────── */}
            <Dialog open={!!tplOpen} onClose={() => setTplOpen(null)} fullWidth maxWidth="sm">
                <DialogTitle>Template — {tplOpen}</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Register this wording with YOUR DLT registrar first: on
                        the registrar portal, our {'{variable}'} placeholders are
                        written as {'{#var#}'}. Once approved, the registrar
                        issues the template ID — paste it below with the exact
                        approved body (keep the {'{variable}'} placeholders
                        unchanged here; we substitute them at send time).
                    </DialogContentText>
                    {(() => {
                        const body = tplDraft[tplOpen]?.body_template || '';
                        const dlt = body.replace(/\{[a-z0-9_]+\}/gi, '{#var#}');
                        if (!body) return null;
                        return (
                            <Alert severity="info" icon={false} sx={{ mb: 2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    DLT-portal form of this body (copy for registration):
                                </Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                    {dlt}
                                </Typography>
                            </Alert>
                        );
                    })()}
                    <Stack spacing={2}>
                        <TextField size="small" label="DLT template ID"
                            value={tplDraft[tplOpen]?.template_id || ''}
                            onChange={(e) => setTplDraft((d) => ({ ...d,
                                [tplOpen]: { ...d[tplOpen], template_id: e.target.value } }))} />
                        <TextField size="small" multiline minRows={4}
                            label="Approved message body"
                            value={tplDraft[tplOpen]?.body_template || ''}
                            onChange={(e) => setTplDraft((d) => ({ ...d,
                                [tplOpen]: { ...d[tplOpen], body_template: e.target.value } }))} />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTplOpen(null)}>Cancel</Button>
                    <Button variant="contained" disabled={busy}
                        onClick={() => onSaveTemplate(tplOpen)}>
                        Save template
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
