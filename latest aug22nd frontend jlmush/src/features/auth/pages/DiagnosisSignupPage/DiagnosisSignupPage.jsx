import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
    Box,
    TextField,
    Button,
    Typography,
    Link,
    Alert,
    InputAdornment,
    IconButton,
    CircularProgress,
    Grid,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import BiotechIcon from '@mui/icons-material/Biotech';
import PasswordStrengthIndicator from '../../components/PasswordStrengthIndicator/PasswordStrengthIndicator';
import { signup, clearError, clearSignupSuccess } from '../../redux/authSlice';
import { validateEmail, validatePhone, validatePassword } from '../../utils/validation';

const DiagnosisSignupPage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { isLoading, error, signupSuccess, signupMessage } = useSelector((state) => state.auth);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone_number: '',
        license_number: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        password: '',
        confirmPassword: '',
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [validationErrors, setValidationErrors] = useState({});

    useEffect(() => {
        if (signupSuccess) {
            const timer = setTimeout(() => {
                dispatch(clearSignupSuccess());
                navigate('/auth/service-provider/login');
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [signupSuccess, navigate, dispatch]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));

        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
        if (error) {
            dispatch(clearError());
        }
    };

    const validate = () => {
        const errors = {};

        if (!formData.name.trim()) {
            errors.name = 'Diagnosis center name is required';
        }
        if (!validateEmail(formData.email)) {
            errors.email = 'Please enter a valid email address';
        }
        if (!validatePhone(formData.phone_number)) {
            errors.phone_number = 'Please enter a valid 10-digit phone number';
        }
        if (!formData.license_number.trim()) {
            errors.license_number = 'License number is required';
        }
        if (!formData.address.trim()) {
            errors.address = 'Address is required';
        }
        if (!formData.city.trim()) {
            errors.city = 'City is required';
        }
        if (!formData.state.trim()) {
            errors.state = 'State is required';
        }
        if (!formData.pincode.trim() || !/^\d{6}$/.test(formData.pincode)) {
            errors.pincode = 'Please enter a valid 6-digit pincode';
        }

        const passwordErrors = validatePassword(formData.password);
        if (passwordErrors.length > 0) {
            errors.password = passwordErrors[0];
        }

        if (formData.password !== formData.confirmPassword) {
            errors.confirmPassword = 'Passwords do not match';
        }

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validate()) return;

        const userData = {
            name: formData.name,
            email: formData.email,
            phone_number: formData.phone_number,
            license_number: formData.license_number,
            address: formData.address,
            city: formData.city,
            state: formData.state,
            pincode: formData.pincode,
            password: formData.password,
            role: 'diagnosis',
        };

        dispatch(signup(userData));
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <Box
                    sx={{
                        p: 2,
                        borderRadius: '50%',
                        bgcolor: 'info.light',
                        color: 'info.contrastText',
                    }}
                >
                    <BiotechIcon sx={{ fontSize: 40 }} />
                </Box>
            </Box>

            <Typography variant="h4" component="h1" gutterBottom align="center" color="primary">
                Diagnosis Center Registration
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3 }}>
                Register your diagnostic center
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
                Your account will be reviewed and activated by an administrator after registration.
            </Alert>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            {signupSuccess && (
                <Alert severity="success" sx={{ mb: 2 }}>
                    {signupMessage} Your account is pending admin approval.
                </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit}>
                <TextField
                    fullWidth
                    label="Diagnosis Center Name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    margin="normal"
                    error={!!validationErrors.name}
                    helperText={validationErrors.name}
                    autoFocus
                />

                <TextField
                    fullWidth
                    label="License Number"
                    name="license_number"
                    value={formData.license_number}
                    onChange={handleChange}
                    required
                    margin="normal"
                    placeholder="e.g., DC-12345"
                    error={!!validationErrors.license_number}
                    helperText={validationErrors.license_number}
                />

                <Grid container spacing={2} sx={{ mt: 0 }}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Email"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            error={!!validationErrors.email}
                            helperText={validationErrors.email}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Phone Number"
                            name="phone_number"
                            value={formData.phone_number}
                            onChange={handleChange}
                            required
                            placeholder="9876543210"
                            error={!!validationErrors.phone_number}
                            helperText={validationErrors.phone_number}
                        />
                    </Grid>
                </Grid>

                <TextField
                    fullWidth
                    label="Address"
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    required
                    margin="normal"
                    multiline
                    rows={2}
                    error={!!validationErrors.address}
                    helperText={validationErrors.address}
                />

                <Grid container spacing={2} sx={{ mt: 0 }}>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="City"
                            name="city"
                            value={formData.city}
                            onChange={handleChange}
                            required
                            error={!!validationErrors.city}
                            helperText={validationErrors.city}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="State"
                            name="state"
                            value={formData.state}
                            onChange={handleChange}
                            required
                            error={!!validationErrors.state}
                            helperText={validationErrors.state}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Pincode"
                            name="pincode"
                            value={formData.pincode}
                            onChange={handleChange}
                            required
                            placeholder="123456"
                            error={!!validationErrors.pincode}
                            helperText={validationErrors.pincode}
                        />
                    </Grid>
                </Grid>

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
                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
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
                                <IconButton onClick={() => setShowConfirmPassword(!showConfirmPassword)} edge="end">
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
                    disabled={isLoading || signupSuccess}
                    sx={{ mt: 3, mb: 2, py: 1.5 }}
                >
                    {isLoading ? <CircularProgress size={24} color="inherit" /> : 'Register Diagnosis Center'}
                </Button>

                <Typography variant="body2" align="center">
                    Already registered?{' '}
                    <Link component={RouterLink} to="/auth/service-provider/login" underline="hover">
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

export default DiagnosisSignupPage;
