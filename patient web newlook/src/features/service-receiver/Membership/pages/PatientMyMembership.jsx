/**
 * PatientMyMembership — a patient's own membership tier + self-service
 * upgrade / downgrade.
 *
 * Reuses the same MembershipPlansPanel the providers use: the panel is
 * vertical-agnostic, so for a patient it lists the PATIENT tiers (Care free /
 * Plus / premium) and runs the same server-priced, prorated Razorpay pay flow.
 * The membership pay endpoints now accept the patient role.
 */
import {
    Box, Container, Typography, Alert, Chip, Paper, Stack, CircularProgress, Divider,
} from '@mui/material';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import MembershipPlansPanel from '../../../service-provider/Membership/components/MembershipPlansPanel/MembershipPlansPanel';
import { useGetMyMembershipQuery } from '../../../service-provider/Membership/api/myMembershipEndpoints';

const STATUS_COLOR = {
    pending: 'warning', trial: 'info', active: 'success',
    past_due: 'error', cancelled: 'default', suspended: 'error',
};
const money = (n) => (n == null ? null : `₹${Number(n).toLocaleString('en-IN')}`);

export default function PatientMyMembership() {
    const { data, isLoading, error } = useGetMyMembershipQuery();
    const sub = data?.subscription || null;
    const plan = data?.plan || null;
    const noMembership = error?.status === 404;

    return (
        <Container maxWidth="md" sx={{ mt: 3, mb: 6 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
                <WorkspacePremiumIcon color="primary" />
                <Typography variant="h4" fontWeight={700}>My Membership</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Your membership tier and its benefits. Upgrade any time — the unused part
                of your current plan is credited. Downgrades take effect at your next cycle.
            </Typography>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
            ) : noMembership ? (
                <Alert severity="info">
                    You’re not on a membership tier yet. Pick one below to start saving on
                    consultations and services.
                </Alert>
            ) : (
                <>
                    {plan && (
                        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
                            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
                                <Typography variant="h6" fontWeight={700}>{plan.name}</Typography>
                                {sub?.status && (
                                    <Chip size="small" label={sub.status}
                                        color={STATUS_COLOR[sub.status] || 'default'}
                                        sx={{ textTransform: 'capitalize' }} />
                                )}
                                {money(plan.price_inr_monthly) != null && (
                                    <Typography variant="body2" color="text.secondary">
                                        {Number(plan.price_inr_monthly) === 0
                                            ? 'Free' : `${money(plan.price_inr_monthly)}/mo`}
                                    </Typography>
                                )}
                            </Stack>
                            {Number(plan.member_discount_pct) > 0 && (
                                <>
                                    <Divider sx={{ my: 1.5 }} />
                                    <Typography variant="body2">
                                        Up to <strong>{Number(plan.member_discount_pct)}%</strong> off
                                        consultations and services.
                                    </Typography>
                                </>
                            )}
                        </Paper>
                    )}
                    <MembershipPlansPanel title="Change your plan" />
                </>
            )}
        </Container>
    );
}
