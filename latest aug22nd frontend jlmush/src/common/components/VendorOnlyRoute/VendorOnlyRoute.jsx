import { Navigate } from 'react-router-dom';

import useIsOnPlatformDomain from '../../hooks/useIsOnPlatformDomain';

/**
 * VendorOnlyRoute — renders its children only on the SaaS vendor's host.
 *
 * The same JS bundle is served from the vendor apex AND from every
 * customer tenant's domain, so "is this page allowed here?" is a
 * host question, not a role question.
 *
 * Why this exists: pages that SELL the SaaS (pricing, tenant signup,
 * checkout) must never appear on a customer's own domain. A clinic's
 * patients landing on their clinic's site should not be offered a
 * subscription to the platform their clinic happens to run on — it
 * leaks the vendor relationship and reads as the clinic reselling
 * software. Before the vendor/customer split this could not happen
 * because the vendor WAS the apex tenant; now that the vendor is a
 * separate row, the bundle needs an explicit guard.
 *
 * Non-vendor hosts are redirected rather than shown an error: the page
 * is not "forbidden", it simply does not exist in that context.
 *
 * This is presentation only. It hides a marketing surface; it is not an
 * authorization boundary. Tenant provisioning is still gated server-side
 * (``/api/v1/public/signup/tenant`` validates the plan and slug, and every
 * vendor operation lives behind ``@role_required(PLATFORM_OWNER)``).
 */
export default function VendorOnlyRoute({ children, redirectTo = '/' }) {
    const isVendorHost = useIsOnPlatformDomain();
    if (!isVendorHost) return <Navigate to={redirectTo} replace />;
    return children;
}
