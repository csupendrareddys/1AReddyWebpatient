"""
Acting on behalf of a practice.

Every provider endpoint in this codebase resolves the practice from whoever is
signed in — ``Clinic.query.filter_by(admin_user_id=current_user.id)``. That
conflates two different questions, *who is making this request* and *whose data
is this*, and it is exactly why a receptionist could sign in and then do
nothing: she is not her clinic's admin user, so every provider service looked
for a practice owned by her and found none.

This module separates the two. ``resolve_principal()`` answers "on whose behalf
is this request being made" and hands back the practice's own admin ``User``, so
the services underneath keep taking a User and need no change at all. That is
deliberate — rewriting every provider service to take a practice row would be a
far larger diff with far more places to get the scoping subtly wrong.

``@provider_access`` is what makes that safe. Borrowing the practice's identity
is an impersonation primitive, so it happens in exactly one place, only for a
route that has declared the module path and action it needs, and only when the
staff member's roles actually grant it. A route that forgets to declare a module
cannot be reached by staff at all — the failure mode is a locked door, not an
open one.

The practice owner passes every check without consulting a grant: they are not
staff, and they hold everything by construction. The permission check exists for
staff alone.
"""
import logging
from functools import wraps

from flask import g, request
from flask_jwt_extended import current_user, verify_jwt_in_request

from app.common.responses import forbidden_response, unauthorized_response
from app.models import (
    Clinic, Doctor, Hospital, ProviderStaff, ProviderStaffStatus,
    StaffProviderType, User, UserRole,
)

logger = logging.getLogger(__name__)

# Which provider row an owner-role signs in as, and the column that ties the
# row back to its owning User. A clinic is keyed by ``admin_user_id`` while a
# doctor is keyed by ``user_id``, hence the column name rather than a shared
# attribute that does not exist.
_OWNER_ROLES = {
    UserRole.DOCTOR: (StaffProviderType.DOCTOR, Doctor, 'user_id'),
    UserRole.CLINIC: (StaffProviderType.CLINIC, Clinic, 'admin_user_id'),
    UserRole.HOSPITAL: (StaffProviderType.HOSPITAL, Hospital, 'admin_user_id'),
}

_PROVIDER_MODELS = {
    StaffProviderType.DOCTOR: (Doctor, 'user_id'),
    StaffProviderType.CLINIC: (Clinic, 'admin_user_id'),
    StaffProviderType.HOSPITAL: (Hospital, 'admin_user_id'),
}

# The role a staff member's borrowed identity presents as, per vertical. The
# acting user IS the practice's admin User, so this is only a convenience for
# reading; nothing is mutated.
_ROLE_FOR_TYPE = {
    StaffProviderType.DOCTOR: UserRole.DOCTOR,
    StaffProviderType.CLINIC: UserRole.CLINIC,
    StaffProviderType.HOSPITAL: UserRole.HOSPITAL,
}


class ProviderAccessError(Exception):
    """Raised when the caller cannot act for any practice."""

    def __init__(self, message, status=403):
        super().__init__(message)
        self.message = message
        self.status = status


class Principal:
    """Who this request acts as, and what they are allowed to do.

    ``acting_user`` is the practice's own admin User in every case — for an
    owner that is simply themselves. Downstream services take this and behave
    identically whether a clinic admin or their receptionist made the call,
    which is the point: the authorisation decision is made here, once, instead
    of being re-derived by every service from the shape of the user.
    """

    __slots__ = ('acting_user', 'provider_type', 'provider', 'staff', '_grants')

    def __init__(self, acting_user, provider_type, provider, staff=None):
        self.acting_user = acting_user
        self.provider_type = provider_type
        self.provider = provider
        self.staff = staff
        self._grants = None

    @property
    def is_staff(self):
        return self.staff is not None

    @property
    def provider_name(self):
        """What to call this practice in a message to its staff.

        Clinics and hospitals carry ``name``; a Doctor doesn't — its name lives
        on the User behind it, as ``full_name``. Every refusal message names
        the practice, so getting this wrong turns a 403 into a 500, which is
        exactly what it did before this existed.
        """
        provider = self.provider
        if provider is None:
            return 'your practice'
        return (getattr(provider, 'name', None)
                or getattr(provider, 'full_name', None)
                or 'your practice')

    @property
    def grants(self):
        """``{module_key: grant}`` for staff; empty for an owner.

        Computed once per request. An owner never consults this — ``can()``
        short-circuits — so the union query does not run for them at all.
        """
        if self._grants is None:
            if self.staff is None:
                self._grants = {}
            else:
                # Imported here: the RBAC service imports models that import
                # this module's siblings, and a top-level import would close
                # the loop.
                from app.api.admin.provider_rbac.service import ProviderPermissionService
                self._grants = {
                    row['module']: row
                    for row in ProviderPermissionService.effective_for_staff(self.staff)
                }
        return self._grants

    def can(self, module_key, action='can_view'):
        """Does this principal hold ``action`` on ``module_key``?

        ``full_access`` is a shorthand for every column, so it satisfies any
        action asked of it — otherwise a role ticked "Full Access" and nothing
        else would grant nothing, which is the opposite of what the operator
        who ticked it meant.
        """
        if not self.is_staff:
            return True
        grant = self.grants.get(module_key)
        if not grant:
            return False
        return bool(grant.get('full_access') or grant.get(action))

    def data_range(self, module_key):
        """The window a staff member sees on a module, or None for an owner."""
        if not self.is_staff:
            return None
        grant = self.grants.get(module_key)
        return grant.get('data_range') if grant else None


