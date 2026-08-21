/**
 * SharedSnackbar — global toast consumer for ``adminSharedUiSlice``.
 *
 * The slice has been around for a while (hooks across multiple admin
 * pages call ``dispatch(setSnackbar(...))``), but no component was
 * ever subscribed to the state. So every error / success notification
 * that flowed through the shared slice — including the 409 from
 * creating a duplicate-tier membership plan — disappeared silently.
 *
 * This component is mounted once at the AdminLayout level so every
 * admin page benefits without each having to repeat snackbar plumbing.
 * Existing pages with their own LOCAL snackbar state keep working
 * unchanged (this consumer only fires when the SHARED slice is used).
 */
import { Alert, Snackbar } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';

import { clearSnackbar } from '../../../redux/adminSharedUiSlice';


export default function SharedSnackbar() {
    const snackbar = useSelector((state) => state.adminSharedUi?.snackbar);
    const dispatch = useDispatch();

    if (!snackbar) return null;

    return (
        <Snackbar
            open={!!snackbar.open}
            autoHideDuration={snackbar.severity === 'error' ? 8000 : 4000}
            onClose={(_, reason) => {
                // Don't auto-dismiss on click-away when it's an error —
                // operator should explicitly acknowledge what failed.
                if (reason === 'clickaway' && snackbar.severity === 'error') return;
                dispatch(clearSnackbar());
            }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
            <Alert
                severity={snackbar.severity || 'info'}
                variant="filled"
                onClose={() => dispatch(clearSnackbar())}
                elevation={6}
                sx={{ minWidth: 280 }}
            >
                {snackbar.message}
            </Alert>
        </Snackbar>
    );
}
