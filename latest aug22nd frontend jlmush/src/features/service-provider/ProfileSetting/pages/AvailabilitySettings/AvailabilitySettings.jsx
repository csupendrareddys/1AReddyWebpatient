import React from 'react';
import {
    Box, Container, Typography, Button, Alert, Snackbar,
    Divider, Stack, Paper, Chip
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { format } from 'date-fns';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CancelIcon from '@mui/icons-material/Cancel';
import EventBusyIcon from '@mui/icons-material/EventBusy';

import useDoctorAvailability from '../../hooks/useDoctorAvailability';
import { useGetDoctorAppointmentsQuery } from '../../../api/doctorEndpoints';
import AvailabilityCalendar from '../../components/AvailabilityCalendar';
import WeeklyScheduleConfig from '../../components/WeeklyScheduleConfig';
import SlotConfiguration from '../../components/SlotConfiguration';
import '../ProfileSetting/ProfileSetting.css';

// ── Approval Status Badge ─────────────────────────────────────────────
const APPROVAL_META = {
    not_submitted: { label: 'Not Submitted', color: 'default', icon: null },
    pending: { label: 'Pending Admin Approval', color: 'warning', icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} /> },
    approved: { label: 'Approved — Slots Live', color: 'success', icon: <CheckCircleIcon sx={{ fontSize: 16 }} /> },
    rejected: { label: 'Rejected', color: 'error', icon: <CancelIcon sx={{ fontSize: 16 }} /> },
};

const ApprovalStatusBadge = ({ status, rejectionReason }) => {
    const meta = APPROVAL_META[status] || APPROVAL_META.not_submitted;
    return (
        <Box>
            <Chip
                label={meta.label}
                color={meta.color}
                icon={meta.icon}
                variant="outlined"
                size="small"
            />
            {status === 'rejected' && rejectionReason && (
                <Alert severity="error" sx={{ mt: 1 }}>
                    Rejection reason: {rejectionReason}
                </Alert>
            )}
        </Box>
    );
};

// ── ExceptionsManager — block individual dates ────────────────────────
const ExceptionsManager = ({ exceptions = {}, onToggle }) => {
    const [selectedDate, setSelectedDate] = React.useState(null);

    const blockedDates = Object.entries(exceptions)
        .filter(([, v]) => v === 'blocked')
        .map(([d]) => d)
        .sort();

    const handleAdd = () => {
        if (!selectedDate) return;
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        onToggle(dateStr);
        setSelectedDate(null);
    };

    return (
        <Box>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Blocked Dates (Exceptions)
            </Typography>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Mark specific dates as unavailable (e.g. public holidays, leave days).
            </Typography>

            <Box display="flex" gap={2} alignItems="center" mb={2} flexWrap="wrap">
                <DatePicker
                    label="Select date to block"
                    value={selectedDate}
                    onChange={setSelectedDate}
                    slotProps={{ textField: { size: 'small' } }}
                />
                <Button
                    variant="outlined"
                    color="error"
                    startIcon={<EventBusyIcon />}
                    onClick={handleAdd}
                    disabled={!selectedDate}
                >
                    Block Date
                </Button>
            </Box>

            {blockedDates.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap={1}>
                    {blockedDates.map(dateStr => (
                        <Chip
                            key={dateStr}
                            label={format(new Date(dateStr + 'T00:00:00'), 'MMM d, yyyy')}
                            onDelete={() => onToggle(dateStr)}
                            color="error"
                            variant="outlined"
                            size="small"
                        />
                    ))}
                </Box>
            )}

            {blockedDates.length === 0 && (
                <Typography variant="body2" color="textSecondary">No exceptions set.</Typography>
            )}
        </Box>
    );
};

