/**
 * ConnectionManager — shared connection UI for My Network and My Link.
 *
 * Parameterised by `context` ('network' | 'link') and a `classification`
 * descriptor (the extra field recorded per connection: referral A/B/C for
 * network, relationship partner/associate/employee for link). Handles the
 * three entity tabs (Individual doctors / Hospital / Clinic), invite-code /
 * phone+name linking with request->accept, and the super-admin-gated Discover
 * directory.
 *
 * **Leaving.** Every row can be severed. On My Link that is not housekeeping:
 * a `relationship_type` of Employee is what lets a clinic operate this
 * doctor's practice (`app/api/provider_link`), and this button is the only
 * way the doctor withdraws it. `removeLabel` lets My Link call it "Delink"
 * where My Network calls it "Remove" — the same act, but one of them is a
 * revocation and shouldn't read as tidying up a list.
 *
 * **Both directions of the same relationship.** A My Link row is stored
 * doctor-side (`care_network_connections.doctor_id` is always the doctor; the
 * facility is the target), so a clinic reading its own affiliations is reading
 * the SAME rows from the other end — and cannot use the doctor's endpoints to
 * do it, because they're `@role_required(DOCTOR)`. When the viewer is a
 * facility the Individual tab is served by `/api/v1/facility/link/doctors`
 * instead, and its rows carry the Operation Page. That belongs here rather
 * than on a tab of its own: "the clinics I'm affiliated with" and "the doctors
 * affiliated with me" are one list seen from two sides, and splitting them
 * would teach people that My Link means something different depending on who
 * you signed in as.
 *
 * A facility gets no Connect / Invite / Join / Discover controls, because it
 * genuinely cannot start one of these — every creating path is on the doctor's
 * blueprint. The buttons are absent rather than disabled: there is nothing the
 * facility could do to earn them.
 */
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Tabs, Tab, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Paper, Chip, Button, Stack, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, IconButton, Tooltip, Alert,
    CircularProgress, Snackbar, MenuItem, FormControl, InputLabel, Select,
    Divider, Collapse,
} from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LinkIcon from '@mui/icons-material/Link';
import InputIcon from '@mui/icons-material/Input';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import TuneIcon from '@mui/icons-material/Tune';

import useProviderCan from '../../../staff/hooks/useProviderCan';
import {
    useGetLinkedDoctorsQuery, useUnlinkDoctorMutation,
} from '../../MyLink/api/providerLinkEndpoints';
import { useGetMyPlanLimitsQuery } from '../../Membership/api/myMembershipEndpoints';
import { limitCount } from '../../../../utils/planLimits';

import {
    useGetNetworkConnectionsQuery,
    useGetNetworkRequestsQuery,
    useGetNetworkDiscoverQuery,
    useGetNetworkVisibilityQuery,
    useSendNetworkRequestMutation,
    useAcceptNetworkRequestMutation,
    useRejectNetworkRequestMutation,
    useCancelNetworkRequestMutation,
    useGenerateNetworkInviteMutation,
    useJoinNetworkByCodeMutation,
    useRemoveNetworkConnectionMutation,
} from '../api/networkEndpoints';

const TYPES = [
    { key: 'doctor', label: 'Individual', icon: PersonIcon, visKey: 'doctors' },
    { key: 'hospital', label: 'Hospital', icon: LocalHospitalIcon, visKey: 'hospitals' },
    { key: 'clinic', label: 'Clinic', icon: BusinessIcon, visKey: 'clinics' },
];

const REQ_STATUS_COLOR = { PENDING: 'warning', ACCEPTED: 'success', REJECTED: 'error', EXPIRED: 'default', CANCELLED: 'default' };

