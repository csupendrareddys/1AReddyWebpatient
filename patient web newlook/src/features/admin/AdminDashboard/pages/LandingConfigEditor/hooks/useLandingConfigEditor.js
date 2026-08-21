/**
 * Orchestrates RTK Query state for the top-level landing editor.
 *
 * Same draft → preview → live lifecycle on both surfaces:
 *
 *   * ``tenant`` / ``legacy`` — per-tenant ``landing_*`` tables.
 *   * ``platform`` — ``platform_landing_*`` tables, scope-keyed
 *     (marketing vs default_template) via the ``?scope=`` query param.
 *
 * The platform branch was previously publish-in-place (Save mutated
 * LIVE directly). It now mirrors the tenant + page-config pattern:
 * Save Draft writes a DRAFT row (auto-cloned from LIVE on first edit),
 * Preview promotes DRAFT → PREVIEW, Publish promotes PREVIEW → LIVE.
 */
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    useGetLandingConfigSummaryQuery,
    useUpdateLandingDraftMutation,
    usePromoteLandingToPreviewMutation,
    usePublishLandingConfigMutation,
    useGetLandingHistoryQuery,
    useRestoreLandingSnapshotMutation,
} from '../../../../api/landingPageConfigEndpoints';
import {
    useGetPlatformLandingSummaryQuery,
    useUpdatePlatformLandingDraftMutation,
    usePromotePlatformLandingToPreviewMutation,
    usePublishPlatformLandingMutation,
    useGetPlatformLandingHistoryQuery,
    useRestorePlatformLandingSnapshotMutation,
} from '../../../../api/platformLandingEndpoints';
import usePermissions from '../../../../../../common/hooks/usePermissions';

