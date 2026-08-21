import React, { useState, useCallback, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Button, Chip, Tabs, Tab,
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Alert, Snackbar, CircularProgress, Divider,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

import useProfileSetting from '../../hooks/useProfileSetting';
import usePatientProfilePageConfig from '../../hooks/usePatientProfilePageConfig';
import useScopeGrantedModules from '../../hooks/useScopeGrantedModules';
import {
    useGetPersonalDetailsQuery, useGetProfileLastUpdateQuery, useGetProfileSectionUpdatesQuery,
} from '../../api/scopedPatientApi';
import { usePatientScope } from '../../context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import LastUpdatedIndicator from '../../../../admin/Operations/components/LastUpdatedIndicator/LastUpdatedIndicator';
// Language switcher — same pattern as doctor profile / public
// landing. Reads ``useLanguage`` shared state + the page config's
// configured translations and renders a globe picker.
import { LanguageSelector, useLanguage } from '../../../../../common/i18n';

import './ProfileSetting.css';

// Lazy-load every section
const PersonalDetailsSection = lazy(() => import('../../components/PersonalDetailsSection'));
const ContactIdentitySection = lazy(() => import('../../components/ContactIdentitySection'));
const AddressSection = lazy(() => import('../../components/AddressSection'));
const EmergencyContactSection = lazy(() => import('../../components/EmergencyContactSection'));
const InsuranceSection = lazy(() => import('../../components/InsuranceSection'));
const FemaleHealthSection = lazy(() => import('../../components/FemaleHealthSection'));
const VitalsSection = lazy(() => import('../../components/VitalsSection'));
const HabitsSection = lazy(() => import('../../components/HabitsSection'));
const SurgeriesSection = lazy(() => import('../../components/SurgeriesSection'));
const HealthRecordsSection = lazy(() => import('../../components/HealthRecordsSection'));
const PrescriptionsSection = lazy(() => import('../../components/PrescriptionsSection'));
const HouseFamilyGroupSection = lazy(() => import('../../components/HouseFamilyGroupSection'));
// Corporate-entity details (type + legal fields). Shared with the clinic/
// hospital profile; self-contained save. Always shown for patients — the
// entity-type selector defaults to Individual and only reveals fields when a
// corporate type is picked.
const EntityDetailsSection = lazy(() => import('../../../../service-provider/EntityProfile/sections/EntityDetailsSection'));

/**
 * Tab definitions. Each tab can contain one or more sections.
 *
 * sectionKeys is used for admin visibility checks — tab is hidden only
 * if ALL its sections are hidden in the admin page-config.
 *
 * featurePath is the plan-feature gate. The tab is hidden if the
 * tenant's plan doesn't include the feature. PLATFORM_OWNER and
 * default-tenant context bypass via hasFeature(). Tabs that are
 * inherently part of the basic patient profile (personal details,
 * address, emergency contact, female health, habits) have no
 * featurePath — they're always available as long as patient.basic_info
 * is enabled, which every plan includes.
 *
 * Mapping rationale:
 *   vitals       → patient.vitals (paid add-on for clinics tracking BP/sugar)
 *   surgeries    → patient.health_records (longitudinal records)
 *   health_records → patient.health_records (the main records tab)
 *   prescriptions  → patient.health_records (history of previous prescriptions
 *                    is a record-style read; not the doctor.prescriptions write surface)
 *   family_group → patient.family (household / dependent management)
 *   insurance    → patient.documents (insurance docs are document storage)
 */
const TAB_DEFS = [
    {
        key: 'personal',
        label: 'Personal',
        sectionKeys: ['personal_details', 'contact_identity', 'address', 'emergency_contact'],
    },
    {
        key: 'insurance',
        label: 'Insurance',
        sectionKeys: ['insurance'],
        featurePath: 'patient.documents',
    },
    {
        key: 'female_health',
        label: 'Female Health',
        sectionKeys: ['female_health'],
        femaleOnly: true,
    },
    {
        key: 'vitals',
        label: 'Vitals',
        sectionKeys: ['vitals'],
        featurePath: 'patient.vitals',
    },
    {
        key: 'habits',
        label: 'Habits & Lifestyle',
        sectionKeys: ['habits'],
    },
    {
        key: 'surgeries',
        label: 'Surgeries',
        sectionKeys: ['surgeries'],
        featurePath: 'patient.health_records',
    },
    {
        key: 'health_records',
        label: 'Health Records',
        sectionKeys: ['health_records'],
        featurePath: 'patient.health_records',
    },
    {
        key: 'prescriptions',
        label: 'Prescriptions',
        sectionKeys: ['previous_prescriptions'],
        featurePath: 'patient.health_records',
    },
    {
        key: 'family_group',
        label: 'Family Group',
        sectionKeys: ['house_family_group'],
        featurePath: 'patient.family',
    },
    {
        key: 'entity',
        label: 'Entity Details',
        sectionKeys: ['entity_details'],
        // Not part of the admin page-config section set, so bypass the
        // isSectionVisible gate below.
        alwaysVisible: true,
    },
];

// Which caregiver-grant module each profile section belongs to — the frontend
// mirror of the backend path→module map in ``patient_family/rules.py``. Used
// only under a caregiver (staff) grant scope to hide sections they weren't
// granted; ``null`` means "no grantable module", so those are hidden whenever a
// grant scope is in force (a caregiver never manages the patient's household or
// corporate entity).
const SECTION_MODULE = {
    personal_details: 'profile_personal',
    contact_identity: 'profile_contact',
    address: 'profile_address',
    emergency_contact: 'profile_emergency',
    insurance: 'profile_insurance',
    female_health: 'profile_female_health',
    vitals: 'health_vitals',
    habits: 'health_habits',
    surgeries: 'health_surgeries',
    health_records: 'health_records',
    previous_prescriptions: 'prescriptions',
    house_family_group: null,
    entity_details: null,
};

/** ``granted`` is a Set of module keys, or null for full access (self/ops/guardian). */
const sectionAllowed = (granted, sectionKey) => {
    if (!granted) return true;
    const mod = SECTION_MODULE[sectionKey];
    return mod ? granted.has(mod) : false;
};

const SectionLoader = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
    </Box>
);

