/**
 * useOperations — hub state + navigation for the super-admin Operations module.
 * Mirrors usePageControls: step-state + config-driven cards that navigate to
 * the member flow. Three levels: section (what to administer) → role (whose
 * data) → module (which operation). Service Receiver → Patient (profile +
 * booking) and Service Provider → Doctor (profile, appointments, catalog,
 * records and service chats) are wired end-to-end against the members' own
 * screens; everything else is a Coming-Soon stub.
 *
 * Two sections share those levels — Manage Entities and Manage Roles &
 * Permissions — and ``activeConfig`` is which of the two configs the current
 * section draws its cards and buttons from.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import PersonIcon from '@mui/icons-material/Person';
import usePermissions from '../../../../common/hooks/usePermissions';

// The two sections that own a role-cards → module-grid flow. Named so the step
// derivation below doesn't have to spell the keys twice.
export const ENTITIES_SECTION = 'entities';
export const RBAC_SECTION = 'rbac';

// Entry level.
//
//  * Manage Entities — act on a member's behalf through their own screens.
//  * Manage Roles & Permissions — one section, not the two dead "Manage Roles"
//    and "Manage Permissions" buttons it replaces. A role and its grants are
//    edited in a single matrix on the same screen, so splitting them into two
//    destinations only ever meant two routes to the same table. UI-only for
//    now: see ../permissions.
//  * Audit Log — every act-on-behalf write in this module already records an
//    ``operations_audit_logs`` row (backend ``record_ops_action``), but that
//    trail is write-only today: nothing reads it back, and the existing admin
//    AuditLogs page reads the RBAC ``audit_logs`` table, which is a different
//    thing. So this is the module's own missing half, not an invented feature
//    — it's dead only until the list endpoint lands.
//
// ``disabled`` is what makes a section inert, and ``openSection`` re-checks it
// rather than trusting the click handler — same belt-and-braces the module
// buttons get from SUPPORTED_OP_TYPES.
export const OPERATIONS_SECTIONS = [
    { key: ENTITIES_SECTION, label: 'Manage Entities' },
    { key: RBAC_SECTION, label: 'Manage Roles & Permissions' },
    { key: 'audit', label: 'Audit Log', disabled: true, comingSoon: true },
];

// Op-types wired end-to-end. A button whose opType is absent from this list —
// including every ``null`` one — can't navigate even if its ``disabled`` flag
// were dropped, because ``goToOp`` checks membership here. That's the second
// half of what makes the Clinic / Hospital placeholders below inert.
export const SUPPORTED_OP_TYPES = [
    'profile', 'booking', 'appointments', 'manage', 'records', 'chats',
];

// Role → the member type its operations act on.
export const ROLE_TO_MEMBER = {
    admin: 'admin',
    service_provider: 'doctor',
    service_receiver: 'patient',
};

export const OPERATIONS_CONFIG = {
    admin: {
        label: 'Admin',
        description: 'Edit administrator details on their behalf',
        icon: AdminPanelSettingsIcon,
        color: '#FF9800',
        modules: {
            management: {
                title: 'Admin Operations',
                buttons: [
                    { label: 'Admin Profile', opType: 'profile' },
                    { label: 'Permissions', opType: null, disabled: true, comingSoon: true },
                    { label: 'Status', opType: null, disabled: true, comingSoon: true },
                ],
            },
        },
    },
    service_provider: {
        label: 'Service Provider',
        description: 'Edit provider details and manage their work on their behalf',
        icon: LocalHospitalIcon,
        color: '#2196F3',
        modules: {
            doctor: {
                title: 'Doctor Operations',
                buttons: [
                    { label: 'Doctor Profile', opType: 'profile' },
                    { label: 'My Appointments / Service List', opType: 'appointments' },
                    { label: 'Manage Appointments / Services', opType: 'manage' },
                    { label: 'Prescriptions / Documents', opType: 'records' },
                    { label: 'Service Chats', opType: 'chats' },
                    // Working hours + consultation pricing are tabs of the
                    // doctor profile page, which "Doctor Profile" now opens in
                    // full — so scheduling isn't a separate destination.
                    { label: 'Verification', opType: null, disabled: true, comingSoon: true },
                ],
            },
            // Clinics and hospitals are provider ENTITIES — they sign up with
            // their own roles (UserRole.CLINIC / HOSPITAL) and own a row on
            // their own table, keyed by the User who registered them.
            //
            // Only Profile is live. It is the facility's real editable
            // surface: an EntityProfile (entity type, legal and trade name,
            // promoters, registration / CIN / GST / PAN), reached through the
            // act-on-behalf proxy against the facility's own
            // ``/api/v1/entity-profile/me``. The rest stay placeholders because
            // the facility has nothing else to act on yet — a clinic has no
            // appointment book or service catalog of its own; its DOCTORS do,
            // and those are already reachable under Doctor Operations above.
            //
            // ``memberType`` is what makes these work: the hub is keyed on
            // ROLE, but Service Provider now covers three member types, so a
            // button that means "a clinic" has to say so.
            clinic: {
                title: 'Clinic Operations',
                memberType: 'clinic',
                buttons: [
                    { label: 'Clinic Profile', opType: 'profile' },
                    { label: 'Clinic Appointments', opType: null, disabled: true, comingSoon: true },
                    { label: 'Manage Services', opType: null, disabled: true, comingSoon: true },
                    { label: 'Doctors & Staff', opType: null, disabled: true, comingSoon: true },
                    { label: 'Service Chats', opType: null, disabled: true, comingSoon: true },
                    { label: 'Verification', opType: null, disabled: true, comingSoon: true },
                ],
            },
            hospital: {
                title: 'Hospital Operations',
                memberType: 'hospital',
                buttons: [
                    { label: 'Hospital Profile', opType: 'profile' },
                    { label: 'Hospital Appointments', opType: null, disabled: true, comingSoon: true },
                    { label: 'Manage Services', opType: null, disabled: true, comingSoon: true },
                    { label: 'Departments', opType: null, disabled: true, comingSoon: true },
                    { label: 'Affiliated Doctors', opType: null, disabled: true, comingSoon: true },
                    { label: 'Verification', opType: null, disabled: true, comingSoon: true },
                ],
            },
        },
    },
    service_receiver: {
        label: 'Service Receiver',
        description: 'Edit patient details and book appointments on their behalf',
        icon: PersonIcon,
        color: '#4CAF50',
        modules: {
            patient: {
                title: 'Patient Operations',
                buttons: [
                    { label: 'Patient Profile', opType: 'profile' },
                    { label: 'Patient Booking', opType: 'booking' },
                    { label: 'Health Records', opType: null, disabled: true, comingSoon: true },
                    { label: 'Family Members', opType: null, disabled: true, comingSoon: true },
                    { label: 'Appointment History', opType: null, disabled: true, comingSoon: true },
                    { label: 'Insurance', opType: null, disabled: true, comingSoon: true },
                ],
            },
        },
    },
};

/**
 * Manage Roles & Permissions reuses the SAME two levels — user type, then the
 * entity within it — so an operator learns the hierarchy once and it holds in
 * both sections. Only the last hop differs: Manage Entities lands on a member
 * list ("which doctor?"), while this lands straight on the entity's permission
 * matrix, because a grant is defined for a ROLE, not for one person.
 *
 * Role cards are spread from OPERATIONS_CONFIG so the icon, colour and label
 * can't drift between the two sections; only the description and the modules
 * are section-specific.
 */
