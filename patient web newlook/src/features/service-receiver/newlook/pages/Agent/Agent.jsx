/**
 * Ask Agent (new look) — port of the mobile MVP's ``app/agent.tsx``, the
 * guided alternative for anyone who'd rather describe what they need than
 * browse the booking shelves.
 *
 * The mobile agent was a locally-scripted flow. On the web it calls ASSUMED
 * endpoint #9 (api/assumedEndpoints.js) — a real assistant on the backend —
 * and says so plainly when that endpoint doesn't exist yet. Suggestion chips
 * in the reply deep-link into the real booking surfaces.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import NLIcon from '../../components/NLIcon';
import { useSendNLAgentMessageMutation, isMissingEndpoint } from '../../api/assumedEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { colors, radius, tint, typography } from '../../theme/tokens';

const ROUTE_HINT = {
    book: 'newlook/book',
    bookings: 'newlook/bookings',
    doctor: 'newlook/find-care',
    marketplace: 'marketplace',
    'health-plans': 'health-plans',
    recovery: 'newlook/recovery-plans',
    'second-opinion': 'newlook/second-opinion',
};

/** Openers, so the page invites a first message instead of a blank box. */
const STARTERS = [
    'I have a fever since yesterday',
    'Book a video consultation for me',
    'I want a second opinion on my prescription',
];

const Agent = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const [send, { isLoading: sending }] = useSendNLAgentMessageMutation();

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [missing, setMissing] = useState(false);
    const scrollRef = useRef(null);

    const submit = async (text) => {
        const message = (text ?? input).trim();
        if (!message || sending) return;
        setInput('');
        const history = [...messages, { from: 'me', text: message }];
        setMessages(history);
        try {
            const res = await send({
                message,
                history: history.slice(-10).map((m) => ({ from: m.from, text: m.text })),
            }).unwrap();
            setMessages((cur) => [...cur, {
                from: 'agent',
                text: res?.reply || 'Sorry — I didn’t catch that.',
                suggestions: res?.suggestions || [],
            }]);
        } catch (e) {
            if (isMissingEndpoint(e)) setMissing(true);
            else {
                setMessages((cur) => [...cur, {
                    from: 'agent',
                    text: 'Something went wrong sending that. Please try again.',
                }]);
            }
        }
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        });
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 860, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <NLIcon name="sparkles" size={22} color={colors.primary} />
                <Typography sx={typography.h1}>Ask Agent</Typography>
            </Box>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Describe what you need and get walked to the right booking — instead of
                browsing the shelves yourself.
            </Typography>

            {missing ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                    The agent needs the backend endpoint{' '}
                    <code>POST /api/patient/agent/messages</code>, which doesn&apos;t exist
                    yet. Until it ships, the booking form asks the same questions —{' '}
                    <Button size="small" onClick={() => navigate(`${basePath}/newlook/book`)}>
                        open Book Appointments
                    </Button>
                </Alert>
            ) : null}

            <Box
                ref={scrollRef}
                sx={{
                    minHeight: 280,
                    maxHeight: '55vh',
                    overflowY: 'auto',
                    border: `1px solid ${colors.border}`,
                    borderRadius: `${radius.md}px`,
                    bgcolor: colors.surface,
                    p: 2,
                    mb: 1.5,
                }}
            >
                {messages.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <NLIcon name="chatbubbles-outline" size={34} color={colors.textMuted} />
                        <Typography sx={{ ...typography.bodyMuted, mt: 1, mb: 2 }}>
                            Try one of these to get going:
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                            {STARTERS.map((s) => (
                                <Button
                                    key={s}
                                    size="small"
                                    variant="outlined"
                                    onClick={() => submit(s)}
                                >
                                    {s}
                                </Button>
                            ))}
                        </Box>
                    </Box>
                ) : messages.map((m, i) => (
                    <Box
                        key={`${m.from}-${i}`}
                        sx={{
                            display: 'flex',
                            justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start',
                            mb: 1.25,
                        }}
                    >
                        <Box
                            sx={{
                                maxWidth: '80%',
                                px: 1.75,
                                py: 1.1,
                                borderRadius: `${radius.md}px`,
                                bgcolor: m.from === 'me' ? colors.primary : tint(colors.primary, 0.07),
                                color: m.from === 'me' ? colors.white : colors.textPrimary,
                            }}
                        >
                            <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                                {m.text}
                            </Typography>
                            {m.suggestions?.length ? (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: 1 }}>
                                    {m.suggestions.map((s) => (
                                        <Button
                                            key={s.label}
                                            size="small"
                                            variant="outlined"
                                            onClick={() => navigate(
                                                `${basePath}/${ROUTE_HINT[s.route_hint] || 'newlook/book'}`,
                                            )}
                                        >
                                            {s.label}
                                        </Button>
                                    ))}
                                </Box>
                            ) : null}
                        </Box>
                    </Box>
                ))}
                {sending ? (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <CircularProgress size={14} />
                        <Typography sx={typography.caption}>Thinking…</Typography>
                    </Box>
                ) : null}
            </Box>

            <Box component="form" onSubmit={(e) => { e.preventDefault(); submit(); }} sx={{ display: 'flex', gap: 1 }}>
                <TextField
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Describe what you need…"
                    size="small"
                    fullWidth
                />
                <Button type="submit" variant="contained" disabled={!input.trim() || sending}>
                    Send
                </Button>
            </Box>
        </Box>
    );
};

export default Agent;
