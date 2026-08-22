/**
 * StaffModuleGuard — mount a practice screen only if this staff member holds a
 * view grant on one of the modules behind it.
 *
 * This is a courtesy, not the lock. The endpoints each screen calls are gated
 * server-side by ``@provider_access``, so a staff member who edits the URL gets
 * a page of 403s rather than data. What this adds is a straight answer instead
 * of a screen that renders empty and looks broken — "you don't have this" reads
 * very differently from "this is broken", and only one of them is true.
 */
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { Link } from 'react-router-dom';

import useStaffAccess from '../../hooks/useStaffAccess';

const StaffModuleGuard = ({ entryKey, children }) => {
    const { isLoading, screens, provider } = useStaffAccess();

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    // One path can be reached by more than one entry when the same screen sits
    // at a different catalog path per vertical; holding either opens it.
    const wanted = Array.isArray(entryKey) ? entryKey : [entryKey];
    if (!screens.some((screen) => wanted.includes(screen.key))) {
        return (
            <Alert
                severity="warning"
                action={(
                    <Button color="inherit" size="small" component={Link} to="/dashboard/staff">
                        Back to dashboard
                    </Button>
                )}
            >
                You don&apos;t have access to this screen. Ask
                {' '}{provider?.name || 'your practice'} to grant it.
            </Alert>
        );
    }

    return children;
};

export default StaffModuleGuard;
