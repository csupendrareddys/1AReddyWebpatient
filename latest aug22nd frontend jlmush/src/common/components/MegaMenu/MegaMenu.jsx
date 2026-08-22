import { useState } from 'react';
import {
  Box, Typography, Paper, Grid2 as Grid, Button, Chip, Stack, Divider,
  alpha, useTheme,
} from '@mui/material';
import { ChevronRight, KeyboardArrowRight } from '@mui/icons-material';
import { PRODUCT_CATEGORIES } from '../../../data/hospitalServices';
import { groupByCategory } from './featureCategories';

/**
 * Mega menu renders the panel under the currently-active nav heading.
 *
 * ── Two levels or three ──
 * ``hierarchy`` is the operator's choice, stored on the landing config as
 * ``nav_hierarchy``:
 *
 *   'three_level' — module → category → feature, the shape a bank's nav uses
 *                   (Personal → Accounts → Savings Account). The middle level
 *                   exists because a module with thirty features rendered flat
 *                   is a wall of links: it gives the panel a spine to hang
 *                   them off and room to grow without getting taller. A
 *                   category is a label on the feature, not a row of its own —
 *                   see ``featureCategories.js``.
 *   'two_level'    — module → feature, one flat list. The right answer for a
 *                   site of small modules, where a middle level is a click
 *                   that buys the visitor nothing.
 *
 * Three-level still falls back to the flat layout for any module whose
 * features carry no category — there is nothing to group by, and a rail with
 * one entry reading the module's own name is a level that isn't there. So the
 * setting reads as a ceiling: three-level means "group where you can", not
 * "always show a rail".
 *
 * ``activeMenu === 'More'`` is handled as a third, separate branch
 * (``renderMoreMenu``). "More" isn't a real category with features under it —
 * it's a flat collection of whole modules that were toggled off via
 * ``is_visible: false``. Each entry there is a MODULE, not a feature, so:
 *   - there's no left info box / "View All Services" (there's no single
 *     category to "view all" of)
 *   - each tile calls ``onNavigate(item.name)`` — the same handler used
 *     when clicking a normal nav heading — instead of ``onServiceClick``,
 *     since these route to ``/module/<slug>``, not ``/service/<slug>``.
 *
 * Data source priority (features branches only):
 *   1. ``categories`` prop — map of ``{headingTitle: [{name, slug?,
 *      category?, description?}, ...]}``. Passed in by ``PublicLandingLayout``
 *      from the landing-page-config API's LIVE navigation data.
 *   2. Fallback: the hardcoded ``PRODUCT_CATEGORIES`` constant (used until
 *      the tenant configures navigation via the admin editor). Its items
 *      carry no ``category``, so it always renders two-level.
 *
 * Colours come from the theme rather than literal hex: the landing palette is
 * admin-editable per tenant (``primary_color`` on the landing config), and a
 * hardcoded blue would leave the nav the one surface ignoring a tenant's brand.
 */
const PANEL_SX = {
  position: 'absolute',
  top: '100%',
  left: 0,
  width: '100%',
  bgcolor: '#fff',
  borderTop: '1px solid',
  borderColor: 'grey.100',
  py: 5,
  px: 4,
  // A category can carry ~30 features; without a cap the panel runs past the
  // fold and the tail is unreachable (closing on mouse-leave beats scrolling).
  maxHeight: 'calc(100vh - 140px)',
  overflowY: 'auto',
  zIndex: 50,
  borderRadius: 0,
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', // shadow-2xl
  animation: 'fadeIn 0.3s ease',
  '@keyframes fadeIn': {
    from: { opacity: 0, transform: 'translateY(-8px) scaleY(0.98)' },
    to: { opacity: 1, transform: 'translateY(0) scaleY(1)' },
  },
};

/** Column heights are capped rather than the whole panel, so the category rail
 *  stays put while a long feature list scrolls beside it. */
const SCROLL_COL_SX = {
  maxHeight: 'calc(100vh - 260px)',
  overflowY: 'auto',
  // A thin scrollbar reads as part of the panel; the OS default reads as a
  // frame around it.
  scrollbarWidth: 'thin',
  '&::-webkit-scrollbar': { width: 6 },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 3,
  },
};

// -----------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------

