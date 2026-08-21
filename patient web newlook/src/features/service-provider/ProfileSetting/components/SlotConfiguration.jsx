import React, { useState } from 'react';
import {
    Box, Typography, Button, IconButton, TextField,
    Select, MenuItem, FormControl, InputLabel,
    Divider, Chip, Alert, Tooltip, Paper
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

// Slot size options (multiples of 5, up to 120 min)
const SLOT_SIZE_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

const getCeilingLabel = (v) => {
    if (v === 0) return 'None (exact start)';
    return `${v} min (e.g. 9:00 → 9:00, 9:01 → 9:${String(v).padStart(2, '0')})`;
};

/**
 * SlotConfiguration
 *
 * Manages:
 *   - Slot size (dropdown, multiples of 5)
 *   - Slot gap (Select, multiples of slot_size)
 *   - Start time ceiling (0 | 5 | 10)
 *   - Charges (label + duration + fee entries = slot_pricing array)
 *
 * Props:
 *   availabilityConfig  : { slot_size, slot_gap, start_ceiling, ... }
 *   slotPricing         : [{ label, duration, fee }]
 *   onConfigChange(field, value) : update single availability_config field
 *   onPricingChange(newArray)    : update slot_pricing array
 */
const SlotConfiguration = ({
    availabilityConfig = {},
    slotPricing = [],
    onConfigChange,
    onPricingChange,
}) => {
    const slotSize = availabilityConfig.slot_size ?? 15;
    const slotGap = availabilityConfig.slot_gap ?? 0;
    const startCeiling = availabilityConfig.start_ceiling ?? 5;

    // Gap options are 0, slotSize, 2×slotSize
    const gapOptions = [0, slotSize, slotSize * 2];
    const ceilingOptions = [0, 5, 10];

    // New charge entry
    const [newCharge, setNewCharge] = useState({ label: '', duration: slotSize, fee: '' });
    const [chargeError, setChargeError] = useState('');

    const handleAddCharge = () => {
        setChargeError('');
        if (!newCharge.label.trim()) { setChargeError('Label is required'); return; }
        if (!newCharge.fee || isNaN(Number(newCharge.fee))) { setChargeError('Valid fee is required'); return; }
        const updated = [...slotPricing, {
            label: newCharge.label.trim(),
            duration: Number(newCharge.duration),
            fee: Number(newCharge.fee),
        }];
        onPricingChange(updated);
        setNewCharge({ label: '', duration: slotSize, fee: '' });
    };

    const handleDeleteCharge = (idx) => {
        onPricingChange(slotPricing.filter((_, i) => i !== idx));
    };

    // When slot_size changes, reset gap if it's no longer valid
    const handleSlotSizeChange = (newSize) => {
        onConfigChange('slot_size', newSize);
        // If current gap isn't a valid multiple of new size, reset to 0
        if (slotGap % newSize !== 0) {
            onConfigChange('slot_gap', 0);
        }
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom fontWeight="bold">
                Slot Configuration
            </Typography>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Configure how appointment slots are generated from your working hours.
            </Typography>

            {/* ── Slot Timing Grid ────────────────────────────────────── */}
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr 1fr' }} gap={2} mb={3}>

                {/* Slot Size */}
                <FormControl size="small" fullWidth>
                    <InputLabel>Slot Size</InputLabel>
                    <Select
                        value={slotSize}
                        label="Slot Size"
                        onChange={(e) => handleSlotSizeChange(Number(e.target.value))}
                    >
                        {SLOT_SIZE_OPTIONS.map(opt => (
                            <MenuItem key={opt} value={opt}>{opt} min</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {/* Slot Gap */}
                <FormControl size="small" fullWidth>
                    <InputLabel>Gap Between Slots</InputLabel>
                    <Select
                        value={slotGap}
                        label="Gap Between Slots"
                        onChange={(e) => onConfigChange('slot_gap', Number(e.target.value))}
                    >
                        {gapOptions.map(opt => (
                            <MenuItem key={opt} value={opt}>{opt === 0 ? 'None' : `${opt} min`}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {/* Start Ceiling */}
                <FormControl size="small" fullWidth>
                    <InputLabel>
                        <Box display="flex" alignItems="center" gap={0.5}>
                            Start Time Ceiling
                            <Tooltip title="If duty starts at exact boundary, keep it. If past a boundary, ceil to next one. E.g. ceiling=5: 9:00→9:00, 9:01→9:05">
                                <InfoOutlinedIcon sx={{ fontSize: 14, cursor: 'help' }} />
                            </Tooltip>
                        </Box>
                    </InputLabel>
                    <Select
                        value={startCeiling}
                        label="Start Time Ceiling"
                        onChange={(e) => onConfigChange('start_ceiling', Number(e.target.value))}
                    >
                        {ceilingOptions.map(opt => (
                            <MenuItem key={opt} value={opt}>{getCeilingLabel(opt)}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            {/* ── Preview ─────────────────────────────────────────────── */}
            <Alert severity="info" sx={{ mb: 3 }}>
                Each appointment slot = <strong>{slotSize} min</strong>
                {slotGap > 0 && <>, followed by a <strong>{slotGap} min</strong> gap</>}
                {startCeiling > 0 && <>, start times aligned to <strong>:{String(startCeiling).padStart(2,'0')} boundaries</ strong></>}.
            </Alert>

            <Divider sx={{ mb: 3 }} />

            {/* ── Charges (Slot Pricing) ───────────────────────────────── */}
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Charges
            </Typography>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Define different pricing tiers patients will see when booking.
            </Typography>

            {slotPricing.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
                    {slotPricing.map((item, idx) => (
                        <Chip
                            key={idx}
                            label={`${item.label} — ${item.duration} min — ₹${item.fee}`}
                            onDelete={() => handleDeleteCharge(idx)}
                            color="primary"
                            variant="outlined"
                            deleteIcon={<DeleteIcon />}
                        />
                    ))}
                </Box>
            )}

            <Paper variant="outlined" sx={{ p: 2 }}>
                <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '2fr 1fr 1fr auto' }} gap={2} alignItems="center">
                    <TextField
                        size="small"
                        label="Label (e.g. Regular)"
                        value={newCharge.label}
                        onChange={(e) => setNewCharge({ ...newCharge, label: e.target.value })}
                        fullWidth
                    />
                    <FormControl size="small" fullWidth>
                        <InputLabel>Duration</InputLabel>
                        <Select
                            value={newCharge.duration}
                            label="Duration"
                            onChange={(e) => setNewCharge({ ...newCharge, duration: Number(e.target.value) })}
                        >
                            {SLOT_SIZE_OPTIONS.map(opt => (
                                <MenuItem key={opt} value={opt}>{opt} min</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        size="small"
                        label="Fee (₹)"
                        type="number"
                        inputProps={{ min: 0 }}
                        value={newCharge.fee}
                        onChange={(e) => setNewCharge({ ...newCharge, fee: e.target.value })}
                        fullWidth
                    />
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={handleAddCharge}
                        sx={{ whiteSpace: 'nowrap' }}
                    >
                        Add
                    </Button>
                </Box>
                {chargeError && (
                    <Typography color="error" variant="caption" sx={{ mt: 1, display: 'block' }}>
                        {chargeError}
                    </Typography>
                )}
            </Paper>
        </Box>
    );
};

export default SlotConfiguration;
