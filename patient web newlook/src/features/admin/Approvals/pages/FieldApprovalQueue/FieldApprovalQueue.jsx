/**
 * FieldApprovalQueue — reviewer queue for field-level profile/education/bank
 * changes. Pending / Approved / Rejected / All filters; Profile module adds a
 * section sub-tab (the profile tabs). Approve / Reject / Query with a comment.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Tabs, Tab, Table, TableHead, TableBody, TableRow,
    TableCell, TableContainer, Chip, Button, Stack, MenuItem, TextField,
    CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
    Snackbar, Breadcrumbs, Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import useFieldApprovalQueue from '../../hooks/useFieldApprovalQueue';

const STATUS_TABS = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
];

const STATUS_COLOR = { pending: 'warning', approved: 'success', rejected: 'error', query: 'info' };

const fmtVal = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
};

const FieldApprovalQueue = () => {
    const navigate = useNavigate();
    const {
        meta, status, setStatus, section, setSection, requests, isLoading,
        approve, reject, queryChange, busy, refetch,
    } = useFieldApprovalQueue();

    const [dialog, setDialog] = useState(null); // { action, request }
    const [comment, setComment] = useState('');
    const [snack, setSnack] = useState(null);

    const openDialog = (action, request) => { setDialog({ action, request }); setComment(''); };

    const runAction = async () => {
        const { action, request } = dialog;
        const fn = action === 'approve' ? approve : action === 'reject' ? reject : queryChange;
        try {
            await fn({ requestId: request.id, comment }).unwrap();
            setSnack({ sev: 'success', msg: `Change ${action === 'query' ? 'queried' : action + 'd'}` });
            setDialog(null);
            refetch();
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.message || e?.data?.error || 'Action failed' });
        }
    };

    return (
        <Box>
            <Paper sx={{ mb: 2, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin/approvals')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Approvals
                    </Link>
                    <Typography color="primary" fontWeight="bold">{meta.title}</Typography>
                </Breadcrumbs>
            </Paper>

            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
                <Tabs value={status} onChange={(_, v) => setStatus(v)}>
                    {STATUS_TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
                </Tabs>
                {meta.sections && (
                    <TextField select size="small" label="Section" value={section}
                        onChange={(e) => setSection(e.target.value)} sx={{ minWidth: 200 }}>
                        <MenuItem value="all">All profile sections</MenuItem>
                        {meta.sections.map((s) => (
                            <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>
                        ))}
                    </TextField>
                )}
            </Stack>

            <TableContainer component={Paper} elevation={2}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            {['#', 'Submitter', 'Section', 'Field', 'Change', 'Submitted', 'Status', 'Actions'].map((h) => (
                                <TableCell key={h} sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>{h}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={8} align="center" sx={{ py: 6 }}><CircularProgress size={26} /></TableCell></TableRow>
                        ) : requests.length === 0 ? (
                            <TableRow><TableCell colSpan={8} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                                No {status === 'all' ? '' : status} field changes.
                            </TableCell></TableRow>
                        ) : (
                            requests.map((r, i) => (
                                <TableRow key={r.id}>
                                    <TableCell>{i + 1}</TableCell>
                                    <TableCell>{r.entity_name || r.entity_id}</TableCell>
                                    <TableCell>{(r.section || '').replace(/_/g, ' ')}</TableCell>
                                    <TableCell>{(r.field_name || '').replace(/_/g, ' ')}</TableCell>
                                    <TableCell sx={{ maxWidth: 320 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                                            {r.is_file_field ? '(file)' : fmtVal(r.old_value)} → <strong>{r.is_file_field ? '(new file)' : fmtVal(r.new_value)}</strong>
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</TableCell>
                                    <TableCell><Chip size="small" label={r.status} color={STATUS_COLOR[r.status] || 'default'} variant="outlined" /></TableCell>
                                    <TableCell>
                                        {r.status === 'pending' ? (
                                            <Stack direction="row" spacing={0.5}>
                                                <Button size="small" color="success" startIcon={<CheckIcon />} disabled={busy} onClick={() => openDialog('approve', r)}>Approve</Button>
                                                <Button size="small" color="error" startIcon={<CloseIcon />} disabled={busy} onClick={() => openDialog('reject', r)}>Reject</Button>
                                                <Button size="small" color="info" startIcon={<HelpOutlineIcon />} disabled={busy} onClick={() => openDialog('query', r)}>Query</Button>
                                            </Stack>
                                        ) : r.review_comment ? (
                                            <Typography variant="caption" color="text.secondary">{r.review_comment}</Typography>
                                        ) : '—'}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ textTransform: 'capitalize' }}>{dialog?.action} field change</DialogTitle>
                <DialogContent>
                    {dialog?.action === 'query' && (
                        <Alert severity="info" sx={{ mb: 2 }}>A comment is required to raise a query back to the submitter.</Alert>
                    )}
                    <TextField autoFocus fullWidth multiline rows={3} label="Comment"
                        value={comment} onChange={(e) => setComment(e.target.value)} sx={{ mt: 1 }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                    <Button variant="contained"
                        color={dialog?.action === 'reject' ? 'error' : dialog?.action === 'query' ? 'info' : 'success'}
                        disabled={busy || (dialog?.action === 'query' && !comment.trim())}
                        onClick={runAction}>
                        {dialog?.action}
                    </Button>
                </DialogActions>
            </Dialog>

            {snack && (
                <Snackbar open autoHideDuration={4000} onClose={() => setSnack(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                    <Alert severity={snack.sev} variant="filled">{snack.msg}</Alert>
                </Snackbar>
            )}
        </Box>
    );
};

export default FieldApprovalQueue;
