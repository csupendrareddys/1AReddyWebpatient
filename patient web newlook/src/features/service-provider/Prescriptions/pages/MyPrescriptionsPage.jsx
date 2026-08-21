/**
 * MyPrescriptionsPage — Doctor's prescription hub
 *
 * Tab 0: Pending (To Generate)  → appointments WITHOUT a prescription
 * Tab 1: Drafts                 → saved drafts not yet sent for approval
 * Tab 2: Awaiting Approval      → prescriptions sent for admin review
 * Tab 3: Pending to Push        → admin approved, doctor still to push to patient
 * Tab 4: Completed              → pushed to patient (active)
 * Tab 5: Rejected               → admin rejected (doctor can fix & resubmit)
 * Tab 6: Revised                → old prescriptions that were revised
 */
import { useState } from 'react';
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
import {
    useGetAppointmentsPendingPrescriptionsQuery,
    useGetDoctorPrescriptionsQuery,
    useGetDoctorPrescriptionSummaryQuery,
} from '../../api/scopedDoctorApi';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

const MyPrescriptionsPage = () => {
    const navigate = useNavigate();
    // Where the prescription sub-pages live for whoever is looking: the
    // doctor's own app, or the Operations ``/records`` tab acting on their
    // behalf. Every link below is built from it rather than hard-coded, which
    // is the whole of what keeps this page working on both surfaces.
    const { recordsPath } = useDoctorScope();
    const [tab, setTab] = useState(0);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Progress summary — pending-to-write + yet-to-publish counts.
    const { data: summary } = useGetDoctorPrescriptionSummaryQuery();

    // Tab 0: appointments needing prescription
    const { data: pendingData, isLoading: pendingLoading } = useGetAppointmentsPendingPrescriptionsQuery(
        { page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 0 },
    );

    // Tab 1: drafts
    const { data: draftData, isLoading: draftLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'draft', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 1 },
    );

    // Tab 2: awaiting admin approval
    const { data: awaitingData, isLoading: awaitingLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'pending_approval', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 2 },
    );

    // Tab 3: approved by admin (ready to push to patient)
    const { data: approvedData, isLoading: approvedLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'approved', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 3 },
    );

    // Tab 4: completed (active — pushed to patient)
    const { data: completedData, isLoading: completedLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'active', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 4 },
    );

    // Tab 5: rejected
    const { data: rejectedData, isLoading: rejectedLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'rejected', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 5 },
    );

    // Tab 6: revised (superseded)
    const { data: revisedData, isLoading: revisedLoading } = useGetDoctorPrescriptionsQuery(
        { status: 'revised', page: page + 1, per_page: rowsPerPage },
        { skip: tab !== 6 },
    );

    const pendingAppts = pendingData?.appointments || [];
    const draftRx = draftData?.prescriptions || [];
    const awaitingRx = awaitingData?.prescriptions || [];
    const approvedRx = approvedData?.prescriptions || [];
    const completedRx = completedData?.prescriptions || [];
    const rejectedRx = rejectedData?.prescriptions || [];
    const revisedRx = revisedData?.prescriptions || [];

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
    const formatTime = (t) => {
        if (!t) return '';
        const [h, m] = t.split(':');
        const hr = parseInt(h);
        return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <DescriptionIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">My Prescriptions</Typography>
            </Box>

            {/* ── Progress bar: how much prescription work is left ── */}
            {summary && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="subtitle1" fontWeight={600}>
                            Prescription progress
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
                                            <TableCell><b>Complaint</b></TableCell>
                                            <TableCell><b>Date</b></TableCell>
                                            <TableCell><b>Time</b></TableCell>
                                            <TableCell><b>Type</b></TableCell>
                                            <TableCell align="right"><b>Action</b></TableCell>
                                        </>
                                    ) : (
                                        <>
                                            <TableCell><b>Patient</b></TableCell>
                                            <TableCell><b>Diagnosis</b></TableCell>
                                            <TableCell><b>Medicines</b></TableCell>
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
                                {tab === 0 && pendingAppts.map((appt) => (
                                    <TableRow key={appt.id} hover>
                                        <TableCell>
                                            <Typography fontWeight={600}>{appt.patient?.full_name || 'Patient'}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            {appt.chief_complaint
                                                ? (appt.chief_complaint.length > 60 ? appt.chief_complaint.slice(0, 60) + '...' : appt.chief_complaint)
                                                : '-'}
                                        </TableCell>
                                        <TableCell>{formatDate(appt.appointment_date)}</TableCell>
                                        <TableCell>{formatTime(appt.start_time)}</TableCell>
                                        <TableCell>
                                            <Chip label={appt.type === 'online' ? 'Online' : 'In-Clinic'} size="small"
                                                color={appt.type === 'online' ? 'info' : 'default'} variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Button variant="contained" size="small" startIcon={<MedicationIcon />}
                                                onClick={() => navigate(`${recordsPath}/prescriptions/new?appointmentId=${appt.id}`)}>
                                                Write Prescription
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 1: DRAFTS ── */}
                                {tab === 1 && draftRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}/edit`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Draft" color="default" size="small" icon={<DraftsIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Continue editing">
                                                <IconButton size="small" color="primary"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/edit`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Preview & Submit">
                                                <IconButton size="small" color="info"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/preview`); }}>
                                                    <PreviewIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 2: AWAITING APPROVAL ── */}
                                {tab === 2 && awaitingRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Awaiting Approval" color="info" size="small" icon={<HourglassTopIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View Preview">
                                                <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/preview`); }}>
                                                    <PreviewIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 3: APPROVED (Ready to Push) ── */}
                                {tab === 3 && approvedRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer', bgcolor: '#f1f8e9' }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Pending to Push" color="warning" size="small" icon={<SendIcon />} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View & Push to Patient">
                                                <IconButton size="small" color="success"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/preview`); }}>
                                                    <SendIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 4: COMPLETED (Pushed to Patient) ── */}
                                {tab === 4 && completedRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}/preview`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Completed" color="success" size="small" />
                                            {p.revision_number > 1 && (
                                                <Chip label={`v${p.revision_number}`} size="small" sx={{ ml: 0.5 }} color="info" variant="outlined" />
                                            )}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View Preview">
                                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/preview`); }}>
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Revise prescription">
                                                <IconButton size="small" color="primary"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/edit?revise=true`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 5: REJECTED ── */}
                                {tab === 5 && rejectedRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}/edit`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Rejected" color="error" size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Edit & Resubmit">
                                                <IconButton size="small" color="warning"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}/edit`); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── TAB 6: REVISED ── */}
                                {tab === 6 && revisedRx.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer', opacity: 0.8 }}
                                        onClick={() => navigate(`${recordsPath}/prescriptions/${p.id}`)}>
                                        <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                        <TableCell>{p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}</TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                        <TableCell>
                                            <Chip label="Revised" color="warning" size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={`v${p.revision_number || 1}`} size="small" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View old version">
                                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigate(`${recordsPath}/prescriptions/${p.id}`); }}>
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {/* ── Empty state ── */}
                                {((tab === 0 && !pendingAppts.length) ||
                                  (tab === 1 && !draftRx.length) ||
                                  (tab === 2 && !awaitingRx.length) ||
                                  (tab === 3 && !approvedRx.length) ||
                                  (tab === 4 && !completedRx.length) ||
                                  (tab === 5 && !rejectedRx.length) ||
                                  (tab === 6 && !revisedRx.length)) && (
                                    <TableRow>
                                        <TableCell colSpan={tab === 6 ? 7 : 6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            {tab === 0 ? 'No pending appointments. All appointments have prescriptions.'
                                                : tab === 1 ? 'No draft prescriptions.'
                                                : tab === 2 ? 'No prescriptions awaiting approval.'
                                                : tab === 3 ? 'No prescriptions pending push to patient.'
                                                : tab === 4 ? 'No completed prescriptions yet.'
                                                : tab === 5 ? 'No rejected prescriptions.'
                                                : 'No revised prescriptions.'}
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

export default MyPrescriptionsPage;
