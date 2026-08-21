import { Box, Typography, Container, Paper, Button, IconButton, Tooltip } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useDispatch, useSelector } from 'react-redux';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme } from '../../redux/themeSlice';

const TermsAndConditionsPage = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { isDarkMode } = useSelector((state) => state.theme);

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
            {/* Theme Toggle */}
            <Box sx={{ position: 'fixed', top: 16, right: 16 }}>
                <Tooltip title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
                    <IconButton onClick={() => dispatch(toggleTheme())} color="primary">
                        {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                    </IconButton>
                </Tooltip>
            </Box>

            <Container maxWidth="md">
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate(-1)}
                    sx={{ mb: 2 }}
                >
                    Back
                </Button>

                <Paper elevation={3} sx={{ p: 4, borderRadius: 3 }}>
                    <Typography variant="h4" component="h1" gutterBottom color="primary">
                        Terms and Conditions
                    </Typography>

                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        Last updated: January 2026
                    </Typography>

                    <Box sx={{ mt: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            1. Acceptance of Terms
                        </Typography>
                        <Typography variant="body1" paragraph>
                            By accessing and using this healthcare platform, you agree to be bound by these Terms and Conditions.
                            If you do not agree with any part of these terms, please do not use our services.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            2. Description of Services
                        </Typography>
                        <Typography variant="body1" paragraph>
                            Our platform provides healthcare services including but not limited to: online consultations,
                            appointment scheduling, prescription management, and health record management. These services
                            are provided for informational purposes and should not replace professional medical advice.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            3. User Accounts
                        </Typography>
                        <Typography variant="body1" paragraph>
                            You are responsible for maintaining the confidentiality of your account credentials. You agree to
                            notify us immediately of any unauthorized use of your account. We reserve the right to suspend or
                            terminate accounts that violate these terms.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            4. Medical Disclaimer
                        </Typography>
                        <Typography variant="body1" paragraph>
                            The information provided through our platform is for general informational purposes only. It is not
                            intended to be a substitute for professional medical advice, diagnosis, or treatment. Always seek
                            the advice of your physician or other qualified health provider.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            5. Privacy
                        </Typography>
                        <Typography variant="body1" paragraph>
                            Your privacy is important to us. Please review our{' '}
                            <Typography
                                component={RouterLink}
                                to="/privacy-policy"
                                color="primary"
                                sx={{ textDecoration: 'underline', cursor: 'pointer' }}
                            >
                                Privacy Policy
                            </Typography>{' '}
                            to understand how we collect, use, and protect your personal information.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            6. Service Provider Verification
                        </Typography>
                        <Typography variant="body1" paragraph>
                            All healthcare service providers on our platform are subject to verification by our administrators.
                            Service providers must provide valid credentials and licenses to operate on our platform.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            7. Limitation of Liability
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We shall not be liable for any indirect, incidental, special, consequential, or punitive damages
                            arising out of or relating to your use of our services.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            8. Changes to Terms
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We reserve the right to modify these terms at any time. We will notify users of any material changes
                            by posting the new terms on this page.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            9. Contact Us
                        </Typography>
                        <Typography variant="body1" paragraph>
                            If you have any questions about these Terms and Conditions, please contact us at support@healthcare.com.
                        </Typography>
                    </Box>
                </Paper>
            </Container>
        </Box>
    );
};

export default TermsAndConditionsPage;
