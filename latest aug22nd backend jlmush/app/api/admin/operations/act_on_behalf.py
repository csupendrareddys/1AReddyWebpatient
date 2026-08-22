"""Act-on-behalf proxy — run a member's own self-service endpoint as an admin.

Motivation
----------
The Operations patient detail screen has to offer *everything* a patient can
change from their own profile UI (personal details, contact, address,
emergency contact, insurance, female health, vitals, habits, surgeries,
health records + attachments, previous prescriptions, family/house group,
entity details) — and, since the booking surfaces were folded in, everything
a patient can *book*: consultations, marketplace services/products and group
health plans. The doctor detail screen wants the same deal for the provider
side: the doctor's own profile page (all its tabs) and their appointments.
Re-declaring each of those as a bespoke ``/operations/...`` route would fork
the validation, the feature gates and the allowlists — the exact drift the
section-editor allowlists in ``service.py`` warn about.

Instead there is ONE proxy per member type here, over shared machinery. Each
re-dispatches the request to the real self-service view function with
``current_user`` temporarily swapped for the target member, so that view's own
validation and service layer run untouched. The frontend reuses the very same
``ProfileSetting`` React components — the patient's and the doctor's; only the
URL prefix differs.

How the swap works
------------------
In :mod:`app.common.act_as`, which owns the ``current_user`` swap and the
re-dispatch for every act-on-behalf surface — this one and the facility link
proxy in :mod:`app.api.provider_link`. What stays HERE is everything that
decides *who may do it*: the RBAC gate on the routes, the allowlists below,
the plan re-gate and the audit. That split is the point — the two surfaces
answer "who is allowed" from completely different authorities and must not be
able to borrow each other's.

Skipping the nested decorator stack means this module owns what those
decorators provided:

* ``@jwt_required()`` / ``@role_required(PATIENT|DOCTOR)`` — replaced by the
  proxy's own ``@jwt_required()`` +
  ``@role_required([SUPER_ADMIN, SUB_ADMIN])`` +
  ``@rbac_required(OPERATIONS_PATIENT|OPERATIONS_DOCTOR, EDIT)``.
  PLATFORM_OWNER passes via the role decorator's documented bypass; a
  SUB_ADMIN passes only if the RBAC gate grants them that module, which is
  the check that actually decides who gets in. Being *in* is not the same as
  being senior: whether their edit applies on the spot or waits for a
  reviewer is a second question, answered by
  :func:`~app.common.profile_audit.self_approving_admin`.
* ``@feature_required(...)`` — re-applied explicitly from the allowlist's
  feature column so an admin can't edit a section the tenant's plan doesn't
  include.

Other safety properties:

* The target member is resolved with :meth:`OperationsService.get_patient` /
  :meth:`~OperationsService.get_doctor_member` /
  :meth:`~OperationsService.get_facility_member`, all tenant-scoped — an admin
  can never reach another tenant's member.
* Only paths on :data:`ALLOWED_PATHS` (patients), :data:`DOCTOR_ALLOWED_PATHS`
  (doctors) or :data:`FACILITY_ALLOWED_PATHS` (clinics + hospitals) are
  reachable. Booking is on the patient list (the Operations screen mounts the
  patient's own booking pages too), but ``/api/payment/*``, OTP and anything
  else gateway- or credential-shaped is deliberately absent — see the comment
  above the booking block.
* Every non-GET is written to ``OperatiosAuditLog`` with the resolved path.
"""
import logging
import re
from contextlib import contextmanager

from flask import g, request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.operations import operations_bp
from app.api.admin.operations.service import OperationsService
from app.common.act_as import (
    ID_PATTERN, IMPERSONATION_KEY, IMPERSONATION_KIND_KEY,
    acting_as_user_id, acting_on_behalf, compile_paths, dispatch_as, match_path,
)
from app.common.decorators import role_required, rbac_required
from app.common.profile_audit import (
    PROFILE_WRITE_ENDPOINTS, stamp_profile_update,
)
from app.common.responses import (
    success_response, error_response, not_found_response, forbidden_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    UserRole, PermissionModule, PermissionAction, record_ops_action,
)

logger = logging.getLogger(__name__)

_OPS = PermissionModule.OPERATIONS_PATIENT
_OPS_DOC = PermissionModule.OPERATIONS_DOCTOR

#: This proxy's surface name in ``app.common.act_as``. Anything that widens
#: behaviour for a support operator keys off THIS, not merely "some proxy is
#: running" — a facility operating its linked doctor goes through the same
#: machinery under source ``'link'`` and must not inherit an admin's latitude.
_SOURCE = 'ops'

# Re-exported for the two modules that still import them from here. The keys
# themselves, and everything that reads them, moved to ``app.common.act_as``
# when the link proxy became a second caller.
__all__ = [
    'ALLOWED_PATHS', 'DOCTOR_ALLOWED_PATHS', 'FACILITY_ALLOWED_PATHS',
    'IMPERSONATION_KEY', 'IMPERSONATION_KIND_KEY',
    'ops_acting_on_behalf', 'ops_acting_as_user_id',
]

