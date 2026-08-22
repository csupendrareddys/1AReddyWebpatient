/**
 * RequirePlatformModule — page-level access gate for vendor-console
 * routes.
 *
 * The route guard already admits only the platform owner and vendor
 * staff; this narrows to the module a page manages, so a sub-admin
 * deep-linking to a console page their role doesn't grant sees an
 * honest "no access" notice instead of the page's empty state ("No
 * add-ons yet" read as truth, not as a wall). The backend 403s every
 * call regardless — this is presentation, not the security boundary.
 *
 * ``modules`` — one module key or an array; view on ANY of them opens
 * the page (the entitlements page spans two modules, for example).
 */
import {
    Alert, Box, Button, CircularProgress, Container, Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useNavigate } from 'react-router-dom';

import usePermissions from '../../hooks/usePermissions';

const RequirePlatformModule = ({ modules, label = 'this area', children }) => {
    const navigate = useNavigate();
    const { can, hasFullAccess, isLoading } = usePermissions();
    const list = Array.isArray(modules) ? modules : [modules];

    // Owner / vendor super-admin: immediate. Sub-admins wait for their
    // permission set so we never flash "no access" during hydration.
    if (!hasFullAccess && isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress size={22} />
            </Box>
        );
    }

    const allowed = hasFullAccess || list.some((m) => can(m, 'view'));
    if (!allowed) {
        return (
            <Container maxWidth="sm" sx={{ py: 8 }}>
                <Alert severity="warning" icon={<LockOutlinedIcon />}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        You don&apos;t have access to {label}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                        Your role doesn&apos;t include this part of the
                        console. Ask the platform owner to grant it, then
                        refresh.
                    </Typography>
                    <Button
                        size="small" variant="outlined" sx={{ mt: 1.5 }}
                        onClick={() => navigate('/dashboard/admin')}
                    >
                        Back to dashboard
                    </Button>
                </Alert>
            </Container>
        );
    }
    return children;
};

export default RequirePlatformModule;
