/**
 * useApprovalsHub — config + logic for the Approvals hub, mirroring
 * usePageControls. The hub is a Page-Controls-style drill-down: sections
 * (Admin / Service Provider / Service Receiver) → module cards → each card
 * opens its approval queue (Pending/Approved/Rejected/All).
 *
 * Each card carries an `rbacModule` (an `approve_*` PermissionModule). Cards a
 * sub-admin lacks are hidden, so they only see the approval types assigned to
 * them; a full-access admin sees everything. Cards route either to the new
 * field-approval reviewer queue (`moduleKey`) or to an existing approval page
 * (`route`) during consolidation.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import PersonIcon from '@mui/icons-material/Person';
import usePermissions from '../../../../common/hooks/usePermissions';

// Re-export the Page-Controls button styles so the hub looks identical.
export { moduleButtonStyle, disabledButtonStyle } from '../../PageControls/hooks/usePageControls';

export const APPROVALS_CONFIG = {
    service_provider: {
        label: 'Service Provider',
        description: 'Approvals for doctors, clinics and hospitals',
        icon: LocalHospitalIcon,
        color: '#2196F3',
        modules: {
            auto_approval: {
                title: 'Auto-Approval Settings',
                cards: [{ label: 'Approval Matrix (auto vs manual)', rbacModule: 'approve_profile', route: '/dashboard/admin/approvals/matrix' }],
            },
            registration: {
                title: 'Registration',
                cards: [{ label: 'Doctor / Facility Registration', rbacModule: 'approve_registration', route: '/dashboard/admin/doctors' }],
            },
            appointment: {
                title: 'Appointment (slots / price / gaps)',
                cards: [
                    { label: 'Slot & Price Approvals', rbacModule: 'approve_appointment', route: '/dashboard/admin/availability-approvals' },
                    { label: 'Slot Visibility / Gaps', rbacModule: 'approve_appointment', route: '/dashboard/admin/pending-approvals' },
                ],
            },
            profile: {
                title: 'Profile Setting',
                cards: [{ label: 'Profile Field Changes', rbacModule: 'approve_profile', moduleKey: 'profile' }],
            },
            working_days: {
                title: 'Working Days',
                cards: [{ label: 'Working Hours / Schedule', rbacModule: 'approve_working_days', route: '/dashboard/admin/availability-approvals' }],
            },
            education: {
                title: 'Education',
                cards: [{ label: 'Education Field Changes', rbacModule: 'approve_education', moduleKey: 'education' }],
            },
            bank: {
                title: 'Bank Details',
                cards: [{ label: 'Bank Detail Changes', rbacModule: 'approve_bank', moduleKey: 'bank' }],
            },
            bank_account: {
                title: 'Bank Account Approvals',
                cards: [{ label: 'Bank Account Verification', rbacModule: 'approve_bank_account', route: '/dashboard/admin/doctors' }],
            },
            payout: {
                title: 'Payout Settlement',
                cards: [{ label: 'Payout / Salary Settlement', rbacModule: 'approve_payout', route: '/dashboard/admin/payout-management' }],
            },
            other: {
                title: 'Other Approvals',
                cards: [
                    { label: 'Service Interests (assign plans)', rbacModule: 'approval_requests', route: '/dashboard/admin/service-interests' },
                    { label: 'Prescription Approvals', rbacModule: 'approval_requests', route: '/dashboard/admin/prescription-approvals' },
                    { label: 'Document Approvals', rbacModule: 'approval_requests', route: '/dashboard/admin/document-approvals' },
                    { label: 'Group Offering Approvals', rbacModule: 'approval_requests', route: '/dashboard/admin/service-group-approvals' },
                    { label: 'Service / Product Approvals', rbacModule: 'approval_requests', route: '/dashboard/admin/service-product-approvals' },
                ],
            },
        },
    },
    admin: {
        label: 'Admin',
        description: 'Approvals for system administrators',
        icon: AdminPanelSettingsIcon,
        color: '#FF9800',
        modules: {
            profile: {
                title: 'Profile Setting',
                cards: [{ label: 'Admin Profile Field Changes', rbacModule: 'approve_profile', moduleKey: 'profile', entityType: 'admin' }],
            },
        },
    },
    service_receiver: {
        label: 'Service Receiver',
        description: 'Approvals for patients',
        icon: PersonIcon,
        color: '#4CAF50',
        modules: {
            profile: {
                title: 'Profile Setting',
                cards: [{ label: 'Patient Profile Approvals', rbacModule: 'approve_profile', disabled: true, comingSoon: true }],
            },
        },
    },
};

const useApprovalsHub = () => {
    const navigate = useNavigate();
    const { hasFullAccess, can } = usePermissions();
    const [selectedSection, setSelectedSection] = useState(null);

    const cardVisible = (card) =>
        card.comingSoon || hasFullAccess || can(card.rbacModule, 'view') || can('approval_requests', 'view');

    // The config filtered down to what this admin may see (a sub-admin only sees
    // the approval types assigned to them; a full-access admin sees all).
    const visibleConfig = useMemo(() => {
        const out = {};
        Object.entries(APPROVALS_CONFIG).forEach(([sectionKey, section]) => {
            const modules = {};
            Object.entries(section.modules).forEach(([moduleKey, module]) => {
                const cards = module.cards.filter(cardVisible);
                if (cards.length) modules[moduleKey] = { ...module, cards };
            });
            if (Object.keys(modules).length) out[sectionKey] = { ...section, modules };
        });
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasFullAccess]);

    const hasViewAccess = hasFullAccess || Object.keys(visibleConfig).length > 0;

    const goTo = (card) => {
        if (card.disabled) return;
        if (card.moduleKey) {
            const q = card.entityType ? `?entity=${card.entityType}` : '';
            navigate(`/dashboard/admin/approvals/module/${card.moduleKey}${q}`);
        } else if (card.route) {
            navigate(card.route);
        }
    };

    const handleBack = () => {
        if (selectedSection) setSelectedSection(null);
        else navigate('/dashboard/admin');
    };

    return { hasFullAccess, hasViewAccess, visibleConfig, selectedSection, setSelectedSection, goTo, handleBack };
};

export default useApprovalsHub;