/**
 * The left card: what this module is, and the way through to its own page.
 *
 * ``description`` is the admin's own copy for the module. When they haven't
 * written any we fall back to a generic line rather than leaving a hole — an
 * empty card next to a full list looks broken, not minimal.
 */
function ModuleCard({ title, description, count, onOpen, theme }) {
  return (
    <Box
      sx={{
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, #ffffff 100%)`,
        borderRadius: 4,
        p: 3.5,
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.15),
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography
        variant="h5"
        fontWeight={800}
        sx={{ letterSpacing: '-0.02em', fontSize: '1.5rem', color: '#0f172a', mb: 1.5 }}
      >
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mb: 2.5, lineHeight: 1.7, color: '#475569', fontSize: '0.875rem',
          display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {description
          || `Professional healthcare services for all your ${title.toLowerCase()} needs. `
             + 'Fast, secure, and fully online.'}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      {count > 0 && (
        <Chip
          size="small"
          variant="outlined"
          label={`${count} service${count === 1 ? '' : 's'}`}
          sx={{ alignSelf: 'flex-start', mb: 1.5, borderColor: alpha(theme.palette.primary.main, 0.3) }}
        />
      )}
      <Button
        onClick={onOpen}
        endIcon={<ChevronRight sx={{ width: 16, height: 16 }} />}
        sx={{
          textTransform: 'none',
          fontWeight: 700,
          fontSize: '0.875rem',
          color: 'primary.main',
          px: 0,
          minWidth: 0,
          alignSelf: 'flex-start',
          '&:hover': { bgcolor: 'transparent', transform: 'translateX(4px)' },
          transition: 'transform 0.2s',
        }}
      >
        View All Services
      </Button>
    </Box>
  );
}

/** One feature link. Shared by both feature layouts so a service looks the
 *  same whether or not its module happens to use categories. */
function FeatureLink({ item, onSelect, theme, showDescription }) {
  const Icon = item.icon || null;
  return (
    <Button
      fullWidth
      onClick={onSelect}
      sx={{
        justifyContent: 'flex-start',
        // A wrapping label must stay flush-left and keep its marker on the
        // first line, not centre itself in the row.
        alignItems: 'flex-start',
        textAlign: 'left',
        textTransform: 'none',
        color: '#475569',
        fontWeight: 500,
        fontSize: '0.95rem',
        lineHeight: 1.5,
        py: 1,
        px: 1,
        borderRadius: 2,
        '& .MuiButton-startIcon': {
          alignSelf: 'flex-start',
          mt: Icon ? '4px' : '9px', // centres the 6px dot on the first text line
        },
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.06),
          color: 'primary.dark',
          '& .mega-dot': { bgcolor: 'primary.main' },
        },
      }}
      startIcon={
        Icon ? (
          <Icon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
        ) : (
          <Box
            className="mega-dot"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: '#d1d5db',
              transition: 'background-color 0.2s',
              flexShrink: 0,
              mr: 0.5,
            }}
          />
        )
      }
    >
      {/* Spans throughout — this renders inside a <button>, whose content
          model is phrasing content only. */}
      <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
        <Box component="span" sx={{ display: 'block' }}>{item.name}</Box>
        {showDescription && item.description && (
          <Typography
            component="span"
            variant="caption"
            sx={{
              display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', color: 'text.secondary', fontWeight: 400,
              textTransform: 'none', mt: 0.25,
            }}
          >
            {item.description}
          </Typography>
        )}
      </Box>
    </Button>
  );
}

// -----------------------------------------------------------------------
// "More" branch — flat grid of module tiles, no left info box.
// -----------------------------------------------------------------------
function renderMoreMenu({ items, onClose, onNavigate }) {
  return (
    <Paper elevation={8} onMouseLeave={onClose} sx={PANEL_SX}>
      <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
        <Grid container spacing={2}>
          {items.map((item, idx) => (
            <Grid size={4} key={item.slug || item.name || idx}>
              <Box
                component="button"
                onClick={() => {
                  onNavigate(item.name);
                  onClose();
                }}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  width: '100%',
                  textAlign: 'center',
                  bgcolor: 'grey.50',
                  border: '1px solid',
                  borderColor: 'grey.200',
                  borderRadius: 1,
                  p: 1.5,
                  cursor: 'pointer',
                  font: 'inherit',
                  transition: 'border-color 0.2s, background-color 0.2s, transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: 'primary.50',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
                  },
                }}
              >
                <Typography variant="subtitle1" fontWeight={700} color="text.primary" sx={{ mb: item.description ? 0.75 : 0 }}>
                  {item.name}
                </Typography>
                {item.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                    {item.description}
                  </Typography>
                )}
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Paper>
  );
}

