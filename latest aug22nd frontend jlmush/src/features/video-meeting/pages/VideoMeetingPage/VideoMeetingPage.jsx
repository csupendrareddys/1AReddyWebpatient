import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Alert,
    Tabs,
    Tab,
    Chip,
    Snackbar,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import axiosInstance from '../../../../api/axiosConfig';
import useTwilioRoom from '../../hooks/useTwilioRoom';
import Participant from '../../components/Participant/Participant';
import ChatPanel from '../../components/ChatPanel/ChatPanel';
import Whiteboard from '../../components/Whiteboard/Whiteboard';
import MeetingControls from '../../components/MeetingControls/MeetingControls';
import ClinicalNotesPanel from '../../components/ClinicalNotesPanel/ClinicalNotesPanel';

/**
 * VideoMeetingPage - Appointment-based video meeting page.
 *
 * Flow:
 * 1. Extracts appointmentId from URL params (/meeting/:appointmentId)
 * 2. Calls POST /api/video/join { appointmentId } — validates time window,
 *    creates Twilio room if needed, returns { token, roomName, identity }
 * 3. Connects to Twilio Video room via useTwilioRoom hook
 * 4. Renders: video grid (left) + sidebar with Chat/Whiteboard tabs (right)
 * 5. Bottom toolbar with meeting controls
 *
 * Route: /meeting/:appointmentId
 * Protected: doctor + patient roles only
 */
const VideoMeetingPage = () => {
    const { appointmentId } = useParams();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);

    const [token, setToken] = useState(null);
    const [roomName, setRoomName] = useState(null);
    const [fetchingToken, setFetchingToken] = useState(true);
    const [fetchError, setFetchError] = useState(null);
    const [sidebarTab, setSidebarTab] = useState(0); // 0 = Chat, 1 = Whiteboard, 2 = Notes (doctor)
    const [copiedSnackbar, setCopiedSnackbar] = useState(false);
    const isDoctor = user?.role === 'doctor';

    // Call /api/video/join — validates appointment access + time window,
    // creates Twilio room if needed, returns token + roomName
    useEffect(() => {
        const joinMeeting = async () => {
            try {
                // Backend's @validate_json on /api/video/join expects
                // ``appointment_id`` (snake_case). The earlier
                // ``appointmentId`` key 422'd with "missing:
                // appointment_id" because Flask's snake_case-only
                // validator can't see the camelCase field.
                const response = await axiosInstance.post('/api/v1/video/join', {
                    appointment_id: appointmentId,
                });
                const { token: fetchedToken, roomName: fetchedRoomName } = response.data.data;
                setToken(fetchedToken);
                setRoomName(fetchedRoomName);
            } catch (err) {
                setFetchError(
                    err.response?.data?.error || 'Failed to join meeting'
                );
            } finally {
                setFetchingToken(false);
            }
        };

        if (appointmentId) {
            joinMeeting();
        }
    }, [appointmentId]);

    // Connect to Twilio room (waits for token + roomName to be set)
    const {
        room,
        participants,
        localParticipant,
        dataTrack,
        onMessage,
        isConnecting,
        error: roomError,
        disconnect,
    } = useTwilioRoom(token, roomName);

    const handleDisconnect = () => {
        disconnect();
        // Navigate back to the appropriate dashboard
        if (user?.role === 'doctor') {
            navigate('/dashboard/doctor');
        } else {
            navigate('/dashboard/patient');
        }
    };

    const handleCopyAppointmentId = () => {
        navigator.clipboard.writeText(appointmentId);
        setCopiedSnackbar(true);
    };

    // Loading state
    if (fetchingToken || isConnecting) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    gap: 2,
                    bgcolor: 'background.default',
                }}
            >
                <CircularProgress size={48} />
                <Typography variant="h6" color="text.secondary">
                    {fetchingToken
                        ? 'Joining meeting...'
                        : 'Connecting to room...'}
                </Typography>
            </Box>
        );
    }

    // Error state
    if (fetchError || roomError) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '100vh',
                    p: 4,
                    bgcolor: 'background.default',
                }}
            >
                <Alert severity="error" sx={{ maxWidth: 500 }}>
                    <Typography variant="h6" gutterBottom>
                        Cannot Join Meeting
                    </Typography>
                    {fetchError || roomError}
                </Alert>
            </Box>
        );
    }

    const localIdentity =
        localParticipant?.identity || user?.first_name || 'You';

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                bgcolor: 'background.default',
            }}
        >
            {/* Header bar */}
            <Paper
                elevation={2}
                sx={{
                    p: 1.5,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderRadius: 0,
                    zIndex: 1,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <VideocamIcon color="error" />
                    <Typography variant="h6" fontWeight="bold">
                        Appointment Meeting
                    </Typography>
                    <Chip
                        label={`${participants.length + 1} participant${participants.length + 1 !== 1 ? 's' : ''}`}
                        size="small"
                        variant="outlined"
                        color="success"
                    />
                </Box>

                <Chip
                    label={`ID: ${appointmentId?.slice(0, 8)}…`}
                    icon={<ContentCopyIcon />}
                    onClick={handleCopyAppointmentId}
                    variant="outlined"
                    size="small"
                    clickable
                    title="Click to copy appointment ID"
                />
            </Paper>

            {/* Main content: video area + sidebar */}
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Video area (left, main) */}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        p: 2,
                        gap: 2,
                    }}
                >
                    <Box
                        sx={{
                            flex: 1,
                            display: 'grid',
                            gridTemplateColumns:
                                participants.length > 0 ? '1fr 1fr' : '1fr',
                            gap: 2,
                            alignItems: 'center',
                            justifyItems: 'center',
                        }}
                    >
                        {/* Local participant */}
                        {localParticipant && (
                            <Participant
                                participant={localParticipant}
                                isLocal
                            />
                        )}

                        {/* Remote participants */}
                        {participants.map((participant) => (
                            <Participant
                                key={participant.sid}
                                participant={participant}
                            />
                        ))}
                    </Box>
                </Box>

                {/* Sidebar (right): Chat / Whiteboard tabs */}
                <Paper
                    elevation={3}
                    sx={{
                        width: 360,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 0,
                        borderLeft: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Tabs
                        value={sidebarTab}
                        onChange={(_, v) => setSidebarTab(v)}
                        variant="fullWidth"
                    >
                        <Tab label="Chat" />
                        <Tab label="Whiteboard" />
                        {isDoctor && <Tab label="Notes" />}
                    </Tabs>

                    <Box sx={{ flex: 1, overflow: 'hidden' }}>
                        {/* Always keep both mounted; use CSS to show/hide so state is never lost */}
                        <Box sx={{ display: sidebarTab === 0 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <ChatPanel
                                dataTrack={dataTrack}
                                onMessage={onMessage}
                                localIdentity={localIdentity}
                            />
                        </Box>
                        <Box sx={{ display: sidebarTab === 1 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <Whiteboard
                                dataTrack={dataTrack}
                                onMessage={onMessage}
                                isDoctor={isDoctor}
                            />
                        </Box>
                        {isDoctor && (
                            <Box sx={{ display: sidebarTab === 2 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                <ClinicalNotesPanel appointmentId={appointmentId} />
                            </Box>
                        )}
                    </Box>
                </Paper>
            </Box>

            {/* Bottom controls bar */}
            <MeetingControls room={room} onDisconnect={handleDisconnect} />

            {/* Copy confirmation */}
            <Snackbar
                open={copiedSnackbar}
                autoHideDuration={2000}
                onClose={() => setCopiedSnackbar(false)}
                message="Appointment ID copied!"
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Box>
    );
};

export default VideoMeetingPage;
