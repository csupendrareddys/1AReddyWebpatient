/**
 * doctorSharedUiSlice — Shared UI state across service-provider sub-features
 * Cross-cutting concerns: snackbar, action feedback shared between dashboards
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    snackbar: { open: false, message: '', severity: 'success' },
};

const doctorSharedUiSlice = createSlice({
    name: 'doctorSharedUi',
    initialState,
    reducers: {
        setSnackbar: (state, action) => {
            state.snackbar = action.payload;
        },
        clearSnackbar: (state) => {
            state.snackbar = { open: false, message: '', severity: 'success' };
        },
    },
});

export const { setSnackbar, clearSnackbar } = doctorSharedUiSlice.actions;
export default doctorSharedUiSlice.reducer;
