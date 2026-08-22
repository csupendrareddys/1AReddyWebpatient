/**
 * DoctorProfilePreviewTab — Renders a live preview of the Doctor Profile page
 * using the actual ProfileSetting component with configOverride + previewMode.
 *
 * When sectionFilter is provided, only that section group's sections are shown
 * by hiding all other sections in the config override.
 */
import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Card, CardContent, Typography, Box, Alert, Chip,
    ToggleButtonGroup, ToggleButton, Stack,
} from '@mui/material';
import PreviewIcon from '@mui/icons-material/Preview';
import ProfileSetting from '../../../../../service-provider/ProfileSetting/pages/ProfileSetting/ProfileSetting';
import { setEducationDropdownOptions } from '../../../../../service-provider/ProfileSetting/redux/doctorProfileEducationSlice';

// Map editor TAB_GROUP keys to the actual backend section keys they contain
const SECTION_GROUP_MAP = {
    personal_professional: ['personal_details', 'additional_personal_details', 'identity_documents', 'female_health_details', 'current_address', 'permanent_address'],
    signatures: ['signatures'],
    about_me: ['about_me'],
    education: ['education_graduation', 'education_post_graduation', 'education_super_speciality', 'education_other_certification'],
    bank_details: ['bank_details'],
    declaration_documents: ['declaration_documents'],
    working_hours: ['working_days_hours'],
    pricing: ['consultation_pricing'],
    analytics: ['doctor_analytics'],
    attendance_activity: ['doctor_attendance'],
};

