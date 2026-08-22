/**
 * ContactSecurityControls — self-service sign-in identity for admins.
 *
 * ``ContactChangeControl`` changes the admin's own phone or email by
 * proving ownership of the NEW value with an OTP
 * (/admin/contact-change/send-otp → /confirm — the same rail patients
 * use, applied immediately). ``ChangePasswordControl`` fronts
 * /auth/change-password, which revokes every session on success, so it
 * ends by sending the admin back to the login page.
 *
 * Both are level-agnostic: the backend scopes everything to the
 * caller's own user row, so the vendor owner, a tenant admin, and a
 * child-tenant admin all get the same behaviour.
 */
import { useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    Stack, TextField,
} from '@mui/material';

import axiosInstance from '../../../../api/axiosConfig';

const label = (channel) => (channel === 'phone' ? 'phone number' : 'email');

export const ContactChangeControl = ({ channel, onChanged }) => {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const [otp, setOtp] = useState('');
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const reset = () => {
        setValue(''); setOtp(''); setSent(false); setBusy(false);
        setError(null);
    };
    const close = () => { if (!busy) { reset(); setOpen(false); } };

    const send = async () => {
        setBusy(true); setError(null);
        try {
            await axiosInstance.post('/api/v1/admin/contact-change/send-otp',
                { channel, value });
            setSent(true);
        } catch (err) {
            setError(err?.response?.data?.error
                || 'Could not send the code.');
        } finally {
            setBusy(false);
        }
    };

    const confirm = async () => {
        setBusy(true); setError(null);
        try {
            const res = await axiosInstance.post(
                '/api/v1/admin/contact-change/confirm',
                { channel, value, otp });
            const data = res?.data?.data || {};
            onChanged?.(channel === 'phone'
                ? data.phone_number : data.email);
            reset();
            setOpen(false);
        } catch (err) {
            setError(err?.response?.data?.error
                || 'Wrong or expired code.');
            setBusy(false);
        }
    };

    return (
        <>
            <Button size="small" onClick={() => setOpen(true)}>
                Change
            </Button>
            <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
                <DialogTitle>Change {label(channel)}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField
                            autoFocus fullWidth size="small"
                            label={`New ${label(channel)}`}
                            type={channel === 'email' ? 'email' : 'tel'}
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value.trim());
                                setSent(false);
                            }}
                        />
                        {sent && (
                            <>
                                <Alert severity="info">
                                    We sent a 6-digit code to the new{' '}
                                    {label(channel)}. It stays unchanged
                                    until you verify.
                                </Alert>
                                <TextField
                                    fullWidth size="small"
                                    label="6-digit code" value={otp}
                                    inputProps={{ inputMode: 'numeric' }}
                                    onChange={(e) => setOtp(
                                        e.target.value.replace(/\D/g, '')
                                            .slice(0, 6))}
                                />
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={close} disabled={busy}>Cancel</Button>
                    {!sent ? (
                        <Button
                            variant="contained" disabled={!value || busy}
                            onClick={send}
                        >
                            {busy ? 'Sending…' : 'Send code'}
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            disabled={otp.length !== 6 || busy}
                            onClick={confirm}
                        >
                            {busy ? 'Verifying…' : 'Verify & save'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};

export const ChangePasswordControl = () => {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ current: '', next: '', confirm: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    const close = () => {
        if (busy) return;
        setForm({ current: '', next: '', confirm: '' });
        setError(null);
        setOpen(false);
    };

    const submit = async () => {
        setBusy(true); setError(null);
        try {
            await axiosInstance.post('/api/v1/auth/change-password', {
                current_password: form.current,
                new_password: form.next,
                confirm_password: form.confirm,
            });
            setDone(true);
            // Every session (including this one) was revoked — hand the
            // admin straight to login rather than letting the next API
            // call bounce them with a 401.
            setTimeout(() => {
                window.location.assign('/auth/admin/login');
            }, 1800);
        } catch (err) {
            const body = err?.response?.data || {};
            setError(body.error
                || Object.values(body.errors || {}).flat().join(' ')
                || 'Could not change the password.');
            setBusy(false);
        }
    };

    const valid = form.current && form.next.length >= 8
        && form.next === form.confirm;

    return (
        <>
            <Button size="small" variant="outlined"
                onClick={() => setOpen(true)}>
                Change password
            </Button>
            <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
                <DialogTitle>Change password</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        {error && <Alert severity="error">{error}</Alert>}
                        {done ? (
                            <Alert severity="success">
                                Password changed. All sessions are signed
                                out — taking you to the login page…
                            </Alert>
                        ) : (
                            <>
                                <TextField
                                    autoFocus fullWidth size="small"
                                    type="password" label="Current password"
                                    value={form.current}
                                    onChange={(e) => setForm(
                                        { ...form, current: e.target.value })}
                                />
                                <TextField
                                    fullWidth size="small" type="password"
                                    label="New password"
                                    helperText="Min 8 chars with upper, lower, digit, special"
                                    value={form.next}
                                    onChange={(e) => setForm(
                                        { ...form, next: e.target.value })}
                                />
                                <TextField
                                    fullWidth size="small" type="password"
                                    label="Confirm new password"
                                    error={Boolean(form.confirm)
                                        && form.next !== form.confirm}
                                    value={form.confirm}
                                    onChange={(e) => setForm(
                                        { ...form, confirm: e.target.value })}
                                />
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={close} disabled={busy}>
                        {done ? 'Close' : 'Cancel'}
                    </Button>
                    {!done && (
                        <Button
                            variant="contained" disabled={!valid || busy}
                            onClick={submit}
                        >
                            {busy ? 'Changing…' : 'Change password'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};
