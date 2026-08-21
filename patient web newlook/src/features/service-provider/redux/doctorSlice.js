import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../../api/axiosConfig';
// Every request below is written ``doctorApiPath('/x')`` rather than
// '/api/doctor/x'. For a doctor on their own pages the two are identical; for
// a super-admin in Operations the helper re-points the call at that doctor's
// act-on-behalf proxy, which is what lets the real doctor profile and
// appointments screens be mounted there instead of admin-only copies.
// See ../api/doctorScope.js for why the scope is ambient here but rides on
// the arg for the RTK-Query endpoints.
import { doctorApiPath } from '../api/doctorScope';

// Helper to parse error messages — check BOTH `message` and `error` keys of
// the backend envelope so validation reasons (e.g. "qualification does not
// meet requirement") surface instead of a generic axios status message.
const parseErrorResponse = (error) => {
    return error.response?.data?.message
        || error.response?.data?.error
        || error.message
        || 'An unknown error occurred';
};

// Async Thunks

// Fetch Doctor Appointments
export const fetchDoctorAppointments = createAsyncThunk(
    'doctor/fetchAppointments',
    async (params = {}, { rejectWithValue }) => {
        try {
            const { page = 1, per_page = 20, status } = params;
            const queryParams = new URLSearchParams();
            queryParams.append('page', page);
            queryParams.append('per_page', per_page);
            if (status) queryParams.append('status', status);

            if (import.meta.env.DEV) console.log('[DOCTOR:APPOINTMENTS] \u2192 request', { page, status });
            const response = await axiosInstance.get(doctorApiPath(`/appointments?${queryParams}`));
            if (import.meta.env.DEV) console.log('[DOCTOR:APPOINTMENTS] \u2190 success', { count: response.data.data?.appointments?.length });
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:APPOINTMENTS] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Fetch Calendar Appointments (for calendar view)
export const fetchCalendarAppointments = createAsyncThunk(
    'doctor/fetchCalendarAppointments',
    async (month, { rejectWithValue }) => {
        try {
            // month format: YYYY-MM
            const response = await axiosInstance.get(doctorApiPath(`/appointments/calendar?month=${month}`));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Accept Appointment
export const acceptAppointment = createAsyncThunk(
    'doctor/acceptAppointment',
    async (appointmentId, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:ACCEPT] \u2192 request', { appointmentId });
            const response = await axiosInstance.post(doctorApiPath(`/appointments/${appointmentId}/accept`));
            if (import.meta.env.DEV) console.log('[DOCTOR:ACCEPT] \u2190 success');
            return { appointmentId, data: response.data.data };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:ACCEPT] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Reject Appointment
export const rejectAppointment = createAsyncThunk(
    'doctor/rejectAppointment',
    async ({ appointmentId, reason }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:REJECT] \u2192 request', { appointmentId });
            const response = await axiosInstance.post(doctorApiPath(`/appointments/${appointmentId}/reject`), { reason });
            if (import.meta.env.DEV) console.log('[DOCTOR:REJECT] \u2190 success');
            return { appointmentId, data: response.data.data };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:REJECT] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Complete Appointment (Optional for now, but good to have)
export const completeAppointment = createAsyncThunk(
    'doctor/completeAppointment',
    async (appointmentId, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(doctorApiPath(`/appointments/${appointmentId}/complete`));
            return { appointmentId, data: response.data.data };
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Create Prescription & Complete Appointment
export const createPrescription = createAsyncThunk(
    'doctor/createPrescription',
    async ({ appointmentId, data }, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:PRESCRIPTION] \u2192 request', { appointmentId, medicines: data?.medicines?.length });
            const response = await axiosInstance.post(doctorApiPath(`/appointments/${appointmentId}/prescription`), data);
            if (import.meta.env.DEV) console.log('[DOCTOR:PRESCRIPTION] \u2190 success');
            return {
                appointmentId,
                ...response.data
            };
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:PRESCRIPTION] \u2717 error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorProfile = createAsyncThunk(
    'doctor/fetchProfile',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profile');
        }
    }
);

export const updateDoctorProfile = createAsyncThunk(
    'doctor/updateProfile',
    async (profileData, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.put(doctorApiPath('/profile'), profileData);
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorSchedule = createAsyncThunk(
    'doctor/fetchSchedule',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/schedule'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch schedule');
        }
    }
);

export const updateDoctorSchedule = createAsyncThunk(
    'doctor/updateSchedule',
    async (scheduleData, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.put(doctorApiPath('/schedule'), scheduleData);
            return {
                schedule: response.data.data,
                message: response.data.message || 'Schedule updated.',
            };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to update schedule');
        }
    }
);

// ── Signatures ──────────────────────────────────────────────────────
export const submitDoctorSignatures = createAsyncThunk(
    'doctor/submitSignatures',
    async (formData, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:SIGNATURES] → request');
            const response = await axiosInstance.post(doctorApiPath('/profile/signatures'), formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (import.meta.env.DEV) console.log('[DOCTOR:SIGNATURES] ← success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:SIGNATURES] ✗ error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorSignatures = createAsyncThunk(
    'doctor/fetchSignatures',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/signatures'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ── About Me ────────────────────────────────────────────────────────
export const submitDoctorAbout = createAsyncThunk(
    'doctor/submitAbout',
    async (formData, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:ABOUT] → request');
            const response = await axiosInstance.post(doctorApiPath('/profile/about'), formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (import.meta.env.DEV) console.log('[DOCTOR:ABOUT] ← success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:ABOUT] ✗ error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorAbout = createAsyncThunk(
    'doctor/fetchAbout',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/about'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ── Education Details ──────────────────────────────────────────────
export const submitDoctorEducation = createAsyncThunk(
    'doctor/submitEducation',
    async (formData, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:EDUCATION] → request');
            const response = await axiosInstance.post(doctorApiPath('/profile/education'), formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (import.meta.env.DEV) console.log('[DOCTOR:EDUCATION] ← success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:EDUCATION] ✗ error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorEducation = createAsyncThunk(
    'doctor/fetchEducation',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/education'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Fetch dropdown options for education (states, universities, institutes, degrees)
export const fetchEducationDropdownOptions = createAsyncThunk(
    'doctor/fetchEducationDropdowns',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/education/dropdowns'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ── Bank Account Details ─────────────────────────────────────────────
export const fetchDoctorBankAccounts = createAsyncThunk(
    'doctor/fetchBankAccounts',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/bank-accounts'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const submitDoctorBankAccounts = createAsyncThunk(
    'doctor/submitBankAccounts',
    async (formData, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(doctorApiPath('/profile/bank-accounts'), formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Doctor confirms they received the ₹1 Cashfree penny drop → account verified.
export const confirmDoctorPennyDrop = createAsyncThunk(
    'doctor/confirmPennyDrop',
    async (accountId, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(doctorApiPath(`/profile/bank-accounts/${accountId}/confirm-penny-drop`));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Doctor pauses payouts to one of their own accounts: detaches the Cashfree
// beneficiary and resets verification. The account stays and can be verified
// again with a fresh ₹1 penny drop. Refused while a payout is in flight.
export const suspendDoctorBankAccount = createAsyncThunk(
    'doctor/suspendBankAccount',
    async (accountId, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(doctorApiPath(`/profile/bank-accounts/${accountId}/suspend`));
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// Doctor removes one of their own accounts (any account, incl. primary).
// Detaches the Cashfree beneficiary and deletes the row; past payouts are
// kept for audit. Refused while a payout is in flight.
export const removeDoctorBankAccount = createAsyncThunk(
    'doctor/removeBankAccountServer',
    async (accountId, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.delete(doctorApiPath(`/profile/bank-accounts/${accountId}`));
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ── Declaration & Documents ──────────────────────────────────────────
export const fetchDoctorDeclarations = createAsyncThunk(
    'doctor/fetchDeclarations',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/declarations'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const submitDoctorDeclarations = createAsyncThunk(
    'doctor/submitDeclarations',
    async (formData, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(doctorApiPath('/profile/declarations'), formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ── Extended Profile (documents, female data, addresses) ────────────
export const updateDoctorExtendedProfile = createAsyncThunk(
    'doctor/updateExtendedProfile',
    async (payload, { rejectWithValue }) => {
        try {
            if (import.meta.env.DEV) console.log('[DOCTOR:EXTENDED_PROFILE] → request');
            // Uses multipart/form-data to support file attachments (Aadhar, PAN, address proofs)
            const response = await axiosInstance.put(doctorApiPath('/profile/extended'), payload, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (import.meta.env.DEV) console.log('[DOCTOR:EXTENDED_PROFILE] ← success');
            return response.data.data;
        } catch (error) {
            if (import.meta.env.DEV) console.error('[DOCTOR:EXTENDED_PROFILE] ✗ error', error.response?.status);
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchDoctorExtendedProfile = createAsyncThunk(
    'doctor/fetchExtendedProfile',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get(doctorApiPath('/profile/extended'));
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

const initialState = {
    appointments: [],
    calendarAppointments: [], // New state for calendar view
    calendarLoading: false,
    currentAppointment: null,
    profile: null,
    schedule: null,
    signatures: null,
    about: null,
    loading: false,
    error: null,
    actionLoading: false,
    actionError: null,
    actionSuccess: null,
};

const doctorSlice = createSlice({
    name: 'doctor',
    initialState,
    reducers: {
        clearDoctorState: (state) => {
            state.profile = null;
            state.appointments = [];
            state.calendarAppointments = [];
            state.error = null;
            state.actionError = null;
            state.actionSuccess = null;
        },
    },
    extraReducers: (builder) => {
        builder
            // Clear state on logout
            .addCase('auth/logout', (state) => {
                state.profile = null;
                state.appointments = [];
                state.calendarAppointments = [];
                state.schedule = null;
                state.signatures = null;
                state.about = null;
                state.error = null;
                state.actionError = null;
                state.actionSuccess = null;
            })
            .addCase('auth/logoutUser/fulfilled', (state) => {
                state.profile = null;
                state.appointments = [];
                state.calendarAppointments = [];
                state.schedule = null;
                state.signatures = null;
                state.about = null;
                state.error = null;
                state.actionError = null;
                state.actionSuccess = null;
            })
            // Fetch Profile
            .addCase(fetchDoctorProfile.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDoctorProfile.fulfilled, (state, action) => {
                state.loading = false;
                state.profile = action.payload;
            })
            .addCase(fetchDoctorProfile.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            // Update Profile
            .addCase(updateDoctorProfile.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(updateDoctorProfile.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.profile = action.payload;
                state.actionSuccess = 'Profile updated successfully';
            })
            .addCase(updateDoctorProfile.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })
            // Fetch Schedule
            .addCase(fetchDoctorSchedule.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDoctorSchedule.fulfilled, (state, action) => {
                state.loading = false;
                state.schedule = action.payload;
            })
            .addCase(fetchDoctorSchedule.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            // Update Schedule
            .addCase(updateDoctorSchedule.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(updateDoctorSchedule.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.schedule = action.payload.schedule;
                state.actionSuccess = action.payload.message || 'Schedule updated successfully';
            })
            .addCase(updateDoctorSchedule.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })

            // Fetch Appointments
            .addCase(fetchDoctorAppointments.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDoctorAppointments.fulfilled, (state, action) => {
                state.loading = false;
                state.appointments = action.payload?.appointments || [];
                state.pagination = action.payload?.pagination || null;
            })
            .addCase(fetchDoctorAppointments.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })

            // Fetch Calendar Appointments
            .addCase(fetchCalendarAppointments.pending, (state) => {
                state.calendarLoading = true;
                state.error = null;
            })
            .addCase(fetchCalendarAppointments.fulfilled, (state, action) => {
                state.calendarLoading = false;
                state.calendarAppointments = action.payload?.appointments || [];
            })
            .addCase(fetchCalendarAppointments.rejected, (state, action) => {
                state.calendarLoading = false;
                state.error = action.payload;
            })

            // Accept Appointment
            .addCase(acceptAppointment.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(acceptAppointment.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.actionSuccess = 'Appointment accepted successfully';
                state.appointments = state.appointments.filter(appt => appt.id !== action.payload.appointmentId);
            })
            .addCase(acceptAppointment.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })

            // Reject Appointment
            .addCase(rejectAppointment.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(rejectAppointment.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.actionSuccess = 'Appointment rejected successfully';
                state.appointments = state.appointments.filter(appt => appt.id !== action.meta.arg.appointmentId);
            })
            .addCase(rejectAppointment.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })
            
            // Create Prescription
            .addCase(createPrescription.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(createPrescription.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.actionSuccess = 'Prescription created and appointment completed';
                state.appointments = state.appointments.filter(appt => appt.id !== action.payload.appointmentId);
            })
            .addCase(createPrescription.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })

            // ── Signatures ──────────────────────────────────────────────
            .addCase(fetchDoctorSignatures.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDoctorSignatures.fulfilled, (state, action) => {
                state.loading = false;
                state.signatures = action.payload;
            })
            .addCase(fetchDoctorSignatures.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(submitDoctorSignatures.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(submitDoctorSignatures.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.signatures = action.payload;
                state.actionSuccess = 'Signatures submitted for admin verification';
            })
            .addCase(submitDoctorSignatures.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })

            // ── About Me ────────────────────────────────────────────────
            .addCase(fetchDoctorAbout.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDoctorAbout.fulfilled, (state, action) => {
                state.loading = false;
                state.about = action.payload;
            })
            .addCase(fetchDoctorAbout.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(submitDoctorAbout.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(submitDoctorAbout.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.about = action.payload;
                state.actionSuccess = 'About information saved successfully';
            })
            .addCase(submitDoctorAbout.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })
            // Education cases
            .addCase(fetchDoctorEducation.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(fetchDoctorEducation.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.education = action.payload;
            })
            .addCase(fetchDoctorEducation.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })
            .addCase(submitDoctorEducation.pending, (state) => {
                state.actionLoading = true;
                state.actionError = null;
            })
            .addCase(submitDoctorEducation.fulfilled, (state, action) => {
                state.actionLoading = false;
                state.education = action.payload;
                state.actionSuccess = 'Education details submitted for verification';
            })
            .addCase(submitDoctorEducation.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            })
            .addCase(fetchEducationDropdownOptions.pending, (state) => {
                state.actionLoading = true;
            })
            .addCase(fetchEducationDropdownOptions.fulfilled, (state, action) => {
                state.actionLoading = false;
                // No need to store separately; handled by education slice
            })
            .addCase(fetchEducationDropdownOptions.rejected, (state, action) => {
                state.actionLoading = false;
                state.actionError = action.payload;
            });
    },
});

export const { clearDoctorErrors, clearDoctorState } = doctorSlice.actions;
export default doctorSlice.reducer;
