import {
    Box,
    TextField,
    Button,
    Typography,
    Link,
    Alert,
    InputAdornment,
    IconButton,
    Grid,
    MenuItem,
    FormControl,
    InputLabel,
    Select,
    FormHelperText,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Divider } from '@mui/material';
import PasswordStrengthIndicator from '../../components/PasswordStrengthIndicator/PasswordStrengthIndicator';
import EntityCoreFields from '../../../../common/components/EntityCoreFields/EntityCoreFields';
import usePatientSignup from '../../hooks/usePatientSignup';
import { INDIAN_STATES } from '../../utils/validation';
import { useListPublicMembershipPlansCatalogQuery } from '../../../admin/api/publicEndpoints';

const PatientSignupPage = () => {
    const {
        formData,
        validationErrors,
        showPassword,
        showConfirmPassword,
        error,
        handleChange,
        handleEntityChange,
        handleSubmit,
        toggleShowPassword,
        toggleShowConfirmPassword,
    } = usePatientSignup();

    // The receiver vertical this signup came from (JoinReceiverPage puts it on
    // the URL). The ``patient`` vertical is a personal-account-only plan, so
    // it's pinned to Individual with no entity picker; every other receiver
    // vertical (and a direct hit on this URL with no vertical) keeps the full
    // choice.
    //
    // Reads ``?vertical=`` — /join_receiver is keyed on vertical types now, not
    // the plan types it used to send as ``?plan_type=``.
    const [searchParams] = useSearchParams();
    const lockIndividual = searchParams.get('vertical') === 'patient';

    // Marketplace (receiver) plans a patient can pick at registration. Optional
    // — if none are configured, the selector simply doesn't render.
    const { data: patientPlans = [] } = useListPublicMembershipPlansCatalogQuery('patient');

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <Box
                    sx={{
                        p: 2,
                        borderRadius: '50%',
                        bgcolor: 'primary.light',
                        color: 'primary.contrastText',
                    }}
                >
                    <PersonAddIcon sx={{ fontSize: 40 }} />
                </Box>
            </Box>

            <Typography variant="h4" component="h1" gutterBottom align="center" color="primary">
                Patient Registration
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3 }}>
                Create your patient account
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit}>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="First Name"
                            name="first_name"
                            value={formData.first_name}
                            onChange={handleChange}
                            required
                            error={!!validationErrors.first_name}
                            helperText={validationErrors.first_name}
                            autoFocus
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Last Name"
                            name="last_name"
                            value={formData.last_name}
                            onChange={handleChange}
                            error={!!validationErrors.last_name}
                            helperText={validationErrors.last_name}
                        />
                    </Grid>
                </Grid>

                <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    margin="normal"
                    error={!!validationErrors.email}
                    helperText={validationErrors.email}
                />

                <FormControl
                    fullWidth
                    margin="normal"
                    required
                    error={!!validationErrors.state}
                >
                    <InputLabel id="state-label">State</InputLabel>
                    <Select
                        labelId="state-label"
                        name="state"
                        value={formData.state}
                        onChange={handleChange}
                        label="State"
                    >
                        {INDIAN_STATES.map((state) => (
                            <MenuItem key={state} value={state}>
                                {state}
                            </MenuItem>
                        ))}
                    </Select>
                    {validationErrors.state && (
                        <FormHelperText>{validationErrors.state}</FormHelperText>
                    )}
                </FormControl>

                {patientPlans.length > 0 && (
                    <FormControl fullWidth margin="normal">
                        <InputLabel id="plan-label">Membership Plan (optional)</InputLabel>
                        <Select
                            labelId="plan-label"
                            name="plan_code"
                            value={formData.plan_code || ''}
                            onChange={handleChange}
                            label="Membership Plan (optional)"
                        >
                            <MenuItem value=""><em>No plan</em></MenuItem>
                            {patientPlans.map((p) => (
                                <MenuItem key={p.code} value={p.code}>
                                    {p.name}
                                    {p.price_inr_monthly != null ? ` — ₹${p.price_inr_monthly}/mo` : ''}
                                </MenuItem>
                            ))}
                        </Select>
                        <FormHelperText>Shows as a tag on your dashboard.</FormHelperText>
                    </FormControl>
                )}

                <TextField
                    fullWidth
                    label="Phone Number"
                    name="phone_number"
                    value={formData.phone_number}
                    onChange={handleChange}
                    required
                    margin="normal"
                    placeholder="9876543210"
                    error={!!validationErrors.phone_number}
                    helperText={validationErrors.phone_number}
                />

                <TextField
                    fullWidth
                    label="Referral Code"
                    name="referral_code"
                    value={formData.referral_code}
                    onChange={handleChange}
                    margin="normal"
                    placeholder="Optional"
                    error={!!validationErrors.referral_code}
                    helperText={validationErrors.referral_code}
                />

                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Registering as
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {lockIndividual
                        ? 'This plan is for personal accounts only.'
                        : 'Choose "Individual" for a personal account, or your entity type for a corporate account.'}
                </Typography>
                <EntityCoreFields
                    values={formData.entity}
                    onChange={handleEntityChange}
                    errors={validationErrors.entity || {}}
                    lockIndividual={lockIndividual}
                />


                <Divider sx={{ my: 2 }} />

                <TextField
                    fullWidth
                    label="Password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleChange}
                    required
                    margin="normal"
                    error={!!validationErrors.password}
                    helperText={validationErrors.password}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={toggleShowPassword} edge="end">
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                <PasswordStrengthIndicator password={formData.password} />

                <TextField
                    fullWidth
                    label="Confirm Password"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                    margin="normal"
                    error={!!validationErrors.confirmPassword}
                    helperText={validationErrors.confirmPassword}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={toggleShowConfirmPassword} edge="end">
                                    {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
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
                    sx={{ mt: 3, mb: 2, py: 1.5 }}
                >
                    Create Account
                </Button>

                <Typography variant="body2" align="center">
                    Already have an account?{' '}
                    <Link component={RouterLink} to="/auth/service-receiver/login" underline="hover">
                        Sign In
                    </Link>
                </Typography>

                <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="body2" align="center" color="text.secondary">
                        By signing up, you agree to our{' '}
                        <Link component={RouterLink} to="/terms-and-conditions" underline="hover">
                            Terms & Conditions
                        </Link>{' '}
                        and{' '}
                        <Link component={RouterLink} to="/privacy-policy" underline="hover">
                            Privacy Policy
                        </Link>
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
};

export default PatientSignupPage;
