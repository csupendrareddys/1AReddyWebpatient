import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorSchedule,
    updateDoctorSchedule,
} from '../../redux/doctorSlice';
import {
    setSlotPricing,
    populateAvailabilityFromSchedule,
    setLoading,
    setSnackbar,
} from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const usePricingConfig = (previewMode = false) => {
    const dispatch = useDispatch();

    const ui = useSelector((state) => state.doctorProfileUi || {});

    const {
        availabilityConfig = PREVIEW_SAMPLE_DATA.availabilityConfig,
        availabilityApprovalStatus = PREVIEW_SAMPLE_DATA.availabilityApprovalStatus,
        availabilityRejectionReason = '',
        granularStatus = null,
    } = previewMode ? PREVIEW_SAMPLE_DATA : ui;

    const formData = previewMode ? PREVIEW_SAMPLE_DATA.formData : (ui.formData || PREVIEW_SAMPLE_DATA.formData);

    // Always fetch fresh schedule data to pick up latest approval status
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const scheduleResult = await dispatch(fetchDoctorSchedule()).unwrap();
                if (scheduleResult) {
                    dispatch(populateAvailabilityFromSchedule(scheduleResult));
                }
            } catch (err) {
                console.error('Failed to load schedule for pricing', err);
            }
        };
        load();
    }, [dispatch, previewMode]);

    const handleSlotPricingChange = useCallback((newSlots) => {
        dispatch(setSlotPricing(newSlots));
    }, [dispatch]);

    const handleSavePricing = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const pricing = formData.slotPricing || [];
            let maxDur = 15;
            if (pricing.length > 0) {
               const max = Math.max(...pricing.map(p => Number(p.duration) || 0));
               if (max > 0) maxDur = max;
            }
            const payload = {
                slot_pricing: pricing,
                availability_config: {
                    ...availabilityConfig,
                    slot_size: maxDur
                }
            };
            const result = await dispatch(updateDoctorSchedule(payload)).unwrap();
            if (result?.schedule) {
                dispatch(populateAvailabilityFromSchedule(result.schedule));
            }
            const backendMsg = result?.message || 'Consultation pricing submitted for admin approval!';
            dispatch(setSnackbar({
                open: true,
                message: backendMsg,
                severity: 'success',
            }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || err || 'Failed to save pricing', severity: 'error' }));
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, formData.slotPricing, availabilityConfig]);

    return {
        slotPricing: formData.slotPricing || [],
        availabilityApprovalStatus,
        availabilityRejectionReason,
        granularStatus,
        handleSlotPricingChange,
        handleSavePricing,
    };
};

export default usePricingConfig;
