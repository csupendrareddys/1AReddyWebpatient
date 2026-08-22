import { Navigate } from 'react-router-dom';

import useIsOnPlatformDomain from '../../hooks/useIsOnPlatformDomain';

/**
 * TenantOnlyRoute — the mirror of {@link VendorOnlyRoute}.
 *
 * Renders its children only on a CUSTOMER tenant's host, redirecting on
 * the SaaS vendor's apex.
 *
 * These are the product's own public surfaces — the marketplace
 * (``/join``), service and module pages, and patient booking. They only
 * mean something in the context of a specific tenant that actually sells
 * services. The vendor sells software, not consultations: it has no
 * verticals, no providers and no bookable slots, so serving these there
 * renders a convincingly-branded empty shell that looks like a broken
 * product rather than a page that does not apply.
 *
 * Before the vendor/customer split this was unnecessary — the apex WAS a
 * clinic tenant, so its marketplace was genuinely populated. Now that the
 * vendor is a separate, product-free row, these routes need an explicit
 * home.
 *
 * Presentation only, same as VendorOnlyRoute: the backend already scopes
 * every one of these reads to the resolved tenant, so the vendor host
 * would return empty results rather than another tenant's data.
 */
export default function TenantOnlyRoute({ children, redirectTo = '/' }) {
    const isVendorHost = useIsOnPlatformDomain();
    if (isVendorHost) return <Navigate to={redirectTo} replace />;
    return children;
}
