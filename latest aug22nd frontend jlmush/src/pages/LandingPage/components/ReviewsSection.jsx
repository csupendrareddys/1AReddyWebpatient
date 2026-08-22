/**
 * ReviewsSection — Play-Store-style reviews carousel.
 *
 * Renders above the trusted-brands strip. Each review is one card with
 * an avatar (or initial), reviewer name + role, star rating (if set)
 * and the review content. Section heading falls back to "What Our
 * Clients Say" when ``landingData.reviews_section_title`` is empty.
 */
import {
    Box, Container, Typography, Avatar, Rating, useTheme, alpha, Skeleton,
} from '@mui/material';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import Carousel from '../../../common/components/Carousel/Carousel';
import { useGetPublicReviewsQuery } from '../../../features/admin/api/landingPageConfigEndpoints';

export default function ReviewsSection({ sectionTitle }) {
    const theme = useTheme();
    const { data: items = [], isLoading } = useGetPublicReviewsQuery();

    if (!isLoading && items.length === 0) return null;

    return (
        <Box
            component="section"
            sx={{ py: { xs: 6, md: 10 }, px: { xs: 2, sm: 3 }, bgcolor: '#fff', overflow: 'hidden' }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2, fontSize: '0.7rem' }}
                    >
                        Reviews
                    </Typography>
                    <Typography
                        variant="h4" fontWeight={800}
                        sx={{
                            mt: 1, letterSpacing: '-0.02em',
                            fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        {sectionTitle || 'What Our Clients Say'}
                    </Typography>
                </Box>

                {isLoading ? (
                    <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                        {[0, 1, 2].map((i) => (
                            <Skeleton
                                key={i} variant="rounded"
                                width={300} height={220}
                                sx={{ borderRadius: 4, display: { xs: i > 0 ? 'none' : 'block', md: 'block' } }}
                            />
                        ))}
                    </Box>
                ) : (
                    <Carousel
                        autoPlayMs={6000}
                        itemMinWidth={{ xs: '88%', sm: '48%', md: '32%' }}
                    >
                        {items.map((r) => (
                            <ReviewCard key={r.id} review={r} theme={theme} />
                        ))}
                    </Carousel>
                )}
            </Container>
        </Box>
    );
}

function ReviewCard({ review, theme }) {
    return (
        <Box
            sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 4,
                border: '1px solid',
                borderColor: 'grey.100',
                bgcolor: '#fff',
                height: '100%',
                display: 'flex', flexDirection: 'column',
                transition: 'all 0.3s',
                '&:hover': {
                    boxShadow: `0 12px 36px ${alpha(theme.palette.primary.main, 0.1)}`,
                    transform: 'translateY(-4px)',
                },
            }}
        >
            <FormatQuoteRoundedIcon sx={{ fontSize: 36, color: alpha(theme.palette.primary.main, 0.35), mb: 1 }} />

            {review.rating ? (
                <Rating value={review.rating} readOnly size="small" sx={{ mb: 2 }} />
            ) : null}

            <Typography
                variant="body1" color="text.secondary"
                sx={{
                    mb: 3, lineHeight: 1.7, fontStyle: 'italic',
                    flex: 1,
                    // Clamp long reviews so cards stay roughly equal height.
                    display: '-webkit-box',
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                }}
            >
                &ldquo;{review.content}&rdquo;
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto' }}>
                {review.avatar_url ? (
                    <Avatar src={review.avatar_url} alt={review.reviewer_name} sx={{ width: 40, height: 40 }} />
                ) : (
                    <Avatar
                        sx={{
                            width: 40, height: 40,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            color: 'primary.main',
                            fontWeight: 700,
                        }}
                    >
                        {(review.reviewer_name || '?').charAt(0).toUpperCase()}
                    </Avatar>
                )}
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: 'break-word' }}>
                        {review.reviewer_name}
                    </Typography>
                    {review.reviewer_role && (
                        <Typography variant="caption" color="text.disabled">
                            {review.reviewer_role}
                        </Typography>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
