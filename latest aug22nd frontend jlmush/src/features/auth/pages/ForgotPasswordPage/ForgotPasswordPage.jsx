import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    TextField,
    Button,
    Typography,
    Link,
    Alert,
    CircularProgress,
    InputAdornment,
    IconButton,
    Stepper,
    Step,
    StepLabel,
} from '@mui/material';
import AlternateEmailOutlinedIcon from '@mui/icons-material/AlternateEmailOutlined';
import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import {
    useForgotPasswordMutation,
    useVerifyResetOtpMutation,
    useResetPasswordMutation,
} from '../../api/authEndpoints';
import PasswordStrengthIndicator from '../../components/PasswordStrengthIndicator/PasswordStrengthIndicator';

const STEPS = ['Identify', 'Verify OTP', 'New Password'];

// ── Identifier helpers ──────────────────────────────────────────────────────
// The backend's /forgot-password + /verify-reset-otp routes accept a
// generic ``identifier`` key (email OR 10-digit phone). Mirror the
// LoginForm's detection so the same input field works for both.
const detectIdentifierKind = (raw) => {
    if (!raw) return null;
    const v = raw.replace(/\s/g, '');
    if (v.includes('@')) return 'email';
    if (/^[6-9]\d{9}$/.test(v)) return 'phone';
    return null;
};

const maskIdentifier = (raw) => {
    if (!raw) return '';
    const kind = detectIdentifierKind(raw);
    if (kind === 'email') {
        const [local, domain] = raw.split('@');
        if (!local || !domain) return raw;
        const head = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
        return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
    }
    if (kind === 'phone') {
        const v = raw.replace(/\s/g, '');
        return `XXXXXX${v.slice(-4)}`;
    }
    return raw;
};

