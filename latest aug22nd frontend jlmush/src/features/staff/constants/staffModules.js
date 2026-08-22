/**
 * Which catalog modules have a real screen behind them, and where it lives in
 * the staff portal.
 *
 * **All three trees are mapped.** Every leaf either opens a screen here or is
 * recorded in ``UNBUILT_MODULES`` as having no screen anywhere — including for
 * the practice itself — with one deliberate exception noted there: service
 * chats are withheld from staff on purpose, not for want of wiring.
 *
 * **The screens are the practice's own, not copies.** ``/dashboard/staff/doctors``
 * mounts the very same ``ManageDoctors`` a clinic admin sees. That is only safe
 * because the backend resolves the practice from the *principal* rather than
 * from the signed-in user (``app.common.provider_access``), so the same
 * component asking the same endpoint gets that staff member's employer. A
 * forked "staff version" of each screen would drift within a release.
 *
 * The exception is where the practice's screen is not really about the module.
 * A facility's Entity Details lives inside the doctor profile page, which
 * fetches a doctor id and a doctor's analytics config; mounting that for a
 * receptionist would ask the server for a doctor who does not exist. There, the
 * section is mounted directly instead — same component, without the page that
 * happens to host it.
 *
 * ``modules`` lists the leaves that open a route: holding ANY of them is
 * enough, because one screen often covers several. Manage Doctors is one page
 * with a roster tab and an invite button, so a grant on either leaf has to open
 * it — the finer distinction is enforced per-action on the endpoints, which is
 * where it can actually be enforced.
 */

