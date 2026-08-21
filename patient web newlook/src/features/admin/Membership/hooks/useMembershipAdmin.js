/**
 * useMembershipAdmin — PLATFORM_OWNER hook for the marketplace
 * ``MembershipPlan`` catalog (apex larazen.in product line).
 *
 * Mirrors the shape of ``usePricingAdmin`` (SaaS plans) but trimmed to
 * what Round 1 needs:
 *   * list / create / update / archive plans,
 *   * status chip click-to-flip (Draft ↔ Active),
 *   * shared snackbar feedback.
 *
 * Round 2 will extend this with ``MembershipSubscription`` writes once
 * the marketplace signup flow is wired.
 */
import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useArchiveMembershipPlanMutation,
    useCreateMembershipPlanMutation,
    useListMembershipPlansQuery,
    useUpdateMembershipPlanMutation,
} from '../../api/membershipEndpoints';
import { tokeniseBullets } from '../utils/fixedFeatures';


const INITIAL_PLAN_FORM = {
    code: '',
    name: '',
    description: '',
    // FK to the vertical-plan-type row. There's no ``vertical`` column any
    // more — the name / description / icon / is_receiver all live on that row,
    // and a plan just points at it. Blank rather than a default vertical: the
    // picker is populated from those rows, so any hardcoded default would be a
    // code the operator might never have created. Empty makes the
    // required-field check ask for a real pick.
    vertical_plan_type_id: '',
    tier: 'basic',

    price_inr_monthly: null,
    og_price_inr_monthly: null,

    price_inr_quarterly: null,
    og_price_inr_quarterly: null,

    price_inr_semi_annual: null,
    og_price_inr_semi_annual: null,

    price_inr_annual: null,
    og_price_inr_annual: null,

    price_inr_biennial: null,
    og_price_inr_biennial: null,

    price_inr_triennial: null,
    og_price_inr_triennial: null,

    trial_days: 14,
    // T-day payout hold on this plan's doctors' earnings — null means
    // "this plan doesn't set a hold" (falls back to the tenant default),
    // mirroring TenantProviderPlan's payout_hold_days. Unlike trial_days
    // there's no sensible non-null default here.
    payout_hold_days: null,

    // Flat % every holder of this tier gets off the patient-facing price of
    // any offering — quoted on the plan card, badged on the doctor / service
    // tiles, and subtracted in the booking summary. 0 = tier grants none.
    member_discount_pct: 0,

    // Health credits (grant + per-offering caps) are no longer part of the plan
    // form — they live in their own ``CreditPolicy`` and are edited on the
    // Health Credits admin page.

    // The three platform charges, moved here from the tenant-wide Billing
    // Config. Each is a percentage of the payment or a fixed ₹ amount and
    // is deducted from a subscribed provider's appointment earnings. A
    // doctor with no active plan gets zero charges (enforced backend-side).
    charge1_name: 'Platform Fee',
    charge1_type: 'percentage',
    charge1_value: '0',
    charge2_name: 'Service Fee',
    charge2_type: 'percentage',
    charge2_value: '0',
    charge3_name: 'Processing Fee',
    charge3_type: 'percentage',
    charge3_value: '0',

    // Capacity caps — how many support staff and My Link affiliations a member
    // on this tier may hold. ``null`` is unlimited, which is what a new plan
    // starts as: a cap has to be a decision somebody made, not something a
    // blank form quietly imposed.
    max_support_staff: null,
    max_link_connections: null,

    status: 'draft',
    is_featured: false,
    publish_on_landing: false,
    // Marks the plan as a legacy tier — kept for existing subscribers but
    // no longer actively sold. Toggled from the edit dialog; sent back
    // through ``buildMembershipPayload`` (which spreads the whole form).
    is_legacy: false,

    // Round 1 stores the marketing bullets here as a free-form dict.
    // Keys are display labels; values are booleans (true = "included
    // in this tier"). Operator can also nest sub-objects later without
    // a schema change.
    features: {},

    // Free-text selling points, receiver (patient) verticals only — the plan
    // card at /join_receiver renders these verbatim. Provider verticals sell
    // through ``features.bullets`` instead and always send this empty; see
    // ``buildMembershipPayload`` in the page.
    benefits: [],

    // Patient Family quotas — RECEIVER (patient) verticals only. A minor /
    // linked member never buys their own plan, so how many an owner may create
    // is a property of the owner's plan. Sent through ``buildMembershipPayload``
    // and persisted by the plan create/update route into PatientFamilyPolicy.
    // -1 = unlimited, 0 = none.
    max_minor_subaccounts: 0,
    max_family_links: 0,
    max_patient_roles: 0,

    sort_order: 10,
};

