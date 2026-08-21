import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Card, CardContent, Box, Typography, Chip, Button, Tooltip,
    Divider, Stack, Collapse, IconButton, Link, Alert,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import PhoneIcon from '@mui/icons-material/Phone';
import ChatIcon from '@mui/icons-material/Chat';
import HomeIcon from '@mui/icons-material/Home';
import FestivalIcon from '@mui/icons-material/Festival';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DescriptionIcon from '@mui/icons-material/Description';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PaymentsIcon from '@mui/icons-material/Payments';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useGetAppointmentPrescriptionsQuery } from '../../api/scopedBookingApi';
import OfferingFeatures from '../../components/OfferingFeatures/OfferingFeatures';
import EditHealthInfoDialog from './EditHealthInfoDialog';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';
import usePatientCheckout from '../../api/usePatientCheckout';

const statusMeta = {
    pending_payment: { label: 'Pending', color: 'warning' },
    pending: { label: 'Pending', color: 'warning' },
    confirmed: { label: 'Upcoming', color: 'info' },
    in_progress: { label: 'In Progress', color: 'primary' },
    completed: { label: 'Completed', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'error' },
    no_show: { label: 'No Show', color: 'default' },
    expired: { label: 'Expired', color: 'default' },
};

// "Booked by" accountability — shown only when someone OTHER than the patient
// initiated the booking (a caregiver, a linked family member, or an admin), so
// a normal self-booking stays uncluttered.
const bookedByMeta = {
    staff: { label: 'support staff', color: 'info' },
    linked: { label: 'family member', color: 'secondary' },
    admin: { label: 'admin', color: 'warning' },
    doctor: { label: 'doctor', color: 'default' },
    other: { label: 'someone else', color: 'default' },
};

// consultation_type → button/icon config for the Join action.
const joinConfig = {
    video: { icon: <VideoCallIcon />, label: 'Join Video', color: 'primary' },
    audio: { icon: <PhoneIcon />, label: 'Join Call', color: 'success' },
    chat: { icon: <ChatIcon />, label: 'Join Chat', color: 'warning' },
    home_visit: { icon: <HomeIcon />, label: 'Home Visit', color: 'info' },
    camp: { icon: <FestivalIcon />, label: 'Camp Visit', color: 'secondary' },
};

const typeIcon = (ct) => (joinConfig[ct]?.icon) || <VideoCallIcon />;

const formatDate = (d) => d
    ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : 'N/A';

