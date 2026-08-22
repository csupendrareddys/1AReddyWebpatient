import { useState, useEffect, useRef } from 'react';
import {
    Box,
    Typography,
    Paper,
    Avatar,
    IconButton,
    Tooltip,
    Chip,
    Snackbar,
    Tabs,
    Tab,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import PersonIcon from '@mui/icons-material/Person';
import ChatPanel from '../../components/ChatPanel/ChatPanel';
import ClinicalNotesPanel from '../../components/ClinicalNotesPanel/ClinicalNotesPanel';
import AppointmentDocumentsPanel from '../../components/AppointmentDocumentsPanel/AppointmentDocumentsPanel';

/**
 * RemoteAudio — invisible <audio> sink that subscribes to a remote
 * participant's audio tracks and attaches them to the DOM. Twilio's
 * Video JS SDK only renders audio once a track is ``track.attach``'d
 * to an HTMLAudioElement that lives in the DOM. Without this the
 * room signalling succeeds, both sides show "Connected", mics
 * publish — but no sound is ever heard. The full ``<Participant>``
 * component (used by the video page) does this attach for both
 * audio + video; the audio-only page previously rendered only a
 * static avatar and never attached anything, hence the silence.
 *
 * Mirrors the audio-track logic in ``components/Participant``:
 * subscribe on mount, re-attach when the track list changes, and
 * detach on unmount so we don't leak audio elements between calls.
 */
const RemoteAudio = ({ participant }) => {
    const [audioTracks, setAudioTracks] = useState([]);
    const audioRef = useRef();

    useEffect(() => {
        const onTrackSubscribed = (track) => {
            if (track.kind === 'audio') {
                setAudioTracks((prev) => [...prev, track]);
            }
        };
        const onTrackUnsubscribed = (track) => {
            if (track.kind === 'audio') {
                setAudioTracks((prev) => prev.filter((t) => t !== track));
            }
        };

        // Seed with any tracks that landed before our handlers ran
        // (the room is often already connected by the time this
        // component mounts, so the existing-tracks pass is the one
        // that actually populates state in steady state).
        const existing = Array.from(participant.tracks.values())
            .filter((pub) => pub.track && pub.track.kind === 'audio')
            .map((pub) => pub.track);
        setAudioTracks(existing);

        participant.on('trackSubscribed', onTrackSubscribed);
        participant.on('trackUnsubscribed', onTrackUnsubscribed);
        return () => {
            participant.off('trackSubscribed', onTrackSubscribed);
            participant.off('trackUnsubscribed', onTrackUnsubscribed);
        };
    }, [participant]);

    useEffect(() => {
        const audioTrack = audioTracks[0];
        if (audioTrack && audioRef.current) {
            audioTrack.attach(audioRef.current);
            return () => {
                audioTrack.detach();
            };
        }
    }, [audioTracks]);

    // ``autoPlay`` is required so the browser starts playback as
    // soon as the track lands — without it, Chrome will buffer
    // silently until the first user gesture. ``muted={false}`` is
    // the default but spelt out for clarity (we are explicitly NOT
    // a local-mic preview here — that's what the local participant
    // mute button toggles in ``toggleAudio`` below).
    return <audio ref={audioRef} autoPlay muted={false} />;
};

/**
 * AudioMeetingPage - Audio-only consultation with chat sidebar.
 *
 * Props come from the parent ConsultationRouter which has already
 * connected to the Twilio room in audio mode.
 */
const AudioMeetingPage = ({
    appointmentId,
    room,
    participants,
    localParticipant,
    dataTrack,
    onMessage,
    disconnect,
    user,
}) => {
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [copiedSnackbar, setCopiedSnackbar] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [sidebarTab, setSidebarTab] = useState(0);
    const timerRef = useRef(null);
    const isDoctor = user?.role === 'doctor';

    // Call duration timer
    useEffect(() => {
        timerRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(timerRef.current);
    }, []);

    const formatDuration = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const toggleAudio = () => {
        if (!room) return;
        room.localParticipant.audioTracks.forEach((pub) => {
            if (isAudioMuted) {
                pub.track.enable();
            } else {
                pub.track.disable();
            }
        });
        setIsAudioMuted(!isAudioMuted);
    };

    const handleCopyAppointmentId = () => {
        navigator.clipboard.writeText(appointmentId);
        setCopiedSnackbar(true);
    };

    const localIdentity =
        localParticipant?.identity || user?.first_name || 'You';

    const remoteParticipant = participants[0]; // 1-to-1 call
    const remoteIdentity = remoteParticipant?.identity || 'Waiting for other party...';
    const isConnected = participants.length > 0;

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                bgcolor: 'background.default',
            }}
        >
            {/* Header */}
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
                    <PhoneIcon color="success" />
                    <Typography variant="h6" fontWeight="bold">
                        Voice Consultation
                    </Typography>
                    <Chip
                        label={isConnected ? 'Connected' : 'Waiting...'}
                        size="small"
                        variant="outlined"
                        color={isConnected ? 'success' : 'warning'}
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

            {/* Main content: Audio visualization + Chat */}
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Audio call area (left, main) */}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        p: 4,
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
                    }}
                >
                    {/* Remote participant avatar */}
                    <Avatar
                        sx={{
                            width: 120,
                            height: 120,
                            bgcolor: isConnected ? 'success.main' : 'grey.600',
                            fontSize: '3rem',
                            boxShadow: isConnected
                                ? '0 0 30px rgba(76, 175, 80, 0.4)'
                                : 'none',
                            transition: 'all 0.3s',
                        }}
                    >
                        <PersonIcon sx={{ fontSize: '3rem' }} />
                    </Avatar>

                    <Typography variant="h5" color="white" fontWeight="bold">
                        {remoteIdentity}
                    </Typography>

                    {/* Audio visualization indicator */}
                    {isConnected && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <GraphicEqIcon sx={{ color: 'success.light', fontSize: 28 }} />
                            <Typography variant="body1" color="success.light">
                                Call in progress
                            </Typography>
                        </Box>
                    )}

                    {/* Call duration */}
                    <Typography variant="h4" color="grey.400" fontFamily="monospace">
                        {formatDuration(callDuration)}
                    </Typography>

                    {/* Local identity */}
                    <Chip
                        label={`You: ${localIdentity}`}
                        size="small"
                        sx={{ color: 'grey.300', borderColor: 'grey.600' }}
                        variant="outlined"
                    />

                    {/* Controls */}
                    <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
                        <Tooltip title={isAudioMuted ? 'Unmute' : 'Mute'}>
                            <IconButton
                                onClick={toggleAudio}
                                sx={{
                                    width: 64,
                                    height: 64,
                                    bgcolor: isAudioMuted ? 'error.main' : 'rgba(255,255,255,0.15)',
                                    color: 'white',
                                    '&:hover': {
                                        bgcolor: isAudioMuted ? 'error.dark' : 'rgba(255,255,255,0.25)',
                                    },
                                }}
                            >
                                {isAudioMuted ? <MicOffIcon fontSize="large" /> : <MicIcon fontSize="large" />}
                            </IconButton>
                        </Tooltip>

                        <Tooltip title="End call">
                            <IconButton
                                onClick={disconnect}
                                sx={{
                                    width: 64,
                                    height: 64,
                                    bgcolor: 'error.main',
                                    color: 'white',
                                    '&:hover': { bgcolor: 'error.dark' },
                                }}
                            >
                                <CallEndIcon fontSize="large" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>

                {/* Sidebar (right): Chat + Notes for doctor */}
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
                    <Tabs value={sidebarTab} onChange={(_, v) => setSidebarTab(v)} variant="fullWidth">
                        <Tab label="Chat" />
                        <Tab label="Documents" />
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
                        {isDoctor && (
                            <Box sx={{ display: sidebarTab === 2 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                <ClinicalNotesPanel appointmentId={appointmentId} />
                            </Box>
                        )}
                    </Box>
                </Paper>
            </Box>

            {/* Invisible audio sinks — one per remote participant.
                Mounting these is what actually makes the call audible;
                see the comment block on ``RemoteAudio`` for the why. */}
            {participants.map((p) => (
                <RemoteAudio key={p.sid} participant={p} />
            ))}

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

export default AudioMeetingPage;
