/**
 * useAdminProfileConfigEditor — Custom hook for Admin Profile Config Editor.
 * Manages draft state, field configs, save/promote/publish workflow.
 * Mirrors useDoctorProfileConfigEditor but uses admin profile config API.
 */
import { useState, useEffect, useCallback } from 'react';
import {
    useGetAdminProfileConfigsQuery,
    useGetAdminProfileDraftQuery,
    useUpdateAdminProfileDraftMutation,
    useUpdateAdminProfileFieldsMutation,
    usePromoteAdminProfileToPreviewMutation,
    usePublishAdminProfileConfigMutation,
    useGetAdminProfileHistoryQuery,
    useRestoreAdminProfileVersionMutation,
    useGetAdminProfileAuditLogsQuery,
} from '../../api/adminProfileConfigEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const TABS = ['Editor', 'Preview', 'History'];

const useAdminProfileConfigEditor = (sectionGroup = null) => {
    const { hasFullAccess, can } = usePermissions();
    const hasViewAccess = hasFullAccess || can('login_page_config', 'view');
    const hasEditAccess = hasFullAccess || can('login_page_config', 'edit');

    const [activeTab, setActiveTab] = useState(0);
    const [localDraft, setLocalDraft] = useState(null);
    const [localFieldConfigs, setLocalFieldConfigs] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showPublishDialog, setShowPublishDialog] = useState(false);

    const {
        data: configsResponse,
        isLoading: isLoadingConfigs,
        refetch: refetchConfigs,
    } = useGetAdminProfileConfigsQuery();

    const {
        data: draftResponse,
        isLoading: isLoadingDraft,
        refetch: refetchDraft,
    } = useGetAdminProfileDraftQuery(sectionGroup || undefined);

    const {
        data: history,
        isLoading: isLoadingHistory,
    } = useGetAdminProfileHistoryQuery(10);

    const {
        data: auditLogs,
        isLoading: isLoadingAuditLogs,
    } = useGetAdminProfileAuditLogsQuery(50);

    const [updateDraft, { isLoading: isSaving }] = useUpdateAdminProfileDraftMutation();
    const [updateFields, { isLoading: isSavingFields }] = useUpdateAdminProfileFieldsMutation();
    const [promoteToPreview, { isLoading: isPromoting }] = usePromoteAdminProfileToPreviewMutation();
    const [publishConfig, { isLoading: isPublishing }] = usePublishAdminProfileConfigMutation();
    const [restoreVersion, { isLoading: isRestoring }] = useRestoreAdminProfileVersionMutation();

    const configs = configsResponse?.data || {};
    const draft = draftResponse?.data || null;

    useEffect(() => {
        if (draft) {
            setLocalDraft({ ...draft });
            setLocalFieldConfigs(draft.field_configs || []);
            setHasUnsavedChanges(false);
        }
    }, [draft]);

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
            const {
                field_configs, id, config_id, page_type, version, status,
                created_at, updated_at, published_at, ...pageData
            } = localDraft;
            await updateDraft(pageData).unwrap();

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
        hasViewAccess,
        hasEditAccess,
        activeTab,
        setActiveTab,
        TABS,
        configs,
        localDraft,
        localFieldConfigs,
        history: history || [],
        auditLogs: auditLogs || [],
        isLoading: isLoadingConfigs || isLoadingDraft,
        isSaving: isSaving || isSavingFields,
        isPromoting,
        isPublishing,
        isRestoring,
        isLoadingHistory,
        isLoadingAuditLogs,
        hasUnsavedChanges,
        showPublishDialog,
        setShowPublishDialog,
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
        handleRestore,
    };
};

export default useAdminProfileConfigEditor;
