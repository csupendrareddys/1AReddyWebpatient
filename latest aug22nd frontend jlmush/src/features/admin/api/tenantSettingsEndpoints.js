/**
 * Super-admin tenant settings — provider directory visibility (RTK Query).
 * Controls whether doctors can browse the Discover directory of all
 * doctors / hospitals / clinics in the tenant.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/admin/tenant-settings/provider-visibility';

export const tenantSettingsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getProviderVisibility: builder.query({
            query: () => ({ url: URL, method: 'GET' }),
            transformResponse: (res) => res.data?.visibility || res.visibility
                || { doctors: false, hospitals: false, clinics: false },
            providesTags: ['ProviderVisibility'],
        }),
        updateProviderVisibility: builder.mutation({
            query: (data) => ({ url: URL, method: 'PUT', data }),
            transformResponse: (res) => res.data?.visibility || res.visibility,
            invalidatesTags: ['ProviderVisibility'],
        }),

        // Tenant-global appointment types (the admin "Appointments" master switch).
        getTenantAppointmentTypes: builder.query({
            query: () => ({ url: '/api/v1/admin/tenant-settings/appointment-types', method: 'GET' }),
            transformResponse: (res) => res.data?.appointment_types || {},
            providesTags: ['ProviderVisibility'],
        }),
        updateTenantAppointmentTypes: builder.mutation({
            query: (data) => ({ url: '/api/v1/admin/tenant-settings/appointment-types', method: 'PUT', data }),
            transformResponse: (res) => res.data?.appointment_types,
            invalidatesTags: ['ProviderVisibility'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetProviderVisibilityQuery,
    useUpdateProviderVisibilityMutation,
    useGetTenantAppointmentTypesQuery,
    useUpdateTenantAppointmentTypesMutation,
} = tenantSettingsEndpoints;
