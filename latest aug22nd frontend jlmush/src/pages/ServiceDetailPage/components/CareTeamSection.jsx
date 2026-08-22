/**
 * "Meet your care team" — the doctors an admin pinned to this service page.
 *
 * The server has already applied each doctor's visibility toggles, so every
 * field arriving here is meant to be shown; a toggled-off field comes through
 * as null and is simply skipped. Only ``name`` is guaranteed present.
 *
 * Visually a sibling of the landing page's "Meet Our Doctors" strip, adapted
 * to a grid (a service page usually pins two or three doctors, where a
 * carousel would be overkill).
 */
import {
    Box, Container, Typography, Grid2 as Grid, Avatar, Stack, Chip,
    useTheme, alpha,
} from '@mui/material';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import GroupsIcon from '@mui/icons-material/Groups';

export default function CareTeamSection({ members = [], serviceName }) {
    const theme = useTheme();
    if (!members.length) return null;

    return (
        <Box
            sx={{
                py: { xs: 8, md: 10 },
                px: { xs: 2, md: 3 },
                bgcolor: 'grey.50',
                borderTop: '1px solid',
                borderColor: 'grey.200',
            }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: 6 }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 1.5 }}
                    >
                        Our Team
                    </Typography>
                    <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
                        Meet your care team
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'grey.500' }}>
                        The people who'll look after your {serviceName}.
                    </Typography>
                </Box>

                <Grid container spacing={3} justifyContent="center">
                    {members.map((member, idx) => (
                        <Grid
                            size={{ xs: 12, sm: 6, md: 4 }}
                            key={member.id || member.doctor_id || idx}
                        >
                            <CareTeamCard entry={member} theme={theme} />
                        </Grid>
                    ))}
                </Grid>
            </Container>
        </Box>
    );
}

function CareTeamCard({ entry, theme }) {
    // A team entry (group offering) pins a whole team as a unit — render its
    // name + members instead of a single doctor's profile fields.
    if (entry.team) {
        return <CareTeamTeamCard entry={entry} theme={theme} />;
    }
    const doctor = entry.doctor || {};
    const name = doctor.name || 'Our specialist';
    const languages = Array.isArray(doctor.languages) ? doctor.languages : [];

    return (
        <Box
            sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center',
                p: { xs: 3, md: 4 },
                borderRadius: 4,
                border: '1px solid',
                borderColor: 'grey.100',
                bgcolor: '#fff',
                height: '100%',
                transition: 'all 0.3s',
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    boxShadow: `0 12px 36px ${alpha(theme.palette.primary.main, 0.12)}`,
                    transform: 'translateY(-4px)',
                },
            }}
        >
            {doctor.photo ? (
                <Avatar
                    src={doctor.photo}
                    alt={name}
                    sx={{
                        width: 112, height: 112, mb: 2,
                        border: '4px solid',
                        borderColor: alpha(theme.palette.primary.main, 0.15),
                    }}
                />
            ) : (
                <Box
                    sx={{
                        width: 112, height: 112, mb: 2, borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: 'primary.main',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '2.25rem',
                    }}
                >
                    {name.charAt(0).toUpperCase()}
                </Box>
            )}

            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5, wordBreak: 'break-word' }}>
                {name}
            </Typography>

            {doctor.work_qualification && (
                <Typography
                    variant="caption"
                    color="primary.main"
                    fontWeight={600}
                    sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                    {doctor.work_qualification}
                </Typography>
            )}

            {(doctor.experience_years !== null && doctor.experience_years !== undefined) && (
                <Stack
                    direction="row" alignItems="center" spacing={0.5}
                    sx={{ color: 'text.secondary', mb: 0.5 }}
                >
                    <AccessTimeIcon sx={{ fontSize: 16 }} />
                    <Typography variant="caption">
                        {doctor.experience_years} {doctor.experience_years === 1 ? 'year' : 'years'} of experience
                    </Typography>
                </Stack>
            )}

            {doctor.location && (
                <Stack
                    direction="row" alignItems="center" spacing={0.5}
                    sx={{ color: 'text.secondary', mb: 0.5 }}
                >
                    <PlaceOutlinedIcon sx={{ fontSize: 16 }} />
                    <Typography variant="caption">{doctor.location}</Typography>
                </Stack>
            )}

            {languages.length > 0 && (
                <Stack
                    direction="row" alignItems="center" spacing={0.5}
                    sx={{ color: 'text.secondary', mb: 1, flexWrap: 'wrap', justifyContent: 'center' }}
                >
                    <TranslateIcon sx={{ fontSize: 16 }} />
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center' }}>
                        {languages.map((lng) => (
                            <Chip
                                key={lng}
                                label={lng}
                                size="small"
                                sx={{
                                    height: 20, fontSize: '0.7rem',
                                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                                    color: 'primary.main',
                                }}
                            />
                        ))}
                    </Box>
                </Stack>
            )}

            {entry.description && (
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                        mt: 1,
                        lineHeight: 1.65,
                        // Clamp so cards keep a consistent height regardless
                        // of how much the admin wrote.
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {entry.description}
                </Typography>
            )}
        </Box>
    );
}

function CareTeamTeamCard({ entry, theme }) {
    const team = entry.team || {};
    const name = team.name || 'Care team';
    const members = Array.isArray(team.members) ? team.members : [];

    return (
        <Box
            sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center',
                p: { xs: 3, md: 4 },
                borderRadius: 4,
                border: '1px solid',
                borderColor: 'grey.100',
                bgcolor: '#fff',
                height: '100%',
                transition: 'all 0.3s',
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    boxShadow: `0 12px 36px ${alpha(theme.palette.primary.main, 0.12)}`,
                    transform: 'translateY(-4px)',
                },
            }}
        >
            <Box
                sx={{
                    width: 112, height: 112, mb: 2, borderRadius: '50%',
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    color: 'primary.main',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                <GroupsIcon sx={{ fontSize: '3rem' }} />
            </Box>

            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5, wordBreak: 'break-word' }}>
                {name}
            </Typography>
            <Typography
                variant="caption" color="primary.main" fontWeight={600}
                sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
                {members.length} {members.length === 1 ? 'specialist' : 'specialists'}
            </Typography>

            {members.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center', mb: 1 }}>
                    {members.map((m) => (
                        <Chip
                            key={m}
                            label={m}
                            size="small"
                            sx={{
                                height: 22, fontSize: '0.72rem',
                                bgcolor: alpha(theme.palette.primary.main, 0.08),
                                color: 'primary.main',
                            }}
                        />
                    ))}
                </Box>
            )}

            {entry.description && (
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                        mt: 1,
                        lineHeight: 1.65,
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {entry.description}
                </Typography>
            )}
        </Box>
    );
}
