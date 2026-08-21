/**
 * DoctorProfile — the patient-facing "View Profile" page for a doctor.
 *
 * Reached from any doctor booking card (Find a Doctor, matched doctors, or a
 * care-team member). Shows the doctor's full profile — Reg/Licence, About,
 * Education & Fellowship, Award/Membership, Registration/Licence, Specialities
 * — with "Back to Doctor Listing" and a "Consult Now" action.
 */
import {
    Box, Container, Paper, Typography, Avatar, Chip, Button, Stack, Divider,
    CircularProgress, Alert, Grid,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SchoolIcon from '@mui/icons-material/School';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import BadgeIcon from '@mui/icons-material/Badge';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import TranslateIcon from '@mui/icons-material/Translate';
import PlaceIcon from '@mui/icons-material/Place';
import { useNavigate, useParams } from 'react-router-dom';

import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import { useGetDoctorDetailQuery, useGetDoctorOfferingsQuery } from '../../api/patientEndpoints';
import DoctorBookingPanel from './DoctorBookingPanel';

const inr = (v) => (v == null ? null : `₹${Number(v).toLocaleString('en-IN')}`);

function Section({ icon, title, children }) {
    return (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                {icon}
                <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
            </Stack>
            {children}
        </Paper>
    );
}

const noInfo = (
    <Typography variant="body2" color="text.secondary">No Information</Typography>
);

export default function DoctorProfile() {
    const { doctorId } = useParams();
    const navigate = useNavigate();
    const { data, isLoading, error } = useGetDoctorDetailQuery(doctorId, { skip: !doctorId });
    const doc = data?.data || data || {};
    const { data: offerings } = useGetDoctorOfferingsQuery(doctorId, { skip: !doctorId });
    const services = offerings?.services || [];
    const carePlans = offerings?.group_offerings || [];

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }
    if (error || !doc.id) {
        return (
            <Container maxWidth="md" sx={{ mt: 4 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/dashboard/patient/find-doctors')} sx={{ mb: 2 }}>
                    Back to Doctor Listing
                </Button>
                <Alert severity="error">Couldn’t load this doctor’s profile.</Alert>
            </Container>
        );
    }

    const degrees = doc.qualifications || [];
    const specialities = doc.specializations || [];
    const languages = doc.languages_known || [];
    const reg = doc.registration || {};
    const regLine = [reg.council, reg.number].filter(Boolean).join(' - ') || null;

    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 8 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/dashboard/patient/find-doctors')} sx={{ mb: 2 }}>
                Back to Doctor Listing
            </Button>

            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
            {/* Header */}
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'flex-start' }}>
                    <Avatar src={doc.profile_image} sx={{ width: 96, height: 96, bgcolor: 'primary.main' }}>
                        <PersonIcon sx={{ fontSize: 48 }} />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="h5" fontWeight={800}>
                            Dr. {doc.full_name}
                            {doc.highest_qualification ? (
                                <Typography component="span" variant="h6" color="text.secondary" fontWeight={600}>
                                    {' '}, {doc.highest_qualification}
                                </Typography>
                            ) : null}
                        </Typography>
                        {specialities.length > 0 && (
                            <Typography variant="subtitle1" color="primary" fontWeight={600}>
                                {specialities.join(', ')}
                                {doc.city ? (
                                    <Typography component="span" color="text.secondary" fontWeight={400}>
                                        {' '}· {doc.city}
                                    </Typography>
                                ) : null}
                            </Typography>
                        )}
                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                            {inr(doc.consultation_fee) != null && (
                                <Typography variant="body1" fontWeight={700}>
                                    {inr(doc.consultation_fee)}
                                    <Typography component="span" variant="body2" color="text.secondary"> / consultation</Typography>
                                </Typography>
                            )}
                            {doc.experience_years != null && (
                                <Typography variant="body2" color="text.secondary">
                                    {doc.experience_years}+ yrs experience
                                </Typography>
                            )}
                        </Stack>
                        {languages.length > 0 && (
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                                <TranslateIcon fontSize="small" color="action" />
                                {languages.map((l) => (
                                    <Chip key={l} label={l} size="small" variant="outlined" />
                                ))}
                            </Stack>
                        )}
                        {regLine && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                Reg. / Lic. no: <strong>{regLine}</strong>
                            </Typography>
                        )}
                    </Box>
                    <Stack spacing={1} sx={{ minWidth: { sm: 160 } }}>
                        <Button variant="contained" onClick={() => navigate(`/dashboard/patient/book/${doc.id}`)}>
                            Consult Now
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            <Grid container spacing={2}>
                <Grid item xs={12}>
                    <Section icon={<PersonIcon color="primary" fontSize="small" />} title="About This Doctor">
                        {doc.about
                            ? <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{doc.about}</Typography>
                            : noInfo}
                    </Section>
                </Grid>

                <Grid item xs={12} md={6}>
                    <Section icon={<SchoolIcon color="primary" fontSize="small" />} title="Education & Fellowship">
                        {degrees.length > 0 ? (
                            <Stack spacing={1}>
                                {degrees.map((d, i) => (
                                    <Box key={i}>
                                        <Typography variant="body2" fontWeight={600}>
                                            {d.degree_name || 'Degree'}
                                            {d.passing_year ? (
                                                <Typography component="span" variant="caption" color="text.secondary">
                                                    {' '}· {d.passing_year}
                                                </Typography>
                                            ) : null}
                                        </Typography>
                                        {d.institution && (
                                            <Typography variant="caption" color="text.secondary">{d.institution}</Typography>
                                        )}
                                    </Box>
                                ))}
                            </Stack>
                        ) : noInfo}
                    </Section>
                </Grid>

                <Grid item xs={12} md={6}>
                    <Section icon={<WorkspacePremiumIcon color="primary" fontSize="small" />} title="Award / Membership">
                        {(doc.awards || []).length > 0 ? (
                            <Stack spacing={0.5}>
                                {doc.awards.map((a, i) => (
                                    <Typography key={i} variant="body2">{typeof a === 'string' ? a : a.name}</Typography>
                                ))}
                            </Stack>
                        ) : noInfo}
                    </Section>
                </Grid>

                <Grid item xs={12} md={6}>
                    <Section icon={<BadgeIcon color="primary" fontSize="small" />} title="Registration / Licence">
                        {regLine
                            ? <Typography variant="body2">{regLine}{reg.year ? ` (${reg.year})` : ''}</Typography>
                            : noInfo}
                    </Section>
                </Grid>

                <Grid item xs={12} md={6}>
                    <Section icon={<LocalHospitalIcon color="primary" fontSize="small" />} title="Specialities">
                        {specialities.length > 0 ? (
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                {specialities.map((s) => <Chip key={s} label={s} size="small" />)}
                            </Stack>
                        ) : noInfo}
                    </Section>
                </Grid>

                {services.length > 0 && (
                    <Grid item xs={12}>
                        <Section icon={<StorefrontIcon color="primary" fontSize="small" />} title="Services by this doctor">
                            <Stack spacing={1}>
                                {services.map((s) => (
                                    <Paper key={s.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                                        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                                                {s.description && (
                                                    <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                                                )}
                                            </Box>
                                            {s.price != null && (
                                                <Typography variant="body2" fontWeight={700}>{inr(s.price)}</Typography>
                                            )}
                                            <Button size="small" variant="contained"
                                                onClick={() => navigate(`/dashboard/patient/marketplace?doctor=${encodeURIComponent(doc.full_name || '')}`)}>
                                                Book
                                            </Button>
                                        </Stack>
                                    </Paper>
                                ))}
                            </Stack>
                        </Section>
                    </Grid>
                )}

                {carePlans.length > 0 && (
                    <Grid item xs={12}>
                        <Section icon={<GroupsIcon color="primary" fontSize="small" />} title="Care plans with this doctor">
                            <Stack spacing={1}>
                                {carePlans.map((g) => (
                                    <Paper key={g.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                                        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
                                            <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>{g.name}</Typography>
                                            {g.price != null && (
                                                <Typography variant="body2" fontWeight={700}>{inr(g.price)}</Typography>
                                            )}
                                            <Button size="small" variant="outlined"
                                                onClick={() => navigate('/dashboard/patient/health-plans')}>
                                                View plan
                                            </Button>
                                        </Stack>
                                    </Paper>
                                ))}
                            </Stack>
                        </Section>
                    </Grid>
                )}
            </Grid>
              </Grid>
              <Grid item xs={12} md={4}>
                <DoctorBookingPanel doctorId={doc.id} fallbackTypes={doc.consultation_types || []} />
              </Grid>
            </Grid>
        </Container>
    );
}
