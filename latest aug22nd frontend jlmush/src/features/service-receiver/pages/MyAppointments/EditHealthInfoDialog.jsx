/**
 * EditHealthInfoDialog — lets a patient revise the health info they shared for a
 * booking, AFTER booking and until it's completed.
 *
 * It reuses the booking flow's SymptomsAndRecordsPage (which reads the shared
 * bookingFlow slice), but first HYDRATES that slice from the saved medical
 * context — so reopening it shows the previous selections and saving never
 * wipes them. The context stores habits/records/surgeries as arrays of
 * {key, visible}; the editor's local state uses {key: true} maps, so we reverse
 * that mapping on the way in.
 */
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Dialog, DialogContent, Box, CircularProgress } from '@mui/material';

import { useGetAppointmentContextQuery } from '../../api/scopedBookingApi';
import {
    setMedicalContextId, setConsultationType, setSharingToggles,
    setSectionVisibility, setSelectedSymptoms, setCustomSymptoms,
    setAdditionalVitals, setAdditionalDetails, setBookingFor,
} from '../../redux/bookingFlowSlice';
import SymptomsAndRecordsPage from '../BookByType/SymptomsAndRecordsPage';

const arrToMap = (arr, key) => (
    Array.isArray(arr)
        ? arr.reduce((m, x) => { if (x && x[key] != null) m[x[key]] = x.visible !== false; return m; }, {})
        : (arr && typeof arr === 'object' ? arr : {})
);

export default function EditHealthInfoDialog({ open, onClose, contextId, consultationType }) {
    const dispatch = useDispatch();
    const { data: ctx, isFetching } = useGetAppointmentContextQuery(contextId, {
        skip: !open || !contextId,
    });
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!open) { setHydrated(false); return; }
        if (!ctx || !ctx.id || hydrated) return;
        dispatch(setMedicalContextId(contextId));
        dispatch(setConsultationType(ctx.consultation_type || consultationType || 'general'));
        dispatch(setSharingToggles({
            vitals: ctx.shared_vitals && typeof ctx.shared_vitals === 'object' ? ctx.shared_vitals : {},
            habits: arrToMap(ctx.shared_habits, 'habit_key'),
            records: arrToMap(ctx.shared_health_records, 'record_id'),
            surgeries: arrToMap(ctx.shared_prescriptions, 'prescription_id'),
        }));
        dispatch(setSectionVisibility({ vitals: true, habits: true, health_records: true, surgeries: true }));
        dispatch(setSelectedSymptoms(
            (ctx.selected_symptoms || []).map((s) => ({ id: s.symptom_id, severity: s.severity || 'moderate' })),
        ));
        dispatch(setCustomSymptoms(ctx.selected_custom_symptoms || []));
        dispatch(setAdditionalVitals(ctx.additional_vitals || {}));
        dispatch(setAdditionalDetails(ctx.patient_notes || { description: '', remarks: '' }));
        dispatch(setBookingFor({
            bookingFor: ctx.house_group_member_id || ctx.booking_for_id ? 'member' : 'self',
            member: null,
        }));
        setHydrated(true);
    }, [open, ctx, hydrated, dispatch, contextId, consultationType]);

    if (!open) return null;
    if (!hydrated || isFetching) {
        return (
            <Dialog open fullWidth maxWidth="sm">
                <DialogContent>
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
                </DialogContent>
            </Dialog>
        );
    }
    return (
        <SymptomsAndRecordsPage asDialog open onClose={onClose} onSaved={onClose} />
    );
}
