/**
 * PatientFamilyDoctorPage — a patient's single family doctor.
 *
 * Add a family doctor by one of three means (directory search, name + phone,
 * or an invite code), see the current link, handle requests (accept ones a
 * doctor sent you, cancel ones you sent), and delink. A patient has at most
 * one family doctor.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
    InputAdornment, List, ListItem, ListItemText, Paper, Stack, Tab, Tabs,
    TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import ConfirmDialog from '../components/ConfirmDialog';
import SecondOpinionBookingsTable from '../components/SecondOpinionBookingsTable';

import {
    useGetMyFamilyDoctorQuery,
    useLazySearchFamilyDoctorsQuery,
    useRequestFamilyDoctorMutation,
    useJoinFamilyDoctorByCodeMutation,
    useDelinkMyFamilyDoctorMutation,
    useGetMySecondOpinionBookingsQuery,
    useStartMySecondOpinionMutation,
    useGetFamilyDoctorRequestsQuery,
    useAcceptFamilyDoctorRequestMutation,
    useRejectFamilyDoctorRequestMutation,
    useCancelFamilyDoctorRequestMutation,
} from '../api/familyDoctorEndpoints';

function useSnack() {
    const [msg, setMsg] = useState(null);
    return [msg, (m, sev = 'success') => setMsg({ m, sev }), () => setMsg(null)];
}

export default function PatientFamilyDoctorPage() {
    const { data: familyDoctor, isLoading } = useGetMyFamilyDoctorQuery();
    const { data: requests = { sent: [], received: [] } } = useGetFamilyDoctorRequestsQuery();
    const [snack, setSnack, clearSnack] = useSnack();

    const [triggerSearch, { data: searchResults = [], isFetching: searching }] = useLazySearchFamilyDoctorsQuery();
    const [sendRequest, { isLoading: sending }] = useRequestFamilyDoctorMutation();
    const [joinByCode, { isLoading: joining }] = useJoinFamilyDoctorByCodeMutation();
    const [delink, { isLoading: delinking }] = useDelinkMyFamilyDoctorMutation();
    const [accept] = useAcceptFamilyDoctorRequestMutation();
    const [reject] = useRejectFamilyDoctorRequestMutation();
    const [cancel] = useCancelFamilyDoctorRequestMutation();

    const [tab, setTab] = useState(0);
    const [confirm, setConfirm] = useState(null);
    const [q, setQ] = useState('');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [code, setCode] = useState('');

    const run = async (fn, ok) => {
        try { await fn().unwrap(); setSnack(ok); }
        catch (e) { setSnack(e?.data?.message || e?.data?.error || 'Something went wrong', 'error'); }
    };

    const hasFamilyDoctor = !!familyDoctor;

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Typography variant="h4" gutterBottom>Family Doctor</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Assign a single dedicated family doctor for your household.
            </Typography>

            {snack && (
                <Alert severity={snack.sev} onClose={clearSnack} sx={{ mb: 2 }}>{snack.m}</Alert>
            )}

            {/* Current family doctor */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        Your family doctor
                    </Typography>
                    {isLoading ? <CircularProgress size={22} />
                        : hasFamilyDoctor ? (
                            <>
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <Chip color="success" label="LINKED" />
                                    <Typography sx={{ flexGrow: 1 }}>{familyDoctor.doctor_name}</Typography>
                                    <Button
                                        color="error" variant="outlined" size="small"
                                        startIcon={<PersonRemoveIcon />}
                                        disabled={delinking}
                                        onClick={() => setConfirm({
                                            title: 'Remove family doctor?',
                                            message: `Remove ${familyDoctor.doctor_name || 'your family doctor'}? You can add one again anytime.`,
                                            confirmLabel: 'Remove',
                                            onConfirm: () => run(() => delink(), 'Family doctor removed.'),
                                        })}
                                    >
                                        Delink
                                    </Button>
                                </Stack>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                                    This doctor is also the second-opinion doctor for your children —
                                    they earn second-opinion credits on your children&apos;s completed
                                    bookings too.
                                </Typography>
                            </>
                        ) : (
                            <Typography color="text.secondary">
                                You don't have a family doctor yet. Add one below.
                            </Typography>
                        )}
                </CardContent>
            </Card>

            {/* Second opinion — the patient's own completed bookings + final
                prescriptions, with chat/voice/video access to their family
                doctor. Only shown once a family doctor is linked. */}
            {hasFamilyDoctor && (
                <SecondOpinionSection
                    doctorName={familyDoctor.doctor_name}
                    onNotify={setSnack}
                />
            )}

            {/* Add a family doctor — 3 methods */}
            {!hasFamilyDoctor && (
                <Card sx={{ mb: 3 }}>
                    <CardContent>
                        <Typography variant="subtitle1" fontWeight={600}>Add a family doctor</Typography>
                        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
                            <Tab label="Search directory" />
                            <Tab label="By name + phone" />
                            <Tab label="By code" />
                        </Tabs>

                        {tab === 0 && (
                            <Box>
                                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                                    <TextField
                                        size="small" fullWidth placeholder="Doctor name (as in the portal)"
                                        value={q} onChange={(e) => setQ(e.target.value)}
                                        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                                    />
                                    <Button variant="contained" disabled={q.trim().length < 2 || searching}
                                        onClick={() => triggerSearch(q.trim())}>Search</Button>
                                </Stack>
                                {searching && <CircularProgress size={20} />}
                                <List dense>
                                    {searchResults.map((d) => (
                                        <ListItem key={d.doctor_id} divider
                                            secondaryAction={
                                                <Button size="small" variant="contained" disabled={sending}
                                                    onClick={() => run(() => sendRequest({ doctor_id: d.doctor_id }), 'Request sent to the doctor.')}>
                                                    Request
                                                </Button>
                                            }>
                                            <ListItemText primary={d.name}
                                                secondary={d.registration_number ? `Reg. ${d.registration_number}` : null} />
                                        </ListItem>
                                    ))}
                                    {!searching && searchResults.length === 0 && q && (
                                        <Typography variant="body2" color="text.secondary">No doctors found.</Typography>
                                    )}
                                </List>
                            </Box>
                        )}

                        {tab === 1 && (
                            <Stack spacing={2} sx={{ maxWidth: 420 }}>
                                <TextField size="small" label="Doctor's phone number" value={phone}
                                    onChange={(e) => setPhone(e.target.value)} />
                                <TextField size="small" label="Doctor's name (as in the portal)" value={name}
                                    onChange={(e) => setName(e.target.value)} />
                                <Button variant="contained" disabled={!phone.trim() || sending}
                                    onClick={() => run(
                                        () => sendRequest({ target_phone: phone.trim(), target_name: name.trim() }),
                                        'Request sent to the doctor.')}>
                                    Send request
                                </Button>
                            </Stack>
                        )}

                        {tab === 2 && (
                            <Stack direction="row" spacing={1} sx={{ maxWidth: 420 }}>
                                <TextField size="small" fullWidth label="Invite code" value={code}
                                    onChange={(e) => setCode(e.target.value)} />
                                <Button variant="contained" disabled={!code.trim() || joining}
                                    onClick={() => run(() => joinByCode(code.trim()), 'Family doctor linked.')}>
                                    Link
                                </Button>
                            </Stack>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Requests */}
            <RequestsPanel
                requests={requests}
                onAccept={(id) => run(() => accept(id), 'Family doctor linked.')}
                onReject={(id) => run(() => reject(id), 'Request rejected.')}
                onCancel={(id) => run(() => cancel(id), 'Request cancelled.')}
                counterpartyLabel="doctor_name"
            />

            <ConfirmDialog data={confirm} onClose={() => setConfirm(null)} />
        </Box>
    );
}


/** The patient's second-opinion table: their completed consultations +
 *  services with final prescriptions, plus chat / voice / video with their
 *  family doctor (max 5 messages, 5-minute calls). */
function SecondOpinionSection({ doctorName, onNotify }) {
    const { data, isLoading, isError } = useGetMySecondOpinionBookingsQuery();
    const bookings = data?.bookings || [];
    const [startSecondOpinion, { isLoading: starting }] = useStartMySecondOpinionMutation();

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
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Typography variant="subtitle1" fontWeight={600}>Second opinion</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Your completed consultations &amp; services with final prescriptions.
                    Ask {doctorName || 'your family doctor'} for a second opinion — chat
                    (up to 5 messages) or a call (up to 5 minutes).
                </Typography>
                <SecondOpinionBookingsTable
                    bookings={bookings}
                    isLoading={isLoading}
                    isError={isError}
                    starting={starting}
                    onSecondOpinion={secondOpinion}
                    emptyMessage="No completed bookings yet. Your consultations & services appear here once completed."
                />
            </CardContent>
        </Card>
    );
}