// -----------------------------------------------------------------------
// Two-level branch — left info box + right feature list.
// Used when a module's features carry no categories.
// -----------------------------------------------------------------------
function renderFeaturesMenu({
  activeMenu, description, services, onClose, onNavigate, onServiceClick, theme,
}) {
  return (
    <Paper elevation={8} onMouseLeave={onClose} sx={PANEL_SX}>
      <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
        <Grid container spacing={5}>
          <Grid size={{ xs: 12, md: 3 }}>
            <ModuleCard
              title={activeMenu}
              description={description}
              count={services.length}
              onOpen={() => { onNavigate(activeMenu); onClose(); }}
              theme={theme}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 9 }}>
            <Grid container rowSpacing={1.5} columnSpacing={3} alignItems="flex-start"
              sx={SCROLL_COL_SX}>
              {services.map((item, idx) => (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.slug || item.name || idx}>
                  <FeatureLink
                    item={item}
                    theme={theme}
                    onSelect={() => {
                      // API items expose ``slug`` — prefer it for navigation;
                      // legacy hardcoded items only have ``name``.
                      onServiceClick(item.slug || item.name);
                      onClose();
                    }}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Paper>
  );
}

// -----------------------------------------------------------------------
// Three-level branch — info box + category rail + the active category's
// features.
// -----------------------------------------------------------------------
function CategorisedMenu({
  activeMenu, description, groups, total, onClose, onNavigate, onServiceClick, theme,
}) {
  // Which category's features are showing. Stored WITH the module it belongs
  // to so moving to another nav heading starts at that module's first
  // category rather than at whichever index happened to be open — the two
  // modules' category lists have nothing to do with each other.
  const [active, setActive] = useState({ menu: null, cat: null });
  const activeCat = active.menu === activeMenu ? active.cat : null;
  const current = groups.find((g) => g.name === activeCat) || groups[0];
  const showDescriptions = current.items.some((i) => i.description);

  return (
    <Paper elevation={8} onMouseLeave={onClose} sx={PANEL_SX}>
      <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
        <Grid container spacing={4}>
          {/* Level 1 — the module itself */}
          <Grid size={{ xs: 12, md: 3 }}>
            <ModuleCard
              title={activeMenu}
              description={description}
              count={total}
              onOpen={() => { onNavigate(activeMenu); onClose(); }}
              theme={theme}
            />
          </Grid>

          {/* Level 2 — the category rail */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography
              variant="overline"
              sx={{ color: 'text.disabled', fontWeight: 700, letterSpacing: '0.08em', pl: 1.5 }}
            >
              Categories
            </Typography>
            <Stack spacing={0.25} sx={{ mt: 0.5, ...SCROLL_COL_SX }}>
              {groups.map((group) => {
                const isActive = group.name === current.name;
                return (
                  <Box
                    key={group.name}
                    component="button"
                    type="button"
                    // Hover switches — the same gesture that opened the panel
                    // keeps working, so browsing the whole module never needs
                    // a click. Focus does too, so a keyboard tab through the
                    // rail shows each category's features as it lands.
                    onMouseEnter={() => setActive({ menu: activeMenu, cat: group.name })}
                    onFocus={() => setActive({ menu: activeMenu, cat: group.name })}
                    onClick={() => setActive({ menu: activeMenu, cat: group.name })}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      width: '100%',
                      font: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                      px: 1.5,
                      py: 1.25,
                      border: 'none',
                      borderLeft: '3px solid',
                      borderLeftColor: isActive ? 'primary.main' : 'transparent',
                      borderRadius: '0 8px 8px 0',
                      bgcolor: isActive
                        ? alpha(theme.palette.primary.main, 0.08)
                        : 'transparent',
                      color: isActive ? 'primary.dark' : '#334155',
                      transition: 'background-color 0.18s, color 0.18s, border-color 0.18s',
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                    }}
                  >
                    {/* All spans: a <button>'s content model is phrasing
                        content, so the default <p>/<div> these would render
                        as is invalid inside one. */}
                    <Box component="span" sx={{ display: 'block', minWidth: 0, flexGrow: 1 }}>
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          display: 'block',
                          fontWeight: isActive ? 700 : 600,
                          fontSize: '0.9rem',
                          lineHeight: 1.35,
                          color: 'inherit',
                          // The rail is narrow on purpose; a long category
                          // name wraps rather than widening the column and
                          // squeezing the feature list.
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {group.name}
                      </Typography>
                      <Typography
                        component="span" variant="caption"
                        sx={{ display: 'block', color: 'text.disabled' }}
                      >
                        {group.items.length} service{group.items.length === 1 ? '' : 's'}
                      </Typography>
                    </Box>
                    <KeyboardArrowRight
                      sx={{
                        fontSize: 18,
                        flexShrink: 0,
                        color: 'primary.main',
                        opacity: isActive ? 1 : 0,
                        transform: isActive ? 'translateX(0)' : 'translateX(-4px)',
                        transition: 'opacity 0.18s, transform 0.18s',
                      }}
                    />
                  </Box>
                );
              })}
            </Stack>
          </Grid>

          {/* Level 3 — the active category's features */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack
              direction="row" alignItems="baseline" spacing={1}
              sx={{ pl: 1, mb: 0.5 }}
            >
              <Typography
                variant="overline"
                sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: '0.08em' }}
              >
                {current.name}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                {current.items.length} service{current.items.length === 1 ? '' : 's'}
              </Typography>
            </Stack>
            <Divider sx={{ mb: 1 }} />
            <Grid
              container
              rowSpacing={0.5}
              columnSpacing={2}
              alignItems="flex-start"
              // Keyed on the category so switching re-runs the fade rather
              // than swapping the text in place — without it the panel gives
              // no sign that the right-hand list is now a different list.
              key={current.name}
              sx={{
                ...SCROLL_COL_SX,
                animation: 'megaFade 0.22s ease',
                '@keyframes megaFade': {
                  from: { opacity: 0, transform: 'translateX(6px)' },
                  to: { opacity: 1, transform: 'translateX(0)' },
                },
              }}
            >
              {current.items.map((item, idx) => (
                // One column when the services carry a blurb — two columns of
                // wrapped title-plus-description is a wall, and the pane is
                // only half the panel's width. Two when they're bare names.
                <Grid
                  size={showDescriptions ? 12 : { xs: 12, sm: 6 }}
                  key={item.slug || item.name || idx}
                >
                  <FeatureLink
                    item={item}
                    theme={theme}
                    showDescription={showDescriptions}
                    onSelect={() => {
                      onServiceClick(item.slug || item.name);
                      onClose();
                    }}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Paper>
  );
}

const MegaMenu = ({
  activeMenu, onClose, onNavigate, onServiceClick, categories, descriptions = {},
  hierarchy = 'three_level',
}) => {
  const theme = useTheme();
  const source = categories && Object.keys(categories).length ? categories : PRODUCT_CATEGORIES;
  if (!activeMenu || !source[activeMenu]) return null;

  const items = source[activeMenu];

  if (activeMenu === 'More') {
    return renderMoreMenu({ items, onClose, onNavigate });
  }

  // Grouping is only attempted when the operator asked for three levels.
  // ``groupByCategory`` still returns null for a module with nothing
  // categorised, so both paths can land on the flat layout below.
  const groups = hierarchy === 'two_level' ? null : groupByCategory(items);
  if (groups) {
    return (
      <CategorisedMenu
        activeMenu={activeMenu}
        description={descriptions[activeMenu]}
        groups={groups}
        total={items.length}
        onClose={onClose}
        onNavigate={onNavigate}
        onServiceClick={onServiceClick}
        theme={theme}
      />
    );
  }

  return renderFeaturesMenu({
    activeMenu,
    description: descriptions[activeMenu],
    services: items,
    onClose,
    onNavigate,
    onServiceClick,
    theme,
  });
};

export default MegaMenu;
