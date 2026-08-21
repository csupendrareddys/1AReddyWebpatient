/**
 * Doctor self-service contact-change endpoints. The doctor verifies a new
 * phone/email by OTP; the verified value is then submitted to the admin
 * approval queue and only takes effect once an admin approves it.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const URL = '/api/doctor/profile/contact';

const contactChangeEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        sendDoctorContactOtp: builder.mutation({
            query: (body) => ({ url: `${URL}/send-otp`, method: 'POST', data: body }),
        }),
        verifyDoctorContactChange: builder.mutation({
            query: (body) => ({ url: `${URL}/verify`, method: 'POST', data: body }),
        }),
    }),
    overrideExisting: false,
});

export const {
    useSendDoctorContactOtpMutation,
    useVerifyDoctorContactChangeMutation,
} = contactChangeEndpoints;

export default contactChangeEndpoints;
