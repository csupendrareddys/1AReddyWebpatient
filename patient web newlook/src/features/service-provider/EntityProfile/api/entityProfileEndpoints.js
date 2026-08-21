/**
 * Entity-profile RTK endpoints — the account's own EntityProfile
 * (type + core fields). Backed by /api/entity-profile/me.
 *
 * TWO scopes reach this one endpoint, because EntityProfile is polymorphic
 * over hospital | clinic | patient and Operations mounts the same section for
 * all three:
 *
 *   patient scope   the Entity Details tab of the patient profile
 *   facility scope  the Profile tab of a clinic or hospital
 *
 * Each reads its own underscored arg key, so an arg carrying one passes
 * through the other untouched, and an unscoped caller — a clinic, hospital or
 * patient on their own settings page — keeps the exact URL and cache key it
 * always had. The facility scope is checked first only because it is the more
 * specific of the two; they can never both be present.
 */
import { apiSlice } from '../../../../app/api/apiSlice';
import {
    splitScope, scopeOf, apiScopedUrl, scopeTag, invalidatesProfile,
} from '../../../service-receiver/api/patientScope';
import {
    scopeOf as facilityScopeOf,
    splitScope as splitFacilityScope,
    apiScopedUrl as facilityScopedUrl,
    scopeTag as facilityScopeTag,
} from '../../api/facilityScope';

/** The URL for whichever scope (if either) the arg carries. */
const entityUrl = (arg) => {
    const facility = facilityScopeOf(arg);
    return facility
        ? facilityScopedUrl(facility, '/entity-profile/me')
        : apiScopedUrl(scopeOf(arg), '/entity-profile/me');
};

/** Cache-tag id, scoped the same way, so no two subjects share an entry. */
const entityTag = (arg) => {
    const facility = facilityScopeOf(arg);
    return facility
        ? facilityScopeTag(facility, 'ME')
        : scopeTag(scopeOf(arg), 'ME');
};

/** Strip whichever scope wrapper is present, leaving the real payload. */
const payloadOf = (arg) => {
    const [facility, rest] = splitFacilityScope(arg);
    return facility ? rest : splitScope(arg)[1];
};

const entityProfileEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getMyEntityProfile: builder.query({
            query: (arg) => ({ url: entityUrl(arg), method: 'GET' }),
            transformResponse: (r) => r?.data || r,
            providesTags: (r, e, arg) => [
                { type: 'EntityProfile', id: entityTag(arg) },
            ],
        }),
        updateMyEntityProfile: builder.mutation({
            query: (arg) => ({
                url: entityUrl(arg), method: 'PUT', data: payloadOf(arg),
            }),
            transformResponse: (r) => r?.data || r,
            // The patient side additionally bumps the profile-provenance tag so
            // the "last updated by" header re-reads; a facility has no such
            // header, so it just invalidates its own entry.
            invalidatesTags: (r, e, arg) => (
                facilityScopeOf(arg)
                    ? [{ type: 'EntityProfile', id: entityTag(arg) }]
                    : invalidatesProfile(
                        scopeOf(arg), { type: 'EntityProfile', id: entityTag(arg) },
                    )
            ),
        }),

        // ── Multiple entities per owner (one primary) ─────────────────
        getMyEntities: builder.query({
            query: () => ({ url: '/entity-profile/me/entities', method: 'GET' }),
            transformResponse: (r) => r?.data?.entities || [],
            providesTags: [{ type: 'EntityProfile', id: 'ENTITIES' }],
        }),
        createMyEntity: builder.mutation({
            query: (body = {}) => ({ url: '/entity-profile/me/entities', method: 'POST', data: body }),
            invalidatesTags: [{ type: 'EntityProfile', id: 'ENTITIES' }],
        }),
        setPrimaryEntity: builder.mutation({
            query: (entityId) => ({
                url: `/entity-profile/me/entities/${entityId}/primary`, method: 'POST',
            }),
            invalidatesTags: [{ type: 'EntityProfile', id: 'ENTITIES' }],
        }),
        deleteMyEntity: builder.mutation({
            query: (entityId) => ({
                url: `/entity-profile/me/entities/${entityId}`, method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'EntityProfile', id: 'ENTITIES' }],
        }),
    }),
});

export const {
    useGetMyEntityProfileQuery,
    useUpdateMyEntityProfileMutation,
    useGetMyEntitiesQuery,
    useCreateMyEntityMutation,
    useSetPrimaryEntityMutation,
    useDeleteMyEntityMutation,
} = entityProfileEndpoints;
