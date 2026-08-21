/**
 * ViewDoctors Page — Pure UI composition
 * All logic lives in useViewDoctors hook
 */
import {
    Box,
    Typography,
    Paper,
    IconButton,
    Avatar,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    TablePagination,
    Popover,
    TextField,
    InputAdornment,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    CircularProgress,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Snackbar,
    Tooltip,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Divider,
    Link,
    Checkbox,
    FormGroup,
    FormControlLabel,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import VerifiedIcon from '@mui/icons-material/Verified';
import DescriptionIcon from '@mui/icons-material/Description';
import BadgeIcon from '@mui/icons-material/Badge';
import ImageIcon from '@mui/icons-material/Image';
import SchoolIcon from '@mui/icons-material/School';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import PublishIcon from '@mui/icons-material/Publish';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BlockIcon from '@mui/icons-material/Block';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import FilterListIcon from '@mui/icons-material/FilterList';
import { resolveMediaUrl } from '../../../../../common/utils/mediaUrl';
import DoctorApprovalMatrixDialog from '../../components/DoctorApprovalMatrixDialog';
import { ToggleButtonGroup, ToggleButton } from '@mui/material';
import InviteUserDialog from '../../../components/InviteUserDialog/InviteUserDialog';
import { useAdminInviteDoctorMutation } from '../../../../service-provider/Affiliation/api/affiliationEndpoints';

import { lazy, Suspense, useState, useEffect } from 'react';
import useViewDoctors from '../../hooks/useViewDoctors';
import {
    useGetPublishStatusByTypeQuery,
    useUpdatePublishStatusByTypeMutation,
    useApproveFieldChangeMutation,
    useRejectFieldChangeMutation,
    useQueryFieldChangeMutation,
} from '../../../api/fieldApprovalEndpoints';
import {
    useGetDoctorBankAccountsQuery,
    useVerifyDoctorBankAccountMutation,
    useGetDoctorPayoutsQuery,
    useGetDoctorCreditLedgerQuery,
    useGetDoctorApprovalHistoryQuery,
    useVerifyDoctorCertificateMutation,
} from '../../../api/doctorsEndpoints';
import { useGetDoctorAnalyticsMetricsQuery } from '../../../api/doctorAnalyticsEndpoints';
import { CONSULTATION_TYPES } from '../../../../service-provider/ProfileSetting/constants/consultationTypes';
import './ViewDoctors.css';

import ErrorBoundary from '../../../../../common/components/ErrorBoundary/ErrorBoundary';

const AnalyticsSection = lazy(() => import('../../../../service-provider/ProfileSetting/sections/AnalyticsSection'));

// Backend API base URL for document access
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const getDocumentUrl = (path) => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
};

const getVerificationColor = (status) => {
    switch (status) {
        case 'verified': return 'success';
        case 'pending': return 'warning';
        case 'rejected': return 'error';
        default: return 'default';
    }
};

const getStatusColor = (status) => {
    switch (status) {
        case 'active': return 'success';
        case 'blocked': return 'error';
        case 'inactive': return 'warning';
        default: return 'default';
    }
};

const getPublishStatusColor = (status) => {
    switch (status) {
        case 'active': return 'success';
        case 'inactive': return 'default';
        case 'on_hold': return 'warning';
        case 'suspended': return 'error';
        default: return 'default';
    }
};

const getPublishStatusLabel = (status) => {
    switch (status) {
        case 'active': return 'Active';
        case 'inactive': return 'Inactive';
        case 'on_hold': return 'On Hold';
        case 'suspended': return 'Suspended';
        default: return status || 'Inactive';
    }
};

// Compact per-type publish chips (used in the Activation section cell).
const renderPublishChips = (doctor) => {
    const map = doctor.publish_status_by_type;
    if (!map || Object.keys(map).length === 0) {
        return <Chip label="Not Set" color="default" size="small" />;
    }
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {CONSULTATION_TYPES.filter((ct) => map[ct.value]).map((ct) => {
                const st = map[ct.value];
                return (
                    <Chip
                        key={ct.value}
                        label={`${ct.shortLabel}: ${getPublishStatusLabel(st)}`}
                        color={getPublishStatusColor(st)}
                        size="small"
                        variant={st === 'active' ? 'filled' : 'outlined'}
                        sx={{ fontSize: '0.65rem', height: 22 }}
                    />
                );
            })}
        </Box>
    );
};

const DASH = <Typography component="span" sx={{ color: 'text.disabled' }}>—</Typography>;

