import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Tabs, Tab, Paper, Chip, Alert, Grid } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import useAvailabilitySchedule from '../hooks/useAvailabilitySchedule';
import WeeklyScheduleConfig from '../components/WeeklyScheduleConfig';
import WeeklyScheduleReadOnly from '../components/WeeklyScheduleReadOnly';
import { SCHEDULABLE_CONSULTATION_TYPES as CONSULTATION_TYPES } from '../constants/consultationTypes';

/**
 * Normalise working_days coming from the backend.
 *
 * Legacy format (flat):
 *   { "Monday": [{ start, end }], ... }
 *
 * New format (per-type):
 *   { video: { "Monday": [...] }, audio: { ... }, ... }
 *
 * If the flat format is detected we wrap it under every type so existing
 * schedules are preserved.
 */
const normaliseWorkingDays = (raw = {}) => {
    const typeKeys = CONSULTATION_TYPES.map((t) => t.value);
    const isPerType = typeKeys.some((k) => raw[k] !== undefined);

    if (isPerType) return raw;

    // Legacy flat → replicate under each type
    const result = {};
    typeKeys.forEach((k) => {
        result[k] = { ...raw };
    });
    return result;
};

/**
 * Count how many days have at least one working window for a given type.
 */
const countDays = (perTypeHours, typeVal) => {
    const hours = (perTypeHours || {})[typeVal] || {};
    return Object.values(hours).filter((v) => Array.isArray(v) && v.length > 0).length;
};

