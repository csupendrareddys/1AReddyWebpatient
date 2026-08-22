/**
 * SetPasswordPage — first-time password set at ``/book/set-password``.
 *
 * Reachable only when the logged-in user has ``must_set_password=true``.
 * Calls ``POST /auth/set-initial-password``; on success the server
 * flips the flag and the user is routed to the patient dashboard.
 *
 * The patient route guard force-redirects HERE for any other route the
 * user tries while the flag is still set, so this page is a hard gate.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box, Container, Typography, Paper, TextField, Button, Stack, Alert,
    CircularProgress, useTheme, alpha,
} from '@mui/material';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import { useSetInitialPasswordMutation } from '../../features/publicBooking/publicBookingApi';
import { fetchProfile } from '../../features/auth/redux/authSlice';

export default function SetPasswordPage() {
    return (
        <PublicLandingLayout>
            <SetPasswordContent />
        </PublicLandingLayout>
    );
}

function SetPasswordContent() {
    const theme = useTheme();
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const user = useSelector((s) => s.auth.user);

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [setInitial, { isLoading }] = useSetInitialPasswordMutation();

    // If somehow the user lands here without ``must_set_password``,
    // bounce them to the dashboard. The route guard does this too —
    // we just defend in depth so the page is never rendered when the
    // flag is already cleared.
    if (user && !user.must_set_password) {
        navigate('/dashboard/patient', { replace: true });
        return null;
    }

    const formError = (() => {
        if (!password) return 'Choose a password.';
        if (password.length < 8) return 'Password must be at least 8 characters.';
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return 'Password must contain at least one letter and one digit.';
        }
        if (password !== confirm) return 'Passwords do not match.';
        return null;
    })();

    const handleSubmit = async () => {
        setError('');
        if (formError) {
            setError(formError);
            return;
        }
        try {
            await setInitial(password).unwrap();
            // Re-fetch profile so the redux user has must_set_password=false.
            await dispatch(fetchProfile());
            navigate('/dashboard/patient', { replace: true });
        } catch (err) {
            setError(extractError(err) || 'Could not set password. Please try again.');
        }
    };

    return (
        <Box>
            <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, sm: 3 } }}>
                <Container maxWidth="sm">
                    <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
                        <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', mb: 3 }}>
                            <Box
                                sx={{
                                    width: 64, height: 64, borderRadius: '50%',
                                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                                    color: 'primary.main',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                <VpnKeyIcon sx={{ fontSize: 32 }} />
                            </Box>
                            <Typography variant="h5" fontWeight={800}>
                                Set your password
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Almost there — choose a password to secure your account.
                                Future logins can use this password or another OTP.
                            </Typography>
                        </Stack>

                        <Stack spacing={2}>
                            <TextField
                                size="small" fullWidth required
                                type="password" label="New password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                helperText="At least 8 characters, one letter and one digit."
                            />
                            <TextField
                                size="small" fullWidth required
                                type="password" label="Confirm password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                            />
                            {error && <Alert severity="error">{error}</Alert>}
                            <Button
                                variant="contained" size="large"
                                onClick={handleSubmit}
                                disabled={isLoading || !!formError}
                                startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : null}
                                sx={{ fontWeight: 700, textTransform: 'none', py: 1.25, borderRadius: 2 }}
                            >
                                {isLoading ? 'Saving…' : 'Set password & continue'}
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
