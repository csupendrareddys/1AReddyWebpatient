import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Card,
    CardContent,
    Typography,
    Box,
    Chip,
    IconButton,
    Tooltip,
    Divider,
    Avatar,
    Button,
    Stack,
    Collapse,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import DescriptionIcon from '@mui/icons-material/Description';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import StarIcon from '@mui/icons-material/Star';
import ReceiptIcon from '@mui/icons-material/Receipt';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import PhoneIcon from '@mui/icons-material/Phone';
import ChatIcon from '@mui/icons-material/Chat';
import HomeIcon from '@mui/icons-material/Home';
import FestivalIcon from '@mui/icons-material/Festival';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import MedicationIcon from '@mui/icons-material/Medication';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PaymentIcon from '@mui/icons-material/Payment';

const statusColors = {
    pending: 'warning',
    confirmed: 'info',
    in_progress: 'primary',
    completed: 'success',
    cancelled: 'error',
    no_show: 'default',
};

const OrderCard = ({ order, onRate, onAddDocument, onViewDetails, onPay }) => {
    const {
        id,
        appointment_date,
        start_time,
        appointment_type,
        status,
        consultation_fee,
        meeting_link,
        doctor,
        hospital,
        rating,
        prescription,
        follow_up_appointment,
        documents = [],
        invoice,
    } = order;

    const navigate = useNavigate();
    const [prescriptionOpen, setPrescriptionOpen] = useState(false);

    /**
     * Returns true if the current time is within the join window:
     * T-5 minutes to T+end_time (or T+60 min if end_time not set).
     */
    const isJoinWindowOpen = () => {
        if (!appointment_date || !start_time) return false;
        const apptMs = new Date(`${appointment_date}T${start_time}`).getTime();
        const now = Date.now();
        const windowOpenMs = apptMs - 5 * 60 * 1000;
        const endTime = order.end_time;
        const windowCloseMs = endTime
            ? new Date(`${appointment_date}T${endTime}`).getTime()
            : apptMs + 60 * 60 * 1000;
        return now >= windowOpenMs && now <= windowCloseMs;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const formatTime = (timeStr) => {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    };

    const canRate = status === 'completed' && !rating;
    // Show Join Call for confirmed/in_progress online appointments (meeting_link may not be set yet on first join)
    const showJoinCall = appointment_type === 'online' && (status === 'confirmed' || status === 'in_progress');
    const hasPrescription = !!prescription;
    const hasInlinePrescription = hasPrescription && (prescription.diagnosis || prescription.notes || (prescription.medicines?.length > 0));
    // Show Pay Now for confirmed/in_progress appointments without a successful payment
    const showPayNow = (status === 'confirmed' || status === 'in_progress') && (!invoice || invoice.status !== 'success');

    return (
        <Card
            sx={{
                mb: 2,
                transition: 'all 0.2s ease',
                '&:hover': {
                    boxShadow: 4,
                },
            }}
        >
            <CardContent>
                {/* Header - Date, Time, Status */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <CalendarMonthIcon color="primary" sx={{ mr: 0.5 }} />
                            <Typography variant="body1" fontWeight="medium">
                                {formatDate(appointment_date)}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <AccessTimeIcon color="action" sx={{ mr: 0.5 }} />
                            <Typography variant="body2" color="text.secondary">
                                {formatTime(start_time)}
                            </Typography>
                        </Box>
                    </Box>
                    <Chip
                        label={status?.replace('_', ' ').toUpperCase()}
                        color={statusColors[status] || 'default'}
                        size="small"
                    />
                </Box>

                {/* Doctor Info */}
                {doctor && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                            {doctor.profile_image ? (
                                <img src={doctor.profile_image} alt={doctor.full_name} style={{ width: '100%' }} />
                            ) : (
                                <PersonIcon />
                            )}
                        </Avatar>
                        <Box>
                            <Typography variant="subtitle1" fontWeight="medium">
                                Dr. {doctor.full_name}
                            </Typography>
                            {doctor.highest_qualification && (
                                <Typography variant="body2" color="text.secondary">
                                    {doctor.highest_qualification}
                                </Typography>
                            )}
                            {doctor.languages_known?.length > 0 && (
                                <Typography variant="body2" color="text.secondary">
                                    Speaks: {doctor.languages_known.join(', ')}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                )}

                {/* Appointment Type & Location */}
                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                    <Chip
                        icon={appointment_type === 'online' ? <VideoCallIcon /> : <LocalHospitalIcon />}
                        label={appointment_type?.replace('_', ' ').toUpperCase()}
                        size="small"
                        variant="outlined"
                    />
                    {hospital && (
                        <Chip
                            icon={<LocationOnIcon />}
                            label={`${hospital.name}, ${hospital.city}`}
                            size="small"
                            variant="outlined"
                        />
                    )}
                </Stack>

                <Divider sx={{ my: 2 }} />

                {/* Actions Row */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                    {/* Join Consultation — shown for confirmed/in-progress online appointments */}
                    {showJoinCall && (() => {
                        const ct = order.consultation_type || 'video';
                        const btnConfig = {
                            video:      { icon: <VideoCallIcon />, label: 'Join Video', color: 'primary' },
                            audio:      { icon: <PhoneIcon />,     label: 'Join Call',  color: 'success' },
                            chat:       { icon: <ChatIcon />,      label: 'Join Chat',  color: 'warning' },
                            home_visit: { icon: <HomeIcon />,      label: 'Home Visit', color: 'info' },
                            camp:       { icon: <FestivalIcon />,  label: 'Camp Visit', color: 'secondary' },
                        }[ct] || { icon: <VideoCallIcon />, label: 'Join Call', color: 'primary' };

                        const tooltipText = isJoinWindowOpen()
                            ? `Join ${ct} consultation`
                            : (import.meta.env.DEV ? `Join ${ct} consultation (dev bypass)` : 'Available 5 minutes before appointment');

                        return (
                            <Tooltip title={tooltipText}>
                                <span>
                                    <Button
                                        variant="contained"
                                        color={btnConfig.color}
                                        size="small"
                                        startIcon={btnConfig.icon}
                                        disabled={!import.meta.env.DEV && !isJoinWindowOpen()}
                                        onClick={() => navigate(`/meeting/${id}`)}
                                    >
                                        {btnConfig.label}
                                    </Button>
                                </span>
                            </Tooltip>
                        );
                    })()}

                    {/* Pay Now */}
                    {showPayNow && onPay && (
                        <Button
                            variant="contained"
                            color="success"
                            size="small"
                            startIcon={<PaymentIcon />}
                            onClick={() => onPay?.(id, consultation_fee)}
                        >
                            Pay Now
                        </Button>
                    )}

                    {/* Invoice */}
                    {invoice && (
                        <Tooltip title={`Payment: ${invoice.status} - ₹${invoice.amount}`}>
                            <Chip
                                icon={<ReceiptIcon />}
                                label={`₹${invoice.amount}`}
                                size="small"
                                color={invoice.status === 'success' ? 'success' : 'warning'}
                            />
                        </Tooltip>
                    )}

                    {/* Prescription PDF link (if generated) */}
                    {prescription?.pdf_link && (
                        <Tooltip title="View Prescription PDF">
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<DescriptionIcon />}
                                href={prescription.pdf_link}
                                target="_blank"
                            >
                                Prescription PDF
                            </Button>
                        </Tooltip>
                    )}

                    {/* View Prescription inline — always shown for completed with a prescription */}
                    {hasInlinePrescription && (
                        <Button
                            variant="outlined"
                            size="small"
                            color="secondary"
                            startIcon={<MedicationIcon />}
                            endIcon={prescriptionOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            onClick={() => setPrescriptionOpen(!prescriptionOpen)}
                        >
                            {prescriptionOpen ? 'Hide' : 'View'} Diagnosis
                        </Button>
                    )}

                    {/* Documents */}
                    {documents.length > 0 && (
                        <Chip
                            icon={<AttachFileIcon />}
                            label={`${documents.length} Documents`}
                            size="small"
                            onClick={() => onViewDetails?.(id)}
                        />
                    )}

                    {/* Follow-up */}
                    {follow_up_appointment && (
                        <Chip
                            icon={<EventRepeatIcon />}
                            label={`Follow-up: ${formatDate(follow_up_appointment.appointment_date)}`}
                            size="small"
                            color="info"
                        />
                    )}

                    {/* Rating */}
                    {rating ? (
                        <Chip
                            icon={<StarIcon />}
                            label={`Rated ${rating.rating}/5`}
                            size="small"
                            color="success"
                        />
                    ) : canRate && (
                        <Button
                            variant="outlined"
                            size="small"
                            color="warning"
                            startIcon={<StarIcon />}
                            onClick={() => onRate?.(id)}
                        >
                            Rate
                        </Button>
                    )}

                    {/* Add Document */}
                    <Button
                        variant="text"
                        size="small"
                        startIcon={<AttachFileIcon />}
                        onClick={() => onAddDocument?.(id)}
                    >
                        Add Doc
                    </Button>
                </Box>

                {/* Prescription Details — expandable */}
                {hasInlinePrescription && (
                    <Collapse in={prescriptionOpen}>
                        <Paper variant="outlined" sx={{ mt: 2, p: 2, bgcolor: 'grey.50' }}>
                            {prescription.diagnosis && (
                                <Box sx={{ mb: 2 }}>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        Diagnosis
                                    </Typography>
                                    <Typography variant="body1">
                                        {prescription.diagnosis}
                                    </Typography>
                                </Box>
                            )}

                            {prescription.notes && (
                                <Box sx={{ mb: 2 }}>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        Clinical Notes
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {prescription.notes}
                                    </Typography>
                                </Box>
                            )}

                            {prescription.medicines?.length > 0 && (
                                <Box>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        Medicines
                                    </Typography>
                                    <TableContainer>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell><strong>Medicine</strong></TableCell>
                                                <TableCell><strong>Dosage</strong></TableCell>
                                                <TableCell><strong>Frequency</strong></TableCell>
                                                <TableCell><strong>Duration</strong></TableCell>
                                                <TableCell><strong>Timing</strong></TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {prescription.medicines.map((med, idx) => (
                                                <TableRow key={idx}>
                                                    <TableCell>{med.name || '—'}</TableCell>
                                                    <TableCell>{med.dosage || '—'}</TableCell>
                                                    <TableCell>{med.frequency || '—'}</TableCell>
                                                    <TableCell>{med.duration || '—'}</TableCell>
                                                    <TableCell>{med.timing || '—'}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                    </TableContainer>
                                    {prescription.medicines.some(m => m.instructions) && (
                                        <Box sx={{ mt: 1 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                Instructions: {prescription.medicines.filter(m => m.instructions).map(m => `${m.name}: ${m.instructions}`).join(' | ')}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                            )}

                            {prescription.issue_date && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    Issued on: {formatDate(prescription.issue_date)}
                                </Typography>
                            )}
                        </Paper>
                    </Collapse>
                )}

                {/* Consultation Fee */}
                {consultation_fee && (
                    <Box sx={{ mt: 2, textAlign: 'right' }}>
                        <Typography variant="body2" color="text.secondary">
                            Consultation Fee: <strong>₹{consultation_fee}</strong>
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default OrderCard;
