/**
 * Public exports for the shared i18n module. Import from here:
 *
 *     import { LanguageSelector, TranslationsEditor, useLanguage } from 'common/i18n';
 *
 * This barrel exists so consumers never reach into subpaths; it's the one
 * entry point the rest of the product depends on.
 */
export { default as LanguageSelector } from './LanguageSelector';
export { default as TranslationsEditor } from './TranslationsEditor';
export { default as useLanguage } from './useLanguage';
export { applyTranslations, translationCompletion } from './applyTranslations';
export {
    SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_MAP,
    getLanguageLabel, getLanguageNative, isSupportedLanguage,
} from './languages';
