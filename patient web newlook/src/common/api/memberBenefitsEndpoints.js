/**
 * The signed-in user's membership benefits — currently just the flat
 * ``member_discount_pct`` their marketplace tier grants off every
 * consultation and catalog service.
 *
 * Separate from ``myMembershipEndpoints`` (``/api/membership/me``) on
 * purpose. That one is the provider dashboard's tile: it 404s when the user
 * holds no subscription, which is a fine answer for a card that should hide,
 * but the wrong one for the doctor tiles, service cards and booking summary
 * that ask this — those render for every patient, member or not, and would
 * each have to read "0%" out of an error. This endpoint always 200s.
 *
 * Lives under ``common/`` rather than a feature because both sides of the
 * marketplace read it: the patient surfaces badge it, and a provider viewing
 * their own membership sees the same number.
 */
import { apiSlice } from '../../app/api/apiSlice';
import { scopeOf, apiScopedUrl } from '../../features/service-receiver/api/patientScope';

const memberBenefitsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getMyMemberBenefits: builder.query({
            // Scope-aware: an admin booking on a patient's behalf has to quote
            // the PATIENT's tier, not their own — this number is what every
            // booking surface badges and subtracts.
            query: (arg) => ({
                url: apiScopedUrl(scopeOf(arg), '/membership/my-benefits'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: [{ type: 'MyMembership', id: 'BENEFITS' }],
        }),
    }),
});

export const { useGetMyMemberBenefitsQuery } = memberBenefitsEndpoints;
