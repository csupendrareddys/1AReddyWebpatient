import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Tabs, Tab, Chip, Alert, Button,
    Radio, RadioGroup, FormControlLabel, FormControl,
    Divider, Tooltip,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { SCHEDULABLE_CONSULTATION_TYPES as CONSULTATION_TYPES } from '../constants/consultationTypes';
import {
    useGetSlotVisibilityQuery,
    useSubmitSlotVisibilityMutation,
} from '../../api/scopedDoctorApi';
import {
    useGetConsultationTargetingQuery,
    useUpdateConsultationTargetingMutation,
    useGetDoctorProductCategoriesQuery,
    useGetAvailableSymptomsQuery,
} from '../../api/doctorEndpoints';
import TargetingSection from '../../../../common/components/TargetingSection/TargetingSection';

// ── Visibility gap options (0, 5, 10, ..., 120 mins) ────────────────────────

const VISIBILITY_OPTIONS = [
    { value: 0,   label: 'Emergency',   description: 'Slot visible right up to its start time — no advance cutoff' },
    ...Array.from({ length: 24 }, (_, i) => {
        const mins = (i + 1) * 5;
        const hours = mins / 60;
        const timeLabel = Number.isInteger(hours) ? `${hours}h` : `${mins} mins`;
        return {
            value: mins,
            label: timeLabel,
            description: `Slot disappears from patient view ${mins} minute${mins > 1 ? 's' : ''} before its start`,
        };
    }),
];

// ── Approval status config ────────────────────────────────────────────────────

const APPROVAL_STATUS_CONFIG = {
    not_submitted: { label: 'Not Submitted',        color: 'default',  icon: null },
    pending:       { label: 'Pending Approval',      color: 'warning',  icon: <HourglassEmptyIcon fontSize="inherit" /> },
    approved:      { label: 'Approved',              color: 'success',  icon: <CheckCircleIcon fontSize="inherit" /> },
    rejected:      { label: 'Rejected by Admin',     color: 'error',    icon: <ErrorIcon fontSize="inherit" /> },
};

// ── Initial state helpers ─────────────────────────────────────────────────────

const makeInitialGap = () =>
    Object.fromEntries(CONSULTATION_TYPES.map((ct) => [ct.value, 0]));

const makeInitialApproval = () =>
    Object.fromEntries(CONSULTATION_TYPES.map((ct) => [ct.value, 'not_submitted']));

// ── Main Section ──────────────────────────────────────────────────────────────

