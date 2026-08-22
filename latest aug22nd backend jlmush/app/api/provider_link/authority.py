"""What a My Link relationship lets a facility do to the doctor behind it.

The premise
-----------
Support staff (``app.common.provider_access``) needed a roles table because
"receptionist" is not a fact the platform knows — someone has to say what she
may touch. A My Link affiliation is different: the doctor already declared the
relationship when they connected, and Partner / Associate / **Employee** is
exactly the statement "here is how much of my practice this facility runs".
So there is nothing to configure. The relationship IS the grant.

That makes the consent story the important one. ``relationship_type`` is
written by the DOCTOR — every path that sets it
(``DoctorNetworkService.send_request`` / ``generate_invite``) runs on the
doctor-side blueprint, and the facility's only move is to accept or reject the
request as sent. A clinic therefore cannot promote itself to Employee over a
doctor who did not offer it. If that ever stops being true, this module's
authority evaporates and the tiers below have to be re-grounded in something
the doctor still controls.

The ladder
----------
A matrix, not a list: each relationship has an access level per SECTION of the
doctor's practice. The shipped defaults (:data:`DEFAULT_MATRIX`):

=============  =======  ============  ======  =======  =====
\\              profile  appointments  manage  records  chats
=============  =======  ============  ======  =======  =====
Partner        view     view          —       —        —
Associate      —        full          full    —        —
Employee       full     full          full    full     full
=============  =======  ============  ======  =======  =====

``view`` is enforced by intersecting that section's methods with the safe verbs
rather than by writing a second, GET-only copy of it — a hand-written copy is a
place for a stray ``PUT`` to survive a rename. A pattern left with no verbs
(``profile/image`` is POST-only) drops out entirely, so it cannot be reached at
all rather than being reachable-but-refused.

Administrators may retune any cell per tenant
(:class:`~app.models.care_network.LinkRelationshipPolicy`, edited from the
admin Roles & Permissions screen). Only edited cells are stored, so the table
above is what an untouched tenant gets and a section added here reaches
everyone without a data migration.

**The exclusions are not configurable, by construction.** A cell picks an
access level for a section; it cannot name an endpoint. The things that must
never be reachable — a doctor's bank accounts, their payouts, joining a live
call — are on no section's path list at all, so no combination of settings can
produce them. That is why this is a matrix over sections rather than a
permission editor over routes.

"Almost" is doing real work in that last row. Two things stay with the doctor
at every tier, and they are the two an employer has the strongest incentive to
want:

* **Bank accounts and payouts.** Where the money lands is not an operational
  detail. ``doctor/profile/bank-accounts*`` and ``doctor/payouts*`` appear on
  no tier, so an employer cannot redirect a doctor's earnings — this is the
  single line that most needs to hold, because the whole feature is an
  employer acting under the doctor's name.
* **Joining a live consultation.** Same line the admin proxy already draws:
  turning up to a patient's video call is the doctor personally being present,
  not paperwork someone can do for them.

Everything an employer writes is still recorded as theirs. Profile edits land
in the doctor's field-approval queue rather than applying silently (the
facility owner has no ``admin_profile``, so ``profile_audit`` can't self-
approve them), and a chat message is stamped ``employer`` so the patient reads
"Employer · <name>" and not the doctor's own voice.
"""
import logging

from app.common.act_as import ID_PATTERN as _ID, compile_paths

logger = logging.getLogger(__name__)

#: Tier keys, weakest first. Stored ``relationship_type`` is title-cased
#: ('Employee'), so every lookup here lowercases first.
PARTNER = 'partner'
ASSOCIATE = 'associate'
EMPLOYEE = 'employee'

#: UI sections, in the order the Operation Page shows them. ``key`` matches the
#: tab route in ``LinkOperationDialog``; keep the two in step.
SECTION_LABELS = {
    'profile': 'Profile & Schedule',
    'appointments': 'Appointments',
    'manage': 'Services & Availability',
    'records': 'Prescriptions & Documents',
    'chats': 'Service Chats',
}

#: Access a relationship has to one section. ``view`` intersects the section's
#: methods with the safe verbs rather than naming a second GET-only path list —
#: a hand-written copy is where a stray ``PUT`` survives a rename.
NONE, VIEW, FULL = 'none', 'view', 'full'
ACCESS_LEVELS = (NONE, VIEW, FULL)
ACCESS_LABELS = {NONE: 'No access', VIEW: 'View only', FULL: 'View & manage'}

