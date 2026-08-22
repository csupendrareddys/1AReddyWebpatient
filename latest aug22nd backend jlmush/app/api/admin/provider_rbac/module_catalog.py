"""
The module tree a provider role's permissions are set over.

This is the canonical copy. The frontend used to hold it and render from a
local constant; it now fetches this, so adding a screen to the catalog is a
backend change alone and the two can't disagree about what
``profile.profile_details.bank_details`` means.

**Shape.** Each provider vertical owns a forest of GROUPS. A group holds
modules; a module may hold sub-modules. The tree is at most three deep and
deliberately UNEVEN, because the product is:

    Profile & Schedule            group   (never carries a grant)
      Profile Details             module  (branch -> roll-up only)
        Personal & Professional   leaf    (the grant lives here)
      Working Hours               module  (leaf -> the grant lives here)

**Only leaves carry grants.** ``leaf_keys()`` is what the write path validates
against, so a payload naming a group or a branch is rejected rather than
silently stored as a fourth source of truth about what a role can do.

**Labels come from the real screens** — the doctor sidebar and ProfileSetting
tabs, the facility layouts — so an operator reading the matrix recognises the
rows as pages they already know rather than invented module names.
"""

# ---------------------------------------------------------------------------
# Doctor
# ---------------------------------------------------------------------------

_DOCTOR_TREE = [
    {
        'key': 'profile',
        'label': 'Profile & Schedule',
        'children': [
            # The one place the app really is three deep: Profile Details is
            # itself a strip of sub-tabs.
            {
                'key': 'profile_details',
                'label': 'Profile Details',
                'children': [
                    {'key': 'personal_professional', 'label': 'Personal & Professional Details'},
                    {'key': 'signatures_pricing', 'label': 'Signatures & Pricing'},
                    {'key': 'about_me', 'label': 'About Me'},
                    {'key': 'education', 'label': 'Education Details'},
                    {'key': 'bank_details', 'label': 'Bank Details'},
                    {'key': 'declaration_documents', 'label': 'Declaration & Documents'},
                ],
            },
            {'key': 'account_status', 'label': 'Account Status'},
            {'key': 'slot_visibility', 'label': 'Slot Visibility'},
            {'key': 'working_hours', 'label': 'Working Hours'},
            {'key': 'consultation_pricing', 'label': 'Consultation Pricing'},
            {'key': 'analytics', 'label': 'Analytics'},
            {'key': 'attendance', 'label': 'Attendance & Activity'},
            {'key': 'treatable_symptoms', 'label': 'Treatable Symptoms'},
        ],
    },
    {
        'key': 'appointments',
        'label': 'Appointments & Services',
        'children': [
            {
                'key': 'my_appointments',
                'label': 'My Appointments / Service List',
                'children': [
                    {'key': 'consultations', 'label': 'My Appointments'},
                    {'key': 'service_list', 'label': 'Service List'},
                    {'key': 'group_offering', 'label': 'My Group Offering'},
                ],
            },
            {
                'key': 'manage',
                'label': 'Manage Appointments / Services',
                'children': [
                    {'key': 'appointment_requests', 'label': 'Appointment Requests'},
                    {'key': 'service_catalog', 'label': 'Service Catalog'},
                    {'key': 'availability_slots', 'label': 'Availability & Slots'},
                ],
            },
        ],
    },
    {
        'key': 'records',
        'label': 'Records & Communication',
        'children': [
            {
                'key': 'prescriptions_documents',
                'label': 'Prescriptions / Documents',
                'children': [
                    {'key': 'prescriptions', 'label': 'Prescriptions'},
                    {'key': 'documents', 'label': 'Documents'},
                ],
            },
            {
                'key': 'service_chats',
                'label': 'Service Chats',
                'children': [
                    {'key': 'channels', 'label': 'Channels'},
                    {'key': 'messages', 'label': 'Messages'},
                    {'key': 'calls', 'label': 'Scheduled Calls'},
                ],
            },
        ],
    },
    {
        'key': 'practice',
        'label': 'Practice',
        # Flat on purpose — each of these is a single sidebar page with no tabs
        # of its own, so a second level here would be invented depth.
        'children': [
            {'key': 'dashboard', 'label': 'Dashboard'},
            {'key': 'billing', 'label': 'My Bills'},
            {'key': 'plan_teams', 'label': 'My Plan Teams'},
            {'key': 'patients', 'label': 'My Patients'},
            {'key': 'affiliations', 'label': 'Hospital Affiliations'},
            {'key': 'my_network', 'label': 'My Network'},
            {'key': 'my_link', 'label': 'My Link'},
            {'key': 'membership', 'label': 'My Membership'},
        ],
    },
]


# ---------------------------------------------------------------------------
# Clinic / Hospital
# ---------------------------------------------------------------------------

