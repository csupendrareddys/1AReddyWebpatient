/**
 * ChannelChat — the message thread + composer for one service channel.
 *
 * Shared by patient and provider: both are just participants, so the only
 * per-side difference is which bubbles land on the right (the caller's own
 * ``my_participant_id``). Deliberately transport-agnostic — it reads history
 * over REST and refetches after sending, so it works today without a socket;
 * a realtime layer later only needs to trigger the same refetch.
 */
import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import {
    Avatar, Box, Chip, CircularProgress, IconButton, Stack, TextField, Typography,
    Alert, Button,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';

import {
    useGetChannelMessagesQuery,
    useGetChannelTimelineQuery,
    useSendChannelMessageMutation,
    useMarkChannelReadMutation,
} from '../api/scopedChannelApi';
import { useDoctorScope } from
    '../../service-provider/ProfileSetting/context/DoctorScopeContext';
import useChannelRoom from '../../../realtime/useChannelRoom';

// System timeline events, rendered inline but visually distinct from chat —
// a healthcare audit trail the reader can follow without a separate log.
const EVENT_LABEL = {
    service_booked: 'Service booked',
    channel_created: 'Conversation started',
    call_scheduled: 'Consultation scheduled',
    call_accepted: 'Consultation accepted',
    participant_joined: 'Joined the call',
    call_completed: 'Call completed',
    call_cancelled: 'Call cancelled',
    form_submitted: 'Form submitted',
    document_uploaded: 'Document uploaded',
    service_expired: 'Service ended',
    conversation_archived: 'Conversation archived',
};

// A stable-ish client id for idempotent sends — good enough to dedupe a
// double-tap / retry without pulling in a uuid dependency.
function clientId() {
    return `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function timeLabel(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

// Who a message says it came from, when that isn't the participant whose row
// sent it. Two kinds of author reach a thread this way and a reader needs to
// tell them apart: a platform operator helping out, and the practice's own
// staff working the doctor's inbox. "Support staff" is nearer than "support"
// for the second — the person IS staff of the practice you're talking to.
// Who typed it, when it wasn't the participant. Three authorities, deliberately
// worded so a patient can tell them apart at a glance: the platform's own desk,
// the practice's hired staff, and the clinic or hospital the doctor works for.
const ON_BEHALF_LABEL = {
    admin: 'Admin staff', staff: 'Support staff', employer: 'Employer',
};

/** True when someone posted this on a participant's behalf. */
const onBehalf = (m) => !!(m.sent_on_behalf ?? m.sent_by_admin);

const onBehalfLabel = (m) => {
    // ``sent_by_admin*`` is the pre-rename shape. A payload that predates the
    // deploy — an open tab, a cached socket frame — still renders its marker
    // rather than losing it, and an unknown kind degrades to the older wording
    // instead of to nothing.
    const kind = m.sent_on_behalf_kind || (m.sent_by_admin ? 'admin' : null);
    const who = ON_BEHALF_LABEL[kind] || 'Sent by support';
    const name = m.sent_on_behalf_name || m.sent_by_admin_name;
    return name ? `${who} · ${name}` : who;
};

export default function ChannelChat({ channel }) {
    const channelId = channel?.id;
    const myParticipantId = channel?.my_participant_id;

    // In Operations an admin is in a doctor↔patient conversation on the
    // doctor's behalf — they can read it AND post into it. What they post is
    // still attributed to the doctor's participant row, but the backend stamps
    // it and every bubble carries an "Admin staff" marker, so both sides can
    // tell. The practice's own support staff reach the same thread the same
    // way, marked "Support staff". Only the socket join below is skipped,
    // because the room is authorized against channel membership and neither of
    // them is a participant.
    const { isOps } = useDoctorScope();

    // A holding channel (admin ↔ held vendor) and a family-doctor second-opinion
    // channel (keyed on a prescription, no purchase) have no purchased service —
    // chat is always on while the channel is active (the backend caps the
    // second-opinion thread at 5 messages). Normal channels gate on the purchase.
    const canSend = channel?.status === 'active' && (
        channel?.is_holding
        || channel?.is_second_opinion
        || (channel?.purchased_service?.chat_enabled
            && channel?.purchased_service?.status === 'active')
    );

    // In a group channel several doctors send messages, so a bubble must name
    // its sender. Map participant id → participant to label each one; a 1:1
    // channel skips this entirely (only ever two participants).
    const isGroup = channel?.kind === 'group';
    const participantsById = {};
    (channel?.participants || []).forEach((p) => { participantsById[p.id] = p; });

    // Join this conversation's Socket.IO room so new messages arrive instantly
    // (server pushes → SocketManager invalidates → this query refetches). The
    // REST poll below stays as a fallback for when the socket is unavailable.
    // Skipped for anyone who reads the thread on someone else's behalf — an
    // operator in Operations, or the practice's own staff. The room authorizes
    // against channel membership and neither of them has a participant row, so
    // the join would be refused; the polling read keeps the pane current.
    const isStaff = useSelector((s) => s.auth?.user?.role) === 'provider_staff';
    useChannelRoom(isOps || isStaff ? null : channelId);

    const { data, isLoading } = useGetChannelMessagesQuery(
        { channelId, limit: 50 },
        { skip: !channelId, pollingInterval: 5000 },
    );
    const { data: events = [] } = useGetChannelTimelineQuery(channelId, {
        skip: !channelId, pollingInterval: 15000,
    });
    const [sendMessage, { isLoading: sending }] = useSendChannelMessageMutation();
    const [markRead] = useMarkChannelReadMutation();

    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const scrollRef = useRef(null);
    const messages = data?.messages || [];

    // Merge chat + system events into one chronological feed. Events render as
    // centered chips so they read as an audit trail, not a message.
    const feed = [
        ...messages.map((m) => ({ kind: 'msg', at: m.created_at, data: m })),
        ...events.map((e) => ({ kind: 'event', at: e.occurred_at, data: e })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    // Keep the newest entry in view as the feed grows.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [feed.length]);

    // Clear the unread marker whenever this channel is on screen with content.
    useEffect(() => {
        if (channelId && messages.length) markRead(channelId);
    }, [channelId, messages.length, markRead]);

    const handleSend = async () => {
        const body = draft.trim();
        if (!body || sending) return;
        setError('');
        try {
            await sendMessage({ channelId, body, client_msg_id: clientId() }).unwrap();
            setDraft('');
        } catch (err) {
            // The backend's friendly reasons (rate limit, flood, expiry) come
            // back here — surface them rather than a generic failure.
            setError(err?.data?.error || err?.data?.message || 'Could not send. Try again.');
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Stack sx={{ height: '100%', minHeight: 0 }}>
            <Box
                ref={scrollRef}
                sx={{
                    flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2,
                    bgcolor: 'grey.50',
                }}
            >
                {feed.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                        No messages yet. Say hello to get started.
                    </Typography>
                )}
                <Stack spacing={1.5}>
                    {feed.map((item) => {
                        if (item.kind === 'event') {
                            const e = item.data;
                            return (
                                <Stack key={`e-${e.id}`} direction="row" justifyContent="center">
                                    <Box
                                        sx={{
                                            px: 1.5, py: 0.5, borderRadius: 3,
                                            bgcolor: 'grey.200', color: 'text.secondary',
                                            fontSize: '0.7rem', maxWidth: '85%', textAlign: 'center',
                                        }}
                                    >
                                        ✓ {EVENT_LABEL[e.event_type] || e.event_type}
                                        {' · '}{timeLabel(e.occurred_at)}
                                    </Box>
                                </Stack>
                            );
                        }
                        const m = item.data;
                        const mine = m.sender_participant_id === myParticipantId;
                        // Only label incoming bubbles in a group chat, where
                        // "who said this" isn't obvious from left/right alone.
                        const sender = participantsById[m.sender_participant_id];
                        const senderName = (!mine && isGroup && sender)
                            ? (sender.display_name
                                || (sender.role === 'provider' ? 'Doctor' : 'Patient'))
                            : null;
                        return (
                            <Stack
                                key={`m-${m.id}`}
                                direction="row"
                                justifyContent={mine ? 'flex-end' : 'flex-start'}
                            >
                                <Box
                                    sx={{
                                        maxWidth: '75%',
                                        px: 1.75, py: 1, borderRadius: 2,
                                        bgcolor: mine ? 'primary.main' : '#fff',
                                        color: mine ? '#fff' : 'text.primary',
                                        border: mine ? 'none' : '1px solid',
                                        borderColor: 'grey.200',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                    }}
                                >
                                    {senderName && (
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                display: 'block', fontWeight: 700,
                                                color: 'primary.main', mb: 0.25,
                                                fontSize: '0.68rem',
                                            }}
                                        >
                                            {senderName}
                                        </Typography>
                                    )}
                                    {onBehalf(m) && (
                                        <Chip
                                            size="small"
                                            icon={<SupportAgentIcon />}
                                            label={onBehalfLabel(m)}
                                            sx={{
                                                // ``height: auto`` + a wrapping label:
                                                // the chip is inside the bubble, so at a
                                                // narrow width a fixed-height one clipped
                                                // the operator's name to "Ow…". The
                                                // "Sent by support" half must never be the
                                                // part that gets cut.
                                                height: 'auto', mb: 0.5, maxWidth: '100%',
                                                py: 0.25,
                                                '& .MuiChip-label': {
                                                    whiteSpace: 'normal',
                                                    overflow: 'visible',
                                                    textOverflow: 'clip',
                                                    lineHeight: 1.3,
                                                    px: 0.75,
                                                },
                                                fontSize: '0.62rem', fontWeight: 700,
                                                // Legible on both bubbles: a light
                                                // tint of the bubble's own colour.
                                                bgcolor: mine
                                                    ? 'rgba(255,255,255,0.25)' : '#fff4e5',
                                                color: mine ? '#fff' : '#663c00',
                                                '& .MuiChip-icon': {
                                                    color: 'inherit', fontSize: '0.9rem', ml: 0.5,
                                                },
                                            }}
                                        />
                                    )}
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {m.body}
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            display: 'block', textAlign: 'right', mt: 0.25,
                                            opacity: 0.7, fontSize: '0.65rem',
                                        }}
                                    >
                                        {timeLabel(m.created_at)}
                                    </Typography>
                                </Box>
                            </Stack>
                        );
                    })}
                </Stack>
            </Box>

            {error && (
                <Alert severity="warning" onClose={() => setError('')} sx={{ borderRadius: 0 }}>
                    {error}
                </Alert>
            )}

            {canSend ? (
                <Stack
                    direction="row"
                    spacing={1}
                    alignItems="flex-end"
                    sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'grey.200', bgcolor: '#fff' }}
                >
                    <TextField
                        fullWidth
                        multiline
                        maxRows={4}
                        size="small"
                        placeholder="Type a message…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                    />
                    <IconButton
                        color="primary"
                        onClick={handleSend}
                        disabled={!draft.trim() || sending}
                    >
                        <SendIcon />
                    </IconButton>
                </Stack>
            ) : (
                <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'grey.200', bgcolor: '#fff' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                        This conversation is read-only — the service has ended.
                        Your history stays here.
                    </Typography>
                </Box>
            )}
        </Stack>
    );
}