#: The shipped ladder: what each relationship opens, section by section.
#: An administrator can override any cell (``LinkRelationshipPolicy``), but
#: this is what every tenant gets until one does, and what an unset cell falls
#: back to — so adding a section here reaches every tenant without a data
#: migration.
DEFAULT_MATRIX = {
    PARTNER: {'profile': VIEW, 'appointments': VIEW},
    ASSOCIATE: {'appointments': FULL, 'manage': FULL},
    EMPLOYEE: {
        'profile': FULL, 'appointments': FULL, 'manage': FULL,
        'records': FULL, 'chats': FULL,
    },
}

#: Verbs a ``view`` cell keeps.
_SAFE_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})

#: The standing character of each relationship, independent of exactly which
#: cells are ticked. Deliberately not derived from the matrix: an operator can
#: retune the cells, and a sentence generated from whatever they last saved
#: would say less than one that explains what the relationship IS.
TIER_SUMMARY = {
    PARTNER: 'A peer, not a supervisor — the narrowest relationship.',
    ASSOCIATE: 'Coordination: the practice they run WITH you, not the practice '
               'that is theirs alone.',
    EMPLOYEE: "Almost everything this doctor can do. Bank details and payouts "
              'stay with them, and profile edits go to their approval queue.',
}

# ── Section path sets ─────────────────────────────────────────────────────
# Same ``(pattern, methods, feature)`` shape as the admin proxy's allowlists,
# and drawn from them: a path that is not safe for a platform operator is not
# safe here either. The reverse does not hold, which is why this is a separate
# list rather than a filter over that one.

_PROFILE = [
    # Profile Details tab — the sections and the presign helpers their uploads
    # need. Bank details are absent at every tier; see the module docstring.
    (r'doctor/profile', {'GET', 'PUT'}, 'doctor.profile'),
    (r'doctor/profile/extended', {'GET', 'PUT'}, 'doctor.profile'),
    (r'doctor/profile/about', {'GET', 'POST'}, None),
    (r'doctor/profile/about/presign', {'GET'}, None),
    (r'doctor/profile/education', {'GET', 'POST'}, None),
    (r'doctor/profile/education/dropdowns', {'GET'}, None),
    (r'doctor/profile/signatures', {'GET', 'POST'}, None),
    (r'doctor/profile/signatures/presign', {'GET'}, None),
    (r'doctor/profile/declarations', {'GET', 'POST'}, None),
    (r'doctor/profile/declarations/presign', {'GET'}, None),
    (r'doctor/profile/documents/presign', {'GET'}, None),
    # Sets ``current_user.profile_image`` — unproxied it would replace the
    # FACILITY owner's own photo with the one they picked for the doctor.
    (r'profile/image', {'POST'}, None),

    # Account Status / Slot Visibility / Working Hours / Pricing tabs.
    (r'doctor/account-state', {'GET'}, None),
    (r'doctor/slot-visibility', {'GET', 'PUT'}, None),
    (r'doctor/schedule', {'GET', 'PUT'}, 'doctor.calendar'),

    # Treatable Symptoms tab.
    (r'doctor/symptoms', {'GET', 'PUT'}, None),
    (r'doctor/symptoms/available', {'GET'}, None),
]

_APPOINTMENTS = [
    # The list, the calendar, and the accept/reject decision on a request —
    # the thing a front desk is actually for. ``complete`` is absent with the
    # prescription routes: completing a consultation posts a prescription.
    (r'doctor/appointments', {'GET'}, None),
    (r'doctor/appointments/calendar', {'GET'}, 'doctor.calendar'),
    (rf'doctor/appointments/{_ID}', {'GET'}, None),
    (rf'doctor/appointments/{_ID}/accept', {'POST'}, None),
    (rf'doctor/appointments/{_ID}/reject', {'POST'}, None),
    (rf'doctor/appointments/{_ID}/patient-context', {'GET'}, None),
    (rf'doctor/appointments/{_ID}/patient-vitals', {'PUT'}, 'patient.vitals'),
    (r'doctor/appointment-settings', {'GET', 'PUT'}, None),
    # "Verified" on an upcoming appointment — resolves the doctor from
    # ``current_user``, so it genuinely needs the swap.
    (rf'doctor-attendance/appointments/{_ID}/verify', {'POST'}, None),
    # Incoming orders and paid plan bookings: the same "a patient paid and
    # nobody has responded" desk work as an appointment request.
    (r'doctor/marketplace/sales', {'GET'}, None),
    (rf'doctor/marketplace/sales/{_ID}', {'PUT'}, None),
    (r'doctor/group-offering-bookings/incoming', {'GET'}, None),
    (rf'doctor/group-offering-bookings/{_ID}/accept', {'POST'}, None),
    (rf'doctor/group-offering-bookings/{_ID}/reject', {'POST'}, None),
]

