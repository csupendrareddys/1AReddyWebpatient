import { useState, useEffect, useRef } from 'react';
import {
    Box,
    TextField,
    IconButton,
    Typography,
    List,
    ListItem,
    ListItemText,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

/**
 * ChatPanel - Live chat during a video meeting.
 *
 * Sends messages via Twilio Video DataTrack.
 * Receives all messages via the centralized `onMessage` registration
 * provided by useTwilioRoom — no per-participant subscriptions needed.
 *
 * DataTrack protocol: JSON string { type: 'chat', payload: { sender, message, timestamp } }
 */
const ChatPanel = ({ dataTrack, onMessage, localIdentity }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);

    // Register with the centralized message dispatcher
    useEffect(() => {
        if (!onMessage) return;
        const cleanup = onMessage('chat', (data) => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'chat') {
                    setMessages((prev) => [...prev, parsed.payload]);
                }
            } catch { /* non-JSON or non-chat — ignore */ }
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

        // Send via DataTrack (DataTrack does NOT echo back to sender)
        dataTrack.send(JSON.stringify({ type: 'chat', payload }));

        // Add to local messages manually
        setMessages((prev) => [...prev, payload]);
        setInput('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Typography variant="subtitle1" sx={{ p: 1.5, fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>
                Chat
            </Typography>

            {/* Messages list */}
            <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
                {messages.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                        No messages yet. Start the conversation!
                    </Typography>
                )}
                <List dense disablePadding>
                    {messages.map((msg, idx) => (
                        <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                            <ListItemText
                                primary={msg.sender}
                                secondary={msg.message}
                                primaryTypographyProps={{
                                    variant: 'caption',
                                    fontWeight: 600,
                                    color:
                                        msg.sender === localIdentity
                                            ? 'primary.main'
                                            : 'secondary.main',
                                }}
                                secondaryTypographyProps={{
                                    variant: 'body2',
                                    color: 'text.primary',
                                }}
                            />
                        </ListItem>
                    ))}
                </List>
                <div ref={messagesEndRef} />
            </Box>

            {/* Input area */}
            <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="Type a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                <IconButton color="primary" onClick={sendMessage} disabled={!input.trim()}>
                    <SendIcon />
                </IconButton>
            </Box>
        </Box>
    );
};

export default ChatPanel;
