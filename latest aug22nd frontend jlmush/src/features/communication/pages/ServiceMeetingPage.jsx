/**
 * ServiceMeetingPage — the full-page voice/video call for a SERVICE channel.
 *
 * Mirrors the appointment consultation page (video grid + sidebar), reusing the
 * shared call components (useTwilioRoom, Participant, ChatPanel, Whiteboard,
 * MeetingControls). Differences from the appointment page:
 *   - token comes from the service `join` endpoint, not /api/video/join;
 *   - sidebar is Chat / Documents / Whiteboard — NO prescription/clinical notes;
 *   - Documents reuses the service channel's ChannelDocumentsPanel.
 *
 * Route: /service-call/:channelId/:callId
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Paper, Typography, Chip, Tabs, Tab, Button, CircularProgress, Alert,
    Stack,
} from '@mui/material';
import CallIcon from '@mui/icons-material/Call';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import useTwilioRoom from '../../video-meeting/hooks/useTwilioRoom';
import Participant from '../../video-meeting/components/Participant/Participant';
import ScreenShare from '../../video-meeting/components/ScreenShare/ScreenShare';
import useScreenShareTrack from '../../video-meeting/hooks/useScreenShareTrack';
import ChatPanel from '../../video-meeting/components/ChatPanel/ChatPanel';
import Whiteboard from '../../video-meeting/components/Whiteboard/Whiteboard';
import MeetingControls from '../../video-meeting/components/MeetingControls/MeetingControls';
import ChannelDocumentsPanel from '../components/ChannelDocumentsPanel';
import {
    useGetServiceChannelQuery,
    useCallActionMutation,
} from '../../admin/api/serviceCommunicationEndpoints';

export default function ServiceMeetingPage() {
    const { channelId, callId } = useParams();
    const navigate = useNavigate();

    const { data: channel } = useGetServiceChannelQuery(channelId, { skip: !channelId });
    const [callAction] = useCallActionMutation();

    const [joinInfo, setJoinInfo] = useState(null);
    const [joinError, setJoinError] = useState('');
    const [sidebarTab, setSidebarTab] = useState(0);

    // Join on mount — opens the billing session and returns the Twilio token.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await callAction({ channelId, callId, action: 'join' }).unwrap();
                if (!cancelled) setJoinInfo(res?.data || res || {});
            } catch (err) {
                if (!cancelled) {
                    setJoinError(err?.data?.error || err?.data?.message || 'Could not join the call.');
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, callId]);

    const mode = joinInfo?.mode || 'audio';
    const configured = !!joinInfo?.calling_configured && !!joinInfo?.token;
    const {
        room, participants, localParticipant, dataTrack, onMessage, isConnecting, error, disconnect,
    } = useTwilioRoom(configured ? joinInfo.token : null, configured ? joinInfo.room_name : null, mode);

    const isProvider = channel?.my_role === 'provider';
    const localIdentity = localParticipant?.identity || (isProvider ? 'Doctor' : 'You');
    const { track: screenTrack } = useScreenShareTrack(participants, localParticipant);
    const isSharing = !!screenTrack;

    const leaveAndExit = async () => {
        try { disconnect(); } catch { /* SDK is forgiving */ }
        try { await callAction({ channelId, callId, action: 'leave' }).unwrap(); } catch { /* best-effort */ }
        navigate(-1);
    };

    // ── Not connectable: error, or Twilio not configured on the server ────
    if (joinError || (joinInfo && !configured)) {
        return (
            <Box sx={{ p: 4, maxWidth: 560, mx: 'auto' }}>
                <Alert severity={joinError ? 'error' : 'info'} sx={{ mb: 2 }}>
                    {joinError
                        || 'Calling isn’t set up on the server yet (Twilio keys). The call session was logged, but there’s no live audio/video.'}
                </Alert>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>Back to chat</Button>
            </Box>
        );
    }

    if (!joinInfo || isConnecting || !room) {
        return (
            <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ height: '100vh' }}>
                <CircularProgress />
                <Typography variant="body2" color="text.secondary">Connecting to the call…</Typography>
            </Stack>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
            {/* Header */}
            <Paper elevation={2} sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 0, zIndex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CallIcon color="primary" />
                    <Typography variant="h6" fontWeight="bold">
                        {mode === 'video' ? 'Video call' : 'Voice call'}
                    </Typography>
                    <Chip
                        label={`${participants.length + 1} on the call`}
                        size="small" variant="outlined" color="success"
                    />
                </Box>
                <Typography variant="body2" color="text.secondary" noWrap>
                    {channel?.purchased_service?.product_name || 'Service'}
                </Typography>
            </Paper>

            {error && <Alert severity="warning" sx={{ borderRadius: 0 }}>{error}</Alert>}

            {/* Main: participant grid + sidebar */}
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2, gap: 2 }}>
                    {/* Screen-share spotlight — main stage while anyone shares. */}
                    {isSharing && (
                        <Box sx={{ flex: 1, minHeight: 0 }}>
                            <ScreenShare participants={participants} localParticipant={localParticipant} />
                        </Box>
                    )}
                    <Box sx={
                        isSharing
                            ? {
                                display: 'flex', flexWrap: 'nowrap', gap: 2, height: 140,
                                flexShrink: 0, justifyContent: 'center',
                                '& > *': { width: 200, flexShrink: 0 },
                            }
                            : {
                                flex: 1, display: 'grid',
                                gridTemplateColumns: participants.length > 0 ? '1fr 1fr' : '1fr',
                                gap: 2, alignItems: 'center', justifyItems: 'center',
                            }
                    }>
                        {localParticipant && <Participant participant={localParticipant} isLocal />}
                        {participants.map((p) => <Participant key={p.sid} participant={p} />)}
                    </Box>
                </Box>

                <Paper elevation={3} sx={{ width: 360, display: 'flex', flexDirection: 'column', borderRadius: 0, borderLeft: '1px solid', borderColor: 'divider' }}>
                    <Tabs value={sidebarTab} onChange={(_, v) => setSidebarTab(v)} variant="fullWidth">
                        <Tab label="Chat" />
                        <Tab label="Documents" />
                        <Tab label="Whiteboard" />
                    </Tabs>
                    <Box sx={{ flex: 1, overflow: 'hidden' }}>
                        <Box sx={{ display: sidebarTab === 0 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <ChatPanel dataTrack={dataTrack} onMessage={onMessage} localIdentity={localIdentity} />
                        </Box>
                        <Box sx={{ display: sidebarTab === 1 ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
                            {channel && <ChannelDocumentsPanel channel={channel} />}
                        </Box>
                        <Box sx={{ display: sidebarTab === 2 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <Whiteboard dataTrack={dataTrack} onMessage={onMessage} isDoctor={isProvider} />
                        </Box>
                    </Box>
                </Paper>
            </Box>

            {/* Controls */}
            <MeetingControls room={room} onDisconnect={leaveAndExit} />
        </Box>
    );
}
