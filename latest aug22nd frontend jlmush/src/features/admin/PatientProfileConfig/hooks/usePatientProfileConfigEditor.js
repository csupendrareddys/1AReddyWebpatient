/**
 * usePatientProfileConfigEditor — Custom hook for Patient Profile Config Editor
 * Manages draft state, field configs, save/promote/publish workflow.
 * Mirrors useDoctorProfileConfigEditor pattern exactly.
 */
import { useState, useEffect, useCallback } from 'react';
import {
    useGetPatientProfileConfigsQuery,
    useGetPatientProfileDraftQuery,
    useUpdatePatientProfileDraftMutation,
    useUpdatePatientProfileFieldConfigsMutation,
    usePromotePatientProfileToPreviewMutation,
    usePublishPatientProfileMutation,
    useGetPatientProfileVersionHistoryQuery,
    useRestorePatientProfileVersionMutation,
} from '../../../service-receiver/api/patientProfileConfigEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const TABS = ['Editor', 'Preview', 'History'];

const usePatientProfileConfigEditor = (sectionGroup = null) => {
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

    // RTK Query hooks
    const {
        data: configsResponse,
        isLoading: isLoadingConfigs,
        refetch: refetchConfigs,
    } = useGetPatientProfileConfigsQuery();

    // Pass section group to fetch only relevant fields from backend
    const {
        data: draftResponse,
        isLoading: isLoadingDraft,
        refetch: refetchDraft,
    } = useGetPatientProfileDraftQuery(sectionGroup || undefined);

    const {
        data: history,
        isLoading: isLoadingHistory,
    } = useGetPatientProfileVersionHistoryQuery(10);

    // Mutations
    const [updateDraft, { isLoading: isSaving }] = useUpdatePatientProfileDraftMutation();
    const [updateFields, { isLoading: isSavingFields }] = useUpdatePatientProfileFieldConfigsMutation();
    const [promoteToPreview, { isLoading: isPromoting }] = usePromotePatientProfileToPreviewMutation();
    const [publishConfig, { isLoading: isPublishing }] = usePublishPatientProfileMutation();
    const [restoreVersion, { isLoading: isRestoring }] = useRestorePatientProfileVersionMutation();

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
        // Special case: adding a new field
        if (key === '_addNew' && value) {
            setLocalFieldConfigs((prev) => [...prev, value]);
            setHasUnsavedChanges(true);
            return;
        }
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

            setHasUnsavedChanges(false);
            return true;
        } catch (err) {
            console.error('Save draft failed:', err);
            return false;
        }
    }, [localDraft, localFieldConfigs, updateDraft, updateFields]);

    const handlePromoteToPreview = useCallback(async () => {
        // Auto-save before promoting
        if (hasUnsavedChanges) {
            const saved = await handleSaveDraft();
            if (!saved) return;
        }
        try {
            await promoteToPreview().unwrap();
            refetchConfigs();
        } catch (err) {
            console.error('Promote to preview failed:', err);
        }
    }, [hasUnsavedChanges, handleSaveDraft, promoteToPreview, refetchConfigs]);

    const handlePublish = useCallback(async () => {
        try {
            await publishConfig().unwrap();
            setShowPublishDialog(false);
            refetchConfigs();
        } catch (err) {
            console.error('Publish failed:', err);
        }
    }, [publishConfig, refetchConfigs]);

    const handleRestore = useCallback(async (versionId) => {
        try {
            await restoreVersion(versionId).unwrap();
            refetchDraft();
        } catch (err) {
            console.error('Restore failed:', err);
        }
    }, [restoreVersion, refetchDraft]);

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
        // Loading states
        isLoading: isLoadingConfigs || isLoadingDraft,
        isSaving: isSaving || isSavingFields,
        isPromoting,
        isPublishing,
        isRestoring,
        isLoadingHistory,
        // State
        hasUnsavedChanges,
        showPublishDialog,
        setShowPublishDialog,
        // Handlers
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
        handleRestore,
    };
};

export default usePatientProfileConfigEditor;
