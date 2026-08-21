/**
 * MyBillsPage — Doctor billing table showing completed appointment payouts.
 * Table 1: Billing breakdown (charges, GST, TDS, final payment)
 * Table 2: Payouts from platform (status, view bill)
 */
import { useState } from 'react';
import SecondOpinionCredits from '../../../family-doctor/components/SecondOpinionCredits';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, CircularProgress, TextField, Grid,
    Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
    Divider, IconButton, Tabs, Tab, Snackbar, Alert, Switch, FormControlLabel,
    Tooltip,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ReceiptIcon from '@mui/icons-material/Receipt';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PaidIcon from '@mui/icons-material/Paid';
import { useGetDoctorBillingQuery, useGetDoctorPayoutsQuery, useGetPayoutBillQuery, useLazyGetPayoutBillPdfQuery, useClaimPayoutMutation, useClaimAllPayoutsMutation, useGetDoctorSalaryPayoutsQuery, useGetPayoutPreferenceQuery, useSetPayoutPreferenceMutation } from '../../api/doctorEndpoints';

const statusColors = {
    on_hold: 'default',
    claimable: 'warning',
    pending: 'info',
    processing: 'info',
    completed: 'success',
    failed: 'error',
    reversed: 'default',
};

const statusLabels = {
    on_hold: 'On Hold',
    claimable: 'Ready to Claim',
    pending: 'To Be Paid',
    processing: 'Processing',
    completed: 'Done',
    failed: 'Failed',
    reversed: 'Reversed',
};

