/**
 * DoctorPanelPatientsPage — a doctor's empanelled patients.
 *
 * See empanelled patients, generate a reusable invite code patients can
 * redeem, request a patient (by name + phone), handle requests, and delink.
 * A doctor can have many empanelled patients.
 *
 * (Phase 1: link management. Viewing a patient's completed bookings +
 * prescriptions and the second-opinion chat/voice/video come in Phase 2/3.)
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
    DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText,
    Stack, TextField, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';

import {
    useGetEmpanelledPatientsQuery,
    useGetEmpanelledPatientBookingsQuery,
    useGenerateEmpanelCodeMutation,
    useRequestPatientMutation,
    useDelinkPatientMutation,
    useGetFamilyDoctorRequestsQuery,
    useAcceptFamilyDoctorRequestMutation,
    useRejectFamilyDoctorRequestMutation,
    useCancelFamilyDoctorRequestMutation,
    useStartSecondOpinionMutation,
} from '../api/familyDoctorEndpoints';
import { RequestsPanel } from './PatientFamilyDoctorPage';
import ConfirmDialog from '../components/ConfirmDialog';
import SecondOpinionBookingsTable from '../components/SecondOpinionBookingsTable';

/** Empanelled patient's completed bookings + prescriptions, with the
 *  second-opinion chat/voice/video actions (limited to 5 messages / 5-min
 *  calls). Details are only visible after a booking is completed. */
function PatientBookingsDialog({ patient, onClose, onNotify }) {
    const { data, isLoading, isError } = useGetEmpanelledPatientBookingsQuery(patient.patient_id);
    const bookings = data?.bookings || [];
    const [startSecondOpinion, { isLoading: starting }] = useStartSecondOpinionMutation();

    // Return the channel so the table opens it in an inline popup (no redirect).
    const secondOpinion = async (prescriptionId, mode) => {
        try {
            return await startSecondOpinion({ prescription_id: prescriptionId, mode }).unwrap();
        } catch (e) {
            onNotify(e?.data?.message || e?.data?.error || 'Could not start second opinion.', 'error');
            return null;
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1 }}>
                    {patient.patient_name || 'Patient'} — completed bookings
                    <Typography variant="body2" color="text.secondary">
                        Consultations &amp; services with prescriptions. Second opinion is
                        limited to 5 messages and 5-minute calls.
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <SecondOpinionBookingsTable
                    bookings={bookings}
                    isLoading={isLoading}
                    isError={isError}
                    starting={starting}
                    onSecondOpinion={secondOpinion}
                    emptyMessage="No completed bookings yet. Details appear only after a booking is completed."
                />
            </DialogContent>
        </Dialog>
    );
}

export default function DoctorPanelPatientsPage() {
    const { data: patients = [], isLoading } = useGetEmpanelledPatientsQuery();
    const { data: requests = { sent: [], received: [] } } = useGetFamilyDoctorRequestsQuery();

    const [genCode, { isLoading: generating }] = useGenerateEmpanelCodeMutation();
    const [requestPatient, { isLoading: requesting }] = useRequestPatientMutation();
    const [delink] = useDelinkPatientMutation();
    const [accept] = useAcceptFamilyDoctorRequestMutation();
    const [reject] = useRejectFamilyDoctorRequestMutation();
    const [cancel] = useCancelFamilyDoctorRequestMutation();

    const [snack, setSnack] = useState(null);
    const [code, setCode] = useState('');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [viewPatient, setViewPatient] = useState(null);
    const [confirm, setConfirm] = useState(null);

    const notify = (m, sev = 'success') => setSnack({ m, sev });
    const run = async (fn, ok) => {
        try { const r = await fn().unwrap(); notify(ok); return r; }
        catch (e) { notify(e?.data?.message || e?.data?.error || 'Something went wrong', 'error'); }
    };

    const onGenerate = async () => {
        const r = await run(() => genCode(), 'Invite code generated.');
        if (r?.code) setCode(r.code);
    };

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Typography variant="h4" gutterBottom>Panel Patients</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Your empanelled patients. Share an invite code, or request a patient
                directly.
            </Typography>

            {snack && <Alert severity={snack.sev} onClose={() => setSnack(null)} sx={{ mb: 2 }}>{snack.m}</Alert>}

            {/* Invite code + request-by-phone */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" gutterBottom>Invite code</Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField size="small" value={code} placeholder="Generate a code"
                                    InputProps={{ readOnly: true }} sx={{ width: 200 }} />
                                {code && (
                                    <Button size="small" startIcon={<ContentCopyIcon />}
                                        onClick={() => navigator.clipboard?.writeText(code)}>Copy</Button>
                                )}
                                <Button variant="contained" size="small" disabled={generating} onClick={onGenerate}>
                                    {code ? 'Regenerate' : 'Generate'}
                                </Button>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                                Patients redeem this on their Family Doctor page.
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" gutterBottom>Request a patient</Typography>
                            <Stack spacing={1} sx={{ maxWidth: 320 }}>
                                <TextField size="small" label="Patient's phone number" value={phone}
                                    onChange={(e) => setPhone(e.target.value)} />
                                <TextField size="small" label="Patient's name" value={name}
                                    onChange={(e) => setName(e.target.value)} />
                                <Button variant="contained" size="small" disabled={!phone.trim() || requesting}
                                    onClick={() => run(
                                        () => requestPatient({ target_phone: phone.trim(), target_name: name.trim() }),
                                        'Request sent to the patient.')}>
                                    Send request
                                </Button>
                            </Stack>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>

            {/* Empanelled patients */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        Empanelled patients ({patients.length})
                    </Typography>
                    {isLoading ? <CircularProgress size={22} />
                        : patients.length === 0 ? (
                            <Typography color="text.secondary">No empanelled patients yet.</Typography>
                        ) : (
                            <List dense>
                                {patients.map((p) => (
                                    <ListItem key={p.id} divider sx={{ pr: 32 }} secondaryAction={
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Chip size="small" color="success" label="ACTIVE" />
                                            <Button size="small" variant="outlined" startIcon={<VisibilityIcon />}
                                                onClick={() => setViewPatient(p)}>
                                                View
                                            </Button>
                                            <Button size="small" color="error" variant="outlined"
                                                startIcon={<PersonRemoveIcon />}
                                                onClick={() => setConfirm({
                                                    title: 'Delink patient?',
                                                    message: `Remove ${p.patient_name || 'this patient'} from your panel? You'll stop earning second-opinion credits on their bookings.`,
                                                    confirmLabel: 'Delink',
                                                    onConfirm: () => run(() => delink(p.patient_id), 'Patient delinked.'),
                                                })}>
                                                Delink
                                            </Button>
                                        </Stack>
                                    }>
                                        <ListItemText
                                            primary={p.patient_name || '—'}
                                            secondary={`Linked ${p.linked_at ? new Date(p.linked_at).toLocaleDateString() : ''} · via ${p.linked_via || '—'}`} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                </CardContent>
            </Card>

            <RequestsPanel
                requests={requests}
                onAccept={(id) => run(() => accept(id), 'Patient empanelled.')}
                onReject={(id) => run(() => reject(id), 'Request rejected.')}
                onCancel={(id) => run(() => cancel(id), 'Request cancelled.')}
                counterpartyLabel="patient_name"
            />

            {viewPatient && (
                <PatientBookingsDialog
                    patient={viewPatient}
                    onClose={() => setViewPatient(null)}
                    onNotify={notify}
                />
            )}

            <ConfirmDialog data={confirm} onClose={() => setConfirm(null)} />
        </Box>
    );
}
