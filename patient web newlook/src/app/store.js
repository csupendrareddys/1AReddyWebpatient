import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/auth/redux/authSlice';
import themeReducer from '../features/auth/redux/themeSlice';
import patientReducer from '../features/service-receiver/redux/patientSlice';
import { apiSlice } from './api/apiSlice';
// Eager-load feature endpoint injections so RTK Query subscriptions are
// wired before the store's middleware settles. Lazy-loading them via
// route-level imports leaves subscriptions out-of-sync in dev HMR.
import '../features/admin/api/pricingEndpoints';
import '../features/admin/api/publicEndpoints';
import '../features/admin/api/platformLandingEndpoints';
import doctorReducer from '../features/service-provider/redux/doctorSlice';
import doctorProfileUiReducer from '../features/service-provider/ProfileSetting/redux/doctorProfilePersonalDetailsSlice';
import doctorProfileSignaturesReducer from '../features/service-provider/ProfileSetting/redux/doctorProfileSignaturesSlice';
import doctorProfileAboutReducer from '../features/service-provider/ProfileSetting/redux/doctorProfileAboutSlice';
import doctorProfileEducationReducer from '../features/service-provider/ProfileSetting/redux/doctorProfileEducationSlice';
import doctorProfileBankDetailsReducer from '../features/service-provider/ProfileSetting/redux/doctorProfileBankDetailsSlice';
import doctorProfileDeclarationReducer from '../features/service-provider/ProfileSetting/redux/doctorProfileDeclarationSlice';

// ─── Shared UI Slices (feature-root level) ──────────────────────────
import bookingFlowReducer from '../features/service-receiver/redux/bookingFlowSlice';
import patientSharedUiReducer from '../features/service-receiver/redux/patientSharedUiSlice';
import doctorSharedUiReducer from '../features/service-provider/redux/doctorSharedUiSlice';
import adminSharedUiReducer from '../features/admin/redux/adminSharedUiSlice';

// ─── Co-located Sub-feature UI Slices ───────────────────────────────
import patientDashboardUiReducer from '../features/service-receiver/PatientDashboard/redux/patientDashboardUiSlice';
import profileSettingUiReducer from '../features/service-receiver/ProfileSetting/redux/profileSettingUiSlice';
import appointmentsUiReducer from '../features/service-provider/Appointments/redux/appointmentsUiSlice';

export const store = configureStore({
    reducer: {
        // Auth & Theme
        auth: authReducer,
        theme: themeReducer,

        // Server-state slices (legacy thunks)
        patient: patientReducer,
        doctor: doctorReducer,
        doctorProfileUi: doctorProfileUiReducer,
        doctorProfileSignatures: doctorProfileSignaturesReducer,
        doctorProfileAbout: doctorProfileAboutReducer,
        doctorProfileEducation: doctorProfileEducationReducer,
        doctorProfileBankDetails: doctorProfileBankDetailsReducer,
        doctorProfileDeclaration: doctorProfileDeclarationReducer,

        // RTK Query
        [apiSlice.reducerPath]: apiSlice.reducer,

        // Booking flow
        bookingFlow: bookingFlowReducer,

        // Shared UI slices
        patientSharedUi: patientSharedUiReducer,
        doctorSharedUi: doctorSharedUiReducer,
        adminSharedUi: adminSharedUiReducer,

        // Sub-feature UI slices
        patientDashboardUi: patientDashboardUiReducer,
        profileSettingUi: profileSettingUiReducer,
        appointmentsUi: appointmentsUiReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
        }).concat(apiSlice.middleware),
});
