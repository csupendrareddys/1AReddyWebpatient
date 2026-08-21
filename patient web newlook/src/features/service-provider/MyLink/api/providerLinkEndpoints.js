/**
 * Facility-side My Link endpoints — the doctors affiliated to THIS clinic or
 * hospital, and what the relationship lets it do to each.
 *
 * Separate from ``MyNetwork/api/networkEndpoints`` on purpose. Those are the
 * doctor's own care-network routes (``/api/doctor/network/*``,
 * ``@role_required(DOCTOR)``) and a facility cannot call them at all — a My
 * Link connection is stored doctor-side, so the facility is the *target* of a
 * row it has no read on. ``/api/facility/link/*`` is that missing read.
 *
 * ``capabilities`` is fetched rather than derived: the tier ladder lives in
 * ``app/api/provider_link/authority.py`` and a second copy here would be a
 * second answer to "may they do this", which is exactly the drift that makes
 * a permission bug invisible until someone is refused mid-flow.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const LINK_URL = '/api/facility/link';

export const providerLinkEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getLinkedDoctors: builder.query({
            query: () => ({ url: `${LINK_URL}/doctors`, method: 'GET' }),
            transformResponse: (res) => res.data?.doctors || res.doctors || [],
            providesTags: ['CareNetworkConnection'],
        }),
        getLinkedDoctorCapabilities: builder.query({
            query: (doctorId) => ({
                url: `${LINK_URL}/doctors/${doctorId}/capabilities`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data || res,
            providesTags: ['CareNetworkConnection'],
        }),
        // Delink. Invalidates the capabilities cache as well as the list: the
        // Operation Page reads its tab strip from there, and a stale entry
        // would keep offering sections that the next request 404s on.
        unlinkDoctor: builder.mutation({
            query: (doctorId) => ({
                url: `${LINK_URL}/doctors/${doctorId}`,
                method: 'DELETE',
            }),
            invalidatesTags: ['CareNetworkConnection'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetLinkedDoctorsQuery,
    useGetLinkedDoctorCapabilitiesQuery,
    useUnlinkDoctorMutation,
} = providerLinkEndpoints;
