import React, { useMemo } from 'react';
import {
    Box,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Button,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import SendIcon from '@mui/icons-material/Send';
import { format } from 'date-fns';
import { CONSULTATION_TYPE_MAP } from '../constants/consultationTypes';

// In-Approval (awaiting admin review) colour.
const PENDING_COLOR = '#f9a825'; // yellow / amber

/** Stable identity for a slot so we can diff the submitted set against the approved baseline. */
const slotKey = (s) =>
    `${s.start}-${s.end}-${[...(s.consultation_types || ['complete'])].sort().join(',')}`;

const formatDateLabel = (dateStr) => {
    try {
        return format(new Date(`${dateStr}T00:00:00`), 'EEE, MMM d, yyyy');
    } catch {
        return dateStr;
    }
};

/**
 * Popup shown after the doctor clicks "Save Availability".
 *
 * Confirms the schedule was sent for admin approval and lays out every date/slot,
 * colouring each by whether it is already approved (blue) or awaiting review (yellow).
 * "Approved" is decided by diffing the just-submitted overrides against the last
 * admin-approved baseline snapshot.
 */
const AvailabilityApprovalDialog = ({ open, onClose, submittedOverrides = {}, approvedBaseline = {} }) => {
    const dates = useMemo(() => {
        return Object.keys(submittedOverrides || {})
            .filter((d) => (submittedOverrides[d] || []).length > 0)
            .sort();
    }, [submittedOverrides]);

    // Keep ONLY the in-approval (new/changed) slots — those absent from the approved
    // baseline. Already-approved, unchanged slots are counted (for the note below) but
    // not listed, so the popup shows only what still needs admin review.
    const { rows, approvedCount, pendingCount } = useMemo(() => {
        let approvedCount = 0;
        let pendingCount = 0;
        const rows = [];
        dates.forEach((date) => {
            const approvedKeys = new Set((approvedBaseline[date] || []).map(slotKey));
            const pendingSlots = [...(submittedOverrides[date] || [])]
                .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
                .filter((s) => {
                    if (approvedKeys.has(slotKey(s))) {
                        approvedCount += 1;
                        return false;
                    }
                    pendingCount += 1;
                    return true;
                });
            if (pendingSlots.length > 0) rows.push({ date, slots: pendingSlots });
        });
        return { rows, approvedCount, pendingCount };
    }, [dates, submittedOverrides, approvedBaseline]);

    // Every listed slot is in-approval, so the chip is always the pending (amber) style.
    const renderSlotChip = (slot, idx) => {
        const color = PENDING_COLOR;
        const types = (slot.consultation_types || ['complete'])
            .map((t) => CONSULTATION_TYPE_MAP[t]?.shortLabel || t)
            .join(', ');
        return (
            <Chip
                key={`${slot.start}-${idx}`}
                size="small"
                icon={<HourglassTopIcon sx={{ color: `${color} !important` }} />}
                label={
                    <Box component="span">
                        {slot.start}–{slot.end}
                        {types && (
                            <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.75 }}>
                                ({types})
                            </Typography>
                        )}
                        <Typography component="span" variant="caption" sx={{ ml: 0.5, fontWeight: 700 }}>
                            · In Approval
                        </Typography>
                    </Box>
                }
                variant="outlined"
                sx={{
                    borderColor: color,
                    color,
                    bgcolor: `${color}14`, // ~8% tint
                    fontWeight: 600,
                    '& .MuiChip-label': { px: 0.75 },
                }}
            />
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {/* Nothing left in approval means either nothing changed or the
                save was already approved on submission (a senior admin editing
                from Operations). Either way "Sent for Approval" would be
                wrong, so the header follows the outcome. */}
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SendIcon color="primary" />
                {rows.length === 0 ? 'Availability Saved' : 'Sent for Approval'}
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {rows.length === 0 ? (
                        <>Nothing is waiting on a review — every slot you saved is
                        approved and live.</>
                    ) : (
                        <>Your availability has been sent to the admin for approval. Only the
                        newly added or changed slots below stay <strong>in approval</strong>{' '}
                        until an admin reviews them.</>
                    )}
                </Typography>

                {/* Legend — only the in-approval slots are listed here */}
                {rows.length > 0 && (
                    <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <HourglassTopIcon sx={{ color: PENDING_COLOR, fontSize: 18 }} />
                            <Typography variant="caption" sx={{ color: PENDING_COLOR, fontWeight: 700 }}>
                                In Approval ({pendingCount})
                            </Typography>
                        </Box>
                    </Stack>
                )}

                {approvedCount > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                        {approvedCount} approved slot{approvedCount === 1 ? '' : 's'} not shown.
                    </Typography>
                )}

                {rows.length === 0 ? null : (
                    <Box sx={{ maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
                        {rows.map(({ date, slots }, i) => (
                            <Box key={date} sx={{ mb: i === rows.length - 1 ? 0 : 1.5 }}>
                                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                                    {formatDateLabel(date)}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                    {slots.map((slot, idx) => renderSlotChip(slot, idx))}
                                </Box>
                                {i !== rows.length - 1 && <Divider sx={{ mt: 1.5 }} />}
                            </Box>
                        ))}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="contained">Got it</Button>
            </DialogActions>
        </Dialog>
    );
};

export default AvailabilityApprovalDialog;