const ViewDoctors = ({ initialSearch, facilityFilter } = {}) => {
    const {
        hasViewPermission,
        hasEditStatusPermission,
        hasVerifyPermission,
        doctors,
        total,
        documents,
        loading,
        error,
        updating,
        loadingDocuments,
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        search,
        setSearch,
        verificationFilter,
        setVerificationFilter,
        handleSearch,
        statusDialogOpen,
        setStatusDialogOpen,
        selectedDoctor,
        newStatus,
        setNewStatus,
        handleStatusEditClick,
        handleStatusUpdate,
        verifyDialogOpen,
        setVerifyDialogOpen,
        newVerificationStatus,
        setNewVerificationStatus,
        handleVerifyClick,
        handleVerificationUpdate,
        documentsDialogOpen,
        setDocumentsDialogOpen,
        handleViewDocuments,
        snackbar,
        closeSnackbar,
    } = useViewDoctors({ facilityFilter });

    // Analytics dialog state
    const [analyticsDoctor, setAnalyticsDoctor] = useState(null);
    const [analyticsDialogOpen, setAnalyticsDialogOpen] = useState(false);

    // When embedded in "View Vendor" and drilled in from a facility's
    // affiliated-doctor roster, seed the search box with that doctor's
    // name so the list lands pre-filtered. Re-seeds whenever the caller
    // passes a new value (e.g. clicking a different doctor).
    useEffect(() => {
        if (initialSearch != null) setSearch(initialSearch);
    }, [initialSearch, setSearch]);

    const handleAnalyticsClick = (doctor) => {
        setAnalyticsDoctor(doctor);
        setAnalyticsDialogOpen(true);
    };

    // Publish status dialog state
    const [publishDialogOpen, setPublishDialogOpen] = useState(false);
    const [publishDoctor, setPublishDoctor] = useState(null);
    const [typeStatusMap, setTypeStatusMap] = useState({});
    const [updatePublishStatusByType, { isLoading: updatingPublish }] = useUpdatePublishStatusByTypeMutation();

    // Approve / reject a doctor's registration or COP certificate.
    const [verifyCertificate, { isLoading: verifyingCert }] = useVerifyDoctorCertificateMutation();
    const handleVerifyCert = async (field, status) => {
        try {
            await verifyCertificate({ doctorId: documents?.doctor_id, field, status }).unwrap();
        } catch (_) { /* surfaced via cache; noop */ }
    };

    const publishDoctorId = publishDoctor?.doctor_id || publishDoctor?.id;
    const { data: publishStatusByTypeData } = useGetPublishStatusByTypeQuery(
        { entityType: 'doctor', entityId: publishDoctorId },
        { skip: !publishDialogOpen || !publishDoctorId }
    );

    // Initialize per-type map when dialog opens or data arrives
    useEffect(() => {
        if (!publishDialogOpen || !publishDoctor) return;
        const fetched = publishStatusByTypeData?.publish_status_by_type || {};
        const fallback = publishDoctor.publish_status || 'inactive';
        const initial = {};
        CONSULTATION_TYPES.forEach((ct) => {
            initial[ct.value] = fetched[ct.value] || fallback;
        });
        setTypeStatusMap(initial);
    }, [publishDialogOpen, publishDoctor, publishStatusByTypeData]);

    const handlePublishClick = (doctor) => {
        setPublishDoctor(doctor);
        setPublishDialogOpen(true);
    };

    const handleSetAll = (status) => {
        const updated = {};
        CONSULTATION_TYPES.forEach((ct) => { updated[ct.value] = status; });
        setTypeStatusMap(updated);
    };

    const handlePublishStatusUpdate = async () => {
        if (!publishDoctor) return;
        try {
            await updatePublishStatusByType({
                entityType: 'doctor',
                entityId: publishDoctorId,
                statusByType: typeStatusMap,
            }).unwrap();
            setPublishDialogOpen(false);
        } catch (err) {
            console.error('Failed to update publish status', err);
        }
    };

    // Bank accounts dialog state
    const [bankDialogOpen, setBankDialogOpen] = useState(false);
    const [bankDoctor, setBankDoctor] = useState(null);
    const [bankSnackMsg, setBankSnackMsg] = useState('');
    const [bankSnackSeverity, setBankSnackSeverity] = useState('success');
    // Account pending hard-removal — holds the account row until the admin
    // confirms the warning dialog (deleting it puts payouts on hold).
    const [removeTarget, setRemoveTarget] = useState(null);

    // Invite-doctor dialog state (Round 9 — admin tooling).
    const [inviteDoctorOpen, setInviteDoctorOpen] = useState(false);
    const [inviteSnack, setInviteSnack] = useState({ open: false, msg: '', severity: 'success' });

    const bankDoctorId = bankDoctor?.doctor_id || bankDoctor?.id;
    const { data: bankData, isLoading: bankLoading, refetch: refetchBank } = useGetDoctorBankAccountsQuery(
        bankDoctorId,
        { skip: !bankDialogOpen || !bankDoctorId }
    );
    const [verifyBankAccount, { isLoading: verifyingBank }] = useVerifyDoctorBankAccountMutation();

    const handleBankClick = (doctor) => {
        setBankDoctor(doctor);
        setBankDialogOpen(true);
    };

    const [bankActionLoading, setBankActionLoading] = useState(null); // track which button is loading

    const handleBankAction = async (bankAccountId, action) => {
        setBankActionLoading(`${bankAccountId}-${action}`);
        try {
            const res = await verifyBankAccount({
                doctorId: bankDoctorId,
                bankAccountId,
                action,
                reason: action === 'reject' ? 'Rejected by admin after review' : undefined,
            }).unwrap();
            setBankSnackMsg(res.message || `Bank account ${action} successful`);
            setBankSnackSeverity('success');
            refetchBank();
        } catch (err) {
            const errMsg = err?.data?.message || err?.data?.error || err?.message || `Failed: ${action}`;
            setBankSnackMsg(errMsg);
            setBankSnackSeverity('error');
        } finally {
            setBankActionLoading(null);
        }
    };

    // ── Sectioned view ────────────────────────────────────────────────────
    // Pick "All columns" or focus one section. Column groups mirror the agreed
    // Doctor-view spec; sections not yet backed by live data open a preview
    // drill-down (Payments / Efficiency / Approvals).
    const [sectionView, setSectionView] = useState('all');
    const [statusFilter, setStatusFilter] = useState('');
    // Per-column sort + filter (client-side, over the loaded page). `sortCol`
    // is a column id (`${section.key}::${colIndex}` or 'identity'); `colFilters`
    // maps that id → a substring the column value must contain.
    const [sortCol, setSortCol] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [colFilters, setColFilters] = useState({});
    const [filterAnchor, setFilterAnchor] = useState(null); // { id, el }
    const toggleSort = (id) => {
        if (sortCol !== id) { setSortCol(id); setSortDir('asc'); }
        else if (sortDir === 'asc') setSortDir('desc');
        else { setSortCol(null); setSortDir('asc'); }
    };
    // Any change to a client-side filter / sort snaps back to the first page so
    // the current page never lands out of range of the filtered set.
    useEffect(() => { setPage(0); }, [statusFilter, colFilters, sortCol, sortDir, setPage]);
    const [briefView, setBriefView] = useState(false); // View 2 — one "View" button per section
    const [stubDialog, setStubDialog] = useState(null); // 'payments'|'efficiency'|'approvals'
    const [stubDoctor, setStubDoctor] = useState(null);
    const [matrixDoctor, setMatrixDoctor] = useState(null); // per-doctor approval-override dialog
    const openStub = (kind, doctor) => { setStubDoctor(doctor); setStubDialog(kind); };

    // Live data for the Payments / Efficiency drill-downs (fetched on open).
    const stubDoctorId = stubDoctor?.doctor_id || stubDoctor?.id;
    const { data: payouts = [], isFetching: payoutsLoading } = useGetDoctorPayoutsQuery(
        stubDoctorId, { skip: stubDialog !== 'payments' || !stubDoctorId },
    );
    const { data: effMetrics, isFetching: effLoading } = useGetDoctorAnalyticsMetricsQuery(
        { doctorId: stubDoctorId, period: 'month' },
        { skip: stubDialog !== 'efficiency' || !stubDoctorId },
    );
    const { data: creditLedger, isFetching: ledgerLoading } = useGetDoctorCreditLedgerQuery(
        stubDoctorId, { skip: stubDialog !== 'ledger' || !stubDoctorId },
    );
    // Full approval history (all statuses, all time) for the Approvals drill-down.
    // Also loaded for the photo viewer so it can surface a pending photo change.
    const { data: apprHistory, isFetching: apprLoading } = useGetDoctorApprovalHistoryQuery(
        stubDoctorId,
        { skip: (stubDialog !== 'approvals' && stubDialog !== 'photo') || !stubDoctorId },
    );
    const [approveField] = useApproveFieldChangeMutation();
    const [rejectField] = useRejectFieldChangeMutation();
    const [queryField] = useQueryFieldChangeMutation();
    const [approvalBusy, setApprovalBusy] = useState(null);

    const handleApproval = async (requestId, action) => {
        setApprovalBusy(`${requestId}-${action}`);
        try {
            const fn = action === 'approve' ? approveField : action === 'reject' ? rejectField : queryField;
            await fn({
                requestId,
                comment: action === 'reject' ? 'Rejected by admin after review'
                    : action === 'query' ? 'More information required' : undefined,
            }).unwrap();
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('approval action failed', e);
        } finally {
            setApprovalBusy(null);
        }
    };

    const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
    const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : '—');
    const SECTION_LABELS = {
        personal_details: 'Personal & Professional',
        signatures: 'Signature & Pricing',
        about_me: 'About Me',
        education: 'Education Details',
        bank: 'Bank Details',
        slot_visibility: 'Slot Visibility',
        consultation_pricing: 'Consultation Pricing',
        working_hours: 'Working Hours',
    };
    const apprColor = (s) => (s === 'approved' ? 'success' : s === 'rejected' ? 'error' : s === 'query' ? 'info' : 'warning');

    // Status is filtered client-side on the current page (verification is
    // filtered server-side via the hook).
    const shownDoctors = statusFilter
        ? doctors.filter((d) => (d.status || 'active') === statusFilter)
        : doctors;

    const textBtn = (label, onClick) => (
        <Button size="small" variant="outlined" onClick={onClick} sx={{ textTransform: 'none' }}>
            {label}
        </Button>
    );

    const creditChip = (d) => (Number(d.health_credits) > 0
        ? <Chip size="small" color="success" label={`₹${Number(d.health_credits).toLocaleString('en-IN')}`} />
        : DASH);
    const pendingChip = (d) => (Number(d.pending_approvals) > 0
        ? <Chip size="small" color="warning" clickable onClick={() => openStub('approvals', d)}
            label={`${d.pending_approvals} pending`} sx={{ fontWeight: 600 }} />
        : <Chip size="small" color="success" variant="outlined" label="Clear" />);

    // Identity cell shown at the very start of every row — name, phone, and
    // at-a-glance chips for health credits + any pending approval requests.
    const identityCell = (doctor) => (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Avatar
                src={resolveMediaUrl(doctor.profile_image)}
                alt={doctor.first_name || ''}
                sx={{ width: 40, height: 40, cursor: doctor.profile_image ? 'pointer' : 'default', fontSize: 15 }}
                onClick={() => doctor.profile_image && openStub('photo', doctor)}
            >
                {(doctor.first_name || '?')[0]}
            </Avatar>
            <Box>
                <Typography variant="body2" fontWeight={600}>{doctor.first_name} {doctor.last_name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    📞 {doctor.phone_number || '—'}{doctor.email ? ` · ${doctor.email}` : ''}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                    {Number(doctor.health_credits) > 0 && (
                        <Chip size="small" color="success" variant="outlined" sx={{ height: 20 }}
                            label={`₹${Number(doctor.health_credits).toLocaleString('en-IN')} credits`} />
                    )}
                    {Number(doctor.pending_approvals) > 0 && (
                        <Chip size="small" color="warning" clickable sx={{ height: 20 }}
                            onClick={() => openStub('approvals', doctor)}
                            label={`${doctor.pending_approvals} approval${doctor.pending_approvals > 1 ? 's' : ''} pending`} />
                    )}
                </Box>
            </Box>
        </Box>
    );

    // Each data column carries a `val(d)` accessor returning a sortable /
    // filterable primitive (string or number). Columns that are pure action
    // buttons omit `val` and therefore get no sort / filter control.
    const SECTIONS = [
        { key: 'activation', label: 'Activation', cols: [
            { label: 'Health credits', val: (d) => Number(d.health_credits) || 0, render: (d) => creditChip(d) },
            { label: 'Approvals', val: (d) => Number(d.pending_approvals) || 0, render: (d) => pendingChip(d) },
            { label: 'Status', val: (d) => d.status || 'active', render: (d) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Chip label={d.status || 'active'} color={getStatusColor(d.status)} size="small" />
                    {hasEditStatusPermission && (
                        <IconButton size="small" onClick={() => handleStatusEditClick(d)}><EditIcon fontSize="inherit" /></IconButton>
                    )}
                </Box>) },
            { label: 'Verification', val: (d) => d.verification_status || 'pending', render: (d) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Chip label={d.verification_status || 'pending'} color={getVerificationColor(d.verification_status)} size="small" />
                    {hasVerifyPermission && (
                        <IconButton size="small" color="success" onClick={() => handleVerifyClick(d)}><VerifiedIcon fontSize="inherit" /></IconButton>
                    )}
                </Box>) },
            { label: 'Publish', val: (d) => d.publish_status || '', render: (d) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {renderPublishChips(d)}
                    <IconButton size="small" color="warning" onClick={() => handlePublishClick(d)}><PublishIcon fontSize="inherit" /></IconButton>
                </Box>) },
            { label: 'Holding', val: (d) => (d.on_holding ? 'In holding' : ''), render: (d) => (d.on_holding ? <Chip label="In holding" color="warning" size="small" /> : DASH) },
        ] },
        { key: 'engagement', label: 'Employee / Consultant / Plan', cols: [
            { label: 'Type', val: (d) => d.billing_type || 'plan', render: (d) => (
                <Chip size="small" color="info" label={d.billing_type || 'plan'} sx={{ textTransform: 'capitalize' }} />) },
            { label: 'Plan', val: (d) => d.plan_name || '', render: (d) => d.plan_name || DASH },
            { label: 'Salary / Fee', val: (d) => Number(d.billing_type === 'employee' ? d.salary
                : d.billing_type === 'consultant' ? d.retainer : 0) || 0, render: (d) => {
                const v = d.billing_type === 'employee' ? d.salary
                    : d.billing_type === 'consultant' ? d.retainer : null;
                return v != null ? `₹${Number(v).toLocaleString('en-IN')}` : DASH;
            } },
            { label: 'Committed hrs', render: () => DASH },
        ] },
        { key: 'basic', label: 'Basic Details', cols: [
            { label: 'Name (Aadhaar)', val: (d) => d.name_as_per_aadhaar || '', render: (d) => d.name_as_per_aadhaar || DASH },
            { label: 'Name (PAN)', val: (d) => d.name_as_per_pan || '', render: (d) => d.name_as_per_pan || DASH },
            { label: 'Category', val: (d) => d.category || '', render: (d) => d.category || DASH },
            { label: 'Religion', val: (d) => d.religion || '', render: (d) => d.religion || DASH },
            { label: 'State', val: (d) => d.state || '', render: (d) => d.state || DASH },
            { label: 'Language', val: (d) => (d.languages_known?.length ? d.languages_known.join(', ') : ''), render: (d) => (d.languages_known?.length ? d.languages_known.join(', ') : DASH) },
            { label: '2nd phone', val: (d) => d.alternative_phone || '', render: (d) => d.alternative_phone || DASH },
            { label: '2nd email', val: (d) => d.alternative_email || '', render: (d) => d.alternative_email || DASH },
            { label: 'Aadhaar', val: (d) => d.aadhar_number || '', render: (d) => d.aadhar_number || DASH },
            { label: 'PAN', val: (d) => d.pan_number || '', render: (d) => d.pan_number || DASH },
            { label: 'Documents', render: (d) => textBtn('View', () => handleViewDocuments(d)) },
        ] },
        { key: 'practice', label: 'Practice', cols: [
            { label: 'Registration #', val: (d) => d.registration_number || '', render: (d) => d.registration_number || DASH },
            { label: 'Council / Board', val: (d) => d.registration_council || d.registration?.board || '', render: (d) => d.registration_council || d.registration?.board || DASH },
            { label: 'Reg. year', val: (d) => d.registration_year || '', render: (d) => d.registration_year || DASH },
            { label: 'COP #', val: (d) => d.cop?.number || '', render: (d) => d.cop?.number || DASH },
            { label: 'Registration & COP', render: (d) => textBtn('View details', () => openStub('practice', d)) },
        ] },
        { key: 'approvals', label: 'Admin Approvals', cols: [
            { label: 'Permissions', render: (d) => textBtn('Approval matrix', () => setMatrixDoctor(d)) },
        ] },
        { key: 'payments', label: 'Payments', cols: [
            { label: 'Payments', render: (d) => textBtn('Payouts', () => openStub('payments', d)) },
            { label: 'Bank a/c', render: (d) => textBtn('Bank', () => handleBankClick(d)) },
        ] },
        { key: 'efficiency', label: 'Efficiency', cols: [
            { label: 'Efficiency', render: (d) => textBtn('Efficiency', () => openStub('efficiency', d)) },
        ] },
        { key: 'analytics', label: 'Analytics', cols: [
            { label: 'Analytics', render: (d) => textBtn('Dashboard', () => handleAnalyticsClick(d)) },
        ] },
        { key: 'documents', label: 'Documents', cols: [
            { label: 'Documents', render: (d) => textBtn('All documents', () => handleViewDocuments(d)) },
        ] },
        { key: 'credit_usage', label: 'Credit Usage', cols: [
            { label: 'Credits used', val: (d) => Number(d.credits_used) || 0, render: (d) => (Number(d.credits_used) > 0
                ? `₹${Number(d.credits_used).toLocaleString('en-IN')}` : DASH) },
            { label: 'Balance', val: (d) => Number(d.health_credits) || 0, render: (d) => (Number(d.health_credits) > 0
                ? `₹${Number(d.health_credits).toLocaleString('en-IN')}` : DASH) },
            { label: 'Ledger', render: (d) => textBtn('Usage', () => openStub('ledger', d)) },
        ] },
    ];
    const activeSections = sectionView === 'all' ? SECTIONS : SECTIONS.filter((s) => s.key === sectionView);
    const showGroup = sectionView === 'all';

    // Flat registry mapping a column id → its value accessor, so sort/filter
    // can look an accessor up by id. The leading identity column sorts/filters
    // by the doctor's name + contact details.
    const COLUMN_VALS = {
        identity: (d) => `${d.first_name || ''} ${d.last_name || ''} ${d.phone_number || ''} ${d.email || ''}`.trim(),
    };
    SECTIONS.forEach((s) => s.cols.forEach((c, ci) => { if (c.val) COLUMN_VALS[`${s.key}::${ci}`] = c.val; }));

    // A column's value shown / matched in the filter list (empty → em dash).
    const cellKey = (v) => (v === '' || v == null ? '—' : String(v));
    // Distinct values (with counts) for a column, computed across the WHOLE
    // loaded dataset so the filter list shows every available option.
    const distinctFor = (id) => {
        const acc = COLUMN_VALS[id];
        if (!acc) return [];
        const m = new Map();
        doctors.forEach((d) => { const k = cellKey(acc(d)); m.set(k, (m.get(k) || 0) + 1); });
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    };

    // `colFilters[id]` is an array of selected display-values. A row passes a
    // column filter when its value is one of the selected options. Sorting and
    // filtering run over the ENTIRE dataset (the hook loads every doctor).
    let processedDoctors = shownDoctors;
    const activeColFilters = Object.entries(colFilters).filter(([, v]) => Array.isArray(v) && v.length > 0);
    if (activeColFilters.length) {
        processedDoctors = processedDoctors.filter((d) => activeColFilters.every(([id, sel]) => {
            const acc = COLUMN_VALS[id];
            return acc ? sel.includes(cellKey(acc(d))) : true;
        }));
    }
    if (sortCol && COLUMN_VALS[sortCol]) {
        const acc = COLUMN_VALS[sortCol];
        processedDoctors = [...processedDoctors].sort((a, b) => {
            const va = acc(a); const vb = acc(b);
            if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
            const sa = String(va ?? '').toLowerCase(); const sb = String(vb ?? '').toLowerCase();
            return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        });
    }
    const hasColSortFilter = !!sortCol || activeColFilters.length > 0;
    const clearColSortFilter = () => { setSortCol(null); setSortDir('asc'); setColFilters({}); };

    // Client-side pagination over the filtered + sorted set.
    const pageStart = page * rowsPerPage;
    const pagedDoctors = processedDoctors.slice(pageStart, pageStart + rowsPerPage);

    // Reusable header content: label + sort toggle + filter icon (only for
    // columns that declare a `val` accessor).
    const ColHead = ({ id, col, groupLabel }) => (
        <>
            {groupLabel && (
                <Typography variant="caption" color="primary" sx={{ display: 'block', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {groupLabel}
                </Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                {col.val ? (
                    <TableSortLabel
                        active={sortCol === id}
                        direction={sortCol === id ? sortDir : 'asc'}
                        onClick={() => toggleSort(id)}
                    >
                        {col.label}
                    </TableSortLabel>
                ) : col.label}
                {col.val && (
                    <IconButton
                        size="small"
                        color={colFilters[id] ? 'primary' : 'default'}
                        onClick={(e) => setFilterAnchor({ id, el: e.currentTarget })}
                        sx={{ p: 0.25 }}
                    >
                        <FilterListIcon fontSize="inherit" />
                    </IconButton>
                )}
            </Box>
        </>
    );

    // View 2 (brief): one "View" button per section. Section detail opens either
    // an existing drill-down or a generic modal that renders the section's cells.
    const BRIEF_SECTIONS = [
        { key: 'activation', label: 'Activation', open: (d) => openStub('activation', d) },
        { key: 'engagement', label: 'Employee / Consultant / Plan', open: (d) => openStub('engagement', d) },
        { key: 'basic', label: 'Basic Details', open: (d) => openStub('basic', d) },
        { key: 'practice', label: 'Practice', open: (d) => openStub('practice', d) },
        { key: 'payments', label: 'Payments', open: (d) => openStub('payments', d) },
        { key: 'efficiency', label: 'Efficiency', open: (d) => openStub('efficiency', d) },
        { key: 'analytics', label: 'Analytics', open: (d) => handleAnalyticsClick(d) },
        { key: 'documents', label: 'Documents', open: (d) => handleViewDocuments(d) },
        { key: 'credit_usage', label: 'Credit Usage', open: (d) => openStub('ledger', d) },
    ];
    const pendingTasks = (d) => {
        const t = [];
        if ((d.verification_status || 'pending') === 'pending') t.push('Activation — verification pending');
        if (d.on_holding) t.push('Plans — membership lapsed (holding)');
        return t;
    };
    // Generic section shown in the drill-down modal (Activation / Engagement / Basic).
    const genericSection = SECTIONS.find((s) => s.key === stubDialog);

    if (!hasViewPermission) {
        return (
            <Alert severity="error">
                Access Denied. You don't have permission to view doctors.
            </Alert>
        );
    }

    return (
        <Box>
            {/* Page Title + Add Doctor */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    View Doctors
                </Typography>
                {/* Verify-doctors permission is the closest fit for who
                    should be able to invite — the same operator already
                    decides whether the doctor's documents pass. */}
                {hasVerifyPermission && (
                    <Button
                        variant="contained"
                        startIcon={<PersonAddIcon />}
                        onClick={() => setInviteDoctorOpen(true)}
                    >
                        Add Doctor
                    </Button>
                )}
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <InviteUserDialog
                open={inviteDoctorOpen}
                onClose={() => setInviteDoctorOpen(false)}
                onResult={(severity, msg) => setInviteSnack({ open: true, msg, severity })}
                mode="doctor"
                mutationHook={useAdminInviteDoctorMutation}
            />
            <Snackbar
                open={inviteSnack.open}
                autoHideDuration={6000}
                onClose={() => setInviteSnack((s) => ({ ...s, open: false }))}
            >
                <Alert
                    severity={inviteSnack.severity}
                    onClose={() => setInviteSnack((s) => ({ ...s, open: false }))}
                >
                    {inviteSnack.msg}
                </Alert>
            </Snackbar>

            {/* Search & Filters */}
            <Paper className="admin-page-card" sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <TextField
                    placeholder="Search by name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyPress={handleSearch}
                    sx={{ flex: 1, minWidth: 220 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start"><SearchIcon /></InputAdornment>
                        ),
                    }}
                />
                <FormControl sx={{ minWidth: 170 }}>
                    <InputLabel>Verification</InputLabel>
                    <Select
                        value={verificationFilter}
                        onChange={(e) => { setVerificationFilter(e.target.value); setPage(0); }}
                        label="Verification"
                    >
                        <MenuItem value="">All</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                        <MenuItem value="verified">Verified</MenuItem>
                        <MenuItem value="rejected">Rejected</MenuItem>
                    </Select>
                </FormControl>
                <FormControl sx={{ minWidth: 150 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        label="Status"
                    >
                        <MenuItem value="">All</MenuItem>
                        <MenuItem value="active">Active</MenuItem>
                        <MenuItem value="blocked">Blocked</MenuItem>
                        <MenuItem value="inactive">Inactive</MenuItem>
                    </Select>
                </FormControl>
            </Paper>

            {/* View mode: Detailed (sectioned columns) vs Brief (one View button / section) */}
            <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <ToggleButtonGroup
                    value={briefView ? 'brief' : 'detailed'}
                    exclusive
                    size="small"
                    onChange={(_, v) => { if (v) setBriefView(v === 'brief'); }}
                >
                    <ToggleButton value="detailed" sx={{ textTransform: 'none' }}>Detailed</ToggleButton>
                    <ToggleButton value="brief" sx={{ textTransform: 'none' }}>Brief (View 2)</ToggleButton>
                </ToggleButtonGroup>
                {!briefView && (
                    <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
                        <ToggleButtonGroup
                            value={sectionView}
                            exclusive
                            size="small"
                            onChange={(_, v) => { if (v) setSectionView(v); }}
                            sx={{ flexWrap: 'wrap' }}
                        >
                            <ToggleButton value="all" sx={{ textTransform: 'none' }}>All columns</ToggleButton>
                            {SECTIONS.map((s) => (
                                <ToggleButton key={s.key} value={s.key} sx={{ textTransform: 'none' }}>{s.label}</ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>
                )}
                {hasColSortFilter && (
                    <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        onDelete={clearColSortFilter}
                        icon={<FilterListIcon />}
                        label={`Sort / filter active${activeColFilters.length ? ` · ${activeColFilters.length} filter${activeColFilters.length > 1 ? 's' : ''}` : ''}`}
                    />
                )}
            </Box>

            {/* Table */}
            <TableContainer component={Paper} className="admin-page-card">
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                ) : (
                    <>
                        {briefView ? (
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Tasks</TableCell>
                                    <TableCell sx={{ minWidth: 200 }}>
                                        {ColHead({ id: 'identity', col: { label: 'Doctor', val: COLUMN_VALS.identity } })}
                                    </TableCell>
                                    {BRIEF_SECTIONS.map((s) => (
                                        <TableCell key={s.key} sx={{ whiteSpace: 'nowrap' }}>{s.label}</TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pagedDoctors.map((doctor) => {
                                    const tasks = pendingTasks(doctor);
                                    return (
                                        <TableRow key={doctor.id} hover>
                                            <TableCell>
                                                {tasks.length ? (
                                                    <Tooltip title={tasks.join(' · ')}>
                                                        <Chip label={`${tasks.length} Pending`} color="warning" size="small" />
                                                    </Tooltip>
                                                ) : <Chip label="Clear" color="success" size="small" />}
                                            </TableCell>
                                            <TableCell>
                                                {identityCell(doctor)}
                                            </TableCell>
                                            {BRIEF_SECTIONS.map((s) => (
                                                <TableCell key={s.key}>
                                                    <Button size="small" variant="outlined" sx={{ textTransform: 'none' }} onClick={() => s.open(doctor)}>View</Button>
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    );
                                })}
                                {processedDoctors.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={12} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">No doctors found</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        ) : (
                        <Table stickyHeader sx={{ minWidth: 700 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', minWidth: 190 }}>
                                        {ColHead({ id: 'identity', col: { label: 'Doctor', val: COLUMN_VALS.identity } })}
                                    </TableCell>
                                    {activeSections.map((s, si) => s.cols.map((c, ci) => (
                                        <TableCell
                                            key={`${s.key}-h-${ci}`}
                                            sx={{
                                                whiteSpace: 'nowrap',
                                                borderLeft: ci === 0 && (si > 0 || !showGroup) ? '1px solid' : 'none',
                                                borderColor: 'divider',
                                            }}
                                        >
                                            {ColHead({ id: `${s.key}::${ci}`, col: c, groupLabel: showGroup && ci === 0 ? s.label : null })}
                                        </TableCell>
                                    )))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pagedDoctors.map((doctor) => (
                                    <TableRow key={doctor.id} hover>
                                        <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}>
                                            {identityCell(doctor)}
                                        </TableCell>
                                        {activeSections.map((s, si) => s.cols.map((c, ci) => (
                                            <TableCell
                                                key={`${s.key}-c-${ci}`}
                                                sx={{
                                                    whiteSpace: 'nowrap',
                                                    borderLeft: ci === 0 && (si > 0 || !showGroup) ? '1px solid' : 'none',
                                                    borderColor: 'divider',
                                                }}
                                            >
                                                {c.render(doctor)}
                                            </TableCell>
                                        )))}
                                    </TableRow>
                                ))}
                                {processedDoctors.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={20} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">No doctors found</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        )}
                        <TablePagination
                            component="div"
                            count={processedDoctors.length}
                            page={page}
                            onPageChange={(e, newPage) => setPage(newPage)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                            rowsPerPageOptions={[5, 10, 25, 50]}
                        />
                    </>
                )}
            </TableContainer>

            {/* Per-column sort + filter popover — shared by every column header.
                Sort offers explicit Asc / Desc; the filter is a checklist of the
                actual values present in that column across the whole dataset. */}
            <Popover
                open={!!filterAnchor}
                anchorEl={filterAnchor?.el}
                onClose={() => setFilterAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                {filterAnchor && (() => {
                    const id = filterAnchor.id;
                    const opts = distinctFor(id);
                    const sel = colFilters[id] || [];
                    const toggleVal = (v) => setColFilters((p) => {
                        const cur = p[id] || [];
                        const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
                        return { ...p, [id]: next };
                    });
                    return (
                        <Box sx={{ p: 1.5, width: 260 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>SORT</Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, mb: 1 }}>
                                <Button size="small" fullWidth
                                    variant={sortCol === id && sortDir === 'asc' ? 'contained' : 'outlined'}
                                    onClick={() => { setSortCol(id); setSortDir('asc'); }}>Asc ↑</Button>
                                <Button size="small" fullWidth
                                    variant={sortCol === id && sortDir === 'desc' ? 'contained' : 'outlined'}
                                    onClick={() => { setSortCol(id); setSortDir('desc'); }}>Desc ↓</Button>
                            </Box>
                            <Divider />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                                    FILTER ({opts.length})
                                </Typography>
                                <Box>
                                    <Button size="small" onClick={() => setColFilters((p) => ({ ...p, [id]: opts.map(([v]) => v) }))}>All</Button>
                                    <Button size="small" onClick={() => setColFilters((p) => ({ ...p, [id]: [] }))}>Clear</Button>
                                </Box>
                            </Box>
                            <Box sx={{ maxHeight: 240, overflowY: 'auto', mt: 0.5 }}>
                                <FormGroup>
                                    {opts.map(([v, count]) => (
                                        <FormControlLabel
                                            key={v}
                                            sx={{ ml: 0, mr: 0 }}
                                            control={<Checkbox size="small" sx={{ py: 0.25 }} checked={sel.includes(v)} onChange={() => toggleVal(v)} />}
                                            label={(
                                                <Typography variant="body2" component="span">
                                                    {v} <Typography component="span" variant="caption" color="text.secondary">({count})</Typography>
                                                </Typography>
                                            )}
                                        />
                                    ))}
                                    {opts.length === 0 && (
                                        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No values.</Typography>
                                    )}
                                </FormGroup>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                                <Button size="small" variant="contained" onClick={() => setFilterAnchor(null)}>Done</Button>
                            </Box>
                        </Box>
                    );
                })()}
            </Popover>

            {/* Per-doctor approval-matrix override */}
            <DoctorApprovalMatrixDialog
                open={!!matrixDoctor}
                onClose={() => setMatrixDoctor(null)}
                doctorId={matrixDoctor?.doctor_id || matrixDoctor?.id}
                doctorName={matrixDoctor ? `${matrixDoctor.first_name || ''} ${matrixDoctor.last_name || ''}`.trim() : ''}
            />

            {/* Edit Status Dialog */}
            <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Change Doctor Status</DialogTitle>
                <DialogContent>
                    {selectedDoctor && (
                        <Box sx={{ pt: 2 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Doctor: {selectedDoctor.first_name} {selectedDoctor.last_name}
                            </Typography>
                            <FormControl fullWidth sx={{ mt: 2 }}>
                                <InputLabel>Status</InputLabel>
                                <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} label="Status">
                                    <MenuItem value="active">Active</MenuItem>
                                    <MenuItem value="blocked">Blocked</MenuItem>
                                    <MenuItem value="inactive">Inactive</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setStatusDialogOpen(false)} disabled={updating}>Cancel</Button>
                    <Button onClick={handleStatusUpdate} variant="contained" disabled={updating}>
                        {updating ? <CircularProgress size={20} /> : 'Update'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Verification Dialog */}
            <Dialog open={verifyDialogOpen} onClose={() => setVerifyDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Update Verification Status</DialogTitle>
                <DialogContent>
                    {selectedDoctor && (
                        <Box sx={{ pt: 2 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Doctor: {selectedDoctor.first_name} {selectedDoctor.last_name}
                            </Typography>
                            <FormControl fullWidth sx={{ mt: 2 }}>
                                <InputLabel>Verification Status</InputLabel>
                                <Select value={newVerificationStatus} onChange={(e) => setNewVerificationStatus(e.target.value)} label="Verification Status">
                                    <MenuItem value="pending">Pending</MenuItem>
                                    <MenuItem value="verified">Verified</MenuItem>
                                    <MenuItem value="rejected">Rejected</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setVerifyDialogOpen(false)} disabled={updating}>Cancel</Button>
                    <Button onClick={handleVerificationUpdate} variant="contained" color="success" disabled={updating}>
                        {updating ? <CircularProgress size={20} /> : 'Update'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Documents Dialog */}
            <Dialog open={documentsDialogOpen} onClose={() => setDocumentsDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Doctor Documents</DialogTitle>
                <DialogContent>
                    {loadingDocuments ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                    ) : documents ? (
                        <Box sx={{ pt: 2 }}>
                            <Typography variant="h6" gutterBottom>{documents.doctor_name}</Typography>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Registration: {documents.registration_number} | Council: {documents.registration_council || 'N/A'} | Year: {documents.registration_year || 'N/A'}
                            </Typography>
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Documents</Typography>
                            <List dense>
                                {[
                                    { field: 'registration_certificate', label: 'Registration Certificate' },
                                    { field: 'cop_attachment', label: 'COP Certificate' },
                                ].map(({ field, label }) => {
                                    const url = documents.documents?.[field];
                                    const status = (documents.certificate_verification?.[field] || 'pending').toLowerCase();
                                    const statusColor = status === 'verified' ? 'success' : status === 'rejected' ? 'error' : 'warning';
                                    return (
                                        <ListItem key={field} alignItems="flex-start">
                                            <ListItemIcon><BadgeIcon /></ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        {label}
                                                        <Chip size="small" color={statusColor} label={status.toUpperCase()} />
                                                    </Box>
                                                }
                                                secondary={
                                                    <>
                                                        {url
                                                            ? <Link href={getDocumentUrl(url)} target="_blank" rel="noopener">View Document</Link>
                                                            : 'Not uploaded'}
                                                        {url && (
                                                            <Box sx={{ mt: 0.5, display: 'flex', gap: 1 }}>
                                                                <Button size="small" color="success" variant="outlined"
                                                                    disabled={verifyingCert || status === 'verified'}
                                                                    onClick={() => handleVerifyCert(field, 'verified')}>
                                                                    Approve
                                                                </Button>
                                                                <Button size="small" color="error" variant="outlined"
                                                                    disabled={verifyingCert || status === 'rejected'}
                                                                    onClick={() => handleVerifyCert(field, 'rejected')}>
                                                                    Reject
                                                                </Button>
                                                            </Box>
                                                        )}
                                                    </>
                                                }
                                            />
                                        </ListItem>
                                    );
                                })}
                                <ListItem>
                                    <ListItemIcon><DescriptionIcon /></ListItemIcon>
                                    <ListItemText primary="Aadhar Attachment" secondary={documents.documents?.aadhar_attachment ? (<Link href={getDocumentUrl(documents.documents.aadhar_attachment)} target="_blank" rel="noopener">View Document</Link>) : 'Not uploaded'} />
                                </ListItem>
                                <ListItem>
                                    <ListItemIcon><ImageIcon /></ListItemIcon>
                                    <ListItemText primary="Profile Image" secondary={documents.documents?.profile_image ? (<Link href={getDocumentUrl(documents.documents.profile_image)} target="_blank" rel="noopener">View Image</Link>) : 'Not uploaded'} />
                                </ListItem>
                                <ListItem>
                                    <ListItemIcon><ImageIcon /></ListItemIcon>
                                    <ListItemText primary="Signature Image" secondary={documents.documents?.signature_image ? (<Link href={getDocumentUrl(documents.documents.signature_image)} target="_blank" rel="noopener">View Image</Link>) : 'Not uploaded'} />
                                </ListItem>
                            </List>

                            {documents.qualifications?.length > 0 && (
                                <>
                                    <Divider sx={{ my: 2 }} />
                                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Qualifications</Typography>
                                    <List dense>
                                        {documents.qualifications.map((qual, index) => (
                                            <ListItem key={index}>
                                                <ListItemIcon><SchoolIcon /></ListItemIcon>
                                                <ListItemText primary={qual.degree_name} secondary={`${qual.institution} (${qual.passing_year || 'N/A'})`} />
                                            </ListItem>
                                        ))}
                                    </List>
                                </>
                            )}
                        </Box>
                    ) : (
                        <Typography color="text.secondary">No documents available</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDocumentsDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Analytics Dialog */}
            <Dialog
                open={analyticsDialogOpen}
                onClose={() => setAnalyticsDialogOpen(false)}
                maxWidth="lg"
                fullWidth
            >
                <DialogTitle>
                    Analytics & Settings — {analyticsDoctor?.first_name} {analyticsDoctor?.last_name}
                </DialogTitle>
                <DialogContent>
                    {analyticsDoctor && (
                        <ErrorBoundary label="Analytics & Settings">
                            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}>
                                <AnalyticsSection
                                    doctorId={analyticsDoctor.doctor_id || analyticsDoctor.id}
                                    isAdmin={true}
                                />
                            </Suspense>
                        </ErrorBoundary>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAnalyticsDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Publish Status Dialog — per-consultation-type */}
            <Dialog open={publishDialogOpen} onClose={() => setPublishDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Change Publish Status</DialogTitle>
                <DialogContent>
                    {publishDoctor && (
                        <Box sx={{ pt: 1 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Doctor: {publishDoctor.first_name} {publishDoctor.last_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                                Publish status controls whether patients can see this doctor's profile and book appointments.
                            </Typography>

                            {/* Set All shortcut */}
                            <Box display="flex" alignItems="center" gap={2} mb={3}>
                                <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>Set All:</Typography>
                                <ToggleButtonGroup
                                    exclusive
                                    onChange={(_, val) => { if (val !== null) handleSetAll(val); }}
                                    size="small"
                                    sx={{ flexWrap: 'wrap' }}
                                >
                                    <ToggleButton value="active" sx={{ px: 2, textTransform: 'none' }}>Active</ToggleButton>
                                    <ToggleButton value="inactive" sx={{ px: 2, textTransform: 'none' }}>Inactive</ToggleButton>
                                    <ToggleButton value="on_hold" sx={{ px: 2, textTransform: 'none' }}>On Hold</ToggleButton>
                                    <ToggleButton value="suspended" sx={{ px: 2, textTransform: 'none' }}>Suspended</ToggleButton>
                                </ToggleButtonGroup>
                            </Box>

                            <Divider sx={{ mb: 2 }} />

                            {/* Per-type rows */}
                            <Box display="flex" flexDirection="column" gap={1.5}>
                                {CONSULTATION_TYPES.map((ct) => (
                                    <Box key={ct.value} display="flex" alignItems="center" gap={2}>
                                        <Box
                                            sx={{
                                                width: 28, height: 28, borderRadius: '50%',
                                                bgcolor: ct.color + '22',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 15, flexShrink: 0,
                                            }}
                                        >
                                            {ct.icon}
                                        </Box>
                                        <Typography variant="body2" sx={{ minWidth: 180, fontWeight: 500 }}>
                                            {ct.label}
                                        </Typography>
                                        <ToggleButtonGroup
                                            value={typeStatusMap[ct.value] || 'inactive'}
                                            exclusive
                                            onChange={(_, val) => {
                                                if (val !== null) setTypeStatusMap((prev) => ({ ...prev, [ct.value]: val }));
                                            }}
                                            size="small"
                                            sx={{ flexWrap: 'wrap' }}
                                        >
                                            <ToggleButton value="active" sx={{ px: 1.5, textTransform: 'none', fontSize: '0.75rem' }}>Active</ToggleButton>
                                            <ToggleButton value="inactive" sx={{ px: 1.5, textTransform: 'none', fontSize: '0.75rem' }}>Inactive</ToggleButton>
                                            <ToggleButton value="on_hold" sx={{ px: 1.5, textTransform: 'none', fontSize: '0.75rem' }}>On Hold</ToggleButton>
                                            <ToggleButton value="suspended" sx={{ px: 1.5, textTransform: 'none', fontSize: '0.75rem' }}>Suspended</ToggleButton>
                                        </ToggleButtonGroup>
                                        <Chip
                                            label={getPublishStatusLabel(typeStatusMap[ct.value])}
                                            color={getPublishStatusColor(typeStatusMap[ct.value])}
                                            size="small"
                                            sx={{ ml: 'auto' }}
                                        />
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPublishDialogOpen(false)} disabled={updatingPublish}>Cancel</Button>
                    <Button onClick={handlePublishStatusUpdate} variant="contained" disabled={updatingPublish}>
                        {updatingPublish ? <CircularProgress size={20} /> : 'Update Publish Status'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Bank Accounts Dialog */}
            <Dialog open={bankDialogOpen} onClose={() => setBankDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>
                    Bank Accounts — {bankData?.doctor_name || bankDoctor?.first_name + ' ' + bankDoctor?.last_name}
                </DialogTitle>
                <DialogContent>
                    {bankLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                    ) : bankData?.accounts?.length > 0 ? (
                        <Box sx={{ pt: 1 }}>
                            {bankData.accounts.map((acc, idx) => (
                                <Paper key={acc.id} sx={{ p: 2, mb: 2, border: '1px solid #e0e0e0' }} elevation={0}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="subtitle1" fontWeight={600}>
                                            {acc.orderIndex === 0 ? 'Primary Account' : `Account ${acc.orderIndex + 1}`}
                                        </Typography>
                                        <Chip
                                            label={acc.verificationStatus || 'pending'}
                                            color={getVerificationColor(acc.verificationStatus)}
                                            size="small"
                                        />
                                    </Box>
                                    <Divider sx={{ mb: 1.5 }} />
                                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">Bank Name</Typography>
                                            <Typography variant="body2">{acc.bankName || '-'}</Typography>
                                        </Box>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">Account Holder</Typography>
                                            <Typography variant="body2">{acc.accountName || '-'}</Typography>
                                        </Box>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">Account Number</Typography>
                                            <Typography variant="body2">{acc.accountNumber || '-'}</Typography>
                                        </Box>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">IFSC Code</Typography>
                                            <Typography variant="body2">{acc.ifscCode || '-'}</Typography>
                                        </Box>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">Branch</Typography>
                                            <Typography variant="body2">{acc.branch || '-'}</Typography>
                                        </Box>
                                    </Box>

                                    {/* Documents */}
                                    <Box sx={{ mt: 1.5 }}>
                                        <Typography variant="caption" fontWeight={600}>Documents</Typography>
                                        <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                                            {acc.passbook?.fileUrl && (
                                                <Chip
                                                    label={`Passbook (${acc.passbook.verificationStatus})`}
                                                    color={getVerificationColor(acc.passbook.verificationStatus)}
                                                    size="small" variant="outlined" clickable
                                                    component="a" href={acc.passbook.signedUrl || acc.passbook.fileUrl}
                                                    target="_blank" rel="noopener"
                                                />
                                            )}
                                            {acc.checkLeaf?.fileUrl && (
                                                <Chip
                                                    label={`Check Leaf (${acc.checkLeaf.verificationStatus})`}
                                                    color={getVerificationColor(acc.checkLeaf.verificationStatus)}
                                                    size="small" variant="outlined" clickable
                                                    component="a" href={acc.checkLeaf.signedUrl || acc.checkLeaf.fileUrl}
                                                    target="_blank" rel="noopener"
                                                />
                                            )}
                                            {acc.bankStatement?.fileUrl && (
                                                <Chip
                                                    label={`Bank Statement (${acc.bankStatement.verificationStatus})`}
                                                    color={getVerificationColor(acc.bankStatement.verificationStatus)}
                                                    size="small" variant="outlined" clickable
                                                    component="a" href={acc.bankStatement.signedUrl || acc.bankStatement.fileUrl}
                                                    target="_blank" rel="noopener"
                                                />
                                            )}
                                        </Box>
                                    </Box>

                                    {/* Actions */}
                                    <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        {acc.verificationStatus !== 'verified' && (
                                            <>
                                                {/* Penny drop is sent ONCE — hide once it's awaiting the
                                                    doctor's confirmation so the admin can't fire ₹1 repeatedly. */}
                                                {acc.beneficiaryStatus !== 'penny_sent' && (
                                                    <Tooltip title="Sends ₹1 (penny drop) to the doctor's account to verify the number & IFSC. The doctor then confirms they received it to complete verification. Sent only once.">
                                                        <Button
                                                            size="small" variant="contained" color="primary"
                                                            startIcon={bankActionLoading === `${acc.id}-validate` ? <CircularProgress size={16} color="inherit" /> : <AccountBalanceIcon />}
                                                            onClick={() => handleBankAction(acc.id, 'validate')}
                                                            disabled={!!bankActionLoading}
                                                        >
                                                            Verify bank (₹1 penny drop)
                                                        </Button>
                                                    </Tooltip>
                                                )}
                                                <Tooltip title="Force-verify without a penny-drop check. Use only if you have manually confirmed the details.">
                                                    <Button
                                                        size="small" variant="outlined" color="success"
                                                        startIcon={<VerifiedUserIcon />}
                                                        onClick={() => handleBankAction(acc.id, 'manual_verify')}
                                                        disabled={!!bankActionLoading}
                                                    >
                                                        Manual Verify
                                                    </Button>
                                                </Tooltip>
                                            </>
                                        )}
                                        {acc.verificationStatus !== 'rejected' && acc.verificationStatus !== 'verified' && (
                                            <Button
                                                size="small" variant="outlined" color="error"
                                                startIcon={<BlockIcon />}
                                                onClick={() => handleBankAction(acc.id, 'reject')}
                                                disabled={!!bankActionLoading}
                                            >
                                                Reject
                                            </Button>
                                        )}
                                        {acc.verificationStatus === 'verified' && (
                                            <Chip label="Verified" color="success" icon={<VerifiedUserIcon />} />
                                        )}
                                        {acc.verificationStatus === 'rejected' && (
                                            <>
                                                <Chip label="Rejected" color="error" size="small" sx={{ mr: 1 }} />
                                                <Tooltip title="Re-verify after doctor corrects details (₹1 penny drop)">
                                                    <Button
                                                        size="small" variant="contained" color="primary"
                                                        startIcon={<AccountBalanceIcon />}
                                                        onClick={() => handleBankAction(acc.id, 'validate')}
                                                        disabled={!!bankActionLoading}
                                                    >
                                                        Re-verify (₹1 penny drop)
                                                    </Button>
                                                </Tooltip>
                                            </>
                                        )}
                                        {/* Cashfree payout beneficiary status + removal */}
                                        {acc.beneficiaryStatus === 'penny_sent' && (
                                            <Chip
                                                label="₹1 sent — awaiting doctor confirmation"
                                                color="warning" size="small" variant="outlined"
                                            />
                                        )}
                                        {/* Suspend — detach from Cashfree, keep the account so it
                                            can be penny-dropped and verified again. */}
                                        {((acc.beneficiaryStatus && !['none', 'removed'].includes(acc.beneficiaryStatus))
                                          || acc.verificationStatus === 'verified') && (
                                            <Tooltip title="Suspend payouts to this account: detaches the Cashfree beneficiary and resets verification. The account stays on the doctor's profile and can be verified again with a fresh ₹1 penny drop.">
                                                <Button
                                                    size="small" variant="outlined" color="warning"
                                                    startIcon={bankActionLoading === `${acc.id}-remove_beneficiary` ? <CircularProgress size={16} color="inherit" /> : <BlockIcon />}
                                                    onClick={() => handleBankAction(acc.id, 'remove_beneficiary')}
                                                    disabled={!!bankActionLoading}
                                                >
                                                    Suspend
                                                </Button>
                                            </Tooltip>
                                        )}
                                        {/* Remove — delete the beneficiary AND the account row. */}
                                        <Tooltip title="Permanently delete this bank account from Cashfree and from the doctor's profile. Payouts will be held until a new account is added and verified.">
                                            <Button
                                                size="small" variant="outlined" color="error"
                                                startIcon={bankActionLoading === `${acc.id}-remove_account` ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
                                                onClick={() => setRemoveTarget(acc)}
                                                disabled={!!bankActionLoading}
                                            >
                                                Remove
                                            </Button>
                                        </Tooltip>
                                    </Box>
                                </Paper>
                            ))}
                        </Box>
                    ) : (
                        <Box sx={{ py: 4, textAlign: 'center' }}>
                            <AccountBalanceIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                            <Typography color="text.secondary">
                                This doctor has not added any bank accounts yet.
                            </Typography>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBankDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Confirm hard-removal of a bank account */}
            <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Remove this bank account?</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Payouts will be held. Until the doctor adds a new account and
                        verifies it with a ₹1 penny drop, no payout can be sent.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        This deletes <strong>{removeTarget?.bankName || 'the account'}</strong>
                        {removeTarget?.accountNumber ? ` (…${String(removeTarget.accountNumber).slice(-4)})` : ''}
                        {' '}from Cashfree and from the doctor&apos;s profile. Past payout records are
                        kept for audit. To pause payouts without deleting, use <strong>Suspend</strong> instead.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
                    <Button
                        variant="contained" color="error"
                        disabled={!!bankActionLoading}
                        onClick={() => {
                            const id = removeTarget?.id;
                            setRemoveTarget(null);
                            if (id) handleBankAction(id, 'remove_account');
                        }}
                    >
                        Remove account
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Preview drill-downs — sections not yet wired to live data */}
            <Dialog open={!!stubDialog} onClose={() => setStubDialog(null)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ textTransform: 'capitalize' }}>
                    {(stubDialog === 'ledger' ? 'Credit usage' : stubDialog === 'photo' ? 'Profile photo' : stubDialog)} — {stubDoctor?.first_name} {stubDoctor?.last_name}
                </DialogTitle>
                <DialogContent>
                    {stubDialog === 'payments' && (
                        payoutsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        ) : payouts.length === 0 ? (
                            <Typography color="text.secondary" sx={{ py: 3 }}>No payouts recorded for this doctor yet.</Typography>
                        ) : (
                            <Table size="small">
                                <TableHead><TableRow>
                                    <TableCell>Appt date</TableCell><TableCell>Bill / Appt</TableCell><TableCell>Type</TableCell>
                                    <TableCell align="right">Payable</TableCell><TableCell align="right">Charges</TableCell>
                                    <TableCell align="right">TDS</TableCell><TableCell align="right">Paid</TableCell>
                                    <TableCell>Paid date</TableCell><TableCell>Status</TableCell>
                                </TableRow></TableHead>
                                <TableBody>
                                    {payouts.map((p) => (
                                        <TableRow key={p.id}>
                                            <TableCell>{fmtDate(p.appointment_date)}</TableCell>
                                            <TableCell>{p.bill_number || (p.appointment_id ? p.appointment_id.slice(0, 8) : '—')}</TableCell>
                                            <TableCell sx={{ textTransform: 'capitalize' }}>{p.consultation_type || '—'}</TableCell>
                                            <TableCell align="right">{inr(p.amount_payable)}</TableCell>
                                            <TableCell align="right">
                                                {(p.charges_snapshot || []).some((c) => Number(c.total) > 0) ? (
                                                    <Tooltip title={(
                                                        <Box sx={{ p: 0.5 }}>
                                                            {(p.charges_snapshot || []).filter((c) => Number(c.total) > 0).map((c, ci) => (
                                                                <Typography key={ci} variant="caption" sx={{ display: 'block' }}>
                                                                    {c.name}: {inr(c.base_charge)} + tax {inr(c.tax)} = {inr(c.total)}
                                                                </Typography>
                                                            ))}
                                                        </Box>
                                                    )}>
                                                        <Box component="span" sx={{ borderBottom: '1px dotted', cursor: 'help' }}>{inr(p.charges)}</Box>
                                                    </Tooltip>
                                                ) : inr(p.charges)}
                                            </TableCell>
                                            <TableCell align="right">{inr(p.tds)}</TableCell>
                                            <TableCell align="right">{inr(p.amount_paid)}</TableCell>
                                            <TableCell>{fmtDate(p.paid_date)}</TableCell>
                                            <TableCell><Chip label={p.status || '—'} size="small" color={p.status === 'completed' ? 'success' : p.status === 'failed' ? 'error' : 'warning'} /></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )
                    )}
                    {stubDialog === 'efficiency' && (
                        effLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        ) : !effMetrics ? (
                            <Typography color="text.secondary" sx={{ py: 3 }}>No metrics available for this doctor.</Typography>
                        ) : (
                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Period: {effMetrics.period} ({fmtDate(effMetrics.start_date)} – {fmtDate(effMetrics.end_date)})
                                </Typography>
                                <Table size="small" sx={{ mt: 1 }}>
                                    <TableBody>
                                        {[
                                            ['Revenue earned', inr(effMetrics.revenue_earned)],
                                            ['Slots published', effMetrics.slots_generated],
                                            ['Slots booked', effMetrics.slots_booked],
                                            ['Booking rate', effMetrics.booking_rate != null ? `${effMetrics.booking_rate}%` : '—'],
                                            ['Appointments — total', effMetrics.appointments_total],
                                            ['Completed', effMetrics.appointments_completed],
                                            ['Cancelled', effMetrics.appointments_cancelled],
                                            ['Pending', effMetrics.appointments_pending],
                                            ['Scheduled hours', effMetrics.scheduled_hours],
                                        ].map(([k, v]) => (
                                            <TableRow key={k}>
                                                <TableCell sx={{ color: 'text.secondary', width: '50%' }}>{k}</TableCell>
                                                <TableCell sx={{ fontWeight: 600 }}>{v ?? '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                        )
                    )}
                    {stubDialog === 'ledger' && (
                        ledgerLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        ) : (
                            <Box>
                                <Box sx={{ display: 'flex', gap: 3, mb: 2 }}>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Available balance</Typography>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>{inr(creditLedger?.available || 0)}</Typography>
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Total spent</Typography>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>{inr(creditLedger?.total_spent || 0)}</Typography>
                                    </Box>
                                </Box>
                                {(creditLedger?.ledger || []).length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 3 }}>No credit activity for this doctor.</Typography>
                                ) : (
                                    <Table size="small">
                                        <TableHead><TableRow>
                                            <TableCell>Date</TableCell><TableCell>Type</TableCell>
                                            <TableCell>Description</TableCell><TableCell align="right">Amount</TableCell>
                                        </TableRow></TableHead>
                                        <TableBody>
                                            {(creditLedger?.ledger || []).map((row, i) => {
                                                const amt = Number(row.amount || 0);
                                                const isDebit = amt < 0 || row.kind === 'spend' || row.kind === 'expire';
                                                return (
                                                    <TableRow key={row.id || i}>
                                                        <TableCell>{fmtDate(row.created_at)}</TableCell>
                                                        <TableCell sx={{ textTransform: 'capitalize' }}>{row.kind || '—'}</TableCell>
                                                        <TableCell>{row.note || row.ref_type || '—'}</TableCell>
                                                        <TableCell align="right" sx={{ fontWeight: 600, color: isDebit ? 'error.main' : 'success.main' }}>
                                                            {isDebit ? '-' : '+'}{inr(Math.abs(amt))}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                )}
                            </Box>
                        )
                    )}
                    {stubDialog === 'photo' && (() => {
                        const pendingPhoto = (apprHistory?.requests || []).find(
                            (r) => /(_image|photo)$/.test(r.field_name || '') && (r.status === 'pending' || r.status === 'query'));
                        return (
                            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', py: 1 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="subtitle2" gutterBottom>Current (approved)</Typography>
                                    <Avatar variant="rounded" src={resolveMediaUrl(stubDoctor?.profile_image)}
                                        sx={{ width: 180, height: 180, mx: 'auto' }}>
                                        {(stubDoctor?.first_name || '?')[0]}
                                    </Avatar>
                                </Box>
                                {pendingPhoto && (
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="subtitle2" gutterBottom color="warning.main">
                                            Pending approval
                                        </Typography>
                                        <Avatar variant="rounded" src={resolveMediaUrl(pendingPhoto.new_value)}
                                            sx={{ width: 180, height: 180, mx: 'auto', border: '2px solid', borderColor: 'warning.main' }}>?</Avatar>
                                        <Button size="small" sx={{ mt: 1 }} onClick={() => openStub('approvals', stubDoctor)}>
                                            Review in approvals
                                        </Button>
                                    </Box>
                                )}
                            </Box>
                        );
                    })()}
                    {['activation', 'engagement', 'basic'].includes(stubDialog) && genericSection && (
                        <Table size="small">
                            <TableBody>
                                {genericSection.cols.map((c, i) => (
                                    <TableRow key={i}>
                                        <TableCell sx={{ color: 'text.secondary', width: '45%' }}>{c.label}</TableCell>
                                        <TableCell>{stubDoctor ? c.render(stubDoctor) : DASH}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {stubDialog === 'practice' && (() => {
                        const reg = stubDoctor?.registration || {};
                        const cop = stubDoctor?.cop || {};
                        const block = (title, r) => (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{title}</Typography>
                                <Table size="small">
                                    <TableHead><TableRow>
                                        <TableCell>S.No</TableCell><TableCell>Reg no</TableCell><TableCell>Reg name</TableCell>
                                        <TableCell>Date</TableCell><TableCell>Expiry</TableCell><TableCell>Board</TableCell>
                                        <TableCell>State</TableCell><TableCell>Attachment</TableCell>
                                    </TableRow></TableHead>
                                    <TableBody><TableRow>
                                        <TableCell>1</TableCell>
                                        <TableCell>{r.number || '—'}</TableCell>
                                        <TableCell>{r.name || '—'}</TableCell>
                                        <TableCell>{fmtDate(r.date)}</TableCell>
                                        <TableCell>{fmtDate(r.expiry)}</TableCell>
                                        <TableCell>{r.board || '—'}</TableCell>
                                        <TableCell>{r.state || '—'}</TableCell>
                                        <TableCell>{r.has_attachment ? textBtn('View', () => handleViewDocuments(stubDoctor)) : '—'}</TableCell>
                                    </TableRow></TableBody>
                                </Table>
                            </Box>
                        );
                        return (<>{block('Registration', reg)}{block('Certificate of Practice (COP)', cop)}</>);
                    })()}
                    {stubDialog === 'approvals' && (
                        apprLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        ) : (() => {
                            const rows = apprHistory?.requests || [];
                            if (rows.length === 0) {
                                return <Typography color="text.secondary" sx={{ py: 3 }}>No field-change requests on record for this doctor.</Typography>;
                            }
                            return (
                                <>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                        {apprHistory?.total || rows.length} total · {apprHistory?.pending_count || 0} pending — full history of every change submitted for admin approval
                                    </Typography>
                                    <Table size="small">
                                        <TableHead><TableRow>
                                            <TableCell>Section</TableCell><TableCell>Field</TableCell>
                                            <TableCell>Change</TableCell><TableCell>Submitted</TableCell>
                                            <TableCell>Status</TableCell><TableCell align="right">Action</TableCell>
                                        </TableRow></TableHead>
                                        <TableBody>
                                            {rows.map((r) => {
                                                const pending = r.status === 'pending' || r.status === 'query';
                                                return (
                                                    <TableRow key={r.id}>
                                                        <TableCell>{SECTION_LABELS[r.section] || r.section}</TableCell>
                                                        <TableCell sx={{ textTransform: 'capitalize' }}>{(r.field_name || '').replace(/_/g, ' ')}</TableCell>
                                                        <TableCell sx={{ maxWidth: 260 }}>
                                                            {(r.is_file_field || /(_image|photo)$/.test(r.field_name || '')) ? (
                                                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                                    <Box sx={{ textAlign: 'center' }}>
                                                                        <Avatar variant="rounded" src={resolveMediaUrl(r.old_value)} sx={{ width: 44, height: 44 }}>—</Avatar>
                                                                        <Typography variant="caption" color="text.secondary">old</Typography>
                                                                    </Box>
                                                                    <Typography>→</Typography>
                                                                    <Box sx={{ textAlign: 'center' }}>
                                                                        <Avatar variant="rounded" src={resolveMediaUrl(r.new_value)} sx={{ width: 44, height: 44 }}>—</Avatar>
                                                                        <Typography variant="caption" color="text.secondary">new</Typography>
                                                                    </Box>
                                                                </Box>
                                                            ) : (
                                                                <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {`${r.old_value ?? '—'} → ${r.new_value ?? '—'}`}
                                                                </Box>
                                                            )}
                                                        </TableCell>
                                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</TableCell>
                                                        <TableCell><Chip label={r.status} color={apprColor(r.status)} size="small" /></TableCell>
                                                        <TableCell align="right">
                                                            {r.kind === 'bank_account' ? (
                                                                // Bank verification has its own gateway-aware flow (penny-drop /
                                                                // manual verify) — send the admin to the Bank Accounts dialog
                                                                // rather than approving a synthetic row here.
                                                                <Button size="small" color="primary" variant="outlined"
                                                                    onClick={() => { setStubDialog(null); handleBankClick(stubDoctor); }}>
                                                                    Review bank
                                                                </Button>
                                                            ) : pending ? (
                                                                <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                                                                    <Button size="small" color="success" variant="outlined"
                                                                        disabled={!!approvalBusy}
                                                                        onClick={() => handleApproval(r.id, 'approve')}>Approve</Button>
                                                                    <Button size="small" color="error" variant="outlined"
                                                                        disabled={!!approvalBusy}
                                                                        onClick={() => handleApproval(r.id, 'reject')}>Reject</Button>
                                                                </Box>
                                                            ) : (
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {r.reviewer_name || (r.reviewed_at ? 'reviewed' : '—')}
                                                                </Typography>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </>
                            );
                        })()
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setStubDialog(null)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={closeSnackbar} message={snackbar.message} />
            <Snackbar
                open={!!bankSnackMsg}
                autoHideDuration={6000}
                onClose={() => setBankSnackMsg('')}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={bankSnackSeverity}
                    onClose={() => setBankSnackMsg('')}
                    variant="filled"
                    sx={{ width: '100%', maxWidth: 600 }}
                >
                    {bankSnackMsg}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ViewDoctors;
