/**
 * AnalyticsSection — Doctor Analytics Tab
 * Shows slot/booking/revenue metrics, appointment acceptance controls, and live status.
 */
import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import {
    Box, Typography, Paper, Grid, Card, CardContent,
    ToggleButtonGroup, ToggleButton, Switch, FormControlLabel,
    CircularProgress, Alert, Tooltip, Chip, Divider,
    TextField, Button,
} from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PendingIcon from '@mui/icons-material/Pending';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

import {
    useGetDoctorAnalyticsMetricsQuery,
    useGetDoctorAnalyticsSettingsQuery,
    useUpdateDoctorAnalyticsSettingsMutation,
} from '../../../admin/api/doctorAnalyticsEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';
import EmploymentAgreementEditor from '../components/EmploymentAgreementEditor';
import { todayLocalDateString } from '../../../../common/utils/date';

const APPOINTMENT_MODE_LABELS = {
    auto_accept: 'Auto Accept',
    auto_reject: 'Auto Reject',
    manual: 'Manual',
};

const MetricCard = ({ title, value, subtitle, icon, color = 'primary.main' }) => (
    <Card sx={{ height: '100%', borderTop: 3, borderColor: color }}>
        <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    {title}
                </Typography>
                <Box sx={{ color, opacity: 0.8 }}>{icon}</Box>
            </Box>
            <Typography variant="h4" fontWeight={700} color={color}>
                {value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary">
                    {subtitle}
                </Typography>
            )}
        </CardContent>
    </Card>
);

