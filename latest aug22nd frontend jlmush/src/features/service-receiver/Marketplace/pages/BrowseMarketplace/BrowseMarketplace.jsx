/**
 * BrowseMarketplace — Patient view of the marketplace.
 * Patients can browse products from all doctors and purchase them independently.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box, Typography, Grid, Card, CardContent, CardActions, Button,
    CircularProgress, TextField, InputAdornment, Chip, Avatar,
    Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Alert,
    Divider, Stack, Checkbox
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import PersonIcon from '@mui/icons-material/Person';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import LoyaltyIcon from '@mui/icons-material/Loyalty';

import {
    useBrowseMarketplaceQuery,
    usePurchaseMarketplaceProductMutation,
    useUploadOrderAttachmentMutation,
    useLinkAppointmentContextMutation,
} from '../../../api/scopedBookingApi';
import BookingIntakeBar from '../../../components/BookingIntakeBar/BookingIntakeBar';
import OfferingFeatures from '../../../components/OfferingFeatures/OfferingFeatures';
import CreditRedeem from '../../../components/CreditRedeem/CreditRedeem';
import usePatientCheckout from '../../../api/usePatientCheckout';
import useMemberDiscount from '../../../../../common/hooks/useMemberDiscount';
import { applyPct, offeringMemberDiscount } from '../../../../../common/components/PlanCard/MemberDiscountBadge';
import DiscountedPrice, { formatMoney } from '../../../../../common/components/Price/DiscountedPrice';
import RedeemCodeFields from '../../../../../common/components/Price/RedeemCodeFields';

const BrowseMarketplace = () => {
    // Pre-filter by doctor when arriving from a doctor's "Choose Consultation
    // Type" screen (Marketplace card → ?doctor=<name>). The product filter
    // below already matches on doctor_name, so seeding the search box scopes
    // the list to that doctor.
    const [searchParams] = useSearchParams();
    const [search, setSearch] = useState(searchParams.get('doctor') || '');
    const { data: products = [], isLoading } = useBrowseMarketplaceQuery();
    const [purchaseProduct] = usePurchaseMarketplaceProductMutation();
    const [uploadOrderAttachment] = useUploadOrderAttachmentMutation();
    // Razorpay for the patient; an audited offline settlement when a
    // super-admin is buying on their behalf from Operations.
    const { checkout, isOps, markAsPaid } = usePatientCheckout();
    // The buyer's membership tier names the discount line in the purchase
    // dialog; what it actually takes off is per-service. A tier's headline % is
    // a ceiling that
    // ``DisplayPricingRule.plan_discounts`` can dial an individual service
    // below, and the backend re-resolves that same per-service figure against
    // ``price_at_purchase`` — so quoting the ceiling here would promise a
    // total the checkout won't honour.
    const { planName } = useMemberDiscount();

    const [linkContext] = useLinkAppointmentContextMutation();

    const [purchaseDialog, setPurchaseDialog] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [description, setDescription] = useState('');
    const [file, setFile] = useState(null);
    const [booking, setBooking] = useState(false);
    // Intake context (book-for / health records) collected in the dialog and
    // linked to the order once it's created.
    const [intakeContextId, setIntakeContextId] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    // What the open dialog's own service grants this buyer, and the total that
    // follows from it.
    const selectedMember = offeringMemberDiscount(selectedProduct);
    const selectedPayable = applyPct(selectedProduct?.doctor_price, selectedMember.pct);

    // ── Redeemable offers on THIS service ─────────────────────────────────
    // Keyed on the catalog product, same as the rule the purchase charges
    // from. A group offering has no per-doctor rule, so it asks for nothing.
    const [appliedCodes, setAppliedCodes] = useState([]);
    const redeemedIds = appliedCodes.map((a) => a.id);
    const redeemedTotal = appliedCodes.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    // Falls back to the list price for a buyer on no tier — they can still
    // redeem, so the total still has to move.
    const basePayable = selectedPayable != null
        ? selectedPayable
        : Number(selectedProduct?.doctor_price || 0);
    const [creditsApplied, setCreditsApplied] = useState(0);
    const finalPayable = Math.max(
        0, Math.round((basePayable - redeemedTotal - creditsApplied) * 100) / 100,
    );
    const creditScope = selectedProduct?.offering_type === 'group' ? 'group' : 'service';


    const handleOpenPurchase = (p) => {
        setSelectedProduct(p);
        setAppliedCodes([]);
        setCreditsApplied(0);
        setDescription('');
        setFile(null);
        setIntakeContextId(null);
        setPurchaseDialog(true);
    };

    // Deep-link: arriving from a landing feature's "Book Now"
    // (?product_id=<id>, possibly via login) auto-opens that product's
    // booking dialog so the buyer lands on the product, not a bare list.
    // Runs once, after the catalog loads.
    const deepLinkProductId = searchParams.get('product_id');
    const autoOpenedRef = useRef(false);
    useEffect(() => {
        if (autoOpenedRef.current || !deepLinkProductId || isLoading) return;
        if (!products.length) return;
        const match = products.find(
            (p) => String(p.product_id ?? '') === deepLinkProductId
                || String(p.id ?? '') === deepLinkProductId,
        );
        if (match) {
            autoOpenedRef.current = true;
            handleOpenPurchase(match);
        }
    }, [deepLinkProductId, isLoading, products]);

    // Book like an appointment: create the order (with the note), attach the
    // optional file, then pay right away. The provider accepts/rejects after.
    const handleConfirmPurchase = async () => {
        if (booking) return;
        setBooking(true);
        try {
            const payload = selectedProduct?.offering_type === 'group'
                ? { group_id: selectedProduct.id, description, redeem_credits: creditsApplied }
                : {
                    mp_product_id: selectedProduct.id,
                    description,
                    // Re-validated server-side against the same rule.
                    redeemed_discount_ids: redeemedIds,
                    redeem_credits: creditsApplied,
                };
            const res = await purchaseProduct(payload).unwrap();
            const order = res?.data || res;
            const orderId = order?.id;

            if (file && orderId) {
                try {
                    await uploadOrderAttachment({ orderId, file }).unwrap();
                } catch { /* attachment is optional — don't block payment */ }
            }

            // Attach the intake (book-for / health records) to the order so the
            // provider sees it and the patient can edit it until it's completed.
            if (intakeContextId && orderId) {
                try {
                    await linkContext({ contextId: intakeContextId, marketplace_order_id: orderId }).unwrap();
                } catch { /* intake is best-effort — don't block payment */ }
            }

            await checkout({
                orderId,
                description: selectedProduct?.product_name || 'Service booking',
            });

            setSnackbar({
                open: true,
                message: isOps
                    ? (markAsPaid
                        ? 'Recorded as paid offline. The request is with the provider — they’ll accept or reject it.'
                        : 'Booked and left unpaid. The patient can pay it from their own app; the provider sees it once paid.')
                    : 'Payment successful! Your request was sent to the provider — you’ll get access once they accept it.',
                severity: 'success',
            });
            setPurchaseDialog(false);
        } catch (err) {
            setSnackbar({
                open: true,
                message: err?.message || err?.data?.message || 'Booking failed. Please try again.',
                severity: 'error',
            });
        } finally {
            setBooking(false);
        }
    };

    if (isLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const q = search.toLowerCase();
    const filteredProducts = products.filter(p =>
        // Either field can come back null (e.g. an unassigned/team product), so
        // guard before lower-casing — otherwise the whole Services page crashes.
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.doctor_name || '').toLowerCase().includes(q)
    );

    return (
        <Box sx={{ p: 4 }}>
            {/* Header */}
            <Box mb={4}>
                <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                    <StorefrontIcon color="primary" sx={{ fontSize: 32 }} />
                    <Typography variant="h4" fontWeight="bold">Services</Typography>
                </Stack>
                <Typography variant="body1" color="text.secondary">
                    Purchase specialized reports, certificates, and medical services directly from verified doctors.
                </Typography>
            </Box>

            {/* Search Bar */}
            <Box mb={4} sx={{ maxWidth: 600 }}>
                <TextField
                    placeholder="Search for products or doctors..."
                    fullWidth
                    variant="outlined"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon color="action" />
                            </InputAdornment>
                        ),
                        sx: { borderRadius: 3, bgcolor: 'white' }
                    }}
                />
            </Box>

            {/* Product Grid */}
            <Grid container spacing={3}>
                {filteredProducts.length === 0 && (
                    <Grid item xs={12}>
                        <Box py={8} textAlign="center" bgcolor="white" borderRadius={3}>
                            <ShoppingBagIcon sx={{ fontSize: 64, color: 'divider', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary">No products found.</Typography>
                        </Box>
                    </Grid>
                )}
                {filteredProducts.map((p) => {
                    // This service's own membership figure, not the tier's
                    // ceiling — ``DisplayPricingRule.plan_discounts`` can dial
                    // an individual service below it.
                    const member = offeringMemberDiscount(p);
                    return (
                    <Grid item xs={12} sm={6} md={4} key={p.id}>
                        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' } }}>
                            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                <Box mb={1.5}>
                                    <Chip
                                        label={p.offering_type === 'group' ? 'Group Service' : 'Product/Service'}
                                        size="small"
                                        color={p.offering_type === 'group' ? 'secondary' : 'primary'}
                                        variant="outlined"
                                    />
                                </Box>
                                <Typography variant="h6" gutterBottom fontWeight="bold">
                                    {p.product_name}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {p.doctor_description || p.product_description}
                                </Typography>

                                {/* Price block, built like the consultation
                                    cards on Find My Doctors: the listed price
                                    exactly as listed, and the membership
                                    reduction stated as a percentage that
                                    settles at billing. No post-membership
                                    figure — it depends on who is buying, and
                                    quoting it beside the list price is what
                                    left the patient guessing which number
                                    they'd actually be charged.

                                    The strikethrough is a different discount:
                                    the admin's markdown on this service,
                                    already baked into ``doctor_price``.
                                    ``original_price`` is only sent when there
                                    is one. */}
                                <Box
                                    sx={{
                                        mt: 'auto', mb: 2, px: 1.5, py: 1.25, borderRadius: 2.5,
                                        border: '1px solid', borderColor: 'rgba(25,118,210,0.28)',
                                        bgcolor: 'rgba(25,118,210,0.05)',
                                    }}
                                >
                                    <DiscountedPrice
                                        price={p.doctor_price}
                                        original={p.original_price}
                                        discountPct={p.discount_pct}
                                        variant="h6"
                                        originalVariant="body2"
                                        color="primary.main"
                                        showPct={false}
                                    />
                                    {member.pct > 0 && (
                                        <Stack direction="row" spacing={0.75} alignItems="flex-start" mt={0.5}>
                                            <LoyaltyIcon sx={{ fontSize: 15, mt: '1px' }} color="success" />
                                            <Typography
                                                variant="caption"
                                                color="success.dark"
                                                fontWeight={600}
                                                sx={{ lineHeight: 1.35 }}
                                            >
                                                {member.pct}% membership discount, applied at billing
                                            </Typography>
                                        </Stack>
                                    )}
                                </Box>

                                <Divider sx={{ mb: 2 }} />

                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.light' }}>
                                        <PersonIcon fontSize="small" />
                                    </Avatar>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" display="block">
                                            {p.offering_type === 'group' ? 'Served by' : 'Offered by'}
                                        </Typography>
                                        <Typography variant="subtitle2">
                                            {p.offering_type === 'group' ? p.doctor_name : `Dr. ${p.doctor_name}`}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </CardContent>
                            <CardActions sx={{ p: 2, pt: 0 }}>
                                <Button fullWidth variant="contained" color="success" onClick={() => handleOpenPurchase(p)} sx={{ borderRadius: 2, fontWeight: 'bold' }}>
                                    Purchase Now
                                </Button>
                            </CardActions>
                        </Card>
                    </Grid>
                    );
                })}
            </Grid>

            {/* Purchase Confirmation Dialog */}
            <Dialog open={purchaseDialog} onClose={() => setPurchaseDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle component="div" sx={{ textAlign: 'center', pt: 3 }}>
                    <ShoppingBagIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
                    <Typography variant="h5" fontWeight="bold">Confirm Purchase</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box textAlign="center" py={1}>
                        <Typography variant="h6" fontWeight="bold" color="primary">
                            {selectedProduct?.product_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {selectedProduct?.doctor_name}
                        </Typography>
                        {/* Itemised once a membership tier is in play, so the
                            patient can see where the reduction came from
                            rather than a total that silently disagrees with
                            the price they clicked. */}
                        {selectedMember.hasDiscount ? (
                            <Stack spacing={0.25} sx={{ mt: 1.5 }}>
                                <Stack direction="row" justifyContent="space-between">
                                    <Typography variant="body2" color="text.secondary">Price</Typography>
                                    {/* The service's own list price, already
                                        marked down by the admin overlay — the
                                        membership % below comes off this. */}
                                    <DiscountedPrice
                                        price={selectedProduct?.doctor_price}
                                        original={selectedProduct?.original_price}
                                        discountPct={selectedProduct?.discount_pct}
                                        color="text.primary"
                                        fontWeight={400}
                                        showPct={false}
                                    />
                                </Stack>
                                <Stack direction="row" justifyContent="space-between">
                                    <Typography variant="body2" color="success.main">
                                        {planName || 'Membership'} discount ({selectedMember.pct}%)
                                    </Typography>
                                    <Typography variant="body2" color="success.main">
                                        −₹{Math.round(
                                            (Number(selectedProduct?.doctor_price || 0)
                                                - Number(selectedPayable || 0)) * 100,
                                        ) / 100}
                                    </Typography>
                                </Stack>
                                <Divider sx={{ my: 0.5 }} />
                                <Stack direction="row" justifyContent="space-between">
                                    <Typography variant="subtitle1" fontWeight="bold">Total</Typography>
                                    <Typography variant="subtitle1" fontWeight="bold">
                                        {formatMoney(selectedPayable)}
                                    </Typography>
                                </Stack>
                            </Stack>
                        ) : (
                            /* No membership tier in play, so the total IS the
                               list price — and it still carries the admin
                               markdown the card slashed, which has to survive
                               into the dialog or the two disagree. */
                            <Stack direction="row" spacing={1} justifyContent="center"
                                   alignItems="baseline" sx={{ mt: 1.5 }}>
                                <Typography variant="subtitle1" fontWeight="bold">Total:</Typography>
                                <DiscountedPrice
                                    price={selectedProduct?.doctor_price}
                                    original={selectedProduct?.original_price}
                                    discountPct={selectedProduct?.discount_pct}
                                    variant="subtitle1"
                                    originalVariant="body2"
                                    color="text.primary"
                                    showPct={false}
                                />
                            </Stack>
                        )}

                        {/* Codes, always shown — see RedeemCodeFields on why
                            this is a field rather than a list that can vanish. */}
                        <Box mt={2} pt={2} borderTop="1px dashed" borderColor="divider"
                             textAlign="left">
                            <RedeemCodeFields
                                offering={{
                                    doctorId: selectedProduct?.doctor_id,
                                    productId: selectedProduct?.product_id,
                                }}
                                applied={appliedCodes}
                                onChange={setAppliedCodes}
                                disabled={booking}
                            />
                            {redeemedTotal > 0 && (
                                <Stack direction="row" justifyContent="space-between"
                                    alignItems="baseline" mt={1.5} pt={1.5}
                                    borderTop="1px solid" borderColor="divider">
                                    <Typography variant="body2" fontWeight="bold">You pay</Typography>
                                    <Stack direction="row" spacing={1} alignItems="baseline">
                                        <Typography variant="body2" color="text.disabled"
                                            sx={{ textDecoration: 'line-through' }}>
                                            {formatMoney(selectedPayable ?? selectedProduct?.doctor_price)}
                                        </Typography>
                                        <Typography variant="subtitle1" fontWeight="bold" color="primary">
                                            {formatMoney(finalPayable)}
                                        </Typography>
                                    </Stack>
                                </Stack>
                            )}
                        </Box>
                    </Box>

                    {selectedProduct && purchaseDialog && (
                        <>
                            {/* Benefits / how it works / essentials linked to this service. */}
                            <Box sx={{ mt: 2 }}>
                                <OfferingFeatures
                                    offering={selectedProduct.offering_type === 'group' ? 'group' : 'service'}
                                    productId={selectedProduct.product_id}
                                    doctorId={selectedProduct.doctor_id}
                                    variant="plain"
                                    title="Benefits & how it works"
                                />
                            </Box>
                            <Box sx={{ mt: 2 }}>
                                <BookingIntakeBar
                                    consultationType="service"
                                    freshKey={`service:${selectedProduct.id}`}
                                    showFilters={false}
                                    title="Share your details for this service"
                                    subtitle="Choose who this is for and share any health records the provider should see."
                                    onContextReady={setIntakeContextId}
                                />
                            </Box>
                            <Box sx={{ mt: 2 }}>
                                <CreditRedeem
                                    offering={creditScope}
                                    price={Math.max(0, basePayable - redeemedTotal)}
                                    onChange={setCreditsApplied}
                                />
                            </Box>
                        </>
                    )}

                    <TextField
                        label="Describe your need (optional)"
                        placeholder="Tell the provider what you need help with…"
                        multiline minRows={2} fullWidth sx={{ mt: 2 }}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <Button
                        component="label" variant="outlined" fullWidth
                        startIcon={<UploadFileIcon />} sx={{ mt: 1.5 }}
                    >
                        {file ? file.name : 'Attach a file (optional)'}
                        <input
                            type="file" hidden accept="application/pdf,image/*"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                        />
                    </Button>

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, textAlign: 'center' }}>
                        {isOps
                            ? (markAsPaid
                                ? 'This will be recorded as already paid offline; the provider then accepts or declines.'
                                : 'This will be booked unpaid — the patient pays it from their own app.')
                            : 'You’ll pay now; the provider then accepts or declines your request.'}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button fullWidth onClick={() => setPurchaseDialog(false)} disabled={booking}>Cancel</Button>
                    <Button
                        fullWidth variant="contained" color="success"
                        onClick={handleConfirmPurchase} disabled={booking}
                    >
                        {booking ? 'Processing…' : (isOps
                            ? (markAsPaid ? 'Book & record paid' : 'Book, leave unpaid')
                            : 'Book & Pay')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={4000} 
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default BrowseMarketplace;
