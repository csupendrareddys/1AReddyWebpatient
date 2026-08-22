/**
 * ChangePasswordDialog — a caregiver changes their own password. Their login was
 * created for them by the patient, so replacing that first password without
 * going back to the patient is the point (mirrors the provider-staff dialog).
 */
import { useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';

import { useChangePatientStaffPasswordMutation } from '../api/supportStaffEndpoints';

const BLANK = { current: '', next: '', confirm: '' };

export default function ChangePasswordDialog({ open, onClose }) {
    const [change, { isLoading }] = useChangePatientStaffPasswordMutation();
    const [form, setForm] = useState(BLANK);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async () => {
        setError(null);
        if (form.next.length < 8) { setError('New password must be at least 8 characters.'); return; }
        if (form.next !== form.confirm) { setError('New passwords do not match.'); return; }
        try {
            await change({ currentPassword: form.current, newPassword: form.next }).unwrap();
            setDone(true);
            setForm(BLANK);
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Could not change your password.');
        }
    };

    const close = () => { setDone(false); setError(null); setForm(BLANK); onClose(); };

    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
            <DialogTitle>Change password</DialogTitle>
            <DialogContent dividers>
                {done ? (
                    <Alert severity="success">Your password was updated.</Alert>
                ) : (
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField type="password" label="Current password" value={form.current} onChange={set('current')} autoFocus />
                        <TextField type="password" label="New password" value={form.next} onChange={set('next')} helperText="At least 8 characters" />
                        <TextField type="password" label="Confirm new password" value={form.confirm} onChange={set('confirm')} />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>{done ? 'Done' : 'Cancel'}</Button>
                {!done && (
                    <Button variant="contained" onClick={submit}
                        disabled={isLoading || !form.current || !form.next || !form.confirm}>
                        {isLoading ? 'Saving…' : 'Change password'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
