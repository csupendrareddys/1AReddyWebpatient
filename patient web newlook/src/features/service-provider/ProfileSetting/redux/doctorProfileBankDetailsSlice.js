import { createSlice } from '@reduxjs/toolkit';

const DEFAULT_FILE_FIELD = {
    file: null,
    fileUrl: null,
    fileName: null,
    preview: null,
    verificationStatus: 'pending', // pending | verified | rejected
};

const DEFAULT_BANK_ACCOUNT = {
    id: null,
    orderIndex: 0,
    bankName: '',
    accountName: '',
    accountNumber: '',
    ifscCode: '',
    branch: '',
    passbook: { ...DEFAULT_FILE_FIELD },
    checkLeaf: { ...DEFAULT_FILE_FIELD },
    bankStatement: { ...DEFAULT_FILE_FIELD },
    verificationStatus: 'pending',
};

const initialState = {
    accounts: [
        { ...DEFAULT_BANK_ACCOUNT, orderIndex: 0 },  // Primary
        { ...DEFAULT_BANK_ACCOUNT, orderIndex: 1 },  // Secondary
    ],
    isSubmitting: false,
    error: null,
};

// Helper to populate an account from backend response
const populateAccount = (backendData) => {
    if (!backendData) return { ...DEFAULT_BANK_ACCOUNT };
    return {
        id: backendData.id || null,
        orderIndex: backendData.orderIndex ?? 0,
        bankName: backendData.bankName || '',
        accountName: backendData.accountName || '',
        accountNumber: backendData.accountNumber || '',
        ifscCode: backendData.ifscCode || '',
        branch: backendData.branch || '',
        passbook: {
            ...DEFAULT_FILE_FIELD,
            fileUrl: backendData.passbook?.fileUrl || null,
            verificationStatus: backendData.passbook?.verificationStatus || 'pending',
        },
        checkLeaf: {
            ...DEFAULT_FILE_FIELD,
            fileUrl: backendData.checkLeaf?.fileUrl || null,
            verificationStatus: backendData.checkLeaf?.verificationStatus || 'pending',
        },
        bankStatement: {
            ...DEFAULT_FILE_FIELD,
            fileUrl: backendData.bankStatement?.fileUrl || null,
            verificationStatus: backendData.bankStatement?.verificationStatus || 'pending',
        },
        verificationStatus: backendData.verificationStatus || 'pending',
        // Cashfree payout beneficiary state. Without these the doctor's
        // "I received ₹1 — Verify account" button can never render, so the
        // account never reaches beneficiary_status='verified' and every payout
        // falls back to a manual settle.
        beneficiaryStatus: backendData.beneficiaryStatus || 'none',
        pennyDropSent: !!backendData.pennyDropSent,
    };
};

const doctorProfileBankDetailsSlice = createSlice({
    name: 'doctorProfileBankDetails',
    initialState,
    reducers: {
        clearBankState: () => initialState,

        // Update a text field in an account
        // payload: { accountIndex: 0, field: 'bankName', value: 'SBI' }
        setBankField: (state, action) => {
            const { accountIndex, field, value } = action.payload;
            if (state.accounts[accountIndex] && !['passbook', 'checkLeaf', 'bankStatement'].includes(field)) {
                state.accounts[accountIndex][field] = value;
            }
        },

        // Set file for a document type
        // payload: { accountIndex: 0, fileType: 'passbook', data: { file, preview, fileName } }
        setBankFile: (state, action) => {
            const { accountIndex, fileType, data } = action.payload;
            if (state.accounts[accountIndex] && state.accounts[accountIndex][fileType]) {
                state.accounts[accountIndex][fileType] = {
                    ...state.accounts[accountIndex][fileType],
                    ...data,
                };
            }
        },

        // Remove file
        // payload: { accountIndex: 0, fileType: 'passbook' }
        removeBankFile: (state, action) => {
            const { accountIndex, fileType } = action.payload;
            if (state.accounts[accountIndex] && state.accounts[accountIndex][fileType]) {
                state.accounts[accountIndex][fileType] = { ...DEFAULT_FILE_FIELD };
            }
        },

        // Add a new additional account
        addBankAccount: (state) => {
            const nextIndex = state.accounts.length;
            state.accounts.push({ ...DEFAULT_BANK_ACCOUNT, orderIndex: nextIndex });
        },

        // Remove an account (only if orderIndex > 1)
        removeBankAccount: (state, action) => {
            const { accountIndex } = action.payload;
            if (accountIndex > 1 && accountIndex < state.accounts.length) {
                state.accounts.splice(accountIndex, 1);
                // Re-index remaining accounts
                state.accounts.forEach((a, i) => { a.orderIndex = i; });
            }
        },

        // Populate from backend response
        populateBankAccountsFromProfile: (state, action) => {
            const accounts = action.payload;
            if (!accounts || !Array.isArray(accounts)) return;

            if (accounts.length === 0) {
                // Keep default primary + secondary
                return;
            }

            state.accounts = accounts.map(a => populateAccount(a));

            // Ensure at least primary + secondary
            if (state.accounts.length < 2) {
                while (state.accounts.length < 2) {
                    state.accounts.push({
                        ...DEFAULT_BANK_ACCOUNT,
                        orderIndex: state.accounts.length,
                    });
                }
            }
        },

        setBankSubmitting: (state, action) => {
            state.isSubmitting = action.payload;
        },
        setBankError: (state, action) => {
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
    clearBankState,
    setBankField,
    setBankFile,
    removeBankFile,
    addBankAccount,
    removeBankAccount,
    populateBankAccountsFromProfile,
    setBankSubmitting,
    setBankError,
} = doctorProfileBankDetailsSlice.actions;

export default doctorProfileBankDetailsSlice.reducer;
