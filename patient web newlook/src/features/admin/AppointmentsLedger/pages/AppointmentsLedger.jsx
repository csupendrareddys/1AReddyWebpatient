/**
 * AppointmentsLedger — read-only ("fetch only") admin ledger of every booking
 * (consultation appointments + marketplace service/group orders) with its
 * payment, payout and margin breakdown.
 *
 * The column layout follows the operations spec: grouped, multi-level headers
 * from Booking → Execution → Patient → Product → Prescription → Customer paid →
 * Price → Payout → Margin. The backend computes every derived figure
 * (N1..N3, B1..B4, PP1, F1..F3, G1..G5); this component only renders.
 */
import { useMemo, useState } from 'react';
import {
    Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, CircularProgress, Chip,
    Autocomplete, TextField, Alert,
} from '@mui/material';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useGetAppointmentsLedgerQuery } from '../../api/appointmentsLedgerEndpoints';

// Product-type filter options (single or multiple). ``value`` matches the
// backend ``?type=`` filter tokens.
const TYPE_OPTIONS = [
    { value: 'service_plan', label: 'Service plan' },
    { value: 'group_plan', label: 'Group plan' },
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'chat', label: 'Chat' },
    { value: 'voice', label: 'Voice' },
    { value: 'home_visit', label: 'Patient home visit' },
];

// Column model: groups → leaves. ``money`` leaves get a ₹ prefix.
const GROUPS = [
    {
        label: 'Booking', color: '#eef2ff', leaves: [
            { key: 'sno', label: 'S.No' },
            { key: 'booking_date', label: 'Date of Booking' },
            { key: 'booking_id', label: 'Booking ID' },
            { key: 'booking_kind', label: 'First / rescheduled / follow-up' },
            { key: 'status', label: 'Status' },
            { key: 'accepted_date', label: 'Date accepted by Doctor/Other' },
            { key: 'accepted_by', label: 'Accepted by (Doc/Admin/Support/Auto)' },
        ],
    },
    {
        label: 'Date of execution', color: '#fdf2f8', leaves: [
            { key: 'exec_started', label: 'Date started' },
            { key: 'exec_progress', label: 'Progress' },
            { key: 'exec_completed', label: 'Date of completion' },
        ],
    },
    {
        label: 'Patient', color: '#eef2ff', leaves: [
            { key: 'patient_id', label: 'Patient ID' },
            { key: 'patient_name', label: 'Patient Name' },
        ],
    },
    {
        label: 'Product', color: '#fdf2f8', leaves: [
            { key: 'product_type', label: 'Product type' },
            { key: 'provider_id', label: 'Team ID / Doctor ID' },
            { key: 'provider_name', label: 'Team / Doctor Name' },
        ],
    },
    {
        label: 'Prescription / document', color: '#eef2ff', leaves: [
            { key: 'presc_status', label: 'Status' },
            { key: 'presc_generated', label: 'Generated' },
            { key: 'presc_pending_admin', label: 'Pending with admin' },
            { key: 'presc_published', label: 'Published to patient' },
        ],
    },
    {
        label: 'Customer paid details', color: '#fdf2f8', leaves: [
            { key: 'payment_tried', label: 'Payment tried / not' },
            { key: 'payment_status', label: 'Payment status' },
            { key: 'payment_id', label: 'Payment id' },
            { key: 'payment_date', label: 'Payment date' },
        ],
    },
    {
        label: 'Price details', color: '#eef2ff', leaves: [
            { key: 'display_price', label: 'Display price', money: true },
            { key: 'price_after_dis', label: 'Price after overall discount', money: true },
            { key: 'plan_name', label: 'Patient Plan name' },
            { key: 'plan_discount', label: 'Plan discount applied', money: true },
            { key: 'plan_coupon', label: 'Plan coupon' },
            { key: 'coupon', label: 'Coupon' },
            { key: 'plan_voucher', label: 'Plan voucher' },
            { key: 'voucher', label: 'Voucher' },
        ],
    },
    {
        label: 'Payout details', color: '#fef9c3', leaves: [
            { key: 'n1_gross', label: 'N1 · Gross paid by patient', money: true },
            { key: 'n2_taxes', label: 'N2 · Less taxes', money: true },
            { key: 'n3_net', label: 'N3 · Net paid by patient', money: true },
            { key: 'b1_doctor_fee', label: 'B1 · Doctor fee', money: true },
            { key: 'b2_service_fee', label: 'B2 · Service fee', money: true },
            { key: 'b3_platform_fee', label: 'B3 · Platform fee', money: true },
            { key: 'b4_other_fee', label: 'B4 · Other fee', money: true },
            { key: 'payout_basis', label: 'Applies for payout (B1 / N1)' },
            { key: 'pp1', label: 'PP1 · Push to payment', money: true },
            { key: 'tds', label: 'TDS', money: true },
            { key: 'net_to_bank', label: 'Net sent to bank', money: true },
            { key: 'eligibility_date', label: 'Date of eligibility' },
            { key: 'claim_date', label: 'Date doctor claimed' },
            { key: 'payment_done_date', label: 'Date of payment done' },
            { key: 'amount_paid', label: 'Amount paid', money: true },
            { key: 'gateway_payout', label: 'Payout from gateway', money: true },
            { key: 'gateway_eligibility_date', label: 'Gateway eligibility date' },
        ],
    },
    {
        label: 'Margin', color: '#fef9c3', leaves: [
            { key: 'fee_f1', label: 'F1 · Fee (B2+B3+B4)', money: true },
            { key: 'fee_tax_f2', label: 'F2 · Tax in fee', money: true },
            { key: 'fee_net_f3', label: 'F3 · Net fee', money: true },
            { key: 'gap_g1', label: 'G1 · Gap margin (PP1−N3)', money: true },
            { key: 'gap_tax', label: 'Tax on gap margin', money: true },
            { key: 'gap_net_g3', label: 'G3 · Net gap margin', money: true },
            { key: 'margin_net_g4', label: 'G4 · Total net margin', money: true },
            { key: 'margin_taxes_t', label: 'Total margin taxes', money: true },
            { key: 'margin_gross_g5', label: 'G5 · Total gross margin', money: true },
        ],
    },
];

