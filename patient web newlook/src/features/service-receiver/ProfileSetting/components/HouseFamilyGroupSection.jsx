import React, { useState, useCallback } from 'react';
import {
    Box, Grid, TextField, Button, Typography, Paper, Chip, Tabs, Tab,
    Dialog, DialogTitle, DialogContent, DialogActions,
    Select, MenuItem, FormControl, InputLabel, IconButton,
    CircularProgress, Alert, Divider, Tooltip,
    FormControlLabel, Checkbox, Radio, RadioGroup, FormLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SecurityIcon from '@mui/icons-material/Security';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LinkIcon from '@mui/icons-material/Link';
import InputIcon from '@mui/icons-material/Input';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetHouseGroupQuery,
    useAddHouseGroupMemberMutation,
    useUpdateHouseGroupMemberMutation,
    useDeleteHouseGroupMemberMutation,
    useGetHouseGroupRequestsQuery,
    useSendHouseGroupRequestMutation,
    useAcceptHouseGroupRequestMutation,
    useRejectHouseGroupRequestMutation,
    useCancelHouseGroupRequestMutation,
    useGenerateInviteCodeMutation,
    useJoinByInviteCodeMutation,
    useUpdateMemberPermissionsMutation,
} from '../api/scopedPatientApi';

const RELATION_OPTIONS = [
    'Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister',
    'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Cousin',
    'Father-in-law', 'Mother-in-law', 'Friend', 'Guardian', 'Other',
];

const RELATION_HINTS = {
    'Father': 'Son or Daughter',
    'Mother': 'Son or Daughter',
    'Son': 'Father or Mother',
    'Daughter': 'Father or Mother',
    'Husband': 'Wife',
    'Wife': 'Husband',
    'Spouse': 'Spouse/Husband/Wife',
    'Brother': 'Brother or Sister',
    'Sister': 'Brother or Sister',
    'Grandfather': 'Grandson or Granddaughter',
    'Grandmother': 'Grandson or Granddaughter',
    'Uncle': 'Nephew or Niece',
    'Aunt': 'Nephew or Niece',
    'Guardian': 'Ward',
};

const getExpectedReceiverRelations = (relation) => RELATION_HINTS[relation] || 'a matching relation';

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const STATUS_COLORS = {
    PENDING: 'warning',
    ACCEPTED: 'success',
    REJECTED: 'error',
    EXPIRED: 'default',
    CANCELLED: 'default',
};

const EMPTY_MEMBER = { first_name: '', last_name: '', relation: '', gender: '', dob: '', blood_group: '', phone_number: '' };
const EMPTY_REQUEST = {
    target_phone: '',
    target_name: '',
    target_last_name: '',
    relation: '',
    group_type: 'family',
    permissions: { visible: true, appointments: false, prescriptions: false },
};

const HouseFamilyGroupSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const dataSources = cfg.dataSources || {};
    const relationOptions = dataSources?.relation_types || RELATION_OPTIONS;

    // Data queries
    const { data: houseGroupData, isLoading: membersLoading } = useGetHouseGroupQuery();
    const { data: requestsData, isLoading: requestsLoading } = useGetHouseGroupRequestsQuery();

    // Mutations
    const [addMember, { isLoading: isAddingMember }] = useAddHouseGroupMemberMutation();
    const [updateMember] = useUpdateHouseGroupMemberMutation();
    const [deleteMember] = useDeleteHouseGroupMemberMutation();
    const [sendRequest, { isLoading: isSending }] = useSendHouseGroupRequestMutation();
    const [acceptRequest] = useAcceptHouseGroupRequestMutation();
    const [rejectRequest] = useRejectHouseGroupRequestMutation();
    const [cancelRequest] = useCancelHouseGroupRequestMutation();
    const [generateInvite, { isLoading: isGenerating }] = useGenerateInviteCodeMutation();
    const [joinByCode, { isLoading: isJoining }] = useJoinByInviteCodeMutation();
    const [updatePermissions] = useUpdateMemberPermissionsMutation();

    // Local state
    const [requestError, setRequestError] = useState('');
    const [activeTab, setActiveTab] = useState(0);
    const [memberDialogOpen, setMemberDialogOpen] = useState(false);
    const [requestDialogOpen, setRequestDialogOpen] = useState(false);
    const [permDialogOpen, setPermDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [memberForm, setMemberForm] = useState({ ...EMPTY_MEMBER });
    const [requestForm, setRequestForm] = useState({ ...EMPTY_REQUEST });
    const [permMemberId, setPermMemberId] = useState(null);
    const [permValues, setPermValues] = useState({ visible: true, appointments: false, prescriptions: false });

    // Accept dialog state (for selecting relation before accepting)
    const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
    const [acceptingRequest, setAcceptingRequest] = useState(null); // { id, requester_name, relation }
    const [acceptReceiverRelation, setAcceptReceiverRelation] = useState('');

    // Invite code dialogs
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [inviteForm, setInviteForm] = useState({ relation: '', group_type: 'family', permissions: { visible: true, appointments: false, prescriptions: false } });
    const [generatedCode, setGeneratedCode] = useState('');
    const [joinDialogOpen, setJoinDialogOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [joinRelation, setJoinRelation] = useState('');
    const [joinError, setJoinError] = useState('');
    const [joinSuccess, setJoinSuccess] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);

    // `getHouseGroup` transforms the response to a flat members array, but older
    // callers passed the raw `{data:{members}}` wrapper — accept either so the
    // list never silently reads 0.
    const members = Array.isArray(houseGroupData)
        ? houseGroupData
        : (houseGroupData?.data?.members || houseGroupData?.members || []);
    const sentRequests = requestsData?.sent_requests || [];
    const receivedRequests = requestsData?.received_requests || [];

    // ── Member CRUD ─────────────────────────────────────────────
    const handleOpenAddMember = useCallback(() => {
        setEditingMember(null);
        setMemberForm({ ...EMPTY_MEMBER });
        setMemberDialogOpen(true);
    }, []);

    const handleOpenEditMember = useCallback((member) => {
        setEditingMember(member);
        setMemberForm({
            first_name: member.first_name || '',
            last_name: member.last_name || '',
            relation: member.relation || '',
            gender: member.gender || '',
            dob: member.dob || '',
            blood_group: member.blood_group || '',
            phone_number: member.phone_number || '',
        });
        setMemberDialogOpen(true);
    }, []);

    const handleMemberFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setMemberForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleMemberSubmit = useCallback(async () => {
        try {
            if (editingMember) {
                await updateMember({ memberId: editingMember.id, data: memberForm }).unwrap();
            } else {
                await addMember(memberForm).unwrap();
            }
            setMemberDialogOpen(false);
        } catch (err) {
            console.error('Member operation failed:', err);
        }
    }, [editingMember, memberForm, addMember, updateMember]);

    const handleDeleteMember = useCallback(async (memberId) => {
        if (!window.confirm('Remove this family member?')) return;
        try {
            await deleteMember(memberId).unwrap();
        } catch (err) {
            console.error('Failed to delete member:', err);
        }
    }, [deleteMember]);

    // ── Request system ──────────────────────────────────────────
    const handleOpenRequestDialog = useCallback(() => {
        setRequestForm({ ...EMPTY_REQUEST });
        setRequestError('');
        setRequestDialogOpen(true);
    }, []);

    const handleRequestFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setRequestForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handlePermCheckboxChange = useCallback((e) => {
        const { name, checked } = e.target;
        setRequestForm((prev) => ({
            ...prev,
            permissions: { ...prev.permissions, [name]: checked },
        }));
    }, []);

    const handleSendRequest = useCallback(async () => {
        setRequestError('');
        try {
            await sendRequest(requestForm).unwrap();
            setRequestDialogOpen(false);
        } catch (err) {
            const message =
                err?.data?.message ||
                err?.error?.message ||
                err?.message ||
                'Failed to send request. Please try again.';
            setRequestError(message);
        }
    }, [requestForm, sendRequest]);

    // ── Accept flow ─────────────────────────────────────────────
    const handleOpenAcceptDialog = useCallback((req) => {
        setAcceptingRequest(req);
        setAcceptReceiverRelation('');
        setAcceptDialogOpen(true);
    }, []);

    const handleConfirmAccept = async () => {
        if (!acceptReceiverRelation) return;
        try {
            await acceptRequest({ requestId: acceptingRequest.id, receiver_relation: acceptReceiverRelation }).unwrap();
            setAcceptDialogOpen(false);
            setAcceptingRequest(null);
        } catch (err) {
            console.error(err);
        }
    };

    const handleReject = useCallback(async (reqId) => {
        try { await rejectRequest(reqId).unwrap(); } catch (err) { console.error(err); }
    }, [rejectRequest]);

    const handleCancel = useCallback(async (reqId) => {
        try { await cancelRequest(reqId).unwrap(); } catch (err) { console.error(err); }
    }, [cancelRequest]);

    // ── Permissions ──────────────────────────────────────────────
    const handleOpenPermDialog = useCallback((member) => {
        setPermMemberId(member.id);
        setPermValues(member.permissions || { visible: true, appointments: false, prescriptions: false });
        setPermDialogOpen(true);
    }, []);

    const handlePermValueChange = useCallback((e) => {
        const { name, checked } = e.target;
        setPermValues((prev) => ({ ...prev, [name]: checked }));
    }, []);

    const handleSavePermissions = useCallback(async () => {
        try {
            await updatePermissions({ memberId: permMemberId, data: { permissions: permValues } }).unwrap();
            setPermDialogOpen(false);
        } catch (err) {
            console.error('Failed to update permissions:', err);
        }
    }, [permMemberId, permValues, updatePermissions]);

    // ── Invite Code Generation ───────────────────────────────────
    const handleOpenInviteDialog = useCallback(() => {
        setInviteForm({ relation: '', group_type: 'family', permissions: { visible: true, appointments: false, prescriptions: false } });
        setGeneratedCode('');
        setCodeCopied(false);
        setInviteDialogOpen(true);
    }, []);

    const handleInviteFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setInviteForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleInvitePermChange = useCallback((e) => {
        const { name, checked } = e.target;
        setInviteForm((prev) => ({
            ...prev,
            permissions: { ...prev.permissions, [name]: checked },
        }));
    }, []);

    const handleGenerateInvite = useCallback(async () => {
        try {
            const result = await generateInvite(inviteForm).unwrap();
            setGeneratedCode(result?.invite_code || result?.data?.invite_code || '');
        } catch (err) {
            console.error('Failed to generate invite:', err);
        }
    }, [inviteForm, generateInvite]);

    // ── Join by Code ────────────────────────────────────────────
    const handleOpenJoinDialog = useCallback(() => {
        setJoinCode('');
        setJoinRelation('');
        setJoinError('');
        setJoinSuccess(false);
        setJoinDialogOpen(true);
    }, []);

    const handleJoinByCode = async () => {
        if (!joinCode.trim() || !joinRelation) return;
        setJoinError('');
        setJoinSuccess(false);
        try {
            await joinByCode({ invite_code: joinCode.trim(), receiver_relation: joinRelation }).unwrap();
            setJoinSuccess(true);
        } catch (err) {
            setJoinError(err?.data?.message || 'Invalid or expired invite code');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
        }).catch(() => {});
    };

    if (!cfg.isSectionVisible('house_family_group')) return null;

    return (
        <Box>
            {/* Sub-tabs */}
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
                <Tab label={`Members (${members.length})`} />
                <Tab label={`Sent (${sentRequests.length})`} />
                <Tab label={`Received (${receivedRequests.length})`} />
            </Tabs>

            {/* ── Members Tab ─────────────────────────────────────── */}
            {activeTab === 0 && (
                <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddMember} size="small">
                                Add Member
                            </Button>
                            <Button variant="outlined" startIcon={<SendIcon />} onClick={handleOpenRequestDialog} size="small">
                                Send Request
                            </Button>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button variant="outlined" color="secondary" startIcon={<LinkIcon />} onClick={handleOpenInviteDialog} size="small">
                                Generate Invite Link
                            </Button>
                            <Button variant="outlined" color="info" startIcon={<InputIcon />} onClick={handleOpenJoinDialog} size="small">
                                Join by Code
                            </Button>
                        </Box>
                    </Box>

                    {membersLoading && <CircularProgress size={24} />}

                    {members.map((member, index) => (
                        <Paper key={member.id || index} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                            <Grid container spacing={1} alignItems="center">
                                <Grid item xs={12} sm={4}>
                                    <Typography variant="subtitle2">
                                        {member.first_name} {member.last_name}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {member.relation || 'Other'}
                                    </Typography>
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    {member.phone_number && (
                                        <Typography variant="body2" color="text.secondary">
                                            {member.phone_number}
                                        </Typography>
                                    )}
                                    {member.permissions && (
                                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                                            {member.permissions.visible && <Chip label="Visible" size="small" color="info" variant="outlined" />}
                                            {member.permissions.appointments && <Chip label="Appointments" size="small" color="success" variant="outlined" />}
                                            {member.permissions.prescriptions && <Chip label="Prescriptions" size="small" color="primary" variant="outlined" />}
                                        </Box>
                                    )}
                                </Grid>
                                <Grid item xs={12} sm={4} sx={{ textAlign: 'right' }}>
                                    <Tooltip title="Edit">
                                        <IconButton size="small" onClick={() => handleOpenEditMember(member)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Permissions">
                                        <IconButton size="small" onClick={() => handleOpenPermDialog(member)}>
                                            <SecurityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Remove">
                                        <IconButton size="small" color="error" onClick={() => handleDeleteMember(member.id)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}

                    {!membersLoading && members.length === 0 && (
                        <Alert severity="info">
                            No family members added yet. Add members directly or send a request to link accounts.
                        </Alert>
                    )}
                </Box>
            )}

            {/* ── Sent Requests Tab ───────────────────────────────── */}
            {activeTab === 1 && (
                <Box>
                    {requestsLoading && <CircularProgress size={24} />}

                    {sentRequests.map((req, index) => (
                        <Paper key={req.id || index} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                            <Grid container spacing={1} alignItems="center">
                                <Grid item xs={12} sm={4}>
                                    <Typography variant="subtitle2">
                                        {req.target_name
                                            ? `${req.target_name}${req.target_last_name ? ' ' + req.target_last_name : ''}`
                                            : req.target_phone || 'Unknown'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {req.relation} &middot; {req.group_type}
                                    </Typography>
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <Chip
                                        label={req.status}
                                        size="small"
                                        color={STATUS_COLORS[req.status] || 'default'}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    {req.invite_code && req.status === 'PENDING' && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                                {req.invite_code}
                                            </Typography>
                                            <Tooltip title="Copy invite code">
                                                <IconButton size="small" onClick={() => copyToClipboard(req.invite_code)}>
                                                    <ContentCopyIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    )}
                                </Grid>
                                <Grid item xs={12} sm={2} sx={{ textAlign: 'right' }}>
                                    {req.status === 'PENDING' && (
                                        <Button size="small" color="error" onClick={() => handleCancel(req.id)}>
                                            Cancel
                                        </Button>
                                    )}
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}

                    {!requestsLoading && sentRequests.length === 0 && (
                        <Alert severity="info">No sent requests.</Alert>
                    )}
                </Box>
            )}

            {/* ── Received Requests Tab ──────────────────────────── */}
            {activeTab === 2 && (
                <Box>
                    {requestsLoading && <CircularProgress size={24} />}

                    {receivedRequests.map((req, index) => (
                        <Paper key={req.id || index} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                            <Grid container spacing={1} alignItems="center">
                                <Grid item xs={12} sm={5}>
                                    <Typography variant="subtitle2">
                                        {req.requester_name || 'Someone'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        wants to add you as: {req.relation} ({req.group_type})
                                    </Typography>
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <Chip label={req.status} size="small" color={STATUS_COLORS[req.status] || 'default'} />
                                </Grid>
                                <Grid item xs={12} sm={4} sx={{ textAlign: 'right' }}>
                                    {req.status === 'PENDING' && (
                                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                            <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} onClick={() => handleOpenAcceptDialog(req)}>
                                                Accept
                                            </Button>
                                            <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => handleReject(req.id)}>
                                                Reject
                                            </Button>
                                        </Box>
                                    )}
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}

                    {!requestsLoading && receivedRequests.length === 0 && (
                        <Alert severity="info">No received requests.</Alert>
                    )}
                </Box>
            )}

            {/* Dynamic custom fields added by admin */}
            <Grid container spacing={2} sx={{ mt: 1 }}>
                <DynamicFieldRenderer
                    sectionKey="house_family_group"
                    cfg={cfg}
                    excludeKeys={[]}
                    formData={{}}
                    onFieldChange={() => {}}
                />
            </Grid>

            {/* ── Add/Edit Member Dialog ─────────────────────────── */}
            <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editingMember ? 'Edit Member' : 'Add Family Member'}</DialogTitle>
                <DialogContent dividers>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="First Name" name="first_name" value={memberForm.first_name} onChange={handleMemberFormChange} required />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Last Name" name="last_name" value={memberForm.last_name} onChange={handleMemberFormChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth required>
                                <InputLabel>Relation</InputLabel>
                                <Select name="relation" value={memberForm.relation} label="Relation" onChange={handleMemberFormChange}>
                                    {relationOptions.map((r) => { const n = norm(r); return <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>; })}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel>Gender</InputLabel>
                                <Select name="gender" value={memberForm.gender} label="Gender" onChange={handleMemberFormChange}>
                                    <MenuItem value="male">Male</MenuItem>
                                    <MenuItem value="female">Female</MenuItem>
                                    <MenuItem value="other">Other</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Date of Birth" name="dob" value={memberForm.dob} onChange={handleMemberFormChange} type="date" InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Phone Number" name="phone_number" value={memberForm.phone_number} onChange={handleMemberFormChange} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setMemberDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleMemberSubmit} disabled={isAddingMember || !memberForm.first_name || !memberForm.relation}>
                        {editingMember ? 'Update' : 'Add'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Send Request Dialog ────────────────────────────── */}
            <Dialog open={requestDialogOpen} onClose={() => setRequestDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PersonAddIcon /> Send Group Request
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    {requestError && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRequestError('')}>
                            {requestError}
                        </Alert>
                    )}
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12}>
                            <TextField fullWidth label="Phone Number *" name="target_phone" value={requestForm.target_phone} onChange={handleRequestFormChange} required placeholder="+91 XXXXX XXXXX" />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="First Name *" name="target_name" value={requestForm.target_name} onChange={handleRequestFormChange} required />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Last Name *" name="target_last_name" value={requestForm.target_last_name} onChange={handleRequestFormChange} required />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth required>
                                <InputLabel>Relation</InputLabel>
                                <Select name="relation" value={requestForm.relation} label="Relation" onChange={handleRequestFormChange}>
                                    {relationOptions.map((r) => { const n = norm(r); return <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>; })}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl>
                                <FormLabel>Group Type</FormLabel>
                                <RadioGroup row name="group_type" value={requestForm.group_type} onChange={handleRequestFormChange}>
                                    <FormControlLabel value="family" control={<Radio />} label="Family" />
                                    <FormControlLabel value="house" control={<Radio />} label="House" />
                                </RadioGroup>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                            <Divider sx={{ mb: 1 }} />
                            <Typography variant="subtitle2" gutterBottom>Permissions</Typography>
                            <FormControlLabel control={<Checkbox checked={requestForm.permissions.visible} onChange={handlePermCheckboxChange} name="visible" />} label="Profile visible to this member" />
                            <FormControlLabel control={<Checkbox checked={requestForm.permissions.appointments} onChange={handlePermCheckboxChange} name="appointments" />} label="Can view appointments" />
                            <FormControlLabel control={<Checkbox checked={requestForm.permissions.prescriptions} onChange={handlePermCheckboxChange} name="prescriptions" />} label="Can view prescriptions" />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRequestDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSendRequest}
                        disabled={isSending || !requestForm.target_phone || !requestForm.target_name || !requestForm.target_last_name || !requestForm.relation}
                        startIcon={<SendIcon />}
                    >
                        {isSending ? 'Sending...' : 'Send Request'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Permissions Dialog ──────────────────────────────── */}
            <Dialog open={permDialogOpen} onClose={() => setPermDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Edit Permissions</DialogTitle>
                <DialogContent dividers>
                    <FormControlLabel control={<Checkbox checked={permValues.visible} onChange={handlePermValueChange} name="visible" />} label="Profile visible" />
                    <FormControlLabel control={<Checkbox checked={permValues.appointments} onChange={handlePermValueChange} name="appointments" />} label="View appointments" />
                    <FormControlLabel control={<Checkbox checked={permValues.prescriptions} onChange={handlePermValueChange} name="prescriptions" />} label="View prescriptions" />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPermDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSavePermissions}>Save</Button>
                </DialogActions>
            </Dialog>

            {/* ── Generate Invite Code Dialog ───────────────────── */}
            <Dialog open={inviteDialogOpen} onClose={() => setInviteDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinkIcon /> Generate Invite Code
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    {!generatedCode ? (
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            <Grid item xs={12}>
                                <FormControl fullWidth required>
                                    <InputLabel>Relation</InputLabel>
                                    <Select name="relation" value={inviteForm.relation} label="Relation" onChange={handleInviteFormChange}>
                                        {relationOptions.map((r) => { const n = norm(r); return <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>; })}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12}>
                                <FormControl>
                                    <FormLabel>Group Type</FormLabel>
                                    <RadioGroup row name="group_type" value={inviteForm.group_type} onChange={handleInviteFormChange}>
                                        <FormControlLabel value="family" control={<Radio />} label="Family" />
                                        <FormControlLabel value="house" control={<Radio />} label="House" />
                                    </RadioGroup>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12}>
                                <Divider sx={{ mb: 1 }} />
                                <Typography variant="subtitle2" gutterBottom>Permissions</Typography>
                                <FormControlLabel control={<Checkbox checked={inviteForm.permissions.visible} onChange={handleInvitePermChange} name="visible" />} label="Profile visible to this member" />
                                <FormControlLabel control={<Checkbox checked={inviteForm.permissions.appointments} onChange={handleInvitePermChange} name="appointments" />} label="Can view appointments" />
                                <FormControlLabel control={<Checkbox checked={inviteForm.permissions.prescriptions} onChange={handleInvitePermChange} name="prescriptions" />} label="Can view prescriptions" />
                            </Grid>
                        </Grid>
                    ) : (
                        <Box sx={{ textAlign: 'center', py: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Share this code with the person you want to invite:
                            </Typography>
                            <Paper variant="outlined" sx={{ p: 2, mt: 2, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, backgroundColor: 'action.hover' }}>
                                <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 2 }}>
                                    {generatedCode}
                                </Typography>
                                <Tooltip title={codeCopied ? 'Copied!' : 'Copy code'}>
                                    <IconButton onClick={() => copyToClipboard(generatedCode)} color={codeCopied ? 'success' : 'default'}>
                                        {codeCopied ? <CheckIcon /> : <ContentCopyIcon />}
                                    </IconButton>
                                </Tooltip>
                            </Paper>
                            <Alert severity="info" sx={{ textAlign: 'left' }}>
                                The recipient can use this code in "Join by Code" to establish the relation.
                            </Alert>
                            {generatedCode && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    You selected relation: <strong>{inviteForm.relation}</strong>. The person joining must select a matching relation (e.g. {getExpectedReceiverRelations(inviteForm.relation)}).
                                </Typography>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInviteDialogOpen(false)}>
                        {generatedCode ? 'Done' : 'Cancel'}
                    </Button>
                    {!generatedCode && (
                        <Button variant="contained" onClick={handleGenerateInvite} disabled={isGenerating || !inviteForm.relation} startIcon={<LinkIcon />}>
                            {isGenerating ? 'Generating...' : 'Generate Code'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* ── Join by Code Dialog ───────────────────────────── */}
            <Dialog open={joinDialogOpen} onClose={() => setJoinDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <InputIcon /> Join by Invite Code
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Enter the invite code and select your relation to join the group.
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                label="Invite Code *"
                                value={joinCode}
                                onChange={(e) => { setJoinCode(e.target.value); setJoinError(''); setJoinSuccess(false); }}
                                placeholder="Paste invite code here"
                                inputProps={{ style: { fontFamily: 'monospace', letterSpacing: 1 } }}
                                disabled={joinSuccess}
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <FormControl fullWidth required>
                                <InputLabel>I am their... *</InputLabel>
                                <Select value={joinRelation} label="I am their... *" onChange={(e) => setJoinRelation(e.target.value)} disabled={joinSuccess}>
                                    {RELATION_OPTIONS.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                            <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                                The relation you select must match what the code sender expects (e.g. if they are the Father, you should select Son or Daughter).
                            </Alert>
                        </Grid>
                    </Grid>
                    {joinError && <Alert severity="error" sx={{ mt: 2 }}>{joinError}</Alert>}
                    {joinSuccess && <Alert severity="success" sx={{ mt: 2 }}>Successfully joined the group!</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setJoinDialogOpen(false)}>
                        {joinSuccess ? 'Done' : 'Cancel'}
                    </Button>
                    {!joinSuccess && (
                        <Button variant="contained" onClick={handleJoinByCode} disabled={isJoining || !joinCode.trim() || !joinRelation} startIcon={<PersonAddIcon />}>
                            {isJoining ? 'Joining...' : 'Join'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* ── Accept Request Dialog ─────────────────────────── */}
            <Dialog open={acceptDialogOpen} onClose={() => setAcceptDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Select Your Relation</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        <strong>{acceptingRequest?.requester_name || 'Someone'}</strong> wants to connect as their <strong>{acceptingRequest?.relation}</strong>.<br />
                        What is your relation to them?
                    </Typography>
                    <FormControl fullWidth required>
                        <InputLabel>I am their...</InputLabel>
                        <Select value={acceptReceiverRelation} label="I am their..." onChange={(e) => setAcceptReceiverRelation(e.target.value)}>
                            {RELATION_OPTIONS.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAcceptDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" color="success" onClick={handleConfirmAccept} disabled={!acceptReceiverRelation} startIcon={<CheckIcon />}>
                        Accept
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default React.memo(HouseFamilyGroupSection);
