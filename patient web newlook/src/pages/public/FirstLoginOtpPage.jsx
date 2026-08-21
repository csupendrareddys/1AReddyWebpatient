/**
 * FirstLoginOtpPage — phone-OTP login at ``/book/first-login``.
 *
 * Pre-fills the phone number from router state (set by
 * :class:`BookingConfirmationPage`); allows manual entry as a fallback
 * when the visitor lands here from an email/SMS deep link without
 * router state.
 *
 * On a successful OTP login:
 *   * If the user has ``must_set_password=true`` → ``/book/set-password``.
 *   * Otherwise (account pre-existed) → ``/dashboard/patient``.
 *
 * The actual OTP delivery happens server-side during /verify (handled
 * by :class:`PublicDoctorSlotsPage`); a "Resend OTP" button re-uses the
 * existing ``/auth/send-phone-otp`` endpoint.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
    Box, Container, Typography, Paper, Button, Stack, TextField, Alert,
    CircularProgress, useTheme, alpha,
} from '@mui/material';
import LockOpenIcon from '@mui/icons-material/LockOpen';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import {
    useLoginViaOtpMutation,
    useSendLoginOtpMutation,
} from '../../features/publicBooking/publicBookingApi';
import { setUserFromOtpLogin } from '../../features/auth/redux/authSlice';

const RESEND_COOLDOWN_SEC = 30;

export default function FirstLoginOtpPage() {
    return (
        <PublicLandingLayout>
            <FirstLoginContent />
        </PublicLandingLayout>
    );
}

function FirstLoginContent() {
    const theme = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useDispatch();

    const [phoneNumber, setPhoneNumber] = useState(
        location.state?.phoneNumber || '',
    );
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SEC);

    const [loginViaOtp, { isLoading: loggingIn }] = useLoginViaOtpMutation();
    const [sendOtp, { isLoading: resending }] = useSendLoginOtpMutation();

    // Cooldown timer for the resend button — prevents accidental
    // double-tap that would hit the rate limiter.
    useEffect(() => {
        if (resendIn <= 0) return undefined;
        const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(id);
    }, [resendIn]);

    const handleResend = async () => {
        if (!phoneNumber) {
            setError('Enter your phone number first.');
            return;
        }
        setError('');
        try {
            await sendOtp(phoneNumber).unwrap();
            setResendIn(RESEND_COOLDOWN_SEC);
        } catch (err) {
            setError(extractError(err) || 'Could not resend OTP. Please try again.');
        }
    };

    const handleVerify = async () => {
        setError('');
        if (!phoneNumber || !otp) {
            setError('Phone number and OTP are required.');
            return;
        }
        try {
            // authEndpoints mutation expects snake_case ``phone_number``.
            // The camelCase publicBookingApi shim was removed because it
            // collided with the authEndpoints definition on the shared
            // apiSlice and caused intermittent "missing phone_number"
            // 422s depending on module load order.
            const resp = await loginViaOtp({ phone_number: phoneNumber, otp }).unwrap();
            // Mirror the existing login-via-otp consumer:
            // ``resp = {success, data: {user, session_id}}``.
            const data = resp?.data || resp;
            const user = data?.user;
            if (!user) {
                setError('Login response missing user payload.');
                return;
            }
            // Surface the user to the redux auth slice so the patient
            // route guard can read ``must_set_password`` immediately.
            dispatch(setUserFromOtpLogin({ user, sessionId: data.session_id }));

            if (user.must_set_password) {
                navigate('/book/set-password');
            } else {
                navigate('/dashboard/patient');
            }
        } catch (err) {
            setError(extractError(err) || 'Invalid or expired OTP.');
        }
    };

    return (
        <Box>
            <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, sm: 3 } }}>
                <Container maxWidth="sm">
                    <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
                        <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', mb: 2 }}>
                            <Box
                                sx={{
                                    width: 64, height: 64, borderRadius: '50%',
                                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                                    color: 'primary.main',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                <LockOpenIcon sx={{ fontSize: 32 }} />
                            </Box>
                            <Typography variant="h5" fontWeight={800}>First-time sign in</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Enter the OTP we sent to your phone. We'll log you in
                                and walk you through setting a password.
                            </Typography>
                        </Stack>

                        <Stack spacing={2} sx={{ mt: 3 }}>
                            <TextField
                                label="Phone number"
                                size="small" fullWidth required
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                InputProps={{ readOnly: !!location.state?.phoneNumber }}
                            />
                            <TextField
                                label="One-time code"
                                size="small" fullWidth required autoFocus
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\s/g, ''))}
                                inputProps={{ inputMode: 'numeric', maxLength: 8 }}
                            />
                            {error && <Alert severity="error">{error}</Alert>}

                            <Button
                                variant="contained" size="large"
                                onClick={handleVerify}
                                disabled={loggingIn || !phoneNumber || !otp}
                                startIcon={loggingIn ? <CircularProgress size={18} color="inherit" /> : null}
                                sx={{ fontWeight: 700, textTransform: 'none', py: 1.25, borderRadius: 2 }}
                            >
                                {loggingIn ? 'Verifying…' : 'Sign in'}
                            </Button>

                            <Button
                                variant="text"
                                onClick={handleResend}
                                disabled={resendIn > 0 || resending}
                                sx={{ textTransform: 'none' }}
                            >
                                {resendIn > 0 ? `Resend OTP in ${resendIn}s` : 'Resend OTP'}
                            </Button>
                        </Stack>
                    </Paper>
                </Container>
            </Box>
        </Box>
    );
}

function extractError(err) {
    if (!err) return null;
    const env = err.data || err;
    if (typeof env === 'string') return env;
    if (env?.errors && typeof env.errors === 'object') {
        return Object.entries(env.errors)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
            .join(' • ');
    }
    if (env?.error) return typeof env.error === 'string' ? env.error : 'Server error.';
    if (env?.message) return env.message;
    return null;
}
