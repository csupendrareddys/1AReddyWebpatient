/**
 * Landing-page theme presets.
 *
 * Each preset defines the four colors the public landing page (and its
 * descendant module / service-detail pages) reads out of MUI's palette:
 *
 *   primary    – buttons, links, hero gradient anchor
 *   secondary  – "For Doctors" banner, secondary CTAs
 *   accent     – chips, hover lifts, micro-highlights
 *   background – page-level subtle background tint
 *
 * The backend stores ``theme_preset`` on ``LandingConfig``. When the value is
 * ``'custom'`` the frontend ignores this table and uses the per-color fields
 * the admin saved instead. Anything else looks up the matching key here.
 *
 * Adding a preset = add a row here + add the same key to the marshmallow
 * ``OneOf`` validator in ``Backend/app/api/landing_page_config/validators.py``.
 */

export const LANDING_THEME_PRESETS = {
    ocean: {
        label: 'Ocean',
        description: 'Calm blues — clean and trustworthy.',
        primary: '#1976d2',
        secondary: '#26a69a',
        accent: '#42a5f5',
        background: '#f5f9ff',
        heroFrom: '#f8faff',
        heroTo: '#e3f2fd',
        dark: '#1a2332',
    },
    emerald: {
        label: 'Emerald',
        description: 'Fresh greens — wellness and vitality.',
        primary: '#2e7d32',
        secondary: '#00897b',
        accent: '#66bb6a',
        background: '#f5fbf7',
        heroFrom: '#f5fbf7',
        heroTo: '#e8f5e9',
        dark: '#1b2e22',
    },
    royal: {
        label: 'Royal',
        description: 'Deep purples — premium and authoritative.',
        primary: '#5e35b1',
        secondary: '#3949ab',
        accent: '#7e57c2',
        background: '#f8f6ff',
        heroFrom: '#f6f3ff',
        heroTo: '#ede7f6',
        dark: '#211a3a',
    },
    sunset: {
        label: 'Sunset',
        description: 'Warm oranges — friendly and energetic.',
        primary: '#e65100',
        secondary: '#d84315',
        accent: '#ff9800',
        background: '#fff8f3',
        heroFrom: '#fff8f3',
        heroTo: '#ffe0b2',
        dark: '#2a1d10',
    },
    midnight: {
        label: 'Midnight',
        description: 'Cool slate — modern and corporate.',
        primary: '#37474f',
        secondary: '#546e7a',
        accent: '#26c6da',
        background: '#f5f7f8',
        heroFrom: '#f5f7f8',
        heroTo: '#cfd8dc',
        dark: '#0f1518',
    },
};

export const LANDING_THEME_PRESET_KEYS = Object.keys(LANDING_THEME_PRESETS);

/** Lookup with fallback to ocean for unknown / nullish keys. */
export function resolveLandingPreset(key) {
    return LANDING_THEME_PRESETS[key] || LANDING_THEME_PRESETS.ocean;
}
