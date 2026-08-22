import { useState, useEffect, useRef } from 'react';
import {
    Box,
    Typography,
    Paper,
    TextField,
    IconButton,
    Avatar,
    Chip,
    Snackbar,
    List,
    ListItem,
    ListItemText,
    Button,
    Divider,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ChatIcon from '@mui/icons-material/Chat';
import CallEndIcon from '@mui/icons-material/CallEnd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonIcon from '@mui/icons-material/Person';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ClinicalNotesPanel from '../../components/ClinicalNotesPanel/ClinicalNotesPanel';

/**
 * ChatConsultationPage - Full-screen text-based consultation.
 *
 * Uses Twilio DataTrack for real-time messaging (no audio/video).
 * Props come from the parent ConsultationRouter.
 */
const ChatConsultationPage = ({
    appointmentId,
    room,
    participants,
    localParticipant,
    dataTrack,
    onMessage,
    disconnect,
    user,
}) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [copiedSnackbar, setCopiedSnackbar] = useState(false);
    const [sessionDuration, setSessionDuration] = useState(0);
    const messagesEndRef = useRef(null);
    const timerRef = useRef(null);

    const localIdentity =
        localParticipant?.identity || user?.first_name || 'You';
    const isConnected = participants.length > 0;
    const remoteIdentity = participants[0]?.identity || 'Waiting for other party...';
    const isDoctor = user?.role === 'doctor';

    // Session duration timer
    useEffect(() => {
        timerRef.current = setInterval(() => {
            setSessionDuration((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(timerRef.current);
    }, []);

    const formatDuration = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    // Register with the centralized message dispatcher
    useEffect(() => {
        if (!onMessage) return;
        const cleanup = onMessage('chat-consultation', (data) => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'chat') {
                    setMessages((prev) => [...prev, parsed.payload]);
                }
            } catch { /* non-JSON — ignore */ }
        });
        return cleanup;
    }, [onMessage]);

    // Auto-scroll to bottom on new message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = () => {
        if (!input.trim() || !dataTrack) return;

        const payload = {
            sender: localIdentity,
            message: input.trim(),
            timestamp: new Date().toISOString(),
        };

        dataTrack.send(JSON.stringify({ type: 'chat', payload }));
        setMessages((prev) => [...prev, payload]);
        setInput('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const handleCopyAppointmentId = () => {
        navigator.clipboard.writeText(appointmentId);
        setCopiedSnackbar(true);
    };

    const formatTime = (isoStr) => {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const isOwnMessage = (msg) => msg.sender === localIdentity;

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
                    <ChatIcon color="warning" />
                    <Typography variant="h6" fontWeight="bold">
                        Chat Consultation
                    </Typography>
                    <Chip
                        label={isConnected ? 'Online' : 'Waiting...'}
                        size="small"
                        variant="outlined"
                        color={isConnected ? 'success' : 'warning'}
                    />
                    <Chip
                        label={formatDuration(sessionDuration)}
                        size="small"
                        variant="outlined"
                    />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                        label={`ID: ${appointmentId?.slice(0, 8)}…`}
                        icon={<ContentCopyIcon />}
                        onClick={handleCopyAppointmentId}
                        variant="outlined"
                        size="small"
                        clickable
                    />
                    <Button
                        variant="contained"
                        color="error"
                        size="small"
                        startIcon={<CallEndIcon />}
                        onClick={disconnect}
                    >
                        End Session
                    </Button>
                </Box>
            </Paper>

            {/* Main content */}
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Participant info sidebar (left) */}
                <Paper
                    elevation={1}
                    sx={{
                        width: 280,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 0,
                        borderRight: '1px solid',
                        borderColor: 'divider',
                        p: 2,
                    }}
                >
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Participants
                    </Typography>
                    <Divider sx={{ mb: 2 }} />

                    {/* Local user */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'primary.main', width: 40, height: 40 }}>
                            <PersonIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="body2" fontWeight="bold">
                                {localIdentity} (You)
                            </Typography>
                            <Typography variant="caption" color="success.main">
                                Online
                            </Typography>
                        </Box>
                    </Box>

                    {/* Remote participant */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                        <Avatar
                            sx={{
                                bgcolor: isConnected ? 'secondary.main' : 'grey.400',
                                width: 40,
                                height: 40,
                            }}
                        >
                            <PersonIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="body2" fontWeight="bold">
                                {remoteIdentity}
                            </Typography>
                            <Typography
                                variant="caption"
                                color={isConnected ? 'success.main' : 'text.secondary'}
                            >
                                {isConnected ? 'Online' : 'Offline'}
                            </Typography>
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="caption" color="text.secondary">
                        Messages are transmitted in real-time. This chat session is linked to your appointment.
                    </Typography>
                </Paper>

                {/* Chat area (center, main) */}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        bgcolor: '#f5f5f5',
                    }}
                >
                    {/* Messages */}
                    <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
                        {messages.length === 0 && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    gap: 1,
                                }}
                            >
                                <ChatIcon sx={{ fontSize: 48, color: 'grey.400' }} />
                                <Typography variant="body1" color="text.secondary">
                                    Start your consultation by sending a message
                                </Typography>
                            </Box>
                        )}

                        {messages.map((msg, idx) => {
                            const own = isOwnMessage(msg);
                            return (
                                <Box
                                    key={idx}
                                    sx={{
                                        display: 'flex',
                                        justifyContent: own ? 'flex-end' : 'flex-start',
                                        mb: 1.5,
                                    }}
                                >
                                    <Paper
                                        elevation={1}
                                        sx={{
                                            maxWidth: '65%',
                                            px: 2,
                                            py: 1,
                                            borderRadius: 2,
                                            bgcolor: own ? 'primary.main' : 'white',
                                            color: own ? 'white' : 'text.primary',
                                        }}
                                    >
                                        {!own && (
                                            <Typography
                                                variant="caption"
                                                fontWeight="bold"
                                                color="secondary.main"
                                                display="block"
                                            >
                                                {msg.sender}
                                            </Typography>
                                        )}
                                        <Typography variant="body1">
                                            {msg.message}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                display: 'block',
                                                textAlign: 'right',
                                                mt: 0.5,
                                                opacity: 0.7,
                                            }}
                                        >
                                            {formatTime(msg.timestamp)}
                                        </Typography>
                                    </Paper>
                                </Box>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </Box>

                    {/* Input area */}
                    <Paper
                        elevation={2}
                        sx={{
                            display: 'flex',
                            gap: 1,
                            p: 2,
                            borderRadius: 0,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                            alignItems: 'flex-end',
                        }}
                    >
                        <TextField
                            fullWidth
                            multiline
                            maxRows={4}
                            placeholder="Type your message..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoComplete="off"
                            variant="outlined"
                            size="small"
                        />
                        <IconButton
                            color="primary"
                            onClick={sendMessage}
                            disabled={!input.trim()}
                            sx={{
                                bgcolor: 'primary.main',
                                color: 'white',
                                '&:hover': { bgcolor: 'primary.dark' },
                                '&.Mui-disabled': { bgcolor: 'grey.300', color: 'grey.500' },
                            }}
                        >
                            <SendIcon />
                        </IconButton>
                    </Paper>
                </Box>

                {/* Clinical Notes sidebar (right, doctor-only) */}
                {isDoctor && (
                    <Paper
                        elevation={1}
                        sx={{
                            width: 320,
                            display: 'flex',
                            flexDirection: 'column',
                            borderRadius: 0,
                            borderLeft: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <ClinicalNotesPanel appointmentId={appointmentId} />
                    </Paper>
                )}
            </Box>

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

export default ChatConsultationPage;
