/**
 * ApprovalMatrix — the tenant-wide DEFAULT approval modes (the "approval matrix"
 * settings surface). Separate from the approve/reject queue: here the admin sets,
 * per section, whether a doctor's change is Auto-approved or needs Manual admin
 * approval, and the doctor's own action mode (Auto-accept / Auto-reject / Manual).
 * Per-doctor overrides live in the ViewDoctors row.
 *
 * Phase 1 enforces the profile-section auto/manual and the appointment-acceptance
 * mode; other rows are stored but not yet enforced (flagged in the UI).
 */
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Box, Paper, Typography, Stack, Chip, Button, Divider, Tooltip,
    ToggleButtonGroup, ToggleButton, Table, TableHead, TableBody, TableRow,
    TableCell, CircularProgress, Alert,
} from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { setSnackbar } from '../../../redux/adminSharedUiSlice';
import {
    useGetApprovalPolicyQuery,
    useGetApprovalCountsQuery,
    useUpdateApprovalPolicyMutation,
    useGetPendingActionsQuery,
    useApprovePendingActionMutation,
    useRejectPendingActionMutation,
} from '../../../api/doctorsEndpoints';
import {
    PERMISSION_GROUPS, ACTION_ROWS, PERMISSION_OPTIONS, ACTION_OPTIONS, COUNT_KEYS,
} from '../../constants/approvalMatrix';

