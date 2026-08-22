/**
 * Where the in-app "Back" button should go.
 *
 * Walking one URL segment up is deterministic (browser Back is blind to
 * same-URL state navigation), but a naive walk lands on paths that are
 * not routes: ``/dashboard/platform/tenants/<uuid>/entitlements`` minus
 * one segment is ``/dashboard/platform/tenants/<uuid>``, which 404s
 * because only the ``/admins``, ``/permissions`` and ``/entitlements``
 * children exist. So we keep walking while the tail looks like a record
 * id rather than a page.
 */

// A path segment that identifies a RECORD, not a page: uuid, numeric id,
// or a long opaque token.
const looksLikeId = (seg) => (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
    || /^\d+$/.test(seg)
    || /^[0-9a-f]{16,}$/i.test(seg)
);

/**
 * @param {string} pathname current location.pathname
 * @param {number} minSegments how many leading segments are the role root
 *        (``/dashboard/admin`` = 2) — never go above that.
 * @returns {string|null} the path to navigate to, or null when already at
 *          the root (caller hides the button).
 */
export function backPathFor(pathname, minSegments = 2) {
    const segments = (pathname || '').split('/').filter(Boolean);
    if (segments.length <= minSegments) return null;

    const next = segments.slice(0, -1);
    // Drop trailing record ids — they are never landable pages.
    while (next.length > minSegments && looksLikeId(next[next.length - 1])) {
        next.pop();
    }
    if (next.length < minSegments) return null;
    return '/' + next.join('/');
}

export default backPathFor;
