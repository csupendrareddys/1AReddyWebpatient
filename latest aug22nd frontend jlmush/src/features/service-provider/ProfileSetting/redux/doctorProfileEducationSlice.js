import { createSlice } from '@reduxjs/toolkit';

const DEFAULT_FILE_FIELD = {
    file: null,
    fileUrl: null,
    fileName: null,
    preview: null,
    verificationStatus: 'pending', // pending | verified | rejected
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
    certificate: { ...DEFAULT_FILE_FIELD },
    marksheet: { ...DEFAULT_FILE_FIELD },
};

const DEFAULT_SUPER_SPECIALITY = {
    degree: '',
    specialization: '',
    state: '',
    university: '',
    institute: '',
    yearOfGraduation: '',
    evaluationCriteria: '',
    obtainedScore: '',
    registrationNumber: '',
    certificate: { ...DEFAULT_FILE_FIELD },
    marksheet: { ...DEFAULT_FILE_FIELD },
};

const DEFAULT_OTHER_CERTIFICATION = {
    courseName: '',
    specialization: '',
    state: '',
    university: '',
    institute: '',
    yearOfCourse: '',
    evaluationCriteria: '',
    obtainedScore: '',
    registrationNumber: '',
    certificate: { ...DEFAULT_FILE_FIELD },
    marksheet: { ...DEFAULT_FILE_FIELD },
};

const initialState = {
    graduation: { ...DEFAULT_EDUCATION_SECTION },
    postGraduation: { ...DEFAULT_EDUCATION_SECTION },
    superSpeciality: { ...DEFAULT_SUPER_SPECIALITY },
    otherCertification: { ...DEFAULT_OTHER_CERTIFICATION },
    // Dropdown options fetched from backend
    dropdownOptions: {
        states: [],
        // ``universities`` / ``institutes`` / ``degrees`` are the UG lists
        // (Graduation + Other-Certification read them). PG and Super-
        // Speciality use their own level-scoped keys so each level shows
        // the options the admin configured for that level.
        universities: [],
        pgUniversities: [],
        superSpecialityUniversities: [],
        institutes: [],
        pgInstitutes: [],
        superSpecialityInstitutes: [],
        degrees: [],
        pgDegrees: [],
        superSpecialityDegrees: [],
        ugSpecializations: [],
        pgSpecializations: [],
        superSpecialitySpecializations: [],
        evaluationCriteria: ['Percentage', 'CGPA', 'Class/Division'],
    },
    isSubmitting: false,
    error: null,
};

// Helper to populate a section from backend data
const populateSection = (backendData, defaultShape) => {
    if (!backendData) return { ...defaultShape };
    return {
        ...defaultShape,
        degree: backendData.degree || backendData.course_name || '',
        courseName: backendData.course_name || backendData.courseName || '',
        specialization: backendData.specialization || '',
        state: backendData.state || '',
        university: backendData.university || '',
        institute: backendData.institute || '',
        yearOfGraduation: backendData.year_of_graduation || backendData.yearOfGraduation || backendData.year_of_course || backendData.yearOfCourse || '',
        yearOfCourse: backendData.year_of_course || backendData.yearOfCourse || '',
        evaluationCriteria: backendData.evaluation_criteria || backendData.evaluationCriteria || '',
        obtainedScore: backendData.obtained_score || backendData.obtainedScore || '',
        registrationNumber: backendData.registration_number || backendData.registrationNumber || '',
        certificate: {
            ...DEFAULT_FILE_FIELD,
            fileUrl: backendData.certificate_url || backendData.certificateUrl || null,
            verificationStatus: backendData.certificate_verification_status || backendData.certificateVerificationStatus || 'pending',
        },
        marksheet: {
            ...DEFAULT_FILE_FIELD,
            fileUrl: backendData.marksheet_url || backendData.marksheetUrl || null,
            verificationStatus: backendData.marksheet_verification_status || backendData.marksheetVerificationStatus || 'pending',
        },
    };
};

