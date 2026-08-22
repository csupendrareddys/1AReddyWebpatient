/**
 * Public module landing — card grid of every visible feature under one
 * dynamic landing module, plus the module's FAQ.
 *
 * The universal navbar + footer come from :class:`PublicLandingLayout`. This
 * file only renders the body. The "Back" button is gone — users navigate via
 * the shared navbar instead, so navigation is consistent with the rest of
 * the public landing tree.
 *
 * The grid groups by the same feature categories the navbar dropdown uses —
 * this page is where "View All Services" lands from that dropdown, so arriving
 * to one undifferentiated wall of cards after browsing a grouped menu would
 * lose the structure the visitor just used. A module whose features carry no
 * category renders the plain grid, exactly as before.
 */
import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box, Container, Typography, Grid2 as Grid, Paper, Button, Chip, Alert,
    CircularProgress, Stack, Accordion, AccordionSummary, AccordionDetails,
    useTheme, alpha, Avatar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useGetPublicModuleQuery } from '../../features/admin/api/landingPageConfigEndpoints';
import { useGetPublicPlatformLandingModuleQuery } from '../../features/admin/api/platformLandingEndpoints';
import { useLanguage } from '../../common/i18n';
import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import VideosSection from '../../common/components/VideoSection/VideosSection';
import ImageSection from '../../common/components/ImageSection/ImageSection';
import { groupByCategory, UNCATEGORISED } from '../../common/components/MegaMenu/featureCategories';

/**
 * One service card. Lifted out of the grid so the flat and the grouped
 * layouts render an identical card — a service must not look different
 * depending on whether its siblings happen to be categorised.
 */
function FeatureCard({ feature: f, theme, onOpen }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 3, borderRadius: 3, height: '100%',
                bgcolor: '#fff',
                border: '1px solid', borderColor: 'grey.100',
                display: 'flex', flexDirection: 'column',
                transition: 'all 0.25s',
                cursor: 'pointer',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: `0 14px 36px ${alpha(theme.palette.primary.main, 0.15)}`,
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                },
            }}
            onClick={onOpen}
        >
            {f.logo_url && (
                <Avatar
                    src={f.logo_url}
                    variant="rounded"
                    sx={{ width: 56, height: 56, mb: 2, bgcolor: 'grey.50', p: 0.5 }}
                />
            )}
            <Typography variant="h6" fontWeight={700} gutterBottom>
                {f.title}
            </Typography>
            {f.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.65 }}>
                    {f.description}
                </Typography>
            )}
            <Stack
                direction="row" spacing={1}
                sx={{ mb: 2.5, flexWrap: 'wrap', gap: 0.5 }}
            >
                {f.starting_price && (
                    <Chip
                        label={`Starts ${f.starting_price}`}
                        size="small" color="success" variant="outlined"
                    />
                )}
                {f.timeline && (
                    <Chip label={f.timeline} size="small" variant="outlined" />
                )}
            </Stack>
            <Box sx={{ mt: 'auto' }}>
                <Button
                    fullWidth variant="contained"
                    endIcon={<ArrowForwardIcon />}
                    onClick={(e) => { e.stopPropagation(); onOpen(); }}
                    sx={{ textTransform: 'none', fontWeight: 700, py: 1.25 }}
                >
                    {f.book_cta_label || 'Get Started'}
                </Button>
            </Box>
        </Paper>
    );
}

export default function ModulePage() {
    return (
        <PublicLandingLayout>
            {({ isMarketingLanding, landingData }) => (
                <ModulePageContent
                    isMarketingLanding={isMarketingLanding}
                    // The nav-hierarchy setting lives on the landing config
                    // root, which this page never fetches — it loads one
                    // module by slug. Taken off the layout's tree instead, so
                    // arriving here from a grouped dropdown lands on a grouped
                    // page and a flat one on a flat page.
                    navHierarchy={landingData?.nav_hierarchy || 'three_level'}
                />
            )}
        </PublicLandingLayout>
    );
}

