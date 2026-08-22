
import React, { useState } from 'react';
import {
    Box, Typography, Checkbox, FormControlLabel,
    TextField, Paper, Alert, Chip, Tabs, Tab,
} from '@mui/material';
import { SCHEDULABLE_CONSULTATION_TYPES as CONSULTATION_TYPES, CONSULTATION_TYPE_MAP } from '../constants/consultationTypes';
// Fixed time ranges — each range maps to a slot duration. Shared with the
// patient's Find-a-Doctor length filter, which has to offer exactly the rungs
// a doctor can actually price.
import { SLOT_RANGES as TIME_RANGES } from '../constants/slotRanges';

/**
 * PricingSlots
 *
 * Sub-tabbed pricing: one tab per consultation type.
 * Each tab shows the same time-range checkboxes with price + description.
 *
 * Props:
 *   slots    : [{ range, duration, price, description, consultation_type }]
 *   onChange : (newSlots) => void
 *   approvalStatus : string  — 'pending' | 'approved' | 'rejected' | 'not_submitted' (Global fallback)
 *   rejectionReason: string | null
 *   granularStatus : object  — granular status tree
 */
const PricingSlots = ({ slots = [], onChange, approvalStatus, rejectionReason, granularStatus }) => {

    const [activeTypeIdx, setActiveTypeIdx] = useState(0);
    const activeType = CONSULTATION_TYPES[activeTypeIdx].value;

    // Helpers scoped to active consultation type
    const typeSlots = slots.filter((s) => (s.consultation_type || 'complete') === activeType);
    const getSlot = (range) => typeSlots.find((s) => s.range === range);
    const isChecked = (range) => !!getSlot(range);

    const handleToggle = (item) => {
        if (isChecked(item.range)) {
            // Uncheck — remove this type+range combination
            onChange(slots.filter((s) =>
                !((s.consultation_type || 'complete') === activeType && s.range === item.range),
            ));
        } else {
            onChange([
                ...slots,
                {
                    range: item.range,
                    duration: item.duration,
                    price: '',
                    description: '',
                    consultation_type: activeType,
                },
            ]);
        }
    };

    const handleField = (range, field, value) => {
        onChange(slots.map((s) =>
            (s.consultation_type || 'complete') === activeType && s.range === range
                ? { ...s, [field]: value }
                : s,
        ));
    };

    const statusColor = { approved: 'success', pending: 'warning', rejected: 'error', not_submitted: 'default' };
    const statusLabel = {
        approved: '✓ Approved — slot sizes are live',
        pending: '⏳ Awaiting admin approval',
        rejected: '✗ Rejected',
        not_submitted: 'Not submitted yet',
    };

    // Count configured slots per type for badge
    const countForType = (typeVal) =>
        slots.filter((s) => (s.consultation_type || 'complete') === typeVal && s.price).length;

    const activeTypeObj = granularStatus?.pricing?.[activeType] || {};
    const currentApprovalStatus = activeTypeObj.status || approvalStatus;
    const currentRejectionReason = activeTypeObj.reason || rejectionReason;

    return (
        <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="h6" fontWeight="bold">
                    {CONSULTATION_TYPES[activeTypeIdx].label} Pricing
                </Typography>
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
                Configure your consultation fees. Your quoted price is inclusive of applicable taxes and is your payout amount. The patient-facing price may vary due to platform pricing and discounts. Submit for admin approval.
            </Typography>

            {currentApprovalStatus === 'rejected' && currentRejectionReason && (
                <Alert severity="error" sx={{ mb: 2 }}>Rejection reason: {currentRejectionReason}</Alert>
            )}
            {currentApprovalStatus === 'pending' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Your pricing for {CONSULTATION_TYPES[activeTypeIdx].label} is pending admin review.
                </Alert>
            )}

            {/* ── Consultation Type Sub-Tabs ── */}
            <Paper variant="outlined" sx={{ mb: 2 }}>
                <Tabs
                    value={activeTypeIdx}
                    onChange={(_, v) => setActiveTypeIdx(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 },
                    }}
                >
                    {CONSULTATION_TYPES.map((ct, idx) => {
                        const count = countForType(ct.value);
                        const tStatus = granularStatus?.pricing?.[ct.value]?.status;
                        
                        // Decide if we should show a status indicator dot on the tab
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
                                        {count > 0 && (
                                            <Chip label={count} size="small" color="primary"
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

            {/* ── Description of active type ── */}
            <Alert severity="info" sx={{ mb: 2, py: 0.5 }} icon={false}>
                <Typography variant="body2">
                    <strong>{CONSULTATION_TYPES[activeTypeIdx].icon} {CONSULTATION_TYPES[activeTypeIdx].label}</strong>
                    {' — '}{CONSULTATION_TYPES[activeTypeIdx].description}
                </Typography>
            </Alert>

            {/* ── Pricing Rows for active type ── */}
            <Box display="flex" flexDirection="column" gap={1.5}>
                {TIME_RANGES.map((item) => {
                    const checked = isChecked(item.range);
                    const slot = getSlot(item.range);
                    const priceEmpty = checked && (!slot?.price && slot?.price !== 0);

                    return (
                        <Paper
                            key={item.range}
                            variant="outlined"
                            sx={{
                                p: 2,
                                borderColor: checked ? CONSULTATION_TYPES[activeTypeIdx].color : undefined,
                                borderWidth: checked ? 2 : 1,
                                bgcolor: checked ? 'action.hover' : 'background.paper',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={checked}
                                            onChange={() => handleToggle(item)}
                                            sx={{
                                                color: CONSULTATION_TYPES[activeTypeIdx].color,
                                                '&.Mui-checked': { color: CONSULTATION_TYPES[activeTypeIdx].color },
                                            }}
                                        />
                                    }
                                    label={
                                        <Typography fontWeight={checked ? 'bold' : 'normal'}>
                                            {item.label}
                                        </Typography>
                                    }
                                    sx={{ minWidth: 150, mr: 0 }}
                                />

                                {checked && (
                                    <>
                                        <TextField
                                            label="Price (₹)"
                                            type="number"
                                            size="small"
                                            value={slot?.price ?? ''}
                                            onChange={(e) => handleField(item.range, 'price', e.target.value)}
                                            inputProps={{ min: 0 }}
                                            required
                                            error={priceEmpty}
                                            helperText={priceEmpty ? 'Required' : ''}
                                            sx={{ width: 140 }}
                                        />
                                        <TextField
                                            label="Description / Label"
                                            size="small"
                                            placeholder="e.g. Quick Consult"
                                            value={slot?.description ?? ''}
                                            onChange={(e) => handleField(item.range, 'description', e.target.value)}
                                            sx={{ flex: 1, minWidth: 160 }}
                                        />
                                    </>
                                )}
                            </Box>
                        </Paper>
                    );
                })}
            </Box>
        </Box>
    );
};

export default PricingSlots;
