import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
    Box,
    Typography,
    CircularProgress,
    Alert,
    Tabs,
    Tab,
    Chip,
    Snackbar,
    Paper,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import axiosInstance from '../../../../api/axiosConfig';
import useTwilioRoom from '../../hooks/useTwilioRoom';
import Participant from '../../components/Participant/Participant';
import ScreenShare from '../../components/ScreenShare/ScreenShare';
import useScreenShareTrack from '../../hooks/useScreenShareTrack';
import ChatPanel from '../../components/ChatPanel/ChatPanel';
import Whiteboard from '../../components/Whiteboard/Whiteboard';
import MeetingControls from '../../components/MeetingControls/MeetingControls';
import AudioMeetingPage from '../AudioMeetingPage/AudioMeetingPage';
import ChatConsultationPage from '../ChatConsultationPage/ChatConsultationPage';
import ClinicalNotesPanel from '../../components/ClinicalNotesPanel/ClinicalNotesPanel';
import AppointmentDocumentsPanel from '../../components/AppointmentDocumentsPanel/AppointmentDocumentsPanel';

/**
 * ConsultationRouter - Unified entry point for all consultation types.
 *
 * Flow:
 * 1. Calls POST /api/video/join { appointmentId }
 * 2. Receives { token, roomName, identity, consultationType }
 * 3. Connects to Twilio room with appropriate mode (video/audio/chat)
 * 4. Renders the correct consultation UI based on consultationType
 *
 * Route: /meeting/:appointmentId
 * Protected: doctor + patient roles only
 */
const ConsultationRouter = () => {
    const { appointmentId } = useParams();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);

    const [token, setToken] = useState(null);
    const [roomName, setRoomName] = useState(null);
    const [consultationType, setConsultationType] = useState(null);
    const [fetchingToken, setFetchingToken] = useState(true);
    const [fetchError, setFetchError] = useState(null);

    // Call /api/video/join — validates appointment, returns token + consultationType
    useEffect(() => {
        const joinMeeting = async () => {
            try {
                // Backend expects snake_case ``appointment_id``. See
                // parallel comment in VideoMeetingPage.jsx for the
                // ``appointmentId`` → ``appointment_id`` rename.
                const response = await axiosInstance.post('/api/video/join', {
                    appointment_id: appointmentId,
                });
                const {
                    token: fetchedToken,
                    roomName: fetchedRoomName,
                    consultationType: fetchedType,
                } = response.data.data;

                setToken(fetchedToken);
                setRoomName(fetchedRoomName);
                setConsultationType(fetchedType || 'video');
            } catch (err) {
                setFetchError(
                    err.response?.data?.error || 'Failed to join consultation'
                );
            } finally {
                setFetchingToken(false);
            }
        };

        if (appointmentId) {
            joinMeeting();
        }
    }, [appointmentId]);

    // Connect to Twilio room with the appropriate mode
    const {
        room,
        participants,
        localParticipant,
        dataTrack,
        onMessage,
        isConnecting,
        error: roomError,
        disconnect,
    } = useTwilioRoom(token, roomName, consultationType || 'video');

    const handleDisconnect = () => {
        disconnect();
        if (user?.role === 'doctor') {
            navigate('/dashboard/doctor');
        } else {
            navigate('/dashboard/patient');
        }
    };

    // Loading state
    if (fetchingToken || isConnecting) {
        const modeLabel = {
            video:      'video meeting',
            audio:      'voice call',
            chat:       'chat session',
            home_visit: 'home visit',
            camp:       'camp consultation',
        }[consultationType] || 'consultation';

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
                        ? 'Joining consultation...'
                        : `Connecting to ${modeLabel}...`}
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
                        Cannot Join Consultation
                    </Typography>
                    {fetchError || roomError}
                </Alert>
            </Box>
        );
    }

    // Route to the correct consultation UI
    const commonProps = {
        appointmentId,
        room,
        participants,
        localParticipant,
        dataTrack,
        onMessage,
        disconnect: handleDisconnect,
        user,
    };

    if (consultationType === 'audio') {
        return <AudioMeetingPage {...commonProps} />;
    }

    if (consultationType === 'chat') {
        return <ChatConsultationPage {...commonProps} />;
    }

    // Default: video
    return <VideoMeetingView {...commonProps} />;
};

