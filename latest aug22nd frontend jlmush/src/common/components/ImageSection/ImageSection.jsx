import { useState } from 'react';
import {
    Box,
    Container,
    Typography,
    Grid2 as Grid,
    Button,
    useTheme,
    alpha,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

// Matches VideosSection's strip: three across on md, the rest behind "More".
const STRIP_LIMIT = 3;

export default function ImageSection({ images = [] }) {
    const theme = useTheme();
    // Unlike the video strip, there's no /gallery/images route to hand off to
    // — these images are inline-only (module/feature ``img_json``), so "More"
    // expands in place rather than navigating.
    const [expanded, setExpanded] = useState(false);

    // ``images`` comes from free-form landing config (``module.img_json`` /
    // ``content.imgs``). A ``|| []`` at the call site only guards ``undefined``
    // — a persisted object (e.g. ``{}``) is truthy and reaches here as a
    // non-array, crashing ``.filter`` (``a.filter is not a function``). Coerce
    // defensively so a malformed value renders nothing instead of white-screening
    // the page.
    const safeImages = Array.isArray(images) ? images : [];
    const visibleImages = safeImages.filter((img) => img && img.image_url);

    if (visibleImages.length === 0) return null;

    const shownImages = expanded ? visibleImages : visibleImages.slice(0, STRIP_LIMIT);
    const showMore = visibleImages.length > STRIP_LIMIT;

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
                        Gallery
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
                        Image Gallery
                    </Typography>

                    <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{ mt: 1, fontSize: { xs: '0.95rem', md: '1rem' } }}
                    >
                        Browse photos from our facilities, services, and events.
                    </Typography>
                </Box>

                <Grid container spacing={{ xs: 2.5, md: 3 }}>
                    {shownImages.map((image, idx) => (
                        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={image.id || idx}>
                            <Box
                                sx={{
                                    borderRadius: 3,
                                    overflow: 'hidden',
                                    aspectRatio: '16 / 9',
                                    bgcolor: 'grey.100',
                                    border: '1px solid',
                                    borderColor: 'grey.200',
                                }}
                            >
                                <Box
                                    component="img"
                                    src={image.image_url}
                                    alt={image.alt_text || `Gallery image ${idx + 1}`}
                                    loading="lazy"
                                    sx={{
                                        width: '100%',
                                        height: '100%',
                                        display: 'block',
                                        objectFit: 'cover',
                                    }}
                                />
                            </Box>
                        </Grid>
                    ))}
                </Grid>

                {showMore && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: { xs: 4, md: 5 } }}>
                        <Button
                            variant="outlined"
                            size="large"
                            endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            onClick={() => setExpanded((prev) => !prev)}
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
                            {expanded
                                ? 'Show less'
                                : `More images (${visibleImages.length - STRIP_LIMIT} more)`}
                        </Button>
                    </Box>
                )}
            </Container>
        </Box>
    );
}
