/**
 * MyPlanTeams — the doctor's Group Offering plan-team memberships + earnings.
 * Shows ONLY the doctor's own fee + installment schedule (never other members'),
 * plus accept / reject for pending invitations.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Paper, Stack, Chip, Button, Table, TableHead, TableRow,
    TableCell, TableBody, CircularProgress, Alert, Snackbar, Divider,
    Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';

import {
    useGetMyPlanTeamsQuery,
    useRespondGroupInviteMutation,
} from '../../../../marketplace/api/marketplaceApi';

const inr = (v) => `₹${Number(v || 0).toLocaleString()}`;
const STATUS_COLOR = { invited: 'warning', accepted: 'success', declined: 'error' };
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

// Modes a slot allows, as a compact "Video 15–30 min" style summary.
const modeSummary = (s) => {
    const parts = [];
    if (s.video_enabled) parts.push(`Video ${s.video_min_duration ?? '—'}–${s.video_max_duration ?? '—'} min`);
    if (s.voice_enabled) parts.push(`Voice ${s.voice_min_duration ?? '—'}–${s.voice_max_duration ?? '—'} min`);
    if (s.chat_enabled) parts.push('Chat');
    return parts.length ? parts.join(' · ') : '—';
};

// The admin-configured constraints the doctor is allowed to see (no other
// members' fees) — duration, working hours, description, per-slot limits.
const PlanDetailsDialog = ({ open, onClose, membership }) => {
    const d = membership?.plan_details;
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>{membership?.plan_name || 'Plan'} — details</DialogTitle>
            <DialogContent dividers>
                {!d ? (
                    <Typography color="text.secondary">No plan details available.</Typography>
                ) : (
                    <Stack spacing={2}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {d.duration_value != null && <Chip label={`Duration: ${d.duration_value} days`} />}
                            {d.total_consultations != null && <Chip label={`Total consultations: ${d.total_consultations}`} variant="outlined" />}
                            {d.doctors_included != null && <Chip label={`Doctors: ${d.doctors_included}`} variant="outlined" />}
                            <Chip label={`Patient price ${inr(membership?.patient_price)}`} color="primary" variant="outlined" />
                            <Chip label={`My fee ${inr(membership?.my_fee)}`} color="primary" />
                        </Stack>
                        {d.description && (
                            <Box>
                                <Typography variant="subtitle2">Description</Typography>
                                <Typography variant="body2" color="text.secondary">{d.description}</Typography>
                            </Box>
                        )}
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>Consultation slots (what's included)</Typography>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><b>Qualification</b></TableCell>
                                        <TableCell><b>Consultations</b></TableCell>
                                        <TableCell><b>Modes allowed</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {(d.slots || []).map((s, i) => (
                                        <TableRow key={i}>
                                            <TableCell>{s.qualification_name || '—'}</TableCell>
                                            <TableCell>{(s.min_consultations ?? '—')}–{(s.max_consultations ?? '—')}</TableCell>
                                            <TableCell>{modeSummary(s)}</TableCell>
                                        </TableRow>
                                    ))}
                                    {(d.slots || []).length === 0 && (
                                        <TableRow><TableCell colSpan={3}>No slots configured.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </Box>
                        {d.working_hours && Object.keys(d.working_hours).length > 0 && (
                            <Box>
                                <Typography variant="subtitle2" gutterBottom>Working hours</Typography>
                                <Stack spacing={0.5}>
                                    {DAYS.map(([key, label]) => {
                                        const wh = d.working_hours[key];
                                        return (
                                            <Typography key={key} variant="body2" color="text.secondary">
                                                {label}: {!wh || wh.closed ? 'Closed' : `${wh.open || '—'} – ${wh.close || '—'}`}
                                            </Typography>
                                        );
                                    })}
                                </Stack>
                            </Box>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </Dialog>
    );
};


const MyPlanTeams = () => {
    const { data: memberships = [], isLoading } = useGetMyPlanTeamsQuery();
    const [respond] = useRespondGroupInviteMutation();
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [detailsFor, setDetailsFor] = useState(null);
    const notify = (m, s = 'info') => setSnackbar({ open: true, message: m, severity: s });

    const doRespond = async (teamId, accept) => {
        try {
            await respond({ id: teamId, accept }).unwrap();
            notify(accept ? 'Invitation accepted' : 'Invitation declined', accept ? 'success' : 'info');
        } catch (e) {
            notify(e?.data?.error || e?.data?.message || 'Failed', 'error');
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>My Plan Teams</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
                Group offering plans you're part of — your fee and payout schedule. You only see your own.
            </Typography>

            {isLoading ? (
                <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
            ) : memberships.length === 0 ? (
                <Alert severity="info">You're not part of any plan teams yet.</Alert>
            ) : (
                <Stack spacing={2}>
                    {memberships.map((m) => (
                        <Paper key={m.membership_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                                <Box>
                                    <Typography variant="h6" fontWeight={700}>{m.plan_name || 'Plan'}</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Patient price {inr(m.patient_price)} · your role: {m.role}
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Chip size="small" label={`My fee ${inr(m.my_fee)}`} color="primary" />
                                    <Chip size="small" label={(m.status || '').toUpperCase()} color={STATUS_COLOR[m.status] || 'default'} />
                                    <Button size="small" variant="outlined" onClick={() => setDetailsFor(m)}>View details</Button>
                                    {m.status === 'invited' && (
                                        <>
                                            <Button size="small" variant="contained" color="success" onClick={() => doRespond(m.team_id, true)}>Accept</Button>
                                            <Button size="small" variant="outlined" color="error" onClick={() => doRespond(m.team_id, false)}>Reject</Button>
                                        </>
                                    )}
                                </Stack>
                            </Stack>
                            {(m.my_installments || []).length > 0 && (
                                <>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="subtitle2" gutterBottom>My payout schedule</Typography>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell><b>#</b></TableCell>
                                                <TableCell><b>Amount</b></TableCell>
                                                <TableCell><b>Period</b></TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {m.my_installments.map((i) => (
                                                <TableRow key={i.id}>
                                                    <TableCell>{i.installment_no}</TableCell>
                                                    <TableCell>
                                                        {i.payment_type === 'percentage' ? `${i.percentage}%` : inr(i.amount)}
                                                        {` (${inr(i.resolved_amount)})`}
                                                    </TableCell>
                                                    <TableCell>{i.period_label || `After ${i.due_after_days} days`}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </>
                            )}
                        </Paper>
                    ))}
                </Stack>
            )}

            <PlanDetailsDialog open={!!detailsFor} membership={detailsFor} onClose={() => setDetailsFor(null)} />

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default MyPlanTeams;
