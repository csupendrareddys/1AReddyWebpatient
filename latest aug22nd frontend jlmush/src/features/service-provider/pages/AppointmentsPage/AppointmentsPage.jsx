import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box,
    Container,
    Typography,
    Paper,
    Tabs,
    Tab,
    List,
    ListItem,
    ListItemText,
    ListItemAvatar,
    Avatar,
    Chip,
    Button,
    CircularProgress,
    Alert,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    IconButton
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import EventIcon from '@mui/icons-material/Event';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
// ... imports
import { fetchDoctorAppointments, acceptAppointment, rejectAppointment, createPrescription, clearDoctorErrors } from '../../redux/doctorSlice';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import MedicationIcon from '@mui/icons-material/Medication';

const AppointmentsPage = () => {
    const dispatch = useDispatch();
    const { appointments, loading, error, actionLoading, actionError, actionSuccess } = useSelector((state) => state.doctor);

    const [tabValue, setTabValue] = useState(0);
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    
    // Consultation Dialog State
    const [consultationOpen, setConsultationOpen] = useState(false);
    const [consultationData, setConsultationData] = useState({
        diagnosis: '',
        notes: '',
        medicines: []
    });

    useEffect(() => {
        loadAppointments();
    }, [dispatch, tabValue]);

    const loadAppointments = () => {
        const statusMap = {
            0: 'pending',
            1: 'confirmed',
            2: 'completed',
            3: 'cancelled'
        };
        dispatch(fetchDoctorAppointments({ status: statusMap[tabValue] }));
    };

    const handleTabChange = (event, newValue) => {
        setTabValue(newValue);
    };

    const handleAccept = (id) => {
        dispatch(acceptAppointment(id));
    };

    const handleRejectClick = (id) => {
        setSelectedAppointmentId(id);
        setRejectDialogOpen(true);
    };

    const handleRejectConfirm = () => {
        if (!selectedAppointmentId) return;
        dispatch(rejectAppointment({ appointmentId: selectedAppointmentId, reason: rejectReason }));
        setRejectDialogOpen(false);
        setRejectReason('');
        setSelectedAppointmentId(null);
    };
    
    // Consultation Handlers
    const handleOpenConsultation = (id) => {
        setSelectedAppointmentId(id);
        setConsultationData({ diagnosis: '', notes: '', medicines: [] });
        setConsultationOpen(true);
    };
    
    const handleAddMedicine = () => {
        setConsultationData({
            ...consultationData,
            medicines: [...consultationData.medicines, { name: '', dosage: '', frequency: '', duration: '' }]
        });
    };
    
    const handleMedicineChange = (index, field, value) => {
        const updatedMedicines = [...consultationData.medicines];
        updatedMedicines[index][field] = value;
        setConsultationData({ ...consultationData, medicines: updatedMedicines });
    };
    
    const handleRemoveMedicine = (index) => {
        const updatedMedicines = consultationData.medicines.filter((_, i) => i !== index);
        setConsultationData({ ...consultationData, medicines: updatedMedicines });
    };
    
    const handleSubmitConsultation = () => {
        if (!selectedAppointmentId) return;
        // Basic validation
        if (!consultationData.diagnosis) {
            alert('Please enter a diagnosis');
            return;
        }
        
        dispatch(createPrescription({ 
            appointmentId: selectedAppointmentId, 
            data: consultationData 
        })).then((result) => {
             if (!result.error) {
                 setConsultationOpen(false);
                 setSelectedAppointmentId(null);
             }
        });
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatTime = (timeString) => {
        // Handle "HH:MM:SS" or ISO string
        if (!timeString) return 'TBD';
        if (timeString.includes('T')) {
            return new Date(timeString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
        return timeString.substring(0, 5);
    };

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Typography variant="h4" gutterBottom>
                My Appointments
            </Typography>

            {/* Action Feedback */}
            {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => dispatch(clearDoctorErrors())}>{actionError}</Alert>}
            {actionSuccess && <Alert severity="success" sx={{ mb: 2 }} onClose={() => dispatch(clearDoctorErrors())}>{actionSuccess}</Alert>}

            <Paper sx={{ mb: 3 }}>
                <Tabs value={tabValue} onChange={handleTabChange} indicatorColor="primary" textColor="primary" variant="fullWidth">
                    <Tab label="Pending Requests" />
                    <Tab label="Upcoming" />
                    <Tab label="Completed" />
                    <Tab label="Cancelled" />
                </Tabs>
            </Paper>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                </Box>
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
                                        <Button
                                            variant="outlined"
                                            color="error"
                                            size="small"
                                            onClick={() => handleRejectClick(appt.id)}
                                            disabled={actionLoading}
                                            startIcon={<CancelIcon />}
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            variant="contained"
                                            color="success"
                                            size="small"
                                            onClick={() => handleAccept(appt.id)}
                                            disabled={actionLoading}
                                            startIcon={<CheckCircleIcon />}
                                        >
                                            Accept
                                        </Button>
                                    </Box>
                                ) : tabValue === 1 ? (
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        size="small"
                                        onClick={() => handleOpenConsultation(appt.id)}
                                        disabled={actionLoading}
                                        startIcon={<MedicationIcon />}
                                    >
                                        Complete Consultation
                                    </Button>
                                ) : null
                            }>
                                <ListItemAvatar>
                                    <Avatar sx={{ bgcolor: 'primary.main' }}>
                                        <PersonIcon />
                                    </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {appt.patient?.full_name || 'Patient'}
                                        </Typography>
                                    }
                                    secondary={
                                        <Box component="span" sx={{ mt: 1, display: 'block' }}>
                                            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                                                <Chip
                                                    icon={<EventIcon />}
                                                    label={formatDate(appt.appointment_date)}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                                <Chip
                                                    icon={<AccessTimeIcon />}
                                                    label={formatTime(appt.start_time)}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                                <Chip
                                                    label={appt.type === 'online' ? 'Online' : 'In-Clinic'}
                                                    size="small"
                                                    color={appt.type === 'online' ? 'info' : 'default'}
                                                />
                                            </Box>
                                            <Typography variant="body2" color="text.primary" component="span" display="block">
                                                <strong>Complaint:</strong> {appt.chief_complaint}
                                            </Typography>
                                        </Box>
                                    }
                                />
                            </ListItem>
                            {index < appointments.length - 1 && <Divider component="li" />}
                        </div>
                    ))}
                </List>
            )}

            {/* Reject Dialog */}
            <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)}>
                <DialogTitle>Reject Appointment</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Please provide a reason for rejecting this appointment request.
                    </Typography>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Reason for Rejection"
                        fullWidth
                        multiline
                        rows={3}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleRejectConfirm} color="error" variant="contained">Reject</Button>
                </DialogActions>
            </Dialog>
            
            {/* Consultation Dialog */}
            <Dialog open={consultationOpen} onClose={() => setConsultationOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Complete Consultation</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="h6" gutterBottom>Diagnosis</Typography>
                    <TextField
                        fullWidth
                        label="Diagnosis"
                        multiline
                        rows={2}
                        value={consultationData.diagnosis}
                        onChange={(e) => setConsultationData({...consultationData, diagnosis: e.target.value})}
                        sx={{ mb: 3 }}
                    />
                    
                    <Typography variant="h6" gutterBottom>Clinical Notes</Typography>
                    <TextField
                        fullWidth
                        label="Notes / Instructions"
                        multiline
                        rows={3}
                        value={consultationData.notes}
                        onChange={(e) => setConsultationData({...consultationData, notes: e.target.value})}
                        sx={{ mb: 3 }}
                    />
                    
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">Prescription</Typography>
                        <Button startIcon={<AddCircleIcon />} onClick={handleAddMedicine} variant="outlined" size="small">
                            Add Medicine
                        </Button>
                    </Box>
                    
                    {consultationData.medicines.map((med, index) => (
                        <Box key={index} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'start' }}>
                            <TextField
                                label="Medicine Name"
                                size="small"
                                sx={{ flex: 2 }}
                                value={med.name}
                                onChange={(e) => handleMedicineChange(index, 'name', e.target.value)}
                            />
                            <TextField
                                label="Dosage (e.g., 500mg)"
                                size="small"
                                sx={{ flex: 1 }}
                                value={med.dosage}
                                onChange={(e) => handleMedicineChange(index, 'dosage', e.target.value)}
                            />
                            <TextField
                                label="Frequency (e.g., BID)"
                                size="small"
                                sx={{ flex: 1 }}
                                value={med.frequency}
                                onChange={(e) => handleMedicineChange(index, 'frequency', e.target.value)}
                            />
                             <TextField
                                label="Duration"
                                size="small"
                                sx={{ flex: 1 }}
                                value={med.duration}
                                onChange={(e) => handleMedicineChange(index, 'duration', e.target.value)}
                            />
                            <IconButton onClick={() => handleRemoveMedicine(index)} color="error" size="small">
                                <DeleteIcon />
                            </IconButton>
                        </Box>
                    ))}
                    {consultationData.medicines.length === 0 && (
                        <Typography color="text.secondary" variant="body2" sx={{ fontStyle: 'italic' }}>
                            No medicines added.
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConsultationOpen(false)}>Cancel</Button>
                    <Button 
                        onClick={handleSubmitConsultation} 
                        color="primary" 
                        variant="contained"
                        disabled={actionLoading}
                    >
                        {actionLoading ? 'Saving...' : 'Complete & Prescribe'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default AppointmentsPage;
