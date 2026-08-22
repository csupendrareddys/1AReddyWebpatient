import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Typography,
  Button,
  Container,
  Box,
  Stack,
  Grid2 as Grid,
  InputBase,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  CheckCircleOutline,
  FormatQuoteRounded,
  ExpandMore,
  ExpandLess,
  ArrowForward,
} from '@mui/icons-material';


import ServiceCard from '../../common/components/ServiceCard/ServiceCard';
import Carousel from '../../common/components/Carousel/Carousel';
import RecognitionsSection from './components/RecognitionsSection';
import VideosSection from './components/VideosSection';
import DoctorsSection from './components/DoctorsSection';
import LandingBookingSection from '../public/LandingBookingSection';
import { useGetPublicSpecializationsQuery } from '../../features/publicBooking/publicBookingApi';
import ReviewsSection from './components/ReviewsSection';
import BrandsSection from './components/BrandsSection';
// ``STATS``/``TESTIMONIALS``/``FAQS`` are marketing content that stays
// hardcoded for now — they're the same across tenants. Module navigation and
// the services grid are fully tenant-driven and no longer fall back to
// ``PRODUCT_CATEGORIES`` / ``HOSPITAL_SERVICES`` — viewers never see data a
// tenant hasn't actually published.
import {
  STATS,
  TESTIMONIALS,
  FAQS,
} from '../../data/hospitalServices';
import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import JoinNetworkBand from './components/JoinNetworkBand';
import { isSectionVisible } from './sectionVisibility';

// ─────────────────── Landing Page ───────────────────
// Navbar / footer / per-tenant theme are owned by ``PublicLandingLayout`` —
// this component only renders the homepage's body sections. The layout
// passes us ``landingData`` so we don't fire a duplicate API call.
export default function LandingPage() {
  return (
    <PublicLandingLayout>
      {({ landingData, isMarketingLanding }) => (
        <LandingPageContent
          landingData={landingData}
          isMarketingLanding={isMarketingLanding}
        />
      )}
    </PublicLandingLayout>
  );
}

