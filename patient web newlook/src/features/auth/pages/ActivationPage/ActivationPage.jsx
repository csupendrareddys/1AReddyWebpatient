/**
 * ActivationPage — landing page for hospital/clinic-invited doctors.
 *
 * URL: /auth/activate?token=<token>
 *
 * The activation token came in via the email + SMS the backend
 * dispatched when the hospital admin invited the doctor. This page
 * walks the doctor through three steps:
 *
 *   1. Set password (with confirm)
 *   2. Verify email OTP (sent on demand to the doctor's email)
 *   3. Verify phone OTP (sent on demand to the doctor's phone)
 *
 * After all three steps complete, the page redirects to the normal
 * /auth/service-provider/login page. The doctor signs in there with
 * the password they just set.
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Alert, Box, Button, Card, CardContent, CircularProgress,
    Container, Divider, Stack, Step, StepLabel, Stepper,
    TextField, Typography,
} from '@mui/material';

import {
    useActivationLookupMutation,
    useActivationSetPasswordMutation,
    useActivationSendEmailOtpMutation,
    useActivationVerifyEmailOtpMutation,
    useActivationSendPhoneOtpMutation,
    useActivationVerifyPhoneOtpMutation,
} from '../../../service-provider/Affiliation/api/affiliationEndpoints';

const STEPS = ['Set password', 'Verify email', 'Verify phone'];

const errText = (e) =>
    e?.data?.error || e?.data?.message ||
    e?.response?.data?.error || e?.response?.data?.message ||
    e?.error || e?.message || 'Operation failed.';

export default function ActivationPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token') || '';

    const [identity, setIdentity] = useState(null);
    const [step, setStep] = useState(0);
    const [error, setError] = useState('');
    const [lookupErr, setLookupErr] = useState('');

    // Step 1
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    // Step 2 / 3
    const [emailOtp, setEmailOtp] = useState('');
    const [phoneOtp, setPhoneOtp] = useState('');
    const [emailOtpSent, setEmailOtpSent] = useState(false);
    const [phoneOtpSent, setPhoneOtpSent] = useState(false);

    const [lookup, { isLoading: looking }] = useActivationLookupMutation();
    const [setPwd, { isLoading: settingPwd }] = useActivationSetPasswordMutation();
    const [sendEmailOtp, { isLoading: sendingEmail }] = useActivationSendEmailOtpMutation();
    const [verifyEmailOtp, { isLoading: verifyingEmail }] = useActivationVerifyEmailOtpMutation();
    const [sendPhoneOtp, { isLoading: sendingPhone }] = useActivationSendPhoneOtpMutation();
    const [verifyPhoneOtp, { isLoading: verifyingPhone }] = useActivationVerifyPhoneOtpMutation();

    // ── Boot: look up the token, figure out which step to start on ──
    useEffect(() => {
        if (!token) {
            setLookupErr('No activation token in the URL.');
            return;
        }
        (async () => {
            try {
                const d = await lookup(token).unwrap();
                setIdentity(d);
                if (d.must_set_password) setStep(0);
                else if (!d.email_verified) setStep(1);
                else if (!d.phone_verified) setStep(2);
                else setStep(3); // all done already
            } catch (e) {
                setLookupErr(errText(e));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // ── Step handlers ───────────────────────────────────────────────
    const handleSetPassword = async () => {
        setError('');
        if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
        if (password !== confirm) { setError('Passwords do not match.'); return; }
        try {
            await setPwd({ token, password }).unwrap();
            setIdentity((p) => ({ ...p, must_set_password: false }));
            setStep(1);
        } catch (e) { setError(errText(e)); }
    };

    const handleSendEmailOtp = async () => {
        setError('');
        try {
            await sendEmailOtp(token).unwrap();
            setEmailOtpSent(true);
        } catch (e) { setError(errText(e)); }
    };

    const handleVerifyEmailOtp = async () => {
        setError('');
        try {
            await verifyEmailOtp({ token, otp: emailOtp.trim() }).unwrap();
            setIdentity((p) => ({ ...p, email_verified: true }));
            setStep(2);
        } catch (e) { setError(errText(e)); }
    };

    const handleSendPhoneOtp = async () => {
        setError('');
        try {
            await sendPhoneOtp(token).unwrap();
            setPhoneOtpSent(true);
        } catch (e) { setError(errText(e)); }
    };

    const handleVerifyPhoneOtp = async () => {
        setError('');
        try {
            await verifyPhoneOtp({ token, otp: phoneOtp.trim() }).unwrap();
            setIdentity((p) => ({ ...p, phone_verified: true }));
            setStep(3);
        } catch (e) { setError(errText(e)); }
    };

    if (lookupErr) {
        return (
            <Container maxWidth="sm" sx={{ py: 6 }}>
                <Card>
                    <CardContent>
                        <Alert severity="error">{lookupErr}</Alert>
                        <Box sx={{ mt: 2 }}>
                            <Button component={RouterLink} to="/auth/service-provider/login" variant="outlined">
                                Go to login
                            </Button>
                        </Box>
                    </CardContent>
                </Card>
            </Container>
        );
    }

    if (looking || !identity) {
        return (
            <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
                <CircularProgress />
            </Container>
        );
    }

    return (
        <Container maxWidth="sm" sx={{ py: 6 }}>
            <Card>
                <CardContent>
                    <Typography variant="h5" gutterBottom>
                        Welcome, Dr. {identity.first_name} {identity.last_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        Let's get your account ready. Set a password, then verify
                        your email and phone — all three steps required before
                        you can sign in.
                    </Typography>

                    <Stepper activeStep={step} sx={{ mb: 4 }}>
                        {STEPS.map((label) => (
                            <Step key={label}><StepLabel>{label}</StepLabel></Step>
                        ))}
                    </Stepper>

                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                    {/* Step 1 — Set password */}
                    {step === 0 && (
                        <Stack spacing={2}>
                            <TextField
                                label="New password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                helperText="At least 8 characters."
                                fullWidth
                            />
                            <TextField
                                label="Confirm password"
                                type="password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                fullWidth
                            />
                            <Button
                                variant="contained"
                                onClick={handleSetPassword}
                                disabled={settingPwd}
                                size="large"
                            >
                                {settingPwd ? 'Saving…' : 'Set password & continue'}
                            </Button>
                        </Stack>
                    )}

                    {/* Step 2 — Verify email */}
                    {step === 1 && (
                        <Stack spacing={2}>
                            <Typography variant="body2">
                                We'll send a 6-digit code to <strong>{identity.email}</strong>.
                            </Typography>
                            {!emailOtpSent ? (
                                <Button
                                    variant="contained"
                                    onClick={handleSendEmailOtp}
                                    disabled={sendingEmail}
                                    size="large"
                                >
                                    {sendingEmail ? 'Sending…' : 'Send email OTP'}
                                </Button>
                            ) : (
                                <>
                                    <TextField
                                        label="Email OTP"
                                        value={emailOtp}
                                        onChange={(e) => setEmailOtp(e.target.value)}
                                        fullWidth autoFocus
                                    />
                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            variant="contained"
                                            onClick={handleVerifyEmailOtp}
                                            disabled={verifyingEmail || !emailOtp}
                                            size="large"
                                            sx={{ flexGrow: 1 }}
                                        >
                                            {verifyingEmail ? 'Verifying…' : 'Verify & continue'}
                                        </Button>
                                        <Button
                                            onClick={handleSendEmailOtp}
                                            disabled={sendingEmail}
                                            size="small"
                                        >
                                            Resend
                                        </Button>
                                    </Stack>
                                </>
                            )}
                        </Stack>
                    )}

                    {/* Step 3 — Verify phone */}
                    {step === 2 && (
                        <Stack spacing={2}>
                            <Typography variant="body2">
                                We'll send a 6-digit code to <strong>{identity.phone_number}</strong>.
                            </Typography>
                            {!phoneOtpSent ? (
                                <Button
                                    variant="contained"
                                    onClick={handleSendPhoneOtp}
                                    disabled={sendingPhone}
                                    size="large"
                                >
                                    {sendingPhone ? 'Sending…' : 'Send phone OTP'}
                                </Button>
                            ) : (
                                <>
                                    <TextField
                                        label="Phone OTP"
                                        value={phoneOtp}
                                        onChange={(e) => setPhoneOtp(e.target.value)}
                                        fullWidth autoFocus
                                    />
                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            variant="contained"
                                            onClick={handleVerifyPhoneOtp}
                                            disabled={verifyingPhone || !phoneOtp}
                                            size="large"
                                            sx={{ flexGrow: 1 }}
                                        >
                                            {verifyingPhone ? 'Verifying…' : 'Verify & finish'}
                                        </Button>
                                        <Button
                                            onClick={handleSendPhoneOtp}
                                            disabled={sendingPhone}
                                            size="small"
                                        >
                                            Resend
                                        </Button>
                                    </Stack>
                                </>
                            )}
                        </Stack>
                    )}

                    {/* Step 4 — Done */}
                    {step === 3 && (
                        <Stack spacing={2} alignItems="center">
                            <Alert severity="success" sx={{ width: '100%' }}>
                                Your account is activated. You can sign in now.
                            </Alert>
                            <Button
                                variant="contained"
                                size="large"
                                onClick={() => navigate('/auth/service-provider/login')}
                            >
                                Go to login
                            </Button>
                        </Stack>
                    )}

                    <Divider sx={{ my: 3 }} />
                    <Typography variant="caption" color="text.secondary">
                        Got this link by mistake? Just close this tab — nothing happens until you set a password.
                    </Typography>
                </CardContent>
            </Card>
        </Container>
    );
}
