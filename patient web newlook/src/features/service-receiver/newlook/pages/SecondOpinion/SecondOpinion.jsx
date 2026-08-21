/**
 * Second Opinion (new look) — your family doctor's view on another doctor's
 * prescription.
 *
 * Ported from the patient mobile MVP's ``app/more/family-doctor.tsx`` and wired
 * to this app's real ``/api/family-doctor`` endpoints, which already implement
 * the whole empanelment + second-opinion flow (join by code, request, delink,
 * completed-bookings table, open the capped chat/call channel).
 *
 * WHERE THIS DIVERGES FROM THE MOBILE DESIGN, and why — all three are backend
 * gaps, not choices:
 *
 *  1. The mobile screen's two heads are "In progress" vs "Completed", split by a
 *     14-day free window counted from the booking's completion. No such window
 *     exists server-side: the second-opinion channel is created ACTIVE with no
 *     expiry, and ``/me/bookings`` returns no window or days-left. Inventing the
 *     clock here would put a countdown on screen that nothing enforces, so the
 *     heads split on what the API actually knows: whether the booking HAS a
 *     prescription, which is what decides if you can ask at all.
 *  2. The mobile card shows the thread's state inline (messages used, last
 *     message, unread) from an AllowancePanel. ``/me/bookings`` returns no
 *     channel reference, and ``ServiceChannel.to_dict()`` omits
 *     ``prescription_id``, so a second-opinion channel cannot be matched back to
 *     its booking without POSTing — which CREATES one. A read must not have that
 *     side effect, so the thread state is left to the Service Chats page.
 *  3. Mobile offers Chat / Voice / Video as three separate starts with their own
 *     allowances. The backend opens one channel per prescription capped at 5
 *     messages / 300s of calls, with no audio-vs-video split, so this offers the
 *     one real action and states the real cap.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Avatar, Box, Button, ButtonBase, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, IconButton, Stack,
    TextField, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLEmptyState from '../../components/NLEmptyState';
import {
    useGetMyFamilyDoctorQuery,
    useGetMySecondOpinionBookingsQuery,
    useStartMySecondOpinionMutation,
    useJoinFamilyDoctorByCodeMutation,
    useDelinkMyFamilyDoctorMutation,
} from '../../../../family-doctor/api/familyDoctorEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { fmtDate, humanise } from '../../utils/format';

/** What the backend actually caps a second-opinion channel at. */
const CAP_MESSAGES = 5;
const CAP_CALL_MINUTES = 5;

/**
 * The two heads, side by side. Split by whether a prescription exists, because
 * that is what the API knows and what decides whether you can ask — see the
 * docblock for why this isn't the mobile's 14-day window.
 */
const HEADS = [
    { key: 'open', label: 'Can ask now', icon: 'hourglass-outline' },
    { key: 'none', label: 'No prescription', icon: 'checkmark-done-outline' },
];

