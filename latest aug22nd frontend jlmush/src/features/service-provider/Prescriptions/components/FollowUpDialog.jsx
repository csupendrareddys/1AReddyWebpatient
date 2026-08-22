/**
 * FollowUpDialog - Doctor selects follow-up details as part of a prescription.
 *
 * This is a DATA PICKER, not an API caller. The selected follow-up data is
 * returned via the `onConfirm(data)` callback and saved with the prescription.
 * The follow-up is only activated when the prescription is pushed to patient
 * (after admin approval).
 *
 * Features an inline month-view calendar with colored date circles showing
 * slot availability.
 *
 * Options:
 * 1) Free: Doctor picks slot — confirmed appointment (fee=0) created on Rx push
 * 2a) Paid (patient picks): Doctor suggests a day — invite sent on Rx push
 * 2b) Paid (doctor picks): Doctor picks exact slot — soft-reserved on Rx push
 */
import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, RadioGroup, FormControlLabel, Radio,
    FormControl, InputLabel, Select, MenuItem,
    Typography, Box, Chip, Alert, Avatar, Grid, Paper,
    CircularProgress, Divider, Stack, IconButton, Tooltip,
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import PaymentIcon from '@mui/icons-material/Payment';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import {
    useGetDoctorOwnSlotsQuery,
    useGetDoctorOwnSlotSummaryQuery,
} from '../../api/doctorEndpoints';
import { fetchDoctorProfile } from '../../redux/doctorSlice';

const CONSULTATION_TYPES = [
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'chat', label: 'Chat' },
    { value: 'complete', label: 'In-Person' },
    { value: 'home_visit', label: 'Home Visit' },
];

// Calendar helpers
function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
}