def _staff_for(user):
    """The active, non-deleted staff row behind a PROVIDER_STAFF user.

    A staff member whose practice suspended them keeps their login but stops
    acting for anyone — the row is the authority on that, not the User.
    """
    return ProviderStaff.query.filter_by(
        user_id=user.id, is_deleted=False,
    ).filter(ProviderStaff.status == ProviderStaffStatus.ACTIVE).first()


def resolve_principal(user=None, passthrough_roles=None):
    """The practice this request acts for. Raises ``ProviderAccessError``.

    Owners resolve to themselves. Staff resolve to their anchor practice and
    borrow its admin User — the single point where that borrowing happens.

    ``passthrough_roles`` covers callers who are not providers but were already
    allowed on the route (an admin holding a facility's owner account, say).
    They act as themselves with no practice attached, which keeps the previous
    behaviour rather than quietly narrowing it.
    """
    user = user or current_user
    if not user:
        raise ProviderAccessError('Authentication required', status=401)

    if passthrough_roles and user.role in passthrough_roles:
        return Principal(user, None, None)

    entry = _OWNER_ROLES.get(user.role)
    if entry:
        provider_type, model, owner_column = entry
        provider = model.query.filter_by(
            **{owner_column: user.id}, is_deleted=False,
        ).first()
        if not provider:
            raise ProviderAccessError(
                'No provider profile is linked to this account yet.', status=404)
        return Principal(user, provider_type, provider)

    if user.role != UserRole.PROVIDER_STAFF:
        raise ProviderAccessError(
            'Only doctors, clinics, hospitals and their staff can use this.')

    staff = _staff_for(user)
    if not staff:
        raise ProviderAccessError(
            'Your staff account is not active. Ask your practice to re-enable it.')

    model, owner_column = _PROVIDER_MODELS[staff.provider_type]
    provider = model.query.filter_by(
        id=staff.provider_id, is_deleted=False,
    ).first()
    if not provider:
        raise ProviderAccessError(
            'The practice you work for is no longer available.', status=404)

    owner_user_id = getattr(provider, owner_column, None)
    acting_user = User.query.get(owner_user_id) if owner_user_id else None
    if not acting_user:
        raise ProviderAccessError(
            'The practice you work for has no active administrator account.',
            status=404)

    return Principal(acting_user, staff.provider_type, provider, staff=staff)


def current_principal(passthrough_roles=None):
    """The principal for this request, resolved once and cached on ``g``.

    Routes that went through ``@provider_access`` can read this instead of
    re-resolving; anything else calling it pays one resolution per request.

    The cache is KEYED BY the signed-in user id: ``g`` is per-request in
    production, but any environment that keeps one app context across
    identity switches (the test client does; a future in-process
    dispatch could) would otherwise serve user A's practice to user B —
    exactly the cross-principal leak this module exists to prevent.
    """
    from flask_jwt_extended import current_user

    uid = getattr(current_user, 'id', None)
    principal = getattr(g, '_provider_principal', None)
    if principal is None or getattr(g, '_provider_principal_uid', None) != uid:
        principal = resolve_principal(passthrough_roles=passthrough_roles)
        g._provider_principal = principal
        g._provider_principal_uid = uid
    return principal


