/**
 * DoctorsSection — "Meet our doctors" slow carousel.
 *
 * Renders above the Reviews section. Hides itself when no visible
 * doctors are configured. Section heading comes from
 * ``landingData.doctors_section_title`` (admin-editable on the Editor
 * tab), falling back to "Meet Our Doctors".
 *
 * Carousel autoplay is intentionally slow (8s per slide) per product
 * direction — doctors should be readable, not flashing past.
 */
import { Box, Container, Typography, Avatar, useTheme, alpha, Skeleton } from '@mui/material';
import Carousel from '../../../common/components/Carousel/Carousel';
import { useGetPublicDoctorsQuery } from '../../../features/admin/api/landingPageConfigEndpoints';

export default function DoctorsSection({ sectionTitle }) {
    const theme = useTheme();
    const { data: items = [], isLoading } = useGetPublicDoctorsQuery();

    if (!isLoading && items.length === 0) return null;

    return (
        <Box
            component="section"
            sx={{ py: { xs: 6, md: 10 }, px: { xs: 2, sm: 3 }, bgcolor: '#fafbfc', overflow: 'hidden' }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2, fontSize: '0.7rem' }}
                    >
                        Our Team
                    </Typography>
                    <Typography
                        variant="h4" fontWeight={800}
                        sx={{
                            mt: 1, letterSpacing: '-0.02em',
                            fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        {sectionTitle || 'Meet Our Doctors'}
                    </Typography>
                </Box>

                {isLoading ? (
                    <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                        {[0, 1, 2].map((i) => (
                            <Skeleton
                                key={i} variant="rounded"
                                width={280} height={340}
                                sx={{ borderRadius: 4, display: { xs: i > 0 ? 'none' : 'block', md: 'block' } }}
                            />
                        ))}
                    </Box>
                ) : (
                    <Carousel
                        autoPlayMs={8000}
                        itemMinWidth={{ xs: '85%', sm: '46%', md: '31%' }}
                    >
                        {items.map((d) => (
                            <DoctorCard key={d.id} doctor={d} theme={theme} />
                        ))}
                    </Carousel>
                )}
            </Container>
        </Box>
    );
}

function DoctorCard({ doctor, theme }) {
    return (
        <Box
            sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
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
            {doctor.photo_url ? (
                <Avatar
                    src={doctor.photo_url}
                    alt={doctor.name}
                    sx={{
                        width: 128, height: 128, mb: 2,
                        border: '4px solid',
                        borderColor: alpha(theme.palette.primary.main, 0.15),
                    }}
                />
            ) : (
                <Box
                    sx={{
                        width: 128, height: 128, mb: 2, borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: 'primary.main',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '2.5rem',
                    }}
                >
                    {(doctor.name || '?').charAt(0).toUpperCase()}
                </Box>
            )}

            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5, wordBreak: 'break-word' }}>
                {doctor.name}
            </Typography>

            {doctor.specialty && (
                <Typography
                    variant="caption" color="primary.main" fontWeight={600}
                    sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                    {doctor.specialty}
                </Typography>
            )}

            {doctor.qualifications && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                    {doctor.qualifications}
                </Typography>
            )}

            {doctor.bio && (
                <Typography
                    variant="body2" color="text.secondary"
                    sx={{
                        lineHeight: 1.65,
                        // Clamp to ~3 lines so cards stay the same height
                        // even when bios vary in length.
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {doctor.bio}
                </Typography>
            )}
        </Box>
    );
}
