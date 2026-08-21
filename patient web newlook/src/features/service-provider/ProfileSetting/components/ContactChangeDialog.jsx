/**
 * ContactChangeDialog — a doctor changes their phone or email in two steps:
 *   1. enter the new value  → we send a 6-digit OTP to it,
 *   2. enter the OTP        → we verify it and submit the change to the admin
 *                             approval queue (it takes effect after approval).
 */
import { useEffect, useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    Stack, TextField, Typography,
} from '@mui/material';

import {
    useSendDoctorContactOtpMutation,
    useVerifyDoctorContactChangeMutation,
} from '../api/contactChangeEndpoints';

export default function ContactChangeDialog({ open, onClose, channel, currentValue }) {
    const isPhone = channel === 'phone';
    const label = isPhone ? 'phone number' : 'email';

    const [step, setStep] = useState(1);
    const [value, setValue] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState(null);
    const [done, setDone] = useState(null);

    const [sendOtp, { isLoading: sending }] = useSendDoctorContactOtpMutation();
    const [verify, { isLoading: verifying }] = useVerifyDoctorContactChangeMutation();

    useEffect(() => {
        if (open) { setStep(1); setValue(''); setOtp(''); setError(null); setDone(null); }
    }, [open]);

    const errMsg = (e) => e?.data?.message || e?.data?.error || 'Something went wrong.';

    const onSend = async () => {
        setError(null);
        try {
            await sendOtp({ channel, value: value.trim() }).unwrap();
            setStep(2);
        } catch (e) { setError(errMsg(e)); }
    };

    const onVerify = async () => {
        setError(null);
        try {
            const res = await verify({ channel, value: value.trim(), otp: otp.trim() }).unwrap();
            setDone(res?.message || `Your new ${label} was sent to the admin for approval.`);
            setStep(3);
        } catch (e) { setError(errMsg(e)); }
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Change {label}</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {step === 1 && (
                    <Stack spacing={1.5}>
                        {currentValue && (
                            <Typography variant="body2" color="text.secondary">
                                Current: {currentValue}
                            </Typography>
                        )}
                        <TextField
                            autoFocus fullWidth
                            label={`New ${label}`}
                            type={isPhone ? 'tel' : 'email'}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                        />
                        <Typography variant="caption" color="text.secondary">
                            We'll send a verification code to your new {label}. Changes take
                            effect only after an admin approves them.
                        </Typography>
                    </Stack>
                )}

                {step === 2 && (
                    <Stack spacing={1.5}>
                        <Typography variant="body2">
                            Enter the 6-digit code sent to <b>{value.trim()}</b>.
                        </Typography>
                        <TextField
                            autoFocus fullWidth label="Verification code"
                            value={otp} onChange={(e) => setOtp(e.target.value)}
                            inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                        />
                        <Button size="small" onClick={onSend} disabled={sending} sx={{ alignSelf: 'flex-start' }}>
                            Resend code
                        </Button>
                    </Stack>
                )}

                {step === 3 && (
                    <Alert severity="success">{done}</Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{step === 3 ? 'Close' : 'Cancel'}</Button>
                {step === 1 && (
                    <Button variant="contained" onClick={onSend} disabled={sending || !value.trim()}>
                        {sending ? 'Sending…' : 'Send code'}
                    </Button>
                )}
                {step === 2 && (
                    <Button variant="contained" onClick={onVerify} disabled={verifying || otp.trim().length < 4}>
                        {verifying ? 'Verifying…' : 'Verify & submit'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
