/**
 * Resolve a stored media path to a URL that actually renders in an <img>.
 *
 * Uploads are served by the backend at `/uploads/<path>`. Values are stored
 * inconsistently across the app's history:
 *   - absolute (`http://host/uploads/...`)  — newer uploads, use as-is
 *   - `/api/uploads/...`                     — older rows; the SPA dev proxy
 *                                              does NOT serve /api/uploads to
 *                                              <img> tags, so this must be
 *                                              rewritten to the backend origin
 *   - `/uploads/...` or `uploads/...`        — relative to the backend origin
 *
 * The backend origin is VITE_API_BASE_URL (e.g. http://localhost:5001 in dev,
 * the API domain in prod). data: URIs and blobs pass through untouched.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const resolveMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;

    let path = url;
    if (path.startsWith('/api/uploads/')) path = path.slice(4); // -> /uploads/...
    if (path.startsWith('uploads/')) path = `/${path}`;
    if (path.startsWith('/uploads/')) return `${API_BASE}${path}`;
    // Unknown shape (e.g. an s3:// key) — return as-is and let the caller decide.
    return url;
};

export default resolveMediaUrl;
