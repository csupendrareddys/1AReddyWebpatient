/**
 * useNewLookBookings — every product the patient has bought, on one status axis.
 *
 * This is the web replacement for the mobile MVP's ``src/data/bookingViews.ts``.
 * The design it feeds is the mobile one; the data is this app's real API.
 *
 * A booking's lifecycle state means different things in each product type — a
 * consultation is ``confirmed``, a marketplace service is ``under_process``, a
 * health plan is ``active``. Three backends, three vocabularies. These helpers
 * flatten all of them onto ONE axis (upcoming / in progress / completed /
 * cancelled) so the home tiles and the Bookings page can show a single
 * cross-category list, and a count on the dashboard always matches what the
 * list it links to actually contains.
 *
 * Two axes are deliberately kept apart, exactly as in the mobile screen:
 * **status** is the view, **category** is a filter that defaults to All.
 * Folding them together is what made the old two-mode screen confusing.
 */
import { useMemo } from 'react';
import {
    useGetUpcomingOrdersQuery,
    useGetPreviousOrdersQuery,
    useGetPatientMarketplaceOrdersQuery,
    useGetMyGroupOfferingBookingsQuery,
    useListMyServiceChannelsQuery,
    useGetFollowUpInvitesQuery,
} from '../../api/scopedBookingApi';
// ASSUMED endpoint (#6 in api/assumedEndpoints.js) — recovery plans have no
// backend product yet. The query 404s harmlessly and contributes nothing until
// the endpoint ships, at which point these rows appear with no further change.
import { useGetNLRecoveryPlanOrdersQuery } from '../api/assumedEndpoints';
import { useGetMySecondOpinionBookingsQuery } from '../../../family-doctor/api/familyDoctorEndpoints';
import { CONSULTATION_TYPE_MAP } from '../../../service-provider/ProfileSetting/constants/consultationTypes';
import { colors } from '../theme/tokens';
import { fmtDate, fmtTime, humanise, inr } from '../utils/format';

/**
 * The order care moves through.
 *
 * Pending leads because it's the only stage that's waiting on somebody: the
 * doctor or care team hasn't accepted yet, or the booking is sitting unpaid.
 * Everything after it is already settled one way or another.
 *
 * There is no separate Cancelled stage. A booking that was rejected, cancelled
 * or left to expire is finished, so it lands in Completed carrying a tag that
 * says which — splitting it out would hide those rows behind a tab nobody
 * thinks to open, while a tag puts the outcome on the row itself.
 */
export const VIEW_ORDER = [
    'pending', 'upcoming', 'in_progress', 'free_follow_up',
    'completed', 'second_opinion', 'cancelled',
];

export const VIEW_TITLE = {
    pending: 'Pending',
    upcoming: 'Upcoming',
    in_progress: 'In progress',
    free_follow_up: 'Free follow-up',
    completed: 'Completed',
    second_opinion: 'Family Doc Second Opinion',
    cancelled: 'Cancelled',
};

export const VIEW_ICON = {
    pending: 'time-outline',
    upcoming: 'calendar-outline',
    in_progress: 'hourglass-outline',
    free_follow_up: 'add-circle-outline',
    completed: 'checkmark-done-outline',
    second_opinion: 'medical-outline',
    cancelled: 'close-circle-outline',
};

/** Four distinct hues, read left to right as the booking progresses. */
export const VIEW_TINT = {
    pending: '#f9a825',
    upcoming: colors.primary,
    in_progress: colors.warning,
    free_follow_up: colors.secondary,
    completed: colors.success,
    second_opinion: colors.primaryDark,
    cancelled: colors.error,
};

/** Status label shown on a row's detail dialog, per view. */
export const VIEW_STATUS_LABEL = {
    pending: 'Waiting to be accepted',
    upcoming: 'Accepted · not started yet',
    in_progress: 'In progress',
    free_follow_up: 'Follow-up offered — not booked yet',
    completed: 'Finished',
    second_opinion: 'Eligible for a family-doctor review',
    cancelled: 'Cancelled, rejected or expired',
};

