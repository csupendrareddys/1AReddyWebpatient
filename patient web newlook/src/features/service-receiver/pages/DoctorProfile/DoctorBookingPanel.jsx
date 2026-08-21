/**
 * DoctorBookingPanel — the "Book an appointment" side panel on a doctor's
 * profile. Pick a consultation type + day and see that day's open slots; tapping
 * a slot goes straight to the booking page for that type/date, so a patient can
 * book from the profile without going back to the listing.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Paper, Box, Typography, Stack, Button, IconButton, Chip, CircularProgress,
    ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import {
    useGetDoctorSlotsQuery,
    useGetDoctorAvailableConsultationTypesQuery,
} from '../../api/patientEndpoints';
import { CONSULTATION_TYPE_MAP } from '../../../service-provider/ProfileSetting/constants/consultationTypes';

const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dow = (d) => d.toLocaleDateString('en-IN', { weekday: 'short' });
const dm = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export default function DoctorBookingPanel({ doctorId, fallbackTypes = [] }) {
    const navigate = useNavigate();
    const { data: avail } = useGetDoctorAvailableConsultationTypesQuery(doctorId, { skip: !doctorId });

    // Types the doctor offers — prefer the availability endpoint, fall back to
    // what the profile listed.
    const types = useMemo(() => {
        const raw = (avail?.types && avail.types.length ? avail.types : fallbackTypes) || [];
        return raw
            .map((t) => (typeof t === 'string' ? t : (t.type || t.value || t.consultation_type)))
            .filter(Boolean);
    }, [avail, fallbackTypes]);

    const [type, setType] = useState(null);
    const activeType = type || types[0] || 'video';

    const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
    const [selectedDate, setSelectedDate] = useState(() => toISO(new Date()));
    const week = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

    const { data: slotsData, isFetching } = useGetDoctorSlotsQuery(
        { doctorId, date: selectedDate, consultationType: activeType },
        { skip: !doctorId || !selectedDate || !activeType },
    );
    const slots = slotsData?.slots || [];
    const booked = slotsData?.booked_slots || [];
    const pending = slotsData?.pending_slots || [];
    const openSlots = slots.filter((s) => !booked.includes(s.start) && !pending.includes(s.start));

    const goBook = (slot) => {
        const q = new URLSearchParams({ date: selectedDate });
        if (slot?.start) q.set('start', slot.start);
        navigate(`/dashboard/patient/book/${doctorId}/${activeType}?${q.toString()}`);
    };

    return (
        <Paper sx={{ p: 2.5, borderRadius: 2, bgcolor: 'primary.50', position: { md: 'sticky' }, top: 16 }}>
            <Typography variant="h5" fontWeight={800} gutterBottom>Book an appointment</Typography>
            <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
                All the schedules are in IST
            </Typography>

            {types.length > 1 && (
                <ToggleButtonGroup
                    size="small" exclusive value={activeType}
                    onChange={(_, v) => v && setType(v)}
                    sx={{ mb: 1.5, flexWrap: 'wrap' }}
                >
                    {types.map((t) => (
                        <ToggleButton key={t} value={t} sx={{ textTransform: 'none' }}>
                            {CONSULTATION_TYPE_MAP[t]?.label || t}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            )}

            {/* Week header + navigation */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                    {dm(week[0])} – {dm(week[week.length - 1])}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <IconButton size="small" onClick={() => setWeekStart(addDays(weekStart, -5))}
                    disabled={toISO(weekStart) <= toISO(new Date())}><ChevronLeftIcon /></IconButton>
                <IconButton size="small" onClick={() => setWeekStart(addDays(weekStart, 5))}><ChevronRightIcon /></IconButton>
            </Stack>

            {/* Day strip */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto', pb: 0.5 }}>
                {week.map((d) => {
                    const iso = toISO(d);
                    const isSel = iso === selectedDate;
                    const isPast = iso < toISO(new Date());
                    return (
                        <Paper key={iso} variant="outlined"
                            onClick={() => !isPast && setSelectedDate(iso)}
                            sx={{
                                px: 1.5, py: 1, minWidth: 64, textAlign: 'center', cursor: isPast ? 'default' : 'pointer',
                                opacity: isPast ? 0.4 : 1,
                                borderColor: isSel ? 'primary.main' : 'divider',
                                borderWidth: isSel ? 2 : 1,
                                bgcolor: isSel ? 'primary.main' : 'background.paper',
                                color: isSel ? 'primary.contrastText' : 'text.primary',
                            }}>
                            <Typography variant="caption" fontWeight={700} display="block">{dow(d)}</Typography>
                            <Typography variant="body2" fontWeight={700}>{dm(d)}</Typography>
                        </Paper>
                    );
                })}
            </Stack>

            {/* Slots for the selected day */}
            {isFetching ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
            ) : openSlots.length === 0 ? (
                <Box sx={{ bgcolor: 'primary.100', borderRadius: 1, py: 2, textAlign: 'center' }}>
                    <Typography color="text.secondary">No slots available</Typography>
                </Box>
            ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {openSlots.map((s) => (
                        <Chip key={s.id || s.start} label={s.start} onClick={() => goBook(s)}
                            color="primary" variant="outlined" clickable />
                    ))}
                </Stack>
            )}

            <Button fullWidth variant="contained" sx={{ mt: 2 }}
                onClick={() => navigate(`/dashboard/patient/book/${doctorId}${activeType ? `/${activeType}` : ''}`)}>
                Go to full booking
            </Button>
        </Paper>
    );
}
