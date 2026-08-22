/**
 * TenantSignup — public self-serve onboarding for clinics.
 *
 * Purely presentational; form + submit logic lives in
 * ``../../hooks/useTenantSignup``.
 */
import {
    Alert, Box, Button, Checkbox, Container, Divider, FormControlLabel,
    InputAdornment, Paper, Stack, TextField, Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SignupSuccess from './SignupSuccess';
import { Link as RouterLink } from 'react-router-dom';

import useTenantSignup from '../../hooks/useTenantSignup';


// The vendor's base domain is a deployment fact, not a constant: it moves
// when the SaaS seller changes domain, and every tenant subdomain moves
// with it. Read it from config instead of baking "larazen.in" into the
// signup copy.
const BASE_DOMAIN = import.meta.env?.VITE_PUBLIC_BASE_DOMAIN || 'localhost';

/**
 * Inline OTP row under a contact field. Three states: idle (Send code),
 * code sent (input + Verify + Resend), verified (green confirmation).
 * The signed proof lives in the hook; this only renders its state.
 */
const VerifyRow = ({ state, label, onSend, onOtp, onVerify, sendDisabled }) => {
    if (state.token) {
        return (
            <Alert
                severity="success" icon={<CheckCircleOutlineIcon />}
                sx={{ py: 0, mt: -1 }}
            >
                {label} verified
            </Alert>
        );
    }
    return (
        <Stack
            direction="row" spacing={1} alignItems="center"
            sx={{ mt: -1 }} flexWrap="wrap" useFlexGap
        >
            <Button
                size="small" variant="outlined"
                onClick={onSend}
                disabled={sendDisabled || state.sending}
            >
                {state.sending
                    ? 'Sending…'
                    : state.sent ? 'Resend code' : 'Send code'}
            </Button>
            {state.sent && (
                <>
                    <TextField
                        size="small" label="6-digit code" value={state.otp}
                        onChange={(e) => onOtp(e.target.value)}
                        sx={{ width: 140 }}
                        inputProps={{ inputMode: 'numeric' }}
                    />
                    <Button
                        size="small" variant="contained"
                        onClick={onVerify}
                        disabled={state.otp.length !== 6 || state.verifying}
                    >
                        {state.verifying ? 'Checking…' : 'Verify'}
                    </Button>
                </>
            )}
        </Stack>
    );
};

const TenantSignup = () => {
    const {
        signupResult, continueAfterSignup,
        planCode, form, setField, fieldErrors, handleSubmit, isSubmitting,
        serverError, verif, sendOtp, setOtp, verifyOtp,
    } = useTenantSignup();

    const phoneLooksValid =
        /^[6-9]\d{9}$/.test(form.phone_number.replace(/\D/g, '').replace(/^91/, ''));
    const emailLooksValid =
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email || '');

    if (signupResult) {

        return (

            <Box sx={{ py: { xs: 3, sm: 6 } }}>

                <SignupSuccess

                    tenantName={signupResult.tenantName}

                    workspaceUrl={signupResult.workspaceUrl}

                    trialEndsAt={signupResult.trialEndsAt}

                    addonsAttached={signupResult.addonsAttached}

                    needsLogin={signupResult.needsLogin}

                    onContinue={continueAfterSignup}

                />

            </Box>

        );

    }


    return (
        <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
            <Paper elevation={3} sx={{ p: { xs: 3, md: 5 }, borderRadius: 3 }}>
                <Stack spacing={1} sx={{ mb: 3, textAlign: 'center' }}>
                    <Box sx={{
                        mx: 'auto', width: 56, height: 56, borderRadius: '50%',
                        bgcolor: 'primary.main', color: 'primary.contrastText',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <BusinessIcon />
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        Start your free trial
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        You're signing up for <strong>{planCode}</strong> — 14-day trial,
                        no card required. You'll become the super-admin of your new clinic.
                    </Typography>
                </Stack>

                {serverError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{serverError}</Alert>
                )}

                <Stack spacing={2}>
                    {/* Industry-neutral wording. The SaaS is sold to any
                        organisation that delivers a service -- clinics,
                        hospitals, legal firms, agencies -- so the signup
                        funnel must not assume healthcare. What a tenant
                        calls its own people is theirs to decide: they
                        create their own verticals after signup. */}
                    <Typography variant="overline" color="text.secondary">Organisation</Typography>
                    <TextField
                        label="Organisation name"
                        value={form.tenant_name}
                        onChange={(e) => setField('tenant_name', e.target.value)}
                        error={!!fieldErrors.tenant_name}
                        helperText={
                            fieldErrors.tenant_name
                            || 'The name your customers will see'
                        }
                        fullWidth
                        required
                    />
                    <TextField
                        label="Subdomain"
                        value={form.tenant_slug}
                        onChange={(e) => setField('tenant_slug', e.target.value.toLowerCase())}
                        error={!!fieldErrors.tenant_slug}
                        helperText={
                            fieldErrors.tenant_slug
                            || `This becomes your portal URL — e.g. "acme" → acme.${BASE_DOMAIN}`
                        }
                        fullWidth
                        required
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">.{BASE_DOMAIN}</InputAdornment>
                            ),
                        }}
                    />

                    <Divider sx={{ my: 1 }} />
                    <Typography variant="overline" color="text.secondary">Super-admin</Typography>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                            label="First name"
                            value={form.first_name}
                            onChange={(e) => setField('first_name', e.target.value)}
                            error={!!fieldErrors.first_name}
                            helperText={fieldErrors.first_name}
                            fullWidth
                            required
                        />
                        <TextField
                            label="Last name"
                            value={form.last_name}
                            onChange={(e) => setField('last_name', e.target.value)}
                            error={!!fieldErrors.last_name}
                            helperText={fieldErrors.last_name}
                            fullWidth
                            required
                        />
                    </Stack>

                    <TextField
                        label="Phone number"
                        value={form.phone_number}
                        onChange={(e) => setField('phone_number', e.target.value)}
                        error={!!fieldErrors.phone_number}
                        helperText={
                            fieldErrors.phone_number
                            || '10-digit Indian number — we verify it by SMS code'
                        }
                        fullWidth
                        required
                    />
                    <VerifyRow
                        state={verif.phone}
                        label="Phone number"
                        onSend={() => sendOtp('phone')}
                        onOtp={(v) => setOtp('phone', v)}
                        onVerify={() => verifyOtp('phone')}
                        sendDisabled={!phoneLooksValid}
                    />

                    <TextField
                        label="Email (optional)"
                        type="email"
                        value={form.email}
                        onChange={(e) => setField('email', e.target.value)}
                        error={!!fieldErrors.email}
                        helperText={
                            fieldErrors.email
                            || 'If provided, we verify it with an emailed code'
                        }
                        fullWidth
                    />
                    {form.email ? (
                        <VerifyRow
                            state={verif.email}
                            label="Email"
                            onSend={() => sendOtp('email')}
                            onOtp={(v) => setOtp('email', v)}
                            onVerify={() => verifyOtp('email')}
                            sendDisabled={!emailLooksValid}
                        />
                    ) : null}

                    <TextField
                        label="Password"
                        type="password"
                        value={form.password}
                        onChange={(e) => setField('password', e.target.value)}
                        error={!!fieldErrors.password}
                        helperText={fieldErrors.password || 'Minimum 8 characters'}
                        fullWidth
                        required
                    />
                    <TextField
                        label="Confirm password"
                        type="password"
                        value={form.confirm_password}
                        onChange={(e) => setField('confirm_password', e.target.value)}
                        error={!!fieldErrors.confirm_password}
                        helperText={fieldErrors.confirm_password}
                        fullWidth
                        required
                    />

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={form.agree_terms}
                                onChange={(e) => setField('agree_terms', e.target.checked)}
                            />
                        }
                        label={
                            <Typography variant="body2">
                                I agree to the Terms of Service and Privacy Policy
                            </Typography>
                        }
                    />
                    {fieldErrors.agree_terms && (
                        <Typography variant="caption" color="error">
                            {fieldErrors.agree_terms}
                        </Typography>
                    )}

                    <Button
                        variant="contained"
                        size="large"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        fullWidth
                    >
                        {isSubmitting ? 'Creating your workspace…' : 'Create clinic workspace'}
                    </Button>

                    <Typography variant="body2" color="text.secondary" align="center">
                        Already have an account?{' '}
                        <RouterLink to="/login/admin" style={{ textDecoration: 'none' }}>
                            Sign in
                        </RouterLink>
                    </Typography>
                </Stack>
            </Paper>
        </Container>
    );
};

export default TenantSignup;