/* ─── Bill Invoice Dialog ─── */
const BillDialog = ({ open, onClose, payoutId }) => {
    const { data: bill, isLoading } = useGetPayoutBillQuery(payoutId, { skip: !payoutId || !open });
    const [triggerPdf, { isFetching: pdfLoading }] = useLazyGetPayoutBillPdfQuery();

    const handleDownloadPdf = async () => {
        try {
            const result = await triggerPdf(payoutId).unwrap();
            if (result?.pdf_url) {
                window.open(result.pdf_url, '_blank');
            }
        } catch (err) {
            console.error('Failed to generate PDF:', err);
        }
    };

    if (!open) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle component="div" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" fontWeight={700}>Invoice / Bill</Typography>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
                ) : bill ? (
                    <Box sx={{ p: 1 }}>
                        {/* Company Header */}
                        {bill.company && (
                            <Box sx={{ textAlign: 'center', mb: 3 }}>
                                <Typography variant="h5" fontWeight={700} color="primary">
                                    {bill.company.name}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {bill.company.tagline}
                                </Typography>
                                <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', gap: 3, flexWrap: 'wrap' }}>
                                    <Typography variant="caption">PAN: {bill.company.pan}</Typography>
                                    <Typography variant="caption">GST: {bill.company.gst_reg}</Typography>
                                    <Typography variant="caption">CIN: {bill.company.cin}</Typography>
                                    <Typography variant="caption">SAC: {bill.company.sac}</Typography>
                                </Box>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Bill Number & Date */}
                        <Grid container spacing={2} sx={{ mb: 2 }}>
                            <Grid item xs={6}>
                                <Typography variant="body2" color="text.secondary">Bill Number</Typography>
                                <Typography variant="body1" fontWeight={600}>{bill.bill_number}</Typography>
                            </Grid>
                            <Grid item xs={6} sx={{ textAlign: 'right' }}>
                                <Typography variant="body2" color="text.secondary">Date</Typography>
                                <Typography variant="body1" fontWeight={600}>
                                    {bill.appointment_date ? new Date(bill.appointment_date).toLocaleDateString('en-IN') : '-'}
                                </Typography>
                            </Grid>
                        </Grid>

                        {/* Doctor & Patient */}
                        <Grid container spacing={2} sx={{ mb: 2 }}>
                            <Grid item xs={6}>
                                <Typography variant="body2" color="text.secondary">Doctor</Typography>
                                <Typography variant="body1">{bill.doctor_name || '-'}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="body2" color="text.secondary">Patient</Typography>
                                <Typography variant="body1">{bill.patient_name || '-'}</Typography>
                            </Grid>
                        </Grid>

                        <Divider sx={{ my: 2 }} />

                        {/* Amount Breakdown Table */}
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Description</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Amount</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    <TableRow>
                                        <TableCell>Consultation Fee</TableCell>
                                        <TableCell align="right">{'\u20B9'}{bill.appointment_amount}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Payment Received</TableCell>
                                        <TableCell align="right">{'\u20B9'}{bill.payment_amount}</TableCell>
                                    </TableRow>
                                    <Divider component="tr" />
                                    <TableRow>
                                        <TableCell sx={{ pl: 3 }}>{bill.charge1_name || 'Charge 1'}</TableCell>
                                        <TableCell align="right">- {'\u20B9'}{bill.charge1_amount}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell sx={{ pl: 3 }}>{bill.charge2_name || 'Charge 2'}</TableCell>
                                        <TableCell align="right">- {'\u20B9'}{bill.charge2_amount}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell sx={{ pl: 3 }}>{bill.charge3_name || 'Charge 3'}</TableCell>
                                        <TableCell align="right">- {'\u20B9'}{bill.charge3_amount}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Total Platform Charges</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>- {'\u20B9'}{bill.total_charges}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>GST (Taxes)</TableCell>
                                        <TableCell align="right">{'\u20B9'}{bill.taxes_gst}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>TDS Deducted</TableCell>
                                        <TableCell align="right">- {'\u20B9'}{bill.tds_amount}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Razorpay Fee</TableCell>
                                        <TableCell align="right">- {'\u20B9'}{bill.razorpay_fee}</TableCell>
                                    </TableRow>
                                    <TableRow sx={{ bgcolor: '#e8f5e9' }}>
                                        <TableCell sx={{ fontWeight: 700, fontSize: '1rem' }}>
                                            Final Payout to Doctor
                                        </TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 700, fontSize: '1rem', color: '#2e7d32' }}>
                                            {'\u20B9'}{bill.payout_amount}
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {/* Bank Info */}
                        {bill.bank_name && (
                            <Box sx={{ mt: 2, p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight={600}>Paid to Bank Account</Typography>
                                <Typography variant="body2">{bill.bank_name} — ****{bill.account_number_last4}</Typography>
                                <Typography variant="body2">{bill.account_holder}</Typography>
                            </Box>
                        )}

                        {/* Razorpay Ref */}
                        {bill.razorpay_transfer_id && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Razorpay Ref: {bill.razorpay_transfer_id}
                                </Typography>
                            </Box>
                        )}

                        {/* Footer */}
                        {bill.company?.footer_note && (
                            <Box sx={{ mt: 3, textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary">
                                    {bill.company.footer_note}
                                </Typography>
                            </Box>
                        )}
                        {bill.company?.support_email && (
                            <Box sx={{ textAlign: 'center', mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Support: {bill.company.support_email}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                ) : (
                    <Typography color="text.secondary">No bill data available.</Typography>
                )}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
                <Button
                    variant="contained"
                    color="error"
                    startIcon={pdfLoading ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdfIcon />}
                    onClick={handleDownloadPdf}
                    disabled={pdfLoading || !bill}
                >
                    {pdfLoading ? 'Generating...' : 'Download PDF'}
                </Button>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};


/* ─── Main Page ─── */
const MyBillsPage = () => {
    const [activeTab, setActiveTab] = useState(0);

    // ── Billing table state ──
    const [billingPage, setBillingPage] = useState(0);
    const [billingRowsPerPage, setBillingRowsPerPage] = useState(20);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [appliedFilters, setAppliedFilters] = useState({});

    // ── Payouts table state ──
    const [payoutPage, setPayoutPage] = useState(0);
    const [payoutRowsPerPage, setPayoutRowsPerPage] = useState(20);
    const [billDialogOpen, setBillDialogOpen] = useState(false);
    const [selectedPayoutId, setSelectedPayoutId] = useState(null);

    // ── Billing query ──
    const billingParams = {
        page: billingPage + 1,
        per_page: billingRowsPerPage,
        ...appliedFilters,
    };
    const { data: billingData, isLoading: billingLoading, isFetching: billingFetching, error: billingError } = useGetDoctorBillingQuery(billingParams);
    const bills = billingData?.bills || [];
    const billingPagination = billingData?.pagination || {};
    const config = billingData?.config || {};

    // ── Payouts query ──
    const payoutParams = {
        page: payoutPage + 1,
        per_page: payoutRowsPerPage,
    };
    const { data: payoutData, isLoading: payoutLoading, isFetching: payoutFetching, error: payoutError } = useGetDoctorPayoutsQuery(payoutParams);
    const payouts = payoutData?.payouts || [];
    const payoutPagination = payoutData?.pagination || {};
    const billConfig = payoutData?.bill_config || {};
    const billingType = payoutData?.billing_type || 'plan';

    const { data: salaryPayouts = [] } = useGetDoctorSalaryPayoutsQuery();
    const [claimPayout, { isLoading: claiming }] = useClaimPayoutMutation();
    const [claimAll, { isLoading: claimingAll }] = useClaimAllPayoutsMutation();
    const claimableCount = payouts.filter((p) => p.status === 'claimable').length;

    const { data: preference } = useGetPayoutPreferenceQuery();
    const [setPreference, { isLoading: savingPreference }] = useSetPayoutPreferenceMutation();
    const autoReceive = preference?.payout_mode === 'autopay';

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const showSnack = (message, severity = 'success') => setSnackbar({ open: true, message, severity });

    // Claiming sends real money, so a failure here must never be silent.
    const handleClaim = async (payoutId) => {
        try {
            const res = await claimPayout(payoutId).unwrap();
            showSnack(res?.message || 'Payout sent to your bank.');
        } catch (err) {
            showSnack(err?.data?.message || 'Could not send your payout. Please try again.', 'error');
        }
    };
    const handleClaimAll = async () => {
        try {
            const res = await claimAll().unwrap();
            showSnack(res?.message || 'Payouts sent to your bank.');
        } catch (err) {
            showSnack(err?.data?.message || 'Could not send your payouts. Please try again.', 'error');
        }
    };
    const handleToggleAutoReceive = async (checked) => {
        try {
            const res = await setPreference(checked ? 'autopay' : 'claim').unwrap();
            showSnack(res?.message || 'Preference saved.');
        } catch (err) {
            showSnack(err?.data?.message || 'Could not save your preference.', 'error');
        }
    };

    const handleApplyFilter = () => {
        const filters = {};
        if (dateFrom) filters.date_from = dateFrom;
        if (dateTo) filters.date_to = dateTo;
        setAppliedFilters(filters);
        setBillingPage(0);
    };

    const handleClearFilter = () => {
        setDateFrom('');
        setDateTo('');
        setAppliedFilters({});
        setBillingPage(0);
    };

    const handleViewBill = (payoutId) => {
        setSelectedPayoutId(payoutId);
        setBillDialogOpen(true);
    };

    const headerStyle = {
        fontWeight: 700,
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
        backgroundColor: '#f5f5f5',
        borderRight: '1px solid #e0e0e0',
        borderBottom: '2px solid #bdbdbd',
        textAlign: 'center',
        py: 1.5,
        px: 1,
    };

    const cellStyle = {
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
        borderRight: '1px solid #e0e0e0',
        textAlign: 'center',
        py: 1,
        px: 1,
    };

    const groupHeaderStyle = {
        ...headerStyle,
        backgroundColor: '#e3f2fd',
        borderBottom: '1px solid #bdbdbd',
        fontSize: '0.8rem',
    };

    return (
        <Box sx={{ py: 3, px: 2 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
                My Bills
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Billing details and payouts for your completed appointments.
            </Typography>

            {/* Tabs */}
            <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ mb: 3 }}>
                <Tab label="Billing Breakdown" />
                <Tab label="Payment Done" />
                <Tab label="Second Opinion" />
                {salaryPayouts.length > 0 && <Tab label="Salary" />}
            </Tabs>

            {/* ═══════════ TAB 0: Billing Breakdown Table ═══════════ */}
            {activeTab === 0 && (
                <>
                    {/* Date Filters */}
                    <Paper sx={{ p: 2, mb: 3 }} elevation={1}>
                        <Grid container spacing={2} alignItems="center">
                            <Grid item xs={12} sm={3}>
                                <TextField
                                    fullWidth label="From Date" type="date"
                                    value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                    size="small" InputLabelProps={{ shrink: true }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <TextField
                                    fullWidth label="To Date" type="date"
                                    value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                    size="small" InputLabelProps={{ shrink: true }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <Button variant="contained" startIcon={<FilterListIcon />} onClick={handleApplyFilter} size="small" sx={{ mr: 1 }}>
                                    Filter
                                </Button>
                                <Button variant="outlined" onClick={handleClearFilter} size="small">Clear</Button>
                            </Grid>
                        </Grid>
                    </Paper>

                    {billingError && (
                        <Paper sx={{ p: 2, mb: 2, bgcolor: '#fff3e0' }}>
                            <Typography color="error" variant="body2">
                                API Error: {billingError?.status} — {JSON.stringify(billingError?.data)}
                            </Typography>
                        </Paper>
                    )}

                    <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
                        {(billingLoading || billingFetching) && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                        )}
                        {!billingLoading && (
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell rowSpan={2} sx={groupHeaderStyle}>Sno</TableCell>
                                        <TableCell colSpan={4} sx={groupHeaderStyle} align="center">Appointment</TableCell>
                                        <TableCell colSpan={3} sx={groupHeaderStyle} align="center">Payment</TableCell>
                                        <TableCell colSpan={4} sx={groupHeaderStyle} align="center">Charges</TableCell>
                                        <TableCell rowSpan={2} sx={groupHeaderStyle}>Summation<br />of charges</TableCell>
                                        <TableCell rowSpan={2} sx={groupHeaderStyle}>Payment Amount -<br />Summation of Charges</TableCell>
                                        <TableCell rowSpan={2} sx={groupHeaderStyle}>TDS</TableCell>
                                        <TableCell rowSpan={2} sx={groupHeaderStyle}>Final payment<br />to doctor</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell sx={headerStyle}>date</TableCell>
                                        <TableCell sx={headerStyle}>Appointment ID</TableCell>
                                        <TableCell sx={headerStyle}>Patient Id</TableCell>
                                        <TableCell sx={headerStyle}>Appointment Amount</TableCell>
                                        <TableCell sx={headerStyle}>Payment date</TableCell>
                                        <TableCell sx={headerStyle}>Payment ID</TableCell>
                                        <TableCell sx={headerStyle}>Payment Amount</TableCell>
                                        <TableCell sx={headerStyle}>Taxes(GST=cgst+sgst)</TableCell>
                                        <TableCell sx={headerStyle}>{config.charge1_name || 'Charge 1'}</TableCell>
                                        <TableCell sx={headerStyle}>{config.charge2_name || 'Charge 2'}</TableCell>
                                        <TableCell sx={headerStyle}>{config.charge3_name || 'Charge 3'}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {bills.length === 0 && !billingFetching && (
                                        <TableRow>
                                            <TableCell colSpan={16} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                                No billing records found.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {bills.map((bill) => (
                                        <TableRow key={`${bill.appointment_id}-${bill.payment_id}`} hover>
                                            <TableCell sx={cellStyle}>{bill.sno}</TableCell>
                                            <TableCell sx={cellStyle}>{bill.appointment_date || '-'}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontSize: '0.7rem' }}>{bill.appointment_id}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontSize: '0.7rem' }}>{bill.patient_id}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.appointment_amount}</TableCell>
                                            <TableCell sx={cellStyle}>{bill.payment_date ? new Date(bill.payment_date).toLocaleDateString() : '-'}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontSize: '0.7rem' }}>{bill.payment_id}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.payment_amount}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.taxes_gst}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.charge1}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.charge2}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.charge3}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.summation_of_charges}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.payment_minus_charges}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{bill.tds}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontWeight: 700, color: '#2e7d32' }}>
                                                {'\u20B9'}{bill.final_payment}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                        <TablePagination
                            component="div"
                            count={billingPagination.total || 0}
                            page={billingPage}
                            onPageChange={(e, newPage) => setBillingPage(newPage)}
                            rowsPerPage={billingRowsPerPage}
                            onRowsPerPageChange={(e) => { setBillingRowsPerPage(parseInt(e.target.value, 10)); setBillingPage(0); }}
                            rowsPerPageOptions={[10, 20, 50]}
                        />
                    </TableContainer>
                </>
            )}

            {/* ═══════════ TAB 1: Payment Done (Payouts) Table ═══════════ */}
            {activeTab === 1 && (
                <>
                    {payoutError && (
                        <Paper sx={{ p: 2, mb: 2, bgcolor: '#fff3e0' }}>
                            <Typography color="error" variant="body2">
                                API Error: {payoutError?.status} — {JSON.stringify(payoutError?.data)}
                            </Typography>
                        </Paper>
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                        <Box>
                            <Tooltip title="Applies to future payouts. Anything already waiting stays waiting for you to collect it.">
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={autoReceive} disabled={savingPreference}
                                            onChange={(e) => handleToggleAutoReceive(e.target.checked)}
                                        />
                                    }
                                    label="Send my payouts automatically"
                                />
                            </Tooltip>
                            <Typography variant="caption" color="text.secondary" display="block">
                                {autoReceive
                                    ? 'Payouts go to your verified bank account as soon as they are released.'
                                    : 'You collect each payout yourself using the Claim button.'}
                            </Typography>
                        </Box>
                    </Box>

                    {claimableCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, p: 1.5, bgcolor: '#fff8e1', borderRadius: 1 }}>
                            <Typography variant="body2">
                                <strong>{claimableCount}</strong> payout{claimableCount > 1 ? 's are' : ' is'} ready to claim.
                                Claiming sends the money to your verified bank account.
                            </Typography>
                            <Button variant="contained" color="warning" startIcon={<PaidIcon />}
                                disabled={claimingAll} onClick={handleClaimAll}>
                                Claim All
                            </Button>
                        </Box>
                    )}

                    <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
                        {(payoutLoading || payoutFetching) && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                        )}
                        {!payoutLoading && (
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={headerStyle}>Sno</TableCell>
                                        <TableCell sx={headerStyle}>Bill No.</TableCell>
                                        <TableCell sx={headerStyle}>Appointment ID</TableCell>
                                        <TableCell sx={headerStyle}>Date</TableCell>
                                        <TableCell sx={headerStyle}>Total Amount</TableCell>
                                        <TableCell sx={headerStyle}>Charges Deducted</TableCell>
                                        <TableCell sx={headerStyle}>Razorpay Fee</TableCell>
                                        <TableCell sx={headerStyle}>TDS</TableCell>
                                        <TableCell sx={headerStyle}>Final to Doctor</TableCell>
                                        <TableCell sx={headerStyle}>Status</TableCell>
                                        <TableCell sx={{ ...headerStyle, borderRight: 'none' }}>Bill</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {payouts.length === 0 && !payoutFetching && (
                                        <TableRow>
                                            <TableCell colSpan={11} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                                No payouts found. Payouts appear here after the platform processes payments to your bank account.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {payouts.map((p, idx) => (
                                        <TableRow key={p.id} hover>
                                            <TableCell sx={cellStyle}>{payoutPage * payoutRowsPerPage + idx + 1}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontWeight: 600 }}>{p.bill_number}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontSize: '0.7rem' }}>{p.appointment_id}</TableCell>
                                            <TableCell sx={cellStyle}>
                                                {p.appointment_date ? new Date(p.appointment_date).toLocaleDateString('en-IN') : '-'}
                                            </TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{p.payment_amount}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{p.total_charges}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{p.razorpay_fee}</TableCell>
                                            <TableCell sx={cellStyle}>{'\u20B9'}{p.tds_amount}</TableCell>
                                            <TableCell sx={{ ...cellStyle, fontWeight: 700, color: '#2e7d32' }}>
                                                {'\u20B9'}{p.payout_amount}
                                            </TableCell>
                                            <TableCell sx={cellStyle}>
                                                <Chip
                                                    label={statusLabels[p.status] || p.status}
                                                    color={statusColors[p.status] || 'default'}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                                {p.status === 'on_hold' && p.hold_until && (
                                                    <Typography variant="caption" color="text.secondary" display="block">
                                                        Available {new Date(p.hold_until).toLocaleDateString('en-IN')}
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell sx={{ ...cellStyle, borderRight: 'none' }}>
                                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                    {p.status === 'claimable' && (
                                                        <Button
                                                            size="small"
                                                            variant="contained"
                                                            color="warning"
                                                            startIcon={<PaidIcon />}
                                                            disabled={claiming}
                                                            onClick={() => handleClaim(p.id)}
                                                        >
                                                            Claim
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        startIcon={<ReceiptIcon />}
                                                        onClick={() => handleViewBill(p.id)}
                                                    >
                                                        View Bill
                                                    </Button>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                        <TablePagination
                            component="div"
                            count={payoutPagination.total || 0}
                            page={payoutPage}
                            onPageChange={(e, newPage) => setPayoutPage(newPage)}
                            rowsPerPage={payoutRowsPerPage}
                            onRowsPerPageChange={(e) => { setPayoutRowsPerPage(parseInt(e.target.value, 10)); setPayoutPage(0); }}
                            rowsPerPageOptions={[10, 20, 50]}
                        />
                    </TableContainer>
                </>
            )}

            {/* ═══════════ TAB 2: Second Opinion Credits ═══════════ */}
            {activeTab === 2 && <SecondOpinionCredits />}

            {/* ═══════════ TAB 3: Salary (employee / consultant) ═══════════ */}
            {activeTab === 3 && (
                <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={headerStyle}>Period</TableCell>
                                <TableCell sx={headerStyle}>Type</TableCell>
                                <TableCell sx={headerStyle}>Gross</TableCell>
                                <TableCell sx={headerStyle}>Deductions</TableCell>
                                <TableCell sx={headerStyle}>Net</TableCell>
                                <TableCell sx={{ ...headerStyle, borderRight: 'none' }}>Status</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {salaryPayouts.map((s) => (
                                <TableRow key={s.id} hover>
                                    <TableCell sx={cellStyle}>
                                        {s.period_start} → {s.period_end}
                                    </TableCell>
                                    <TableCell sx={cellStyle}>{s.kind}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{s.gross_salary}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{s.deductions}</TableCell>
                                    <TableCell sx={{ ...cellStyle, fontWeight: 700, color: '#2e7d32' }}>{'₹'}{s.net_amount}</TableCell>
                                    <TableCell sx={{ ...cellStyle, borderRight: 'none' }}>
                                        <Chip label={statusLabels[s.status] || s.status} color={statusColors[s.status] || 'default'}
                                            size="small" variant="outlined" />
                                        {s.compliance_withheld && (
                                            <Chip label="Withheld" size="small" color="error" sx={{ ml: 0.5 }} />
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Billing type — shown bottom-right so the doctor knows how they're paid */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                <Chip
                    label={`Billing: ${{ plan: 'Plan-based', employee: 'Employee', consultant: 'Consultant' }[billingType] || billingType}`}
                    color={billingType === 'plan' ? 'default' : 'primary'}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                />
            </Box>

            {/* Bill Dialog */}
            <BillDialog
                open={billDialogOpen}
                onClose={() => { setBillDialogOpen(false); setSelectedPayoutId(null); }}
                payoutId={selectedPayoutId}
            />

            <Snackbar
                open={snackbar.open} autoHideDuration={6000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MyBillsPage;
