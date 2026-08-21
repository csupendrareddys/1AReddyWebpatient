/**
 * ScheduledCallsPanel — the calls surface for one channel.
 *
 * Role-aware, mirroring a clinic appointment:
 *   * PROVIDER schedules calls and can end them.
 *   * PATIENT proposes a time (a chat message) and accepts / joins.
 * Both can join and cancel. Which controls show is driven purely by
 * ``channel.my_role`` + the call's status, so one component serves both sides.
 *
 * Calling itself: when the backend reports ``calling_configured: false`` (dev,
 * no Twilio) we still open a "session" so the connected-duration billing is
 * exercised end-to-end; the panel just tells the user calling isn't wired up
 * rather than pretending to launch a room.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent,
    DialogTitle, MenuItem, Stack, TextField, Typography, IconButton, Tooltip,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import CallIcon from '@mui/icons-material/Call';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import {
    useGetChannelCallsQuery,
    useScheduleChannelCallMutation,
    useProposeChannelCallMutation,
    useCallActionMutation,
} from '../api/scopedChannelApi';
import { useDoctorScope } from
    '../../service-provider/ProfileSetting/context/DoctorScopeContext';
import { usePatientScope } from
    '../../service-receiver/ProfileSetting/context/PatientScopeContext';

const STATUS_CHIP = {
    scheduled: { label: 'Scheduled', color: 'info' },
    accepted: { label: 'Accepted', color: 'success' },
    in_progress: { label: 'Live', color: 'warning' },
    completed: { label: 'Completed', color: 'default' },
    cancelled: { label: 'Cancelled', color: 'default' },
    no_show: { label: 'No-show', color: 'default' },
    proposed: { label: 'Proposed', color: 'default' },
};

function fmt(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

// ``datetime-local`` value → ISO. Treated as local wall-clock, which is what
// the picker shows the user.
function toIso(localValue) {
    if (!localValue) return null;
    const d = new Date(localValue);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function ScheduledCallsPanel({ channel }) {
    const navigate = useNavigate();
    const channelId = channel?.id;
    // JOINING a live call is off every act-on-behalf allowlist and requires being
    // a ChannelParticipant, so no proxy actor can do it — the button must stay
    // hidden or it dead-ends on a 404. That covers an admin driving the DOCTOR's
    // schedule in Operations (``useDoctorScope().isOps``) AND a patient-side proxy:
    // a support-staff CAREGIVER ('staff'), a guardian / linked adult ('family'),
    // or an admin acting on the PATIENT ('ops') — all read from usePatientScope.
    // Scheduling, proposing, accepting and cancelling still work; only Join is
    // withheld. The patient's own session ('self') and the doctor keep Join.
    const { isOps } = useDoctorScope();
    const { scopeKind } = usePatientScope();
    const isProxyActor = isOps || (scopeKind && scopeKind !== 'self');
    // Who may schedule a call: normally the PROVIDER, but on a vendor "holding"
    // channel it is the ADMIN (the held vendor can only chat / send docs).
    const isProvider = channel?.is_holding
        ? channel?.my_role === 'admin'
        : channel?.my_role === 'provider';
    const ps = channel?.purchased_service || {};
    // A holding channel and a family-doctor second-opinion channel have no
    // purchase — they are live while active and both call modes are available
    // (the backend clamps a second-opinion call to 5 minutes). Normal channels
    // gate on the purchase.
    const noPurchaseChannel = channel?.is_holding || channel?.is_second_opinion;
    const live = channel?.status === 'active' && (noPurchaseChannel || ps.status === 'active');
    const audioOn = noPurchaseChannel || !!ps.audio_enabled;
    const videoOn = noPurchaseChannel || !!ps.video_enabled;

    const { data: calls = [] } = useGetChannelCallsQuery(channelId, {
        skip: !channelId, pollingInterval: 10000,
    });
    const [scheduleCall, { isLoading: scheduling }] = useScheduleChannelCallMutation();
    const [proposeCall] = useProposeChannelCallMutation();
    const [callAction] = useCallActionMutation();

    const [open, setOpen] = useState(true);
    const [dialog, setDialog] = useState(false);
    const [form, setForm] = useState({ mode: videoOn ? 'video' : 'audio', start: '', end: '' });
    const [error, setError] = useState('');

    if (!audioOn && !videoOn) return null; // service has no calls

    const act = async (callId, action) => {
        setError('');
        try {
            await callAction({ channelId, callId, action }).unwrap();
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || 'Action failed.');
        }
    };

    // Join opens the full-page call surface, which does the actual join +
    // Twilio connect and shows chat / documents / whiteboard.
    const handleJoin = (call) => {
        navigate(`/service-call/${channelId}/${call.id}`);
    };

    // Join is only allowed from 5 minutes before the scheduled start (same rule
    // as a consultation) — an in-progress call is always joinable.
    const JOIN_LEAD_MS = 5 * 60 * 1000;
    const canJoin = (c) => {
        if (isProxyActor) return false;
        if (c.status === 'in_progress') return true;
        if (!c.scheduled_start) return false;
        return Date.now() >= new Date(c.scheduled_start).getTime() - JOIN_LEAD_MS;
    };

    const submitSchedule = async () => {
        setError('');
        const scheduled_start = toIso(form.start);
        const scheduled_end = toIso(form.end);
        if (!scheduled_start || !scheduled_end) {
            setError('Pick a start and end time.');
            return;
        }
        try {
            if (isProvider) {
                await scheduleCall({ channelId, mode: form.mode, scheduled_start, scheduled_end }).unwrap();
            } else {
                await proposeCall({ channelId, suggested_time: fmt(scheduled_start) }).unwrap();
            }
            setDialog(false);
            setForm({ mode: videoOn ? 'video' : 'audio', start: '', end: '' });
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || 'Could not save.');
        }
    };

    const activeCalls = calls.filter((c) => !['completed', 'cancelled', 'no_show'].includes(c.status));

    return (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'grey.200', bgcolor: '#fff' }}>
            <Stack
                direction="row" alignItems="center" justifyContent="space-between"
                sx={{ px: 2, py: 1, cursor: 'pointer' }}
                onClick={() => setOpen((v) => !v)}
            >
                <Stack direction="row" spacing={1} alignItems="center">
                    <VideocamIcon fontSize="small" color="action" />
                    <Typography variant="subtitle2" fontWeight={700}>
                        Calls{activeCalls.length ? ` (${activeCalls.length})` : ''}
                    </Typography>
                </Stack>
                <IconButton size="small">{open ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
            </Stack>

            <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 2, pb: 2 }}>
                    {error && (
                        <Alert severity="warning" onClose={() => setError('')} sx={{ mb: 1 }}>
                            {error}
                        </Alert>
                    )}

                    {calls.length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                            No calls yet.
                        </Typography>
                    )}

                    <Stack spacing={1}>
                        {calls.slice(0, 6).map((c) => {
                            const chip = STATUS_CHIP[c.status] || STATUS_CHIP.scheduled;
                            const closed = ['completed', 'cancelled', 'no_show'].includes(c.status);
                            return (
                                <Stack
                                    key={c.id}
                                    direction="row" alignItems="center" justifyContent="space-between"
                                    sx={{ p: 1, borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}
                                >
                                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                        {c.mode === 'video'
                                            ? <VideocamIcon fontSize="small" color="action" />
                                            : <CallIcon fontSize="small" color="action" />}
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" noWrap>{fmt(c.scheduled_start)}</Typography>
                                            <Chip size="small" label={chip.label} color={chip.color} sx={{ height: 18 }} />
                                            {c.status === 'completed' && (
                                                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                    {Math.round((c.connected_seconds || 0) / 60)} min used
                                                </Typography>
                                            )}
                                        </Box>
                                    </Stack>
                                    {live && !closed && (
                                        <Stack direction="row" spacing={0.5}>
                                            {!isProvider && c.status === 'scheduled' && (
                                                <Button size="small" onClick={() => act(c.id, 'accept')}>Accept</Button>
                                            )}
                                            {['scheduled', 'accepted', 'in_progress'].includes(c.status) && (
                                                canJoin(c) ? (
                                                    <Button size="small" variant="contained" onClick={() => handleJoin(c)}>Join</Button>
                                                ) : (
                                                    <Tooltip title={`You can join from 5 minutes before ${fmt(c.scheduled_start)}`}>
                                                        <span>
                                                            <Button size="small" variant="contained" disabled>Join</Button>
                                                        </span>
                                                    </Tooltip>
                                                )
                                            )}
                                            {c.status === 'in_progress' && isProvider && (
                                                <Button size="small" color="error" onClick={() => act(c.id, 'end')}>End</Button>
                                            )}
                                            {c.status !== 'in_progress' && (
                                                <Button size="small" color="inherit" onClick={() => act(c.id, 'cancel')}>Cancel</Button>
                                            )}
                                        </Stack>
                                    )}
                                </Stack>
                            );
                        })}
                    </Stack>

                    {/* On a holding channel calls are arranged by the admin only —
                        the held vendor gets no "Propose a time". Elsewhere the
                        patient may still propose. */}
                    {live && (isProvider || !channel?.is_holding) && (
                        <Button
                            size="small" startIcon={<AddIcon />} sx={{ mt: 1 }}
                            onClick={() => setDialog(true)}
                        >
                            {isProvider ? 'Schedule a call' : 'Propose a time'}
                        </Button>
                    )}
                </Box>
            </Collapse>

            <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>{isProvider ? 'Schedule a call' : 'Propose a call time'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        {isProvider && (
                            <TextField
                                select label="Type" size="small"
                                value={form.mode}
                                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                            >
                                {videoOn && <MenuItem value="video">Video call</MenuItem>}
                                {audioOn && <MenuItem value="audio">Voice call</MenuItem>}
                            </TextField>
                        )}
                        <TextField
                            label="Start" type="datetime-local" size="small"
                            InputLabelProps={{ shrink: true }}
                            value={form.start}
                            onChange={(e) => setForm({ ...form, end: form.end, start: e.target.value })}
                        />
                        <TextField
                            label="End" type="datetime-local" size="small"
                            InputLabelProps={{ shrink: true }}
                            value={form.end}
                            onChange={(e) => setForm({ ...form, end: e.target.value })}
                        />
                        {error && <Alert severity="warning">{error}</Alert>}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(false)}>Cancel</Button>
                    <Button variant="contained" onClick={submitSchedule} disabled={scheduling}>
                        {isProvider ? 'Schedule' : 'Propose'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
