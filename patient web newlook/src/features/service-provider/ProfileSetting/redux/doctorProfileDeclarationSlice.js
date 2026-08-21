import { createSlice } from '@reduxjs/toolkit';

const DEFAULT_FILE_FIELD = {
    file: null,
    fileUrl: null,
    fileName: null,
    preview: null,
    verificationStatus: 'pending',
};

const initialState = {
    // Admin-configured questions with doctor's responses merged
    questions: [],
    // Admin-configured document types with doctor's uploads merged
    documentTypes: [],
    // Self-declaration checkboxes
    selfDeclaration: {
        termsAccepted: false,
        policiesAccepted: false,
    },
    isSubmitting: false,
    error: null,
};

const doctorProfileDeclarationSlice = createSlice({
    name: 'doctorProfileDeclaration',
    initialState,
    reducers: {
        clearDeclarationState: () => initialState,

        // Set yes/no answer for a question
        // payload: { configId: 'uuid', answer: true }
        setDeclarationAnswer: (state, action) => {
            const { configId, answer } = action.payload;
            const q = state.questions.find(q => q.configId === configId);
            if (q) q.answer = answer;
        },

        // Set explanation text for a question
        // payload: { configId: 'uuid', explanation: 'text' }
        setDeclarationExplanation: (state, action) => {
            const { configId, explanation } = action.payload;
            const q = state.questions.find(q => q.configId === configId);
            if (q) q.explanation = explanation;
        },

        // Set attachment file for a question
        // payload: { configId: 'uuid', data: { file, preview, fileName } }
        setDeclarationAttachment: (state, action) => {
            const { configId, data } = action.payload;
            const q = state.questions.find(q => q.configId === configId);
            if (q) q.attachment = { ...q.attachment, ...data };
        },

        // Remove attachment for a question
        removeDeclarationAttachment: (state, action) => {
            const { configId } = action.payload;
            const q = state.questions.find(q => q.configId === configId);
            if (q) q.attachment = { ...DEFAULT_FILE_FIELD };
        },

        // Set file for a document type upload
        // payload: { configId: 'uuid', data: { file, preview, fileName } }
        setDocumentFile: (state, action) => {
            const { configId, data } = action.payload;
            const d = state.documentTypes.find(d => d.configId === configId);
            if (d) d.file = { ...d.file, ...data };
        },

        // Remove file for a document type
        removeDocumentFile: (state, action) => {
            const { configId } = action.payload;
            const d = state.documentTypes.find(d => d.configId === configId);
            if (d) d.file = { ...DEFAULT_FILE_FIELD };
        },

        // Toggle self-declaration checkbox
        // payload: { field: 'termsAccepted', value: true }
        setSelfDeclaration: (state, action) => {
            const { field, value } = action.payload;
            if (field in state.selfDeclaration) {
                state.selfDeclaration[field] = value;
            }
        },

        // Populate from backend response
        populateDeclarationsFromProfile: (state, action) => {
            const data = action.payload;
            if (!data) return;

            if (data.questions) {
                state.questions = data.questions.map(q => ({
                    configId: q.id || q.configId,
                    label: q.label || '',
                    description: q.description || '',
                    isRequired: q.isRequired || false,
                    hasExplanation: q.hasExplanation !== false,
                    hasAttachment: q.hasAttachment !== false,
                    answer: q.answer ?? null,
                    explanation: q.explanation || '',
                    attachment: {
                        ...DEFAULT_FILE_FIELD,
                        fileUrl: q.attachmentUrl || null,
                    },
                }));
            }

            if (data.documentTypes) {
                state.documentTypes = data.documentTypes.map(d => ({
                    configId: d.id || d.configId,
                    label: d.label || '',
                    description: d.description || '',
                    isRequired: d.isRequired || false,
                    file: {
                        ...DEFAULT_FILE_FIELD,
                        fileUrl: d.fileUrl || null,
                        verificationStatus: d.verificationStatus || 'pending',
                    },
                }));
            }

            if (data.selfDeclaration) {
                state.selfDeclaration = {
                    termsAccepted: data.selfDeclaration.termsAccepted || false,
                    policiesAccepted: data.selfDeclaration.policiesAccepted || false,
                };
            }
        },

        setDeclarationSubmitting: (state, action) => {
            state.isSubmitting = action.payload;
        },
        setDeclarationError: (state, action) => {
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
    clearDeclarationState,
    setDeclarationAnswer,
    setDeclarationExplanation,
    setDeclarationAttachment,
    removeDeclarationAttachment,
    setDocumentFile,
    removeDocumentFile,
    setSelfDeclaration,
    populateDeclarationsFromProfile,
    setDeclarationSubmitting,
    setDeclarationError,
} = doctorProfileDeclarationSlice.actions;

export default doctorProfileDeclarationSlice.reducer;
