/**
 * Frontend twin of ``Backend/app/common/i18n.apply_translations``. Used by
 * preview components that need to render a draft config in a target language
 * without hitting the backend.
 */
import { DEFAULT_LANGUAGE } from './languages';

/**
 * Return a new object where each field in ``translatableFields`` is replaced
 * with ``config.translations[field][lang]`` when present. When ``lang`` is the
 * default or no translations exist, returns the input unchanged.
 *
 * @param {object|null} config - config dict from the backend (model.to_dict())
 * @param {string} lang - target language code
 * @param {string[]} [translatableFields] - whitelist of keys that may be translated
 * @returns {object|null}
 */
export const applyTranslations = (config, lang = DEFAULT_LANGUAGE, translatableFields) => {
    if (!config || lang === DEFAULT_LANGUAGE) return config;
    const translations = config.translations || {};
    if (!translations || !Object.keys(translations).length) return config;

    const keys = translatableFields || Object.keys(translations);
    const out = { ...config };
    keys.forEach((field) => {
        const langMap = translations[field];
        if (langMap && typeof langMap === 'object' && langMap[lang]) {
            out[field] = langMap[lang];
        }
    });
    return out;
};

/**
 * Count how many of ``translatableFields`` have a non-empty string for ``lang``.
 * Used by admin UIs that show per-language progress.
 */
export const translationCompletion = (translations, translatableFields, lang) => {
    const total = translatableFields.length;
    if (lang === DEFAULT_LANGUAGE) return { translated: total, total, percent: 100 };
    const safe = translations || {};
    let translated = 0;
    translatableFields.forEach((field) => {
        const val = safe[field]?.[lang];
        if (val) translated += 1;
    });
    return { translated, total, percent: total ? Math.round((translated / total) * 100) : 0 };
};
