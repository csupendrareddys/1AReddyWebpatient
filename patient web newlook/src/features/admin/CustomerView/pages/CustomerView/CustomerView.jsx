/**
 * CustomerView — admin surface for customers (renamed from "View
 * Patients"). Two sub-sections:
 *
 *   * Patient   — individual customers (the former patient list).
 *   * Corporate — patients that carry a non-individual EntityProfile.
 *
 * Each sub-section carries a View 1 / View 2 toggle. Both views show the
 * customer's basic info (name / contact / status) plus an Analytics
 * column; clicking it opens a per-customer detail:
 *
 *   * View 1 → appointments + prescriptions side by side, full lifecycle
 *              (pending → completed) across consultation / service /
 *              group offering.
 *   * View 2 → booking-lifecycle table (booking date, type, acceptance,
 *              start, completion, total days, status) with payment
 *              details below.
 *
 * Data: GET /api/admin/patients, /api/admin/corporate-customers, and
 * /api/admin/appointments-ledger/customer/<patient_id>.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, IconButton, InputAdornment,
    MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell,
    TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import InsightsIcon from '@mui/icons-material/Insights';
import CloseIcon from '@mui/icons-material/Close';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

import {
    useGetPatientsQuery,
    useGetCorporateCustomersQuery,
    useGetCustomerHistoryQuery,
    useUpdatePatientStatusMutation,
} from '../../../api/patientsEndpoints';
import usePermissions from '../../../../../common/hooks/usePermissions';


const USER_STATUS_COLOR = {
    active: 'success',
    blocked: 'error',
    inactive: 'warning',
};

// Booking lifecycle status → chip colour (union across the three sources).
const BOOKING_STATUS_COLOR = {
    completed: 'success',
    active: 'info',
    in_progress: 'info',
    under_process: 'info',
    confirmed: 'primary',
    pending: 'warning',
    pending_payment: 'warning',
    upcoming: 'warning',
    cancelled: 'default',
    rejected: 'error',
    expired: 'default',
    no_show: 'error',
};

const prettify = (s) =>
    (s || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');


function StatusChip({ status, colorMap }) {
    return (
        <Chip
            size="small"
            label={prettify(status) || '—'}
            color={colorMap[status] || 'default'}
        />
    );
}


/** Booking UUID shown short with the full id on hover. */
function BookingId({ id }) {
    if (!id) return '—';
    return (
        <Tooltip title={id}>
            <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}
            >
                {String(id).slice(0, 8)}…
            </Typography>
        </Tooltip>
    );
}


const USER_STATUSES = ['active', 'blocked', 'inactive'];

/** Status-change dialog (active / blocked / inactive) — mirrors the old
 *  View Patients edit-status action. Works for patient + corporate rows
 *  (both are patients). */