function ModulePageContent({ isMarketingLanding = false, navHierarchy = 'three_level' }) {
    const { moduleSlug } = useParams();
    const navigate = useNavigate();
    const theme = useTheme();
    const landing = theme.palette.landing || {};
    const { lang } = useLanguage();
    const [searchParams] = useSearchParams();
    const mode = searchParams.get('mode') || 'live';
    // ``null`` = show every category, each under its own heading. Naming one
    // narrows the grid to it. Declared here with the other hooks — the
    // loading / not-found returns below are early exits.
    const [activeCategory, setActiveCategory] = useState(null);

    // Apex (marketing) reads the schema-separated platform module table —
    // where the platform_owner's edits live. Without this branch, the apex
    // would still query the per-tenant module table and report "Module not
    // found" even though the module exists in platform_landing_modules.
    const tenantQ = useGetPublicModuleQuery(
        { slug: moduleSlug, lang, mode },
        { skip: !moduleSlug || isMarketingLanding },
    );
    const platformQ = useGetPublicPlatformLandingModuleQuery(
        { slug: moduleSlug, lang, mode },
        { skip: !moduleSlug || !isMarketingLanding },
    );
    const module = isMarketingLanding ? platformQ.data : tenantQ.data;
    const isLoading = isMarketingLanding ? platformQ.isLoading : tenantQ.isLoading;
    const error = isMarketingLanding ? platformQ.error : tenantQ.error;

    if (isLoading) {
        return (
            <Box sx={{ minHeight: '60vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error || !module) {
        return (
            <Container maxWidth="md" sx={{ py: 8 }}>
                <Alert severity="error">Module not found.</Alert>
            </Container>
        );
    }

    const sections = module.sections_enabled_json || { hero: true, features_grid: true, faq: true };
    const features = (module.features || []).filter((f) => f.is_visible);
    // ``null`` when the operator chose a two-level nav, or when no feature
    // carries a category — the grid then renders flat, with no filter row and
    // no headings.
    const featureGroups = navHierarchy === 'two_level'
        ? null
        : groupByCategory(features);
    const shownGroups = featureGroups
        ? featureGroups.filter((g) => activeCategory === null || g.name === activeCategory)
        : [];
    const faq = module.faq_json || [];
    const vids = module?.vid_json || [];
    const imgs = module?.img_json || [];

    return (
        <Box>
            {/* ═══════════ Module hero ═══════════ */}
            {sections.hero !== false && (
                <Box
                    sx={{
                        py: { xs: 5, md: 10 }, px: { xs: 2, sm: 3 },
                        background: `linear-gradient(180deg, ${landing.heroFrom || '#f8faff'} 0%, ${landing.heroTo || '#fff'} 100%)`,
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    {/* Decorative blob in the corner — kept inside the box
                        thanks to ``overflow: hidden`` on the parent. Its
                        offset is small enough that on a 320px mobile viewport
                        the blob still doesn't reach the visible area. */}
                    <Box
                        sx={{
                            position: 'absolute', top: -100, right: -40,
                            width: { xs: 200, md: 350 }, height: { xs: 200, md: 350 },
                            borderRadius: '50%',
                            bgcolor: alpha(theme.palette.primary.main, 0.08),
                            filter: 'blur(60px)',
                            pointerEvents: 'none',
                        }}
                    />
                    <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
                        <Grid
                            container
                            spacing={4}
                            alignItems="center"
                            justifyContent="center"
                        >
                            {/* Logo */}
                            {module.logo_url && (
                                <Grid size="auto">
                                    <Avatar
                                        src={module.logo_url}
                                        variant="rounded"
                                        sx={{
                                            width: 96,
                                            height: 96,
                                            bgcolor: '#fff',
                                            boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                            p: 1,
                                        }}
                                    />
                                </Grid>
                            )}

                            {/* Content */}
                            <Grid size={{ xs: 12, md: 8 }}>
                                <Box sx={{ textAlign: { xs: 'center'} }}>
                                    <Chip
                                        label="MODULE"
                                        size="small"
                                        sx={{
                                            mb: 1.5,
                                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                                            color: 'primary.main',
                                            fontWeight: 700,
                                            letterSpacing: 1.5,
                                            fontSize: '0.65rem',
                                        }}
                                    />

                                    <Typography
                                        variant="h2"
                                        fontWeight={800}
                                        sx={{
                                            mb: 1.5,
                                            letterSpacing: '-0.02em',
                                            lineHeight: 1.15,
                                            fontSize: {
                                                xs: '1.85rem',
                                                sm: '2.5rem',
                                                md: '3rem',
                                            },
                                        }}
                                    >
                                        {module.name}
                                    </Typography>

                                    {module.description && (
                                        <Typography
                                            variant="h6"
                                            color="text.secondary"
                                            fontWeight={400}
                                            sx={{
                                                lineHeight: 1.6,
                                                fontSize: { xs: '1rem', md: '1.15rem' },
                                            }}
                                        >
                                            {module.description}
                                        </Typography>
                                    )}

                                    <Stack
                                        direction="row"
                                        justifyContent="center"
                                        sx={{ mt: 2.5 }}
                                    >
                                        <Chip
                                            label={`${features.length} service${features.length === 1 ? '' : 's'}`}
                                            size="small"
                                            sx={{
                                                bgcolor: '#fff',
                                                border: '1px solid',
                                                borderColor: 'grey.200',
                                            }}
                                        />
                                    </Stack>
                                </Box>
                            </Grid>
                        </Grid>
                    </Container>
                </Box>
            )}

            {/* ═══════════ Features grid ═══════════ */}
            {sections.features_grid !== false && (
                <Box sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: '#fafbfc' }}>
                    <Container maxWidth="lg">
                        <Box sx={{ textAlign: 'center', mb: 6 }}>
                            <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.02em', mb: 1 }}>
                                Browse our services
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                Choose a service below to see full details, requirements and pricing.
                            </Typography>
                        </Box>

                        {/* The filter row — the same categories the navbar
                            dropdown groups by. Absent for a module with no
                            categorised features, which then reads exactly as
                            it did before this existed. */}
                        {featureGroups && (
                            <Stack
                                direction="row" spacing={1} justifyContent="center"
                                flexWrap="wrap" useFlexGap sx={{ mb: 5 }}
                            >
                                <Chip
                                    label={`All · ${features.length}`}
                                    onClick={() => setActiveCategory(null)}
                                    color={activeCategory === null ? 'primary' : 'default'}
                                    variant={activeCategory === null ? 'filled' : 'outlined'}
                                    sx={{ fontWeight: 600 }}
                                />
                                {featureGroups.map((g) => (
                                    <Chip
                                        key={g.name}
                                        label={`${g.name} · ${g.items.length}`}
                                        onClick={() => setActiveCategory(g.name)}
                                        color={activeCategory === g.name ? 'primary' : 'default'}
                                        variant={activeCategory === g.name ? 'filled' : 'outlined'}
                                        sx={{ fontWeight: 600 }}
                                    />
                                ))}
                            </Stack>
                        )}

                        {features.length === 0 && (
                            <Alert severity="info">No features are currently available in this module.</Alert>
                        )}

                        {features.length > 0 && !featureGroups && (
                            <Grid container spacing={3} justifyContent="center">
                                {features.map((f) => (
                                    <Grid key={f.id} size={{ xs: 12, sm: 6, md: 4 }}>
                                        <FeatureCard
                                            feature={f}
                                            theme={theme}
                                            onOpen={() => navigate(`/service/${encodeURIComponent(f.slug)}`)}
                                        />
                                    </Grid>
                                ))}
                            </Grid>
                        )}

                        {featureGroups && shownGroups.map((group) => (
                            <Box key={group.name} sx={{ mb: 6, '&:last-of-type': { mb: 0 } }}>
                                {/* The heading is dropped when the visitor has
                                    filtered to a single category — the chip
                                    above already says which one, and repeating
                                    it reads as a second level that isn't there. */}
                                {activeCategory === null && (
                                    <Stack
                                        direction="row" alignItems="center" spacing={2}
                                        sx={{ mb: 3 }}
                                    >
                                        <Typography
                                            variant="h6" fontWeight={800}
                                            sx={{ letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
                                        >
                                            {group.name === UNCATEGORISED
                                                ? `More from ${module.name}`
                                                : group.name}
                                        </Typography>
                                        <Box sx={{
                                            flexGrow: 1, height: '1px',
                                            bgcolor: alpha(theme.palette.primary.main, 0.18),
                                        }} />
                                        <Typography variant="caption" color="text.secondary"
                                            sx={{ whiteSpace: 'nowrap' }}>
                                            {group.items.length} service{group.items.length === 1 ? '' : 's'}
                                        </Typography>
                                    </Stack>
                                )}
                                <Grid container spacing={3} justifyContent="center">
                                    {group.items.map((f) => (
                                        <Grid key={f.id} size={{ xs: 12, sm: 6, md: 4 }}>
                                            <FeatureCard
                                                feature={f}
                                                theme={theme}
                                                onOpen={() => navigate(`/service/${encodeURIComponent(f.slug)}`)}
                                            />
                                        </Grid>
                                    ))}
                                </Grid>
                            </Box>
                        ))}
                    </Container>
                </Box>
            )}
            {/* ═══════════ VIDEO GALLERY STRIP ═══════════
                       Up to 3 visible videos as embedded thumbnails. When the tenant
                       has more than 3 visible videos a "More" CTA appears below the
                       strip linking to the dedicated /gallery/videos page. */}
            {vids && (
                <VideosSection
                isMarketingLanding={isMarketingLanding}
                inlineItems={vids.videos}
                />
            )}
            {/* == IMAGE CAROUSEL == */}
            {/* img_json is shaped { images: [...] } (same as vid_json's
                { videos: [...] }); pass the array, not the wrapper object. */}
            {imgs?.images && (<ImageSection images={imgs.images} />)}

            {/* ═══════════ FAQ ═══════════ */}
            {sections.faq !== false && faq.length > 0 && (
                <Box sx={{ py: { xs: 6, md: 10 }, px: 2 }}>
                    <Container maxWidth="md">
                        <Typography variant="h4" fontWeight={800} textAlign="center" sx={{ mb: 1 }}>
                            Frequently Asked Questions
                        </Typography>
                        <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 5 }}>
                            Everything you need to know about the process.
                        </Typography>
                        {faq.map((item, i) => (
                            <Accordion
                                key={i}
                                disableGutters elevation={0}
                                sx={{
                                    bgcolor: '#fff',
                                    border: '1px solid', borderColor: 'grey.100',
                                    borderRadius: '12px !important',
                                    mb: 2,
                                    '&::before': { display: 'none' },
                                    overflow: 'hidden',
                                }}
                            >
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 3, py: 1 }}>
                                    <Typography fontWeight={600}>{item.question}</Typography>
                                </AccordionSummary>
                                <AccordionDetails sx={{ px: 3, pb: 3 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                                        {item.answer}
                                    </Typography>
                                </AccordionDetails>
                            </Accordion>
                        ))}
                    </Container>
                </Box>
            )}
        </Box>
    );
}