const ForgotPasswordPage = () => {
    const navigate = useNavigate();

    // Step state: 0 = identifier, 1 = OTP, 2 = new password, 3 = success
    const [step, setStep] = useState(0);
    const [identifier, setIdentifier] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [resetToken, setResetToken] = useState('');
    const [validationError, setValidationError] = useState('');
    const [resendTimer, setResendTimer] = useState(0); // seconds remaining
    const timerRef = useRef(null);

    // Start 60-second countdown whenever we enter the OTP step
    useEffect(() => {
        if (step === 1) {
            setResendTimer(60);
            timerRef.current = setInterval(() => {
                setResendTimer((prev) => {
                    if (prev <= 1) {
                        clearInterval(timerRef.current);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timerRef.current);
    }, [step]);

    const [forgotPassword, { isLoading: sendingOtp }] = useForgotPasswordMutation();
    const [verifyOtp, { isLoading: verifyingOtp }] = useVerifyResetOtpMutation();
    const [resetPassword, { isLoading: resettingPw }] = useResetPasswordMutation();

    const isLoading = sendingOtp || verifyingOtp || resettingPw;
    const identifierKind = detectIdentifierKind(identifier);

    // ── Step 0: Submit identifier (email or phone) ─────────────────────────
    const handleIdentifierSubmit = async (e) => {
        e.preventDefault();
        setValidationError('');
        const trimmed = identifier.trim();
        if (!trimmed) {
            setValidationError('Email or mobile number is required');
            return;
        }
        const kind = detectIdentifierKind(trimmed);
        if (!kind) {
            setValidationError(
                'Enter a valid email address or 10-digit mobile number (starting with 6-9).'
            );
            return;
        }
        // Normalise the stored value (strip whitespace for phones, lowercase emails)
        const normalised = kind === 'phone'
            ? trimmed.replace(/\s/g, '')
            : trimmed.toLowerCase();
        setIdentifier(normalised);
        try {
            await forgotPassword(normalised).unwrap();
        } catch (_) {
            // Always proceed to OTP step (prevent enumeration)
        }
        setStep(1);
    };

    // ── Step 1: Verify OTP ────────────────────────────────────────────────────
    const handleOtpSubmit = async (e) => {
        e.preventDefault();
        setValidationError('');
        if (!otp.trim() || otp.length !== 6) {
            setValidationError('Please enter the 6-digit OTP');
            return;
        }
        try {
            const result = await verifyOtp({ identifier, otp }).unwrap();
            const token = result?.data?.token || result?.token;
            if (!token) throw new Error('No token returned');
            setResetToken(token);
            setStep(2);
        } catch (err) {
            const msg =
                err?.data?.message ||
                err?.data?.error ||
                'Invalid or expired OTP. Please try again.';
            setValidationError(msg);
        }
    };

    // ── Step 2: Set new password ──────────────────────────────────────────────
    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setValidationError('');
        if (!newPassword) {
            setValidationError('New password is required');
            return;
        }
        if (newPassword.length < 8) {
            setValidationError('Password must be at least 8 characters');
            return;
        }
        if (newPassword !== confirmPassword) {
            setValidationError('Passwords do not match');
            return;
        }
        try {
            await resetPassword({ token: resetToken, new_password: newPassword }).unwrap();
            setStep(3);
        } catch (err) {
            const msg =
                err?.data?.message ||
                err?.data?.error ||
                'Failed to reset password. Please try again.';
            setValidationError(msg);
        }
    };

    // ── Success ───────────────────────────────────────────────────────────────
    if (step === 3) {
        return (
            <Box sx={{ textAlign: 'center', width: '100%' }}>
                <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main', mb: 1 }} />
                <Typography variant="h5" fontWeight={700} gutterBottom>
                    Password Reset!
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Your password has been updated successfully. All active sessions have been
                    logged out for security.
                </Typography>
                <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    onClick={() => navigate(-1)}
                >
                    Back to Login
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {/* Icon */}
            <Box
                sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    bgcolor: 'primary.light',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                }}
            >
                <LockResetOutlinedIcon sx={{ fontSize: 28, color: 'primary.main' }} />
            </Box>

            <Typography variant="h5" component="h1" fontWeight={700} gutterBottom align="center">
                Forgot Password
            </Typography>

            {/* Stepper */}
            <Stepper activeStep={step} sx={{ width: '100%', mb: 3 }}>
                {STEPS.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Error */}
            {validationError && (
                <Alert severity="error" sx={{ mb: 2, width: '100%' }}>
                    {validationError}
                </Alert>
            )}

            {/* ── Step 0: Identifier (email OR phone) ── */}
            {step === 0 && (
                <Box component="form" onSubmit={handleIdentifierSubmit} sx={{ width: '100%' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Enter your registered <strong>email address</strong> or{' '}
                        <strong>10-digit mobile number</strong>. We'll send a 6-digit OTP via
                        SMS (and email too, if your account has a verified email on file).
                    </Typography>
                    <TextField
                        fullWidth
                        id="forgot-password-identifier"
                        label="Email or Mobile Number"
                        type="text"
                        value={identifier}
                        onChange={(e) => {
                            setIdentifier(e.target.value);
                            setValidationError('');
                        }}
                        margin="normal"
                        autoComplete="username"
                        autoFocus
                        placeholder="you@example.com or 9876543210"
                        helperText={
                            identifierKind === 'email'
                                ? 'Detected: email'
                                : identifierKind === 'phone'
                                    ? 'Detected: mobile number'
                                    : ' '
                        }
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <AlternateEmailOutlinedIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={isLoading}
                        sx={{ mt: 2, mb: 2, py: 1.5 }}
                    >
                        {isLoading ? <CircularProgress size={24} color="inherit" /> : 'Send OTP'}
                    </Button>
                    <Box sx={{ textAlign: 'center' }}>
                        <Link
                            component="button"
                            type="button"
                            variant="body2"
                            onClick={() => navigate(-1)}
                            underline="hover"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                        >
                            <ArrowBackIcon fontSize="small" /> Back to Login
                        </Link>
                    </Box>
                </Box>
            )}

            {/* ── Step 1: OTP ── */}
            {step === 1 && (
                <Box component="form" onSubmit={handleOtpSubmit} sx={{ width: '100%' }}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        If an account exists for{' '}
                        <strong>{maskIdentifier(identifier)}</strong>, a 6-digit OTP has been
                        sent via SMS (and email, where available).
                    </Alert>
                    <TextField
                        fullWidth
                        id="reset-otp"
                        label="6-Digit OTP"
                        value={otp}
                        onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                            setOtp(val);
                            setValidationError('');
                        }}
                        margin="normal"
                        autoFocus
                        inputProps={{ maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' }}
                        placeholder="Enter 6-digit OTP"
                        sx={{
                            '& input': {
                                fontSize: '1.5rem',
                                letterSpacing: '0.5rem',
                                textAlign: 'center',
                            },
                        }}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={isLoading || otp.length !== 6}
                        sx={{ mt: 2, mb: 1, py: 1.5 }}
                    >
                        {isLoading ? <CircularProgress size={24} color="inherit" /> : 'Verify OTP'}
                    </Button>
                    <Button
                        fullWidth
                        variant="text"
                        size="small"
                        disabled={resendTimer > 0 || isLoading}
                        onClick={() => { setStep(0); setOtp(''); setValidationError(''); }}
                        sx={{ mb: 1 }}
                    >
                        {resendTimer > 0
                            ? `Resend OTP in ${resendTimer}s`
                            : 'Resend OTP'}
                    </Button>
                </Box>
            )}

            {/* ── Step 2: New Password ── */}
            {step === 2 && (
                <Box component="form" onSubmit={handlePasswordSubmit} sx={{ width: '100%' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        OTP verified! Choose a strong new password.
                    </Typography>
                    <TextField
                        fullWidth
                        id="reset-new-password"
                        label="New Password"
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); setValidationError(''); }}
                        margin="normal"
                        autoComplete="new-password"
                        autoFocus
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                    {newPassword && <PasswordStrengthIndicator password={newPassword} />}
                    <TextField
                        fullWidth
                        id="reset-confirm-password"
                        label="Confirm New Password"
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setValidationError(''); }}
                        margin="normal"
                        autoComplete="new-password"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton onClick={() => setShowConfirm(!showConfirm)} edge="end">
                                        {showConfirm ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={isLoading}
                        sx={{ mt: 2, mb: 2, py: 1.5 }}
                    >
                        {isLoading ? <CircularProgress size={24} color="inherit" /> : 'Reset Password'}
                    </Button>
                </Box>
            )}
        </Box>
    );
};

export default ForgotPasswordPage;