def acting_user():
    """The User whose data this request is about — the practice's own admin.

    This is the drop-in for ``current_user`` inside provider routes: pass it
    where a service expects "the signed-in provider" and staff calls start
    resolving to the practice instead of to nobody.
    """
    return current_principal().acting_user


def acting_doctor():
    """The ``Doctor`` row this request acts for, or None.

    A doctor gets their own row; a doctor's assistant gets their employer's.
    This is what the doctor blueprint's resolution helpers call, so a route
    written years ago starts serving the assistant without being edited —
    provided the staff gate let the request through at all (see
    ``staff_prefix_gate``). The gate runs in ``before_request``, so by the time
    any handler asks for a doctor the decision has already been made.
    """
    user = current_user
    if not user:
        return None
    if getattr(user, 'role', None) != UserRole.PROVIDER_STAFF:
        doc = Doctor.query.filter_by(user_id=user.id, is_deleted=False).first()
        if doc:
            return doc
        # A clinic/hospital HEAD is also a practitioner — they reuse the full
        # doctor profile for their own details. They have no Doctor row from
        # signup, so auto-provision a backing one (get-or-create) the first
        # time they open the profile. It's invisible in doctor listings (those
        # filter on role == DOCTOR) and carries a FACILITY- placeholder
        # registration number the profile GET blanks for editing.
        if getattr(user, 'role', None) in (UserRole.CLINIC, UserRole.HOSPITAL):
            from app.extensions import db
            doc = Doctor(
                user_id=user.id, tenant_id=user.tenant_id,
                aadhar_number='', aadhar_attachment='',
                registration_number=f'FACILITY-{user.id}',
                registration_certificate='',
            )
            db.session.add(doc)
            db.session.commit()
            return doc
        return None
    try:
        principal = current_principal()
    except ProviderAccessError:
        return None
    if principal.provider_type != StaffProviderType.DOCTOR:
        return None
    return principal.provider


def acting_doctor_user_id():
    """The USER id behind the doctor this request acts for, or None.

    Some doctor services take a user id rather than a doctor row. For a doctor
    that is their own; for their assistant it is the doctor's, never the
    assistant's — passing the assistant's would silently find no doctor and
    404, which is precisely how this surfaced.
    """
    doctor = acting_doctor()
    return doctor.user_id if doctor else None


def delegated_role():
    """The owner role this request was delegated to act as, if any."""
    return getattr(g, '_staff_delegated_role', None)


def _action_for(method, overrides=None):
    """Default grant column per HTTP verb, before any per-rule override."""
    if overrides and method in overrides:
        return overrides[method]
    return {
        'GET': 'can_view', 'HEAD': 'can_view', 'OPTIONS': 'can_view',
        'POST': 'can_create', 'PUT': 'can_edit', 'PATCH': 'can_edit',
        'DELETE': 'can_delete',
    }.get(method, 'can_view')


def staff_prefix_gate(base, rules, vertical, public=()):
    """Build a ``before_request`` that gates staff on a path-prefix table.

    Written as a table rather than 100+ decorators, for a blueprint whose URLs
    are already grouped by feature — ``prescriptions/...`` is the prescriptions
    module however many routes hang off it. Fewer places to forget one.

    **Matching is on the route PATTERN, not the concrete path.** Flask has
    already matched the URL by the time a ``before_request`` runs, so
    ``request.url_rule`` gives ``<doctor_id>/metrics`` rather than a particular
    uuid. That makes an id-bearing segment ordinary matchable text, instead of
    something a rule has to recognise by shape and hope it guessed right.

    **Unlisted means denied.** A staff member reaching a pattern no rule
    matches is refused, so adding a route can only ever fail closed. ``public``
    lists the prefixes that are directory lookups rather than "my data" —
    those are left exactly as they are for everyone.

    ``rules`` is checked LONGEST PREFIX FIRST, so ``profile/bank-accounts`` can
    sit beside a plain ``profile`` catch-all without the shorter one swallowing
    it.

    On success the request is marked as delegated, which is what lets the
    untouched ``@role_required(UserRole.DOCTOR)`` downstream admit it.
    """
    ordered = sorted(rules.items(), key=lambda kv: -len(kv[0]))

    def gate():
        try:
            verify_jwt_in_request(optional=True)
        except Exception:  # noqa: BLE001 — a bad token is the view's problem
            return None
        user = current_user
        if not user or getattr(user, 'role', None) != UserRole.PROVIDER_STAFF:
            return None

        # No matched rule means Flask is about to 404 — let it, rather than
        # answering a nonexistent route with a permissions error.
        rule = getattr(request.url_rule, 'rule', None)
        if not rule:
            return None
        path = rule[len(base):].lstrip('/') if rule.startswith(base) else rule.lstrip('/')

        if any(path == p or path.startswith(f'{p}/') for p in public):
            return None

        try:
            principal = current_principal()
        except ProviderAccessError as exc:
            return forbidden_response(exc.message)
        # ``vertical=None`` means the table applies to a staff member of any
        # practice type — used by blueprints that deny all staff, where a
        # "wrong provider type" message would misdescribe the refusal.
        if vertical is not None and principal.provider_type != vertical:
            return forbidden_response('This is not available for your provider type.')

        for prefix, spec in ordered:
            if not (path == prefix or path.startswith(f'{prefix}/')):
                continue
            modules, overrides = spec if isinstance(spec, tuple) else (spec, None)
            modules = (modules,) if isinstance(modules, str) else modules
            action = _action_for(request.method, overrides)
            if any(principal.can(m, action) for m in modules):
                g._staff_delegated_role = _ROLE_FOR_TYPE[principal.provider_type]
                return None
            return forbidden_response(
                f'Your roles do not allow this. Ask {principal.provider_name} '
                f'to grant it.')

        return forbidden_response('Staff accounts cannot use this screen.')

    return gate


