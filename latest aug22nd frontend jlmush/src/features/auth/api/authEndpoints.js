import { apiSlice } from '../../../app/api/apiSlice';

const AUTH_BASE = '/api/v1/auth';

export const authEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Step 1: Request password reset (sends 6-digit OTP via SMS,
        // and email as well if the account has a verified email).
        // ``identifier`` may be either an email or a phone number —
        // the backend route accepts ``{identifier}`` (preferred),
        // ``{email}``, or ``{phone_number}`` and the service hashes
        // whichever was provided to look up the user.
        forgotPassword: builder.mutation({
            query: (identifier) => ({
                url: `${AUTH_BASE}/forgot-password`,
                method: 'POST',
                data: { identifier },
            }),
        }),

        // Step 2: Verify 6-digit OTP → returns full reset token.
        // Same identifier flexibility as /forgot-password.
        verifyResetOtp: builder.mutation({
            query: ({ identifier, otp }) => ({
                url: `${AUTH_BASE}/verify-reset-otp`,
                method: 'POST',
                data: { identifier, otp },
            }),
        }),

        // Step 3: Reset password using token from step 2
        resetPassword: builder.mutation({
            query: ({ token, new_password }) => ({
                url: `${AUTH_BASE}/reset-password`,
                method: 'POST',
                data: { token, new_password },
            }),
        }),

        // --- Phone OTP Login (Combirds SMS) ---

        // Send OTP to phone number for passwordless login. Accepts
        // ``expected_role`` so the backend can fail-fast on
        // wrong-portal attempts (doctor's phone on patient login,
        // etc.) BEFORE a real SMS goes out — saves the wasted-OTP
        // user experience. Backward-compatible: still accepts a bare
        // phone-number string from older callers.
        sendLoginOtp: builder.mutation({
            query: (arg) => {
                const isString = typeof arg === 'string';
                const phone_number = isString ? arg : arg?.phone_number;
                const expected_role = isString ? undefined : arg?.expected_role;
                return {
                    url: `${AUTH_BASE}/send-phone-otp`,
                    method: 'POST',
                    data: {
                        phone_number,
                        ...(expected_role ? { expected_role } : {}),
                    },
                };
            },
        }),

        // Login via phone OTP (passwordless). ``expected_role`` lets the
        // calling page constrain WHO can authenticate through it —
        // patient login passes 'patient', doctor login 'service_provider'
        // or 'doctor', admin login 'admin'. Backend rejects with a
        // clear error if the matched user's role doesn't fit. Without
        // this, a patient could log in through the doctor portal and
        // end up at the wrong dashboard.
        loginViaOtp: builder.mutation({
            query: ({ phone_number, otp, expected_role }) => ({
                url: `${AUTH_BASE}/login-via-otp`,
                method: 'POST',
                data: {
                    phone_number,
                    otp,
                    ...(expected_role ? { expected_role } : {}),
                },
            }),
        }),
    }),
    overrideExisting: false,
});

export const {
    useForgotPasswordMutation,
    useVerifyResetOtpMutation,
    useResetPasswordMutation,
    useSendLoginOtpMutation,
    useLoginViaOtpMutation,
} = authEndpoints;
