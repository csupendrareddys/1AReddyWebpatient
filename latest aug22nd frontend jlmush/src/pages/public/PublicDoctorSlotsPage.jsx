/**
 * PublicDoctorSlotsPage — slot picker + booking form at
 * ``/book/<consultationType>/doctor/<doctorId>``.
 *
 * Two-column layout:
 *   * LEFT: date picker + slot grid (filtered by consultation_type).
 *     Slots fetched from the public timeslot endpoint; the page
 *     refreshes every minute so the visitor doesn't see stale slots
 *     after sitting on the page.
 *   * RIGHT: contact form (name, phone, email, DOB, optional
 *     description). Submit calls ``/initiate``, opens Razorpay's
 *     checkout, then on success calls ``/verify`` and routes to the
 *     confirmation screen.
 *
 * Razorpay's checkout SDK script is loaded on demand the first time
 * the visitor clicks "Pay & Book" — keeps the landing-page bundle lean
 * for the (much larger) audience that never starts a booking.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
    Box, Container, Typography, Grid2 as Grid, Paper, TextField, Button, Stack,
    Skeleton, Alert, Chip, useTheme, alpha, CircularProgress,
} from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import { CONSULTATION_TYPES } from '../../features/service-provider/ProfileSetting/constants/consultationTypes';
import {
    useGetPublicDoctorTimeslotsQuery,
    useInitiatePublicBookingMutation,
    useVerifyPublicBookingMutation,
} from '../../features/publicBooking/publicBookingApi';
import { loadRazorpayScript } from '../../utils/loadRazorpayScript';
import { todayLocalDateString } from '../../common/utils/date';

const todayIso = () => todayLocalDateString();

export default function PublicDoctorSlotsPage() {
    return (
        <PublicLandingLayout>
            <PublicDoctorSlotsContent />
        </PublicLandingLayout>
    );
}

function PublicDoctorSlotsContent() {
    const { consultationType, doctorId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();

    // Doctor card (with price_range) passed from the list page so we can show
    // pricing here too. Optional — a direct URL hit just won't show it.
    const passedDoctor = location.state?.doctor || null;

    const ctMeta = CONSULTATION_TYPES.find((c) => c.value === consultationType);

    const [date, setDate] = useState(todayIso());
    const [selectedSlotId, setSelectedSlotId] = useState(null);
    const [form, setForm] = useState({
        name: '', phone_number: '', email: '', dob: '', description: '',
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const { data: slots = [], isFetching, refetch } = useGetPublicDoctorTimeslotsQuery({
        doctorId, date, consultationType,
    });

    const [initiateBooking] = useInitiatePublicBookingMutation();
    const [verifyBooking] = useVerifyPublicBookingMutation();

    // Auto-refresh slot list every 60s so race-condition losers don't
    // sit on stale availability. Cleared on unmount.
    useEffect(() => {
        const id = setInterval(() => refetch(), 60_000);
        return () => clearInterval(id);
    }, [refetch]);

    const formError = useMemo(() => {
        if (!form.name.trim()) return 'Name is required.';
        if (!form.phone_number.trim()) return 'Phone number is required.';
        if (!/^\+?[0-9\s-]{8,20}$/.test(form.phone_number.trim())) {
            return 'Phone number looks invalid.';
        }
        if (!selectedSlotId) return 'Please select a slot.';
        return null;
    }, [form, selectedSlotId]);

    const handlePayAndBook = async () => {
        setError('');
        if (formError) {
            setError(formError);
            return;
        }
        setBusy(true);

        try {
            // 1. Pre-lock + Razorpay order
            const initResp = await initiateBooking({
                ...form,
                email: form.email || null,
                dob: form.dob || null,
                description: form.description || null,
                doctor_id: doctorId,
                time_slot_id: selectedSlotId,
                consultation_type: consultationType,
                dateKey: date,  // for cache-tag invalidation only
            }).unwrap();

            const data = initResp?.data || initResp;
            const {
                pending_id, razorpay_order_id, key_id, amount_paise,
                currency, name, phone_number, email,
            } = data;

            // 2. Razorpay checkout
            const ok = await loadRazorpayScript();
            if (!ok || !window.Razorpay) {
                throw new Error('Could not load the payment SDK. Please retry.');
            }

            await new Promise((resolve, reject) => {
                const rzp = new window.Razorpay({
                    key: key_id,
                    amount: amount_paise,
                    currency: currency || 'INR',
                    name: 'Consultation Booking',
                    order_id: razorpay_order_id,
                    prefill: {
                        name,
                        contact: phone_number,
                        email: email || undefined,
                    },
                    handler: async (rzpResponse) => {
                        try {
                            // 3. Verify on the server. The server creates
                            // the User + Appointment if signature checks
                            // out and the slot is still ours.
                            const verifyResp = await verifyBooking({
                                pending_id,
                                razorpay_order_id: rzpResponse.razorpay_order_id,
                                razorpay_payment_id: rzpResponse.razorpay_payment_id,
                                razorpay_signature: rzpResponse.razorpay_signature,
                            }).unwrap();

                            const verifyData = verifyResp?.data || verifyResp;

                            // Park the result in sessionStorage so the
                            // confirmation page can render it without a
                            // round-trip; nothing sensitive is stored.
                            sessionStorage.setItem('publicBookingResult', JSON.stringify({
                                ...verifyData,
                                doctorId,
                                consultationType,
                            }));
                            navigate('/book/confirmation');
                            resolve();
                        } catch (verifyErr) {
                            reject(verifyErr);
                        }
                    },
                    modal: {
                        ondismiss: () => {
                            // User closed the Razorpay modal without
                            // paying. Pre-lock will lapse on its own
                            // in 15 min.
                            reject(new Error('Payment cancelled.'));
                        },
                    },
                });
                rzp.open();
            });
        } catch (err) {
            setError(extractError(err) || 'Booking failed. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box>
            <Box
                sx={{
                    py: { xs: 4, md: 6 }, px: { xs: 2, sm: 3 },
                    background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, transparent 100%)`,
                }}
            >
                <Container maxWidth="lg">
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2, fontSize: '0.7rem' }}
                    >
                        {ctMeta?.label || 'Consultation'}
                    </Typography>
                    <Typography
                        variant="h3" fontWeight={800}
                        sx={{
                            letterSpacing: '-0.02em',
                            fontSize: { xs: '1.65rem', sm: '2rem', md: '2.25rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        Pick a slot &amp; complete booking
                    </Typography>
                    {/* Pricing carried over from the doctor card — same tiers
                        the after-login booking shows. A doctor may offer
                        several slots at different prices. */}
                    {passedDoctor && (
                        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
                            {Array.isArray(passedDoctor.price_range) && passedDoctor.price_range.length > 0 ? (
                                passedDoctor.price_range.map((t, i) => (
                                    <Chip
                                        key={i}
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        label={`${t.range ? `${t.range} · ` : ''}₹${t.price}${t.description ? ` — ${t.description}` : ''}`}
                                    />
                                ))
                            ) : passedDoctor.consultation_fee != null && (
                                <Chip size="small" color="primary" variant="outlined"
                                    label={`₹${passedDoctor.consultation_fee}`} />
                            )}
                        </Stack>
                    )}
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        We'll create your patient account automatically after payment — no signup form upfront.
                    </Typography>
                </Container>
            </Box>

            <Box sx={{ py: { xs: 4, md: 6 }, px: { xs: 2, sm: 3 } }}>
                <Container maxWidth="lg">
                    <Grid container spacing={{ xs: 3, md: 4 }}>
                        {/* LEFT: slot picker */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3 }} variant="outlined">
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                                    <EventAvailableIcon color="primary" />
                                    <Typography variant="h6" fontWeight={700}>Available slots</Typography>
                                </Stack>
                                <TextField
                                    type="date"
                                    label="Date"
                                    value={date}
                                    onChange={(e) => {
                                        setDate(e.target.value);
                                        setSelectedSlotId(null);
                                    }}
                                    fullWidth
                                    InputLabelProps={{ shrink: true }}
                                    inputProps={{ min: todayIso() }}
                                    size="small"
                                    sx={{ mb: 2 }}
                                />

                                {isFetching ? (
                                    <Stack direction="row" flexWrap="wrap" gap={1}>
                                        {[0, 1, 2, 3, 4, 5].map((i) => (
                                            <Skeleton key={i} variant="rounded" width={80} height={36} />
                                        ))}
                                    </Stack>
                                ) : slots.length === 0 ? (
                                    <Alert severity="info">
                                        No slots open on this date. Try a different day.
                                    </Alert>
                                ) : (
                                    <Stack direction="row" flexWrap="wrap" gap={1}>
                                        {slots.map((s) => (
                                            <Chip
                                                key={s.id}
                                                label={s.duration ? `${s.start} · ${s.duration}m` : s.start}
                                                clickable
                                                color={selectedSlotId === s.id ? 'primary' : 'default'}
                                                variant={selectedSlotId === s.id ? 'filled' : 'outlined'}
                                                onClick={() => setSelectedSlotId(s.id)}
                                                sx={{ fontWeight: 600 }}
                                            />
                                        ))}
                                    </Stack>
                                )}
                            </Paper>
                        </Grid>

                        {/* RIGHT: form + pay button */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3 }} variant="outlined">
                                <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
                                    Your details
                                </Typography>
                                <Stack spacing={2}>
                                    <TextField
                                        size="small" fullWidth required
                                        label="Full name"
                                        value={form.name}
                                        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                    />
                                    <TextField
                                        size="small" fullWidth required
                                        label="Phone number"
                                        value={form.phone_number}
                                        onChange={(e) => setForm((p) => ({ ...p, phone_number: e.target.value }))}
                                        helperText="We'll send your first-login OTP here."
                                    />
                                    <TextField
                                        size="small" fullWidth
                                        type="email" label="Email (optional)"
                                        value={form.email}
                                        onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                                    />
                                    <TextField
                                        size="small" fullWidth
                                        type="date" label="Date of birth (optional)"
                                        InputLabelProps={{ shrink: true }}
                                        value={form.dob}
                                        onChange={(e) => setForm((p) => ({ ...p, dob: e.target.value }))}
                                    />
                                    <TextField
                                        size="small" fullWidth multiline minRows={2} maxRows={5}
                                        label="What would you like to discuss? (optional)"
                                        value={form.description}
                                        onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                                    />

                                    {error && <Alert severity="error">{error}</Alert>}

                                    <Button
                                        variant="contained"
                                        size="large"
                                        onClick={handlePayAndBook}
                                        disabled={busy || !!formError}
                                        startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
                                        sx={{ fontWeight: 700, textTransform: 'none', py: 1.25 }}
                                    >
                                        {busy ? 'Processing…' : 'Pay & Book'}
                                    </Button>
                                </Stack>
                            </Paper>
                        </Grid>
                    </Grid>
                </Container>
            </Box>
        </Box>
    );
}

// ---------------------------------------------------------------------------

function extractError(err) {
    if (!err) return null;
    const env = err.data || err;
    if (typeof env === 'string') return env;
    if (env?.errors && typeof env.errors === 'object') {
        return Object.entries(env.errors)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
            .join(' • ');
    }
    if (env?.error) return typeof env.error === 'string' ? env.error : 'Server error.';
    if (env?.message) return env.message;
    return null;
}