_MANAGE = [
    # When the doctor takes appointments, and what they sell. The schedule is
    # here as well as on the profile: Working Hours and Availability Slots are
    # two views of one document, and an Associate holds this section without
    # holding that one.
    (r'doctor/schedule', {'GET', 'PUT'}, 'doctor.calendar'),
    (r'doctor/products', {'GET'}, None),
    (r'doctor/marketplace/my-products', {'GET', 'POST'}, None),
    (rf'doctor/marketplace/my-products/{_ID}', {'PUT', 'DELETE'}, None),
    (r'doctor/marketplace/service-groups', {'GET', 'POST'}, None),
    (r'doctor/marketplace/service-groups/invitations', {'GET'}, None),
    (rf'doctor/marketplace/service-groups/{_ID}', {'PUT', 'DELETE'}, None),
    (rf'doctor/marketplace/service-groups/{_ID}/respond', {'POST'}, None),
    # Co-doctor picker on the group dialog — has to be the DOCTOR's network,
    # not the facility's, which is what the swap makes it.
    (r'doctor/network/connections', {'GET'}, None),
]

_RECORDS = [
    # Clinical authorship, and knowingly so: a prescription is issued in the
    # doctor's name. Employee only, and audited on every write.
    (r'doctor/prescriptions', {'GET'}, 'doctor.prescriptions'),
    (r'doctor/prescriptions/summary', {'GET'}, None),
    (rf'doctor/prescriptions/{_ID}', {'GET', 'PUT', 'DELETE'}, None),
    (rf'doctor/prescriptions/{_ID}/revise', {'POST'}, None),
    (rf'doctor/prescriptions/{_ID}/follow-up', {'POST'}, None),
    (r'doctor/appointments/pending-prescriptions', {'GET'}, None),
    (rf'doctor/appointments/{_ID}/prescription', {'POST'}, None),
    # The prescription form's own lookups — role-gated, so without the swap
    # the form loses medicine search and the banned-drug check mid-compose.
    (r'doctor/medicines/search', {'GET'}, None),
    (r'doctor/banned-check', {'GET'}, None),

    (r'doctor/documents', {'GET'}, 'doctor.prescriptions'),
    (r'doctor/documents/summary', {'GET'}, None),
    (rf'doctor/documents/{_ID}', {'GET', 'PUT', 'DELETE'}, None),
    (rf'doctor/documents/{_ID}/revise', {'POST'}, None),
    (rf'doctor/documents/{_ID}/attachment', {'POST', 'DELETE'}, None),
    (rf'doctor/documents/{_ID}/fields/{_ID}/attachment', {'POST'}, None),
    (rf'doctor/documents/{_ID}/fields/{_ID}/attachment/{_ID}', {'DELETE'}, None),
    (r'doctor/orders/pending-documents', {'GET'}, None),
    (rf'doctor/orders/{_ID}', {'GET'}, None),
    (rf'doctor/orders/{_ID}/document', {'POST'}, None),
    (rf'doctor/orders/{_ID}/document/upload', {'POST'}, None),
]

