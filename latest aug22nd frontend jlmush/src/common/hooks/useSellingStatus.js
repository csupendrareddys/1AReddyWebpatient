/**
 * useSellingStatus — does the CURRENT host sell SaaS tenancies?
 *
 * Vendor hosts answer immediately (no request). Tenant hosts ask the
 * anonymous ``/api/v1/public/selling-status`` endpoint, which says
 * whether this site is an apex reseller's storefront. Backed by the
 * same imperative-unwrap priming as PublicLandingLayout — the RTK
 * selector can wedge at ``pending`` while the request already 200'd,
 * and a wedged guard would blank the pricing page forever.
 *
 * Returns { sellsTenancies, seller: 'vendor'|'reseller'|null, resolved }.
 * ``resolved`` is false only while a tenant host's answer is in flight.
 */
import { useEffect, useState } from 'react';

import useIsOnPlatformDomain from './useIsOnPlatformDomain';
import { useGetPublicSellingStatusQuery } from '../../features/admin/api/publicEndpoints';

export default function useSellingStatus() {
    const isVendorHost = useIsOnPlatformDomain();
    const q = useGetPublicSellingStatusQuery(undefined, { skip: isVendorHost });
    const { refetch } = q;
    const [primed, setPrimed] = useState(null);

    useEffect(() => {
        if (isVendorHost) return undefined;
        let alive = true;
        Promise.resolve(refetch())
            .then((r) => (r && typeof r.unwrap === 'function' ? r.unwrap() : r))
            .then((d) => { if (alive) setPrimed(d || { sells_tenancies: false }); })
            // Fail CLOSED: an unreachable backend hides the storefront
            // rather than advertising plans the signup can't honour.
            .catch(() => { if (alive) setPrimed({ sells_tenancies: false }); });
        return () => { alive = false; };
    }, [isVendorHost, refetch]);

    if (isVendorHost) {
        return {
            sellsTenancies: true, seller: 'vendor', resolved: true,
            showPricingNav: true,
        };
    }
    const data = q.data || primed;
    return {
        sellsTenancies: !!data?.sells_tenancies,
        seller: data?.seller || null,
        resolved: data != null,
        // Apex label knob (see /public/selling-status). Absent field --
        // older backend -- reads as "show", matching prior behaviour.
        showPricingNav: data?.show_pricing_nav !== false,
    };
}