def _facility_tree(noun):
    """Clinics and hospitals run the same dashboard — same sidebar, same
    settings page, same Manage Doctors / Network Requests / Bills — so they get
    the same tree from one factory rather than two copies that drift. Only the
    noun differs. When a hospital grows a surface a clinic doesn't have (wards,
    departments), that is the moment to split this in two, not before.
    """
    return [
        {
            'key': 'entity_profile',
            'label': f'{noun} Profile',
            'children': [
                {
                    'key': 'entity_details',
                    'label': 'Entity Details',
                    'children': [
                        {'key': 'entity_type_name', 'label': 'Entity Type & Legal Name'},
                        {'key': 'registration_licence', 'label': 'Registration & Licence'},
                        {'key': 'tax_identifiers', 'label': 'Tax Identifiers (GST / PAN / CIN)'},
                        {'key': 'promoters', 'label': 'Promoters & Establishment'},
                    ],
                },
                {'key': 'account_status', 'label': 'Account Status'},
                {'key': 'verification', 'label': 'Verification Documents'},
            ],
        },
        {
            'key': 'doctors_network',
            'label': 'Doctors & Network',
            'children': [
                {
                    'key': 'manage_doctors',
                    'label': 'Manage Doctors',
                    'children': [
                        {'key': 'roster', 'label': 'Doctor Roster'},
                        {'key': 'invitations', 'label': 'Invitations'},
                        {'key': 'affiliation_requests', 'label': 'Affiliation Requests'},
                    ],
                },
                {'key': 'network_requests', 'label': 'Network Requests'},
                # My Link affiliations, and the Operation Page behind them.
                # What the facility may DO to a linked doctor is decided by
                # the relationship the doctor declared, not by this grant —
                # this only says whether a staff member reaches the surface at
                # all (view = read the list, edit = act for a doctor through
                # it). See app/api/provider_link/authority.py.
                {'key': 'linked_doctors', 'label': 'Linked Doctors (My Link)'},
            ],
        },
        {
            'key': 'billing',
            'label': 'Billing',
            'children': [
                {
                    'key': 'bills',
                    'label': 'Bills',
                    'children': [
                        {'key': 'invoices', 'label': 'Invoices'},
                        {'key': 'payments', 'label': 'Payments'},
                    ],
                },
                {'key': 'membership', 'label': 'My Membership'},
            ],
        },
        {
            'key': 'staff',
            'label': 'Staff',
            # A facility's own staff list. Present here and not on the doctor
            # tree because a doctor's assistant managing other assistants is a
            # role nobody has asked for; a clinic manager doing it is the
            # normal case.
            'children': [
                {'key': 'staff_directory', 'label': 'Staff Directory'},
                {'key': 'staff_roles', 'label': 'Staff Roles'},
            ],
        },
        {
            'key': 'overview',
            'label': 'Overview',
            'children': [{'key': 'dashboard', 'label': 'Dashboard'}],
        },
    ]


MODULE_CATALOG = {
    'doctor': _DOCTOR_TREE,
    'clinic': _facility_tree('Clinic'),
    'hospital': _facility_tree('Hospital'),
}


# ---------------------------------------------------------------------------
# Derived lookups
# ---------------------------------------------------------------------------

def _walk(nodes, parent_path, on_leaf, on_branch=None):
    for node in nodes:
        path = f"{parent_path}.{node['key']}" if parent_path else node['key']
        children = node.get('children') or []
        if children:
            if on_branch:
                on_branch(path, node)
            _walk(children, path, on_leaf, on_branch)
        else:
            on_leaf(path, node)


def _index(provider_type):
    leaves, labels = {}, {}

    def leaf(path, node):
        leaves[path] = node['label']
        labels[path] = node['label']

    def branch(path, node):
        labels[path] = node['label']

    _walk(MODULE_CATALOG.get(provider_type, []), '', leaf, branch)
    return leaves, labels


# Built once at import. The catalog is a module-level constant, so rebuilding
# the index per request would be pure waste on the hot validation path.
_LEAVES = {pt: _index(pt)[0] for pt in MODULE_CATALOG}
_LABELS = {pt: _index(pt)[1] for pt in MODULE_CATALOG}


def tree_for(provider_type):
    """The nested tree the matrix renders. ``provider_type`` is the enum VALUE
    ('doctor' / 'clinic' / 'hospital')."""
    return MODULE_CATALOG.get(provider_type, [])


def leaf_keys(provider_type):
    """Every module path that may carry a grant, for this vertical."""
    return set(_LEAVES.get(provider_type, {}))


def label_for(provider_type, module_key):
    """Human label for a path — used when echoing stored grants back, so the
    client doesn't have to re-walk the tree to render a name."""
    return _LABELS.get(provider_type, {}).get(module_key)


def leaf_count(provider_type):
    return len(_LEAVES.get(provider_type, {}))