# Sub-paths (relative to ``/api/``) the proxy will forward, with the methods
# allowed on each, and the plan feature each one needs (``None`` = ungated,
# i.e. part of ``patient.basic_info`` which every plan includes).
#
# The feature column mirrors the frontend's ``TAB_DEFS[].featurePath`` in
# ``ProfileSetting.jsx`` — keep the two in step.
#
# Anchored full-match regexes; a path not listed here is a 403, not a 404, so
# a typo in the frontend is obvious. UUID-ish segments match loosely — the
# real ownership check still happens inside the patient view, which scopes
# every lookup to ``current_user`` (i.e. the patient we swapped in).
_ID = ID_PATTERN
ALLOWED_PATHS = [
    # ── Profile sections (Personal tab, Insurance, Female Health) ──
    (r'patient/profile', {'GET', 'PUT'}, None),
    (r'patient/profile/personal-details', {'GET', 'PUT'}, 'patient.basic_info'),
    (r'patient/profile/contact-identity', {'GET', 'PUT'}, None),
    (r'patient/profile/address', {'GET', 'PUT'}, None),
    (r'patient/profile/emergency-contact', {'GET', 'PUT'}, None),
    (r'patient/profile/insurance', {'GET', 'PUT'}, 'patient.documents'),
    (r'patient/profile/female-health', {'GET', 'PUT'}, None),
    # "Who last changed this profile" — a read, surfaced to the patient and to
    # anyone acting on their behalf for accountability.
    (r'patient/profile/last-update', {'GET'}, None),
    # Per-section version of the same.
    (r'patient/profile/section-updates', {'GET'}, None),

    # ── Vitals / habits / surgeries ──
    (r'patient/vitals', {'GET', 'PUT'}, 'patient.vitals'),
    (r'patient/habits', {'GET', 'PUT'}, None),
    (r'patient/surgeries', {'GET', 'POST'}, 'patient.health_records'),

    # ── Health records (+ the Prescriptions tab, which is a by-type read) ──
    (r'patient/health-records', {'GET', 'POST'}, 'patient.health_records'),
    (rf'patient/health-records/{_ID}', {'GET', 'PUT', 'DELETE'}, 'patient.health_records'),
    (r'patient/health-records/by-type/[a-z_]+', {'GET'}, 'patient.health_records'),
    (rf'patient/health-records/{_ID}/attachments', {'GET', 'POST'}, 'patient.health_records'),
    (rf'patient/health-records/{_ID}/attachments/{_ID}', {'DELETE'}, 'patient.health_records'),

    # ── House / family group ──
    (r'patient/house-group', {'GET', 'POST'}, 'patient.family'),
    (rf'patient/house-group/{_ID}', {'PUT', 'DELETE'}, 'patient.family'),
    (rf'patient/house-group/{_ID}/permissions', {'PUT'}, 'patient.family'),
    (r'patient/house-group/requests', {'GET', 'POST'}, 'patient.family'),
    (rf'patient/house-group/requests/{_ID}/accept', {'POST'}, 'patient.family'),
    (rf'patient/house-group/requests/{_ID}/reject', {'POST'}, 'patient.family'),
    (rf'patient/house-group/requests/{_ID}/cancel', {'POST'}, 'patient.family'),
    (r'patient/house-group/generate-invite', {'POST'}, 'patient.family'),
    (r'patient/house-group/join/[A-Za-z0-9_-]+', {'POST'}, 'patient.family'),

    # ── Entity details tab ──
    (r'entity-profile/me', {'GET', 'PUT'}, None),

    # ── Profile picture ──
    # ``/api/profile/image`` sets ``current_user.profile_image``, so it has to
    # go through the swap: called unproxied from the Operations page it would
    # silently replace the ADMIN's photo with the one they picked for the
    # patient.
    (r'profile/image', {'POST'}, None),

    # ══════════════════════════════════════════════════════════════════════
    # Booking. Same reasoning as the profile block above: the Operations
    # screen mounts the patient's OWN booking pages, so the endpoints they
    # call have to be reachable here or the reused component 403s halfway
    # through a flow.
    #
    # Money still doesn't flow through this proxy. ``/api/payment/*`` is
    # absent on purpose — an admin has no way to complete the patient's
    # Razorpay checkout, and a proxy that could would be a proxy that can
    # charge someone else's card. Settlement is an explicit, audited,
    # offline-only Operations route instead: see ``settle_payment.py``.
    # ══════════════════════════════════════════════════════════════════════

    # ── Discovery + quoting (what the booking screens read) ──
    # ``patient/symptoms``, ``doctors/search``, ``doctors/match`` and
    # ``slot-availability-summary`` are public/tenant-scoped on the patient
    # side and don't read ``current_user``, so the frontend calls them
    # directly; they're listed anyway because the shared components don't
    # know which mode they're in and a 403 mid-flow is worse than a
    # redundant allowlist row.
    (r'patient/symptoms', {'GET'}, None),
    (r'patient/doctors/search', {'GET'}, None),
    (r'patient/doctors/match', {'POST'}, None),
    (r'patient/slot-availability-summary', {'GET'}, None),
    # The doctor directory + slot reads. Public / optional-JWT on the patient
    # side, but they price each slot against the CALLER's membership tier —
    # read unscoped, the booking screen would quote the admin's discount on
    # the patient's booking. Reads only; nothing here mutates a doctor.
    (r'doctor/list', {'GET'}, None),
    (rf'doctor/{_ID}/public', {'GET'}, None),
    (rf'doctor/{_ID}/slots', {'GET'}, None),
    (rf'doctor/{_ID}/slot-summary', {'GET'}, None),
    (rf'doctor/{_ID}/available-consultation-types', {'GET'}, None),
    # Per-buyer pricing: tier vouchers, health credits, offering blurbs.
    # These MUST be scoped — they answer "what does THIS patient pay?".
    (r'patient/member-offers', {'GET'}, None),
    (r'patient/redeem-code', {'POST'}, None),
    (r'patient/credits', {'GET'}, None),
    (r'patient/credits/quote', {'GET'}, None),
    (r'patient/offerings/features', {'GET'}, None),
    (r'membership/my-benefits', {'GET'}, None),
    # "Has this patient actually paid?" — the ledger behind every booking
    # above, and the first thing support reaches for after settling one.
    (r'patient/spending', {'GET'}, None),

    # ── Intake context (book-for + shared records, attached at booking) ──
    (r'patient/appointment-context', {'POST'}, 'patient.intake_forms'),
    (rf'patient/appointment-context/{_ID}',
     {'GET', 'PUT', 'DELETE'}, 'patient.intake_forms'),
    # ``/link`` carries no @feature_required on the patient route — it only
    # attaches an already-created context to an already-created booking.
    (rf'patient/appointment-context/{_ID}/link', {'POST'}, None),

    # ── Appointments ──
    # ``appointment`` (no trailing segment) is the create route; the nested
    # view gates consultation types from the body, which is why it carries no
    # static feature here either.
    (r'appointment', {'POST'}, None),
    (r'appointment/patient/upcoming', {'GET'}, None),
    (r'appointment/patient/history', {'GET'}, None),
    (rf'appointment/{_ID}/cancel', {'POST'}, None),
    (r'patient/follow-up-invites', {'GET'}, None),
    (rf'patient/follow-up-invites/{_ID}/book', {'POST'}, None),
    (rf'patient/orders/{_ID}', {'GET'}, None),
    (rf'patient/orders/{_ID}/documents', {'GET', 'POST'}, 'patient.documents'),
    (rf'patient/appointments/{_ID}/prescriptions', {'GET'}, None),
    # The Prescriptions / Documents hub lists — the patient's own tabs, reads
    # only. A support-staff caregiver (or admin) with the grant sees the same
    # rows the patient does.
    (r'patient/prescriptions', {'GET'}, None),
    (r'patient/documents', {'GET'}, None),

    # ── Services / products (marketplace) ──
    # No feature column: the patient routes carry no ``@feature_required``
    # either — ``clinic.marketplace`` is enforced by the route-level
    # FeatureGuard in the SPA, and gating harder here would block an admin
    # on a flow the patient themselves can still complete.
    (r'patient/marketplace/products', {'GET'}, None),
    (r'patient/marketplace/purchase', {'POST'}, None),
    (r'patient/marketplace/orders', {'GET'}, None),
    (rf'patient/marketplace/orders/{_ID}/attachment', {'POST'}, None),

    # ── Group offerings (health plans) ──
    # ``bookings`` can't be swallowed by the ``<id>`` pattern below it — the
    # id class is hex+dash only, and 'bookings' isn't.
    (r'patient/group-offerings', {'GET'}, None),
    (r'patient/group-offerings/bookings', {'GET'}, None),
    (rf'patient/group-offerings/{_ID}', {'GET'}, None),
    (rf'patient/group-offerings/{_ID}/teams', {'GET'}, None),
    (rf'patient/group-offerings/{_ID}/book', {'POST'}, None),

    # ── Service channels (so the bookings list can show what's open) ──
    (r'service-communication/channels', {'GET'}, None),
]

