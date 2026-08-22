"""
Which catalog module each part of the doctor API belongs to.

The doctor blueprint is ~129 rules. Decorating each one would mean 129 chances
to forget one, and forgetting one on a *write* route is the expensive
direction. Its URLs are already grouped by feature though — everything under
``prescriptions/`` is the prescriptions module however many routes hang off it
— so the grouping the URLs already have is the grouping used here.

**Anything unlisted is denied to staff.** Adding a route can only fail closed:
a new path nobody mapped refuses a staff caller rather than inheriting whatever
the nearest rule happened to be.

The action follows the HTTP verb by default (GET reads, POST creates, PUT/PATCH
edit, DELETE deletes). Where a verb lies about what the route does — a POST
that accepts an appointment is not creating one — the rule overrides it, which
is the whole reason for the second element of the tuple.
"""
from app.models import StaffProviderType

# ── Catalog leaves, named once ───────────────────────────────────────────
P_PERSONAL = 'profile.profile_details.personal_professional'
P_SIGNATURES = 'profile.profile_details.signatures_pricing'
P_ABOUT = 'profile.profile_details.about_me'
P_EDUCATION = 'profile.profile_details.education'
P_BANK = 'profile.profile_details.bank_details'
P_DECLARATIONS = 'profile.profile_details.declaration_documents'
P_ACCOUNT = 'profile.account_status'
P_SLOTS = 'profile.slot_visibility'
P_HOURS = 'profile.working_hours'
P_PRICING = 'profile.consultation_pricing'
P_SYMPTOMS = 'profile.treatable_symptoms'

A_CONSULTATIONS = 'appointments.my_appointments.consultations'
A_SERVICE_LIST = 'appointments.my_appointments.service_list'
A_GROUP = 'appointments.my_appointments.group_offering'
A_REQUESTS = 'appointments.manage.appointment_requests'
A_CATALOG = 'appointments.manage.service_catalog'
A_AVAILABILITY = 'appointments.manage.availability_slots'

R_PRESCRIPTIONS = 'records.prescriptions_documents.prescriptions'
R_DOCUMENTS = 'records.prescriptions_documents.documents'

W_BILLING = 'practice.billing'
W_PATIENTS = 'practice.patients'
W_NETWORK = 'practice.my_network'
W_TEAMS = 'practice.plan_teams'


# Verb overrides, for routes whose method doesn't describe the act.
_RESPOND = {'POST': 'can_edit'}      # accept / reject / respond / claim
_READ_POST = {'POST': 'can_view'}    # a POST that only looks something up

# ── The table ────────────────────────────────────────────────────────────
# Longest prefix wins, so a specific rule can sit beside a general one.
DOCTOR_STAFF_RULES = {
    # Profile & schedule
    'profile/signatures': P_SIGNATURES,
    'profile/about': P_ABOUT,
    'profile/education': P_EDUCATION,
    'profile/bank-accounts': P_BANK,
    'profile/declarations': P_DECLARATIONS,
    'profile/documents': P_DECLARATIONS,
    'profile/extended': P_PERSONAL,
    'profile': P_PERSONAL,
    'qualifications': P_EDUCATION,
    'account-state': P_ACCOUNT,
    'banned-check': P_ACCOUNT,
    # A doctor asking their admin for a field change. Reading the thread is
    # account status; raising one is an edit, not a create — the request is
    # about the profile, not a new object of its own.
    'admin-requests': (P_ACCOUNT, {'POST': 'can_edit', 'PUT': 'can_edit'}),
    'schedule': P_HOURS,
    'slot-visibility': P_SLOTS,
    'symptoms': P_SYMPTOMS,

    # Appointments & services
    'appointments/calendar': A_CONSULTATIONS,
    'appointments/pending-prescriptions': R_PRESCRIPTIONS,
    'appointments': (A_CONSULTATIONS, _RESPOND),
    'appointment-settings': A_AVAILABILITY,
    'services': A_SERVICE_LIST,
    'group-offering-bookings': (A_GROUP, _RESPOND),
    'group-offering-teams': W_TEAMS,
    'marketplace/service-groups': A_GROUP,
    'marketplace/my-products': A_CATALOG,
    'marketplace/sales': A_CATALOG,
    'products': A_CATALOG,

    # Records & communication
    'prescriptions': R_PRESCRIPTIONS,
    'documents': R_DOCUMENTS,
    'orders': R_DOCUMENTS,
    # The medicine picker inside the prescription form. A search is a read
    # however it is spelled.
    'medicines/search': (R_PRESCRIPTIONS, _READ_POST),

    # Practice
    'patients': W_PATIENTS,
    'network': (W_NETWORK, _RESPOND),
    'billing': W_BILLING,
    'payouts': (W_BILLING, _RESPOND),
    'salary-payouts': (W_BILLING, _RESPOND),
}

# Directory and by-id lookups: these name an explicit doctor or search the
# public roster, so they are not "my practice's data" and are left alone for
# every caller. Gating them would break a staff member looking up the doctor
# they work for by id, which any screen showing a profile does.
#
# ``<doctor_id>`` is the literal route pattern, matched as text — the gate
# compares against ``request.url_rule``, not the request path.
DOCTOR_PUBLIC_PREFIXES = ('list', 'search', '<doctor_id>')

DOCTOR_VERTICAL = StaffProviderType.DOCTOR
