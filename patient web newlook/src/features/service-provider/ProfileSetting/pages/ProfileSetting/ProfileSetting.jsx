
import React, { lazy, Suspense, useRef, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import {
    Box, Container, Typography, Paper, Button,
    Alert, Snackbar, Tabs, Tab, Chip, CircularProgress
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import useProfileUI from '../../hooks/useProfileUI';
import useDoctorProfilePageConfig from '../../hooks/useDoctorProfilePageConfig';
import { useGetDoctorAnalyticsSettingsQuery } from '../../../../admin/api/doctorAnalyticsEndpoints';
import { useGetMyDoctorIdQuery } from '../../../api/scopedDoctorApi';
import { useGetFieldStatusesQuery } from '../../../../admin/api/fieldApprovalEndpoints';
import { LINK_SCOPE } from '../../../api/doctorScope';
import { useDoctorScope } from '../../context/DoctorScopeContext';
import ApprovalBanner from '../../../../../common/components/ApprovalBanner/ApprovalBanner';
// Language switcher — reads ``useLanguage`` shared state and the page
// config's published translations to render a globe picker in the
// page header. Auto-hides when only one language is configured.
import { LanguageSelector, useLanguage } from '../../../../../common/i18n';
import './ProfileSetting.css';

const ProfileDetailsSection = lazy(() => import('../../sections/ProfileDetailsSection'));
const AccountStatusSection = lazy(() => import('../../sections/AccountStatusSection'));
// Availability / Schedule moved to the "Manage Appointments / Services" page.
const WorkingHoursSection = lazy(() => import('../../sections/WorkingHoursSection'));
const PricingSection = lazy(() => import('../../sections/PricingSection'));
const SlotVisibilitySection = lazy(() => import('../../sections/SlotVisibilitySection'));
const AnalyticsSection = lazy(() => import('../../sections/AnalyticsSection'));
const AttendanceSection = lazy(() => import('../../sections/AttendanceSection'));
const TreatableSymptomsSection = lazy(() => import('../../sections/TreatableSymptomsSection'));
// Entity Details tab — only shown for clinic/hospital (facility) accounts,
// which reuse this doctor profile page for their managing person. Doctors
// don't have an entity, so the tab is role-gated.
const EntityDetailsSection = lazy(() => import('../../../EntityProfile/sections/EntityDetailsSection'));

// Maps the editor's ``sectionFilter`` group keys (from
// ``DoctorProfilePreviewTab.SECTION_GROUP_MAP``) to the top-tab indices
// they correspond to. Used when the editor is showing a filtered
// preview (URL has ``?section=education`` etc.) — top-tabs that don't
// contain the active filter are disabled so the operator can't
// accidentally navigate out of the section they were editing.
const SECTION_FILTER_TO_TAB_INDEX = {
    personal_professional: 0,   // Profile Details
    signatures: 0,              // Profile Details
    about_me: 0,                // Profile Details
    education: 0,               // Profile Details (Education Details sub-tab)
    bank_details: 0,            // Profile Details
    declaration_documents: 0,   // Profile Details
    working_hours: 3,
    pricing: 4,
    analytics: 5,
    attendance_activity: 6,
};

const ProfileSetting = ({
    configOverride = null,
    previewMode = false,
    // Optional sectionFilter (only passed when mounted from the
    // editor's preview tab with a ``?section=...`` URL param). When
    // set, only the top-tab containing that section is enabled.
    sectionFilter = null,
    // Which top-tabs this viewer may see, by index. The staff mount passes a
    // grant check here; a doctor looking at their own profile passes nothing
    // and sees everything, as before.
    allowTab = () => true,
    // Same, one level down: which Profile Details sub-tabs are open. Separate
    // from ``allowTab`` because the two lists are indexed independently.
    allowSubTab = () => true,
    // This viewer may read the page but not write it — a My Link Partner
    // looking at a doctor they're affiliated with. Only the Save bar is this
    // component's business; making the fields themselves inert is the
    // caller's, because it has to cover the other sections too (see
    // ``ReadOnlyShell`` in LinkOperationDialog).
    readOnly = false,
}) => {
    const {
        activeTab,
        loading,
        error,
        snackbar,
        handleTabChange,
        handleCloseSnackbar,
    } = useProfileUI(previewMode);

    // Whose profile this page is about. Unscoped it's the signed-in user's
    // own; scoped, it's the doctor someone is acting for.
    const { doctorId: scopedDoctorId, scopeKind } = useDoctorScope();

    // Facility accounts (clinic/hospital) reuse this page for their manager
    // and additionally get an "Entity Details" tab. Real doctors don't — and
    // neither does a facility *operating a linked doctor*, which is why the
    // scope has to be part of this and not just the role. The tab edits the
    // caller's own entity profile; grown inside a doctor's page it would put
    // the clinic's registration details behind a tab labelled as the
    // doctor's.
    const userRole = useSelector((s) => s?.auth?.user?.role);
    const isFacility = !scopedDoctorId
        && (userRole === 'clinic' || userRole === 'hospital');

    // Use the shared language state (driven by the public landing's
    // LanguageSelector + any login-time setting) rather than
    // hard-coding 'en'. The hook forwards ``lang`` to
    // ``GET /api/doctor-profile-config/public/doctor_profile?lang=...``
    // which applies the operator's translations server-side.
    const { lang, setLang } = useLanguage();
    const cfg = useDoctorProfilePageConfig(lang, 'doctor', configOverride);

    // The page config is always fetched as userType 'doctor' (above), so
    // ``cfg.pageTitle`` reads "Doctor Profile & Settings" even for a facility
    // account that's only borrowing this page for its authorized person.
    // Relabel the header for the vertical actually viewing it.
    const facilityProfileTitle = userRole === 'hospital'
        ? 'Hospital Profile & Settings'
        : 'Clinic Profile & Settings';
    const displayPageTitle = isFacility ? facilityProfileTitle : cfg.pageTitle;

    // Languages the operator has provided translations for. Derived
    // from the page config's ``translations`` map keys (a Set of
    // every lang code that appears in any field-level or page-level
    // translation block). Falls back to ['en'] so the selector
    // auto-hides when nothing's translated.
    const availableLanguages = (() => {
        const set = new Set(['en']);
        const pc = configOverride?.page_config || cfg?.pageConfig;
        const fc = configOverride?.field_configs || cfg?.fieldConfigs;
        const walk = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    Object.keys(v).forEach((k) => {
                        // Translation maps are keyed by ISO codes (2-3
                        // letters); skip non-locale-looking keys to
                        // avoid pulling in nested field translations.
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
    })();

    // These two are doctor-id-parameterised rather than proxied — they take
    // the doctor as a path param and admit an admin or the doctor themselves,
    // so they're called directly. That holds for Operations and breaks for a
    // facility running a linked doctor: a clinic is neither, and both would
    // 403. Skipped there rather than proxied, because each only decorates the
    // page — the chip hides and the banner reads zero, which is the same as a
    // doctor with nothing pending.
    const skipAsCaller = previewMode || scopeKind === LINK_SCOPE;

    // Live status indicator
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: liveSettings } = useGetDoctorAnalyticsSettingsQuery(
        { doctorId: myDoctorId },
        { skip: !myDoctorId || skipAsCaller }
    );

    // Field approval statuses for the banner
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: !myDoctorId || skipAsCaller }
    );

    // registerSave pattern: each section registers its own save handler + label
    const [saveInfo, setSaveInfo] = useState({ handler: null, label: 'Save', disabled: false });
    const registerSave = useCallback((handler, label, disabled) => {
        setSaveInfo({ handler, label: label || 'Save', disabled: !!disabled });
    }, []);

    const handleSaveForTab = () => {
        if (saveInfo.handler) saveInfo.handler();
    };

    return (
        <Box className="doctor-profile-container" sx={previewMode ? { opacity: 0.95, position: 'relative' } : {}}>
            {previewMode && (
                <Chip label="Preview Mode — Interactive" color="info" size="small" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }} />
            )}
            <Container maxWidth="lg" sx={{ mt: previewMode ? 1 : 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                    <Typography variant="h4" fontWeight="bold">{displayPageTitle}</Typography>
                    {liveSettings && (
                        <Chip
                            icon={<FiberManualRecordIcon sx={{ fontSize: 12 }} />}
                            label={liveSettings.is_live ? 'Live' : 'Offline'}
                            size="small"
                            color={liveSettings.is_live ? 'success' : 'default'}
                            variant="outlined"
                        />
                    )}
                    {/* Language picker — auto-hidden when only English
                        is configured. Pinned to the right of the row
                        via flex:1 spacer so it always lands in the
                        same header position. */}
                    <Box sx={{ flex: 1 }} />
                    <LanguageSelector
                        value={lang}
                        onChange={setLang}
                        availableLanguages={availableLanguages}
                    />
                </Box>

                {/* Approval Banner */}
                {!previewMode && (
                    <ApprovalBanner
                        pendingCount={fieldStatusData?.pending_count || 0}
                    />
                )}

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {/* Tabs — Account Status inserted at index 1.
                    When ``sectionFilter`` is set (editor preview), only
                    the tab containing that section group is enabled —
                    other tabs render greyed out so the operator can't
                    navigate out of the section they're editing. */}
                <Paper sx={{ mb: 3 }}>
                    <Tabs value={activeTab} onChange={handleTabChange} indicatorColor="primary" textColor="primary" variant="scrollable" scrollButtons="auto">
                        {(() => {
                            const labels = [
                                'Profile Details',          // 0
                                'Account Status',           // 1
                                'Slot Visibility',          // 2
                                'Working Hours',            // 3
                                'Consultation Pricing',     // 4
                                'Analytics',                // 5
                                'Attendance & Activity',    // 6
                                'Treatable Symptoms',       // 7
                                ...(isFacility ? ['Entity Details'] : []),  // 8 (facility only)
                            ];
                            const allowedIdx = sectionFilter
                                ? SECTION_FILTER_TO_TAB_INDEX[sectionFilter]
                                : null;
                            return labels.map((label, idx) => (
                                <Tab
                                    key={idx}
                                    label={label}
                                    // ``allowTab`` is how the staff mount drops
                                    // the tabs a role wasn't granted. Rendering
                                    // it hidden rather than removing it keeps
                                    // every index below meaning what it says —
                                    // these are positional, and resequencing
                                    // them would silently repoint the content.
                                    sx={allowTab(idx) ? undefined : { display: 'none' }}
                                    disabled={
                                        (allowedIdx != null && idx !== allowedIdx)
                                        || !allowTab(idx)
                                    }
                                />
                            ));
                        })()}
                    </Tabs>
                </Paper>

                {/* Tab Content — lazy loaded, only active tab mounted */}
                <Suspense fallback={<Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>}>
                    {!allowTab(activeTab) && (
                        <Alert severity="warning">
                            You don&apos;t have access to this section.
                        </Alert>
                    )}
                    {allowTab(activeTab) && activeTab === 0 && (
                        <ProfileDetailsSection
                            previewMode={previewMode}
                            configOverride={configOverride}
                            registerSave={registerSave}
                            allowSubTab={allowSubTab}
                        />
                    )}
                    {allowTab(1) && activeTab === 1 && (
                        <AccountStatusSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                            doctorId={myDoctorId}
                            entityType="doctor"
                            isAdminView={false}
                        />
                    )}
                    {allowTab(2) && activeTab === 2 && (
                        <SlotVisibilitySection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {allowTab(3) && activeTab === 3 && (
                        <WorkingHoursSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {allowTab(4) && activeTab === 4 && (
                        <PricingSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {allowTab(5) && activeTab === 5 && (
                        <AnalyticsSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {allowTab(6) && activeTab === 6 && (
                        <AttendanceSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {allowTab(7) && activeTab === 7 && (
                        <TreatableSymptomsSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 8 && isFacility && (
                        <EntityDetailsSection registerSave={registerSave} />
                    )}
                </Suspense>
            </Container>

            {/* Sticky Footer — hidden in preview mode, and for a viewer who
                may only read. The inputs above are already inert (the caller
                wraps them); leaving an enabled-looking Save under them would
                promise a write that the server will refuse. */}
            {!previewMode && !readOnly && (
                <Box className="action-buttons-container">
                    <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveForTab}
                            disabled={loading || saveInfo.disabled}
                            size="large"
                            sx={{ px: 4 }}
                        >
                            {loading || saveInfo.disabled ? 'Saving...' : saveInfo.label}
                        </Button>
                    </Container>
                </Box>
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
