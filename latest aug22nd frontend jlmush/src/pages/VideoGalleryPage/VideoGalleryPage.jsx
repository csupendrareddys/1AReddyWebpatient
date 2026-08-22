/**
 * VideoGalleryPage — public ``/gallery/videos`` page.
 *
 * Lists every visible video for the current tenant. When at least one
 * video has a ``category`` set, videos are grouped under per-category
 * sub-headings; otherwise we render a single flat grid. Wrapped in
 * :class:`PublicLandingLayout` so the navbar / footer / per-tenant theme
 * all flow through.
 */
import { useEffect, useMemo, useState } from 'react';
import { store } from '../../app/store';
import {
    Box, Container, Typography, Grid, Skeleton, Alert,
    useTheme, alpha,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import { useGetPublicVideosQuery } from '../../features/admin/api/landingPageConfigEndpoints';
import { useGetPublicPlatformLandingVideosQuery } from '../../features/admin/api/platformLandingEndpoints';
import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import VideoCard from '../../common/components/VideoCard/VideoCard';

const UNCATEGORISED_KEY = '__uncategorised__';

export default function VideoGalleryPage() {
    return (
        <PublicLandingLayout>
            {({ isMarketingLanding }) => (
                <VideoGalleryContent isMarketingLanding={isMarketingLanding} />
            )}
        </PublicLandingLayout>
    );
}

function VideoGalleryContent({ isMarketingLanding = false }) {
    const theme = useTheme();
    const landing = theme.palette.landing || {};
    // No ``limit`` — get them all. Apex / marketing-preview reads from the
    // platform-marketing videos table; tenant subdomains read from the
    // per-tenant landing_videos table. The two endpoints emit the same
    // ``{videos, total_count}`` envelope so the rest of this component
    // doesn't need to care.
    // Subscribe ONLY to fire the request — we then read the entry directly
    // from Redux via ``useSyncExternalStore`` below. RTK Query's own hook
    // ``data`` field, and even ``useSelector`` against the same cache key,
    // failed to re-render this page when the entry transitioned from
    // pending → fulfilled under the layout's auth-cycle re-renders. Going
    // through the store's external-store subscription model directly is the
    // most React-18-faithful way to get a deterministic update.
    useGetPublicVideosQuery(undefined, { skip: isMarketingLanding });
    useGetPublicPlatformLandingVideosQuery(undefined, { skip: !isMarketingLanding });
    const cacheKey = isMarketingLanding
        ? 'getPublicPlatformLandingVideos(undefined)'
        : 'getPublicVideos(undefined)';
    // Poll the redux store every 250ms until a cache entry with data
    // appears, then stop. RTK Query's hook output and useSelector both
    // failed to re-render this component reliably when the entry
    // transitioned pending → fulfilled (auth-cycle dispatches racing with
    // the resolution under React 18 strict mode). This polling approach
    // sidesteps the subscription-notification path entirely and self-stops
    // once data is in hand, so the cost is bounded to the brief loading
    // window.
    const [tick, setTick] = useState(0);
    const entry = store.getState().api?.queries?.[cacheKey];
    const data = entry?.data;
    const isError = entry?.status === 'rejected';
    const isLoading = !data && !isError;
    useEffect(() => {
        if (data || isError) return undefined;
        const id = setInterval(() => setTick((n) => n + 1), 250);
        return () => clearInterval(id);
    // ``tick`` is included so the effect re-evaluates after each poll and
    // stops cleanly the moment data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, isError, tick]);

    const videos = data?.videos || [];

    // Group by category. We preserve insertion order so the admin's
    // ``display_order`` carries through both the inter-category ordering
    // and within each category. Categories with empty/null values fold into
    // a single "uncategorised" bucket which is rendered without a heading.
    const groups = useMemo(() => {
        const map = new Map();
        for (const v of videos) {
            const key = v.category && v.category.trim() ? v.category.trim() : UNCATEGORISED_KEY;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(v);
        }
        return Array.from(map.entries());
    }, [videos]);

    return (
        <Box>
            {/* ═══════════ Page hero ═══════════ */}
            <Box
                sx={{
                    py: { xs: 5, md: 8 },
                    px: { xs: 2, sm: 3 },
                    background: `linear-gradient(180deg, ${landing.heroFrom || '#f8faff'} 0%, ${landing.heroTo || '#fff'} 100%)`,
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                <Box
                    sx={{
                        position: 'absolute', top: -100, right: -40,
                        width: { xs: 200, md: 320 }, height: { xs: 200, md: 320 },
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        filter: 'blur(60px)',
                        pointerEvents: 'none',
                    }}
                />
                <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Box
                            sx={{
                                width: 56, height: 56, borderRadius: 2,
                                bgcolor: alpha(theme.palette.primary.main, 0.12),
                                color: 'primary.main',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <VideocamIcon sx={{ fontSize: 32 }} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography
                                variant="overline"
                                sx={{
                                    color: 'primary.main', fontWeight: 700,
                                    letterSpacing: 2, fontSize: '0.7rem',
                                }}
                            >
                                Gallery
                            </Typography>
                            <Typography
                                variant="h2" fontWeight={800}
                                sx={{
                                    letterSpacing: '-0.02em', lineHeight: 1.15,
                                    fontSize: { xs: '1.85rem', sm: '2.5rem', md: '3rem' },
                                    wordBreak: 'break-word',
                                }}
                            >
                                Video gallery
                            </Typography>
                        </Box>
                    </Box>
                    <Typography
                        variant="body1" color="text.secondary"
                        sx={{ maxWidth: 720, fontSize: { xs: '0.95rem', md: '1.05rem' } }}
                    >
                        Browse our patient stories, facility tours and expert insights — all in one place.
                    </Typography>
                </Container>
            </Box>

            {/* ═══════════ Grid(s) ═══════════ */}
            <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, sm: 3 }, bgcolor: '#fafbfc' }}>
                <Container maxWidth="lg">
                    {isError && (
                        <Alert severity="error">
                            Couldn’t load the gallery. Please try again in a moment.
                        </Alert>
                    )}

                    {isLoading && (
                        <Grid container spacing={3}>
                            {Array.from({ length: 6 }).map((_, i) => (
                                // MUI v6's default ``@mui/material`` Grid is the
                                // *legacy* Grid (size= is the new Grid2 API).
                                // The legacy Grid silently drops ``size={...}``
                                // and renders each child full-width — which is
                                // why these cards were huge on the gallery
                                // page but correct in the dashboard strip
                                // (VideosSection uses ``item xs={...}``).
                                <Grid item xs={12} sm={6} md={4} key={i}>
                                    <Skeleton variant="rounded" height={220} sx={{ borderRadius: 3 }} />
                                </Grid>
                            ))}
                        </Grid>
                    )}

                    {!isLoading && !isError && videos.length === 0 && (
                        <Alert severity="info">
                            No videos have been published yet — check back soon.
                        </Alert>
                    )}

                    {!isLoading && !isError && groups.map(([category, vids]) => (
                        <Box key={category} sx={{ mb: { xs: 5, md: 7 } }}>
                            {category !== UNCATEGORISED_KEY && (
                                <Typography
                                    variant="h5" fontWeight={700}
                                    sx={{
                                        mb: { xs: 2.5, md: 3 },
                                        fontSize: { xs: '1.25rem', md: '1.5rem' },
                                        letterSpacing: '-0.01em',
                                    }}
                                >
                                    {category}
                                </Typography>
                            )}
                            <Grid container spacing={{ xs: 2.5, md: 3 }}>
                                {vids.map((v) => (
                                    <Grid item xs={12} sm={6} md={4} key={v.id}>
                                        <VideoCard video={v} />
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
