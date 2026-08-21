/**
 * Money (new look) — port of the mobile MVP's drawer "Money" group: Wallet,
 * Spending, Membership, Marketplace.
 *
 * The mobile Wallet screen has a gradient balance card and an "add money"
 * top-up flow. THIS APP HAS NO TOP-UP: the only patient balance the backend
 * keeps is the health-credit wallet, which is granted by a membership plan and
 * refunded into on cancellation — there is no endpoint to pay money into it. So
 * the balance card is here, with the real credit balance and its expiry, and the
 * top-up controls are not, because pressing them could do nothing.
 */
import { useNavigate } from 'react-router-dom';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLIcon from '../../components/NLIcon';
import NLMenuRow from '../../components/NLMenuRow';
import NLSectionHeader from '../../components/NLSectionHeader';
import NLStatTile from '../../components/NLStatTile';
import {
    useGetCreditsQuery,
    useGetSpendingQuery,
} from '../../../api/scopedBookingApi';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { colors, typography } from '../../theme/tokens';
import { fmtDate, inr } from '../../utils/format';

const Money = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const go = (p) => navigate(`${basePath}/${p}`);

    const { data: credits, isLoading: creditsLoading } = useGetCreditsQuery();
    const { data: spending, isLoading: spendLoading, error: spendError } = useGetSpendingQuery();
    const { data: membership } = useGetPatientMembershipQuery();

    const balance = credits?.available || 0;
    const expiry = credits?.wallet?.period_end;
    const payments = spending?.payments || [];
    const totalSpent = spending?.total_spent || 0;
    const successful = payments.filter((p) => p.status === 'success').length;
    const planName = membership?.plan?.name;

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Money</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Your credits, what you&apos;ve spent, and the plan it&apos;s all priced against.
            </Typography>

            {/* The mobile balance card, with the one real balance this app keeps. */}
            <Box
                sx={{
                    borderRadius: '16px',
                    p: 2.5,
                    mb: 3,
                    color: colors.white,
                    background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <NLIcon name="wallet-outline" size={18} color={colors.white} />
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, opacity: 0.9 }}>
                        Health credits available
                    </Typography>
                </Box>
                <Typography sx={{ fontSize: 32, fontWeight: 800, mt: 0.5 }}>
                    {creditsLoading ? '—' : inr(balance)}
                </Typography>
                <Typography sx={{ fontSize: 12, opacity: 0.9 }}>
                    {balance > 0
                        ? `Spendable on eligible bookings and renewals${expiry ? ` · expires ${fmtDate(expiry)}` : ''}`
                        : 'Credits arrive with a membership plan, and come back here if a booking is cancelled.'}
                </Typography>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                    gap: '10px',
                    mb: 3,
                }}
            >
                <NLStatTile
                    icon="card-outline"
                    label="Total spent"
                    value={spendLoading ? '—' : inr(totalSpent)}
                    tint={colors.error}
                    onClick={() => go('spending')}
                />
                <NLStatTile
                    icon="receipt-outline"
                    label="Payments"
                    value={spendLoading ? '—' : String(successful)}
                    onClick={() => go('spending')}
                />
                <NLStatTile
                    icon="ribbon-outline"
                    label={planName ? 'Your plan' : 'Membership'}
                    value={planName || 'None'}
                    tint={colors.secondary}
                    onClick={() => go('my-membership')}
                />
            </Box>

            {spendError ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Couldn’t load your spending just now.
                </Alert>
            ) : null}

            <NLSectionHeader
                title="Recent payments"
                actionLabel="View all"
                onAction={() => go('spending')}
            />
            {spendLoading ? (
                <NLCard sx={{ display: 'flex', justifyContent: 'center', py: 3, mb: 3 }}>
                    <CircularProgress size={22} />
                </NLCard>
            ) : payments.length ? (
                <NLCard sx={{ p: 0, overflow: 'hidden', mb: 3 }}>
                    {payments.slice(0, 5).map((p, i) => (
                        <NLMenuRow
                            key={p.id || `${p.date}-${i}`}
                            icon={p.status === 'success' ? 'checkmark-circle' : 'time-outline'}
                            title={p.description || p.purpose || 'Payment'}
                            subtitle={[fmtDate(p.date || p.created_at), p.method].filter(Boolean).join(' · ')}
                            value={p.amount != null ? inr(p.amount) : undefined}
                            tint={p.status === 'success' ? colors.success : colors.warning}
                            onClick={() => go('spending')}
                            last={i === Math.min(payments.length, 5) - 1}
                        />
                    ))}
                </NLCard>
            ) : (
                <NLCard sx={{ mb: 3 }}>
                    <Typography sx={typography.bodyMuted}>
                        No payments yet. Anything you pay for shows up here.
                    </Typography>
                </NLCard>
            )}

            <NLSectionHeader title="Browse" />
            <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                <NLMenuRow
                    icon="card-outline"
                    title="Wallet"
                    subtitle="Money on the platform — balance, top-up, transactions"
                    onClick={() => go('newlook/wallet')}
                />
                <NLMenuRow
                    icon="wallet-outline"
                    title="Credits & Spending"
                    subtitle="Payment history and your credit ledger"
                    value={creditsLoading ? undefined : inr(balance)}
                    tint={colors.error}
                    onClick={() => go('spending')}
                />
                <NLMenuRow
                    icon="ribbon-outline"
                    title="Membership"
                    subtitle="Your plan, benefits and renewal"
                    badge={planName ? undefined : 'Not on a plan'}
                    tint={colors.secondary}
                    onClick={() => go('my-membership')}
                />
                <NLMenuRow
                    icon="storefront-outline"
                    title="Services"
                    subtitle="Buy add-on services from your providers"
                    tint={colors.warning}
                    onClick={() => go('marketplace')}
                    disabled={!hasFeature('clinic.marketplace')}
                />
                <NLMenuRow
                    icon="heart-circle-outline"
                    title="Health Plans"
                    subtitle="Longer programmes run by a care team"
                    tint="#5e35b1"
                    onClick={() => go('health-plans')}
                    last
                />
            </NLCard>
        </Box>
    );
};

export default Money;
