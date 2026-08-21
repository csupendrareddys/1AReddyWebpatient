import { useState } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
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
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useResetPasswordMutation } from '../../api/authEndpoints';
import PasswordStrengthIndicator from '../../components/PasswordStrengthIndicator/PasswordStrengthIndicator';

const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [success, setSuccess] = useState(false);

    const [resetPassword, { isLoading, error }] = useResetPasswordMutation();

    // If no token in URL, show invalid link state immediately
    const hasToken = Boolean(token);

    const validate = () => {
        if (!newPassword) {
            setValidationError('New password is required');
            return false;
        }
        if (newPassword.length < 8) {
            setValidationError('Password must be at least 8 characters');
            return false;
        }
        if (newPassword !== confirmPassword) {
            setValidationError('Passwords do not match');
            return false;
        }
        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setValidationError('');
        if (!validate()) return;

        try {
            await resetPassword({ token, new_password: newPassword }).unwrap();
            setSuccess(true);
            // Redirect to login after 3 seconds
            setTimeout(() => navigate('/auth/service-receiver/login'), 3000);
        } catch (err) {
            // Error handled via RTK Query error state
        }
    };

    const apiError =
        error?.data?.message ||
        error?.data?.error ||
        (error?.status === 400 ? 'Invalid or expired reset link. Please request a new one.' : null);

    // No token in URL
    if (!hasToken) {
        return (
            <Box sx={{ textAlign: 'center', width: '100%' }}>
                <ErrorOutlineIcon sx={{ fontSize: 56, color: 'error.main', mb: 1 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>
                    Invalid Reset Link
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    This password reset link is invalid or missing. Please request a new one.
                </Typography>
                <Button
                    variant="contained"
                    fullWidth
                    onClick={() => navigate('/auth/forgot-password')}
                >
                    Request New Reset Link
                </Button>
            </Box>
        );
    }

    // Success state
    if (success) {
        return (
            <Box sx={{ textAlign: 'center', width: '100%' }}>
                <CheckCircleOutlineIcon sx={{ fontSize: 56, color: 'success.main', mb: 1 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>
                    Password Reset Successful!
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Your password has been updated. All your active sessions have been logged out
                    for security. Redirecting to login…
                </Typography>
                <Button
                    variant="contained"
                    fullWidth
                    onClick={() => navigate('/auth/service-receiver/login')}
                >
                    Go to Login
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {/* Icon */}
            <Box
                sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bgcolor: 'primary.light',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                }}
            >
                <LockOutlinedIcon sx={{ fontSize: 32, color: 'primary.main' }} />
            </Box>

            <Typography variant="h5" component="h1" fontWeight={700} gutterBottom align="center">
                Set New Password
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
                Choose a strong password for your account.
            </Typography>

            <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%' }}>
                {(validationError || apiError) && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {validationError || apiError}
                        {apiError && (
                            <>
                                {' '}
                                <Link
                                    component={RouterLink}
                                    to="/auth/forgot-password"
                                    underline="hover"
                                >
                                    Request a new link
                                </Link>
                            </>
                        )}
                    </Alert>
                )}

                <TextField
                    fullWidth
                    id="reset-new-password"
                    label="New Password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => {
                        setNewPassword(e.target.value);
                        setValidationError('');
                    }}
                    margin="normal"
                    autoComplete="new-password"
                    autoFocus
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={() => setShowPassword(!showPassword)}
                                    edge="end"
                                >
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                {/* Password strength indicator */}
                {newPassword && <PasswordStrengthIndicator password={newPassword} />}

                <TextField
                    fullWidth
                    id="reset-confirm-password"
                    label="Confirm New Password"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setValidationError('');
                    }}
                    margin="normal"
                    autoComplete="new-password"
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={() => setShowConfirm(!showConfirm)}
                                    edge="end"
                                >
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
                    {isLoading ? (
                        <CircularProgress size={24} color="inherit" />
                    ) : (
                        'Reset Password'
                    )}
                </Button>

                <Box sx={{ textAlign: 'center' }}>
                    <Link
                        component={RouterLink}
                        to="/auth/forgot-password"
                        variant="body2"
                        underline="hover"
                    >
                        Request a new reset link
                    </Link>
                </Box>
            </Box>
        </Box>
    );
};

export default ResetPasswordPage;
