/**
 * Global "Verify your email" banner + OTP dialog.
 *
 * Mounts at the top of every authenticated page (rendered globally from
 * App.jsx). Visible iff the logged-in user has an email on file but
 * `email_verified === false`. Closing the security hole where any
 * unverified email could be used for signin or password reset:
 *
 *  1. Banner shows: "Email not verified — verify to enable email login"
 *  2. User clicks Verify → POST /auth/email/send-verification
 *  3. Dialog opens with OTP input
 *  4. User submits OTP → POST /auth/email/verify
 *  5. Server flips email_verified=True, slice mirrors locally,
 *     banner unmounts.
 *
 * The banner is dismissable for the current session (sessionStorage)
 * so users who don't want to verify right now aren't nagged forever
 * — but the security gate stays on regardless of dismiss state.
 */
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert, Button, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Typography, Box, CircularProgress,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import { sendEmailVerificationOtp, verifyEmailOtp } from '../../redux/authSlice';

const DISMISS_KEY = 'verify_email_banner_dismissed';

export default function VerifyEmailBanner() {
    const dispatch = useDispatch();
    const { isAuthenticated, user } = useSelector((s) => s.auth);

    const [open, setOpen] = useState(false);
    const [otp, setOtp] = useState('');
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);
    const [dismissed, setDismissed] = useState(
        () => sessionStorage.getItem(DISMISS_KEY) === '1'
    );

    // Hide entirely unless: authed, has an email, and it isn't verified.
    if (!isAuthenticated || !user || !user.email || user.email_verified) {
        return null;
    }
    if (dismissed && !open) return null;

    const handleSend = async () => {
        setSending(true);
        setError(null);
        setInfo(null);
        const action = await dispatch(sendEmailVerificationOtp());
        setSending(false);
        if (action.meta.requestStatus === 'fulfilled') {
            setOpen(true);
            setInfo(`Code sent to ${user.email}. Check inbox + spam.`);
        } else {
            setError(action.payload?.message || 'Failed to send verification code.');
        }
    };

    const handleVerify = async () => {
        if (otp.length !== 6) {
            setError('Enter the 6-digit code.');
            return;
        }
        setVerifying(true);
        setError(null);
        const action = await dispatch(verifyEmailOtp({ otp }));
        setVerifying(false);
        if (action.meta.requestStatus === 'fulfilled') {
            setOpen(false);
            setOtp('');
        } else {
            setError(action.payload?.message || 'Invalid OTP.');
        }
    };

    const handleDismiss = () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        setDismissed(true);
    };

    return (
        <>
            <Alert
                severity="warning"
                icon={<EmailIcon />}
                sx={{
                    borderRadius: 0,
                    py: 0.5,
                    '& .MuiAlert-message': { flex: 1 },
                }}
                action={
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            color="inherit"
                            size="small"
                            onClick={handleSend}
                            disabled={sending}
                            startIcon={sending ? <CircularProgress size={14} /> : null}
                        >
                            Verify
                        </Button>
                        <Button color="inherit" size="small" onClick={handleDismiss}>
                            Dismiss
                        </Button>
                    </Box>
                }
            >
                Your email <strong>{user.email}</strong> isn't verified. Email login
                and email-based password reset stay disabled until you verify.
            </Alert>

            <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>Verify your email</DialogTitle>
                <DialogContent>
                    {info && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {info}
                        </Typography>
                    )}
                    <TextField
                        autoFocus
                        fullWidth
                        label="6-digit code"
                        value={otp}
                        onChange={(e) =>
                            setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        inputProps={{
                            inputMode: 'numeric',
                            pattern: '[0-9]*',
                            style: { letterSpacing: 8, fontSize: 24, textAlign: 'center' },
                        }}
                        error={!!error}
                        helperText={error}
                    />
                    <Button
                        onClick={handleSend}
                        disabled={sending}
                        size="small"
                        sx={{ mt: 1 }}
                    >
                        {sending ? 'Sending…' : 'Resend code'}
                    </Button>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button
                        onClick={handleVerify}
                        variant="contained"
                        disabled={verifying || otp.length !== 6}
                        startIcon={verifying ? <CircularProgress size={14} /> : null}
                    >
                        Verify
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