const DoctorProfilePreviewTab = ({
    localDraft, localFieldConfigs, sectionFilter = null,
    // Lifecycle sources for the source-toggle. Landing page editor has
    // the same chooser — operator wants parity here so they can preview
    // what's currently DRAFT vs PREVIEW vs LIVE without leaving the
    // editor. ``localDraft`` is the live editing copy; ``preview`` /
    // ``live`` come from the resolved configs object.
    preview = null,
    live = null,
}) => {
    // Which lifecycle row to feed into ProfileSetting. Defaults to
    // ``draft`` because that's what the operator is most often
    // tweaking; flips to preview / live on demand.
    const [source, setSource] = useState('draft');
    const dispatch = useDispatch();

    // Resolve the actual config row for the chosen source. Falls back
    // to a lower priority if the chosen row is empty (e.g. no preview
    // yet → silently use draft) so the preview is never blank.
    const activeRow = useMemo(() => {
        if (source === 'live' && live) return live;
        if (source === 'preview' && preview) return preview;
        return localDraft;
    }, [source, localDraft, preview, live]);

    // Pick the field configs that drive the dropdown override below.
    // For DRAFT we want ``localFieldConfigs`` (operator's in-memory
    // edits) — for PREVIEW / LIVE we want the row's own field_configs
    // so the operator sees exactly what's persisted there.
    const activeFieldConfigs = useMemo(() => {
        if (source === 'live' && live) return live.field_configs || [];
        if (source === 'preview' && preview) return preview.field_configs || [];
        return localFieldConfigs || [];
    }, [source, localFieldConfigs, preview, live]);

    // The data_sources map (data_source string → resolved options
    // array) is computed server-side; each lifecycle row carries its
    // own. Fall back to the draft's resolved map for DRAFT mode.
    const activeDataSources = useMemo(() => {
        if (source === 'live' && live?.data_sources) return live.data_sources;
        if (source === 'preview' && preview?.data_sources) return preview.data_sources;
        return localDraft?.data_sources || {};
    }, [source, localDraft, preview, live]);

    // Push dropdown options into the Education redux slice based on
    // the chosen source. The preview's ``ProfileSetting`` reads
    // ``state.doctorProfileEducation.dropdownOptions`` for select-
    // type fields (Degree / Specialization / etc.). Without this
    // override the preview tab would show whatever master_data
    // contains LIVE — even when the operator's DRAFT has different
    // options (e.g. user removed 3 entries, hasn't published yet).
    //
    // Mirrors the backend's ``get_education_dropdowns`` resolution:
    // field.options first, then resolved data_source.
    useEffect(() => {
        if (!activeFieldConfigs || activeFieldConfigs.length === 0) return;

        const fcByKey = {};
        for (const f of activeFieldConfigs) {
            // First wins so the lookup deterministic across re-renders
            // even if a field_key shows up in multiple sections.
            if (!fcByKey[f.field_key]) fcByKey[f.field_key] = f;
        }

        const optionsFor = (fieldKey) => {
            const f = fcByKey[fieldKey];
            if (!f) return null;
            // Locally-saved options take precedence — these are what
            // the operator typed in the editor (still DRAFT, not yet
            // flushed to master_data).
            if (Array.isArray(f.options) && f.options.length > 0) {
                return f.options.filter(Boolean);
            }
            // Otherwise the server-resolved data_source (LIVE
            // master_data) is the next-best display.
            if (f.data_source && activeDataSources[f.data_source]) {
                return activeDataSources[f.data_source].map((o) =>
                    typeof o === 'string'
                        ? o
                        : (o?.name || o?.id || String(o))
                );
            }
            return null;
        };

        // Map field_key → Redux ``dropdownOptions`` shape. The keys
        // match the backend's ``get_education_dropdowns`` envelope.
        const overrides = {};
        const map = [
            ['ug_degree', 'degrees'],
            ['pg_degree', 'pgDegrees'],
            ['ss_degree', 'superSpecialityDegrees'],
            ['ug_specialization', 'ugSpecializations'],
            ['pg_specialization', 'pgSpecializations'],
            ['ss_specialization', 'superSpecialitySpecializations'],
            ['ug_state', 'states'],
            ['ug_university', 'universities'],
            ['pg_university', 'pgUniversities'],
            ['ss_university', 'superSpecialityUniversities'],
            ['ug_institute', 'institutes'],
            ['pg_institute', 'pgInstitutes'],
            ['ss_institute', 'superSpecialityInstitutes'],
            ['ug_evaluation_criteria', 'evaluationCriteria'],
        ];
        for (const [fieldKey, dropdownKey] of map) {
            const v = optionsFor(fieldKey);
            if (v && v.length > 0) overrides[dropdownKey] = v;
        }
        if (Object.keys(overrides).length > 0) {
            dispatch(setEducationDropdownOptions(overrides));
        }
    }, [activeFieldConfigs, activeDataSources, dispatch]);

    // Build configOverride — if sectionFilter is set, hide all other sections
    const configOverride = useMemo(() => {
        const draft = activeRow ? { ...activeRow } : null;

        if (draft && sectionFilter && sectionFilter !== 'page_settings' && sectionFilter !== 'master_data') {
            const allowedSections = SECTION_GROUP_MAP[sectionFilter] || [sectionFilter];
            const fields = draft.fields ? { ...draft.fields } : {};
            const sections = (fields.sections || []).map((s) => ({
                ...s,
                is_present: allowedSections.includes(s.key) ? (s.is_present ?? true) : false,
            }));
            draft.fields = { ...fields, sections };
        }

        return {
            page_config: draft,
            field_configs: localFieldConfigs || [],
            data_sources: activeRow?.data_sources || {},
        };
    }, [activeRow, localFieldConfigs, sectionFilter]);

    return (
        <Card>
            <CardContent>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={2}
                    sx={{ mb: 1, justifyContent: 'space-between' }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PreviewIcon color="primary" />
                        <Typography variant="h6">Live Preview</Typography>
                        {sectionFilter && sectionFilter !== 'page_settings' && sectionFilter !== 'master_data' && (
                            <Chip label={`Showing: ${sectionFilter}`} size="small" color="info" variant="outlined" />
                        )}
                    </Box>

                    {/* Source selector — mirrors the Landing page editor.
                        Buttons for rows that don't exist are disabled so
                        the operator can't pick a phantom preview / live
                        with nothing in it. */}
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={source}
                        onChange={(_, v) => v && setSource(v)}
                        aria-label="Preview source"
                    >
                        <ToggleButton value="draft" disabled={!localDraft}>
                            Draft
                        </ToggleButton>
                        <ToggleButton value="preview" disabled={!preview}>
                            Preview
                        </ToggleButton>
                        <ToggleButton value="live" disabled={!live}>
                            Live
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Stack>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                    This is a fully interactive preview using the actual Doctor Profile page with your draft configuration.
                    Changes to field visibility, section labels, and page settings are reflected in real-time.
                </Typography>

                <Alert severity="info" sx={{ mb: 2 }}>
                    This preview uses sample data. The actual doctor profile will show real doctor information.
                </Alert>

                <Box
                    sx={{
                        border: '2px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: activeRow?.background_color || '#ffffff',
                        maxHeight: '80vh',
                        overflowY: 'auto',
                    }}
                >
                    <ProfileSetting
                        configOverride={configOverride}
                        previewMode={true}
                        // When ?section=... is in the URL, restrict the
                        // outer ProfileSetting tabs (Profile Details /
                        // Account Status / Working Hours / etc.) to
                        // only the one containing the active section
                        // group. Operators previewing the Education
                        // section don't want to accidentally click into
                        // Bank Details and have it look like a routing
                        // exit. Page-settings + master-data don't have
                        // a tab equivalent — pass null.
                        sectionFilter={
                            sectionFilter
                            && sectionFilter !== 'page_settings'
                            && sectionFilter !== 'master_data'
                                ? sectionFilter
                                : null
                        }
                    />
                </Box>
            </CardContent>
        </Card>
    );
};

export default DoctorProfilePreviewTab;