const SlotVisibilitySection = React.memo(({ previewMode = false, registerSave }) => {
    const [activeTypeIdx, setActiveTypeIdx] = useState(0);

    // Fetch current slot visibility config from backend
    const { data: slotData } = useGetSlotVisibilityQuery(undefined, { skip: previewMode });
    const [submitSlotVisibility] = useSubmitSlotVisibilityMutation();

    // Per-type gap (minutes before slot start at which it disappears for patients)
    const [perTypeGap, setPerTypeGap] = useState(makeInitialGap);

    // Per-type approval state
    const [perTypeApproval, setPerTypeApproval] = useState(makeInitialApproval);

    // ── Per-type audience targeting — edits accumulate locally across ALL
    // types; one "Save targeting" click sends the whole map in a single
    // PUT (no per-click API traffic). ──
    const { data: savedTargeting } = useGetConsultationTargetingQuery(undefined, { skip: previewMode });
    const { data: productCategories = [] } = useGetDoctorProductCategoriesQuery(undefined, { skip: previewMode });
    const { data: availableSymptoms } = useGetAvailableSymptomsQuery(undefined, { skip: previewMode });
    const [saveTargeting, { isLoading: savingTargeting }] = useUpdateConsultationTargetingMutation();
    const [targetingByType, setTargetingByType] = useState({});
    const [targetingDirty, setTargetingDirty] = useState(false);
    const [targetingMsg, setTargetingMsg] = useState(null);

    useEffect(() => {
        if (savedTargeting) {
            setTargetingByType(savedTargeting);
            setTargetingDirty(false);
        }
    }, [savedTargeting]);

    const handleSaveTargeting = async () => {
        try {
            await saveTargeting(targetingByType).unwrap();
            setTargetingDirty(false);
            setTargetingMsg({ sev: 'success', text: 'Targeting saved for all consultation types.' });
        } catch (err) {
            setTargetingMsg({
                sev: 'error',
                text: err?.data?.error || err?.data?.message || 'Could not save targeting.',
            });
        }
    };

    // Sync from backend data when loaded
    useEffect(() => {
        if (!slotData) return;
        const { slot_visibility_gap, slot_visibility_approval_status, slot_visibility_approved_gap } = slotData;

        // Set gap values from backend (requested gap, or approved gap as fallback)
        if (slot_visibility_gap && Object.keys(slot_visibility_gap).length > 0) {
            setPerTypeGap((prev) => ({ ...prev, ...slot_visibility_gap }));
        } else if (slot_visibility_approved_gap && Object.keys(slot_visibility_approved_gap).length > 0) {
            setPerTypeGap((prev) => ({ ...prev, ...slot_visibility_approved_gap }));
        }

        // Set per-type approval status from the global approval status
        if (slot_visibility_approval_status) {
            setPerTypeApproval(() => {
                const next = {};
                CONSULTATION_TYPES.forEach((ct) => {
                    next[ct.value] = slot_visibility_approval_status;
                });
                return next;
            });
        }
    }, [slotData]);

    const activeType = CONSULTATION_TYPES[activeTypeIdx];

    // ── Save / Submit for Approval ──
    const handleSubmit = useCallback(async () => {
        try {
            await submitSlotVisibility(perTypeGap).unwrap();
            // Mark all types as pending after successful submission
            setPerTypeApproval(() => {
                const next = {};
                CONSULTATION_TYPES.forEach((ct) => {
                    next[ct.value] = 'pending';
                });
                return next;
            });
        } catch (err) {
            console.error('Slot visibility submission failed:', err);
        }
    }, [perTypeGap, submitSlotVisibility]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSubmit, 'Submit for Approval', false);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSubmit]);

    const handleGapChange = (typeValue, newGap) => {
        setPerTypeGap((prev) => ({ ...prev, [typeValue]: Number(newGap) }));
        // Reset approval to not_submitted if doctor changes a previously submitted value
        setPerTypeApproval((prev) =>
            prev[typeValue] !== 'not_submitted'
                ? { ...prev, [typeValue]: 'not_submitted' }
                : prev
        );
    };

    const currentGap      = perTypeGap[activeType?.value] ?? 0;
    const currentApproval = perTypeApproval[activeType?.value] ?? 'not_submitted';
    const approvedGap     = currentApproval === 'approved' ? currentGap : null;
    const approvalCfg     = APPROVAL_STATUS_CONFIG[currentApproval];

    return (
        <Box>
            <div className="section-title-bar">Slot Visibility Window</div>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Control how early a slot disappears from patient booking view before its start time.
                Each consultation type can have a different cutoff. Changes require super-admin approval.
            </Typography>

            <Alert severity="info" icon={<AccessTimeIcon fontSize="inherit" />} sx={{ mb: 3, py: 0.5 }}>
                Example: if a slot is at <strong>5:00 PM</strong> and you select <strong>10 mins</strong>,
                patients will no longer see it after <strong>4:50 PM</strong>.
            </Alert>

            {/* ── Consultation type sub-navigation ── */}
            <Paper variant="outlined" sx={{ mb: 3 }}>
                <Tabs
                    value={activeTypeIdx}
                    onChange={(_, v) => setActiveTypeIdx(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 } }}
                >
                    {CONSULTATION_TYPES.map((ct) => {
                        const approval = perTypeApproval[ct.value];
                        const isApproved = approval === 'approved';
                        const isPending  = approval === 'pending';
                        return (
                            <Tab
                                key={ct.value}
                                label={
                                    <Box display="flex" alignItems="center" gap={0.75}>
                                        <Box
                                            sx={{
                                                width: 10, height: 10, borderRadius: '50%',
                                                bgcolor: ct.color, flexShrink: 0,
                                            }}
                                        />
                                        {ct.shortLabel}
                                        {isApproved && (
                                            <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                                        )}
                                        {isPending && (
                                            <HourglassEmptyIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                                        )}
                                    </Box>
                                }
                            />
                        );
                    })}
                </Tabs>
            </Paper>

            {/* ── Active type content ── */}
            {activeType && (
                <Paper elevation={1} sx={{ p: 3, borderRadius: 2 }}>
                    {/* Type header */}
                    <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                        <Box
                            sx={{
                                width: 40, height: 40, borderRadius: '50%',
                                bgcolor: activeType.color + '1A',
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 20, flexShrink: 0,
                            }}
                        >
                            {activeType.icon}
                        </Box>
                        <Box>
                            <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>
                                {activeType.label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {activeType.description}
                            </Typography>
                        </Box>
                        <Box ml="auto">
                            <Chip
                                label={approvalCfg.label}
                                color={approvalCfg.color}
                                size="small"
                                icon={approvalCfg.icon || undefined}
                                variant={currentApproval === 'not_submitted' ? 'outlined' : 'filled'}
                            />
                        </Box>
                    </Box>

                    {/* Approved value banner */}
                    {currentApproval === 'approved' && (
                        <Alert severity="success" sx={{ mb: 2, py: 0.5 }}>
                            Currently live: slots disappear{' '}
                            <strong>
                                {approvedGap === 0
                                    ? 'right at start time (Emergency)'
                                    : `${approvedGap} mins before start`}
                            </strong>
                        </Alert>
                    )}
                    {currentApproval === 'pending' && (
                        <Alert severity="warning" sx={{ mb: 2, py: 0.5 }}>
                            Change submitted — awaiting super-admin approval.
                        </Alert>
                    )}
                    {currentApproval === 'rejected' && (
                        <Alert severity="error" sx={{ mb: 2, py: 0.5 }}>
                            Previous request was rejected. Adjust and resubmit.
                        </Alert>
                    )}

                    <Divider sx={{ mb: 2 }} />

                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                        Select cutoff window
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Choose how many minutes before slot start it should stop being visible to patients.
                    </Typography>

                    {/* ── Radio options ── */}
                    <FormControl component="fieldset" fullWidth>
                        <RadioGroup
                            value={String(currentGap)}
                            onChange={(e) => handleGapChange(activeType.value, e.target.value)}
                        >
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                                    gap: 1,
                                }}
                            >
                                {VISIBILITY_OPTIONS.map((opt) => {
                                    const isSelected = currentGap === opt.value;
                                    return (
                                        <Tooltip
                                            key={opt.value}
                                            title={opt.description}
                                            placement="top"
                                            arrow
                                        >
                                            <Paper
                                                variant="outlined"
                                                sx={{
                                                    px: 2, py: 1,
                                                    borderRadius: 2,
                                                    borderColor: isSelected ? activeType.color : 'divider',
                                                    bgcolor: isSelected ? activeType.color + '12' : 'background.paper',
                                                    cursor: 'pointer',
                                                    transition: 'border-color 0.15s, background-color 0.15s',
                                                    '&:hover': {
                                                        borderColor: activeType.color,
                                                        bgcolor: activeType.color + '08',
                                                    },
                                                }}
                                                onClick={() => handleGapChange(activeType.value, opt.value)}
                                            >
                                                <FormControlLabel
                                                    value={String(opt.value)}
                                                    control={
                                                        <Radio
                                                            size="small"
                                                            sx={{
                                                                color: activeType.color,
                                                                '&.Mui-checked': { color: activeType.color },
                                                                p: 0.5,
                                                            }}
                                                        />
                                                    }
                                                    label={
                                                        <Box>
                                                            <Typography
                                                                variant="body2"
                                                                fontWeight={isSelected ? 700 : 400}
                                                                color={isSelected ? 'text.primary' : 'text.secondary'}
                                                            >
                                                                {opt.label}
                                                            </Typography>
                                                            {opt.value === 0 && (
                                                                <Typography variant="caption" color="text.disabled">
                                                                    No cutoff
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                    }
                                                    sx={{ m: 0, width: '100%' }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </Paper>
                                        </Tooltip>
                                    );
                                })}
                            </Box>
                        </RadioGroup>
                    </FormControl>

                    <Box mt={2}>
                        <Typography variant="caption" color="text.secondary">
                            Selected: <strong>
                                {currentGap === 0
                                    ? 'Emergency — no cutoff'
                                    : `${currentGap} minutes before slot start`}
                            </strong>.
                            {' '}Use the <strong>Submit for Approval</strong> button at the bottom to send all types for review.
                        </Typography>
                    </Box>

                    {/* ── Audience targeting for THIS consultation type ── */}
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                        Targeting — who sees your {activeType.label.toLowerCase()} first
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure the audience for this consultation type. Edits across
                        all types are kept locally and saved together in one go.
                    </Typography>
                    {targetingMsg && (
                        <Alert
                            severity={targetingMsg.sev}
                            sx={{ mb: 2, py: 0.5 }}
                            onClose={() => setTargetingMsg(null)}
                        >
                            {targetingMsg.text}
                        </Alert>
                    )}
                    <TargetingSection
                        value={targetingByType[activeType.value] || null}
                        onChange={(t) => {
                            setTargetingByType((m) => ({ ...m, [activeType.value]: t }));
                            setTargetingDirty(true);
                            setTargetingMsg(null);
                        }}
                        categories={productCategories}
                        symptomOptions={availableSymptoms?.symptoms || []}
                    />
                    <Box mt={2} display="flex" justifyContent="flex-end">
                        <Button
                            variant="contained"
                            size="small"
                            disabled={!targetingDirty || savingTargeting}
                            onClick={handleSaveTargeting}
                        >
                            {savingTargeting ? 'Saving…' : 'Save targeting (all types)'}
                        </Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
});

SlotVisibilitySection.displayName = 'SlotVisibilitySection';
export default SlotVisibilitySection;
