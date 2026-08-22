"""Path -> module map for the linked-adult / caregiver act-on-behalf gate.

A linked adult (or a support-staff caregiver) acting on another patient is
bounded by the role that patient granted them. This maps each patient
self-service sub-path (relative to ``/api/``) to one of the catalog modules, so
the gate can require ``view`` on a GET and ``manage`` on a write. Two special
results:

  * ``'basic'`` — a public / booking-support read (doctor catalog, slots,
    pricing, the combined own-profile view). View-only; allowed for any linked
    adult who holds a role at all.
  * ``None``    — unmapped / deliberately blocked. Fail closed -> denied.

Granularity is maximal: every profile section, every health section, and the
appointment lists (upcoming vs past) map to their own module, so a role can
grant e.g. Vitals without the rest of the record, or Upcoming appointments
without Book. Appointment *view* only splits into upcoming vs history at the
endpoint level — "completed" is a client-side slice of the history list and so
falls under ``appt_history``.

Longest-prefix-first: the list is ordered most-specific first; first match wins.
"""

# (path-prefix, module | 'basic' | None). Order matters — specific before general.
_PREFIX_RULES = [
    # ── Profile sections ──
    ('patient/profile/personal-details', 'profile_personal'),
    ('patient/profile/contact-identity', 'profile_contact'),
    ('patient/profile/address', 'profile_address'),
    ('patient/profile/emergency-contact', 'profile_emergency'),
    ('patient/profile/insurance', 'profile_insurance'),
    ('patient/profile/female-health', 'profile_female_health'),

    # ── Health-record sections ──
    ('patient/vitals', 'health_vitals'),
    ('patient/habits', 'health_habits'),
    ('patient/surgeries', 'health_surgeries'),
    ('patient/health-records', 'health_records'),

    # ── Records the doctor pushes ──
    ('patient/prescriptions', 'prescriptions'),
    ('patient/appointments/', 'prescriptions'),   # <id>/prescriptions (read)
    ('patient/documents', 'documents'),

    # ── Service list (purchases) — must precede the booking prefixes below ──
    ('patient/marketplace/orders', 'appt_service_list'),
    ('patient/group-offerings/bookings', 'appt_service_list'),
    ('patient/orders', 'appt_service_list'),

    # ── Appointments: view (upcoming vs history) ──
    ('appointment/patient/upcoming', 'appt_upcoming'),
    ('appointment/patient/history', 'appt_history'),

    # ── Booking: the write actions (create / cancel / intake / purchase) ──
    ('appointment', 'appt_booking'),
    ('patient/appointment-context', 'appt_booking'),
    ('patient/follow-up-invites', 'appt_booking'),
    ('patient/marketplace', 'appt_booking'),
    ('patient/group-offerings', 'appt_booking'),

    # ── Spending / billing / credits ──
    ('patient/spending', 'spending'),
    ('patient/credits', 'spending'),
    ('patient/member-offers', 'spending'),
    ('patient/redeem-code', 'spending'),
    ('membership/my-benefits', 'spending'),

    # ── Family doctor / second opinion ──
    ('family-doctor', 'family_doctor'),

    # ── Public / booking-support reads (view-only) ──
    ('patient/symptoms', 'basic'),
    ('patient/doctors', 'basic'),
    ('patient/slot-availability-summary', 'basic'),
    ('patient/offerings/features', 'basic'),
    ('doctor/list', 'basic'),
    ('doctor/', 'basic'),

    # ── Profile: combined own-profile GET + profile image ──
    ('profile/image', 'profile_personal'),
    ('patient/profile', 'basic'),
    ('entity-profile/me', 'basic'),
]

# Service-communication channel actions (the segment lives *after* the channel
# id, so this can't be a plain prefix). Longest / most-specific token first.
_SERVICE_PREFIX = 'service-communication/channels'
_SERVICE_ACTIONS = [
    ('/messages', 'service_chat'),
    ('/read', 'service_chat'),
    ('/calls', 'service_calls'),
    ('/documents', 'service_documents'),
    ('/forms', 'service_documents'),
]

# POST-shaped discovery reads: they carry a body (symptoms, filters) but mutate
# nothing, so they're allowed at the same view level as the GET catalog reads.
# Without this the booking flow's "Matched Doctors" step 403s for a caregiver
# even though the doctor list, search and slots (plain GETs) load fine.
_BASIC_DISCOVERY_POSTS = ('patient/doctors/match',)


def module_for(subpath):
    """The module a patient sub-path belongs to: a catalog key, ``'basic'``, or
    ``None`` (deny). ``subpath`` is relative to ``/api/`` with no leading slash."""
    subpath = (subpath or '').strip('/')

    # Service communication: classify by the action segment after the channel id.
    if subpath.startswith(_SERVICE_PREFIX):
        tail = subpath[len(_SERVICE_PREFIX):]
        for token, module in _SERVICE_ACTIONS:
            if token in tail:
                return module
        return 'basic'  # channel list / detail / timeline — a view

    for prefix, module in _PREFIX_RULES:
        if subpath == prefix or subpath.startswith(prefix + '/') or subpath.startswith(prefix):
            return module
    return None


def linked_adult_allowed(subpath, method, grants):
    """Whether a linked adult holding ``grants`` (``effective_for_member``) may
    call ``method`` on ``subpath``. Fail closed."""
    module = module_for(subpath)
    if module is None:
        return False
    if module == 'basic':
        if method == 'GET':
            return True  # public / view-only reads
        return (subpath or '').strip('/') in _BASIC_DISCOVERY_POSTS
    grant = grants.get(module)
    if not grant:
        return False
    return grant.get('can_view') if method == 'GET' else grant.get('can_manage')
