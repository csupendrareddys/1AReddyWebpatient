/**
 * LiveCallStageSection — Live/Call stage metrics.
 *
 * Tracks whether doctor turned on video, audio, chat during calls.
 * Known by buttons clicked by doctor during the call session.
 * Same UX pattern: local edits → confirm → batch submit.
 */
import { useState, useCallback, useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, Card, CardContent, Chip,
    ToggleButtonGroup, ToggleButton, TextField, CircularProgress,
    Alert, IconButton, Tooltip, Divider, Button, Snackbar,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import VideocamIcon from '@mui/icons-material/Videocam';
import MicIcon from '@mui/icons-material/Mic';
import ChatIcon from '@mui/icons-material/Chat';
import CallIcon from '@mui/icons-material/Call';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import SendIcon from '@mui/icons-material/Send';
import DoneAllIcon from '@mui/icons-material/DoneAll';

import {
    useGetLiveCallMetricsQuery,
    useSubmitMetricOverrideMutation,
    useGetMetricOverridesQuery,
} from '../../../admin/api/doctorAttendanceEndpoints';
import SuggestCorrectionDialog from './SuggestCorrectionDialog';
import { SCHEDULABLE_CONSULTATION_TYPES } from '../constants/consultationTypes';
import { todayLocalDateString } from '../../../../common/utils/date';

const CONSULTATION_TYPES = [
    { value: '', label: 'All' },
    ...SCHEDULABLE_CONSULTATION_TYPES.map((ct) => ({ value: ct.value, label: ct.shortLabel })),
];

// status: null | 'pending_submission' | 'approval_pending'
const MetricCard = ({ title, value, icon, color = 'primary.main', onEdit, status, previewMode, subtitle }) => (
    <Card sx={{
        height: '100%', borderLeft: 4,
        borderColor: status === 'pending_submission' ? 'warning.main' : status === 'approval_pending' ? 'info.main' : color,
        bgcolor: status === 'pending_submission' ? 'warning.50' : status === 'approval_pending' ? 'info.50' : 'background.paper',
    }}>
        <CardContent sx={{ pb: '12px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={500} noWrap>{title}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {status === 'pending_submission' && <Chip label="Pending Submission" size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />}
                    {status === 'approval_pending' && <Chip label="Approval Pending" size="small" color="info" sx={{ height: 20, fontSize: '0.6rem' }} />}
                    {!previewMode && onEdit && (
                        <Tooltip title="Suggest Correction">
                            <IconButton size="small" onClick={onEdit} sx={{ p: 0.5 }}><EditIcon fontSize="small" /></IconButton>
                        </Tooltip>
                    )}
                </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color, opacity: 0.8 }}>{icon}</Box>
                <Typography variant="h4" fontWeight={700} color={color}>{value}</Typography>
            </Box>
            {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </CardContent>
    </Card>
);

const LiveCallStageSection = ({ doctorId, previewMode = false }) => {
    const [period, setPeriod] = useState('day');
    const [dateStr, setDateStr] = useState(todayLocalDateString());
    const [consultationType, setConsultationType] = useState('');
    const [corrections, setCorrections] = useState({});
    const [confirmed, setConfirmed] = useState(false);
    const [submitted, setSubmitted] = useState({});
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogTarget, setDialogTarget] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const { data: metrics, isLoading, isFetching } = useGetLiveCallMetricsQuery(
        { doctorId, period, date: dateStr, consultationType: consultationType || undefined },
        { skip: !doctorId, refetchOnMountOrArgChange: true }
    );

    const [submitOverride, { isLoading: submitting }] = useSubmitMetricOverrideMutation();

    // Load pending overrides from API to persist state across refreshes
    const { data: pendingOverrides } = useGetMetricOverridesQuery(
        { doctorId, status: 'pending' },
        { skip: !doctorId }
    );

    useEffect(() => {
        if (!pendingOverrides || !metrics) return;
        const sub = {};
        let groupConfirmed = false;
        for (const ov of pendingOverrides) {
            if (ov.period_start !== metrics?.start_date || ov.period_end !== metrics?.end_date) continue;
            const ovType = ov.consultation_type || '';
            if (ovType !== (consultationType || '')) continue;
            if (ov.metric_type === 'live_group_confirmed') { groupConfirmed = true; sub[ov.metric_type] = { reason: 'Confirmed' }; continue; }
            if (ov.metric_type.startsWith('live_')) {
                sub[ov.metric_type] = { reason: ov.reason };
            }
        }
        setSubmitted(sub);
        if (Object.keys(sub).length > 0 || groupConfirmed) setConfirmed(true);
    }, [pendingOverrides, metrics, consultationType]);

    const resetState = () => { setCorrections({}); setConfirmed(false); setSubmitted({}); };

    const openEdit = useCallback((metricType, label, value) => {
        setDialogTarget({ metricType, label, value });
        setDialogOpen(true);
    }, []);

    const handleSaveLocal = useCallback((metricType, correction) => {
        setCorrections((prev) => ({ ...prev, [metricType]: correction }));
        setConfirmed(false);
    }, []);

    const handleRemoveLocal = useCallback((metricType) => {
        setCorrections((prev) => { const n = { ...prev }; delete n[metricType]; return n; });
    }, []);

    const handleConfirm = useCallback(async () => {
        try {
            if (Object.keys(corrections).length === 0) {
                await submitOverride({
                    doctorId,
                    metric_type: 'live_group_confirmed',
                    original_value: 0,
                    suggested_value: 0,
                    reason: 'Doctor confirmed all values are correct',
                    period_start: metrics?.start_date,
                    period_end: metrics?.end_date,
                    consultation_type: consultationType || null,
                }).unwrap();
                setSubmitted((prev) => ({ ...prev, live_group_confirmed: { reason: 'Confirmed' } }));
                setConfirmed(true);
                setSnackbar({ open: true, message: 'Values confirmed as correct', severity: 'success' });
                return;
            }
            const raw = metrics?._raw || {};
            for (const [metricType, corr] of Object.entries(corrections)) {
                const key = metricType.replace('live_', '');
                const originalValue = raw[key] ?? 0;
                if (!corr.reason) continue;
                await submitOverride({
                    doctorId,
                    metric_type: metricType,
                    original_value: originalValue,
                    suggested_value: originalValue,
                    reason: corr.reason,
                    period_start: metrics?.start_date,
                    period_end: metrics?.end_date,
                    consultation_type: consultationType || null,
                    attachments: corr.attachments?.map((a) => ({ name: a.name, size: a.size, type: a.file?.type || 'unknown' })) || null,
                }).unwrap();
            }
            setSubmitted((prev) => ({ ...prev, ...corrections }));
            setCorrections({});
            setConfirmed(true);
            setSnackbar({ open: true, message: `${Object.keys(corrections).length} correction(s) submitted to admin for approval`, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Failed to submit', severity: 'error' });
        }
    }, [corrections, metrics, doctorId, consultationType, submitOverride]);

    const getStatus = (key) => {
        if (key in corrections) return 'pending_submission';
        if (key in submitted) return 'approval_pending';
        return null;
    };
    const mkEdit = (key, label, val) => {
        if (previewMode) return undefined;
        if (key in submitted) return undefined; // Disable edit after submission
        return () => openEdit(key, label, val);
    };

    if (isLoading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

    const raw = metrics?._raw || {};
    const editCount = Object.keys(corrections).length;

    return (
        <Box>
            {/* Filters */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" fontWeight={600}>Period:</Typography>
                    <ToggleButtonGroup value={period} exclusive onChange={(e, v) => { if (v) { setPeriod(v); resetState(); } }} size="small">
                        <ToggleButton value="day">Day</ToggleButton>
                        <ToggleButton value="week">Week</ToggleButton>
                        <ToggleButton value="month">Month</ToggleButton>
                    </ToggleButtonGroup>
                    <TextField type="date" size="small" value={dateStr} onChange={(e) => { setDateStr(e.target.value); resetState(); }} sx={{ width: 180 }} InputLabelProps={{ shrink: true }} label="Reference Date" />
                    <Divider orientation="vertical" flexItem />
                    <Typography variant="subtitle2" fontWeight={600}>Type:</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {CONSULTATION_TYPES.map((ct) => (
                            <Chip key={ct.value} label={ct.label} size="small"
                                color={consultationType === ct.value ? 'primary' : 'default'}
                                variant={consultationType === ct.value ? 'filled' : 'outlined'}
                                onClick={() => { setConsultationType(ct.value); resetState(); }}
                                sx={{ cursor: 'pointer' }} />
                        ))}
                    </Box>
                    {isFetching && <CircularProgress size={20} />}
                    {metrics && <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{metrics.start_date} &rarr; {metrics.end_date}</Typography>}
                </Box>
            </Paper>

            {!metrics ? (
                <Alert severity="info">No data available for this period.</Alert>
            ) : (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        Live / Call Metrics
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Tracked by buttons clicked by doctor during the call session. Only counts attended appointments.
                    </Typography>

                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6} md={4}>
                            <MetricCard title="Total Attended Appointments" value={metrics.total_attended}
                                icon={<CallIcon />} color="primary.main" previewMode={previewMode} />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <MetricCard title="Video Call — Accessed by Doctor" value={raw.video_used}
                                status={getStatus('live_video_used')}
                                icon={<VideocamIcon />} color="error.main" previewMode={previewMode}
                                onEdit={mkEdit('live_video_used', 'Video Call by Doctor', raw.video_used)}
                                subtitle="Doctor turned on video during call" />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <MetricCard title="Audio Call — Accessed by Doctor" value={raw.audio_used}
                                status={getStatus('live_audio_used')}
                                icon={<MicIcon />} color="success.main" previewMode={previewMode}
                                onEdit={mkEdit('live_audio_used', 'Audio Call by Doctor', raw.audio_used)}
                                subtitle="Doctor turned on audio during call" />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <MetricCard title="Video + Audio — Both Accessed" value={raw.video_and_audio}
                                status={getStatus('live_video_and_audio')}
                                icon={<SlideshowIcon />} color="info.main" previewMode={previewMode}
                                onEdit={mkEdit('live_video_and_audio', 'Video & Audio by Doctor', raw.video_and_audio)}
                                subtitle="Doctor used both video and audio" />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <MetricCard title="Chat — Accessed by Doctor" value={raw.chat_used}
                                status={getStatus('live_chat_used')}
                                icon={<ChatIcon />} color="warning.main" previewMode={previewMode}
                                onEdit={mkEdit('live_chat_used', 'Chat by Doctor', raw.chat_used)}
                                subtitle="Doctor used chat during call" />
                        </Grid>
                    </Grid>

                    {/* Confirm */}
                    {!previewMode && (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                            {confirmed && <Chip icon={<DoneAllIcon />} label="Confirmed & Submitted" color="success" variant="outlined" />}
                            {editCount > 0 && !confirmed && <Typography variant="body2" color="text.secondary">{editCount} correction{editCount > 1 ? 's' : ''} pending</Typography>}
                            {!confirmed && (
                                <Button variant="contained" color={editCount > 0 ? 'warning' : 'success'}
                                    startIcon={editCount > 0 ? <SendIcon /> : <DoneAllIcon />}
                                    onClick={handleConfirm} disabled={submitting}>
                                    {submitting ? 'Submitting...' : editCount > 0 ? `Confirm & Submit ${editCount} Correction${editCount > 1 ? 's' : ''}` : 'Confirm Values Correct'}
                                </Button>
                            )}
                        </Box>
                    )}
                </Paper>
            )}

            <SuggestCorrectionDialog
                open={dialogOpen} onClose={() => setDialogOpen(false)}
                metricType={dialogTarget?.metricType} metricLabel={dialogTarget?.label}
                originalValue={dialogTarget?.value ?? 0}
                existingCorrection={corrections[dialogTarget?.metricType]}
                onSaveLocal={handleSaveLocal} onRemoveLocal={handleRemoveLocal} />

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert onClose={() => setSnackbar((s) => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default LiveCallStageSection;
