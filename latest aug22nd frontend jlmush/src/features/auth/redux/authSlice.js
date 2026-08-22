import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../../api/axiosConfig';

// Bearer-token storage keys. Mirror the names used by the axios
// request interceptor (axiosConfig.js) so this slice and the
// transport layer stay in sync. localStorage is per-origin, so
// each tenant domain has its own isolated session — that's the
// "different tenants in different tabs" behaviour the platform
// owner asked for, and it's automatic, no per-tenant cookie name
// gymnastics required.
const ACCESS_TOKEN_KEY = 'auth.access_token';
const REFRESH_TOKEN_KEY = 'auth.refresh_token';
const persistTokens = ({ access_token, refresh_token } = {}) => {
    try {
        if (access_token) window.localStorage.setItem(ACCESS_TOKEN_KEY, access_token);
        if (refresh_token) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
    } catch { /* private mode / disabled — fall back to cookies */ }
};
const clearTokens = () => {
    try {
        window.localStorage.removeItem(ACCESS_TOKEN_KEY);
        window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch { /* ignore */ }
};

// Helper to parse error response
const parseErrorResponse = (error) => {
    // Handle network errors (no response from server)
    if (!error.response) {
        return {
            message: error.message || 'Network error. Please check your connection.',
            errors: null,
        };
    }

    const data = error.response?.data;

    // Backend uses 'error' for error_response and 'message' for success_response
    // Also check for 'detail' (common in some frameworks)
    const message = data?.error || data?.message || data?.detail || 'An error occurred. Please try again.';

    return {
        message: message,
        errors: data?.errors || null,
    };
};

// Async thunks
export const login = createAsyncThunk(
    'auth/login',
    async (credentials, { rejectWithValue }) => {
        try {
            // credentials can have: { password, email } OR { password, phone_number } OR { password, aadhar_number }
            const response = await axiosInstance.post('/api/v1/auth/signin', credentials);
            // Persist tokens for cross-site auth (tenant custom
            // domains). Same-site users (platform domain) ALSO get
            // them via cookies — both paths are accepted server-side.
            persistTokens(response.data?.data);
            return response.data.data;
        } catch (error) {
            const responseData = error?.response?.data;

            // Role mismatch — user tried wrong login page
            if (responseData?.code === 'ROLE_MISMATCH') {
                return rejectWithValue({
                    message: responseData.error || 'Please use the correct login page for your account type.',
                    roleMismatch: true,
                });
            }

            // Email not verified — surfaced from the server-side gate.
            // Forms read `emailNotVerified` to render a "verify or use
            // phone instead" hint and to NOT show the generic 401 banner.
            if (responseData?.code === 'EMAIL_NOT_VERIFIED') {
                return rejectWithValue({
                    message: responseData.error || 'Email not verified. Sign in with phone instead.',
                    emailNotVerified: true,
                });
            }

            const parsed = parseErrorResponse(error);
            // Tag session-limit errors so the UI can open the dialog
            const isSessionLimit = parsed.message?.toLowerCase().includes('maximum') &&
                parsed.message?.toLowerCase().includes('session');
            if (isSessionLimit) {
                return rejectWithValue({ ...parsed, sessionLimitHit: true, credentials });
            }
            return rejectWithValue(parsed);
        }
    }
);

export const signup = createAsyncThunk(
    'auth/signup',
    async (userData, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post('/api/v1/auth/signup', userData);
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ─── Post-login email verification (closes the unverified-email hole) ──────
//
// After signin the UI shows a banner if user.email_verified === false.
// User clicks "Verify" → sendEmailVerificationOtp dispatches → user
// receives a 6-digit OTP at the address on file → verifyEmailOtp
// flips the flag server-side and we mirror it locally.

export const sendEmailVerificationOtp = createAsyncThunk(
    'auth/sendEmailVerificationOtp',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post('/api/v1/auth/email/send-verification');
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const verifyEmailOtp = createAsyncThunk(
    'auth/verifyEmailOtp',
    async ({ otp }, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post('/api/v1/auth/email/verify', { otp });
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);


// ─── Pre-Signup OTP Thunks (Combirds SMS) ────────────────────────────────────

// Backwards-compatible: callers may pass either a bare phone string
// (legacy) or { phoneNumber, firstName } (preferred — lets the SMS
// render the personalized DLT body instead of "Hi there.").
export const sendPreSignupPhoneOtp = createAsyncThunk(
    'auth/sendPreSignupPhoneOtp',
    async (arg, { rejectWithValue }) => {
        const { phoneNumber, firstName } =
            typeof arg === 'string' ? { phoneNumber: arg, firstName: undefined } : arg;
        try {
            const payload = { phone_number: phoneNumber };
            if (firstName) payload.first_name = firstName;
            const response = await axiosInstance.post('/api/v1/auth/pre-signup/send-phone-otp', payload);
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const verifyPreSignupPhoneOtp = createAsyncThunk(
    'auth/verifyPreSignupPhoneOtp',
    async ({ phone_number, otp }, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post('/api/v1/auth/pre-signup/verify-phone-otp', {
                phone_number,
                otp,
            });
            return response.data.data; // { token }
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

// ─── Pre-Signup EMAIL OTP (SendClean) ────────────────────────────────────────
//
// Email is optional at signup; these thunks only fire when the user
// supplied an email. The verify endpoint returns a short-lived JWT
// (``email_verification_token``) submitted alongside the phone token
// when /auth/signup is finally called.

export const sendPreSignupEmailOtp = createAsyncThunk(
    'auth/sendPreSignupEmailOtp',
    async (arg, { rejectWithValue }) => {
        // Accept either a bare email string or { email, firstName }.
        const { email, firstName } =
            typeof arg === 'string' ? { email: arg, firstName: undefined } : arg;
        try {
            const payload = { email };
            if (firstName) payload.first_name = firstName;
            const response = await axiosInstance.post(
                '/api/v1/auth/pre-signup/send-email-otp', payload,
            );
            return response.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const verifyPreSignupEmailOtp = createAsyncThunk(
    'auth/verifyPreSignupEmailOtp',
    async ({ email, otp }, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.post(
                '/api/v1/auth/pre-signup/verify-email-otp', { email, otp },
            );
            return response.data.data; // { token }
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const fetchProfile = createAsyncThunk(
    'auth/fetchProfile',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get('/api/v1/auth/me');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const refreshToken = createAsyncThunk(
    'auth/refreshToken',
    async (_, { rejectWithValue }) => {
        try {
            // /auth/refresh accepts either a refresh-cookie OR an
            // ``Authorization: Bearer <refresh_token>`` header. The
            // axios interceptor injects the latter when /auth/refresh
            // is the URL — so this call works cross-site too.
            const response = await axiosInstance.post('/api/v1/auth/refresh');
            // Server returns the rotated tokens in the body for
            // bearer-mode clients; persist the new pair.
            persistTokens(response.data?.data);
            return response.data;
        } catch (error) {
            // Refresh failed — wipe stored tokens so we don't keep
            // sending a stale Bearer on every retry.
            clearTokens();
            return rejectWithValue(parseErrorResponse(error));
        }
    }
);

export const logoutUser = createAsyncThunk(
    'auth/logout',
    async (_, { rejectWithValue }) => {
        try {
            await axiosInstance.post('/api/v1/auth/logout');
            return null;
        } catch (error) {
            return rejectWithValue(parseErrorResponse(error));
        } finally {
            // Clear tokens regardless of whether the API call
            // succeeded — the backend may already have invalidated
            // the session on its side, and we want the local UI to
            // reflect logged-out state immediately.
            clearTokens();
        }
    }
);

const initialState = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isInitialized: false,
    error: null,
    validationErrors: null,  // Field-specific validation errors
    signupSuccess: false,
    signupMessage: '',
    sessionLimitCredentials: null,  // Set when login fails due to max sessions
    preSignup: {
        formData: null,       // All form fields (incl. File objects for doctor signup)
        signupType: null,     // 'patient' | 'doctor' | 'pharmacy' | etc.
        phoneToken: null,     // JWT returned from verify-phone-otp (Combirds SMS)
        emailToken: null,     // JWT returned from verify-email-otp (SendClean) — null when no email entered
        otpStatus: 'idle',    // 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'
        otpError: null,
        redirect: null,       // post-login deep-link carried from a "Book Now" signup
    },
};

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        clearError: (state) => {
            state.error = null;
            state.validationErrors = null;
        },
        clearValidationErrors: (state) => {
            state.validationErrors = null;
        },
        clearSignupSuccess: (state) => {
            state.signupSuccess = false;
            state.signupMessage = '';
        },
        clearSessionLimit: (state) => {
            state.sessionLimitCredentials = null;
        },
        logout: (state) => {
            state.user = null;
            state.isAuthenticated = false;
            state.error = null;
            state.validationErrors = null;
            // Wipe Bearer tokens — same as the logoutUser thunk's
            // finally block. The axios interceptor reads from
            // localStorage on every request; leaving stale tokens
            // would mean the next request silently re-authenticates
            // until the access token expires.
            clearTokens();
        },
        setUserFromOtpLogin: (state, action) => {
            // Every caller of this action adopts a COOKIE-based session
            // (OTP login, first-login OTP, tenant signup) whose response
            // carries no body tokens. Purge any localStorage tokens from a
            // PREVIOUS account: axios prefers the Bearer header over
            // cookies, so a stale token would keep impersonating the old
            // user — signing up a tenant while logged in as the platform
            // owner left every subsequent request running as the owner
            // ("Admin profile not found" on My Access) until a hard
            // refresh dropped the stale header.
            clearTokens();
            state.user = action.payload.user;
            state.isAuthenticated = true;
            state.isLoading = false;
            state.error = null;
        },
        setInitialized: (state) => {
            state.isInitialized = true;
        },
        // Pre-signup flow actions
        storePreSignupData: (state, action) => {
            state.preSignup.formData = action.payload.formData;
            state.preSignup.signupType = action.payload.signupType;
            state.preSignup.redirect = action.payload.redirect || null;
            state.preSignup.phoneToken = null;
            state.preSignup.emailToken = null;
            state.preSignup.otpStatus = 'idle';
            state.preSignup.otpError = null;
        },
        storePhoneToken: (state, action) => {
            state.preSignup.phoneToken = action.payload;
        },
        storeEmailToken: (state, action) => {
            state.preSignup.emailToken = action.payload;
        },
        clearPreSignup: (state) => {
            state.preSignup = {
                formData: null,
                signupType: null,
                phoneToken: null,
                emailToken: null,
                otpStatus: 'idle',
                otpError: null,
                redirect: null,
            };
        },
    },
    extraReducers: (builder) => {
        builder
            // Email verification — mirror the server-side flag flip locally
            // so the banner / verified-badge re-render without a /me round-trip.
            .addCase(verifyEmailOtp.fulfilled, (state) => {
                if (state.user) {
                    state.user = { ...state.user, email_verified: true };
                }
            })
            // Login
            .addCase(login.pending, (state) => {
                state.isLoading = true;
                state.error = null;
                state.validationErrors = null;
            })
            .addCase(login.fulfilled, (state, action) => {
                state.isLoading = false;
                state.isAuthenticated = true;
                state.user = action.payload.user;
                state.error = null;
                state.validationErrors = null;
            })
            .addCase(login.rejected, (state, action) => {
                state.isLoading = false;
                state.isAuthenticated = false;
                state.user = null;
                if (action.payload?.sessionLimitHit) {
                    // Don't show the error in the form — show session dialog instead
                    state.error = null;
                    state.sessionLimitCredentials = action.payload.credentials;
                } else {
                    state.error = action.payload?.message || 'Login failed';
                    state.validationErrors = action.payload?.errors || null;
                    state.sessionLimitCredentials = null;
                }
            })
            // Signup
            .addCase(signup.pending, (state) => {
                state.isLoading = true;
                state.error = null;
                state.validationErrors = null;
                state.signupSuccess = false;
            })
            .addCase(signup.fulfilled, (state, action) => {
                state.isLoading = false;
                state.signupSuccess = true;
                state.signupMessage = 'Registration successful! Please login.';
                state.error = null;
                state.validationErrors = null;
            })
            .addCase(signup.rejected, (state, action) => {
                state.isLoading = false;
                state.signupSuccess = false;
                state.error = action.payload?.message || 'Signup failed';
                state.validationErrors = action.payload?.errors || null;
            })
            // Fetch Profile
            .addCase(fetchProfile.pending, (state) => {
                state.isLoading = true;
            })
            .addCase(fetchProfile.fulfilled, (state, action) => {
                state.isLoading = false;
                state.isAuthenticated = true;
                state.user = action.payload;
                state.isInitialized = true;
            })
            .addCase(fetchProfile.rejected, (state) => {
                state.isLoading = false;
                state.isAuthenticated = false;
                state.user = null;
                state.isInitialized = true;
            })
            // Refresh Token
            .addCase(refreshToken.fulfilled, (state) => {
                // Token refreshed, no state change needed
            })
            .addCase(refreshToken.rejected, (state) => {
                state.isAuthenticated = false;
                state.user = null;
            })
            // Logout
            .addCase(logoutUser.pending, (state) => {
                state.isLoading = true;
            })
            .addCase(logoutUser.fulfilled, (state) => {
                state.user = null;
                state.isAuthenticated = false;
                state.isLoading = false;
                state.isInitialized = false;
                state.error = null;
            })
            .addCase(logoutUser.rejected, (state) => {
                // Clear auth state even if logout API fails
                state.user = null;
                state.isAuthenticated = false;
                state.isLoading = false;
                state.isInitialized = false;
                state.error = null;
            })
            // Pre-signup: send phone OTP (Combirds SMS)
            .addCase(sendPreSignupPhoneOtp.pending, (state) => {
                state.preSignup.otpStatus = 'sending';
                state.preSignup.otpError = null;
            })
            .addCase(sendPreSignupPhoneOtp.fulfilled, (state) => {
                state.preSignup.otpStatus = 'sent';
            })
            .addCase(sendPreSignupPhoneOtp.rejected, (state, action) => {
                state.preSignup.otpStatus = 'error';
                state.preSignup.otpError = action.payload?.message || 'Failed to send OTP';
            })
            // Pre-signup: verify phone OTP
            .addCase(verifyPreSignupPhoneOtp.pending, (state) => {
                state.preSignup.otpStatus = 'verifying';
                state.preSignup.otpError = null;
            })
            .addCase(verifyPreSignupPhoneOtp.fulfilled, (state, action) => {
                state.preSignup.otpStatus = 'verified';
                state.preSignup.phoneToken = action.payload?.token || null;
            })
            .addCase(verifyPreSignupPhoneOtp.rejected, (state, action) => {
                state.preSignup.otpStatus = 'error';
                state.preSignup.otpError = action.payload?.message || 'Invalid OTP';
            })
            // Pre-signup: send email OTP
            .addCase(sendPreSignupEmailOtp.pending, (state) => {
                state.preSignup.otpStatus = 'sending';
                state.preSignup.otpError = null;
            })
            .addCase(sendPreSignupEmailOtp.fulfilled, (state) => {
                state.preSignup.otpStatus = 'sent';
            })
            .addCase(sendPreSignupEmailOtp.rejected, (state, action) => {
                state.preSignup.otpStatus = 'error';
                state.preSignup.otpError = action.payload?.message || 'Failed to send email OTP';
            })
            // Pre-signup: verify email OTP
            .addCase(verifyPreSignupEmailOtp.pending, (state) => {
                state.preSignup.otpStatus = 'verifying';
                state.preSignup.otpError = null;
            })
            .addCase(verifyPreSignupEmailOtp.fulfilled, (state, action) => {
                state.preSignup.otpStatus = 'verified';
                state.preSignup.emailToken = action.payload?.token || null;
            })
            .addCase(verifyPreSignupEmailOtp.rejected, (state, action) => {
                state.preSignup.otpStatus = 'error';
                state.preSignup.otpError = action.payload?.message || 'Invalid OTP';
            });
    },
});

export const {
    clearError, clearValidationErrors, clearSignupSuccess, clearSessionLimit,
    logout, setInitialized, setUserFromOtpLogin,
    storePreSignupData, storePhoneToken, storeEmailToken, clearPreSignup,
} = authSlice.actions;
export default authSlice.reducer;
