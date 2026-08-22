import React, { useState, useEffect, useMemo } from 'react';
import {
    Box, Container, Typography, Button,
    TextField, Chip, Paper, Alert,
    CircularProgress, Divider, Avatar, Snackbar, Stack, Grid, IconButton, Tooltip,
    Checkbox, RadioGroup, FormControlLabel, Radio,
} from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import {
    CONSULTATION_TYPE_MAP,
} from '../../../service-provider/ProfileSetting/constants/consultationTypes';

import {
    useGetDoctorDetailQuery,
    useGetDoctorSlotsQuery,
    useGetDoctorSlotSummaryQuery,
    useBookAppointmentMutation,
    useLinkAppointmentContextMutation,
    useBookFollowUpMutation,
    useCancelAppointmentMutation,
} from '../../api/scopedBookingApi';
import {
    useCreatePaymentOrderMutation,
    useVerifyPaymentMutation,
} from '../../api/patientEndpoints';
import usePatientCheckout from '../../api/usePatientCheckout';
import { useGetPatientStaffMeQuery } from '../../SupportStaff/api/supportStaffEndpoints';
import { loadRazorpayScript } from '../../../../utils/loadRazorpayScript';
import useMemberDiscount from '../../../../common/hooks/useMemberDiscount';
import {
    applyMemberBenefit, applyPct, offeringMemberDiscount,
} from '../../../../common/components/PlanCard/MemberDiscountBadge';
import DiscountedPrice from '../../../../common/components/Price/DiscountedPrice';
import RedeemCodeFields from '../../../../common/components/Price/RedeemCodeFields';
import BookingIntakeBar from '../../components/BookingIntakeBar/BookingIntakeBar';
import CreditRedeem from '../../components/CreditRedeem/CreditRedeem';
import OfferingFeatures from '../../components/OfferingFeatures/OfferingFeatures';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';
import { todayLocalDateString } from '../../../../common/utils/date';

// ── Helpers ──────────────────────────────────────────────────────────────────

function slotDuration(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * The ``slot_pricing`` tier a slot of ``durationMin`` falls in.
 *
 * Returns the whole tier rather than just its price: the tier also carries
 * ``original_price`` / ``discount_pct`` when the admin overlay has marked this
 * offering down, and the Booking Summary needs those to slash the list price.
 */
function getTierForSlot(durationMin, slotPricing = [], consultationType = null) {
    if (!slotPricing || slotPricing.length === 0) return null;

    // Filter to only matching consultation type (safety net — backend should already filter)
    const tiers = consultationType
        ? slotPricing.filter((t) => !t.consultation_type || t.consultation_type === consultationType)
        : slotPricing;

    for (const tier of tiers) {
        if (tier.range) {
            const parts = tier.range.split('-');
            const min = parseInt(parts[0], 10);
            const max = parseInt(parts[1], 10);
            if (durationMin > min && durationMin <= max) return tier;
        } else if (tier.min_duration !== undefined || tier.max_duration !== undefined) {
            const min = tier.min_duration ?? 0;
            const max = tier.max_duration ?? Infinity;
            if (durationMin >= min && durationMin <= max) return tier;
        } else if (tier.duration !== undefined) {
            if (durationMin === tier.duration) return tier;
        }
    }
    return null;
}

function tierPrice(tier) {
    if (!tier) return null;
    return tier.price != null ? Number(tier.price) : Number(tier.fee);
}

function getPriceForSlot(durationMin, slotPricing = [], consultationType = null) {
    return tierPrice(getTierForSlot(durationMin, slotPricing, consultationType));
}

function todayStr() {
    return todayLocalDateString();
}

// ── Calendar Helpers ─────────────────────────────────────────────────────────

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
}

// ── Component ─────────────────────────────────────────────────────────────────

