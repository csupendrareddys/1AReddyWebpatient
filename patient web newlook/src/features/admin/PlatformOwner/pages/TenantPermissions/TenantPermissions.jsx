/**
 * Standalone permission-allocation page (back-compat wrapper).
 *
 * The actual matrix UI now lives in ``TenantPermissionsMatrix`` so
 * the new ``TenantEntitlements`` tabbed page can render it as one
 * of three tabs without duplicating the table/checkbox logic.
 *
 * This page exists only for the legacy
 * ``/dashboard/platform/tenants/<id>/permissions`` route, so a
 * bookmark or any other deep link still works after the icon in
 * the Tenants table was repointed to the new entitlements page.
 */
import {
    Breadcrumbs, Container, Link as MLink, Typography,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';

import { useGetPlatformTenantQuery } from '../../../api/platformEndpoints';
import TenantPermissionsMatrix from './TenantPermissionsMatrix';


const TenantPermissions = () => {
    const { tenantId } = useParams();
    const navigate = useNavigate();
    const tenantQ = useGetPlatformTenantQuery(tenantId);

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            <Breadcrumbs sx={{ mb: 2 }}>
                <MLink
                    component="button" underline="hover"
                    onClick={() => navigate('/dashboard/platform/tenants')}
                >
                    Tenants
                </MLink>
                <Typography color="text.primary">
                    {tenantQ.data?.name || tenantId}
                </Typography>
            </Breadcrumbs>
            <Typography variant="h5" sx={{ mb: 2 }}>
                Permission allocation — {tenantQ.data?.name || '…'}
            </Typography>
            <TenantPermissionsMatrix tenantId={tenantId} />
        </Container>
    );
};

export default TenantPermissions;
