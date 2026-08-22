/**
 * ConfirmDialog — a small reusable confirmation gate for destructive actions
 * (delink, redeem, reject …) so a stray click can't act immediately.
 *
 * Usage: keep a piece of state holding the pending action, e.g.
 *   const [confirm, setConfirm] = useState(null);   // { title, message, onConfirm }
 *   <ConfirmDialog data={confirm} onClose={() => setConfirm(null)} />
 */
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText,
    DialogTitle,
} from '@mui/material';

export default function ConfirmDialog({ data, onClose, busy = false }) {
    if (!data) return null;
    const {
        title = 'Are you sure?',
        message,
        confirmLabel = 'Confirm',
        confirmColor = 'error',
        severity,
        onConfirm,
    } = data;

    const handleConfirm = async () => {
        await onConfirm?.();
        onClose?.();
    };

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {severity
                    ? <Alert severity={severity} sx={{ mb: 0 }}>{message}</Alert>
                    : <DialogContentText>{message}</DialogContentText>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="contained" color={confirmColor} onClick={handleConfirm} disabled={busy}>
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
