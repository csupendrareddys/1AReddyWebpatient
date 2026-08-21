/**
 * Pre-signup email OTP step.
 *
 * Reached only when the user supplied an email on the signup form
 * (PreSignupPhoneOtpPage navigates here after phone verification).
 * Mirrors the phone OTP flow:
 *
 *   1. Auto-send a 6-digit code to the supplied email via SendClean
 *   2. User enters the code
 *   3. /auth/pre-signup/verify-email-otp returns ``email_verification_token``
 *   4. Final /auth/signup is POSTed with BOTH tokens
 *
 * Closes the unverified-email security hole at the gate — without this
 * step an attacker could squat someone else's email at signup, since
 * email is later usable as a login identifier and password-reset
 * surface.
 *
 * Guards:
 *   • If formData / phoneToken missing → redirect to /
 *   • If email missing in formData → never should land here, but redirect
 *     to phone-only completion just in case (defensive)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate, useNavigate } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, CircularProgress,
    Alert, Paper, InputAdornment,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import {
    sendPreSignupEmailOtp,
    verifyPreSignupEmailOtp,
    storeEmailToken,
    clearPreSignup,
    signup,
    clearSignupSuccess,
} from '../../redux/authSlice';
import { submitSignupWithTokens } from '../../utils/submitSignup';

const RESEND_COOLDOWN = 60;

const PreSignupEmailOtpPage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const {
        preSignup, signupSuccess, isLoading: signupLoading, error: signupError,
    } = useSelector((s) => s.auth);
    const { formData, signupType, phoneToken, otpStatus, otpError, redirect } = preSignup;

    const [otp, setOtp] = useState('');
    const [resendTimer, setResendTimer] = useState(0);
    const [localError, setLocalError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const timerRef = useRef(null);
    const hasSentRef = useRef(false);

    const email = formData?.email;
    const firstName = formData?.first_name;

    // Direct-URL access guard — both formData AND phoneToken must be in
    // state, otherwise the user is here out of order.
    if (!formData || !phoneToken) {
        return <Navigate to="/" replace />;
    }
    // Defensive: if somehow no email, this page shouldn't render at all
    // — bounce to phone page where signup will submit phone-only.
    if (!email) {
        return <Navigate to="/auth/signup/verify-phone" replace />;
    }

    const startResendTimer = () => {
        setResendTimer(RESEND_COOLDOWN);
        clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            setResendTimer((t) => {
                if (t <= 1) { clearInterval(timerRef.current); return 0; }
                return t - 1;
            });
        }, 1000);
    };

    // Auto-send OTP once on mount — useRef guard prevents StrictMode double-send.
    useEffect(() => {
        if (email && !hasSentRef.current) {
            hasSentRef.current = true;
            dispatch(sendPreSignupEmailOtp({ email, firstName }));
            startResendTimer();
        }
        return () => clearInterval(timerRef.current);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Mirror the phone page — patient/pharmacy signups commit via the
    // signup() thunk → signupSuccess flips → we redirect.
    useEffect(() => {
        if (signupSuccess) {
            // Carry the "Book Now" deep-link to the login step (patients only).
            const target = signupType !== 'doctor' ? redirect : null;
            dispatch(clearPreSignup());
            dispatch(clearSignupSuccess());
            const loginPath = signupType === 'doctor'
                ? '/auth/service-provider/login'
                : '/auth/service-receiver/login';
            const to = target
                ? `${loginPath}?redirect=${encodeURIComponent(target)}`
                : loginPath;
            navigate(to, { replace: true });
        }
    }, [signupSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleOtpChange = useCallback((e) => {
        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(val);
        setLocalError(null);
    }, []);

    const handleVerify = useCallback(async () => {
        if (otp.length !== 6) return;
        setLocalError(null);

        const action = await dispatch(verifyPreSignupEmailOtp({ email, otp }));
        if (action.meta.requestStatus !== 'fulfilled') return;

        const token = action.payload?.token;
        if (!token) {
            setLocalError('Verification failed. Please try again.');
            return;
        }
        dispatch(storeEmailToken(token));

        // Both tokens in hand — finalize signup.
        setIsSubmitting(true);
        const result = await submitSignupWithTokens({
            formData, signupType,
            phoneToken,
            emailToken: token,
            dispatch, signupAction: signup,
        });
        setIsSubmitting(false);
        if (!result.ok) {
            setLocalError(result.error);
            return;
        }
        // Doctor path commits inside submitSignupWithTokens — nudge the UI.
        if (signupType === 'doctor') {
            dispatch(clearPreSignup());
            navigate('/auth/service-provider/login', { replace: true });
        }
    }, [otp, email, formData, signupType, phoneToken, dispatch, navigate]);

    const handleResend = useCallback(() => {
        if (resendTimer > 0) return;
        setOtp('');
        setLocalError(null);
        hasSentRef.current = true;
        dispatch(sendPreSignupEmailOtp({ email, firstName }));
        startResendTimer();
    }, [resendTimer, email, firstName, dispatch]);

    const handleBack = useCallback(() => {
        // Back to phone page — keep formData, drop tokens via clearPreSignup
        // would be too aggressive (loses phone token). Just navigate back.
        navigate('/auth/signup/verify-phone');
    }, [navigate]);

    const isSending = otpStatus === 'sending';
    const isVerifying = otpStatus === 'verifying';
    const displayError = localError || otpError || signupError;

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '100vh',
                bgcolor: 'background.default',
                p: 2,
            }}
        >
            <Paper elevation={3} sx={{ p: 4, maxWidth: 420, width: '100%', borderRadius: 2 }}>
                <Box sx={{ textAlign: 'center', mb: 3 }}>
                    <EmailIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
                    <Typography variant="h5" fontWeight={700}>
                        Verify Your Email
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                        A 6-digit code has been sent to
                    </Typography>
                    <Typography variant="body1" fontWeight={600} mt={0.5}>
                        {email}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        (delivered via email — check spam if it's slow)
                    </Typography>
                </Box>

                {displayError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {displayError}
                    </Alert>
                )}

                {isSending && (
                    <Box sx={{ textAlign: 'center', mb: 2 }}>
                        <CircularProgress size={20} />
                        <Typography variant="caption" ml={1}>Sending OTP...</Typography>
                    </Box>
                )}

                <TextField
                    fullWidth
                    label="Enter OTP"
                    value={otp}
                    onChange={handleOtpChange}
                    inputProps={{ maxLength: 6, inputMode: 'numeric' }}
                    placeholder="------"
                    sx={{ mb: 2 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <EmailIcon fontSize="small" />
                            </InputAdornment>
                        ),
                    }}
                />

                <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    onClick={handleVerify}
                    disabled={otp.length !== 6 || isVerifying || signupLoading || isSubmitting}
                    sx={{ mb: 2 }}
                >
                    {isVerifying || signupLoading || isSubmitting
                        ? <CircularProgress size={22} color="inherit" />
                        : 'Verify & Complete Signup'}
                </Button>

                <Box sx={{ textAlign: 'center', mb: 1 }}>
                    <Button
                        variant="text"
                        size="small"
                        onClick={handleResend}
                        disabled={resendTimer > 0 || isSending}
                    >
                        {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
                    </Button>
                </Box>

                <Box sx={{ textAlign: 'center' }}>
                    <Button variant="text" size="small" color="inherit" onClick={handleBack}>
                        Back to Phone Verification
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default PreSignupEmailOtpPage;
