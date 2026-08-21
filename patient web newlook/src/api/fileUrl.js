/**
 * Absolute URL for an API-relative file path.
 *
 * The backend hands out download paths like
 * ``/api/document-files/<id>/pdf`` rather than presigned S3 URLs, so the
 * file stays behind the session and the link can't go stale. Those paths
 * are relative to the API origin, not to the app origin — a bare
 * ``<a href="/api/…">`` would hit the Vite dev server and 404.
 *
 * Auth rides on the ``access_token`` cookie (JWT_TOKEN_LOCATION includes
 * cookies, and GET isn't CSRF-protected), which is why a plain anchor or
 * an iframe works without attaching a bearer token by hand.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const apiFileUrl = (path) => {
    if (!path) return null;
    // Already absolute (or a blob/data URI) — leave it alone.
    if (/^[a-z]+:\/\//i.test(path) || path.startsWith('blob:') || path.startsWith('data:')) {
        return path;
    }
    return `${API_BASE_URL}${path}`;
};

export default apiFileUrl;