/**
 * VideoMeetingView - Video consultation UI.
 * Receives room connection props from ConsultationRouter instead of fetching its own token.
 */
const VideoMeetingView = ({
    appointmentId,
    room,
    participants,
    localParticipant,
    dataTrack,
    onMessage,
    disconnect,
    user,
}) => {
    const [sidebarTab, setSidebarTab] = useState(0);
    const [copiedSnackbar, setCopiedSnackbar] = useState(false);
    const isDoctor = user?.role === 'doctor';
    const { track: screenTrack } = useScreenShareTrack(participants, localParticipant);
    const isSharing = !!screenTrack;

    const handleCopyAppointmentId = () => {
        navigator.clipboard.writeText(appointmentId);
        setCopiedSnackbar(true);
    };

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
                        Video Consultation
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
                />
            </Paper>

            {/* Main content: video area + sidebar */}
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Video area */}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        p: 2,
                        gap: 2,
                    }}
                >
                    {/* Screen-share spotlight — takes the main stage while
                        anyone is sharing; renders nothing otherwise. */}
                    {isSharing && (
                        <Box sx={{ flex: 1, minHeight: 0 }}>
                            <ScreenShare
                                participants={participants}
                                localParticipant={localParticipant}
                            />
                        </Box>
                    )}
                    <Box
                        sx={
                            isSharing
                                ? {
                                    // Camera strip below the shared screen.
                                    display: 'flex',
                                    flexWrap: 'nowrap',
                                    gap: 2,
                                    height: 140,
                                    flexShrink: 0,
                                    justifyContent: 'center',
                                    '& > *': { width: 200, flexShrink: 0 },
                                }
                                : {
                                    flex: 1,
                                    display: 'grid',
                                    gridTemplateColumns:
                                        participants.length > 0 ? '1fr 1fr' : '1fr',
                                    gap: 2,
                                    alignItems: 'center',
                                    justifyItems: 'center',
                                }
                        }
                    >
                        {localParticipant && (
                            <Participant participant={localParticipant} isLocal />
                        )}
                        {participants.map((participant) => (
                            <Participant
                                key={participant.sid}
                                participant={participant}
                            />
                        ))}
                    </Box>
                </Box>

                {/* Sidebar: Chat / Whiteboard tabs */}
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
                        <Tab label="Documents" />
                        <Tab label="Whiteboard" />
                        {isDoctor && <Tab label="Notes" />}
                    </Tabs>
                    <Box sx={{ flex: 1, overflow: 'hidden' }}>
                        <Box sx={{ display: sidebarTab === 0 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <ChatPanel
                                dataTrack={dataTrack}
                                onMessage={onMessage}
                                localIdentity={localIdentity}
                            />
                        </Box>
                        <Box sx={{ display: sidebarTab === 1 ? 'block' : 'none', height: '100%' }}>
                            <AppointmentDocumentsPanel
                                appointmentId={appointmentId}
                                canUpload={!isDoctor}
                            />
                        </Box>
                        <Box sx={{ display: sidebarTab === 2 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                            <Whiteboard
                                dataTrack={dataTrack}
                                onMessage={onMessage}
                                isDoctor={isDoctor}
                            />
                        </Box>
                        {isDoctor && (
                            <Box sx={{ display: sidebarTab === 3 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                <ClinicalNotesPanel appointmentId={appointmentId} />
                            </Box>
                        )}
                    </Box>
                </Paper>
            </Box>

            {/* Bottom controls bar */}
            <MeetingControls room={room} onDisconnect={disconnect} />

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

export default ConsultationRouter;
