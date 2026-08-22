/**
 * appointmentsUiSlice — UI state for the Appointments sub-feature
 * Tabs, reject dialog, consultation dialog, medicine list
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    // List vs Calendar View
    viewMode: 'list', // 'list' or 'calendar'

    // Tabs
    tabValue: 0,

    // Reject dialog
    rejectDialogOpen: false,
    selectedAppointmentId: null,
    rejectReason: '',

    // Consultation dialog
    consultationOpen: false,
    consultationData: {
        diagnosis: '',
        notes: '',
        medicines: [],
    },
};

const appointmentsUiSlice = createSlice({
    name: 'appointmentsUi',
    initialState,
    reducers: {
        setViewMode: (state, action) => {
            state.viewMode = action.payload;
        },
        // Tabs
        setTabValue: (state, action) => {
            state.tabValue = action.payload;
        },

        // Reject dialog
        openRejectDialog: (state, action) => {
            state.selectedAppointmentId = action.payload;
            state.rejectDialogOpen = true;
            state.rejectReason = '';
        },
        closeRejectDialog: (state) => {
            state.rejectDialogOpen = false;
            state.rejectReason = '';
            state.selectedAppointmentId = null;
        },
        setRejectReason: (state, action) => {
            state.rejectReason = action.payload;
        },

        // Consultation dialog
        openConsultation: (state, action) => {
            state.selectedAppointmentId = action.payload;
            state.consultationData = { diagnosis: '', notes: '', medicines: [] };
            state.consultationOpen = true;
        },
        closeConsultation: (state) => {
            state.consultationOpen = false;
            state.selectedAppointmentId = null;
        },
        setConsultationField: (state, action) => {
            const { name, value } = action.payload;
            state.consultationData[name] = value;
        },

        // Medicines
        addMedicine: (state) => {
            state.consultationData.medicines.push({
                name: '', dosage: '', frequency: '', duration: '',
            });
        },
        updateMedicine: (state, action) => {
            const { index, field, value } = action.payload;
            state.consultationData.medicines[index][field] = value;
        },
        removeMedicine: (state, action) => {
            state.consultationData.medicines.splice(action.payload, 1);
        },
    },
});

export const {
    setViewMode,
    setTabValue,
    openRejectDialog,
    closeRejectDialog,
    setRejectReason,
    openConsultation,
    closeConsultation,
    setConsultationField,
    addMedicine,
    updateMedicine,
    removeMedicine,
} = appointmentsUiSlice.actions;

export default appointmentsUiSlice.reducer;