export const RBAC_CONFIG = {
    admin: {
        ...OPERATIONS_CONFIG.admin,
        description: 'Decide what each kind of administrator can do',
        modules: {
            entities: {
                title: 'Admin Roles & Permissions',
                buttons: [{ label: 'Admin', entity: 'admin' }],
            },
        },
    },
    service_provider: {
        ...OPERATIONS_CONFIG.service_provider,
        description: 'Decide what doctors, clinics and hospitals can do',
        modules: {
            entities: {
                title: 'Service Provider Roles & Permissions',
                buttons: [
                    { label: 'Doctor', entity: 'doctor' },
                    { label: 'Clinic', entity: 'clinic' },
                    { label: 'Hospital', entity: 'hospital' },
                ],
            },
        },
    },
    service_receiver: {
        ...OPERATIONS_CONFIG.service_receiver,
        description: 'Decide what patients and their family members can do',
        modules: {
            entities: {
                title: 'Service Receiver Roles & Permissions',
                buttons: [{ label: 'Patient', entity: 'patient' }],
            },
        },
    },
};

// Same belt-and-braces as SUPPORTED_OP_TYPES: a button can only navigate to an
// entity that actually has a permission tree behind it.
export const RBAC_ENTITIES = ['doctor', 'clinic', 'hospital', 'patient', 'admin'];