function LandingPageContent({ landingData, isMarketingLanding = false }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const landing = theme.palette.landing || {};
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFaq, setExpandedFaq] = useState(false);
  // The services grid is capped at two rows (3-up on md) until the visitor
  // asks for the rest — a tenant with many published features would otherwise
  // push everything below it off the first screen.
  const [showAllServices, setShowAllServices] = useState(false);
  const servicesRef = useRef(null);

  const visibleModules = (landingData?.modules || []).filter((m) => m.is_visible);
  const hasLiveModules = visibleModules.length > 0;

  // Booking-slide gate — the widget itself renders null when there are no
  // specializations (no doctors), but its carousel wrapper would still be a
  // truthy child and leave an empty slide. Mirror the widget's own null
  // condition here (show while loading — the consultation cards are static —
  // and drop the slide only once we confirm zero doctors) so the slide is
  // omitted entirely rather than rendered blank.
  const { data: bookingSpecializations = [], isLoading: bookingLoading } =
    useGetPublicSpecializationsQuery();
  const hasBookingSlide = bookingLoading || bookingSpecializations.length > 0;

  // Flatten every visible feature across every visible module into the
  // services-grid shape. v1 returned a flat ``features`` array; v2 nests
  // features under modules so we walk the tree.
  const apiServices = (landingData?.modules || [])
    .filter((m) => m.is_visible)
    .flatMap((m) =>
      (m.features || [])
        .filter((f) => f.is_visible)
        .map((f) => ({
          id: f.id,
          slug: f.slug,
          title: f.title,
          desc: f.description,
          tags: [],
          price: f.starting_price,
          color: null,
          icon: null,
          moduleName: m.name,
          is_popular: !!f.is_popular,
        })),
    );
  const servicesSource = apiServices;

  // Featured slider (the third sliding bar): every module + feature the admin
  // flagged ``show_in_slider`` in the landing config. Each slide links to its
  // own page — modules → /module/<slug>, services → /service/<slug>.
  const sliderItems = [
    ...(landingData?.modules || [])
      .filter((m) => m.show_in_slider)
      .map((m) => ({
        key: `m-${m.slug}`, kind: 'Module', label: m.name,
        logo: m.logo_url, to: `/module/${encodeURIComponent(m.slug)}`,
      })),
    ...(landingData?.modules || []).flatMap((m) =>
      (m.features || [])
        .filter((f) => f.show_in_slider)
        .map((f) => ({
          key: `f-${f.slug}`, kind: 'Service', label: f.title,
          logo: f.logo_url, to: `/service/${encodeURIComponent(f.slug)}`,
        })),
    ),
  ];

  const filteredServices = searchQuery
    ? servicesSource.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.tags || []).some((t) => (t || '').toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : servicesSource;

  const SERVICES_PREVIEW_COUNT = 6;
  // Features flagged ``is_popular`` render up-front; everything else sits
  // behind the "More" toggle. When the tenant hasn't flagged any feature as
  // popular we fall back to the historical first-N slice so the grid is never
  // empty. Search still applies to the whole set before the split.
  const popularServices = filteredServices.filter((s) => s.is_popular);
  const hasPopularFlags = popularServices.length > 0;

  const previewServices = hasPopularFlags
    ? popularServices
    : filteredServices.slice(0, SERVICES_PREVIEW_COUNT);
  const overflowServices = hasPopularFlags
    ? filteredServices.filter((s) => !s.is_popular)
    : filteredServices.slice(SERVICES_PREVIEW_COUNT);

  const visibleServices = showAllServices
    ? [...previewServices, ...overflowServices]
    : previewServices;
  const hasMoreServices = overflowServices.length > 0;

  const handleServiceClick = (serviceName) => {
    navigate(`/service/${encodeURIComponent(serviceName)}`);
  };

  // Clicking a top-nav module header navigates to its dedicated module page.
  // Static fallback categories (no matching module slug) scroll to the
  // services section — same as before for legacy tenants.
  const handleCategoryClick = (categoryId) => {
    const module = (landingData?.modules || []).find((m) => m.name === categoryId);
    if (module?.slug) {
      navigate(`/module/${encodeURIComponent(module.slug)}`);
      return;
    }
    if (servicesRef.current) {
      servicesRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    if (e.target.value && servicesRef.current) {
      servicesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <Box>
      {/* ═══════════ TOP CAROUSEL: HERO + BOOKING ═══════════
           The hero image/search section and the public "Book a slot" widget
           are two full-width, auto-rotating slides. Booking is only a slide
           when visible (``.filter(Boolean)`` drops it otherwise so there's no
           empty slide). */}
      <Carousel
        itemMinWidth={{ xs: '100%', sm: '100%', md: '100%' }}
        autoPlayMs={7000}
        gap={0}
      >
      {[
        (
      <Box
        key="hero"
        sx={{
          position: 'relative',
          pt: { xs: 6, md: 12 },
          pb: { xs: 8, md: 16 },
          px: { xs: 2, sm: 3 },
          textAlign: 'center',
          overflow: 'hidden',
          background: landing.heroStyle === 'solid'
            ? landing.heroFrom || '#f8faff'
            : landing.heroStyle === 'pattern'
              ? `radial-gradient(circle at 20% 20%, ${alpha(theme.palette.primary.main, 0.08)} 0%, transparent 40%), radial-gradient(circle at 80% 60%, ${alpha(theme.palette.secondary.main, 0.08)} 0%, transparent 40%), ${landing.heroFrom || '#f8faff'}`
              : `linear-gradient(180deg, ${landing.heroFrom || '#f8faff'} 0%, ${landing.heroTo || '#fff'} 100%)`,
        }}
      >
        {/* Decorative shapes — themed off the user's primary/accent so the
            hero feels related to the rest of the palette in custom mode.
            ``translateX`` was previously 80px outward, which pushed the
            decoration past the right edge and triggered horizontal overflow
            on narrow viewports / inside the preview iframe. */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '40%',
            height: '100%',
            background: `linear-gradient(225deg, ${alpha(theme.palette.primary.main, 0.18)} 0%, transparent 100%)`,
            transform: 'skewX(-20deg)',
            opacity: 0.85,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: { xs: 180, md: 350 },
            height: { xs: 180, md: 350 },
            bgcolor: alpha(landing.accent || theme.palette.secondary.main, 0.25),
            borderRadius: '50%',
            filter: 'blur(100px)',
            opacity: 0.5,
          }}
        />

        <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1 }}>
          {/* Trust Badge */}
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              bgcolor: '#fff',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.25),
              borderRadius: 5,
              px: 2,
              py: 0.75,
              mb: 4,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <Box
              sx={{
                position: 'relative',
                width: 8,
                height: 8,
                mr: 1.5,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  bgcolor: '#4caf50',
                  animation: 'pulse 2s infinite',
                },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  bgcolor: '#4caf50',
                },
                '@keyframes pulse': {
                  '0%': { transform: 'scale(1)', opacity: 0.7 },
                  '50%': { transform: 'scale(2.5)', opacity: 0 },
                  '100%': { transform: 'scale(1)', opacity: 0 },
                },
              }}
            />
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1.5, textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {landingData?.trust_badge_text || 'Trusted by 10,000+ Patients'}
            </Typography>
          </Box>

          {/* Headline */}
          <Typography
            variant="h2"
            component="h1"
            fontWeight={800}
            sx={{
              // 2rem on xs is safer for very long tenant names — at 2.5rem,
              // headlines like "Sole Proprietorship Registration" overflow
              // a 360px viewport. Scale up at sm/md for desktop emphasis.
              fontSize: { xs: '2rem', sm: '2.75rem', md: '4rem' },
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              mb: 3,
              // Long single words (e.g. brand names) shouldn't blow the line.
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {landingData?.hero_title || 'Healthcare,'}{' '}
            <Box
              component="span"
              sx={{
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {landingData?.hero_subtitle ? '' : 'Simplified.'}
            </Box>
          </Typography>
          {landingData?.hero_subtitle && (
            <Typography variant="h5" color="text.secondary" sx={{ mb: 3, fontWeight: 400 }}>
              {landingData.hero_subtitle}
            </Typography>
          )}

          {/* Body copy — admin-editable via ``hero_body_text``. Falls
              back to the historical marketing one-liner when null. */}
          <Typography
            variant="h6"
            color="text.secondary"
            fontWeight={300}
            sx={{ mb: 5, maxWidth: 600, mx: 'auto', lineHeight: 1.7, fontSize: { xs: '1rem', md: '1.25rem' } }}
          >
            {landingData?.hero_body_text
                || 'Book appointments, consult doctors online, get prescriptions, order medicines — all in one place.'}
          </Typography>

          {/* Search Bar */}
          <Box
            sx={{
              maxWidth: 520,
              mx: 'auto',
              mb: 6,
              position: 'relative',
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: -2,
                borderRadius: 3,
                background: 'linear-gradient(135deg, rgba(25,118,210,0.2), rgba(92,107,192,0.2))',
                filter: 'blur(8px)',
                opacity: 0.5,
                transition: 'opacity 0.4s',
              },
              '&:focus-within::before': { opacity: 1 },
            }}
          >
            <InputBase
              placeholder={
                  landingData?.hero_search_placeholder
                  || "Search 'Video Consultation' or 'Lab Tests'..."
              }
              value={searchQuery}
              onChange={handleSearch}
              sx={{
                position: 'relative',
                width: '100%',
                bgcolor: '#fff',
                border: '1px solid',
                borderColor: 'grey.200',
                borderRadius: 3,
                px: { xs: 2, md: 3 },
                py: { xs: 1.25, md: 2 },
                // 16px keeps iOS Safari from auto-zooming the viewport when
                // the field takes focus — anything smaller triggers it.
                fontSize: { xs: '1rem', md: '1.1rem' },
                boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                '&:focus-within': { borderColor: 'primary.main' },
              }}
              endAdornment={
                <IconButton onClick={() => servicesRef.current?.scrollIntoView({ behavior: 'smooth' })}>
                  <SearchIcon sx={{ color: 'grey.400' }} />
                </IconButton>
              }
            />
          </Box>

          {/* Partner Logos — admin-toggleable via section_visibility.hero_partners. */}
          {isSectionVisible(landingData, 'hero_partners') && (() => {
              const partners = Array.isArray(landingData?.hero_partners) && landingData.hero_partners.length > 0
                  ? landingData.hero_partners
                  : [{ name: 'Apollo' }, { name: 'AIIMS' }, { name: 'Fortis' }, { name: 'Max Healthcare' }];
              return (
                  <Stack
                    direction="row"
                    spacing={{ xs: 2.5, md: 5 }}
                    justifyContent="center"
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ opacity: 0.5, filter: 'grayscale(1)', transition: 'all 0.5s', '&:hover': { opacity: 0.8, filter: 'grayscale(0)' } }}
                  >
                    {partners.map((p, i) => (
                        p?.logo_url ? (
                            <Box
                              key={p.name || i}
                              component="img"
                              src={p.logo_url}
                              alt={p.name || `Partner ${i + 1}`}
                              sx={{ height: { xs: 24, md: 32 }, maxWidth: 120, width: 'auto', objectFit: 'contain' }}
                            />
                        ) : (
                            <Typography
                              key={p?.name || i}
                              variant="subtitle1" fontWeight={700} color="text.disabled"
                              sx={{ fontSize: { xs: '0.9rem', md: '1rem' } }}
                            >
                              {p?.name || ''}
                            </Typography>
                        )
                    ))}
                  </Stack>
              );
          })()}
        </Container>
      </Box>
        ),
        isSectionVisible(landingData, 'booking') && hasBookingSlide
          ? <Box key="book"><LandingBookingSection /></Box>
          : null,
        // ═══════════ FEATURED SLIDER (third sliding bar) ═══════════
        // Modules + services the admin flagged ``show_in_slider`` in the
        // landing config, rendered as a full-width slide *in order* right
        // after hero + booking (not a separate section below). Each card
        // links to its own page. Dropped from the slide rotation when
        // nothing is flagged.
        sliderItems.length > 0 ? (
          <Box
            key="featured"
            sx={{
              minHeight: '100%',
              py: { xs: 6, md: 10 }, px: { xs: 2, sm: 3 },
              display: 'flex', alignItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.03),
            }}
          >
            <Container maxWidth="lg">
              <Box sx={{ textAlign: 'center', mb: { xs: 3, md: 5 } }}>
                <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 2 }}>
                  Featured
                </Typography>
                <Typography
                  variant="h4" fontWeight={800}
                  sx={{
                    letterSpacing: '-0.02em',
                    fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                  }}
                >
                  Popular services &amp; modules
                </Typography>
              </Box>
              <Grid container spacing={{ xs: 2, md: 3 }} justifyContent="center">
                {sliderItems.map((item) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.key}>
                    <Box
                      onClick={() => navigate(item.to)}
                      sx={{
                        cursor: 'pointer', height: '100%', p: 3, borderRadius: 3,
                        border: '1px solid', borderColor: 'grey.100', bgcolor: '#fff',
                        transition: 'all 0.25s',
                        '&:hover': {
                          borderColor: alpha(theme.palette.primary.main, 0.4),
                          boxShadow: `0 12px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
                          transform: 'translateY(-3px)',
                        },
                      }}
                    >
                      <Stack direction="row" spacing={2} alignItems="center">
                        {item.logo ? (
                          <Box component="img" src={item.logo} alt={item.label}
                            sx={{ width: 48, height: 48, borderRadius: 2, objectFit: 'cover' }} />
                        ) : (
                          <Box sx={{
                            width: 48, height: 48, borderRadius: 2, flexShrink: 0,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'primary.main', fontWeight: 700,
                          }}>
                            {(item.label || '?').charAt(0)}
                          </Box>
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1, display: 'block' }}>
                            {item.kind}
                          </Typography>
                          <Typography variant="subtitle1" fontWeight={700} noWrap>
                            {item.label}
                          </Typography>
                        </Box>
                        <ArrowForward sx={{ ml: 'auto', color: 'primary.main' }} />
                      </Stack>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Container>
          </Box>
        ) : null,
      ].filter(Boolean)}
      </Carousel>

      {/* ═══════════ RECOGNITIONS ═══════════
           Carousel of accreditation / certification cards directly below
           the hero. Hides itself when the tenant has none configured. */}
      {/* When the editor's preview iframe loads us in platform-preview
          mode, landingData carries the right draft/preview/live row
          with recognitions inlined — pass those in so the section
          renders the lifecycle stage the user is previewing rather
          than always going to the LIVE-only public endpoint. */}
      {isSectionVisible(landingData, 'recognitions') && (
          <RecognitionsSection
            isMarketingLanding={isMarketingLanding}
            inlineItems={landingData?.recognitions}
          />
      )}

      {/* ═══════════ BROWSE BY CATEGORY ═══════════
           Tiles are driven by the tenant's published modules. When no module
           is live the section is omitted entirely — viewers never see a
           phantom category that doesn't actually map to anything. */}
      {isSectionVisible(landingData, 'categories') && hasLiveModules && (
        <Box sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: '#fff', overflow: 'hidden' }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
              <Typography
                variant="h4" fontWeight={800}
                sx={{
                  letterSpacing: '-0.02em', mb: 1,
                  fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                  wordBreak: 'break-word',
                }}
              >
                {landingData?.categories_section_title || 'Browse by Category'}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {landingData?.categories_section_subtitle || 'Select a service category to get started'}
              </Typography>
            </Box>

            <Grid container spacing={{ xs: 2, md: 3 }}>
              {(landingData?.modules || []).filter((m) => m.is_visible).map((mod, idx) => {
                // Rotate the accent stripe through primary / secondary /
                // accent so a tenant with many modules still gets visual
                // variety without the admin needing to pick a per-tile color.
                const stripeColors = [
                  theme.palette.primary.main,
                  theme.palette.secondary.main,
                  landing.accent || theme.palette.primary.light,
                ];
                const stripe = stripeColors[idx % stripeColors.length];
                return (
                  <Grid size={{ xs: 6, md: 3 }} key={mod.id}>
                    <Box
                      onClick={() => handleCategoryClick(mod.name)}
                      sx={{
                        position: 'relative',
                        bgcolor: '#fff', borderRadius: 4,
                        // Two tiles per row on xs leaves each ~112px wide at
                        // 360px — 24px of inner padding each side left almost
                        // no room for the module name. Scale it down on mobile.
                        p: { xs: 2, md: 3 },
                        border: '1px solid', borderColor: 'grey.100',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                        cursor: 'pointer', textAlign: 'center',
                        overflow: 'hidden',
                        transition: 'all 0.3s',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0, left: 0, right: 0,
                          height: 4,
                          bgcolor: stripe,
                        },
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: `0 12px 30px ${alpha(stripe, 0.18)}`,
                          borderColor: alpha(stripe, 0.4),
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: { xs: 40, md: 48 }, height: { xs: 40, md: 48 },
                          mx: 'auto', mb: 1.5,
                          borderRadius: '50%',
                          bgcolor: alpha(stripe, 0.12),
                          color: stripe,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: { xs: '1rem', md: '1.1rem' },
                        }}
                      >
                        {(mod.name || '?').charAt(0).toUpperCase()}
                      </Box>
                      <Typography
                        variant="subtitle1" fontWeight={700} color="text.primary"
                        sx={{
                          mb: 0.5,
                          fontSize: { xs: '0.9rem', md: '1rem' },
                          wordBreak: 'break-word',
                        }}
                      >
                        {mod.name}
                      </Typography>
                      {mod.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          {mod.description}
                        </Typography>
                      )}
                      <Typography variant="caption" sx={{ color: stripe }} fontWeight={600}>
                        {(mod.features || []).filter((f) => f.is_visible).length} service(s) &rarr;
                      </Typography>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
          </Container>
        </Box>
      )}

      {/* ═══════════ POPULAR SERVICES GRID ═══════════ */}
      {isSectionVisible(landingData, 'services') && (
      <Box ref={servicesRef} sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: '#fafbfc' }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 8 } }}>
            <Typography
              variant="h4" fontWeight={800}
              sx={{
                letterSpacing: '-0.02em', mb: 1,
                fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                wordBreak: 'break-word',
              }}
            >
              {landingData?.services_section_title || 'Popular Services'}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {landingData?.services_section_subtitle || 'Everything you need to manage your health'}
            </Typography>
          </Box>

          <Grid container spacing={{ xs: 2.5, md: 4 }}>
            {visibleServices.map((service) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={service.id}>
                <ServiceCard service={service} onClick={() => handleServiceClick(service.slug)} />
              </Grid>
            ))}
          </Grid>

          {hasMoreServices && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}>
              <Button
                variant="outlined"
                size="large"
                onClick={() => setShowAllServices((prev) => !prev)}
                endIcon={showAllServices ? <ExpandLess /> : <ExpandMore />}
                sx={{
                  px: 4, py: 1.25, borderRadius: 2, borderWidth: 2,
                  fontWeight: 700, textTransform: 'none', bgcolor: '#fff',
                  '&:hover': { borderWidth: 2 },
                }}
              >
                {showAllServices
                  ? 'Show less'
                  : `More (${overflowServices.length} more)`}
              </Button>
            </Box>
          )}

          {filteredServices.length === 0 && (
            <Box
              sx={{
                py: 6, textAlign: 'center', color: 'text.secondary',
                border: '1px dashed', borderColor: 'grey.300', borderRadius: 3,
              }}
            >
              <Typography variant="h6" sx={{ mb: 1 }}>
                {searchQuery
                  ? `No services match "${searchQuery}".`
                  : 'No services published yet.'}
              </Typography>
              <Typography variant="body2">
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Once the tenant admin publishes modules and features, they will appear here.'}
              </Typography>
            </Box>
          )}
        </Container>
      </Box>
      )}

      {/* ═══════════ WHY CHOOSE US ═══════════
           No explicit ``width: 100vw`` — that includes the vertical scroll-
           bar's width on browsers that reserve space for it, which shifts
           content slightly leftward inside any centered child. The global
           ``overflow-x: hidden`` on body is sufficient; sections just go
           with ``width: 100%`` of their natural parent. */}
      {isSectionVisible(landingData, 'why_us') && (
      <Box
        sx={{
          py: { xs: 6, md: 12 },
          px: { xs: 2, sm: 3 },
          bgcolor: landing.dark || '#1a2332',
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative */}
        <Box sx={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', background: `linear-gradient(270deg, ${alpha(theme.palette.primary.main, 0.12)} 0%, transparent 100%)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: { xs: 200, md: 350 }, height: { xs: 200, md: 350 }, bgcolor: 'primary.main', borderRadius: '50%', filter: 'blur(150px)', opacity: 0.15, pointerEvents: 'none' }} />

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Grid container spacing={{ xs: 4, lg: 8 }} alignItems="center">
            {/* Left: Benefits */}
            <Grid size={{ xs: 12, lg: 6 }}>
              <Typography
                variant="h3" fontWeight={800}
                sx={{
                  mb: 2, letterSpacing: '-0.02em', lineHeight: 1.2,
                  // ``variant="h3"`` defaults to ~3rem which doesn't fit a
                  // long brand title on a 360px viewport. Step explicitly.
                  fontSize: { xs: '1.85rem', sm: '2.25rem', md: '3rem' },
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                {/* Admin can override the whole heading via
                    ``why_section_title``; otherwise we render the
                    historical "Why <brand>?" template using the
                    configurable brand name. */}
                {landingData?.why_section_title || (
                    <>
                        Why{' '}
                        <Box component="span" sx={{ color: 'primary.light' }}>
                            {(landingData?.brand_name || 'JLMush Hospital').trim()}?
                        </Box>
                    </>
                )}
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: 'grey.500', mb: { xs: 3, md: 5 }, lineHeight: 1.8,
                  fontSize: { xs: '0.95rem', md: '1.1rem' },
                }}
              >
                {landingData?.why_section_subtitle
                    || 'We combine modern technology with compassionate care to provide you with the best healthcare experience.'}
              </Typography>

              <Stack spacing={4}>
                {/* Why-us feature bullets — admin-editable array of
                    ``{title, description}``. Falls back to the
                    historical hardcoded 4-pack so an un-configured
                    landing still shows reasonable copy. Normalise the
                    incoming row to handle both the legacy ``desc`` key
                    and the new ``description`` key from the admin
                    schema. */}
                {(() => {
                    const fallback = [
                      { title: 'Certified Doctors', description: 'All doctors are verified with valid medical registrations and credentials.' },
                      { title: '24/7 Availability', description: 'Access healthcare anytime with instant and scheduled consultations.' },
                      { title: 'Secure Medical Records', description: 'Your health data is encrypted and HIPAA-compliant.' },
                      { title: 'Affordable Pricing', description: 'Transparent pricing with no hidden fees. Pay only for what you need.' },
                    ];
                    const items = Array.isArray(landingData?.why_features) && landingData.why_features.length > 0
                        ? landingData.why_features
                        : fallback;
                    return items.map((item, idx) => (
                  <Stack key={idx} direction="row" spacing={2.5} alignItems="flex-start" sx={{ '&:hover .benefit-icon': { bgcolor: 'primary.main' } }}>
                    <Box
                      className="benefit-icon"
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        bgcolor: 'rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'background-color 0.3s',
                      }}
                    >
                      <CheckCircleOutline sx={{ color: 'primary.light' }} />
                    </Box>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5, transition: 'color 0.2s' }}>
                        {item.title}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'grey.500', lineHeight: 1.6 }}>
                        {/* New schema uses ``description``; fall back to
                            legacy ``desc`` so any prior data shape still
                            renders without admin re-entry. */}
                        {item.description ?? item.desc ?? ''}
                      </Typography>
                    </Box>
                  </Stack>
                    ));
                })()}
              </Stack>
            </Grid>

            {/* Right: Stats Box */}
            <Grid size={{ xs: 12, lg: 6 }}>
              <Box
                sx={{
                  bgcolor: 'rgba(255,255,255,0.05)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 5,
                  p: { xs: 2, sm: 3, md: 5 },
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}
              >
                {/* Stat tiles — admin-editable array of {value, label}.
                    Falls back to the historical hardcoded STATS so an
                    un-configured landing still shows reasonable trust
                    signals. Each tile uses ``size={6}`` for a 2×N grid;
                    odd-count arrays get a half-row at the bottom, which
                    is fine for any 2/4/6-element list. */}
                {(() => {
                    const stats = Array.isArray(landingData?.stats) && landingData.stats.length > 0
                        ? landingData.stats
                        : STATS;
                    return (
                        <Grid container spacing={{ xs: 1.5, md: 3 }} sx={{ mb: 4 }}>
                          {stats.map((stat, idx) => (
                            <Grid size={6} key={idx}>
                              <Box
                                sx={{
                                  textAlign: 'center',
                                  // 2-up tiles nested inside the stats panel are
                                  // very narrow on xs — trim the padding so the
                                  // value/label aren't squeezed to a few chars.
                                  p: { xs: 1.5, md: 3 },
                                  bgcolor: 'rgba(255,255,255,0.04)',
                                  borderRadius: 3,
                                  border: '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                <Typography
                                  variant="h4" fontWeight={800}
                                  sx={{
                                    color: 'primary.light', mb: 0.5,
                                    fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2.125rem' },
                                  }}
                                >
                                  {stat?.value || ''}
                                </Typography>
                                <Typography
                                  variant="caption" fontWeight={500}
                                  sx={{
                                    color: 'grey.500', textTransform: 'uppercase',
                                    letterSpacing: { xs: 0.5, md: 1 },
                                    fontSize: { xs: '0.65rem', md: '0.75rem' },
                                  }}
                                >
                                  {stat?.label || ''}
                                </Typography>
                              </Box>
                            </Grid>
                          ))}
                        </Grid>
                    );
                })()}

                {/* "Ready to start?" mini-CTA inside the stats panel.
                    Admin-editable; clearing the title hides the whole
                    box. ``ready_cta_href`` accepts internal routes
                    (e.g. ``/auth/service-receiver/login``) or external
                    URLs (http(s)://…) — the click handler picks the
                    right navigation strategy. Also gated on the
                    ``ready_cta`` section toggle so the admin can hide
                    it without clearing the copy. */}
                {isSectionVisible(landingData, 'ready_cta') && (() => {
                    // Distinguish "admin explicitly cleared" (empty
                    // string after trim) from "never configured" (null
                    // / undefined → use default).
                    const titleField = landingData?.ready_cta_title;
                    const hasField = titleField !== undefined && titleField !== null;
                    if (hasField && !String(titleField).trim()) return null;
                    const title = hasField ? titleField : 'Ready to start?';
                    const subtitle = landingData?.ready_cta_subtitle
                        ?? 'Talk to a healthcare expert today.';
                    const label = landingData?.ready_cta_label || 'Book Consultation';
                    const href = landingData?.ready_cta_href
                        || '/auth/service-receiver/login';

                    return (
                        <Box
                          sx={{
                            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                            borderRadius: 3,
                            p: { xs: 2.5, md: 4 },
                            textAlign: 'center',
                            boxShadow: `0 8px 30px ${alpha(theme.palette.primary.main, 0.4)}`,
                          }}
                        >
                          <Typography variant="h6" fontWeight={700} sx={{ mb: 1, color: '#fff' }}>
                            {title}
                          </Typography>
                          {subtitle && (
                            <Typography variant="body2" sx={{ color: alpha('#fff', 0.85), mb: 3 }}>
                              {subtitle}
                            </Typography>
                          )}
                          <Button
                            variant="contained"
                            fullWidth
                            onClick={() => {
                                if (/^https?:\/\//i.test(href)) {
                                    window.location.href = href;
                                } else {
                                    navigate(href);
                                }
                            }}
                            sx={{
                              bgcolor: '#fff',
                              color: 'primary.main',
                              fontWeight: 700,
                              py: 1.5,
                              borderRadius: 2.5,
                              '&:hover': { bgcolor: 'grey.100' },
                              textTransform: 'none',
                              fontSize: '1rem',
                            }}
                          >
                            {label}
                          </Button>
                        </Box>
                    );
                })()}
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>
      )}

      {/* ═══════════ VIDEO GALLERY STRIP ═══════════
           Up to 3 visible videos as embedded thumbnails. When the tenant
           has more than 3 visible videos a "More" CTA appears below the
           strip linking to the dedicated /gallery/videos page. */}
      {isSectionVisible(landingData, 'videos') && (
          <VideosSection
            isMarketingLanding={isMarketingLanding}
            inlineItems={landingData?.videos}
          />          
      )}

      {/* ═══════════ JOIN OUR NETWORK ═══════════
           Band that funnels providers into the persona-picker flow
           (/join → /join?vertical=<v> → signup with ?plan=<code>).
           Replaces the inline 9-tier pricing grid that used to live on
           the homepage — the full tier comparison now happens on the
           dedicated vertical pages so the landing stays patient-focused.

           Shown on EVERY tenant, not just the apex: the /join grid it
           leads to sells MembershipPlans ("who pays us"), which are
           tenant-isolated, so each tenant recruits providers into its own
           network with its own tiers. (Provider plans — "who we pay" —
           are admin-assigned per provider and never public, so they don't
           belong in this funnel.) The admin's ``join_network`` section
           toggle still hides it per tenant.
           SaaS pricing lives at /pricing — that stays apex-only, since
           tenant clinics don't sell platform subdomains. */}
      {/* Marketplace recruitment ("list your practice, get discovered by
          patients") is a TENANT surface — it recruits providers into a
          tenant's verticals. The SaaS vendor sells software and runs no
          marketplace, so this band both advertised the wrong product and
          pointed at /join, which no longer renders on the vendor host. */}
      {!isMarketingLanding
        && isSectionVisible(landingData, 'join_network')
        && <JoinNetworkBand />}

      {/* ═══════════ TESTIMONIALS — auto-rotating carousel ═══════════
           Carousel is the right pattern here: rotating quotes feel natural,
           save vertical space, and let the page breathe. Other sections keep
           their grid layouts — carousels only where they're a real fit. */}
      {isSectionVisible(landingData, 'testimonials') && (
      <Box sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: '#fff', overflow: 'hidden' }}>
        <Container maxWidth="lg">
          {/* Testimonials section — heading + subtitle admin-editable;
              the carousel content comes from ``landingData.testimonials``
              (array of {quote, name, role}) with the hardcoded
              TESTIMONIALS as fallback so an un-configured landing still
              shows social proof. */}
          {(() => {
              const items = Array.isArray(landingData?.testimonials) && landingData.testimonials.length > 0
                  ? landingData.testimonials
                  : TESTIMONIALS;
              const heading = landingData?.testimonials_section_title || 'What Our Patients Say';
              const subhead = landingData?.testimonials_section_subtitle || 'Hear from people who trust us with their health';
              // Empty heading AND empty subtitle AND empty list → render
              // nothing. Admin can hide the whole section.
              if (!items.length) return null;
              return (
                  <>
                    <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                        <Typography
                            variant="h4" fontWeight={800}
                            sx={{
                                letterSpacing: '-0.02em', mb: 1,
                                fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                                wordBreak: 'break-word',
                            }}
                        >
                            {heading}
                        </Typography>
                        {subhead && (
                            <Typography variant="body1" color="text.secondary">
                                {subhead}
                            </Typography>
                        )}
                    </Box>

                    <Carousel
                      autoPlayMs={6000}
                      itemMinWidth={{ xs: '88%', sm: '48%', md: '32%' }}
                    >
                      {items.map((t, idx) => (
              <Box
                key={idx}
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: 4,
                  border: '1px solid',
                  borderColor: 'grey.100',
                  bgcolor: '#fff',
                  height: '100%',
                  transition: 'all 0.3s',
                  '&:hover': {
                    boxShadow: '0 12px 36px rgba(0,0,0,0.08)',
                    transform: 'translateY(-4px)',
                  },
                }}
              >
                <FormatQuoteRounded sx={{ fontSize: 40, color: alpha(theme.palette.primary.main, 0.35), mb: 2 }} />
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.8, fontStyle: 'italic' }}>
                  &ldquo;{t.quote}&rdquo;
                </Typography>
                <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                  {t.name}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {t.role}
                </Typography>
              </Box>
            ))}
                    </Carousel>
                  </>
              );
          })()}
        </Container>
      </Box>
      )}

      {/* ═══════════ FAQ SECTION ═══════════
           Heading + subhead + items all admin-editable. Hidden entirely
           when the resolved item list is empty AND the admin cleared
           the title (no point rendering a section header with no
           questions under it). */}
      {isSectionVisible(landingData, 'faq') && (() => {
          const items = Array.isArray(landingData?.faqs) && landingData.faqs.length > 0
              ? landingData.faqs
              : FAQS;
          if (!items.length) return null;
          const heading = landingData?.faq_section_title || 'Frequently Asked Questions';
          const subhead = landingData?.faq_section_subtitle || 'Got questions? We have answers.';
          return (
              <Box sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: '#fafbfc' }}>
                <Container maxWidth="md">
                  <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
                    <Typography
                      variant="h4" fontWeight={800}
                      sx={{
                        letterSpacing: '-0.02em', mb: 1,
                        fontSize: { xs: '1.65rem', sm: '2rem', md: '2.125rem' },
                        wordBreak: 'break-word',
                      }}
                    >
                      {heading}
                    </Typography>
                    {subhead && (
                        <Typography variant="body1" color="text.secondary">
                          {subhead}
                        </Typography>
                    )}
                  </Box>

                  {items.map((faq, idx) => (
                    <Accordion
                      key={idx}
                      expanded={expandedFaq === idx}
                      onChange={(_, isExpanded) => setExpandedFaq(isExpanded ? idx : false)}
                      elevation={0}
                      disableGutters
                      sx={{
                        bgcolor: '#fff',
                        border: '1px solid',
                        borderColor: 'grey.100',
                        borderRadius: '12px !important',
                        mb: 2,
                        '&::before': { display: 'none' },
                        overflow: 'hidden',
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: { xs: 2, md: 3 }, py: 1 }}>
                        <Typography
                          variant="subtitle1" fontWeight={600}
                          sx={{ fontSize: { xs: '0.95rem', md: '1rem' } }}
                        >
                          {faq?.question || ''}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ px: { xs: 2, md: 3 }, pb: 3 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                          {faq?.answer || ''}
                        </Typography>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Container>
              </Box>
          );
      })()}

      {/* ═══════════ FOR-DOCTORS / CTA BAND ═══════════
           Admin-configurable. ``cta_band_title`` empty → entire band
           hides (tenants who don't want a recruitment-style CTA on
           their landing skip the section gracefully). Defaults below
           preserve the historical "Are you a doctor?" copy + route to
           ``/join/doctor`` (the marketplace funnel) so existing
           apex installs keep their CTA without an admin edit. */}
      {isSectionVisible(landingData, 'cta_band') && (() => {
          // ``null`` for an empty string field means the admin
          // deliberately cleared it — honour that and hide the band.
          // ``undefined`` (column never set) falls through to default.
          const titleSet = landingData?.cta_band_title !== undefined
              && landingData?.cta_band_title !== null;
          // The DEFAULTS below are marketplace recruitment ("Are you a
          // doctor?" → /join/doctor). They are right for a tenant and
          // wrong for the SaaS vendor, which recruits no providers and no
          // longer serves /join at all. So on the vendor site the band
          // appears only when its admin has explicitly written one —
          // never by falling through to a tenant's default copy.
          if (isMarketingLanding && !titleSet) return null;
          const title = titleSet
              ? landingData.cta_band_title
              : 'Are you a doctor?';
          if (titleSet && !title.trim()) return null; // admin cleared it

          const subtitle = landingData?.cta_band_subtitle
              ?? 'Join thousands of doctors on our network and reach patients across India.';
          const label = landingData?.cta_band_label || 'Join Our Network';
          const href = landingData?.cta_band_href || '/join/doctor';

          return (
              <Box
                sx={{
                  py: 6,
                  bgcolor: 'secondary.main',
                  color: 'white',
                  textAlign: 'center',
                }}
              >
                <Container maxWidth="sm">
                  <Typography variant="h5" fontWeight={700} gutterBottom>
                    {title}
                  </Typography>
                  {subtitle && (
                    <Typography variant="body1" sx={{ mb: 3, opacity: 0.9 }}>
                      {subtitle}
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    size="large"
                    endIcon={<ArrowForward />}
                    sx={{
                      bgcolor: 'white',
                      color: 'secondary.main',
                      '&:hover': { bgcolor: 'grey.100' },
                      px: 4,
                      fontWeight: 700,
                      textTransform: 'none',
                      borderRadius: 2,
                    }}
                    onClick={() => {
                      // External links (http/https) get window.location
                      // so they open the operator's chosen destination
                      // properly; internal routes use the SPA navigator.
                      if (/^https?:\/\//i.test(href)) {
                        window.location.href = href;
                      } else {
                        navigate(href);
                      }
                    }}
                  >
                    {label}
                  </Button>
                </Container>
              </Box>
          );
      })()}

      {/* ═══════════ BOOK A SLOT ═══════════
           Moved into the TOP CAROUSEL alongside the hero (see above). Kept
           this marker so the section order stays readable. */}

      {/* ═══════════ MEET OUR DOCTORS ═══════════
           Slow auto-rotating carousel of doctor profile cards. Hides
           when no doctors are configured. */}
      {isSectionVisible(landingData, 'doctors') && (
          <DoctorsSection sectionTitle={landingData?.doctors_section_title} />
      )}

      {/* ═══════════ CLIENT REVIEWS ═══════════
           Play-Store-style review-card carousel. Hides when no
           reviews are configured. */}
      {isSectionVisible(landingData, 'reviews') && (
          <ReviewsSection sectionTitle={landingData?.reviews_section_title} />
      )}

      {/* ═══════════ TRUSTED BY GLOBAL BRANDS ═══════════
           Logo-only continuous marquee strip immediately above the
           footer. Hides when no brands are configured. Section heading
           is admin-editable; falls back to "Trusted by Global Brands". */}
      {isSectionVisible(landingData, 'brands') && (
          <BrandsSection sectionTitle={landingData?.brands_section_title} />
      )}

    </Box>
  );
}
