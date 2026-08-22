import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box, Paper, Typography, Grid, IconButton, Tooltip,
    Avatar, Chip, CircularProgress, Badge,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EventIcon from '@mui/icons-material/Event';

import { fetchCalendarAppointments } from '../../redux/doctorSlice';

const DoctorCalendarView = ({ onSelectAppointment }) => {
    const dispatch = useDispatch();
    const { calendarAppointments, calendarLoading } = useSelector((state) => state.doctor);
    
    const [currentDate, setCurrentDate] = useState(new Date());
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1; // 1-indexed
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    useEffect(() => {
        dispatch(fetchCalendarAppointments(monthStr));
    }, [dispatch, monthStr]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfMonth = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

    const handlePrevMonth = () => {
        setCurrentDate(new Date(year, month - 2, 1));
    };

    const handleNextMonth = () => {
        setCurrentDate(new Date(year, month, 1));
    };

    const monthName = currentDate.toLocaleString('default', { month: 'long' });

    // Group appointments by date
    const apptsByDate = (calendarAppointments || []).reduce((acc, appt) => {
        const date = appt.appointment_date; // YYYY-MM-DD
        if (!acc[date]) acc[date] = [];
        acc[date].push(appt);
        return acc;
    }, {});

    const renderDays = () => {
        const days = [];
        // Header
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekDays.forEach(wd => {
            days.push(
                <Grid item xs={12/7} key={wd} sx={{ textAlign: 'center', py: 1 }}>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">{wd}</Typography>
                </Grid>
            );
        });

        // Blank days at start
        for (let i = 0; i < firstDayOfMonth; i++) {
            days.push(<Grid item xs={12/7} key={`blank-${i}`} />);
        }

        // Real days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayAppts = apptsByDate[dateStr] || [];
            
            days.push(
                <Grid item xs={12/7} key={d} sx={{ p: 0.5 }}>
                    <Paper
                        variant="outlined"
                        sx={{
                            minHeight: 80,
                            p: 0.5,
                            display: 'flex',
                            flexDirection: 'column',
                            bgcolor: dayAppts.length > 0 ? 'primary.50' : 'background.paper',
                            transition: 'all 0.2s',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        <Typography variant="caption" sx={{ mb: 0.5, fontWeight: dayAppts.length > 0 ? 'bold' : 'normal' }}>
                            {d}
                        </Typography>
                        
                        <Box sx={{ overflowY: 'auto', flexGrow: 1, maxHeight: 60 }}>
                            {dayAppts.map(appt => (
                                <Tooltip key={appt.id} title={`${appt.start_time.substring(0,5)} - ${appt.patient_name}`}>
                                    <Chip
                                        label={appt.patient_name}
                                        size="small"
                                        color={appt.status === 'confirmed' ? 'primary' : 'success'}
                                        sx={{ 
                                            fontSize: '0.6rem', 
                                            height: 18, 
                                            mb: 0.5, 
                                            width: '100%',
                                            justifyContent: 'flex-start',
                                            '& .MuiChip-label': { px: 0.5 }
                                        }}
                                        onClick={() => onSelectAppointment?.(appt.id)}
                                    />
                                </Tooltip>
                            ))}
                        </Box>
                    </Paper>
                </Grid>
            );
        }
        return days;
    };

    return (
        <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">{monthName} {year}</Typography>
                <Box>
                    <IconButton onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
                    <IconButton onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
                </Box>
            </Box>

            {calendarLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
            ) : (
                <Grid container>
                    {renderDays()}
                </Grid>
            )}

            <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'center' }}>
                <Box display="flex" alignItems="center" gap={0.5}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'primary.main' }} />
                    <Typography variant="caption">Confirmed</Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={0.5}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main' }} />
                    <Typography variant="caption">In Progress/Completed</Typography>
                </Box>
            </Box>
        </Box>
    );
};

export default DoctorCalendarView;
