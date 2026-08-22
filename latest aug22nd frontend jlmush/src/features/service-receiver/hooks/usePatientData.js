import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    fetchDoctors,
    fetchSymptoms,
    fetchPlatforms,
    fetchUpcomingOrders,
    fetchPreviousOrders,
    fetchOrderDetail,
    submitRating,
    addDocument,
    fetchPatientProfile,
    bookAppointment,
    cancelAppointment,
    clearErrors,
    clearBookingState,
} from '../redux/patientSlice';

/**
 * Custom hook to manage patient data fetching and state
 */
export const usePatientData = () => {
    const dispatch = useDispatch();
    const patientState = useSelector((state) => state.patient);

    // Fetch all initial data for dashboard
    const fetchDashboardData = useCallback(() => {
        dispatch(fetchPlatforms());
        dispatch(fetchUpcomingOrders());
        dispatch(fetchPreviousOrders());
    }, [dispatch]);

    // Fetch doctors with optional filters
    const loadDoctors = useCallback((params = {}) => {
        dispatch(fetchDoctors(params));
    }, [dispatch]);

    // Fetch symptoms with optional category filter
    const loadSymptoms = useCallback((category = null) => {
        dispatch(fetchSymptoms(category));
    }, [dispatch]);

    // Fetch platforms
    const loadPlatforms = useCallback(() => {
        dispatch(fetchPlatforms());
    }, [dispatch]);

    // Fetch upcoming orders with pagination
    const loadUpcomingOrders = useCallback((params = {}) => {
        dispatch(fetchUpcomingOrders(params));
    }, [dispatch]);

    // Fetch previous orders with pagination
    const loadPreviousOrders = useCallback((params = {}) => {
        dispatch(fetchPreviousOrders(params));
    }, [dispatch]);

    // Fetch single order detail
    const loadOrderDetail = useCallback((orderId) => {
        dispatch(fetchOrderDetail(orderId));
    }, [dispatch]);

    // Submit rating for an order
    const rateOrder = useCallback((orderId, rating, review = '', isAnonymous = false) => {
        return dispatch(submitRating({
            orderId,
            rating,
            review,
            is_anonymous: isAnonymous
        })).unwrap();
    }, [dispatch]);

    // Add document to an order
    const uploadDocument = useCallback((orderId, documentData) => {
        return dispatch(addDocument({ orderId, ...documentData })).unwrap();
    }, [dispatch]);

    // Load patient profile
    const loadProfile = useCallback(() => {
        dispatch(fetchPatientProfile());
    }, [dispatch]);

    // Clear all errors
    const clearAllErrors = useCallback(() => {
        dispatch(clearErrors());
    }, [dispatch]);

    return {
        // State
        ...patientState,

        // Actions
        fetchDashboardData,
        loadDoctors,
        loadSymptoms,
        loadPlatforms,
        loadUpcomingOrders,
        loadPreviousOrders,
        loadOrderDetail,
        rateOrder,
        uploadDocument,
        loadProfile,
        clearAllErrors,
    };
};

export default usePatientData;
