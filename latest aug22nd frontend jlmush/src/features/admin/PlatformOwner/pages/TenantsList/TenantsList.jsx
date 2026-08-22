/**
 * Platform-owner view: list / create tenants, jump to permission allocation.
 */
import { useState, useEffect } from 'react';
import {
    Box, Container, Typography, Paper, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, Dialog, DialogTitle, DialogContent,
    DialogActions, TextField, Snackbar, Alert, Chip, Tooltip, Stack,
    List, ListItem, ListItemText, Divider, FormControlLabel, Checkbox,
    CircularProgress, MenuItem, FormControl, InputLabel, Select, RadioGroup,
    Radio, FormLabel, Link as MuiLink,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CampaignIcon from '@mui/icons-material/Campaign';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import BlockIcon from '@mui/icons-material/Block';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import DnsIcon from '@mui/icons-material/Dns';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useNavigate } from 'react-router-dom';
import {
    useListPlatformTenantsQuery,
    useUpdatePlatformTenantMutation,
    useCreatePlatformTenantMutation,
    useCreateTenantSuperAdminMutation,
    useListTenantAdminsQuery,
    useResyncTenantDnsMutation,
    useGetTenantDnsQuery,
    useSetTenantDomainMutation,
    useVerifyTenantDomainMutation,
    useRefreshTenantDomainMutation,
    useResetTenantDomainMutation,
    useCheckTenantDomainCnameMutation,
    useDeleteTenantMutation,
    useAnnounceToTenantsMutation,
} from '../../../api/platformEndpoints';
import { useListPlansQuery } from '../../../api/pricingEndpoints';
import AnnouncementDialog from '../../../components/AnnouncementDialog';


/**
 * Render the per-record chip for ONE of the two domains of a tenant
 * (the platform subdomain OR the tenant's custom domain). The
 * subdomain chip reflects ``subdomain_routing``; the custom-domain
 * chip reflects ``custom_domain_routing`` — both are derived
 * server-side in ``Tenant.to_dict()`` so the UI never has to
 * re-implement the in-zone / out-of-zone / unverified logic.
 */
const DomainChip = ({ kind, status, label, error, onRefresh, refreshing, onOpenInstructions }) => {
    const map = {
        // subdomain_routing values
        active:    { color: 'success', icon: <CheckCircleOutlineIcon />, text: 'active' },
        pending:   { color: 'warning', icon: <HourglassEmptyIcon />,    text: 'pending' },
        failed:    { color: 'error',   icon: <ErrorOutlineIcon />,      text: 'failed' },
        disabled:  { color: 'default', icon: null,                       text: 'disabled' },
        platform:  { color: 'default', icon: null,                       text: 'platform' },
        // custom_domain_routing values
        none:                 { color: 'default', icon: null,                       text: 'no custom domain' },
        unverified:           { color: 'warning', icon: <HourglassEmptyIcon />,    text: 'verify TXT' },
        out_of_zone_pending:  { color: 'info',    icon: <DnsIcon />,                text: 'add CNAME' },
        in_zone_active:       { color: 'success', icon: <CheckCircleOutlineIcon />, text: 'active' },
    };
    const cfg = map[status] || map.disabled;
    const tooltip = error
        ? `Error: ${error}`
        : label
            ? `${kind === 'subdomain' ? 'Subdomain' : 'Custom domain'}: ${label} · ${cfg.text}`
            : cfg.text;
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title={tooltip}>
                <Chip
                    icon={cfg.icon || undefined}
                    label={label || cfg.text}
                    size="small"
                    color={cfg.color}
                    variant={status === 'active' || status === 'in_zone_active' ? 'filled' : 'outlined'}
                    onClick={onOpenInstructions}
                    clickable={Boolean(onOpenInstructions)}
                />
            </Tooltip>
            {onRefresh && (
                <Tooltip title={`Re-sync ${kind === 'subdomain' ? 'subdomain' : 'custom domain'} DNS`}>
                    <span>
                        <IconButton size="small" onClick={onRefresh} disabled={refreshing}>
                            {refreshing ? <CircularProgress size={14} /> : <ReplayIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
            )}
        </Stack>
    );
};


/**
 * The DNS table cell — stacks the two per-record chips vertically so
 * the operator can see at a glance whether subdomain AND custom domain
 * are routing, with a dedicated refresh button per record.
 */
const DnsStatusCell = ({ tenant, onResync, resyncingScope, onOpenInstructions }) => {
    const baseDomain = (tenant.fqdn && tenant.slug
        ? tenant.fqdn.replace(`${tenant.slug}.`, '')
        : '') || '';
    const slugLabel = tenant.auto_subdomain
        ? (baseDomain ? `${tenant.slug}.${baseDomain}` : tenant.slug)
        : 'subdomain off';
    // For tenants with a custom domain, surface the combined
    // cf_hostname_status + cf_ssl_status as a single chip. The existing
    // ``custom_domain_routing`` chip stays — it reflects the
    // tenant-facing routing state — but the CF-side health chip is
    // what tells the operator whether DCV / SSL provisioning has
    // converged.
    const cfStatus = (() => {
        if (!tenant.domain) return null;
        const h = tenant.cf_hostname_status;
        const s = tenant.cf_ssl_status;
        if (!h && !s) return { color: 'default', text: 'CF: not provisioned' };
        if (h === 'active' && s === 'active') return { color: 'success', text: 'CF: Live' };
        if (s === 'pending_validation') return { color: 'warning', text: 'CF: Waiting on DCV' };
        if (h === 'blocked' || s === 'blocked') return { color: 'error', text: 'CF: blocked' };
        return { color: 'info', text: `CF: ${h || '?'} / ${s || '?'}` };
    })();
    return (
        <Stack spacing={0.5}>
            <DomainChip
                kind="subdomain"
                status={tenant.subdomain_routing || 'disabled'}
                label={slugLabel}
                error={tenant.dns_error}
                onRefresh={!tenant.is_default && tenant.auto_subdomain
                    ? () => onResync(tenant, 'subdomain')
                    : undefined}
                refreshing={resyncingScope?.tenantId === tenant.id && resyncingScope?.scope === 'subdomain'}
                onOpenInstructions={tenant.auto_subdomain ? () => onOpenInstructions(tenant) : undefined}
            />
            <DomainChip
                kind="custom"
                status={tenant.custom_domain_routing || 'none'}
                label={tenant.domain || ''}
                error={tenant.dns_error}
                onRefresh={tenant.domain
                    ? () => onResync(tenant, 'custom')
                    : undefined}
                refreshing={resyncingScope?.tenantId === tenant.id && resyncingScope?.scope === 'custom'}
                onOpenInstructions={tenant.domain ? () => onOpenInstructions(tenant) : undefined}
            />
            {cfStatus && (
                <Tooltip title={`Cloudflare: hostname=${tenant.cf_hostname_status || '—'} · ssl=${tenant.cf_ssl_status || '—'}`}>
                    <Chip
                        label={cfStatus.text}
                        size="small"
                        color={cfStatus.color}
                        variant={cfStatus.color === 'success' ? 'filled' : 'outlined'}
                        onClick={() => onOpenInstructions(tenant)}
                        clickable
                    />
                </Tooltip>
            )}
        </Stack>
    );
};


