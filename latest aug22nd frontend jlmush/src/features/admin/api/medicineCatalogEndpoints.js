import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/v1/admin/medicine-catalog';

const medicineCatalogEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Medicines ──
        getAdminMedicines: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { url: `${ADMIN_URL}/medicines?${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: ['MedicineCatalog'],
        }),
        createMedicine: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/medicines`, method: 'POST', data }),
            invalidatesTags: ['MedicineCatalog'],
        }),
        updateMedicine: builder.mutation({
            query: ({ id, ...data }) => ({ url: `${ADMIN_URL}/medicines/${id}`, method: 'PUT', data }),
            invalidatesTags: ['MedicineCatalog'],
        }),
        deleteMedicine: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/medicines/${id}`, method: 'DELETE' }),
            invalidatesTags: ['MedicineCatalog'],
        }),
        bulkUploadMedicines: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/medicines/bulk`, method: 'POST', data }),
            invalidatesTags: ['MedicineCatalog'],
        }),

        // ── Banned Medicines ──
        getBannedMedicines: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { url: `${ADMIN_URL}/banned-medicines?${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: ['BannedMedicines'],
        }),
        addBannedMedicine: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/banned-medicines`, method: 'POST', data }),
            invalidatesTags: ['BannedMedicines', 'MedicineCatalog'],
        }),
        updateBannedMedicine: builder.mutation({
            query: ({ id, ...data }) => ({ url: `${ADMIN_URL}/banned-medicines/${id}`, method: 'PUT', data }),
            invalidatesTags: ['BannedMedicines'],
        }),
        removeBannedMedicine: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/banned-medicines/${id}`, method: 'DELETE' }),
            invalidatesTags: ['BannedMedicines'],
        }),
        bulkUploadBannedMedicines: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/banned-medicines/bulk`, method: 'POST', data }),
            invalidatesTags: ['BannedMedicines', 'MedicineCatalog'],
        }),

        // ── Allergies ──
        getAdminAllergies: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { url: `${ADMIN_URL}/allergies?${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data?.allergies || [],
            providesTags: ['AllergyMaster'],
        }),
        createAllergy: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/allergies`, method: 'POST', data }),
            invalidatesTags: ['AllergyMaster'],
        }),
        deleteAllergy: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/allergies/${id}`, method: 'DELETE' }),
            invalidatesTags: ['AllergyMaster'],
        }),
        bulkUploadAllergies: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/allergies/bulk`, method: 'POST', data }),
            invalidatesTags: ['AllergyMaster'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetAdminMedicinesQuery,
    useCreateMedicineMutation,
    useUpdateMedicineMutation,
    useDeleteMedicineMutation,
    useBulkUploadMedicinesMutation,
    useGetBannedMedicinesQuery,
    useAddBannedMedicineMutation,
    useUpdateBannedMedicineMutation,
    useRemoveBannedMedicineMutation,
    useBulkUploadBannedMedicinesMutation,
    useGetAdminAllergiesQuery,
    useCreateAllergyMutation,
    useDeleteAllergyMutation,
    useBulkUploadAllergiesMutation,
} = medicineCatalogEndpoints;
