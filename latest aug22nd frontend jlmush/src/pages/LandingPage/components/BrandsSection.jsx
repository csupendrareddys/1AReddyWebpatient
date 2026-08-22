/**
 * BrandsSection — "Trusted by global brands" logo marquee.
 *
 * Renders directly above the footer. Logo-only continuous slide rather
 * than a paged carousel (no arrows, no dots) — the brand strip should
 * feel like a passive, ambient element, not an interactive widget.
 *
 * The animation is pure CSS keyframes that translate the row from 0 to
 * -50%; we duplicate the logo list so the loop is seamless. ``hover``
 * pauses the animation so users who want to read a logo can.
 *
 * Section heading falls back to "Trusted by Global Brands" when
 * ``landingData.brands_section_title`` is empty.
 */
import { Box, Container, Typography, Skeleton, useTheme, alpha } from '@mui/material';
import { useGetPublicTrustedBrandsQuery } from '../../../features/admin/api/landingPageConfigEndpoints';

export default function BrandsSection({ sectionTitle }) {
    const theme = useTheme();
    const { data: items = [], isLoading } = useGetPublicTrustedBrandsQuery();

    if (!isLoading && items.length === 0) return null;

    return (
        <Box
            component="section"
            sx={{ py: { xs: 5, md: 7 }, px: { xs: 2, sm: 3 }, bgcolor: '#fafbfc', overflow: 'hidden' }}
        >
            <Container maxWidth="lg">
                <Box sx={{ textAlign: 'center', mb: { xs: 3, md: 4 } }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2, fontSize: '0.7rem' }}
                    >
                        Partners
                    </Typography>
                    <Typography
                        variant="h5" fontWeight={800}
                        sx={{
                            mt: 0.5, letterSpacing: '-0.02em',
                            fontSize: { xs: '1.4rem', sm: '1.65rem', md: '1.75rem' },
                            wordBreak: 'break-word',
                        }}
                    >
                        {sectionTitle || 'Trusted by Global Brands'}
                    </Typography>
                </Box>

                {isLoading ? (
                    <Box sx={{ display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                        {[0, 1, 2, 3, 4].map((i) => (
                            <Skeleton
                                key={i} variant="rounded" width={120} height={50}
                                sx={{ borderRadius: 1, opacity: 0.5 }}
                            />
                        ))}
                    </Box>
                ) : (
                    <BrandMarquee items={items} theme={theme} />
                )}
            </Container>
        </Box>
    );
}

// ---------------------------------------------------------------------------

function BrandMarquee({ items, theme }) {
    // Duplicate the list so the keyframe can translate from 0 to -50%
    // without revealing a gap at the seam.
    const doubled = [...items, ...items];

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                overflow: 'hidden',
                // Soft fade on the edges so logos feel like they're
                // sliding in/out of an ambient strip rather than abruptly
                // appearing.
                maskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    gap: { xs: 5, md: 7 },
                    alignItems: 'center',
                    width: 'max-content',
                    animation: 'brand-marquee 35s linear infinite',
                    '&:hover': { animationPlayState: 'paused' },
                    '@keyframes brand-marquee': {
                        '0%': { transform: 'translateX(0)' },
                        '100%': { transform: 'translateX(-50%)' },
                    },
                }}
            >
                {doubled.map((b, idx) => (
                    <BrandLogo key={`${b.id}-${idx}`} brand={b} theme={theme} />
                ))}
            </Box>
        </Box>
    );
}

function BrandLogo({ brand, theme }) {
    // Slightly desaturated logos by default so the strip feels
    // cohesive; saturate on hover to draw attention without it being
    // visually noisy at rest.
    const inner = brand.logo_url ? (
        <Box
            component="img"
            src={brand.logo_url}
            alt={brand.name}
            sx={{
                height: { xs: 32, md: 44 },
                maxWidth: { xs: 120, md: 160 },
                objectFit: 'contain',
                filter: 'grayscale(0.4) opacity(0.85)',
                transition: 'filter 0.3s, transform 0.3s',
                '&:hover': {
                    filter: 'grayscale(0) opacity(1)',
                    transform: 'scale(1.05)',
                },
            }}
        />
    ) : (
        <Typography
            variant="h6" fontWeight={700}
            sx={{
                color: alpha(theme.palette.text.primary, 0.55),
                whiteSpace: 'nowrap',
                px: 2,
            }}
        >
            {brand.name}
        </Typography>
    );

    if (brand.link_url) {
        return (
            <Box
                component="a"
                href={brand.link_url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                    display: 'inline-flex', alignItems: 'center',
                    flexShrink: 0,
                    textDecoration: 'none',
                }}
            >
                {inner}
            </Box>
        );
    }
    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            {inner}
        </Box>
    );
}
