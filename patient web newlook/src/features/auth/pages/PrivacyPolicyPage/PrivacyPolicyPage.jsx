import { Box, Typography, Container, Paper, Button, IconButton, Tooltip } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useDispatch, useSelector } from 'react-redux';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme } from '../../redux/themeSlice';

const PrivacyPolicyPage = () => {
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
                        Privacy Policy
                    </Typography>

                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        Last updated: January 2026
                    </Typography>

                    <Box sx={{ mt: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            1. Information We Collect
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We collect information you provide directly to us, such as when you create an account,
                            book an appointment, or communicate with healthcare providers. This may include:
                        </Typography>
                        <Typography component="ul" sx={{ pl: 3, mb: 2 }}>
                            <li>Personal identification information (name, email, phone number)</li>
                            <li>Health information and medical records</li>
                            <li>Payment information</li>
                            <li>Device and usage information</li>
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            2. How We Use Your Information
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We use the information we collect to:
                        </Typography>
                        <Typography component="ul" sx={{ pl: 3, mb: 2 }}>
                            <li>Provide, maintain, and improve our services</li>
                            <li>Process transactions and send related information</li>
                            <li>Send you technical notices and support messages</li>
                            <li>Respond to your comments and questions</li>
                            <li>Protect the safety and security of our users</li>
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            3. Data Security
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We implement appropriate security measures to protect your personal information. Your data is
                            encrypted at rest using AES-256 encryption. We use secure HTTPS connections for all data transfers.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            4. Data Sharing
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We do not sell, trade, or otherwise transfer your personal information to third parties.
                            We may share your health information with healthcare providers on our platform only with your consent.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            5. Cookies
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We use cookies and similar technologies to maintain your session, remember your preferences,
                            and secure your account. You can control cookie settings through your browser.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            6. Your Rights
                        </Typography>
                        <Typography variant="body1" paragraph>
                            You have the right to:
                        </Typography>
                        <Typography component="ul" sx={{ pl: 3, mb: 2 }}>
                            <li>Access your personal data</li>
                            <li>Correct inaccurate data</li>
                            <li>Request deletion of your data</li>
                            <li>Object to processing of your data</li>
                            <li>Request data portability</li>
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            7. Children's Privacy
                        </Typography>
                        <Typography variant="body1" paragraph>
                            Our services are not directed to children under 13. We do not knowingly collect personal
                            information from children under 13 without parental consent.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            8. Changes to This Policy
                        </Typography>
                        <Typography variant="body1" paragraph>
                            We may update this privacy policy from time to time. We will notify you of any changes by
                            posting the new policy on this page.
                        </Typography>

                        <Typography variant="h6" gutterBottom>
                            9. Contact Us
                        </Typography>
                        <Typography variant="body1" paragraph>
                            If you have any questions about this Privacy Policy, please contact us at privacy@healthcare.com.
                        </Typography>
                    </Box>

                    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="body2" color="text.secondary">
                            Also see our{' '}
                            <Typography
                                component={RouterLink}
                                to="/terms-and-conditions"
                                color="primary"
                                sx={{ textDecoration: 'underline', cursor: 'pointer' }}
                            >
                                Terms and Conditions
                            </Typography>
                        </Typography>
                    </Box>
                </Paper>
            </Container>
        </Box>
    );
};

export default PrivacyPolicyPage;
