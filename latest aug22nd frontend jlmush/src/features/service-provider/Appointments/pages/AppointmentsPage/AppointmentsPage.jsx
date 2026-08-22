import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Tabs, Tab, List, ListItem,
    ListItemText, ListItemAvatar, Avatar, Chip, Button,
    CircularProgress, Alert, Divider, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, IconButton, Tooltip,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import EventIcon from '@mui/icons-material/Event';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import MedicationIcon from '@mui/icons-material/Medication';
import VideocamIcon from '@mui/icons-material/Videocam';
import PhoneIcon from '@mui/icons-material/Phone';
import ChatIcon from '@mui/icons-material/Chat';
import HomeIcon from '@mui/icons-material/Home';
import VerifiedIcon from '@mui/icons-material/Verified';
import { CONSULTATION_TYPE_MAP } from '../../../ProfileSetting/constants/consultationTypes';

const CONSULTATION_TYPE_CHIP_COLOR = {
    video: 'primary', audio: 'success', chat: 'warning',
    complete: 'secondary', home_visit: 'info', camp: 'error',
};

import CalendarViewMonthIcon from '@mui/icons-material/CalendarViewMonth';
import ListIcon from '@mui/icons-material/List';

import useAppointments from '../../hooks/useAppointments';
import PatientContextPanel from '../../components/PatientContextPanel';
import DoctorCalendarView from '../../components/DoctorCalendarView';
import { useVerifyAppointmentMutation } from '../../../api/scopedDoctorApi';
import { useDoctorScope } from '../../../ProfileSetting/context/DoctorScopeContext';

/**
 * Returns true if the current time is within the join window:
 * T-5 minutes to T+60 minutes (or T+end_time if available).
 */
const isJoinWindowOpen = (appt) => {
    const dateStr = appt.appointment_date; // 'YYYY-MM-DD'
    const timeStr = appt.start_time;       // 'HH:MM' or 'HH:MM:SS'
    const apptMs = new Date(`${dateStr}T${timeStr}`).getTime();
    const now = Date.now();
    const windowOpenMs = apptMs - 5 * 60 * 1000;
    const windowCloseMs = appt.end_time
        ? new Date(`${dateStr}T${appt.end_time}`).getTime()
        : apptMs + 60 * 60 * 1000;
    return now >= windowOpenMs && now <= windowCloseMs;
};

