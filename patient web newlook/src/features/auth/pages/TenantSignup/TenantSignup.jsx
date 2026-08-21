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
import { Link as RouterLink } from 'react-router-dom';

import useTenantSignup from '../../hooks/useTenantSignup';


const TenantSignup = () => {
    const {
        planCode, form, setField, fieldErrors, handleSubmit, isSubmitting,
        serverError,
    } = useTenantSignup();

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
                    <Typography variant="overline" color="text.secondary">Clinic</Typography>
                    <TextField
                        label="Clinic name"
                        value={form.tenant_name}
                        onChange={(e) => setField('tenant_name', e.target.value)}
                        error={!!fieldErrors.tenant_name}
                        helperText={fieldErrors.tenant_name || 'e.g. Arogya Family Clinic'}
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
                            || 'This becomes your portal URL — e.g. "arogya" → arogya.larazen.in'
                        }
                        fullWidth
                        required
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">.larazen.in</InputAdornment>
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
                        helperText={fieldErrors.phone_number || '10-digit Indian number'}
                        fullWidth
                        required
                    />

                    <TextField
                        label="Email (optional)"
                        type="email"
                        value={form.email}
                        onChange={(e) => setField('email', e.target.value)}
                        error={!!fieldErrors.email}
                        helperText={fieldErrors.email}
                        fullWidth
                    />

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