/**
 * One row inside the DNS instructions dialog: shows a value with a
 * monospace background and a copy-to-clipboard button. Used for the
 * TXT challenge value, the CNAME target, and the host names.
 */
const CopyRow = ({ label, value }) => {
    const [copied, setCopied] = useState(false);
    const onCopy = () => {
        if (!value) return;
        try {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore — older browsers */ }
    };
    return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary' }}>
                {label}
            </Typography>
            <Box sx={{
                flex: 1, fontFamily: 'monospace', fontSize: 12,
                bgcolor: 'grey.100', px: 1, py: 0.5, borderRadius: 1,
                overflowX: 'auto', whiteSpace: 'nowrap',
            }}>
                {value || '—'}
            </Box>
            <Tooltip title={copied ? 'Copied' : 'Copy'}>
                <span>
                    <IconButton size="small" onClick={onCopy} disabled={!value}>
                        <ContentCopyIcon fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </Stack>
    );
};


/**
 * DNS setup dialog — shows the operator the exact records they need to
 * publish at their registrar (TXT for ownership verification, CNAME for
 * traffic routing). Pulls the live ``ingress_target`` + verification
 * token via the per-tenant ``/dns`` endpoint so we never have to rely
 * on what the tenant list returned.
 *
 * Also lets the operator (a) attach a custom domain post-create —
 * issuing the TXT challenge — and (b) re-run TXT verification once
 * they've published the record at their registrar.
 */
