import { useSelector } from 'react-redux';

/**
 * useIsOnPlatformDomain — true when the browser is on the platform's
 * apex (or ``www``), false on any tenant subdomain or custom domain.
 *
 * Resolution (current — hardcoded):
 *   1. ``localhost`` / IPs → true (dev convenience).
 *   2. ``window.location.hostname`` matches one of ``PLATFORM_APEX_HOSTS``
 *      (or the ``www.`` form of any of them) → true.
 *   3. ``user.tenant_context.is_platform_host`` from /auth/me → true
 *      (covers logged-in case where backend-authoritative answer is
 *      available; useful when the bundle is served from a mirror /
 *      preview hostname not in the hardcoded list).
 *   4. Otherwise → false (tenant subdomain / custom domain).
 *
 * Why hardcoded instead of env-var driven:
 *   Build-time env vars from CI dashboards (originally Amplify, now
 *   the GitHub Actions Pages-deploy workflow) were not reliably
 *   propagated through to the Vite build subprocess. Committing
 *   ``.env.production`` was needed for predictable builds, so the
 *   apex list lives in code. Add a new apex by appending to the
 *   constant below — that's a one-line code change.
 *
 * Why this exists:
 *   The same React bundle is served from the platform apex AND from
 *   every tenant's domain. A platform_owner who visits a tenant's
 *   domain shouldn't see cross-tenant management items (Plans,
 *   Add-ons, Tenants). Same logic decides whether public-landing
 *   fetches hit the platform marketing endpoint or the per-tenant one.
 *
 * Security note:
 *   This hook is UI-only. Authorization for platform-owner endpoints
 *   is enforced server-side via ``@role_required(PLATFORM_OWNER)`` on
 *   every ``/api/platform/*`` route. A client that flips this to
 *   ``true`` in its own JS can show menu items, but the backend will
 *   still 403 the actual API calls.
 */

// Platform apex domains. Add new entries here when launching on
// additional apexes. Bare hostname only — NO protocol, NO ``www.``,
// NO trailing slash. The hook automatically accepts ``www.<entry>``
// as well, so don't list both.
const PLATFORM_APEX_HOSTS = [
    'larazen.in',
];

const _isLocalhostOrIp = (host) =>
    !host
    || host === 'localhost'
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

const _isPlatformApex = (host) => {
    if (!host) return false;
    for (const apex of PLATFORM_APEX_HOSTS) {
        if (host === apex) return true;
        if (host === `www.${apex}`) return true;
    }
    return false;
};

// One-shot per-host debug log so the operator can see EXACTLY what
// the hook is computing on each unique host the bundle runs on.
const _debugLogged = new Set();
const _debugLog = (host, ctxFlag, result, source) => {
    if (typeof console === 'undefined' || !console.log) return;
    if (_debugLogged.has(host)) return;
    _debugLogged.add(host);
    /* eslint-disable no-console */
    console.log(
        '[useIsOnPlatformDomain] host=%o apex_list=%o ctxFlag=%o → isPlatform=%o (via %s)',
        host, PLATFORM_APEX_HOSTS, ctxFlag, result, source,
    );
    /* eslint-enable no-console */
};

const useIsOnPlatformDomain = () => {
    // Subscribe to the backend-authoritative signal so we re-render
    // when /auth/me resolves.
    const ctxFlag = useSelector((s) =>
        s?.auth?.user?.tenant_context?.is_platform_host
    );

    if (typeof window !== 'undefined') {
        const host = (window.location.hostname || '').toLowerCase();
        if (_isLocalhostOrIp(host)) {
            _debugLog(host, ctxFlag, true, 'localhost-or-ip');
            return true;
        }
        if (_isPlatformApex(host)) {
            _debugLog(host, ctxFlag, true, 'platform-apex-hardcoded');
            return true;
        }
        if (ctxFlag === true) {
            _debugLog(host, ctxFlag, true, 'auth-me-tenant-context');
            return true;
        }
        _debugLog(host, ctxFlag, false, 'no-match-tenant-fallback');
        return false;
    }

    // SSR fallback (no window).
    return true;
};

export default useIsOnPlatformDomain;
