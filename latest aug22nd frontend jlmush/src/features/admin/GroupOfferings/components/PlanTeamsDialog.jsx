/**
 * PlanTeamsDialog — admin manages the TEAMS that fulfil a Group Offering plan.
 * The admin assigns a doctor + fee (+ payout installment schedule) to each of
 * the plan's slots, marks a lead, and creates the team. Doctors then accept /
 * reject; once all accept the admin approves it → bookable. Multiple teams can
 * fulfil one plan.
 */
import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
    Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Paper,
    Chip, Stack, Divider, TextField, MenuItem, Select, FormControl, Radio,
    IconButton, Snackbar, Alert, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { store } from '../../../../app/store';
import { apiSlice } from '../../../../app/api/apiSlice';
import {
    useGetPlanTeamsQuery,
    useCreatePlanTeamMutation,
    useApprovePlanTeamMutation,
    useDeletePlanTeamMutation,
} from '../../api/groupOfferingEndpoints';

const inr = (v) => `₹${Number(v || 0).toLocaleString()}`;
const STATUS_COLOR = { awaiting_members: 'info', pending: 'warning', approved: 'success', rejected: 'error' };

// Fetch the doctors eligible for a saved slot (matched against its full
// eligibility — specializations + work-quals + experience) on demand.
const fetchCandidates = async (memberId) => {
    if (!memberId) return [];
    try {
        const res = await store.dispatch(
            apiSlice.endpoints.getQualificationCandidates.initiate({ memberId }),
        ).unwrap();
        return res || [];
    } catch { return []; }
};

// Readable slot label from its eligibility (falls back to the legacy name).
const slotLabel = (s) => {
    const e = s.eligibility || {};
    const names = [...(e.specialization_names || []), ...(e.work_qualification_names || [])]
        .filter(Boolean);
    return names.join(' / ') || s.qualification_name || 'Slot';
};

