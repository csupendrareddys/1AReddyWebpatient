import { Box, Container, Typography, Grid2 as Grid, Button, Skeleton, useTheme, alpha } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { useGetPublicVideosQuery } from '../../../features/admin/api/landingPageConfigEndpoints';
import { useGetPublicPlatformLandingVideosQuery } from '../../../features/admin/api/platformLandingEndpoints';
import VideoCard from '../../../common/components/VideoCard/VideoCard';

const STRIP_LIMIT = 3;

export default function VideosSection({
    isMarketingLanding = false,
    inlineItems,
}) {
    const navigate = useNavigate();
    const theme = useTheme();

    // prevent new object every render (important)
    const queryArg = useMemo(() => ({ limit: STRIP_LIMIT }), []);

    const haveInline = Array.isArray(inlineItems);

    // Public fetch only fires when we don't have inline items from the
    // preview-iframe path (where the platform summary already has the
    // right draft/preview/live videos inlined). React rules-of-hooks
    // means we call both hooks unconditionally and skip the one we
    // don't want.
    const platformQ = useGetPublicPlatformLandingVideosQuery(
        queryArg, { skip: !isMarketingLanding || haveInline },
    );
    const tenantQ = useGetPublicVideosQuery(
        queryArg, { skip: isMarketingLanding || haveInline },
    );
    const fetched = isMarketingLanding ? platformQ : tenantQ;

    const videos = haveInline
        ? inlineItems
            .filter((v) => v.is_visible !== false)
            .slice(0, STRIP_LIMIT)
        : (fetched.data?.videos || []);
    const totalCount = haveInline
        ? inlineItems.filter((v) => v.is_visible !== false).length
        : (fetched.data?.total_count || 0);
    const isLoading = haveInline ? false : fetched.isLoading;
    const isError = haveInline ? false : fetched.isError;

    // same behavior as before
    if (!isLoading && videos.length === 0) return null;

    const showMore = totalCount > STRIP_LIMIT;

    return (
        <Box
            component="section"
            sx={{
                py: { xs: 6, md: 10 },
                px: { xs: 2, sm: 3 },
                bgcolor: '#fff',
                overflow: 'hidden',
            }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                    <Typography
                        variant="overline"
                        sx={{
                            color: 'primary.main',
                            fontWeight: 700,
                            letterSpacing: 2,
                            fontSize: '0.7rem',
                        }}
                    >
                        Video Gallery
                    </Typography>

                    <Typography
                        variant="h4"
                        fontWeight={800}
                        sx={{
                            mt: 1,
                            letterSpacing: '-0.02em',
                            fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        See us in action
                    </Typography>

                    <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{ mt: 1, fontSize: { xs: '0.95rem', md: '1rem' } }}
                    >
                        Patient stories, facility tours, and expert insights.
                    </Typography>
                </Box>

                <Grid container spacing={{ xs: 2.5, md: 3 }}>
                    {(isLoading ? Array.from({ length: STRIP_LIMIT }) : videos).map((v, idx) => (
                        <Grid size={{ xs: 12, md: 4 }} key={v?.id || idx}>
                            {isLoading ? (
                                <Skeleton variant="rounded" height={220} sx={{ borderRadius: 3 }} />
                            ) : (
                                <VideoCard video={v} />
                            )}
                        </Grid>
                    ))}
                </Grid>

                {showMore && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: { xs: 4, md: 5 } }}>
                        <Button
                            variant="outlined"
                            size="large"
                            endIcon={<ArrowForwardIcon />}
                            onClick={() => navigate('/gallery/videos')}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: 2,
                                borderWidth: 2,
                                px: 4,
                                '&:hover': {
                                    borderWidth: 2,
                                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                                },
                            }}
                        >
                            More videos ({totalCount})
                        </Button>
                    </Box>
                )}
            </Container>
        </Box>
    );
}