/**
 * Orchestrates RTK Query state for the feature-level editor.
 *
 * Feature edits mutate the draft subtree in place. Preview renders the
 * production ServiceDetailPage with draft data; Phase 7 rewrites that page
 * to read from the new backend.
 *
 * History at feature level is derived from landing snapshots — restore pulls
 * this feature's row out of ``snapshot.tree_json`` and copies it back.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
    useGetLandingFeatureQuery,
    useUpdateLandingFeatureMutation,
    useGetLandingHistoryQuery,
    useRestoreLandingFeatureMutation,
    useGetLandingModuleQuery,
    useUploadLandingAssetMutation,
} from '../../../../api/landingPageConfigEndpoints';
import {
    useGetPlatformLandingFeatureQuery,
    useGetPlatformLandingModuleQuery,
    useUpdatePlatformLandingFeatureBySlugMutation,
    useUploadPlatformLandingAssetMutation,
} from '../../../../api/platformLandingEndpoints';
import resolveStagedGalleryUploads from '../../../../components/MediaListEditor/resolveStagedUploads';
import usePermissions from '../../../../../../common/hooks/usePermissions';

const useFeatureConfigEditor = () => {
    const { moduleId, slug } = useParams();
    const location = useLocation();
    // Same mode-from-URL convention as ``useModuleConfigEditor``.
    const isPlatform = location.pathname.startsWith('/dashboard/platform/');
    const [activeTab, setActiveTab] = useState(0);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

    const permissions = usePermissions();
    const { hasFullAccess, isPlatformOwner } = permissions;
    // Platform mode is route-gated to platform_owner; mirror that here.
    const canView = isPlatform
        ? (hasFullAccess || isPlatformOwner)
        : (hasFullAccess
            || permissions.can('landing_module', 'view', moduleId)
            || permissions.can('landing_config', 'view'));
    const canEdit = isPlatform
        ? (hasFullAccess || isPlatformOwner)
        : (hasFullAccess
            || permissions.can('landing_module', 'edit', moduleId)
            || permissions.can('landing_config', 'edit'));

    const tenantFeatureQ = useGetLandingFeatureQuery(
        { moduleId, slug },
        { skip: !canView || !moduleId || !slug || isPlatform, refetchOnMountOrArgChange: true },
    );
    const platformFeatureQ = useGetPlatformLandingFeatureQuery(
        { moduleId, slug },
        { skip: !canView || !moduleId || !slug || !isPlatform, refetchOnMountOrArgChange: true },
    );
    const tenantModuleQ = useGetLandingModuleQuery(moduleId, {
        skip: !canView || !moduleId || isPlatform,
        refetchOnMountOrArgChange: true,
    });
    const platformModuleQ = useGetPlatformLandingModuleQuery(moduleId, {
        skip: !canView || !moduleId || !isPlatform,
        refetchOnMountOrArgChange: true,
    });
    const historyQ = useGetLandingHistoryQuery(20, { skip: !canView || isPlatform, refetchOnMountOrArgChange: true });

    const [updateTenantFeature, updateTenantState] = useUpdateLandingFeatureMutation();
    const [updatePlatformFeature, updatePlatformState] = useUpdatePlatformLandingFeatureBySlugMutation();
    const updateFeature = isPlatform ? updatePlatformFeature : updateTenantFeature;
    const updateState = isPlatform ? updatePlatformState : updateTenantState;
    const [restoreFeature, restoreState] = useRestoreLandingFeatureMutation();

    // Gallery uploads are deferred to Save Draft (see resolveStagedGalleryUploads).
    const [uploadTenantAsset] = useUploadLandingAssetMutation();
    const [uploadPlatformAsset] = useUploadPlatformLandingAssetMutation();
    const [isUploading, setIsUploading] = useState(false);

    const featureQ = isPlatform ? platformFeatureQ : tenantFeatureQ;
    const moduleQ = isPlatform ? platformModuleQ : tenantModuleQ;
    const feature = featureQ.data;
    const parentModule = moduleQ.data;

    const [patch, setPatch] = useState({});
    const hasChanges = Object.keys(patch).length > 0;

    const patchFeature = (updates) => setPatch((prev) => ({ ...prev, ...updates }));
    const resetPatch = () => setPatch({});

    const handleSave = async () => {
        if (!hasChanges) return;
        try {
            const uploadAsset = async (file, kind) => {
                const fn = isPlatform ? uploadPlatformAsset : uploadTenantAsset;
                const res = await fn({ file, kind }).unwrap();
                return { url: res.url, s3_key: res.s3_key };
            };
            setIsUploading(true);
            const resolvedPatch = await resolveStagedGalleryUploads(patch, uploadAsset);
            setIsUploading(false);
            await updateFeature({ moduleId, slug, data: resolvedPatch }).unwrap();
            resetPatch();
            setSnack({ open: true, severity: 'success', message: 'Feature saved.' });
        } catch (err) {
            setIsUploading(false);
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.message || err?.data?.error || err?.message || 'Failed to save feature.',
            });
        }
    };

    const handleRestoreSnapshot = async (snapshotId) => {
        if (isPlatform) return;  // platform mode has no per-feature snapshot lifecycle
        try {
            await restoreFeature({ moduleId, slug, snapshotId }).unwrap();
            setSnack({ open: true, severity: 'success', message: 'Feature restored from snapshot.' });
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Failed to restore feature.',
            });
        }
    };

    const mergedFeature = useMemo(
        () => (feature ? { ...feature, ...patch } : null),
        [feature, patch],
    );

    return {
        moduleId, slug,
        isPlatform,
        permissions: { canView, canEdit, hasFullAccess },
        loading: featureQ.isLoading || moduleQ.isLoading,
        feature: mergedFeature, parentModule,
        history: historyQ.data || [],
        hasChanges,
        activeTab, setActiveTab,
        snack, setSnack,
        isSaving: isUploading || updateState.isLoading || restoreState.isLoading,
        actions: {
            patchFeature, resetPatch, handleSave, handleRestoreSnapshot,
            refetch: () => {
                featureQ.refetch();
                if (!isPlatform) historyQ.refetch();
            },
        },
    };
};

export default useFeatureConfigEditor;
