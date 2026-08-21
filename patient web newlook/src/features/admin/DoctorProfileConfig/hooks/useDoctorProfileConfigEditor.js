/**
 * useDoctorProfileConfigEditor — Custom hook for Doctor Profile Config Editor
 * Manages draft state, field configs, save/promote/publish workflow
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetDoctorProfileConfigsQuery,
    useGetDoctorProfileDraftQuery,
    useUpdateDoctorProfileDraftMutation,
    useUpdateDoctorProfileFieldsMutation,
    usePromoteDoctorProfileToPreviewMutation,
    usePublishDoctorProfileConfigMutation,
    useGetDoctorProfileHistoryQuery,
    useRestoreDoctorProfileVersionMutation,
    useGetDoctorProfileAuditLogsQuery,
} from '../../api/doctorProfileConfigEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const TABS = ['Editor', 'Preview', 'History'];

const useDoctorProfileConfigEditor = (sectionGroup = null) => {
    const { hasFullAccess, can } = usePermissions();
    const hasViewAccess = hasFullAccess || can('login_page_config', 'view');
    const hasEditAccess = hasFullAccess || can('login_page_config', 'edit');

    // Tab state
    const [activeTab, setActiveTab] = useState(0);

    // Local draft state
    const [localDraft, setLocalDraft] = useState(null);
    const [localFieldConfigs, setLocalFieldConfigs] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Publish confirmation dialog
    const [showPublishDialog, setShowPublishDialog] = useState(false);

    // Registry of "deferred master_data write" flushers. Each
    // FieldEditor for a master-backed field registers a callback
    // under its field.id; ``handleSaveDraft`` iterates and awaits
    // each one after the regular field-config save. This lets
    // FieldEditor keep edits in local state and avoid the per-
    // keystroke backend write that previously caused the options
    // list to re-sort alphabetically mid-typing.
    const optionsFlushersRef = useRef(new Map());
    const registerOptionsFlusher = useCallback((fieldId, flushFn) => {
        if (flushFn) {
            optionsFlushersRef.current.set(fieldId, flushFn);
        } else {
            optionsFlushersRef.current.delete(fieldId);
        }
    }, []);

    // Snackbar for save / promote / publish / restore feedback. The
    // previous catch blocks just did ``console.error`` and the success
    // paths fired nothing, so the operator never saw a confirmation
    // after Publish (the original "no publish message" complaint).
    const [snack, setSnack] = useState({
        open: false, severity: 'success', message: '',
    });
    const notify = useCallback((severity, message) => {
        setSnack({ open: true, severity, message });
    }, []);
    const closeSnack = useCallback(() => {
        setSnack((s) => ({ ...s, open: false }));
    }, []);
    // Extract the most informative message from a rejected mutation —
    // backend envelopes vary, so try each shape in turn.
    const errMsg = (err, fallback) =>
        err?.data?.error
        || err?.data?.message
        || err?.error
        || err?.message
        || fallback;

    // RTK Query hooks
    const {
        data: configsResponse,
        isLoading: isLoadingConfigs,
        refetch: refetchConfigs,
    } = useGetDoctorProfileConfigsQuery();

    // Pass section group to fetch only relevant fields from backend
    const {
        data: draftResponse,
        isLoading: isLoadingDraft,
        refetch: refetchDraft,
    } = useGetDoctorProfileDraftQuery(sectionGroup || undefined);

    const {
        data: history,
        isLoading: isLoadingHistory,
    } = useGetDoctorProfileHistoryQuery(10);

    const {
        data: auditLogs,
        isLoading: isLoadingAuditLogs,
    } = useGetDoctorProfileAuditLogsQuery(50);

    // Mutations
    const [updateDraft, { isLoading: isSaving }] = useUpdateDoctorProfileDraftMutation();
    const [updateFields, { isLoading: isSavingFields }] = useUpdateDoctorProfileFieldsMutation();
    const [promoteToPreview, { isLoading: isPromoting }] = usePromoteDoctorProfileToPreviewMutation();
    const [publishConfig, { isLoading: isPublishing }] = usePublishDoctorProfileConfigMutation();
    const [restoreVersion, { isLoading: isRestoring }] = useRestoreDoctorProfileVersionMutation();

    // Extract data
    const configs = configsResponse?.data || {};
    const draft = draftResponse?.data || null;
    const dataSources = draftResponse?.data?.data_sources || {};

    // Sync server draft to local state
    useEffect(() => {
        if (draft) {
            setLocalDraft({ ...draft });
            setLocalFieldConfigs(draft.field_configs || []);
            setHasUnsavedChanges(false);
        }
    }, [draft]);

    // ---- Handlers ----

    const handleDraftChange = useCallback((key, value) => {
        setLocalDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
        setHasUnsavedChanges(true);
    }, []);

    const handleSectionChange = useCallback((sectionKey, field, value) => {
        setLocalDraft((prev) => {
            if (!prev) return prev;
            const fields = prev.fields || {};
            const sections = (fields.sections || []).map((s) =>
                s.key === sectionKey ? { ...s, [field]: value } : s
            );
            return { ...prev, fields: { ...fields, sections } };
        });
        setHasUnsavedChanges(true);
    }, []);

    const handleFieldConfigChange = useCallback((fieldId, key, value) => {
        setLocalFieldConfigs((prev) =>
            prev.map((f) => (f.id === fieldId ? { ...f, [key]: value } : f))
        );
        setHasUnsavedChanges(true);
    }, []);

    const handleSaveDraft = useCallback(async () => {
        if (!localDraft) return;

        try {
            // Save page-level changes
            const {
                field_configs, id, config_id, page_type, version, status,
                created_at, updated_at, published_at, ...pageData
            } = localDraft;
            await updateDraft(pageData).unwrap();

            // Save field config changes
            const fieldUpdates = localFieldConfigs.map((f) => ({
                id: f.id,
                label: f.label,
                placeholder: f.placeholder,
                helper_text: f.helper_text,
                required: f.required,
                is_present: f.is_present,
                display_order: f.display_order,
                translations: f.translations,
                user_types: f.user_types,
                data_source: f.data_source,
                field_type: f.field_type,
                options: f.options,
            }));
            await updateFields(fieldUpdates).unwrap();

            // Save Draft DELIBERATELY does not flush master_data
            // edits — master_data is the source of truth for the
            // public signup form's dropdowns and writing to it
            // would push edits live before Publish runs. The
            // operator's pending option list lives on
            // PageFieldConfig.options (a per-tenant draft buffer);
            // the actual master_data CRUD batch lives in
            // ``handlePublish`` (see below).

            setHasUnsavedChanges(false);
            notify('success', 'Draft saved.');
            return true;
        } catch (err) {
            notify('error', errMsg(err, 'Save draft failed.'));
            return false;
        }
    }, [localDraft, localFieldConfigs, updateDraft, updateFields, notify]);

    const handlePromoteToPreview = useCallback(async () => {
        // Auto-save before promoting
        if (hasUnsavedChanges) {
            const saved = await handleSaveDraft();
            if (!saved) return;
        }
        try {
            await promoteToPreview().unwrap();
            refetchConfigs();
            notify('success', 'Promoted to preview.');
        } catch (err) {
            notify('error', errMsg(err, 'Promote to preview failed.'));
        }
    }, [hasUnsavedChanges, handleSaveDraft, promoteToPreview,
        refetchConfigs, notify]);

    const handlePublish = useCallback(async (note) => {
        try {
            // Flush deferred master_data option edits FIRST — these
            // were accumulated in PageFieldConfig.options during the
            // Save Draft cycle but not yet written to the master
            // catalog. Doing them before publishConfig means the
            // public read of the newly-LIVE PageConfig immediately
            // sees the right dropdown options.
            //
            // Each FieldEditor (for master-backed fields) registers
            // a flusher under its field.id via
            // ``registerOptionsFlusher``. The flusher diffs the
            // local buffer against masterRows and emits one bulk
            // create + one delete per removed row. Errors are
            // logged but don't abort the publish — a partial
            // master_data state is better than a publish that's
            // rolled back after the LIVE row was promoted.
            const flushers = Array.from(optionsFlushersRef.current.values());
            for (const flushFn of flushers) {
                try {
                    await flushFn();
                } catch (e) {
                    console.error('[doctorProfile] master_data flush failed', e);
                }
            }

            // Optional ``note`` — free-text comment the operator types
            // in the publish dialog. Forwarded to the backend's audit
            // log so the History tab can display the rationale next to
            // each version. Empty string is fine (mutation strips it).
            await publishConfig(note).unwrap();
            setShowPublishDialog(false);
            refetchConfigs();
            // The original symptom: Publish silently closed the dialog
            // with no feedback. Now the operator always sees a green
            // toast on success (and the actual error message on fail).
            notify('success', 'Published! Changes are live.');
        } catch (err) {
            notify('error', errMsg(err, 'Publish failed.'));
        }
    }, [publishConfig, refetchConfigs, notify]);

    const handleRestore = useCallback(async (versionId) => {
        try {
            await restoreVersion(versionId).unwrap();
            refetchDraft();
            notify('success', 'Version restored to draft.');
        } catch (err) {
            notify('error', errMsg(err, 'Restore failed.'));
        }
    }, [restoreVersion, refetchDraft, notify]);

    return {
        // Permissions
        hasViewAccess,
        hasEditAccess,
        // Tab
        activeTab,
        setActiveTab,
        TABS,
        // Data
        configs,
        localDraft,
        localFieldConfigs,
        dataSources,
        history: history || [],
        auditLogs: auditLogs || [],
        // Loading states
        isLoading: isLoadingConfigs || isLoadingDraft,
        isSaving: isSaving || isSavingFields,
        isPromoting,
        isPublishing,
        isRestoring,
        isLoadingHistory,
        isLoadingAuditLogs,
        // State
        hasUnsavedChanges,
        showPublishDialog,
        setShowPublishDialog,
        // Snackbar feedback
        snack,
        closeSnack,
        // Handlers
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
        handleRestore,
        // Round 9 — per-field master_data flusher registry. Passed
        // down through SectionEditor → FieldEditor; FieldEditor uses
        // it to defer master_data CRUD until Save Draft.
        registerOptionsFlusher,
    };
};

export default useDoctorProfileConfigEditor;
