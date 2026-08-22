/**
 * Patient API scope — lets the very same patient self-service endpoints be
 * called either as the logged-in patient or, by a super-admin in Operations,
 * on behalf of a specific patient.
 *
 * Why the id rides on the RTK-Query *arg* rather than a module-level variable
 * or a request header: RTK Query keys its cache on (endpoint, serialized arg).
 * If the scope were ambient, ``getVitals(undefined)`` would be one cache entry
 * shared by every patient an admin opens — patient B would render patient A's
 * vitals until a refetch landed. Threading it through the arg gives each
 * patient its own cache entry for free, and lets ``providesTags`` /
 * ``invalidatesTags`` be scoped the same way (see :func:`scopeTag`).
 *
 * Backend counterpart: ``/api/v1/admin/operations/patients/<id>/act/<path>``
 * (app/api/admin/operations/act_on_behalf.py) re-dispatches to the identical
 * patient view with ``current_user`` swapped, so validation and service layer
 * are shared too — nothing is reimplemented per-surface.
 */

/** Arg key carrying the target patient id. Underscored: never sent as a field. */
export const OPS_SCOPE_KEY = '__opsPatientId';

/** Arg key used to box a non-object arg (e.g. a bare recordId string). */
const SCALAR_KEY = '__scopedArg';

/**
 * Attach the ops scope to an endpoint arg. Returns the arg untouched when
 * there's no scope, so the patient's own calls keep their existing cache keys.
 */
export const withScope = (opsPatientId, arg) => {
    if (!opsPatientId) return arg;
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
        return { ...arg, [OPS_SCOPE_KEY]: opsPatientId };
    }
    return { [OPS_SCOPE_KEY]: opsPatientId, [SCALAR_KEY]: arg };
};

/**
 * Inverse of {@link withScope}. Returns ``[opsPatientId, originalArg]`` —
 * ``opsPatientId`` is null for a patient's own request.
 */
export const splitScope = (arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg) && OPS_SCOPE_KEY in arg) {
        const { [OPS_SCOPE_KEY]: id, ...rest } = arg;
        if (SCALAR_KEY in rest) return [id || null, rest[SCALAR_KEY]];
        return [id || null, rest];
    }
    return [null, arg];
};

/** Just the scope id from an arg — for tag builders that ignore the payload. */
export const scopeOf = (arg) => splitScope(arg)[0];

/** Prefixes a scope string can carry:
 *  - ``family:<houseGroupMemberId>`` — a guardian on a minor, or a linked adult;
 *  - ``staff:<patientId>``           — a support-staff CAREGIVER acting on the
 *    patient who employs them (their own login, role-bounded);
 *  - a plain uuid                    — the ops (admin) scope. */
const FAMILY_PREFIX = 'family:';
const STAFF_PREFIX = 'staff:';
const STAFF_FAMILY_PREFIX = 'staff-family:';

/** ``/act`` prefix for a scope (ops / family / staff / staff-family), or null
 *  for self. ``staff-family:<memberId>`` is a CAREGIVER acting on one of their
 *  employer patient's MINORS — checked before the bare ``staff:`` prefix (which
 *  it does not collide with) for clarity. */
const actBase = (scope) => {
    if (!scope) return null;
    if (typeof scope === 'string' && scope.startsWith(STAFF_FAMILY_PREFIX)) {
        return `/api/v1/patient-staff/act-minor/${scope.slice(STAFF_FAMILY_PREFIX.length)}`;
    }
    if (typeof scope === 'string' && scope.startsWith(FAMILY_PREFIX)) {
        return `/api/v1/patient/family/${scope.slice(FAMILY_PREFIX.length)}/act`;
    }
    if (typeof scope === 'string' && scope.startsWith(STAFF_PREFIX)) {
        return `/api/v1/patient-staff/act/${scope.slice(STAFF_PREFIX.length)}`;
    }
    return `/api/v1/admin/operations/patients/${scope}/act`;
};

/**
 * Build the URL for a patient self-service ``path`` (leading slash, relative
 * to ``/api/v1/patient``) in the given scope — a guardian acting on their minor,
 * an admin acting on a patient, or the logged-in patient themselves.
 */
export const patientScopedUrl = (scope, path) => {
    const base = actBase(scope);
    return base ? `${base}/patient${path}` : `/api/v1/patient${path}`;
};

/** Same, for any other blueprint the proxy allowlists (e.g. entity-profile). */
export const apiScopedUrl = (scope, path) => {
    const base = actBase(scope);
    return base ? `${base}${path}` : `/api/v1${path}`;
};

/**
 * Suffix a cache-tag id with the scope so an admin viewing patient A can never
 * be served — or invalidate — patient B's entry, nor the admin's own.
 */
export const scopeTag = (opsPatientId, id) => (
    opsPatientId ? `${id}@${opsPatientId}` : id
);

/**
 * The "who last touched this profile" tag. Every profile write invalidates it
 * so the page header re-reads provenance — a save in any tab has to move the
 * indicator, not just the tab you happened to be on.
 */
export const auditTag = (opsPatientId) => ({
    type: 'ProfileAudit', id: scopeTag(opsPatientId, 'CURRENT'),
});

/**
 * ``invalidatesTags`` helper: the endpoint's own tags plus the audit tag.
 * Used by every profile mutation so none can forget it.
 */
export const invalidatesProfile = (opsPatientId, ...tags) => [
    ...tags, auditTag(opsPatientId),
];