const AnalyticsSection = ({ previewMode = false, registerSave, doctorId: propDoctorId, isAdmin = false }) => {
    const { user } = useSelector((state) => state.auth);
    const isUserAdmin = isAdmin || user?.role === 'super_admin' || user?.role === 'sub_admin';

    // Resolve doctor ID: if passed as prop (admin view), use it; otherwise fetch from /me
    const { data: myDoctorId, isLoading: loadingMyId } = useGetMyDoctorIdQuery(undefined, {
        skip: !!propDoctorId || isUserAdmin,
    });
    const doctorId = propDoctorId || myDoctorId;

    // Period & date state
    const [period, setPeriod] = useState('day');
    const [dateStr, setDateStr] = useState(todayLocalDateString());

    // Fetch metrics
    const {
        data: metrics,
        isLoading: loadingMetrics,
        isFetching: fetchingMetrics,
    } = useGetDoctorAnalyticsMetricsQuery(
        { doctorId, period, date: dateStr },
        { skip: !doctorId, refetchOnMountOrArgChange: true }
    );

    // Fetch settings
    const {
        data: settings,
        isLoading: loadingSettings,
    } = useGetDoctorAnalyticsSettingsQuery(
        { doctorId },
        { skip: !doctorId }
    );

    const [updateSettings, { isLoading: updatingSettings }] = useUpdateDoctorAnalyticsSettingsMutation();
    const [settingsError, setSettingsError] = useState('');

    // Register no-op save (analytics doesn't need a save button)
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Analytics', true);
        }
    }, [registerSave]);

    const handlePeriodChange = useCallback((e, newPeriod) => {
        if (newPeriod) setPeriod(newPeriod);
    }, []);

    const handleAppointmentModeChange = useCallback(async (e, newMode) => {
        if (!newMode || !doctorId) return;
        setSettingsError('');
        try {
            await updateSettings({ doctorId, accepting_appointments: newMode }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update appointment mode');
        }
    }, [doctorId, updateSettings]);

    const handleLiveToggle = useCallback(async (e) => {
        if (!doctorId) return;
        setSettingsError('');
        try {
            await updateSettings({ doctorId, is_live: e.target.checked }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update live status');
        }
    }, [doctorId, updateSettings]);

    const handleAllowedModesChange = useCallback(async (mode) => {
        if (!doctorId || !settings) return;
        setSettingsError('');
        const currentModes = settings.admin_allowed_appointment_modes || ['manual'];
        let newModes;
        if (currentModes.includes(mode)) {
            newModes = currentModes.filter(m => m !== mode);
            if (newModes.length === 0) newModes = ['manual']; // At least one mode
        } else {
            newModes = [...currentModes, mode];
        }
        try {
            await updateSettings({ doctorId, admin_allowed_appointment_modes: newModes }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update allowed modes');
        }
    }, [doctorId, settings, updateSettings]);

    const [holdDaysInput, setHoldDaysInput] = useState('');
    useEffect(() => {
        if (settings) setHoldDaysInput(settings.hold_days_override ?? '');
    }, [settings]);

    const [tdsInput, setTdsInput] = useState('');
    useEffect(() => {
        if (settings) setTdsInput(settings.tds_rate_override ?? '');
    }, [settings]);

    const handlePayoutModeChange = useCallback(async (e, newMode) => {
        if (!newMode || !doctorId) return;
        setSettingsError('');
        try {
            await updateSettings({ doctorId, payout_mode: newMode }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update payout mode');
        }
    }, [doctorId, updateSettings]);

    const handleHoldDaysSave = useCallback(async () => {
        if (!doctorId) return;
        setSettingsError('');
        try {
            await updateSettings({
                doctorId,
                hold_days_override: holdDaysInput === '' ? null : Number(holdDaysInput),
            }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update hold days');
        }
    }, [doctorId, holdDaysInput, updateSettings]);

    const handleTdsSave = useCallback(async () => {
        if (!doctorId) return;
        setSettingsError('');
        try {
            await updateSettings({
                doctorId,
                tds_rate_override: tdsInput === '' ? null : Number(tdsInput),
            }).unwrap();
        } catch (err) {
            setSettingsError(err?.data?.message || 'Failed to update TDS rate');
        }
    }, [doctorId, tdsInput, updateSettings]);

    if (loadingMyId || (!doctorId && !isUserAdmin)) {
        return (
            <Box display="flex" justifyContent="center" py={6}>
                <CircularProgress />
            </Box>
        );
    }

    if (!doctorId) {
        return <Alert severity="warning">Doctor profile not found.</Alert>;
    }

    const allowedModes = settings?.admin_allowed_appointment_modes || ['manual'];

    return (
        <Box>
            {/* ── Period Selector ── */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" fontWeight={600}>Period:</Typography>
                    <ToggleButtonGroup
                        value={period}
                        exclusive
                        onChange={handlePeriodChange}
                        size="small"
                    >
                        <ToggleButton value="day">Day</ToggleButton>
                        <ToggleButton value="week">Week</ToggleButton>
                        <ToggleButton value="month">Month</ToggleButton>
                    </ToggleButtonGroup>

                    <TextField
                        type="date"
                        size="small"
                        value={dateStr}
                        onChange={(e) => setDateStr(e.target.value)}
                        sx={{ width: 180 }}
                        InputLabelProps={{ shrink: true }}
                        label="Reference Date"
                    />

                    {fetchingMetrics && <CircularProgress size={20} />}

                    {metrics && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                            {metrics.start_date} → {metrics.end_date}
                        </Typography>
                    )}
                </Box>
            </Paper>

            {/* ── Metrics Cards ── */}
            {loadingMetrics ? (
                <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
            ) : metrics ? (
                <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={12} sm={6} md={3}>
                        <MetricCard
                            title="Slots Generated"
                            value={metrics.slots_generated}
                            subtitle={`${metrics.slots_available} available`}
                            icon={<CalendarTodayIcon />}
                            color="primary.main"
                        />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <MetricCard
                            title="Slots Booked"
                            value={metrics.slots_booked}
                            subtitle={`${metrics.booking_rate}% booking rate`}
                            icon={<EventAvailableIcon />}
                            color="success.main"
                        />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <MetricCard
                            title="Revenue Earned"
                            value={`₹${metrics.revenue_earned.toLocaleString('en-IN')}`}
                            subtitle={`${metrics.appointments_completed} completed`}
                            icon={<AttachMoneyIcon />}
                            color="warning.main"
                        />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <MetricCard
                            title="Appointments"
                            value={metrics.appointments_total}
                            subtitle={
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                                    <Chip icon={<CheckCircleIcon />} label={metrics.appointments_completed} size="small" color="success" variant="outlined" />
                                    <Chip icon={<CancelIcon />} label={metrics.appointments_cancelled} size="small" color="error" variant="outlined" />
                                    <Chip icon={<PendingIcon />} label={metrics.appointments_pending} size="small" color="warning" variant="outlined" />
                                </Box>
                            }
                            icon={<TrendingUpIcon />}
                            color="info.main"
                        />
                    </Grid>
                </Grid>
            ) : (
                <Alert severity="info" sx={{ mb: 3 }}>No analytics data available for this period.</Alert>
            )}

            {/* ── Compliance (employee/consultant min-slot rules) ── */}
            {metrics?.compliance && (
                <Paper sx={{ p: 2, mb: 3, borderLeft: 4, borderColor: metrics.compliance.met ? 'success.main' : 'warning.main' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle1" fontWeight={600}>Slot Compliance ({period})</Typography>
                        <Chip size="small" label={metrics.compliance.met ? 'On Track' : 'Below Minimum'}
                            color={metrics.compliance.met ? 'success' : 'warning'} />
                        <Typography variant="body2" color="text.secondary">
                            Scheduled <strong>{metrics.compliance.scheduled_hours}h</strong>
                            {metrics.compliance.required_hours != null && <> of required <strong>{metrics.compliance.required_hours}h</strong></>}
                        </Typography>
                    </Box>
                    {(metrics.compliance.warnings || []).map((w, i) => (
                        <Typography key={i} variant="body2" color="warning.main">• {w}</Typography>
                    ))}
                    {metrics.compliance.met && (
                        <Typography variant="body2" color="success.main">All minimums met for this {period}.</Typography>
                    )}
                </Paper>
            )}

            {/* ── Settings Section ── */}
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                    Appointment Settings
                </Typography>

                {settingsError && <Alert severity="error" sx={{ mb: 2 }}>{settingsError}</Alert>}

                {loadingSettings ? (
                    <CircularProgress />
                ) : settings ? (
                    <Box>
                        {/* Live Status */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <FiberManualRecordIcon
                                    sx={{ color: settings.is_live ? 'success.main' : 'grey.400', fontSize: 16 }}
                                />
                                <Typography variant="subtitle1" fontWeight={600}>
                                    Live Status
                                </Typography>
                                <Chip
                                    label={settings.is_live ? 'LIVE' : 'OFFLINE'}
                                    size="small"
                                    color={settings.is_live ? 'success' : 'default'}
                                />
                            </Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {isUserAdmin
                                    ? 'Toggle whether this doctor appears in patient search and booking.'
                                    : 'Your live status is controlled by the admin. Contact admin to change.'}
                            </Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={settings.is_live}
                                        onChange={handleLiveToggle}
                                        disabled={!isUserAdmin || updatingSettings || previewMode}
                                    />
                                }
                                label={settings.is_live ? 'Doctor is Live' : 'Doctor is Offline'}
                            />
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Admin: Payout (billing type + release mode + hold) */}
                        {isUserAdmin && (
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                    Admin: Payout
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    Billing type: <Chip label={(settings.billing_type || 'plan').toUpperCase()} size="small" sx={{ ml: 0.5 }} />
                                    &nbsp;·&nbsp; After a completed appointment, earnings are held for the T-day period, then released by mode below.
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" display="block">Release mode</Typography>
                                        <ToggleButtonGroup value={settings.payout_mode || 'autopay'} exclusive size="small"
                                            onChange={handlePayoutModeChange} disabled={updatingSettings || previewMode}>
                                            <ToggleButton value="autopay">Autopay</ToggleButton>
                                            <ToggleButton value="claim">Doctor Claims</ToggleButton>
                                        </ToggleButtonGroup>
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" display="block">Hold days override</Typography>
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                            <TextField type="number" size="small" placeholder="tenant default"
                                                value={holdDaysInput} onChange={(e) => setHoldDaysInput(e.target.value)}
                                                sx={{ width: 130 }} inputProps={{ min: 0 }} disabled={previewMode} />
                                            <Button size="small" variant="outlined" onClick={handleHoldDaysSave}
                                                disabled={updatingSettings || previewMode}>Save</Button>
                                        </Box>
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" display="block">TDS rate override (%)</Typography>
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                            <TextField type="number" size="small" placeholder="tenant default"
                                                value={tdsInput} onChange={(e) => setTdsInput(e.target.value)}
                                                sx={{ width: 130 }} inputProps={{ min: 0, max: 100, step: '0.01' }} disabled={previewMode} />
                                            <Button size="small" variant="outlined" onClick={handleTdsSave}
                                                disabled={updatingSettings || previewMode}>Save</Button>
                                        </Box>
                                    </Box>
                                </Box>
                                {!previewMode && <EmploymentAgreementEditor doctorId={doctorId} />}
                            </Box>
                        )}

                        {/* Admin: Allowed Modes */}
                        {isUserAdmin && (
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                    Admin: Allowed Appointment Modes
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    Select which appointment acceptance modes this doctor can use.
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {Object.entries(APPOINTMENT_MODE_LABELS).map(([mode, label]) => (
                                        <Chip
                                            key={mode}
                                            label={label}
                                            color={allowedModes.includes(mode) ? 'primary' : 'default'}
                                            variant={allowedModes.includes(mode) ? 'filled' : 'outlined'}
                                            onClick={() => !previewMode && handleAllowedModesChange(mode)}
                                            disabled={updatingSettings || previewMode}
                                            sx={{ cursor: previewMode ? 'default' : 'pointer' }}
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}

                        {/* Appointment Acceptance Mode */}
                        <Box>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                Appointment Acceptance Mode
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                Choose how incoming appointment requests are handled.
                            </Typography>
                            <ToggleButtonGroup
                                value={settings.accepting_appointments}
                                exclusive
                                onChange={handleAppointmentModeChange}
                                size="small"
                                disabled={updatingSettings || previewMode}
                            >
                                {Object.entries(APPOINTMENT_MODE_LABELS).map(([mode, label]) => {
                                    const isAllowed = allowedModes.includes(mode);
                                    return (
                                        <Tooltip
                                            key={mode}
                                            title={!isAllowed ? 'This mode is not enabled by admin' : ''}
                                        >
                                            <span>
                                                <ToggleButton
                                                    value={mode}
                                                    disabled={!isAllowed || updatingSettings || previewMode}
                                                    sx={{
                                                        px: 3,
                                                        '&.Mui-selected': {
                                                            bgcolor: mode === 'auto_accept' ? 'success.light' :
                                                                     mode === 'auto_reject' ? 'error.light' :
                                                                     'primary.light',
                                                            color: '#fff',
                                                            '&:hover': {
                                                                bgcolor: mode === 'auto_accept' ? 'success.main' :
                                                                         mode === 'auto_reject' ? 'error.main' :
                                                                         'primary.main',
                                                            },
                                                        },
                                                    }}
                                                >
                                                    {label}
                                                </ToggleButton>
                                            </span>
                                        </Tooltip>
                                    );
                                })}
                            </ToggleButtonGroup>
                        </Box>
                    </Box>
                ) : (
                    <Alert severity="warning">Could not load settings.</Alert>
                )}
            </Paper>
        </Box>
    );
};

export default AnalyticsSection;
