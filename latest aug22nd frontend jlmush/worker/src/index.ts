/**
 * jlmush-edge — Cloudflare Worker that sits in front of the Pages
 * project (``jlmushiitm-frontend``).
 *
 * Tenant Custom Hostnames (provisioned via ``cloudflare_saas.py``)
 * route to this Worker via the zone's Fallback Origin
 * (``fallback.larazen.in`` → this Worker). The Worker proxies to
 * Pages via the ``ASSETS`` binding declared in ``wrangler.toml``.
 *
 * Today the Worker is a transparent pass-through. We deliberately do
 * NOT redirect apex → www here: on Free / Pro / Business SSL-for-SaaS
 * Cloudflare doesn't support wildcard Custom Hostnames, so each
 * tenant registers only ONE canonical hostname (we recommend
 * ``www.<apex>``). Bare apex requests never reach this Worker because
 * the TLS handshake at the edge fails first (no cert for apex). Apex
 * redirects, if a tenant wants them, are configured at the tenant's
 * own DNS provider as a URL-forwarding / redirect rule.
 *
 * Future tenant-host middleware (maintenance pages, X-Tenant-Host
 * rewrites, geo / bot rules, tenant feature flags at the edge) goes
 * here.
 */
export interface Env {
    ASSETS: Fetcher;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // Pass-through. Hooks for tenant-host rewrites, maintenance
        // modes, geo/bot policies, or per-tenant feature flags would
        // go here.
        return env.ASSETS.fetch(request);
    },
};
