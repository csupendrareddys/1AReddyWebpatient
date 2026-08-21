import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorSchedule,
    updateDoctorSchedule,
} from '../../redux/doctorSlice';
import {
    populateAvailabilityFromSchedule,
    setWorkingDays,
    addAvailableDay,
    removeAvailableDay,
    updateDaySlots,
    updateMultipleDaySlots,
    setLoading,
    setSnackbar,
} from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useAvailabilitySchedule = (previewMode = false) => {
    const dispatch = useDispatch();

    const ui = useSelector((state) => state.doctorProfileUi || {});
    const { schedule } = useSelector((state) => state.doctor || {});

    const {
        availabilityConfig = PREVIEW_SAMPLE_DATA.availabilityConfig,
        availabilityApprovalStatus = PREVIEW_SAMPLE_DATA.availabilityApprovalStatus,
        availabilityRejectionReason = '',
        availableDays = PREVIEW_SAMPLE_DATA.availableDays,
        availableSlots = {},
        approvedSlotPricing = [],
        approvedWorkingDays = {},
        approvedDayOverrides = {},
        granularStatus = null,
    } = previewMode ? PREVIEW_SAMPLE_DATA : ui;

    // Always fetch fresh schedule on mount — ensures approval status,
    // approved pricing, and approved working days are current.
    // (Admin may have approved/rejected since last fetch.)
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const scheduleResult = await dispatch(fetchDoctorSchedule()).unwrap();
                if (scheduleResult) {
                    dispatch(populateAvailabilityFromSchedule(scheduleResult));
                }
            } catch (err) {
                console.error('Failed to load schedule', err);
            }
        };
        load();
    }, [dispatch, previewMode]);

    const handleSaveAvailability = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const payload = {
                availability_config: availabilityConfig,
            };
            const result = await dispatch(updateDoctorSchedule(payload)).unwrap();
            if (result?.schedule) {
                dispatch(populateAvailabilityFromSchedule(result.schedule));
            }
            const backendMsg = result?.message || 'Availability saved! Awaiting admin approval.';
            dispatch(setSnackbar({ open: true, message: backendMsg, severity: 'success' }));
            // The result, not a bare `true`: callers need the POST-save approved
            // snapshot to say what's actually still waiting on a review. Truthy
            // either way, so `if (ok)` callers are unaffected.
            return result || true;
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || err || 'Failed to update availability', severity: 'error' }));
            return false;
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, availabilityConfig]);

    const handleWorkingHoursChange = useCallback((newWorkingDays) => {
        dispatch(setWorkingDays(newWorkingDays));
    }, [dispatch]);

    const handleSaveWorkingHours = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const payload = { availability_config: availabilityConfig };
            const result = await dispatch(updateDoctorSchedule(payload)).unwrap();
            if (result?.schedule) {
                dispatch(populateAvailabilityFromSchedule(result.schedule));
            }
            const backendMsg = result?.message || 'Working hours saved! Awaiting admin approval.';
            dispatch(setSnackbar({ open: true, message: backendMsg, severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || err || 'Failed to save working hours', severity: 'error' }));
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, availabilityConfig]);

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
        availabilityConfig,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        granularStatus,
        availableDays,
        availableSlots,
        approvedSlotPricing,
        approvedWorkingDays,
        approvedDayOverrides,
        handleSaveAvailability,
        handleWorkingHoursChange,
        handleSaveWorkingHours,
        toggleDayAvailability,
        updateSlotsForDay,
        updateSlotsForDays,
    };
};

export default useAvailabilitySchedule;
