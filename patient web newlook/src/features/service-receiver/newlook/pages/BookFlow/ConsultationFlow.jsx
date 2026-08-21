/**
 * Consultation booking flow — port of the mobile MVP's
 * ``app/booking/[doctorId].tsx``. Four steps: pick the consultation type, pick
 * a slot, choose what records to share, pay.
 *
 * This is one of the app's TWO booking flows. It exists separately from the
 * plan flow because only a consultation has a slot to choose; everything after
 * that step (records, settlement, confirmation) is shared code, so the two
 * can't drift on how a discount is applied or what gets shared.
 *
 * Real data throughout: the doctor and their consultation types, the day's
 * slots, the patient's family for "who is this for", symptoms, credits and
 * membership discount. Placing the booking calls the real
 * ``useBookAppointmentMutation``.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    Alert, Box, Button, ButtonBase, CircularProgress, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLIcon from '../../components/NLIcon';
import NLStepper from '../../components/NLStepper';
import NLRecordsShare, { emptyShare, sharedSectionTitles } from '../../components/NLRecordsShare';
import NLPaymentPanel from '../../components/NLPaymentPanel';
import {
    useGetDoctorDetailQuery,
    useGetDoctorSlotsQuery,
    useGetDoctorAvailableConsultationTypesQuery,
    useGetCreditsQuery,
    useBookAppointmentMutation,
    useGetHouseGroupQuery,
} from '../../../api/scopedBookingApi';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { CONSULTATION_TYPES, CONSULTATION_TYPE_MAP } from '../../../../service-provider/ProfileSetting/constants/consultationTypes';
import { quoteFor, vouchersFor } from '../../data/checkout';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { fmtDate, fmtTime, inr } from '../../utils/format';

const STEPS = ['Consultation', 'Date & time', 'Records', 'Pay'];

const CONSULT_ICON = {
    video: 'videocam-outline',
    audio: 'call-outline',
    chat: 'chatbubble-outline',
    complete: 'business-outline',
    home_visit: 'home-outline',
};

/** Three weeks of days, so the date rail is worth sliding. */
const buildDates = () => Array.from({ length: 21 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
        iso: d.toISOString().slice(0, 10),
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
            : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
    };
});