function StatusEditDialog({ customer, onClose, onSaved }) {
    const [newStatus, setNewStatus] = useState(customer.status || 'active');
    const [updateStatus, { isLoading }] = useUpdatePatientStatusMutation();
    const [err, setErr] = useState(null);

    const save = async () => {
        setErr(null);
        try {
            await updateStatus({ patientId: customer.id, status: newStatus }).unwrap();
            onSaved(`Status updated to ${newStatus}`);
        } catch (e) {
            setErr(e?.data?.error || e?.data?.message || 'Failed to update status');
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Change customer status</DialogTitle>
            <DialogContent dividers>
                {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
                <TextField
                    select
                    fullWidth
                    label="Status"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                >
                    {USER_STATUSES.map((s) => (
                        <MenuItem key={s} value={s}>{prettify(s)}</MenuItem>
                    ))}
                </TextField>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={isLoading}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
}


/* ── View 1: appointments + prescriptions side by side ─────────────── */
function BookingsPrescriptionsView({ rows }) {
    if (!rows.length) {
        return <Alert severity="info">No bookings for this customer yet.</Alert>;
    }
    return (
        <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
                <TableHead>
                    <TableRow>
                        <TableCell colSpan={6} sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>
                            Appointment
                        </TableCell>
                        <TableCell colSpan={4} sx={{ fontWeight: 700, bgcolor: 'action.selected' }}>
                            Prescription
                        </TableCell>
                    </TableRow>
                    <TableRow>
                        <TableCell>Booking ID</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Provider</TableCell>
                        <TableCell>Booked</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Price</TableCell>
                        <TableCell>Rx Status</TableCell>
                        <TableCell>Generated</TableCell>
                        <TableCell>Pending Admin</TableCell>
                        <TableCell>Published</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.booking_id} hover>
                            <TableCell><BookingId id={r.booking_id} /></TableCell>
                            <TableCell>{prettify(r.product_type)}</TableCell>
                            <TableCell>{r.provider_name || '—'}</TableCell>
                            <TableCell>{fmtDate(r.booking_date)}</TableCell>
                            <TableCell>
                                <StatusChip status={r.status} colorMap={BOOKING_STATUS_COLOR} />
                            </TableCell>
                            <TableCell>₹{r.display_price ?? '—'}</TableCell>
                            <TableCell>
                                {r.presc_status
                                    ? <Chip size="small" variant="outlined" label={prettify(r.presc_status)} />
                                    : '—'}
                            </TableCell>
                            <TableCell>{fmtDate(r.presc_generated)}</TableCell>
                            <TableCell>{fmtDate(r.presc_pending_admin)}</TableCell>
                            <TableCell>{fmtDate(r.presc_published)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}


/* ── View 2: lifecycle table + payments ────────────────────────────── */
function LifecyclePaymentsView({ rows }) {
    if (!rows.length) {
        return <Alert severity="info">No bookings for this customer yet.</Alert>;
    }
    return (
        <Stack spacing={3}>
            <Box>
                <Typography variant="subtitle2" gutterBottom>Booking lifecycle</Typography>
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>Booking ID</TableCell>
                                <TableCell>Booked</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Provider / Plan</TableCell>
                                <TableCell>Accepted</TableCell>
                                <TableCell>Started</TableCell>
                                <TableCell>Completed</TableCell>
                                <TableCell align="center">Total Days</TableCell>
                                <TableCell>Status</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((r) => (
                                <TableRow key={r.booking_id} hover>
                                    <TableCell><BookingId id={r.booking_id} /></TableCell>
                                    <TableCell>{fmtDate(r.booking_date)}</TableCell>
                                    <TableCell>{prettify(r.product_type)}</TableCell>
                                    <TableCell>{r.provider_name || r.plan_name || '—'}</TableCell>
                                    <TableCell>{fmtDate(r.accepted_date)}</TableCell>
                                    <TableCell>{fmtDate(r.exec_started)}</TableCell>
                                    <TableCell>{fmtDate(r.exec_completed)}</TableCell>
                                    <TableCell align="center">
                                        {r.total_days == null ? '—' : r.total_days}
                                    </TableCell>
                                    <TableCell>
                                        <StatusChip status={r.status} colorMap={BOOKING_STATUS_COLOR} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>

            <Box>
                <Typography variant="subtitle2" gutterBottom>Payment details</Typography>
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Booking ID</TableCell>
                                <TableCell>Booking</TableCell>
                                <TableCell>Amount</TableCell>
                                <TableCell>Payment Status</TableCell>
                                <TableCell>Payment ID</TableCell>
                                <TableCell>Paid On</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((r) => (
                                <TableRow key={r.booking_id} hover>
                                    <TableCell><BookingId id={r.booking_id} /></TableCell>
                                    <TableCell>{prettify(r.product_type)}</TableCell>
                                    <TableCell>₹{r.display_price ?? '—'}</TableCell>
                                    <TableCell>
                                        {r.payment_status
                                            ? <Chip
                                                size="small"
                                                color={r.payment_status === 'success' ? 'success'
                                                    : r.payment_status === 'failed' ? 'error' : 'warning'}
                                                label={prettify(r.payment_status)}
                                              />
                                            : <Chip size="small" variant="outlined" label="No payment" />}
                                    </TableCell>
                                    <TableCell>{r.payment_id || '—'}</TableCell>
                                    <TableCell>{fmtDate(r.payment_date)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        </Stack>
    );
}


/* ── Per-customer detail dialog ────────────────────────────────────── */
function CustomerDetailDialog({ customer, view, onClose }) {
    const { data, isLoading, isError, error } = useGetCustomerHistoryQuery(customer.id);
    const rows = data?.rows || [];
    const summary = data?.summary || { total_bookings: 0, total_paid: 0 };
    const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || '—';

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                    {name}
                    {customer.entity_name && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            {customer.entity_name} ({prettify(customer.entity_type)})
                        </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                        {view === 'view1'
                            ? 'Appointments & prescriptions'
                            : 'Booking lifecycle & payments'}
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                )}
                {isError && (
                    <Alert severity="error">
                        Could not load history:{' '}
                        {error?.data?.message || error?.message || 'unknown error'}
                    </Alert>
                )}
                {!isLoading && !isError && (
                    <>
                        <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                            <Paper variant="outlined" sx={{ px: 2, py: 1, borderRadius: 2 }}>
                                <Typography variant="caption" color="text.secondary">Bookings</Typography>
                                <Typography variant="h6">{summary.total_bookings}</Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ px: 2, py: 1, borderRadius: 2 }}>
                                <Typography variant="caption" color="text.secondary">Total paid</Typography>
                                <Typography variant="h6">₹{summary.total_paid ?? 0}</Typography>
                            </Paper>
                            <Divider orientation="vertical" flexItem />
                            {Object.entries(summary.by_status || {}).map(([s, n]) => (
                                <Chip
                                    key={s}
                                    size="small"
                                    color={BOOKING_STATUS_COLOR[s] || 'default'}
                                    label={`${n} ${prettify(s)}`}
                                />
                            ))}
                        </Stack>
                        <Divider sx={{ mb: 2 }} />
                        {view === 'view1'
                            ? <BookingsPrescriptionsView rows={rows} />
                            : <LifecyclePaymentsView rows={rows} />}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}


/* ── Customer list (basic info + analytics column) ─────────────────── */
function CustomerTable({ section, onOpen }) {
    const isCorporate = section === 'corporate';
    const { hasFullAccess, can } = usePermissions();
    const canEdit = hasFullAccess || can('patient_list', 'edit');
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [page, setPage] = useState(0);
    const [perPage, setPerPage] = useState(10);
    const [statusEdit, setStatusEdit] = useState(null);
    const [snack, setSnack] = useState({ open: false, msg: '' });

    useMemo(() => {
        const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
        return () => clearTimeout(t);
    }, [search]);

    const params = { page: page + 1, per_page: perPage, ...(debounced ? { search: debounced } : {}) };
    const patientsQ = useGetPatientsQuery(params, { skip: isCorporate });
    const corporateQ = useGetCorporateCustomersQuery(params, { skip: !isCorporate });
    const q = isCorporate ? corporateQ : patientsQ;

    const rows = isCorporate ? (q.data?.customers || []) : (q.data?.patients || []);
    const total = q.data?.pagination?.total || 0;

    return (
        <Box>
            <TextField
                size="small"
                placeholder={isCorporate ? 'Search by name, phone or entity' : 'Search by name or phone'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    ),
                }}
                sx={{ minWidth: 320, mb: 2 }}
            />

            {q.isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                </Box>
            )}
            {q.isError && (
                <Alert severity="error">
                    Could not load customers:{' '}
                    {q.error?.data?.message || q.error?.message || 'unknown error'}
                </Alert>
            )}
            {q.isSuccess && rows.length === 0 && (
                <Alert severity="info">
                    No {isCorporate ? 'corporate customers' : 'patients'} found.
                </Alert>
            )}

            {rows.length > 0 && (
                <>
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    {isCorporate && <TableCell>Entity</TableCell>}
                                    <TableCell>Email</TableCell>
                                    <TableCell>Phone</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Created</TableCell>
                                    <TableCell align="right">Analytics</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.map((c) => (
                                    <TableRow key={c.id} hover>
                                        <TableCell>
                                            {`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}
                                        </TableCell>
                                        {isCorporate && (
                                            <TableCell>
                                                <Typography variant="body2">{c.entity_name || '—'}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {prettify(c.entity_type)}
                                                </Typography>
                                            </TableCell>
                                        )}
                                        <TableCell>{c.email || '—'}</TableCell>
                                        <TableCell>{c.phone_number || '—'}</TableCell>
                                        <TableCell>
                                            <StatusChip status={c.status} colorMap={USER_STATUS_COLOR} />
                                        </TableCell>
                                        <TableCell>{fmtDate(c.created_at)}</TableCell>
                                        <TableCell align="right">
                                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                <Tooltip title="View booking analytics">
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        startIcon={<InsightsIcon />}
                                                        onClick={() => onOpen(c)}
                                                    >
                                                        Analytics
                                                    </Button>
                                                </Tooltip>
                                                {canEdit && (
                                                    <Tooltip title="Change status">
                                                        <IconButton size="small" onClick={() => setStatusEdit(c)}>
                                                            <ManageAccountsIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <TablePagination
                        component="div"
                        count={total}
                        page={page}
                        onPageChange={(_e, p) => setPage(p)}
                        rowsPerPage={perPage}
                        onRowsPerPageChange={(e) => { setPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                        rowsPerPageOptions={[5, 10, 25]}
                    />
                </>
            )}

            {statusEdit && (
                <StatusEditDialog
                    customer={statusEdit}
                    onClose={() => setStatusEdit(null)}
                    onSaved={(msg) => {
                        setStatusEdit(null);
                        setSnack({ open: true, msg });
                        q.refetch();
                    }}
                />
            )}
            <Snackbar
                open={snack.open}
                autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                message={snack.msg}
            />
        </Box>
    );
}


export default function CustomerView() {
    const [section, setSection] = useState('patient');   // 'patient' | 'corporate'
    const [view, setView] = useState('view1');           // 'view1' | 'view2'
    const [selected, setSelected] = useState(null);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" gutterBottom>Customer View</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Individual and corporate customers, with per-customer booking and
                payment analytics.
            </Typography>

            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ sm: 'center' }}
                sx={{ mb: 2, gap: 1 }}
            >
                <Tabs
                    value={section}
                    onChange={(_e, v) => setSection(v)}
                >
                    <Tab label="Patient" value="patient" />
                    <Tab label="Corporate" value="corporate" />
                </Tabs>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    size="small"
                    onChange={(_e, v) => v && setView(v)}
                >
                    <ToggleButton value="view1">View 1 · Appointments & Rx</ToggleButton>
                    <ToggleButton value="view2">View 2 · Lifecycle & Payments</ToggleButton>
                </ToggleButtonGroup>
            </Stack>

            <CustomerTable section={section} onOpen={setSelected} />

            {selected && (
                <CustomerDetailDialog
                    customer={selected}
                    view={view}
                    onClose={() => setSelected(null)}
                />
            )}
        </Box>
    );
}
