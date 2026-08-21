/**
 * usePricingAdmin — PLATFORM_OWNER hook for the plan + add-on catalog.
 *
 * Owns every bit of non-presentational state for ``PlansAdmin`` and any
 * sibling component: RTK Query subscriptions, the create-plan form, the
 * create-addon form, and tenant-subscription / tenant-addon mutations.
 * The page renders from what this hook returns — no prop drilling, no
 * local RTK imports scattered across components.
 *
 * Why a hook + shared slice instead of a dedicated pricing slice:
 *   * RTK Query cache (keyed by endpoint + args, invalidated by tags)
 *     IS the server-state store for plans/addons/subscriptions — a
 *     parallel slice would just mirror it and invite drift.
 *   * Cross-cutting UI feedback (snackbar, confirm dialog) already lives
 *     in ``features/admin/redux/adminSharedUiSlice`` — the hook dispatches
 *     into that slice so feedback surfaces uniformly with the rest of
 *     the admin console.
 *   * Form / dialog state is genuinely local (scoped to this feature and
 *     reset on unmount) — ``useState`` is the right fit; persisting it in
 *     Redux would be accidental complexity.
 */
import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useArchiveAddonMutation,
    useArchivePlanMutation,
    useAssignTenantSubscriptionMutation,
    useAttachTenantAddonMutation,
    useCreateAddonMutation,
    useCreatePlanMutation,
    useCreatePlanTypeMutation,
    useDeletePlanTypeMutation,
    useDetachTenantAddonMutation,
    useListAddonsQuery,
    useListPlansQuery,
    useListPlanTypesQuery,
    useUpdateAddonMutation,
    useUpdatePlanMutation,
    useUpdatePlanTypeMutation,
    useUpdateTenantSubscriptionMutation,
} from '../../api/pricingEndpoints';

const PLAN1_TEMPLATE_FEATURES = {
    patient: { basic_info: true, vitals: false, documents: false, family: false },
    doctor: { profile: true, calendar: true, pricing: true, prescriptions: true },
    admin: { manage_users: true, page_configuration: false },
    communication: {
        sms: { enabled: true, control: 'platform' },
        email: { enabled: true, control: 'platform' },
    },
    payments: { razorpay: { enabled: true, control: 'platform' } },
    domain: {
        subdomain: { enabled: true, configurable: true },
        custom_domain: { enabled: false, configurable: false },
    },
};


const INITIAL_PLAN_FORM = {
    code: '',
    name: '',
    description: '',
    is_default: false,
    price_inr_monthly: null,
    price_inr_annual: null,
    max_total_users: 20,
    max_super_admins: 1,
    max_sub_admins: 3,
    max_providers: 16,
    // Per-vertical provider-entity quotas. Distinct from ``max_providers``
    // (staff-seat count). -1 = unlimited, 0 = vertical disabled, int = cap.
    // Defaults to disabled — the operator opts in per plan.
    max_provider_doctors: 0,
    max_provider_clinics: 0,
    max_provider_hospitals: 0,
    trial_days: 14,
    over_limit_action: 'block_new',
    grace_period_days: 0,
    razorpay_supported: true,
    tenant_keys_allowed: false,
    // Sensible starter feature tree — operator edits via the
    // structured editor. Empty would force them to toggle every
    // basic feature on by hand for a brand-new plan.
    features: PLAN1_TEMPLATE_FEATURES,
    usage_limits: null,
    default_addons: [],   // list of addon codes auto-attached on subscribe
    // Free-text selling points, receiver (patient) plans only. Provider
    // plans describe themselves through ``features`` / ``default_addons``
    // instead, and always send this empty. See ``buildPlanPayload``.
    benefits: [],
    saas_plan_type_id: null,
};


/**
 * Receiver (patient) plans and provider plans describe what they sell in
 * mutually exclusive ways: a receiver plan carries free-text ``benefits``,
 * a provider plan carries a structured ``features`` tree plus
 * ``default_addons``. The dialog only ever shows one side, so the hidden
 * side is zeroed rather than sent stale — otherwise flipping a plan's type
 * would silently keep whatever the previous type had left behind.
 */
