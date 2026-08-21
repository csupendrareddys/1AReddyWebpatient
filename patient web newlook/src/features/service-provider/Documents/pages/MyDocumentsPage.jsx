/**
 * MyDocumentsPage — Doctor's document hub
 *
 * Tab 0: Pending (To Generate)  → purchased services (orders) WITHOUT a document
 * Tab 1: Drafts                 → saved drafts not yet sent for approval
 * Tab 2: Awaiting Approval      → documents sent for admin review
 * Tab 3: Pending to Push        → admin approved, doctor still to push to patient
 * Tab 4: Completed              → pushed to patient (active)
 * Tab 5: Rejected               → admin rejected (doctor can fix & resubmit)
 * Tab 6: Revised                → old documents that were revised
 */
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Tabs, Tab, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TablePagination, Chip, IconButton,
    CircularProgress, Tooltip, Button, LinearProgress,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import MedicationIcon from '@mui/icons-material/Medication';
import HistoryIcon from '@mui/icons-material/History';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import PreviewIcon from '@mui/icons-material/Preview';
import DraftsIcon from '@mui/icons-material/Drafts';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SendIcon from '@mui/icons-material/Send';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
    useGetOrdersPendingDocumentsQuery,
    useGetDoctorDocumentsQuery,
    useGetDoctorDocumentSummaryQuery,
    useUploadDocumentMutation,
} from '../../api/scopedDoctorApi';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

