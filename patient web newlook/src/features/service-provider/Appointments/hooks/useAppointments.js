/**
 * useAppointments — Custom hook for the Appointments sub-feature
 * Combines doctorSlice thunks + appointmentsUiSlice for UI state
 */
import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorAppointments,
    acceptAppointment,
    rejectAppointment,
    createPrescription,
    clearDoctorErrors,
} from '../../redux/doctorSlice';

import {
    setTabValue,
    openRejectDialog,
    closeRejectDialog,
    setRejectReason,
    openConsultation,
    closeConsultation,
    setConsultationField,
    addMedicine,
    updateMedicine,
    removeMedicine,
    setViewMode,
} from '../redux/appointmentsUiSlice';

const STATUS_MAP = { 0: 'pending', 1: 'confirmed', 2: 'completed', 3: 'cancelled' };

const useAppointments = () => {
    const dispatch = useDispatch();

    // Server state from doctorSlice
    const { appointments, loading, error, actionLoading, actionError, actionSuccess } =
        useSelector((state) => state.doctor);

    // UI state from appointmentsUiSlice
    const {
        tabValue, rejectDialogOpen, selectedAppointmentId,
        rejectReason, consultationOpen, consultationData,
        viewMode,
    } = useSelector((state) => state.appointmentsUi);

    // ─── Load appointments on tab change ───────────
    useEffect(() => {
        dispatch(fetchDoctorAppointments({ status: STATUS_MAP[tabValue] }));
    }, [dispatch, tabValue]);

    // ─── Tab ────────────────────────────────────────
    const handleTabChange = useCallback((event, newValue) => {
        dispatch(setTabValue(newValue));
    }, [dispatch]);

    // ─── Accept ─────────────────────────────────────
    const handleAccept = useCallback((id) => {
        dispatch(acceptAppointment(id));
    }, [dispatch]);

    // ─── Reject ─────────────────────────────────────
    const handleRejectClick = useCallback((id) => {
        dispatch(openRejectDialog(id));
    }, [dispatch]);

    const handleRejectConfirm = useCallback(() => {
        if (!selectedAppointmentId) return;
        dispatch(rejectAppointment({ appointmentId: selectedAppointmentId, reason: rejectReason }));
        dispatch(closeRejectDialog());
    }, [dispatch, selectedAppointmentId, rejectReason]);

    const handleCloseRejectDialog = useCallback(() => {
        dispatch(closeRejectDialog());
    }, [dispatch]);

    // ─── Consultation ───────────────────────────────
    const handleOpenConsultation = useCallback((id) => {
        dispatch(openConsultation(id));
    }, [dispatch]);

    const handleCloseConsultation = useCallback(() => {
        dispatch(closeConsultation());
    }, [dispatch]);

    const handleConsultationFieldChange = useCallback((name, value) => {
        dispatch(setConsultationField({ name, value }));
    }, [dispatch]);

    const handleAddMedicine = useCallback(() => {
        dispatch(addMedicine());
    }, [dispatch]);

    const handleMedicineChange = useCallback((index, field, value) => {
        dispatch(updateMedicine({ index, field, value }));
    }, [dispatch]);

    const handleRemoveMedicine = useCallback((index) => {
        dispatch(removeMedicine(index));
    }, [dispatch]);

    const handleSubmitConsultation = useCallback(() => {
        if (!selectedAppointmentId) return;
        if (!consultationData.diagnosis) {
            alert('Please enter a diagnosis');
            return;
        }
        dispatch(createPrescription({
            appointmentId: selectedAppointmentId,
            data: consultationData,
        })).then((result) => {
            if (!result.error) {
                dispatch(closeConsultation());
            }
        });
    }, [dispatch, selectedAppointmentId, consultationData]);

    // ─── Helpers ────────────────────────────────────
    const formatDate = useCallback((dateString) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        });
    }, []);

    const formatTime = useCallback((timeString) => {
        if (!timeString) return 'TBD';
        if (timeString.includes('T')) {
            return new Date(timeString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
        return timeString.substring(0, 5);
    }, []);

    const handleClearErrors = useCallback(() => {
        dispatch(clearDoctorErrors());
    }, [dispatch]);

    return {
        // Data
        appointments, loading, error,
        actionLoading, actionError, actionSuccess,

        // Tabs
        tabValue,
        handleTabChange,

        // Reject dialog
        rejectDialogOpen,
        rejectReason,
        handleRejectClick,
        handleRejectConfirm,
        handleCloseRejectDialog,
        setRejectReason: (val) => dispatch(setRejectReason(val)),

        // Accept
        handleAccept,

        // Consultation
        consultationOpen,
        consultationData,
        handleOpenConsultation,
        handleCloseConsultation,
        handleConsultationFieldChange,
        handleAddMedicine,
        handleMedicineChange,
        handleRemoveMedicine,
        handleSubmitConsultation,

        // View Mode
        viewMode,
        setViewMode: (val) => dispatch(setViewMode(val)),

        // Helpers
        formatDate,
        formatTime,
        handleClearErrors,
    };
};

export default useAppointments;
