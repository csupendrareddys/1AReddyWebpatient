/**
 * Admin CRUD Endpoints (RTK Query)
 * Replaces: adminService.js admin CRUD functions + AdminDashboard.js async thunks
 */
import { apiSlice } from '../../../app/api/apiSlice';

const SUPER_ADMIN_URL = '/api/v1/admin/super-admin';

const adminEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // List all admins with pagination
        getAdmins: builder.query({
            query: (params = {}) => ({
                url: `${SUPER_ADMIN_URL}/admins`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                admins: response.data?.admins || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.admins.map(({ id }) => ({ type: 'Admin', id })),
                          { type: 'Admin', id: 'LIST' },
                      ]
                    : [{ type: 'Admin', id: 'LIST' }],
        }),

        // Get a single admin by ID
        getAdmin: builder.query({
            query: (adminId) => ({
                url: `${SUPER_ADMIN_URL}/admins/${adminId}`,
                method: 'GET',
            }),
            providesTags: (result, error, adminId) => [{ type: 'Admin', id: adminId }],
        }),

        // Get all available permissions
        getPermissions: builder.query({
            query: () => ({
                url: `${SUPER_ADMIN_URL}/permissions`,
                method: 'GET',
            }),
            transformResponse: (response) => response.data?.permissions || [],
        }),

        // Create a new admin
        createAdmin: builder.mutation({
            query: (adminData) => ({
                url: `${SUPER_ADMIN_URL}/admins`,
                method: 'POST',
                data: adminData,
            }),
            invalidatesTags: [{ type: 'Admin', id: 'LIST' }],
        }),

        // Update admin details and permissions
        updateAdmin: builder.mutation({
            query: ({ adminId, updateData }) => ({
                url: `${SUPER_ADMIN_URL}/admins/${adminId}`,
                method: 'PUT',
                data: updateData,
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Admin', id: adminId },
                { type: 'Admin', id: 'LIST' },
            ],
        }),

        // Delete an admin (soft delete by default)
        deleteAdmin: builder.mutation({
            query: ({ adminId, hardDelete = false }) => ({
                url: `${SUPER_ADMIN_URL}/admins/${adminId}`,
                method: 'DELETE',
                params: { hard: hardDelete },
            }),
            invalidatesTags: [{ type: 'Admin', id: 'LIST' }],
        }),

        // Toggle admin status (activate/block)
        toggleAdminStatus: builder.mutation({
            query: ({ adminId, status }) => ({
                url: `${SUPER_ADMIN_URL}/admins/${adminId}/status`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Admin', id: adminId },
                { type: 'Admin', id: 'LIST' },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetAdminsQuery,
    useGetAdminQuery,
    useGetPermissionsQuery,
    useCreateAdminMutation,
    useUpdateAdminMutation,
    useDeleteAdminMutation,
    useToggleAdminStatusMutation,
} = adminEndpoints;
