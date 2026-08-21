/**
 * PublicDoctorListPage — public doctor catalog at ``/book/<consultationType>``.
 *
 * Anonymous visitors arrive here from a consultation-type card on the
 * landing page. Doctors are grouped by their primary specialization
 * (Category) so the visitor can quickly narrow to "Cardiology" /
 * "Neurology" / etc. Clicking a doctor card navigates into the
 * slot-picker page for that doctor.
 *
 * Wrapped in :class:`PublicLandingLayout` so the navbar / footer / theme
 * mirror the landing page.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Box, Container, Typography, Grid2 as Grid, Card, CardActionArea, CardContent,
    Avatar, Chip, TextField, MenuItem, Skeleton, Alert, Stack, useTheme, alpha,
    InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import { CONSULTATION_TYPES } from '../../features/service-provider/ProfileSetting/constants/consultationTypes';
import {
    useGetPublicSpecializationsQuery,
    useGetPublicBookingDoctorsQuery,
} from '../../features/publicBooking/publicBookingApi';

export default function PublicDoctorListPage() {
    return (
        <PublicLandingLayout>
            <PublicDoctorListContent />
        </PublicLandingLayout>
    );
}

function PublicDoctorListContent() {
    const { consultationType } = useParams();
    const navigate = useNavigate();
    const theme = useTheme();

    const ctMeta = CONSULTATION_TYPES.find((c) => c.value === consultationType);

    const [specializationId, setSpecializationId] = useState('');
    const [name, setName] = useState('');

    const { data: specializations = [] } = useGetPublicSpecializationsQuery();

    const { data: doctorsResp, isLoading, isFetching } = useGetPublicBookingDoctorsQuery({
        specializationId: specializationId || undefined,
        consultationType,
        name: name || undefined,
        page: 1, perPage: 50,
    });

    const doctors = doctorsResp?.items || [];

    // Group doctors by primary specialization for the section
    // headings — preserves the admin-side ordering by relying on the
    // specializations list (which is already sorted alphabetically).
    const grouped = useMemo(() => {
        const map = new Map();
        // Seed with the specialization order so empty categories show
        // up under their heading rather than being dropped.
        specializations.forEach((s) => map.set(s.id, { spec: s, doctors: [] }));
        const fallbackKey = '__none__';
        for (const d of doctors) {
            const key = d.specialization_id || fallbackKey;
            if (!map.has(key)) {
                map.set(key, {
                    spec: { id: key, name: d.specialization_name || 'Other' },
                    doctors: [],
                });
            }
            map.get(key).doctors.push(d);
        }
        // Drop categories with zero doctors so the page shows only what
        // the visitor can actually act on.
        return Array.from(map.values()).filter((g) => g.doctors.length > 0);
    }, [doctors, specializations]);

    return (
        <Box>
            {/* Header strip */}
            <Box
                sx={{
                    py: { xs: 5, md: 7 }, px: { xs: 2, sm: 3 },
                    background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, transparent 100%)`,
                }}
            >
                <Container maxWidth="lg">
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between"
                    >
                        <Box sx={{ minWidth: 0 }}>
                            <Typography
                                variant="overline"
                                sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2, fontSize: '0.7rem' }}
                            >
                                {ctMeta?.label || 'Consultation'}
                            </Typography>
                            <Typography
                                variant="h3"
                                fontWeight={800}
                                sx={{
                                    letterSpacing: '-0.02em',
                                    fontSize: { xs: '1.65rem', sm: '2rem', md: '2.5rem' },
                                    lineHeight: 1.15,
                                    wordBreak: 'break-word',
                                }}
                            >
                                Find your {ctMeta?.shortLabel?.toLowerCase() || 'consultation'} doctor
                            </Typography>
                            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                                Pick a specialty and a doctor. Slots and prices are shown on the next page.
                            </Typography>
                        </Box>
                    </Stack>

                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ mt: 3 }}
                    >
                        <TextField
                            select size="small"
                            label="Specialty"
                            value={specializationId}
                            onChange={(e) => setSpecializationId(e.target.value)}
                            sx={{ minWidth: 220 }}
                        >
                            <MenuItem value="">All specialties</MenuItem>
                            {specializations.map((s) => (
                                <MenuItem key={s.id} value={s.id}>
                                    {s.name} ({s.doctor_count})
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            size="small"
                            placeholder="Search by doctor name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            sx={{ flex: 1 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Stack>
                </Container>
            </Box>

            {/* Body */}
            <Box sx={{ py: { xs: 4, md: 6 }, px: { xs: 2, sm: 3 }, bgcolor: '#fafbfc' }}>
                <Container maxWidth="lg">
                    {(isLoading || isFetching) && (
                        <Grid container spacing={2}>
                            {[0, 1, 2, 3].map((i) => (
                                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                                    <Skeleton variant="rounded" height={180} sx={{ borderRadius: 3 }} />
                                </Grid>
                            ))}
                        </Grid>
                    )}

                    {!isLoading && doctors.length === 0 && (
                        <Alert severity="info">
                            No doctors found for the selected filters. Try a different
                            specialty or consultation type.
                        </Alert>
                    )}

                    {!isLoading && grouped.map(({ spec, doctors: specDoctors }) => (
                        <Box key={spec.id} sx={{ mb: { xs: 4, md: 6 } }}>
                            <Stack
                                direction="row" alignItems="center" spacing={1}
                                sx={{ mb: 2 }}
                            >
                                <LocalHospitalIcon sx={{ color: 'primary.main' }} />
                                <Typography variant="h5" fontWeight={700}>
                                    {spec.name}
                                </Typography>
                                <Chip
                                    size="small" variant="outlined"
                                    label={`${specDoctors.length} doctor${specDoctors.length === 1 ? '' : 's'}`}
                                />
                            </Stack>
                            <Grid container spacing={2}>
                                {specDoctors.map((d) => (
                                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={d.id}>
                                        <DoctorCard
                                            doctor={d}
                                            onClick={() => navigate(
                                                `/book/${consultationType}/doctor/${d.id}`,
                                                { state: { doctor: d } },
                                            )}
                                            theme={theme}
                                        />
                                    </Grid>
                                ))}
                            </Grid>
                        </Box>
                    ))}
                </Container>
            </Box>
        </Box>
    );
}

// ---------------------------------------------------------------------------

function DoctorCard({ doctor, onClick, theme }) {
    return (
        <Card
            elevation={0}
            sx={{
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'grey.100',
                height: '100%',
                transition: 'all 0.2s',
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    boxShadow: `0 12px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
                    transform: 'translateY(-3px)',
                },
            }}
        >
            <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <Avatar
                            src={doctor.profile_image || undefined}
                            sx={{ width: 64, height: 64, bgcolor: alpha(theme.palette.primary.main, 0.12) }}
                        >
                            {(doctor.first_name || '?')[0]?.toUpperCase()}
                        </Avatar>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.25 }}>
                                Dr. {doctor.full_name}
                            </Typography>
                            {doctor.specialization_name && (
                                <Typography variant="caption" color="primary.main" fontWeight={600}>
                                    {doctor.specialization_name}
                                </Typography>
                            )}
                            <Typography
                                variant="body2" color="text.secondary"
                                sx={{ mt: 0.5, fontSize: '0.85rem' }}
                            >
                                {doctor.experience_years
                                    ? `${doctor.experience_years} years experience`
                                    : ''}
                                {/* Per-slot pricing tiers (range/duration → price)
                                    when the doctor set slot pricing; else the
                                    single consultation fee. */}
                                {Array.isArray(doctor.price_range) && doctor.price_range.length > 0 ? (
                                    <Box component="span" sx={{ ml: doctor.experience_years ? 1 : 0 }}>
                                        {doctor.experience_years && '· '}
                                        {doctor.price_range.map((t, i) => (
                                            <Box component="span" key={i}>
                                                {i > 0 && ' · '}
                                                {t.range ? `${t.range}: ` : ''}₹{t.price}
                                            </Box>
                                        ))}
                                    </Box>
                                ) : doctor.consultation_fee != null && (
                                    <Box component="span" sx={{ ml: doctor.experience_years ? 1 : 0 }}>
                                        {doctor.experience_years && '· '}
                                        ₹{doctor.consultation_fee}
                                    </Box>
                                )}
                            </Typography>
                        </Box>
                        <ArrowForwardIcon sx={{ color: 'primary.main' }} />
                    </Stack>
                </CardContent>
            </CardActionArea>
        </Card>
    );
}
