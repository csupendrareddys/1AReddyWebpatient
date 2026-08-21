/**
 * Shared vocabulary for the roles-and-permissions matrix, plus the two trees
 * that are still preview-only.
 *
 * **Where the trees live now.** Doctor, clinic and hospital used to be defined
 * here; the backend owns them (``app/api/admin/provider_rbac/module_catalog.py``)
 * and the client fetches them. That is what makes the module keys the client
 * saves the same keys the server validates against — with two copies, adding a
 * screen meant editing both and finding out at save time when you didn't.
 *
 * **What's left.** Patient and Admin have no staff entity behind them, so
 * there is nothing to persist a grant against and no endpoint to fetch a tree
 * from. They keep a local tree and the preview banner:
 *
 *   * Admin — roles and per-module grants for platform staff are already
 *     administered end-to-end by ManageRoles / ManageSubAdmins over the
 *     ``roles`` table. A second editor over the same rows is the drift this
 *     module exists to avoid.
 *   * Patient — a patient is one person, not an organisation. There is no
 *     "patient's front desk" to grant anything to. If family-member delegation
 *     ever becomes real, this is the shape it would take.
 */

/**
 * Mirrors ``ManageRoles``' PermissionMatrix so the two matrices read the same,
 * and mirrors ``GRANT_COLUMNS`` in the backend model so the payload needs no
 * translation. ``full_access`` is first and drives the rest of the row.
 */
export const ACTION_COLUMNS = [
    { key: 'full_access', label: 'Full Access' },
    { key: 'can_view', label: 'View' },
    { key: 'can_create', label: 'Create' },
    { key: 'can_edit', label: 'Edit' },
    { key: 'can_update', label: 'Update' },
    { key: 'can_delete', label: 'Delete' },
    { key: 'can_l1_verify', label: 'L1 Verify' },
    { key: 'can_l2_verify', label: 'L2 Verify' },
    { key: 'can_l3_verify', label: 'L3 Verify' },
    { key: 'can_lock', label: 'Lock' },
    { key: 'can_unlock', label: 'Unlock' },
];

// Every column except full_access — the set a full_access tick cascades over.
export const GRANT_COLUMNS = ACTION_COLUMNS.slice(1).map((c) => c.key);

/**
 * The backend ``DataRange`` enum. The live verticals get this list from
 * ``/modules`` instead; this copy is the fallback for the preview entities,
 * which have no endpoint to ask.
 */
export const DATA_RANGES = [
    { value: 'ALL', label: 'All Time' },
    { value: 'LAST_15_DAYS', label: 'Last 15 Days' },
    { value: 'LAST_30_DAYS', label: 'Last 30 Days' },
    { value: 'LAST_60_DAYS', label: 'Last 60 Days' },
    { value: 'LAST_90_DAYS', label: 'Last 90 Days' },
    { value: 'LAST_180_DAYS', label: 'Last 180 Days' },
    { value: 'LAST_360_DAYS', label: 'Last 360 Days' },
];

export const DEFAULT_DATA_RANGE = 'ALL';

// The verticals with a ProviderStaff table behind them. Everything else is a
// preview. Kept in step with ``StaffProviderType`` on the backend — three
// values there, three here.
export const LIVE_ENTITIES = ['doctor', 'clinic', 'hospital'];

export const ENTITY_LABEL = {
    doctor: 'Doctor', clinic: 'Clinic', hospital: 'Hospital',
    patient: 'Patient', admin: 'Admin',
};

// ---------------------------------------------------------------------------
// Preview-only trees
// ---------------------------------------------------------------------------

const PATIENT_TREE = [
    {
        key: 'profile',
        label: 'Profile & Health Record',
        children: [
            {
                key: 'personal',
                label: 'Personal',
                children: [
                    { key: 'personal_details', label: 'Personal Details' },
                    { key: 'contact_identity', label: 'Contact & Identity' },
                    { key: 'address', label: 'Address' },
                    { key: 'emergency_contact', label: 'Emergency Contact' },
                ],
            },
            { key: 'insurance', label: 'Insurance' },
            { key: 'female_health', label: 'Female Health' },
            { key: 'vitals', label: 'Vitals' },
            { key: 'habits', label: 'Habits & Lifestyle' },
            { key: 'surgeries', label: 'Surgeries' },
            { key: 'health_records', label: 'Health Records' },
            { key: 'previous_prescriptions', label: 'Prescriptions' },
            { key: 'house_family_group', label: 'Family Group' },
            { key: 'entity_details', label: 'Entity Details' },
        ],
    },
    {
        key: 'booking',
        label: 'Booking',
        children: [
            {
                key: 'book_consultation',
                label: 'Book Consultation',
                children: [
                    { key: 'book_by_type', label: 'Book by Type' },
                    { key: 'book_by_symptoms', label: 'Book by Symptoms' },
                    { key: 'instant', label: 'Instant Consultation' },
                    { key: 'clinic_visit', label: 'Clinical Visit' },
                    { key: 'counselling', label: 'Counselling' },
                    { key: 'vaccination', label: 'Vaccination' },
                ],
            },
            { key: 'find_doctors', label: 'Find a Doctor' },
        ],
    },
    {
        key: 'services',
        label: 'Services & Plans',
        children: [
            {
                key: 'marketplace',
                label: 'Services (Marketplace)',
                children: [
                    { key: 'browse', label: 'Browse Services' },
                    { key: 'orders', label: 'My Orders' },
                ],
            },
            { key: 'health_plans', label: 'Health Plans' },
            { key: 'membership', label: 'My Membership' },
        ],
    },
    {
        key: 'activity',
        label: 'My Activity',
        children: [
            {
                key: 'my_appointments',
                label: 'My Appointments / Services',
                children: [
                    { key: 'upcoming', label: 'Upcoming' },
                    { key: 'past', label: 'Past' },
                    { key: 'service_orders', label: 'Service Orders' },
                ],
            },
            {
                key: 'my_records',
                label: 'Prescriptions / Documents',
                children: [
                    { key: 'prescriptions', label: 'Prescriptions' },
                    { key: 'documents', label: 'Documents' },
                ],
            },
            {
                key: 'my_services',
                label: 'My Services (Chats)',
                children: [
                    { key: 'channels', label: 'Channels' },
                    { key: 'messages', label: 'Messages' },
                    { key: 'calls', label: 'Scheduled Calls' },
                ],
            },
            { key: 'spending', label: 'My Spending' },
        ],
    },
];

