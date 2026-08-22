/**
 * HealthPlans — patient browsing + booking of admin-authored Group Offering
 * plans, and managing their booked plans' installment payments.
 *
 * Tax is included in the plan price (carved out of the doctors' budget), so the
 * patient always pays the plain plan price — no tax added on top.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, Paper, Grid, Card, CardContent, Chip, Stack,
    Divider, Tabs, Tab, Dialog, DialogTitle, DialogContent, DialogActions,
    Table, TableHead, TableRow, TableCell, TableBody, CircularProgress,
    Snackbar, Alert, List, ListItem, ListItemText,
    RadioGroup, Radio, FormControlLabel,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import PaidIcon from '@mui/icons-material/Paid';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import {
    useBrowseGroupOfferingsQuery,
    useGetMyGroupOfferingBookingsQuery,
    useGetGroupOfferingTeamsQuery,
    useBookGroupOfferingMutation,
    useLinkAppointmentContextMutation,
} from '../../../api/scopedBookingApi';
import usePatientCheckout from '../../../api/usePatientCheckout';
import BookingIntakeBar from '../../../components/BookingIntakeBar/BookingIntakeBar';
import OfferingFeatures from '../../../components/OfferingFeatures/OfferingFeatures';
import CreditRedeem from '../../../components/CreditRedeem/CreditRedeem';
import { useNavigate } from 'react-router-dom';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';

const DURATION_LABEL = {
    '15_days': '15 Days', '1_month': '1 Month', '3_months': '3 Months',
    '6_months': '6 Months', '12_months': '12 Months',
};
const durationText = (o) => DURATION_LABEL[o.duration_type] || `${o.duration_value} Days`;
const inr = (v) => `₹${Number(v || 0).toLocaleString()}`;
const STATUS_COLOR = {
    pending_payment: 'warning', pending_acceptance: 'warning',
    active: 'success', completed: 'info', cancelled: 'default',
};
// Lifecycle buckets for "My Plans", mirroring the service order list.
const PLAN_BUCKETS = [
    { key: 'all', label: 'All', match: () => true },
    { key: 'pending', label: 'Pending', match: (s) => s === 'pending_payment' || s === 'pending_acceptance' },
    { key: 'active', label: 'In Process', match: (s) => s === 'active' },
    { key: 'completed', label: 'Completed', match: (s) => s === 'completed' },
    { key: 'cancelled', label: 'Cancelled', match: (s) => s === 'cancelled' },
];

const HealthPlans = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const [tab, setTab] = useState(0);
    const [planFilter, setPlanFilter] = useState('all');
    const { data: plans = [], isLoading: plansLoading } = useBrowseGroupOfferingsQuery();
    const { data: bookings = [], isLoading: bookingsLoading, refetch: refetchBookings } = useGetMyGroupOfferingBookingsQuery();
    const [bookPlan] = useBookGroupOfferingMutation();
    // Razorpay for the patient; an audited offline settlement when a
    // super-admin is booking on their behalf from Operations.
    const { checkout, isOps, markAsPaid } = usePatientCheckout();

    // "My Plans" filtered by the active lifecycle bucket.
    const activeBucket = PLAN_BUCKETS.find((x) => x.key === planFilter) || PLAN_BUCKETS[0];
    const shownBookings = bookings.filter((b) => activeBucket.match(b.status));

    const [bookPlanLink] = useLinkAppointmentContextMutation();
    const [detail, setDetail] = useState(null); // plan being viewed
    const [selectedTeam, setSelectedTeam] = useState('');
    const [intakeContextId, setIntakeContextId] = useState(null);
    const [creditsApplied, setCreditsApplied] = useState(0);
    const [busy, setBusy] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });

    const { data: teams = [] } = useGetGroupOfferingTeamsQuery(detail?.id, { skip: !detail });

    const payInstallment = async (installmentId, planName) => {
        setBusy(true);
        try {
            await checkout({
                bookingInstallmentId: installmentId,
                description: `${planName} — installment`,
            });
            notify(
                isOps
                    ? (markAsPaid ? 'Recorded as paid offline' : 'Left unpaid — the patient can pay from their app')
                    : 'Payment successful',
                'success',
            );
            // Refresh so the paid installment flips and the Pay button clears —
            // the generic payment-verify mutation doesn't tag plan bookings.
            await refetchBookings();
            setTab(1);
        } catch (e) {
            notify(e?.message || e?.data?.error || 'Payment failed', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleBook = async (plan) => {
        if (!selectedTeam) { notify('Please pick a care team', 'warning'); return; }
        setBusy(true);
        try {
            const booking = await bookPlan({ id: plan.id, team_id: selectedTeam, redeem_credits: creditsApplied }).unwrap();
            // Attach the intake (book-for / health records) to the group booking.
            if (intakeContextId && booking?.id) {
                try {
                    await bookPlanLink({ contextId: intakeContextId, group_offering_booking_id: booking.id }).unwrap();
                } catch { /* intake is best-effort — don't block payment */ }
            }
            setDetail(null);
            setSelectedTeam('');
            const due = booking?.next_due_installment_id;
            if (due) {
                await payInstallment(due, plan.name);
            } else {
                notify('Plan booked', 'success');
                setTab(1);
            }
        } catch (e) {
            notify(e?.data?.message || e?.data?.error || 'Booking failed', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>Health Plans</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
                Multidisciplinary care plans — a team of specialists under one plan.
            </Typography>

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Available Plans" />
                <Tab label={`My Plans (${bookings.length})`} />
            </Tabs>

            {/* ── Available plans ─────────────────────────────────────────── */}
            {tab === 0 && (
                plansLoading ? (
                    <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
                ) : plans.length === 0 ? (
                    <Alert severity="info">No health plans are available right now.</Alert>
                ) : (
                    <Grid container spacing={2}>
                        {plans.map((p) => (
                            <Grid item xs={12} md={6} lg={4} key={p.id}>
                                <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                                    <CardContent>
                                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                            <Typography variant="h6" fontWeight={700}>{p.name}</Typography>
                                            <Chip size="small" label={p.category} />
                                        </Stack>
                                        <Typography variant="h5" color="primary" fontWeight={800} mt={1}>{inr(p.patient_price)}</Typography>
                                        <Typography variant="caption" color="text.secondary">for {durationText(p)}</Typography>
                                        {p.description && (
                                            <Typography variant="body2" color="text.secondary" mt={1}>{p.description}</Typography>
                                        )}
                                        <Divider sx={{ my: 1.5 }} />
                                        <Stack direction="row" spacing={2}>
                                            <Stack direction="row" spacing={0.5} alignItems="center">
                                                <GroupsIcon fontSize="small" color="action" />
                                                <Typography variant="body2">{p.doctors_included} doctors</Typography>
                                            </Stack>
                                            <Typography variant="body2" color="text.secondary">{p.total_consultations} consultations</Typography>
                                        </Stack>
                                        <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={() => setDetail(p)}>
                                            View &amp; Book
                                        </Button>
                                    </CardContent>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                )
            )}

            {/* ── My plans ────────────────────────────────────────────────── */}
            {tab === 1 && (
                bookingsLoading ? (
                    <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
                ) : bookings.length === 0 ? (
                    <Alert severity="info">You haven't booked any health plans yet.</Alert>
                ) : (
                    <>
                    <Tabs value={planFilter} onChange={(_, v) => setPlanFilter(v)} sx={{ mb: 2 }}
                        variant="scrollable" scrollButtons="auto">
                        {PLAN_BUCKETS.map((bk) => (
                            <Tab key={bk.key} value={bk.key}
                                label={`${bk.label} (${bookings.filter((b) => bk.match(b.status)).length})`} />
                        ))}
                    </Tabs>
                    {shownBookings.length === 0 ? (
                        <Alert severity="info">No plans in this bucket.</Alert>
                    ) : (
                    <Stack spacing={2}>
                        {shownBookings.map((b) => {
                            const nextDue = (b.installments || []).find((i) => i.status !== 'paid');
                            return (
                                <Paper key={b.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                                        <Box>
                                            <Typography variant="h6" fontWeight={700}>{b.plan_name}</Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Paid {inr(b.amount_paid)} of {inr(b.total_payable)}
                                            </Typography>
                                        </Box>
                                        <Chip label={(b.status || '').replace('_', ' ').toUpperCase()} color={STATUS_COLOR[b.status] || 'default'} />
                                    </Stack>
                                    <Table size="small" sx={{ mt: 1 }}>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell><b>#</b></TableCell>
                                                <TableCell><b>Amount</b></TableCell>
                                                <TableCell><b>Due</b></TableCell>
                                                <TableCell><b>Status</b></TableCell>
                                                <TableCell />
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {(b.installments || []).map((i) => (
                                                <TableRow key={i.id}>
                                                    <TableCell>{i.installment_no}{i.is_booking ? ' (booking)' : ''}</TableCell>
                                                    <TableCell>{inr(i.amount)}</TableCell>
                                                    <TableCell>{i.due_label || '—'}</TableCell>
                                                    <TableCell>
                                                        {i.status === 'paid'
                                                            ? <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Paid" />
                                                            : <Chip size="small" color="warning" label="Pending" />}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {i.status !== 'paid' && nextDue && nextDue.id === i.id && (
                                                            <Button size="small" variant="contained" startIcon={<PaidIcon />}
                                                                disabled={busy} onClick={() => payInstallment(i.id, b.plan_name)}>
                                                                Pay {inr(i.amount)}
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                    {(b.documents || []).length > 0 && (
                                        <Box mt={1.5}>
                                            {b.all_docs_uploaded && (
                                                <Chip size="small" color="success" icon={<CheckCircleIcon />}
                                                    label="Plan completed — all documents delivered" sx={{ mb: 1 }} />
                                            )}
                                            <Typography variant="subtitle2" gutterBottom>Documents from your care team</Typography>
                                            <Stack spacing={0.5}>
                                                {b.documents.map((d) => (
                                                    <Stack key={d.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                        <Typography variant="body2">
                                                            {d.doctor_name || 'Doctor'}: {d.file_name || 'Document'}
                                                            {d.note ? ` — ${d.note}` : ''}
                                                        </Typography>
                                                        {d.document_url && (
                                                            <Button size="small" component="a" href={d.document_url}
                                                                target="_blank" rel="noopener">View</Button>
                                                        )}
                                                    </Stack>
                                                ))}
                                            </Stack>
                                        </Box>
                                    )}
                                </Paper>
                            );
                        })}
                    </Stack>
                    )}
                    </>
                )
            )}

            {/* ── Plan detail + book dialog ───────────────────────────────── */}
            <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
                {detail && (
                    <>
                        <DialogTitle>{detail.name}</DialogTitle>
                        <DialogContent dividers>
                            <Typography variant="h5" color="primary" fontWeight={800}>{inr(detail.patient_price)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                for {durationText(detail)} · taxes included
                            </Typography>
                            {detail.description && <Typography variant="body2" mt={1}>{detail.description}</Typography>}

                            {/* Benefits / how it works / essentials linked to this plan. */}
                            <Box sx={{ mt: 2 }}>
                                <OfferingFeatures
                                    offering="group"
                                    productId={detail.backing_product_id}
                                    teamId={selectedTeam || undefined}
                                    variant="plain"
                                    title="Benefits & how it works"
                                />
                            </Box>

                            <Typography variant="subtitle2" mt={2} gutterBottom>What's included</Typography>
                            <List dense disablePadding>
                                {(detail.members || []).map((m) => (
                                    <ListItem key={m.id} disableGutters>
                                        <ListItemText
                                            primary={`${m.qualification_name || 'Specialist'} — ${m.consultation_count} consultation(s)`}
                                            secondary={`${m.min_duration}–${m.max_duration} min each${m.doctor_name ? ` · Dr. ${m.doctor_name}` : ''}`}
                                        />
                                    </ListItem>
                                ))}
                            </List>

                            <Typography variant="subtitle2" mt={2} gutterBottom>Choose your care team</Typography>
                            {teams.length === 0 ? (
                                <Alert severity="info">No teams are available for this plan yet.</Alert>
                            ) : (
                                <RadioGroup value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
                                    {teams.map((t) => (
                                        <FormControlLabel key={t.id} value={t.id} control={<Radio />}
                                            label={
                                                <Box>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        Led by Dr. {t.lead_name || '—'}
                                                        {t.patient_price != null && (
                                                            <Typography component="span" color="primary" sx={{ ml: 1 }}>
                                                                · {inr(t.patient_price)}
                                                            </Typography>
                                                        )}
                                                    </Typography>
                                                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                                                        {(t.doctors || []).map((d) => (
                                                            <Chip
                                                                key={d.doctor_id || d.doctor_name}
                                                                size="small"
                                                                variant="outlined"
                                                                label={`Dr. ${d.doctor_name}`}
                                                                onClick={d.doctor_id ? (e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    navigate(`${basePath}/doctor/${d.doctor_id}`);
                                                                } : undefined}
                                                            />
                                                        ))}
                                                    </Stack>
                                                </Box>
                                            } />
                                    ))}
                                </RadioGroup>
                            )}

                            <Box sx={{ mt: 2 }}>
                                <BookingIntakeBar
                                    consultationType="health_plan"
                                    freshKey={`plan:${detail.id}`}
                                    showFilters={false}
                                    title="Share your details for this plan"
                                    subtitle="Choose who this plan is for and share any health records your care team should see."
                                    onContextReady={setIntakeContextId}
                                />
                            </Box>
                            {selectedTeam && (
                                <Box sx={{ mt: 2 }}>
                                    <CreditRedeem
                                        offering="group"
                                        price={teams.find((t) => t.id === selectedTeam)?.patient_price ?? detail.patient_price}
                                        onChange={setCreditsApplied}
                                    />
                                </Box>
                            )}
                        </DialogContent>
                        <DialogActions sx={{ px: 3, pb: 2 }}>
                            <Button onClick={() => { setDetail(null); setSelectedTeam(''); setCreditsApplied(0); }}>Close</Button>
                            <Button variant="contained" disabled={busy || !selectedTeam} onClick={() => handleBook(detail)}>
                                {busy ? 'Processing…' : `${isOps
                                    ? (markAsPaid ? 'Book & record paid' : 'Book, leave unpaid')
                                    : 'Book & Pay'} ${inr(
                                    Math.max(0, (teams.find((t) => t.id === selectedTeam)?.patient_price
                                    ?? detail.patient_price ?? 0) - creditsApplied)
                                )}`}
                            </Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default HealthPlans;