const PlanTeamsDialog = ({ offering, open, onClose }) => {
    const offeringId = offering?.id;
    const { data: teams = [], isLoading } = useGetPlanTeamsQuery(offeringId, { skip: !open || !offeringId });
    const [createTeam] = useCreatePlanTeamMutation();
    const [approveTeam] = useApprovePlanTeamMutation();
    const [deleteTeam] = useDeletePlanTeamMutation();

    const [creating, setCreating] = useState(false);
    const [rows, setRows] = useState([]);           // one per slot: {slotId, name, budget, doctor_id, fee, installments}
    const [candMap, setCandMap] = useState({});     // slotId -> [{id,name}]
    const [leadDoctor, setLeadDoctor] = useState('');
    const [groupPrice, setGroupPrice] = useState('');   // this team's patient price
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const notify = (m, s = 'info') => setSnackbar({ open: true, message: m, severity: s });

    const startCreate = async () => {
        const slots = offering?.members || [];
        const map = {};
        await Promise.all(slots.map(async (s) => { map[s.id] = await fetchCandidates(s.id); }));
        setCandMap(map);
        setRows(slots.map((s) => ({
            slotId: s.id, name: slotLabel(s), budget: Number(s.allocated_budget || 0),
            doctor_id: '', fee: Number(s.allocated_budget || 0),
            installments: [{ payment_type: 'percentage', percentage: 100, period_label: 'On completion', due_after_days: 0 }],
        })));
        setLeadDoctor('');
        setGroupPrice(String(offering?.patient_price ?? ''));
        setCreating(true);
    };

    const setRow = (slotId, patch) => setRows((rs) => rs.map((r) => (r.slotId === slotId ? { ...r, ...patch } : r)));
    const addInst = (slotId) => setRow(slotId, {
        installments: [...(rows.find((r) => r.slotId === slotId).installments),
            { payment_type: 'fixed', amount: 0, period_label: 'After 30 days', due_after_days: 30 }],
    });
    const setInst = (slotId, idx, patch) => {
        const r = rows.find((x) => x.slotId === slotId);
        setRow(slotId, { installments: r.installments.map((i, n) => (n === idx ? { ...i, ...patch } : i)) });
    };
    const removeInst = (slotId, idx) => {
        const r = rows.find((x) => x.slotId === slotId);
        setRow(slotId, { installments: r.installments.filter((_, n) => n !== idx) });
    };

    const submit = async () => {
        // A team must fill EVERY slot — a plan is only deliverable when the whole
        // multidisciplinary team is assembled, not a single doctor.
        const unfilled = rows.filter((r) => !r.doctor_id);
        if (unfilled.length) {
            notify(`Assign a doctor to every slot (${unfilled.length} still empty)`, 'warning');
            return;
        }
        const members = rows.map((r) => ({
            doctor_id: r.doctor_id,
            group_offering_member_id: r.slotId,
            allocated_fee: Number(r.fee) || 0,
            payout_installments: r.installments.map((i, idx) => ({
                installment_no: idx + 1,
                payment_type: i.payment_type,
                amount: i.payment_type === 'fixed' ? Number(i.amount) || 0 : null,
                percentage: i.payment_type === 'percentage' ? Number(i.percentage) || 0 : null,
                // Label is derived from the numeric days — no free text.
                period_label: (Number(i.due_after_days) || 0) > 0
                    ? `After ${Number(i.due_after_days)} days` : 'On completion',
                due_after_days: Number(i.due_after_days) || 0,
            })),
        }));
        if (!leadDoctor) { notify('Pick a lead doctor', 'warning'); return; }
        const priceNum = Number(groupPrice);
        if (!(priceNum >= 0)) { notify('Enter a valid patient price', 'warning'); return; }
        const feeTotal = members.reduce((s, m) => s + (Number(m.allocated_fee) || 0), 0);
        if (feeTotal > priceNum + 1e-6) {
            notify(`Doctor fees (${inr(feeTotal)}) exceed this team's price (${inr(priceNum)})`, 'warning');
            return;
        }
        try {
            await createTeam({
                offeringId, lead_doctor_id: leadDoctor, members,
                group_price: priceNum,
            }).unwrap();
            notify('Team created — doctors invited', 'success');
            setCreating(false);
        } catch (e) { notify(e?.data?.message || e?.data?.error || 'Create failed', 'error'); }
    };

    const doApprove = async (teamId) => {
        try { await approveTeam({ teamId, offeringId }).unwrap(); notify('Team approved', 'success'); }
        catch (e) { notify(e?.data?.message || e?.data?.error || 'Approve failed', 'error'); }
    };
    const doDelete = async (teamId) => {
        if (!window.confirm('Delete this team?')) return;
        try { await deleteTeam({ teamId, offeringId }).unwrap(); notify('Team deleted', 'success'); }
        catch (e) { notify(e?.data?.message || 'Delete failed', 'error'); }
    };

    useEffect(() => { if (!open) setCreating(false); }, [open]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Teams — {offering?.name}</DialogTitle>
            <DialogContent dividers>
                {!creating ? (
                    <>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                            <Typography variant="body2" color="text.secondary">
                                Each team (lead + members) fulfils this plan. Patients pick a team.
                            </Typography>
                            <Button startIcon={<AddIcon />} variant="contained" onClick={startCreate}>Add Team</Button>
                        </Stack>
                        {isLoading ? (
                            <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>
                        ) : teams.length === 0 ? (
                            <Alert severity="info">No teams yet. Add one to make this plan bookable.</Alert>
                        ) : (
                            <TableContainer component={Paper}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell><b>Lead</b></TableCell>
                                            <TableCell><b>Doctors</b></TableCell>
                                            <TableCell align="right"><b>Price</b></TableCell>
                                            <TableCell><b>Status</b></TableCell>
                                            <TableCell align="center"><b>Actions</b></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {teams.map((t) => (
                                            <TableRow key={t.id}>
                                                <TableCell>{t.lead_name || '—'}</TableCell>
                                                <TableCell>
                                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                                        {(t.members || []).map((m) => (
                                                            <Chip key={m.id} size="small" variant="outlined"
                                                                label={`${m.doctor_name}${m.role === 'lead' ? ' (lead)' : ''} · ${m.status}`}
                                                                color={m.status === 'accepted' ? 'success' : m.status === 'declined' ? 'error' : 'default'} />
                                                        ))}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell align="right">{inr(t.group_price)}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={(t.approval_status || '').replace('_', ' ')}
                                                        color={STATUS_COLOR[t.approval_status] || 'default'} />
                                                </TableCell>
                                                <TableCell align="center">
                                                    {t.approval_status === 'pending' && (
                                                        <IconButton size="small" color="success" onClick={() => doApprove(t.id)}>
                                                            <CheckCircleIcon fontSize="small" />
                                                        </IconButton>
                                                    )}
                                                    <IconButton size="small" color="error" onClick={() => doDelete(t.id)}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </>
                ) : (
                    <>
                        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
                            <TextField
                                size="small" type="number" label="Price to patient (₹)"
                                value={groupPrice} onChange={(e) => setGroupPrice(e.target.value)}
                                sx={{ width: 200 }}
                                helperText="This team's own price — can differ per team."
                            />
                        </Stack>
                        <Typography variant="subtitle2" gutterBottom>Assign a doctor to each slot (pick the lead)</Typography>
                        {rows.map((r) => (
                            <Paper key={r.slotId} variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
                                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                                    <Typography sx={{ minWidth: 120 }} fontWeight={600}>{r.name}</Typography>
                                    <FormControl size="small" sx={{ minWidth: 180 }}>
                                        <Select displayEmpty value={r.doctor_id}
                                            onChange={(e) => setRow(r.slotId, { doctor_id: e.target.value })}>
                                            <MenuItem value=""><em>Pick doctor</em></MenuItem>
                                            {(candMap[r.slotId] || []).map((c) => (
                                                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <TextField size="small" type="number" label={`Fee (≤ ${inr(r.budget)})`} sx={{ width: 150 }}
                                        value={r.fee} onChange={(e) => setRow(r.slotId, { fee: e.target.value })} />
                                    <Stack direction="row" alignItems="center">
                                        <Radio size="small" checked={leadDoctor === r.doctor_id && !!r.doctor_id}
                                            disabled={!r.doctor_id} onChange={() => setLeadDoctor(r.doctor_id)} />
                                        <Typography variant="caption">Lead</Typography>
                                    </Stack>
                                </Stack>
                                <Divider sx={{ my: 1 }} />
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" color="text.secondary">Payout installments (≤ fee)</Typography>
                                    <Button size="small" startIcon={<AddIcon />} onClick={() => addInst(r.slotId)}>Add</Button>
                                </Stack>
                                {r.installments.map((i, idx) => (
                                    <Stack key={idx} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                                        <Select size="small" value={i.payment_type} sx={{ minWidth: 110 }}
                                            onChange={(e) => setInst(r.slotId, idx, { payment_type: e.target.value })}>
                                            <MenuItem value="percentage">%</MenuItem>
                                            <MenuItem value="fixed">₹ fixed</MenuItem>
                                        </Select>
                                        {i.payment_type === 'percentage' ? (
                                            <TextField size="small" type="number" sx={{ width: 90 }} value={i.percentage}
                                                onChange={(e) => setInst(r.slotId, idx, { percentage: e.target.value })} />
                                        ) : (
                                            <TextField size="small" type="number" sx={{ width: 110 }} value={i.amount}
                                                onChange={(e) => setInst(r.slotId, idx, { amount: e.target.value })} />
                                        )}
                                        <TextField size="small" type="number" sx={{ width: 130 }} label="Pay after (days)" value={i.due_after_days}
                                            onChange={(e) => setInst(r.slotId, idx, { due_after_days: e.target.value })} />
                                        <IconButton size="small" color="error" onClick={() => removeInst(r.slotId, idx)}><DeleteIcon fontSize="small" /></IconButton>
                                    </Stack>
                                ))}
                            </Paper>
                        ))}
                    </>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                {creating ? (
                    <>
                        <Button onClick={() => setCreating(false)}>Back</Button>
                        <Button variant="contained" onClick={submit}>Create Team</Button>
                    </>
                ) : (
                    <Button onClick={onClose}>Close</Button>
                )}
            </DialogActions>
            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Dialog>
    );
};

export default PlanTeamsDialog;