const WorkingHoursSection = React.memo(({ previewMode = false, registerSave }) => {
    const {
        availabilityConfig,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        granularStatus,
        approvedWorkingDays,
        handleWorkingHoursChange,
        handleSaveWorkingHours,
    } = useAvailabilitySchedule(previewMode);

    const [activeTypeIdx, setActiveTypeIdx] = useState(0);
    const activeType = CONSULTATION_TYPES[activeTypeIdx].value;

    // Editable draft (what the doctor is currently editing / will submit)
    const perTypeHours = normaliseWorkingDays(availabilityConfig?.working_days);
    // Admin-approved snapshot (the live schedule — only changes on admin approval)
    const approvedPerType = normaliseWorkingDays(approvedWorkingDays);

    const approvedForType = approvedPerType[activeType] || {};
    const draftForType = perTypeHours[activeType] || {};
    const hasApprovedHours = Object.values(approvedForType)
        .some((v) => Array.isArray(v) && v.length > 0);

    // When the doctor edits one type's schedule we update the whole working_days object
    const handleTypeHoursChange = useCallback((newDayMap) => {
        const updated = { ...perTypeHours, [activeType]: newDayMap };
        handleWorkingHoursChange(updated);
    }, [perTypeHours, activeType, handleWorkingHoursChange]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSaveWorkingHours, 'Save & Submit Working Hours', false);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSaveWorkingHours]);
    const statusColor = { approved: 'success', pending: 'warning', rejected: 'error', not_submitted: 'default' };
    const statusLabel = {
        approved: '✓ Approved — schedule is live',
        pending: '⏳ Awaiting admin approval',
        rejected: '✗ Rejected',
        not_submitted: 'Not submitted yet',
    };

    const activeTypeObj = granularStatus?.working_hours?.[activeType] || {};
    const currentApprovalStatus = activeTypeObj.status || availabilityApprovalStatus;
    const currentRejectionReason = activeTypeObj.reason || availabilityRejectionReason;

    return (
        <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <div className="section-title-bar">{CONSULTATION_TYPES[activeTypeIdx].label} Hours</div>
                {currentApprovalStatus && currentApprovalStatus !== 'not_submitted' && (
                    <Chip
                        label={statusLabel[currentApprovalStatus] || currentApprovalStatus}
                        color={statusColor[currentApprovalStatus] || 'default'}
                        size="small"
                        variant="outlined"
                    />
                )}
            </Box>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Set your recurring weekly schedule for each consultation type. Changes require admin approval.
            </Typography>

            {currentApprovalStatus === 'rejected' && currentRejectionReason && (
                <Alert severity="error" sx={{ mb: 2 }}>Rejection reason: {currentRejectionReason}</Alert>
            )}
            {currentApprovalStatus === 'pending' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Your {CONSULTATION_TYPES[activeTypeIdx].label} working hours are pending admin review.
                </Alert>
            )}

            {/* ── Consultation Type Sub-Tabs ── */}
            <Paper variant="outlined" sx={{ mb: 3 }}>
                <Tabs
                    value={activeTypeIdx}
                    onChange={(_, v) => setActiveTypeIdx(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 },
                    }}
                >
                    {CONSULTATION_TYPES.map((ct) => {
                        const days = countDays(perTypeHours, ct.value);
                        const tStatus = granularStatus?.working_hours?.[ct.value]?.status;
                        
                        let dotColor = null;
                        if (tStatus === 'pending') dotColor = 'warning.main';
                        if (tStatus === 'rejected') dotColor = 'error.main';
                        if (tStatus === 'approved') dotColor = 'success.main';

                        return (
                            <Tab
                                key={ct.value}
                                label={
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Box position="relative">
                                            <Box
                                                sx={{
                                                    width: 10, height: 10, borderRadius: '50%',
                                                    bgcolor: ct.color, flexShrink: 0,
                                                }}
                                            />
                                            {dotColor && (
                                                <Box
                                                    sx={{
                                                        position: 'absolute', top: -4, right: -4,
                                                        width: 6, height: 6, borderRadius: '50%',
                                                        bgcolor: dotColor, border: '1px solid white'
                                                    }}
                                                />
                                            )}
                                        </Box>
                                        {ct.label}
                                        {days > 0 && (
                                            <Chip
                                                label={`${days}d`} size="small" color="primary"
                                                sx={{ height: 18, fontSize: '0.7rem', ml: 0.5 }}
                                            />
                                        )}
                                    </Box>
                                }
                            />
                        );
                    })}
                </Tabs>
            </Paper>

            {/* ── Active type description ── */}
            <Alert severity="info" sx={{ mb: 2, py: 0.5 }} icon={false}>
                <Typography variant="body2">
                    <strong>{CONSULTATION_TYPES[activeTypeIdx].icon} {CONSULTATION_TYPES[activeTypeIdx].label}</strong>
                    {' — '}{CONSULTATION_TYPES[activeTypeIdx].description}
                </Typography>
            </Alert>

            {/* ── Weekly Schedule for active type: approved (read-only) vs editable ── */}
            <Typography variant="h6" fontWeight="bold" mb={0.5}>
                Weekly Authorized Hours
            </Typography>
            <Typography variant="body2" color="textSecondary" mb={2}>
                The left panel displays your currently authorized working hours for consultations.
                Edit the right panel and click "Save & Submit Working Hours" to submit your updated authorized working hours. Your existing live and booked schedule will remain unchanged.
            </Typography>

            <Grid container spacing={3}>
                {/* ── Admin-approved (read-only) ── */}
                <Grid item xs={12} md={6}>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <LockOutlinedIcon fontSize="small" color="action" />
                        <Typography variant="subtitle1" fontWeight="bold">
                            Authorized Hours
                        </Typography>
                        <Chip label="Live" size="small" color="success" variant="outlined" />
                    </Box>
                    <Typography variant="body2" color="textSecondary" mb={2}>
                        Currently approved and visible to patients. Read-only.
                    </Typography>

                    {hasApprovedHours ? (
                        <WeeklyScheduleReadOnly workingHours={approvedForType} />
                    ) : (
                        <Alert severity="info">
                            No approved hours yet for {CONSULTATION_TYPES[activeTypeIdx].label}.
                            Your submitted schedule appears here once an admin approves it.
                        </Alert>
                    )}
                </Grid>

                {/* ── Editable draft ── */}
                <Grid
                    item
                    xs={12}
                    md={6}
                    sx={{
                        borderLeft: { md: '1px solid' },
                        borderColor: { md: 'divider' },
                    }}
                >
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <EditOutlinedIcon fontSize="small" color="primary" />
                        <Typography variant="subtitle1" fontWeight="bold">
                            Update Your Authorized Hours
                        </Typography>
                        {currentApprovalStatus === 'pending' && (
                            <Chip label="Pending approval" size="small" color="warning" variant="outlined" />
                        )}
                        {currentApprovalStatus === 'rejected' && (
                            <Chip label="Rejected" size="small" color="error" variant="outlined" />
                        )}
                    </Box>
                    <Typography variant="body2" color="textSecondary" mb={2}>
                        Update your authorized hours for each weekday. These hours determine when appointment slots are available for generation.
                    </Typography>

                    <WeeklyScheduleConfig
                        workingHours={draftForType}
                        onChange={handleTypeHoursChange}
                    />
                </Grid>
            </Grid>
        </Box>
    );
});

WorkingHoursSection.displayName = 'WorkingHoursSection';
export default WorkingHoursSection;