// ── Main Page ─────────────────────────────────────────────────────────
const AvailabilitySettings = () => {
    const {
        loading,
        error,
        availabilityConfig,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        slotConfig,
        availableDays,
        availableSlots,
        snackbar,
        handleSaveAvailability,
        handleAvailabilityFieldChange,
        handleWorkingHoursChange,
        handleToggleException,
        handleSlotConfigChange,
        toggleDayAvailability,
        updateSlotsForDay,
        updateSlotsForDays,
        handleCloseSnackbar,
    } = useDoctorAvailability();

    // Max approved duration — the calendar enforces slot_size + gap ≤ this
    const maxApprovedDuration = (availabilityApprovalStatus === 'approved' && Array.isArray(slotConfig) && slotConfig.length > 0)
        ? Math.max(...slotConfig.map(s => Number(s.duration) || 0))
        : 0;

    // Booked slots — derived from the doctor's own appointments so the calendar
    // can mark them "Booked" and lock them (a booked slot can't be changed).
    // Map: { 'YYYY-MM-DD': ['09:00', '09:15', ...] } of occupied start times.
    const { data: apptData } = useGetDoctorAppointmentsQuery({ page_size: 500 });
    const bookedSlots = React.useMemo(() => {
        const map = {};
        const FREED = new Set(['cancelled', 'rejected', 'no_show']);
        (apptData?.appointments || []).forEach((a) => {
            if (FREED.has(String(a.status || '').toLowerCase())) return;
            const d = a.appointment_date;
            const t = (a.start_time || '').substring(0, 5);
            if (!d || !t) return;
            (map[d] = map[d] || []).push(t);
        });
        return map;
    }, [apptData]);

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box className="doctor-profile-container">
                <Container maxWidth="lg" sx={{ mt: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                        <Typography variant="h4" fontWeight="bold">Schedule &amp; Availability</Typography>
                        <ApprovalStatusBadge
                            status={availabilityApprovalStatus}
                            rejectionReason={availabilityRejectionReason}
                        />
                    </Box>

                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                    <Paper sx={{ p: 3, mb: 10 }}>
                        <Stack spacing={4}>

                            {/* 1. Working Days & Duty Hours */}
                            <Box>
                                <WeeklyScheduleConfig
                                    workingHours={availabilityConfig.working_days || {}}
                                    onChange={handleWorkingHoursChange}
                                />
                            </Box>

                            <Divider />

                            {/* 2. Slot Config + Charges */}
                            <SlotConfiguration
                                availabilityConfig={availabilityConfig}
                                slotPricing={slotConfig}
                                onConfigChange={handleAvailabilityFieldChange}
                                onPricingChange={handleSlotConfigChange}
                            />

                            <Divider />

                            {/* 3. Blocked Dates (Exceptions) */}
                            <ExceptionsManager
                                exceptions={availabilityConfig.exceptions || {}}
                                onToggle={handleToggleException}
                            />

                            <Divider />

                            {/* 4. Calendar Override View */}
                            <Box>
                                <Typography variant="h6" gutterBottom>Calendar Override</Typography>
                                <Typography variant="body2" color="textSecondary" mb={2}>
                                    Override generated slots for individual days if needed.
                                </Typography>
                                <AvailabilityCalendar
                                    availableDays={availableDays}
                                    availableSlots={availableSlots}
                                    bookedSlots={bookedSlots}
                                    approvalStatus={availabilityApprovalStatus}
                                    workingHours={availabilityConfig.working_days || {}}
                                    maxApprovedDuration={maxApprovedDuration}
                                    onToggleDay={toggleDayAvailability}
                                    onUpdateSlots={updateSlotsForDay}
                                    onBulkUpdateSlots={updateSlotsForDays}
                                />
                            </Box>

                        </Stack>
                    </Paper>
                </Container>

                {/* Sticky Footer */}
                <Box className="action-buttons-container">
                    <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveAvailability}
                            disabled={loading}
                            size="large"
                            sx={{ px: 4 }}
                        >
                            {loading ? 'Saving...' : 'Save & Submit for Approval'}
                        </Button>
                    </Container>
                </Box>

                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={5000}
                    onClose={handleCloseSnackbar}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                >
                    <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </Box>
        </LocalizationProvider>
    );
};

export default AvailabilitySettings;
