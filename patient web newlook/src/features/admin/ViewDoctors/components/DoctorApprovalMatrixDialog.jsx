/**
 * DoctorApprovalMatrixDialog — the per-doctor OVERRIDE of the approval matrix,
 * opened from a doctor's row in View Doctors. Each row can be left on the tenant
 * Default, or overridden to Auto / Manual (permission) or Auto-accept /
 * Auto-reject / Manual (action). Shows the effective (resolved) mode and the
 * per-section pending/accepted/rejected/query counts.
 */
import { useEffect, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Stack,
    Chip, Button, Table, TableHead, TableBody, TableRow, TableCell,
    ToggleButtonGroup, ToggleButton, CircularProgress,
} from '@mui/material';
import {
    useGetDoctorApprovalModesQuery,
    useUpdateDoctorApprovalModesMutation,
} from '../../api/doctorsEndpoints';
import {
    PERMISSION_GROUPS, ACTION_ROWS, PERMISSION_OPTIONS, ACTION_OPTIONS, COUNT_KEYS,
} from '../../Approvals/constants/approvalMatrix';

const withDefault = (opts) => [{ value: 'default', label: 'Default' }, ...opts];

const CountChips = ({ c }) => (
    <Stack direction="row" spacing={0.5}>
        {COUNT_KEYS.map(([k, lbl, color]) => (
            <Chip key={k} size="small" variant="outlined" color={c?.[k] ? color : 'default'}
                label={`${lbl.slice(0, 3)} ${c?.[k] || 0}`} sx={{ height: 20 }} />
        ))}
    </Stack>
);

export default function DoctorApprovalMatrixDialog({ open, onClose, doctorId, doctorName }) {
    const { data, isFetching } = useGetDoctorApprovalModesQuery(doctorId, { skip: !open || !doctorId });
    const [save, { isLoading: saving }] = useUpdateDoctorApprovalModesMutation();

    const [perm, setPerm] = useState({});
    const [action, setAction] = useState({});

    useEffect(() => {
        if (data) {
            setPerm({ ...(data.override?.permission_modes || {}) });
            setAction({ ...(data.override?.action_modes || {}) });
        }
    }, [data]);

    const eff = data?.effective || {};
    const counts = data?.counts || {};
    const permVal = (k) => perm[k] || 'default';
    const actionVal = (k) => action[k] || 'default';

    const onSave = async () => {
        // Send every key's current selection; 'default' clears the override
        // server-side (falls back to the tenant default).
        await save({ doctorId, permission_modes: perm, action_modes: action }).unwrap().catch(() => {});
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Approval overrides — {doctorName}</DialogTitle>
            <DialogContent dividers>
                {isFetching ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Leave a row on <b>Default</b> to follow the tenant policy, or override it for this
                            doctor. The <b>Effective</b> column shows what actually applies.
                        </Typography>
                        {PERMISSION_GROUPS.map((group) => (
                            <Box key={group.title} sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" fontWeight={700} gutterBottom>{group.title}</Typography>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell><b>Section</b></TableCell>
                                            <TableCell><b>Override</b></TableCell>
                                            <TableCell><b>Effective</b></TableCell>
                                            <TableCell align="right"><b>Pending / etc.</b></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {group.rows.map((row) => (
                                            <TableRow key={row.key}>
                                                <TableCell>{row.label}</TableCell>
                                                <TableCell>
                                                    <ToggleButtonGroup exclusive size="small" value={permVal(row.key)}
                                                        onChange={(_, v) => v && setPerm((p) => ({ ...p, [row.key]: v }))}>
                                                        {withDefault(PERMISSION_OPTIONS).map((o) => (
                                                            <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', px: 1.25 }}>{o.label}</ToggleButton>
                                                        ))}
                                                    </ToggleButtonGroup>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={eff.permission_modes?.[row.key] || '—'}
                                                        color={eff.permission_modes?.[row.key] === 'auto' ? 'success' : 'default'} />
                                                </TableCell>
                                                <TableCell align="right"><CountChips c={counts[row.key]} /></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                        ))}
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Doctor Approval — action mode</Typography>
                        <Table size="small">
                            <TableBody>
                                {ACTION_ROWS.map((row) => (
                                    <TableRow key={row.key}>
                                        <TableCell sx={{ width: '40%' }}>{row.label}</TableCell>
                                        <TableCell>
                                            <ToggleButtonGroup exclusive size="small" value={actionVal(row.key)}
                                                onChange={(_, v) => v && setAction((a) => ({ ...a, [row.key]: v }))}>
                                                {withDefault(ACTION_OPTIONS).map((o) => (
                                                    <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', px: 1.25 }}>{o.label}</ToggleButton>
                                                ))}
                                            </ToggleButtonGroup>
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="small" label={eff.action_modes?.[row.key] || '—'} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onSave} disabled={saving || isFetching}>
                    {saving ? 'Saving…' : 'Save overrides'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
