import { useState } from 'react';
import LoginForm from '../../../../../../auth/components/LoginForm/LoginForm';
import PatientSignupPage from '../../../../../../auth/pages/PatientSignupPage/PatientSignupPage';
import DoctorSignupPage from '../../../../../../auth/pages/DoctorSignupPage/DoctorSignupPage';
import PharmacySignupPage from '../../../../../../auth/pages/PharmacySignupPage/PharmacySignupPage';
import DiagnosisSignupPage from '../../../../../../auth/pages/DiagnosisSignupPage/DiagnosisSignupPage';
import { Box } from '@mui/material';
import { LanguageSelector, applyTranslations } from '../../../../../../../common/i18n';

// Keys on a login/signup page config that may carry per-language overrides.
const PAGE_TRANSLATABLE_FIELDS = [
    'page_title', 'page_subtitle', 'page_description',
    'primary_button_text', 'identifier_label',
    'username_placeholder', 'password_placeholder',
    'otp_section_text', 'otp_button_text',
    'forgot_password_text', 'register_text', 'register_link_text',
    'remember_me_text', 'terms_checkbox_text', 'terms_link_text',
    'privacy_link_text', 'footer_text', 'logo_alt_text',
];

const applyTranslationsLocally = (draft, lang) =>
    applyTranslations(draft, lang, PAGE_TRANSLATABLE_FIELDS);

/**
 * Renders a login preview with the same visual config (logo, background)
 * that the live login pages use, so the preview matches the live page.
 */
const LoginPagePreview = ({ selectedPageType, draft, previewLang }) => {
    const cfg = applyTranslationsLocally(draft, previewLang) || {};

    // Page background (outermost container)
    const pageBg = cfg.background_url
        ? { backgroundImage: `url(${cfg.background_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { backgroundColor: cfg.background_color || '#ffffff' };

    return (
        <Box
            sx={{
                ...pageBg,
                p: 4,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                maxWidth: 500,
                mx: 'auto',
                display: 'flex',
                justifyContent: 'center',
            }}
        >
            {/* Card — contains logo + form, just like the real login page */}
            <Box
                sx={{
                    backgroundColor: cfg.card_background_color || '#ffffff',
                    borderRadius: '20px',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)',
                    p: '40px 35px',
                    width: '100%',
                    maxWidth: 420,
                }}
            >
                {/* Logo inside the card */}
                {cfg.logo_is_present && cfg.logo_url && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                        <Box
                            component="img"
                            src={cfg.logo_url}
                            alt={cfg.logo_alt_text || 'Logo'}
                            sx={{ maxHeight: 80, maxWidth: 220, objectFit: 'contain' }}
                        />
                    </Box>
                )}

                <LoginForm
                    userType={selectedPageType.replace('_login', '')}
                    configOverride={cfg}
                    previewMode={true}
                />
            </Box>
        </Box>
    );
};

/**
 * Language selector for the preview — lets admin test translations before publishing.
 * Shows every language that has at least one translated value, plus published ones.
 */
const PreviewLanguageSelector = ({ draft, selectedLang, onLangChange }) => {
    const published = draft?.published_languages || ['en'];
    const translations = draft?.translations || {};

    const withTranslations = new Set(['en', ...published]);
    Object.values(translations).forEach((langMap) => {
        if (langMap && typeof langMap === 'object') {
            Object.keys(langMap).forEach((c) => withTranslations.add(c));
        }
    });

    return (
        <LanguageSelector
            value={selectedLang}
            onChange={onLangChange}
            availableLanguages={[...withTranslations]}
        />
    );
};

const PreviewTab = ({ selectedPageType, draft }) => {
    const isLoginType = ['admin_login', 'patient_login', 'doctor_login'].includes(selectedPageType);
    const [previewLang, setPreviewLang] = useState('en');

    return (
        <Box>
            {/* Language selector for preview */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <PreviewLanguageSelector
                    draft={draft}
                    selectedLang={previewLang}
                    onLangChange={setPreviewLang}
                />
            </Box>

            {isLoginType ? (
                <LoginPagePreview selectedPageType={selectedPageType} draft={draft} previewLang={previewLang} />
            ) : (
                <Box sx={{
                    p: 4,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    maxWidth: 600,
                    mx: 'auto',
                    bgcolor: 'background.paper'
                }}>
                    {(() => {
                        const translatedDraft = applyTranslationsLocally(draft, previewLang);
                        switch (selectedPageType) {
                            case 'patient_signup':
                                return <PatientSignupPage configOverride={translatedDraft} previewMode={true} />;
                            case 'doctor_signup':
                                return <DoctorSignupPage configOverride={translatedDraft} previewMode={true} />;
                            case 'pharmacy_signup':
                                return <PharmacySignupPage configOverride={translatedDraft} previewMode={true} />;
                            case 'diagnosis_signup':
                                return <DiagnosisSignupPage configOverride={translatedDraft} previewMode={true} />;
                            default:
                                return <LoginForm userType={selectedPageType.replace('_login', '')} configOverride={translatedDraft} previewMode={true} />;
                        }
                    })()}
                </Box>
            )}
        </Box>
    );
};

export default PreviewTab;