const ADMIN_TREE = [
    {
        key: 'my_account',
        label: 'My Account',
        children: [
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'my_access', label: 'My Access' },
            { key: 'profile_settings', label: 'Profile Settings' },
        ],
    },
    {
        key: 'user_management',
        label: 'User Management',
        children: [
            {
                key: 'directories',
                label: 'Directories',
                children: [
                    { key: 'view_patients', label: 'View Patients' },
                    { key: 'view_doctors', label: 'View Doctors' },
                    { key: 'view_clinics', label: 'View Clinics' },
                    { key: 'view_hospitals', label: 'View Hospitals' },
                ],
            },
            {
                key: 'administrators',
                label: 'Administrators',
                children: [
                    { key: 'manage_admins', label: 'Manage Admins' },
                    { key: 'sub_admins', label: 'Sub-Admins' },
                ],
            },
            {
                key: 'roles_permissions',
                label: 'Roles & Permissions',
                children: [
                    { key: 'roles', label: 'Roles' },
                    { key: 'permission_matrix', label: 'Permission Matrix' },
                    { key: 'overrides', label: 'Overrides' },
                ],
            },
        ],
    },
    {
        key: 'approvals',
        label: 'Approvals',
        children: [
            { key: 'pending_approvals', label: 'Pending Approvals' },
            { key: 'availability_approvals', label: 'Availability Approvals' },
            { key: 'group_offering_approvals', label: 'Group Offering Approvals' },
            { key: 'service_product_approvals', label: 'Service / Product Approvals' },
            { key: 'prescription_approvals', label: 'Prescription Approvals' },
            { key: 'document_approvals', label: 'Document Approvals' },
        ],
    },
    {
        key: 'catalog',
        label: 'Catalog & Pricing',
        children: [
            { key: 'product_catalog', label: 'Product Catalog' },
            { key: 'medicine_catalog', label: 'Medicine Catalog' },
            { key: 'group_offerings', label: 'Group Offerings' },
            { key: 'pricing_configuration', label: 'Pricing Configuration' },
            { key: 'provider_visibility', label: 'Provider Visibility' },
            { key: 'feature_product_linking', label: 'Feature-Product Linking' },
        ],
    },
    {
        key: 'operations',
        label: 'Operations',
        children: [
            {
                key: 'manage_entities',
                label: 'Manage Entities',
                children: [
                    { key: 'service_provider', label: 'Service Provider' },
                    { key: 'service_receiver', label: 'Service Receiver' },
                    { key: 'admin', label: 'Admin' },
                ],
            },
            { key: 'manage_roles_permissions', label: 'Manage Roles & Permissions' },
            { key: 'audit_log', label: 'Audit Log' },
        ],
    },
    {
        key: 'configuration',
        label: 'Configuration',
        children: [
            { key: 'page_controls', label: 'Page Controls' },
            { key: 'page_config', label: 'Page Config Editor' },
            { key: 'landing_page', label: 'My Landing Page' },
            { key: 'pdf_editor', label: 'Prescription / Document PDF Editor' },
            { key: 'billing_config', label: 'Billing Config' },
            { key: 'settings', label: 'Settings' },
        ],
    },
    {
        key: 'finance_reports',
        label: 'Billing & Reports',
        children: [
            { key: 'subscription', label: 'Subscription' },
            { key: 'payout_management', label: 'Payout Management' },
            { key: 'reports', label: 'Reports' },
            { key: 'audit_logs', label: 'Audit Logs' },
        ],
    },
];

export const PREVIEW_TREES = {
    patient: PATIENT_TREE,
    admin: ADMIN_TREE,
};

/**
 * Roles offered for the preview entities. The live verticals get theirs from
 * the database (seeded per tenant on first read); these have nowhere to be
 * stored, so they're named here to keep the screen legible.
 */
export const PREVIEW_ROLES = {
    patient: [
        { id: 'patient_primary', name: 'Patient (Account Owner)' },
        { id: 'family_member', name: 'Family Member' },
        { id: 'dependent', name: 'Dependent' },
        { id: 'caregiver', name: 'Caregiver' },
    ],
    admin: [
        { id: 'super_admin', name: 'Super Admin' },
        { id: 'sub_admin', name: 'Sub-Admin' },
        { id: 'support_agent', name: 'Support Agent' },
    ],
};

export const RBAC_ENTITIES = [...LIVE_ENTITIES, ...Object.keys(PREVIEW_TREES)];
