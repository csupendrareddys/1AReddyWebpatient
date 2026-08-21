/**
 * Canonical list of languages supported across the product. Kept in sync with
 * ``Backend/app/common/i18n.py``'s SUPPORTED_LANGUAGES — if you add a language
 * here, add it there too.
 *
 * All UI surfaces that render a language picker (AuthLayout, TranslationsEditor,
 * public-site header) read from this list so adding a language is a one-place
 * change.
 */

export const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English',   native: 'English',   direction: 'ltr' },
    { code: 'hi', label: 'Hindi',     native: 'हिन्दी',      direction: 'ltr' },
    { code: 'te', label: 'Telugu',    native: 'తెలుగు',    direction: 'ltr' },
    { code: 'ta', label: 'Tamil',     native: 'தமிழ்',     direction: 'ltr' },
    { code: 'kn', label: 'Kannada',   native: 'ಕನ್ನಡ',      direction: 'ltr' },
    { code: 'ml', label: 'Malayalam', native: 'മലയാളം',    direction: 'ltr' },
    { code: 'bn', label: 'Bengali',   native: 'বাংলা',      direction: 'ltr' },
    { code: 'mr', label: 'Marathi',   native: 'मराठी',      direction: 'ltr' },
    { code: 'gu', label: 'Gujarati',  native: 'ગુજરાતી',    direction: 'ltr' },
    { code: 'pa', label: 'Punjabi',   native: 'ਪੰਜਾਬੀ',     direction: 'ltr' },
    { code: 'or', label: 'Odia',      native: 'ଓଡ଼ିଆ',      direction: 'ltr' },
    { code: 'as', label: 'Assamese',  native: 'অসমীয়া',    direction: 'ltr' },
    { code: 'ur', label: 'Urdu',      native: 'اردو',       direction: 'rtl' },
];

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_MAP = SUPPORTED_LANGUAGES.reduce((acc, l) => {
    acc[l.code] = l;
    return acc;
}, {});

export const getLanguageLabel = (code) => LANGUAGE_MAP[code]?.label || code.toUpperCase();

export const getLanguageNative = (code) => LANGUAGE_MAP[code]?.native || code;

export const isSupportedLanguage = (code) => !!LANGUAGE_MAP[code];
