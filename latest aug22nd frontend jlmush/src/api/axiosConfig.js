import axios from 'axios';

// Set by the seller support inbox while a customer thread is open —
// see the interceptor below. Null = no override.
let supportTenantOverride = null;
export const setSupportTenantOverride = (slug) => {
    supportTenantOverride = slug || null;
};
import { store } from '../app/store';
import { logout, refreshToken } from '../features/auth/redux/authSlice';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Helper function to get cookie by name
const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
};

// Single-inflight refresh state — prevents concurrent refresh calls
// (React StrictMode double-mount, parallel requests, etc.)
let isRefreshing = false;
let refreshQueue = []; // Callbacks waiting for the in-progress refresh to settle

const processQueue = (error) => {
    refreshQueue.forEach(({ resolve, reject }) => {
        if (error) reject(error);
        else resolve();
    });
    refreshQueue = [];
};

const axiosInstance = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // Important for cookies
    headers: {
        'Content-Type': 'application/json',
    },
});

// localStorage keys for Bearer-token-based auth. We keep tokens in
// localStorage (not sessionStorage) so a tab refresh doesn't log the
// user out, and use distinct keys for access + refresh so the refresh
// endpoint can be sent the right one. Per-origin scoping is automatic
// (jlmush.in's localStorage is separate from larazen.in's), which is
// exactly what we want: two tenant domains can each have their own
// session in the same browser without colliding.
const ACCESS_TOKEN_KEY = 'auth.access_token';
const REFRESH_TOKEN_KEY = 'auth.refresh_token';
const getAccessToken = () => {
    try { return window.localStorage.getItem(ACCESS_TOKEN_KEY) || null; }
    catch { return null; }
};
const getRefreshToken = () => {
    try { return window.localStorage.getItem(REFRESH_TOKEN_KEY) || null; }
    catch { return null; }
};

