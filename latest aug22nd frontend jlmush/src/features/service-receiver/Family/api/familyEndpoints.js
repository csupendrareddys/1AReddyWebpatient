/**
 * Patient Family endpoints — minor sub-profiles (P1) + reciprocal roles (P2).
 *
 * Minors are login-less patients the guardian creates and switches into. Roles
 * scope what a LINKED ADULT family member may do on the owner's behalf. The
 * "act as" scope itself rides on the shared scoped hooks (api/patientScope.js)
 * and needs no endpoint here.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const MIN = '/api/v1/patient/family';   // minor sub-profiles (on the patient blueprint)
const PF = '/api/v1/patient-family';    // roles + scopes (patient-family blueprint)

const familyEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Minors (P1) ──────────────────────────────────────────────
        getMinors: builder.query({
            query: () => ({ url: `${MIN}/minors`, method: 'GET' }),
            transformResponse: (r) => r?.data?.minors || [],
            providesTags: [{ type: 'FamilyMinor', id: 'LIST' }],
        }),
        createMinor: builder.mutation({
            query: (body) => ({ url: `${MIN}/minors`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'FamilyMinor', id: 'LIST' }, { type: 'FamilyScope', id: 'LIST' }],
        }),

        // ── Scopes: whom can I switch into (minors + role-granted adults) ──
        getFamilyScopes: builder.query({
            query: () => ({ url: `${PF}/scopes`, method: 'GET' }),
            transformResponse: (r) => r?.data || { minors: [], linked: [], granted: [] },
            providesTags: [{ type: 'FamilyScope', id: 'LIST' }],
        }),

        // ── Roles (P2) ───────────────────────────────────────────────
        getFamilyModules: builder.query({
            query: () => ({ url: `${PF}/modules`, method: 'GET' }),
            transformResponse: (r) => r?.data?.modules || [],
        }),
        getFamilyRoles: builder.query({
            query: () => ({ url: `${PF}/roles`, method: 'GET' }),
            transformResponse: (r) => r?.data?.roles || [],
            providesTags: [{ type: 'FamilyRole', id: 'LIST' }],
        }),
        getFamilyRole: builder.query({
            query: (id) => ({ url: `${PF}/roles/${id}`, method: 'GET' }),
            transformResponse: (r) => r?.data || null,
            providesTags: (res, err, id) => [{ type: 'FamilyRole', id }],
        }),
        createFamilyRole: builder.mutation({
            query: (body) => ({ url: `${PF}/roles`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'FamilyRole', id: 'LIST' }],
        }),
        setFamilyRoleMatrix: builder.mutation({
            query: ({ id, permissions }) => ({
                url: `${PF}/roles/${id}/matrix`, method: 'PUT', data: { permissions },
            }),
            invalidatesTags: (res, err, { id }) => [{ type: 'FamilyRole', id }, { type: 'FamilyRole', id: 'LIST' }],
        }),
        assignMemberRole: builder.mutation({
            query: ({ memberId, roleId }) => ({
                url: `${PF}/members/${memberId}/role`, method: 'PUT', data: { role_id: roleId || null },
            }),
            invalidatesTags: [{ type: 'FamilyScope', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetMinorsQuery,
    useCreateMinorMutation,
    useGetFamilyScopesQuery,
    useGetFamilyModulesQuery,
    useGetFamilyRolesQuery,
    useGetFamilyRoleQuery,
    useCreateFamilyRoleMutation,
    useSetFamilyRoleMatrixMutation,
    useAssignMemberRoleMutation,
} = familyEndpoints;

export default familyEndpoints;
