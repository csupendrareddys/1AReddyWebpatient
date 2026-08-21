/**
 * Universal shell for the public-facing landing tree.
 *
 * Wraps :class:`LandingPage`, :class:`ModulePage` and :class:`ServiceDetailPage`
 * with one navbar + one footer + one ``ThemeProvider`` so admin theming flows
 * to every public page (not just the homepage) and so users see the same
 * navigation regardless of which tenant page they're on.
 *
 * Theming is driven by the per-tenant landing config — the same query the
 * homepage uses. Pages that need access to the resolved tree (e.g. the
 * homepage itself, to render its services grid) can read ``landingData``
 * via the ``children``-as-render-prop signature this layout supports.
 *
 * Usage::
 *
 *   <PublicLandingLayout>{({ landingData, mode }) => (
 *     <YourPage landingData={landingData} mode={mode} />
 *   )}</PublicLandingLayout>
 *
 * Plain children also work — the render-prop is only needed when the inner
 * page wants the data the layout already fetched (avoids a duplicate query).
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink, useLocation } from 'react-router-dom';
import {
    AppBar,
    Toolbar,
    Typography,
    Button,
    Container,
    Box,
    Stack,
    Grid2 as Grid,
    Link,
    Divider,
    InputBase,
    ThemeProvider,
    useTheme,
    IconButton,
    Drawer,
    List,
    ListItemButton,
    ListItemText,
    Collapse,
    Tooltip,
    Paper,
    MenuList,
    MenuItem,
    ListItemIcon,
} from '@mui/material';
import {
    KeyboardArrowDown,
    Search as SearchIcon,
    PersonOutline,
    // Email as EmailIcon,
    Menu as MenuIcon,
    Close as CloseIcon,
    ExpandMore,
    ExpandLess,
    PriceChange as PriceChangeIcon,
    HowToReg as HowToRegIcon,
} from '@mui/icons-material';
import MegaMenu from '../../common/components/MegaMenu/MegaMenu';
import { groupByCategory } from '../../common/components/MegaMenu/featureCategories';
import { CHOOSER_MODES, useChooserItems, receiverDividerKey } from '../PersonaChooserPage/personas';
import ChooserItemIcon from '../PersonaChooserPage/ChooserItemIcon';
import { useGetPublicLandingQuery } from '../../features/admin/api/landingPageConfigEndpoints';
import {
    useGetPublicPlatformLandingQuery,
    useGetPlatformLandingSummaryQuery,
} from '../../features/admin/api/platformLandingEndpoints';
import { useLanguage, LanguageSelector } from '../../common/i18n';
import { buildLandingTheme } from '../../theme/buildLandingTheme';
import useIsOnPlatformDomain from '../../common/hooks/useIsOnPlatformDomain';

// The previous ``_isApexHost`` heuristic classified hosts by label
// count (≤ 2 labels = apex). That misroutes every two-label tenant
// custom domain (e.g. ``vedanthzen.com``) into the platform marketing
// branch — users see the pricing module instead of their tenant's
// landing. We now defer to ``useIsOnPlatformDomain`` (single source
// of truth, env-driven) which returns true ONLY for the literal
// platform apex / ``www.<base>``.

export default function PublicLandingLayout({ children }) {
    const { lang } = useLanguage();
    const [searchParams] = useSearchParams();
    const mode = searchParams.get('mode') || 'live';

    // Apex (e.g. ``larazen.in`` or localhost) reads from the schema-separated
    // platform marketing landing. Subdomains (``<slug>.larazen.in``) keep
    // hitting the per-tenant landing endpoint.
    //
    // Special case — ``?_platform_scope=<scope>`` is set by the admin
    // PreviewTab iframe to force-load a specific platform scope's
    // DRAFT / PREVIEW / LIVE row via the admin summary endpoint.
    // Same-origin auth cookies flow, so platform_owners viewing their
    // own preview see exactly what they're editing.
    //
    // Optional ``?_platform_mode=draft|preview|live`` picks which of
    // the three rows to render. Defaults to ``draft`` — the editor's
    // working copy — so saving in the editor shows up in the iframe
    // without having to promote first.
    const platformScopePreview = searchParams.get('_platform_scope');
    const platformModePreview = searchParams.get('_platform_mode') || 'draft';
    const isPlatformPreview = !!platformScopePreview;
    // Strict apex check (env-driven via VITE_PUBLIC_BASE_DOMAIN). Any
    // hostname that isn't the literal platform base — including every
    // tenant custom domain — falls into the per-tenant branch below.
    const isApex = useIsOnPlatformDomain();
    const tenantQ = useGetPublicLandingQuery(
        { lang, mode }, { skip: isApex || isPlatformPreview },
    );
    const platformQ = useGetPublicPlatformLandingQuery(
        undefined, { skip: !isApex || isPlatformPreview },
    );
    const platformAdminQ = useGetPlatformLandingSummaryQuery(
        platformScopePreview, { skip: !isPlatformPreview },
    );
    const platformAdminData = platformAdminQ.data
        ? (platformAdminQ.data[platformModePreview] || platformAdminQ.data.live)
        : null;
    const landingData = isPlatformPreview
        ? platformAdminData
        : (isApex ? platformQ.data : tenantQ.data);
    // Pricing (and the corresponding nav entry) belongs to the apex
    // marketing site only — it describes plans that clinics buy to subscribe
    // to the platform. The ``default_template`` scope is itself the seed
    // copied into every new tenant, so previewing it should look like a
    // tenant clinic landing (no pricing). Tenant subdomains never show it
    // either.
    const isMarketingLanding = isPlatformPreview
        ? platformScopePreview === 'marketing'
        : isApex;
    const landingTheme = useMemo(() => buildLandingTheme(landingData), [landingData]);

    // ``palette.landing.background`` is the admin-chosen page-level tint —
    // applying it here makes the 4th color in the preset picker actually
    // visible on every section that doesn't override its own bgcolor.
    const pageBg = landingTheme.palette.landing?.background
        || landingTheme.palette.background?.default
        || '#fff';

    return (
        <ThemeProvider theme={landingTheme}>
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: pageBg,
                    // ``overflow-x: hidden`` is set globally on html/body/#root
                    // in index.css — this Box doesn't need its own override
                    // (extra clipping here can interact badly with sticky
                    // ancestors and is redundant given the global rule).
                }}
            >
                <PublicHeader landingData={landingData} isMarketingLanding={isMarketingLanding} />
                <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {typeof children === 'function'
                        ? children({ landingData, mode, isMarketingLanding })
                        : children}
                </Box>
                <PublicFooter landingData={landingData} />
            </Box>
        </ThemeProvider>
    );
}

// ---------------------------------------------------------------------------

function PublicHeader({ landingData, isMarketingLanding = false }) {
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const landing = theme.palette.landing || {};
    const [activeMenu, setActiveMenu] = useState(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileExpandedModule, setMobileExpandedModule] = useState(null);
    // Which persona dropdown is open ('login' | 'register' | null). One piece
    // of state rather than a boolean each, so hovering from Login straight to
    // Register can't leave both panels hanging open at once.
    const [openPersonaMenu, setOpenPersonaMenu] = useState(null);
    // Language state — driven by the tenant's ``published_languages``
    // list on the landing config. ``useLanguage`` stores the choice in
    // a shared context + persists it across navigations; updating it
    // here causes ``useGetPublicLandingQuery`` upstream to re-fetch with
    // the new ?lang= and apply the translations. ``LanguageSelector``
    // auto-hides when only one language is published so this is safe
    // to mount unconditionally.
    const { lang, setLang } = useLanguage();
    const publishedLanguages = Array.isArray(landingData?.published_languages)
        && landingData.published_languages.length > 0
            ? landingData.published_languages
            : ['en'];

    // Brand + contact resolution. ``landingData.brand_name`` is admin-
    // editable per tenant (and per scope for the platform marketing
    // surface); fall back to a generic placeholder so a fresh / empty
    // config doesn't render the literal string "undefined" anywhere.
    // ``brandWords`` splits the brand into two parts for the two-tone
    // display ("Larazen Hospital" → ["Larazen", "Hospital"]); a single-
    // word brand renders as a single coloured span.
    const brandName = (landingData?.brand_name || 'JLMush Hospital').trim();
    const brandWords = brandName.split(/\s+/);
    const brandPrimary = brandWords[0] || brandName;
    const brandSuffix = brandWords.slice(1).join(' ');
    // const supportEmail = landingData?.support_email || 'support@jlmushhospital.com';
    const brandLogoUrl = landingData?.brand_logo_url || null;
    const brandSubTagline = (landingData?.brand_sub_tagline || '').trim();

    // Build the menu map the navbar dropdown reads: one entry per visible
    // module, holding its visible features in ``display_order``.
    //
    // ``category`` rides along untouched — MegaMenu groups on it to render the
    // dropdown's middle level (module → category → feature) and falls back to
    // a flat list for a module whose features have none. Grouping is decided
    // there, not here, so the mobile drawer below can reuse the same shape.
    const apiCategories = (() => {
        const modules = (landingData?.modules || []).filter((m) => m.is_visible && !m.is_additional);
        if (!modules.length) return {};
        const map = {};
        modules.forEach((mod) => {
            map[mod.name] = (mod.features || [])
                .filter((f) => f.is_visible)
                .map((f) => ({
                    name: f.title,
                    slug: f.slug,
                    category: f.category,
                    description: f.description,
                }));
        });
        return map;
    })();
    const additionalModules = (landingData?.modules || [])
        .filter((m) => m.is_visible && m.is_additional)
        .map((m) => ({ name: m.name, slug: m.slug }));
    if (additionalModules.length > 0) {
        apiCategories['More'] = additionalModules;
    }

    const navHeadings = Object.keys(apiCategories);

    // 'three_level' (module → category → service) or 'two_level' (module →
    // service), set by the admin on the landing config. Defaulted here as well
    // as on the column so a stale cached tree from before the setting existed
    // still renders rather than dropping to an undefined branch.
    const navHierarchy = landingData?.nav_hierarchy || 'three_level';

    // Lookup table for navbar tooltips — the admin's module
    // description shows on hover instead of a generic "[name]" so the
    // platform owner's copy actually surfaces in the UI.
    const moduleDescriptionByName = (() => {
        const out = {};
        (landingData?.modules || []).forEach((m) => {
            if (m.description) out[m.name] = m.description;
        });
        return out;
    })();

    const handleCategoryClick = (categoryId) => {
        const module = (landingData?.modules || []).find((m) => m.name === categoryId);
        if (module?.slug) {
            navigate(`/module/${encodeURIComponent(module.slug)}`);
            setActiveMenu(null);
            setMobileOpen(false);
        }
    };
    // MegaMenu hands us the slug (it falls back to name if slug is missing).
    // Always navigate by slug — the backend's get_public_feature looks up by
    // slug, not by display title, so passing a title produced "service not
    // available" for every nav-dropdown click.
    const handleServiceClick = (slug) => {
        navigate(`/service/${encodeURIComponent(slug)}`);
        setActiveMenu(null);
        setMobileOpen(false);
    };

    // "Pricing" used to be an anchored section on the homepage; now it
    // lives at the dedicated ``/pricing`` route (SaaS pricing — clinics
    // buying their own subdomain). The marketplace tier picker is a
    // distinct flow accessed via the "Join Our Network" CTA → /join.
    const handlePricingClick = () => {
        setMobileOpen(false);
        navigate('/pricing');
    };

    return (
        <>
            {/* Top utility strip — commented out. Support email + Terms/Privacy
                already live in the footer; the strip ate space at the very top.
            <Box sx={{ bgcolor: landing.dark || '#1a2332', color: 'grey.400', fontSize: '0.75rem' }}>
                <Container maxWidth={false}>
                    <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        sx={{ height: 36, px: { xs: 0, md: 2 } }}
                    >
                        <Stack
                            direction="row" alignItems="center" spacing={0.5}
                            sx={{ display: { xs: 'none', sm: 'flex' } }}
                        >
                            <EmailIcon sx={{ fontSize: 14, color: 'grey.500' }} />
                            <Typography
                                variant="caption"
                                sx={{ color: 'grey.400', '&:hover': { color: '#fff' }, transition: 'color 0.2s' }}
                            >
                                {supportEmail}
                            </Typography>
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ fontWeight: 500 }}>
                            <Link
                                component={RouterLink} to="/terms-and-conditions"
                                underline="hover" variant="caption"
                                sx={{ color: 'grey.400', '&:hover': { color: '#fff' } }}
                            >
                                Terms &amp; Conditions
                            </Link>
                            <Typography variant="caption" sx={{ color: 'grey.600' }}>|</Typography>
                            <Link
                                component={RouterLink} to="/privacy-policy"
                                underline="hover" variant="caption"
                                sx={{ color: 'grey.400', '&:hover': { color: '#fff' } }}
                            >
                                Privacy Policy
                            </Link>
                        </Stack>
                    </Stack>
                </Container>
            </Box>
            */}

            {/* Sticky 3-zone navbar */}
            <AppBar
                position="relative"
                elevation={0}
                onMouseLeave={() => setActiveMenu(null)}
                sx={{
                    overflow: "visible",
                    zIndex: (theme) => theme.zIndex.appBar,
                    bgcolor: 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(12px)',
                    borderBottom: '1px solid',
                    borderColor: 'grey.100',
                    color: 'text.primary',
                }}
            >
                <Container maxWidth={false} sx={{ px: { xs: 1, md: 2 } }}>
                    <Toolbar disableGutters={true}
                        sx={{
                            display: 'grid',
                            // Equal-weight side columns keep the center nav on the
                            // viewport's midline even though the actions zone is
                            // much wider than the logo zone. With `auto ... auto`
                            // the middle only centers in the leftover space, which
                            // drags it left.
                            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                            alignItems: 'center',
                            columnGap: { xs: 1, md: 2 },
                        }}
                    >
                        {/* Mobile hamburger — only on screens narrower than lg.
                            Tapping it opens the same module list shown in the
                            desktop center nav, but as a fullscreen Drawer. */}
                        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                            <IconButton
                                onClick={() => setMobileOpen(true)}
                                sx={{ display: { xs: 'inline-flex', lg: 'none' }, color: 'text.primary' }}
                                aria-label="Open menu"
                            >
                                <MenuIcon />
                            </IconButton>

                            {/* ZONE 1: Logo + brand. Logo image renders to the
                                LEFT of the brand text when ``brand_logo_url`` is
                                set (admin-editable). Sub-tagline (also admin-
                                editable) renders BELOW the brand name in a
                                muted style — empty hides cleanly. */}
                            <Stack
                                direction="row"
                                spacing={{ xs: 0.75, md: 1.25 }}
                                alignItems="center"
                                sx={{ minWidth: 0, cursor: 'pointer' }}
                                onClick={() => navigate('/')}
                            >
                                {brandLogoUrl && (
                                    <Box
                                        component="img"
                                        src={brandLogoUrl}
                                        alt={`${brandName} logo`}
                                        sx={{
                                            // Fill (nearly) the whole navbar height so
                                            // the logo reads as the anchor of the bar
                                            // rather than a small inline glyph.
                                            height: { xs: 52, md: 72 },
                                            width: 'auto',
                                            objectFit: 'contain',
                                            flexShrink: 0,
                                        }}
                                    />
                                )}
                                <Box sx={{ lineHeight: 1.1, minWidth: 0, textAlign: 'center' }}>
                                    <Typography
                                        variant="h6" fontWeight={800}
                                        sx={{
                                            letterSpacing: '-0.03em',
                                            fontSize: { xs: '1rem', sm: '1.15rem', md: '1.25rem' },
                                            // Long brand names shorten with an
                                            // ellipsis rather than widening the navbar.
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        <Box component="span" sx={{ color: 'primary.dark'}}>{brandPrimary}</Box>
                                        {brandSuffix && (
                                            <>
                                                {' '}
                                                <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                                                    {brandSuffix}
                                                </Box>
                                            </>
                                        )}
                                    </Typography>
                                    {brandSubTagline && (
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                display: { xs: 'none', sm: 'block' },
                                                // Darker than the old muted grey so the
                                                // tagline reads clearly under the name.
                                                color: 'text.primary',
                                                fontWeight: 500,
                                                fontSize: '0.7rem',
                                                letterSpacing: 0.3,
                                                mt: 0.1,
                                            }}
                                        >
                                            {brandSubTagline}
                                        </Typography>
                                    )}
                                </Box>
                            </Stack>
                        </Stack>

                        {/* ZONE 2: Center nav */}
                        <Stack
                            direction="row" spacing={1}
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                justifyContent: 'center',
                                minWidth: 0,
                                }}
                        >
                            {navHeadings.map((key) => {
                                const tip = moduleDescriptionByName[key] || '';
                                const btn = (
                                    <Button
                                        key={key}
                                        onMouseEnter={() => setActiveMenu(key)}
                                        onClick={() => handleCategoryClick(key)}
                                        endIcon={
                                            <KeyboardArrowDown
                                                sx={{
                                                    fontSize: 16,
                                                    transition: 'transform 0.2s',
                                                    transform: activeMenu === key ? 'rotate(180deg)' : 'none',
                                                }}
                                            />
                                        }
                                        sx={{
                                            textTransform: 'none', fontWeight: 500, fontSize: '0.875rem',
                                            color: activeMenu === key ? 'primary.main' : 'text.secondary',
                                            borderBottom: '2px solid',
                                            borderColor: activeMenu === key ? 'primary.main' : 'transparent',
                                            borderRadius: 0, py: 2.5, px: 1.5,
                                            '&:hover': { color: 'primary.main', bgcolor: 'transparent' },
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        {key}
                                    </Button>
                                );
                                // Skip the tooltip when there's no description so we
                                // don't render an empty popover.
                                return tip
                                    ? <Tooltip key={key} title={tip} placement="bottom" arrow>{btn}</Tooltip>
                                    : btn;
                            })}

                            {/* Pricing — platform marketing only. Lives in the
                                center nav alongside the module headings; hidden
                                on tenant landings since tenant clinics don't
                                sell platform plans. */}
                            {isMarketingLanding && (
                                <Button
                                    onClick={handlePricingClick}
                                    sx={{
                                        textTransform: 'none', fontWeight: 500, fontSize: '0.875rem',
                                        color: 'text.secondary',
                                        borderBottom: '2px solid transparent',
                                        borderRadius: 0, py: 2.5, px: 1.5,
                                        '&:hover': { color: 'primary.main', bgcolor: 'transparent' },
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    Pricing
                                </Button>
                            )}
                        </Stack>

                        {/* ZONE 3: Actions. The language picker sits loose to
                            the left; the CTAs stack in one block: "Join Our
                            Network" spans the full width on top, Login /
                            Register share the row beneath it. A single
                            horizontal rule separates the two rows — no outer
                            border, no divider between Login and Register. */}
                        <Stack
                            direction="row" spacing={1} alignItems="center"
                            sx={{
                                flexShrink: 0,
                                // Pin to the LAST grid column. The center nav is
                                // display:none below lg, so without this zone 3
                                // flows into the middle column and the CTAs sit
                                // right next to the logo with the right-hand
                                // column left empty.
                                gridColumn: '3 / 4',
                                justifyContent: 'flex-end',
                                ml: 'auto',
                            }}
                        >
                            {/* Globe-icon picker for the tenant's
                                ``published_languages``. Auto-hides when
                                fewer than 2 codes — the operator only sees it
                                after adding a second language in the editor. */}
                            <LanguageSelector
                                value={lang}
                                onChange={setLang}
                                availableLanguages={publishedLanguages}
                            />

                            {/* NB: no ``overflow: hidden`` here — the Login /
                                Register dropdowns are absolutely-positioned and
                                would be clipped by it. */}
                            <Box
                                sx={{
                                    display: { xs: 'none', md: 'block' },
                                }}
                            >
                                {/* Top — Join Our Network, full width */}
                                <Button
                                    fullWidth
                                    variant="text"
                                    sx={{
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        fontSize: '0.875rem',
                                        color: 'text.secondary',
                                        py: 0.4,
                                        minHeight: 0,
                                        borderRadius: 0,
                                    }}
                                    onClick={() => navigate('/join')}
                                >
                                    Join Our Network
                                </Button>
                                {/* Bottom — Login / Register */}
                                <Stack
                                    direction="row"
                                    alignItems="stretch"
                                >
                                    {/* Login / Register — one entry per persona
                                        each. See ``PersonaMenuButton`` below for
                                        the interaction + why this isn't a MUI
                                        ``Menu``. */}
                                    {/* Opening a persona dropdown dismisses any
                                        open MegaMenu — the two share a z-index and
                                        the MegaMenu (rendered later in the DOM,
                                        full-width) would otherwise paint over the
                                        login/register panel and make it unreadable.
                                        Closing the hovered-over category as the
                                        persona menu opens is cleaner than stacking
                                        them. */}
                                    <PersonaMenuButton
                                        mode="login"
                                        icon={PersonOutline}
                                        open={openPersonaMenu === 'login'}
                                        onOpen={() => { setActiveMenu(null); setOpenPersonaMenu('login'); }}
                                        onClose={() => setOpenPersonaMenu(null)}
                                        onNavigate={navigate}
                                    />
                                    <PersonaMenuButton
                                        mode="register"
                                        icon={HowToRegIcon}
                                        open={openPersonaMenu === 'register'}
                                        onOpen={() => { setActiveMenu(null); setOpenPersonaMenu('register'); }}
                                        onClose={() => setOpenPersonaMenu(null)}
                                        onNavigate={navigate}
                                    />
                                </Stack>
                            </Box>

                            {/* Mobile counterpart of the block above: below md
                                the persona dropdowns are hidden, which left
                                small screens with no visible auth entry point
                                other than the burger menu. These go straight to
                                the ``/login`` / ``/register`` tile pages no
                                hover dropdown, which is the wrong interaction
                                on touch. The drawer keeps its own copies. */}
                            <Stack
                                direction="row" spacing={0.25} alignItems="center"
                                sx={{ display: { xs: 'flex', md: 'none' } }}
                            >
                                <Button
                                    size="small"
                                    startIcon={<PersonOutline sx={{ fontSize: 16 }} />}
                                    onClick={() => navigate(CHOOSER_MODES.login.chooserRoute)}
                                    sx={{
                                        textTransform: 'none', fontWeight: 600,
                                        fontSize: '0.8rem', color: 'text.secondary',
                                        px: 0.75, minWidth: 0, whiteSpace: 'nowrap',
                                    }}
                                >
                                    {CHOOSER_MODES.login.navLabel}
                                </Button>
                                <Button
                                    size="small"
                                    startIcon={<HowToRegIcon sx={{ fontSize: 16 }} />}
                                    onClick={() => navigate(CHOOSER_MODES.register.chooserRoute)}
                                    sx={{
                                        textTransform: 'none', fontWeight: 600,
                                        fontSize: '0.8rem', color: 'text.secondary',
                                        px: 0.75, minWidth: 0, whiteSpace: 'nowrap',
                                    }}
                                >
                                    {CHOOSER_MODES.register.navLabel}
                                </Button>
                            </Stack>
                        </Stack>
                    </Toolbar>
                </Container>

                <MegaMenu
                    activeMenu={activeMenu}
                    onClose={() => setActiveMenu(null)}
                    onNavigate={handleCategoryClick}
                    onServiceClick={handleServiceClick}
                    categories={apiCategories}
                    descriptions={moduleDescriptionByName}
                    hierarchy={navHierarchy}
                />
            </AppBar>

            {/* ───────── Mobile Drawer ───────── */}
            <Drawer
                anchor="left"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                PaperProps={{ sx: { width: { xs: '85vw', sm: 360 } } }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'grey.100' }}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                        {brandLogoUrl && (
                            <Box
                                component="img"
                                src={brandLogoUrl}
                                alt={`${brandName} logo`}
                                sx={{ height: 32, width: 'auto', maxWidth: 120, objectFit: 'contain' }}
                            />
                        )}
                        <Box sx={{ lineHeight: 1.1 }}>
                            <Typography variant="h6" fontWeight={800} sx={{ letterSpacing: '-0.03em' }}>
                                <Box component="span" sx={{ color: 'primary.main' }}>{brandPrimary}</Box>
                                {brandSuffix && (
                                    <>
                                        {' '}
                                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>{brandSuffix}</Box>
                                    </>
                                )}
                            </Typography>
                            {brandSubTagline && (
                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.7rem' }}>
                                    {brandSubTagline}
                                </Typography>
                            )}
                        </Box>
                    </Stack>
                    <IconButton onClick={() => setMobileOpen(false)} aria-label="Close menu">
                        <CloseIcon />
                    </IconButton>
                </Box>
                <List sx={{ py: 1 }}>
                    {navHeadings.map((key) => {
                        const features = apiCategories[key] || [];
                        const expanded = mobileExpandedModule === key;
                        // Same grouping the desktop panel uses, and gated on
                        // the same setting, so a module reads the same on a
                        // phone as it does on a laptop. ``null`` — two-level
                        // asked for, or no feature carries a category — keeps
                        // the flat list rather than inventing a heading.
                        const groups = navHierarchy === 'two_level'
                            ? null
                            : groupByCategory(features);
                        return (
                            <Box key={key}>
                                <ListItemButton
                                    onClick={() => {
                                        if (features.length > 0) {
                                            setMobileExpandedModule(expanded ? null : key);
                                        } else {
                                            handleCategoryClick(key);
                                        }
                                    }}
                                >
                                    <ListItemText
                                        primary={key}
                                        primaryTypographyProps={{ fontWeight: 600 }}
                                    />
                                    {features.length > 0 && (expanded ? <ExpandLess /> : <ExpandMore />)}
                                </ListItemButton>
                                <Collapse in={expanded} timeout="auto" unmountOnExit>
                                    <List disablePadding>
                                        <ListItemButton
                                            sx={{ pl: 4 }}
                                            onClick={() => handleCategoryClick(key)}
                                        >
                                            <ListItemText
                                                primary={`View all ${key}`}
                                                primaryTypographyProps={{ fontSize: '0.85rem', color: 'primary.main', fontWeight: 600 }}
                                            />
                                        </ListItemButton>
                                        {groups
                                            ? groups.map((group) => (
                                                <MobileCategorySection
                                                    key={group.name}
                                                    group={group}
                                                    onServiceClick={handleServiceClick}
                                                />
                                            ))
                                            : features.map((f) => (
                                                <ListItemButton
                                                    key={f.slug || f.name}
                                                    sx={{ pl: 4 }}
                                                    onClick={() => handleServiceClick(f.slug || f.name)}
                                                >
                                                    <ListItemText
                                                        primary={f.name}
                                                        primaryTypographyProps={{ fontSize: '0.85rem' }}
                                                    />
                                                </ListItemButton>
                                            ))}
                                    </List>
                                </Collapse>
                            </Box>
                        );
                    })}
                    {additionalModules.length > 0 && (
                        <>
                            <Divider sx={{ my: 1 }} />
                            {additionalModules.map((m) => (
                                <ListItemButton
                                    key={m.name}
                                    onClick={() => handleCategoryClick(m.name)}
                                >
                                    <ListItemText
                                        primary={m.name}
                                        primaryTypographyProps={{ fontWeight: 600 }}
                                    />
                                </ListItemButton>
                            ))}
                        </>
                    )}
                    {isMarketingLanding && (
                        <ListItemButton onClick={handlePricingClick}>
                            <PriceChangeIcon fontSize="small" sx={{ mr: 1.5, color: 'primary.main' }} />
                            <ListItemText
                                primary="Pricing"
                                primaryTypographyProps={{ fontWeight: 600 }}
                            />
                        </ListItemButton>
                    )}
                    {/* Mobile counterpart of the desktop Login / Register
                        dropdowns. Flattened to one entry per persona — a
                        nested dropdown inside an already-nested drawer buys
                        nothing, and the drawer has the vertical room. */}
                    {['login', 'register'].map((mode) => (
                        <DrawerChooserSection
                            key={mode}
                            mode={mode}
                            onNavigate={(route) => { setMobileOpen(false); navigate(route); }}
                        />
                    ))}
                </List>
            </Drawer>
        </>
    );
}

// ---------------------------------------------------------------------------

/**
 * One category inside an expanded module in the mobile drawer — the third
 * level of the nav, matching the desktop panel's category rail.
 *
 * Collapsed by default, unlike the module level above it. A module with five
 * categories of six services each is thirty rows; opening all of them at once
 * would bury the modules below it and make the drawer a scroll marathon. Its
 * own component so each category tracks its own open state.
 */
function MobileCategorySection({ group, onServiceClick }) {
    const [open, setOpen] = useState(false);
    return (
        <Box>
            <ListItemButton sx={{ pl: 4 }} onClick={() => setOpen((v) => !v)}>
                <ListItemText
                    primary={group.name}
                    secondary={`${group.items.length} service${group.items.length === 1 ? '' : 's'}`}
                    primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 600 }}
                    secondaryTypographyProps={{ fontSize: '0.7rem' }}
                />
                {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </ListItemButton>
            <Collapse in={open} timeout="auto" unmountOnExit>
                <List disablePadding>
                    {group.items.map((f) => (
                        <ListItemButton
                            key={f.slug || f.name}
                            sx={{ pl: 6 }}
                            onClick={() => onServiceClick(f.slug || f.name)}
                        >
                            <ListItemText
                                primary={f.name}
                                primaryTypographyProps={{ fontSize: '0.82rem' }}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </Collapse>
        </Box>
    );
}

// ---------------------------------------------------------------------------

/**
 * One mode's worth of entries in the mobile drawer — the counterpart of the
 * desktop ``PersonaMenuButton`` dropdown. Flattened to one entry per choice:
 * a nested dropdown inside an already-nested drawer buys nothing, and the
 * drawer has the vertical room.
 *
 * Its own component rather than inline in the drawer's ``['login',
 * 'register'].map(…)`` because ``useChooserItems`` is a hook and can't be
 * called from inside that loop. Renders nothing until its items land.
 */
function DrawerChooserSection({ mode, onNavigate }) {
    const { items } = useChooserItems(mode);
    if (items.length === 0) return null;

    // Separator between the receiver (patient) block and the providers.
    const dividerBeforeKey = receiverDividerKey(items);

    return (
        <Box>
            <Divider sx={{ my: 1 }} />
            {items.map((item) => (
                <Box key={item.key}>
                    {item.key === dividerBeforeKey && <Divider sx={{ my: 0.5 }} />}
                    <ListItemButton onClick={() => onNavigate(item.route)}>
                        <ChooserItemIcon item={item} fontSize="small" sx={{ mr: 1.5 }} />
                        <ListItemText primary={item.menuLabel} />
                    </ListItemButton>
                </Box>
            ))}
        </Box>
    );
}

// ---------------------------------------------------------------------------

/**
 * A navbar button that opens a persona dropdown on hover and navigates to the
 * matching tile-picker page on click. Drives both Login and Register — the
 * ``mode`` selects the labels and per-persona routes out of ``CHOOSER_MODES``.
 *
 * Hovering opens the panel, which is the same interaction the module headings
 * in the center nav already use. Clicking the button itself skips the shortcut
 * and lands on the ``/login`` or ``/register`` tile page, which offers the same
 * four choices with room to explain them.
 *
 * Deliberately NOT a MUI ``Menu``: that mounts a Modal whose invisible backdrop
 * eats the next click anywhere on the page — fine for a click-opened menu,
 * hostile for a hover-opened one, where merely brushing past the button would
 * swallow your next click. The absolutely-positioned Paper is the same approach
 * ``MegaMenu`` uses, and the AppBar's ``overflow: visible`` is what lets it
 * escape the toolbar.
 */
function PersonaMenuButton({ mode, icon: ButtonIcon, open, onOpen, onClose, onNavigate }) {
    const cfg = CHOOSER_MODES[mode];
    // Items come from the backend's vertical types, so they can be empty for
    // the first frames. The button still renders and still routes to the tile
    // page, which owns the loading / error copy — a navbar dropdown is the
    // wrong place for a spinner.
    const { items } = useChooserItems(mode);
    // Separator between the receiver (patient) block and the providers.
    const dividerBeforeKey = receiverDividerKey(items);

    return (
        <Box
            sx={{ position: 'relative', display: { xs: 'none', md: 'flex' } }}
            onMouseEnter={onOpen}
            onMouseLeave={onClose}
        >
            <Button
                variant="text"
                onClick={() => onNavigate(cfg.chooserRoute)}
                endIcon={
                    <KeyboardArrowDown
                        sx={{
                            fontSize: 16,
                            transition: 'transform 0.2s',
                            transform: open ? 'rotate(180deg)' : 'none',
                        }}
                    />
                }
                sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    color: open ? 'primary.main' : 'text.secondary',
                }}
            >
                <ButtonIcon sx={{ fontSize: 18, mr: 0.5 }} />
                {cfg.navLabel}
            </Button>
            {open && (
                <Paper
                    elevation={8}
                    sx={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        minWidth: 210,
                        // Above the MegaMenu panel (also zIndex 50, but rendered
                        // later in the DOM so it would win on a tie) — belt-and-
                        // suspenders alongside closing the MegaMenu on open.
                        zIndex: 60,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'grey.100',
                        overflow: 'hidden',
                    }}
                >
                    <MenuList disablePadding>
                        {items.map((item) => {
                            return (
                                <div key={item.key}>
                                {item.key === dividerBeforeKey && <Divider sx={{ my: 0.5 }} />}
                                <MenuItem
                                    onClick={() => {
                                        onClose();
                                        onNavigate(item.route);
                                    }}
                                    sx={{
                                        py: 1.25,
                                        px: 2,
                                        // Same resting/hover colours as the nav
                                        // headings and the button itself.
                                        color: 'text.secondary',
                                        transition: 'color 0.2s, background-color 0.2s',
                                        '&:hover': {
                                            color: 'primary.main',
                                            bgcolor: 'action.hover',
                                        },
                                        // Let the icon ride the text colour instead
                                        // of MUI's default muted action grey.
                                        '& .MuiListItemIcon-root': { color: 'inherit' },
                                    }}
                                >
                                    <ListItemIcon sx={{ minWidth: 32 }}>
                                        <ChooserItemIcon item={item} sx={{ fontSize: 18 }} />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={item.menuLabel}
                                        primaryTypographyProps={{
                                            fontSize: '0.875rem',
                                            fontWeight: 600,
                                            letterSpacing: 0,
                                        }}
                                    />
                                </MenuItem>
                                </div>
                            );
                        })}
                    </MenuList>
                </Paper>
            )}
        </Box>
    );
}