const buildPlanPayload = (form, isReceiver) => {
    if (isReceiver) {
        return {
            ...form,
            // Blank rows are an editing artifact, not a benefit.
            benefits: (form.benefits || [])
                .map((b) => (b || '').trim())
                .filter(Boolean),
            features: {},
            default_addons: [],
        };
    }
    return { ...form, benefits: [] };
};


const INITIAL_PLAN_TYPE_FORM = {
    code: '',
    name: '',
    description: '',
    icon_key: '',
    // Marks the type as service-RECEIVER (patient) rather than provider.
    // ``/join_receiver`` lists the flagged types; ``/pricing`` lists the
    // rest. Defaults to false so a new type is provider-facing unless the
    // operator opts in — the same default the provider catalog has always
    // had implicitly.
    is_receiver: false,
};


const INITIAL_ADDON_FORM = {
    code: '',
    name: '',
    description: '',
    price_inr_monthly: null,
    price_inr_annual: null,
    features: {},
    limits: null,
    usage_deltas: null,
    prerequisites: [],
};


export const usePricingAdmin = () => {
    const dispatch = useDispatch();

    // ── Server state (RTK Query — no slice needed) ────────────
    const plansQuery = useListPlansQuery();
    const planTypesQuery = useListPlanTypesQuery();
    const addonsQuery = useListAddonsQuery();


    const [createPlan, createPlanState] = useCreatePlanMutation();
    const [updatePlan, updatePlanState] = useUpdatePlanMutation();
    const [archivePlan] = useArchivePlanMutation();

    const [createPlanType, createPlanTypeState] = useCreatePlanTypeMutation();
    const [updatePlanType, updatePlanTypeState] = useUpdatePlanTypeMutation();
    const [deletePlanType] = useDeletePlanTypeMutation();


    const [createAddon, createAddonState] = useCreateAddonMutation();
    const [updateAddon] = useUpdateAddonMutation();
    const [archiveAddon] = useArchiveAddonMutation();

    const [assignTenantSubscription] = useAssignTenantSubscriptionMutation();
    const [updateTenantSubscription] = useUpdateTenantSubscriptionMutation();
    const [attachTenantAddon] = useAttachTenantAddonMutation();
    const [detachTenantAddon] = useDetachTenantAddonMutation();

    // ── Local, transient UI state ─────────────────────────────
    // ``editingCode`` is non-null when the dialog is open in edit
    // mode — backend update endpoints are keyed by ``code``, not id.
    const [planDialogOpen, setPlanDialogOpen] = useState(false);
    const [planForm, setPlanForm] = useState(INITIAL_PLAN_FORM);
    const [editingPlanCode, setEditingPlanCode] = useState(null);

    const [planTypeDialogOpen, setPlanTypeDialogOpen] = useState(false);
    const [planTypeForm, setPlanTypeForm] = useState(INITIAL_PLAN_TYPE_FORM);
    const [editingPlanTypeId, setEditingPlanTypeId] = useState(null);

    const [addonDialogOpen, setAddonDialogOpen] = useState(false);
    const [addonForm, setAddonForm] = useState(INITIAL_ADDON_FORM);
    const [editingAddonCode, setEditingAddonCode] = useState(null);

    // ── Derived ───────────────────────────────────────────────
    // Which half of the plan dialog applies is a property of the
    // *currently selected* plan type, not of the saved row — picking a
    // different type in the dropdown must swap the editor immediately.
    const planTypes = planTypesQuery.data || [];
    const selectedPlanType =
        planTypes.find((pt) => pt.id === planForm.saas_plan_type_id) || null;
    const isReceiverPlan = !!selectedPlanType?.is_receiver;

    // ── Handlers ──────────────────────────────────────────────
    const notify = useCallback(
        (severity, message) => {
            dispatch(setSnackbar({ open: true, severity, message }));
        },
        [dispatch],
    );

    const openPlanDialog = useCallback((existing) => {
        if (existing) {
            // Edit mode: hydrate the form from the live row. The
            // server returns ``user_limits`` nested; flatten back to
            // the four ``max_*`` fields the create payload uses.
            setEditingPlanCode(existing.code);
            setPlanForm({
                code: existing.code,
                name: existing.name || '',
                description: existing.description || '',
                status: existing.status || 'draft',
                is_default: !!existing.is_default,
                price_inr_monthly: existing.price_inr_monthly ?? null,
                og_price_inr_monthly: existing.og_price_inr_monthly ?? null,

                price_inr_quarterly: existing.price_inr_quarterly ?? null,
                og_price_inr_quarterly: existing.og_price_inr_quarterly ?? null,

                price_inr_semi_annual: existing.price_inr_semi_annual ?? null,
                og_price_inr_semi_annual: existing.og_price_inr_semi_annual ?? null,

                price_inr_annual: existing.price_inr_annual ?? null,
                og_price_inr_annual: existing.og_price_inr_annual ?? null,

                price_inr_biennial: existing.price_inr_biennial ?? null,
                og_price_inr_biennial: existing.og_price_inr_biennial ?? null,

                price_inr_triennial: existing.price_inr_triennial ?? null,
                og_price_inr_triennial: existing.og_price_inr_triennial ?? null,
                
                max_total_users: existing.user_limits?.total ?? 0,
                max_super_admins: existing.user_limits?.per_role?.super_admin ?? 0,
                max_sub_admins: existing.user_limits?.per_role?.sub_admin ?? 0,
                max_providers: existing.user_limits?.per_role?.provider ?? 0,
                // Round 5 — per-vertical provider-entity quotas.
                max_provider_doctors:
                    existing.provider_entity_limits?.doctor ?? 0,
                max_provider_clinics:
                    existing.provider_entity_limits?.clinic ?? 0,
                max_provider_hospitals:
                    existing.provider_entity_limits?.hospital ?? 0,
                trial_days: existing.trial_days ?? 0,
                over_limit_action: existing.over_limit_action || 'block_new',
                grace_period_days: existing.grace_period_days ?? 0,
                razorpay_supported: existing.razorpay_supported ?? true,
                tenant_keys_allowed: existing.tenant_keys_allowed ?? false,
                features: existing.features || {},
                usage_limits: existing.usage_limits || null,
                default_addons: existing.default_addons || [],
                // Tolerate a legacy row that predates the column, or a
                // backend that hands back null / a dict instead of a list.
                benefits: Array.isArray(existing.benefits) ? existing.benefits : [],
                saas_plan_type_id: existing.plan_type?.id ?? null,
            });
        } else {
            setEditingPlanCode(null);
            setPlanForm(INITIAL_PLAN_FORM);
        }
        setPlanDialogOpen(true);
    }, []);

    const closePlanDialog = useCallback(() => {
        setPlanDialogOpen(false);
        setEditingPlanCode(null);
    }, []);

    const handleSavePlan = useCallback(async () => {
        // Use the form's own ``features`` dict; the ``PLAN1_TEMPLATE_FEATURES``
        // hardcode was a stop-gap that ignored the structured editor.
        const payload = buildPlanPayload(planForm, isReceiverPlan);
        try {
            if (editingPlanCode) {
                await updatePlan({
                    code: editingPlanCode,
                    data: payload,
                }).unwrap();
                notify('success', `Plan "${editingPlanCode}" updated`);
            } else {
                await createPlan({
                    ...payload,
                    status: 'draft',
                }).unwrap();
                notify('success', `Plan "${planForm.code}" created`);
            }
            setPlanDialogOpen(false);
            setEditingPlanCode(null);
        } catch (err) {
            const msg =
                err?.data?.errors
                    ? Object.entries(err.data.errors)
                          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                          .join('; ')
                    : err?.data?.error || 'Save failed';
            notify('error', msg);
        }
    }, [createPlan, updatePlan, planForm, editingPlanCode, isReceiverPlan, notify]);

    // Back-compat alias — older callers used ``handleCreatePlan``.
    const handleCreatePlan = handleSavePlan;

    const handleUpdatePlan = useCallback(
        async (code, patch) => {
            try {
                await updatePlan({ code, data: patch }).unwrap();
                notify('success', `Plan "${code}" updated`);
            } catch (err) {
                notify('error', err?.data?.error || 'Update failed');
            }
        },
        [updatePlan, notify],
    );

    const handleArchivePlan = useCallback(
        async (code) => {
            try {
                await archivePlan(code).unwrap();
                notify('success', `Plan "${code}" archived`);
            } catch (err) {
                notify('error', err?.data?.error || 'Archive failed');
            }
        },
        [archivePlan, notify],
    );

    // Plan type handlers
    const openPlanTypeDialog = useCallback((existing) => {
        if (existing) {
            setEditingPlanTypeId(existing.id);
            setPlanTypeForm({
                code: existing.code || '',
                name: existing.name || '',
                description: existing.description || '',
                icon_key: existing.icon_key || '',
                is_receiver: !!existing.is_receiver,
            });
        } else {
            setEditingPlanTypeId(null);
            setPlanTypeForm(INITIAL_PLAN_TYPE_FORM);
        }
        setPlanTypeDialogOpen(true);
    }, []);

    const closePlanTypeDialog = useCallback(() => {
        setPlanTypeDialogOpen(false);
        setEditingPlanTypeId(null);
    }, []);

    const handleSavePlanType = useCallback(async () => {
        try {
            if (editingPlanTypeId) {
                await updatePlanType({
                    id: editingPlanTypeId,
                    data: planTypeForm,
                }).unwrap();
                notify('success', `Plan type "${planTypeForm.code}" updated`);
            } else {
                await createPlanType(planTypeForm).unwrap();
                notify('success', `Plan type "${planTypeForm.code}" created`);
            }
            setPlanTypeDialogOpen(false);
            setEditingPlanTypeId(null);
        } catch (err) {
            // create/update return a flat {error} on 409 (duplicate code),
            // not the {errors: {...}} shape the plan/addon 422s use.
            notify('error', err?.data?.error || 'Save failed');
        }
    }, [createPlanType, updatePlanType, planTypeForm, editingPlanTypeId, notify]);

    const handleDeletePlanType = useCallback(
        async (id, code) => {
            try {
                await deletePlanType(id).unwrap();
                notify('success', `Plan type "${code}" deleted`);
            } catch (err) {
                // 409 when a live plan still references this plan type.
                notify('error', err?.data?.error || 'Delete failed');
            }
        },
        [deletePlanType, notify],
    );

    // ── Add-on handlers ───────────────────────────────────────
    const openAddonDialog = useCallback((existing) => {
        if (existing) {
            setEditingAddonCode(existing.code);
            setAddonForm({
                code: existing.code,
                name: existing.name || '',
                description: existing.description || '',
                status: existing.status || 'draft',
                price_inr_monthly: existing.price_inr_monthly ?? null,
                price_inr_annual: existing.price_inr_annual ?? null,
                features: existing.features || {},
                limits: existing.limits || null,
                usage_deltas: existing.usage_deltas || null,
                prerequisites: existing.prerequisites || [],
            });
        } else {
            setEditingAddonCode(null);
            setAddonForm(INITIAL_ADDON_FORM);
        }
        setAddonDialogOpen(true);
    }, []);

    const closeAddonDialog = useCallback(() => {
        setAddonDialogOpen(false);
        setEditingAddonCode(null);
    }, []);

    const handleSaveAddon = useCallback(async () => {
        try {
            if (editingAddonCode) {
                await updateAddon({
                    code: editingAddonCode,
                    data: addonForm,
                }).unwrap();
                notify('success', `Add-on "${editingAddonCode}" updated`);
            } else {
                await createAddon({ ...addonForm, status: 'draft' }).unwrap();
                notify('success', `Add-on "${addonForm.code}" created`);
            }
            setAddonDialogOpen(false);
            setEditingAddonCode(null);
        } catch (err) {
            const msg =
                err?.data?.errors
                    ? Object.entries(err.data.errors)
                          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                          .join('; ')
                    : err?.data?.error || 'Save failed';
            notify('error', msg);
        }
    }, [createAddon, updateAddon, addonForm, editingAddonCode, notify]);

    // Back-compat alias.
    const handleCreateAddon = handleSaveAddon;

    const handleArchiveAddon = useCallback(
        async (code) => {
            try {
                await archiveAddon(code).unwrap();
                notify('success', `Add-on "${code}" archived`);
            } catch (err) {
                notify('error', err?.data?.error || 'Archive failed');
            }
        },
        [archiveAddon, notify],
    );

    const handleUpdateAddon = useCallback(
        async (code, patch) => {
            try {
                await updateAddon({ code, data: patch }).unwrap();
                notify('success', `Add-on "${code}" updated`);
            } catch (err) {
                notify('error', err?.data?.error || 'Update failed');
            }
        },
        [updateAddon, notify],
    );

    // ── Tenant-level handlers (wired by consumers as needed) ──
    const handleAssignPlan = useCallback(
        async (tenantId, data) => {
            try {
                await assignTenantSubscription({ tenantId, data }).unwrap();
                notify('success', 'Subscription assigned');
            } catch (err) {
                notify('error', err?.data?.error || 'Assign failed');
            }
        },
        [assignTenantSubscription, notify],
    );

    const handleAttachAddon = useCallback(
        async (tenantId, addonCode, billingCycle = 'monthly') => {
            try {
                await attachTenantAddon({
                    tenantId,
                    data: { addon_code: addonCode, billing_cycle: billingCycle },
                }).unwrap();
                notify('success', `Attached "${addonCode}"`);
            } catch (err) {
                notify('error', err?.data?.error || 'Attach failed');
            }
        },
        [attachTenantAddon, notify],
    );

    const handleDetachAddon = useCallback(
        async (tenantId, addonCode) => {
            try {
                await detachTenantAddon({ tenantId, code: addonCode }).unwrap();
                notify('success', `Detached "${addonCode}"`);
            } catch (err) {
                notify('error', err?.data?.error || 'Detach failed');
            }
        },
        [detachTenantAddon, notify],
    );

    return {
        // Server state
        plans: plansQuery.data || [],
        plansLoading: plansQuery.isLoading,
        plansError: plansQuery.error,
        planTypes,
        planTypesLoading: planTypesQuery.isLoading,
        planTypesError: planTypesQuery.error,
        addons: addonsQuery.data || [],
        addonsLoading: addonsQuery.isLoading,

        // Plan dialog
        planDialogOpen,
        planForm,
        setPlanForm,
        openPlanDialog,
        closePlanDialog,
        editingPlanCode,
        // True when the picked plan type is service-receiver (patient) —
        // the dialog swaps add-ons + features for the benefits list.
        isReceiverPlan,
        isCreatingPlan: createPlanState.isLoading,
        isUpdatingPlan: updatePlanState.isLoading,
        isSavingPlan: createPlanState.isLoading || updatePlanState.isLoading,

        // Plan Type dialog
        planTypeDialogOpen,
        planTypeForm,
        setPlanTypeForm,
        openPlanTypeDialog,
        closePlanTypeDialog,
        editingPlanTypeId,
        isSavingPlanType: createPlanTypeState.isLoading || updatePlanTypeState.isLoading,

        // Add-on dialog
        addonDialogOpen,
        addonForm,
        setAddonForm,
        openAddonDialog,
        closeAddonDialog,
        editingAddonCode,
        isCreatingAddon: createAddonState.isLoading,

        // Plan actions
        handleCreatePlan,
        handleSavePlan,
        handleUpdatePlan,
        handleArchivePlan,

        //Plan Type actions
        handleSavePlanType,
        handleDeletePlanType,

        // Add-on actions
        handleCreateAddon,
        handleSaveAddon,
        handleUpdateAddon,
        handleArchiveAddon,

        // Tenant-level actions
        handleAssignPlan,
        updateTenantSubscription,
        handleAttachAddon,
        handleDetachAddon,
    };
};

export default usePricingAdmin;
