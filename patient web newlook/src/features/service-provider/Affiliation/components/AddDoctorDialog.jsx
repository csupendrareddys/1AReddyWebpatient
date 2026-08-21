/**
 * AddDoctorDialog — two-tab dialog launched from ManageDoctors.
 *
 * Tab 1 "Enter code": hospital/clinic admin pastes the doctor's invite
 *   code + picks an employment type; backend creates a PENDING
 *   affiliation the doctor must approve before it goes live.
 *
 * Tab 2 "Invite new doctor": hospital/clinic admin enters minimal
 *   identity + qualifications + files. Backend creates the User +
 *   Doctor in a "pending activation" state and dispatches an email +
 *   SMS activation link to the doctor. The hospital admin does NOT
 *   set a password and does NOT coordinate OTPs — the doctor walks
 *   through the activation page on their own.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, IconButton, InputLabel,
    MenuItem, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import {
    useRequestDoctorByCodeMutation,
    useInviteFacilityDoctorMutation,
} from '../api/scopedAffiliationApi';

const EMPLOYMENT_OPTIONS = [
    { value: 'full_time', label: 'Full time' },
    { value: 'part_time', label: 'Part time' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'visiting', label: 'Visiting' },
];

const initialIdentity = {
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    state: '',
    registration_number: '',
    aadhar_number: '',
    employment_type: 'full_time',
};

export default function AddDoctorDialog({ open, onClose, onResult }) {
    const [tab, setTab] = useState(0);

    // ── Tab 1: enter-code state ──────────────────────────────────────
    const [code, setCode] = useState('');
    const [codeEmployment, setCodeEmployment] = useState('full_time');
    const [requestByCode, { isLoading: codeSubmitting }] = useRequestDoctorByCodeMutation();

    // ── Tab 2: invite-only state ─────────────────────────────────────
    const [identity, setIdentity] = useState(initialIdentity);
    const [regCert, setRegCert] = useState(null);
    const [aadharFile, setAadharFile] = useState(null);
    const [qualCert, setQualCert] = useState(null);
    const [inviteDoctor, { isLoading: inviting }] = useInviteFacilityDoctorMutation();
    const [localError, setLocalError] = useState('');
    const [activationLink, setActivationLink] = useState('');

    const errText = (e) =>
        e?.data?.error || e?.data?.message ||
        e?.response?.data?.error || e?.response?.data?.message ||
        e?.error || e?.message || 'Operation failed.';

    const reset = () => {
        setTab(0);
        setCode('');
        setCodeEmployment('full_time');
        setIdentity(initialIdentity);
        setRegCert(null); setAadharFile(null); setQualCert(null);
        setLocalError('');
        setActivationLink('');
    };

    const handleClose = () => { reset(); onClose?.(); };

    // ─── Tab 1 handler ───────────────────────────────────────────────
    const submitCode = async () => {
        if (!code.trim()) {
            setLocalError('Please enter the doctor\'s invite code.');
            return;
        }
        try {
            const res = await requestByCode({
                code: code.trim(), employment_type: codeEmployment,
            }).unwrap();
            onResult?.('success',
                res?.data?.status === 'pending'
                    ? 'Request sent to doctor for approval.'
                    : 'Affiliation request created.');
            handleClose();
        } catch (e) {
            setLocalError(errText(e));
        }
    };

    // ─── Tab 2 handler ──────────────────────────────────────────────
    const submitInvite = async () => {
        setLocalError('');
        const required = [
            'first_name', 'last_name', 'phone_number', 'email',
            'state', 'registration_number', 'aadhar_number',
        ];
        for (const k of required) {
            if (!identity[k]) {
                setLocalError(`Missing field: ${k.replace('_', ' ')}`);
                return;
            }
        }
        if (!regCert) { setLocalError('Upload registration certificate.'); return; }
        if (!aadharFile) { setLocalError('Upload Aadhaar document.'); return; }

        const fd = new FormData();
        Object.entries(identity).forEach(([k, v]) => fd.append(k, v));
        // Minimal qualification scaffold; doctor can complete details
        // post-activation.
        fd.append('qualifications', JSON.stringify([{
            qualification_level: 'ug',
            degree_name: 'MBBS',
            institution: identity.state || 'To be updated',
        }]));
        fd.append('registration_certificate', regCert);
        fd.append('aadhar_attachment', aadharFile);
        if (qualCert) fd.append('qualification_certificate_0', qualCert);

        try {
            const res = await inviteDoctor(fd).unwrap();
            const link = res?.data?.activation_link;
            if (link) {
                setActivationLink(link);
                onResult?.('success',
                    `Doctor invited. Activation link sent to ${res.data.invite_email_sent_to} and ${res.data.invite_sms_sent_to}.`);
            } else {
                onResult?.('success', 'Doctor invited.');
                handleClose();
            }
        } catch (e) {
            setLocalError(errText(e));
        }
    };

    const setField = (k) => (e) =>
        setIdentity((p) => ({ ...p, [k]: e.target.value }));

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Add doctor
                <IconButton onClick={handleClose} size="small">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <Tabs value={tab} onChange={(_, v) => { setTab(v); setLocalError(''); }} variant="fullWidth">
                <Tab label="Enter code" />
                <Tab label="Invite new doctor" />
            </Tabs>
            <DialogContent dividers>
                {localError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{localError}</Alert>
                )}

                {tab === 0 && (
                    <Box sx={{ pt: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Ask the doctor to generate their invite code under
                            <strong> Hospital affiliations</strong> in their profile,
                            then paste it here.
                        </Typography>
                        <Stack spacing={2}>
                            <TextField
                                label="Doctor's invite code"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                placeholder="e.g. UDUnII0czAk"
                                inputProps={{ style: { fontFamily: 'monospace', letterSpacing: 1 } }}
                                fullWidth
                            />
                            <FormControl fullWidth>
                                <InputLabel>Employment type</InputLabel>
                                <Select
                                    label="Employment type"
                                    value={codeEmployment}
                                    onChange={(e) => setCodeEmployment(e.target.value)}
                                >
                                    {EMPLOYMENT_OPTIONS.map((o) => (
                                        <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Alert severity="info">
                                Submitting will send a request to the doctor.
                                The doctor approves it from their profile;
                                the affiliation only becomes active once approved.
                            </Alert>
                        </Stack>
                    </Box>
                )}

                {tab === 1 && (
                    <Box sx={{ pt: 1 }}>
                        {activationLink ? (
                            <Stack spacing={2}>
                                <Alert severity="success">
                                    Invite sent. The doctor will receive an email + SMS
                                    with an activation link. They'll set their password
                                    and verify their phone + email before signing in.
                                </Alert>
                                <Typography variant="caption" color="text.secondary">
                                    Activation link (can be shared manually too):
                                </Typography>
                                <TextField
                                    fullWidth size="small"
                                    value={activationLink}
                                    InputProps={{ readOnly: true, style: { fontFamily: 'monospace' } }}
                                />
                                <Button onClick={handleClose} variant="contained">Done</Button>
                            </Stack>
                        ) : (
                            <>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    Fill in the doctor's identity and upload documents.
                                    The doctor will receive an email + SMS with an
                                    activation link; they'll set their own password and
                                    verify both contacts before they can sign in.
                                </Typography>

                                <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>Identity</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField label="First name" value={identity.first_name} onChange={setField('first_name')} fullWidth />
                                    <TextField label="Last name" value={identity.last_name} onChange={setField('last_name')} fullWidth />
                                </Stack>

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Contact (activation link will be sent here)</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField label="Phone (10 digits, no +91)" value={identity.phone_number} onChange={setField('phone_number')} fullWidth />
                                    <TextField label="Email" value={identity.email} onChange={setField('email')} fullWidth />
                                </Stack>

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Credentials</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField label="State" value={identity.state} onChange={setField('state')} fullWidth />
                                    <TextField label="MCI registration number" value={identity.registration_number} onChange={setField('registration_number')} fullWidth />
                                </Stack>
                                <TextField label="Aadhaar (12 digits, 2-9 start)" value={identity.aadhar_number} onChange={setField('aadhar_number')} fullWidth sx={{ mt: 2 }} />

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Documents</Typography>
                                <Stack spacing={1.5}>
                                    <Button variant="outlined" component="label">
                                        {regCert ? `Registration certificate: ${regCert.name}` : 'Upload registration certificate'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setRegCert(e.target.files?.[0])} />
                                    </Button>
                                    <Button variant="outlined" component="label">
                                        {aadharFile ? `Aadhaar: ${aadharFile.name}` : 'Upload Aadhaar document'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setAadharFile(e.target.files?.[0])} />
                                    </Button>
                                    <Button variant="outlined" component="label">
                                        {qualCert ? `Qualification certificate: ${qualCert.name}` : 'Upload qualification certificate (optional)'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setQualCert(e.target.files?.[0])} />
                                    </Button>
                                </Stack>

                                <Divider sx={{ my: 2 }} />
                                <FormControl fullWidth>
                                    <InputLabel>Employment type</InputLabel>
                                    <Select
                                        label="Employment type"
                                        value={identity.employment_type}
                                        onChange={setField('employment_type')}
                                    >
                                        {EMPLOYMENT_OPTIONS.map((o) => (
                                            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Cancel</Button>
                {tab === 0 ? (
                    <Button onClick={submitCode} variant="contained" disabled={codeSubmitting || !code.trim()}>
                        {codeSubmitting ? 'Sending…' : 'Send request to doctor'}
                    </Button>
                ) : !activationLink && (
                    <Button onClick={submitInvite} variant="contained" disabled={inviting}>
                        {inviting ? 'Inviting…' : 'Send invite'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
