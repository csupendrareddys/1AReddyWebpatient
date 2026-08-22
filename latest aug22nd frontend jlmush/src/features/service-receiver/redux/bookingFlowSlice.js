import { createSlice } from '@reduxjs/toolkit';

/**
 * Booking Flow Steps:
 * 1. Consultation Type selection
 * 2. Filter preferences (doctor filters — no doctor list)
 * 3. Family member selection
 * 4. Symptoms + Medical records (combined page)
 * 5. Doctor match list (doctors matching symptoms + filters)
 */
const initialState = {
    currentStep: 1,

    // Step 1: Consultation type
    selectedConsultationType: null,

    // Step 2: Filter preferences
    filters: {},

    // Step 3: Family member
    bookingFor: 'self',
    selectedMember: null,

    // Step 4: Symptoms + Medical context (combined)
    medicalContextId: null,
    sharedHealthRecords: [],
    sharedVitals: {},
    sharedHabits: [],
    sharedPrescriptions: [],
    additionalVitals: {},
    additionalHabits: [],
    selectedSymptoms: [],
    customSymptoms: [],
    additionalDetails: { description: '', remarks: '' },

    // Step 4 (cont.): Sharing toggles
    sharingToggles: null, // { vitals: {}, habits: {}, records: {}, surgeries: {} }
    sectionVisibility: null, // { vitals: true, habits: true, health_records: true, surgeries: true }

    // Step 5: Doctor match
    selectedDoctorId: null,
    selectedDoctorName: null,
};

const bookingFlowSlice = createSlice({
    name: 'bookingFlow',
    initialState,
    reducers: {
        setConsultationType(state, action) {
            state.selectedConsultationType = action.payload;
            state.currentStep = 2;
        },
        applyFilters(state, action) {
            state.filters = action.payload;
            state.currentStep = 3;
        },
        setFilters(state, action) {
            state.filters = action.payload;
        },
        setBookingFor(state, action) {
            const { bookingFor, member } = action.payload;
            state.bookingFor = bookingFor;
            state.selectedMember = member || null;
            state.currentStep = 4;
        },
        setMedicalContextId(state, action) {
            state.medicalContextId = action.payload;
        },
        setSharedHealthRecords(state, action) {
            state.sharedHealthRecords = action.payload;
        },
        setSharedVitals(state, action) {
            state.sharedVitals = action.payload;
        },
        setSharedHabits(state, action) {
            state.sharedHabits = action.payload;
        },
        setSharedPrescriptions(state, action) {
            state.sharedPrescriptions = action.payload;
        },
        setAdditionalVitals(state, action) {
            state.additionalVitals = action.payload;
        },
        setAdditionalHabits(state, action) {
            state.additionalHabits = action.payload;
        },
        setSelectedSymptoms(state, action) {
            state.selectedSymptoms = action.payload;
        },
        setCustomSymptoms(state, action) {
            state.customSymptoms = action.payload;
        },
        setAdditionalDetails(state, action) {
            state.additionalDetails = action.payload;
        },
        setSharingToggles(state, action) {
            state.sharingToggles = action.payload;
        },
        setSectionVisibility(state, action) {
            state.sectionVisibility = action.payload;
        },
        completeSymptomsAndRecords(state) {
            state.currentStep = 5;
        },
        selectDoctor(state, action) {
            const { doctorId, doctorName } = action.payload;
            state.selectedDoctorId = doctorId;
            state.selectedDoctorName = doctorName;
        },
        goToStep(state, action) {
            state.currentStep = action.payload;
        },
        resetBookingFlow() {
            return initialState;
        },
    },
});

export const {
    setConsultationType,
    applyFilters,
    setFilters,
    setBookingFor,
    setMedicalContextId,
    setSharedHealthRecords,
    setSharedVitals,
    setSharedHabits,
    setSharedPrescriptions,
    setAdditionalVitals,
    setAdditionalHabits,
    setSelectedSymptoms,
    setCustomSymptoms,
    setAdditionalDetails,
    setSharingToggles,
    setSectionVisibility,
    completeSymptomsAndRecords,
    selectDoctor,
    goToStep,
    resetBookingFlow,
} = bookingFlowSlice.actions;

export default bookingFlowSlice.reducer;