const DnsInstructionsDialog = ({ open, onClose, tenant, onSnack }) => {
    const { data: dns, isFetching, refetch } = useGetTenantDnsQuery(tenant?.id, {
        skip: !open || !tenant?.id,
    });
    const [setDomain, { isLoading: settingDomain }] = useSetTenantDomainMutation();
    const [verify, { isLoading: verifying }] = useVerifyTenantDomainMutation();
    // Cloudflare Custom Hostname refresh / reset.
    const [refreshDomain, { isLoading: domainRefreshing }] = useRefreshTenantDomainMutation();
    const [resetDomain, { isLoading: domainResetting }] = useResetTenantDomainMutation();
    const [checkCname, { isLoading: checkingCname }] = useCheckTenantDomainCnameMutation();

    const [domainInput, setDomainInput] = useState('');
    // Last "Check CNAME" probe result for the open tenant. Cleared
    // whenever the dialog opens for a different tenant or the user
    // attaches a new domain. We also auto-run the probe once the
    // dialog opens for an out-of-zone domain — that way the green
    // tick survives dialog close/reopen instead of dropping back to
    // the "add CNAME" warning every time.
    const [cnameProbe, setCnameProbe] = useState(null);
    useEffect(() => { setCnameProbe(null); }, [tenant?.id]);

    // Compute routing state up-front so the auto-probe effect can
    // depend on it. Doing this BEFORE the early-return is required
    // by the Rules of Hooks — the hook order has to be identical
    // across every render.  All accesses are null-safe.
    const customRouting = dns?.custom_domain_routing || tenant?.custom_domain_routing;
    const customNeedsTxtForEffect = customRouting === 'unverified';

    // Auto-probe the CNAME once the dialog opens for an out-of-zone
    // domain that's already past TXT verification. Keeps the green
    // "CNAME confirmed" state across dialog close/reopen — without
    // this the probe result lives only in component state and resets
    // to 'pending' every time the operator reopens.
    useEffect(() => {
        if (!open || !tenant?.id || !tenant?.domain) return;
        if (cnameProbe) return;                  // already probed this open
        if (customNeedsTxtForEffect) return;     // ownership not done yet
        if (customRouting === 'in_zone_active') return;  // we manage it
        // Best-effort probe; failures land silently so the alert
        // stays in the warning state with no probe result.
        checkCname(tenant.id).unwrap()
            .then((res) => setCnameProbe(res?.data || res))
            .catch(() => { /* keep cnameProbe null */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, tenant?.id, customRouting, customNeedsTxtForEffect]);

    if (!tenant) return null;

    const ingress = dns?.ingress_target;
    const baseDomain = dns?.base_domain;
    const token = dns?.verification_token || tenant.domain_verification_token;
    // Authoritative TXT host comes from the backend (uses ``_lz-verify.``
    // prefix). Falls back to a compatible local construction so the
    // dialog still renders something while the per-tenant /dns query
    // is in flight.
    const verificationHost = dns?.verification_record_name
        || (tenant.domain ? `_lz-verify.${tenant.domain}` : '');
    const subdomainRouting = dns?.subdomain_routing || tenant.subdomain_routing;
    const slugFqdn = tenant.slug && baseDomain ? `${tenant.slug}.${baseDomain}` : tenant.fqdn;

    const showSubdomainBlock = tenant.auto_subdomain && !tenant.is_default;
    const showCustomBlock = Boolean(tenant.domain);
    const customNeedsCname = customRouting === 'out_of_zone_pending';
    const customNeedsTxt = customRouting === 'unverified';

    const handleAttachDomain = async () => {
        const clean = (domainInput || '').trim().toLowerCase();
        if (!clean) return;
        try {
            await setDomain({ tenantId: tenant.id, domain: clean }).unwrap();
            setDomainInput('');
            refetch();
            onSnack?.({
                severity: 'success',
                message: `Verification challenge issued for ${clean}.`,
            });
        } catch (err) {
            onSnack?.({
                severity: 'error',
                message: err?.data?.error || 'Failed to attach domain.',
            });
        }
    };

    const handleVerify = async () => {
        try {
            const res = await verify(tenant.id).unwrap();
            const verified = res?.data?.verified ?? res?.verified;
            refetch();
            onSnack?.({
                severity: verified ? 'success' : 'warning',
                message: verified
                    ? 'Domain ownership verified — provisioning DNS.'
                    : 'TXT record not yet visible. Wait a few minutes and try again.',
            });
        } catch (err) {
            onSnack?.({
                severity: 'error',
                message: err?.data?.error || 'Verification call failed.',
            });
        }
    };

    const handleResetDomain = async () => {
        const ok = window.confirm(
            'This will delete the existing Cloudflare Custom Hostname ' +
            'association and create a fresh one. Use this when SSL DCV is ' +
            'stuck in a failed state — CF caches DCV failures on the row ' +
            'and delete-then-create is the documented unstick. Continue?'
        );
        if (!ok) return;
        try {
            const res = await resetDomain(tenant.id).unwrap();
            const data = res?.data || res;
            refetch();
            const blocked = data?.status === 'blocked'
                || data?.status === 'pending_blocked';
            onSnack?.({
                severity: blocked ? 'error' : 'success',
                message: blocked
                    ? (data?.error || 'Reset completed but new hostname is also blocked.')
                    : 'Cloudflare Custom Hostname reset — fresh DCV records issued.',
            });
        } catch (err) {
            onSnack?.({
                severity: 'error',
                message: err?.data?.error || 'Cloudflare reset failed.',
            });
        }
    };

    const handleRefreshDomain = async () => {
        try {
            const res = await refreshDomain(tenant.id).unwrap();
            const data = res?.data || res;
            refetch();
            const live = data?.status === 'active' && data?.ssl_status === 'active';
            onSnack?.({
                severity: live ? 'success' : 'info',
                message: live
                    ? 'Custom Hostname is live — traffic will be served.'
                    : (data?.error
                        || `CF hostname=${data?.status || '?'} · ssl=${data?.ssl_status || '?'}.`),
            });
        } catch (err) {
            onSnack?.({
                severity: 'error',
                message: err?.data?.error || 'Cloudflare refresh failed.',
            });
        }
    };

    const handleCheckCname = async () => {
        try {
            const res = await checkCname(tenant.id).unwrap();
            const report = res?.data || res;
            setCnameProbe(report);
            onSnack?.({
                severity: report?.matches ? 'success' : 'warning',
                message: report?.matches
                    ? 'CNAME points at our ingress — DNS routing is good.'
                    : (report?.reason || 'CNAME does not point at our ingress yet.'),
            });
        } catch (err) {
            onSnack?.({
                severity: 'error',
                message: err?.data?.error || 'CNAME check failed.',
            });
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                DNS records for {tenant.name}
                <Typography variant="caption" display="block" color="text.secondary">
                    Each record below maps to one chip on the Tenants table.
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                {isFetching && <Typography variant="body2">Loading DNS state…</Typography>}

                {showSubdomainBlock && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2">
                            Platform subdomain — {slugFqdn || tenant.slug}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Managed automatically on <code>{baseDomain || 'the platform zone'}</code>.
                            No action needed at your registrar.
                        </Typography>
                        <Box sx={{ mt: 1 }}>
                            <CopyRow label="Type" value="CNAME" />
                            <CopyRow label="Host" value={slugFqdn} />
                            <CopyRow label="Target" value={ingress} />
                        </Box>
                        {subdomainRouting === 'failed' && (
                            <Alert severity="error" sx={{ mt: 1 }}>
                                Last sync failed. Try the refresh icon on the chip.
                            </Alert>
                        )}
                    </Box>
                )}

                {showCustomBlock && (
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2">
                            Custom domain — {tenant.domain}
                        </Typography>

                        {customNeedsTxt && (
                            <Alert severity="info" sx={{ mt: 1 }}>
                                <b>Step 1</b> — add this <b>TXT</b> record at your domain
                                registrar to prove ownership, then click <b>Verify TXT</b>:
                                <Box sx={{ mt: 1 }}>
                                    <CopyRow label="Type" value="TXT" />
                                    <CopyRow label="Host" value={verificationHost} />
                                    <CopyRow label="Value" value={token} />
                                </Box>
                            </Alert>
                        )}

                        {(customNeedsCname || customNeedsTxt) && (
                            <Alert
                                severity={cnameProbe?.matches ? 'success' : 'warning'}
                                sx={{ mt: 1 }}
                                action={
                                    !customNeedsTxt && (
                                        <Button
                                            size="small"
                                            onClick={handleCheckCname}
                                            disabled={checkingCname}
                                        >
                                            {checkingCname ? 'Checking…' : 'Check CNAME'}
                                        </Button>
                                    )
                                }
                            >
                                <b>Step 2</b> —{' '}
                                {cnameProbe?.matches
                                    ? <>CNAME confirmed pointing at our ingress.</>
                                    : <>add this <b>CNAME</b> at your registrar so
                                        traffic routes to our ingress. We can't manage
                                        DNS for an out-of-zone domain — once you've
                                        added the record, click <b>Check CNAME</b> to
                                        confirm it resolves correctly.</>}
                                <Box sx={{ mt: 1 }}>
                                    <CopyRow label="Type" value="CNAME" />
                                    <CopyRow label="Host" value={tenant.domain} />
                                    {/*
                                      Target is the Cloudflare Pages project
                                      hostname (<project>.pages.dev by default).
                                      Backend exposes it as
                                      ``cloudflare_saas_fallback_origin``;
                                      fall back to the legacy
                                      ``ingress_target`` if Pages isn't
                                      configured yet so we don't render an
                                      empty target during partial setup.
                                    */}
                                    <CopyRow label="Target" value={dns?.cloudflare_saas_fallback_origin || ingress} />
                                </Box>
                                {/*
                                  Apex-redirect guidance.

                                  Wildcard Custom Hostnames are
                                  Enterprise-only on Cloudflare's SSL-for-
                                  SaaS, so we can only register ONE
                                  hostname per Custom Hostname row. We
                                  recommend operators register the
                                  ``www.<apex>`` variant as the tenant's
                                  domain (one cert, one row) and tell the
                                  tenant to redirect bare apex to it at
                                  their DNS provider — that way they
                                  don't burn a second Custom Hostname slot
                                  just to serve a 301.

                                  Show the redirect note in two cases:
                                    a) Operator entered ``www.<apex>`` —
                                       tenant has to bind apex separately.
                                    b) Operator entered the apex — tenant
                                       is fine here, BUT bare apex visitors
                                       will see whatever this row resolves
                                       to (the SPA), not a redirect to www.
                                       In that case, no note is shown.
                                */}
                                {tenant.domain
                                    && tenant.domain.startsWith('www.')
                                    && (() => {
                                        const apex = tenant.domain.slice(4);
                                        return (
                                            <Alert severity="info" sx={{ mt: 1.5 }}>
                                                <Typography variant="caption" sx={{ display: 'block' }}>
                                                    <b>Bare apex redirect (optional).</b>{' '}
                                                    To make <code>https://{apex}/</code> redirect
                                                    to <code>https://{tenant.domain}/</code>,
                                                    configure a redirect rule at your DNS
                                                    provider. On Cloudflare DNS: zone for{' '}
                                                    <code>{apex}</code> → Rules → Redirect Rules
                                                    → forward <code>{apex}/*</code> to{' '}
                                                    <code>https://{tenant.domain}/$1</code> (301).
                                                    On other registrars: look for "URL
                                                    forwarding" or "domain forwarding."
                                                </Typography>
                                            </Alert>
                                        );
                                    })()}
                                {cnameProbe && !cnameProbe.matches && cnameProbe.resolved_chain?.length > 0 && (
                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                                        Currently resolving to:{' '}
                                        <code>
                                            {cnameProbe.resolved_chain
                                                .map((h) => Array.isArray(h.target) ? h.target.join(', ') : h.target)
                                                .join(' → ')}
                                        </code>
                                    </Typography>
                                )}
                            </Alert>
                        )}

                        {customRouting === 'in_zone_active' && (
                            <Alert severity="success" sx={{ mt: 1 }}>
                                Inside our managed zone — CNAME provisioned automatically.
                                <Box sx={{ mt: 1 }}>
                                    <CopyRow label="Type" value="CNAME" />
                                    <CopyRow label="Host" value={tenant.domain} />
                                    <CopyRow label="Target" value={ingress} />
                                </Box>
                            </Alert>
                        )}

                        {/*
                          Cloudflare Pages — Step 3 block. After our TXT
                          ownership verifies, the backend calls the CF
                          Pages API to add the tenant's hostname to the
                          Pages project as a Custom Domain. Pages then
                          provisions a TLS cert and starts routing traffic
                          for that hostname.

                          The status fields here (cf_hostname_status,
                          cf_ssl_status) reflect Pages's Custom Domain
                          state ("initializing" / "pending" / "active" /
                          "blocked"). ``cf_ownership_verification`` carries
                          Pages's verification_data when CF needs the
                          tenant to publish an extra record (rare; usually
                          the CNAME-based auto-verification suffices).

                          All values come from the backend — frontend
                          never reconstructs record names.
                        */}
                        {dns?.cloudflare_configured
                            && !customNeedsTxt && (() => {
                            const hostStatus = dns?.cf_hostname_status;
                            const sslStatus = dns?.cf_ssl_status;
                            const ownership = dns?.cf_ownership_verification || null;
                            const errorMsg = dns?.cf_error;
                            const live = hostStatus === 'active';
                            const blocked = hostStatus === 'blocked'
                                || hostStatus === 'deactivated';
                            return (
                                <Alert
                                    severity={
                                        live ? 'success'
                                            : blocked ? 'error'
                                            : 'info'
                                    }
                                    sx={{ mt: 1 }}
                                    action={
                                        <Stack direction="row" spacing={1}>
                                            {blocked && (
                                                <Button
                                                    size="small"
                                                    color="warning"
                                                    onClick={handleResetDomain}
                                                    disabled={domainResetting || domainRefreshing}
                                                >
                                                    {domainResetting ? 'Resetting…' : 'Reset & retry'}
                                                </Button>
                                            )}
                                            <Button
                                                size="small"
                                                onClick={handleRefreshDomain}
                                                disabled={domainRefreshing || domainResetting}
                                            >
                                                {domainRefreshing ? 'Refreshing…' : 'Refresh'}
                                            </Button>
                                        </Stack>
                                    }
                                >
                                    <b>Step 3 — Cloudflare Pages domain</b>
                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                                        Pages status:{' '}
                                        <code>{hostStatus || 'not yet attached'}</code>
                                        {sslStatus && (
                                            <> · SSL: <code>{sslStatus}</code></>
                                        )}
                                    </Typography>
                                    {live && (
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                            ✓ Cloudflare Pages serves <code>{tenant.domain}</code>{' '}
                                            with an auto-issued TLS cert.
                                        </Typography>
                                    )}
                                    {!live && (
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                            The routing CNAME in Step 2 above is all the
                                            tenant needs to publish. Pages auto-verifies
                                            ownership via the CNAME chain and issues the
                                            cert in 1&ndash;5 minutes. Click <b>Refresh</b>
                                            to re-poll status.
                                        </Typography>
                                    )}
                                    {!live && ownership && ownership.reason && (
                                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                                            ℹ Pages says: {ownership.reason}
                                        </Typography>
                                    )}
                                    {errorMsg && (
                                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: blocked ? 'error.main' : 'text.secondary' }}>
                                            {blocked ? '' : 'ℹ '}{errorMsg}
                                        </Typography>
                                    )}
                                </Alert>
                            );
                        })()}

                        {/*
                          Fallback advisory when the CF Pages integration
                          isn't configured on this deployment. Without it,
                          tenant custom domains can't be auto-attached to
                          the Pages project — the operator would have to
                          add each one manually in the CF Pages dashboard.
                        */}
                        {!dns?.cloudflare_configured && !customNeedsTxt && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                <b>Cloudflare Pages integration not configured.</b>{' '}
                                Set <code>CLOUDFLARE_API_TOKEN</code> (with{' '}
                                <code>Account → Pages → Edit</code> scope),{' '}
                                <code>CLOUDFLARE_ACCOUNT_ID</code>, and{' '}
                                <code>CLOUDFLARE_PAGES_PROJECT_NAME</code> in the
                                backend env so custom domains can be auto-attached
                                to the Pages project after the tenant verifies. Until
                                then, an operator must manually add each tenant
                                hostname under <b>Workers & Pages → project →
                                Custom domains</b> in the Cloudflare dashboard.
                            </Alert>
                        )}
                    </Box>
                )}

                {!showCustomBlock && !tenant.is_default && (
                    <Box sx={{ mt: showSubdomainBlock ? 2 : 0 }}>
                        <Typography variant="subtitle2">Attach a custom domain</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Optional. Lets the tenant be reached at their own URL in addition
                            to (or instead of) the platform subdomain. We'll issue a TXT
                            challenge after you save.
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                            <TextField
                                size="small" fullWidth
                                placeholder="e.g. clinic.example.com"
                                value={domainInput}
                                onChange={(e) => setDomainInput(e.target.value.trim())}
                            />
                            <Button
                                variant="contained"
                                disabled={settingDomain || !domainInput}
                                onClick={handleAttachDomain}
                            >
                                Attach
                            </Button>
                        </Stack>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                {showCustomBlock && customRouting !== 'in_zone_active' && (
                    <Button
                        onClick={handleVerify}
                        disabled={verifying}
                        variant="contained"
                    >
                        {verifying ? 'Verifying…' : 'Verify TXT'}
                    </Button>
                )}
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};


/**
 * Drill-down dialog: show every admin (super_admin + sub_admin) inside a
 * given tenant. Lazy-fetched — only triggers the RTK query while open.
 */
const TenantAdminsDialog = ({ open, tenant, onClose, onCreateSuperAdmin }) => {
    const { data: admins = [], isLoading, error } = useListTenantAdminsQuery(
        { tenantId: tenant?.id },
        { skip: !open || !tenant },
    );

    const superAdmins = admins.filter((a) => a.role === 'super_admin');
    const subAdmins = admins.filter((a) => a.role === 'sub_admin');

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                Admins in {tenant?.name || '…'}
                <Typography variant="caption" display="block" color="text.secondary">
                    tenant slug <code>{tenant?.slug}</code>
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                {isLoading && <Typography>Loading…</Typography>}
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error?.data?.error || 'Failed to load admins.'}
                    </Alert>
                )}
                {!isLoading && !error && (
                    <>
                        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                            <Chip
                                label={`${superAdmins.length} super-admin${superAdmins.length !== 1 ? 's' : ''}`}
                                color="primary" size="small"
                            />
                            <Chip
                                label={`${subAdmins.length} sub-admin${subAdmins.length !== 1 ? 's' : ''}`}
                                size="small"
                            />
                        </Stack>

                        <Typography variant="subtitle2" color="text.secondary">
                            Super admins
                        </Typography>
                        {superAdmins.length === 0 ? (
                            <Alert severity="warning" sx={{ my: 1 }}>
                                No super-admins yet. Create one so this tenant can be managed.
                            </Alert>
                        ) : (
                            <List dense>
                                {superAdmins.map((u) => (
                                    <ListItem key={u.id} divider>
                                        <ListItemText
                                            primary={u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—'}
                                            secondary={`${u.phone_number || '—'}${u.email ? ' · ' + u.email : ''}`}
                                        />
                                        <Chip label={u.status} size="small" />
                                    </ListItem>
                                ))}
                            </List>
                        )}

                        {subAdmins.length > 0 && (
                            <>
                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" color="text.secondary">
                                    Sub admins
                                </Typography>
                                <List dense>
                                    {subAdmins.map((u) => (
                                        <ListItem key={u.id} divider>
                                            <ListItemText
                                                primary={u.full_name || '—'}
                                                secondary={`${u.phone_number || '—'}${u.email ? ' · ' + u.email : ''}`}
                                            />
                                            <Chip label={u.status} size="small" />
                                        </ListItem>
                                    ))}
                                </List>
                            </>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                <Button
                    variant="contained"
                    startIcon={<PersonAddIcon />}
                    onClick={() => onCreateSuperAdmin(tenant)}
                >
                    Add super admin
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const TenantsList = () => {
    const navigate = useNavigate();
    const { data: tenants = [], isLoading, error } = useListPlatformTenantsQuery();
    const [createTenant, createState] = useCreatePlatformTenantMutation();
    const [createSuperAdmin, createSuperAdminState] = useCreateTenantSuperAdminMutation();
    const [resyncDns] = useResyncTenantDnsMutation();
    const [deleteTenant] = useDeleteTenantMutation();
    const [updateTenant] = useUpdatePlatformTenantMutation();
    const [announce, announceState] = useAnnounceToTenantsMutation();

    // The vendor announces to its DIRECT tenants only — an apex's
    // children hear from the apex (the backend enforces the same split;
    // filtering here keeps the picker honest).
    const [announceOpen, setAnnounceOpen] = useState(false);
    const directTenants = tenants.filter((t) => !t.parent_tenant_id);

    const handleAnnounce = async (payload) => {
        try {
            const res = await announce(payload).unwrap();
            const d = res?.data || res;
            setSnack({
                open: true, severity: 'success',
                message: `Announcement sent to ${d?.admins_notified ?? 0} `
                    + `admin(s) across ${d?.tenants_reached ?? 0} tenant(s).`
                    + (d?.skipped_ids?.length
                        ? ` ${d.skipped_ids.length} id(s) skipped.` : ''),
            });
            return true;
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.error || 'Failed to send announcement.',
            });
            return false;
        }
    };

    /**
     * Derive the public URL for a tenant. Always resolves to the
     * production hostname pattern ``<slug>.<base_domain>`` so the
     * "Open product" button takes the operator to the live tenant
     * landing page, even if DNS provisioning hasn't completed yet
     * (the tenant just won't actually load until DNS lands).
     *
     * Resolution order:
     *   1. ``tenant.fqdn`` if Cloudflare returned one — that's the
     *      authoritative public hostname for this tenant.
     *   2. ``<tenant.slug>.<base_domain>`` derived from the current
     *      browser hostname. Operator on ``www.larazen.in`` →
     *      base = ``larazen.in`` → URL = ``acme.larazen.in``.
     *   3. ``VITE_PUBLIC_BASE_DOMAIN`` env override (for non-prod).
     *   4. Bare slug fallback (rare; only when running on localhost).
     */
    const buildTenantUrl = (t) => {
        if (t?.fqdn) return `https://${t.fqdn}`;
        if (!t?.slug) return null;

        const envBase = import.meta?.env?.VITE_PUBLIC_BASE_DOMAIN;
        let base = envBase;
        if (!base && typeof window !== 'undefined') {
            const host = window.location.hostname || '';
            // Strip a leading "www." or "app." or "admin." so the base
            // is the apex domain. Same hostname rules useTenantSlug uses.
            const parts = host.split('.');
            if (parts.length >= 2 && ['www', 'app', 'admin', 'main'].includes(parts[0])) {
                base = parts.slice(1).join('.');
            } else if (parts.length >= 2 && host !== 'localhost') {
                // Already on apex or first label is unknown — assume apex.
                base = parts.length > 2 ? parts.slice(-2).join('.') : host;
            }
        }
        if (!base || base === 'localhost') {
            // Dev mode — there's no real DNS. Use the in-app override.
            return `/?tenant=${t.slug}`;
        }
        return `https://${t.slug}.${base}`;
    };

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState({
        name: '', slug: '', domain: '', auto_subdomain: true,
        plan_code: '', billing_cycle: 'monthly',
    });
    // Lazy-load plans only when the create dialog opens — saves a
    // round-trip on the Tenants list page for operators who never
    // open the dialog.
    const { data: plans = [], isLoading: plansLoading } = useListPlansQuery(
        undefined, { skip: !dialogOpen },
    );
    // Pre-select the platform's default plan once plans land. Falls
    // back to the first ``active`` plan, then the first plan in the
    // list. We intentionally don't overwrite a value the operator
    // already chose.
    useEffect(() => {
        if (!dialogOpen || form.plan_code || plans.length === 0) return;
        const def = plans.find((p) => p.is_default && p.status === 'active')
            || plans.find((p) => p.status === 'active')
            || plans[0];
        if (def?.code) {
            setForm((f) => (f.plan_code ? f : { ...f, plan_code: def.code }));
        }
    }, [dialogOpen, plans, form.plan_code]);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });
    const [fieldErrors, setFieldErrors] = useState({});

    // DNS instructions dialog state — opens when the operator clicks a
    // chip or the DNS-setup icon, or right after a tenant is created
    // with a custom domain (to show the TXT challenge immediately).
    const [dnsDialog, setDnsDialog] = useState({ open: false, tenant: null });
    // Per-record refresh spinner state.
    const [resyncingScope, setResyncingScope] = useState(null);

    // Super-admin creation dialog state.
    const EMPTY_SA = { first_name: '', last_name: '', phone_number: '', email: '', password: '' };
    const [saDialog, setSaDialog] = useState({ open: false, tenant: null });
    const [saForm, setSaForm] = useState(EMPTY_SA);
    const [saErrors, setSaErrors] = useState({});

    // Admins drill-down dialog state — clicking the "N admins" chip opens it.
    const [adminsDialog, setAdminsDialog] = useState({ open: false, tenant: null });

    const openSuperAdminDialog = (tenant) => {
        setSaForm(EMPTY_SA);
        setSaErrors({});
        setSaDialog({ open: true, tenant });
    };
    const closeSuperAdminDialog = () => setSaDialog({ open: false, tenant: null });

    const handleResyncDns = async (tenant, scope = 'all') => {
        setResyncingScope({ tenantId: tenant.id, scope });
        try {
            await resyncDns({ tenantId: tenant.id, scope }).unwrap();
            const what = scope === 'subdomain' ? 'subdomain' : scope === 'custom' ? 'custom domain' : 'DNS';
            setSnack({ open: true, severity: 'success',
                message: `Re-synced ${what} for ${tenant.slug}.` });
        } catch (err) {
            setSnack({ open: true, severity: 'error',
                message: err?.data?.error || 'Failed to resync DNS.' });
        } finally {
            setResyncingScope(null);
        }
    };

    // Workspace on/off — distinct from a BILLING suspension (that lives on
    // the Entitlements page). Inactive darkens the whole tenant: its users
    // see "contact your provider", and the backend gates features too.
    const handleTenantStatus = async (t, status) => {
        const going = status === 'inactive';
        if (!window.confirm(
            going
                ? `Deactivate "${t.name}"? Everyone in that workspace loses `
                  + 'access until you reactivate it. No data is deleted.'
                : `Reactivate "${t.name}"?`)) return;
        try {
            await updateTenant({ tenantId: t.id, data: { status } }).unwrap();
            setSnack({
                open: true, severity: 'success',
                message: going
                    ? `"${t.name}" is now inactive.`
                    : `"${t.name}" is active again.`,
            });
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.error || 'Could not change status.',
            });
        }
    };

    const handleDeleteTenant = async (tenant, { hard = false } = {}) => {
        const confirmMsg = hard
            ? `HARD-delete "${tenant.name}"? Every row linked to this tenant ` +
              `(users, admins, appointments, configs) will be removed. ` +
              `This is irreversible.`
            : `Soft-delete "${tenant.name}"? Its DNS will be removed and it ` +
              `will disappear from this list. Row stays in DB for audit.`;
        if (!window.confirm(confirmMsg)) return;
        try {
            await deleteTenant({ tenantId: tenant.id, hard }).unwrap();
            setSnack({ open: true, severity: 'success',
                message: `Tenant ${tenant.slug} ${hard ? 'hard-' : ''}deleted.` });
        } catch (err) {
            setSnack({ open: true, severity: 'error',
                message: err?.data?.error || 'Failed to delete tenant.' });
        }
    };

    const handleCreateSuperAdmin = async () => {
        setSaErrors({});
        const payload = {
            first_name: saForm.first_name.trim(),
            last_name: saForm.last_name.trim(),
            phone_number: saForm.phone_number.trim(),
            password: saForm.password,
        };
        if (saForm.email && saForm.email.trim()) payload.email = saForm.email.trim();
        try {
            const res = await createSuperAdmin({
                tenantId: saDialog.tenant.id,
                data: payload,
            }).unwrap();
            // Backend wraps responses as ``{success, data, message}``.
            // The body of interest (tenant_slug, phone_number, …) lives
            // under ``res.data`` — reading from the top level surfaced
            // "Super admin created for 'undefined'. Phone: undefined."
            const created = res?.data || res;
            closeSuperAdminDialog();
            setSnack({
                open: true,
                severity: 'success',
                message: (
                    `Super admin created for "${created?.tenant_slug || saDialog.tenant.slug}".`
                    + ` Phone: ${created?.phone_number || saForm.phone_number}`
                ),
            });
        } catch (err) {
            const body = err?.data || {};
            const perField = body.errors || {};
            const flatErrors = {};
            Object.entries(perField).forEach(([field, msgs]) => {
                flatErrors[field] = Array.isArray(msgs) ? msgs.join(' ') : String(msgs);
            });
            setSaErrors(flatErrors);
            const summary = Object.entries(flatErrors)
                .map(([f, m]) => `${f}: ${m}`)
                .join(' · ');
            setSnack({
                open: true,
                severity: 'error',
                message: summary || body.error || 'Failed to create super admin.',
            });
        }
    };

    // Backend rule (Backend/app/api/platform/validators.py):
    //   ^[a-z0-9][a-z0-9-]{1,98}$  — must start alnum, only a-z/0-9/-, length 2-99.
    const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,98}$/;

    // Make the slug input forgiving: lowercase + strip whitespace/slashes,
    // replace runs of invalid chars with a single dash, trim leading dashes.
    const sanitizeSlug = (raw) =>
        (raw || '')
            .toLowerCase()
            .trim()
            .replace(/[\s/]+/g, '-')          // strip whitespace + slashes
            .replace(/[^a-z0-9-]+/g, '-')     // any other garbage -> dash
            .replace(/-+/g, '-')              // collapse repeated dashes
            .replace(/^-+/, '');              // no leading dash

    const slugClientError = form.slug
        ? (SLUG_RE.test(form.slug)
            ? null
            : 'Only a-z, 0-9, and dashes. Must start with a letter or digit (2-99 chars).')
        : null;

    const handleCreate = async () => {
        setFieldErrors({});
        // Strip empty optional fields so marshmallow / the uniqueness check
        // don't treat '' as a real domain.
        const payload = {
            name: form.name.trim(),
            auto_subdomain: form.auto_subdomain,
            billing_cycle: form.billing_cycle,
        };
        // Send slug only when filled — backend derives one from the
        // domain otherwise. Sending '' would fail the regex validator.
        if (form.slug && form.slug.trim()) payload.slug = form.slug.trim();
        if (form.domain && form.domain.trim()) payload.domain = form.domain.trim();
        if (form.plan_code) payload.plan_code = form.plan_code;
        try {
            const res = await createTenant(payload).unwrap();
            const created = res?.data || res;
            setDialogOpen(false);
            setForm({
                name: '', slug: '', domain: '', auto_subdomain: true,
                plan_code: '', billing_cycle: 'monthly',
            });
            setSnack({ open: true, severity: 'success', message: 'Tenant created.' });
            // If a custom domain was supplied OR auto_subdomain is off,
            // pop the DNS dialog so the operator immediately sees what
            // records to publish at the registrar.
            if (created && (created.domain || !created.auto_subdomain)) {
                setDnsDialog({ open: true, tenant: created });
            }
        } catch (err) {
            // Marshmallow returns per-field errors under ``errors``; conflicts
            // (duplicate slug/domain) surface as ``error`` at 409.
            const body = err?.data || {};
            const perField = body.errors || {};
            const flatErrors = {};
            Object.entries(perField).forEach(([field, msgs]) => {
                flatErrors[field] = Array.isArray(msgs) ? msgs.join(' ') : String(msgs);
            });
            setFieldErrors(flatErrors);
            const summary = Object.entries(flatErrors)
                .map(([f, m]) => `${f}: ${m}`)
                .join(' · ');
            setSnack({
                open: true,
                severity: 'error',
                message: summary || body.error || 'Failed to create tenant.',
            });
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h5">Tenants</Typography>
                <Stack direction="row" spacing={1}>
                    <Button
                        variant="outlined" startIcon={<CampaignIcon />}
                        onClick={() => setAnnounceOpen(true)}
                        disabled={directTenants.length === 0}
                    >
                        Announce
                    </Button>
                    <Button
                        variant="contained" startIcon={<AddIcon />}
                        onClick={() => setDialogOpen(true)}
                    >
                        New tenant
                    </Button>
                </Stack>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error?.data?.error || 'Failed to load tenants.'}
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Slug</TableCell>
                            <TableCell>DNS</TableCell>
                            <TableCell>Admins</TableCell>
                            <TableCell>Plan / Billing</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading && (
                            <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>
                        )}
                        {!isLoading && tenants.length === 0 && (
                            <TableRow><TableCell colSpan={7}>No tenants yet.</TableCell></TableRow>
                        )}
                        {tenants.map((t) => {
                            const counts = t.admin_counts || { super_admin: 0, sub_admin: 0, total: 0 };
                            const openUrl = buildTenantUrl(t);   // <slug>.<base_domain>, see helper above
                            return (
                                <TableRow key={t.id} hover>
                                    <TableCell>{t.name}</TableCell>
                                    <TableCell><code>{t.slug}</code></TableCell>
                                    <TableCell>
                                        <DnsStatusCell
                                            tenant={t}
                                            onResync={handleResyncDns}
                                            resyncingScope={resyncingScope}
                                            onOpenInstructions={(tenant) => setDnsDialog({ open: true, tenant })}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title="Open admin management page">
                                            <Chip
                                                icon={<GroupIcon />}
                                                label={`${counts.super_admin} super · ${counts.sub_admin} sub`}
                                                size="small"
                                                color={counts.super_admin > 0 ? 'primary' : 'default'}
                                                variant={counts.super_admin > 0 ? 'filled' : 'outlined'}
                                                onClick={() => navigate(`/dashboard/platform/tenants/${t.id}/admins`)}
                                                clickable
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell>
                                        {t.subscription?.plan_kind === 'apex' && (
                                            <Tooltip title="Apex reseller — sells its own plans and operates child tenants">
                                                <Chip size="small" color="secondary" label="APEX" sx={{ mr: 0.5 }} />
                                            </Tooltip>
                                        )}
                                        {t.subscription ? (
                                            <Tooltip title={
                                                t.subscription.status === 'trial'
                                                    ? `Trial ends ${t.subscription.trial_ends_at?.slice(0, 10) || '—'}`
                                                    : `Paid until ${t.subscription.current_period_end?.slice(0, 10) || '—'}`
                                            }>
                                                <Chip
                                                    size="small"
                                                    label={`${t.subscription.plan_code || '—'} · ${t.subscription.status}`}
                                                    color={{
                                                        active: 'success', trial: 'info',
                                                        past_due: 'warning', over_limit: 'warning',
                                                        suspended: 'error',
                                                    }[t.subscription.status] || 'default'}
                                                    variant="outlined"
                                                />
                                            </Tooltip>
                                        ) : (
                                            <Chip size="small" label="no subscription" variant="outlined" />
                                        )}
                                    </TableCell>
                                    <TableCell><Chip label={t.status} size="small" /></TableCell>
                                    <TableCell align="right">
                                        <Tooltip title={`Open tenant product (${openUrl})`}>
                                            <IconButton
                                                aria-label="open tenant product"
                                                onClick={() => window.open(openUrl, '_blank', 'noopener')}
                                            >
                                                <OpenInNewIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="DNS records & verification">
                                            <IconButton
                                                aria-label="dns setup"
                                                onClick={() => setDnsDialog({ open: true, tenant: t })}
                                            >
                                                <DnsIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Create super admin for this tenant">
                                            <IconButton
                                                aria-label="create super admin"
                                                onClick={() => openSuperAdminDialog(t)}
                                            >
                                                <PersonAddIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Entitlements (subscription, add-ons, permissions)">
                                            <IconButton
                                                aria-label="tenant entitlements"
                                                onClick={() => navigate(`/dashboard/platform/tenants/${t.id}/entitlements`)}
                                            >
                                                <SettingsIcon />
                                            </IconButton>
                                        </Tooltip>
                                        {!t.is_default && (
                                            t.status === 'active' ? (
                                                <Tooltip title="Deactivate workspace (whole tenant goes dark)">
                                                    <IconButton
                                                        aria-label="deactivate tenant"
                                                        color="warning"
                                                        onClick={() => handleTenantStatus(t, 'inactive')}
                                                    >
                                                        <BlockIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            ) : (
                                                <Tooltip title="Reactivate workspace">
                                                    <IconButton
                                                        aria-label="reactivate tenant"
                                                        color="success"
                                                        onClick={() => handleTenantStatus(t, 'active')}
                                                    >
                                                        <CheckCircleOutlineIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            )
                                        )}
                                        {!t.is_default && (
                                            <Tooltip title="Delete tenant (soft-delete, DNS removed)">
                                                <IconButton
                                                    aria-label="delete tenant"
                                                    color="error"
                                                    onClick={() => handleDeleteTenant(t)}
                                                >
                                                    <DeleteOutlineIcon />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Create tenant</DialogTitle>
                <DialogContent dividers>
                    <TextField
                        autoFocus margin="dense" fullWidth label="Name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        error={Boolean(fieldErrors.name)}
                        helperText={fieldErrors.name || ''}
                    />
                    <TextField
                        margin="dense" fullWidth label="Slug (optional if custom domain set)"
                        placeholder="e.g. acme-clinic"
                        helperText={
                            fieldErrors.slug
                                || slugClientError
                                || 'Optional when a custom domain is provided — we’ll derive one from the domain. Lowercase letters, digits, dashes.'
                        }
                        value={form.slug}
                        onChange={(e) => setForm({ ...form, slug: sanitizeSlug(e.target.value) })}
                        error={Boolean(fieldErrors.slug) || Boolean(slugClientError)}
                    />
                    <TextField
                        margin="dense" fullWidth label="Custom domain (optional)"
                        placeholder="e.g. clinic.example.com"
                        value={form.domain}
                        onChange={(e) => setForm({ ...form, domain: e.target.value.trim() })}
                        error={Boolean(fieldErrors.domain)}
                        helperText={
                            fieldErrors.domain
                            || 'Optional. If filled, you’ll get a TXT verification challenge after Create.'
                        }
                    />
                    <FormControlLabel
                        sx={{ mt: 1 }}
                        control={
                            <Checkbox
                                checked={form.auto_subdomain}
                                onChange={(e) => setForm({ ...form, auto_subdomain: e.target.checked })}
                            />
                        }
                        label="Also provision the platform subdomain (recommended)"
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5 }}>
                        Off = tenant reachable only via custom domain. On = both URLs work; same login,
                        same data.
                    </Typography>

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Subscription
                    </Typography>
                    {plansLoading && (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                            <CircularProgress size={14} />
                            <Typography variant="caption" color="text.secondary">
                                Loading available plans…
                            </Typography>
                        </Stack>
                    )}
                    {!plansLoading && plans.length === 0 && (
                        <Alert severity="warning" sx={{ mb: 1 }}>
                            No plans defined yet.{' '}
                            <MuiLink
                                component="button" type="button"
                                onClick={() => navigate('/dashboard/platform/plans')}
                            >
                                Create one in Pricing
                            </MuiLink>{' '}
                            first. Without a plan the tenant has no entitlements and every
                            feature gate will fail.
                        </Alert>
                    )}
                    {plans.length > 0 && (
                        <>
                            <FormControl fullWidth margin="dense" error={Boolean(fieldErrors.plan_code)}>
                                <InputLabel id="plan-select-label">Plan</InputLabel>
                                <Select
                                    labelId="plan-select-label"
                                    label="Plan"
                                    value={form.plan_code}
                                    onChange={(e) => setForm({ ...form, plan_code: e.target.value })}
                                >
                                    {plans
                                        .filter((p) => p.status !== 'archived')
                                        .map((p) => {
                                            const monthly = p.price_inr_monthly;
                                            const annual = p.price_inr_annual;
                                            const priceLabel =
                                                form.billing_cycle === 'annual' && annual != null
                                                    ? ` · ₹${annual.toLocaleString('en-IN')}/yr`
                                                    : monthly != null
                                                        ? ` · ₹${monthly.toLocaleString('en-IN')}/mo`
                                                        : '';
                                            const trialLabel = p.trial_days > 0 ? ` · ${p.trial_days}d trial` : '';
                                            return (
                                                <MenuItem key={p.code} value={p.code} disabled={p.status !== 'active'}>
                                                    {p.name} ({p.code}){priceLabel}{trialLabel}
                                                    {p.is_default ? ' · default' : ''}
                                                    {p.status !== 'active' ? ` · ${p.status}` : ''}
                                                </MenuItem>
                                            );
                                        })}
                                </Select>
                            </FormControl>
                            {fieldErrors.plan_code && (
                                <Typography variant="caption" color="error">
                                    {fieldErrors.plan_code}
                                </Typography>
                            )}
                            <FormControl margin="dense">
                                <FormLabel sx={{ fontSize: 12 }}>Billing cycle</FormLabel>
                                <RadioGroup
                                    row
                                    value={form.billing_cycle}
                                    onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
                                >
                                    <FormControlLabel value="monthly" control={<Radio size="small" />} label="Monthly" />
                                    <FormControlLabel value="annual" control={<Radio size="small" />} label="Annual" />
                                </RadioGroup>
                            </FormControl>
                            {form.plan_code && (() => {
                                const p = plans.find((x) => x.code === form.plan_code);
                                if (!p) return null;
                                return (
                                    <Box sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                            User limits — total {p.user_limits?.total ?? '—'} ·
                                            {' '}super {p.user_limits?.per_role?.super_admin ?? '—'} ·
                                            {' '}sub {p.user_limits?.per_role?.sub_admin ?? '—'} ·
                                            {' '}provider {p.user_limits?.per_role?.provider ?? '—'}
                                        </Typography>
                                        {p.trial_days > 0 && (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                Starts in TRIAL for {p.trial_days} days, then ACTIVE.
                                            </Typography>
                                        )}
                                    </Box>
                                );
                            })()}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={
                            createState.isLoading
                            || !form.name.trim()
                            // Slug-or-domain: at least one identifier required.
                            || (!form.slug.trim() && !form.domain.trim())
                            || Boolean(slugClientError)
                        }
                        onClick={handleCreate}
                    >
                        Create
                    </Button>
                </DialogActions>
            </Dialog>

            <AnnouncementDialog
                open={announceOpen}
                onClose={() => setAnnounceOpen(false)}
                tenants={directTenants}
                audienceAllLabel="All direct tenants"
                onSend={handleAnnounce}
                sending={announceState.isLoading}
            />

            <TenantAdminsDialog
                open={adminsDialog.open}
                tenant={adminsDialog.tenant}
                onClose={() => setAdminsDialog({ open: false, tenant: null })}
                onCreateSuperAdmin={(tenant) => {
                    setAdminsDialog({ open: false, tenant: null });
                    openSuperAdminDialog(tenant);
                }}
            />

            <DnsInstructionsDialog
                open={dnsDialog.open}
                onClose={() => setDnsDialog({ open: false, tenant: null })}
                tenant={dnsDialog.tenant}
                onSnack={({ severity, message }) =>
                    setSnack({ open: true, severity, message })
                }
            />


            <Dialog open={saDialog.open} onClose={closeSuperAdminDialog} maxWidth="sm" fullWidth>
                <DialogTitle>
                    Create super admin
                    {saDialog.tenant && (
                        <Typography variant="caption" display="block" color="text.secondary">
                            for tenant <code>{saDialog.tenant.slug}</code> ({saDialog.tenant.name})
                        </Typography>
                    )}
                </DialogTitle>
                <DialogContent dividers>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        A SUPER_ADMIN is strictly tenant-scoped. They will only see and
                        manage data inside <code>{saDialog.tenant?.slug}</code>. To act
                        across tenants, use the PLATFORM_OWNER role instead.
                    </Alert>
                    <TextField
                        autoFocus margin="dense" fullWidth label="First name"
                        value={saForm.first_name}
                        onChange={(e) => setSaForm({ ...saForm, first_name: e.target.value })}
                        error={Boolean(saErrors.first_name)}
                        helperText={saErrors.first_name || ''}
                    />
                    <TextField
                        margin="dense" fullWidth label="Last name (optional)"
                        value={saForm.last_name}
                        onChange={(e) => setSaForm({ ...saForm, last_name: e.target.value })}
                        error={Boolean(saErrors.last_name)}
                        helperText={saErrors.last_name || ''}
                    />
                    <TextField
                        margin="dense" fullWidth label="Phone number"
                        placeholder="10-digit Indian mobile, starts 6-9"
                        value={saForm.phone_number}
                        onChange={(e) => setSaForm({ ...saForm, phone_number: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                        error={Boolean(saErrors.phone_number)}
                        helperText={saErrors.phone_number || ''}
                    />
                    <TextField
                        margin="dense" fullWidth label="Email (optional)"
                        value={saForm.email}
                        onChange={(e) => setSaForm({ ...saForm, email: e.target.value.trim() })}
                        error={Boolean(saErrors.email)}
                        helperText={saErrors.email || ''}
                    />
                    <TextField
                        margin="dense" fullWidth type="password" label="Password"
                        helperText={
                            saErrors.password
                            || 'Min 8 chars, with uppercase, lowercase, digit, special char.'
                        }
                        value={saForm.password}
                        onChange={(e) => setSaForm({ ...saForm, password: e.target.value })}
                        error={Boolean(saErrors.password)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeSuperAdminDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={
                            createSuperAdminState.isLoading
                            || !saForm.first_name.trim()
                            || saForm.phone_number.length !== 10
                            || (saForm.password || '').length < 8
                        }
                        onClick={handleCreateSuperAdmin}
                    >
                        Create super admin
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snack.open}
                autoHideDuration={5000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert severity={snack.severity}>{snack.message}</Alert>
            </Snackbar>
        </Container>
    );
};

export default TenantsList;