const ConnectionManager = ({
    context, title, subtitle, classification,
    removeLabel = 'Remove',
    // Extra sentence in the confirm, when leaving costs more than a list entry.
    removeWarning = null,
}) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [tabIdx, setTabIdx] = useState(0);
    const tab = TYPES[tabIdx];
    const connType = tab.key;
    const isDoctorTab = connType === 'doctor';
    const clsOptions = classification.optionsByType[connType] || [];

    // Which end of the relationship this viewer is on. See the module
    // docstring — a facility reads the same rows through its own endpoint.
    const role = useSelector((s) => s.auth?.user?.role);
    const asFacility = role === 'clinic' || role === 'hospital';

    const { data: connections = [], isLoading } = useGetNetworkConnectionsQuery(
        { type: connType, context }, { skip: asFacility },
    );
    const { data: requests = { sent: [], received: [] } } =
        useGetNetworkRequestsQuery({ context }, { skip: asFacility });
    const { data: visibility = {} } = useGetNetworkVisibilityQuery(undefined, { skip: asFacility });
    const directoryOn = !asFacility && !!visibility[tab.visKey];

    const { data: linkedDoctors = [], isLoading: loadingLinked } =
        useGetLinkedDoctorsQuery(undefined, { skip: !asFacility });
    const [unlinkDoctor] = useUnlinkDoctorMutation();
    const { can } = useProviderCan();
    const canUnlink = !asFacility || can('doctors_network.linked_doctors', 'can_delete');

    // The membership tier's cap on My Link affiliations. Only fetched on My
    // Link — My Network is the same component and a different relationship,
    // and referrals are not capped. A facility sees its meter too: it never
    // creates a link, but accepting one is where its own ceiling bites, and
    // finding that out from a rejection would be the first it heard of it.
    const isLinkContext = context === 'link';
    const { data: planLimits } = useGetMyPlanLimitsQuery(undefined, { skip: !isLinkContext });
    const links = isLinkContext ? (planLimits?.my_links || null) : null;
    const atLinkLimit = !!links?.at_limit;

    // The facility's rows, shaped like a connection so the table below doesn't
    // have to know which end it is rendering. Everything extra (the tier, what
    // it opens, whether it's read-only) rides along for the actions column.
    const facilityRows = asFacility && isDoctorTab
        ? linkedDoctors.map((d) => ({
            ...d,
            id: d.connection_id,
            [classification.field]: d.relationship_type,
        }))
        : [];
    const rows = asFacility ? facilityRows : connections;
    const loading = asFacility ? loadingLinked : isLoading;

    // Facility (clinic/hospital) connects are pending until the facility's own
    // account accepts — surface those as "Pending" rows in the list below.
    const pendingFacility = !isDoctorTab && !asFacility
        ? (requests.sent || []).filter((r) => r.status === 'PENDING')
        : [];

    const [sendRequest, { isLoading: isSending }] = useSendNetworkRequestMutation();
    const [acceptRequest] = useAcceptNetworkRequestMutation();
    const [rejectRequest] = useRejectNetworkRequestMutation();
    const [cancelRequest] = useCancelNetworkRequestMutation();
    const [generateInvite] = useGenerateNetworkInviteMutation();
    const [joinByCode, { isLoading: isJoining }] = useJoinNetworkByCodeMutation();
    const [removeConnection, { isLoading: isRemoving }] = useRemoveNetworkConnectionMutation();

    // dialogs / state
    const [connectOpen, setConnectOpen] = useState(false);
    const [connectForm, setConnectForm] = useState({ target_phone: '', target_name: '', target_last_name: '', cls: '', target_id: '' });
    const [connectError, setConnectError] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteCls, setInviteCls] = useState('');
    const [generatedCode, setGeneratedCode] = useState('');
    const [joinOpen, setJoinOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [joinError, setJoinError] = useState('');
    const [codeCopied, setCodeCopied] = useState(false);
    const [showDiscover, setShowDiscover] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });
    const clsPayload = (v) => (classification.field && v ? { [classification.field]: v } : {});

    // ── Connect (send request / add facility) ─────────────────
    const openConnect = (prefill = {}) => {
        setConnectForm({ target_phone: '', target_name: '', target_last_name: '', cls: clsOptions[0] || '', target_id: '', ...prefill });
        setConnectError('');
        setConnectOpen(true);
    };
    const handleConnect = async () => {
        setConnectError('');
        try {
            const res = await sendRequest({
                connection_type: connType, context,
                ...clsPayload(connectForm.cls),
                target_id: connectForm.target_id || undefined,
                target_phone: connectForm.target_phone || undefined,
                target_name: connectForm.target_name || undefined,
                target_last_name: connectForm.target_last_name || undefined,
            }).unwrap();
            setConnectOpen(false);
            notify(res?.data?.request ? 'Request sent' : 'Added to your ' + (context === 'link' ? 'links' : 'network'), 'success');
        } catch (err) {
            setConnectError(err?.data?.message || err?.data?.error || 'Failed to connect');
        }
    };

    // ── Invite ────────────────────────────────────────────────
    const openInvite = async () => {
        setInviteCls(clsOptions[0] || '');
        setGeneratedCode('');
        setCodeCopied(false);
        setInviteOpen(true);
    };
    const doGenerate = async () => {
        try {
            const res = await generateInvite({ connection_type: connType, context, ...clsPayload(inviteCls) }).unwrap();
            setGeneratedCode(res?.data?.invite_code || res?.invite_code || '');
        } catch (err) {
            notify(err?.data?.message || err?.data?.error || 'Failed to generate invite', 'error');
        }
    };
    const copyCode = (t) => navigator.clipboard.writeText(t).then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); }).catch(() => {});

    // ── Join ──────────────────────────────────────────────────
    const handleJoin = async () => {
        if (!joinCode.trim()) return;
        setJoinError('');
        try {
            await joinByCode(joinCode.trim()).unwrap();
            setJoinOpen(false); setJoinCode('');
            notify('Connected successfully', 'success');
        } catch (err) {
            setJoinError(err?.data?.message || err?.data?.error || 'Invalid or expired invite code');
        }
    };

    const act = async (fn, id, ok) => {
        try { await fn(id).unwrap(); notify(ok, 'success'); }
        // ``error`` is where this envelope puts the message; ``message`` is
        // checked first only because a few endpoints set both. Without the
        // fallback every refusal here reads "Action failed", including the
        // plan-limit one, which is the one that most needs its reason.
        catch (err) { notify(err?.data?.message || err?.data?.error || 'Action failed', 'error'); }
    };

    // ── Leave / delink ────────────────────────────────────────
    // Two endpoints for one act, because each side can only address rows it is
    // a party to: the doctor deletes the connection by id, the facility names
    // the doctor. The row already knows which shape it is.
    const doRemove = async () => {
        const target = removing;
        setRemoving(null);
        await act(
            asFacility ? unlinkDoctor : removeConnection,
            asFacility ? target.doctor_id : target.id,
            `${removeLabel}ed ${target.name || 'connection'}`,
        );
    };

    const facilityLabel = tab.label; // Hospital / Clinic
    const capReason = links
        ? `Your membership includes ${links.limit} My Link affiliations and all `
          + `${links.used} are in use. Delink one, or upgrade the plan.`
        : '';

    return (
        <Box sx={{ py: 3, px: 2 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{subtitle}</Typography>

            {/* Only when a tier actually caps this — an uncapped practice has
                no number to keep an eye on. The count is every active link,
                across all three entity tabs, because that is what the cap
                counts; scoping it to the visible tab would make it disagree
                with the refusal. */}
            {links && !links.unlimited && (
                <Alert severity={atLinkLimit ? 'warning' : 'info'} sx={{ mb: 2 }}>
                    <b>{limitCount(links.used, links.limit)}</b> My Link affiliations used
                    {planLimits?.plan?.name ? ` on the ${planLimits.plan.name} plan` : ''}.
                    {atLinkLimit
                        ? ' Upgrade the membership to add more — every existing'
                          + ' affiliation is untouched.'
                        : ` Room for ${links.remaining} more.`}
                </Alert>
            )}

            <Tabs value={tabIdx} onChange={(_, v) => { setTabIdx(v); setShowDiscover(false); }} sx={{ mb: 2 }}>
                {TYPES.map((t) => {
                    const Icon = t.icon;
                    return <Tab key={t.key} label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Icon fontSize="small" />{t.label}</Box>} />;
                })}
            </Tabs>

            {/* Actions. Absent for a facility rather than disabled — every path
                that creates one of these rows is on the doctor's blueprint, so
                there is nothing it could do to earn them. */}
            {asFacility ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Doctors affiliate themselves with you. When one sends a request it
                    arrives under <b>Network Requests</b>, and the relationship they
                    chose — Partner, Associate or Employee — is what decides how much of
                    their practice you can run from here.
                </Alert>
            ) : (
                <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                    {/* All three create a link, so all three close at the cap.
                        Disabled rather than hidden, unlike the facility case
                        above: these are things this account normally can do,
                        and a button that vanished would read as a bug. The
                        span is what lets a disabled button still show its
                        tooltip. */}
                    <Tooltip title={atLinkLimit ? capReason : ''}>
                        <span>
                            <Button variant="contained" size="small" startIcon={<PersonAddIcon />}
                                disabled={atLinkLimit} onClick={() => openConnect()}>
                                {isDoctorTab ? 'Send Request' : `Add ${facilityLabel}`}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={atLinkLimit ? capReason : ''}>
                        <span>
                            <Button variant="outlined" size="small" color="secondary" startIcon={<LinkIcon />}
                                disabled={atLinkLimit} onClick={openInvite}>
                                Generate Invite
                            </Button>
                        </span>
                    </Tooltip>
                    {isDoctorTab && (
                        <Tooltip title={atLinkLimit ? capReason : ''}>
                            <span>
                                <Button variant="outlined" size="small" color="info" startIcon={<InputIcon />}
                                    disabled={atLinkLimit}
                                    onClick={() => { setJoinCode(''); setJoinError(''); setJoinOpen(true); }}>
                                    Join by Code
                                </Button>
                            </span>
                        </Tooltip>
                    )}
                    {directoryOn && (
                        <Button variant={showDiscover ? 'contained' : 'outlined'} size="small" color="success"
                            startIcon={<TravelExploreIcon />} onClick={() => setShowDiscover((s) => !s)}>
                            Discover
                        </Button>
                    )}
                </Stack>
            )}

            {/* Discover directory (super-admin gated) */}
            {directoryOn && (
                <Collapse in={showDiscover}>
                    <DiscoverDirectory connType={connType} onConnect={(p) => openConnect({ target_id: p.id, target_name: p.name })} />
                </Collapse>
            )}

            {/* Requests (doctor only) */}
            {isDoctorTab && (requests.received.length > 0 || requests.sent.some((r) => r.status === 'PENDING')) && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>Connection Requests</Typography>
                    {requests.received.map((r) => (
                        <Stack key={r.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5 }}>
                            <Typography variant="body2">
                                <strong>{r.requester_name || 'A doctor'}</strong> wants to connect
                                {r[classification.field] && <> · {classification.label}: {r[classification.field]}</>}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} onClick={() => act(acceptRequest, r.id, 'Connection accepted')}>Accept</Button>
                                <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => act(rejectRequest, r.id, 'Request rejected')}>Reject</Button>
                            </Box>
                        </Stack>
                    ))}
                    {requests.sent.filter((r) => r.status === 'PENDING').map((r) => (
                        <Stack key={r.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Sent to {r.target_name || r.target_phone || 'a doctor'}
                                {r.invite_code && <> · code <span style={{ fontFamily: 'monospace' }}>{r.invite_code}</span></>}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Chip label={r.status} size="small" color={REQ_STATUS_COLOR[r.status] || 'default'} />
                                <Button size="small" color="error" onClick={() => act(cancelRequest, r.id, 'Request cancelled')}>Cancel</Button>
                            </Box>
                        </Stack>
                    ))}
                </Paper>
            )}

            {/* Connections table */}
            <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #e0e0e0' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>#</TableCell>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>{tab.label} Name</TableCell>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Contact</TableCell>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>{classification.label}</TableCell>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }} align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}><CircularProgress size={26} /></TableCell></TableRow>
                        ) : (rows.length === 0 && pendingFacility.length === 0) ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                        {(() => { const Icon = tab.icon; return <Icon sx={{ fontSize: 48, opacity: 0.3 }} />; })()}
                                        <Typography>
                                            {asFacility && isDoctorTab
                                                ? 'No doctors are affiliated with you yet.'
                                                : `No ${tab.label.toLowerCase()} connections yet.`}
                                        </Typography>
                                        {asFacility && (
                                            <Typography variant="caption">
                                                {isDoctorTab
                                                    ? 'A doctor adds you from their own My Link, and you accept it under Network Requests.'
                                                    : 'Affiliations here are always with individual practitioners.'}
                                            </Typography>
                                        )}
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {rows.map((c, i) => (
                                    <TableRow key={c.id}>
                                        <TableCell>{i + 1}</TableCell>
                                        <TableCell>
                                            {c.name || '—'}
                                            {c.registration_number && (
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    Reg. {c.registration_number}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>{c.contact || '—'}</TableCell>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                                {c[classification.field]
                                                    ? <Chip label={c[classification.field]} size="small" color="primary" variant="outlined" />
                                                    : '—'}
                                                {/* What the relationship opens and whether it
                                                    can be changed are two different facts. A
                                                    Partner sees the same sections an Employee
                                                    does and can save none of them. */}
                                                {c.read_only && (
                                                    <Chip label="View only" size="small" variant="outlined" />
                                                )}
                                            </Stack>
                                        </TableCell>
                                        <TableCell><Chip label="Connected" size="small" color="success" variant="outlined" /></TableCell>
                                        <TableCell align="right">
                                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                {/* The Operation Page — only on the facility's
                                                    side of a link, because only it can act for
                                                    the other party. A relationship that opens
                                                    nothing keeps the button, disabled with the
                                                    reason on hover: "this relationship doesn't
                                                    include it" and "this feature doesn't exist"
                                                    must not look the same. */}
                                                {asFacility && isDoctorTab && (
                                                    <Tooltip title={
                                                        c.sections?.length
                                                            ? `Opens: ${c.sections.map((s) => s.label).join(', ')}`
                                                            : (c.summary || '')
                                                    }>
                                                        <span>
                                                            <Button
                                                                size="small"
                                                                variant={c.read_only ? 'outlined' : 'contained'}
                                                                startIcon={<TuneIcon />}
                                                                disabled={!c.sections?.length}
                                                                onClick={() => navigate(
                                                                    `${pathname.replace(/\/+$/, '')}/operate/${c.doctor_id}`)}
                                                            >
                                                                Operation Page
                                                            </Button>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                                {canUnlink && (
                                                    <Button size="small" color="error" startIcon={<LinkOffIcon />}
                                                        onClick={() => setRemoving(c)}>
                                                        {removeLabel}
                                                    </Button>
                                                )}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {pendingFacility.map((r, i) => (
                                    <TableRow key={r.id}>
                                        <TableCell>{rows.length + i + 1}</TableCell>
                                        <TableCell>{r.target_facility_name || r.target_name || '—'}</TableCell>
                                        <TableCell>—</TableCell>
                                        <TableCell>
                                            {r[classification.field]
                                                ? <Chip label={r[classification.field]} size="small" color="primary" variant="outlined" />
                                                : '—'}
                                        </TableCell>
                                        <TableCell>
                                            <Chip label="Pending" size="small" color="warning" variant="outlined" />
                                        </TableCell>
                                        {/* A pending row has no connection to
                                            sever yet — the request is what you
                                            take back. */}
                                        <TableCell align="right">
                                            <Button size="small" color="error" onClick={() => act(cancelRequest, r.id, 'Request cancelled')}>Cancel</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Connect dialog */}
            <Dialog open={connectOpen} onClose={() => setConnectOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{connectForm.target_id ? `Connect with ${connectForm.target_name || 'provider'}` : (isDoctorTab ? 'Send Connection Request' : `Add ${facilityLabel}`)}</DialogTitle>
                <DialogContent dividers>
                    {connectError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setConnectError('')}>{connectError}</Alert>}
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        {clsOptions.length > 0 && (
                            <FormControl fullWidth>
                                <InputLabel>{classification.label}</InputLabel>
                                <Select label={classification.label} value={connectForm.cls}
                                    onChange={(e) => setConnectForm((f) => ({ ...f, cls: e.target.value }))}>
                                    {clsOptions.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                                </Select>
                            </FormControl>
                        )}
                        {!connectForm.target_id && (
                            <>
                                <TextField label={isDoctorTab ? 'Phone Number *' : 'Phone Number'} fullWidth value={connectForm.target_phone}
                                    onChange={(e) => setConnectForm((f) => ({ ...f, target_phone: e.target.value }))} />
                                <TextField label={isDoctorTab ? 'First Name *' : `${facilityLabel} Name`} fullWidth value={connectForm.target_name}
                                    onChange={(e) => setConnectForm((f) => ({ ...f, target_name: e.target.value }))} />
                                {isDoctorTab && (
                                    <TextField label="Last Name *" fullWidth value={connectForm.target_last_name}
                                        onChange={(e) => setConnectForm((f) => ({ ...f, target_last_name: e.target.value }))} />
                                )}
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConnectOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleConnect} disabled={isSending}>
                        {isSending ? 'Submitting…' : (isDoctorTab && !connectForm.target_id ? 'Send Request' : 'Connect')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Invite dialog */}
            <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Generate Invite Code</DialogTitle>
                <DialogContent dividers>
                    {!generatedCode ? (
                        <Stack spacing={2} sx={{ mt: 0.5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Share a code for a {tab.label.toLowerCase()} to connect with you.
                            </Typography>
                            {clsOptions.length > 0 && (
                                <FormControl fullWidth>
                                    <InputLabel>{classification.label}</InputLabel>
                                    <Select label={classification.label} value={inviteCls} onChange={(e) => setInviteCls(e.target.value)}>
                                        {clsOptions.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            )}
                        </Stack>
                    ) : (
                        <Box sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>Share this code:</Typography>
                            <Paper variant="outlined" sx={{ p: 2, mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 2 }}>{generatedCode}</Typography>
                                <Tooltip title={codeCopied ? 'Copied!' : 'Copy'}>
                                    <IconButton onClick={() => copyCode(generatedCode)} color={codeCopied ? 'success' : 'default'}>
                                        {codeCopied ? <CheckIcon /> : <ContentCopyIcon />}
                                    </IconButton>
                                </Tooltip>
                            </Paper>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInviteOpen(false)}>{generatedCode ? 'Done' : 'Cancel'}</Button>
                    {!generatedCode && <Button variant="contained" onClick={doGenerate} startIcon={<LinkIcon />}>Generate</Button>}
                </DialogActions>
            </Dialog>

            {/* Leave / delink confirm */}
            <Dialog open={!!removing} onClose={() => setRemoving(null)} maxWidth="xs" fullWidth>
                <DialogTitle>{removeLabel} {removing?.name || 'this connection'}?</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" gutterBottom>
                        {removing?.[classification.field]
                            ? <>This ends your <b>{removing[classification.field]}</b> {classification.label.toLowerCase()} with {removing.name}.</>
                            : <>This ends your connection with {removing?.name}.</>}
                    </Typography>
                    {/* The facility's side knows exactly what it is giving up, so it
                        says so. "Are you sure?" over a name doesn't distinguish
                        surrendering a read-only view from surrendering the front
                        desk's access to a doctor's prescriptions. */}
                    {asFacility && !!removing?.sections?.length && (
                        <Typography variant="body2" gutterBottom>
                            You immediately lose{' '}
                            <b>{removing.sections.map((s) => s.label).join(', ')}</b>{' '}
                            on their behalf, and cannot add them back — only the doctor
                            can send the affiliation again.
                        </Typography>
                    )}
                    {!asFacility && removeWarning && (
                        <Alert severity="warning" sx={{ mt: 2 }}>{removeWarning}</Alert>
                    )}
                    {!asFacility && isDoctorTab && (
                        <Typography variant="caption" color="text.secondary">
                            It is removed for both of you — a doctor-to-doctor connection
                            is a two-way link.
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoving(null)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={doRemove} disabled={isRemoving}>
                        {isRemoving ? `${removeLabel}…` : removeLabel}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Join dialog */}
            <Dialog open={joinOpen} onClose={() => setJoinOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Join by Invite Code</DialogTitle>
                <DialogContent dividers>
                    <TextField autoFocus fullWidth label="Invite Code *" value={joinCode}
                        onChange={(e) => { setJoinCode(e.target.value); setJoinError(''); }}
                        inputProps={{ style: { fontFamily: 'monospace', letterSpacing: 1 } }} />
                    {joinError && <Alert severity="error" sx={{ mt: 2 }}>{joinError}</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setJoinOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleJoin} disabled={isJoining || !joinCode.trim()}>{isJoining ? 'Joining…' : 'Join'}</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

/** Discover directory sub-panel — lists visible providers with a Connect action. */
const DiscoverDirectory = ({ connType, onConnect }) => {
    const { data: providers = [], isLoading, isError } = useGetNetworkDiscoverQuery(connType);
    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f8fff8' }}>
            <Typography variant="subtitle2" gutterBottom>Discover — browse and connect</Typography>
            <Divider sx={{ mb: 1 }} />
            {isLoading ? (
                <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={22} /></Box>
            ) : isError ? (
                <Alert severity="info">This directory isn't available right now.</Alert>
            ) : providers.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No new providers to connect with.</Typography>
            ) : (
                <Stack spacing={1}>
                    {providers.map((p) => (
                        <Stack key={p.id} direction="row" alignItems="center" justifyContent="space-between">
                            <Box>
                                <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                                {p.contact && <Typography variant="caption" color="text.secondary">{p.contact}</Typography>}
                            </Box>
                            <Button size="small" variant="outlined" startIcon={<PersonAddIcon />} onClick={() => onConnect(p)}>Connect</Button>
                        </Stack>
                    ))}
                </Stack>
            )}
        </Paper>
    );
};

export default ConnectionManager;