const doctorProfileEducationSlice = createSlice({
    name: 'doctorProfileEducation',
    initialState,
    reducers: {
        clearEducationState: () => initialState,

        // Update a text field in a section
        // payload: { section: 'graduation', field: 'degree', value: 'MBBS' }
        setEducationField: (state, action) => {
            const { section, field, value } = action.payload;
            if (state[section] && field !== 'certificate' && field !== 'marksheet') {
                state[section][field] = value;
            }
        },

        // Set file for certificate or marksheet
        // payload: { section: 'graduation', fileType: 'certificate', data: { file, preview, fileName } }
        setEducationFile: (state, action) => {
            const { section, fileType, data } = action.payload;
            if (state[section] && state[section][fileType]) {
                state[section][fileType] = { ...state[section][fileType], ...data };
            }
        },

        // Remove file
        // payload: { section: 'graduation', fileType: 'certificate' }
        removeEducationFile: (state, action) => {
            const { section, fileType } = action.payload;
            if (state[section] && state[section][fileType]) {
                state[section][fileType] = { ...DEFAULT_FILE_FIELD };
            }
        },

        // Set dropdown options from backend
        setEducationDropdownOptions: (state, action) => {
            const data = action.payload;
            if (data.states) state.dropdownOptions.states = data.states;
            if (data.universities) state.dropdownOptions.universities = data.universities;
            if (data.pgUniversities) state.dropdownOptions.pgUniversities = data.pgUniversities;
            if (data.superSpecialityUniversities) state.dropdownOptions.superSpecialityUniversities = data.superSpecialityUniversities;
            if (data.institutes) state.dropdownOptions.institutes = data.institutes;
            if (data.pgInstitutes) state.dropdownOptions.pgInstitutes = data.pgInstitutes;
            if (data.superSpecialityInstitutes) state.dropdownOptions.superSpecialityInstitutes = data.superSpecialityInstitutes;
            if (data.degrees) state.dropdownOptions.degrees = data.degrees;
            if (data.pgDegrees) state.dropdownOptions.pgDegrees = data.pgDegrees;
            if (data.superSpecialityDegrees) state.dropdownOptions.superSpecialityDegrees = data.superSpecialityDegrees;
            if (data.ugSpecializations) state.dropdownOptions.ugSpecializations = data.ugSpecializations;
            if (data.pgSpecializations) state.dropdownOptions.pgSpecializations = data.pgSpecializations;
            if (data.superSpecialitySpecializations) state.dropdownOptions.superSpecialitySpecializations = data.superSpecialitySpecializations;
        },

        // Populate from backend response
        populateEducationFromProfile: (state, action) => {
            const data = action.payload;
            if (!data) return;

            if (data.graduation) {
                state.graduation = populateSection(data.graduation, DEFAULT_EDUCATION_SECTION);
            }
            if (data.postGraduation || data.post_graduation) {
                state.postGraduation = populateSection(
                    data.postGraduation || data.post_graduation,
                    DEFAULT_EDUCATION_SECTION
                );
            }
            if (data.superSpeciality || data.super_speciality) {
                state.superSpeciality = populateSection(
                    data.superSpeciality || data.super_speciality,
                    DEFAULT_SUPER_SPECIALITY
                );
            }
            if (data.otherCertification || data.other_certification) {
                state.otherCertification = populateSection(
                    data.otherCertification || data.other_certification,
                    DEFAULT_OTHER_CERTIFICATION
                );
            }
        },

        setEducationSubmitting: (state, action) => {
            state.isSubmitting = action.payload;
        },
        setEducationError: (state, action) => {
            state.error = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase('auth/logout', () => initialState)
            .addCase('auth/logoutUser/fulfilled', () => initialState);
    },
});

export const {
    clearEducationState,
    setEducationField,
    setEducationFile,
    removeEducationFile,
    setEducationDropdownOptions,
    populateEducationFromProfile,
    setEducationSubmitting,
    setEducationError,
} = doctorProfileEducationSlice.actions;

export default doctorProfileEducationSlice.reducer;