export const VIEW_SUBTITLE = {
    pending: 'Waiting for the doctor or care team to accept, or for payment to be settled.',
    upcoming: 'Accepted and scheduled — nothing to do until it starts.',
    in_progress: 'Care that has already begun.',
    free_follow_up: 'Follow-ups your doctor has offered after a consultation. Book the slot to turn one into an appointment.',
    completed: 'Consultations, services and plans that finished as intended.',
    second_opinion: 'Completed bookings whose prescription your family doctor can review. Opening one starts the conversation.',
    cancelled: 'Bookings that ended without being delivered — cancelled, rejected, or left to expire.',
};

const PLAN_TINT = '#5e35b1';

/**
 * ── Status → view, per product type ──────────────────────────────────────
 *
 * The backend already runs the lifecycle this screen describes
 * (``AppointmentService.apply_acceptance_mode``): the patient books, payment
 * lands, and the booking sits PENDING until the doctor's acceptance mode
 * resolves it — auto_accept → CONFIRMED, auto_reject → CANCELLED with the slot
 * released and health credits refunded, manual → left PENDING for the doctor to
 * act on. So "waiting to be accepted" isn't a UI invention; PENDING *is* that
 * state, and PENDING_PAYMENT is the same wait with the money still outstanding.
 *
 * Marketplace services and group-offering plans have the same shape under
 * different names: unpaid, then awaiting the provider or care team, then
 * running. Those all fold onto Pending too.
 *
 * Terminal-but-not-completed states (cancelled, rejected, expired, no-show) map
 * to Completed and carry a tag naming the outcome — see CANCELLED_TAG below.
 */
const APPOINTMENT_VIEW = {
    pending_payment: 'pending',
    pending: 'pending',
    confirmed: 'upcoming',
    in_progress: 'in_progress',
    completed: 'completed',
    cancelled: 'cancelled',
    no_show: 'cancelled',
    expired: 'cancelled',
};

const SERVICE_VIEW = {
    // Unpaid, or paid and waiting on the provider to accept.
    pending: 'pending',
    paid: 'pending',
    accepted: 'pending',
    under_process: 'in_progress',
    completed: 'completed',
    rejected: 'cancelled',
    cancelled: 'cancelled',
};

const PLAN_VIEW = {
    pending_payment: 'pending',
    pending_acceptance: 'pending',
    active: 'in_progress',
    completed: 'completed',
    cancelled: 'cancelled',
};

// Recovery plans (assumed endpoint): "in_process" is the running state, as in
// the mobile MVP's data. Pending/confirmed haven't started yet.
const RECOVERY_VIEW = {
    pending: 'pending',
    confirmed: 'upcoming',
    in_process: 'in_progress',
    completed: 'completed',
    cancelled: 'cancelled',
    rejected: 'cancelled',
};

/**
 * Why a Pending row is waiting — the patient can act on one of these and not
 * the other, so the row has to say which.
 *
 *   'payment'  → the patient (or whoever booked for them) still owes money.
 *   'approval' → paid, waiting on the doctor / provider / care team.
 *
 * MUST be keyed by product type, not by status string alone: bare ``pending``
 * means opposite things across these backends. A consultation is PENDING only
 * *after* payment lands (it's the doctor who's holding it up), while a
 * marketplace order sits ``pending`` precisely because it is UNPAID — the
 * services page labels that one "PAYMENT PENDING · Finish payment to send your
 * request". Sharing one map got every unpaid service order labelled as waiting
 * on the provider, which is the one thing the patient can actually clear.
 */
const PENDING_REASON = {
    consultation: {
        pending_payment: 'payment',
        pending: 'approval',
    },
    service: {
        pending: 'payment',
        paid: 'approval',
        accepted: 'approval',
    },
    plan: {
        pending_payment: 'payment',
        pending_acceptance: 'approval',
    },
    recovery: {
        pending: 'approval',
    },
};

