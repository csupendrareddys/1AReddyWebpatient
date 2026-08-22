/**
 * Doctor Signup Config Editor.
 *
 * Lean editor: admin tweaks page-level copy (title / subtitle / CTA) and
 * per-field labels / placeholders / helper text, then publishes. Locked
 * fields (phone_number, password, first_name, etc.) render a lock chip
 * and have ``is_present`` toggling disabled at the UI level — the backend
 * also enforces the same set in ``LOCKED_FIELD_KEYS``, so a hand-crafted
 * PUT can't bypass it either.
 *
 * Master-data CRUD (UG / PG / SS colleges / specializations / degrees)
 * lives in the existing ``MasterDataManager`` component, which we mount
 * here as a collapsible accordion. That gives admins one place to drive
 * the signup form: tweak labels above, curate the master lists below.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Box, Paper, Typography, Stack, Button, TextField, Switch, FormControlLabel,
    Accordion, AccordionSummary, AccordionDetails, Chip, Alert, AlertTitle,
    CircularProgress, Divider, Tooltip, Link,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SaveIcon from '@mui/icons-material/Save';
import PublishIcon from '@mui/icons-material/Publish';
import LockIcon from '@mui/icons-material/Lock';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import {
    useGetDoctorSignupConfigsQuery,
    useGetDoctorSignupDraftQuery,
    useUpdateDoctorSignupDraftMutation,
    useUpdateDoctorSignupFieldsMutation,
    usePromoteDoctorSignupToPreviewMutation,
    usePublishDoctorSignupConfigMutation,
} from '../../../api/doctorSignupConfigEndpoints';

import ConfigEditorHeader from '../../../../../common/components/ConfigEditorHeader/ConfigEditorHeader';
import EditorTab from '../../../AdminDashboard/pages/PageConfigEditor/components/EditorTab/EditorTab';


// Section keys are stable strings the backend ships; the labels here are
// just nicer display strings for the editor. If the backend adds a new
// section the editor still renders it (it falls back to the raw key).
const SECTION_DISPLAY = {
    account: 'Account',
    personal: 'Personal Details',
    identity: 'Identity & Registration',
    address: 'Address',
    qualifications_ug: 'Qualifications — Graduation (UG)',
    qualifications_pg: 'Qualifications — Post Graduation (PG)',
    qualifications_ss: 'Qualifications — Super Speciality',
};


const PAGE_FIELDS = [
    { key: 'page_title', label: 'Page Title' },
    { key: 'page_subtitle', label: 'Subtitle' },
    { key: 'primary_button_text', label: 'Submit Button Label' },
];


const StatusChip = ({ label, color }) => (
    <Chip label={label} size="small" color={color} variant="outlined" sx={{ ml: 1 }} />
);


const DoctorSignupConfigEditor = () => {
    const { data: draft, isLoading, error, refetch } = useGetDoctorSignupDraftQuery();
    // Lifecycle snapshot — returns { draft, preview, live } so the
    // shared header can render the chips + gate Preview / Publish on
    // the actual row state instead of the editor's local "dirty" flag.
    const { data: configs = {}, refetch: refetchConfigs } =
        useGetDoctorSignupConfigsQuery();
    const [updateDraft, { isLoading: savingDraft }] = useUpdateDoctorSignupDraftMutation();
    const [updateFields, { isLoading: savingFields }] = useUpdateDoctorSignupFieldsMutation();
    const [promotePreview, { isLoading: promoting }] = usePromoteDoctorSignupToPreviewMutation();
    const [publish, { isLoading: publishing }] = usePublishDoctorSignupConfigMutation();

    // ---- Local edit state ----
    // Keep one un-saved snapshot per row keyed by field id. We only PUT
    // the rows that actually changed, so a Save Draft cycle stays small
    // and the audit log doesn't get spammed.
    const [pageOverrides, setPageOverrides] = useState({});
    const [fieldOverrides, setFieldOverrides] = useState({});  // { [id]: { label?, placeholder?, helper_text?, is_present? } }
    const [bannerMessage, setBannerMessage] = useState(null);

    // Reset local edits whenever a fresh draft comes back from the server.
    useEffect(() => {
        setPageOverrides({});
        setFieldOverrides({});
    }, [draft?.id, draft?.updated_at]);

    const lockedFieldKeys = useMemo(
        () => new Set(draft?.locked_field_keys || []),
        [draft?.locked_field_keys],
    );

    // ---- Helpers to read current edited value ----
    const pageValue = (key) =>
        pageOverrides[key] !== undefined ? pageOverrides[key] : (draft?.[key] || '');

    const fieldValue = (field, key) =>
        fieldOverrides[field.id]?.[key] !== undefined
            ? fieldOverrides[field.id][key]
            : (field[key] ?? '');

    const fieldIsPresent = (field) => {
        const ov = fieldOverrides[field.id];
        if (ov && 'is_present' in ov) return !!ov.is_present;
        return field.is_present !== false;
    };

    // ---- Group field_configs by section, preserving original order ----
    const sections = useMemo(() => {
        const fc = draft?.field_configs || [];
        const bySection = new Map();
        for (const f of fc) {
            if (!bySection.has(f.section)) bySection.set(f.section, []);
            bySection.get(f.section).push(f);
        }
        // Sort each section by display_order.
        for (const arr of bySection.values()) {
            arr.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
        }
        return Array.from(bySection.entries());
    }, [draft?.field_configs]);

    // ---- Save handlers ----
    const handleSaveDraft = async () => {
        setBannerMessage(null);
        const tasks = [];
        if (Object.keys(pageOverrides).length > 0) {
            tasks.push(updateDraft(pageOverrides).unwrap());
        }
        const changedRows = Object.entries(fieldOverrides).map(([id, patch]) => ({
            id, ...patch,
        }));
        if (changedRows.length > 0) {
            tasks.push(updateFields(changedRows).unwrap());
        }
        if (tasks.length === 0) {
            setBannerMessage({ severity: 'info', text: 'Nothing to save.' });
            return;
        }
        try {
            const results = await Promise.all(tasks);
            // Surface any locked-field rejections from the field-update response.
            const fieldsRes = results.find((r) => r && r.rejected_updates);
            if (fieldsRes && fieldsRes.rejected_updates?.length > 0) {
                setBannerMessage({
                    severity: 'warning',
                    text: `Saved, but ${fieldsRes.rejected_updates.length} locked-field change(s) were silently dropped by the server (visibility / wiring on protected fields can't be changed).`,
                });
            } else {
                setBannerMessage({ severity: 'success', text: 'Draft saved.' });
            }
            refetch();
            refetchConfigs();
        } catch (err) {
            setBannerMessage({
                severity: 'error',
                text: err?.data?.message || err?.message || 'Save failed.',
            });
        }
    };

    // Round 5 — split publish into separate Preview (promote) + Publish
    // steps so the lifecycle aligns with every other page-config editor
    // (Landing, PageConfig, DoctorProfile, etc.). The shared
    // ConfigEditorHeader gates Publish on the existence of a Preview
    // row, so a user can no longer publish without explicitly promoting.
    const handlePromote = async () => {
        setBannerMessage(null);
        try {
            await promotePreview().unwrap();
            setBannerMessage({ severity: 'success', text: 'Promoted to preview.' });
            refetch();
            refetchConfigs();
        } catch (err) {
            setBannerMessage({
                severity: 'error',
                text: err?.data?.message || err?.message || 'Promote failed.',
            });
        }
    };

    const handlePublish = async () => {
        setBannerMessage(null);
        try {
            await publish().unwrap();
            setBannerMessage({ severity: 'success', text: 'Configuration published.' });
            refetch();
            refetchConfigs();
        } catch (err) {
            setBannerMessage({
                severity: 'error',
                text: err?.data?.message || err?.message || 'Publish failed.',
            });
        }
    };

    if (isLoading) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ p: 4 }}>
                <Alert severity="error">
                    Failed to load draft: {error?.data?.message || error?.message || String(error)}
                </Alert>
            </Box>
        );
    }

    const dirtyCount = Object.keys(pageOverrides).length
        + Object.keys(fieldOverrides).length;

    return (
        <Box sx={{ p: { xs: 2, md: 3 } }}>
            {/* Unified Draft / Preview / Publish header. Same component
                as the other page-config editors so this surface gains
                the chip strip (Draft / Preview / Live) and the Preview
                button it was missing — endpoints were already wired,
                only the UI had drifted. */}
            <ConfigEditorHeader
                title="Doctor Signup Page"
                canEdit
                hasChanges={dirtyCount > 0}
                draftExists={!!configs.draft}
                previewExists={!!configs.preview}
                live={configs.live}
                draftVersion={configs.draft?.version}
                isSaving={savingDraft || savingFields || promoting || publishing}
                onSaveDraft={handleSaveDraft}
                onPreview={handlePromote}
                onPublish={handlePublish}
                onRefresh={() => { refetch(); refetchConfigs(); }}
            />

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Tweak labels / placeholders / helper text for the public signup
                form. Locked fields (the ones the platform needs to authenticate
                a new account) can be relabelled but not hidden.
            </Typography>

            {bannerMessage && (
                <Alert
                    severity={bannerMessage.severity}
                    onClose={() => setBannerMessage(null)}
                    sx={{ mb: 2 }}
                >
                    {bannerMessage.text}
                </Alert>
            )}

            {/* Branding & Terms — colours, page title / subtitle, logo,
                terms / privacy text. Mounted via the same ``EditorTab``
                component the standalone Page Configuration Editor uses
                so the operator gets one editor for everything on the
                signup page (no more bouncing between the Login Module
                editor and this one). Changes are folded into
                ``pageOverrides`` and saved through the existing
                ``handleSaveDraft`` flow — no new backend endpoints. */}
            <Accordion sx={{ mb: 3 }} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        Branding & Terms
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <EditorTab
                        draft={{ ...(draft || {}), ...pageOverrides }}
                        handleDraftChange={(field, value) => {
                            // Mirror the change into the same overrides
                            // dict the per-field accordions write to,
                            // so Save Draft commits everything in one
                            // PUT round-trip.
                            setPageOverrides((prev) => ({
                                ...prev, [field]: value,
                            }));
                        }}
                        handleAssetUpload={() => {
                            // Asset upload flow (S3 staging + delayed
                            // PUT) lives in the standalone editor and
                            // hasn't been ported here yet — point the
                            // operator there for now. Text + colour
                            // edits still work fine in this editor.
                            setBannerMessage({
                                severity: 'info',
                                text:
                                    'Logo / terms / privacy document uploads are '
                                    + 'managed under Login Module → Page Configuration → '
                                    + 'Service Provider Signup. Text and colours can be '
                                    + 'edited here.',
                            });
                        }}
                        selectedPageType="doctor_signup"
                    />
                </AccordionDetails>
            </Accordion>

            {/* Page-level copy */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                    Page-level copy
                </Typography>
                <Stack spacing={2}>
                    {PAGE_FIELDS.map((p) => (
                        <TextField
                            key={p.key}
                            fullWidth
                            size="small"
                            label={p.label}
                            value={pageValue(p.key)}
                            onChange={(e) =>
                                setPageOverrides((prev) => ({ ...prev, [p.key]: e.target.value }))
                            }
                        />
                    ))}
                </Stack>
            </Paper>

            {/* Field editors, one accordion per section */}
            {sections.map(([sectionKey, fields]) => (
                <Accordion key={sectionKey} defaultExpanded sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle1" fontWeight="bold">
                            {SECTION_DISPLAY[sectionKey] || sectionKey}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                            ({fields.length} field{fields.length === 1 ? '' : 's'})
                        </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <Stack spacing={2} divider={<Divider flexItem />}>
                            {fields.map((f) => {
                                const locked = lockedFieldKeys.has(f.field_key);
                                return (
                                    <Box key={f.id}>
                                        <Stack
                                            direction="row"
                                            spacing={1}
                                            alignItems="center"
                                            sx={{ mb: 1 }}
                                        >
                                            <Typography variant="body2" color="text.secondary">
                                                <code>{f.field_key}</code> · {f.field_type}
                                            </Typography>
                                            {locked && (
                                                <Tooltip title="System-required field. You can edit its label / placeholder / helper text, but not hide it or change its type.">
                                                    <Chip
                                                        icon={<LockIcon />}
                                                        label="Locked"
                                                        size="small"
                                                        variant="outlined"
                                                        color="warning"
                                                    />
                                                </Tooltip>
                                            )}
                                            {f.data_source && (
                                                <StatusChip
                                                    label={`Options: ${f.data_source}`}
                                                    color="info"
                                                />
                                            )}
                                            <Box sx={{ flexGrow: 1 }} />
                                            <FormControlLabel
                                                control={
                                                    <Switch
                                                        size="small"
                                                        checked={fieldIsPresent(f)}
                                                        disabled={locked}
                                                        onChange={(e) =>
                                                            setFieldOverrides((prev) => ({
                                                                ...prev,
                                                                [f.id]: {
                                                                    ...prev[f.id],
                                                                    is_present: e.target.checked,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                }
                                                label={fieldIsPresent(f) ? 'Visible' : 'Hidden'}
                                            />
                                        </Stack>
                                        <Stack
                                            direction={{ xs: 'column', md: 'row' }}
                                            spacing={2}
                                        >
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Label"
                                                value={fieldValue(f, 'label')}
                                                onChange={(e) =>
                                                    setFieldOverrides((prev) => ({
                                                        ...prev,
                                                        [f.id]: {
                                                            ...prev[f.id],
                                                            label: e.target.value,
                                                        },
                                                    }))
                                                }
                                            />
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Placeholder"
                                                value={fieldValue(f, 'placeholder')}
                                                onChange={(e) =>
                                                    setFieldOverrides((prev) => ({
                                                        ...prev,
                                                        [f.id]: {
                                                            ...prev[f.id],
                                                            placeholder: e.target.value,
                                                        },
                                                    }))
                                                }
                                            />
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Helper text"
                                                value={fieldValue(f, 'helper_text')}
                                                onChange={(e) =>
                                                    setFieldOverrides((prev) => ({
                                                        ...prev,
                                                        [f.id]: {
                                                            ...prev[f.id],
                                                            helper_text: e.target.value,
                                                        },
                                                    }))
                                                }
                                            />
                                        </Stack>
                                    </Box>
                                );
                            })}
                        </Stack>
                    </AccordionDetails>
                </Accordion>
            ))}

            {/* Master-data CRUD (UG / PG / SS colleges, specializations,
                degrees) is centralised under Doctor Profile → Master
                Data. The previous accordion here pointed at the same
                backend tables, so two editors were competing for the
                same rows — confusing, and silent backend errors made
                the "counts reset to 0" symptom hard to diagnose.
                Single source of truth now lives in the profile editor;
                this banner is the bridge. */}
            <Alert
                severity="info"
                sx={{ mt: 3 }}
                action={
                    <Button
                        size="small"
                        component={RouterLink}
                        to="/dashboard/admin/doctor-profile-config/editor?section=master_data"
                        endIcon={<OpenInNewIcon fontSize="small" />}
                    >
                        Open editor
                    </Button>
                }
            >
                <AlertTitle sx={{ fontWeight: 'bold' }}>
                    Master data lives in Doctor Profile
                </AlertTitle>
                Colleges, specializations and degrees are curated under
                {' '}
                <strong>Doctor Profile → Master Data</strong>. Edits
                apply to the signup form automatically.
            </Alert>
        </Box>
    );
};

export default DoctorSignupConfigEditor;