/** Wraps each sub-section inside a tab with a title, divider, and optional save.
 *  ``provenance`` (from the per-section audit) renders a "last updated by …"
 *  line under the title for accountability. */
const SubSection = ({ title, children, saveInfo, profileLoading, previewMode, cardBgColor, provenance }) => (
    <Paper variant="outlined" sx={{ p: 3, mb: 2, bgcolor: cardBgColor || '#ffffff' }}>
        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
            {title}
        </Typography>
        {provenance && <LastUpdatedIndicator data={provenance} sx={{ mt: 0.25 }} />}
        <Divider sx={{ mt: 1, mb: 2 }} />
        <Suspense fallback={<SectionLoader />}>
            {children}
        </Suspense>
        {!previewMode && saveInfo?.handler && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={saveInfo.handler}
                    disabled={saveInfo.saving || profileLoading}
                >
                    {saveInfo.saving ? 'Saving...' : saveInfo.label}
                </Button>
            </Box>
        )}
    </Paper>
);

/**
 * @param {Object}  props
 * @param {Object}  [props.configOverride] Draft page-config for admin preview.
 * @param {boolean} [props.previewMode]    Read-only admin preview (no saves).
 * @param {string}  [props.initialSection] Preview: which tab to open on.
 * @param {boolean} [props.embedded]       Render without the full-page chrome
 *   (no 100vh min-height / page background). Used when Operations mounts this
 *   inside the admin patient-detail tab.
 */
