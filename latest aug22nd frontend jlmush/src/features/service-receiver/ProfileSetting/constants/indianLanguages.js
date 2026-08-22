/**
 * Indian Languages constant and helpers
 * Matches the backend INDIAN_LANGUAGES list for patient profile configuration.
 */

export const INDIAN_LANGUAGES = [
    { code: 'as', name: 'Assamese', native: '\u0985\u09B8\u09AE\u09C0\u09AF\u09BC\u09BE' },
    { code: 'bn', name: 'Bengali', native: '\u09AC\u09BE\u0982\u09B2\u09BE' },
    { code: 'gu', name: 'Gujarati', native: '\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0' },
    { code: 'hi', name: 'Hindi', native: '\u0939\u093F\u0928\u094D\u0926\u0940' },
    { code: 'kn', name: 'Kannada', native: '\u0C95\u0CA8\u0CCD\u0CA8\u0CA1' },
    { code: 'ks', name: 'Kashmiri', native: '\u0915\u0949\u0936\u0941\u0930' },
    { code: 'kok', name: 'Konkani', native: '\u0915\u094B\u0902\u0915\u0923\u0940' },
    { code: 'ml', name: 'Malayalam', native: '\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02' },
    { code: 'mr', name: 'Marathi', native: '\u092E\u0930\u093E\u0920\u0940' },
    { code: 'or', name: 'Odia', native: '\u0B13\u0B21\u0B3C\u0B3F\u0B06' },
    { code: 'pa', name: 'Punjabi', native: '\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40' },
    { code: 'sa', name: 'Sanskrit', native: '\u0938\u0902\u0938\u094D\u0915\u0943\u0924\u092E\u094D' },
    { code: 'ta', name: 'Tamil', native: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD' },
    { code: 'te', name: 'Telugu', native: '\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41' },
    { code: 'ur', name: 'Urdu', native: '\u0627\u0631\u062F\u0648' },
    { code: 'en', name: 'English', native: 'English' },
];

/**
 * Look up a language entry by its ISO code.
 * @param {string} code - Language code (e.g. 'hi', 'ta')
 * @returns {object|undefined} The matching language object, or undefined if not found.
 */
export const getLanguageByCode = (code) => {
    return INDIAN_LANGUAGES.find((lang) => lang.code === code);
};

/**
 * Format a language object as "Name (Native)" for display in dropdowns.
 * @param {object} lang - A language object with name and native properties.
 * @returns {string} Formatted string, e.g. "Hindi (हिन्दी)"
 */
export const formatLanguageOption = (lang) => {
    if (!lang) return '';
    return `${lang.name} (${lang.native})`;
};
