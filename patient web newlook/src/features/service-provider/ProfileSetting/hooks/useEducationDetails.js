import { useEffect, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorEducation,
    submitDoctorEducation,
    fetchEducationDropdownOptions,
} from '../../redux/doctorSlice';
import {
    setEducationField,
    setEducationFile,
    removeEducationFile,
    populateEducationFromProfile,
    setEducationDropdownOptions,
    setEducationSubmitting,
} from '../redux/doctorProfileEducationSlice';
import { setSnackbar } from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';
import { extractApiError } from '../../../../common/utils/apiError';

const useEducationDetails = (previewMode = false) => {
    const dispatch = useDispatch();

    const educationState = useSelector((state) =>
        state.doctorProfileEducation || PREVIEW_SAMPLE_DATA.educationState
    );

    // In preview mode the per-doctor education fields come from sample
    // data (the admin previewing isn't a doctor), but the dropdown
    // options should reflect the LIVE master_data tables — otherwise
    // the operator sees a hardcoded ``MBBS / BDS / BAMS`` fallback that
    // doesn't match what real doctors will see at signup. Merge: take
    // the sample shape, but overlay ``dropdownOptions`` from redux
    // (populated by ``fetchEducationDropdownOptions`` below) when the
    // fetch returned a non-empty list.
    const resolvedEducation = useMemo(() => {
        if (!previewMode) return educationState;
        const liveDropdowns = educationState?.dropdownOptions;
        const sampleDropdowns = PREVIEW_SAMPLE_DATA.educationState.dropdownOptions;
        // Use the live dropdowns when redux has been populated (any key
        // is non-empty); else stick with the sample shape so we don't
        // crash on missing keys.
        const hasLive = liveDropdowns
            && Object.values(liveDropdowns).some(v => Array.isArray(v) && v.length > 0);
        return {
            ...PREVIEW_SAMPLE_DATA.educationState,
            dropdownOptions: hasLive
                ? { ...sampleDropdowns, ...liveDropdowns }
                : sampleDropdowns,
        };
    }, [previewMode, educationState]);

    // Fetch education + dropdown options on mount.
    //
    // Preview mode (admin previewing the profile page from the editor):
    //   * SKIP the per-doctor ``fetchDoctorEducation`` — the admin isn't a
    //     doctor; the sample data in PREVIEW_SAMPLE_DATA fills in.
    //   * SKIP the master_data dropdown fetch too. The preview tab is
    //     supposed to reflect WHICHEVER lifecycle row the operator
    //     toggled to (Draft / Preview / Live), and the dropdown fetch
    //     always returns LIVE master_data — so firing it overwrote
    //     the draft option overrides the preview tab dispatches.
    //     ``DoctorProfilePreviewTab`` is responsible for dispatching
    //     ``setEducationDropdownOptions`` with values derived from
    //     the chosen source (its field.options + resolved
    //     data_sources). The merge below ensures we don't crash if
    //     no override was dispatched (falls back to sample data).
    //
    // Non-preview (real doctor signed in): unchanged — fetch the
    // master_data dropdowns so the public profile form populates.
    useEffect(() => {
        const load = async () => {
            if (previewMode) return;
            try {
                const eduResult = await dispatch(fetchDoctorEducation()).unwrap();
                if (eduResult) dispatch(populateEducationFromProfile(eduResult));
            } catch (_) { /* education may not exist yet */ }

            try {
                const dropdownResult = await dispatch(fetchEducationDropdownOptions()).unwrap();
                if (dropdownResult) dispatch(setEducationDropdownOptions(dropdownResult));
            } catch (_) { /* dropdowns may not be available */ }
        };
        load();
    }, [dispatch, previewMode]);

    const handleEducationFieldChange = useCallback((section, field, value) => {
        dispatch(setEducationField({ section, field, value }));
    }, [dispatch]);

    const handleEducationFileChange = useCallback((section, fileType, file) => {
        if (!file) {
            dispatch(removeEducationFile({ section, fileType }));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setEducationFile({
            section,
            fileType,
            data: { file, preview, fileName: file.name },
        }));
    }, [dispatch]);

    const handleRemoveEducationFile = useCallback((section, fileType) => {
        dispatch(removeEducationFile({ section, fileType }));
    }, [dispatch]);

    const handleSaveEducation = useCallback(async () => {
        dispatch(setEducationSubmitting(true));
        try {
            const formData = new FormData();
            const { graduation, postGraduation, superSpeciality, otherCertification } = resolvedEducation;

            formData.append('graduation', JSON.stringify({
                degree: graduation.degree || '',
                specialization: graduation.specialization || '',
                state: graduation.state || '',
                university: graduation.university || '',
                institute: graduation.institute || '',
                yearOfGraduation: graduation.yearOfGraduation || '',
                evaluationCriteria: graduation.evaluationCriteria || '',
                obtainedScore: graduation.obtainedScore || '',
                registrationNumber: graduation.registrationNumber || '',
            }));
            if (graduation.certificate.file) formData.append('graduation_certificate', graduation.certificate.file);
            if (graduation.marksheet.file) formData.append('graduation_marksheet', graduation.marksheet.file);

            formData.append('postGraduation', JSON.stringify({
                degree: postGraduation.degree || '',
                specialization: postGraduation.specialization || '',
                state: postGraduation.state || '',
                university: postGraduation.university || '',
                institute: postGraduation.institute || '',
                yearOfGraduation: postGraduation.yearOfGraduation || '',
                evaluationCriteria: postGraduation.evaluationCriteria || '',
                obtainedScore: postGraduation.obtainedScore || '',
                registrationNumber: postGraduation.registrationNumber || '',
            }));
            if (postGraduation.certificate.file) formData.append('postGraduation_certificate', postGraduation.certificate.file);
            if (postGraduation.marksheet.file) formData.append('postGraduation_marksheet', postGraduation.marksheet.file);

            formData.append('superSpeciality', JSON.stringify({
                degree: superSpeciality.degree || '',
                specialization: superSpeciality.specialization || '',
                state: superSpeciality.state || '',
                university: superSpeciality.university || '',
                institute: superSpeciality.institute || '',
                yearOfGraduation: superSpeciality.yearOfGraduation || '',
                evaluationCriteria: superSpeciality.evaluationCriteria || '',
                obtainedScore: superSpeciality.obtainedScore || '',
                registrationNumber: superSpeciality.registrationNumber || '',
            }));
            if (superSpeciality.certificate.file) formData.append('superSpeciality_certificate', superSpeciality.certificate.file);
            if (superSpeciality.marksheet.file) formData.append('superSpeciality_marksheet', superSpeciality.marksheet.file);

            formData.append('otherCertification', JSON.stringify({
                courseName: otherCertification.courseName || '',
                specialization: otherCertification.specialization || '',
                state: otherCertification.state || '',
                university: otherCertification.university || '',
                institute: otherCertification.institute || '',
                yearOfCourse: otherCertification.yearOfCourse || '',
                evaluationCriteria: otherCertification.evaluationCriteria || '',
                obtainedScore: otherCertification.obtainedScore || '',
                registrationNumber: otherCertification.registrationNumber || '',
            }));
            if (otherCertification.certificate.file) formData.append('otherCertification_certificate', otherCertification.certificate.file);
            if (otherCertification.marksheet.file) formData.append('otherCertification_marksheet', otherCertification.marksheet.file);

            const result = await dispatch(submitDoctorEducation(formData)).unwrap();
            if (result) dispatch(populateEducationFromProfile(result));
            dispatch(setSnackbar({ open: true, message: 'Education details submitted for verification!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: extractApiError(err, 'Failed to submit education details'), severity: 'error' }));
        } finally {
            dispatch(setEducationSubmitting(false));
        }
    }, [dispatch, resolvedEducation]);

    return {
        educationState: resolvedEducation,
        handleEducationFieldChange,
        handleEducationFileChange,
        handleRemoveEducationFile,
        handleSaveEducation,
    };
};

export default useEducationDetails;
