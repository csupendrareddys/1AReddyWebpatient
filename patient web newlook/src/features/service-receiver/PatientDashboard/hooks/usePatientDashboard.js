/**
 * usePatientDashboard — Custom hook for the PatientDashboard page
 * Combines RTK Query for server data + UI slices for local state
 */
import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';
import {
    useGetDoctorsListQuery,
    useGetSymptomsQuery,
    useGetPlatformsQuery,
    useGetUpcomingOrdersQuery,
    useGetPreviousOrdersQuery,
    useSubmitRatingMutation,
    useAddOrderDocumentMutation,
} from '../../api/patientEndpoints';

// Dashboard UI slice actions
import {
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
} from '../redux/patientDashboardUiSlice';

// Shared UI slice actions
import {
    openBookingDialog,
    closeBookingDialog,
} from '../../redux/patientSharedUiSlice';

const usePatientDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Auth & theme from existing slices
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    // Dashboard UI state
    const dashboardUi = useSelector((state) => state.patientDashboardUi);
    const {
        activeNav,
        mobileMenuOpen,
        orderTab,
        searchQuery,
        selectedSpecialization,
        selectedGender,
        selectedLanguage,
        filterDrawerOpen,
        ratingDialogOpen,
        documentDialogOpen,
        selectedOrderId,
    } = dashboardUi;

    // Sync URL ?view= param → activeNav state
    useEffect(() => {
        const view = searchParams.get('view');
        const navKey = view || 'main';
        if (navKey !== activeNav) {
            dispatch(setActiveNav(navKey));
        }
    }, [searchParams, dispatch]); // intentionally omit activeNav to avoid loops

    // Shared UI state
    const { bookingDialogOpen, selectedDoctorForBooking } = useSelector(
        (state) => state.patientSharedUi
    );

    // ─── RTK Query hooks ───────────────────────────
    const {
        data: doctorsData,
        isLoading: doctorsLoading,
        refetch: refetchDoctors,
    } = useGetDoctorsListQuery({
        name: searchQuery || undefined,
        specialization: selectedSpecialization || undefined,
    });

    const { data: symptomsData } = useGetSymptomsQuery();
    const { data: platformsData, isLoading: platformsLoading } = useGetPlatformsQuery();

    const {
        data: upcomingOrdersData,
        isLoading: upcomingLoading,
        error: upcomingError,
        refetch: refetchUpcoming,
    } = useGetUpcomingOrdersQuery();

    const {
        data: previousOrdersData,
        isLoading: previousLoading,
        error: previousError,
        refetch: refetchPrevious,
    } = useGetPreviousOrdersQuery();

    const [rateOrderMutation, { isLoading: ratingSubmitting, error: ratingError }] =
        useSubmitRatingMutation();
    const [uploadDocumentMutation, { isLoading: documentUploading, error: documentError }] =
        useAddOrderDocumentMutation();

    // ─── Derived data ──────────────────────────────
    const doctors = doctorsData?.doctors || [];
    const doctorsPagination = doctorsData?.pagination || null;
    const symptoms = symptomsData?.symptoms || [];
    const symptomCategories = [...new Set(symptoms.map((s) => s.category).filter(Boolean))];
    const platforms = platformsData?.platforms || [];
    const upcomingOrders = upcomingOrdersData?.orders || [];
    const previousOrders = previousOrdersData?.orders || [];

    // ─── Handlers ──────────────────────────────────
    const handleLogout = useCallback(async () => {
        try {
            await dispatch(logoutUser()).unwrap();
        } catch (error) {
            console.log('Logout API failed, but clearing local state');
        }
        navigate('/auth/service-receiver/login');
    }, [dispatch, navigate]);

    const handleToggleTheme = useCallback(() => {
        dispatch(toggleTheme());
    }, [dispatch]);

    const handleNavChange = useCallback(
        (navKey) => {
            dispatch(setActiveNav(navKey));
        },
        [dispatch]
    );

    const handleSearchDoctors = useCallback(() => {
        refetchDoctors();
    }, [refetchDoctors]);

    const handleBookDoctor = useCallback(
        (doctor) => {
            dispatch(openBookingDialog(doctor));
        },
        [dispatch]
    );

    const handleCloseBookingDialog = useCallback(() => {
        dispatch(closeBookingDialog());
    }, [dispatch]);

    const handleRateClick = useCallback(
        (orderId) => {
            dispatch(openRatingDialog(orderId));
        },
        [dispatch]
    );

    const handleAddDocumentClick = useCallback(
        (orderId) => {
            dispatch(openDocumentDialog(orderId));
        },
        [dispatch]
    );

    const handleRatingSubmit = useCallback(
        async (rating, review, isAnonymous) => {
            try {
                await rateOrderMutation({
                    orderId: selectedOrderId,
                    rating,
                    review,
                    isAnonymous,
                }).unwrap();
                dispatch(closeRatingDialog());
            } catch (error) {
                // Error handled by RTK Query
            }
        },
        [rateOrderMutation, selectedOrderId, dispatch]
    );

    const handleDocumentSubmit = useCallback(
        async (documentData) => {
            try {
                await uploadDocumentMutation({
                    orderId: selectedOrderId,
                    ...documentData,
                }).unwrap();
                dispatch(closeDocumentDialog());
            } catch (error) {
                // Error handled by RTK Query
            }
        },
        [uploadDocumentMutation, selectedOrderId, dispatch]
    );

    const handleRefreshOrders = useCallback(() => {
        if (orderTab === 0) refetchUpcoming();
        else refetchPrevious();
    }, [orderTab, refetchUpcoming, refetchPrevious]);

    return {
        // Auth & theme
        user,
        isDarkMode,
        handleLogout,
        handleToggleTheme,
        navigate,

        // Navigation
        activeNav,
        mobileMenuOpen,
        handleNavChange,
        setMobileMenuOpen: (open) => dispatch(setMobileMenuOpen(open)),

        // Doctor data
        doctors,
        doctorsLoading,
        doctorsPagination,

        // Symptoms
        symptoms,
        symptomCategories,

        // Platforms
        platforms,
        platformsLoading,

        // Orders
        orderTab,
        setOrderTab: (tab) => dispatch(setOrderTab(tab)),
        upcomingOrders,
        upcomingLoading,
        upcomingError,
        previousOrders,
        previousLoading,
        previousError,
        handleRefreshOrders,

        // Search & Filters
        searchQuery,
        setSearchQuery: (q) => dispatch(setSearchQuery(q)),
        selectedSpecialization,
        setSelectedSpecialization: (v) => dispatch(setSelectedSpecialization(v)),
        selectedGender,
        setSelectedGender: (v) => dispatch(setSelectedGender(v)),
        selectedLanguage,
        setSelectedLanguage: (v) => dispatch(setSelectedLanguage(v)),
        filterDrawerOpen,
        setFilterDrawerOpen: (open) => dispatch(setFilterDrawerOpen(open)),
        handleSearchDoctors,

        // Booking dialog (shared)
        bookingDialogOpen,
        selectedDoctorForBooking,
        handleBookDoctor,
        handleCloseBookingDialog,

        // Rating dialog
        ratingDialogOpen,
        ratingSubmitting,
        ratingError,
        handleRateClick,
        handleRatingSubmit,
        closeRatingDialog: () => dispatch(closeRatingDialog()),

        // Document dialog
        documentDialogOpen,
        documentUploading,
        documentError,
        handleAddDocumentClick,
        handleDocumentSubmit,
        closeDocumentDialog: () => dispatch(closeDocumentDialog()),
    };
};

export default usePatientDashboard;