def delegated_user(modules, action='can_view'):
    """``(user, None)`` or ``(None, error_response)`` — for routes shared with
    non-providers.

    ``modules`` is one catalog path or several. Several matter because the same
    screen sits at a different path in each vertical — a facility's membership
    is ``billing.membership`` and a doctor's is ``practice.membership`` — and
    one handler serves both. Holding any of them is enough.

    ``@provider_access`` suits a route only providers reach. Some routes serve
    patients, doctors and facilities from the same handler (membership is the
    example: the subscription hangs off a User, whoever that User is). Those
    cannot take a decorator that refuses everyone who isn't a practice.

    So this leaves every other caller exactly as they were and only redirects a
    staff member — to their employer, and only if they hold the grant. A staff
    member with no grant gets a refusal rather than their own empty record,
    which would otherwise read as "your practice has no membership".
    """
    if getattr(current_user, 'role', None) != UserRole.PROVIDER_STAFF:
        return current_user, None
    try:
        principal = current_principal()
    except ProviderAccessError as exc:
        return None, forbidden_response(exc.message)
    wanted = (modules,) if isinstance(modules, str) else tuple(modules)
    if not any(principal.can(module, action) for module in wanted):
        return None, forbidden_response(
            f'Your roles do not allow this. Ask {principal.provider_name} to grant it.')
    return principal.acting_user, None


def provider_access(module=None, action='can_view', verticals=None,
                    passthrough_roles=None):
    """Gate a provider route, and resolve who it acts for.

    ``module`` is a leaf path from the module catalog and ``action`` a grant
    column. Both describe what a *staff* caller needs; an owner passes
    regardless. ``verticals`` restricts which practice types may reach the
    route at all (a doctor has no Manage Doctors screen), and applies equally
    to owners and to their staff.

    Omitting ``module`` means the route is owner-only: staff are refused
    outright rather than silently allowed. Routes get added faster than
    catalog entries do, and the default has to be the safe one.
    """
    allowed = set(verticals) if verticals else None

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            try:
                principal = current_principal(passthrough_roles=passthrough_roles)
            except ProviderAccessError as exc:
                if exc.status == 401:
                    return unauthorized_response(exc.message)
                return forbidden_response(exc.message)

            # A pass-through caller has no practice, so a vertical filter has
            # nothing to test them against and is not applied.
            if allowed and principal.provider_type is not None \
                    and principal.provider_type not in allowed:
                return forbidden_response(
                    'This is not available for your provider type.')

            if principal.is_staff:
                if not module:
                    return forbidden_response(
                        'Staff accounts cannot use this screen.')
                if not principal.can(module, action):
                    logger.info(
                        'Staff %s denied %s on %s',
                        principal.staff.id, action, module)
                    return forbidden_response(
                        f'Your roles do not allow this. Ask '
                        f'{principal.provider_name} to grant it.')

            return fn(*args, **kwargs)
        return wrapper
    return decorator
