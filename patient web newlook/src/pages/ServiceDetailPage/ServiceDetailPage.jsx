import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid2 as Grid,
  Stack,
  Chip,
  Paper,
  Divider,
  Avatar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
  alpha,
} from '@mui/material';
import {
  ArrowBackOutlined,
  CheckCircleOutline,
  ThumbUpOutlined,
  ThumbDownOutlined,
  CloseOutlined,
  Star,
  AccessTime,
  PersonOutline,
  InfoOutlined,
  ExpandMore as ExpandMoreIcon,
  GroupsOutlined,
  HowToRegOutlined,
  Inventory2Outlined,
  FlagOutlined,
  TaskAltOutlined,
} from '@mui/icons-material';
import { useGetPublicFeatureQuery } from '../../features/admin/api/landingPageConfigEndpoints';
import { useGetPublicPlatformLandingFeatureQuery } from '../../features/admin/api/platformLandingEndpoints';
import { useLanguage } from '../../common/i18n';
import { Alert, CircularProgress } from '@mui/material';
import PublicLandingLayout from '../PublicLandingLayout/PublicLandingLayout';
import VideosSection from '../../common/components/VideoSection/VideosSection';
import ImageSection from '../../common/components/ImageSection/ImageSection';
import CareTeamSection from './components/CareTeamSection';

export default function ServiceDetailPage() {
  return (
    <PublicLandingLayout>
      {({ isMarketingLanding }) => (
        <ServiceDetailPageContent isMarketingLanding={isMarketingLanding} />
      )}
    </PublicLandingLayout>
  );
}

