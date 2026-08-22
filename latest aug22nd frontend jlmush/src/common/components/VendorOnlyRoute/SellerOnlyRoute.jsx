import { Navigate } from 'react-router-dom';

import useSellingStatus from '../../hooks/useSellingStatus';

/**
 * SellerOnlyRoute — renders its children on any host that SELLS SaaS
 * tenancies: the vendor apex (as VendorOnlyRoute always allowed) plus
 * an apex reseller's own site (P3 — resellers sell tenancies on their
 * storefront exactly like the vendor does on its own).
 *
 * A plain tenant host — including a reseller's CHILD — redirects away,
 * same rationale as VendorOnlyRoute: the page doesn't exist in that
 * context. Presentation only; the backend refuses signup on
 * non-selling hosts (404 signup_not_available) regardless.
 */
export default function SellerOnlyRoute({ children, redirectTo = '/' }) {
    const { sellsTenancies, resolved } = useSellingStatus();
    // A tenant host's answer is one tiny anonymous request away —
    // render nothing rather than flashing a page we may yank back.
    if (!resolved) return null;
    if (!sellsTenancies) return <Navigate to={redirectTo} replace />;
    return children;
}
