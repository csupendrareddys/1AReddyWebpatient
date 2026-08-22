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
        }).concat(apiSlice.middleware, renotifyMiddleware),
});

// ─── RTK Query notification safety net ──────────────────────────────
//
// THE "wedge": a query's HTTP request returns 200 and the cache entry in
// this store reaches status:'fulfilled' WITH data — but the component's
// useXxxQuery hook stays at isLoading forever and the page hangs on a
// spinner (or silently renders defaults). Diagnosed live on
// /dashboard/platform/plans: the store held fulfilled data while the
// subscribed component never re-rendered, and ONE later no-op dispatch
// instantly unwedged the page. The store-subscriber notification for the
// fulfilled action is lost — it lands while the lazy route's tree is
// suspended, and React's useSyncExternalStore re-read never happens.
//
// The net: after any RTK Query action settles a request, schedule one
// debounced macrotask dispatch of an inert action. Reducers ignore it, so
// state is untouched — but dispatching re-runs every store subscriber,
// and any component whose earlier notification was swallowed re-reads
// the (already fulfilled) snapshot and renders. Costs one no-op dispatch
// per query burst. This is the root-cause fix for the per-page
// ``usePrimedQuery`` / imperative-refetch workarounds; those remain
// harmless but are no longer load-bearing.
const RENOTIFY = { type: '__renotify/ping' };
function renotifyMiddleware(storeApi) {
    let timer = null;
    return (next) => (action) => {
        const result = next(action);
        const type = typeof action?.type === 'string' ? action.type : '';
        if ((type.startsWith('api/executeQuery/') || type.startsWith('api/executeMutation/'))
            && (type.endsWith('/fulfilled') || type.endsWith('/rejected'))
            && timer === null) {
            timer = setTimeout(() => {
                timer = null;
                storeApi.dispatch(RENOTIFY);
            }, 0);
        }
        return result;
    };
}
