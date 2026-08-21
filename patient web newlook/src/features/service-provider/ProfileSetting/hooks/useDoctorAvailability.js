import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorSchedule,
    updateDoctorSchedule,
} from '../../redux/doctorSlice';
import {
    populateAvailabilityFromSchedule,
    setAvailabilityConfig,
    setAvailabilityField,
    setWorkingDays,
    toggleException,
    setApprovalStatus,
    addAvailableDay,
    removeAvailableDay,
    updateDaySlots,
    updateMultipleDaySlots,
    setSlotPricing,
    setLoading,
    setSnackbar,
    clearSnackbar,
} from '../redux/doctorProfilePersonalDetailsSlice';

const useDoctorAvailability = () => {
    const dispatch = useDispatch();

    const { schedule, loading: dataLoading, error: dataError } = useSelector((state) => state.doctor);
    const ui = useSelector((state) => state.doctorProfileUi);

    const {
        availabilityConfig,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        availabilityApprovalRequestedAt,
        availabilityApprovedAt,
        // Legacy calendar
        availableDays,
        availableSlots,
        // Slot pricing (stored in formData)
        formData,
        loading: uiLoading,
        error: uiError,
        snackbar,
    } = ui;

    const slotConfig = formData.slotPricing;
    const loading = dataLoading || uiLoading;
    const error = dataError || uiError;

    // ── Load schedule on mount ─────────────────────────────────────────
    useEffect(() => {
        const loadData = async () => {
            try {
                const result = await dispatch(fetchDoctorSchedule()).unwrap();
                if (result) {
                    dispatch(populateAvailabilityFromSchedule(result));
                }
            } catch (err) {
                console.error('Failed to load doctor schedule', err);
            }
        };

        // Always fetch fresh from backend on mount to ensure latest slot data
        loadData();
    }, [dispatch]);

    // ── Save handler ───────────────────────────────────────────────────
    const handleSaveAvailability = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const payload = {
                availability_config: availabilityConfig,
                slot_pricing: slotConfig,
            };
            const result = await dispatch(updateDoctorSchedule(payload)).unwrap();
            if (result?.schedule) {
                dispatch(populateAvailabilityFromSchedule(result.schedule));
            }
            const backendMsg = result?.message || 'Schedule saved! Awaiting admin approval to go live.';
            dispatch(setSnackbar({
                open: true,
                message: backendMsg,
                severity: 'success'
            }));
        } catch (err) {
            dispatch(setSnackbar({
                open: true,
                message: err.message || err || 'Failed to save schedule',
                severity: 'error'
            }));
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, availabilityConfig, slotConfig]);

    // ── Availability config field handlers ─────────────────────────────
    const handleAvailabilityFieldChange = useCallback((field, value) => {
        dispatch(setAvailabilityField({ field, value }));
    }, [dispatch]);

    const handleWorkingHoursChange = useCallback((newWorkingDays) => {
        dispatch(setWorkingDays(newWorkingDays));
    }, [dispatch]);

    const handleToggleException = useCallback((dateStr) => {
        dispatch(toggleException(dateStr));
    }, [dispatch]);

    // ── Slot pricing (charges dropdown) handler ────────────────────────
    const handleSlotConfigChange = useCallback((newConfig) => {
        dispatch(setSlotPricing(newConfig));
    }, [dispatch]);

    // ── Legacy calendar handlers (for AvailabilityCalendar overrides) ──
    const toggleDayAvailability = useCallback((day) => {
        if (availableDays.includes(day)) {
            dispatch(removeAvailableDay(day));
        } else {
            dispatch(addAvailableDay(day));
        }
    }, [dispatch, availableDays]);

    const updateSlotsForDay = useCallback((day, newSlots) => {
        dispatch(updateDaySlots({ day, slots: newSlots }));
    }, [dispatch]);

    const updateSlotsForDays = useCallback((updates) => {
        dispatch(updateMultipleDaySlots(updates));
    }, [dispatch]);

    return {
        // Availability config
        availabilityConfig,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        availabilityApprovalRequestedAt,
        availabilityApprovedAt,

        // Charges / slot pricing
        slotConfig,

        // Legacy calendar
        availableDays,
        availableSlots,

        // Meta
        loading,
        error,
        snackbar,
        schedule,

        // Handlers
        handleSaveAvailability,
        handleAvailabilityFieldChange,
        handleWorkingHoursChange,
        handleToggleException,
        handleSlotConfigChange,
        toggleDayAvailability,
        updateSlotsForDay,
        updateSlotsForDays,
        handleCloseSnackbar: () => dispatch(clearSnackbar()),
    };
};

export default useDoctorAvailability;