// Held doctor actions (cancel / payout-claim) awaiting admin sign-off.
const HeldActionsPanel = () => {
    const dispatch = useDispatch();
    const { data: actions = [], isLoading } = useGetPendingActionsQuery('pending');
    const [approve, { isLoading: approving }] = useApprovePendingActionMutation();
    const [reject, { isLoading: rejecting }] = useRejectPendingActionMutation();
    const busy = approving || rejecting;

    const act = async (fn, actionId, okMsg) => {
        try {
            const res = await fn({ actionId }).unwrap();
            dispatch(setSnackbar({ open: true, severity: 'success', message: res?.message || okMsg }));
        } catch (e) {
            dispatch(setSnackbar({ open: true, severity: 'error', message: e?.data?.error || e?.data?.message || 'Failed' }));
        }
    };

    if (isLoading || actions.length === 0) return null;
    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2, borderColor: 'warning.main' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Held actions awaiting approval ({actions.length})
            </Typography>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell><b>Doctor</b></TableCell><TableCell><b>Action</b></TableCell>
                        <TableCell><b>Detail</b></TableCell><TableCell align="right"><b></b></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {actions.map((a) => (
                        <TableRow key={a.id}>
                            <TableCell>{a.doctor_name || '—'}</TableCell>
                            <TableCell sx={{ textTransform: 'capitalize' }}>{(a.kind || '').replace(/_/g, ' ')}</TableCell>
                            <TableCell>{a.label || '—'}</TableCell>
                            <TableCell align="right">
                                <Button size="small" color="success" variant="outlined" disabled={busy}
                                    onClick={() => act(approve, a.id, 'Approved')} sx={{ mr: 0.5 }}>Approve</Button>
                                <Button size="small" color="error" variant="outlined" disabled={busy}
                                    onClick={() => act(reject, a.id, 'Rejected')}>Reject</Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Paper>
    );
};

const NotWired = () => (
    <Tooltip title="Stored, not yet enforced (coming soon)">
        <Chip size="small" variant="outlined" color="default" label="soon"
            icon={<InfoOutlinedIcon />} sx={{ ml: 1, height: 20 }} />
    </Tooltip>
);

const CountChips = ({ c }) => (
    <Stack direction="row" spacing={0.5}>
        {COUNT_KEYS.map(([k, lbl, color]) => (
            <Chip key={k} size="small" variant="outlined" color={c?.[k] ? color : 'default'}
                label={`${lbl.slice(0, 3)} ${c?.[k] || 0}`} sx={{ height: 20 }} />
        ))}
    </Stack>
);

export default function ApprovalMatrix() {
    const dispatch = useDispatch();
    const { data: policyData, isLoading, error } = useGetApprovalPolicyQuery();
    const { data: counts = {} } = useGetApprovalCountsQuery();
    const [save, { isLoading: saving }] = useUpdateApprovalPolicyMutation();

    const [perm, setPerm] = useState({});
    const [action, setAction] = useState({});
    const defaults = policyData?.defaults || { permission: 'manual', action: 'manual' };

    useEffect(() => {
        if (policyData?.policy) {
            setPerm({ ...(policyData.policy.permission_modes || {}) });
            setAction({ ...(policyData.policy.action_modes || {}) });
        }
    }, [policyData]);

    const permVal = (key) => perm[key] || defaults.permission;
    const actionVal = (key) => action[key] || defaults.action;

    const onSave = async () => {
        try {
            await save({ permission_modes: perm, action_modes: action }).unwrap();
            dispatch(setSnackbar({ open: true, severity: 'success', message: 'Approval defaults saved — live for new submissions.' }));
        } catch (e) {
            dispatch(setSnackbar({ open: true, severity: 'error', message: e?.data?.error || 'Save failed' }));
        }
    };

    if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    if (error) return <Alert severity="error" sx={{ m: 3 }}>Couldn’t load the approval policy.</Alert>;

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <GavelIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>Approval Matrix — defaults</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Tenant-wide defaults for how a doctor’s changes and actions are approved. Set a section to
                <b> Auto</b> to let the doctor’s change go live immediately, or <b>Manual</b> to require admin
                approval. Override for a specific doctor from their row in <b>View Doctors</b>. Changes here
                apply to new submissions immediately.
            </Typography>

            <HeldActionsPanel />

            {PERMISSION_GROUPS.map((group) => (
                <Paper key={group.title} variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700} gutterBottom>{group.title}</Typography>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><b>Section</b></TableCell>
                                <TableCell><b>Admin → Doctor</b></TableCell>
                                <TableCell align="right"><b>Any pending for approval</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {group.rows.map((row) => (
                                <TableRow key={row.key}>
                                    <TableCell>
                                        {row.label}{!row.wired && <NotWired />}
                                    </TableCell>
                                    <TableCell>
                                        <ToggleButtonGroup exclusive size="small" value={permVal(row.key)}
                                            onChange={(_, v) => v && setPerm((p) => ({ ...p, [row.key]: v }))}>
                                            {PERMISSION_OPTIONS.map((o) => (
                                                <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', px: 1.5 }}>{o.label}</ToggleButton>
                                            ))}
                                        </ToggleButtonGroup>
                                    </TableCell>
                                    <TableCell align="right"><CountChips c={counts[row.key]} /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Paper>
            ))}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>Doctor Approval — action mode</Typography>
                <Typography variant="caption" color="text.secondary">
                    The doctor’s own operating mode, set directly by the admin.
                </Typography>
                <Table size="small" sx={{ mt: 1 }}>
                    <TableBody>
                        {ACTION_ROWS.map((row) => (
                            <TableRow key={row.key}>
                                <TableCell sx={{ width: '45%' }}>{row.label}{!row.wired && <NotWired />}</TableCell>
                                <TableCell>
                                    <ToggleButtonGroup exclusive size="small" value={actionVal(row.key)}
                                        onChange={(_, v) => v && setAction((a) => ({ ...a, [row.key]: v }))}>
                                        {ACTION_OPTIONS.map((o) => (
                                            <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', px: 1.5 }}>{o.label}</ToggleButton>
                                        ))}
                                    </ToggleButtonGroup>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Paper>

            <Divider sx={{ mb: 2 }} />
            <Stack direction="row" justifyContent="flex-end">
                <Button variant="contained" onClick={onSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save defaults'}
                </Button>
            </Stack>
        </Box>
    );
}
