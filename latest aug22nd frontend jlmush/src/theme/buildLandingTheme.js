/**
 * Build a per-tenant MUI theme for the public landing tree from the API
 * payload returned by ``GET /api/landing/public``.
 *
 * The shape we consume:
 *
 *     {
 *       theme_preset:    'ocean' | 'emerald' | … | 'custom',
 *       primary_color:   '#1976d2',
 *       secondary_color: '#26a69a',
 *       accent_color:    '#42a5f5',
 *       background_color:'#f5f9ff',
 *       hero_style:      'gradient' | 'solid' | 'pattern',
 *     }
 *
 * Anything missing falls back to the ``ocean`` preset — viewers always see a
 * coherent palette even before an admin has saved one. We expose the chosen
 * tokens both via the standard MUI palette (primary / secondary) and via the
 * custom ``palette.landing`` namespace so deeply themed sections (the dark
 * "Why choose us" band, the hero gradient stops) can read them without
 * polluting MUI's typed surfaces.
 */
import { createTheme } from '@mui/material/styles';
import { lightTheme } from './theme';
import { LANDING_THEME_PRESETS, resolveLandingPreset } from './landingThemePresets';

// --------------------------------------------------------------------------- //
// Color helpers — minimal, no library
// --------------------------------------------------------------------------- //

/** Parse ``#RGB`` / ``#RRGGBB`` into [r,g,b]. Returns null on garbage input. */
function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbToHex = ([r, g, b]) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

/** Mix ``hex`` with white by ``amount`` (0..1). 1 = full white. */
function lighten(hex, amount) {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    return rgbToHex(rgb.map((c) => c + (255 - c) * amount));
}

/** Mix ``hex`` with black by ``amount`` (0..1). 1 = full black. */
function darken(hex, amount) {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    return rgbToHex(rgb.map((c) => c * (1 - amount)));
}

/**
 * Pick a "section-dark" color suitable for the "Why choose us" band and the
 * footer when the admin's primary is light/saturated. We desaturate toward
 * a near-black tinted with the primary's hue so the page stays cohesive.
 */
function deriveDark(primary) {
    const rgb = parseHex(primary);
    if (!rgb) return '#1a2332';
    // 88% black + 12% primary tint = readable dark with hint of brand.
    return rgbToHex(rgb.map((c) => c * 0.12 + 0 * 0.88));
}

// --------------------------------------------------------------------------- //
// Theme builder
// --------------------------------------------------------------------------- //

export function buildLandingTheme(landingData) {
    const preset = (landingData?.theme_preset || 'ocean').toLowerCase();
    const isCustom = preset === 'custom';

    // For named presets, every visual token (including hero gradient + dark
    // band) comes from the preset table — that's what makes the picker tiles
    // a meaningful one-click action.
    //
    // For 'custom', everything has to be DERIVED from the four hex fields
    // the admin saved. Falling back to the Ocean preset's hero/dark colors
    // (the previous bug) made the page LOOK ocean-themed even when buttons
    // were red — confusing and made the 4th color (background) feel like a
    // dead control.
    const presetVals = isCustom
        ? null
        : (resolveLandingPreset(preset) || LANDING_THEME_PRESETS.ocean);

    const fallback = LANDING_THEME_PRESETS.ocean;

    const primary = isCustom
        ? (landingData?.primary_color || fallback.primary)
        : presetVals.primary;
    const secondary = isCustom
        ? (landingData?.secondary_color || fallback.secondary)
        : presetVals.secondary;
    const accent = isCustom
        ? (landingData?.accent_color || fallback.accent)
        : presetVals.accent;
    const background = isCustom
        ? (landingData?.background_color || fallback.background)
        : presetVals.background;

    // Hero gradient stops — for named presets use the picked stops; for
    // custom, lighten the page background and the primary so the hero feels
    // related to the rest of the palette without being garish.
    const heroFrom = isCustom ? lighten(background, 0.35) : presetVals.heroFrom;
    const heroTo = isCustom ? lighten(primary, 0.85) : presetVals.heroTo;

    // Dark band — named presets ship a hand-picked dark; custom derives it
    // from the primary so the band still feels on-brand.
    const dark = isCustom ? deriveDark(primary) : presetVals.dark;

    const heroStyle = landingData?.hero_style || 'gradient';

    return createTheme({
        ...lightTheme,
        palette: {
            ...lightTheme.palette,
            primary: { main: primary, light: lighten(primary, 0.4), dark: darken(primary, 0.2) },
            secondary: { main: secondary, light: lighten(secondary, 0.4), dark: darken(secondary, 0.2) },
            background: {
                ...lightTheme.palette.background,
                default: background,
            },
            // Custom namespace — pages read tokens here for hero gradient
            // stops, dark-band background, etc. Keeps MUI's palette surface
            // un-extended (no TS surprises).
            landing: {
                primary,
                secondary,
                accent,
                background,
                heroFrom,
                heroTo,
                dark,
                heroStyle,
                preset,
            },
        },
    });
}