/** Screens that exist today, in sidebar order. */
export const STAFF_MODULE_ROUTES = [
    // ── Clinic / hospital ────────────────────────────────────────────────
    {
        key: 'doctors',
        path: 'doctors',
        label: 'Manage Doctors',
        verticals: ['clinic', 'hospital'],
        modules: [
            'doctors_network.manage_doctors.roster',
            'doctors_network.manage_doctors.invitations',
            'doctors_network.manage_doctors.affiliation_requests',
        ],
    },
    {
        key: 'network-requests',
        path: 'network-requests',
        label: 'Network Requests',
        verticals: ['clinic', 'hospital'],
        modules: ['doctors_network.network_requests'],
    },
    {
        key: 'practice',
        path: 'practice',
        label: 'Practice Profile',
        verticals: ['clinic', 'hospital'],
        modules: [
            'entity_profile.entity_details.entity_type_name',
            'entity_profile.entity_details.registration_licence',
            'entity_profile.entity_details.tax_identifiers',
            'entity_profile.entity_details.promoters',
            'entity_profile.account_status',
        ],
    },
    {
        key: 'billing',
        path: 'billing',
        label: 'Billing',
        verticals: ['clinic', 'hospital'],
        modules: [
            'billing.membership',
            'billing.bills.invoices',
            'billing.bills.payments',
        ],
    },
    {
        key: 'team',
        path: 'team',
        label: 'Staff Directory',
        verticals: ['clinic', 'hospital'],
        modules: ['staff.staff_directory'],
    },
    {
        key: 'roles',
        path: 'roles',
        label: 'Staff Roles',
        verticals: ['clinic', 'hospital'],
        modules: ['staff.staff_roles'],
    },
    // The dashboard they already land on IS this grant. Pointing it at the
    // index rather than a second overview screen keeps one answer to "where do
    // I start", and the sidebar drops the duplicate entry.
    {
        key: 'overview',
        path: '',
        label: 'Overview',
        verticals: ['clinic', 'hospital'],
        modules: ['overview.dashboard'],
        isIndex: true,
    },

    // ── Doctor ───────────────────────────────────────────────────────────
    // The doctor API is gated by a path-prefix table in
    // app/api/service_provider/doctor/staff_access.py rather than per-route
    // decorators, so these are all live rather than aspirational.
    {
        key: 'doctor-profile',
        path: 'doctor-profile',
        label: 'Profile & Schedule',
        verticals: ['doctor'],
        modules: [
            'profile.profile_details.personal_professional',
            'profile.profile_details.signatures_pricing',
            'profile.profile_details.about_me',
            'profile.profile_details.education',
            'profile.profile_details.bank_details',
            'profile.profile_details.declaration_documents',
            'profile.account_status',
            'profile.slot_visibility',
            'profile.working_hours',
            'profile.consultation_pricing',
            'profile.analytics',
            'profile.attendance',
            'profile.treatable_symptoms',
        ],
    },
    {
        key: 'doctor-appointments',
        path: 'appointments',
        label: 'Appointments & Services',
        verticals: ['doctor'],
        modules: [
            'appointments.my_appointments.consultations',
            'appointments.my_appointments.service_list',
            'appointments.my_appointments.group_offering',
        ],
    },
    {
        key: 'doctor-manage',
        path: 'manage',
        label: 'Manage Services',
        verticals: ['doctor'],
        modules: [
            'appointments.manage.appointment_requests',
            'appointments.manage.service_catalog',
            'appointments.manage.availability_slots',
        ],
    },
    {
        key: 'doctor-records',
        path: 'records',
        label: 'Prescriptions & Documents',
        verticals: ['doctor'],
        modules: [
            'records.prescriptions_documents.prescriptions',
            'records.prescriptions_documents.documents',
        ],
    },
    {
        key: 'doctor-chats',
        path: 'service-chats',
        label: 'Service Chats',
        verticals: ['doctor'],
        modules: [
            'records.service_chats.channels',
            'records.service_chats.messages',
            'records.service_chats.calls',
        ],
    },
    {
        key: 'doctor-patients',
        path: 'patients',
        label: 'My Patients',
        verticals: ['doctor'],
        modules: ['practice.patients'],
    },
    {
        key: 'doctor-network',
        path: 'network',
        label: 'My Network',
        verticals: ['doctor'],
        modules: ['practice.my_network'],
    },
    {
        key: 'doctor-affiliations',
        path: 'affiliations',
        label: 'Hospital Affiliations',
        verticals: ['doctor'],
        modules: ['practice.affiliations'],
    },
    {
        key: 'doctor-teams',
        path: 'plan-teams',
        label: 'My Plan Teams',
        verticals: ['doctor'],
        modules: ['practice.plan_teams'],
    },
    {
        key: 'doctor-billing',
        path: 'billing',
        label: 'Billing & Membership',
        verticals: ['doctor'],
        modules: ['practice.billing', 'practice.membership'],
    },
    {
        key: 'doctor-link',
        path: 'team',
        label: 'Support Staff',
        verticals: ['doctor'],
        modules: ['practice.my_link'],
    },
    {
        key: 'doctor-overview',
        path: '',
        label: 'Overview',
        verticals: ['doctor'],
        modules: ['practice.dashboard'],
        isIndex: true,
    },
];

/**
 * Leaves with no screen for ANYONE — the practice can't see these either, so
 * "not built" is the honest label rather than "staff can't reach it".
 * Surfaced on the dashboard so the distinction is visible where it matters.
 */
export const UNBUILT_MODULES = new Set([
    'entity_profile.verification',
]);

/**
 * Leaves deliberately NOT delegated to staff, with the reason shown on hover.
 * Empty today — service chats were here, and are now delegated on the
 * condition that every message records who typed it (see ChannelChat's
 * "Support staff · <name>" marker). Kept because the distinction is worth
 * having: "we chose not to" is a different answer from "nobody built it", and
 * the next module that needs it shouldn't have to reinvent the machinery.
 */
export const WITHHELD_MODULES = new Map();

/** Every module path that has a screen — the rest can only be described. */
export const ROUTED_MODULES = new Set(
    STAFF_MODULE_ROUTES.flatMap((entry) => entry.modules),
);

/**
 * The routes this principal can open: granted ``can_view`` on at least one of
 * the entry's modules, and in a vertical the screen exists for.
 */
export const routesFor = (providerType, grants) => STAFF_MODULE_ROUTES.filter(
    (entry) => entry.verticals.includes(providerType)
        && entry.modules.some((module) => {
            const grant = grants[module];
            return !!grant && (grant.full_access || grant.can_view);
        }),
);
