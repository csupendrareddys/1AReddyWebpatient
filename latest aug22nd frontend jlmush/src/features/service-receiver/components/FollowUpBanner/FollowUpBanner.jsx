/**
 * FollowUpBanner - Shows pending follow-up invites from doctors.
 *
 * For PAID_PATIENT_PICKS: "Book on [suggested date]" → links to booking page
 * For PAID_DOCTOR_PICKS: "Pay & Confirm" → calls bookFollowUp → opens Razorpay
 */
import {
    Box, Card, CardContent, Typography, Button, Chip, Stack, Alert,
    CircularProgress,
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import PaymentIcon from '@mui/icons-material/Payment';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import { useNavigate } from 'react-router-dom';
import {
    useGetFollowUpInvitesQuery,
    useBookFollowUpMutation,
} from '../../api/scopedBookingApi';
import {
    useCreatePaymentOrderMutation,
    useVerifyPaymentMutation,
} from '../../api/patientEndpoints';
import usePatientCheckout from '../../api/usePatientCheckout';
import { loadRazorpayScript } from '../../../../utils/loadRazorpayScript';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';

const FollowUpBanner = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { data: invites = [], isLoading } = useGetFollowUpInvitesQuery();
    const [bookFollowUp, { isLoading: booking }] = useBookFollowUpMutation();
    const [createPaymentOrder] = useCreatePaymentOrderMutation();
    const [verifyPayment] = useVerifyPaymentMutation();
    // Ops mode: an admin can't drive the patient's Razorpay popup, so the
    // doctor-picks branch settles offline instead.
    const { checkout, isOps, markAsPaid } = usePatientCheckout();

    if (isLoading || invites.length === 0) return null;

    const handlePatientPicks = (invite) => {
        // Navigate to booking page pre-filtered to doctor + suggested date
        navigate(
            `${basePath}/book/${invite.doctor_id}/${invite.consultation_type}?follow_up_invite=${invite.id}&date=${invite.suggested_date}`
        );
    };

    const handleDoctorPicks = async (invite) => {
        try {
            // Book from the reserved slot
            const result = await bookFollowUp({ inviteId: invite.id }).unwrap();
            const appointment = result.data || result;

            if (isOps) {
                await checkout({
                    appointmentId: appointment.id,
                    description: `Follow-up with Dr. ${invite.doctor_name}`,
                });
                alert(markAsPaid
                    ? 'Follow-up booked and recorded as paid offline.'
                    : 'Follow-up booked, left unpaid — the patient can pay it from their own app.');
                return;
            }

            // Now initiate Razorpay payment
            const orderResult = await createPaymentOrder({
                appointment_id: appointment.id,
            }).unwrap();
            const orderData = orderResult.data || orderResult;

            const ok = await loadRazorpayScript();
            if (!ok || !window.Razorpay) {
                alert('Razorpay SDK failed to load. Are you online?');
                return;
            }

            // Open Razorpay checkout
            const options = {
                key: orderData.key_id,
                amount: orderData.amount,
                currency: orderData.currency || 'INR',
                name: 'Follow-Up Appointment',
                description: `Follow-up with Dr. ${invite.doctor_name}`,
                order_id: orderData.razorpay_order_id,
                // Prefill from our stored profile so the popup never re-asks for the phone.
                prefill: Object.fromEntries(
                    Object.entries(orderData?.prefill || {}).filter(([, v]) => v)
                ),
                handler: async (response) => {
                    try {
                        await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            payment_id: orderData.payment_id,
                        }).unwrap();
                        alert('Payment successful! Your follow-up appointment is confirmed.');
                        navigate(`${basePath}/my-appointments`);
                    } catch {
                        alert('Payment verification failed. Please contact support.');
                    }
                },
                theme: { color: '#1976d2' },
            };

            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (err) {
            alert(err?.data?.error || 'Failed to book follow-up');
        }
    };

    return (
        <Box sx={{ mb: 3 }}>
            {invites.map((invite) => (
                <Card
                    key={invite.id}
                    sx={{
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'warning.main',
                        borderLeft: '4px solid',
                        borderLeftColor: 'warning.main',
                        bgcolor: 'warning.50',
                    }}
                >
                    <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <LocalHospitalIcon color="warning" />
                                <Box>
                                    <Typography variant="subtitle2" fontWeight="bold">
                                        Follow-Up Recommended by Dr. {invite.doctor_name}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {invite.consultation_type.charAt(0).toUpperCase() + invite.consultation_type.slice(1)} consultation
                                        {invite.follow_up_type === 'paid_patient_picks' && invite.suggested_date && (
                                            <> on <strong>{new Date(invite.suggested_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></>
                                        )}
                                        {invite.follow_up_type === 'paid_doctor_picks' && invite.reserved_slot && (
                                            <> on <strong>{new Date(invite.reserved_slot.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong> at <strong>{invite.reserved_slot.start}</strong></>
                                        )}
                                    </Typography>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Chip
                                    label={invite.follow_up_type === 'paid_patient_picks' ? 'Pick Your Slot' : 'Reserved for You'}
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                />

                                {invite.follow_up_type === 'paid_patient_picks' ? (
                                    <Button
                                        variant="contained"
                                        size="small"
                                        startIcon={<EventIcon />}
                                        onClick={() => handlePatientPicks(invite)}
                                    >
                                        Book Now
                                    </Button>
                                ) : (
                                    <Button
                                        variant="contained"
                                        color="warning"
                                        size="small"
                                        startIcon={booking ? <CircularProgress size={16} /> : <PaymentIcon />}
                                        onClick={() => handleDoctorPicks(invite)}
                                        disabled={booking}
                                    >
                                        Pay & Confirm
                                    </Button>
                                )}
                            </Box>
                        </Stack>
                    </CardContent>
                </Card>
            ))}
        </Box>
    );
};

export default FollowUpBanner;
