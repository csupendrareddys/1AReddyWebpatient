import { useCallback, useEffect, useState } from 'react';

/**
 * Guards a page against an RTK-Query subscription that never resolves.
 *
 * The failure mode: the HTTP request returns 200 with a full body, but the
 * component's selector stays at `status: 'pending'` with `data === undefined`
 * forever. Confirmed on the public landing and pricing queries, and **not**
 * a StrictMode-only artifact — it reproduces in a production `vite build`.
 * Left alone it renders as a permanent spinner or, worse, as silently
 * defaulted content (a site showing placeholder branding as though nothing
 * were wrong).
 *
 * The workaround: alongside the normal subscription, fire one imperative
 * `refetch().unwrap()`. Its promise resolves independently of the wedged
 * selector, so we get the payload even when the selector never delivers.
 * The subscription is left in place, so cache invalidation, tag refetching
 * and refetch-on-focus all keep working — this only supplies a value when
 * the selector fails to, and defers to the selector whenever it works.
 *
 * Prefer plain RTK hooks for new code. Reach for this on surfaces where a
 * silent hang is costly: first-run onboarding, anything a customer sees
 * before they trust the product. Remove it once the root cause is fixed.
 *
 * Call `reprime()` after any mutation that invalidates this query. Tag
 * invalidation refreshes the *subscription*, but when the subscription is
 * the thing that's wedged, the primed value would otherwise stay frozen at
 * whatever it held on mount — so a successful save would report success
 * while the screen kept showing the old state.
 *
 * @param {object} queryResult  the object returned by a useXxxQuery hook
 * @param {object} [opts]
 * @param {boolean} [opts.skip] don't prime (mirror the query's own skip)
 * @returns {{data: any, settled: boolean, reprime: function}}
 */
export default function usePrimedQuery(queryResult, { skip = false } = {}) {
    const { data, refetch } = queryResult || {};
    const [primed, setPrimed] = useState(undefined);
    // Bumped by reprime(); re-runs the effect below. Deliberately NOT
    // keyed off the query's own timestamps — those change as a result of
    // the refetch this effect performs, which would loop.
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (skip || typeof refetch !== 'function') return undefined;
        let alive = true;
        Promise.resolve(refetch())
            .then((r) => (r && typeof r.unwrap === 'function' ? r.unwrap() : r))
            .then((d) => { if (alive) setPrimed(d ?? null); })
            .catch(() => { if (alive) setPrimed(null); });
        return () => { alive = false; };
    }, [refetch, skip, nonce]);

    const reprime = useCallback(() => setNonce((n) => n + 1), []);

    // Prefer the subscription when it works; fall back to the primed
    // value. When both are present the subscription is the fresher of
    // the two, since tag invalidation drives it directly.
    const value = data !== undefined ? data : primed;
    return { data: value, settled: value !== undefined, reprime };
}
