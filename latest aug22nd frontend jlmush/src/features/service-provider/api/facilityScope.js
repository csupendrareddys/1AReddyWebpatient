/**
 * Facility API scope — lets a clinic's or hospital's own self-service
 * endpoints be called either as the logged-in facility or, by a super-admin in
 * Operations, on behalf of a specific one.
 *
 * Third of three scopes, after ``service-receiver/api/patientScope`` and
 * ``service-provider/api/doctorScope``, and the same bargain as both: the id
 * rides on the RTK-Query *arg* rather than a module-level variable, because
 * RTK Query keys its cache on (endpoint, serialized arg). Ambient, an admin
 * opening clinic B would be served clinic A's entity profile until a refetch
 * landed.
 *
 * What differs here is that ONE scope covers two member types. A clinic and a
 * hospital are the same shape — own table, ``admin_user_id`` owner, one
 * EntityProfile — and the backend serves both from a single
 * ``/<vertical>-members/<id>/act/<path>`` route, so the vertical travels with
 * the id instead of being a fourth scope module. That is also why the scope
 * value is a PAIR: an id alone wouldn't say which table to look in.
 *
 * Backend counterpart: ``/api/v1/admin/operations/<vertical>-members/<id>/act/…``
 * in app/api/admin/operations/act_on_behalf.py, whose FACILITY_ALLOWED_PATHS
 * is deliberately one row — ``entity-profile/me``. Everything else an admin
 * does to a facility (verify, reject, suspend, invite) already takes the
 * facility as a path parameter on ``/api/v1/admin/clinics/<id>`` style routes and
 * never comes near this proxy.
 */

/** Arg key carrying the target facility. Underscored: never sent as a field. */
export const OPS_FACILITY_KEY = '__opsFacility';

/** Arg key used to box a non-object arg. */
const SCALAR_KEY = '__scopedArg';

/** The member types this scope covers, i.e. the ``<vertical>`` path segment. */
export const FACILITY_VERTICALS = ['clinic', 'hospital'];

/**
 * Attach the ops scope to an endpoint arg. ``facility`` is ``{ id, vertical }``
 * or null. Returns the arg untouched when there's no scope, so a facility's own
 * calls keep their existing cache keys.
 */
export const withScope = (facility, arg) => {
    if (!facility?.id || !facility?.vertical) return arg;
    // A FormData is ``typeof 'object'`` but spreading it yields ``{}`` and drops
    // every file — so box it (like a scalar) instead of spreading. Plain objects
    // still get the key folded in so their fields ride the cache key.
    const spreadable = arg && typeof arg === 'object' && !Array.isArray(arg)
        && !(typeof FormData !== 'undefined' && arg instanceof FormData);
    if (spreadable) {
        return { ...arg, [OPS_FACILITY_KEY]: facility };
    }
    return { [OPS_FACILITY_KEY]: facility, [SCALAR_KEY]: arg };
};

/**
 * Inverse of {@link withScope}. Returns ``[facility, originalArg]`` —
 * ``facility`` is null for a facility's own request.
 */
export const splitScope = (arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)
        && OPS_FACILITY_KEY in arg) {
        const { [OPS_FACILITY_KEY]: facility, ...rest } = arg;
        if (SCALAR_KEY in rest) return [facility || null, rest[SCALAR_KEY]];
        return [facility || null, rest];
    }
    return [null, arg];
};

/** Just the scope from an arg — for tag builders that ignore the payload. */
export const scopeOf = (arg) => splitScope(arg)[0];

/**
 * Build the URL for ``path`` (leading slash, relative to ``/api/v1``) in the given
 * scope. Unscoped it is the plain ``/api/v1`` URL, byte for byte what the
 * facility's own page has always called.
 */
export const apiScopedUrl = (facility, path) => {
    if (!facility?.id || !facility?.vertical) return `/api/v1${path}`;
    // A BRANCH scope (a main clinic operating its own login-less branch) rides a
    // different proxy than the ops (admin) one: the clinic owner initiates it, so
    // it goes through /api/clinic/branches/<id>/act, not the Operations route.
    if (facility.kind === 'branch') {
        return `/api/v1/clinic/branches/${facility.id}/act${path}`;
    }
    return `/api/v1/admin/operations/${facility.vertical}-members/${facility.id}/act${path}`;
};

/**
 * Suffix a cache-tag id with the scope so an admin viewing clinic A can never
 * be served — or invalidate — clinic B's entry, nor a hospital's that happens
 * to share an id space, nor the admin's own. ``kind`` keeps a branch scope's
 * entries distinct from an ops view of the same clinic id.
 */
export const scopeTag = (facility, id) => (
    facility?.id ? `${id}@${facility.kind || facility.vertical}:${facility.id}` : id
);