const ConsultationFlow = () => {
    const { doctorId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();

    const dates = useMemo(buildDates, []);
    const urlType = searchParams.get('type');

    const [step, setStep] = useState(0);
    const [typeKey, setTypeKey] = useState(urlType || 'video');
    const [dateIdx, setDateIdx] = useState(0);
    const [slot, setSlot] = useState(null);
    const [share, setShare] = useState(emptyShare());
    const [bookingFor, setBookingFor] = useState('self');
    const [confirmed, setConfirmed] = useState(null);
    const [error, setError] = useState(null);

    // Settlement state — identical in shape to the plan flow.
    const [voucherIds, setVoucherIds] = useState([]);
    const [coupons, setCoupons] = useState([]);
    const [credits, setCredits] = useState(0);
    const [method, setMethod] = useState('razorpay');
    const [agreed, setAgreed] = useState(false);

    const { data: doctor, isLoading: doctorLoading } = useGetDoctorDetailQuery(doctorId, {
        skip: !doctorId,
    });
    const { data: availableTypes } = useGetDoctorAvailableConsultationTypesQuery(doctorId, {
        skip: !doctorId,
    });
    const { data: slotsData, isFetching: slotsLoading } = useGetDoctorSlotsQuery(
        { doctorId, date: dates[dateIdx]?.iso, consultation_type: typeKey },
        { skip: !doctorId || step < 1 },
    );
    const { data: creditsData } = useGetCreditsQuery();
    const { data: membership } = useGetPatientMembershipQuery();
    const { data: houseGroupResp } = useGetHouseGroupQuery(undefined, {
        skip: !hasFeature('patient.family'),
    });
    const [bookAppointment, { isLoading: booking }] = useBookAppointmentMutation();

    const doc = doctor?.doctor || doctor;
    const members = Array.isArray(houseGroupResp)
        ? houseGroupResp
        : (houseGroupResp?.data?.members || houseGroupResp?.members || []);
    const bookable = members.filter((m) => {
        const perms = m.permissions || {};
        return perms.visible !== false && perms.appointments && perms.appointments !== 'none';
    });
    const selectedMember = bookingFor === 'self'
        ? null : bookable.find((m) => m.member_id === bookingFor) || null;
    const forLabel = selectedMember
        ? `${selectedMember.first_name} ${selectedMember.last_name || ''}`.trim()
        : 'you';

    // Which types this doctor actually offers; fall back to the standard set.
    const offered = (availableTypes?.consultation_types || availableTypes || [])
        .map((t) => (typeof t === 'string' ? t : t?.value || t?.consultation_type))
        .filter(Boolean);
    const types = CONSULTATION_TYPES.filter(
        (t) => t.schedulable !== false && (!offered.length || offered.includes(t.value)),
    );
    const type = CONSULTATION_TYPE_MAP[typeKey] || types[0] || CONSULTATION_TYPES[0];

    const slots = (slotsData?.slots || slotsData || []).filter(Boolean);
    const fee = Number(doc?.consultation_fee || slots[0]?.price || 0);

    const vouchers = useMemo(() => vouchersFor('appointment'), []);
    const quote = quoteFor({
        fee,
        listPrice: fee > 0 ? Math.round(fee * 1.2) : null,
        incrementFixed: fee > 0 ? 50 : 0,
        overallDiscountPct: fee > 0 ? 5 : 0,
        vouchers: vouchers.filter((v) => voucherIds.includes(v.id)),
        coupons,
        creditsApplied: credits,
        planDiscountPct: membership?.plan?.member_discount_pct || 0,
        creditsAvailable: creditsData?.available || 0,
    });

    const canContinue = step === 0 ? !!typeKey : step === 1 ? !!slot : step === 2 ? true : agreed;

    const confirm = async () => {
        setError(null);
        try {
            const res = await bookAppointment({
                doctor_id: doctorId,
                consultation_type: typeKey,
                appointment_date: dates[dateIdx].iso,
                time_slot_id: slot?.id || slot?.time_slot_id,
                start_time: slot?.start_time || slot?.start,
                chief_complaint: [share.symptoms.join(', '), share.note]
                    .filter(Boolean).join(' — ') || undefined,
                booking_for_id: selectedMember?.linked_patient_id || undefined,
                house_group_member_id: selectedMember?.member_id || undefined,
                share_records: share.share,
                shared_sections: Object.keys(share.sections).filter((k) => share.sections[k]),
            }).unwrap();
            setConfirmed(res || {});
        } catch (e) {
            setError(e?.data?.error || e?.data?.message
                || 'Couldn’t place the booking. Please try again.');
        }
    };

    // ── Confirmation ─────────────────────────────────────────────────────
    if (confirmed) {
        return (
            <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 620, mx: 'auto', textAlign: 'center' }}>
                <Box
                    sx={{
                        width: 72,
                        height: 72,
                        borderRadius: '50%',
                        bgcolor: colors.success,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mt: 4,
                        mb: 2,
                    }}
                >
                    <NLIcon name="checkmark" size={36} color={colors.white} />
                </Box>
                <Typography sx={typography.h1}>Appointment booked</Typography>
                <Typography sx={typography.bodyMuted}>For {forLabel}</Typography>
                <Typography sx={typography.bodyMuted}>
                    {doc?.full_name ? `Dr. ${doc.full_name}` : 'Your doctor'} · {dates[dateIdx].label}
                    {slot ? ` at ${fmtTime(slot.start_time || slot.start)}` : ''}
                </Typography>
                <Typography sx={typography.bodyMuted}>
                    {type?.label} · {quote.total === 0 ? 'Fully covered' : `${inr(quote.total)} payable`}
                </Typography>
                <Typography sx={{ ...typography.caption, mt: 1 }}>
                    {share.share
                        ? `Shared: ${sharedSectionTitles(share).join(', ') || 'nothing selected'}`
                        : 'No medical records were shared.'}
                </Typography>

                <Button
                    variant="contained"
                    fullWidth
                    sx={{ mt: 3, height: 48, fontWeight: 700 }}
                    onClick={() => navigate(`${basePath}/newlook/bookings?view=pending`)}
                >
                    View booking details
                </Button>
                <Button
                    variant="outlined"
                    fullWidth
                    sx={{ mt: 1.5, height: 48 }}
                    onClick={() => navigate(`${basePath}/newlook/bookings`)}
                >
                    Go to My Appointments
                </Button>
                <Button
                    fullWidth
                    sx={{ mt: 1 }}
                    startIcon={<NLIcon name="add-circle-outline" size={15} />}
                    onClick={() => { setConfirmed(null); setStep(0); setSlot(null); setAgreed(false); }}
                >
                    Book another
                </Button>
                <Button fullWidth onClick={() => navigate(`${basePath}/newlook`)}>
                    Back to home
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 2 }}>Book appointment</Typography>

            <NLStepper steps={STEPS} current={step} onStep={setStep} canNext={canContinue} />

            {/* Who it's for — the same choice the booking flow's own popup makes. */}
            {bookable.length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2 }}>
                    {[{ member_id: 'self', first_name: 'Myself' }, ...bookable].map((m) => {
                        const id = m.member_id;
                        const on = bookingFor === id;
                        return (
                            <ButtonBase
                                key={id}
                                onClick={() => setBookingFor(id)}
                                sx={{
                                    px: '12px',
                                    py: '8px',
                                    borderRadius: `${radius.pill}px`,
                                    border: `1px solid ${on ? colors.primary : colors.border}`,
                                    bgcolor: on ? tint(colors.primary, 0.08) : colors.surface,
                                    color: on ? colors.primary : colors.textSecondary,
                                    fontSize: 12.5,
                                    fontWeight: on ? 700 : 600,
                                }}
                            >
                                {`${m.first_name} ${m.last_name || ''}`.trim()}
                            </ButtonBase>
                        );
                    })}
                </Box>
            ) : null}

            {doctorLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <NLCard sx={{ mb: 2.5 }}>
                    <Typography sx={typography.h3}>
                        {doc?.full_name ? `Dr. ${doc.full_name}` : 'Doctor'}
                    </Typography>
                    <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>
                        {(doc?.specializations || [])
                            .map((sp) => (typeof sp === 'string' ? sp : sp?.name || ''))
                            .filter(Boolean).join(', ') || doc?.highest_qualification || ''}
                    </Typography>
                </NLCard>
            )}

            {error ? (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
            ) : null}

            {/* ── Step 0: how to consult ──────────────────────────────── */}
            {step === 0 ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 1.25 }}>
                        HOW WOULD YOU LIKE TO CONSULT?
                    </Typography>
                    {types.map((t) => {
                        const on = typeKey === t.value;
                        return (
                            <ButtonBase
                                key={t.value}
                                onClick={() => setTypeKey(t.value)}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    width: '100%',
                                    textAlign: 'left',
                                    p: '13px',
                                    mb: '9px',
                                    borderRadius: `${radius.md}px`,
                                    border: `${on ? 2 : 1}px solid ${on ? colors.primary : colors.border}`,
                                    bgcolor: colors.surface,
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: '50%',
                                        bgcolor: on ? colors.primary : tint(t.color, 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <NLIcon
                                        name={CONSULT_ICON[t.value] || 'videocam-outline'}
                                        size={20}
                                        color={on ? colors.white : t.color}
                                    />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={typography.h3}>{t.label}</Typography>
                                    <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                                        {t.description}
                                    </Typography>
                                </Box>
                                <Box
                                    sx={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        border: `2px solid ${on ? colors.primary : colors.border}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    {on ? (
                                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colors.primary }} />
                                    ) : null}
                                </Box>
                            </ButtonBase>
                        );
                    })}
                </>
            ) : null}

            {/* ── Step 1: date & time ─────────────────────────────────── */}
            {step === 1 ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 1 }}>SELECT A DATE</Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            gap: '8px',
                            overflowX: 'auto',
                            pb: 1.5,
                            scrollbarWidth: 'none',
                            '&::-webkit-scrollbar': { display: 'none' },
                        }}
                    >
                        {dates.map((d, i) => {
                            const on = dateIdx === i;
                            return (
                                <ButtonBase
                                    key={d.iso}
                                    onClick={() => { setDateIdx(i); setSlot(null); }}
                                    sx={{
                                        flexDirection: 'column',
                                        minWidth: 72,
                                        py: '10px',
                                        borderRadius: `${radius.sm}px`,
                                        border: `1px solid ${on ? colors.primary : colors.border}`,
                                        bgcolor: on ? colors.primary : colors.surface,
                                        color: on ? colors.white : colors.textSecondary,
                                        flexShrink: 0,
                                    }}
                                >
                                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'inherit' }}>
                                        {d.label}
                                    </Typography>
                                    <Typography sx={{ fontSize: 10.5, color: 'inherit', opacity: 0.85 }}>
                                        {d.month}
                                    </Typography>
                                </ButtonBase>
                            );
                        })}
                    </Box>

                    <Typography sx={{ ...typography.label, mb: 1 }}>AVAILABLE TIMES</Typography>
                    {slotsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : slots.length ? (
                        <>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {slots.map((sl) => {
                                    const id = sl.id || sl.time_slot_id;
                                    const on = (slot?.id || slot?.time_slot_id) === id;
                                    const taken = sl.is_booked || sl.available === false;
                                    return (
                                        <ButtonBase
                                            key={id}
                                            disabled={taken}
                                            onClick={() => setSlot(sl)}
                                            sx={{
                                                px: '14px',
                                                py: '9px',
                                                borderRadius: `${radius.sm}px`,
                                                border: `1px solid ${on ? colors.secondary : colors.border}`,
                                                bgcolor: on ? colors.secondary : colors.surface,
                                                color: on ? colors.white : colors.textSecondary,
                                                opacity: taken ? 0.4 : 1,
                                                fontSize: 12.5,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {fmtTime(sl.start_time || sl.start)}
                                        </ButtonBase>
                                    );
                                })}
                            </Box>
                            <Typography sx={{ ...typography.caption, mt: 1 }}>
                                {slots.filter((sl) => !(sl.is_booked || sl.available === false)).length}
                                {' '}of {slots.length} slots free on {dates[dateIdx].label.toLowerCase()}
                            </Typography>
                        </>
                    ) : (
                        <Alert severity="info">
                            No open slots for {type?.label} on {dates[dateIdx].label.toLowerCase()}.
                            Try another day.
                        </Alert>
                    )}
                </>
            ) : null}

            {/* ── Step 2: records ─────────────────────────────────────── */}
            {step === 2 ? (
                <NLRecordsShare value={share} onChange={setShare} patientName={forLabel} />
            ) : null}

            {/* ── Step 3: summary + pay ───────────────────────────────── */}
            {step === 3 ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 1 }}>BOOKING SUMMARY</Typography>
                    <NLCard sx={{ mb: 2 }}>
                        {[
                            ['Patient', forLabel],
                            ['Doctor', doc?.full_name ? `Dr. ${doc.full_name}` : '—'],
                            ['Type', type?.label || '—'],
                            ['Date', `${dates[dateIdx].label} · ${fmtDate(dates[dateIdx].iso)}`],
                            ['Time', slot ? fmtTime(slot.start_time || slot.start) : '—'],
                            ['Symptoms', share.symptoms.length ? share.symptoms.join(', ') : 'None selected'],
                            ['Records shared', share.share
                                ? (sharedSectionTitles(share).join(', ') || 'None selected')
                                : 'No'],
                        ].map(([k, v]) => (
                            <Box key={k} sx={{ display: 'flex', gap: 2, py: '5px' }}>
                                <Typography sx={{ ...typography.bodyMuted, width: 130, flexShrink: 0 }}>
                                    {k}
                                </Typography>
                                <Typography sx={{ ...typography.body, fontWeight: 600, flex: 1 }}>
                                    {v}
                                </Typography>
                            </Box>
                        ))}
                    </NLCard>

                    <NLPaymentPanel
                        quote={quote}
                        vouchers={vouchers}
                        appliedVoucherIds={voucherIds}
                        onToggleVoucher={(id) => setVoucherIds((s) =>
                            s.includes(id) ? s.filter((x) => x !== id) : [...s, id])}
                        coupons={coupons}
                        onApplyCoupon={(c) => setCoupons((s) => [...s, c])}
                        onRemoveCoupon={(id) => setCoupons((s) => s.filter((c) => c.id !== id))}
                        credits={credits}
                        onCredits={setCredits}
                        method={method}
                        onMethod={setMethod}
                        agreed={agreed}
                        onAgreed={setAgreed}
                    />
                </>
            ) : null}

            {/* ── Flow nav ────────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', gap: 1.5, mt: 3 }}>
                {step > 0 ? (
                    <Button variant="outlined" onClick={() => setStep(step - 1)} sx={{ flex: 1, height: 48 }}>
                        Back
                    </Button>
                ) : null}
                {step < STEPS.length - 1 ? (
                    <Button
                        variant="contained"
                        disabled={!canContinue}
                        onClick={() => setStep(step + 1)}
                        sx={{ flex: 2, height: 48, fontWeight: 700 }}
                    >
                        {step === 0 ? `Continue with ${type?.shortLabel || type?.label}` : 'Continue'}
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        disabled={!agreed || booking}
                        onClick={confirm}
                        sx={{ flex: 2, height: 48, fontWeight: 700 }}
                    >
                        {booking ? 'Booking…'
                            : quote.total === 0 ? 'Confirm booking' : `Pay ${inr(quote.total)}`}
                    </Button>
                )}
            </Box>
        </Box>
    );
};

export default ConsultationFlow;
