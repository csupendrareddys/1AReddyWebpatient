/**
 * adminSharedUiSlice — Shared UI state across admin sub-features
 * Cross-cutting concerns: snackbar, confirmation dialogs
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    snackbar: { open: false, message: '', severity: 'success' },
    confirmDialog: { open: false, title: '', message: '', onConfirm: null },
};

const adminSharedUiSlice = createSlice({
    name: 'adminSharedUi',
    initialState,
    reducers: {
        setSnackbar: (state, action) => {
            state.snackbar = action.payload;
        },
        clearSnackbar: (state) => {
            state.snackbar = { open: false, message: '', severity: 'success' };
        },
        openConfirmDialog: (state, action) => {
            state.confirmDialog = { open: true, ...action.payload };
        },
        closeConfirmDialog: (state) => {
            state.confirmDialog = { ...state.confirmDialog, open: false };
        },
    },
});

export const {
    setSnackbar,
    clearSnackbar,
    openConfirmDialog,
    closeConfirmDialog,
} = adminSharedUiSlice.actions;

export default adminSharedUiSlice.reducer;