const useOperations = () => {
    const navigate = useNavigate();
    // Visible to super_admin AND platform_owner (hasFullAccess) — the platform
    // owner gets the same IT operations surface as the tenant super-admin.
    const { hasFullAccess } = usePermissions();

    const [selectedSection, setSelectedSection] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);

    // Which config the role cards and module grid are drawn from. Both
    // sections share the two levels; only their module buttons differ.
    const activeConfig = selectedSection === RBAC_SECTION
        ? RBAC_CONFIG : OPERATIONS_CONFIG;

    // ``step`` is DERIVED, never stored, so the two pieces of state can't
    // disagree about what's on screen: leaving a section can't strand a stale
    // role, and a role that isn't in the config falls back to the cards
    // instead of rendering nothing.
    let step = 'entry';
    if (selectedSection === ENTITIES_SECTION || selectedSection === RBAC_SECTION) {
        step = activeConfig[selectedRole] ? 'module' : 'role';
    }

    // Dead sections do nothing at all — no state change, so no back-stack
    // entry to unwind and no half-open screen.
    const openSection = (sectionKey) => {
        const section = OPERATIONS_SECTIONS.find((s) => s.key === sectionKey);
        if (!section || section.disabled) return;
        setSelectedRole(null);
        setSelectedSection(section.key);
    };

    // Returning to the entry level drops the role too — the role only means
    // something inside a section.
    const goToEntry = () => {
        setSelectedRole(null);
        setSelectedSection(null);
    };

    // ``memberTypeOverride`` comes from the module a button sits in. Service
    // Provider spans doctor, clinic and hospital, so the role alone no longer
    // determines the member type; ROLE_TO_MEMBER stays the default for the
    // single-type roles and for the doctor module.
    const goToOp = (opType, memberTypeOverride) => {
        const memberType = memberTypeOverride || ROLE_TO_MEMBER[selectedRole];
        if (memberType && opType && SUPPORTED_OP_TYPES.includes(opType)) {
            navigate(`/dashboard/admin/operations/${memberType}/${opType}`);
        }
    };

    // Manage Roles & Permissions' last hop: an entity's permission matrix.
    // No member id — the matrix is per role, not per person.
    const goToRbac = (entity) => {
        if (RBAC_ENTITIES.includes(entity)) {
            navigate(`/dashboard/admin/operations/roles-permissions/${entity}`);
        }
    };

    // One "up" per level, in reverse of the way in: module → role cards →
    // entry → out of the module entirely. Keyed off the derived step so it can
    // never skip a level or leave the page while a screen is still open.
    const handleBack = () => {
        if (step === 'module') setSelectedRole(null);
        else if (step === 'role') setSelectedSection(null);
        else navigate('/dashboard/admin');
    };

    return {
        // super_admin + platform_owner for now (backend RBAC is the real gate)
        hasViewAccess: hasFullAccess,
        step,
        selectedSection,
        activeConfig,
        openSection,
        goToEntry,
        selectedRole,
        setSelectedRole,
        goToOp,
        goToRbac,
        handleBack,
    };
};

export default useOperations;
