/**
 * useSubscriptionHub — config + logic for the Subscription hub, mirroring
 * useApprovalsHub / usePageControls. The hub is a Page-Controls-style
 * drill-down: sections (organised by the three subscription product axes) →
 * module cards → each card routes to its existing management page.
 *
 * The three sections map onto the three distinct subscription systems:
 *   * ``saas``        — Plan / TenantSubscription. The platform-owner-authored
 *                       SaaS tiers a tenant subscribes to for its own subdomain
 *                       (the tenant's own "My Subscription", plus the platform
 *                       catalog: Plans + Add-ons).
 *   * ``marketplace`` — MembershipPlan / MembershipSubscription. "Who pays
 *                       us": the tenant's PUBLIC catalog, browsable at /join,
 *                       that doctors / clinics / hospitals buy to join that
 *                       tenant's network. Tenant-isolated (every tenant
 *                       publishes its own), not apex-only.
 *   * ``provider``    — TenantProviderPlan / TenantProviderSubscription. "Who
 *                       we pay": also tenant-isolated, but never public — an
 *                       admin assigns one to a specific provider
 *                       (Provider Plans + Provider Subscriptions).
 *
 * Cards carry a ``gate`` that decides visibility, so a plain tenant admin sees
 * only their own items while the platform owner additionally sees the
 * cross-tenant catalog cards. Pages are NOT moved — each card just navigates
 * to the route that already renders that page.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import StorefrontIcon from '@mui/icons-material/Storefront';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import usePermissions from '../../../../common/hooks/usePermissions';

// Re-export the Page-Controls button styles so the hub looks identical.
export { moduleButtonStyle, disabledButtonStyle } from '../../PageControls/hooks/usePageControls';

export const SUBSCRIPTION_CONFIG = {
    saas: {
        label: 'SaaS Subscription',
        description: 'The platform plan a tenant subscribes to for its own subdomain',
        icon: WorkspacePremiumIcon,
        color: '#2196F3',
        modules: {
            my_tenant: {
                title: 'My Tenant',
                cards: [
                    { label: 'My Subscription', route: '/dashboard/admin/subscription/my', gate: 'tenant' },
                ],
            },
            catalog: {
                title: 'Platform Catalog',
                cards: [
                    { label: 'Plans', route: '/dashboard/platform/plans', gate: 'platform' },
                    { label: 'Add-ons', route: '/dashboard/platform/addons', gate: 'platform' },
                    // The roster: every tenant grouped by plan type, with a
                    // change-plan action. Complements the per-tenant view
                    // reachable from the Tenants list.
                    { label: 'SaaS Subscriptions', route: '/dashboard/platform/subscriptions', gate: 'platform' },
                ],
            },
        },
    },
    marketplace: {
        label: 'Marketplace Membership',
        description: 'Your public tiers providers buy to join your network',
        icon: StorefrontIcon,
        color: '#9C27B0',
        modules: {
            catalog: {
                title: 'Membership Catalog',
                cards: [
                    { label: 'Membership Plans', route: '/dashboard/admin/membership-plans', gate: 'membership' },
                    // Each plan's credit grant + per-offering redemption caps —
                    // edited live (no plan re-version / renewal).
                    { label: 'Health Credits', route: '/dashboard/admin/membership-credits', gate: 'membership' },
                    // Each plan's platform charges (c1/c2/c3) + per-charge tax —
                    // edited live, effective on the next payout.
                    { label: 'Charges & Taxes', route: '/dashboard/admin/membership-charges', gate: 'membership' },
                    // Patient Family quotas (minors / linked adults / roles) are
                    // now configured ON each receiver plan in the plan editor
                    // (members never buy their own plan), not a separate page.
                    // Who currently holds one of those tiers, and the action
                    // to move them onto a different one.
                    { label: 'Membership Subscriptions', route: '/dashboard/admin/membership-subscriptions', gate: 'membership' },
                ],
            },
        },
    },
    provider: {
        // "Provider Plans", not "In-Tenant Provider" — both this and the
        // marketplace catalog are tenant-isolated, so "in-tenant" never
        // distinguished the two. What actually separates them is who pays
        // and who picks: membership is published for anyone to buy, a
        // provider plan is assigned by an admin to a specific provider.
        label: 'Employee / Consultant Plans',
        description: 'Plans an admin assigns to a specific doctor, clinic or hospital',
        icon: CardMembershipIcon,
        color: '#4CAF50',
        modules: {
            manage: {
                title: 'Employee / Consultant Plans & Subscriptions',
                cards: [
                    { label: 'Employee / Consultant Plans', route: '/dashboard/admin/provider-plans', gate: 'provider' },
                    { label: 'Employee / Consultant Subscriptions', route: '/dashboard/admin/provider-subscriptions', gate: 'provider' },
                ],
            },
        },
    },
};

const useSubscriptionHub = () => {
    const navigate = useNavigate();
    const { hasFullAccess, isPlatformOwner, hasFeature } = usePermissions();
    const [selectedSection, setSelectedSection] = useState(null);

    // Per-card visibility. Mirrors the gates the individual sidebar entries
    // used before consolidation:
    //   * ``platform`` — cross-tenant catalog pages under /dashboard/platform,
    //     reachable only by the platform owner.
    //   * ``provider`` — in-tenant provider plans, gated on the tenant holding
    //     at least one per-vertical plan-authoring add-on.
    //   * ``tenant``   — the tenant's own subscription, any full-access admin.
    const cardVisible = (card) => {
        switch (card.gate) {
            case 'platform':
                return isPlatformOwner;
            case 'provider':
                return hasFullAccess && (
                    hasFeature('tenant.can_create_doctor_plans')
                    || hasFeature('tenant.can_create_clinic_plans')
                    || hasFeature('tenant.can_create_hospital_plans')
                );
            case 'membership':
                // Marketplace membership authoring — per-vertical, mirroring
                // ``provider``. The platform owner passes via ``hasFeature``
                // (short-circuits true) so it always shows on the apex.
                return hasFullAccess && (
                    hasFeature('tenant.can_create_membership_doctor_plans')
                    || hasFeature('tenant.can_create_membership_clinic_plans')
                    || hasFeature('tenant.can_create_membership_hospital_plans')
                );
            case 'tenant':
            default:
                return hasFullAccess;
        }
    };

    // The config filtered down to what this admin may see. Empty modules /
    // sections are dropped so the hub never renders a bare card-less section.
    const visibleConfig = (() => {
        const out = {};
        Object.entries(SUBSCRIPTION_CONFIG).forEach(([sectionKey, section]) => {
            const modules = {};
            Object.entries(section.modules).forEach(([moduleKey, module]) => {
                const cards = module.cards.filter(cardVisible);
                if (cards.length) modules[moduleKey] = { ...module, cards };
            });
            if (Object.keys(modules).length) out[sectionKey] = { ...section, modules };
        });
        return out;
    })();

    const hasViewAccess = hasFullAccess || Object.keys(visibleConfig).length > 0;

    const goTo = (card) => {
        if (card.disabled) return;
        if (card.route) navigate(card.route);
    };

    const handleBack = () => {
        if (selectedSection) setSelectedSection(null);
        else navigate('/dashboard/admin');
    };

    return { hasViewAccess, visibleConfig, selectedSection, setSelectedSection, goTo, handleBack };
};

export default useSubscriptionHub;
