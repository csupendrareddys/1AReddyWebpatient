import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Checkbox,
    FormControlLabel,
} from '@mui/material';
import { Visibility, VisibilityOff, Close as CloseIcon } from '@mui/icons-material';
import { login, clearError, setUserFromOtpLogin } from '../../redux/authSlice';
import { useSendLoginOtpMutation, useLoginViaOtpMutation } from '../../api/authEndpoints';

/**
 * Builds an embeddable viewer URL for a document.
 * - PDFs: use directly in iframe (browsers render them natively)
 * - Word docs (.doc/.docx): use Google Docs Viewer for inline rendering
 */
const getEmbedUrl = (url) => {
    if (!url) return null;
    const lower = url.split('?')[0].toLowerCase();
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
        return `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
    }
    // PDFs: hide native toolbar (zoom, print, download) with #toolbar=0
    return url + (url.includes('#') ? '&toolbar=0' : '#toolbar=0');
};

// A post-login ``?redirect=`` deep-link (e.g. "Book Now" on a landing
// feature → login → straight to the linked product). Only same-origin
// absolute paths are honoured; anything else (protocol-relative //host,
// external URLs) is ignored so login can't be turned into an open
// redirect.
const getSafeRedirect = (search) => {
    try {
        const target = new URLSearchParams(search).get('redirect');
        if (target && target.startsWith('/') && !target.startsWith('//')) {
            return target;
        }
    } catch {
        /* malformed query — fall through to default */
    }
    return null;
};

// Auto-detect identifier type
const detectIdentifierType = (value) => {
    if (!value) return null;

    const cleanValue = value.replace(/\s/g, '');
    console.log("cleanValue", cleanValue);
    // Check if it's an email (contains @)
    if (value.includes('@')) {
        console.log("email");
        return 'email';
    }

    // Check if it's a 12-digit Aadhaar number
    if (/^\d{12}$/.test(cleanValue)) {
        console.log("aadhar");
        return 'aadhar';
    }

    // Check if it's a 10-digit phone number starting with 6-9
    if (/^[6-9]\d{9}$/.test(cleanValue)) {
        console.log("phone");
        return 'phone';
    }

    // Could be partial input, try to guess
    if (/^\d+$/.test(cleanValue)) {
        if (cleanValue.length <= 10) return 'phone';
        if (cleanValue.length <= 12) return 'aadhar';
    }

    return 'email'; // Default to email
};

const LoginForm = ({
    title = 'Sign In',
    subtitle = 'Welcome back!',
    signupLink,
    signupLinkText = "Don't have an account? Sign Up",
    userType = 'patient',
    configOverride = null,
    previewMode = false,
    onSessionLimit = null,  // callback(credentials) when session limit is hit
}) => {
    console.log("userType", userType);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { isLoading, error } = useSelector((state) => state.auth);

    // Apply configOverride values (from PageConfigEditor preview)
    const cfg = configOverride || {};
    const displayTitle = cfg.page_title || title;
    const displaySubtitle = cfg.page_subtitle || subtitle;
    const displayButtonText = cfg.primary_button_text || 'Sign In';
    const showForgotPassword = cfg.forgot_password_is_present !== undefined ? cfg.forgot_password_is_present : true;
    const forgotPasswordText = cfg.forgot_password_text || 'Forgot Password?';
    const showRegister = cfg.register_is_present !== undefined ? cfg.register_is_present : !!signupLink;
    const registerText = cfg.register_text || '';
    const registerLinkText = cfg.register_link_text || signupLinkText;
    let registerLinkUrl = cfg.register_link_url || signupLink;
    if (registerLinkUrl && !registerLinkUrl.startsWith('/') && !registerLinkUrl.startsWith('http')) {
        registerLinkUrl = '/' + registerLinkUrl;
    }
    const showRememberMe = cfg.remember_me_is_present !== undefined ? cfg.remember_me_is_present : false;
    const rememberMeText = cfg.remember_me_text || 'Remember Me';
    const showOtp = cfg.otp_is_present !== undefined ? cfg.otp_is_present : false;
    const otpSectionText = cfg.otp_section_text || 'Login via OTP';
    const otpButtonText = cfg.otp_button_text || 'Request OTP';
    const showTerms = cfg.terms_is_present !== undefined ? cfg.terms_is_present : true;
    const termsLinkText = cfg.terms_link_text || 'Terms & Conditions';
    const privacyLinkText = cfg.privacy_link_text || 'Privacy Policy';
    const termsDocUrl = cfg.terms_url || null;
    const privacyDocUrl = cfg.privacy_url || null;
    const showFooter = cfg.footer_is_present !== undefined ? cfg.footer_is_present : true;
    const footerText = cfg.footer_text || null;
    const usernamePlaceholder = cfg.username_placeholder || 'Enter Email, Phone, or Aadhaar';
    const passwordPlaceholder = cfg.password_placeholder || 'Enter Password';
    const identifierLabel = cfg.identifier_label || 'Email / Phone / Aadhaar';
    // Visual config — applied to button and title
    const primaryColor = cfg.primary_color || null;
    const secondaryColor = cfg.secondary_color || null;

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [validationError, setValidationError] = useState('');

    // OTP flow state
    const [otpMode, setOtpMode] = useState(false); // true = OTP login mode
    const [otpPhone, setOtpPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [otpCooldown, setOtpCooldown] = useState(0); // seconds remaining
    const [otpError, setOtpError] = useState('');
    const [otpSuccess, setOtpSuccess] = useState('');
    const cooldownRef = useRef(null);

    // RTK Query mutations for OTP
    const [sendOtp, { isLoading: isSendingOtp }] = useSendLoginOtpMutation();
    const [loginOtp, { isLoading: isVerifyingOtp }] = useLoginViaOtpMutation();

    // Cooldown timer effect
    useEffect(() => {
        if (otpCooldown > 0) {
            cooldownRef.current = setTimeout(() => setOtpCooldown(prev => prev - 1), 1000);
        }
        return () => clearTimeout(cooldownRef.current);
    }, [otpCooldown]);

    const handleSendOtp = async () => {
        const phone = otpPhone.trim();
        // Indian mobile validation: 10 digits starting with 6-9 (matches backend)
        if (!/^[6-9]\d{9}$/.test(phone)) {
            setOtpError('Please enter a valid 10-digit Indian mobile number');
            return;
        }
        setOtpError('');
        setOtpSuccess('');
        try {
            // Pass ``expected_role`` so the backend can refuse to send
            // an OTP for a phone whose account belongs to a different
            // role (doctor's number on the patient portal, etc.) —
            // fail-fast at Send time instead of letting the user
            // discover the mismatch after they've typed the code.
            await sendOtp({
                phone_number: phone,
                expected_role: userType || undefined,
            }).unwrap();
            setOtpSent(true);
            setOtpCooldown(60); // 60 second cooldown
            setOtpSuccess('Verification code sent via SMS. Valid for 10 minutes.');
        } catch (err) {
            const msg = err?.data?.message || err?.data?.error || 'Failed to send OTP. Please try again.';
            setOtpError(msg);
        }
    };

    const handleOtpLogin = async () => {
        if (!otpCode.trim()) {
            setOtpError('Please enter the verification code');
            return;
        }
        setOtpError('');
        try {
            // ``expected_role`` mirrors the password-login portal-scoping:
            // patient login portal only accepts patient accounts, doctor
            // portal only accepts provider accounts, admin portal only
            // accepts super_admin/sub_admin. Backend maps the umbrella
            // userType strings ('service_provider', 'service_receiver',
            // 'admin') onto the underlying role enum values.
            const result = await loginOtp({
                phone_number: otpPhone.trim(),
                otp: otpCode.trim(),
                expected_role: userType || undefined,
            }).unwrap();
            // Login successful — update Redux state and redirect
            const userData = result?.data;
            if (userData?.user) {
                dispatch(setUserFromOtpLogin({ user: userData.user }));
                const dashboardRoutes = {
                    patient: '/dashboard/patient',
                    doctor: '/dashboard/doctor',
                    pharmacy: '/dashboard/pharmacy',
                    diagnosis: '/dashboard/diagnosis',
                    // Marketplace facility admins (Round 3+4).
                    clinic: '/dashboard/clinic',
                    hospital: '/dashboard/hospital',
                    // A practice's own staff — same portal as their practice.
                    provider_staff: '/dashboard/staff',
                    patient_staff: '/dashboard/patient-staff',
                    super_admin: '/dashboard/admin',
                    sub_admin: '/dashboard/admin',
                    // PLATFORM_OWNER lands on the tenants console by default;
                    // the admin layout still renders so they can switch to
                    // Landing Page from the sidebar.
                    platform_owner: '/dashboard/platform/tenants',
                };
                const fallback = dashboardRoutes[userData.user.role] || '/dashboard/patient';
                // Honour a ?redirect= deep-link only for patients (the
                // booking flow that sets it); other roles always land on
                // their dashboard.
                const redirect = userData.user.role === 'patient'
                    ? getSafeRedirect(location.search) : null;
                navigate(redirect || fallback);
            }
        } catch (err) {
            const msg = err?.data?.message || err?.data?.error || 'Invalid or expired code. Please try again.';
            setOtpError(msg);
        }
    };

    const handleBackToPassword = () => {
        setOtpMode(false);
        setOtpSent(false);
        setOtpCode('');
        setOtpError('');
        setOtpSuccess('');
        setOtpCooldown(0);
    };

    // Document viewer modal state
    const [docModalOpen, setDocModalOpen] = useState(false);
    const [docModalTitle, setDocModalTitle] = useState('');
    const [docModalUrl, setDocModalUrl] = useState('');

    const handleOpenDoc = (title, url) => {
        setDocModalTitle(title);
        setDocModalUrl(getEmbedUrl(url));
        setDocModalOpen(true);
    };

    const handleIdentifierChange = (e) => {
        setIdentifier(e.target.value);
        setValidationError('');
        if (error) {
            dispatch(clearError());
        }
    };

    const handlePasswordChange = (e) => {
        setPassword(e.target.value);
        setValidationError('');
        if (error) {
            dispatch(clearError());
        }
    };

    const validateForm = () => {
        if (!identifier.trim()) {
            setValidationError('Please enter your Email, Phone, or Aadhaar number');
            return false;
        }

        const identifierType = detectIdentifierType(identifier);
        const cleanIdentifier = identifier.replace(/\s/g, '');

        if (identifierType === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(identifier)) {
                setValidationError('Please enter a valid email address');
                return false;
            }
        } else if (identifierType === 'phone') {
            const phoneRegex = /^[6-9]\d{9}$/;
            if (!phoneRegex.test(cleanIdentifier)) {
                setValidationError('Please enter a valid 10-digit phone number');
                return false;
            }
        } else if (identifierType === 'aadhar') {
            const aadharRegex = /^[2-9]\d{11}$/;
            if (!aadharRegex.test(cleanIdentifier)) {
                setValidationError('Please enter a valid 12-digit Aadhaar number');
                return false;
            }
        }

        if (!password) {
            setValidationError('Password is required');
            return false;
        }

        // Check terms & privacy acceptance
        if (cfg.terms_required !== false) {
            if ((showTerms || termsDocUrl) && !termsAccepted) {
                setValidationError('Please accept the Terms & Conditions to continue');
                return false;
            }
            if (privacyDocUrl && !privacyAccepted) {
                setValidationError('Please accept the Privacy Policy to continue');
                return false;
            }
        }

        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateForm()) return;
        console.log("identifier", identifier);
        const identifierType = detectIdentifierType(identifier);
        const cleanIdentifier = identifier.replace(/\s/g, '');

        // Build login payload based on detected type
        const loginPayload = { password };

        if (identifierType === 'email') {
            console.log("email");
            loginPayload.email = identifier;
        } else if (identifierType === 'phone') {
            console.log("phone");
            loginPayload.phone_number = cleanIdentifier;
        } else {
            console.log("aadhar");
            loginPayload.aadhar_number = cleanIdentifier;
        }

        // Map frontend userType to backend expected_role.
        //
        // ``service_provider`` is the umbrella login form used by
        // doctor, hospital, clinic, pharmacy and diagnosis admins —
        // they all sign in through /auth/service-provider/login.
        // Send ``service_provider`` through as-is so the backend's
        // ``role_page_mapping`` (auth/service.py) accepts all five
        // roles. Previously this hardcoded ``doctor`` here, which
        // caused every hospital / clinic admin to 4xx with
        // "This account cannot be used to login from this page"
        // despite the backend having been widened to accept them.
        const roleMapping = {
            service_receiver: 'patient',
            admin: 'admin',
            patient: 'patient',
            doctor: 'doctor',
        };
        loginPayload.expected_role = roleMapping[userType] || userType;

        try {
            console.log("loginPayload", loginPayload);
            const result = await dispatch(login(loginPayload)).unwrap();
            console.log("result", result);
            // Redirect based on user role
            const dashboardRoutes = {
                patient: '/dashboard/patient',
                doctor: '/dashboard/doctor',
                pharmacy: '/dashboard/pharmacy',
                diagnosis: '/dashboard/diagnosis',
                // Marketplace facility admins (Round 3+4).
                clinic: '/dashboard/clinic',
                hospital: '/dashboard/hospital',
                // A practice's own staff — same portal as their practice.
                provider_staff: '/dashboard/staff',
                patient_staff: '/dashboard/patient-staff',
                super_admin: '/dashboard/admin',
                sub_admin: '/dashboard/admin',
                // PLATFORM_OWNER lands on the tenants console by default.
                platform_owner: '/dashboard/platform/tenants',
            };

            const fallback = dashboardRoutes[result.user.role] || '/dashboard/patient';
            // Honour a ?redirect= deep-link only for patients (the booking
            // flow that sets it); other roles always land on their dashboard.
            const redirect = result.user.role === 'patient'
                ? getSafeRedirect(location.search) : null;
            navigate(redirect || fallback);
        } catch (err) {
            console.log("err", err);

            // Check if error is due to session limit
            const errMsg = typeof err === 'string' ? err : err?.message || '';
            if (errMsg.toLowerCase().includes('session') && errMsg.toLowerCase().includes('maximum')) {
                dispatch(clearError());
                if (onSessionLimit) {
                    onSessionLimit(loginPayload);
                }
            }
            // Other errors are handled by Redux (shown in the Alert above)
        }
    };

    const handleForgotPassword = () => {
        navigate('/auth/forgot-password');
    };

    // Get helper text based on detected type
    const getHelperText = () => {
        if (!identifier) return usernamePlaceholder;
        const type = detectIdentifierType(identifier);
        if (type === 'email') return 'Signing in with Email';
        if (type === 'phone') return 'Signing in with Phone Number';
        if (type === 'aadhar') return 'Signing in with Aadhaar';
        return '';
    };

    // ======== OTP MODE RENDERING ========
    if (otpMode && showOtp && !previewMode) {
        return (
            <Box>
                <Typography variant="h4" component="h1" gutterBottom align="center" sx={{ color: primaryColor || 'primary.main' }}>
                    {displayTitle}
                </Typography>
                <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3 }}>
                    {otpSent ? 'Enter the code sent via SMS' : 'Enter your mobile number to receive a login code'}
                </Typography>

                {otpError && <Alert severity="error" sx={{ mb: 2 }}>{otpError}</Alert>}
                {otpSuccess && <Alert severity="success" sx={{ mb: 2 }}>{otpSuccess}</Alert>}

                {/* Mobile number input */}
                <TextField
                    fullWidth
                    label="Mobile Number"
                    type="tel"
                    value={otpPhone}
                    onChange={(e) => {
                        const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setOtpPhone(cleaned);
                        setOtpError('');
                    }}
                    margin="normal"
                    autoFocus={!otpSent}
                    disabled={otpSent}
                    placeholder="10-digit mobile number"
                    inputProps={{ inputMode: 'numeric', maxLength: 10 }}
                />

                {/* OTP code input — shown after OTP is sent */}
                {otpSent && (
                    <TextField
                        fullWidth
                        label="Verification Code"
                        value={otpCode}
                        onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                        margin="normal"
                        autoFocus
                        placeholder="Enter 6-digit code"
                        inputProps={{ maxLength: 6, style: { letterSpacing: '0.5em', textAlign: 'center', fontSize: '1.2rem' } }}
                    />
                )}

                {/* Action buttons */}
                <Box sx={{ mt: 2 }}>
                    {!otpSent ? (
                        <Button
                            fullWidth
                            variant="contained"
                            size="large"
                            onClick={handleSendOtp}
                            disabled={isSendingOtp}
                            sx={{
                                py: 1.5,
                                ...(primaryColor && {
                                    backgroundColor: primaryColor,
                                    '&:hover': { backgroundColor: secondaryColor || primaryColor, filter: 'brightness(0.88)' },
                                }),
                            }}
                        >
                            {isSendingOtp ? <CircularProgress size={24} color="inherit" /> : 'Send Code'}
                        </Button>
                    ) : (
                        <>
                            <Button
                                fullWidth
                                variant="contained"
                                size="large"
                                onClick={handleOtpLogin}
                                disabled={isVerifyingOtp || otpCode.length < 6}
                                sx={{
                                    py: 1.5,
                                    mb: 1,
                                    ...(primaryColor && {
                                        backgroundColor: primaryColor,
                                        '&:hover': { backgroundColor: secondaryColor || primaryColor, filter: 'brightness(0.88)' },
                                    }),
                                }}
                            >
                                {isVerifyingOtp ? <CircularProgress size={24} color="inherit" /> : 'Verify & Sign In'}
                            </Button>
                            <Button
                                fullWidth
                                variant="text"
                                size="small"
                                onClick={handleSendOtp}
                                disabled={isSendingOtp || otpCooldown > 0}
                                sx={{ textTransform: 'none' }}
                            >
                                {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend Code'}
                            </Button>
                        </>
                    )}
                </Box>

                {/* Back to password login */}
                <Box sx={{ mt: 2, textAlign: 'center' }}>
                    <Button variant="text" size="small" onClick={handleBackToPassword} sx={{ textTransform: 'none' }}>
                        ← Back to password login
                    </Button>
                </Box>
            </Box>
        );
    }

    // ======== NORMAL PASSWORD MODE ========
    return (
        <Box component="form" onSubmit={previewMode ? (e) => e.preventDefault() : handleSubmit}>
            <Typography
                variant="h4"
                component="h1"
                gutterBottom
                align="center"
                sx={{ color: primaryColor || 'primary.main' }}
            >
                {displayTitle}
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3 }}>
                {displaySubtitle}
            </Typography>

            {(error || validationError) && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error || validationError}
                </Alert>
            )}

            <TextField
                fullWidth
                label={identifierLabel}
                value={identifier}
                onChange={handleIdentifierChange}
                margin="normal"
                autoComplete="username"
                autoFocus
                placeholder={usernamePlaceholder}
                helperText={getHelperText()}
            />

            <TextField
                fullWidth
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={handlePasswordChange}
                margin="normal"
                autoComplete="current-password"
                placeholder={passwordPlaceholder}
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

            {showForgotPassword && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, mb: 2 }}>
                    <Button
                        variant="text"
                        size="small"
                        onClick={previewMode ? undefined : handleForgotPassword}
                        sx={{ textTransform: 'none' }}
                    >
                        {forgotPasswordText}
                    </Button>
                </Box>
            )}

            <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading && !previewMode}
                sx={{
                    mt: 1,
                    mb: 2,
                    py: 1.5,
                    ...(primaryColor && {
                        backgroundColor: primaryColor,
                        '&:hover': { backgroundColor: secondaryColor || primaryColor, filter: 'brightness(0.88)' },
                    }),
                }}
            >
                {isLoading && !previewMode ? <CircularProgress size={24} color="inherit" /> : displayButtonText}
            </Button>

            {/* Remember Me */}
            {showRememberMe && (
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, mb: 1 }}>
                    <input
                        type="checkbox"
                        id="remember-me"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        style={{ marginRight: 8, cursor: 'pointer' }}
                    />
                    <Typography
                        component="label"
                        htmlFor="remember-me"
                        variant="body2"
                        sx={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                        {rememberMeText}
                    </Typography>
                </Box>
            )}

            {/* OTP Section */}
            {showOtp && (
                <Box sx={{ mt: 2, mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', my: 1 }}>
                        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>Or</Typography>
                        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Typography variant="body2" color="text.secondary">{otpSectionText}</Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            sx={{ textTransform: 'none', ml: 2, flexShrink: 0 }}
                            onClick={previewMode ? undefined : () => {
                                setOtpMode(true);
                                // Pre-fill phone if user already entered one
                                if (detectIdentifierType(identifier) === 'phone') {
                                    setOtpPhone(identifier.replace(/\D/g, '').slice(-10));
                                }
                            }}
                        >
                            {otpButtonText}
                        </Button>
                    </Box>
                </Box>
            )}

            {showRegister && (
                <Typography variant="body2" align="center" sx={{ mt: 2 }}>
                    {registerText && <>{registerText}{' '}</>}
                    {registerLinkUrl ? (
                        <Link component={previewMode ? 'span' : RouterLink} to={previewMode ? undefined : registerLinkUrl} underline="hover">
                            {registerLinkText}
                        </Link>
                    ) : (
                        <Typography component="span" variant="body2" color="text.secondary">{registerLinkText}</Typography>
                    )}
                </Typography>
            )}

            {/* Terms & Conditions Checkbox */}
            {(showTerms || termsDocUrl) && (
                <Box sx={{ mt: 2 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={termsAccepted}
                                onChange={(e) => setTermsAccepted(e.target.checked)}
                                size="small"
                            />
                        }
                        label={
                            <Typography variant="body2" color="text.secondary">
                                I agree to the{' '}
                                {termsDocUrl ? (
                                    <Link
                                        component="button"
                                        type="button"
                                        variant="body2"
                                        underline="hover"
                                        onClick={(e) => { e.preventDefault(); handleOpenDoc(termsLinkText, termsDocUrl); }}
                                    >
                                        {termsLinkText}
                                    </Link>
                                ) : (
                                    <Link component={previewMode ? 'span' : RouterLink} to={previewMode ? undefined : '/terms-and-conditions'} variant="body2" underline="hover">
                                        {termsLinkText}
                                    </Link>
                                )}
                            </Typography>
                        }
                    />
                </Box>
            )}

            {/* Privacy Policy Checkbox */}
            {privacyDocUrl && (
                <Box sx={{ mt: 0.5 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={privacyAccepted}
                                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                                size="small"
                            />
                        }
                        label={
                            <Typography variant="body2" color="text.secondary">
                                I agree to the{' '}
                                <Link
                                    component="button"
                                    type="button"
                                    variant="body2"
                                    underline="hover"
                                    onClick={(e) => { e.preventDefault(); handleOpenDoc(privacyLinkText, privacyDocUrl); }}
                                >
                                    {privacyLinkText}
                                </Link>
                            </Typography>
                        }
                    />
                </Box>
            )}

            {/* Document Viewer Modal */}
            <Dialog
                open={docModalOpen}
                onClose={() => setDocModalOpen(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{ sx: { height: '85vh' } }}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}>
                    <Typography variant="h6" component="span">{docModalTitle}</Typography>
                    <IconButton onClick={() => setDocModalOpen(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0, overflow: 'hidden' }}>
                    {docModalUrl && (
                        <iframe
                            src={docModalUrl}
                            title={docModalTitle}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 2, py: 1 }}>
                    <Button onClick={() => setDocModalOpen(false)} variant="contained" size="small">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default LoginForm;