const FollowUpDialog = ({ open, onClose, onConfirm, initialData, patientName }) => {
    const dispatch = useDispatch();
    const doctorProfile = useSelector((state) => state.doctor.profile);

    // Ensure doctor profile is loaded (needed for doctor_id)
    useEffect(() => {
        if (open && !doctorProfile) {
            dispatch(fetchDoctorProfile());
        }
    }, [open, doctorProfile, dispatch]);

    const [followUpType, setFollowUpType] = useState('free');
    const [paidMode, setPaidMode] = useState('patient_picks');
    const [consultationType, setConsultationType] = useState('video');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(null);

    // Calendar month state
    const now = new Date();
    const [currentMonth, setCurrentMonth] = useState(now.getMonth());
    const [currentYear, setCurrentYear] = useState(now.getFullYear());

    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const doctorId = doctorProfile?.id;

    // Restore from initialData when dialog opens
    useEffect(() => {
        if (open && initialData) {
            if (initialData.follow_up_type === 'free_doctor') {
                setFollowUpType('free');
            } else if (initialData.follow_up_type === 'paid_patient_picks') {
                setFollowUpType('paid');
                setPaidMode('patient_picks');
            } else if (initialData.follow_up_type === 'paid_doctor_picks') {
                setFollowUpType('paid');
                setPaidMode('doctor_picks');
            }
            if (initialData.follow_up_consultation_type) {
                setConsultationType(initialData.follow_up_consultation_type);
            }
            if (initialData.follow_up_date) {
                setSelectedDate(initialData.follow_up_date);
            }
            // Note: we can't restore slot selection from ID alone — user must re-pick
        }
    }, [open, initialData]);

    // Slot summary for the calendar month
    const { data: summaryData, isFetching: summaryFetching } = useGetDoctorOwnSlotSummaryQuery(
        { doctorId, month: monthStr, consultationType },
        { skip: !doctorId || !open },
    );

    // Slots for the selected date
    const needsSlot = followUpType === 'free' || (followUpType === 'paid' && paidMode === 'doctor_picks');
    const { data: slots = [], isFetching: slotsFetching } = useGetDoctorOwnSlotsQuery(
        { doctorId, date: selectedDate, consultationType },
        { skip: !doctorId || !selectedDate || !open || !needsSlot },
    );

    const handlePrevMonth = () => {
        if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
        else setCurrentMonth(currentMonth - 1);
    };
    const handleNextMonth = () => {
        if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
        else setCurrentMonth(currentMonth + 1);
    };

    const handleConfirm = () => {
        // Build the follow-up data to return to the parent form
        let fuType;
        if (followUpType === 'free') fuType = 'free_doctor';
        else if (paidMode === 'patient_picks') fuType = 'paid_patient_picks';
        else fuType = 'paid_doctor_picks';

        const data = {
            follow_up_type: fuType,
            follow_up_consultation_type: consultationType,
            follow_up_date: selectedDate || null,
            follow_up_time_slot_id: selectedSlot?.id || null,
            // Extra display info for the summary box (not sent to backend)
            _display: {
                type_label: followUpType === 'free' ? 'Free Follow-Up' : 'Paid Follow-Up',
                mode_label: followUpType === 'paid'
                    ? (paidMode === 'patient_picks' ? 'Patient picks slot' : 'Doctor picked slot')
                    : null,
                consultation_type: CONSULTATION_TYPES.find(ct => ct.value === consultationType)?.label || consultationType,
                date: selectedDate,
                slot_time: selectedSlot ? `${selectedSlot.start} - ${selectedSlot.end}` : null,
            },
        };

        onConfirm(data);
        handleClose();
    };

    const handleClose = () => {
        setFollowUpType('free');
        setPaidMode('patient_picks');
        setConsultationType('video');
        setSelectedDate('');
        setSelectedSlot(null);
        const n = new Date();
        setCurrentMonth(n.getMonth());
        setCurrentYear(n.getFullYear());
        onClose();
    };

    const handleClear = () => {
        // Clear follow-up data and close
        onConfirm(null);
        handleClose();
    };

    const canSubmit = () => {
        if (followUpType === 'free') return !!selectedSlot;
        if (followUpType === 'paid' && paidMode === 'patient_picks') return !!selectedDate;
        return !!selectedSlot;
    };

    const formatDisplayDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // ── Render Calendar ──────────────────────────────────────────────────────
    const renderCalendar = () => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const days = [];

        for (let i = 0; i < firstDay; i++) {
            days.push(<Grid item xs={12 / 7} key={`pad-${i}`} />);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(currentYear, currentMonth, d);
            const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isPast = dateObj <= today;
            const slotCount = summaryData?.dates?.[dStr] || 0;
            const isSelected = selectedDate === dStr;

            let bgColor = 'grey.100';
            let textColor = 'text.disabled';
            let cursor = 'default';

            if (!isPast) {
                textColor = 'text.primary';
                cursor = 'pointer';
                if (slotCount > 10) bgColor = 'success.light';
                else if (slotCount > 0) bgColor = 'warning.light';
                else bgColor = 'error.light';

                if (!summaryData?.dates || !Object.keys(summaryData.dates).includes(dStr)) {
                    bgColor = 'error.light';
                }
            } else {
                bgColor = 'action.disabledBackground';
            }

            days.push(
                <Grid item xs={12 / 7} key={d} sx={{ display: 'flex', justifyContent: 'center', p: 0.5 }}>
                    <Tooltip title={isPast ? 'Past / Today' : `${slotCount} slots available`}>
                        <Avatar
                            onClick={isPast ? undefined : () => { setSelectedDate(dStr); setSelectedSlot(null); }}
                            sx={{
                                width: { xs: 32, sm: 38 }, height: { xs: 32, sm: 38 },
                                bgcolor: isSelected ? 'primary.main' : bgColor,
                                color: isSelected ? 'white' : (bgColor.includes('light') ? 'white' : textColor),
                                fontSize: '0.8rem', fontWeight: 600,
                                cursor,
                                transition: 'all 0.2s',
                                '&:hover': !isPast ? { opacity: 0.8, transform: 'scale(1.1)' } : {},
                                border: isSelected ? '2px solid' : 'none',
                                borderColor: 'primary.dark',
                            }}
                        >
                            {d}
                        </Avatar>
                    </Tooltip>
                </Grid>
            );
        }

        return (
            <Box sx={{ width: '100%' }}>
                {/* Month navigation */}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </Typography>
                    <Box>
                        <IconButton size="small" onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
                        <IconButton size="small" onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
                    </Box>
                </Box>

                {/* Day headers */}
                <Grid container spacing={0} mb={0.5}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <Grid item xs={12 / 7} key={day} sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">{day}</Typography>
                        </Grid>
                    ))}
                </Grid>

                {/* Day cells */}
                {summaryFetching ? (
                    <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
                ) : (
                    <Grid container spacing={0}>{days}</Grid>
                )}

                {/* Legend */}
                <Box display="flex" justifyContent="center" gap={2} mt={2} flexWrap="wrap">
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.light' }} />
                        <Typography variant="caption">&gt;10 Slots</Typography>
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

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}>
                <EventIcon color="primary" />
                Schedule Follow-Up{patientName ? ` for ${patientName}` : ''}
            </DialogTitle>

            <DialogContent dividers>
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                    Follow-up details will be saved with the prescription and shown in the PDF.
                    The follow-up will only be activated after admin approval and push to patient.
                </Alert>

                <Stack spacing={2.5}>
                    {/* Type Selection */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom fontWeight="bold">
                            Follow-Up Type
                        </Typography>
                        <RadioGroup
                            value={followUpType}
                            onChange={(e) => { setFollowUpType(e.target.value); setSelectedSlot(null); setSelectedDate(''); }}
                            row
                        >
                            <FormControlLabel
                                value="free"
                                control={<Radio />}
                                label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <CardGiftcardIcon fontSize="small" color="success" /> Free Follow-Up
                                </Box>}
                            />
                            <FormControlLabel
                                value="paid"
                                control={<Radio />}
                                label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <PaymentIcon fontSize="small" color="warning" /> Paid Follow-Up
                                </Box>}
                            />
                        </RadioGroup>
                    </Box>

                    {/* Paid sub-mode */}
                    {followUpType === 'paid' && (
                        <Box>
                            <Typography variant="subtitle2" gutterBottom fontWeight="bold">
                                How should the patient book?
                            </Typography>
                            <RadioGroup
                                value={paidMode}
                                onChange={(e) => { setPaidMode(e.target.value); setSelectedSlot(null); setSelectedDate(''); }}
                            >
                                <FormControlLabel
                                    value="patient_picks"
                                    control={<Radio size="small" />}
                                    label="Suggest a day — patient picks slot & pays"
                                />
                                <FormControlLabel
                                    value="doctor_picks"
                                    control={<Radio size="small" />}
                                    label="I'll pick the exact slot — patient just pays"
                                />
                            </RadioGroup>
                        </Box>
                    )}

                    <Divider />

                    {/* Consultation Type */}
                    <FormControl fullWidth size="small">
                        <InputLabel>Consultation Type</InputLabel>
                        <Select
                            value={consultationType}
                            onChange={(e) => { setConsultationType(e.target.value); setSelectedSlot(null); setSelectedDate(''); }}
                            label="Consultation Type"
                        >
                            {CONSULTATION_TYPES.map((ct) => (
                                <MenuItem key={ct.value} value={ct.value}>{ct.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Inline Calendar */}
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        {renderCalendar()}
                    </Paper>

                    {/* Selected date chip */}
                    {selectedDate && (
                        <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                            Selected: <strong>{formatDisplayDate(selectedDate)}</strong>
                            {summaryData?.dates?.[selectedDate] != null && (
                                <> — {summaryData.dates[selectedDate]} slot(s) available</>
                            )}
                        </Alert>
                    )}

                    {/* Slot Picker (for free + paid_doctor_picks) */}
                    {needsSlot && selectedDate && (
                        <Box>
                            <Typography variant="subtitle2" gutterBottom fontWeight="bold">
                                Pick a Time Slot
                            </Typography>
                            {slotsFetching ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                    <CircularProgress size={24} />
                                </Box>
                            ) : slots.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">
                                    No available slots for this date and consultation type.
                                </Typography>
                            ) : (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {slots.map((slot) => (
                                        <Chip
                                            key={slot.id}
                                            label={`${slot.start} - ${slot.end}`}
                                            onClick={() => setSelectedSlot(slot)}
                                            color={selectedSlot?.id === slot.id ? 'primary' : 'default'}
                                            variant={selectedSlot?.id === slot.id ? 'filled' : 'outlined'}
                                            sx={{ cursor: 'pointer' }}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    )}

                    {/* Summary */}
                    {canSubmit() && (
                        <Alert severity="success" variant="outlined">
                            {followUpType === 'free' && selectedSlot && (
                                <>Free follow-up on <strong>{formatDisplayDate(selectedDate)}</strong> at <strong>{selectedSlot.start}</strong> ({consultationType}). Will be created as confirmed appointment when prescription is pushed to patient.</>
                            )}
                            {followUpType === 'paid' && paidMode === 'patient_picks' && selectedDate && (
                                <>Patient will be invited to book a <strong>{consultationType}</strong> slot on <strong>{formatDisplayDate(selectedDate)}</strong> and pay, after prescription is pushed.</>
                            )}
                            {followUpType === 'paid' && paidMode === 'doctor_picks' && selectedSlot && (
                                <>Slot <strong>{selectedSlot.start}</strong> on <strong>{formatDisplayDate(selectedDate)}</strong> will be reserved for patient after prescription is pushed.</>
                            )}
                        </Alert>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions sx={{ px: 3, py: 2 }}>
                {initialData && (
                    <Button onClick={handleClear} color="error" variant="outlined" sx={{ mr: 'auto' }}>
                        Remove Follow-Up
                    </Button>
                )}
                <Button onClick={handleClose} variant="outlined">
                    Cancel
                </Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    disabled={!canSubmit()}
                    startIcon={<EventIcon />}
                >
                    Set Follow-Up
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default FollowUpDialog;
