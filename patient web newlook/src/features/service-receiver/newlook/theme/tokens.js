/**
 * Design tokens for the NEW LOOK patient screens.
 *
 * A direct port of the patient mobile MVP's ``src/theme/theme.ts``, which in
 * turn mirrors this app's MUI palette — so the ported screens read as the same
 * product as the rest of the website while keeping the mobile design's exact
 * type scale and spacing. The values are the mobile file's values verbatim;
 * only the shapes change (RN style objects become MUI ``sx`` objects).
 *
 * Kept as plain tokens rather than a second MUI theme: these three pages sit
 * inside the existing PatientLayout, and nesting a ThemeProvider would fight
 * the app's light/dark switch for every other component on the page.
 */
export const colors = {
    primary: '#1976d2',
    primaryLight: '#42a5f5',
    primaryDark: '#1565c0',
    secondary: '#26a69a',
    secondaryLight: '#4db6ac',
    secondaryDark: '#00897b',
    success: '#4caf50',
    warning: '#E8833A',
    warningLight: '#FFF3E8',
    warningDark: '#D4702E',
    error: '#f44336',
    background: '#f5f5f5',
    surface: '#ffffff',
    border: '#e6e8eb',
    textPrimary: '#1a2332',
    textSecondary: '#5f6b7a',
    textMuted: '#95a1ae',
    white: '#ffffff',
};

export const radius = {
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
};

export const typography = {
    h1: { fontSize: 26, fontWeight: 700, color: colors.textPrimary },
    h2: { fontSize: 20, fontWeight: 700, color: colors.textPrimary },
    h3: { fontSize: 17, fontWeight: 600, color: colors.textPrimary },
    body: { fontSize: 14, fontWeight: 400, color: colors.textPrimary },
    bodyMuted: { fontSize: 13, fontWeight: 400, color: colors.textSecondary },
    caption: { fontSize: 12, fontWeight: 500, color: colors.textMuted },
    label: {
        fontSize: 12,
        fontWeight: 600,
        color: colors.textSecondary,
        letterSpacing: 0.4,
    },
};

/**
 * A translucent wash of a tint, for the round icon chips behind every glyph.
 *
 * The mobile code wrote this as a hex-suffix (`${tint}1A`). That happens to be
 * valid CSS too, but only for 6-digit hex input — this tolerates rgb()/named
 * colours by handing them back unchanged rather than producing garbage.
 */
export const tint = (color, alpha = 0.1) => {
    if (typeof color !== 'string') return color;
    const hex = color.trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return hex;
    const full = hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const cardShadow = '0 2px 8px rgba(15, 27, 45, 0.06)';

/** The mobile ``Card`` component's style, as sx. */
export const cardSx = {
    bgcolor: colors.surface,
    borderRadius: `${radius.md}px`,
    border: `1px solid ${colors.border}`,
    boxShadow: cardShadow,
    p: '14px',
};

/** Clamp text to n lines — the web equivalent of RN's numberOfLines. */
export const clamp = (lines) => ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    wordBreak: 'break-word',
});
