/**
 * Affiliation endpoints — apex-marketplace doctor↔hospital roster.
 *
 * Two audiences share this slice:
 *
 *   * Doctor: generate/revoke an invite code, list their request inbox,
 *     accept or reject hospital requests.
 *   * Hospital/Clinic admin: list facility roster, claim a doctor by
 *     code, withdraw a pending request, direct-create a new doctor
 *     account onto the roster.
 *
 * Backend wraps every payload in ``{ data: ..., success: true }``; the
 * transforms below unwrap so components consume the inner shape.
 */
import { apiSlice } from '../../../../app/api/apiSlice';
import {
    scopeOf as facScopeOf,
    splitScope as facSplit,
    apiScopedUrl as facUrl,
    scopeTag as facTag,
} from '../../api/facilityScope';

const BASE = '/api/v1/affiliation';

const unwrap = (response) => response?.data ?? null;

// The FACILITY-admin roster endpoints are scope-aware: a plain call is the
// clinic/hospital's own; a branch scope (folded by scopedAffiliationApi) routes
// through /api/clinic/branches/<id>/act/... and tags a distinct cache entry so
// a parent never sees a branch's roster. Path is relative to /api.
const rosterUrl = (arg, sub) => facUrl(facScopeOf(arg), `/affiliation/facility${sub}`);
const rosterTag = (arg) => ({ type: 'FacilityRoster', id: facTag(facScopeOf(arg), 'LIST') });

const affiliationEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ─── Doctor ──────────────────────────────────────────────────
        getMyInvite: builder.query({
            query: () => ({ url: `${BASE}/invite`, method: 'GET' }),
            transformResponse: unwrap,
            providesTags: [{ type: 'AffiliationInvite', id: 'ME' }],
        }),
        regenerateMyInvite: builder.mutation({
            query: () => ({
                url: `${BASE}/invite/regenerate`, method: 'POST',
            }),
            transformResponse: unwrap,
            invalidatesTags: [{ type: 'AffiliationInvite', id: 'ME' }],
        }),
        revokeMyInvite: builder.mutation({
            query: () => ({ url: `${BASE}/invite`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'AffiliationInvite', id: 'ME' }],
        }),

        // Doctor's request inbox + history. ``requests`` array.
        listMyAffiliationRequests: builder.query({
            query: () => ({ url: `${BASE}/requests`, method: 'GET' }),
            transformResponse: (response) =>
                response?.data?.requests ?? [],
            providesTags: [{ type: 'AffiliationRequest', id: 'INBOX' }],
        }),
        approveAffiliationRequest: builder.mutation({
            query: (requestId) => ({
                url: `${BASE}/requests/${requestId}/approve`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'AffiliationRequest', id: 'INBOX' }],
        }),
        rejectAffiliationRequest: builder.mutation({
            query: ({ requestId, reason }) => ({
                url: `${BASE}/requests/${requestId}/reject`,
                method: 'POST',
                data: { reason: (reason || '').trim() || undefined },
            }),
            invalidatesTags: [{ type: 'AffiliationRequest', id: 'INBOX' }],
        }),

        // ─── Facility admin (scope-aware — see rosterUrl/rosterTag) ──────
        listFacilityDoctors: builder.query({
            query: (arg) => {
                const [, status] = facSplit(arg);
                return {
                    url: rosterUrl(arg, '/doctors'),
                    method: 'GET',
                    params: status ? { status } : undefined,
                };
            },
            transformResponse: (response) =>
                response?.data?.affiliations ?? [],
            providesTags: (r, e, arg) => [rosterTag(arg)],
        }),
        requestDoctorByCode: builder.mutation({
            query: (arg) => {
                const [, { code, employment_type } = {}] = facSplit(arg);
                return {
                    url: rosterUrl(arg, '/request-by-code'),
                    method: 'POST',
                    data: {
                        code: (code || '').trim(),
                        employment_type: employment_type || 'full_time',
                    },
                };
            },
            invalidatesTags: (r, e, arg) => [rosterTag(arg)],
        }),
        cancelFacilityRequest: builder.mutation({
            query: (arg) => {
                const [, requestId] = facSplit(arg);
                return {
                    url: rosterUrl(arg, `/requests/${requestId}/cancel`),
                    method: 'POST',
                };
            },
            invalidatesTags: (r, e, arg) => [rosterTag(arg)],
        }),
        inviteFacilityDoctor: builder.mutation({
            // FormData multipart upload — minimal identity + files,
            // no password and no OTP. Backend creates the User+Doctor
            // in pending-activation state and dispatches an email +
            // SMS activation link.
            //
            // The Content-Type header MUST be set to ``multipart/form-data``
            // *with no boundary*; axios then re-detects the FormData
            // body and writes the boundary itself. Omitting this
            // header lets the instance-level default (application/json)
            // win, which makes the backend reject the request with
            // "Multipart form data required".
            query: (arg) => {
                // FormData is boxed by withScope (spreading it drops files), so
                // split it back out here.
                const [, formData] = facSplit(arg);
                return {
                    url: rosterUrl(arg, '/doctors/invite'),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (r, e, arg) => [rosterTag(arg)],
        }),

        // ─── Round 9: admin + doctor invite flows ────────────────────
        // Same activation machinery as the facility invite above, but
        // callable by tenant SUPER_ADMIN / PLATFORM_OWNER (doctors +
        // patients) and by a DOCTOR (patients only).
        adminInviteDoctor: builder.mutation({
            // Multipart — see inviteFacilityDoctor for the header rationale.
            query: (formData) => ({
                url: '/api/v1/admin/doctors/invite',
                method: 'POST',
                data: formData,
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
            // Invalidate the admin doctor list + the facility roster so
            // both surfaces refresh when the new doctor row lands.
            invalidatesTags: [
                { type: 'Doctor', id: 'LIST' },
                { type: 'FacilityRoster', id: 'LIST' },
            ],
        }),
        adminInvitePatient: builder.mutation({
            // JSON body — patients have no document uploads at invite time.
            query: (body) => ({
                url: '/api/v1/admin/patients/invite',
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'Patient', id: 'LIST' }],
        }),
        doctorInvitePatient: builder.mutation({
            query: (body) => ({
                url: '/api/v1/doctor/patients/invite',
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [
                { type: 'Patient', id: 'LIST' },
                { type: 'DoctorInvitedPatient', id: 'LIST' },
            ],
        }),
        // Doctor's roster of patients they invited. Used by the My
        // Patients page to render an activation-status table — mirror
        // of the hospital admin's ManageDoctors surface. Tenant-scoped
        // + filtered by Patient.invited_by_user_id == current_user.id
        // on the backend, so a doctor never sees another doctor's
        // invitees.
        listDoctorInvitedPatients: builder.query({
            // Now returns the doctor's full patient roster: invited UNION
            // completed-appointment patients. Accepts search/source/
            // consultation_type/sort/page/per_page params and returns
            // { patients, pagination }.
            query: (params = {}) => {
                const clean = Object.fromEntries(
                    Object.entries(params).filter(
                        ([, v]) => v !== undefined && v !== null && v !== '',
                    ),
                );
                const qs = new URLSearchParams(clean).toString();
                return {
                    url: `/api/v1/doctor/patients${qs ? `?${qs}` : ''}`,
                    method: 'GET',
                };
            },
            transformResponse: (r) => r?.data || { patients: [], pagination: {} },
            providesTags: (result) => [
                { type: 'DoctorInvitedPatient', id: 'LIST' },
                ...((result?.patients || []).map((p) => (
                    { type: 'DoctorInvitedPatient', id: p.patient_id }
                ))),
            ],
        }),
        // Multipart facility invites — Hospital + Clinic admins are
        // verified facility users, so the invite payload includes
        // registration_certificate + admin_aadhaar_attachment uploads
        // alongside the identity fields. Same header trick as the
        // existing facility-doctor invite (Content-Type set to
        // multipart/form-data with no boundary; axios re-detects the
        // FormData body and writes the boundary itself).
        adminInviteHospital: builder.mutation({
            query: (formData) => ({
                url: '/api/v1/admin/hospitals/invite',
                method: 'POST',
                data: formData,
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
            invalidatesTags: [{ type: 'Hospital', id: 'LIST' }],
        }),
        adminInviteClinic: builder.mutation({
            query: (formData) => ({
                url: '/api/v1/admin/clinics/invite',
                method: 'POST',
                data: formData,
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
            invalidatesTags: [{ type: 'Clinic', id: 'LIST' }],
        }),

        // ── Activation flow (used by the public /auth/activate page) ─
        // None of these require auth — the activation token IS the
        // proof of identity.
        activationLookup: builder.mutation({
            query: (token) => ({
                url: `${BASE}/activate/lookup`,
                method: 'POST',
                data: { token },
            }),
            transformResponse: unwrap,
        }),
        activationSetPassword: builder.mutation({
            query: ({ token, password }) => ({
                url: `${BASE}/activate/set-password`,
                method: 'POST',
                data: { token, password },
            }),
        }),
        activationSendEmailOtp: builder.mutation({
            query: (token) => ({
                url: `${BASE}/activate/send-email-otp`,
                method: 'POST',
                data: { token },
            }),
        }),
        activationVerifyEmailOtp: builder.mutation({
            query: ({ token, otp }) => ({
                url: `${BASE}/activate/verify-email-otp`,
                method: 'POST',
                data: { token, otp },
            }),
        }),
        activationSendPhoneOtp: builder.mutation({
            query: (token) => ({
                url: `${BASE}/activate/send-phone-otp`,
                method: 'POST',
                data: { token },
            }),
        }),
        activationVerifyPhoneOtp: builder.mutation({
            query: ({ token, otp }) => ({
                url: `${BASE}/activate/verify-phone-otp`,
                method: 'POST',
                data: { token, otp },
            }),
        }),
    }),
});

export const {
    useGetMyInviteQuery,
    useRegenerateMyInviteMutation,
    useRevokeMyInviteMutation,
    useListMyAffiliationRequestsQuery,
    useApproveAffiliationRequestMutation,
    useRejectAffiliationRequestMutation,
    useListFacilityDoctorsQuery,
    useRequestDoctorByCodeMutation,
    useCancelFacilityRequestMutation,
    useInviteFacilityDoctorMutation,
    useAdminInviteDoctorMutation,
    useAdminInvitePatientMutation,
    useDoctorInvitePatientMutation,
    useListDoctorInvitedPatientsQuery,
    useAdminInviteHospitalMutation,
    useAdminInviteClinicMutation,
    useActivationLookupMutation,
    useActivationSetPasswordMutation,
    useActivationSendEmailOtpMutation,
    useActivationVerifyEmailOtpMutation,
    useActivationSendPhoneOtpMutation,
    useActivationVerifyPhoneOtpMutation,
} = affiliationEndpoints;
