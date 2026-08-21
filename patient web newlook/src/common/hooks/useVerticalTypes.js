/**
 * useVerticalTypes — the marketplace verticals, from the backend.
 *
 * Four surfaces need to agree on which verticals exist and where each one's
 * registration funnel lives: the ``/register`` tiles, the navbar's Register
 * dropdown, ``/join`` (providers) and ``/join_receiver`` (receivers). They
 * used to agree by each carrying its own hardcoded doctor/clinic/hospital
 * list, which meant adding a vertical was a four-file edit that silently
 * half-worked when one was missed — a vertical the tiles offered but /join's
 * list didn't know about would land you on the doctor tab.
 *
 * So the list comes from ``GET /api/public/vertical-types`` and the routing
 * rule lives here too, in ``registerRouteFor``. Adding a vertical is now a
 * backend row.
 *
 * ``is_receiver`` is the fork in the funnel: receivers (patients) buy plans
 * without joining the network, so they get ``/join_receiver``; everyone else
 * gets the ``/join`` marketplace funnel. Both take ``?vertical=<code>``.
 */
import { useMemo } from 'react';

import { useListPublicVerticalTypesQuery } from '../../features/admin/api/publicEndpoints';

/** The registration funnel for a vertical. ``is_receiver`` picks the page. */
export const registerRouteFor = (vt) =>
    (vt.is_receiver ? '/join_receiver' : '/join')
    + `?vertical=${encodeURIComponent(vt.code)}`;

/**
 * The provider signup page a vertical's funnel ends at, derived from its code
 * rather than a lookup table — the routes in route.jsx already follow this
 * pattern for every vertical (doctor, clinic, hospital, pharmacy, diagnosis),
 * so a table would just be that pattern retyped and one more file to forget.
 *
 * Built off ``code``, not ``name``: the code is the URL-safe identifier the
 * routes are keyed on, while name is display copy that can carry spaces and
 * case ("Diagnostic Centre").
 *
 * Receiver verticals don't go here — they end at the shared receiver signup,
 * which /join_receiver links directly.
 */
export const providerSignupRouteFor = (code) => `/auth/service-provider/${code}/signup`;

/**
 * Returns ``{verticalTypes, receiverTypes, providerTypes, isLoading, error}``.
 *
 * ``receiverTypes`` / ``providerTypes`` are the ``is_receiver`` split, which
 * is what /join_receiver and /join respectively build their tab rows from.
 */
export default function useVerticalTypes() {
    const { data: verticalTypes = [], isLoading, error } = useListPublicVerticalTypesQuery();

    const [receiverTypes, providerTypes] = useMemo(
        () => [
            verticalTypes.filter((vt) => vt.is_receiver),
            verticalTypes.filter((vt) => !vt.is_receiver),
        ],
        [verticalTypes],
    );

    return { verticalTypes, receiverTypes, providerTypes, isLoading, error };
}

/**
 * Resolves the ``?vertical=`` param against a list of vertical types.
 *
 * Returns the requested code when it's in the list, else the first one — so a
 * stale/hand-typed/receiver-on-the-provider-page code degrades to a sane tab
 * instead of an empty page. Returns null while the list is still loading,
 * which callers must treat as "not resolved yet" and NOT as a reason to fire
 * a plans query: ``membership-plans`` with no ``?vertical=`` returns the
 * unfiltered catalog, which would flash every vertical's plans on the page.
 */
export const resolveVertical = (types, raw) => {
    if (types.length === 0) return null;
    return types.some((vt) => vt.code === raw) ? raw : types[0].code;
};
