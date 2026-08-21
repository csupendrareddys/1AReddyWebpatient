/**
 * Doctor API scope — lets the very same doctor self-service endpoints be
 * called either as the logged-in doctor or on behalf of a specific doctor by
 * someone entitled to act for them.
 *
 * **Two callers, two proxies.** A super-admin in Operations, and a clinic or
 * hospital running a doctor it is linked to in My Link. They differ in who
 * authorises them and in how much they may reach, so they are separate
 * backend routes — but the doctor-side components can't tell, which is the
 * whole point of putting the difference here:
 *
 *   * ``ops``  → ``/api/admin/operations/doctor-members/<id>/act/<path>``
 *   * ``link`` → ``/api/facility/link/doctors/<id>/act/<path>``
 *
 * Both re-dispatch to the identical doctor view with ``current_user`` swapped
 * (``app/common/act_as.py``), so validation, the approval queue and the
 * service layer are shared — nothing is reimplemented per surface. Same deal
 * the patient side already has (see ``service-receiver/api/patientScope.js``).
 *
 * A scope is therefore a ``"<kind>:<id>"`` token rather than a bare id. It has
 * to carry the kind: the id alone cannot say which proxy to address, and using
 * it as a cache key alone would let the same doctor opened from two surfaces
 * share one entry. A bare id still parses as ``ops`` so nothing that predates
 * the second proxy has to change.
 *
 * Two ways to carry the scope, because the doctor surfaces are written two
 * ways:
 *
 * 1. **RTK Query — on the arg** ({@link withScope}). RTK Query keys its cache
 *    on (endpoint, serialized arg), so threading the id through the arg gives
 *    each doctor its own cache entry for free. An ambient scope would instead
 *    make ``getSlotVisibility(undefined)`` one entry shared by every doctor an
 *    admin opens, and doctor B would render doctor A's data until a refetch
 *    landed.
 *
 * 2. **Redux thunks — from the URL** ({@link doctorApiPath}). Most of the
 *    doctor profile predates RTK Query: it's ``createAsyncThunk`` + axios
 *    writing into ``state.doctor`` and the ``doctorProfile*`` slices. Those
 *    aren't an arg-keyed cache — there is exactly ONE of each, holding one
 *    doctor, which is also all the Operations page ever shows. So the hazard
 *    that rules out an ambient scope for RTK Query doesn't exist, and
 *    threading an argument through ~30 thunks and the dozen hooks that
 *    dispatch them would touch every section for no behavioural gain.
 *
 *    The scope is read from ``window.location`` at REQUEST time rather than
 *    held in a variable a provider sets. A variable was tried first and is
 *    subtly wrong: a child's effect runs before its parent's, so on React
 *    StrictMode's simulated remount ``useAppointments`` dispatched its fetch
 *    after the provider's cleanup had reset the variable and before its setup
 *    could re-assert it — one request per mount escaped to ``/api/doctor/...``
 *    as the admin and 403'd. Anything effect-ordered has that hole. The URL
 *    does not: it already IS the scope (the member id is a route param), it is
 *    correct the instant a thunk runs, and it cannot leak into the doctor's
 *    own app because leaving the route changes it.
 */

/** Arg key carrying the target doctor scope. Underscored: never sent as a field. */
export const OPS_DOCTOR_SCOPE_KEY = '__opsDoctorId';

/** Arg key used to box a non-object arg (e.g. a bare appointmentId string). */
const SCALAR_KEY = '__scopedArg';

/** Which proxy a scope addresses. */
export const OPS_SCOPE = 'ops';
export const LINK_SCOPE = 'link';

/** ``/api`` prefix each proxy hangs its allowlisted paths off. */
const SCOPE_PREFIX = {
    [OPS_SCOPE]: (id) => `/api/admin/operations/doctor-members/${id}/act`,
    [LINK_SCOPE]: (id) => `/api/facility/link/doctors/${id}/act`,
};

/** Build a scope token, or null when there is no scope. */
export const makeScope = (doctorId, kind = OPS_SCOPE) => (
    doctorId ? `${kind}:${doctorId}` : null
);

/**
 * ``[kind, id]`` from a scope token. A bare id — anything without a ``:`` —
 * reads as ``ops``, which is every scope that predates the link proxy.
 */
export const scopeParts = (scope) => {
    if (!scope) return [null, null];
    const text = String(scope);
    const cut = text.indexOf(':');
    return cut < 0 ? [OPS_SCOPE, text] : [text.slice(0, cut), text.slice(cut + 1)];
};