export const useMembershipAdmin = () => {
    const dispatch = useDispatch();

    const plansQuery = useListMembershipPlansQuery();
    const [createPlan, createPlanState] = useCreateMembershipPlanMutation();
    const [updatePlan, updatePlanState] = useUpdateMembershipPlanMutation();
    const [archivePlan] = useArchiveMembershipPlanMutation();

    const [planDialogOpen, setPlanDialogOpen] = useState(false);
    const [planForm, setPlanForm] = useState(INITIAL_PLAN_FORM);
    // Editing key is the plan's stable ``code`` — backend routes hang
    // off /membership-plans/<code>, not the UUID id.
    const [editingPlanCode, setEditingPlanCode] = useState(null);

    const notify = useCallback(
        (severity, message) => {
            dispatch(setSnackbar({ open: true, severity, message }));
        },
        [dispatch],
    );

    const openPlanDialog = useCallback((existing) => {
        if (existing) {
            // Edit mode: hydrate every field, including ``status`` so
            // the Status select in the dialog shows the current value
            // (mirrors the SaaS Plan hydration fix that shipped earlier
            // today).
            setEditingPlanCode(existing.code);
            setPlanForm({
                code: existing.code,
                name: existing.name || '',
                description: existing.description || '',
                // Read off the nested row: the serialiser returns the whole
                // ``vertical_plan_type`` object and no flat id, but the write
                // side takes ``vertical_plan_type_id``. Read and write shapes
                // differ here, so this can't just round-trip the field name.
                vertical_plan_type_id: existing.vertical_plan_type?.id ?? '',
                tier: existing.tier || 'basic',

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

                trial_days: existing.trial_days ?? 0,
                payout_hold_days: existing.payout_hold_days ?? null,

                charge1_name: existing.charge1_name ?? 'Platform Fee',
                charge1_type: existing.charge1_type ?? 'percentage',
                charge1_value: existing.charge1_value ?? '0',
                charge2_name: existing.charge2_name ?? 'Service Fee',
                charge2_type: existing.charge2_type ?? 'percentage',
                charge2_value: existing.charge2_value ?? '0',
                charge3_name: existing.charge3_name ?? 'Processing Fee',
                charge3_type: existing.charge3_type ?? 'percentage',
                charge3_value: existing.charge3_value ?? '0',

                // Read off the nested ``limits`` object the serialiser returns;
                // the write side takes the two flat column names. ``??`` not
                // ``||`` — a cap of 0 is a real setting ("this tier grants
                // none") and must not hydrate as unlimited.
                max_support_staff: existing.limits?.support_staff ?? null,
                max_link_connections: existing.limits?.my_links ?? null,

                status: existing.status || 'draft',
                is_featured: !!existing.is_featured,
                is_legacy: !!existing.is_legacy,
                publish_on_landing: !!existing.publish_on_landing,
                // Re-attach the {token} to baked special rows so the editor
                // shows their fixed-number prefix; plain bullets pass through.
                features: {
                    ...(existing.features || {}),
                    bullets: tokeniseBullets(existing, existing.features?.bullets),
                },
                benefits: Array.isArray(existing.benefits) ? existing.benefits : [],
                sort_order: existing.sort_order ?? 0,
                member_discount_pct: existing.member_discount_pct ?? 0,
                // Receiver-plan family quotas, read off the row the list endpoint
                // now attaches (null for provider plans → defaults to 0).
                max_minor_subaccounts: existing.family_policy?.max_minor_subaccounts ?? 0,
                max_family_links: existing.family_policy?.max_family_links ?? 0,
                max_patient_roles: existing.family_policy?.max_patient_roles ?? 0,
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

    const handleSavePlan = useCallback(async (override) => {
        // The page component may pass a fresh payload (e.g. with the
        // bullets textarea folded in) to bypass the
        // setPlanForm-is-async race. Falls back to the form state for
        // callers that don't need that — keeps the API backward
        // compatible.
        const payload = override && typeof override === 'object'
            ? override
            : planForm;
        try {
            if (editingPlanCode) {
                await updatePlan({
                    code: editingPlanCode,
                    data: payload,
                }).unwrap();
                notify('success', `Membership plan "${editingPlanCode}" updated`);
            } else {
                // Creates always start as 'draft' server-side regardless
                // of what the form holds; the user flips status via the
                // Edit dialog or row chip after creation. Matches the
                // SaaS Plans convention.
                await createPlan({
                    ...payload,
                    status: 'draft',
                }).unwrap();
                notify('success', `Membership plan "${payload.code}" created`);
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
    }, [createPlan, updatePlan, planForm, editingPlanCode, notify]);

    const handleUpdatePlan = useCallback(
        async (code, patch) => {
            // Generic partial-update helper. The row's clickable status
            // chip calls this with ``{ status: 'active' }`` to flip
            // Draft ↔ Active in one click — same UX as SaaS Plans got
            // earlier today.
            try {
                await updatePlan({ code, data: patch }).unwrap();
                notify('success', `Membership plan "${code}" updated`);
            } catch (err) {
                notify('error', err?.data?.error || 'Update failed');
            }
        },
        [updatePlan, notify],
    );

    const handleArchivePlan = useCallback(
        async (code) => {
            try {
                const res = await archivePlan(code).unwrap();
                // Surface the backend's outcome: a plan with members is
                // grandfathered ("closed to new subscribers, N members keep
                // it"); an empty one is removed.
                notify('success', res?.message || `Membership plan "${code}" archived`);
            } catch (err) {
                notify('error', err?.data?.error || 'Archive failed');
            }
        },
        [archivePlan, notify],
    );

    return {
        // Server state
        plans: plansQuery.data || [],
        plansLoading: plansQuery.isLoading,
        plansError: plansQuery.error,

        // Dialog state
        planDialogOpen,
        planForm,
        setPlanForm,
        openPlanDialog,
        closePlanDialog,
        editingPlanCode,
        isCreatingPlan: createPlanState.isLoading,
        isUpdatingPlan: updatePlanState.isLoading,
        isSavingPlan: createPlanState.isLoading || updatePlanState.isLoading,

        // Actions
        handleSavePlan,
        handleUpdatePlan,
        handleArchivePlan,
    };
};

export default useMembershipAdmin;