// ---------------------------------------------------------------------------

function PublicFooter({ landingData }) {
    // Same brand / contact resolution as the header — admin-editable
    // ``landing_configs.brand_name`` / ``support_email``, with
    // generic-default fallbacks for fresh / empty configs.
    const brandName = (landingData?.brand_name || 'JLMush Hospital').trim();
    const brandWords = brandName.split(/\s+/);
    const brandPrimary = brandWords[0] || brandName;
    const brandSuffix = brandWords.slice(1).join(' ');
    const supportEmail = landingData?.support_email || 'support@jlmushhospital.com';
    const brandLogoUrl = landingData?.brand_logo_url || null;
    const brandSubTagline = (landingData?.brand_sub_tagline || '').trim();
    const theme = useTheme();
    const landing = theme.palette.landing || {};

    return (
        <Box
            component="footer"
            sx={{
                mt: 'auto',
                bgcolor: landing.dark || '#1a2332',
                color: 'grey.400',
                pt: { xs: 6, md: 8 },
            }}
        >
            <Container maxWidth="lg">
                {/* Brand cell — single column, full width. The old layout
                    surfaced the tenant's landing MODULES as link columns
                    next to the brand block; that turned out to be
                    misleading (modules are top-nav navigation, not footer
                    sitemap entries) so the columns were dropped. The
                    footer now is just brand identity + contact + legal. */}
                <Box sx={{ mb: 4, maxWidth: 600 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
                        {brandLogoUrl && (
                            <Box
                                component="img"
                                src={brandLogoUrl}
                                alt={`${brandName} logo`}
                                sx={{
                                    height: 44, width: 'auto', maxWidth: 180,
                                    objectFit: 'contain',
                                    // Slight brightness lift so a dark-text logo
                                    // doesn't disappear on the dark footer bg.
                                    filter: 'brightness(1.05)',
                                }}
                            />
                        )}
                        <Box sx={{ lineHeight: 1.1 }}>
                            <Typography
                                variant="h6" fontWeight={800}
                                sx={{ color: '#fff', letterSpacing: '-0.02em' }}
                            >
                                <Box component="span" sx={{ color: theme.palette.primary.light }}>{brandPrimary}</Box>
                                {brandSuffix && (
                                    <>
                                        {' '}
                                        <Box component="span" sx={{ color: 'grey.300', fontWeight: 400 }}>{brandSuffix}</Box>
                                    </>
                                )}
                            </Typography>
                            {brandSubTagline && (
                                <Typography variant="caption" sx={{ display: 'block', color: 'grey.500', fontSize: '0.7rem' }}>
                                    {brandSubTagline}
                                </Typography>
                            )}
                        </Box>
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'grey.500', lineHeight: 1.7, mb: 2 }}>
                        {landingData?.marketing_tagline
                            || 'Modern healthcare, simplified. Book appointments, consult doctors online, and manage your records — all in one place.'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'grey.600', display: 'block' }}>
                        {supportEmail}
                    </Typography>
                </Box>

                <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={2}
                    sx={{ py: 3 }}
                >
                    <Typography variant="body2" sx={{ color: 'grey.500' }}>
                        &copy; {new Date().getFullYear()} {brandName}. All rights reserved.
                    </Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <Link
                            component={RouterLink} to="/terms-and-conditions"
                            variant="body2" underline="hover"
                            sx={{ color: 'grey.500', '&:hover': { color: '#fff' } }}
                        >
                            Terms &amp; Conditions
                        </Link>
                        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />
                        <Link
                            component={RouterLink} to="/privacy-policy"
                            variant="body2" underline="hover"
                            sx={{ color: 'grey.500', '&:hover': { color: '#fff' } }}
                        >
                            Privacy Policy
                        </Link>
                    </Stack>
                </Stack>
            </Container>
        </Box>
    );
}