// Client identification — every request says which client it is so backend
// logs, rate limits and the min-version gate can tell web/mobile/desktop
// apart. The device id is a per-browser-install random uuid (NOT identity:
// it survives logout, it's per-origin, and the backend only uses it for
// log correlation and per-device sessions — never for security decisions).
const DEVICE_ID_KEY = 'client.device_id';
const getDeviceId = () => {
    try {
        let id = window.localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            id = (window.crypto?.randomUUID?.() ||
                `${Date.now()}-${Math.random().toString(36).slice(2)}`);
            window.localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch { return null; }
};
// Injected by vite.config.js from package.json at build time.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

// Request interceptor - Add CSRF token + X-Tenant-Slug + Authorization
axiosInstance.interceptors.request.use(
    (config) => {
        config.headers['X-Client'] = 'web';
        config.headers['X-Client-Version'] = APP_VERSION;
        const deviceId = getDeviceId();
        if (deviceId) {
            config.headers['X-Device-Id'] = deviceId;
        }
        // Authorization: Bearer header from localStorage. Required for
        // cross-site auth (tenant custom domains can't rely on cookies
        // because modern browsers block third-party cookies). For the
        // /auth/refresh endpoint specifically we send the REFRESH
        // token; everywhere else we send the ACCESS token.
        const isRefreshEndpoint = config.url?.includes('/api/v1/auth/refresh');
        const tok = isRefreshEndpoint ? getRefreshToken() : getAccessToken();
        if (tok && !config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${tok}`;
        }

        // Add CSRF token for non-GET requests (POST, PUT, PATCH, DELETE)
        if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
            // Use csrf_refresh_token for the refresh endpoint, csrf_access_token for everything else
            const csrfCookieName = isRefreshEndpoint ? 'csrf_refresh_token' : 'csrf_access_token';
            const csrfToken = getCookie(csrfCookieName);
            if (csrfToken) {
                config.headers['X-CSRF-TOKEN'] = csrfToken;
            }
        }

        // Tenant resolution headers.
        //
        // Phase 3 architecture: the BACKEND derives the tenant from
        // ``request.host`` (the literal HTTP Host header that the
        // browser sends natively, possibly forwarded through a trusted
        // proxy as ``X-Forwarded-Host``). The frontend doesn't need to
        // tell the backend which tenant it is — the URL the browser
        // already typed carries that signal.
        //
        // ``VITE_SEND_LEGACY_TENANT_HEADERS`` controls the rollout:
        //   * ``true`` (default during the rollout window) — keep
        //     sending ``X-Tenant-Host`` / ``X-Tenant-Slug`` for
        //     backwards compatibility with backends that haven't been
        //     upgraded to the trusted-host resolver yet, AND for the
        //     dev-server use case (Vite proxy doesn't propagate the
        //     real Host through to the backend). Default ON.
        //   * ``false`` — drop the legacy headers entirely. Set this
        //     once production telemetry confirms zero
        //     ``[TENANT_RESOLVE] source=default_fallback`` from auth
        //     paths AND the backend has
        //     ``BACKEND_TRUST_TENANT_HOST_HEADER=false``.
        //
        // The legacy headers are NEVER a security boundary — backend
        // authorization is JWT-role-based and host-validated server-
        // side. They're a routing hint only.
        // ── Seller support override ─────────────────────────────
        // The seller console converses on a CUSTOMER tenant's support
        // channel through the standard service-communication endpoints.
        // While a thread is open, those calls — and ONLY those — carry
        // the customer's slug so the backend resolves the right tenant;
        // every other request keeps the seller's own context.
        if (supportTenantOverride
                && typeof config.url === 'string'
                && config.url.startsWith('/api/v1/service-communication')) {
            config.headers['X-Tenant-Slug'] = supportTenantOverride;
            delete config.headers['X-Tenant-Host'];
            return config;
        }
        try {
            const sendLegacy = (
                String(import.meta?.env?.VITE_SEND_LEGACY_TENANT_HEADERS ?? 'true')
                    .toLowerCase()
                    .trim() !== 'false'
            );
            if (sendLegacy && typeof window !== 'undefined') {
                const slug = (function resolveSlug() {
                    try {
                        const qs = new URLSearchParams(window.location.search);
                        const fromQ = qs.get('tenant');
                        if (fromQ && /^[a-z0-9][a-z0-9-]{0,98}$/i.test(fromQ)) return fromQ.toLowerCase();
                    } catch { /* ignore */ }
                    const env = import.meta?.env?.VITE_TENANT_SLUG;
                    if (env && /^[a-z0-9][a-z0-9-]{0,98}$/i.test(env)) return env.toLowerCase();
                    const host = window.location.hostname || '';
                    if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
                    const [first] = host.split('.');
                    if (!first || ['www', 'app', 'main', 'api', 'staging'].includes(first)) return null;
                    if (!/^[a-z0-9][a-z0-9-]{0,98}$/i.test(first)) return null;
                    return first.toLowerCase();
                })();
                if (slug) {
                    config.headers['X-Tenant-Slug'] = slug;
                }
                const host = window.location.hostname;
                if (host && host !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
                    config.headers['X-Tenant-Host'] = host.toLowerCase();
                }
            }
        } catch { /* never let header resolution break a request */ }

        if (import.meta.env.DEV) {
            console.log(`[API →] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
        }
        return config;
    },
    (error) => {
        if (import.meta.env.DEV) {
            console.error('[API →] Request setup error:', error.message);
        }
        return Promise.reject(error);
    }
);

// Response interceptor
axiosInstance.interceptors.response.use(
    (response) => {
        if (import.meta.env.DEV) {
            console.log(`[API ←] ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        }
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        if (import.meta.env.DEV) {
            console.error(`[API ✗] ${error.response?.status || 'NETWORK'} ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}`, error.response?.data?.error || error.message);
        }

        // ── 429 handler: friendly toast for rate limiting ─────────
        // Backend's Flask-Limiter returns 429 with a Retry-After
        // header on platform-mutation endpoints so a stuck UI loop
        // or impatient operator can't runaway-spam Cloudflare's
        // Custom Hostnames API. Surface the wait time via the
        // existing admin shared snackbar so the operator sees WHY
        // their click stopped working.
        if (error.response?.status === 429) {
            try {
                const { setSnackbar } = await import(
                    '../features/admin/redux/adminSharedUiSlice'
                );
                const retryAfter = parseInt(
                    error.response.headers?.['retry-after'] || '60', 10,
                ) || 60;
                store.dispatch(setSnackbar({
                    open: true,
                    severity: 'warning',
                    message: (
                        `Slow down — you're hitting the per-minute rate limit. `
                        + `Wait ~${retryAfter}s before retrying. (This protects `
                        + `the Cloudflare API quota from being throttled.)`
                    ),
                }));
            } catch (e) {
                // Snackbar plumbing isn't critical to error propagation —
                // fall through and reject as normal so callers still
                // see the 429 in their own error handlers.
                if (import.meta.env.DEV) {
                    console.warn('[API] 429 toast dispatch failed:', e);
                }
            }
            return Promise.reject(error);
        }

        // ── 403 / 402 plan-gate toasts ────────────────────────────
        // Backend's @feature_required decorator returns
        // ``403 {code: 'feature_disabled', data: {feature: '...'}}``
        // when the caller's plan doesn't include the requested
        // capability. The frontend was silently swallowing these
        // (only logged to the browser console) — the operator saw
        // the click happen, the network tab showed 403, but the UI
        // gave no indication that the action was rejected. Surface
        // both feature_disabled (403) and no_active_subscription
        // (402) as visible warnings so the user knows their click
        // didn't land.
        const errCode = error.response?.data?.code;
        if (errCode === 'feature_disabled' || errCode === 'no_active_subscription') {
            try {
                const { setSnackbar } = await import(
                    '../features/admin/redux/adminSharedUiSlice'
                );
                const featurePath = error.response?.data?.data?.feature;
                const msg = errCode === 'feature_disabled'
                    ? (
                        `This feature isn't available on your plan`
                        + (featurePath ? ` (${featurePath})` : '')
                        + '. Upgrade or contact your administrator.'
                    )
                    : 'No active subscription. Contact your administrator.';
                store.dispatch(setSnackbar({
                    open: true,
                    severity: 'warning',
                    message: msg,
                }));
            } catch (e) {
                if (import.meta.env.DEV) {
                    console.warn('[API] feature_disabled toast dispatch failed:', e);
                }
            }
            return Promise.reject(error);
        }

        // List of endpoints that should NOT trigger token refresh on 401
        const authEndpoints = ['/api/v1/auth/signin', '/api/v1/auth/signup', '/api/v1/auth/signup/doctor', '/api/v1/auth/refresh'];
        const isAuthEndpoint = authEndpoints.some(endpoint => originalRequest.url?.includes(endpoint));

        if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
            originalRequest._retry = true;

            // If a refresh is already in-flight, queue this request to retry after it settles
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    refreshQueue.push({ resolve, reject });
                }).then(() => {
                    // Refresh succeeded — update CSRF and retry
                    const csrfToken = getCookie('csrf_access_token');
                    if (csrfToken) originalRequest.headers['X-CSRF-TOKEN'] = csrfToken;
                    return axiosInstance(originalRequest);
                }).catch((err) => Promise.reject(err));
            }

            // We're the first — take ownership of the refresh
            isRefreshing = true;

            try {
                if (import.meta.env.DEV) {
                    console.log('[API] ↻ Attempting token refresh...');
                }
                await store.dispatch(refreshToken()).unwrap();
                if (import.meta.env.DEV) {
                    console.log('[API] ↻ Token refreshed, retrying original request');
                }
                processQueue(null); // Unblock all queued requests
                const csrfToken = getCookie('csrf_access_token');
                if (csrfToken) originalRequest.headers['X-CSRF-TOKEN'] = csrfToken;
                return axiosInstance(originalRequest);
            } catch (refreshError) {
                if (import.meta.env.DEV) {
                    console.error('[API] ↻ Refresh failed, logging out');
                }
                processQueue(refreshError); // Reject all queued requests
                store.dispatch(logout());
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

export default axiosInstance;
