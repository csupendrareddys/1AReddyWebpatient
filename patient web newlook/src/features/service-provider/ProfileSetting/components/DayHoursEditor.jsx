import React from 'react';
import {
    Popover, Box, Typography, Switch, TextField, IconButton, Button,
    Chip, Divider, Tooltip,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { toMins, getSlotErrors, formatTime12h } from '../utils/scheduleTime';

/**
 * Popover editor for a single (day × consultation-type) cell of the weekly
 * hours grid. Edits are applied to the draft immediately via onChangeDay /
 * onCopyToAllWeekdays; persistence still happens through the section-level
 * "Save & Submit Working Hours" button.
 */
const DayHoursEditor = ({
    open,
    anchorEl,
    onClose,
    day,
    type,
    slots = [],
    approvedSlots = [],
    status,
    onChangeDay,
    onCopyToAllWeekdays,
}) => {
    const isEnabled = slots.length > 0;
    const errored = getSlotErrors(slots);

    const setSlots = (next) => onChangeDay(next);

    const handleToggleDay = () => {
        if (isEnabled) {
            setSlots([]);
        } else {
            setSlots([{ start: '09:00', end: '17:00' }]);
        }
    };

    const handleTimeChange = (index, field, value) => {
        const next = slots.map((s, i) => (i === index ? { ...s, [field]: value } : s));
        setSlots(next);
    };

    const addSlot = () => {
        const last = slots[slots.length - 1];
        const newStart = last?.end || '09:00';
        const [h, m] = newStart.split(':').map(Number);
        const endH = Math.min(h + 2, 23);
        const newEnd = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        setSlots([...slots, { start: newStart, end: newEnd }]);
    };

    const removeSlot = (index) => {
        setSlots(slots.filter((_, i) => i !== index));
    };

    const statusChip = {
        pending: { label: 'Pending approval', color: 'warning' },
        rejected: { label: 'Rejected', color: 'error' },
        approved: { label: 'Approved', color: 'success' },
    }[status];

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            PaperProps={{ sx: { width: 340, p: 2, borderRadius: 2 } }}
        >
            {/* Header */}
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
                <Box display="flex" alignItems="center" gap={1}>
                    <Box
                        sx={{
                            width: 12, height: 12, borderRadius: '50%',
                            bgcolor: type?.color, flexShrink: 0,
                        }}
                    />
                    <Typography variant="subtitle2" fontWeight="bold">
                        {day} · {type?.shortLabel || type?.label}
                    </Typography>
                </Box>
                <EditOutlinedIcon fontSize="small" color="action" />
            </Box>

            {statusChip && (
                <Chip
                    size="small"
                    variant="outlined"
                    color={statusChip.color}
                    label={statusChip.label}
                    sx={{ mb: 1, height: 20, fontSize: '0.7rem' }}
                />
            )}

            {/* Live / approved reference */}
            {approvedSlots.length > 0 && (
                <Box mb={1}>
                    <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                        <LockOutlinedIcon sx={{ fontSize: 14 }} color="action" />
                        <Typography variant="caption" color="text.secondary">
                            Live (approved)
                        </Typography>
                    </Box>
                    <Box display="flex" flexWrap="wrap" gap={0.5}>
                        {approvedSlots.map((s, i) => (
                            <Chip
                                key={i}
                                size="small"
                                variant="outlined"
                                color="success"
                                label={`${formatTime12h(s.start)} – ${formatTime12h(s.end)}`}
                                sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            <Divider sx={{ my: 1 }} />

            {/* Availability toggle */}
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="body2" fontWeight={600}>
                    {isEnabled ? 'Available' : 'Unavailable'}
                </Typography>
                <Switch size="small" checked={isEnabled} onChange={handleToggleDay} />
            </Box>

            {/* Editable time ranges */}
            {isEnabled && slots.map((slot, index) => {
                const isErr = errored.has(index);
                const endBeforeStart = toMins(slot.end) <= toMins(slot.start);
                return (
                    <Box key={index} mb={1}>
                        <Box display="flex" alignItems="center" gap={1}>
                            <TextField
                                type="time"
                                size="small"
                                label="Start"
                                value={slot.start}
                                onChange={(e) => handleTimeChange(index, 'start', e.target.value)}
                                InputLabelProps={{ shrink: true }}
                                error={isErr}
                                sx={{ flex: 1 }}
                            />
                            <Typography color="text.secondary">–</Typography>
                            <TextField
                                type="time"
                                size="small"
                                label="End"
                                value={slot.end}
                                onChange={(e) => handleTimeChange(index, 'end', e.target.value)}
                                InputLabelProps={{ shrink: true }}
                                error={isErr}
                                sx={{ flex: 1 }}
                            />
                            <IconButton size="small" color="error" onClick={() => removeSlot(index)}>
                                <RemoveCircleOutlineIcon fontSize="small" />
                            </IconButton>
                        </Box>
                        {isErr && (
                            <Typography variant="caption" color="error">
                                {endBeforeStart
                                    ? 'End must be after start'
                                    : 'Overlaps another range'}
                            </Typography>
                        )}
                    </Box>
                );
            })}

            {isEnabled && (
                <Button
                    size="small"
                    startIcon={<AddCircleOutlineIcon />}
                    onClick={addSlot}
                    sx={{ textTransform: 'none' }}
                >
                    Add time range
                </Button>
            )}

            <Divider sx={{ my: 1 }} />

            {/* Actions */}
            <Box display="flex" alignItems="center" justifyContent="space-between">
                <Tooltip title="Copy these ranges to every weekday (Mon–Sun) for this consultation type">
                    <span>
                        <Button
                            size="small"
                            startIcon={<ContentCopyIcon fontSize="small" />}
                            onClick={() => onCopyToAllWeekdays(slots)}
                            disabled={!isEnabled || errored.size > 0}
                            sx={{ textTransform: 'none' }}
                        >
                            Copy to all days
                        </Button>
                    </span>
                </Tooltip>
                <Button size="small" variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>
                    Done
                </Button>
            </Box>
        </Popover>
    );
};

export default DayHoursEditor;
