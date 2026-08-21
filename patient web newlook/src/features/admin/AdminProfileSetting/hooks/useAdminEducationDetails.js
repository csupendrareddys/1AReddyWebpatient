import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMyEducationQuery,
    useUpdateAdminMyEducationMutation,
} from '../../api/adminProfileConfigEndpoints';

const DEFAULT_FILE_ENTRY = {
    file: null,
    preview: null,
    fileName: null,
    fileUrl: null,
    verificationStatus: 'pending',
};

const DEFAULT_EDUCATION_SECTION = {
    degree: '',
    specialization: '',
    state: '',
    university: '',
    institute: '',
    yearOfGraduation: '',
    evaluationCriteria: '',
    obtainedScore: '',
    registrationNumber: '',
    certificate: { ...DEFAULT_FILE_ENTRY },
    marksheet: { ...DEFAULT_FILE_ENTRY },
};

const DEFAULT_OTHER_CERT_SECTION = {
    courseName: '',
    specialization: '',
    state: '',
    university: '',
    institute: '',
    yearOfCourse: '',
    evaluationCriteria: '',
    obtainedScore: '',
    registrationNumber: '',
    certificate: { ...DEFAULT_FILE_ENTRY },
    marksheet: { ...DEFAULT_FILE_ENTRY },
};

const DEFAULT_EDUCATION_STATE = {
    graduation: { ...DEFAULT_EDUCATION_SECTION },
    postGraduation: { ...DEFAULT_EDUCATION_SECTION },
    superSpeciality: { ...DEFAULT_EDUCATION_SECTION },
    otherCertification: { ...DEFAULT_OTHER_CERT_SECTION },
    dropdownOptions: {},
    isSubmitting: false,
};

const useAdminEducationDetails = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [educationState, setEducationState] = useState({ ...DEFAULT_EDUCATION_STATE });

    const {
        data: eduData,
    } = useGetAdminMyEducationQuery(undefined, { skip: previewMode });

    const [updateEducation] = useUpdateAdminMyEducationMutation();

    // Populate state from fetched data
    useEffect(() => {
        if (previewMode || !eduData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            const mapFileEntry = (raw) => ({
                file: null,
                preview: null,
                fileName: raw?.fileName || null,
                fileUrl: raw?.fileUrl || raw?.url || null,
                verificationStatus: raw?.verificationStatus || 'pending',
            });

            const mapSection = (raw, isOther = false) => {
                if (!raw) return isOther ? { ...DEFAULT_OTHER_CERT_SECTION } : { ...DEFAULT_EDUCATION_SECTION };
                const base = {
                    specialization: raw.specialization || '',
                    state: raw.state || '',
                    university: raw.university || '',
                    institute: raw.institute || '',
                    evaluationCriteria: raw.evaluationCriteria || '',
                    obtainedScore: raw.obtainedScore || '',
                    registrationNumber: raw.registrationNumber || '',
                    certificate: raw.certificate ? mapFileEntry(raw.certificate) : { ...DEFAULT_FILE_ENTRY },
                    marksheet: raw.marksheet ? mapFileEntry(raw.marksheet) : { ...DEFAULT_FILE_ENTRY },
                };
                if (isOther) {
                    return {
                        ...base,
                        courseName: raw.courseName || '',
                        yearOfCourse: raw.yearOfCourse || '',
                    };
                }
                return {
                    ...base,
                    degree: raw.degree || '',
                    yearOfGraduation: raw.yearOfGraduation || '',
                };
            };

            setEducationState((prev) => ({
                ...prev,
                graduation: mapSection(eduData.graduation),
                postGraduation: mapSection(eduData.postGraduation),
                superSpeciality: mapSection(eduData.superSpeciality),
                otherCertification: mapSection(eduData.otherCertification, true),
                dropdownOptions: eduData.dropdownOptions || prev.dropdownOptions,
            }));
        } catch (err) {
            console.error('Failed to populate admin education data', err);
        }
    }, [eduData, previewMode]);

    const handleEducationFieldChange = useCallback((section, field, value) => {
        setEducationState((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [field]: value,
            },
        }));
    }, []);

    const handleEducationFileChange = useCallback((section, fileType, file) => {
        if (!file) {
            setEducationState((prev) => ({
                ...prev,
                [section]: {
                    ...prev[section],
                    [fileType]: { ...DEFAULT_FILE_ENTRY },
                },
            }));
            return;
        }
        const preview = URL.createObjectURL(file);
        setEducationState((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [fileType]: {
                    ...prev[section][fileType],
                    file,
                    preview,
                    fileName: file.name,
                },
            },
        }));
    }, []);

    const handleRemoveEducationFile = useCallback((section, fileType) => {
        setEducationState((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [fileType]: { ...DEFAULT_FILE_ENTRY },
            },
        }));
    }, []);

    const handleSaveEducation = useCallback(async () => {
        setEducationState((prev) => ({ ...prev, isSubmitting: true }));
        try {
            const formData = new FormData();
            const { graduation, postGraduation, superSpeciality, otherCertification } = educationState;

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

            await updateEducation(formData).unwrap();
            return { success: true, message: 'Education details submitted for verification!' };
        } catch (err) {
            console.error('Failed to save admin education details', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to submit education details' };
        } finally {
            setEducationState((prev) => ({ ...prev, isSubmitting: false }));
        }
    }, [educationState, updateEducation]);

    return {
        educationState,
        handleEducationFieldChange,
        handleEducationFileChange,
        handleRemoveEducationFile,
        handleSaveEducation,
    };
};

export default useAdminEducationDetails;