const SecondOpinion = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();

    const [head, setHead] = useState('open');
    const [code, setCode] = useState('');
    const [viewRx, setViewRx] = useState(null);
    const [confirmDelink, setConfirmDelink] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const { data: link, isLoading: linkLoading } = useGetMyFamilyDoctorQuery();
    const { data: table, isLoading: tableLoading } = useGetMySecondOpinionBookingsQuery();
    const [startOpinion, { isLoading: starting }] = useStartMySecondOpinionMutation();
    const [joinByCode, { isLoading: joining }] = useJoinFamilyDoctorByCodeMutation();
    const [delink, { isLoading: delinking }] = useDelinkMyFamilyDoctorMutation();

    const linked = !!link;
    const bookings = table?.bookings || [];

    // Newest first in both heads: the one you're most likely to be looking for
    // is the one you had most recently.
    const byNewest = useMemo(
        () => [...bookings].sort((a, b) => String(b.completed_date || '').localeCompare(String(a.completed_date || ''))),
        [bookings],
    );
    const withRx = byNewest.filter((b) => b.prescription);
    const withoutRx = byNewest.filter((b) => !b.prescription);
    const shown = head === 'open' ? withRx : withoutRx;

    const ask = async (booking) => {
        setError(null);
        setNotice(null);
        try {
            const res = await startOpinion({ prescription_id: booking.prescription.id }).unwrap();
            // The backend hands back its own deep-link into Service Chats, which
            // is where the conversation actually lives.
            if (res?.channel_id) {
                navigate(`${basePath}/my-services?channel=${res.channel_id}`);
                return;
            }
            setNotice('Second-opinion conversation is ready — open it under My Services.');
        } catch (e) {
            setError(e?.data?.error || e?.data?.message || 'Couldn’t start the second opinion.');
        }
    };

    const join = async () => {
        setError(null);
        try {
            await joinByCode(code.trim()).unwrap();
            setCode('');
            setNotice('Linked. You can now ask for a second opinion on any completed booking.');
        } catch (e) {
            setError(e?.data?.error || e?.data?.message || 'That code didn’t work.');
        }
    };

    const doDelink = async () => {
        setError(null);
        try {
            await delink().unwrap();
            setConfirmDelink(false);
            setNotice('Family doctor delinked.');
        } catch (e) {
            setConfirmDelink(false);
            setError(e?.data?.error || e?.data?.message || 'Couldn’t delink.');
        }
    };

    const renderBooking = (b) => (
        <NLCard key={b.booking_id} sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.h3}>{humanise(b.type) || 'Booking'}</Typography>
                    <Typography sx={typography.bodyMuted}>
                        {b.provider_name || 'Provider'}
                    </Typography>
                </Box>
                {b.prescription ? (
                    <NLBadge label={humanise(b.prescription.status) || 'Prescription'} tone="success" />
                ) : (
                    <NLBadge label="No prescription" tone="neutral" />
                )}
            </Box>

            <Box sx={{ display: 'flex', gap: 3, mt: 1.5 }}>
                <Box>
                    <Typography sx={typography.caption}>BOOKED</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                        {fmtDate(b.booked_date) || '—'}
                    </Typography>
                </Box>
                <Box>
                    <Typography sx={typography.caption}>COMPLETED</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                        {fmtDate(b.completed_date) || '—'}
                    </Typography>
                </Box>
            </Box>

            {b.prescription ? (
                <>
                    <ButtonBase
                        onClick={() => setViewRx(b.prescription)}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            width: '100%',
                            py: 1.25,
                            mt: 1.5,
                            textAlign: 'left',
                            borderTop: `1px solid ${colors.border}`,
                            borderBottom: `1px solid ${colors.border}`,
                        }}
                    >
                        <NLIcon name="document-text-outline" size={16} color={colors.primary} />
                        <Typography sx={{ ...typography.body, flex: 1 }}>View prescription</Typography>
                        <NLIcon name="chevron-forward" size={15} color={colors.textMuted} />
                    </ButtonBase>

                    <Typography sx={{ ...typography.label, mt: 1.5, mb: 1 }}>
                        ASK YOUR FAMILY DOCTOR
                    </Typography>
                    {linked ? (
                        <>
                            <Button
                                variant="contained"
                                fullWidth
                                disabled={starting}
                                startIcon={<NLIcon name="chatbubbles-outline" size={16} />}
                                onClick={() => ask(b)}
                                sx={{ fontWeight: 700 }}
                            >
                                {starting ? 'Opening…' : 'Start second opinion'}
                            </Button>
                            <Typography sx={{ fontSize: 11, color: colors.textMuted, mt: 1 }}>
                                Opens a conversation with {link.doctor_name} — up to {CAP_MESSAGES}{' '}
                                messages and calls of up to {CAP_CALL_MINUTES} minutes, included.
                            </Typography>
                        </>
                    ) : (
                        <Typography
                            sx={{ fontSize: 11.5, color: colors.textMuted, textAlign: 'center' }}
                        >
                            Link a family doctor to ask for a second opinion.
                        </Typography>
                    )}
                </>
            ) : (
                <Typography sx={{ ...typography.bodyMuted, mt: 1.5 }}>
                    A second opinion needs the original doctor&apos;s prescription. This booking
                    doesn&apos;t have one yet.
                </Typography>
            )}
        </NLCard>
    );

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Second Opinion</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                By your family doctor — a review of any completed booking&apos;s prescription.
            </Typography>

            {error ? (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
            ) : null}
            {notice ? (
                <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>
            ) : null}

            {linkLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : linked ? (
                <NLCard sx={{ mb: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar sx={{ width: 54, height: 54 }}>
                            {(link.doctor_name || '?')[0]}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={typography.h3}>
                                {link.doctor_name || 'Your family doctor'}
                            </Typography>
                            <Typography sx={typography.bodyMuted}>Family doctor</Typography>
                            {link.linked_at ? (
                                <Typography sx={typography.caption}>
                                    Linked since {fmtDate(link.linked_at)}
                                    {link.linked_via ? ` · via ${link.linked_via}` : ''}
                                </Typography>
                            ) : null}
                        </Box>
                        <NLBadge label="Linked" tone="success" />
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => navigate(`${basePath}/doctor/${link.doctor_id}`)}
                        >
                            View profile
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => setConfirmDelink(true)}
                        >
                            Delink
                        </Button>
                    </Stack>
                </NLCard>
            ) : (
                <>
                    <NLCard sx={{ mb: 1.75 }}>
                        <Typography sx={typography.h3}>Join with a code</Typography>
                        <Typography sx={typography.bodyMuted}>
                            Enter the empanelment code your doctor shared with you.
                        </Typography>
                        <Stack direction="row" spacing={1.25} sx={{ mt: 1.5 }}>
                            <TextField
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                placeholder="FD-0000"
                                size="small"
                                fullWidth
                            />
                            <Button
                                variant="contained"
                                disabled={code.trim().length < 4 || joining}
                                onClick={join}
                                sx={{ minWidth: 96 }}
                            >
                                {joining ? '…' : 'Join'}
                            </Button>
                        </Stack>
                    </NLCard>

                    <NLCard sx={{ mb: 2.5 }}>
                        <Typography sx={typography.h3}>Or find a family doctor</Typography>
                        <Typography sx={typography.bodyMuted}>
                            Search available doctors and send an empanelment request.
                        </Typography>
                        <Button
                            variant="outlined"
                            sx={{ mt: 1.5 }}
                            onClick={() => navigate(`${basePath}/find-doctors`)}
                        >
                            Search doctors
                        </Button>
                    </NLCard>
                </>
            )}

            {/* ── Second opinions ─────────────────────────────────────────
                Two heads side by side rather than stacked, so moving between
                them is one click instead of a scroll past everything. */}
            {tableLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : bookings.length ? (
                <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                        {HEADS.map((h) => {
                            const on = head === h.key;
                            const count = h.key === 'open' ? withRx.length : withoutRx.length;
                            return (
                                <ButtonBase
                                    key={h.key}
                                    onClick={() => setHead(h.key)}
                                    aria-pressed={on}
                                    sx={{
                                        flex: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '5px',
                                        py: 1.25,
                                        px: 1,
                                        borderRadius: `${radius.pill}px`,
                                        border: `1px solid ${on ? colors.primary : colors.border}`,
                                        bgcolor: on ? colors.primary : colors.surface,
                                    }}
                                >
                                    <NLIcon
                                        name={h.icon}
                                        size={14}
                                        color={on ? colors.white : colors.textSecondary}
                                    />
                                    <Typography
                                        sx={{
                                            fontSize: 12.5,
                                            fontWeight: 700,
                                            color: on ? colors.white : colors.textSecondary,
                                        }}
                                    >
                                        {h.label}
                                    </Typography>
                                    <Box
                                        sx={{
                                            minWidth: 22,
                                            px: '6px',
                                            borderRadius: `${radius.pill}px`,
                                            textAlign: 'center',
                                            bgcolor: on ? 'rgba(255,255,255,0.22)' : colors.background,
                                        }}
                                    >
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                color: on ? colors.white : colors.textSecondary,
                                            }}
                                        >
                                            {count}
                                        </Typography>
                                    </Box>
                                </ButtonBase>
                            );
                        })}
                    </Box>

                    <Typography sx={{ ...typography.bodyMuted, mb: 1.5 }}>
                        {head === 'open'
                            ? 'Completed bookings whose prescription your family doctor can review.'
                            : 'Completed bookings with no prescription attached — nothing to review yet.'}
                    </Typography>

                    {shown.length ? shown.map(renderBooking) : (
                        <NLCard sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                            <NLIcon name="time-outline" size={17} color={colors.textMuted} />
                            <Typography sx={{ ...typography.bodyMuted, flex: 1 }}>
                                {head === 'open'
                                    ? 'Nothing to ask about yet. A booking appears here once it completes and its doctor issues a prescription.'
                                    : 'Every completed booking here has a prescription.'}
                            </Typography>
                        </NLCard>
                    )}
                </>
            ) : (
                <NLEmptyState
                    icon="chatbubbles-outline"
                    title={linked ? 'No completed bookings yet' : 'Link a family doctor first'}
                    subtitle={linked
                        ? 'Details appear only after a booking is completed.'
                        : 'Once you’re linked, your completed bookings appear here for review.'}
                />
            )}

            {/* Read-only prescription viewer */}
            <Dialog open={!!viewRx} onClose={() => setViewRx(null)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                        <Typography sx={typography.h3}>Prescription</Typography>
                        {viewRx ? (
                            <Typography sx={typography.bodyMuted}>
                                {viewRx.doctor?.full_name || viewRx.doctor_name || 'Doctor'}
                                {viewRx.created_at ? ` · ${fmtDate(viewRx.created_at)}` : ''}
                            </Typography>
                        ) : null}
                    </Box>
                    <IconButton onClick={() => setViewRx(null)} size="small" aria-label="Close">
                        <NLIcon name="close" size={20} color={colors.textSecondary} />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {viewRx ? <PrescriptionBody rx={viewRx} /> : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setViewRx(null)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Delink confirmation */}
            <Dialog open={confirmDelink} onClose={() => setConfirmDelink(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Delink family doctor?</DialogTitle>
                <DialogContent>
                    <Typography sx={typography.body}>
                        You&apos;ll no longer be able to ask {link?.doctor_name || 'them'} for a
                        second opinion. You can re-link later with their code.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelink(false)}>Cancel</Button>
                    <Button variant="contained" color="error" disabled={delinking} onClick={doDelink}>
                        {delinking ? 'Delinking…' : 'Delink'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

/**
 * The prescription, as the API returns it. Every block is omitted when empty —
 * a heading over nothing reads as data that failed to load.
 */
const PrescriptionBody = ({ rx }) => {
    const meds = rx.medicines || rx.prescription_medicines || [];
    const Section = ({ label, children }) => (children ? (
        <>
            <Typography sx={{ ...typography.label, mt: 2, mb: 0.75 }}>{label}</Typography>
            {children}
        </>
    ) : null);

    return (
        <Box>
            <Section label="DIAGNOSIS" children={rx.diagnosis
                ? <Typography sx={typography.body}>{rx.diagnosis}</Typography> : null} />

            {meds.length ? (
                <>
                    <Typography sx={{ ...typography.label, mt: 2, mb: 0.75 }}>MEDICINES</Typography>
                    {meds.map((m, i) => (
                        <Box
                            key={m.id || `${m.name}-${i}`}
                            sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 0.5 }}
                        >
                            <Box
                                sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    bgcolor: colors.primary,
                                    mt: '7px',
                                    flexShrink: 0,
                                }}
                            />
                            <Box sx={{ minWidth: 0 }}>
                                <Typography
                                    sx={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}
                                >
                                    {m.name || m.medicine?.name || m.medicine_name || 'Medicine'}
                                </Typography>
                                <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                                    {[m.dosage, m.frequency, m.duration].filter(Boolean).join(' · ')}
                                </Typography>
                            </Box>
                        </Box>
                    ))}
                </>
            ) : null}

            <Section label="TESTS" children={rx.diagnostic_tests
                ? <Typography sx={typography.body}>{rx.diagnostic_tests}</Typography> : null} />
            <Section label="INSTRUCTIONS" children={rx.instructions
                ? <Typography sx={typography.body}>{rx.instructions}</Typography> : null} />
            <Section label="NOTES" children={rx.notes
                ? <Typography sx={typography.body}>{rx.notes}</Typography> : null} />
            <Section label="ADVICE" children={rx.doctors_advice
                ? <Typography sx={typography.body}>{rx.doctors_advice}</Typography> : null} />

            {rx.pdf_link ? (
                <>
                    <Divider sx={{ my: 2 }} />
                    <Button
                        href={rx.pdf_link}
                        target="_blank"
                        rel="noopener"
                        startIcon={<NLIcon name="document-text-outline" size={16} />}
                    >
                        Open PDF
                    </Button>
                </>
            ) : null}
        </Box>
    );
};

export default SecondOpinion;
