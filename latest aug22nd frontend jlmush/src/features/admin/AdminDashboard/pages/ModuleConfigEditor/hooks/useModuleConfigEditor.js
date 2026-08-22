/**
 * Orchestrates RTK Query state for the module-level editor.
 *
 * Module mutations happen in place on the landing DRAFT subtree — there is
 * no module-level draft/preview/live lifecycle (the landing atomic publish
 * snapshots the whole tree).
 *
 * History for this module is derived from the landing snapshots by picking
 * out the matching module from ``snapshot.tree_json`` — we fetch full snapshot
 * rows lazily only when the user opens the History tab.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
    useGetLandingModuleQuery,
    useUpdateLandingModuleMutation,
    useGetLandingHistoryQuery,
    useRestoreLandingModuleMutation,
} from '../../../../api/landingPageConfigEndpoints';
import {
    useGetPlatformLandingModuleQuery,
    useUpdatePlatformLandingModuleMutation,
    useUploadPlatformLandingAssetMutation,
} from '../../../../api/platformLandingEndpoints';
import { useUploadLandingAssetMutation } from '../../../../api/landingPageConfigEndpoints';
import resolveStagedGalleryUploads from '../../../../components/MediaListEditor/resolveStagedUploads';
import usePermissions from '../../../../../../common/hooks/usePermissions';

const useModuleConfigEditor = () => {
    const { moduleId } = useParams();
    const location = useLocation();
    // Mode is implied by which parent route mounted us: paths under
    // ``/dashboard/platform/landing-config/...`` are the platform-marketing
    // surface (writes ``platform_landing_*`` tables); everything else is the
    // per-tenant clinic surface. We branch endpoints rather than duplicating
    // the editor so the UI stays single-source.
    const isPlatform = location.pathname.startsWith('/dashboard/platform/');

    const [activeTab, setActiveTab] = useState(0);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

    const permissions = usePermissions();
    const { hasFullAccess, isPlatformOwner } = permissions;
    // Platform mode is already gated by the platform_owner role on the route
    // tree, so any caller reaching this hook in platform mode can view+edit
    // — mirror that here instead of running the tenant ACL on a row that
    // isn't a tenant module.
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

    const tenantModuleQ = useGetLandingModuleQuery(moduleId, {
        skip: !canView || !moduleId || isPlatform,
        refetchOnMountOrArgChange: true,
    });
    const platformModuleQ = useGetPlatformLandingModuleQuery(moduleId, {
        skip: !canView || !moduleId || !isPlatform,
        refetchOnMountOrArgChange: true,
    });
    // History is landing-snapshot-driven on the tenant side. Platform mode
    // has no snapshot/restore lifecycle for individual modules (the platform
    // config-level Publish does the snapshot), so we don't fetch history in
    // platform mode and the History tab will simply be empty.
    const historyQ = useGetLandingHistoryQuery(20, { skip: !canView || isPlatform, refetchOnMountOrArgChange: true });

    const [updateTenantModule, updateTenantState] = useUpdateLandingModuleMutation();
    const [updatePlatformModule, updatePlatformState] = useUpdatePlatformLandingModuleMutation();
    const updateModule = isPlatform ? updatePlatformModule : updateTenantModule;
    const updateState = isPlatform ? updatePlatformState : updateTenantState;
    const [restoreModule, restoreState] = useRestoreLandingModuleMutation();

    // Gallery uploads are deferred to Save Draft (see resolveStagedGalleryUploads).
    const [uploadTenantAsset] = useUploadLandingAssetMutation();
    const [uploadPlatformAsset] = useUploadPlatformLandingAssetMutation();
    const [isUploading, setIsUploading] = useState(false);

    const moduleQ = isPlatform ? platformModuleQ : tenantModuleQ;
    const module = moduleQ.data;

    // Buffered edits — admins can batch field changes, FAQ reorderings, etc.
    const [patch, setPatch] = useState({});
    const hasChanges = Object.keys(patch).length > 0;

    const patchModule = (updates) => setPatch((prev) => ({ ...prev, ...updates }));
    const resetPatch = () => setPatch({});

    const handleSave = async () => {
        if (!hasChanges) return;
        try {
            // Upload any staged gallery files first, then PUT the resolved patch.
            const uploadAsset = async (file, kind) => {
                const fn = isPlatform ? uploadPlatformAsset : uploadTenantAsset;
                const res = await fn({ file, kind }).unwrap();
                return { url: res.url, s3_key: res.s3_key };
            };
            setIsUploading(true);
            const resolvedPatch = await resolveStagedGalleryUploads(patch, uploadAsset);
            setIsUploading(false);
            await updateModule({ moduleId, data: resolvedPatch }).unwrap();
            resetPatch();
            setSnack({ open: true, severity: 'success', message: 'Module saved.' });
        } catch (err) {
            setIsUploading(false);
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.message || err?.data?.error || err?.message || 'Failed to save module.',
            });
        }
    };

    const handleRestoreSnapshot = async (snapshotId) => {
        if (isPlatform) return;  // platform mode has no per-module snapshot lifecycle
        try {
            await restoreModule({ moduleId, snapshotId }).unwrap();
            setSnack({ open: true, severity: 'success', message: 'Module restored from snapshot.' });
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Failed to restore module.',
            });
        }
    };

    const mergedModule = useMemo(
        () => (module ? { ...module, ...patch } : null),
        [module, patch],
    );

    return {
        moduleId,
        isPlatform,
        permissions: { canView, canEdit, hasFullAccess },
        loading: moduleQ.isLoading,
        error: moduleQ.error,
        module: mergedModule,
        history: historyQ.data || [],
        hasChanges,
        activeTab, setActiveTab,
        snack, setSnack,
        isSaving: isUploading || updateState.isLoading || restoreState.isLoading,
        actions: {
            patchModule, resetPatch, handleSave, handleRestoreSnapshot,
            refetch: () => {
                moduleQ.refetch();
                if (!isPlatform) historyQ.refetch();
            },
        },
    };
};

export default useModuleConfigEditor;
