/**
 * useLanguage — lightweight hook for a UI surface's current language.
 *
 * Persists the selection under ``localStorage['jlmush.lang']`` so the choice
 * survives navigation and page reload. Intentionally independent of the auth
 * context (public pages use it before login) and of any specific config
 * model — this is purely which language to *display*.
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages';

const STORAGE_KEY = 'jlmush.lang';

const readInitial = () => {
    try {
        const v = window?.localStorage?.getItem(STORAGE_KEY);
        if (v && isSupportedLanguage(v)) return v;
    } catch {
        // localStorage not available (SSR, private mode) — fall through
    }
    return DEFAULT_LANGUAGE;
};

const useLanguage = () => {
    const [lang, setLangState] = useState(readInitial);

    const setLang = useCallback((code) => {
        if (!isSupportedLanguage(code)) return;
        setLangState(code);
        try {
            window?.localStorage?.setItem(STORAGE_KEY, code);
        } catch {
            /* ignore */
        }
    }, []);

    // If another tab/window changed the language, pick it up here too.
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === STORAGE_KEY && e.newValue && isSupportedLanguage(e.newValue)) {
                setLangState(e.newValue);
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    return { lang, setLang };
};

export default useLanguage;
