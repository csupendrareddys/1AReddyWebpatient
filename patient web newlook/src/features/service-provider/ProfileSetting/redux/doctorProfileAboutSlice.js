import { createSlice } from '@reduxjs/toolkit';

const DEFAULT_ABOUT_FIELD = {
    text: '',
    attachment: null,      // File object or null
    attachmentUrl: null,   // URL string after upload
    attachmentName: null,  // Original file name
    preview: null,         // Local preview URL (blob)
    verificationStatus: 'pending', // pending | verified | rejected
};

// Admin-curated single pick, not a text+attachment block like the fields above.
const DEFAULT_WORK_QUALIFICATION = {
    id: null,
    name: null,
    verificationStatus: 'pending',
};

// '' means "not stated" and is preserved as such on save — distinct from 0,
// which claims zero years served.
const DEFAULT_EXPERIENCE = {
    ugYears: '',
    pgYears: '',
    superSpecialityYears: '',
    verificationStatus: 'pending',
};

const initialState = {
    briefAbout: { ...DEFAULT_ABOUT_FIELD },
    natureOfWork: { ...DEFAULT_ABOUT_FIELD },
    currentlyWorkingWith: { ...DEFAULT_ABOUT_FIELD },
    workQualification: { ...DEFAULT_WORK_QUALIFICATION },
    // Multi work qualifications: [{ id, name, is_primary }] (first = primary).
    // Supersedes the single ``workQualification`` above; the public booking
    // groups by these.
    workQualifications: [],
    experience: { ...DEFAULT_EXPERIENCE },
    isSubmitting: false,
    error: null,
};

const doctorProfileAboutSlice = createSlice({
    name: 'doctorProfileAbout',
    initialState,
    reducers: {
        clearAboutState: () => initialState,

        // Update text for a field: { field: 'briefAbout', text: '...' }
        setAboutFieldText: (state, action) => {
            const { field, text } = action.payload;
            if (state[field]) {
                state[field].text = text;
            }
        },

        // Set attachment for a field: { field: 'briefAbout', data: { attachment, preview, attachmentName } }
        setAboutFieldAttachment: (state, action) => {
            const { field, data } = action.payload;
            if (state[field]) {
                state[field] = { ...state[field], ...data };
            }
        },

        // Pick / clear the work qualification: { id, name } or null to clear
        setAboutWorkQualification: (state, action) => {
            const val = action.payload;
            state.workQualification = val
                ? { ...state.workQualification, id: val.id || null, name: val.name || null }
                : { ...DEFAULT_WORK_QUALIFICATION };
        },

        // Set the multi work-qualification list: [{ id, name }] (order = priority,
        // first is primary). Replaces the whole list.
        setAboutWorkQualifications: (state, action) => {
            const list = Array.isArray(action.payload) ? action.payload : [];
            state.workQualifications = list.map((w, i) => ({
                id: String(w.id),
                name: w.name || '',
                is_primary: i === 0,
            }));
        },

        // Set one experience level: { field: 'ugYears', value: '3' }
        setAboutExperience: (state, action) => {
            const { field, value } = action.payload;
            if (field in state.experience) state.experience[field] = value;
        },

        // Remove attachment for a field
        removeAboutFieldAttachment: (state, action) => {
            const field = action.payload;
            if (state[field]) {
                state[field].attachment = null;
                state[field].attachmentUrl = null;
                state[field].attachmentName = null;
                state[field].preview = null;
            }
        },

        // Populate from backend response
        populateAboutFromProfile: (state, action) => {
            const data = action.payload;
            if (!data) return;

            if (data.briefAbout !== undefined || data.brief_about !== undefined) {
                const val = data.briefAbout || data.brief_about;
                state.briefAbout = {
                    ...DEFAULT_ABOUT_FIELD,
                    text: (typeof val === 'string' ? val : val?.text) || '',
                    attachmentUrl: val?.attachmentUrl || val?.attachment_url || null,
                    verificationStatus: val?.verificationStatus || val?.verification_status || data.brief_about_verification_status || 'pending',
                };
            }
            if (data.natureOfWork !== undefined || data.nature_of_work !== undefined) {
                const val = data.natureOfWork || data.nature_of_work;
                state.natureOfWork = {
                    ...DEFAULT_ABOUT_FIELD,
                    text: (typeof val === 'string' ? val : val?.text) || '',
                    attachmentUrl: val?.attachmentUrl || val?.attachment_url || null,
                    verificationStatus: val?.verificationStatus || val?.verification_status || data.nature_of_work_verification_status || 'pending',
                };
            }
            if (data.currentlyWorkingWith !== undefined || data.currently_working_with !== undefined) {
                const val = data.currentlyWorkingWith || data.currently_working_with;
                state.currentlyWorkingWith = {
                    ...DEFAULT_ABOUT_FIELD,
                    text: (typeof val === 'string' ? val : val?.text) || '',
                    attachmentUrl: val?.attachmentUrl || val?.attachment_url || null,
                    verificationStatus: val?.verificationStatus || val?.verification_status || data.currently_working_with_verification_status || 'pending',
                };
            }
            // The backend omits this key entirely when nothing is selected, so
            // absence must reset it — otherwise a cleared pick would linger.
            const wq = data.workQualification || data.work_qualification;
            state.workQualification = wq
                ? {
                    id: wq.id ? String(wq.id) : null,
                    name: wq.name || null,
                    verificationStatus: wq.verificationStatus || wq.verification_status || 'pending',
                }
                : { ...DEFAULT_WORK_QUALIFICATION };

            // Multi work qualifications (primary-first from the backend).
            // The API's ``id`` is the link-row PK; the identity used everywhere
            // else — the catalog multi-select's option ids AND the save endpoint's
            // validation — is the *category* id. Prefer ``category_id`` (falling
            // back to ``id`` only for legacy payloads without it). Storing the
            // link-row PK here previously (a) never matched a catalog option, so
            // already-saved picks showed unselected on reload, and (b) was sent
            // back on save where the backend rejected it as an invalid category
            // id ("Invalid work qualification(s)"), so the update never persisted.
            state.workQualifications = Array.isArray(data.work_qualifications)
                ? data.work_qualifications.map((w) => ({
                    id: String(w.category_id || w.id),
                    name: w.name || w.category_name || '',
                    is_primary: !!w.is_primary,
                }))
                : [];

            const exp = data.experience;
            if (exp) {
                // null from the server means "not stated" -> '' in the form.
                // Coerce through != null so a real 0 survives.
                const num = (v) => (v == null ? '' : String(v));
                state.experience = {
                    ugYears: num(exp.ug_years ?? exp.ugYears),
                    pgYears: num(exp.pg_years ?? exp.pgYears),
                    superSpecialityYears: num(exp.super_speciality_years ?? exp.superSpecialityYears),
                    verificationStatus: exp.verification_status || exp.verificationStatus || 'pending',
                };
            }
        },

        setAboutSubmitting: (state, action) => {
            state.isSubmitting = action.payload;
        },
        setAboutError: (state, action) => {
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
    clearAboutState,
    setAboutFieldText,
    setAboutFieldAttachment,
    setAboutWorkQualification,
    setAboutWorkQualifications,
    setAboutExperience,
    removeAboutFieldAttachment,
    populateAboutFromProfile,
    setAboutSubmitting,
    setAboutError,
} = doctorProfileAboutSlice.actions;

export default doctorProfileAboutSlice.reducer;