const useLandingConfigEditor = ({ mode = 'tenant', skip = false } = {}) => {
    const isPlatform = mode === 'platform';
    const [searchParams] = useSearchParams();
    const platformScope = searchParams.get('scope') || 'marketing';

    const [activeTab, setActiveTab] = useState(0);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });
    const [publishDialogOpen, setPublishDialogOpen] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [patchVersion, setPatchVersion] = useState(0);
    const heroPatchRef = useRef({});

    // ── Permissions ────────────────────────────────────────────────
    // Platform mode is route-gated to platform_owner; any caller
    // reaching this hook in platform mode can view+edit.
    const permissions = usePermissions();
    const { hasFullAccess } = permissions;
    const canView = isPlatform || hasFullAccess || permissions.can('landing_config', 'view');
    const canEdit = isPlatform || hasFullAccess || permissions.can('landing_config', 'edit');

    // ── Tenant queries (skipped in platform mode) ─────────────────
    //
    // IMPORTANT: we intentionally do NOT call ``useGetLandingDraftQuery``.
    // That endpoint is ``get_or_create`` — every cache invalidation
    // (after promote / publish) would auto-create a brand-new draft
    // from defaults, causing the editor to revert to seed content.
    // Instead we read draft data from the SUMMARY endpoint (read-only,
    // no side effects). The first ``PUT /admin/draft`` (Save Draft)
    // internally calls ``get_or_create_draft()`` so the auto-create
    // only fires when the user actually saves — same pattern as the
    // platform path.
    const tenantSummaryQ = useGetLandingConfigSummaryQuery(
        undefined, {
            skip: skip || !canView || isPlatform,
            // Always re-fetch from the server on mount so another session's
            // saved draft is never masked by a 60-second stale cache.
            refetchOnMountOrArgChange: true,
        },
    );
    const tenantHistoryQ = useGetLandingHistoryQuery(
        20, {
            skip: skip || !canView || isPlatform,
            refetchOnMountOrArgChange: true,
        },
    );
    const [tenantUpdateDraft, tenantUpdateState] = useUpdateLandingDraftMutation();
    const [tenantPromote, tenantPromoteState] = usePromoteLandingToPreviewMutation();
    const [tenantPublish, tenantPublishState] = usePublishLandingConfigMutation();
    const [tenantRestore, tenantRestoreState] = useRestoreLandingSnapshotMutation();

    // ── Platform queries (skipped in tenant mode) ────────────────
    // Only the SUMMARY endpoint drives the status chips — same as
    // page-config. The DRAFT endpoint is kept available but only fired
    // when the user actually clicks Save (its backend handler auto-
    // creates the row from LIVE on first save). Hitting it on view
    // would auto-create a DRAFT every time someone opens the editor,
    // which would leave the Draft chip permanently lit even right
    // after a publish.
    const platformSummaryQ = useGetPlatformLandingSummaryQuery(
        platformScope, {
            skip: !isPlatform,
            refetchOnMountOrArgChange: true,
        },
    );
    const platformHistoryQ = useGetPlatformLandingHistoryQuery(
        platformScope, {
            skip: !isPlatform,
            refetchOnMountOrArgChange: true,
        },
    );
    const [platformUpdateDraft, platformUpdateState] = useUpdatePlatformLandingDraftMutation();
    const [platformPromote, platformPromoteState] = usePromotePlatformLandingToPreviewMutation();
    const [platformPublish, platformPublishState] = usePublishPlatformLandingMutation();
    const [platformRestore, platformRestoreState] = useRestorePlatformLandingSnapshotMutation();

    // ── Normalised data — same shape across both modes ──────────
    const summary = isPlatform ? platformSummaryQ.data : tenantSummaryQ.data;
    // Editing surface: prefer DRAFT if one exists, else fall back to
    // LIVE so the editor has something coherent to render. First save
    // creates the DRAFT row server-side (PUT /admin/draft auto-clones
    // from LIVE + applies the patch). Both tenant and platform paths
    // read from the summary endpoint only — no side-effect queries.
    const draftRow = summary?.draft || summary?.live || null;
    const preview = summary?.preview || null;
    const live = summary?.live || null;
    const history = (isPlatform ? platformHistoryQ.data : tenantHistoryQ.data) || [];

    const hasChanges = isDirty;
    const mergedDraft = useMemo(
        () => (draftRow ? { ...draftRow, ...heroPatchRef.current } : null),
        // Recalculate whenever the server data changes OR the user makes
        // any edit. ``patchVersion`` is a monotonically increasing counter
        // bumped by every ``patchHero`` call, so useMemo always sees a new
        // dependency value — unlike the old boolean ``isDirty`` which only
        // transitioned once (false → true) and then froze the memo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draftRow, patchVersion],
    );

    // Page-config-standard gate: Publish is enabled iff a PREVIEW row
    // exists (someone has promoted draft and the snapshot hasn't been
    // flipped to LIVE yet). Same gate used in tenant landing and
    // page-config editor — keeps the three editors visually identical.
    const hasPendingPublish = !!preview;

    const loading = isPlatform
        ? platformSummaryQ.isLoading
        : tenantSummaryQ.isLoading;
    const error = isPlatform
        ? platformSummaryQ.error
        : tenantSummaryQ.error;
    const isSaving = isPlatform
        ? (platformUpdateState.isLoading
            || platformPromoteState.isLoading
            || platformPublishState.isLoading
            || platformRestoreState.isLoading)
        : (tenantUpdateState.isLoading || tenantPromoteState.isLoading
            || tenantPublishState.isLoading || tenantRestoreState.isLoading);

    // ``patchHero`` accumulates field-level edits in a ref (zero
    // re-renders per call) and flips ``isDirty`` once (one re-render
    // total). This preserves the user's ref-based "no DOM thrash on
    // every keystroke" design while letting the Save Draft button
    // enable after the first edit.
    const patchHero = (updates) => {
        Object.assign(heroPatchRef.current, updates);
        setIsDirty(true);
        setPatchVersion(v => v + 1);  // Force useMemo recalc on every edit
    };
    const resetPatch = () => {
        heroPatchRef.current = {};
        setIsDirty(false);
        setPatchVersion(0);
    };
    const notifyError = (err, fallback) => setSnack({
        open: true, severity: 'error',
        message: err?.data?.message || err?.data?.error || fallback,
    });
    const notifyOk = (message) => setSnack({ open: true, severity: 'success', message });

    const handleSave = async () => {
        if (!isDirty) return;
        const data = { ...heroPatchRef.current };
        try {
            if (isPlatform) {
                await platformUpdateDraft({ scope: platformScope, data }).unwrap();
            } else {
                await tenantUpdateDraft(data).unwrap();
            }
            resetPatch();
            notifyOk('Draft saved.');
        } catch (err) {
            notifyError(err, 'Failed to save draft.');
        }
    };

    const handlePromote = async () => {
        try {
            // Auto-save accumulated edits before promoting — mirrors
            // PageConfigEditor's handlePromoteToPreview pattern. Without
            // this, clicking Preview discards all heroPatch edits because
            // the promote operates on the last-persisted draft row.
            if (isDirty) {
                const data = { ...heroPatchRef.current };
                if (isPlatform) {
                    await platformUpdateDraft({ scope: platformScope, data }).unwrap();
                } else {
                    await tenantUpdateDraft(data).unwrap();
                }
                resetPatch();
            }
            if (isPlatform) {
                await platformPromote(platformScope).unwrap();
            } else {
                await tenantPromote().unwrap();
            }
            notifyOk('Promoted to preview.');
        } catch (err) {
            notifyError(err, 'Failed to promote.');
        }
    };

    const handlePublish = async (note) => {
        try {
            if (isPlatform) {
                await platformPublish({ scope: platformScope, note }).unwrap();
            } else {
                await tenantPublish(note).unwrap();
            }
            setPublishDialogOpen(false);
            notifyOk('Landing page published.');
        } catch (err) {
            notifyError(err, 'Failed to publish.');
        }
    };

    const handleRestoreSnapshot = async (snapshotId) => {
        try {
            if (isPlatform) {
                await platformRestore({ snapshotId, scope: platformScope }).unwrap();
            } else {
                await tenantRestore(snapshotId).unwrap();
            }
            notifyOk('Snapshot restored to draft.');
        } catch (err) {
            notifyError(err, 'Failed to restore snapshot.');
        }
    };

    const refetch = () => {
        if (isPlatform) {
            platformSummaryQ.refetch();
            platformHistoryQ.refetch();
        } else {
            tenantSummaryQ.refetch();
            tenantHistoryQ.refetch();
        }
    };

    return {
        mode,
        scope: platformScope,
        permissions: { canView, canEdit, hasFullAccess },
        loading,
        error,
        summary,
        // ``draft`` is the editing surface — falls back to LIVE so the
        // editor renders coherent content even before the user has
        // saved their first draft.
        draft: mergedDraft,
        // ``draftExists`` reflects ONLY the DB-level DRAFT row (from
        // summary), used for the Draft status chip so it goes outlined
        // immediately after a promote and lit after a save.
        draftExists: !!summary?.draft,
        preview,
        live,
        history,
        hasChanges,
        hasPendingPublish,
        activeTab, setActiveTab,
        snack, setSnack,
        publishDialogOpen, setPublishDialogOpen,
        isSaving,
        actions: {
            patchHero, resetPatch,
            handleSave, handlePromote, handlePublish, handleRestoreSnapshot,
            refetch,
        },
    };
};

export default useLandingConfigEditor;