# ══════════════════════════════════════════════════════════════════════════
# DOCTOR paths.
#
# Same bargain as the patient list: the Operations doctor screen mounts the
# doctor's OWN ``ProfileSetting`` page, their OWN "My Appointments / Service
# List" page and their OWN "Manage Appointments / Services" page, so every
# endpoint those screens call has to be reachable or the reused component 403s
# halfway through a tab.
#
# Deliberately absent, and why:
#   * ``doctor/payouts*`` / ``salary-payouts*`` — claiming a payout moves money
#     to the doctor's bank account. Support can read the bank section (it's
#     part of the profile) but must not be able to trigger a disbursement in
#     someone else's name.
#   * ``group-offering-bookings/<id>/document*`` — the plan's completion
#     document. The plan-booking rows below name ``accept``/``reject``
#     explicitly rather than taking the whole subtree, and no Operations
#     surface drives that document yet.
#   * ``service-communication/channels/<id>/calls/<id>/join`` — admission to a
#     live A/V room with a patient. Presence rather than paperwork, and the
#     same line the appointment box draws around joining a consultation.
#
# The prescription, document and chat WRITES further down USED to be absent
# here for the same authorship reason, and were opened deliberately on the
# product owner's instruction. They are the sharpest capability this proxy
# grants — the patient sees the doctor's name on everything they produce — so
# read that block's header before touching them.
#
# The many endpoints these screens hit that are ALREADY doctor-id-parameterised
# and admin-callable (doctor-analytics, field-approval, doctor-attendance
# metrics) are not here on purpose: the frontend calls those directly as the
# admin, because they already take the target doctor as a path parameter.
# ══════════════════════════════════════════════════════════════════════════
DOCTOR_ALLOWED_PATHS = [
    # ── Profile Details tab (personal/professional, about, education,
    #    signatures, bank, declarations) + the presign helpers its uploads use ──
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
    # admin's own photo. For a doctor it also files the change through the
    # field-approval queue, which is the behaviour support wants anyway.
    (r'profile/image', {'POST'}, None),
    # Bank accounts. Read + edit the section, and the lifecycle actions the
    # doctor's own UI offers (confirm a ₹1 penny drop, pause, remove). None of
    # these disburse anything — that's ``payouts/*``, which is off the list.
    (r'doctor/profile/bank-accounts', {'GET', 'POST'}, None),
    (r'doctor/profile/bank-accounts/presign', {'GET'}, None),
    (rf'doctor/profile/bank-accounts/{_ID}', {'DELETE'}, None),
    (rf'doctor/profile/bank-accounts/{_ID}/confirm-penny-drop', {'POST'}, None),
    (rf'doctor/profile/bank-accounts/{_ID}/suspend', {'POST'}, None),

    # ── Account Status / Slot Visibility / Working Hours / Pricing tabs ──
    (r'doctor/account-state', {'GET'}, None),
    (r'doctor/slot-visibility', {'GET', 'PUT'}, None),
    # Working Hours and Consultation Pricing are two views of one schedule
    # document, which is why both tabs read and write this single path.
    (r'doctor/schedule', {'GET', 'PUT'}, 'doctor.calendar'),

    # ── Treatable Symptoms tab ──
    (r'doctor/symptoms', {'GET', 'PUT'}, None),
    (r'doctor/symptoms/available', {'GET'}, None),

    # ── Appointments ──
    # The list, the calendar, and the accept/reject decision on a request.
    # ``complete`` is absent with the prescription routes: the doctor's
    # "Complete Consultation" dialog posts a prescription, so the Operations
    # calendar is read-only rather than half-opening that flow.
    (r'doctor/appointments', {'GET'}, None),
    (r'doctor/appointments/calendar', {'GET'}, 'doctor.calendar'),
    (rf'doctor/appointments/{_ID}', {'GET'}, None),
    (rf'doctor/appointments/{_ID}/accept', {'POST'}, None),
    (rf'doctor/appointments/{_ID}/reject', {'POST'}, None),
    (rf'doctor/appointments/{_ID}/patient-context', {'GET'}, None),
    (rf'doctor/appointments/{_ID}/patient-vitals', {'PUT'}, 'patient.vitals'),
    (r'doctor/appointment-settings', {'GET', 'PUT'}, None),
    # "Verified" on an upcoming appointment. Lives on the attendance blueprint
    # and resolves the doctor from ``current_user``, so unlike the metrics
    # endpoints next to it, it genuinely needs the swap.
    (rf'doctor-attendance/appointments/{_ID}/verify', {'POST'}, None),

    # ── "Manage Appointments / Services" → Service List ──
    # The doctor's own catalog: which of the admin's products they sell, at
    # what price. ``doctor/products`` is the pickable catalog — it looks
    # tenant-wide but filters to what THIS doctor's specialization may offer,
    # so read unscoped it would list the admin's (empty) set and the Add
    # dialog would come up blank.
    #
    # No feature column, matching the patient marketplace block above: these
    # routes carry no ``@feature_required`` either. They gate on the doctor's
    # own plan offering (``service.offer``) inside the view, which is the
    # check that should decide — gating on the tenant's plan here would block
    # an admin on a flow the doctor themselves can still complete.
    (r'doctor/products', {'GET'}, None),
    (r'doctor/marketplace/my-products', {'GET', 'POST'}, None),
    (rf'doctor/marketplace/my-products/{_ID}', {'PUT', 'DELETE'}, None),

    # ── "Manage Appointments / Services" → Group Offering ──
    # ``invitations`` can't be swallowed by the ``<id>`` pattern below it —
    # the id class is hex+dash only, and 'invitations' isn't.
    (r'doctor/marketplace/service-groups', {'GET', 'POST'}, None),
    (r'doctor/marketplace/service-groups/invitations', {'GET'}, None),
    (rf'doctor/marketplace/service-groups/{_ID}', {'PUT', 'DELETE'}, None),
    (rf'doctor/marketplace/service-groups/{_ID}/respond', {'POST'}, None),
    # Co-doctor picker on the group dialog — the lead doctor's accepted care
    # network. A read, and one that has to be the doctor's: the admin's own
    # network is not who this group can be built from.
    (r'doctor/network/connections', {'GET'}, None),

    # ══════════════════════════════════════════════════════════════════════
    # The *tracking* side, i.e. the other half of "My Appointments / Service
    # List" beside the appointment rows above: who actually bought what, and
    # the accept/reject decision on each. It is the same support operation as
    # accepting an appointment request — a patient has paid and is waiting on
    # the provider to respond — so it belongs here for the same reason.
    #
    # Money doesn't move either way. Both accepts open chat channels and (for
    # a plan) write payout ROWS; claiming a payout is ``doctor/payouts*``,
    # which stays off the list.
    # ══════════════════════════════════════════════════════════════════════

    # ── "My Appointments / Service List" → Service List (incoming orders) ──
    (r'doctor/marketplace/sales', {'GET'}, None),
    (rf'doctor/marketplace/sales/{_ID}', {'PUT'}, None),

    # ── "My Appointments / Service List" → My Group Offering ──
    # Plan bookings on teams this doctor LEADS. ``incoming`` can't be swallowed
    # by the ``<id>`` rows below it — the id class is hex+dash only, and
    # 'incoming' isn't. ``<id>/document*`` is deliberately not matched here.
    (r'doctor/group-offering-bookings/incoming', {'GET'}, None),
    (rf'doctor/group-offering-bookings/{_ID}/accept', {'POST'}, None),
    (rf'doctor/group-offering-bookings/{_ID}/reject', {'POST'}, None),

    # ══════════════════════════════════════════════════════════════════════
    # Clinical records + conversations.
    #
    # The Operations screen mounts the doctor's "Prescriptions / Documents"
    # hub and their "Service Chats" page, so support can answer what they are
    # actually asked — where is this patient's prescription, why is that
    # document still unpublished, what did the doctor and the patient agree.
    #
    # These write, and knowingly so: authorship is the point. A prescription
    # is a clinical document issued in the doctor's name, and a chat message
    # reads to the patient as the doctor speaking. Nothing here marks the
    # difference to the recipient — the only record that an operator, not the
    # doctor, produced it is the ``OperatiosAuditLog`` row ``_proxy`` writes
    # on every non-GET, which is why that audit must not be weakened.
    #
    # ``/join`` on a call is absent: it admits someone to a live A/V room with
    # a patient, which is presence rather than paperwork, and the same line
    # the appointment box already draws around joining a consultation.
    # ══════════════════════════════════════════════════════════════════════

    # ── "Prescriptions / Documents" → Prescriptions ──
    # ``summary`` and ``pending-prescriptions`` can't be swallowed by the
    # ``<id>`` row: the id class is hex+dash only, and neither word is.
    (r'doctor/prescriptions', {'GET'}, 'doctor.prescriptions'),
    (r'doctor/prescriptions/summary', {'GET'}, None),
    (rf'doctor/prescriptions/{_ID}', {'GET', 'PUT', 'DELETE'}, None),
    (rf'doctor/prescriptions/{_ID}/revise', {'POST'}, None),
    (rf'doctor/prescriptions/{_ID}/follow-up', {'POST'}, None),
    (r'doctor/appointments/pending-prescriptions', {'GET'}, None),
    # Authoring one against an appointment. Anchoring keeps this clear of the
    # bare ``doctor/appointments/<id>`` read further up the list.
    (rf'doctor/appointments/{_ID}/prescription', {'POST'}, None),
    # The prescription form's own lookups. Doctor-blueprint reads that don't
    # resolve a doctor from ``current_user``, but they're role-gated, so an
    # admin calling them unproxied 403s and the form loses its medicine
    # search and its banned-drug check mid-compose.
    (r'doctor/medicines/search', {'GET'}, None),
    (r'doctor/banned-check', {'GET'}, None),

    # ── "Prescriptions / Documents" → Documents ──
    # The same lifecycle attached to a purchased service instead of an
    # appointment, including the manual-PDF path (``/document/upload``) and
    # the per-field attachments the clinical form collects.
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

    # ── "Service Chats" ──
    # The channels this doctor participates in, what is in them, and taking
    # part. Every one of these resolves the participant from ``current_user``
    # and 404s a non-participant, so they genuinely need the swap — called as
    # the admin they report that the doctor's conversations do not exist.
    (r'service-communication/channels', {'GET'}, None),
    (rf'service-communication/channels/{_ID}', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/messages', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/read', {'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls/propose', {'POST'}, None),
    # accept / cancel / end / leave — the scheduling decisions. ``join`` is
    # excluded on purpose (see the block header); listing the verbs rather
    # than ``[a-z]+`` is what keeps it excluded.
    (rf'service-communication/channels/{_ID}/calls/{_ID}/(accept|cancel|end|leave)',
     {'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents/{_ID}/download', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/timeline', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/forms', {'GET', 'POST'}, None),
]

# ══════════════════════════════════════════════════════════════════════════
# PROVIDER FACILITY paths — clinics and hospitals share this one list.
#
# Short on purpose. A facility's editable profile is its EntityProfile (legal
# and trade name, entity type, promoters, registration / CIN / GST / PAN),
# and ``/api/entity-profile/me`` is the ONLY endpoint that resolves a facility
# from ``current_user`` — everything else an admin does to a clinic or
# hospital (verify, reject, suspend the owner account, invite) already lives
# on ``/api/admin/clinics/<id>`` style routes that take the facility as a path
# parameter and are called as the admin, so they never come near this proxy.
#
# Note this is the same endpoint and the same section component the PATIENT
# proxy already carries at ``ALLOWED_PATHS`` — EntityProfile is polymorphic
# over hospital | clinic | patient. That's why the surface is one component
# reused three ways rather than three forms.
# ══════════════════════════════════════════════════════════════════════════
FACILITY_ALLOWED_PATHS = [
    (r'entity-profile/me', {'GET', 'PUT'}, None),
]

_COMPILED_FACILITY_PATHS = [
    (re.compile(rf'^{pattern}$'), methods, feature)
    for pattern, methods, feature in FACILITY_ALLOWED_PATHS
]

# ── BRANCH clinic act-on-behalf surface ───────────────────────────────────
# A main clinic (or a branch-scoped staff member) operates a login-less BRANCH
# through these self-service endpoints — the ones that resolve the facility from
# ``current_user``. Starts from the facility EntityProfile surface (already
# scope-aware on the frontend); widen as more branch-management screens become
# scope-aware. Everything else an admin does to a clinic takes the clinic as a
# path param and never comes near this proxy.
BRANCH_ALLOWED_PATHS = FACILITY_ALLOWED_PATHS + [
    (r'membership/me', {'GET'}, None),
    # ── Manage Doctors — the branch's affiliation roster + claim/invite/cancel.
    # All resolve the facility from current_user (the branch owner) once
    # ``_acting_as`` clears the cached parent principal.
    (r'affiliation/facility/doctors', {'GET'}, None),
    (r'affiliation/facility/request-by-code', {'POST'}, None),
    (rf'affiliation/facility/requests/{_ID}/cancel', {'POST'}, None),
    (r'affiliation/facility/doctors/invite', {'POST'}, None),
    # ── Network Requests inbox (doctor affiliation accept/reject).
    (r'facility/network/requests', {'GET'}, None),
    (rf'facility/network/requests/{_ID}/accept', {'POST'}, None),
    (rf'facility/network/requests/{_ID}/reject', {'POST'}, None),
]
_COMPILED_BRANCH_PATHS = [
    (re.compile(rf'^{pattern}$'), methods, feature)
    for pattern, methods, feature in BRANCH_ALLOWED_PATHS
]

_COMPILED_PATHS = [
    (re.compile(rf'^{pattern}$'), methods, feature)
    for pattern, methods, feature in ALLOWED_PATHS
]
_COMPILED_DOCTOR_PATHS = [
    (re.compile(rf'^{pattern}$'), methods, feature)
    for pattern, methods, feature in DOCTOR_ALLOWED_PATHS
]

# ── MINOR sub-profile extras ──────────────────────────────────────────────
# The guardian operates a login-less MINOR through a FULL replica of the
# patient app (profile, prescriptions/documents, service chats), so the minor
# proxy needs more than the Operations patient list. These are kept OFF
# ``ALLOWED_PATHS`` on purpose: that list is shared with the Operations admin
# proxy, and message-POST / document-upload / contact-OTP AS an adult patient
# is exactly the write-authorship the ops list deliberately withholds. The
# minor is the guardian's own dependent, so granting them here is safe.
MINOR_EXTRA_PATHS = [
    # Prescriptions / Documents hub (patient-facing lists).
    (r'patient/prescriptions', {'GET'}, None),
    (r'patient/documents', {'GET'}, None),
    # Contact-change OTP — verify a phone/email added to the minor's profile.
    (r'patient/send-otp', {'POST'}, None),
    (r'patient/verify-and-update', {'POST'}, None),
    # Service chats — the minor's side of the conversation (list is already on
    # ALLOWED_PATHS; these add the detail / messages / calls / docs / forms).
    (rf'service-communication/channels/{_ID}', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/messages', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/read', {'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls/propose', {'POST'}, None),
    (rf'service-communication/channels/{_ID}/calls/{_ID}/(accept|cancel|end|leave)',
     {'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents', {'GET', 'POST'}, None),
    (rf'service-communication/channels/{_ID}/documents/{_ID}/download', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/timeline', {'GET'}, None),
    (rf'service-communication/channels/{_ID}/forms', {'GET', 'POST'}, None),
]
_COMPILED_MINOR_PATHS = _COMPILED_PATHS + [
    (re.compile(rf'^{pattern}$'), methods, feature)
    for pattern, methods, feature in MINOR_EXTRA_PATHS
]


def _match_path(compiled, subpath, method):
    """Return ``(allowed, feature)`` for ``subpath``+``method``."""
    for pattern, methods, feature in compiled:
        if pattern.match(subpath):
            return method in methods, feature
    return False, None


@contextmanager
def _acting_as(target, kind, user, admin):
    """Make ``flask_jwt_extended.current_user`` resolve to ``user`` in-block.

    Swaps only the ``loaded_user`` entry of ``g._jwt_extended_jwt_user`` — the
    raw token claims (``g._jwt_extended_jwt``) stay the admin's, so anything
    reading claims still sees who really called. Always restored.

    ``admin`` is published via :func:`~app.common.profile_audit.set_acting_admin`
    so provenance bookkeeping credits the real caller: inside this block
    ``current_user`` is the member, and reading it would log every support
    edit as a self-edit.
    """
    from app.common.profile_audit import set_acting_admin

    previous_jwt_user = g.get('_jwt_extended_jwt_user', None)
    previous_target = getattr(g, IMPERSONATION_KEY, None)
    previous_kind = getattr(g, IMPERSONATION_KIND_KEY, None)
    previous_admin = acting_admin()
    # The provider principal is cached on ``g`` by whatever OUTER route resolved
    # it — the branch proxy calls ``current_principal()`` to authorise the
    # caller, which caches the PARENT clinic. Leaving that cached would make
    # ``acting_user()`` / ``current_principal()`` INSIDE the nested view keep
    # serving the parent (the nested @provider_access is stripped by
    # ``inspect.unwrap``, so it never re-resolves on its own). Clear it so the
    # nested view re-resolves against the swapped ``current_user`` — the branch's
    # own owner. Harmless elsewhere: non-provider proxies never set this.
    previous_principal = g.get('_provider_principal', None)
    g._jwt_extended_jwt_user = {'loaded_user': user}
    g._provider_principal = None
    setattr(g, IMPERSONATION_KEY, target)
    setattr(g, IMPERSONATION_KIND_KEY, kind)
    set_acting_admin(admin)
    try:
        yield
    finally:
        g._jwt_extended_jwt_user = previous_jwt_user
        g._provider_principal = previous_principal
        setattr(g, IMPERSONATION_KEY, previous_target)
        setattr(g, IMPERSONATION_KIND_KEY, previous_kind)
        set_acting_admin(previous_admin)


def ops_acting_on_behalf(kind=None):
    """True when this request is an **Operations** act-on-behalf proxy call.

    Self-service routes use this to widen an allowlist for IT-support edits
    the member can't self-serve (e.g. correcting a wrong phone number, which
    the patient UI gates behind OTP). Pinned to this proxy's source, so the
    facility link proxy — same machinery, different authority — never inherits
    a latitude that was granted to platform support.

    Pass ``kind`` ('patient' | 'doctor') to require a specific member type.
    """
    return acting_on_behalf(source=_SOURCE, kind=kind)


def ops_acting_as_user_id():
    """The USER id being acted for, as a string, or ``None`` outside a proxy.

    Unpinned on purpose, unlike :func:`ops_acting_on_behalf`: its callers want
    "who is this request about", which is the same question whoever authorised
    the swap. See :func:`app.common.act_as.acting_as_user_id`.
    """
    return acting_as_user_id()


def _proxy(target, kind, label, compiled_paths, subpath, stamp_provenance=False):
    """Run one self-service endpoint as ``target``. Shared by both routes.

    ``subpath`` is the path under ``/api/`` — e.g. ``patient/vitals``,
    ``doctor/schedule`` or ``entity-profile/me``. Query string and body are
    forwarded implicitly: the nested view reads ``request.args`` /
    ``request.get_json()`` / ``request.files`` off this very request object.
    """
    from app.api.pricing.service import FeatureDisabled, FeatureGate

    subpath = subpath.strip('/')
    allowed, feature = match_path(compiled_paths, subpath, request.method)
    if not allowed:
        logger.warning(
            '[OPS_ACT] blocked path %s=%s %s /api/%s actor=%s',
            kind, target.id, request.method, subpath, current_user.id,
        )
        return forbidden_response(
            'This endpoint is not available through act-on-behalf.'
        )

    if not target.user:
        return error_response(
            f'{label} has no linked user account.', status_code=400,
        )

    # Re-apply the plan gate the nested @feature_required would have enforced.
    # PLATFORM_OWNER keeps the same bypass it has on every other gated route.
    if feature and current_user.role != UserRole.PLATFORM_OWNER:
        try:
            FeatureGate.require_feature(current_tenant_id_strict(), feature)
        except FeatureDisabled:
            return error_response(
                "This section isn't available on your plan.",
                status_code=403, code='feature_disabled', data={'feature': feature},
            )

    # Resolve the proxy to the real User NOW. ``current_user`` is a LocalProxy
    # over the very ``g`` key ``acting_as`` is about to swap, so a reference to
    # it kept across the dispatch silently starts answering with the MEMBER —
    # which is how ``acting_admin()`` came to hand its callers the doctor and
    # every "was this a senior admin's edit?" check said no.
    actor = current_user._get_current_object()
    actor_id = actor.id

    response, endpoint = dispatch_as(
        target, kind, _SOURCE, actor, subpath, log_label='OPS_ACT',
    )

    if request.method != 'GET' and response.status_code < 400:
        # Audit AFTER the nested view committed its own work, and only when it
        # actually succeeded — a rejected edit must not leave a log row
        # claiming it happened.
        record_ops_action(
            actor_id, kind, target.id, 'act_on_behalf',
            {'method': request.method, 'path': f'/api/v1/{subpath}'},
        )
        db.session.commit()

        # Profile provenance. The nested blueprint's own after_request hook
        # can't do this — the request was handled by THIS blueprint — and it
        # would credit the impersonated member anyway. Stamp the real admin.
        # Patients only: ``profile_updated_*`` is a Patient column, and the
        # doctor profile has its own field-approval trail instead.
        if stamp_provenance and endpoint in PROFILE_WRITE_ENDPOINTS:
            stamp_profile_update(target, actor=actor)
            from app.common.profile_audit import ENDPOINT_SECTION, stamp_section_update
            _section = ENDPOINT_SECTION.get(endpoint)
            if _section:
                stamp_section_update(target, _section, actor=actor)

    return response


@operations_bp.route(
    '/patients/<patient_id>/act/<path:subpath>',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.EDIT)
def ops_act_on_behalf(patient_id, subpath):
    """Run one patient self-service endpoint as the target patient."""
    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    return _proxy(
        patient, 'patient', 'Patient', _COMPILED_PATHS, subpath,
        stamp_provenance=True,
    )


@operations_bp.route(
    '/doctor-members/<doctor_id>/act/<path:subpath>',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def ops_doctor_act_on_behalf(doctor_id, subpath):
    """Run one doctor self-service endpoint as the target doctor.

    Gated on ``OPERATIONS_DOCTOR`` rather than ``OPERATIONS_PATIENT`` so the
    two surfaces are grantable to different sub-admins — matching the doctor
    list/profile routes next door. An operator can hold the patient desk
    without the provider desk, or the reverse.
    """
    doctor = OperationsService.get_doctor_member(current_tenant_id_strict(), doctor_id)
    if not doctor:
        return not_found_response('Doctor')
    return _proxy(doctor, 'doctor', 'Doctor', _COMPILED_DOCTOR_PATHS, subpath)


@operations_bp.route(
    '/<vertical>-members/<facility_id>/act/<path:subpath>',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def ops_facility_act_on_behalf(vertical, facility_id, subpath):
    """Run one facility self-service endpoint as the target clinic/hospital.

    One route for both verticals — the models are the same shape and the
    allowlist is shared. ``vertical`` is validated against the known set
    rather than trusted, so an unknown segment 404s instead of reaching
    :meth:`OperationsService.get_facility_member` with a bad key.

    Gated on ``OPERATIONS_DOCTOR``: a clinic is a service provider, and the
    desk that handles providers handles their facilities. See the note above
    the facility list route in ``routes.py``.

    The impersonated user is the facility's ``admin_user_id`` owner — the
    person who registered it — which is what ``target.user`` resolves to.
    That relationship exists on Clinic and Hospital only so this works; both
    models spell the FK ``admin_user_id`` rather than ``user_id``.
    """
    from app.api.admin.operations.service import FACILITY_MODELS

    if vertical not in FACILITY_MODELS:
        return not_found_response('Member type')
    facility = OperationsService.get_facility_member(
        current_tenant_id_strict(), vertical, facility_id,
    )
    if not facility:
        return not_found_response(vertical.capitalize())
    return _proxy(
        facility, vertical, vertical.capitalize(),
        _COMPILED_FACILITY_PATHS, subpath,
    )


@operations_bp.route('/patients/<patient_id>/act-capabilities', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_act_capabilities(patient_id):
    """Expose the proxy allowlist so the UI can explain what it can reach."""
    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    return success_response(data={
        'paths': [
            {'path': p, 'methods': sorted(m), 'feature': f}
            for p, m, f in ALLOWED_PATHS
        ],
    })


@operations_bp.route('/doctor-members/<doctor_id>/act-capabilities', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def ops_doctor_act_capabilities(doctor_id):
    """Expose the doctor proxy allowlist so the UI can explain what it can reach."""
    doctor = OperationsService.get_doctor_member(current_tenant_id_strict(), doctor_id)
    if not doctor:
        return not_found_response('Doctor')
    return success_response(data={
        'paths': [
            {'path': p, 'methods': sorted(m), 'feature': f}
            for p, m, f in DOCTOR_ALLOWED_PATHS
        ],
    })