const PENDING_LABEL = {
    consultation: {
        payment: 'Payment pending',
        approval: 'Waiting for the doctor to accept',
    },
    service: {
        payment: 'Payment pending',
        approval: 'Waiting for the provider to accept',
    },
    plan: {
        payment: 'Payment pending',
        approval: 'Waiting for the care team to accept',
    },
    recovery: {
        payment: 'Payment pending',
        approval: 'Waiting for the care team to accept',
    },
};

/**
 * The tag a finished-but-not-completed booking carries in the Completed list.
 * Named by cause rather than all called "Cancelled": an expired reservation and
 * a doctor's rejection are different events, and the patient's next move
 * differs too.
 */
const CANCELLED_TAG = {
    cancelled: 'Cancelled',
    rejected: 'Rejected',
    expired: 'Expired',
    no_show: 'No show',
};

/** Which glyph a consultation gets — its medium, not its status. */
const CONSULT_ICON = {
    video: 'videocam-outline',
    audio: 'call-outline',
    chat: 'chatbubble-outline',
    complete: 'business-outline',
    home_visit: 'home-outline',
    camp: 'tent-outline',
};

const viewOf = (map, status) => map[String(status || '').toLowerCase()] || null;

const norm = (s) => String(s || '').toLowerCase();

/**
 * The stage fields every row carries, derived from its raw status once so the
 * three product types can't drift on what "pending" or "cancelled" means.
 */
const stageOf = (kind, status) => {
    const st = norm(status);
    const reason = PENDING_REASON[kind]?.[st] || null;
    const tag = CANCELLED_TAG[st] || null;
    return {
        pendingReason: reason,
        pendingLabel: reason ? PENDING_LABEL[kind]?.[reason] || null : null,
        // Set on a booking that ended without being delivered. Drives the tag in
        // the Completed list and the refund note on the detail dialog.
        cancelledTag: tag,
        isCancelled: !!tag,
        // Health credits spent on a cancelled CONSULTATION are returned to the
        // wallet by the backend itself (credit_service.refund_for_ref, called
        // from both cancel() and the auto-reject path). Services and plans are
        // settled by the provider out-of-band, so don't promise otherwise.
        refundsToWallet: !!tag && kind === 'consultation',
    };
};

/**
 * What a consultation lets you do right now. Derived from the booking's own
 * medium rather than guessed: a video consult carries video and chat, a voice
 * consult carries the call, and any consultation accepts documents (that's the
 * Attach Document action the appointments page already offers).
 */
const consultCaps = (consultationType) => {
    const ct = String(consultationType || 'video').toLowerCase();
    return {
        video: ct === 'video',
        voice: ct === 'audio' || ct === 'video',
        chat: ct === 'chat' || ct === 'video',
        files: true,
    };
};

