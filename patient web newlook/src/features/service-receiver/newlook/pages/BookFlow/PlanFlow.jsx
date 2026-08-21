/**
 * Plan / product checkout flow — port of the mobile MVP's ``app/checkout.tsx``.
 * Three steps: review what's being bought, choose what records to share, pay.
 *
 * The app's SECOND booking flow. One checkout for every non-appointment
 * product — services, group offerings, recovery plans and advanced care plans.
 * They differ only in what they're called and what they cost, so they share a
 * screen rather than each growing its own drift-prone copy of the same steps.
 * Appointments keep their own flow because they add slot selection.
 *
 * The product arrives by query string (``kind``, ``name``, ``price``,
 * ``provider``, ``meta``, ``productId``) so any surface — a category page, a
 * shelf, the marketplace — can start a checkout without this page needing to
 * know where it came from.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, ButtonBase, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLStepper from '../../components/NLStepper';
import NLRecordsShare, { emptyShare, sharedSectionTitles } from '../../components/NLRecordsShare';
import NLPaymentPanel from '../../components/NLPaymentPanel';
import {
    useGetCreditsQuery,
    useGetHouseGroupQuery,
    usePurchaseMarketplaceProductMutation,
} from '../../../api/scopedBookingApi';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { PRODUCT_LABEL, quoteFor, vouchersFor } from '../../data/checkout';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { inr } from '../../utils/format';

const STEPS = ['Review', 'Records', 'Pay'];

const KIND_ICON = {
    service: 'storefront-outline',
    group_offering: 'heart-circle-outline',
    recovery_plan: 'thermometer-outline',
    advanced_plan: 'infinite-outline',
};

const PlanFlow = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();

    const kind = searchParams.get('kind') || 'service';
    const name = searchParams.get('name') || 'Product';
    const price = Number(searchParams.get('price') || 0);
    const provider = searchParams.get('provider') || '';
    const meta = searchParams.get('meta') || '';
    const productId = searchParams.get('productId');
    // A sample-catalogue row has no live product id. Rather than dead-end the
    // flow, it runs end to end and confirms as a PREVIEW — labelled at every
    // step, and never claiming a real order was placed.
    const isSample = searchParams.get('sample') === '1';
    const listPrice = searchParams.get('listPrice')
        ? Number(searchParams.get('listPrice')) : null;

    const [step, setStep] = useState(0);
    const [share, setShare] = useState(emptyShare());
    const [bookingFor, setBookingFor] = useState('self');
    const [confirmed, setConfirmed] = useState(null);
    const [error, setError] = useState(null);

    const [voucherIds, setVoucherIds] = useState([]);
    const [coupons, setCoupons] = useState([]);
    const [credits, setCredits] = useState(0);
    const [method, setMethod] = useState('razorpay');
    const [agreed, setAgreed] = useState(false);

    const { data: creditsData } = useGetCreditsQuery();
    const { data: membership } = useGetPatientMembershipQuery();
    const { data: houseGroupResp } = useGetHouseGroupQuery(undefined, {
        skip: !hasFeature('patient.family'),
    });
    const [purchase, { isLoading: buying }] = usePurchaseMarketplaceProductMutation();

    const members = Array.isArray(houseGroupResp)
        ? houseGroupResp
        : (houseGroupResp?.data?.members || houseGroupResp?.members || []);
    const bookable = members.filter((m) => {
        const perms = m.permissions || {};
        return perms.visible !== false && perms.appointments && perms.appointments !== 'none';
    });
    const selectedMember = bookingFor === 'self'
        ? null : bookable.find((m) => m.member_id === bookingFor) || null;
    const forLabel = selectedMember
        ? `${selectedMember.first_name} ${selectedMember.last_name || ''}`.trim()
        : 'you';

    const vouchers = useMemo(() => vouchersFor(kind), [kind]);
    const quote = quoteFor({
        fee: price,
        listPrice,
        overallDiscountPct: price > 0 ? 5 : 0,
        vouchers: vouchers.filter((v) => voucherIds.includes(v.id)),
        coupons,
        creditsApplied: credits,
        planDiscountPct: membership?.plan?.member_discount_pct || 0,
        creditsAvailable: creditsData?.available || 0,
    });

    const canContinue = step === 2 ? agreed : true;

    const confirm = async () => {
        setError(null);
        try {
            // Only a real marketplace product can be purchased through the real
            // endpoint. Anything else (a sample catalogue row, a plan from the
            // assumed catalogue) has no product id, so say so rather than fake
            // a receipt.
            if (!productId) {
                if (isSample) { setConfirmed({ preview: true }); return; }
                setError(
                    'This item isn’t a live catalogue product, so it can’t be purchased yet. '
                    + 'Browse Services or Health Plans to buy something real.',
                );
                return;
            }
            const res = await purchase({
                product_id: productId,
                house_group_member_id: selectedMember?.member_id || undefined,
            }).unwrap();
            setConfirmed(res || {});
        } catch (e) {
            setError(e?.data?.error || e?.data?.message
                || 'Couldn’t complete the purchase. Please try again.');
        }
    };

    if (confirmed) {
        return (
            <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 620, mx: 'auto', textAlign: 'center' }}>
                <Box
                    sx={{
                        width: 72,
                        height: 72,
                        borderRadius: '50%',
                        bgcolor: colors.success,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mt: 4,
                        mb: 2,
                    }}
                >
                    <NLIcon name="checkmark" size={36} color={colors.white} />
                </Box>
                <Typography sx={typography.h1}>
                    {confirmed.preview ? 'Preview complete' : `${PRODUCT_LABEL[kind] || 'Product'} booked`}
                </Typography>
                <Typography sx={typography.bodyMuted}>{name} · for {forLabel}</Typography>
                <Typography sx={typography.bodyMuted}>
                    {quote.total === 0 ? 'Fully covered' : `${inr(quote.total)} payable`}
                </Typography>
                <Typography sx={{ ...typography.caption, mt: 1 }}>
                    {confirmed.preview
                        ? 'Nothing was ordered or charged — this item is sample data. A real product follows exactly these steps.'
                        : 'Your provider accepts it next — you’ll find it under Pending until they do.'}
                </Typography>
                <Button
                    variant="contained"
                    fullWidth
                    sx={{ mt: 3, height: 48, fontWeight: 700 }}
                    onClick={() => navigate(`${basePath}/newlook/bookings?view=pending`)}
                >
                    View it in My Appointments
                </Button>
                <Button fullWidth sx={{ mt: 1 }} onClick={() => navigate(`${basePath}/newlook`)}>
                    Back to home
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 2 }}>Checkout</Typography>

            <NLStepper steps={STEPS} current={step} onStep={setStep} canNext={canContinue} />

            {bookable.length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2 }}>
                    {[{ member_id: 'self', first_name: 'Myself' }, ...bookable].map((m) => {
                        const on = bookingFor === m.member_id;
                        return (
                            <ButtonBase
                                key={m.member_id}
                                onClick={() => setBookingFor(m.member_id)}
                                sx={{
                                    px: '12px',
                                    py: '8px',
                                    borderRadius: `${radius.pill}px`,
                                    border: `1px solid ${on ? colors.primary : colors.border}`,
                                    bgcolor: on ? tint(colors.primary, 0.08) : colors.surface,
                                    color: on ? colors.primary : colors.textSecondary,
                                    fontSize: 12.5,
                                    fontWeight: on ? 700 : 600,
                                }}
                            >
                                {`${m.first_name} ${m.last_name || ''}`.trim()}
                            </ButtonBase>
                        );
                    })}
                </Box>
            ) : null}

            {isSample ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <strong>Preview.</strong> This is a sample catalogue item, so the flow runs
                    end to end but no order is placed and nothing is charged.
                </Alert>
            ) : null}

            {error ? (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
            ) : null}

            {/* ── Step 0: review ──────────────────────────────────────── */}
            {step === 0 ? (
                <NLCard sx={{ display: 'flex', gap: 1.75 }}>
                    <Box
                        sx={{
                            width: 48,
                            height: 48,
                            borderRadius: '50%',
                            bgcolor: tint(colors.secondary, 0.1),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <NLIcon
                            name={KIND_ICON[kind] || 'storefront-outline'}
                            size={22}
                            color={colors.secondary}
                        />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <NLBadge label={PRODUCT_LABEL[kind] || kind} tone="secondary" />
                        </Box>
                        <Typography sx={{ ...typography.h3, ...clamp(2) }}>{name}</Typography>
                        {provider ? (
                            <Typography sx={typography.bodyMuted}>{provider}</Typography>
                        ) : null}
                        {meta ? <Typography sx={typography.caption}>{meta}</Typography> : null}
                        <Typography
                            sx={{ fontSize: 21, fontWeight: 800, color: colors.primary, mt: 1 }}
                        >
                            {price === 0 ? 'Free' : inr(price)}
                        </Typography>
                    </Box>
                </NLCard>
            ) : null}

            {/* ── Step 1: records ─────────────────────────────────────── */}
            {step === 1 ? (
                <NLRecordsShare value={share} onChange={setShare} patientName={forLabel} />
            ) : null}

            {/* ── Step 2: summary + pay ───────────────────────────────── */}
            {step === 2 ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 1 }}>ORDER SUMMARY</Typography>
                    <NLCard sx={{ mb: 2 }}>
                        {[
                            ['Patient', forLabel],
                            ['Product', name],
                            ['Type', PRODUCT_LABEL[kind] || kind],
                            ['Provider', provider || '—'],
                            ['Records shared', share.share
                                ? (sharedSectionTitles(share).join(', ') || 'None selected')
                                : 'No'],
                        ].map(([k, v]) => (
                            <Box key={k} sx={{ display: 'flex', gap: 2, py: '5px' }}>
                                <Typography sx={{ ...typography.bodyMuted, width: 130, flexShrink: 0 }}>
                                    {k}
                                </Typography>
                                <Typography sx={{ ...typography.body, fontWeight: 600, flex: 1 }}>
                                    {v}
                                </Typography>
                            </Box>
                        ))}
                    </NLCard>

                    <NLPaymentPanel
                        quote={quote}
                        vouchers={vouchers}
                        appliedVoucherIds={voucherIds}
                        onToggleVoucher={(id) => setVoucherIds((s) =>
                            s.includes(id) ? s.filter((x) => x !== id) : [...s, id])}
                        coupons={coupons}
                        onApplyCoupon={(c) => setCoupons((s) => [...s, c])}
                        onRemoveCoupon={(id) => setCoupons((s) => s.filter((c) => c.id !== id))}
                        credits={credits}
                        onCredits={setCredits}
                        method={method}
                        onMethod={setMethod}
                        agreed={agreed}
                        onAgreed={setAgreed}
                    />
                </>
            ) : null}

            <Box sx={{ display: 'flex', gap: 1.5, mt: 3 }}>
                {step > 0 ? (
                    <Button variant="outlined" onClick={() => setStep(step - 1)} sx={{ flex: 1, height: 48 }}>
                        Back
                    </Button>
                ) : null}
                {step < STEPS.length - 1 ? (
                    <Button
                        variant="contained"
                        onClick={() => setStep(step + 1)}
                        sx={{ flex: 2, height: 48, fontWeight: 700 }}
                    >
                        Continue
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        disabled={!agreed || buying}
                        onClick={confirm}
                        sx={{ flex: 2, height: 48, fontWeight: 700 }}
                    >
                        {buying ? 'Processing…'
                            : quote.total === 0 ? 'Confirm' : `Pay ${inr(quote.total)}`}
                    </Button>
                )}
            </Box>
        </Box>
    );
};

export default PlanFlow;
