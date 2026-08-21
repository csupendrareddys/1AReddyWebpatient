import { createSlice } from '@reduxjs/toolkit';

const DEFAULT_SIGNATURE = {
    file: null,       // File object or null
    fileUrl: null,    // URL string after upload
    fileName: null,   // Original file name
    preview: null,    // Local preview URL (blob)
    verificationStatus: 'pending', // pending | verified | rejected
};

const initialState = {
    signature1: { ...DEFAULT_SIGNATURE },
    signature2: { ...DEFAULT_SIGNATURE },
    digitalSignature: { ...DEFAULT_SIGNATURE },
    isSubmitting: false,
    error: null,
};

const doctorProfileSignaturesSlice = createSlice({
    name: 'doctorProfileSignatures',
    initialState,
    reducers: {
        clearSignaturesState: () => initialState,

        // Set a single signature field: { key: 'signature1', data: { file, preview, fileName } }
        setSignatureFile: (state, action) => {
            const { key, data } = action.payload;
            if (state[key]) {
                state[key] = { ...state[key], ...data };
            }
        },

        // Remove a signature file
        removeSignatureFile: (state, action) => {
            const key = action.payload;
            if (state[key]) {
                state[key] = { ...DEFAULT_SIGNATURE };
            }
        },

        // Populate from backend response
        populateSignaturesFromProfile: (state, action) => {
            const data = action.payload;
            if (!data) return;

            if (data.signature1) {
                state.signature1 = {
                    ...DEFAULT_SIGNATURE,
                    fileUrl: data.signature1.fileUrl || data.signature1 || null,
                    verificationStatus: data.signature1.verificationStatus || data.signature1_verification_status || 'pending',
                };
            }
            if (data.signature2) {
                state.signature2 = {
                    ...DEFAULT_SIGNATURE,
                    fileUrl: data.signature2.fileUrl || data.signature2 || null,
                    verificationStatus: data.signature2.verificationStatus || data.signature2_verification_status || 'pending',
                };
            }
            if (data.digitalSignature || data.digital_signature) {
                const ds = data.digitalSignature || data.digital_signature;
                state.digitalSignature = {
                    ...DEFAULT_SIGNATURE,
                    fileUrl: ds.fileUrl || ds || null,
                    verificationStatus: ds.verificationStatus || data.digital_signature_verification_status || 'pending',
                };
            }
        },

        setSignaturesSubmitting: (state, action) => {
            state.isSubmitting = action.payload;
        },
        setSignaturesError: (state, action) => {
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
    clearSignaturesState,
    setSignatureFile,
    removeSignatureFile,
    populateSignaturesFromProfile,
    setSignaturesSubmitting,
    setSignaturesError,
} = doctorProfileSignaturesSlice.actions;

export default doctorProfileSignaturesSlice.reducer;
