/**
 * Patient support-staff endpoints — base ``/api/v1/patient-staff``.
 *
 * Two audiences:
 *   • the OWNER (a patient) manages caregiver seats (create with a login, list,
 *     rename / reset password, assign roles, suspend, remove);
 *   • the CAREGIVER reads who they support (``/me``) — their landing.
 *
 * Roles themselves are authored via the shared ``/api/v1/patient-family/roles``
 * (see familyEndpoints + the reused ``RoleManager``): a caregiver and a linked
 * adult draw from the same role pool, so there is no separate role namespace.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const BASE = '/api/v1/patient-staff';

const supportStaffEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Owner (patient) manages caregivers ──────────────────────────────
        getPatientStaff: builder.query({
            query: () => ({ url: BASE, method: 'GET' }),
            transformResponse: (r) => r?.data?.staff || [],
            providesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        createPatientStaff: builder.mutation({
            query: (body) => ({ url: BASE, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        updatePatientStaff: builder.mutation({
            query: ({ staffId, ...body }) => ({ url: `${BASE}/${staffId}`, method: 'PUT', data: body }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        setPatientStaffRoles: builder.mutation({
            query: ({ staffId, roleIds, canPayOnBehalf }) => ({
                url: `${BASE}/${staffId}/roles`, method: 'PUT',
                data: {
                    role_ids: roleIds,
                    // Only sent when the caller set it, so the backend leaves the
                    // flag untouched otherwise.
                    ...(canPayOnBehalf === undefined ? {} : { can_pay_on_behalf: canPayOnBehalf }),
                },
            }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        // Grant a caregiver access to a set of the owner's MINORS, each optionally
        // bounded by a role (``role_id`` omitted = the whole minor account).
        // ``minors`` is ``[{ member_id, role_id? }]``.
        setPatientStaffMinors: builder.mutation({
            query: ({ staffId, minors }) => ({
                url: `${BASE}/${staffId}/minors`, method: 'PUT', data: { minors },
            }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        suspendPatientStaff: builder.mutation({
            query: (staffId) => ({ url: `${BASE}/${staffId}/suspend`, method: 'POST' }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        activatePatientStaff: builder.mutation({
            query: (staffId) => ({ url: `${BASE}/${staffId}/activate`, method: 'POST' }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),
        deletePatientStaff: builder.mutation({
            query: (staffId) => ({ url: `${BASE}/${staffId}`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'PatientStaff', id: 'LIST' }],
        }),

        // ── Caregiver: my own profile + who I support (home) ────────────────
        getPatientStaffMe: builder.query({
            query: () => ({ url: `${BASE}/me`, method: 'GET' }),
            transformResponse: (r) => r?.data || { me: null, patients: [] },
            providesTags: [{ type: 'PatientStaffMe', id: 'ME' }],
        }),
        changePatientStaffPassword: builder.mutation({
            query: ({ currentPassword, newPassword }) => ({
                url: `${BASE}/me/password`, method: 'PUT',
                data: { current_password: currentPassword, new_password: newPassword },
            }),
            // A password change alters no field /me returns.
        }),
        // A caregiver edits their own basic profile (name + relation).
        updatePatientStaffMe: builder.mutation({
            query: (body) => ({ url: `${BASE}/me`, method: 'PUT', data: body }),
            invalidatesTags: [{ type: 'PatientStaffMe', id: 'ME' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetPatientStaffQuery,
    useCreatePatientStaffMutation,
    useUpdatePatientStaffMutation,
    useSetPatientStaffRolesMutation,
    useSetPatientStaffMinorsMutation,
    useSuspendPatientStaffMutation,
    useActivatePatientStaffMutation,
    useDeletePatientStaffMutation,
    useGetPatientStaffMeQuery,
    useChangePatientStaffPasswordMutation,
    useUpdatePatientStaffMeMutation,
} = supportStaffEndpoints;

export default supportStaffEndpoints;