const formatTime = (t) => {
    if (!t) return '—';
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m} ${ampm}`;
};

/**
 * Card for a single patient appointment. Layout: date / time / type pinned to
 * a left rail; doctor + status + actions (Join, Attach Document) on the right.
 */
const AppointmentCard = ({ appt, onAttachDocument }) => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const [docsOpen, setDocsOpen] = useState(false);

    const {
        id, appointment_date, start_time, end_time, appointment_type,
        consultation_type, status, doctor, chief_complaint, documents = [],
        doctor_id, medical_context, payment, expires_at,
    } = appt;
    const docId = doctor_id || doctor?.id;
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [editInfoOpen, setEditInfoOpen] = useState(false);
    const canEditInfo = !!(medical_context?.id && medical_context?.is_editable);

    const ct = consultation_type || 'video';
    const meta = statusMeta[status] || { label: status || '—', color: 'default' };
    const cfg = joinConfig[ct] || { icon: <VideoCallIcon />, label: 'Join', color: 'primary' };

    // Who initiated this booking — only surfaced when it wasn't the patient
    // themselves (owner), so a caregiver/family/admin booking is accountable.
    const bookedBy = (appt.booked_by && appt.booked_by.actor_type !== 'owner') ? appt.booked_by : null;
    const bookedByM = bookedBy ? (bookedByMeta[bookedBy.actor_type] || bookedByMeta.other) : null;

    // A completed appointment can have a prescription — surface a link to it.
    const isCompleted = status === 'completed';
    const { data: prescriptions = [] } = useGetAppointmentPrescriptionsQuery(id, {
        skip: !isCompleted || !id,
    });
    const prescription = prescriptions[0];
    const openPrescription = () => {
        if (prescription?.pdf_link) {
            window.open(prescription.pdf_link, '_blank', 'noopener');
        } else {
            navigate(`${basePath}/my-records?tab=prescriptions`);
        }
    };

    // An appointment can sit unpaid — a checkout the patient abandoned, or one
    // an admin booked for them from Operations and left for them to settle.
    // Without an action here that second case is a dead end: the booking shows
    // as Pending forever with nothing to click. Payment is the same checkout
    // the booking screen runs (offline settlement when an admin is driving).
    const isUnpaid = status === 'pending_payment';
    const fee = appt.consultation_fee ?? payment?.amount ?? null;

    // Live countdown for an unpaid reservation. The slot is held until
    // ``expires_at``; past that the reaper expires the booking AND releases the
    // slot, so the main account sees exactly how long is left to pay.
    const [nowTs, setNowTs] = useState(() => Date.now());
    const reservationActive = isUnpaid && !!expires_at;
    useEffect(() => {
        if (!reservationActive) return undefined;
        const iv = setInterval(() => setNowTs(Date.now()), 1000);
        return () => clearInterval(iv);
    }, [reservationActive]);
    const msLeft = expires_at ? new Date(expires_at).getTime() - nowTs : 0;
    const reservationExpired = reservationActive && msLeft <= 0;
    const countdownLabel = (() => {
        if (!reservationActive) return null;
        if (msLeft <= 0) return 'Reservation expired';
        const totalSec = Math.floor(msLeft / 1000);
        const mm = Math.floor(totalSec / 60);
        const ss = String(totalSec % 60).padStart(2, '0');
        return `${mm}:${ss} left to pay`;
    })();

    const [paying, setPaying] = useState(false);
    const [payError, setPayError] = useState(null);
    const { checkout } = usePatientCheckout();
    const payNow = async () => {
        setPaying(true);
        setPayError(null);
        try {
            await checkout({
                appointmentId: id,
                description: doctor?.full_name
                    ? `Consultation with Dr. ${doctor.full_name}` : 'Consultation',
            });
        } catch (e) {
            setPayError(e?.data?.error || e?.data?.message || e?.message || 'Payment failed.');
        } finally {
            setPaying(false);
        }
    };

    // Join is available for online consultations that are confirmed or live.
    const showJoin = appointment_type === 'online'
        && (status === 'confirmed' || status === 'in_progress');

    // Within T-5min .. end_time (or T+60min). Bypassed in dev.
    const isJoinWindowOpen = () => {
        if (!appointment_date || !start_time) return false;
        const apptMs = new Date(`${appointment_date}T${start_time}`).getTime();
        const now = Date.now();
        const openMs = apptMs - 5 * 60 * 1000;
        const closeMs = end_time
            ? new Date(`${appointment_date}T${end_time}`).getTime()
            : apptMs + 60 * 60 * 1000;
        return now >= openMs && now <= closeMs;
    };
    const joinEnabled = import.meta.env.DEV || isJoinWindowOpen();

    return (
        <Card variant="outlined" sx={{ mb: 2, '&:hover': { boxShadow: 3 } }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' } }}>
                    {/* ── LEFT RAIL: date / time / type ── */}
                    <Box
                        sx={{
                            flex: '0 0 auto',
                            width: { xs: '100%', sm: 200 },
                            bgcolor: 'grey.50',
                            borderRight: { sm: '1px solid' },
                            borderBottom: { xs: '1px solid', sm: 'none' },
                            borderColor: { xs: 'divider', sm: 'divider' },
                            p: 2,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <CalendarMonthIcon fontSize="small" color="primary" />
                            <Typography variant="body2" fontWeight={600}>
                                {formatDate(appointment_date)}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <AccessTimeIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                                {formatTime(start_time)}
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                            <Chip
                                icon={typeIcon(ct)}
                                label={(ct || '—').replace('_', ' ')}
                                size="small"
                                variant="outlined"
                                sx={{ textTransform: 'capitalize' }}
                            />
                            <Chip
                                icon={appointment_type === 'online' ? <VideoCallIcon /> : <LocalHospitalIcon />}
                                label={(appointment_type || '—').replace('_', ' ')}
                                size="small"
                                variant="outlined"
                                sx={{ textTransform: 'capitalize' }}
                            />
                        </Stack>
                    </Box>

                    {/* ── RIGHT: doctor + status + actions ── */}
                    <Box sx={{ flex: 1, p: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <PersonIcon color="action" />
                                <Box>
                                    <Typography
                                        fontWeight={600}
                                        onClick={docId ? () => navigate(`${basePath}/doctor/${docId}`) : undefined}
                                        sx={docId ? { cursor: 'pointer', '&:hover': { textDecoration: 'underline' } } : undefined}
                                    >
                                        {doctor?.full_name ? `Dr. ${doctor.full_name}` : 'Doctor'}
                                    </Typography>
                                    {doctor?.specialization && (
                                        <Typography variant="caption" color="text.secondary">
                                            {doctor.specialization}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                                {bookedBy && (
                                    <Tooltip title={`Booked on the patient's behalf by a ${bookedByM.label}`}>
                                        <Chip
                                            icon={<BadgeOutlinedIcon />}
                                            size="small"
                                            variant="outlined"
                                            color={bookedByM.color}
                                            label={`By ${bookedBy.name || bookedByM.label}`}
                                        />
                                    </Tooltip>
                                )}
                                {payment?.amount != null && (
                                    <Chip
                                        icon={<PaymentsIcon />}
                                        size="small"
                                        variant="outlined"
                                        color={payment.paid ? 'success' : 'default'}
                                        label={`₹${Number(payment.amount).toLocaleString('en-IN')}${payment.paid ? ' · Paid' : payment.status ? ` · ${payment.status}` : ''}`}
                                    />
                                )}
                                <Chip label={meta.label} color={meta.color} size="small" />
                            </Stack>
                        </Box>

                        {chief_complaint && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                {chief_complaint.length > 90 ? chief_complaint.slice(0, 90) + '…' : chief_complaint}
                            </Typography>
                        )}

                        <Divider sx={{ my: 1.5 }} />

                        {payError && (
                            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setPayError(null)}>
                                {payError}
                            </Alert>
                        )}

                        {/* Actions: Pay + Join + Attach Document */}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                            {isUnpaid && (
                                <Button
                                    variant="contained"
                                    color="warning"
                                    size="small"
                                    startIcon={<PaymentsIcon />}
                                    disabled={paying || reservationExpired}
                                    onClick={payNow}
                                >
                                    {paying ? 'Processing…' : `Pay ${fee != null ? `₹${fee}` : 'now'}`}
                                </Button>
                            )}

                            {reservationActive && (
                                <Tooltip title={reservationExpired
                                    ? 'The held slot has been released — please book again.'
                                    : 'This slot is reserved until the timer runs out, then released.'}>
                                    <Chip
                                        icon={<AccessTimeIcon />}
                                        size="small"
                                        variant="outlined"
                                        color={reservationExpired ? 'default' : (msLeft < 5 * 60 * 1000 ? 'error' : 'warning')}
                                        label={countdownLabel}
                                    />
                                </Tooltip>
                            )}

                            {showJoin && (
                                <Tooltip
                                    title={joinEnabled
                                        ? `Join ${ct} consultation`
                                        : 'Available 5 minutes before your appointment'}
                                >
                                    <span>
                                        <Button
                                            variant="contained"
                                            color={cfg.color}
                                            size="small"
                                            startIcon={cfg.icon}
                                            disabled={!joinEnabled}
                                            onClick={() => navigate(`/meeting/${id}`)}
                                        >
                                            {cfg.label}
                                        </Button>
                                    </span>
                                </Tooltip>
                            )}

                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<AttachFileIcon />}
                                onClick={() => onAttachDocument?.(id)}
                            >
                                Attach Document
                            </Button>

                            {canEditInfo && (
                                <Tooltip title="Revise the symptoms / health records you shared for this booking">
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        color="primary"
                                        startIcon={<EditNoteIcon />}
                                        onClick={() => setEditInfoOpen(true)}
                                    >
                                        Edit health info
                                    </Button>
                                </Tooltip>
                            )}

                            {isCompleted && (
                                <Tooltip title={prescription
                                    ? 'View the prescription from this appointment'
                                    : 'No prescription was issued for this appointment yet'}>
                                    <span>
                                        <Button
                                            variant={prescription ? 'contained' : 'outlined'}
                                            color="secondary"
                                            size="small"
                                            startIcon={<ReceiptLongIcon />}
                                            disabled={!prescription}
                                            onClick={openPrescription}
                                        >
                                            {prescription ? 'View Prescription' : 'Prescription pending'}
                                        </Button>
                                    </span>
                                </Tooltip>
                            )}

                            {docId && (
                                <Button
                                    variant="text"
                                    size="small"
                                    startIcon={<BadgeOutlinedIcon />}
                                    onClick={() => navigate(`${basePath}/doctor/${docId}`)}
                                >
                                    Doctor Profile
                                </Button>
                            )}

                            <Button
                                variant="text"
                                size="small"
                                startIcon={<InfoOutlinedIcon />}
                                onClick={() => setDetailsOpen((o) => !o)}
                                endIcon={detailsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            >
                                Details
                            </Button>

                            {documents.length > 0 && (
                                <Chip
                                    icon={<DescriptionIcon />}
                                    label={`${documents.length} Document${documents.length > 1 ? 's' : ''}`}
                                    size="small"
                                    onClick={() => setDocsOpen((o) => !o)}
                                    onDelete={() => setDocsOpen((o) => !o)}
                                    deleteIcon={docsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                />
                            )}
                        </Box>

                        {/* Expandable: the offering's linked benefits / how it works. */}
                        <Collapse in={detailsOpen}>
                            <Box sx={{ mt: 1.5 }}>
                                <OfferingFeatures
                                    offering={ct}
                                    doctorId={docId}
                                    variant="plain"
                                    title="Benefits & how it works"
                                />
                            </Box>
                        </Collapse>

                        {/* Attached documents list */}
                        {documents.length > 0 && (
                            <Collapse in={docsOpen}>
                                <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                                    {documents.map((doc) => (
                                        <Box
                                            key={doc.id}
                                            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                                        >
                                            <AttachFileIcon fontSize="small" color="action" />
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Link
                                                    href={doc.attachment_link}
                                                    target="_blank"
                                                    rel="noopener"
                                                    underline="hover"
                                                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                                                >
                                                    {doc.document_name}
                                                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                                                </Link>
                                                {doc.document_type && (
                                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                        {doc.document_type.replace('_', ' ')}
                                                    </Typography>
                                                )}
                                            </Box>
                                            <Typography variant="caption" color="text.secondary">
                                                {doc.uploaded_by === 'patient' ? 'You' : 'Doctor'}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Stack>
                            </Collapse>
                        )}
                    </Box>
                </Box>
            </CardContent>

            {canEditInfo && (
                <EditHealthInfoDialog
                    open={editInfoOpen}
                    onClose={() => setEditInfoOpen(false)}
                    contextId={medical_context.id}
                    consultationType={consultation_type}
                />
            )}
        </Card>
    );
};

export default AppointmentCard;