/** The doctor a scope points at, ignoring which proxy reaches them. */
export const scopeDoctorId = (scope) => scopeParts(scope)[1];

const prefixFor = (scope) => {
    const [kind, id] = scopeParts(scope);
    return (SCOPE_PREFIX[kind] || SCOPE_PREFIX[OPS_SCOPE])(id);
};

/**
 * Build the URL for a doctor self-service ``path`` (leading slash, relative to
 * ``/api/doctor``) in the given scope.
 */
export const doctorScopedUrl = (scope, path) => (
    scope ? `${prefixFor(scope)}/doctor${path}` : `/api/doctor${path}`
);

/** Same, for any other blueprint the proxy allowlists (e.g. doctor-attendance). */
export const apiScopedUrl = (scope, path) => (
    scope ? `${prefixFor(scope)}${path}` : `/api${path}`
);

/**
 * Attach the ops scope to an endpoint arg. Returns the arg untouched when
 * there's no scope, so the doctor's own calls keep their existing cache keys.
 */
export const withScope = (opsDoctorId, arg) => {
    if (!opsDoctorId) return arg;
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
        return { ...arg, [OPS_DOCTOR_SCOPE_KEY]: opsDoctorId };
    }
    return { [OPS_DOCTOR_SCOPE_KEY]: opsDoctorId, [SCALAR_KEY]: arg };
};

/**
 * Inverse of {@link withScope}. Returns ``[opsDoctorId, originalArg]`` —
 * ``opsDoctorId`` is null for a doctor's own request.
 */
export const splitScope = (arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)
        && OPS_DOCTOR_SCOPE_KEY in arg) {
        const { [OPS_DOCTOR_SCOPE_KEY]: id, ...rest } = arg;
        if (SCALAR_KEY in rest) return [id || null, rest[SCALAR_KEY]];
        return [id || null, rest];
    }
    return [null, arg];
};

/** Just the scope id from an arg — for tag builders that ignore the payload. */
export const scopeOf = (arg) => splitScope(arg)[0];

/**
 * Suffix a cache-tag id with the scope so an admin viewing doctor A can never
 * be served — or invalidate — doctor B's entry, nor the admin's own.
 */
export const scopeTag = (opsDoctorId, id) => (
    opsDoctorId ? `${id}@${opsDoctorId}` : id
);

// ── Scope for the redux thunks (see the module docstring) ───────────────────

/**
 * The routes that ARE a scope, one per proxy, each capturing the doctor id.
 *
 *   * Operations doctor detail —
 *     ``/dashboard/admin/operations/doctor/<opType>/<doctorId>[/...]``.
 *     ``doctor`` is literal: the patient and admin member flows use their own
 *     segment and must not match.
 *   * My Link Operation Page —
 *     ``/dashboard/<clinic|hospital>/my-link/operate/<doctorId>[/...]``.
 *
 * The Operation Page is a *dialog*, and this is exactly why it is mounted on a
 * real nested route rather than held in component state: these thunks read the
 * scope from ``window.location`` at request time (see the module docstring),
 * so a modal with no URL of its own would leave every thunk-based section
 * calling ``/api/doctor/...`` as the facility and 403-ing. Closing the dialog
 * navigates back, which is also what un-scopes them.
 *
 * Kept in step with ``route.jsx`` and with the links in
 * ``Operations/hooks/useOperations``.
 */
const SCOPE_ROUTES = [
    [OPS_SCOPE, /\/dashboard\/admin\/operations\/doctor\/[^/]+\/([0-9a-fA-F-]{8,})(?:\/|$)/],
    [LINK_SCOPE, /\/dashboard\/(?:clinic|hospital)\/my-link\/operate\/([0-9a-fA-F-]{8,})(?:\/|$)/],
];

/**
 * The scope token the current page is acting under, or null on every other
 * route — including all of the doctor's own ``/dashboard/doctor/*``.
 */
export const opsDoctorScope = () => {
    if (typeof window === 'undefined' || !window.location) return null;
    const { pathname } = window.location;
    for (const [kind, pattern] of SCOPE_ROUTES) {
        const match = pattern.exec(pathname);
        if (match) return makeScope(match[1], kind);
    }
    return null;
};

/**
 * ``/api/doctor``-relative path in whatever scope is active. Every axios call
 * in ``redux/doctorSlice`` goes through this instead of a literal URL, which
 * is the whole of what makes those thunks work on someone else's behalf.
 */
export const doctorApiPath = (path) => doctorScopedUrl(opsDoctorScope(), path);
