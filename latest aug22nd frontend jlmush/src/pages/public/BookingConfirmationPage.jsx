/**
 * BookingConfirmationPage — post-payment confirmation at ``/book/confirmation``.
 *
 * Renders the appointment ID + a "we sent an OTP to your phone" notice +
 * a button that hands the visitor off to ``/book/first-login``. Reads
 * the verification result from sessionStorage (set by
 * :class:`PublicDoctorSlotsPage` right before navigating here).
 *
 * If the visitor lands here without a result blob (e.g. shared a link,
 * or session expired), we route them to the first-login screen anyway —
 * their account is real and the OTP flow can resume from there.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Button, Stack, Alert, useTheme, alpha,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SmsIcon from '@mui/icons-material/Sms';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';

export default function BookingConfirmationPage() {
    return (
        <PublicLandingLayout>
            <BookingConfirmationContent />
        </PublicLandingLayout>
    );
}

function BookingConfirmationContent() {
    const theme = useTheme();
    const navigate = useNavigate();
    const [result, setResult] = useState(null);

    useEffect(() => {
        try {
            const blob = sessionStorage.getItem('publicBookingResult');
            if (blob) setResult(JSON.parse(blob));
        } catch {
            // ignore — sessionStorage parse failure shouldn't block the page
        }
    }, []);

    return (
        <Box>
            <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, sm: 3 } }}>
                <Container maxWidth="sm">
                    <Paper
                        variant="outlined"
                        sx={{
                            p: { xs: 3, md: 5 },
                            borderRadius: 4,
                            textAlign: 'center',
                        }}
                    >
                        <Box
                            sx={{
                                width: 72, height: 72,
                                borderRadius: '50%', mx: 'auto', mb: 2,
                                bgcolor: alpha(theme.palette.success.main, 0.12),
                                color: 'success.main',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <CheckCircleIcon sx={{ fontSize: 48 }} />
                        </Box>
                        <Typography variant="h4" fontWeight={800} sx={{ mb: 1, letterSpacing: '-0.02em' }}>
                            Booking confirmed
                        </Typography>
                        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                            Your payment was successful. We've created your patient account
                            and sent a one-time login code to your phone.
                        </Typography>

                        {result?.appointment_id && (
                            <Alert
                                severity="success" icon={false}
                                sx={{
                                    mb: 3, textAlign: 'left',
                                    borderRadius: 2,
                                }}
                            >
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Appointment reference
                                </Typography>
                                <Typography variant="body2" fontFamily="monospace">
                                    {result.appointment_id}
                                </Typography>
                            </Alert>
                        )}

                        {result?.account_existed && (
                            <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
                                We found a patient account already linked to your phone
                                number — this booking has been added to it. Use your existing
                                password (or OTP) to log in.
                            </Alert>
                        )}

                        <Stack
                            direction="row" spacing={1} alignItems="center" justifyContent="center"
                            sx={{ mb: 3, color: 'text.secondary' }}
                        >
                            <SmsIcon fontSize="small" />
                            <Typography variant="body2">
                                Check your phone for the OTP — the next screen will sign you in.
                            </Typography>
                        </Stack>

                        <Button
                            variant="contained" size="large" fullWidth
                            onClick={() => navigate('/book/first-login', {
                                state: { phoneNumber: result?.phone_number },
                            })}
                            sx={{ fontWeight: 700, textTransform: 'none', py: 1.25, borderRadius: 2 }}
                        >
                            Continue to first login
                        </Button>
                    </Paper>
                </Container>
            </Box>
        </Box>
    );
}