export function RequestsPanel({ requests, onAccept, onReject, onCancel, counterpartyLabel }) {
    const { sent = [], received = [] } = requests || {};
    if (!sent.length && !received.length) return null;
    return (
        <Card>
            <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>Requests</Typography>
                {received.length > 0 && (
                    <>
                        <Typography variant="caption" color="text.secondary">Awaiting your response</Typography>
                        <List dense>
                            {received.map((r) => (
                                <ListItem key={r.id} divider secondaryAction={
                                    <Stack direction="row" spacing={1}>
                                        <Button size="small" color="success" variant="contained" onClick={() => onAccept(r.id)}>Accept</Button>
                                        <Button size="small" color="error" variant="outlined" onClick={() => onReject(r.id)}>Reject</Button>
                                    </Stack>
                                }>
                                    <ListItemText
                                        primary={r[counterpartyLabel] || r.patient_name || r.target_name || '—'}
                                        secondary={`Requested by ${r.initiated_by}`} />
                                </ListItem>
                            ))}
                        </List>
                        <Divider sx={{ my: 1 }} />
                    </>
                )}
                {sent.length > 0 && (
                    <>
                        <Typography variant="caption" color="text.secondary">Sent by you (pending)</Typography>
                        <List dense>
                            {sent.map((r) => (
                                <ListItem key={r.id} divider secondaryAction={
                                    <Button size="small" variant="outlined" onClick={() => onCancel(r.id)}>Cancel</Button>
                                }>
                                    <ListItemText
                                        primary={r[counterpartyLabel] || r.patient_name || r.target_name || r.target_phone || '—'}
                                        secondary="Pending" />
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