const ProfileSetting = ({
    configOverride = null, previewMode = false, initialSection = null, embedded = false,
}) => {
    // Non-null when a super-admin is driving this page on behalf of a patient
    // from Operations. Every data hook below already routes itself through the
    // act-on-behalf proxy via the scope context; this flag is only for the
    // handful of things that differ in the UI itself.
    const { isOps, scopeKind } = usePatientScope();
    // A guardian operating a MINOR sub-profile (``family`` scope) sees the whole
    // profile EXCEPT Family Group — a minor has no family group of their own.
    const isFamilyScope = scopeKind === 'family';
    // A support-staff caregiver: the sections the patient granted them (a Set),
    // or null for every other scope (full page). Sections outside the grant are
    // hidden so the caregiver never sees empty, un-saveable fields.
    const grantedModules = useScopeGrantedModules();

    // Deep-link a specific tab via ``?section=<sectionKey|tabKey>`` (e.g. the
    // "Edit" buttons on the read-only Health Records page jump straight to the
    // matching editor tab). Falls back to the ``initialSection`` prop used by
    // the admin preview embed.
    const [searchParams] = useSearchParams();
    const effectiveSection = initialSection || searchParams.get('section');

    // Use shared language state instead of hard-coded 'en' — the
    // public landing's LanguageSelector + the AuthLayout selector
    // both write into the same context, so a patient who picked
    // Hindi on the landing stays in Hindi inside their profile.
    const { lang, setLang } = useLanguage();
    const cfg = usePatientProfilePageConfig(lang, 'patient', configOverride);

    // Languages the operator configured translations for — same
    // derivation as the doctor profile page. Falls back to ['en']
    // so the selector auto-hides when nothing's translated.
    const availableLanguages = useMemo(() => {
        const set = new Set(['en']);
        const pc = configOverride?.page_config || cfg?.pageConfig;
        const fc = configOverride?.field_configs || cfg?.fieldConfigs;
        const walk = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    Object.keys(v).forEach((k) => {
                        if (typeof k === 'string' && k.length >= 2 && k.length <= 5) {
                            set.add(k);
                        }
                    });
                }
            }
        };
        walk(pc?.translations);
        for (const f of (fc || [])) walk(f?.translations);
        return Array.from(set);
    }, [configOverride, cfg]);

    // Fetch patient gender for conditional female health tab
    const { data: personalData } = useGetPersonalDetailsQuery(undefined, { skip: !!configOverride });
    const patientGender = personalData?.gender || configOverride?.patientGender || '';

    // "Who last changed this profile" — owner / linked family / support staff —
    // shown for accountability (refetches automatically on every section save
    // via the shared audit tag).
    const { data: profileLastUpdate } = useGetProfileLastUpdateQuery(
        undefined, { skip: !!configOverride });

    // Per-section provenance — {section_key: {updated_at, updated_by}} — for the
    // "last updated by …" line under each individual section.
    const { data: sectionUpdates = {} } = useGetProfileSectionUpdatesQuery(
        undefined, { skip: !!configOverride });

    const [activeTab, setActiveTab] = useState(0);

    // Per-section save handlers: { sectionKey: { handler, label, saving } }
    const [saveHandlers, setSaveHandlers] = useState({});

    // Pre-create one stable registerSave function per section key (created once at mount)
    const registerSaveFns = useMemo(() => {
        const keys = ['personal_details', 'contact_identity', 'address', 'emergency_contact', 'insurance', 'female_health'];
        return Object.fromEntries(
            keys.map((key) => [
                key,
                (handler, label = 'Save', saving = false) => {
                    setSaveHandlers((prev) => ({ ...prev, [key]: { handler, label, saving } }));
                },
            ])
        );
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // OTP / snackbar infrastructure
    const {
        profileLoading, profileError,
        otpDialogOpen, otpPurpose, otpIdentifier, otpValue, otpSent, otpLoading, otpError,
        handleOpenOtpDialog, handleCloseOtpDialog, handleSendOtp, handleVerifyOtp,
        setOtpIdentifier, setOtpValue,
        snackbar, notify, handleCloseSnackbar,
        // In ops scope the "my profile" thunks would run as the admin and 403;
        // the sections load the target patient through the scoped hooks. A
        // support-staff CAREGIVER (patient_staff role) hits the same wall — the
        // unscoped ``/api/patient/*`` thunks 403 with "Required roles: ['patient']"
        // and paint a spurious banner — so skip the combined fetch for them too.
    } = useProfileSetting({ skipFetch: isOps || scopeKind === 'staff' });

    const [savingPersonal, setSavingPersonal] = useState(false);

    // Call all registered personal-section handlers together. The individual
    // section saves reject on failure and nothing used to catch them — an
    // unhandled rejection and, worse, a Save button that looked like it
    // worked. Report both outcomes through the existing snackbar.
    const handleSavePersonal = useCallback(async () => {
        const personalKeys = ['personal_details', 'contact_identity', 'address', 'emergency_contact'];
        setSavingPersonal(true);
        try {
            await Promise.all(
                personalKeys
                    .filter((k) => saveHandlers[k]?.handler)
                    .map((k) => saveHandlers[k].handler())
            );
            notify('Personal details saved');
        } catch (err) {
            notify(
                err?.data?.error || err?.message || 'Failed to save personal details',
                'error',
            );
        } finally {
            setSavingPersonal(false);
        }
    }, [saveHandlers, notify]);

    // Plan-feature gate. Tabs that map to a paid plan feature are
    // hidden when the tenant's plan doesn't include that feature.
    // PLATFORM_OWNER and the default-tenant context always pass via
    // hasFeature's bypass logic.
    const { hasFeature } = usePermissions();

    // Filter visible tabs
    const visibleTabs = useMemo(() => TAB_DEFS.filter((tab) => {
        // A minor sub-profile (family scope) has no family group of its own —
        // hide that tab for the guardian operating the minor.
        if (tab.key === 'family_group' && isFamilyScope) return false;
        // Caregiver grant scope: hide any tab whose sections the patient did not
        // grant this caregiver (checked before ``alwaysVisible`` so even Entity
        // Details is clipped when a grant scope is in force).
        if (grantedModules && !tab.sectionKeys.some((sk) => sectionAllowed(grantedModules, sk))) {
            return false;
        }
        // Always-visible tabs (e.g. Entity Details) skip the admin section-config gate.
        if (tab.alwaysVisible) return true;
        // Female health: hide for non-female patients (unless preview mode)
        if (tab.femaleOnly && !previewMode && patientGender && patientGender !== 'female') {
            return false;
        }
        // Plan-feature gate. Skip in preview mode so platform admins
        // can see what every section LOOKS like regardless of plan.
        if (tab.featurePath && !previewMode && !hasFeature(tab.featurePath)) {
            return false;
        }
        // Tab is visible if at least one of its sections is visible in admin config
        return tab.sectionKeys.some((sk) => cfg.isSectionVisible(sk));
    }), [cfg, previewMode, patientGender, hasFeature, isFamilyScope, grantedModules]);

    // Auto-select the tab named by ``effectiveSection`` (admin preview prop OR
    // the ``?section=`` deep-link) once the visible tabs are known. Guarded so
    // it runs a single time and never fights the user's own tab clicks after.
    const didAutoSelect = useRef(false);
    useEffect(() => {
        if (didAutoSelect.current || !effectiveSection || !visibleTabs.length) return;
        const idx = visibleTabs.findIndex((tab) =>
            tab.sectionKeys.includes(effectiveSection) || tab.key === effectiveSection
        );
        if (idx >= 0) {
            setActiveTab(idx);
            didAutoSelect.current = true;
        }
    }, [effectiveSection, visibleTabs]);

    const currentTab = visibleTabs[activeTab] || visibleTabs[0];

    const handleTabChange = (_, newValue) => {
        setActiveTab(newValue);
    };

    /** Render the content for the active tab */
    const renderTabContent = () => {
        if (!currentTab) return null;
        const bgColor = cfg.cardBackgroundColor;

        switch (currentTab.key) {
            case 'personal':
                return (
                    <>
                        {cfg.isSectionVisible('personal_details') && sectionAllowed(grantedModules, 'personal_details') && (
                            <SubSection
                                title={cfg.getSectionLabel('personal_details', 'Personal Details')}
                                saveInfo={null}
                                profileLoading={profileLoading}
                                previewMode={previewMode}
                                cardBgColor={bgColor}
                                provenance={sectionUpdates.personal_details}
                            >
                                <PersonalDetailsSection configOverride={configOverride} registerSave={registerSaveFns.personal_details} />
                            </SubSection>
                        )}
                        {cfg.isSectionVisible('contact_identity') && sectionAllowed(grantedModules, 'contact_identity') && (
                            <SubSection
                                title={cfg.getSectionLabel('contact_identity', 'Contact & Identity')}
                                saveInfo={null}
                                profileLoading={profileLoading}
                                previewMode={previewMode}
                                cardBgColor={bgColor}
                                provenance={sectionUpdates.contact_identity}
                            >
                                <ContactIdentitySection configOverride={configOverride} registerSave={registerSaveFns.contact_identity} onOpenOtp={handleOpenOtpDialog} />
                            </SubSection>
                        )}
                        {cfg.isSectionVisible('address') && sectionAllowed(grantedModules, 'address') && (
                            <SubSection
                                title={cfg.getSectionLabel('address', 'Address')}
                                saveInfo={null}
                                profileLoading={profileLoading}
                                previewMode={previewMode}
                                cardBgColor={bgColor}
                                provenance={sectionUpdates.address}
                            >
                                <AddressSection configOverride={configOverride} registerSave={registerSaveFns.address} />
                            </SubSection>
                        )}
                        {cfg.isSectionVisible('emergency_contact') && sectionAllowed(grantedModules, 'emergency_contact') && (
                            <SubSection
                                title={cfg.getSectionLabel('emergency_contact', 'Emergency Contact')}
                                saveInfo={null}
                                profileLoading={profileLoading}
                                previewMode={previewMode}
                                cardBgColor={bgColor}
                                provenance={sectionUpdates.emergency_contact}
                            >
                                <EmergencyContactSection configOverride={configOverride} registerSave={registerSaveFns.emergency_contact} />
                            </SubSection>
                        )}
                        {!previewMode && (
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                                <Button
                                    variant="contained"
                                    size="medium"
                                    startIcon={<SaveIcon />}
                                    onClick={handleSavePersonal}
                                    disabled={savingPersonal || profileLoading}
                                >
                                    {savingPersonal ? 'Saving...' : 'Save Personal Details'}
                                </Button>
                            </Box>
                        )}
                    </>
                );

            case 'insurance':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('insurance', 'Insurance')}
                        saveInfo={saveHandlers.insurance}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.insurance}
                    >
                        <InsuranceSection configOverride={configOverride} registerSave={registerSaveFns.insurance} />
                    </SubSection>
                );

            case 'entity':
                return (
                    <Suspense fallback={<SectionLoader />}>
                        <EntityDetailsSection />
                    </Suspense>
                );

            case 'female_health':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('female_health', 'Female Health')}
                        saveInfo={saveHandlers.female_health}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.female_health}
                    >
                        <FemaleHealthSection configOverride={configOverride} registerSave={registerSaveFns.female_health} />
                    </SubSection>
                );

            case 'vitals':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('vitals', 'Vitals')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.vitals}
                    >
                        <VitalsSection configOverride={configOverride} />
                    </SubSection>
                );

            case 'habits':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('habits', 'Habits & Lifestyle')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.habits}
                    >
                        <HabitsSection configOverride={configOverride} />
                    </SubSection>
                );

            case 'surgeries':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('surgeries', 'Surgeries')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.surgeries}
                    >
                        <SurgeriesSection configOverride={configOverride} />
                    </SubSection>
                );

            case 'health_records':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('health_records', 'Health Records')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                        provenance={sectionUpdates.health_records}
                    >
                        <HealthRecordsSection configOverride={configOverride} />
                    </SubSection>
                );

            case 'prescriptions':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('previous_prescriptions', 'Prescriptions')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                    >
                        <PrescriptionsSection configOverride={configOverride} />
                    </SubSection>
                );

            case 'family_group':
                return (
                    <SubSection
                        title={cfg.getSectionLabel('house_family_group', 'Family Group')}
                        saveInfo={null}
                        profileLoading={profileLoading}
                        previewMode={previewMode}
                        cardBgColor={bgColor}
                    >
                        <HouseFamilyGroupSection configOverride={configOverride} />
                    </SubSection>
                );

            default:
                return null;
        }
    };

    return (
        <Box className="profile-setting-container" sx={{
            ...(previewMode ? { opacity: 0.95, position: 'relative' } : {}),
            // Embedded (Operations tab) sits inside the admin layout, which
            // already owns the page background and scroll height.
            ...(embedded ? {} : { bgcolor: cfg.backgroundColor }),
            minHeight: previewMode || embedded ? 'auto' : '100vh',
        }}>
            {previewMode && (
                <Chip label="Preview Mode — Interactive" color="info" size="small" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }} />
            )}
            <Container
                maxWidth="lg"
                disableGutters={embedded}
                sx={{ mt: previewMode || embedded ? 1 : 2, pb: 4 }}
            >
                {/* Header — title row with the language picker on the
                    right. Selector auto-hides when only English is
                    configured so the row stays clean for single-
                    language tenants. */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="h5" sx={{ fontWeight: 600, flex: 1 }}>
                        {cfg.pageTitle}
                    </Typography>
                    <LanguageSelector
                        value={lang}
                        onChange={setLang}
                        availableLanguages={availableLanguages}
                    />
                </Box>
                {cfg.pageSubtitle && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {cfg.pageSubtitle}
                    </Typography>
                )}

                {/* Accountability: who last changed this profile — the patient's
                    own account, a linked family member, or a support-staff
                    caregiver. Shown to the patient and to anyone acting for them. */}
                {!previewMode && <LastUpdatedIndicator data={profileLastUpdate} sx={{ mb: 2 }} />}

                {isOps && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        You are editing this patient&apos;s profile on their behalf.
                        Every change is saved against their account and recorded in
                        the operations audit log.
                    </Alert>
                )}

                {!previewMode && profileError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{profileError}</Alert>
                )}

                {/* Tabs — grouped logically */}
                <Paper variant="outlined" sx={{ mb: 2 }}>
                    <Tabs
                        value={activeTab}
                        onChange={handleTabChange}
                        variant="scrollable"
                        scrollButtons="auto"
                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                    >
                        {visibleTabs.map((tab, index) => (
                            <Tab
                                key={tab.key}
                                label={tab.label}
                                disabled={previewMode && initialSection && index !== activeTab}
                            />
                        ))}
                    </Tabs>
                </Paper>

                {/* Active tab content — lazy loaded */}
                {renderTabContent()}
            </Container>

            {/* OTP Verification Dialog. Not reachable in ops scope: an admin
                can't receive the patient's OTP, so ContactIdentitySection lets
                them edit phone/email directly instead (the backend widens the
                allowlist for act-on-behalf writes only). */}
            {!previewMode && !isOps && (
                <Dialog open={otpDialogOpen} onClose={handleCloseOtpDialog} maxWidth="xs" fullWidth>
                    <DialogTitle>
                        Verify {otpPurpose === 'phone_change' ? 'Phone Number' : 'Email'}
                    </DialogTitle>
                    <DialogContent>
                        {otpError && <Alert severity="error" sx={{ mb: 2 }}>{otpError}</Alert>}
                        <TextField
                            fullWidth
                            label={otpPurpose === 'phone_change' ? 'Phone Number' : 'Email'}
                            value={otpIdentifier}
                            onChange={(e) => setOtpIdentifier(e.target.value)}
                            sx={{ mb: 2, mt: 1 }}
                            disabled={otpSent}
                        />
                        {otpSent && (
                            <TextField
                                fullWidth
                                label="Enter OTP"
                                value={otpValue}
                                onChange={(e) => setOtpValue(e.target.value)}
                                placeholder="Enter 6-digit OTP"
                                sx={{ mb: 2 }}
                            />
                        )}
                        <Typography variant="caption" color="text.secondary">
                            {otpSent
                                ? 'OTP sent! Check the backend terminal for the OTP (testing mode).'
                                : 'Click Send OTP to receive verification code.'}
                        </Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseOtpDialog}>Cancel</Button>
                        {!otpSent ? (
                            <Button variant="contained" onClick={handleSendOtp} disabled={otpLoading}>
                                {otpLoading ? 'Sending...' : 'Send OTP'}
                            </Button>
                        ) : (
                            <Button variant="contained" onClick={handleVerifyOtp} disabled={otpLoading || !otpValue}>
                                {otpLoading ? 'Verifying...' : 'Verify & Update'}
                            </Button>
                        )}
                    </DialogActions>
                </Dialog>
            )}

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ProfileSetting;
