import { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, FormControl, InputLabel, Select, MenuItem,
    Typography, Box, Alert, CircularProgress, Avatar, Chip,
    Divider, Stack, IconButton, Grid, Tooltip, Paper
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useDispatch, useSelector } from 'react-redux';
import { bookAppointment, clearBookingState } from '../../redux/patientSlice';
import { useGetDoctorSlotsQuery, useGetDoctorSlotSummaryQuery } from '../../api/patientEndpoints';
import { todayLocalDateString } from '../../../../common/utils/date';

// ── Helpers ──────────────────────────────────────────────────────────────────

function slotDuration(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

function getPriceForSlot(durationMin, slotPricing = []) {
    if (!slotPricing || slotPricing.length === 0) return null;
    const match = slotPricing.find(
        (tier) => durationMin >= (tier.min_duration ?? 0) && durationMin <= (tier.max_duration ?? Infinity)
    );
    return match ? match.price : null;
}

function todayStr() {
    return todayLocalDateString();
}

// ── Calendar Helpers ─────────────────────────────────────────────────────────

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
}

// ── Component ─────────────────────────────────────────────────────────────────

const BookingDialog = ({ open, onClose, doctor }) => {
    const dispatch = useDispatch();
    const { bookingLoading, bookingError, bookingSuccess } = useSelector((s) => s.patient);

    const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [appointmentType, setAppointmentType] = useState('online');
    const [chiefComplaint, setChiefComplaint] = useState('');
    const [localError, setLocalError] = useState('');

    const doctorId = doctor?.id;
    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    // 1. Fetch Monthly Summary for legend
    const { data: summaryData, isFetching: summaryFetching } = useGetDoctorSlotSummaryQuery(
        { doctorId, month: monthStr },
        { skip: !doctorId || !open }
    );

    // 2. Fetch Slots for selected date
    const { data: slotsData, isFetching: slotsFetching } = useGetDoctorSlotsQuery(
        { doctorId, date: selectedDate },
        { skip: !doctorId || !selectedDate }
    );

    const slots = slotsData?.slots || [];
    const slotPricing = slotsData?.slot_pricing || doctor?.slot_pricing || [];
    const slotsApproved = slotsData?.approved;
    const bookedSlots = slotsData?.booked_slots || [];
    const pendingSlots = slotsData?.pending_slots || [];

    const selectedFee = useMemo(() => {
        if (!selectedSlot) return null;
        const dur = slotDuration(selectedSlot.start, selectedSlot.end);
        return getPriceForSlot(dur, slotPricing);
    }, [selectedSlot, slotPricing]);

    // Reset when dialog opens/closes
    useEffect(() => {
        if (open) {
            const now = new Date();
            setCurrentMonth(now.getMonth());
            setCurrentYear(now.getFullYear());
            setSelectedDate('');
            setSelectedSlot(null);
            setAppointmentType('online');
            setChiefComplaint('');
            setLocalError('');
            dispatch(clearBookingState());
        }
    }, [open, dispatch]);

    useEffect(() => {
        if (bookingSuccess) {
            const t = setTimeout(() => onClose(), 2000);
            return () => clearTimeout(t);
        }
    }, [bookingSuccess, onClose]);

    const handlePrevMonth = () => {
        if (currentMonth === 0) {
            setCurrentMonth(11);
            setCurrentYear(currentYear - 1);
        } else {
            setCurrentMonth(currentMonth - 1);
        }
    };

    const handleNextMonth = () => {
        if (currentMonth === 11) {
            setCurrentMonth(0);
            setCurrentYear(currentYear + 1);
        } else {
            setCurrentMonth(currentMonth + 1);
        }
    };

    const handleSubmit = () => {
        setLocalError('');
        if (!selectedDate) return setLocalError('Please select a date from the calendar.');
        if (!selectedSlot) return setLocalError('Please select a time slot.');
        if (!chiefComplaint || chiefComplaint.trim().length < 10)
            return setLocalError('Please describe your symptoms (minimum 10 characters).');

        dispatch(bookAppointment({
            doctor_id: doctorId,
            appointment_date: selectedDate,
            start_time: selectedSlot.start,
            end_time: selectedSlot.end,
            appointment_type: appointmentType,
            chief_complaint: chiefComplaint.trim(),
            consultation_fee: selectedFee ?? undefined,
        }));
    };

    // ── Render Calendar Grid ─────────────────────────────────────────────────

    const renderCalendar = () => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const days = [];

        // Padding for previous month
        for (let i = 0; i < firstDay; i++) {
            days.push(<Grid item xs={12 / 7} key={`pad-${i}`} />);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(currentYear, currentMonth, d);
            const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isPast = dateObj < today;
            // summaryData loaded but date not in schedule => no availability
            const scheduleLoaded = !!summaryData;
            const hasSchedule = scheduleLoaded && Object.prototype.hasOwnProperty.call(summaryData.dates ?? {}, dStr);
            const slotCount = hasSchedule ? (summaryData.dates[dStr] || 0) : 0;
            const isSelected = selectedDate === dStr;
            const isDisabled = isPast || (scheduleLoaded && !hasSchedule);

            let bgColor = 'action.disabledBackground';
            let textColor = 'text.disabled';
            let cursor = 'not-allowed';
            let tooltipTitle = isPast ? 'Past date' : (scheduleLoaded && !hasSchedule ? 'No schedule' : `${slotCount} slots available`);

            if (!isDisabled) {
                textColor = 'text.primary';
                cursor = 'pointer';
                if (slotCount > 10) bgColor = 'success.light';
                else if (slotCount > 0) bgColor = 'warning.light';
                else bgColor = 'grey.200'; // schedule exists, 0 slots
            }

            days.push(
                <Grid item xs={12/7} key={d} sx={{ display: 'flex', justifyContent: 'center', p: 0.5 }}>
                    <Tooltip title={tooltipTitle}>
                        <Avatar
                            onClick={isDisabled ? undefined : () => { setSelectedDate(dStr); setSelectedSlot(null); }}
                            sx={{
                                width: 36, height: 36,
                                bgcolor: isSelected ? 'primary.main' : bgColor,
                                color: isSelected ? 'white' : (isDisabled ? textColor : (bgColor.includes('light') ? 'white' : 'text.primary')),
                                fontSize: '0.875rem',
                                cursor: cursor,
                                transition: 'all 0.2s',
                                '&:hover': !isDisabled ? { opacity: 0.8, transform: 'scale(1.1)' } : {},
                                border: isSelected ? '2px solid' : 'none',
                                borderColor: 'primary.dark',
                                opacity: isDisabled && !isPast ? 0.55 : 1,
                            }}
                        >
                            {d}
                        </Avatar>
                    </Tooltip>
                </Grid>
            );
        }

        return (
            <Box sx={{ width: '100%', mt: 1 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </Typography>
                    <Box>
                        <IconButton size="small" onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
                        <IconButton size="small" onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
                    </Box>
                </Box>
                
                {/* Weekday headers */}
                <Grid container spacing={0} mb={0.5}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <Grid item xs={12/7} key={day} sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">{day}</Typography>
                        </Grid>
                    ))}
                </Grid>

                <Grid container spacing={0}>
                    {days}
                </Grid>

                {/* Calendar Legend */}
                <Box display="flex" justifyContent="center" gap={2} mt={2} flexWrap="wrap">
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.light' }} />
                        <Typography variant="caption">{'>'} 10 Slots</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'warning.light' }} />
                        <Typography variant="caption">1-10 Slots</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'error.light' }} />
                        <Typography variant="caption">No Slots</Typography>
                    </Box>
                </Box>
            </Box>
        );
    };

    if (!doctor) return null;

    const doctorName = doctor.full_name || `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim();

    return (
        <Dialog open={open} onClose={!bookingLoading ? onClose : undefined} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box display="flex" alignItems="center" gap={2}>
                    <EventIcon color="primary" />
                    Book Appointment
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {/* Doctor Info */}
                <Box display="flex" alignItems="center" gap={2} mb={3} p={2} bgcolor="action.hover" borderRadius={2}>
                    <Avatar src={doctor.profile_image} sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}>
                        <PersonIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h6">Dr. {doctorName}</Typography>
                        <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
                            {doctor.specializations?.slice(0, 2).map((spec, i) => (
                                <Chip key={i} label={spec} size="small" color="primary" variant="outlined" />
                            ))}
                        </Box>
                    </Box>
                </Box>

                {bookingSuccess && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        Appointment request sent! The doctor will confirm shortly.
                    </Alert>
                )}

                {(bookingError || localError) && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {bookingError || localError}
                    </Alert>
                )}

                {!bookingSuccess && (
                    <Stack spacing={3}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Consultation Type</InputLabel>
                            <Select value={appointmentType} onChange={(e) => setAppointmentType(e.target.value)} label="Consultation Type">
                                <MenuItem value="online">Online Consultation</MenuItem>
                                <MenuItem value="in_clinic">In-Clinic Visit</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Custom Calendar */}
                        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper' }}>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                Select Availability Date
                            </Typography>
                            {summaryFetching ? (
                                <Box display="flex" justifyContent="center" py={4}><CircularProgress size={30} /></Box>
                            ) : (
                                renderCalendar()
                            )}
                        </Paper>

                        {/* Slots for selected date */}
                        {selectedDate && (
                            <Box>
                                <Typography variant="subtitle2" gutterBottom display="flex" alignItems="center" gap={0.5}>
                                    <AccessTimeIcon fontSize="small" /> Time Slots for {new Date(selectedDate).toLocaleDateString()}
                                </Typography>

                                {slotsFetching && <CircularProgress size={20} />}

                                {!slotsFetching && !slotsApproved && (
                                    <Alert severity="warning" sx={{ mt: 1 }}>This doctor's slots are pending approval. Please check back soon.</Alert>
                                )}

                                {!slotsFetching && slotsApproved && slots.length === 0 && (
                                    <Alert severity="info" sx={{ mt: 1 }}>No available slots for this date. Please select another date.</Alert>
                                )}

                                {!slotsFetching && slotsApproved && slots.length > 0 && (
                                    <>
                                        <Box display="flex" flexWrap="wrap" gap={1}>
                                            {slots.map((slot, idx) => {
                                                const isSelected = selectedSlot?.start === slot.start;
                                                const isBooked = bookedSlots.includes(slot.start);
                                                const isPending = !isBooked && pendingSlots.includes(slot.start);
                                                const dur = slotDuration(slot.start, slot.end);
                                                const fee = getPriceForSlot(dur, slotPricing);

                                                const feeTag = fee != null ? ` · ₹${fee}` : '';
                                                const statusTag = isBooked ? ' 🔒' : isPending ? ' ⏳' : '';
                                                const label = `${slot.start}${feeTag}${statusTag}`;

                                                let extraSx = {};
                                                if (isBooked) extraSx = { bgcolor: 'error.light', color: 'white', opacity: 0.85 };
                                                else if (isPending) extraSx = { bgcolor: 'warning.light', color: 'white' };

                                                return (
                                                    <Chip
                                                        key={idx}
                                                        label={label}
                                                        onClick={isBooked ? undefined : () => setSelectedSlot(slot)}
                                                        color={isSelected ? 'primary' : 'default'}
                                                        variant={isSelected ? 'filled' : 'outlined'}
                                                        disabled={isBooked}
                                                        sx={{ cursor: isBooked ? 'not-allowed' : 'pointer', fontWeight: isSelected ? 'bold' : 400, ...extraSx }}
                                                    />
                                                );
                                            })}
                                        </Box>

                                        {selectedSlot && (
                                            <Box mt={2} p={1.5} bgcolor="primary.50" borderRadius={1} border="1px solid" borderColor="primary.200">
                                                <Typography variant="body2">
                                                    <strong>Selected:</strong> {selectedSlot.start} – {selectedSlot.end} ({slotDuration(selectedSlot.start, selectedSlot.end)} min)
                                                </Typography>
                                                {selectedFee != null && (
                                                    <Typography variant="body2" color="primary.main" fontWeight="bold">Fee: ₹{selectedFee}</Typography>
                                                )}
                                            </Box>
                                        )}
                                    </>
                                )}
                            </Box>
                        )}

                        <Divider />

                        <TextField
                            label="Describe your symptoms"
                            placeholder="Briefly describe your health concern…"
                            multiline
                            rows={3}
                            fullWidth
                            value={chiefComplaint}
                            onChange={(e) => setChiefComplaint(e.target.value)}
                            inputProps={{ maxLength: 500 }}
                            helperText={`${chiefComplaint.length}/500 characters`}
                        />
                    </Stack>
                )}
            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} disabled={bookingLoading}>
                    {bookingSuccess ? 'Close' : 'Cancel'}
                </Button>
                {!bookingSuccess && (
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={bookingLoading || !selectedDate || !selectedSlot}
                        startIcon={bookingLoading ? <CircularProgress size={18} color="inherit" /> : <EventIcon />}
                    >
                        {bookingLoading ? 'Booking…' : 'Confirm Booking'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default BookingDialog;
