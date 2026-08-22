import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../../api/axiosConfig';
import { patientScopedUrl } from '../api/patientScope';

// Helper to parse error response
const parseErrorResponse = (error) => {
    if (!error.response) {
        return {
            message: error.message || 'Network error. Please check your connection.',
        };
    }
    const data = error.response?.data;
    return {
        message: data?.error || data?.message || 'An error occurred.',
    };
};

// --- Async Thunks ---

export const fetchDoctors = createAsyncThunk(
    'patient/fetchDoctors',
    async (params = {}, { rejectWithValue }) => {
        try {
            const { specialization, name, page = 1, per_page = 20 } = params;
            const queryParams = new URLSearchParams();
            if (specialization) queryParams.append('specialization', specialization);
            if (name) queryParams.append('name', name);
            queryParams.append('page', page);
            queryParams.append('per_page', per_page);

            // Updated to use new doctor list endpoint
            if (import.meta.env.DEV) console.log('[PATIENT:DOCTORS] \u2192 request', params);
            const response = await axiosInstance.get(`/api/v1/doctor/list?${queryParams}`);
            if (import.meta.env.DEV) console.log('[PATIENT:DOCTORS] \u2190 success', { count: response.data.data?.doctors?.length });
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:DOCTORS] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorDetail = createAsyncThunk(
    'patient/fetchDoctorDetail',
    async (doctorId, { rejectWithValue }) => {
        try {
            // Updated to use new doctor public endpoint
            if (import.meta.env.DEV) console.log('[PATIENT:DOCTOR_DETAIL] \u2192 request', { doctorId });
            const response = await axiosInstance.get(`/api/v1/doctor/${doctorId}/public`);
            if (import.meta.env.DEV) console.log('[PATIENT:DOCTOR_DETAIL] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:DOCTOR_DETAIL] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchSymptoms = createAsyncThunk(
    'patient/fetchSymptoms',
    async (category = null, { rejectWithValue }) => {
        try {
            const url = category
                ? `/api/v1/patient/symptoms?category=${category}`
                : '/api/v1/patient/symptoms';
            if (import.meta.env.DEV) console.log('[PATIENT:SYMPTOMS] \u2192 request', { category });
            const response = await axiosInstance.get(url);
            if (import.meta.env.DEV) console.log('[PATIENT:SYMPTOMS] \u2190 success', { count: response.data.data?.symptoms?.length });
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:SYMPTOMS] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchPlatforms = createAsyncThunk(
    'patient/fetchPlatforms',
    async (_, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:PLATFORMS] \u2192 request');
            const response = await axiosInstance.get('/api/v1/patient/platforms');
            if (import.meta.env.DEV) console.log('[PATIENT:PLATFORMS] \u2190 success', { count: response.data.data?.platforms?.length });
            return response.data.data.platforms;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:PLATFORMS] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchUpcomingOrders = createAsyncThunk(
    'patient/fetchUpcomingOrders',
    async (params = {}, { rejectWithValue }) => {
        try {
            // Updated to use new appointment endpoint
            if (import.meta.env.DEV) console.log('[PATIENT:ORDERS:UPCOMING] \u2192 request');
            const response = await axiosInstance.get('/api/v1/appointment/patient/upcoming');
            if (import.meta.env.DEV) console.log('[PATIENT:ORDERS:UPCOMING] \u2190 success', { count: response.data.data?.appointments?.length });
            return { 
                orders: response.data.data.appointments,
                pagination: null 
            };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:ORDERS:UPCOMING] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchPreviousOrders = createAsyncThunk(
    'patient/fetchPreviousOrders',
    async (params = {}, { rejectWithValue }) => {
        try {
            const { page = 1, per_page = 20 } = params;
            // Updated to use new appointment history endpoint
            if (import.meta.env.DEV) console.log('[PATIENT:ORDERS:PREVIOUS] \u2192 request', { page });
            const response = await axiosInstance.get(
                `/api/v1/appointment/patient/history?page=${page}&per_page=${per_page}`
            );
            if (import.meta.env.DEV) console.log('[PATIENT:ORDERS:PREVIOUS] \u2190 success', { count: response.data.data?.appointments?.length });
            return {
                orders: response.data.data.appointments,
                pagination: response.data.data.pagination
            };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:ORDERS:PREVIOUS] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// New: Book Appointment
export const bookAppointment = createAsyncThunk(
    'patient/bookAppointment',
    async (appointmentData, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:BOOK] \u2192 request', { doctorId: appointmentData.doctor_id, date: appointmentData.appointment_date });
            // NO trailing slash — backend route is ``/api/v1/appointment``
            // (Flask strict_slashes=True). Posting to ``/api/v1/appointment/``
            // 404s the CORS preflight and breaks the booking flow.
            const response = await axiosInstance.post('/api/v1/appointment', appointmentData);
            if (import.meta.env.DEV) console.log('[PATIENT:BOOK] \u2190 success', { appointmentId: response.data.data?.id });
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:BOOK] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// New: Cancel Appointment
export const cancelAppointment = createAsyncThunk(
    'patient/cancelAppointment',
    async (appointmentId, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:CANCEL] \u2192 request', { appointmentId });
            const response = await axiosInstance.post(`/api/v1/appointment/${appointmentId}/cancel`);
            if (import.meta.env.DEV) console.log('[PATIENT:CANCEL] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:CANCEL] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchOrderDetail = createAsyncThunk(
    'patient/fetchOrderDetail',
    async (orderId, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:ORDER_DETAIL] \u2192 request', { orderId });
            const response = await axiosInstance.get(`/api/v1/patient/orders/${orderId}`);
            if (import.meta.env.DEV) console.log('[PATIENT:ORDER_DETAIL] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:ORDER_DETAIL] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const submitRating = createAsyncThunk(
    'patient/submitRating',
    async ({ orderId, rating, review, is_anonymous = false }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:RATE] \u2192 request', { orderId, rating });
            const response = await axiosInstance.post(`/api/v1/patient/orders/${orderId}/rating`, {
                rating,
                review,
                is_anonymous,
            });
            if (import.meta.env.DEV) console.log('[PATIENT:RATE] \u2190 success');
            return { orderId, rating: response.data.data };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:RATE] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const addDocument = createAsyncThunk(
    'patient/addDocument',
    async ({ orderId, document_name, attachment_link, description, document_type }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:ADD_DOC] \u2192 request', { orderId, name: document_name });
            const response = await axiosInstance.post(`/api/v1/patient/orders/${orderId}/documents`, {
                document_name,
                attachment_link,
                description,
                document_type,
            });
            if (import.meta.env.DEV) console.log('[PATIENT:ADD_DOC] \u2190 success');
            return { orderId, document: response.data.data };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:ADD_DOC] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchPatientProfile = createAsyncThunk(
    'patient/fetchProfile',
    async (_, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:PROFILE] \u2192 request');
            const response = await axiosInstance.get('/api/v1/patient/profile');
            if (import.meta.env.DEV) console.log('[PATIENT:PROFILE] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:PROFILE] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);


export const updateProfile = createAsyncThunk(
    'patient/updateProfile',
    async (data, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:UPDATE_PROFILE] \u2192 request');
            const response = await axiosInstance.put('/api/v1/patient/profile', data);
            if (import.meta.env.DEV) console.log('[PATIENT:UPDATE_PROFILE] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:UPDATE_PROFILE] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchHouseGroup = createAsyncThunk(
    'patient/fetchHouseGroup',
    async (_, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:HOUSE_GROUP] \u2192 request');
            const response = await axiosInstance.get('/api/v1/patient/house-group');
            if (import.meta.env.DEV) console.log('[PATIENT:HOUSE_GROUP] \u2190 success', { count: response.data.data?.members?.length });
            return response.data.data.members;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:HOUSE_GROUP] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const addHouseGroupMember = createAsyncThunk(
    'patient/addHouseGroupMember',
    async (data, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:ADD_MEMBER] \u2192 request', { name: data.first_name });
            const response = await axiosInstance.post('/api/v1/patient/house-group', data);
            if (import.meta.env.DEV) console.log('[PATIENT:ADD_MEMBER] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:ADD_MEMBER] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const updateHouseGroupMember = createAsyncThunk(
    'patient/updateHouseGroupMember',
    async ({ memberId, data }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:UPDATE_MEMBER] \u2192 request', { memberId });
            const response = await axiosInstance.put(`/api/v1/patient/house-group/${memberId}`, data);
            if (import.meta.env.DEV) console.log('[PATIENT:UPDATE_MEMBER] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:UPDATE_MEMBER] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const deleteHouseGroupMember = createAsyncThunk(
    'patient/deleteHouseGroupMember',
    async (memberId, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:DELETE_MEMBER] \u2192 request', { memberId });
            await axiosInstance.delete(`/api/v1/patient/house-group/${memberId}`);
            if (import.meta.env.DEV) console.log('[PATIENT:DELETE_MEMBER] \u2190 success');
            return memberId;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:DELETE_MEMBER] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ``scope`` routes the OTP through the act-on-behalf proxy: a guardian adding a
// phone/email to a MINOR sub-profile (scope ``family:<memberId>``) verifies it
// from THEIR OWN account/session, and the OTP + update land on the minor. No
// scope = the caller's own contact (unchanged).
export const sendOtp = createAsyncThunk(
    'patient/sendOtp',
    async ({ identifier, purpose, scope = null }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:SEND_OTP] \u2192 request', { identifier, purpose, scope });
            const url = scope ? patientScopedUrl(scope, '/send-otp') : '/api/v1/patient/send-otp';
            const response = await axiosInstance.post(url, { identifier, purpose });
            if (import.meta.env.DEV) console.log('[PATIENT:SEND_OTP] \u2190 success');
            return response.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:SEND_OTP] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const verifyAndUpdateContact = createAsyncThunk(
    'patient/verifyAndUpdateContact',
    async ({ identifier, otp, purpose, scope = null }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[PATIENT:VERIFY_OTP] \u2192 request', { identifier, purpose, scope });
            const url = scope ? patientScopedUrl(scope, '/verify-and-update') : '/api/v1/patient/verify-and-update';
            const response = await axiosInstance.post(url, { identifier, otp, purpose });
            if (import.meta.env.DEV) console.log('[PATIENT:VERIFY_OTP] \u2190 success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[PATIENT:VERIFY_OTP] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// --- Initial State ---

const initialState = {
    // Profile
    profile: null,
    profileLoading: false,
    profileError: null,

    // Doctors
    doctors: [],
    doctorsPagination: null,
    doctorsLoading: false,
    doctorsError: null,
    selectedDoctor: null,

    // Symptoms
    symptoms: [],
    symptomCategories: [],
    symptomsLoading: false,
    symptomsError: null,

    // Platforms
    platforms: [],
    platformsLoading: false,
    platformsError: null,

    // Upcoming Orders
    upcomingOrders: [],
    upcomingPagination: null,
    upcomingLoading: false,
    upcomingError: null,

    // Previous Orders
    previousOrders: [],
    previousPagination: null,
    previousLoading: false,
    previousError: null,

    // Selected Order Detail
    selectedOrder: null,
    orderDetailLoading: false,

    // Action states
    ratingSubmitting: false,
    ratingError: null,
    documentUploading: false,
    documentError: null,

    // House Group
    houseGroup: [],
    houseGroupLoading: false,
    houseGroupError: null,
    houseGroupActionLoading: false,

    // Appointment Booking
    bookingLoading: false,
    bookingError: null,
    bookingSuccess: false,
    lastBookedAppointment: null,
};

// --- Slice ---

const patientSlice = createSlice({
    name: 'patient',
    initialState,
    reducers: {
        clearErrors: (state) => {
            state.doctorsError = null;
            state.symptomsError = null;
            state.platformsError = null;
            state.upcomingError = null;
            state.previousError = null;
            state.ratingError = null;
            state.documentError = null;
            state.profileError = null;
            state.houseGroupError = null;
            state.bookingError = null;
        },
        clearBookingState: (state) => {
            state.bookingLoading = false;
            state.bookingError = null;
            state.bookingSuccess = false;
            state.lastBookedAppointment = null;
        },
        clearSelectedDoctor: (state) => {
            state.selectedDoctor = null;
        },
        clearSelectedOrder: (state) => {
            state.selectedOrder = null;
        },
        resetPatientState: () => initialState,
    },
    extraReducers: (builder) => {
        builder
            // Fetch Doctors
            .addCase(fetchDoctors.pending, (state) => {
                state.doctorsLoading = true;
                state.doctorsError = null;
            })
            .addCase(fetchDoctors.fulfilled, (state, action) => {
                state.doctorsLoading = false;
                state.doctors = action.payload.doctors;
                state.doctorsPagination = action.payload.pagination;
            })
            .addCase(fetchDoctors.rejected, (state, action) => {
                state.doctorsLoading = false;
                state.doctorsError = action.payload?.message;
            })

            // Fetch Doctor Detail
            .addCase(fetchDoctorDetail.fulfilled, (state, action) => {
                state.selectedDoctor = action.payload;
            })

            // Fetch Symptoms
            .addCase(fetchSymptoms.pending, (state) => {
                state.symptomsLoading = true;
                state.symptomsError = null;
            })
            .addCase(fetchSymptoms.fulfilled, (state, action) => {
                state.symptomsLoading = false;
                state.symptoms = action.payload.symptoms;
                state.symptomCategories = action.payload.categories || [];
            })
            .addCase(fetchSymptoms.rejected, (state, action) => {
                state.symptomsLoading = false;
                state.symptomsError = action.payload?.message;
            })

            // Fetch Platforms
            .addCase(fetchPlatforms.pending, (state) => {
                state.platformsLoading = true;
                state.platformsError = null;
            })
            .addCase(fetchPlatforms.fulfilled, (state, action) => {
                state.platformsLoading = false;
                state.platforms = action.payload;
            })
            .addCase(fetchPlatforms.rejected, (state, action) => {
                state.platformsLoading = false;
                state.platformsError = action.payload?.message;
            })

            // Fetch Upcoming Orders
            .addCase(fetchUpcomingOrders.pending, (state) => {
                state.upcomingLoading = true;
                state.upcomingError = null;
            })
            .addCase(fetchUpcomingOrders.fulfilled, (state, action) => {
                state.upcomingLoading = false;
                state.upcomingOrders = action.payload.orders;
                state.upcomingPagination = action.payload.pagination;
            })
            .addCase(fetchUpcomingOrders.rejected, (state, action) => {
                state.upcomingLoading = false;
                state.upcomingError = action.payload?.message;
            })

            // Fetch Previous Orders
            .addCase(fetchPreviousOrders.pending, (state) => {
                state.previousLoading = true;
                state.previousError = null;
            })
            .addCase(fetchPreviousOrders.fulfilled, (state, action) => {
                state.previousLoading = false;
                state.previousOrders = action.payload.orders;
                state.previousPagination = action.payload.pagination;
            })
            .addCase(fetchPreviousOrders.rejected, (state, action) => {
                state.previousLoading = false;
                state.previousError = action.payload?.message;
            })

            // Fetch Order Detail
            .addCase(fetchOrderDetail.pending, (state) => {
                state.orderDetailLoading = true;
            })
            .addCase(fetchOrderDetail.fulfilled, (state, action) => {
                state.orderDetailLoading = false;
                state.selectedOrder = action.payload;
            })
            .addCase(fetchOrderDetail.rejected, (state) => {
                state.orderDetailLoading = false;
            })

            // Submit Rating
            .addCase(submitRating.pending, (state) => {
                state.ratingSubmitting = true;
                state.ratingError = null;
            })
            .addCase(submitRating.fulfilled, (state, action) => {
                state.ratingSubmitting = false;
                // Update the rating in the orders list
                const { orderId, rating } = action.payload;
                const updateRating = (orders) => {
                    return orders.map((order) =>
                        order.id === orderId ? { ...order, rating } : order
                    );
                };
                state.upcomingOrders = updateRating(state.upcomingOrders);
                state.previousOrders = updateRating(state.previousOrders);
                if (state.selectedOrder?.id === orderId) {
                    state.selectedOrder = { ...state.selectedOrder, rating };
                }
            })
            .addCase(submitRating.rejected, (state, action) => {
                state.ratingSubmitting = false;
                state.ratingError = action.payload?.message;
            })

            // Add Document
            .addCase(addDocument.pending, (state) => {
                state.documentUploading = true;
                state.documentError = null;
            })
            .addCase(addDocument.fulfilled, (state, action) => {
                state.documentUploading = false;
                // Add document to the order's documents list
                const { orderId, document } = action.payload;
                const updateDocs = (orders) => {
                    return orders.map((order) => {
                        if (order.id === orderId) {
                            return {
                                ...order,
                                documents: [...(order.documents || []), document],
                            };
                        }
                        return order;
                    });
                };
                state.upcomingOrders = updateDocs(state.upcomingOrders);
                state.previousOrders = updateDocs(state.previousOrders);
                if (state.selectedOrder?.id === orderId) {
                    state.selectedOrder = {
                        ...state.selectedOrder,
                        documents: [...(state.selectedOrder.documents || []), document],
                    };
                }
            })
            .addCase(addDocument.rejected, (state, action) => {
                state.documentUploading = false;
                state.documentError = action.payload?.message;
            })

            // Fetch Patient Profile
            .addCase(fetchPatientProfile.pending, (state) => {
                state.profileLoading = true;
                state.profileError = null;
            })
            .addCase(fetchPatientProfile.fulfilled, (state, action) => {
                state.profileLoading = false;
                state.profile = action.payload;
            })
            .addCase(fetchPatientProfile.rejected, (state, action) => {
                state.profileLoading = false;
                state.profileError = action.payload?.message;
            })

            // Update Profile
            .addCase(updateProfile.pending, (state) => {
                state.profileLoading = true;
                state.profileError = null;
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.profileLoading = false;
                state.profile = action.payload;
            })
            .addCase(updateProfile.rejected, (state, action) => {
                state.profileLoading = false;
                state.profileError = action.payload?.message;
            })

            // Fetch House Group
            .addCase(fetchHouseGroup.pending, (state) => {
                state.houseGroupLoading = true;
                state.houseGroupError = null;
            })
            .addCase(fetchHouseGroup.fulfilled, (state, action) => {
                state.houseGroupLoading = false;
                state.houseGroup = action.payload;
            })
            .addCase(fetchHouseGroup.rejected, (state, action) => {
                state.houseGroupLoading = false;
                state.houseGroupError = action.payload?.message;
            })

            // Add House Group Member
            .addCase(addHouseGroupMember.pending, (state) => {
                state.houseGroupActionLoading = true;
                state.houseGroupError = null;
            })
            .addCase(addHouseGroupMember.fulfilled, (state, action) => {
                state.houseGroupActionLoading = false;
                state.houseGroup.push(action.payload);
            })
            .addCase(addHouseGroupMember.rejected, (state, action) => {
                state.houseGroupActionLoading = false;
                state.houseGroupError = action.payload?.message;
            })

            // Update House Group Member
            .addCase(updateHouseGroupMember.pending, (state) => {
                state.houseGroupActionLoading = true;
                state.houseGroupError = null;
            })
            .addCase(updateHouseGroupMember.fulfilled, (state, action) => {
                state.houseGroupActionLoading = false;
                const index = state.houseGroup.findIndex(m => m.id === action.payload.id);
                if (index !== -1) {
                    state.houseGroup[index] = action.payload;
                }
            })
            .addCase(updateHouseGroupMember.rejected, (state, action) => {
                state.houseGroupActionLoading = false;
                state.houseGroupError = action.payload?.message;
            })

            // Delete House Group Member
            .addCase(deleteHouseGroupMember.pending, (state) => {
                state.houseGroupActionLoading = true;
                state.houseGroupError = null;
            })
            .addCase(deleteHouseGroupMember.fulfilled, (state, action) => {
                state.houseGroupActionLoading = false;
                state.houseGroup = state.houseGroup.filter(m => m.id !== action.payload);
            })
            .addCase(deleteHouseGroupMember.rejected, (state, action) => {
                state.houseGroupActionLoading = false;
                state.houseGroupError = action.payload?.message;
            })

            // Book Appointment
            .addCase(bookAppointment.pending, (state) => {
                state.bookingLoading = true;
                state.bookingError = null;
                state.bookingSuccess = false;
            })
            .addCase(bookAppointment.fulfilled, (state, action) => {
                state.bookingLoading = false;
                state.bookingSuccess = true;
                state.lastBookedAppointment = action.payload;
                // Add to upcoming orders
                state.upcomingOrders = [action.payload, ...state.upcomingOrders];
            })
            .addCase(bookAppointment.rejected, (state, action) => {
                state.bookingLoading = false;
                state.bookingError = action.payload?.message;
            })

            // Cancel Appointment
            .addCase(cancelAppointment.pending, (state) => {
                state.bookingLoading = true;
                state.bookingError = null;
            })
            .addCase(cancelAppointment.fulfilled, (state, action) => {
                state.bookingLoading = false;
                // Remove from upcoming, add to previous
                const cancelledId = action.payload.id;
                state.upcomingOrders = state.upcomingOrders.filter(o => o.id !== cancelledId);
                state.previousOrders = [action.payload, ...state.previousOrders];
            })
            .addCase(cancelAppointment.rejected, (state, action) => {
                state.bookingLoading = false;
                state.bookingError = action.payload?.message;
            });
    },
});

export const { clearErrors, clearBookingState, clearSelectedDoctor, clearSelectedOrder, resetPatientState } = patientSlice.actions;
export default patientSlice.reducer;
