/**
 * usePatientAppointmentConfigEditor — Custom hook for Patient Appointment Config Editor
 * Manages draft state, field configs, save/promote/publish workflow.
 * Works for both 'patient_appointment_filter' and 'patient_appointment_symptoms' page types.
 */
import { useState, useEffect, useCallback } from 'react';
import {
    useGetPatientAppointmentDraftQuery,
    useUpdatePatientAppointmentDraftMutation,
    useUpdatePatientAppointmentFieldsMutation,
    usePromotePatientAppointmentToPreviewMutation,
    usePublishPatientAppointmentConfigMutation,
    useGetPatientAppointmentHistoryQuery,
} from '../../api/patientAppointmentConfigEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const TABS = ['Editor', 'Preview', 'History'];

const usePatientAppointmentConfigEditor = (pageType, sectionGroup = null) => {
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
        data: draftResponse,
        isLoading: isLoadingDraft,
        refetch: refetchDraft,
    } = useGetPatientAppointmentDraftQuery(
        { pageType, section: sectionGroup || undefined },
        { skip: !pageType }
    );

    const {
        data: history,
        isLoading: isLoadingHistory,
    } = useGetPatientAppointmentHistoryQuery(
        { pageType, limit: 10 },
        { skip: !pageType }
    );

    // Mutations
    const [updateDraft, { isLoading: isSaving }] = useUpdatePatientAppointmentDraftMutation();
    const [updateFields, { isLoading: isSavingFields }] = useUpdatePatientAppointmentFieldsMutation();
    const [promoteToPreview, { isLoading: isPromoting }] = usePromotePatientAppointmentToPreviewMutation();
    const [publishConfig, { isLoading: isPublishing }] = usePublishPatientAppointmentConfigMutation();

    // Extract data
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
        if (!localDraft || !pageType) return;

        try {
            // Save page-level changes
            const {
                field_configs, id, config_id, page_type, version, status,
                created_at, updated_at, published_at, data_sources, ...pageData
            } = localDraft;
            await updateDraft({ pageType, ...pageData }).unwrap();

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
            await updateFields({ pageType, fields: fieldUpdates }).unwrap();

            setHasUnsavedChanges(false);
            return true;
        } catch (err) {
            console.error('Save draft failed:', err);
            return false;
        }
    }, [localDraft, localFieldConfigs, pageType, updateDraft, updateFields]);

    const handlePromoteToPreview = useCallback(async () => {
        // Auto-save before promoting
        if (hasUnsavedChanges) {
            const saved = await handleSaveDraft();
            if (!saved) return;
        }
        try {
            await promoteToPreview(pageType).unwrap();
            refetchDraft();
        } catch (err) {
            console.error('Promote to preview failed:', err);
        }
    }, [hasUnsavedChanges, handleSaveDraft, promoteToPreview, pageType, refetchDraft]);

    const handlePublish = useCallback(async () => {
        try {
            await publishConfig(pageType).unwrap();
            setShowPublishDialog(false);
            refetchDraft();
        } catch (err) {
            console.error('Publish failed:', err);
        }
    }, [publishConfig, pageType, refetchDraft]);

    return {
        // Permissions
        hasViewAccess,
        hasEditAccess,
        // Tab
        activeTab,
        setActiveTab,
        TABS,
        // Data
        localDraft,
        localFieldConfigs,
        dataSources,
        history: history || [],
        // Loading states
        isLoading: isLoadingDraft,
        isSaving: isSaving || isSavingFields,
        isPromoting,
        isPublishing,
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
    };
};

export default usePatientAppointmentConfigEditor;