const AppointmentsPage = ({ embedded = false }) => {
    const navigate = useNavigate();
    const {
        // Data
        appointments, loading, error,
        actionLoading, actionError, actionSuccess,

        // Tabs
        tabValue, handleTabChange,
        
        // View Mode
        viewMode, setViewMode,

        // Reject dialog
        rejectDialogOpen, rejectReason,
        handleRejectClick, handleRejectConfirm, handleCloseRejectDialog, setRejectReason,

        // Accept
        handleAccept,

        // Consultation
        consultationOpen, consultationData,
        handleOpenConsultation, handleCloseConsultation,
        handleConsultationFieldChange,
        handleAddMedicine, handleMedicineChange, handleRemoveMedicine,
        handleSubmitConsultation,

        // Helpers
        formatDate, formatTime, handleClearErrors,
    } = useAppointments();

    const [verifyAppointment, { isLoading: verifying }] = useVerifyAppointmentMutation();

    // In Operations a super-admin is looking at someone else's appointments.
    // Everything on this page is something support can legitimately do for a
    // doctor — except the two below, which are the doctor personally showing
    // up: joining the consultation, and signing a prescription. Those stay the
    // doctor's own (the backend proxy doesn't allowlist them either).
    const { isOps } = useDoctorScope();

    const handleVerify = async (apptId) => {
        try {
            await verifyAppointment({ appointmentId: apptId }).unwrap();
        } catch (err) {
            // Error handled by RTK Query
        }
    };

    const isCalendar = viewMode === 'calendar';

    return (
        <Container maxWidth="md" sx={{ py: embedded ? 0 : 4 }} disableGutters={embedded}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4">{embedded ? 'Appointments' : 'My Appointments'}</Typography>

                <Paper variant="outlined" sx={{ display: 'flex', p: 0.5 }}>
                    <Tooltip title="List View">
                        <IconButton 
                            color={!isCalendar ? 'primary' : 'default'} 
                            onClick={() => setViewMode('list')}
                            size="small"
                            sx={{ borderRadius: 1 }}
                        >
                            <ListIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Calendar View">
                        <IconButton 
                            color={isCalendar ? 'primary' : 'default'} 
                            onClick={() => setViewMode('calendar')}
                            size="small"
                            sx={{ borderRadius: 1 }}
                        >
                            <CalendarViewMonthIcon />
                        </IconButton>
                    </Tooltip>
                </Paper>
            </Box>

            {/* Action Feedback */}
            {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={handleClearErrors}>{actionError}</Alert>}
            {actionSuccess && <Alert severity="success" sx={{ mb: 2 }} onClose={handleClearErrors}>{actionSuccess}</Alert>}

            {!isCalendar && (
                <Paper sx={{ mb: 3 }}>
                    <Tabs value={tabValue} onChange={handleTabChange} indicatorColor="primary" textColor="primary" variant="fullWidth">
                        <Tab label="Pending Requests" />
                        <Tab label="Upcoming" />
                        <Tab label="Completed" />
                        <Tab label="Cancelled" />
                    </Tabs>
                </Paper>
            )}

            {isCalendar ? (
                <DoctorCalendarView
                    /* Selecting a day's appointment opens the "Complete
                       Consultation" dialog, which authors a prescription — the
                       one thing on this page an admin must not do in the
                       doctor's name. In Operations the calendar is a read-only
                       month view instead. */
                    onSelectAppointment={isOps ? undefined : (id) => handleOpenConsultation(id)}
                />
            ) : (
                loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : appointments.length === 0 ? (
                    <Paper sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">No appointments found in this category.</Typography>
                    </Paper>
                ) : (
                    <List component={Paper}>
                    {appointments.map((appt, index) => (
                        <div key={appt.id}>
                            <ListItem alignItems="flex-start" secondaryAction={
                                tabValue === 0 ? (
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <Button variant="outlined" color="error" size="small"
                                            onClick={() => handleRejectClick(appt.id)} disabled={actionLoading}
                                            startIcon={<CancelIcon />}>Reject</Button>
                                        <Button variant="contained" color="success" size="small"
                                            onClick={() => handleAccept(appt.id)} disabled={actionLoading}
                                            startIcon={<CheckCircleIcon />}>Accept</Button>
                                    </Box>
                                ) : tabValue === 1 ? (
                                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        {/* Verified button — tracking only, no flow impact */}
                                        {appt.doctor_verified ? (
                                            <Chip
                                                icon={<VerifiedIcon />}
                                                label="Verified"
                                                size="small"
                                                color="success"
                                                variant="outlined"
                                            />
                                        ) : (
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                onClick={() => handleVerify(appt.id)}
                                                disabled={verifying}
                                                startIcon={<VerifiedIcon />}
                                                sx={{
                                                    borderColor: 'teal',
                                                    color: 'teal',
                                                    '&:hover': { borderColor: 'teal', bgcolor: 'rgba(0,128,128,0.04)' },
                                                }}
                                            >
                                                Verify
                                            </Button>
                                        )}
                                        {!isOps && (() => {
                                            const ct = appt.consultation_type || 'complete';
                                            const btnConfig = {
                                                video:      { icon: <VideocamIcon />, label: 'Join Video',  color: 'error' },
                                                audio:      { icon: <PhoneIcon />,    label: 'Join Call',   color: 'success' },
                                                chat:       { icon: <ChatIcon />,     label: 'Join Chat',   color: 'warning' },
                                                complete:   { icon: <EventIcon />,    label: 'Start Visit', color: 'primary' },
                                                home_visit: { icon: <HomeIcon />,     label: 'Home Visit',  color: 'info' },
                                                camp:       { icon: <EventIcon />,    label: 'Camp Visit',  color: 'secondary' },
                                            }[ct] || { icon: <VideocamIcon />, label: 'Join', color: 'primary' };

                                            const windowOpen = isJoinWindowOpen(appt);
                                            const tooltipText = windowOpen
                                                ? `Join ${ct} consultation`
                                                : 'Available 5 minutes before appointment';

                                            return (
                                                <Tooltip title={tooltipText}>
                                                    <span>
                                                        <Button
                                                            variant="contained"
                                                            color={btnConfig.color}
                                                            size="small"
                                                            disabled={!windowOpen}
                                                            onClick={() => navigate(`/meeting/${appt.id}`)}
                                                            startIcon={btnConfig.icon}
                                                        >
                                                            {btnConfig.label}
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            );
                                        })()}
                                        {!isOps && (
                                            <Button variant="contained" color="primary" size="small"
                                                onClick={() => navigate(`/dashboard/doctor/prescriptions/new?appointmentId=${appt.id}`)}
                                                startIcon={<MedicationIcon />}>Write Prescription</Button>
                                        )}
                                    </Box>
                                ) : null
                            }>
                                <ListItemAvatar>
                                    <Avatar sx={{ bgcolor: 'primary.main' }}><PersonIcon /></Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={<Typography variant="subtitle1" fontWeight="bold">{appt.patient?.full_name || 'Patient'}</Typography>}
                                    secondary={
                                        <Box component="span" sx={{ mt: 1, display: 'block' }}>
                                            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                                                <Chip icon={<EventIcon />} label={formatDate(appt.appointment_date)} size="small" variant="outlined" />
                                                <Chip icon={<AccessTimeIcon />} label={formatTime(appt.start_time)} size="small" variant="outlined" />
                                                <Chip label={appt.type === 'online' ? 'Online' : 'In-Clinic'} size="small" color={appt.type === 'online' ? 'info' : 'default'} />
                                                {appt.consultation_type && (
                                                    <Chip
                                                        label={CONSULTATION_TYPE_MAP[appt.consultation_type]?.shortLabel || appt.consultation_type}
                                                        size="small"
                                                        color={CONSULTATION_TYPE_CHIP_COLOR[appt.consultation_type] || 'default'}
                                                        variant="outlined"
                                                    />
                                                )}
                                            </Box>
                                            <Typography variant="body2" color="text.primary" component="span" display="block">
                                                <strong>Complaint:</strong> {appt.chief_complaint}
                                            </Typography>
                                        </Box>
                                    }
                                />
                            </ListItem>
                            {/* Patient medical context — visible on all tabs */}
                            <Box sx={{ px: 9, pb: 2 }}>
                                <PatientContextPanel appointmentId={appt.id} />
                            </Box>
                            {index < appointments.length - 1 && <Divider component="li" />}
                        </div>
                    ))}
                    </List>
                )
            )}

            {/* Reject Dialog */}
            <Dialog open={rejectDialogOpen} onClose={handleCloseRejectDialog}>
                <DialogTitle>Reject Appointment</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Please provide a reason for rejecting this appointment request.
                    </Typography>
                    <TextField autoFocus margin="dense" label="Reason for Rejection" fullWidth
                        multiline rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseRejectDialog}>Cancel</Button>
                    <Button onClick={handleRejectConfirm} color="error" variant="contained">Reject</Button>
                </DialogActions>
            </Dialog>

            {/* Consultation Dialog */}
            <Dialog open={consultationOpen} onClose={handleCloseConsultation} maxWidth="md" fullWidth>
                <DialogTitle>Complete Consultation</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="h6" gutterBottom>Diagnosis</Typography>
                    <TextField fullWidth label="Diagnosis" multiline rows={2}
                        value={consultationData.diagnosis}
                        onChange={(e) => handleConsultationFieldChange('diagnosis', e.target.value)}
                        sx={{ mb: 3 }} />

                    <Typography variant="h6" gutterBottom>Clinical Notes</Typography>
                    <TextField fullWidth label="Notes / Instructions" multiline rows={3}
                        value={consultationData.notes}
                        onChange={(e) => handleConsultationFieldChange('notes', e.target.value)}
                        sx={{ mb: 3 }} />

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">Prescription</Typography>
                        <Button startIcon={<AddCircleIcon />} onClick={handleAddMedicine} variant="outlined" size="small">Add Medicine</Button>
                    </Box>

                    {consultationData.medicines.map((med, index) => (
                        <Box key={index} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'start' }}>
                            <TextField label="Medicine Name" size="small" sx={{ flex: 2 }}
                                value={med.name} onChange={(e) => handleMedicineChange(index, 'name', e.target.value)} />
                            <TextField label="Dosage (e.g., 500mg)" size="small" sx={{ flex: 1 }}
                                value={med.dosage} onChange={(e) => handleMedicineChange(index, 'dosage', e.target.value)} />
                            <TextField label="Frequency (e.g., BID)" size="small" sx={{ flex: 1 }}
                                value={med.frequency} onChange={(e) => handleMedicineChange(index, 'frequency', e.target.value)} />
                            <TextField label="Duration" size="small" sx={{ flex: 1 }}
                                value={med.duration} onChange={(e) => handleMedicineChange(index, 'duration', e.target.value)} />
                            <IconButton onClick={() => handleRemoveMedicine(index)} color="error" size="small"><DeleteIcon /></IconButton>
                        </Box>
                    ))}
                    {consultationData.medicines.length === 0 && (
                        <Typography color="text.secondary" variant="body2" sx={{ fontStyle: 'italic' }}>No medicines added.</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseConsultation}>Cancel</Button>
                    <Button onClick={handleSubmitConsultation} color="primary" variant="contained" disabled={actionLoading}>
                        {actionLoading ? 'Saving...' : 'Complete & Prescribe'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default AppointmentsPage;
