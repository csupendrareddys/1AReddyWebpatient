
import React from 'react';
import {
    Box, Grid, Typography, Switch, TextField,
    IconButton, Paper, Chip
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Per-slot approval: every slot carries a stable id + approval_status. Editing a
// slot flips it back to 'pending' locally (clears any prior 'rejected' so the
// backend raises a fresh approval request for just that slot).
const newId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const STATUS_BADGE = {
    approved: { label: 'Approved', color: 'success' },
    pending:  { label: 'Pending',  color: 'warning' },
    rejected: { label: 'Rejected', color: 'error' },
};

const SlotStatusChip = ({ status }) => {
    const b = STATUS_BADGE[status];
    if (!b) return null;
    return <Chip label={b.label} size="small" color={b.color} variant="outlined" />;
};

const toMins = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// Returns a Set of slot indices that have errors (overlap or end <= start)
const getSlotErrors = (slots) => {
    const errors = new Set();
    slots.forEach((slot, i) => {
        const aStart = toMins(slot.start);
        const aEnd = toMins(slot.end);
        if (aEnd <= aStart) {
            errors.add(i);
            return;
        }
        slots.forEach((other, j) => {
            if (i === j) return;
            const bStart = toMins(other.start);
            const bEnd = toMins(other.end);
            if (bEnd <= bStart) return;
            // Overlap: aStart < bEnd && bStart < aEnd
            if (aStart < bEnd && bStart < aEnd) {
                errors.add(i);
                errors.add(j);
            }
        });
    });
    return errors;
};

const WeeklyScheduleConfig = ({ workingHours, onChange }) => {

    const handleToggleDay = (day) => {
        const next = { ...workingHours };
        if (next[day]) {
            delete next[day];
        } else {
            next[day] = [{ id: newId(), start: '09:00', end: '17:00', approval_status: 'pending' }];
        }
        onChange(next);
    };

    const handleTimeChange = (day, index, field, value) => {
        const next = { ...workingHours };
        const slots = [...(next[day] || [])];
        // Editing a slot resets it to pending (also clears a prior rejection).
        slots[index] = { ...slots[index], [field]: value, approval_status: 'pending' };
        if (!slots[index].id) slots[index].id = newId();
        next[day] = slots;
        onChange(next);
    };

    const addTimeSlot = (day) => {
        const next = { ...workingHours };
        const slots = [...(next[day] || [])];
        // Default new slot just after the last one ends
        const last = slots[slots.length - 1];
        const newStart = last?.end || '09:00';
        // Add 4 hours for a sensible default end
        const [h, m] = newStart.split(':').map(Number);
        const endH = Math.min(h + 4, 23);
        const newEnd = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        slots.push({ id: newId(), start: newStart, end: newEnd, approval_status: 'pending' });
        next[day] = slots;
        onChange(next);
    };

    const removeTimeSlot = (day, index) => {
        const next = { ...workingHours };
        const slots = [...(next[day] || [])];
        slots.splice(index, 1);
        if (slots.length === 0) {
            delete next[day];
        } else {
            next[day] = slots;
        }
        onChange(next);
    };

    return (
        <Box>
            <Grid container spacing={2}>
                {DAYS.map((day) => {
                    const isEnabled = !!workingHours[day];
                    const slots = workingHours[day] || [];
                    const errored = isEnabled ? getSlotErrors(slots) : new Set();

                    return (
                        <Grid item xs={12} key={day}>
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 2,
                                    bgcolor: isEnabled ? 'background.paper' : 'action.disabledBackground',
                                    borderColor: errored.size > 0 ? 'error.main' : undefined,
                                }}
                            >
                                <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                                    {/* Day toggle */}
                                    <Box display="flex" alignItems="center" width={160} flexShrink={0}>
                                        <Switch
                                            checked={isEnabled}
                                            onChange={() => handleToggleDay(day)}
                                            color="primary"
                                        />
                                        <Typography fontWeight={isEnabled ? 'bold' : 'normal'}>{day}</Typography>
                                    </Box>

                                    {/* Time slots */}
                                    <Box flex={1}>
                                        {isEnabled && slots.map((slot, index) => {
                                            const isOverlap = errored.has(index);
                                            const endBeforeStart = toMins(slot.end) <= toMins(slot.start);

                                            return (
                                                <Box key={index} mb={1}>
                                                    <Box display="flex" alignItems="center" gap={2}>
                                                        <TextField
                                                            type="time"
                                                            size="small"
                                                            label="Start"
                                                            value={slot.start}
                                                            onChange={(e) => handleTimeChange(day, index, 'start', e.target.value)}
                                                            InputLabelProps={{ shrink: true }}
                                                            error={isOverlap}
                                                        />
                                                        <Typography color="text.secondary">–</Typography>
                                                        <TextField
                                                            type="time"
                                                            size="small"
                                                            label="End"
                                                            value={slot.end}
                                                            onChange={(e) => handleTimeChange(day, index, 'end', e.target.value)}
                                                            InputLabelProps={{ shrink: true }}
                                                            error={isOverlap}
                                                        />
                                                        <IconButton
                                                            size="small"
                                                            color="error"
                                                            onClick={() => removeTimeSlot(day, index)}
                                                            disabled={slots.length === 1}
                                                        >
                                                            <RemoveCircleOutlineIcon />
                                                        </IconButton>
                                                        {index === slots.length - 1 && (
                                                            <IconButton
                                                                size="small"
                                                                color="primary"
                                                                onClick={() => addTimeSlot(day)}
                                                            >
                                                                <AddCircleOutlineIcon />
                                                            </IconButton>
                                                        )}
                                                        <SlotStatusChip status={slot.approval_status} />
                                                    </Box>
                                                    {isOverlap && (
                                                        <Typography variant="caption" color="error" sx={{ pl: 1 }}>
                                                            {endBeforeStart
                                                                ? 'End time must be after start time'
                                                                : 'This window overlaps with another range — please adjust'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                        {!isEnabled && (
                                            <Typography variant="body2" color="text.disabled" py={1}>
                                                Unavailable
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            </Paper>
                        </Grid>
                    );
                })}
            </Grid>
        </Box>
    );
};

export default WeeklyScheduleConfig;
