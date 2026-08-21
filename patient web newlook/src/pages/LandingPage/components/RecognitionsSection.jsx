/**
 * RecognitionsSection — accreditations / certifications carousel.
 *
 * Renders directly below the hero on the public landing page. Hidden when
 * the tenant has no visible recognitions so the page never shows an empty
 * "Recognized by" header.
 *
 * Each card: uploaded logo + title + (optional subtitle) + (optional
 * description). The carousel auto-rotates every 5s and pauses on hover —
 * matching the testimonials rhythm so the page feels coherent.
 */
import { Box, Container, Typography, Avatar, useTheme, alpha, Skeleton } from '@mui/material';
import Carousel from '../../../common/components/Carousel/Carousel';
import { useGetPublicRecognitionsQuery } from '../../../features/admin/api/landingPageConfigEndpoints';
import { useGetPublicPlatformLandingRecognitionsQuery } from '../../../features/admin/api/platformLandingEndpoints';

export default function RecognitionsSection({
    isMarketingLanding = false,
    inlineItems,
}) {
    const theme = useTheme();
    // When the editor's preview iframe mounts us, the layout already
    // has the right draft/preview/live config row from the platform
    // summary endpoint with recognitions inlined — use those directly
    // so DRAFT and PREVIEW iframes show the carousel state the user
    // is editing, instead of always serving LIVE via the public path.
    const haveInline = Array.isArray(inlineItems);
    // Apex (marketing) reads from the schema-separated platform recognitions
    // table — that's where the platform_owner's edits land. Tenant
    // subdomains keep using the per-tenant table. Public fetch only fires
    // when we don't already have inline items from the layout.
    const platformQ = useGetPublicPlatformLandingRecognitionsQuery(
        undefined, { skip: !isMarketingLanding || haveInline },
    );
    const tenantQ = useGetPublicRecognitionsQuery(
        undefined, { skip: isMarketingLanding || haveInline },
    );
    const items = haveInline
        ? inlineItems.filter((r) => r.is_visible !== false)
        : ((isMarketingLanding ? platformQ.data : tenantQ.data) || []);
    const isLoading = haveInline
        ? false
        : (isMarketingLanding ? platformQ.isLoading : tenantQ.isLoading);

    // Empty state — render nothing rather than a "no recognitions yet"
    // placeholder. Tenants who haven't configured this should look like the
    // section doesn't exist on their site.
    if (!isLoading && items.length === 0) return null;

    return (
        <Box
            component="section"
            sx={{
                py: { xs: 5, md: 8 },
                px: { xs: 2, sm: 3 },
                bgcolor: '#fff',
                overflow: 'hidden',
            }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 5 } }}>
                    <Typography
                        variant="overline"
                        sx={{
                            color: 'primary.main', fontWeight: 700,
                            letterSpacing: 2, fontSize: '0.7rem',
                        }}
                    >
                        Recognitions
                    </Typography>
                    <Typography
                        variant="h4" fontWeight={800}
                        sx={{
                            mt: 1, letterSpacing: '-0.02em',
                            fontSize: { xs: '1.5rem', sm: '1.85rem', md: '2.125rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        Recognized & accredited by
                    </Typography>
                </Box>

                {isLoading ? (
                    <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                        {[0, 1, 2].map((i) => (
                            <Skeleton
                                key={i} variant="rounded"
                                width={240} height={160}
                                sx={{ borderRadius: 3, display: { xs: i > 0 ? 'none' : 'block', md: 'block' } }}
                            />
                        ))}
                    </Box>
                ) : (
                    <Carousel
                        autoPlayMs={5000}
                        itemMinWidth={{ xs: '85%', sm: '46%', md: '31%' }}
                    >
                        {items.map((r) => (
                            <RecognitionCard key={r.id} item={r} theme={theme} />
                        ))}
                    </Carousel>
                )}
            </Container>
        </Box>
    );
}

// ---------------------------------------------------------------------------

function RecognitionCard({ item, theme }) {
    return (
        <Box
            sx={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', textAlign: 'center',
                p: { xs: 3, md: 3.5 },
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'grey.100',
                bgcolor: '#fff',
                height: '100%',
                transition: 'all 0.3s',
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    boxShadow: `0 12px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
                    transform: 'translateY(-4px)',
                },
            }}
        >
            {item.logo_url ? (
                <Avatar
                    src={item.logo_url}
                    variant="rounded"
                    alt={item.title}
                    sx={{
                        width: 96, height: 96, mb: 2,
                        bgcolor: 'grey.50', p: 1,
                        // ``object-fit: contain`` — logos shouldn't be cropped
                        // even if they're not square. ``img`` is the inner
                        // element MUI's Avatar renders.
                        '& img': { objectFit: 'contain' },
                    }}
                />
            ) : (
                <Box
                    sx={{
                        width: 96, height: 96, borderRadius: 2, mb: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: 'primary.main',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '2.25rem',
                    }}
                >
                    {(item.title || '?').charAt(0).toUpperCase()}
                </Box>
            )}

            <Typography
                variant="subtitle1" fontWeight={700}
                sx={{
                    mb: item.subtitle || item.description ? 0.5 : 0,
                    wordBreak: 'break-word',
                }}
            >
                {item.title}
            </Typography>

            {item.subtitle && (
                <Typography
                    variant="caption" color="primary.main" fontWeight={600}
                    sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                    {item.subtitle}
                </Typography>
            )}

            {item.description && (
                <Typography
                    variant="body2" color="text.secondary"
                    sx={{ lineHeight: 1.65 }}
                >
                    {item.description}
                </Typography>
            )}
        </Box>
    );
}
