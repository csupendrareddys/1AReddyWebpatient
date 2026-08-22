import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import useAvailabilitySchedule from '../hooks/useAvailabilitySchedule';
import { useGetDoctorAppointmentsQuery } from '../../api/scopedDoctorApi';
import { useDoctorScope } from '../context/DoctorScopeContext';
import AvailabilityCalendar from '../components/AvailabilityCalendar';
import AvailabilityApprovalDialog from '../components/AvailabilityApprovalDialog';
import getMaxDuration from '../utils/getMaxDuration';

const AvailabilitySection = React.memo(({ previewMode = false, registerSave }) => {
    const {
        availabilityConfig,
        availabilityApprovalStatus,
        availableDays,
        availableSlots,
        approvedSlotPricing,
        approvedWorkingDays,
        approvedDayOverrides,
        handleSaveAvailability,
        toggleDayAvailability,
        updateSlotsForDay,
        updateSlotsForDays,
    } = useAvailabilitySchedule(previewMode);
    const { isOps } = useDoctorScope();

    // Use approved data from backend (admin-approved snapshots) for slot generation controls.
    // The local formData.slotPricing is only for the doctor's editable pricing form —
    // the calendar MUST use approved snapshots to prevent bypassing admin approval.
    const maxApprovedDuration = useMemo(() => getMaxDuration(approvedSlotPricing), [approvedSlotPricing]);

    // Booked slots — from the doctor's own appointments, so the calendar can
    // group/lock them. Map: { 'YYYY-MM-DD': ['09:00', ...] } of occupied starts.
    const { data: apptData } = useGetDoctorAppointmentsQuery({ page_size: 500 });
    const bookedSlots = useMemo(() => {
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

    // "Sent for approval" summary popup shown after a successful save.
    const [approvalDialog, setApprovalDialog] = useState({ open: false, submitted: {}, baseline: {} });

    // Save, then — on success — surface the popup with the just-submitted overrides
    // diffed against the last approved baseline (approved → blue, new → yellow).
    //
    // The baseline is the approved snapshot as it stands AFTER the save, not
    // before. An admin senior enough to approve their own Operations edit has
    // these slots already approved by the time this runs, and listing them as
    // "in approval" would be a lie; for a doctor the snapshot is untouched by
    // the save, so it's the same baseline it always was.
    const handleSaveAndPreview = useCallback(async () => {
        const submitted = JSON.parse(JSON.stringify(availableSlots || {}));
        const result = await handleSaveAvailability();
        if (!result) return;
        const baseline = JSON.parse(JSON.stringify(
            result?.schedule?.approved_day_overrides || approvedDayOverrides || {},
        ));
        setApprovalDialog({ open: true, submitted, baseline });
    }, [availableSlots, approvedDayOverrides, handleSaveAvailability]);

    useEffect(() => {
        if (registerSave) {
            // Neutral wording in Operations: whether the save needs a review
            // depends on how senior the admin is, and only the backend knows —
            // its response message is what reports the outcome.
            registerSave(handleSaveAndPreview, isOps ? 'Save Availability' : 'Send for Approval', false);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSaveAndPreview, isOps]);

    return (
        <Box>
            <div className="section-title-bar">Manage Availability</div>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Click on a working-hours day to generate appointment slots for that date.
            </Typography>
            <AvailabilityCalendar
                availableDays={availableDays}
                availableSlots={availableSlots}
                bookedSlots={bookedSlots}
                workingHours={availabilityConfig?.working_days || {}}
                approvedWorkingDays={approvedWorkingDays}
                maxApprovedDuration={maxApprovedDuration}
                slotPricing={approvedSlotPricing}
                approvalStatus={availabilityApprovalStatus}
                onToggleDay={toggleDayAvailability}
                onUpdateSlots={updateSlotsForDay}
                onBulkUpdateSlots={updateSlotsForDays}
            />
            <AvailabilityApprovalDialog
                open={approvalDialog.open}
                onClose={() => setApprovalDialog((d) => ({ ...d, open: false }))}
                submittedOverrides={approvalDialog.submitted}
                approvedBaseline={approvalDialog.baseline}
            />
        </Box>
    );
});

AvailabilitySection.displayName = 'AvailabilitySection';
export default AvailabilitySection;
