import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate, useNavigate } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, CircularProgress,
    Alert, Paper, InputAdornment,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import {
    sendPreSignupPhoneOtp,
    verifyPreSignupPhoneOtp,
    storePhoneToken,
    clearPreSignup,
    signup,
    clearSignupSuccess,
} from '../../redux/authSlice';
import { submitSignupWithTokens } from '../../utils/submitSignup';

const RESEND_COOLDOWN = 60;

const PreSignupPhoneOtpPage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { preSignup, signupSuccess, isLoading: signupLoading, error: signupError } = useSelector(
        (state) => state.auth
    );
    const { formData, signupType, phoneToken, otpStatus, otpError, redirect } = preSignup;

    const [otp, setOtp] = useState('');
    const [resendTimer, setResendTimer] = useState(0);
    const [localError, setLocalError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const timerRef = useRef(null);
    const hasSentRef = useRef(false); // Prevents StrictMode double-send

    const phoneNumber = formData?.phone_number;
    const firstName = formData?.first_name;

    // Guard: redirect if no form data (e.g. direct URL access)
    if (!formData) {
        return <Navigate to="/" replace />;
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

    // Auto-send OTP once on mount — useRef guard prevents StrictMode double-send
    useEffect(() => {
        if (phoneNumber && !hasSentRef.current) {
            hasSentRef.current = true;
            dispatch(sendPreSignupPhoneOtp({ phoneNumber, firstName }));
            startResendTimer();
        }
        return () => clearInterval(timerRef.current);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // After signup success (no-email path)
    useEffect(() => {
        if (signupSuccess) {
            // Capture the "Book Now" deep-link before clearPreSignup wipes it;
            // only patients carry it (doctors go to the provider login).
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

    // Verify phone OTP. Two next-step branches:
    //  • Email was supplied → navigate to /auth/signup/verify-email so the
    //    user verifies email ownership before the account is written.
    //  • No email → submit signup directly using the phone token alone.
    const handleVerify = useCallback(async () => {
        if (otp.length !== 6) return;
        setLocalError(null);

        const action = await dispatch(verifyPreSignupPhoneOtp({ phone_number: phoneNumber, otp }));
        if (action.meta.requestStatus !== 'fulfilled') return;

        const token = action.payload?.token;
        if (!token) {
            setLocalError('Verification failed. Please try again.');
            return;
        }

        // Persist token in Redux so it survives navigation and retries.
        dispatch(storePhoneToken(token));

        // Branch on whether the user supplied an email at signup. Doctor
        // signup always supplies one (validator enforces), so doctors
        // always go through the email step.
        const hasEmail = !!formData.email;
        if (hasEmail) {
            navigate('/auth/signup/verify-email');
            return;
        }

        // Phone-only signup — submit immediately with the phone token.
        setIsSubmitting(true);
        const result = await submitSignupWithTokens({
            formData, signupType,
            phoneToken: token,
            emailToken: null,
            dispatch, signupAction: signup,
        });
        setIsSubmitting(false);
        if (!result.ok) {
            setLocalError(result.error);
            return;
        }
        // Doctor path commits in submitSignupWithTokens; nudge UI through
        // the same redirect the JSON path uses on signupSuccess.
        if (signupType === 'doctor') {
            dispatch(clearPreSignup());
            navigate('/auth/service-provider/login', { replace: true });
        }
    }, [otp, phoneNumber, formData, signupType, dispatch, navigate]);

    const handleResend = useCallback(() => {
        if (resendTimer > 0) return;
        setOtp('');
        setLocalError(null);
        hasSentRef.current = true; // mark as handled so auto-send doesn't fire again
        dispatch(sendPreSignupPhoneOtp({ phoneNumber, firstName }));
        startResendTimer();
    }, [resendTimer, phoneNumber, firstName, dispatch]);

    const handleBack = useCallback(() => {
        dispatch(clearPreSignup());
        navigate(-1);
    }, [dispatch, navigate]);

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
                    <PhoneIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
                    <Typography variant="h5" fontWeight={700}>
                        Verify Your Phone
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                        A 6-digit code has been sent to
                    </Typography>
                    <Typography variant="body1" fontWeight={600} mt={0.5}>
                        {phoneNumber}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        (delivered via SMS)
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
                                <PhoneIcon fontSize="small" />
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
                        Back to Signup
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default PreSignupPhoneOtpPage;
