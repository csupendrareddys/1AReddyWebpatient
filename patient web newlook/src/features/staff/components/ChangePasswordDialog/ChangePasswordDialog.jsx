/**
 * ChangePasswordDialog — a staff member changing their own password.
 *
 * The confirm field is checked here rather than sent: a typo in it is not
 * something the server should have to reject, and the current password is
 * still what proves the change is theirs to make.
 */
import { useState } from 'react';
import {
    Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, Stack, TextField,
} from '@mui/material';

import { useChangeStaffPasswordMutation } from '../../api/staffEndpoints';

const EMPTY_FORM = { current: '', next: '', confirm: '' };

export default function ChangePasswordDialog({ open, onClose }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState('');
    const [changed, setChanged] = useState(false);
    const [changePassword, { isLoading }] = useChangeStaffPasswordMutation();

    const close = () => {
        setForm(EMPTY_FORM);
        setError('');
        setChanged(false);
        onClose();
    };

    const field = (name) => ({
        value: form[name],
        onChange: (e) => {
            setForm((f) => ({ ...f, [name]: e.target.value }));
            setError('');
        },
    });

    const submit = async () => {
        if (!form.current) {
            setError('Enter your current password');
            return;
        }
        if (form.next.length < 8) {
            setError('Your new password must be at least 8 characters');
            return;
        }
        if (form.next !== form.confirm) {
            setError('The two new passwords do not match');
            return;
        }
        try {
            await changePassword({
                currentPassword: form.current, newPassword: form.next,
            }).unwrap();
            setChanged(true);
        } catch (err) {
            setError(err?.data?.message || err?.data?.error || 'Could not change your password');
        }
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
            <DialogTitle>Change password</DialogTitle>
            <DialogContent>
                {changed ? (
                    <Alert severity="success" sx={{ mt: 1 }}>
                        Your password has been changed. Use the new one the next time you
                        sign in.
                    </Alert>
                ) : (
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField
                            label="Current password" type="password" size="small"
                            fullWidth autoFocus {...field('current')}
                        />
                        <TextField
                            label="New password" type="password" size="small" fullWidth
                            helperText="At least 8 characters" {...field('next')}
                        />
                        <TextField
                            label="Confirm new password" type="password" size="small"
                            fullWidth {...field('confirm')}
                        />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>{changed ? 'Close' : 'Cancel'}</Button>
                {!changed && (
                    <Button
                        variant="contained" onClick={submit} disabled={isLoading}
                        startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : null}
                    >
                        Change password
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
