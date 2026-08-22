/**
 * AcceptanceStageSection — Full implementation of acceptance stage metrics.
 *
 * UX Flow:
 *  1. Metrics load from API
 *  2. Doctor clicks pencil on any metric → opens dialog → edits locally (no API call)
 *  3. Corrected metrics show "Edited" badge
 *  4. At bottom of each group (Auto-Approved / Manual), a "Confirm & Submit" button
 *  5. Clicking Confirm sends ALL corrections for that group as a batch to admin
 *  6. If no corrections, Confirm just records that doctor reviewed and accepted values
 */
import { useState, useCallback, useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, Card, CardContent, Chip,
    ToggleButtonGroup, ToggleButton, TextField, CircularProgress,
    Alert, IconButton, Tooltip, Divider, Button, Snackbar,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VerifiedIcon from '@mui/icons-material/Verified';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import CancelIcon from '@mui/icons-material/Cancel';
import ScheduleIcon from '@mui/icons-material/Schedule';
import InboxIcon from '@mui/icons-material/Inbox';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import PanToolIcon from '@mui/icons-material/PanTool';
import SendIcon from '@mui/icons-material/Send';
import DoneAllIcon from '@mui/icons-material/DoneAll';

import {
    useGetAcceptanceMetricsQuery,
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

// ── Metric Card ──
// status: null | 'pending_submission' | 'approval_pending'
const MetricCard = ({ title, value, icon, color = 'primary.main', onEdit, status, previewMode }) => (
    <Card sx={{
        height: '100%',
        borderLeft: 4,
        borderColor: status === 'pending_submission' ? 'warning.main' : status === 'approval_pending' ? 'info.main' : color,
        position: 'relative',
        bgcolor: status === 'pending_submission' ? 'warning.50' : status === 'approval_pending' ? 'info.50' : 'background.paper',
    }}>
        <CardContent sx={{ pb: '12px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={500} noWrap>
                    {title}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {status === 'pending_submission' && (
                        <Chip label="Pending Submission" size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />
                    )}
                    {status === 'approval_pending' && (
                        <Chip label="Approval Pending" size="small" color="info" sx={{ height: 20, fontSize: '0.6rem' }} />
                    )}
                    {!previewMode && onEdit && (
                        <Tooltip title="Suggest Correction">
                            <IconButton size="small" onClick={onEdit} sx={{ p: 0.5 }}>
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color, opacity: 0.8 }}>{icon}</Box>
                <Typography variant="h4" fontWeight={700} color={color}>
                    {value}
                </Typography>
            </Box>
        </CardContent>
    </Card>
);

// ── Confirm Button at bottom of each group ──
const GroupConfirmButton = ({ group, corrections, isSubmitting, isConfirmed, onConfirm }) => {
    const editCount = Object.keys(corrections).length;
    return (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            {isConfirmed && (
                <Chip icon={<DoneAllIcon />} label="Confirmed & Submitted" color="success" variant="outlined" />
            )}
            {editCount > 0 && !isConfirmed && (
                <Typography variant="body2" color="text.secondary">
                    {editCount} correction{editCount > 1 ? 's' : ''} pending
                </Typography>
            )}
            {!isConfirmed && (
                <Button
                    variant="contained"
                    color={editCount > 0 ? 'warning' : 'success'}
                    startIcon={editCount > 0 ? <SendIcon /> : <DoneAllIcon />}
                    onClick={onConfirm}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? 'Submitting...' : editCount > 0 ? `Confirm & Submit ${editCount} Correction${editCount > 1 ? 's' : ''}` : 'Confirm Values Correct'}
                </Button>
            )}
        </Box>
    );
};


const AcceptanceStageSection = ({ doctorId, previewMode = false }) => {
    const [period, setPeriod] = useState('day');
    const [dateStr, setDateStr] = useState(todayLocalDateString());
    const [consultationType, setConsultationType] = useState('');

    // LOCAL correction state per group: { metricType: { suggestedValue, reason, attachments } }
    const [autoCorrections, setAutoCorrections] = useState({});
    const [manualCorrections, setManualCorrections] = useState({});

    // Confirmed state per group
    const [autoConfirmed, setAutoConfirmed] = useState(false);
    const [manualConfirmed, setManualConfirmed] = useState(false);

    // Track which metrics have been submitted (awaiting admin approval)
    const [autoSubmitted, setAutoSubmitted] = useState({});
    const [manualSubmitted, setManualSubmitted] = useState({});

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogTarget, setDialogTarget] = useState(null); // { metricType, label, value, group }

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const {
        data: metrics,
        isLoading,
        isFetching,
    } = useGetAcceptanceMetricsQuery(
        { doctorId, period, date: dateStr, consultationType: consultationType || undefined },
        { skip: !doctorId, refetchOnMountOrArgChange: true }
    );

    const [submitOverride, { isLoading: submitting }] = useSubmitMetricOverrideMutation();

    // Load pending overrides from API to persist state across refreshes
    const { data: pendingOverrides } = useGetMetricOverridesQuery(
        { doctorId, status: 'pending' },
        { skip: !doctorId }
    );

    // Pre-populate submitted state from API pending overrides (persists across refresh)
    useEffect(() => {
        if (!pendingOverrides || !metrics) return;
        const autoSub = {};
        const manualSub = {};
        let autoGroupConfirmed = false;
        let manualGroupConfirmed = false;
        const startDate = metrics?.start_date;
        const endDate = metrics?.end_date;
        for (const ov of pendingOverrides) {
            if (ov.period_start !== startDate || ov.period_end !== endDate) continue;
            const ovType = ov.consultation_type || '';
            if (ovType !== (consultationType || '')) continue;
            const mt = ov.metric_type;
            // Detect confirmation markers
            if (mt === 'auto_group_confirmed') { autoGroupConfirmed = true; autoSub[mt] = { reason: 'Confirmed' }; continue; }
            if (mt === 'manual_group_confirmed') { manualGroupConfirmed = true; manualSub[mt] = { reason: 'Confirmed' }; continue; }
            const entry = { reason: ov.reason };
            if (mt.startsWith('auto_')) autoSub[mt] = entry;
            else if (mt.startsWith('manual_')) manualSub[mt] = entry;
        }
        setAutoSubmitted(autoSub);
        setManualSubmitted(manualSub);
        if (Object.keys(autoSub).length > 0 || autoGroupConfirmed) setAutoConfirmed(true);
        if (Object.keys(manualSub).length > 0 || manualGroupConfirmed) setManualConfirmed(true);
    }, [pendingOverrides, metrics, consultationType]);

    // Reset confirmations when period/date/type changes
    const resetAll = useCallback(() => {
        setAutoCorrections({});
        setManualCorrections({});
        setAutoConfirmed(false);
        setManualConfirmed(false);
        setAutoSubmitted({});
        setManualSubmitted({});
    }, []);

    const handlePeriodChange = useCallback((e, val) => {
        if (val) { setPeriod(val); resetAll(); }
    }, [resetAll]);

    const handleDateChange = useCallback((e) => {
        setDateStr(e.target.value); resetAll();
    }, [resetAll]);

    const handleTypeChange = useCallback((val) => {
        setConsultationType(val); resetAll();
    }, [resetAll]);

    // Open dialog for a metric
    const openEdit = useCallback((metricType, label, value, group) => {
        setDialogTarget({ metricType, label, value, group });
        setDialogOpen(true);
    }, []);

    // Save local remarks from dialog (no value change — only remarks + attachments)
    const handleSaveLocal = useCallback((metricType, correction) => {
        const group = dialogTarget?.group;
        if (group === 'auto') {
            setAutoCorrections((prev) => ({ ...prev, [metricType]: correction }));
            setAutoConfirmed(false);
        } else if (group === 'manual') {
            setManualCorrections((prev) => ({ ...prev, [metricType]: correction }));
            setManualConfirmed(false);
        }
    }, [dialogTarget]);

    // Remove local correction
    const handleRemoveLocal = useCallback((metricType) => {
        const group = dialogTarget?.group;
        if (group === 'auto') {
            setAutoCorrections((prev) => {
                const next = { ...prev };
                delete next[metricType];
                return next;
            });
        } else if (group === 'manual') {
            setManualCorrections((prev) => {
                const next = { ...prev };
                delete next[metricType];
                return next;
            });
        }
    }, [dialogTarget]);

    // Confirm & Submit a group
    const handleConfirmGroup = useCallback(async (group) => {
        const corrections = group === 'auto' ? autoCorrections : manualCorrections;
        const setConfirmed = group === 'auto' ? setAutoConfirmed : setManualConfirmed;
        const setSubmitted = group === 'auto' ? setAutoSubmitted : setManualSubmitted;
        const setCorr = group === 'auto' ? setAutoCorrections : setManualCorrections;

        try {
            if (Object.keys(corrections).length === 0) {
                // No corrections — submit a confirmation marker so it persists across refresh
                const markerType = group === 'auto' ? 'auto_group_confirmed' : 'manual_group_confirmed';
                await submitOverride({
                    doctorId,
                    metric_type: markerType,
                    original_value: 0,
                    suggested_value: 0,
                    reason: 'Doctor confirmed all values are correct',
                    period_start: metrics?.start_date,
                    period_end: metrics?.end_date,
                    consultation_type: consultationType || null,
                }).unwrap();
                setSubmitted((prev) => ({ ...prev, [markerType]: { reason: 'Confirmed' } }));
                setConfirmed(true);
                setSnackbar({ open: true, message: 'Values confirmed as correct', severity: 'success' });
                return;
            }

            // Submit each remarks entry as an override request
            for (const [metricType, corr] of Object.entries(corrections)) {
                if (!corr.reason) continue;

                const groupData = group === 'auto' ? metrics?.auto_approved?._raw : metrics?.manual?._raw;
                const key = metricType.replace('auto_approved_', '').replace('auto_', '').replace('manual_', '');
                const originalValue = groupData?.[key] ?? 0;

                await submitOverride({
                    doctorId,
                    metric_type: metricType,
                    original_value: originalValue,
                    suggested_value: originalValue,
                    reason: corr.reason,
                    period_start: metrics?.start_date,
                    period_end: metrics?.end_date,
                    consultation_type: consultationType || null,
                    attachments: corr.attachments?.map((a) => ({
                        name: a.name, size: a.size, type: a.file?.type || 'unknown',
                    })) || null,
                }).unwrap();
            }

            setSubmitted((prev) => ({ ...prev, ...corrections }));
            setCorr({});
            setConfirmed(true);
            setSnackbar({
                open: true,
                message: `${Object.keys(corrections).length} correction(s) submitted to admin for approval`,
                severity: 'success',
            });
        } catch (err) {
            setSnackbar({
                open: true,
                message: err?.data?.message || 'Failed to submit corrections',
                severity: 'error',
            });
        }
    }, [autoCorrections, manualCorrections, metrics, doctorId, consultationType, submitOverride]);

    // Helper: get metric status — 'pending_submission' | 'approval_pending' | null
    const getStatus = (group, metricType) => {
        const corrections = group === 'auto' ? autoCorrections : manualCorrections;
        const submitted = group === 'auto' ? autoSubmitted : manualSubmitted;
        if (metricType in corrections) return 'pending_submission';
        if (metricType in submitted) return 'approval_pending';
        return null;
    };

    const mkEdit = (metricType, label, value, group) => {
        if (previewMode) return undefined;
        // Disable edit if already submitted and awaiting approval
        const sub = group === 'auto' ? autoSubmitted : manualSubmitted;
        if (metricType in sub) return undefined;
        return () => openEdit(metricType, label, value, group);
    };

    if (isLoading) {
        return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
    }

    const auto = metrics?.auto_approved || {};
    const manual = metrics?.manual || {};
    const autoRaw = auto._raw || {};
    const manualRaw = manual._raw || {};

    // Existing correction for dialog
    const existingCorrection = dialogTarget
        ? (dialogTarget.group === 'auto' ? autoCorrections : manualCorrections)[dialogTarget.metricType]
        : null;

    return (
        <Box>
            {/* ── Filters ── */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" fontWeight={600}>Period:</Typography>
                    <ToggleButtonGroup value={period} exclusive onChange={handlePeriodChange} size="small">
                        <ToggleButton value="day">Day</ToggleButton>
                        <ToggleButton value="week">Week</ToggleButton>
                        <ToggleButton value="month">Month</ToggleButton>
                    </ToggleButtonGroup>

                    <TextField
                        type="date"
                        size="small"
                        value={dateStr}
                        onChange={handleDateChange}
                        sx={{ width: 180 }}
                        InputLabelProps={{ shrink: true }}
                        label="Reference Date"
                    />

                    <Divider orientation="vertical" flexItem />

                    <Typography variant="subtitle2" fontWeight={600}>Type:</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {CONSULTATION_TYPES.map((ct) => (
                            <Chip
                                key={ct.value}
                                label={ct.label}
                                size="small"
                                color={consultationType === ct.value ? 'primary' : 'default'}
                                variant={consultationType === ct.value ? 'filled' : 'outlined'}
                                onClick={() => handleTypeChange(ct.value)}
                                sx={{ cursor: 'pointer' }}
                            />
                        ))}
                    </Box>

                    {isFetching && <CircularProgress size={20} />}

                    {metrics && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                            {metrics.start_date} &rarr; {metrics.end_date}
                        </Typography>
                    )}
                </Box>
            </Paper>

            {!metrics ? (
                <Alert severity="info">No data available for this period.</Alert>
            ) : (
                <>
                    {/* ── Total Received ── */}
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                        <Grid item xs={12}>
                            <MetricCard
                                title="Total Appointments Received"
                                value={metrics.total_received}
                                icon={<InboxIcon fontSize="large" />}
                                color="primary.main"
                                previewMode={previewMode}
                            />
                        </Grid>
                    </Grid>

                    {/* ── Auto-Approved Group ── */}
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <AutoModeIcon color="success" />
                            <Typography variant="h6" fontWeight={600}>
                                Auto-Approved Appointments
                            </Typography>
                            {Object.keys(autoCorrections).length > 0 && (
                                <Chip
                                    label={`${Object.keys(autoCorrections).length} edited`}
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                />
                            )}
                        </Box>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Auto Approved" value={autoRaw.total} icon={<CheckCircleIcon />}
                                    color="success.main" previewMode={previewMode} status={getStatus('auto', 'auto_approved_total')}
                                    onEdit={mkEdit('auto_approved_total', 'Auto Approved', autoRaw.total, 'auto')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Verified (Viewed)" value={autoRaw.verified} icon={<VerifiedIcon />}
                                    color="info.main" previewMode={previewMode} status={getStatus('auto', 'auto_verified')}
                                    onEdit={mkEdit('auto_verified', 'Verified (Viewed)', autoRaw.verified, 'auto')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Accepted" value={autoRaw.accepted} icon={<ThumbUpIcon />}
                                    color="success.dark" previewMode={previewMode} status={getStatus('auto', 'auto_accepted')}
                                    onEdit={mkEdit('auto_accepted', 'Accepted', autoRaw.accepted, 'auto')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Rejected (Wrong Specialization)" value={autoRaw.rejected} icon={<ThumbDownIcon />}
                                    color="error.main" previewMode={previewMode} status={getStatus('auto', 'auto_rejected')}
                                    onEdit={mkEdit('auto_rejected', 'Rejected (Wrong Specialization)', autoRaw.rejected, 'auto')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Cancelled (Doctor Unavailable)" value={autoRaw.cancelled} icon={<CancelIcon />}
                                    color="warning.main" previewMode={previewMode} status={getStatus('auto', 'auto_cancelled')}
                                    onEdit={mkEdit('auto_cancelled', 'Cancelled (Doctor Unavailable)', autoRaw.cancelled, 'auto')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={4}>
                                <MetricCard title="Rescheduled" value={autoRaw.rescheduled} icon={<ScheduleIcon />}
                                    color="grey.600" previewMode={previewMode} status={getStatus('auto', 'auto_rescheduled')}
                                    onEdit={mkEdit('auto_rescheduled', 'Rescheduled', autoRaw.rescheduled, 'auto')} />
                            </Grid>
                        </Grid>

                        {/* Confirm button for Auto group */}
                        {!previewMode && (
                            <GroupConfirmButton
                                group="auto"
                                corrections={autoCorrections}
                                isSubmitting={submitting}
                                isConfirmed={autoConfirmed}
                                onConfirm={() => handleConfirmGroup('auto')}
                            />
                        )}
                    </Paper>

                    {/* ── Manual Group ── */}
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <PanToolIcon color="primary" />
                            <Typography variant="h6" fontWeight={600}>
                                Manual Appointments
                            </Typography>
                            {Object.keys(manualCorrections).length > 0 && (
                                <Chip
                                    label={`${Object.keys(manualCorrections).length} edited`}
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                />
                            )}
                        </Box>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6} md={3}>
                                <MetricCard title="Manual Total" value={manualRaw.total} icon={<CheckCircleIcon />}
                                    color="primary.main" previewMode={previewMode} status={getStatus('manual', 'manual_total')}
                                    onEdit={mkEdit('manual_total', 'Manual Total', manualRaw.total, 'manual')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <MetricCard title="Accepted" value={manualRaw.accepted} icon={<ThumbUpIcon />}
                                    color="success.main" previewMode={previewMode} status={getStatus('manual', 'manual_accepted')}
                                    onEdit={mkEdit('manual_accepted', 'Manual Accepted', manualRaw.accepted, 'manual')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <MetricCard title="Rejected" value={manualRaw.rejected} icon={<ThumbDownIcon />}
                                    color="error.main" previewMode={previewMode} status={getStatus('manual', 'manual_rejected')}
                                    onEdit={mkEdit('manual_rejected', 'Manual Rejected', manualRaw.rejected, 'manual')} />
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <MetricCard title="Cancelled" value={manualRaw.cancelled} icon={<CancelIcon />}
                                    color="warning.main" previewMode={previewMode} status={getStatus('manual', 'manual_cancelled')}
                                    onEdit={mkEdit('manual_cancelled', 'Manual Cancelled', manualRaw.cancelled, 'manual')} />
                            </Grid>
                        </Grid>

                        {/* Confirm button for Manual group */}
                        {!previewMode && (
                            <GroupConfirmButton
                                group="manual"
                                corrections={manualCorrections}
                                isSubmitting={submitting}
                                isConfirmed={manualConfirmed}
                                onConfirm={() => handleConfirmGroup('manual')}
                            />
                        )}
                    </Paper>
                </>
            )}

            {/* ── Correction Dialog (saves locally only) ── */}
            <SuggestCorrectionDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                metricType={dialogTarget?.metricType}
                metricLabel={dialogTarget?.label}
                originalValue={dialogTarget?.value ?? 0}
                existingCorrection={existingCorrection}
                onSaveLocal={handleSaveLocal}
                onRemoveLocal={handleRemoveLocal}
            />

            {/* ── Snackbar ── */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                    severity={snackbar.severity}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default AcceptanceStageSection;
