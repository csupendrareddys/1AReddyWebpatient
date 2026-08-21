/**
 * patientDashboardUiSlice — UI state for the PatientDashboard sub-feature
 * Navigation, search/filters, drawers, dialogs specific to the dashboard
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    // Navigation
    activeNav: 'main',
    mobileMenuOpen: false,

    // Orders section
    orderTab: 0,

    // Doctor search & filters
    searchQuery: '',
    selectedSpecialization: '',
    selectedGender: '',
    selectedLanguage: '',
    filterDrawerOpen: false,

    // Dialogs
    ratingDialogOpen: false,
    documentDialogOpen: false,
    selectedOrderId: null,
};

const patientDashboardUiSlice = createSlice({
    name: 'patientDashboardUi',
    initialState,
    reducers: {
        // Navigation
        setActiveNav: (state, action) => {
            state.activeNav = action.payload;
            state.mobileMenuOpen = false;
        },
        setMobileMenuOpen: (state, action) => {
            state.mobileMenuOpen = action.payload;
        },

        // Orders
        setOrderTab: (state, action) => {
            state.orderTab = action.payload;
        },

        // Search & Filters
        setSearchQuery: (state, action) => {
            state.searchQuery = action.payload;
        },
        setSelectedSpecialization: (state, action) => {
            state.selectedSpecialization = action.payload;
        },
        setSelectedGender: (state, action) => {
            state.selectedGender = action.payload;
        },
        setSelectedLanguage: (state, action) => {
            state.selectedLanguage = action.payload;
        },
        setFilterDrawerOpen: (state, action) => {
            state.filterDrawerOpen = action.payload;
        },

        // Dialogs
        openRatingDialog: (state, action) => {
            state.ratingDialogOpen = true;
            state.selectedOrderId = action.payload;
        },
        closeRatingDialog: (state) => {
            state.ratingDialogOpen = false;
            state.selectedOrderId = null;
        },
        openDocumentDialog: (state, action) => {
            state.documentDialogOpen = true;
            state.selectedOrderId = action.payload;
        },
        closeDocumentDialog: (state) => {
            state.documentDialogOpen = false;
            state.selectedOrderId = null;
        },
    },
});

export const {
    setActiveNav,
    setMobileMenuOpen,
    setOrderTab,
    setSearchQuery,
    setSelectedSpecialization,
    setSelectedGender,
    setSelectedLanguage,
    setFilterDrawerOpen,
    openRatingDialog,
    closeRatingDialog,
    openDocumentDialog,
    closeDocumentDialog,
} = patientDashboardUiSlice.actions;

export default patientDashboardUiSlice.reducer;
