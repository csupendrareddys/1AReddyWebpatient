/**
 * patientSharedUiSlice — Shared UI state across service-receiver sub-features
 * Cross-cutting concerns: snackbar feedback, booking dialog state
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    snackbar: { open: false, message: '', severity: 'success' },
    bookingDialogOpen: false,
    selectedDoctorForBooking: null,
};

const patientSharedUiSlice = createSlice({
    name: 'patientSharedUi',
    initialState,
    reducers: {
        setSnackbar: (state, action) => {
            state.snackbar = action.payload;
        },
        clearSnackbar: (state) => {
            state.snackbar = { open: false, message: '', severity: 'success' };
        },
        openBookingDialog: (state, action) => {
            state.bookingDialogOpen = true;
            state.selectedDoctorForBooking = action.payload;
        },
        closeBookingDialog: (state) => {
            state.bookingDialogOpen = false;
            state.selectedDoctorForBooking = null;
        },
    },
});

export const {
    setSnackbar,
    clearSnackbar,
    openBookingDialog,
    closeBookingDialog,
} = patientSharedUiSlice.actions;

export default patientSharedUiSlice.reducer;
