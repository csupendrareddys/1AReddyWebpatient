import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorAbout,
    submitDoctorAbout,
} from '../../redux/doctorSlice';
import {
    setAboutFieldText,
    setAboutFieldAttachment,
    setAboutWorkQualification,
    setAboutWorkQualifications,
    setAboutExperience,
    removeAboutFieldAttachment,
    populateAboutFromProfile,
    setAboutSubmitting,
} from '../redux/doctorProfileAboutSlice';
import { setSnackbar } from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useAboutMe = (previewMode = false) => {
    const dispatch = useDispatch();

    const aboutState = useSelector((state) =>
        state.doctorProfileAbout || PREVIEW_SAMPLE_DATA.aboutState
    );

    const resolvedAbout = previewMode ? PREVIEW_SAMPLE_DATA.aboutState : aboutState;

    // Fetch about data on mount
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const aboutResult = await dispatch(fetchDoctorAbout()).unwrap();
                if (aboutResult) dispatch(populateAboutFromProfile(aboutResult));
            } catch (_) { /* about may not exist yet */ }
        };
        load();
    }, [dispatch, previewMode]);

    const handleAboutTextChange = useCallback((field, text) => {
        dispatch(setAboutFieldText({ field, text }));
    }, [dispatch]);

    const handleAboutAttachmentChange = useCallback((field, file) => {
        if (!file) {
            dispatch(removeAboutFieldAttachment(field));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setAboutFieldAttachment({
            field,
            data: { attachment: file, preview, attachmentName: file.name },
        }));
    }, [dispatch]);

    const handleRemoveAboutAttachment = useCallback((field) => {
        dispatch(removeAboutFieldAttachment(field));
    }, [dispatch]);

    const handleSaveAbout = useCallback(async () => {
        dispatch(setAboutSubmitting(true));
        try {
            const formData = new FormData();
            const { briefAbout, natureOfWork, currentlyWorkingWith, workQualification, workQualifications, experience } = resolvedAbout;

            formData.append('briefAbout', briefAbout.text || '');
            formData.append('natureOfWork', natureOfWork.text || '');
            formData.append('currentlyWorkingWith', currentlyWorkingWith.text || '');
            // '' clears the selection; the backend treats blank as "none".
            formData.append('workQualification', workQualification?.id || '');
            // Multi work qualifications — JSON array of category ids (first =
            // primary). The backend syncs the ProfileWorkQualification rows.
            formData.append(
                'workQualifications',
                JSON.stringify((workQualifications || []).map((w) => String(w.id))),
            );
            // '' means "not stated"; the backend keeps that distinct from 0.
            formData.append('ugExperienceYears', experience?.ugYears ?? '');
            formData.append('pgExperienceYears', experience?.pgYears ?? '');
            formData.append('superSpecialityExperienceYears', experience?.superSpecialityYears ?? '');

            if (briefAbout.attachment) formData.append('briefAboutAttachment', briefAbout.attachment);
            if (natureOfWork.attachment) formData.append('natureOfWorkAttachment', natureOfWork.attachment);
            if (currentlyWorkingWith.attachment) formData.append('currentlyWorkingWithAttachment', currentlyWorkingWith.attachment);

            const result = await dispatch(submitDoctorAbout(formData)).unwrap();
            if (result) dispatch(populateAboutFromProfile(result));
            dispatch(setSnackbar({ open: true, message: 'About information submitted for approval!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || err || 'Failed to save about info', severity: 'error' }));
        } finally {
            dispatch(setAboutSubmitting(false));
        }
    }, [dispatch, resolvedAbout]);

    const handleWorkQualificationChange = useCallback((choice) => {
        dispatch(setAboutWorkQualification(choice));
    }, [dispatch]);

    const handleWorkQualificationsChange = useCallback((list) => {
        dispatch(setAboutWorkQualifications(list));
    }, [dispatch]);

    const handleExperienceChange = useCallback((field, value) => {
        dispatch(setAboutExperience({ field, value }));
    }, [dispatch]);

    return {
        aboutState: resolvedAbout,
        handleAboutTextChange,
        handleAboutAttachmentChange,
        handleRemoveAboutAttachment,
        handleWorkQualificationChange,
        handleWorkQualificationsChange,
        handleExperienceChange,
        handleSaveAbout,
    };
};

export default useAboutMe;