_CHATS = [
    # Every message written from here is stamped ``employer`` and rendered
    # "Employer · <name>" to the patient — see
    # ``app/api/service_communication/service.py``. The stamp is the condition
    # this section rests on, exactly as it is for support staff.
    (r'service-communication/channels', {'GET'}, None),
    (rf'service-communication/channels/{_ID}', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/messages', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/read', {'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls/propose', {'POST'}, None),
    # ``join`` is excluded on purpose (see the module docstring); listing the
    # verbs rather than ``[a-z]+`` is what keeps it excluded.
    (rf'service-communication/channels/{_ID}/calls/{_ID}/(accept|cancel|end|leave)',
     {'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents/{_ID}/download', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/timeline', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/forms', {'GET', 'POST'}, None),
]

SECTION_PATHS = {
    'profile': _PROFILE,
    'appointments': _APPOINTMENTS,
    'manage': _MANAGE,
    'records': _RECORDS,
    'chats': _CHATS,
}


def tier_for(relationship_type):
    """The tier a stored ``relationship_type`` maps to, or ``None``.

    ``None`` means "this connection grants nothing" — an unset or unrecognised
    relationship, which is the right answer for a link made before the field
    existed. Failing closed here is what keeps a blank column from reading as
    full access.
    """
    key = (relationship_type or '').strip().lower()
    return key if key in DEFAULT_MATRIX else None


def matrix():
    """``{tier: {section: access}}`` for the current tenant.

    The shipped defaults with any administrator overrides laid on top, cell by
    cell. Resolved once per request and cached on ``g``: a single Operation
    Page request asks for this several times (the gate, the refusal message,
    the tab strip), and re-querying per call would put three round trips on the
    hot path of every proxied read.

    Falls back to the defaults outside a request context — scripts and jobs get
    the shipped ladder rather than an error.
    """
    from flask import g, has_request_context

    if not has_request_context():
        return {tier: dict(cells) for tier, cells in DEFAULT_MATRIX.items()}

    cached = getattr(g, '_link_relationship_matrix', None)
    if cached is not None:
        return cached

    resolved = {tier: dict(cells) for tier, cells in DEFAULT_MATRIX.items()}
    try:
        from app.common.tenant_context import current_tenant_id
        from app.models import LinkRelationshipPolicy

        tenant_id = current_tenant_id()
        if tenant_id:
            rows = LinkRelationshipPolicy.query.filter_by(tenant_id=tenant_id).all()
            for row in rows:
                if row.relationship in resolved and row.section in SECTION_PATHS:
                    if row.access == NONE:
                        resolved[row.relationship].pop(row.section, None)
                    else:
                        resolved[row.relationship][row.section] = row.access
    except Exception:  # noqa: BLE001
        # A permission surface must not fail open. If the override table can't
        # be read, the shipped ladder stands — it is the stricter, known-good
        # answer, and every caller below still enforces it.
        logger.exception('[LINK_POLICY] override lookup failed; using defaults')

    g._link_relationship_matrix = resolved
    return resolved


def access_for(tier, section):
    """This tenant's access level for one cell."""
    return matrix().get(tier, {}).get(section, NONE)


def sections_for(tier):
    """The sections a tier opens, in display order.

    Ordered by ``SECTION_LABELS`` rather than by the matrix, so the tab strip
    reads the same however the cells were saved.
    """
    cells = matrix().get(tier, {})
    return tuple(key for key in SECTION_LABELS if cells.get(key, NONE) != NONE)


def _merge(cells):
    """``{pattern: (methods, feature)}`` across a tier's granted sections.

    Methods UNION rather than overwrite: ``doctor/schedule`` is listed by both
    the profile and the manage sections, and a tier holding either should get
    everything that section allows on it. Overwriting would make the result
    depend on section order, which is a display concern.

    A ``view`` cell contributes only the safe verbs. Because it is an
    intersection per section, a tier that can VIEW the profile and MANAGE the
    schedule still gets ``PUT`` on ``doctor/schedule`` from the manage side —
    which is right: it holds that section outright.
    """
    merged = {}
    for section, access in cells.items():
        if access == NONE:
            continue
        for pattern, methods, feature in SECTION_PATHS.get(section, ()):
            allowed = set(methods)
            if access == VIEW:
                allowed &= _SAFE_METHODS
            if not allowed:
                # Write-only path (an upload, a lifecycle action) under a
                # view-only cell. Dropping it is stricter than keeping it with
                # no verbs, and says the same thing.
                continue
            if pattern in merged:
                prev_methods, prev_feature = merged[pattern]
                merged[pattern] = (prev_methods | allowed, prev_feature or feature)
            else:
                merged[pattern] = (allowed, feature)
    return merged


def paths_for(tier):
    """The compiled allowlist for ``tier`` under this tenant's matrix.

    Compiled per request rather than at import, because the matrix is now
    per-tenant. The regexes are small and the result is cached on ``g`` with
    the matrix that produced it.
    """
    from flask import g, has_request_context

    cells = matrix().get(tier)
    if not cells:
        # Unknown relationship, or every cell turned off. Refused everywhere,
        # without a special case anywhere else.
        return []

    if not has_request_context():
        return compile_paths([
            (pattern, methods, feature)
            for pattern, (methods, feature) in _merge(cells).items()
        ])

    cache = getattr(g, '_link_relationship_paths', None)
    if cache is None:
        cache = {}
        g._link_relationship_paths = cache
    if tier not in cache:
        cache[tier] = compile_paths([
            (pattern, methods, feature)
            for pattern, (methods, feature) in _merge(cells).items()
        ])
    return cache[tier]


def describe(tier):
    """What the Operation Page needs to render itself, for one tier.

    ``read_only`` is derived, not stored: a relationship is read-only when
    nothing it holds can be written. That keeps it true however the cells were
    configured, instead of being a second fact to keep in step.
    """
    cells = matrix().get(tier, {})
    granted = sections_for(tier)
    return {
        'tier': tier,
        'label': (tier or '').title() or None,
        'read_only': bool(granted) and all(
            cells.get(key) == VIEW for key in granted),
        'summary': TIER_SUMMARY.get(tier, 'This relationship grants no control.'),
        'sections': [
            {
                'key': key,
                'label': SECTION_LABELS[key],
                'access': cells.get(key, NONE),
            }
            for key in granted
        ],
    }
