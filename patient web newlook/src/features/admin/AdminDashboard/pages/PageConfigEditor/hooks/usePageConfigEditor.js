import { useState, useEffect, useCallback, useRef } from 'react';

// Maps field-name passed to <input type="file" onChange={…handleAssetUpload(e, '<key>')}>
// → which draft fields to write the resulting asset id / url into.
// One source of truth so the staging code, the flush code, and the save
// handlers all agree.
const ASSET_FIELD_MAP = {
    logo:             { idField: 'logo_asset_id',    urlField: 'logo_url' },
    terms_document:   { idField: 'terms_asset_id',   urlField: 'terms_url' },
    privacy_document: { idField: 'privacy_asset_id', urlField: 'privacy_url' },
};
import { useNavigate, useSearchParams } from 'react-router-dom';
import usePermissions from '../../../../../../common/hooks/usePermissions';
import {
    useGetAdminPageConfigsQuery,
    useGetDraftConfigQuery,
    useUpdateDraftConfigMutation,
    usePromoteToPreviewMutation,
    usePublishConfigMutation,
    useGetVersionHistoryQuery,
    useGetPageConfigAuditLogsQuery,
    useRestoreVersionMutation,
    uploadAsset,
    PAGE_TYPE_LABELS
} from '../../../../api/pageConfigEndpoints';

/**
 * @param {string} [pageTypeOverride] - When provided, locks the editor
 *   to this page_type instead of reading the URL ``?type=`` param. Used
 *   when this hook is embedded inside another editor (e.g.
 *   DoctorSignupConfigEditor pins it to ``doctor_signup``) so the
 *   embedded copy doesn't fight with the URL of its host. When omitted,
 *   the hook behaves as before (reads / writes the URL).
 */