const LEAVES = GROUPS.flatMap((g) => g.leaves);
const TOTAL_COLS = LEAVES.length;

const headerCell = {
    fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap',
    borderRight: '1px solid #e0e0e0', textAlign: 'center', p: 0.75,
    position: 'sticky', top: 0,
};
const bodyCell = {
    fontSize: '0.75rem', whiteSpace: 'nowrap', borderRight: '1px solid #eee',
    textAlign: 'center', p: 0.75,
};

const fmt = (leaf, val) => {
    if (val === null || val === undefined || val === '') return '—';
    if (leaf.money) {
        const n = Number(val);
        return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : String(val);
    }
    return String(val);
};

export default function AppointmentsLedger() {
    const [types, setTypes] = useState([]);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50);

    const args = useMemo(() => ({
        types: types.map((t) => t.value),
        page: page + 1,
        per_page: rowsPerPage,
    }), [types, page, rowsPerPage]);

    const { data, isLoading, isFetching, error } = useGetAppointmentsLedgerQuery(args);
    const rows = data?.rows || [];
    const pagination = data?.pagination || {};

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <EventNoteIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>Appointments</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Read-only ledger of every booking with its payment, payout and margin
                breakdown. Filter by product type; all figures are computed server-side.
            </Typography>

            <Paper sx={{ p: 2, mb: 2 }} elevation={1}>
                <Autocomplete
                    multiple
                    size="small"
                    options={TYPE_OPTIONS}
                    getOptionLabel={(o) => o.label}
                    isOptionEqualToValue={(a, b) => a.value === b.value}
                    value={types}
                    onChange={(_, v) => { setTypes(v); setPage(0); }}
                    renderTags={(vals, getTagProps) => vals.map((opt, i) => (
                        <Chip size="small" label={opt.label} {...getTagProps({ index: i })} key={opt.value} />
                    ))}
                    renderInput={(params) => (
                        <TextField {...params} label="Type of Product"
                            placeholder="All (select one or more)" sx={{ maxWidth: 640 }} />
                    )}
                />
            </Paper>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    Failed to load the ledger. {error?.data?.message || ''}
                </Alert>
            )}

            <TableContainer component={Paper} elevation={2} sx={{ maxHeight: '72vh', border: '1px solid #bdbdbd' }}>
                {(isLoading || isFetching) && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress /></Box>
                )}
                {!isLoading && (
                    <Table size="small" stickyHeader sx={{ minWidth: TOTAL_COLS * 120 }}>
                        <TableHead>
                            {/* Group header row */}
                            <TableRow>
                                {GROUPS.map((g) => (
                                    <TableCell key={g.label} colSpan={g.leaves.length}
                                        sx={{ ...headerCell, bgcolor: g.color, fontSize: '0.8rem', top: 0 }}>
                                        {g.label}
                                    </TableCell>
                                ))}
                            </TableRow>
                            {/* Leaf header row */}
                            <TableRow>
                                {GROUPS.map((g) => g.leaves.map((leaf) => (
                                    <TableCell key={leaf.key}
                                        sx={{ ...headerCell, bgcolor: '#fafafa', top: 34 }}>
                                        {leaf.label}
                                    </TableCell>
                                )))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.length === 0 && !isFetching && (
                                <TableRow>
                                    <TableCell colSpan={TOTAL_COLS} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        No bookings found for the selected filters.
                                    </TableCell>
                                </TableRow>
                            )}
                            {rows.map((row, ri) => (
                                <TableRow key={row.booking_id || ri} hover>
                                    {LEAVES.map((leaf) => (
                                        <TableCell key={leaf.key}
                                            sx={{ ...bodyCell, ...(leaf.money ? { fontWeight: 600 } : {}) }}>
                                            {fmt(leaf, row[leaf.key])}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
                <TablePagination
                    component="div"
                    count={pagination.total || 0}
                    page={page}
                    onPageChange={(_, p) => setPage(p)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                    rowsPerPageOptions={[25, 50, 100]}
                />
            </TableContainer>
        </Box>
    );
}