const useNewLookBookings = () => {
    const upcomingQ = useGetUpcomingOrdersQuery();
    const historyQ = useGetPreviousOrdersQuery();
    const servicesQ = useGetPatientMarketplaceOrdersQuery();
    const plansQ = useGetMyGroupOfferingBookingsQuery();
    const recoveryQ = useGetNLRecoveryPlanOrdersQuery();
    // Follow-up invites a doctor has offered — REAL (``/follow-up-invites``,
    // PENDING only). FollowUpType.FREE_DOCTOR is the free one; the paid kinds
    // ride the same list and are labelled as such rather than hidden.
    const followUpsQ = useGetFollowUpInvitesQuery();
    // Completed bookings your family doctor may review — REAL
    // (``/family-doctor/me/bookings``, prescriptions only).
    const secondOpinionQ = useGetMySecondOpinionBookingsQuery();
    // Only used to decide which service rows can advertise chat / calls / files.
    // A channel exists once a communication-enabled service was activated, and
    // even then each medium is a separate flag on the purchased service.
    const channelsQ = useListMyServiceChannelsQuery();

    const appointments = useMemo(() => ([
        ...(upcomingQ.data?.orders || []),
        ...(historyQ.data?.orders || []),
    ]), [upcomingQ.data, historyQ.data]);

    const capsByOrderId = useMemo(() => {
        const map = new Map();
        (channelsQ.data || []).forEach((c) => {
            const ps = c?.purchased_service;
            if (!ps?.order_id || c.status === 'archived') return;
            const prev = map.get(ps.order_id) || {};
            map.set(ps.order_id, {
                chat: prev.chat || !!ps.chat_enabled,
                voice: prev.voice || !!ps.audio_enabled,
                video: prev.video || !!ps.video_enabled,
                files: prev.files || !!ps.documents_enabled,
            });
        });
        return map;
    }, [channelsQ.data]);

    const rows = useMemo(() => {
        const out = [];

        // ── Consultations ────────────────────────────────────────────────
        appointments.forEach((a) => {
            const view = viewOf(APPOINTMENT_VIEW, a.status);
            if (!view) return;
            const ct = String(a.consultation_type || 'video').toLowerCase();
            const typeMeta = CONSULTATION_TYPE_MAP[ct];
            const when = [fmtDate(a.appointment_date), fmtTime(a.start_time)]
                .filter(Boolean).join(' · ');
            out.push({
                id: `appt-${a.id}`,
                rawId: a.id,
                kind: 'consultation',
                kindLabel: 'Consultation',
                title: a.doctor?.full_name ? `Dr. ${a.doctor.full_name}` : 'Consultation',
                subtitle: a.doctor?.specialization || typeMeta?.label || 'Consultation',
                // Who provided it — lets the dashboard derive "your favourite
                // doctor" from actual booking history instead of a mock.
                doctorId: a.doctor_id || a.doctor?.id || null,
                providerName: a.doctor?.full_name || null,
                meta: [when, humanise(a.consultation_type)].filter(Boolean).join(' · '),
                icon: CONSULT_ICON[ct] || 'videocam-outline',
                tint: typeMeta?.color || colors.primary,
                categoryKey: ct,
                categoryLabel: typeMeta?.label || humanise(ct) || 'Consultation',
                statusRaw: a.status,
                statusLabel: humanise(a.status),
                amount: a.consultation_fee ?? a.payment?.amount ?? null,
                paid: !!a.payment?.paid,
                // An unpaid reservation is held only until this passes, after
                // which the slot is released — the one pending row with a clock
                // on it.
                expiresAt: a.expires_at || null,
                view,
                ...stageOf('consultation', a.status),
                // Capability glyphs are a live-booking affordance, so only the
                // in-progress view shows them — same rule as the mobile screen.
                caps: view === 'in_progress' ? consultCaps(ct) : undefined,
                target: 'my-appointments',
            });
        });

        // ── Marketplace services ─────────────────────────────────────────
        (servicesQ.data || []).forEach((o) => {
            const view = viewOf(SERVICE_VIEW, o.status);
            if (!view) return;
            out.push({
                id: `svc-${o.id}`,
                rawId: o.id,
                kind: 'service',
                kindLabel: 'Service',
                title: o.product_name || 'Service',
                subtitle: o.doctor_name ? `Dr. ${o.doctor_name}` : 'Service provider',
                doctorId: o.doctor_id || null,
                providerName: o.doctor_name || null,
                meta: [
                    o.created_at ? `Ordered ${fmtDate(o.created_at)}` : '',
                    o.price_at_purchase != null ? inr(o.price_at_purchase) : '',
                ].filter(Boolean).join(' · '),
                icon: 'storefront-outline',
                tint: colors.secondary,
                categoryKey: 'service',
                categoryLabel: 'Services',
                statusRaw: o.status,
                statusLabel: humanise(o.status),
                amount: o.price_at_purchase ?? null,
                paid: norm(o.status) !== 'pending',
                view,
                ...stageOf('service', o.status),
                caps: view === 'in_progress' ? capsByOrderId.get(o.id) : undefined,
                target: 'my-appointments',
            });
        });

        // ── Health plans (group offerings) ───────────────────────────────
        (plansQ.data || []).forEach((b) => {
            const view = viewOf(PLAN_VIEW, b.status);
            if (!view) return;
            const paidAmt = b.amount_paid ?? 0;
            const total = b.total_payable ?? 0;
            out.push({
                id: `plan-${b.id}`,
                rawId: b.id,
                kind: 'plan',
                kindLabel: 'Health Plan',
                title: b.plan_name || 'Health plan',
                subtitle: b.team_name || 'Care team',
                meta: total ? `Paid ${inr(paidAmt)} of ${inr(total)}` : inr(paidAmt),
                icon: 'heart-circle-outline',
                tint: PLAN_TINT,
                categoryKey: 'health_plan',
                categoryLabel: 'Health Plans',
                statusRaw: b.status,
                statusLabel: humanise(b.status),
                amount: total || paidAmt || null,
                paid: total > 0 && paidAmt >= total,
                view,
                ...stageOf('plan', b.status),
                caps: undefined,
                target: 'health-plans',
            });
        });

        // ── Recovery plans (assumed endpoint — empty until it ships) ──────
        (recoveryQ.data || []).forEach((o) => {
            const view = viewOf(RECOVERY_VIEW, o.status);
            if (!view) return;
            out.push({
                id: `rec-${o.id}`,
                rawId: o.id,
                kind: 'recovery',
                kindLabel: 'Recovery Plan',
                title: o.plan_name || 'Recovery plan',
                subtitle: 'Recovery plan',
                meta: [
                    o.ordered_on ? `Started ${fmtDate(o.ordered_on)}` : '',
                    o.amount != null ? inr(o.amount) : '',
                ].filter(Boolean).join(' · '),
                icon: 'thermometer-outline',
                tint: colors.error,
                categoryKey: 'recovery',
                categoryLabel: 'Recovery Plans',
                statusRaw: o.status,
                statusLabel: humanise(o.status),
                amount: o.amount ?? null,
                paid: !['pending'].includes(norm(o.status)),
                view,
                ...stageOf('recovery', o.status),
                caps: undefined,
                target: 'newlook/recovery-plans',
            });
        });

        // ── Free follow-ups (real) ───────────────────────────────────────
        (followUpsQ.data || []).forEach((inv) => {
            const isFree = norm(inv.follow_up_type) === 'free_doctor';
            const slot = inv.reserved_slot;
            const when = slot
                ? `${fmtDate(slot.date)} · ${fmtTime(slot.start)}`
                : inv.suggested_date ? `Suggested ${fmtDate(inv.suggested_date)}` : '';
            const ct = norm(inv.consultation_type || 'video');
            out.push({
                id: `fu-${inv.id}`,
                rawId: inv.id,
                kind: 'follow_up',
                kindLabel: isFree ? 'Free follow-up' : 'Follow-up',
                title: inv.doctor_name ? `Dr. ${inv.doctor_name}` : 'Follow-up',
                subtitle: isFree
                    ? 'Offered free by your doctor'
                    : 'Follow-up offered by your doctor',
                meta: [when, humanise(ct)].filter(Boolean).join(' · '),
                icon: CONSULT_ICON[ct] || 'add-circle-outline',
                tint: isFree ? colors.secondary : colors.primary,
                categoryKey: ct,
                categoryLabel: CONSULTATION_TYPE_MAP[ct]?.label || humanise(ct) || 'Follow-up',
                statusRaw: inv.status,
                statusLabel: isFree ? 'Free — book your slot' : 'Book your slot',
                amount: isFree ? 0 : null,
                paid: isFree,
                // The slot is only held until this passes.
                expiresAt: inv.soft_reservation_expiry || null,
                doctorId: inv.doctor_id || null,
                providerName: inv.doctor_name || null,
                view: 'free_follow_up',
                pendingReason: null,
                pendingLabel: null,
                cancelledTag: null,
                isCancelled: false,
                refundsToWallet: false,
                caps: undefined,
                target: 'my-appointments',
            });
        });

        // ── Family-doctor second opinions (real) ─────────────────────────
        (secondOpinionQ.data?.bookings || [])
            .filter((b) => b.prescription)
            .forEach((b) => {
                const ct = norm(b.type);
                out.push({
                    id: `so-${b.booking_id}`,
                    rawId: b.booking_id,
                    kind: 'second_opinion',
                    kindLabel: 'Second Opinion',
                    title: humanise(b.type) || 'Booking',
                    subtitle: b.provider_name || 'Provider',
                    meta: [
                        b.completed_date ? `Completed ${fmtDate(b.completed_date)}` : '',
                        secondOpinionQ.data?.doctor_name
                            ? `Reviewable by Dr. ${secondOpinionQ.data.doctor_name}` : '',
                    ].filter(Boolean).join(' · '),
                    icon: 'medical-outline',
                    tint: colors.primaryDark,
                    categoryKey: ct || 'second_opinion',
                    categoryLabel: CONSULTATION_TYPE_MAP[ct]?.label || humanise(ct) || 'Second opinion',
                    statusRaw: b.prescription?.status,
                    statusLabel: 'Prescription ready to review',
                    amount: null,
                    paid: true,
                    view: 'second_opinion',
                    pendingReason: null,
                    pendingLabel: null,
                    cancelledTag: null,
                    isCancelled: false,
                    refundsToWallet: false,
                    caps: undefined,
                    // Asking is a POST that opens a channel, so the row leads to
                    // the page that owns that action rather than doing it here.
                    target: 'newlook/second-opinion',
                });
            });

        return out;
    }, [appointments, servicesQ.data, plansQ.data, recoveryQ.data, followUpsQ.data,
        secondOpinionQ.data, capsByOrderId]);

    const byView = useMemo(() => {
        const groups = {
            pending: [], upcoming: [], in_progress: [], free_follow_up: [],
            completed: [], second_opinion: [], cancelled: [],
        };
        rows.forEach((r) => groups[r.view]?.push(r));
        // Inside Pending, what needs the patient's money comes before what needs
        // somebody else's signature — one of those they can act on right now.
        groups.pending.sort((a, b) => {
            const rank = (r) => (r.pendingReason === 'payment' ? 0 : 1);
            return rank(a) - rank(b);
        });
        return groups;
    }, [rows]);

    /** How the Pending total splits — drives the heading breakdown. */
    const pendingSplit = useMemo(() => {
        const p = byView.pending || [];
        return {
            payment: p.filter((r) => r.pendingReason === 'payment').length,
            approval: p.filter((r) => r.pendingReason === 'approval').length,
        };
    }, [byView]);

    /** Cancelled / rejected / expired rows, which live inside Completed. */
    const cancelledCount = useMemo(() => (byView.cancelled || []).length, [byView]);

    const counts = useMemo(() => VIEW_ORDER.reduce((acc, v) => {
        acc[v] = byView[v].length;
        return acc;
    }, {}), [byView]);

    /**
     * Which categories actually have bookings in this status. Offering every
     * category when most are empty makes the filter feel broken.
     */
    const categoriesInView = (view) => {
        const seen = new Map();
        (byView[view] || []).forEach((r) => {
            const hit = seen.get(r.categoryKey);
            if (hit) hit.count += 1;
            else seen.set(r.categoryKey, { key: r.categoryKey, label: r.categoryLabel, count: 1 });
        });
        return [...seen.values()];
    };

    const isLoading = upcomingQ.isLoading || historyQ.isLoading
        || servicesQ.isLoading || plansQ.isLoading;
    // A partial failure still shows what did load — losing the marketplace call
    // shouldn't blank out the patient's consultations.
    const isError = !!(upcomingQ.error && historyQ.error && servicesQ.error && plansQ.error);
    const failed = [
        upcomingQ.error || historyQ.error ? 'consultations' : null,
        servicesQ.error ? 'services' : null,
        plansQ.error ? 'health plans' : null,
    ].filter(Boolean);

    return {
        rows,
        byView,
        counts,
        pendingSplit,
        cancelledCount,
        categoriesInView,
        isLoading,
        isError,
        failed,
        refetch: () => {
            upcomingQ.refetch?.();
            historyQ.refetch?.();
            servicesQ.refetch?.();
            plansQ.refetch?.();
        },
    };
};

export default useNewLookBookings;
