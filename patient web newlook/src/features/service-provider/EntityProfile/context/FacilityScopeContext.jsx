/**
 * FacilityScopeContext — "whose clinic / hospital am I acting on?"
 *
 * Default (no provider): the logged-in facility, acting on itself. That's
 * ``/dashboard/clinic/settings`` and ``/dashboard/hospital/settings``, and it
 * behaves exactly as it always has — no scope on the arg means the same URLs
 * and the same cache keys.
 *
 * With a facility: a super-admin in Operations acting on behalf of that one.
 * ``EntityDetailsSection`` doesn't branch on this; it consumes the scope-aware
 * hooks in ``EntityProfile/api/entityProfileEndpoints``, which fold the scope
 * into the arg. That's what lets Operations reuse the real section rather than
 * keeping an admin-only copy of the same eleven fields.
 *
 * Simpler than {@link DoctorScopeContext} on purpose. There are no redux
 * slices to clear (the entity profile is RTK Query only, so switching from
 * clinic A to clinic B is already a different cache entry), and no
 * ``basePath`` — the section is a single tab, with no navigation of its own.
 */
import { createContext, useContext, useMemo } from 'react';

const DEFAULT = { facility: null, vertical: null, isOps: false };

const FacilityScopeContext = createContext(DEFAULT);

/**
 * @param {string} facilityId  the clinic/hospital being acted on
 * @param {'clinic'|'hospital'} vertical  which table that id lives in
 */
export const FacilityScopeProvider = ({ facilityId = null, vertical = null, kind = null, children }) => {
    const value = useMemo(() => {
        // Both halves or neither — an id without a vertical can't build a URL,
        // and silently scoping to the wrong table would be worse than not
        // scoping at all.
        const scoped = !!(facilityId && vertical);
        // ``kind:'branch'`` is a main clinic operating its own login-less branch
        // (routes at /api/clinic/branches/<id>/act). It is NOT an ops admin, so
        // ``isOps`` stays false — the section shows its normal self-service UI.
        return {
            facility: scoped ? { id: facilityId, vertical, ...(kind ? { kind } : {}) } : null,
            vertical: scoped ? vertical : null,
            isOps: scoped && kind !== 'branch',
        };
    }, [facilityId, vertical, kind]);
    return (
        <FacilityScopeContext.Provider value={value}>
            {children}
        </FacilityScopeContext.Provider>
    );
};

/**
 * @returns {{facility: {id: string, vertical: string}|null,
 *           vertical: string|null, isOps: boolean}}
 */
export const useFacilityScope = () => useContext(FacilityScopeContext);

export default FacilityScopeContext;