const usePageConfigEditor = (pageTypeOverride) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { hasFullAccess, can } = usePermissions();

    // Sub-admins with login_page_config view can access in preview-only mode
    const hasViewAccess = hasFullAccess || can('login_page_config', 'view');
    const hasEditAccess = hasFullAccess || can('login_page_config', 'edit');

    // Get initial page type from URL or default to patient_login. The
    // override pin is for embedded use — keep selectedPageType in state
    // so internal callers (handlePageTypeChange) can still mutate it
    // when not pinned.
    const initialPageType = pageTypeOverride
        || searchParams.get('type')
        || 'patient_login';
    const [selectedPageType, setSelectedPageType] = useState(initialPageType);
    const isPinned = !!pageTypeOverride;

    // Local State
    const [configs, setConfigs] = useState({ draft: null, preview: null, live: null });
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [hasChanges, setHasChanges] = useState(false);
    const [activeTab, setActiveTab] = useState(0); // 0: Editor, 1: Preview, 2: History
    const [showPublishDialog, setShowPublishDialog] = useState(false);

    // ──────────────────────────────────────────────────────────────────
    // Deferred asset uploads
    // ──────────────────────────────────────────────────────────────────
    // Files chosen by the user are NOT uploaded immediately. We hold the
    // ``File`` object plus a blob URL for instant preview, and only POST
    // them to the backend when the user explicitly clicks "Save Draft" or
    // "Publish". This keeps the editor responsive (no waterfall on every
    // file pick), and lets the user discard a pick by simply changing
    // their mind before save.
    //
    // Shape: { [fieldName]: { file: File, previewUrl: string } }
    const [pendingAssets, setPendingAssets] = useState({});
    // Keep a ref for the cleanup effect so blob URLs are revoked on unmount
    // even if state has been replaced — avoids memory leaks in long sessions.
    const pendingAssetsRef = useRef(pendingAssets);
    pendingAssetsRef.current = pendingAssets;
    useEffect(() => () => {
        Object.values(pendingAssetsRef.current || {}).forEach((p) => {
            if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        });
    }, []);

    // RTK Query Hooks
    // We intentionally don't use the hook's data directly for 'draft' because we need 
    // local state for editing. We sync when data is fetched.
    const { 
        data: adminConfigs, 
        isLoading: isConfigsLoading, 
        refetch: refetchConfigs 
    } = useGetAdminPageConfigsQuery(selectedPageType, { skip: !hasViewAccess, refetchOnMountOrArgChange: true });

    const { 
        data: draftConfigData, 
        isLoading: isDraftLoading 
    } = useGetDraftConfigQuery(selectedPageType, { skip: !hasViewAccess || !!adminConfigs?.draft, refetchOnMountOrArgChange: true });
    
    // Mutations
    const [updateDraft, { isLoading: isUpdating }] = useUpdateDraftConfigMutation();
    const [promoteToPreview, { isLoading: isPromoting }] = usePromoteToPreviewMutation();
    const [publishConfig, { isLoading: isPublishing }] = usePublishConfigMutation();
    const [restoreVersion, { isLoading: isRestoring }] = useRestoreVersionMutation();

    // History and Logs (only fetched when needed)
    // History tab index depends on whether user has edit access:
    // With edit: 0=Editor, 1=Preview, 2=History  |  Without edit: 0=Preview, 1=History
    const historyTabIndex = hasEditAccess ? 2 : 1;
    const { data: versionHistory = [] } = useGetVersionHistoryQuery(
        { pageType: selectedPageType },
        { skip: activeTab !== historyTabIndex || !hasViewAccess }
    );
    const { data: auditLogsResult = [] } = useGetPageConfigAuditLogsQuery(
        { pageType: selectedPageType },
        { skip: activeTab !== historyTabIndex || !hasViewAccess }
    );
    const auditLogs = Array.isArray(auditLogsResult) ? auditLogsResult : [];

    // Effect to sync fetched data to local state
    useEffect(() => {
        if (adminConfigs?.data) {
            // API returns { success: true, data: { draft: ..., preview: ..., live: ... } }
            // So adminConfigs is the full response, adminConfigs.data is the payload
            const data = adminConfigs.data;
            setConfigs(data);
            
            if (data.draft) {
                setDraft(data.draft);
            } else if (draftConfigData?.data) {
                // If main config didn't have draft but separate draft query did
                setDraft(draftConfigData.data);
                setConfigs(prev => ({ ...prev, draft: draftConfigData.data }));
            }
            setLoading(false);
        } else if (isConfigsLoading || isDraftLoading) {
            setLoading(true);
        }
    }, [adminConfigs, draftConfigData, isConfigsLoading, isDraftLoading]);

    // Handle Page Type Change. When the hook is pinned (embedded use),
    // this is a no-op — the caller doesn't render the page-type selector
    // anyway, so this guard is belt-and-suspenders.
    const handlePageTypeChange = (event) => {
        if (isPinned) return;
        const newType = event.target.value;
        setSelectedPageType(newType);
        // Reset state for new page type
        setDraft(null);
        setHasChanges(false);
        setActiveTab(0);
        // URL update is optional but good practice
        navigate(`?type=${newType}`, { replace: true });
    };

    const handleDraftChange = (field, value) => {
        setDraft(prev => ({ ...prev, [field]: value }));
        setHasChanges(true);
    };

    const handleSaveDraft = async () => {
        try {
            setError(null);
            // 1) Upload any staged assets (logo / docs) to S3 first, fold the
            //    resulting asset_ids into the draft payload.
            const draftWithAssets = await flushPendingAssets(draft);
            // 2) PUT the merged draft.
            const response = await updateDraft({
                pageType: selectedPageType, data: draftWithAssets,
            }).unwrap();
            const updatedDraft = response?.data || response;
            setDraft(updatedDraft);
            setConfigs(prev => ({ ...prev, draft: updatedDraft }));
            setSuccessMessage('Draft saved successfully!');
            setHasChanges(false);
        } catch (err) {
            setError(err.data?.message || err?.message || 'Failed to save draft');
        }
    };

    const handlePromoteToPreview = async () => {
        try {
            // Auto-save draft (and flush any pending uploads) first.
            if (hasChanges || Object.keys(pendingAssets).length > 0) {
                const draftWithAssets = await flushPendingAssets(draft);
                await updateDraft({ pageType: selectedPageType, data: draftWithAssets }).unwrap();
            }

            const response = await promoteToPreview(selectedPageType).unwrap();
            const previewData = response?.data || response;
            setConfigs(prev => ({ ...prev, preview: previewData, draft: null }));
            setSuccessMessage('Promoted to preview! You can now test it.');
            refetchConfigs();
        } catch (err) {
            console.error('Promote error:', err);
            setError(err.data?.message || err.error?.data?.message || 'Failed to promote to preview');
        }
    };

    const handlePublish = async () => {
        try {
            // Same guarantee on publish — never lose a staged asset because
            // the operator skipped the explicit Save step.
            if (hasChanges || Object.keys(pendingAssets).length > 0) {
                const draftWithAssets = await flushPendingAssets(draft);
                await updateDraft({ pageType: selectedPageType, data: draftWithAssets }).unwrap();
            }
            const response = await publishConfig(selectedPageType).unwrap();
            const liveData = response?.data || response;
            setConfigs(prev => ({ ...prev, live: liveData, preview: null }));
            setSuccessMessage('Published successfully! Changes are now live.');
            setShowPublishDialog(false);
            refetchConfigs();
        } catch (err) {
            setError(err.data?.message || 'Failed to publish');
        }
    };

    const handleRestoreVersion = async (versionId, versionNum) => {
        if (!window.confirm(`Restore version ${versionNum} to draft? This will replace your current draft.`)) {
            return;
        }

        try {
            setError(null);
            const response = await restoreVersion({ pageType: selectedPageType, versionId }).unwrap();
            setSuccessMessage(`Version ${versionNum} restored to draft!`);
            // The mutation invalidation should trigger a refetch of getAdminPageConfigs
            // which will update the draft in the useEffect
            setActiveTab(0);
        } catch (err) {
            setError(err.data?.message || 'Failed to restore version');
        }
    };

    // ──────────────────────────────────────────────────────────────────
    // Stage an asset locally (no network). Network upload happens at
    // save / preview / publish time — see ``flushPendingAssets`` below.
    // ──────────────────────────────────────────────────────────────────
    const handleAssetUpload = (event, fieldName) => {
        const file = event.target.files[0];
        // Always reset the input so re-picking the same file fires onChange.
        event.target.value = '';
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            setError('File size must be less than 2MB');
            return;
        }

        // Revoke the previous blob (if any) for this field to avoid leaks.
        const prev = pendingAssets[fieldName];
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);

        const previewUrl = URL.createObjectURL(file);
        setPendingAssets((p) => ({ ...p, [fieldName]: { file, previewUrl } }));

        // Surface the local preview URL on the draft so the existing UI
        // (which reads e.g. ``draft.logo_url``) shows the picked image
        // immediately. The asset_id stays whatever it was — we only mint
        // a real id when we actually upload on save.
        const urlField = ASSET_FIELD_MAP[fieldName]?.urlField;
        if (urlField) {
            setDraft((d) => (d ? { ...d, [urlField]: previewUrl } : d));
        }
        if (fieldName === 'logo') {
            setDraft((d) => (d ? { ...d, logo_is_present: true } : d));
        }
        setHasChanges(true);
    };

    // Upload everything queued in ``pendingAssets`` and merge the
    // returned asset_ids into the draft. Returns the patched draft so
    // the caller can pass it to PUT /draft in the same flow.
    const flushPendingAssets = useCallback(async (currentDraft) => {
        const fields = Object.keys(pendingAssets);
        if (fields.length === 0) return currentDraft;

        let nextDraft = { ...(currentDraft || {}) };
        for (const fieldName of fields) {
            const { file } = pendingAssets[fieldName];
            const map = ASSET_FIELD_MAP[fieldName];
            if (!map) continue;
            const resp = await uploadAsset(file, fieldName, file.name);
            const asset = resp?.data || resp;
            if (asset?.id) {
                nextDraft[map.idField] = asset.id;
                if (map.urlField && asset.url) nextDraft[map.urlField] = asset.url;
            }
        }
        // Revoke blob URLs and clear staged files now that they're uploaded.
        Object.values(pendingAssets).forEach((p) => {
            if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        });
        setPendingAssets({});
        return nextDraft;
    }, [pendingAssets]);

    // Discard a staged file without saving (e.g. user changes their mind).
    const discardPendingAsset = useCallback((fieldName) => {
        setPendingAssets((p) => {
            const cur = p[fieldName];
            if (cur?.previewUrl) URL.revokeObjectURL(cur.previewUrl);
            const { [fieldName]: _drop, ...rest } = p;
            return rest;
        });
    }, []);

    const isSaving = isUpdating || isPromoting || isPublishing || isRestoring;

    return {
        hasFullAccess,
        hasViewAccess,
        hasEditAccess,
        selectedPageType,
        configs,
        draft,
        loading,
        error,
        setError,
        successMessage,
        setSuccessMessage,
        hasChanges,
        activeTab,
        setActiveTab,
        showPublishDialog,
        setShowPublishDialog,
        versionHistory,
        auditLogs,
        isSaving,
        handlePageTypeChange,
        handleSaveDraft,
        handleDraftChange,
        handlePromoteToPreview,
        handlePublish,
        handleRestoreVersion,
        handleAssetUpload,
        // New: number of staged-but-not-yet-uploaded files. Use this to
        // render a "1 unsaved upload" pill next to the Save button so the
        // operator knows their image isn't persisted yet.
        pendingAssetCount: Object.keys(pendingAssets).length,
        discardPendingAsset,
        refetchConfigs
    };
};

export default usePageConfigEditor;
