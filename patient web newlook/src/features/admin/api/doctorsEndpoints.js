/**
 * Doctor Endpoints (RTK Query)
 * Replaces: adminService.js listDoctors, updateDoctorStatus,
 *           updateDoctorVerification, getDoctorDocuments
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/admin';

const doctorsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // List all doctors with pagination, search, and filter
        getDoctors: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/doctors`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                doctors: response.data?.doctors || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.doctors.map(({ id }) => ({ type: 'Doctor', id })),
                          { type: 'Doctor', id: 'LIST' },
                      ]
                    : [{ type: 'Doctor', id: 'LIST' }],
        }),

        // Update doctor user status
        updateDoctorStatus: builder.mutation({
            query: ({ doctorId, status }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/status`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, { doctorId }) => [
                { type: 'Doctor', id: doctorId },
                { type: 'Doctor', id: 'LIST' },
            ],
        }),

        // Toggle whether the doctor shows on the public landing booking
        // widget ("popular"). Independent of publish_status.
        updateDoctorLandingPopular: builder.mutation({
            query: ({ doctorId, isPopular }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/landing-popular`,
                method: 'PUT',
                data: { is_popular: isPopular },
            }),
            invalidatesTags: (result, error, { doctorId }) => [
                { type: 'Doctor', id: doctorId },
                { type: 'Doctor', id: 'LIST' },
            ],
        }),

        // Update doctor verification status
        updateDoctorVerification: builder.mutation({
            query: ({ doctorId, verificationStatus }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/verification`,
                method: 'PUT',
                data: { verification_status: verificationStatus },
            }),
            invalidatesTags: (result, error, { doctorId }) => [
                { type: 'Doctor', id: doctorId },
                { type: 'Doctor', id: 'LIST' },
            ],
        }),

        // Get doctor documents
        getDoctorDocuments: builder.query({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/documents`,
                method: 'GET',
            }),
            transformResponse: (response) => response.data,
            providesTags: (result, error, doctorId) => [{ type: 'Doctor', id: `docs-${doctorId}` }],
        }),

        // Approve / reject a doctor's registration or COP certificate.
        verifyDoctorCertificate: builder.mutation({
            query: ({ doctorId, field, status }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/certificate-verification`,
                method: 'PUT',
                data: { field, status },
            }),
            invalidatesTags: (result, error, { doctorId }) => [
                { type: 'Doctor', id: `docs-${doctorId}` },
                { type: 'Doctor', id: doctorId },
                { type: 'Doctor', id: 'LIST' },
            ],
        }),

        // Get doctor bank accounts
        getDoctorBankAccounts: builder.query({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/bank-accounts`,
                method: 'GET',
            }),
            transformResponse: (response) => response.data,
            providesTags: (result, error, doctorId) => [{ type: 'Doctor', id: `bank-${doctorId}` }],
        }),

        // Verify / reject doctor bank account
        verifyDoctorBankAccount: builder.mutation({
            query: ({ doctorId, bankAccountId, action, reason }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/bank-accounts/${bankAccountId}/verify`,
                method: 'PUT',
                data: { action, reason },
            }),
            invalidatesTags: (result, error, { doctorId }) => [
                { type: 'Doctor', id: `bank-${doctorId}` },
                { type: 'Payout', id: 'NEEDS_BANK' },
            ],
        }),

        // Per-appointment payout ledger for a doctor (Payments drill-down).
        getDoctorPayouts: builder.query({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/payouts`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.payouts || [],
            providesTags: (result, error, doctorId) => [{ type: 'Doctor', id: `payouts-${doctorId}` }],
        }),

        // Health-credit usage ledger for a doctor (Credit-usage drill-down).
        getDoctorCreditLedger: builder.query({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/credit-ledger`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || { available: 0, total_spent: 0, ledger: [] },
            providesTags: (result, error, doctorId) => [{ type: 'Doctor', id: `ledger-${doctorId}` }],
        }),

        // FULL field-approval history for a doctor — all statuses, all time
        // (Approvals drill-down "show all"). Tagged with the field-approval
        // list so approve/reject mutations refresh it.
        getDoctorApprovalHistory: builder.query({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/approval-history`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || { requests: [], pending_count: 0, total: 0 },
            providesTags: (result, error, doctorId) => [
                { type: 'Doctor', id: `approvals-${doctorId}` },
                { type: 'FieldApproval', id: 'LIST' },
            ],
        }),

        // ── Approval matrix (auto-approval settings) ────────────────────────
        // Tenant-wide default approval modes + the canonical section/action keys.
        getApprovalPolicy: builder.query({
            query: () => ({ url: `${ADMIN_URL}/approval-policy`, method: 'GET' }),
            transformResponse: (r) => r?.data || {},
            providesTags: [{ type: 'ApprovalPolicy', id: 'GLOBAL' }],
        }),
        updateApprovalPolicy: builder.mutation({
            query: (body) => ({ url: `${ADMIN_URL}/approval-policy`, method: 'PUT', data: body }),
            invalidatesTags: [{ type: 'ApprovalPolicy', id: 'GLOBAL' }],
        }),
        // Aggregate pending/accepted/rejected/query counts by section.
        getApprovalCounts: builder.query({
            query: () => ({ url: `${ADMIN_URL}/approval-policy/counts`, method: 'GET' }),
            transformResponse: (r) => r?.data?.counts || {},
            providesTags: [{ type: 'FieldApproval', id: 'LIST' }],
        }),
        // Per-doctor overrides: effective (resolved) modes + raw overrides + counts.
        getDoctorApprovalModes: builder.query({
            query: (doctorId) => ({ url: `${ADMIN_URL}/doctors/${doctorId}/approval-modes`, method: 'GET' }),
            transformResponse: (r) => r?.data || { effective: {}, override: {}, counts: {} },
            providesTags: (result, error, doctorId) => [{ type: 'ApprovalPolicy', id: `doctor-${doctorId}` }],
        }),
        updateDoctorApprovalModes: builder.mutation({
            query: ({ doctorId, ...body }) => ({
                url: `${ADMIN_URL}/doctors/${doctorId}/approval-modes`, method: 'PUT', data: body,
            }),
            invalidatesTags: (result, error, { doctorId }) => [{ type: 'ApprovalPolicy', id: `doctor-${doctorId}` }],
        }),

        // Held doctor actions (cancel / payout-claim awaiting admin approval).
        getPendingActions: builder.query({
            query: (status = 'pending') => ({ url: `${ADMIN_URL}/pending-actions`, method: 'GET', params: { status } }),
            transformResponse: (r) => r?.data?.actions || [],
            providesTags: [{ type: 'ApprovalPolicy', id: 'ACTIONS' }],
        }),
        approvePendingAction: builder.mutation({
            query: ({ actionId, comment }) => ({ url: `${ADMIN_URL}/pending-actions/${actionId}/approve`, method: 'POST', data: { comment } }),
            invalidatesTags: [{ type: 'ApprovalPolicy', id: 'ACTIONS' }, { type: 'FieldApproval', id: 'LIST' }],
        }),
        rejectPendingAction: builder.mutation({
            query: ({ actionId, comment }) => ({ url: `${ADMIN_URL}/pending-actions/${actionId}/reject`, method: 'POST', data: { comment } }),
            invalidatesTags: [{ type: 'ApprovalPolicy', id: 'ACTIONS' }, { type: 'FieldApproval', id: 'LIST' }],
        }),

        // Doctors who expressed interest in a catalog service / group plan.
        getServiceInterests: builder.query({
            query: () => ({ url: `${ADMIN_URL}/service-interests`, method: 'GET' }),
            transformResponse: (r) => r?.data?.interests || [],
            providesTags: [{ type: 'ServiceInterest', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetDoctorsQuery,
    useUpdateDoctorStatusMutation,
    useUpdateDoctorLandingPopularMutation,
    useUpdateDoctorVerificationMutation,
    useGetDoctorDocumentsQuery,
    useLazyGetDoctorDocumentsQuery,
    useVerifyDoctorCertificateMutation,
    useGetDoctorBankAccountsQuery,
    useLazyGetDoctorBankAccountsQuery,
    useVerifyDoctorBankAccountMutation,
    useGetDoctorPayoutsQuery,
    useGetDoctorCreditLedgerQuery,
    useGetDoctorApprovalHistoryQuery,
    useGetApprovalPolicyQuery,
    useUpdateApprovalPolicyMutation,
    useGetApprovalCountsQuery,
    useGetDoctorApprovalModesQuery,
    useUpdateDoctorApprovalModesMutation,
    useGetPendingActionsQuery,
    useApprovePendingActionMutation,
    useRejectPendingActionMutation,
    useGetServiceInterestsQuery,
} = doctorsEndpoints;