const BookAppointment = () => {
    const { doctorId, consultationType } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const medicalContextId = searchParams.get('ctx');
    // The intake context actually linked at payment: the one passed from the
    // type-first flow (?ctx=) or, for a doctor-first booking, the one the
    // intake bar mints on this page.
    const [intakeContextId, setIntakeContextId] = useState(searchParams.get('ctx') || null);
    const followUpInviteId = searchParams.get('follow_up_invite');
    const suggestedDate = searchParams.get('date');
    // A slot start time (HH:MM) passed from the profile's booking panel — auto-
    // select that slot once the day's slots load so a tap there lands ready to pay.
    const suggestedStart = searchParams.get('start');
    const isFollowUp = !!followUpInviteId;
    const typeInfo = CONSULTATION_TYPE_MAP[consultationType];

    // Derive appointment_type from consultation type
    const appointmentType = consultationType === 'complete' ? 'in_clinic' : 'online';

    // If follow-up with suggested date, start calendar on that month
    const initialDate = suggestedDate ? new Date(suggestedDate + 'T00:00:00') : new Date();
    const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
    const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());

    const [selectedDate, setSelectedDate] = useState(suggestedDate || '');
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [chiefComplaint, setChiefComplaint] = useState(
        isFollowUp ? 'Follow-up consultation as recommended by doctor' : ''
    );
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    // Tick every minute so past slots quietly vanish as time advances.
    // Without this the list freezes at the time the page first rendered —
    // a slot that just expired stays clickable until the user manually
    // re-selects the date. Cheap on render cost; the work below is just
    // an Array.prototype.filter over <100 slots.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    const { data: doctor, isLoading: doctorLoading } = useGetDoctorDetailQuery(doctorId, { skip: !doctorId });

    // 1. Fetch Monthly Summary for legend, filtered by consultation type
    const { data: summaryData, isFetching: summaryFetching } = useGetDoctorSlotSummaryQuery(
        { doctorId, month: monthStr, consultationType },
        { skip: !doctorId }
    );

    // 2. Fetch Slots for selected date, filtered by consultation type
    const { data: slotsData, isFetching: slotsFetching } = useGetDoctorSlotsQuery(
        { doctorId, date: selectedDate, consultationType },
        { skip: !doctorId || !selectedDate }
    );

    const [bookAppointment, { isLoading: booking }] = useBookAppointmentMutation();
    const [createPaymentOrder] = useCreatePaymentOrderMutation();
    const [verifyPayment] = useVerifyPaymentMutation();
    const [linkContext] = useLinkAppointmentContextMutation();
    const [bookFollowUp] = useBookFollowUpMutation();
    const [cancelAppointment, { isLoading: cancelling }] = useCancelAppointmentMutation();
    // Ops mode only: an admin booking on this patient's behalf can't run the
    // Razorpay popup below, so it settles offline instead. The patient path is
    // untouched.
    const { checkout, isOps, markAsPaid } = usePatientCheckout();
    const { basePath, scopeKind, patientId } = usePatientScope();
    // A support-staff CAREGIVER ('staff' scope) creates the booking; by default
    // the PATIENT settles it from their own account (a 20-minute reservation
    // then runs on their pending-payment card). BUT if the patient granted this
    // caregiver ``can_pay_on_behalf``, the caregiver may instead pay now from
    // their OWN method — an explicit choice at the confirm step.
    const isCaregiverMain = scopeKind === 'staff' && (patientId || '').startsWith('staff:');
    const { data: staffMe } = useGetPatientStaffMeQuery(undefined, { skip: !isCaregiverMain });
    const myPatientEntry = (staffMe?.patients || []).find(
        (p) => p.patient_id === (patientId || '').replace(/^staff:/, ''));
    const caregiverCanPay = isCaregiverMain && !!myPatientEntry?.can_pay;
    const [payNow, setPayNow] = useState(false);
    const caregiverPaysNow = caregiverCanPay && payNow;
    // Defer to the patient unless the caregiver both MAY and CHOSE to pay now.
    const deferToPatient = !isOps && scopeKind === 'staff' && !caregiverPaysNow;
    const [paying, setPaying] = useState(false);

    // After a successful booking the appointment row exists in DB even if
    // the downstream Razorpay step failed. Holding the id here lets the
    // patient (a) retry payment without creating a duplicate appointment
    // and (b) cancel cleanly via the cancel endpoint.
    const [pendingAppointmentId, setPendingAppointmentId] = useState(null);
    const [paymentError, setPaymentError] = useState(null);

    const slots = slotsData?.slots || [];
    const slotPricing = slotsData?.slot_pricing || doctor?.data?.slot_pricing || [];
    const slotsApproved = slotsData?.approved;
    const bookedSlots = slotsData?.booked_slots || [];
    const pendingSlots = slotsData?.pending_slots || [];

    // Auto-select the slot the patient tapped on the profile panel (?start=).
    const preselectedRef = React.useRef(false);
    useEffect(() => {
        if (preselectedRef.current || !suggestedStart || selectedSlot || !slots.length) return;
        const match = slots.find(
            (s) => s.start === suggestedStart
                && !bookedSlots.includes(s.start) && !pendingSlots.includes(s.start),
        );
        if (match) { setSelectedSlot(match); preselectedRef.current = true; }
    }, [slots, suggestedStart, selectedSlot, bookedSlots, pendingSlots]);

    // Drop slots whose start time has already passed when the user has
    // selected TODAY. For any future date we show every slot. The backend
    // already rejects past-bookings, but seeing 00:00–16:50 when it's
    // 17:05 IST is a confusing UI — the chip is clickable but the booking
    // would 4xx server-side. Filtering at render keeps the chip list
    // honest. Compares wall-clock minutes (slot.start is "HH:MM" in
    // tenant local time, which the page already assumes elsewhere).
    const visibleSlots = useMemo(() => {
        if (selectedDate !== todayStr()) return slots;
        const cutoffMin = now.getHours() * 60 + now.getMinutes();
        return slots.filter((s) => {
            if (!s.start) return true; // malformed → don't hide
            const [h, m] = s.start.split(':').map(Number);
            if (Number.isNaN(h) || Number.isNaN(m)) return true;
            return (h * 60 + m) > cutoffMin;
        });
    }, [slots, selectedDate, now]);
    const isToday = selectedDate === todayStr();
    const hasFutureSlotsButTodayElapsed = (
        isToday && slots.length > 0 && visibleSlots.length === 0
    );

    const selectedTier = useMemo(() => {
        if (!selectedSlot) return null;
        const dur = slotDuration(selectedSlot.start, selectedSlot.end);
        return getTierForSlot(dur, slotPricing, consultationType);
    }, [selectedSlot, slotPricing, consultationType]);
    const selectedFee = tierPrice(selectedTier);

    // What this slot was priced at before the admin's markdown, and by how
    // much. Sent only when there IS a markdown, so an undiscounted slot leaves
    // both null and the Fee row renders as a single number, as it always has.
    const listFee = selectedTier?.original_price ?? null;
    const offerDiscountPct = selectedTier?.discount_pct ?? 0;

    // What the patient's own membership tier takes off THIS slot. The tier's
    // headline % is only a ceiling: ``DisplayPricingRule.plan_discounts`` can
    // dial an individual doctor × consultation × slot below it, and the server
    // charges the dialled figure. The decorated tier carries that resolved
    // number, so this summary quotes what the invoice will say; falling back
    // to the ceiling only for a slot that predates the decoration.
    //
    // ``selectedFee`` stays the list price throughout — it's what the slot
    // chips quote, what the "is this slot priced at all?" guards test, and what
    // gets POSTed as the fallback ``consultation_fee``. The server applies the
    // same discount when it prices the booking, so sending the discounted
    // number here would take it off twice.
    const { discountPct: ceilingPct, planName } = useMemberDiscount();
    const tierMember = offeringMemberDiscount(selectedTier);
    // The ceiling is the fallback for a tier that predates the decoration —
    // never an override of a resolved figure, which would re-introduce the
    // over-promise this replaced.
    const member = tierMember.hasDiscount
        ? tierMember
        : { pct: ceilingPct, flat: 0, hasDiscount: ceilingPct > 0 };
    const discountPct = member.pct;
    const memberFlat = member.flat || 0;
    const hasDiscount = member.hasDiscount;
    // Total payable is the fee less the TIER's percentage, and nothing else.
    // The per-plan voucher is shown on its own line underneath — it is a
    // separate thing an admin attached to this one slot, and folding it into
    // the total would leave no figure saying what the plan itself grants.
    const payableFee = selectedFee != null ? applyPct(selectedFee, discountPct) : null;
    const discountAmount = selectedFee != null && payableFee != null
        ? Math.round((selectedFee - payableFee) * 100) / 100
        : 0;
    // ── Redeemable offers on THIS slot ────────────────────────────────────
    // What the buyer's tier lets them spend here, and which of those they've
    // ticked. Keyed on the slot: pick a different time and the offers are
    // re-fetched and the selection cleared, because an offer an admin attached
    // to the 0-10 rule means nothing on a 30-minute booking.
    const slotMinutes = selectedSlot
        ? slotDuration(selectedSlot.start, selectedSlot.end)
        : null;
    const [appliedCodes, setAppliedCodes] = useState([]);
    const redeemedIds = appliedCodes.map((a) => a.id);
    const redeemedTotal = appliedCodes
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    // What they'll actually be charged. The server re-resolves this from the
    // same rule and ignores anything it didn't offer, so this is a preview of
    // its answer, never the authority for it.
    const [creditsApplied, setCreditsApplied] = useState(0);
    const finalPayable = payableFee != null
        ? Math.max(0, Math.round((payableFee - redeemedTotal - creditsApplied) * 100) / 100)
        : null;

    const handlePrevMonth = () => {
        if (currentMonth === 0) {
            setCurrentMonth(11);
            setCurrentYear(currentYear - 1);
        } else {
            setCurrentMonth(currentMonth - 1);
        }
    };

    const handleNextMonth = () => {
        if (currentMonth === 11) {
            setCurrentMonth(0);
            setCurrentYear(currentYear + 1);
        } else {
            setCurrentMonth(currentMonth + 1);
        }
    };

    // The patient-side checkout, unchanged: create the order server-side,
    // open Razorpay, verify. Lifted out of ``handleBook`` only so the
    // Operations act-on-behalf path can substitute an offline settlement
    // for it without this code growing a branch it has no business knowing
    // about.
    const payWithRazorpay = async (appointmentId) => {
        // Step 2: Create Razorpay order on backend (amount is read from DB)
        const orderResult = await createPaymentOrder({ appointment_id: appointmentId }).unwrap();
        const orderData = orderResult?.data || orderResult;
        const { razorpay_order_id, amount, key_id, payment_id } = orderData;
        // Prefill from our stored profile so the popup never re-asks for the phone.
        const prefill = Object.fromEntries(
            Object.entries(orderData?.prefill || {}).filter(([, v]) => v)
        );

        // Inject Razorpay's checkout.js on demand. The SDK script was
        // moved out of index.html so admin pages don't pull ~1MB of
        // Razorpay chunks for nothing. Without this, ``window.Razorpay``
        // is undefined here and we'd throw "Razorpay SDK not loaded".
        const sdkOk = await loadRazorpayScript();
        if (!sdkOk || !window.Razorpay) {
            throw new Error('Razorpay SDK failed to load. Check your internet connection and try again.');
        }

        // Step 3: Open Razorpay checkout popup
        await new Promise((resolve, reject) => {
            const rzp = new window.Razorpay({
                key: key_id,
                amount,
                currency: 'INR',
                name: 'Healthcare Portal',
                description: `Consultation with Dr. ${doctorName}`,
                order_id: razorpay_order_id,
                handler: async (response) => {
                    try {
                        // Step 4: Verify payment on backend
                        await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            payment_id,
                        }).unwrap();
                        resolve();
                    } catch (verifyErr) {
                        reject(verifyErr);
                    }
                },
                prefill,
                theme: { color: '#2563eb' },
                modal: {
                    ondismiss: () => reject(new Error('Payment cancelled by user.')),
                },
            });

            // ``payment.failed`` fires when Razorpay's processing
            // engine rejects the charge — risk-check failures
            // ("website not registered with Razorpay"), card
            // declines, bank-side blocks, etc. Without this hook
            // the promise never settles when Razorpay's own modal
            // shows the failure page, leaving the UI in
            // ``setPaying(true)`` limbo. response.error carries
            // ``code``, ``description``, ``source``, ``step``,
            // ``reason`` — surface the description so the patient
            // sees the real reason instead of a generic spinner.
            rzp.on('payment.failed', (response) => {
                const e = response?.error || {};
                const msg = e.description
                    ? `Payment failed: ${e.description}`
                    : 'Payment failed at Razorpay.';
                // Close Razorpay's modal so the patient lands back
                // on our page with the Retry / Cancel buttons.
                try { rzp.close(); } catch { /* SDK is forgiving */ }
                reject(new Error(msg));
            });

            rzp.open();
        });
    };

    const handleBook = async () => {
        if (!selectedSlot || !selectedDate) {
            setSnackbar({ open: true, message: 'Please select a date and time slot', severity: 'warning' });
            return;
        }
        if (!isFollowUp && !chiefComplaint.trim()) {
            setSnackbar({ open: true, message: 'Please describe your symptoms', severity: 'warning' });
            return;
        }
        if (selectedFee == null || selectedFee <= 0) {
            setSnackbar({ open: true, message: 'This slot has no fee configured. Contact the doctor.', severity: 'warning' });
            return;
        }

        setPaying(true);
        setPaymentError(null);
        try {
            let appointmentId = pendingAppointmentId;

            // Step 1: book only on first attempt. If a previous attempt
            // already created the row, reuse its id so retries don't pile
            // up duplicate PENDING_PAYMENT appointments + double-book the
            // slot. The id is cleared once the user explicitly cancels.
            if (!appointmentId) {
                let apptResult;
                if (isFollowUp && followUpInviteId) {
                    // Follow-up booking: use the invite endpoint which creates appointment with follow-up metadata
                    apptResult = await bookFollowUp({
                        inviteId: followUpInviteId,
                        time_slot_id: selectedSlot.id,
                    }).unwrap();
                } else {
                    // Normal booking
                    apptResult = await bookAppointment({
                        doctor_id: doctorId,
                        appointment_date: selectedDate,
                        start_time: selectedSlot.start,
                        end_time: selectedSlot.end,
                        appointment_type: appointmentType,
                        consultation_type: consultationType,
                        time_slot_id: selectedSlot.id,
                        chief_complaint: chiefComplaint.trim(),
                        consultation_fee: selectedFee,
                        // The offers they ticked. Re-validated server-side
                        // against the same pricing rule, so this is a request
                        // to spend them, not an instruction on the price.
                        redeemed_discount_ids: redeemedIds,
                        // Health credits to spend — server re-caps by the
                        // plan's per-offering rule + balance.
                        redeem_credits: creditsApplied,
                    }).unwrap();
                }

                appointmentId = apptResult?.data?.id || apptResult?.id;
                if (!appointmentId) throw new Error('Appointment creation failed');
                setPendingAppointmentId(appointmentId);
            }

            // Steps 2-4: settle the booking. A super-admin acting on this
            // patient's behalf cannot drive their Razorpay popup, so ops mode
            // records the offline state (unpaid / paid-at-the-counter) instead.
            if (isOps) {
                await checkout({
                    appointmentId,
                    description: `Consultation with Dr. ${doctorName}`,
                });
            } else if (deferToPatient) {
                // Caregiver: the booking is created (pending); the patient
                // completes payment from their own account. Nothing to settle.
            } else {
                await payWithRazorpay(appointmentId);
            }

            // Link the intake context to the appointment — whether it came from
            // the type-first flow (?ctx=) or was collected on this page by the
            // intake bar (doctor-first booking).
            if (intakeContextId && appointmentId) {
                try {
                    await linkContext({ contextId: intakeContextId, appointment_id: appointmentId }).unwrap();
                } catch (linkErr) {
                    console.warn('Failed to link medical context:', linkErr);
                }
            }

            // Clear the held appointment id only on full success — at this
            // point payment is verified and we're navigating away.
            setPendingAppointmentId(null);
            setPaymentError(null);
            setSnackbar({
                open: true,
                message: isOps
                    ? (markAsPaid
                        ? '✅ Booked and recorded as paid offline — sent for doctor approval.'
                        : '✅ Booked and left unpaid — the patient can pay it from their own app.')
                    : deferToPatient
                        ? '✅ Booking created — the slot is reserved 20 minutes for the patient to pay from their own account (My Appointments).'
                        : '✅ Payment successful! Appointment sent for doctor approval.',
                severity: 'success',
            });
            // The patient lands back on their dashboard; an operator wants the
            // bookings list, which is where they'd go to confirm it stuck.
            setTimeout(
                () => navigate((isOps || deferToPatient) ? `${basePath}/my-appointments` : basePath),
                2000,
            );

        } catch (err) {
            const msg = err?.data?.message || err?.data?.error || err?.message || 'Payment failed. Please try again.';
            setPaymentError(msg);
            setSnackbar({ open: true, message: msg, severity: 'error' });
        } finally {
            setPaying(false);
        }
    };

    const handleCancelPendingAppointment = async () => {
        // Free the slot (and the PENDING_PAYMENT row) when the patient
        // gives up on a stuck payment. Without this the appointment
        // sits in PENDING_PAYMENT, the slot stays held, and the patient
        // can't even rebook the same slot until the payment expiry
        // window elapses server-side.
        if (!pendingAppointmentId) return;
        try {
            await cancelAppointment(pendingAppointmentId).unwrap();
            setSnackbar({
                open: true,
                message: 'Appointment cancelled. The slot is free again.',
                severity: 'info',
            });
            setPendingAppointmentId(null);
            setPaymentError(null);
            setSelectedSlot(null);
        } catch (err) {
            const msg = err?.data?.message || err?.data?.error || err?.message
                || 'Could not cancel the appointment. Please try again.';
            setSnackbar({ open: true, message: msg, severity: 'error' });
        }
    };

    // ── Render Calendar Grid ─────────────────────────────────────────────────

    const renderCalendar = () => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const days = [];

        for (let i = 0; i < firstDay; i++) {
            days.push(<Grid item xs={12 / 7} key={`pad-${i}`} />);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(currentYear, currentMonth, d);
            const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isPast = dateObj < today;
            const slotCount = summaryData?.dates?.[dStr] || 0;
            const isSelected = selectedDate === dStr;

            let bgColor = 'grey.100';
            let textColor = 'text.disabled';
            let cursor = 'default';

            if (!isPast) {
                textColor = 'text.primary';
                cursor = 'pointer';
                // Strong, saturated shades so the green / orange / red read
                // clearly with white text (deep orange, not the light amber).
                if (slotCount > 10) bgColor = '#1B7F3B';
                else if (slotCount > 0) bgColor = '#E65100';
                else bgColor = '#C62828';

                if (!summaryData?.dates || !Object.keys(summaryData.dates).includes(dStr)) {
                    bgColor = '#C62828';
                }
            } else {
                bgColor = 'action.disabledBackground';
            }

            days.push(
                <Grid item xs={12/7} key={d} sx={{ display: 'flex', justifyContent: 'center', p: 0.5 }}>
                    <Tooltip title={isPast ? 'Past Date' : `${slotCount} slots available`}>
                        <Avatar
                            onClick={isPast ? undefined : () => { setSelectedDate(dStr); setSelectedSlot(null); }}
                            sx={{
                                width: { xs: 32, sm: 40 }, height: { xs: 32, sm: 40 },
                                bgcolor: isSelected ? 'primary.main' : bgColor,
                                color: isSelected ? 'white' : (isPast ? textColor : 'white'),
                                fontSize: '0.875rem',
                                cursor: cursor,
                                transition: 'all 0.2s',
                                '&:hover': !isPast ? { opacity: 0.8, transform: 'scale(1.1)' } : {},
                                border: isSelected ? '2px solid' : 'none',
                                borderColor: 'primary.dark'
                            }}
                        >
                            {d}
                        </Avatar>
                    </Tooltip>
                </Grid>
            );
        }

        return (
            <Box sx={{ width: '100%', mt: 1 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography variant="h6" fontWeight="bold">
                        {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </Typography>
                    <Box>
                        <IconButton onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
                        <IconButton onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
                    </Box>
                </Box>
                
                <Grid container spacing={0} mb={1}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <Grid item xs={12/7} key={day} sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">{day}</Typography>
                        </Grid>
                    ))}
                </Grid>

                <Grid container spacing={0}>
                    {days}
                </Grid>

                <Box display="flex" justifyContent="center" gap={3} mt={3} flexWrap="wrap">
                    <Box display="flex" alignItems="center" gap={1}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#1B7F3B' }} />
                        <Typography variant="caption" fontWeight="medium">&gt; 10 Slots</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#E65100' }} />
                        <Typography variant="caption" fontWeight="medium">1-10 Slots</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#C62828' }} />
                        <Typography variant="caption" fontWeight="medium">No Slots</Typography>
                    </Box>
                </Box>
            </Box>
        );
    };

    if (doctorLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const doctorData = doctor?.data || doctor || {};
    const doctorName = doctorData?.full_name || `${doctorData?.first_name || ''} ${doctorData?.last_name || ''}`.trim();

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            {/* Back button */}
            <Button
                startIcon={<ArrowBackIcon />}
                onClick={() => isFollowUp ? navigate(`${basePath}/my-appointments`) : navigate(`${basePath}/book/${doctorId}`)}
                sx={{ mb: 2 }}
            >
                {isFollowUp ? 'Back to Appointments' : 'Change Consultation Type'}
            </Button>

            {/* Follow-Up Banner */}
            {isFollowUp && (
                <Alert severity="info" variant="filled" sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold">Follow-Up Appointment</Typography>
                    <Typography variant="body2">
                        Your doctor has recommended a follow-up consultation.
                        {suggestedDate && <> Suggested date: <strong>{new Date(suggestedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>}
                        {' '}Please select a slot and complete payment.
                    </Typography>
                </Alert>
            )}

            {/* Doctor Info */}
            <Paper sx={{ p: 3, mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Avatar src={doctorData?.profile_image} sx={{ width: 72, height: 72, bgcolor: 'primary.main' }}>
                    <PersonIcon />
                </Avatar>
                <Box>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Typography variant="h5" fontWeight="bold">Book Appointment</Typography>
                        {typeInfo && (
                            <Chip
                                label={`${typeInfo.icon} ${typeInfo.label}`}
                                sx={{ bgcolor: typeInfo.color, color: 'white', fontWeight: 'bold' }}
                                size="small"
                            />
                        )}
                    </Box>
                    <Typography variant="h6" color="primary">Dr. {doctorName}</Typography>
                    {doctorData?.specializations?.length > 0 && (
                        <Typography variant="body2" color="textSecondary">
                            {doctorData.specializations.join(', ')}
                        </Typography>
                    )}
                </Box>
            </Paper>

            {/* Benefits / how it works / essentials linked to this consultation. */}
            <Box sx={{ mb: 2 }}>
                <OfferingFeatures
                    offering={consultationType}
                    doctorId={doctorId}
                    title="Benefits & how it works"
                />
            </Box>

            {/* Collect this information — book-for / preferences / health records.
                Shown for every booking, including doctor-first (previously this
                card only appeared in the type-first "Book Consultation" flow). */}
            {!isFollowUp && (
                <BookingIntakeBar
                    consultationType={consultationType}
                    existingContextId={medicalContextId}
                    freshKey={`${doctorId}:${consultationType}`}
                    onContextReady={setIntakeContextId}
                />
            )}

            <Stack spacing={3}>
                {/* Step 1: Date Calendar */}
                <Paper sx={{ p: 3 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <EventIcon color="primary" />
                        <Typography variant="h6" fontWeight="bold">Step 1 — Select Date</Typography>
                    </Box>
                    {summaryFetching ? (
                        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
                    ) : (
                        renderCalendar()
                    )}
                </Paper>

                {/* Step 2: Slot Selection */}
                {selectedDate && (
                    <Paper sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <AccessTimeIcon color="primary" />
                            <Typography variant="h6" fontWeight="bold">Step 2 — Select Time Slot</Typography>
                        </Box>

                        {slotsFetching && <CircularProgress size={20} />}

                        {!slotsFetching && !slotsApproved && selectedDate && (
                            <Alert severity="warning">This doctor's schedule is not yet approved.</Alert>
                        )}

                        {!slotsFetching && slotsApproved && slots.length === 0 && (
                            <Alert severity="error">No available slots for {new Date(selectedDate).toLocaleDateString()}.</Alert>
                        )}

                        {!slotsFetching && slotsApproved && hasFutureSlotsButTodayElapsed && (
                            <Alert severity="info">
                                All of today's slots have already passed. Please pick a future date.
                            </Alert>
                        )}

                        {!slotsFetching && slotsApproved && visibleSlots.length > 0 && (
                            <Box display="flex" flexWrap="wrap" gap={1}>
                                {visibleSlots.map((slot, idx) => {
                                    const isSelected = selectedSlot?.start === slot.start;
                                    const isBooked = bookedSlots.includes(slot.start);
                                    const isPending = !isBooked && pendingSlots.includes(slot.start);
                                    const dur = slotDuration(slot.start, slot.end);
                                    const fee = getPriceForSlot(dur, slotPricing, consultationType);

                                    const feeTag = fee != null ? ` · ₹${fee}` : '';
                                    const statusTag = isBooked ? ' 🔒' : isPending ? ' ⏳' : '';
                                    const label = `${slot.start}${feeTag}${statusTag}`;

                                    let extraSx = {};
                                    if (isBooked) extraSx = { bgcolor: '#C62828', color: 'white', opacity: 0.9 };
                                    else if (isPending) extraSx = { bgcolor: '#E65100', color: 'white' };

                                    return (
                                        <Chip
                                            key={idx}
                                            label={label}
                                            onClick={isBooked ? undefined : () => setSelectedSlot(slot)}
                                            color={isSelected ? 'primary' : 'default'}
                                            variant={isSelected ? 'filled' : 'outlined'}
                                            disabled={isBooked}
                                            sx={{ cursor: isBooked ? 'not-allowed' : 'pointer', fontWeight: isSelected ? 'bold' : 400, ...extraSx }}
                                        />
                                    );
                                })}
                            </Box>
                        )}
                    </Paper>
                )}

                {/* Step 3: Booking Details and Confirm */}
                {selectedSlot && (
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" fontWeight="bold" mb={3}>
                            {isFollowUp ? 'Step 3 — Confirm & Pay' : 'Step 3 — Finalize Details'}
                        </Typography>
                        <Stack spacing={3}>
                            {typeInfo && (
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Typography variant="body2" color="textSecondary">Consultation:</Typography>
                                    <Chip
                                        label={`${typeInfo.icon} ${typeInfo.label}`}
                                        sx={{ bgcolor: typeInfo.color, color: 'white', fontWeight: 'bold' }}
                                    />
                                </Box>
                            )}

                            {isFollowUp ? (
                                <Alert severity="success" variant="outlined">
                                    This is a follow-up appointment. Your previous consultation details
                                    will be available to the doctor.
                                </Alert>
                            ) : (
                                <TextField
                                    label="Reason for Visit (Describe your symptoms)"
                                    multiline
                                    rows={4}
                                    fullWidth
                                    value={chiefComplaint}
                                    onChange={(e) => setChiefComplaint(e.target.value)}
                                    placeholder="Describe your health concern..."
                                />
                            )}

                            <Divider />

                            <Box p={2} bgcolor="primary.50" borderRadius={2} border="1px solid" borderColor="primary.200">
                                <Typography variant="subtitle1" fontWeight="bold" mb={1}>Booking Summary</Typography>
                                <Grid container spacing={1}>
                                    <Grid item xs={6}><Typography variant="body2" color="textSecondary">Type</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2">{typeInfo ? `${typeInfo.icon} ${typeInfo.label}` : consultationType}</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2" color="textSecondary">Date</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2">{new Date(selectedDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2" color="textSecondary">Time</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2">{selectedSlot.start} – {selectedSlot.end}</Typography></Grid>
                                    <Grid item xs={6}><Typography variant="body2" color="textSecondary">Fee</Typography></Grid>
                                    <Grid item xs={6}>
                                        {/* Two different discounts can land on
                                            this row, so the strikethrough is
                                            reserved for exactly one of them:
                                            the offering's own list price
                                            (``original_price``, the admin
                                            overlay), which is already baked
                                            into ``selectedFee``. The buyer's
                                            membership % is NOT struck here —
                                            it's a line item below with its own
                                            "Total payable", and striking the
                                            fee for it too would leave the
                                            patient with two struck numbers and
                                            no way to tell which discount is
                                            which. When a membership discount
                                            applies the fee merely de-emphasises
                                            to secondary, so "Total payable"
                                            below is the prominent figure. */}
                                        {selectedFee != null ? (
                                            <DiscountedPrice
                                                price={selectedFee}
                                                original={listFee}
                                                discountPct={offerDiscountPct}
                                                color={discountPct > 0 ? 'text.secondary' : 'primary'}
                                            />
                                        ) : (
                                            <Typography variant="body2" fontWeight="bold" color="text.secondary">
                                                Not Set
                                            </Typography>
                                        )}
                                    </Grid>

                                    {/* Only itemised when the tier actually
                                        takes something off. A "discount (0%):
                                        −₹0" row is noise, and on a plan that
                                        grants nothing it is actively
                                        misleading. */}
                                    {discountPct > 0 && selectedFee != null && (
                                        <>
                                            <Grid item xs={6}>
                                                <Typography variant="body2" color="success.main">
                                                    {planName || 'Membership'} discount ({discountPct}%)
                                                </Typography>
                                            </Grid>
                                            <Grid item xs={6}>
                                                <Typography variant="body2" fontWeight="bold" color="success.main">
                                                    −₹{discountAmount}
                                                </Typography>
                                            </Grid>
                                            <Grid item xs={12}><Divider /></Grid>
                                            <Grid item xs={6}>
                                                <Typography variant="body2" fontWeight="bold">Total payable</Typography>
                                            </Grid>
                                            <Grid item xs={6}>
                                                <Typography variant="body2" fontWeight="bold" color="primary">
                                                    ₹{payableFee}
                                                </Typography>
                                            </Grid>



                                        </>
                                    )}
                                </Grid>

                                {/* Codes, always shown. Whether anything
                                    applies is the server's answer to a typed
                                    code, not a section that quietly isn't
                                    there. */}
                                <Box mt={2} pt={2} borderTop="1px dashed" borderColor="primary.200">
                                    <RedeemCodeFields
                                        offering={{
                                            doctorId,
                                            consultationType,
                                            duration: slotMinutes,
                                        }}
                                        applied={appliedCodes}
                                        onChange={setAppliedCodes}
                                        disabled={booking || paying}
                                    />
                                    <Box sx={{ mt: 1.5 }}>
                                        <CreditRedeem
                                            offering={consultationType}
                                            price={Math.max(0, (payableFee || 0) - redeemedTotal)}
                                            onChange={setCreditsApplied}
                                        />
                                    </Box>
                                    {redeemedTotal > 0 && (
                                        <Stack direction="row" justifyContent="space-between"
                                            alignItems="baseline" mt={1.5} pt={1.5}
                                            borderTop="1px solid" borderColor="divider">
                                            <Typography variant="body2" fontWeight="bold">
                                                You pay
                                            </Typography>
                                            <Stack direction="row" spacing={1} alignItems="baseline">
                                                <Typography variant="body2" color="text.disabled"
                                                    sx={{ textDecoration: 'line-through' }}>
                                                    ₹{payableFee}
                                                </Typography>
                                                <Typography variant="subtitle1" fontWeight="bold" color="primary">
                                                    ₹{finalPayable}
                                                </Typography>
                                            </Stack>
                                        </Stack>
                                    )}
                                </Box>
                            </Box>

                            {/* Sticky error after a failed payment — gives the
                                patient context for the Retry / Cancel choice
                                below. The snackbar auto-hides; this Alert
                                stays put so the user knows why the buttons
                                changed. */}
                            {paymentError && pendingAppointmentId && (
                                <Alert severity="error" variant="outlined">
                                    {paymentError}
                                </Alert>
                            )}

                            {pendingAppointmentId ? (
                                // After a failed Razorpay step the appointment
                                // exists; offer Retry + Cancel so the patient
                                // can either pay again (no double-book) or
                                // free the slot.
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <Button
                                        variant="contained"
                                        size="large"
                                        onClick={handleBook}
                                        disabled={paying || cancelling}
                                        fullWidth
                                        sx={{ py: 1.5 }}
                                    >
                                        {paying
                                            ? <CircularProgress size={24} color="inherit" />
                                            : `Retry Payment${finalPayable != null ? ` ₹${finalPayable}` : ''}`
                                        }
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        color="error"
                                        size="large"
                                        onClick={handleCancelPendingAppointment}
                                        disabled={paying || cancelling}
                                        fullWidth
                                        sx={{ py: 1.5 }}
                                    >
                                        {cancelling
                                            ? <CircularProgress size={24} color="inherit" />
                                            : 'Cancel Appointment'
                                        }
                                    </Button>
                                </Stack>
                            ) : (
                                <>
                                    {/* Caregiver with pay permission: choose who settles this booking. */}
                                    {caregiverCanPay && (
                                        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: 'action.hover' }}>
                                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                                Who pays for this booking?
                                            </Typography>
                                            <RadioGroup
                                                value={payNow ? 'me' : 'patient'}
                                                onChange={(e) => setPayNow(e.target.value === 'me')}
                                            >
                                                <FormControlLabel
                                                    value="patient"
                                                    control={<Radio size="small" />}
                                                    label={`Let ${myPatientEntry?.patient_name || 'the patient'} pay — the slot is held 20 minutes for them`}
                                                />
                                                <FormControlLabel
                                                    value="me"
                                                    control={<Radio size="small" />}
                                                    label="I'll pay now, from my own account"
                                                />
                                            </RadioGroup>
                                        </Paper>
                                    )}
                                    <Button
                                        variant="contained"
                                        size="large"
                                        onClick={handleBook}
                                        disabled={booking || paying || !selectedSlot || selectedFee == null}
                                        fullWidth
                                        sx={{ py: 1.5 }}
                                    >
                                        {(booking || paying)
                                            ? <CircularProgress size={24} color="inherit" />
                                            : (() => {
                                                if (isOps) return `${markAsPaid ? 'Confirm & record paid' : 'Confirm, leave unpaid'}${finalPayable != null ? ` ₹${finalPayable}` : ''}`;
                                                if (deferToPatient) return 'Confirm booking';
                                                return `Confirm & Pay${finalPayable != null ? ` ₹${finalPayable}` : ''}`;
                                            })()
                                        }
                                    </Button>
                                </>
                            )}
                        </Stack>
                    </Paper>
                )}
            </Stack>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Container>
    );
};

export default BookAppointment;
