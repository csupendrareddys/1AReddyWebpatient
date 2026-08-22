/**
 * DeleteAccountSection — the "danger zone" card mounted at the bottom of
 * every profile-settings page (patient / doctor / admin).
 *
 * Calls ``POST /auth/account/delete`` which deactivates + anonymizes the
 * AUTH identity only — medical records are retained under statutory
 * retention, which is exactly what the copy tells the user. The backend
 * re-authenticates with the current password and refuses with a coded 409
 * when the account still anchors something (last super admin, upcoming
 * appointments, managed minors, facility login); those messages are shown
 * verbatim so the user knows what to resolve first.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent,
    DialogContentText, DialogTitle, Paper, TextField, Typography,
} from '@mui/material';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import axiosInstance from '../../../api/axiosConfig';
import { logoutUser } from '../../../features/auth/redux/authSlice';

export default function DeleteAccountSection({ loginPath = '/' }) {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const close = () => {
        if (busy) return;
        setOpen(false);
        setPassword('');
        setReason('');
        setError(null);
    };

    const onDelete = async () => {
        setBusy(true);
        setError(null);
        try {
            await axiosInstance.post('/api/v1/auth/account/delete', {
                password, reason: reason.trim() || undefined,
            });
            // The backend has already revoked every session — clear the
            // local auth state and land on the login page.
            await dispatch(logoutUser());
            navigate(loginPath, { replace: true });
        } catch (e) {
            const data = e?.response?.data || {};
            setError(data.error || data.message
                || 'Could not delete the account. Please try again.');
            setBusy(false);
        }
    };

    return (
        <Paper variant="outlined"
            sx={{ p: 3, mt: 4, borderColor: 'error.light' }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Delete account
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Deleting your account removes your login and personal contact
                details permanently. Medical records are retained as required
                by law, but they will no longer be linked to your identity.
                This cannot be undone.
            </Typography>
            <Button color="error" variant="outlined"
                startIcon={<DeleteForeverIcon />}
                onClick={() => setOpen(true)}>
                Delete my account
            </Button>

            <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        This is permanent. Enter your current password to
                        confirm.
                    </DialogContentText>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    )}
                    <TextField autoFocus fullWidth size="small" type="password"
                        label="Current password" value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        sx={{ mb: 2 }} />
                    <TextField fullWidth size="small" multiline minRows={2}
                        label="Reason (optional)" value={reason}
                        onChange={(e) => setReason(e.target.value)} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={close} disabled={busy}>Cancel</Button>
                    <Box sx={{ flex: 1 }} />
                    <Button color="error" variant="contained"
                        disabled={busy || !password}
                        onClick={onDelete}>
                        {busy ? 'Deleting…' : 'Delete forever'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