// The list shows the description as the row summary — it is the document's
// only fixed content field, so it is the closest thing to a title.
const summarise = (text, max = 50) => {
    if (!text) return '-';
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

const MyDocumentsPage = () => {
    const navigate = useNavigate();
    // See MyPrescriptionsPage — the sibling hub — for why links are built from
    // the scope rather than hard-coded to /dashboard/doctor.
    const { recordsPath } = useDoctorScope();
    const [tab, setTab] = useState(0);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Manual-PDF-upload: the only difference from "Write Document" is that the
    // doctor attaches a ready PDF instead of filling the clinical form. The
    // resulting draft follows the identical approve → push lifecycle.
    const [uploadDocument] = useUploadDocumentMutation();
    const [uploadingOrderId, setUploadingOrderId] = useState(null);
    const uploadInputRef = useRef(null);
    const pendingUploadOrderRef = useRef(null);

    const openUploadPicker = (orderId) => {
        pendingUploadOrderRef.current = orderId;
        uploadInputRef.current?.click();
    };
    const onUploadFilePicked = async (e) => {
        const file = e.target.files?.[0];
        const orderId = pendingUploadOrderRef.current;
        e.target.value = '';
        if (!file || !orderId) return;
        if (file.size > 5 * 1024 * 1024) {
            window.alert('File is too large (max 5 MB).');
            return;
        }
        setUploadingOrderId(orderId);
        try {
            await uploadDocument({ orderId, file, title: file.name }).unwrap();
        } catch (err) {
            window.alert(err?.data?.error || err?.data?.message || 'Upload failed.');
        } finally {
            setUploadingOrderId(null);
        }
    };

    // Progress summary — pending-to-write + yet-to-publish counts.
    const { data: summary } = useGetDoctorDocumentSummaryQuery();

    // Tab 0: purchased services (orders) needing a document
    const { data: pendingData, isLoading: pendingLoading } = useGetOrdersPendingDocumentsQuery(
        { page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 0 },
    );

    // Tab 1: drafts
    const { data: draftData, isLoading: draftLoading } = useGetDoctorDocumentsQuery(
        { status: 'draft', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 1 },
    );

    // Tab 2: awaiting admin approval
    const { data: awaitingData, isLoading: awaitingLoading } = useGetDoctorDocumentsQuery(
        { status: 'pending_approval', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 2 },
    );

    // Tab 3: approved by admin (ready to push to patient)
    const { data: approvedData, isLoading: approvedLoading } = useGetDoctorDocumentsQuery(
        { status: 'approved', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 3 },
    );

    // Tab 4: completed (active — pushed to patient)
    const { data: completedData, isLoading: completedLoading } = useGetDoctorDocumentsQuery(
        { status: 'active', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 4 },
    );

    // Tab 5: rejected
    const { data: rejectedData, isLoading: rejectedLoading } = useGetDoctorDocumentsQuery(
        { status: 'rejected', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 5 },
    );

    // Tab 6: revised (superseded)
    const { data: revisedData, isLoading: revisedLoading } = useGetDoctorDocumentsQuery(
        { status: 'revised', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 6 },
    );

    const pendingOrders = pendingData?.orders || [];
    const draftDoc = draftData?.documents || [];
    const awaitingDoc = awaitingData?.documents || [];
    const approvedDoc = approvedData?.documents || [];
    const completedDoc = completedData?.documents || [];
    const rejectedDoc = rejectedData?.documents || [];
    const revisedDoc = revisedData?.documents || [];

    const paginationMap = {
        0: pendingData?.pagination || {},
        1: draftData?.pagination || {},
        2: awaitingData?.pagination || {},
        3: approvedData?.pagination || {},
        4: completedData?.pagination || {},
        5: rejectedData?.pagination || {},
        6: revisedData?.pagination || {},
    };
    const currentPagination = paginationMap[tab] || {};
    const loadingMap = [pendingLoading, draftLoading, awaitingLoading, approvedLoading, completedLoading, rejectedLoading, revisedLoading];
    const isLoading = loadingMap[tab] || false;


    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '-';

    return (
        <Box sx={{ p: 3 }}>
            {/* Shared hidden picker for the per-row "Upload PDF" action. */}
            <input
                ref={uploadInputRef} type="file"
                accept=".pdf,application/pdf"
                style={{ display: 'none' }} onChange={onUploadFilePicked}
            />
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <DescriptionIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">My Documents</Typography>
            </Box>

            {/* ── Progress bar: how much document work is left ── */}
            {summary && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="subtitle1" fontWeight={600}>
                            Document progress
                        </Typography>
                        {summary.all_done ? (
                            <Chip icon={<CheckCircleIcon />} color="success" size="small"
                                label="All caught up — nothing pending!" />
                        ) : (
                            <Typography variant="body2" color="text.secondary">
                                {summary.pending_to_write} pending to write
                                {' · '}
                                {summary.yet_to_publish} yet to publish
                            </Typography>
                        )}
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={summary.all_done ? 100 : (summary.completed_pct ?? 0)}
                        color={summary.all_done ? 'success' : 'primary'}
                        sx={{ height: 10, borderRadius: 5 }}
                    />
                    <Box display="flex" gap={1} mt={1.5} flexWrap="wrap">
                        <Chip size="small"
                            variant={summary.pending_to_write ? 'filled' : 'outlined'}
                            color={summary.pending_to_write ? 'warning' : 'default'}
                            label={`${summary.pending_to_write} to write`}
                            onClick={() => { setTab(0); setPage(0); }}
                            clickable />
                        <Chip size="small"
                            variant={summary.yet_to_publish ? 'filled' : 'outlined'}
                            color={summary.yet_to_publish ? 'info' : 'default'}
                            label={`${summary.yet_to_publish} to publish`}
                            onClick={() => { setTab(3); setPage(0); }}
                            clickable />
                        <Chip size="small" variant="outlined" color="success"
                            label={`${summary.published} published`} />
                    </Box>
                </Paper>
            )}

            <Paper sx={{ mb: 3 }}>
                <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(0); }} variant="scrollable" scrollButtons="auto">
                    <Tab label="Pending (To Generate)" />
                    <Tab label="Drafts" icon={<DraftsIcon />} iconPosition="start" />
                    <Tab label="Awaiting Approval" icon={<HourglassTopIcon />} iconPosition="start" />
                    <Tab label="Pending to Push to Patient" icon={<CheckCircleIcon />} iconPosition="start" />
                    <Tab label="Completed" />
                    <Tab label="Rejected" />
                    <Tab label="Revised" icon={<HistoryIcon />} iconPosition="start" />
                </Tabs>
            </Paper>

            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{
                                    bgcolor: tab === 6 ? '#fff3e0' : tab === 5 ? '#fce4ec' : tab === 3 ? '#e8f5e9'
                                        : tab === 2 ? '#e3f2fd' : tab === 1 ? '#ede7f6' : 'grey.100'
                                }}>
                                    {tab === 0 ? (
                                        <>
                                            <TableCell><b>Patient</b></TableCell>
                                            <TableCell><b>Service</b></TableCell>
                                            <TableCell><b>Purchased</b></TableCell>
                                            <TableCell><b>Price</b></TableCell>
                                            <TableCell><b>Order Status</b></TableCell>
                                            <TableCell align="right"><b>Action</b></TableCell>
                                        </>
                                    ) : (
                                        <>
                                            <TableCell><b>Patient</b></TableCell>
                                            <TableCell><b>Service</b></TableCell>
                                            <TableCell><b>Description</b></TableCell>
                                            <TableCell><b>Fields</b></TableCell>
                                            <TableCell><b>Date</b></TableCell>
                                            <TableCell><b>Status</b></TableCell>
                                            {tab === 6 && <TableCell><b>Version</b></TableCell>}
                                            <TableCell align="right"><b>Action</b></TableCell>
                                        </>
                                    )}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {/* ── TAB 0: PENDING (To Generate) ── */}
                                {tab === 0 && pendingOrders.map((order) => (
                                    <TableRow key={order.id} hover>
                                        <TableCell>
                                            <Typography fontWeight={600}>{order.patient?.full_name || order.patient_name || 'Patient'}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            {order.product_name || '-'}
                                            {order.serving_doctors?.length > 1 && (
                                                <Typography variant="caption" display="block" color="text.secondary">
                                                    Group: {order.serving_doctors.join(', ')}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>{formatDate(order.created_at)}</TableCell>
                                        <TableCell>₹{order.price_at_purchase}</TableCell>
                                        <TableCell>
                                            <Chip label={(order.status || '').replace(/_/g, ' ')} size="small"
                                                color={order.status === 'completed' ? 'success' : 'info'} variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Box sx={{ display: 'inline-flex', gap: 1 }}>
                                                <Button variant="contained" size="small" startIcon={<MedicationIcon />}
                                                    onClick={() => navigate(`${recordsPath}/documents/new?orderId=${order.id}`)}>
                                                    Write Document
                                                </Button>
                                                {/* Manual PDF upload — attach a ready PDF instead of
                                                    generating one. Same lifecycle afterwards. */}
                                                <Button variant="outlined" size="small" startIcon={<UploadFileIcon />}
                                                    disabled={uploadingOrderId === order.id}
                                                    onClick={() => openUploadPicker(order.id)}>
                                                    {uploadingOrderId === order.id ? 'Uploading…' : 'Upload PDF'}
                                                </Button>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 1: DRAFTS ── */}
                                {tab === 1 && draftDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}/edit`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Draft" color="default" size="small" icon={<DraftsIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Continue editing">
                                                <IconButton size="small" color="primary"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/edit`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Preview & Submit">
                                                <IconButton size="small" color="info"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/preview`); }}>
                                                    <PreviewIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 2: AWAITING APPROVAL ── */}
                                {tab === 2 && awaitingDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Awaiting Approval" color="info" size="small" icon={<HourglassTopIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View Preview">
                                                <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/preview`); }}>
                                                    <PreviewIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 3: APPROVED (Ready to Push) ── */}
                                {tab === 3 && approvedDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer', bgcolor: '#f1f8e9' }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Pending to Push" color="warning" size="small" icon={<SendIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View & Push to Patient">
                                                <IconButton size="small" color="success"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/preview`); }}>
                                                    <SendIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 4: COMPLETED (Pushed to Patient) ── */}
                                {tab === 4 && completedDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Completed" color="success" size="small" />
                                            {p.revision_number > 1 && (
                                                <Chip label={`v${p.revision_number}`} size="small" sx={{ ml: 0.5 }} color="info" variant="outlined" />
                                            )}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View Preview">
                                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/preview`); }}>
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Revise document">
                                                <IconButton size="small" color="primary"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/edit?revise=true`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 5: REJECTED ── */}
                                {tab === 5 && rejectedDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}/edit`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Rejected" color="error" size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Edit & Resubmit">
                                                <IconButton size="small" color="warning"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}/edit`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 6: REVISED ── */}
                                {tab === 6 && revisedDoc.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer', opacity: 0.8 }}
                                        onClick={() => navigate(`${recordsPath}/documents/${p.id}`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.product_name || '-'}</TableCell>
                                        <TableCell>{summarise(p.description)}</TableCell>
                                        <TableCell>{p.custom_fields?.length || 0} fields</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Revised" color="warning" size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={`v${p.revision_number || 1}`} size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View old version">
                                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/documents/${p.id}`); }}>
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── Empty state ── */}
                                {((tab === 0 && !pendingOrders.length) ||
                                  (tab === 1 && !draftDoc.length) ||
                                  (tab === 2 && !awaitingDoc.length) ||
                                  (tab === 3 && !approvedDoc.length) ||
                                  (tab === 4 && !completedDoc.length) ||
                                  (tab === 5 && !rejectedDoc.length) ||
                                  (tab === 6 && !revisedDoc.length)) && (
                                    <TableRow>
                                        <TableCell colSpan={tab === 0 ? 6 : tab === 6 ? 8 : 7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            {tab === 0 ? 'No pending services. Every purchased service has a document.'
                                                : tab === 1 ? 'No draft documents.'
                                                : tab === 2 ? 'No documents awaiting approval.'
                                                : tab === 3 ? 'No documents pending push to patient.'
                                                : tab === 4 ? 'No completed documents yet.'
                                                : tab === 5 ? 'No rejected documents.'
                                                : 'No revised documents.'}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div" count={currentPagination.total || 0}
                            page={page} onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value)); setPage(0); }}
                        />
                    </>
                )}
            </TableContainer>
        </Box>
    );
};

export default MyDocumentsPage;
