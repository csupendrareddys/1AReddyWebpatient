/**
 * Redirect away from the back-compat ``/dashboard/admin/landing-config`` URL.
 *
 * The legacy route used to mount the tenant editor under a confusingly
 * generic name, which let platform_owners land there and save edits into
 * the per-tenant ``landing_configs`` table — those edits never reached the
 * apex marketing site, which reads from ``platform_landing_configs``.
 *
 * Role-aware redirect with deep-link preservation:
 *   * platform_owner → ``/dashboard/platform/landing-config[/...]`` — the
 *     module + feature deep links exist on the platform tree too now, so
 *     the URL survives the redirect end-to-end.
 *   * everyone else → ``/dashboard/admin/tenant-landing[/...]`` (the
 *     proper tenant editor — same component, ``mode='tenant'``).
 */
import { Navigate, useParams } from 'react-router-dom';
import usePermissions from '../../../../../common/hooks/usePermissions';

const LegacyLandingConfigRedirect = ({ subpath = '' }) => {
    const { isPlatformOwner } = usePermissions();
    const { moduleId, slug } = useParams();
    const root = isPlatformOwner
        ? '/dashboard/platform/landing-config'
        : '/dashboard/admin/tenant-landing';

    let target = root;
    if (subpath === 'modules' && moduleId) {
        target = `${root}/modules/${moduleId}`;
    } else if (subpath === 'features' && moduleId && slug) {
        target = `${root}/modules/${moduleId}/features/${slug}`;
    }
    return <Navigate to={target} replace />;
};

export default LegacyLandingConfigRedirect;
