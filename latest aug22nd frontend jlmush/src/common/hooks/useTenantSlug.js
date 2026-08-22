/**
 * Resolve the current tenant slug.
 *
 * Resolution order (first match wins):
 *   1. ``?tenant=<slug>`` query string on the current URL — handy for local
 *      preview without touching DNS (``http://localhost:3000/?tenant=acme``).
 *   2. Environment override ``VITE_TENANT_SLUG`` — fixed per build.
 *   3. First DNS label if the hostname looks like ``<slug>.<domain>`` and
 *      the slug is not a generic label (``www``, ``app``, ``main``, …).
 *   4. Default value ``platform`` (the is_default tenant on the backend).
 *
 * Exported as a plain function (not a hook) so it can be consumed by RTK
 * Query ``skip``/``arg`` without depending on render state.
 */

const DEFAULT_SLUG = 'platform';
const GENERIC_LABELS = new Set(['www', 'app', 'main', 'staging', 'localhost']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,98}$/i;

const resolveTenantSlug = () => {
    if (typeof window === 'undefined') return DEFAULT_SLUG;

    // 1. Query param override — ?tenant=acme
    try {
        const qs = new URLSearchParams(window.location.search);
        const fromQuery = qs.get('tenant');
        if (fromQuery && SLUG_RE.test(fromQuery)) return fromQuery.toLowerCase();
    } catch { /* ignore */ }

    // 2. Env override
    const envSlug = import.meta?.env?.VITE_TENANT_SLUG;
    if (envSlug && SLUG_RE.test(envSlug)) return envSlug.toLowerCase();

    // 3. Hostname-based resolution
    const host = window.location.hostname;
    if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        return DEFAULT_SLUG;
    }
    const [first] = host.split('.');
    if (!first || GENERIC_LABELS.has(first)) return DEFAULT_SLUG;
    if (!SLUG_RE.test(first)) return DEFAULT_SLUG;
    return first.toLowerCase();
};

export default resolveTenantSlug;
