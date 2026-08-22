import { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorProfile,
    updateDoctorProfile,
    fetchDoctorSchedule,
    fetchDoctorExtendedProfile,
    updateDoctorExtendedProfile,
} from '../../redux/doctorSlice';
import {
    setFormField,
    setFormData,
    populateFormFromProfile,
    populateAvailabilityFromSchedule,
    setLoading,
    setSnackbar,
    setDocumentField,
    setDocumentData,
    setFemaleField,
    setCommunicationField,
    setCommunicationData,
    setPermanentAddressField,
    copyCommToPermanent,
} from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';
import { extractApiError } from '../../../../common/utils/apiError';
import { toLocalDateString } from '../../../../common/utils/date';

const usePersonalDetails = (previewMode = false) => {
    const dispatch = useDispatch();
    const hasFetched = useRef(false);

    const { isAuthenticated } = useSelector((state) => state.auth);
    const ui = useSelector((state) => state.doctorProfileUi || {});
    const { loading: dataLoading } = useSelector((state) => state.doctor || {});

    const {
        formData = PREVIEW_SAMPLE_DATA.formData,
        documentData = PREVIEW_SAMPLE_DATA.documentData,
        female_data = PREVIEW_SAMPLE_DATA.female_data,
        communication_data = PREVIEW_SAMPLE_DATA.communication_data,
        permanent_address_data = PREVIEW_SAMPLE_DATA.permanent_address_data,
        loading: uiLoading = false,
    } = previewMode ? PREVIEW_SAMPLE_DATA : ui;

    const loading = previewMode ? false : (dataLoading || uiLoading);

    // Load profile + schedule + extended profile once auth is ready
    useEffect(() => {
        if (previewMode || !isAuthenticated || hasFetched.current) return;
        hasFetched.current = true;

        const loadData = async () => {
            try {
                const profileResult = await dispatch(fetchDoctorProfile()).unwrap();
                if (profileResult) {
                    dispatch(populateFormFromProfile(profileResult));
                }

                const scheduleResult = await dispatch(fetchDoctorSchedule()).unwrap();
                if (scheduleResult) {
                    dispatch(populateAvailabilityFromSchedule(scheduleResult));
                }

                // Load extended profile (documents, female data, addresses)
                try {
                    const extResult = await dispatch(fetchDoctorExtendedProfile()).unwrap();
                    if (extResult) {
                        dispatch(setFormData({
                            alternate_phone_number: extResult.alternate_phone_number || '',
                            alternate_email:        extResult.alternate_email || '',
                            height:                 extResult.height || '',
                            weight:                 extResult.weight || '',
                            category:               extResult.category || '',
                            religion:               extResult.religion || '',
                            citizenship:            extResult.citizenship || '',
                            languages_known:        extResult.languages_known || [],
                            name_as_per_aadhaar:    extResult.name_as_per_aadhaar || '',
                            name_as_per_pan:        extResult.name_as_per_pan || '',
                            // Registration + COP details (flat keys for the form).
                            ...(extResult.registration_details || {}),
                        }));
                        if (extResult.documents) {
                            dispatch(setDocumentData(extResult.documents));
                        }
                        if (extResult.female_data) {
                            Object.entries(extResult.female_data).forEach(([name, value]) => {
                                dispatch(setFemaleField({ name, value: value || '' }));
                            });
                        }
                        if (extResult.communication_address && Object.keys(extResult.communication_address).length) {
                            dispatch(setCommunicationData(extResult.communication_address));
                        }
                        if (extResult.permanent_address && Object.keys(extResult.permanent_address).length) {
                            Object.entries(extResult.permanent_address).forEach(([name, value]) => {
                                dispatch(setPermanentAddressField({ name, value: value || '' }));
                            });
                        }
                    }
                } catch (_) { /* extended profile may not exist yet */ }
            } catch (err) {
                console.error('Failed to load doctor data', err);
                hasFetched.current = false; // Allow retry on next auth change
            }
        };

        loadData();
    }, [dispatch, previewMode, isAuthenticated]);

    // ── Form Handlers ──
    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setFormField({ name, value }));
    }, [dispatch]);

    const handleDateChange = useCallback((name, date) => {
        dispatch(setFormField({ name, value: date }));
    }, [dispatch]);

    const handleGenderSelect = useCallback((gender) => {
        dispatch(setFormField({ name: 'gender', value: gender }));
    }, [dispatch]);

    const handleSaveProfile = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const { slotPricing, ...profileFields } = formData;
            const payload = { ...profileFields };
            if (payload.dob) payload.dob = toLocalDateString(payload.dob);

            await dispatch(updateDoctorProfile(payload)).unwrap();
            dispatch(setSnackbar({ open: true, message: 'Profile changes submitted for approval!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: extractApiError(err, 'Failed to update profile'), severity: 'error' }));
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, formData]);

    // ── Document / Female / Address Handlers ──
    const handleDocumentChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setDocumentField({ name, value }));
    }, [dispatch]);

    const handleDocumentFileChange = useCallback((name, file) => {
        dispatch(setDocumentField({ name, value: file ?? '' }));
    }, [dispatch]);

    const handleFemaleChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setFemaleField({ name, value }));
    }, [dispatch]);

    const handleCommunicationChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setCommunicationField({ name, value }));
    }, [dispatch]);

    const handleCommunicationFileChange = useCallback((name, file) => {
        dispatch(setCommunicationField({ name, value: file ?? '' }));
    }, [dispatch]);

    const handlePermanentAddressChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setPermanentAddressField({ name, value }));
    }, [dispatch]);

    const handlePermanentAddressFileChange = useCallback((name, file) => {
        dispatch(setPermanentAddressField({ name, value: file ?? '' }));
    }, [dispatch]);

    const handleCopyCommToPermanent = useCallback(() => {
        dispatch(copyCommToPermanent());
    }, [dispatch]);

    const handleSaveExtendedProfile = useCallback(async () => {
        dispatch(setLoading(true));
        try {
            const payload = new FormData();

            payload.append('alternate_phone_number', formData.alternate_phone_number || '');
            payload.append('alternate_email', formData.alternate_email || '');
            payload.append('languages_known', JSON.stringify(formData.languages_known || []));
            payload.append('height', formData.height || '');
            payload.append('weight', formData.weight || '');
            payload.append('category', formData.category || '');
            payload.append('religion', formData.religion || '');
            payload.append('citizenship', formData.citizenship || '');

            payload.append('aadhar_number', documentData.aadhar_number || '');
            payload.append('pan_number', documentData.pan_number || '');
            payload.append('name_as_per_aadhaar', formData.name_as_per_aadhaar || '');
            payload.append('name_as_per_pan', formData.name_as_per_pan || '');
            [
                'registration_name', 'registration_date', 'registration_expiry',
                'registration_board', 'registration_state',
                'cop_number', 'cop_name', 'cop_date', 'cop_expiry', 'cop_board', 'cop_state',
            ].forEach((k) => payload.append(k, formData[k] || ''));
            if (documentData.aadhar_attachment instanceof File) payload.append('aadhar_attachment', documentData.aadhar_attachment);
            if (documentData.pan_attachment instanceof File) payload.append('pan_attachment', documentData.pan_attachment);
            // Registration + COP certificate files (reset to pending re-verification on upload).
            if (documentData.registration_certificate instanceof File) payload.append('registration_certificate', documentData.registration_certificate);
            if (documentData.cop_attachment instanceof File) payload.append('cop_attachment', documentData.cop_attachment);

            payload.append('LMP_calender', female_data.LMP_calender || '');
            payload.append('LMP_remarks', female_data.LMP_remarks || '');
            payload.append('pregnancy_status', female_data.pregnancy_status || '');
            payload.append('pregnancy_status_remarks', female_data.pregnancy_status_remarks || '');

            Object.entries(communication_data).forEach(([k, v]) => {
                if (!(v instanceof File)) payload.append(`comm_${k}`, v || '');
                else payload.append(`comm_${k}`, v);
            });

            Object.entries(permanent_address_data).forEach(([k, v]) => {
                if (!(v instanceof File)) payload.append(`perm_${k}`, v || '');
                else payload.append(`perm_${k}`, v);
            });

            await dispatch(updateDoctorExtendedProfile(payload)).unwrap();
            dispatch(setSnackbar({ open: true, message: 'Extended profile changes submitted for approval!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: extractApiError(err, 'Failed to save extended profile'), severity: 'error' }));
        } finally {
            dispatch(setLoading(false));
        }
    }, [dispatch, formData, documentData, female_data, communication_data, permanent_address_data]);

    return {
        loading,
        formData,
        documentData,
        female_data,
        communication_data,
        permanent_address_data,
        handleInputChange,
        handleDateChange,
        handleGenderSelect,
        handleSaveProfile,
        handleDocumentChange,
        handleDocumentFileChange,
        handleFemaleChange,
        handleCommunicationChange,
        handleCommunicationFileChange,
        handlePermanentAddressChange,
        handlePermanentAddressFileChange,
        handleCopyCommToPermanent,
        handleSaveExtendedProfile,
    };
};

export default usePersonalDetails;
