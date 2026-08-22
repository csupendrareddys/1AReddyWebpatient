"""Patient Family module catalog — what a role can grant a linked family member
or a support-staff caregiver (both draw from the same role pool).

Fine-grained leaves, grouped: a patient can grant "Vitals" without the rest of
their health record, or "Upcoming appointments" without "Book". Each leaf
carries two verbs — ``view`` (read) and ``manage`` (create / edit / act). The
path→module mapping the act-on-behalf gate uses lives in ``rules.py``.

Backwards compatibility: the earlier coarse keys ``appointments`` /
``health_records`` / ``prescriptions`` were split here. Existing granted
permissions are migrated to the new leaves by migration ``<split>`` so no role
loses access — see ``LEGACY_SPLIT`` for the mapping the migration applies.
"""

# key, label, group. Order defines display order; groups render in first-seen
# order.
PATIENT_MODULES = [
    # ── Profile — each section on its own ──
    {'key': 'profile_personal',      'label': 'Personal details',      'group': 'Profile'},
    {'key': 'profile_contact',       'label': 'Contact & identity',    'group': 'Profile'},
    {'key': 'profile_address',       'label': 'Address',               'group': 'Profile'},
    {'key': 'profile_emergency',     'label': 'Emergency contact',     'group': 'Profile'},
    {'key': 'profile_insurance',     'label': 'Insurance & documents', 'group': 'Profile'},
    {'key': 'profile_female_health', 'label': 'Female health',         'group': 'Profile'},

    # ── Health record — each section ──
    {'key': 'health_vitals',    'label': 'Vitals',             'group': 'Health'},
    {'key': 'health_habits',    'label': 'Habits & lifestyle', 'group': 'Health'},
    {'key': 'health_surgeries', 'label': 'Surgeries',          'group': 'Health'},
    {'key': 'health_records',   'label': 'Health records',     'group': 'Health'},

    # ── Appointments — by list, plus booking as its own act ──
    {'key': 'appt_upcoming',     'label': 'Upcoming appointments',       'group': 'Appointments'},
    {'key': 'appt_history',      'label': 'Past appointments',           'group': 'Appointments'},
    {'key': 'appt_service_list', 'label': 'Service list (purchases)',    'group': 'Appointments'},
    {'key': 'appt_booking',      'label': 'Book appointments & services', 'group': 'Appointments'},

    # ── Records the doctor pushes ──
    {'key': 'prescriptions', 'label': 'Prescriptions', 'group': 'Records'},
    {'key': 'documents',     'label': 'Documents',     'group': 'Records'},

    # ── Care ──
    {'key': 'family_doctor', 'label': 'Family doctor', 'group': 'Care'},

    # ── Services — the service-communication channel, by action ──
    {'key': 'service_chat',      'label': 'Service chat (messages)', 'group': 'Services'},
    {'key': 'service_calls',     'label': 'Audio & video calls',     'group': 'Services'},
    {'key': 'service_documents', 'label': 'Shared documents & forms', 'group': 'Services'},

    # ── Money ──
    {'key': 'spending', 'label': 'Spending & billing', 'group': 'Money'},
]

MODULE_KEYS = {m['key'] for m in PATIENT_MODULES}
LABELS = {m['key']: m['label'] for m in PATIENT_MODULES}

# Old coarse key -> the new leaves it became. The grant migration copies each
# existing permission onto every leaf here (same view/manage), then drops the
# old row. Kept in code (not just the migration) so the split is documented and
# a future backfill can reuse it.
LEGACY_SPLIT = {
    'appointments': ['appt_upcoming', 'appt_history', 'appt_service_list', 'appt_booking'],
    'health_records': ['health_vitals', 'health_habits', 'health_surgeries',
                       'health_records', 'profile_female_health'],
    'prescriptions': ['prescriptions', 'documents'],
}


def module_catalog():
    """The full catalog (backend-owned; the frontend fetches it)."""
    return [dict(m) for m in PATIENT_MODULES]


def is_valid_module(key):
    return key in MODULE_KEYS