function ServiceDetailPageContent({ isMarketingLanding = false }) {
  const { serviceSlug } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const landing = theme.palette.landing || {};
  const serviceName = decodeURIComponent(serviceSlug || '');

  const { lang } = useLanguage();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'live';
  const { isAuthenticated, user } = useSelector((s) => s.auth);
  const tenantQ = useGetPublicFeatureQuery(
    { slug: serviceName, lang, mode },
    { skip: !serviceName || isMarketingLanding },
  );
  const platformQ = useGetPublicPlatformLandingFeatureQuery(
    { slug: serviceName, lang, mode },
    { skip: !serviceName || !isMarketingLanding },
  );
  const apiFeature = isMarketingLanding ? platformQ.data : tenantQ.data;
  const isLoading = isMarketingLanding ? platformQ.isLoading : tenantQ.isLoading;
  const isError = isMarketingLanding ? platformQ.isError : tenantQ.isError;

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!apiFeature || isError) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Alert severity="warning">
          Service "<strong>{serviceName}</strong>" is not available. The tenant may have
          removed it or it was never published.
        </Alert>
      </Container>
    );
  }

  // "Book Now" target: if this feature is linked to a marketplace product,
  // deep-link straight to that product's booking; otherwise fall back to
  // the marketplace landing. Guests are sent through login with the target
  // preserved as ?redirect= so they arrive on the product, not the
  // dashboard (LoginForm / GuestRoute honour it for patients).
  const bookingTarget = apiFeature.product_id
    ? `/dashboard/patient/marketplace?product_id=${encodeURIComponent(apiFeature.product_id)}`
    : '/dashboard/patient/marketplace';
  const goToBooking = () => {
    if (isAuthenticated && user?.role === 'patient') {
      navigate(bookingTarget);
    } else {
      navigate(`/auth/service-receiver/login?redirect=${encodeURIComponent(bookingTarget)}`);
    }
  };
  const goToSignup = () => {
    navigate(`/auth/service-receiver/signup?redirect=${encodeURIComponent(bookingTarget)}`);
  };

  const content = {
    title: apiFeature.title,
    description: apiFeature.description,
    price: apiFeature.starting_price,
    timeline: apiFeature.timeline,
    rating: apiFeature.rating,
    whatIs: apiFeature.what_is,
    requirements: apiFeature.requirements,
    process: apiFeature.process || [],
    pros: apiFeature.benefits,
    cons: apiFeature.disadvantages,
    whoShouldJoin: apiFeature.who_should_join || [],
    whatsIncluded: apiFeature.whats_included || [],
    expectedOutcomes: apiFeature.expected_outcomes || [],
    documents: apiFeature.documents,
    bookCtaLabel: apiFeature.book_cta_label,
    sections: apiFeature.sections_enabled_json || {},
    vids: apiFeature?.vid_json?.videos || [],
    imgs: apiFeature?.img_json?.images || [],
    faqs: apiFeature.faq_json || [],
    // Care team is tenant-only — the platform/marketing feature payload has
    // no such key, so this stays empty there and the section never renders.
    careTeam: apiFeature.care_team || [],
  };

  const sections = content.sections;
  const showSection = (key) => sections[key] !== false;

  return (
    <Box>
      {/* ═══════════ STICKY BACK BAR ═══════════ */}
      <Box sx={{ bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'grey.200', position: 'sticky', top: 0, zIndex: 30 }}>
        <Container maxWidth="lg" sx={{ py: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            onClick={() => navigate(-1)}
            sx={{
              cursor: 'pointer',
              color: 'text.secondary',
              fontSize: '0.875rem',
              fontWeight: 500,
              width: 'fit-content',
              transition: 'color 0.2s',
              '&:hover': { color: 'primary.main' },
            }}
          >
            <ArrowBackOutlined sx={{ fontSize: 16 }} />
            <Typography variant="body2" fontWeight={500}>Back to Services</Typography>
          </Stack>
        </Container>
      </Box>

      {/* ═══════════ HERO: Service Info + Login Sidebar ═══════════ */}
      <Box sx={{ pt: 6, pb: 8, px: { xs: 2, sm: 3 }, overflow: 'hidden', bgcolor: '#fff' }}>
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            {/* LEFT: Service Info */}
            <Grid size={{ xs: 12, lg: 6 }}>
              {/* {apiFeature.logo_url && (
                <Avatar
                  src={apiFeature.logo_url}
                  variant="rounded"
                  sx={{ width: 80, height: 80, mb: 3, bgcolor: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,0.08)', p: 1 }}
                />
              )} */}
              <Chip
                label="FAST & ONLINE"
                size="small"
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: 'primary.dark',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  height: 'auto',
                  py: 0.5,
                  borderRadius: 999,
                  mb: 3,
                }}
              />

              <Typography
                variant="h3"
                fontWeight={800}
                sx={{
                  mb: 3,
                  lineHeight: 1.25,
                  color: 'grey.900',
                  fontSize: { xs: '1.875rem', md: '3rem' },
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                {content.title}
              </Typography>

              <Typography
                variant="body1"
                sx={{ mb: 4, lineHeight: 1.625, color: 'grey.600', fontSize: '1.125rem', wordBreak: 'break-word' }}
              >
                {content.description}
              </Typography>

              {showSection('pricing') && (content.price || content.timeline) && (
                <Stack direction="row" spacing={3} sx={{ mb: 4, flexWrap: 'wrap', rowGap: 2, alignItems: 'center' }}>
                  {content.price && (
                    <Stack
                      direction="row"
                      alignItems="center"
                      sx={{ bgcolor: 'success.50', border: '1px solid', borderColor: 'success.100', borderRadius: 2, px: 2, py: 1 }}
                    >
                      <Typography variant="body1" fontWeight={500} sx={{ color: 'grey.500', mr: 1 }}>Starting at:</Typography>
                      <Typography variant="h6" fontWeight={700} sx={{ color: 'success.dark', fontSize: '1.5rem' }}>
                        {content.price}
                      </Typography>
                    </Stack>
                  )}
                  {content.timeline && (
                    <Stack
                      direction="row"
                      alignItems="center"
                      sx={{ bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.100', borderRadius: 2, px: 2, py: 1.25, color: 'grey.600' }}
                    >
                      <AccessTime sx={{ fontSize: 22, mr: 1, color: 'grey.500' }} />
                      <Typography variant="body1" fontWeight={500}>{content.timeline}</Typography>
                    </Stack>
                  )}
                </Stack>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 4 }}>
                {showSection('book_now') && (
                  <Button
                    variant="contained"
                    onClick={goToBooking}
                    sx={{
                      px: 5,
                      py: 2,
                      fontWeight: 700,
                      textTransform: 'none',
                      borderRadius: 2,
                      fontSize: '1.0625rem',
                      lineHeight: 1.5,
                      boxShadow: `0 10px 15px -3px ${alpha(theme.palette.primary.main, 0.25)}`,
                      '&:hover': { boxShadow: `0 10px 15px -3px ${alpha(theme.palette.primary.main, 0.25)}` },
                    }}
                  >
                    {content.bookCtaLabel || 'Book Now'}
                  </Button>
                )}
                {showSection('rating') && (
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color: 'grey.600', px: 2 }}>
                    <Star sx={{ color: '#facc15', fontSize: 24, mr: 0.5 }} />
                    <Typography variant="body1" fontWeight={700}>{content.rating || '4.8/5'}</Typography>
                    <Typography variant="body1">Rating</Typography>
                  </Stack>
                )}
              </Stack>

              <Stack direction="row" spacing={3} sx={{ color: 'grey.500', flexWrap: 'wrap', rowGap: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CheckCircleOutline sx={{ fontSize: 20, color: 'success.main' }} />
                  <Typography variant="body1" sx={{ fontSize: '0.9375rem' }}>100% Online Process</Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CheckCircleOutline sx={{ fontSize: 20, color: 'success.main' }} />
                  <Typography variant="body1" sx={{ fontSize: '0.9375rem' }}>Expert Support</Typography>
                </Stack>
              </Stack>
            </Grid>

            {/* RIGHT: Login / Booking Sidebar */}
            <Grid size={{ xs: 12, lg: 6 }}>
              <Box sx={{ position: 'relative' }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 4,
                    borderRadius: 4,
                    bgcolor: 'grey.50',
                    border: '1px solid',
                    borderColor: 'grey.100',
                    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mb: 2,
                      }}
                    >
                      <PersonOutline sx={{ fontSize: 32, color: 'primary.main' }} />
                    </Box>
                    <Typography variant="h6" fontWeight={700} sx={{ mb: 1, fontSize: '1.25rem', color: 'grey.900' }}>
                      Login Required
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 3, color: 'grey.600' }}>
                      Please login or signup to book this service
                    </Typography>

                    <Stack spacing={1.5}>
                      <Button
                        variant="contained"
                        fullWidth
                        onClick={goToBooking}
                        sx={{ fontWeight: 700, textTransform: 'none', py: 1.75, borderRadius: 2, fontSize: '1.0625rem', lineHeight: 1.5, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
                      >
                        Login
                      </Button>
                      <Button
                        variant="outlined"
                        fullWidth
                        onClick={goToSignup}
                        sx={{
                          fontWeight: 700,
                          textTransform: 'none',
                          py: 1.75,
                          borderRadius: 2,
                          fontSize: '1.0625rem',
                          lineHeight: 1.5,
                          borderWidth: 2,
                          bgcolor: '#fff',
                          '&:hover': { borderWidth: 2, bgcolor: alpha(theme.palette.primary.main, 0.04) },
                        }}
                      >
                        Create Account
                      </Button>
                    </Stack>
                  </Box>
                </Paper>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* ═══════════ WHAT IS & REQUIREMENTS ═══════════ */}
      {((showSection('what_is') && content.whatIs) ||
        (showSection('eligibility') && content.requirements)) && (
        <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, md: 3 }, bgcolor: 'grey.50' }}>
          <Container maxWidth="md">
            <Stack spacing={{ xs: 5, md: 6 }}>
              {showSection('what_is') && content.whatIs && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 2.5 }} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 48, height: 48, borderRadius: '50%',
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      // centre the 48px circle on the heading's first line rather than
                      // on the top of the text block: (lineHeight 32px - 48px) / 2
                      mt: { xs: 0, sm: '-8px' },
                    }}
                  >
                    <InfoOutlined sx={{ color: 'primary.main' }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="h5"
                      fontWeight={700}
                      sx={{ mb: { xs: 1.5, md: 2 }, fontSize: { xs: '1.35rem', md: '1.5rem' }, lineHeight: '32px' }}
                    >
                      What is it?
                    </Typography>
                    <Typography variant="body1" sx={{ lineHeight: 1.7, fontSize: { xs: '1rem', md: '1.125rem' }, color: 'grey.600' }}>
                      {content.whatIs}
                    </Typography>
                  </Box>
                </Stack>
              )}

              {showSection('eligibility') && content.requirements && (
                <Paper
                  elevation={0}
                  sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, bgcolor: '#fff', border: '1px solid', borderColor: 'grey.200', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                  <Typography variant="h6" fontWeight={700} sx={{ mb: { xs: 2, md: 3 } }}>
                    Eligibility & Requirements
                  </Typography>
                  <Grid container spacing={{ xs: 2, md: 2 }}>
                    {content.requirements.map((req, i) => (
                      <Grid size={{ xs: 12, md: 6 }} key={i}>
                        <Box sx={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'flex-start', gap: 1.5 }}>
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              minWidth: 6,
                              borderRadius: '50%',
                              bgcolor: 'primary.main',
                              flexShrink: 0,
                              // centre the dot on the first line of text:
                              // (lineHeight 1.6 * fontSize 0.875rem - dot 6px) / 2
                              mt: '8px',
                            }}
                          />
                          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6, minWidth: 0 }}>
                            {req}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </Paper>
              )}
            </Stack>
          </Container>
        </Box>
      )}

      {/* ═══════════ WHO SHOULD JOIN THE PROGRAM ═══════════ */}
      {showSection('who_should_join') && content.whoShouldJoin?.length > 0 && (
        <Box
          sx={{
            // Opaque, like every other band on this page. A translucent tint
            // would let the tenant's admin-chosen page background bleed
            // through at full saturation.
            py: { xs: 6, md: 9 }, px: { xs: 2, md: 3 }, bgcolor: '#fff',
            borderTop: '1px solid', borderColor: 'grey.100',
          }}
        >
          <Container maxWidth="lg">
            <Stack alignItems="center" sx={{ mb: { xs: 4, md: 6 }, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 52, height: 52, borderRadius: '50%', mb: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <GroupsOutlined sx={{ color: 'primary.main', fontSize: 28 }} />
              </Box>
              <Typography variant="h4" fontWeight={700} sx={{ fontSize: { xs: '1.5rem', md: '2rem' } }}>
                Who Should Join the Program
              </Typography>
              <Typography variant="body1" sx={{ color: 'grey.600', mt: 1 }}>
                This is built for you if any of these sound familiar.
              </Typography>
            </Stack>

            <Grid container spacing={3} justifyContent="center">
              {content.whoShouldJoin.map((item, i) => (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3, height: '100%', borderRadius: 3, bgcolor: '#fff',
                      border: '1px solid', borderColor: 'grey.100',
                      transition: 'transform 0.25s, box-shadow 0.25s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: '0 12px 20px -8px rgba(0,0,0,0.15)',
                      },
                    }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
                      <Box
                        sx={{
                          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <HowToRegOutlined sx={{ color: 'primary.main', fontSize: 20 }} />
                      </Box>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ minWidth: 0 }}>
                        {item.title}
                      </Typography>
                    </Stack>
                    {item.desc && (
                      <Typography variant="body2" sx={{ color: 'grey.600', lineHeight: 1.65 }}>
                        {item.desc}
                      </Typography>
                    )}
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>
      )}

      {/* ═══════════ WHAT'S INCLUDED ═══════════ */}
      {/* Deliberately a single divided panel rather than a card grid — it
          reads as a manifest of what the price covers, and keeps this
          section visually distinct from the card grids either side of it. */}
      {showSection('whats_included') && content.whatsIncluded?.length > 0 && (
        <Box
          sx={{
            py: { xs: 6, md: 9 }, px: { xs: 2, md: 3 }, bgcolor: 'grey.50',
            borderTop: '1px solid', borderColor: 'grey.200',
          }}
        >
          <Container maxWidth="md">
            <Stack alignItems="center" sx={{ mb: { xs: 4, md: 5 }, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 52, height: 52, borderRadius: '50%', mb: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Inventory2Outlined sx={{ color: 'primary.main', fontSize: 28 }} />
              </Box>
              <Typography variant="h4" fontWeight={700} sx={{ fontSize: { xs: '1.5rem', md: '2rem' } }}>
                What's Included
              </Typography>
              <Typography variant="body1" sx={{ color: 'grey.600', mt: 1 }}>
                Everything below is covered by the price you see.
              </Typography>
            </Stack>

            <Paper
              elevation={0}
              sx={{
                borderRadius: 4, overflow: 'hidden', bgcolor: '#fff',
                border: '1px solid', borderColor: 'grey.200',
              }}
            >
              {content.whatsIncluded.map((item, i) => (
                <Box key={i}>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="flex-start"
                    sx={{ px: { xs: 2.5, md: 3 }, py: 2.5, transition: 'background-color 0.2s', '&:hover': { bgcolor: 'grey.50' } }}
                  >
                    <CheckCircleOutline
                      sx={{ fontSize: 22, color: 'success.main', mt: '2px', flexShrink: 0 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body1" fontWeight={600} sx={{ color: 'grey.800' }}>
                        {item.title}
                      </Typography>
                      {item.desc && (
                        <Typography variant="body2" sx={{ color: 'grey.600', mt: 0.5, lineHeight: 1.65 }}>
                          {item.desc}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                  {i < content.whatsIncluded.length - 1 && (
                    <Divider sx={{ borderColor: 'grey.100' }} />
                  )}
                </Box>
              ))}
            </Paper>
          </Container>
        </Box>
      )}

      {/* ═══════════ BENEFITS & DISADVANTAGES ═══════════ */}
      {((showSection('benefits') && content.pros?.length > 0) ||
        (showSection('disadvantages') && content.cons?.length > 0)) && (
        <Box sx={{ py: { xs: 5, md: 8 }, px: { xs: 2, md: 3 }, bgcolor: '#fff', borderTop: '1px solid', borderColor: 'grey.100' }}>
          <Container maxWidth="lg">
            <Typography variant="h5" fontWeight={700} textAlign="center" sx={{ mb: 6 }}>
              Is this right for you?
            </Typography>

            <Grid container spacing={4} justifyContent="center">
              {showSection('benefits') && content.pros?.length > 0 && (
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper elevation={0} sx={{ p: 4, borderRadius: 4, bgcolor: alpha(theme.palette.success.light, 0.15), border: '1px solid', borderColor: 'success.100', height: '100%' }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
                      <ThumbUpOutlined sx={{ color: 'success.main' }} />
                      <Typography variant="h6" fontWeight={700}>Benefits</Typography>
                    </Stack>
                    <Stack spacing={2}>
                      {content.pros.map((pro, i) => (
                        <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start">
                          <CheckCircleOutline sx={{ fontSize: 20, color: 'success.main', mt: 0.3, flexShrink: 0 }} />
                          <Typography variant="body2" sx={{ color: 'grey.700' }}>{pro}</Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Paper>
                </Grid>
              )}

              {showSection('disadvantages') && content.cons?.length > 0 && (
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper elevation={0} sx={{ p: 4, borderRadius: 4, bgcolor: alpha(theme.palette.error.light, 0.15), border: '1px solid', borderColor: 'error.100', height: '100%' }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
                      <ThumbDownOutlined sx={{ color: 'error.main' }} />
                      <Typography variant="h6" fontWeight={700}>Disadvantages</Typography>
                    </Stack>
                    <Stack spacing={2}>
                      {content.cons.map((con, i) => (
                        <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start">
                          <CloseOutlined sx={{ fontSize: 20, color: 'error.main', mt: 0.3, flexShrink: 0 }} />
                          <Typography variant="body2" sx={{ color: 'grey.700' }}>{con}</Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Paper>
                </Grid>
              )}
            </Grid>
          </Container>
        </Box>
      )}

      {/* ═══════════ EXPECTED OUTCOME ═══════════ */}
      {showSection('expected_outcomes') && content.expectedOutcomes?.length > 0 && (
        <Box
          sx={{
            py: { xs: 6, md: 9 }, px: { xs: 2, md: 3 }, bgcolor: '#fff',
            borderTop: '1px solid', borderColor: 'grey.100',
          }}
        >
          <Container maxWidth="lg">
            <Stack alignItems="center" sx={{ mb: { xs: 4, md: 6 }, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 52, height: 52, borderRadius: '50%', mb: 2,
                  bgcolor: alpha(theme.palette.success.main, 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <FlagOutlined sx={{ color: 'success.main', fontSize: 28 }} />
              </Box>
              <Typography variant="h4" fontWeight={700} sx={{ fontSize: { xs: '1.5rem', md: '2rem' } }}>
                Expected Outcome
              </Typography>
              <Typography variant="body1" sx={{ color: 'grey.600', mt: 1 }}>
                What you walk away with once we're done.
              </Typography>
            </Stack>

            <Grid container spacing={3} justifyContent="center">
              {content.expectedOutcomes.map((item, i) => (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3, height: '100%', borderRadius: 3, bgcolor: 'grey.50',
                      border: '1px solid', borderColor: 'grey.100',
                      // Left accent bar keeps these visually distinct from the
                      // benefits panel above, which is also success-tinted.
                      borderLeft: '4px solid',
                      borderLeftColor: 'success.main',
                      transition: 'box-shadow 0.25s',
                      '&:hover': { boxShadow: '0 12px 20px -8px rgba(0,0,0,0.12)' },
                    }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <TaskAltOutlined
                        sx={{ color: 'success.main', fontSize: 22, mt: '2px', flexShrink: 0 }}
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: item.desc ? 0.75 : 0 }}>
                          {item.title}
                        </Typography>
                        {item.desc && (
                          <Typography variant="body2" sx={{ color: 'grey.600', lineHeight: 1.65 }}>
                            {item.desc}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>
      )}

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      {showSection('how_it_works') && content.process?.length > 0 && (
        <Box sx={{ py: { xs: 8, md: 10 }, px: { xs: 2, md: 3 }, bgcolor: 'grey.50', borderTop: '1px solid', borderColor: 'grey.200' }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: 8 }}>
              <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
                How It Works
              </Typography>
              <Typography variant="body1" sx={{ color: 'grey.500' }}>
                Simple process to get your {serviceName}
              </Typography>
            </Box>

            <Grid container spacing={3} justifyContent="center">
              {content.process.map((step, idx) => (
                <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={idx}>
                  <Box
                    className="process-card"
                    sx={{
                      p: 3,
                      borderRadius: 3,
                      height: '100%',
                      position: 'relative',
                      overflow: 'hidden',
                      bgcolor: '#fff',
                      border: '1px solid',
                      borderColor: 'grey.100',
                      transition: 'box-shadow 0.3s',
                      '&:hover': { boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' },
                      '&:hover .process-number-bg': { color: alpha(theme.palette.primary.main, 0.08) },
                    }}
                  >
                    <Typography
                      className="process-number-bg"
                      sx={{ position: 'absolute', top: -16, right: -8, fontSize: '4.5rem', fontWeight: 900, color: 'grey.50', lineHeight: 1, transition: 'color 0.3s' }}
                    >
                      {idx + 1}
                    </Typography>

                    <Box sx={{ position: 'relative', zIndex: 1 }}>
                      <Box
                        sx={{
                          width: 40, height: 40, borderRadius: '50%',
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                          color: 'primary.main',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, mb: 2,
                        }}
                      >
                        {idx + 1}
                      </Box>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                        {step.title}
                      </Typography>
                      <Typography variant="body2" sx={{ lineHeight: 1.6, color: 'grey.500', fontSize: '0.875rem' }}>
                        {step.desc}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>
      )}

      {/* ═══════════ DOCUMENTS REQUIRED ═══════════ */}
      {showSection('documents') && content.documents?.length > 0 && (
        <Box sx={{ py: { xs: 8, md: 10 }, px: { xs: 2, md: 3 }, bgcolor: '#fff' }}>
          <Container maxWidth="md">
            <Typography variant="h5" fontWeight={700} textAlign="center" sx={{ mb: 4 }}>
              Documents Required
            </Typography>
            <Paper elevation={0} sx={{ borderRadius: 4, overflow: 'hidden', bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200' }}>
              {content.documents.map((doc, idx) => (
                <Box key={idx}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={2}
                    sx={{ px: 3, py: 2, transition: 'background-color 0.2s', '&:hover': { bgcolor: '#fff' } }}
                  >
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
                    <Typography variant="body1" fontWeight={500} sx={{ color: 'grey.700' }}>
                      {doc}
                    </Typography>
                  </Stack>
                  {idx < content.documents.length - 1 && <Divider sx={{ borderColor: 'grey.200' }} />}
                </Box>
              ))}
            </Paper>
          </Container>
        </Box>
      )}
      {/* ═══════════ MEET YOUR CARE TEAM ═══════════ */}
      {showSection('care_team') && (
        <CareTeamSection members={content.careTeam} serviceName={content.title || serviceName} />
      )}

      {/* VIDS SECTION */}
      {content.vids && (
                <VideosSection
                isMarketingLanding={isMarketingLanding}
                inlineItems={content.vids}
                />
            )}
        {/* IMGS SECTION */}
        {content.imgs && (<ImageSection images={content.imgs} />)}

      {/* ═══════════ FAQ ═══════════ */}
      {showSection('faq') && content.faqs.length > 0 && (
        <Box sx={{ py: { xs: 6, md: 10 }, px: 2, bgcolor: 'grey.50', borderTop: '1px solid', borderColor: 'grey.200' }}>
          <Container maxWidth="md">
            <Typography variant="h4" fontWeight={800} textAlign="center" sx={{ mb: 1 }}>
              Frequently Asked Questions
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ mb: 5 }}>
              Everything you need to know about {content.title}.
            </Typography>
            {content.faqs.map((item, i) => (
              <Accordion
                key={i}
                disableGutters
                elevation={0}
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