"""Running one member's own endpoint as that member.

The mechanism behind every "act on behalf" surface in the codebase. It was
written for the admin Operations proxy (``app/api/admin/operations/
act_on_behalf.py``) and lives here because a second caller now needs it: a
clinic or hospital operating a doctor it is linked to in My Link
(``app/api/provider_link``).

What it does, and what it deliberately leaves to the caller
-----------------------------------------------------------
This module owns the *unsafe* part — swapping ``current_user`` and
re-dispatching to a view that was written for a different caller — and nothing
else. Deciding **who may do it**, **to whom**, and **which paths** is the
caller's job, because those answers differ completely between the two
surfaces: the admin proxy asks an RBAC permission, the link proxy asks what
relationship the doctor recorded. Keeping the authorisation out here is what
stops one surface's rules leaking into the other's.

So a caller is expected to, in order:

1. authorise itself and resolve the target,
2. check ``subpath`` against its own compiled allowlist (:func:`match_path`),
3. call :func:`dispatch_as`,
4. audit the write.

How the swap works
------------------
``flask_jwt_extended.current_user`` is a proxy over
``g._jwt_extended_jwt_user["loaded_user"]``. :func:`acting_as` swaps that one
``g`` key and restores it in a ``finally``. The nested view is invoked
*unwrapped* (:func:`inspect.unwrap` — every decorator in these stacks uses
``functools.wraps``) so its own ``@jwt_required()`` can't re-run the JWT user
lookup and clobber the swap. Skipping the nested decorator stack means the
caller owns whatever those decorators provided; see the note above each
caller's allowlist.

``source`` vs ``kind``
----------------------
Two different questions, and conflating them was the first bug waiting to
happen here.

``kind`` is *what sort of member* is being acted as — 'patient', 'doctor',
'clinic', 'hospital'. ``source`` is *which surface authorised it* — 'ops' for
the platform's admin desk, 'link' for a facility operating its own linked
doctor.

Code that widens behaviour for a support operator must ask for the SOURCE, not
the kind. ``/api/patient`` relaxes an OTP gate for the admin proxy; a clinic
must never inherit that by virtue of also being "a proxy". The two flags are
separate ``g`` keys so the narrower one can't be reached by accident.
"""
import inspect
import logging
import re
from contextlib import contextmanager

from flask import current_app, g, request
from werkzeug.exceptions import HTTPException, MethodNotAllowed, NotFound

from app.common.responses import error_response, not_found_response
from app.extensions import db

logger = logging.getLogger(__name__)

#: ``g`` key holding the member row being acted upon (Patient, Doctor, Clinic
#: or Hospital). The name is historical — it predates every proxy but the
#: patient one — and is kept because other modules read it through the
#: accessors below rather than by name.
IMPERSONATION_KEY = '_ops_acting_as_patient'

#: ``g`` key holding WHAT that member is: 'patient' | 'doctor' | 'clinic' |
#: 'hospital'.
IMPERSONATION_KIND_KEY = '_ops_acting_kind'

#: ``g`` key holding WHICH SURFACE authorised the swap: 'ops' | 'link'.
#: See the module docstring — this is the one to ask about before widening
#: anything for a support caller.
IMPERSONATION_SOURCE_KEY = '_ops_acting_source'

#: A uuid-ish path segment, for allowlist patterns. Loose on purpose: the real
#: ownership check happens inside the nested view, which scopes every lookup to
#: ``current_user`` — i.e. the member just swapped in.
ID_PATTERN = r'[0-9a-fA-F-]{8,}'


def compile_paths(paths):
    """Compile an allowlist of ``(pattern, methods, feature)`` triples.

    Anchored full matches, so a path not listed is refused rather than
    partially matched by a shorter neighbour.
    """
    return [
        (re.compile(rf'^{pattern}$'), methods, feature)
        for pattern, methods, feature in paths
    ]


def match_path(compiled, subpath, method):
    """Return ``(allowed, feature)`` for ``subpath`` + ``method``."""
    for pattern, methods, feature in compiled:
        if pattern.match(subpath):
            return method in methods, feature
    return False, None


@contextmanager
def acting_as(target, kind, user, actor, source='ops'):
    """Make ``flask_jwt_extended.current_user`` resolve to ``user`` in-block.

    Swaps only the ``loaded_user`` entry of ``g._jwt_extended_jwt_user`` — the
    raw token claims (``g._jwt_extended_jwt``) stay the caller's, so anything
    reading claims still sees who really called. Always restored.

    ``actor`` is published via ``profile_audit.set_acting_admin`` so provenance
    bookkeeping credits the real caller: inside this block ``current_user`` is
    the member, and reading it would log every delegated edit as a self-edit.
    """
    from app.common.profile_audit import acting_admin, set_acting_admin

    previous_jwt_user = g.get('_jwt_extended_jwt_user', None)
    previous_target = getattr(g, IMPERSONATION_KEY, None)
    previous_kind = getattr(g, IMPERSONATION_KIND_KEY, None)
    previous_source = getattr(g, IMPERSONATION_SOURCE_KEY, None)
    previous_actor = acting_admin()
    g._jwt_extended_jwt_user = {'loaded_user': user}
    setattr(g, IMPERSONATION_KEY, target)
    setattr(g, IMPERSONATION_KIND_KEY, kind)
    setattr(g, IMPERSONATION_SOURCE_KEY, source)
    set_acting_admin(actor)
    try:
        yield
    finally:
        g._jwt_extended_jwt_user = previous_jwt_user
        setattr(g, IMPERSONATION_KEY, previous_target)
        setattr(g, IMPERSONATION_KIND_KEY, previous_kind)
        setattr(g, IMPERSONATION_SOURCE_KEY, previous_source)
        set_acting_admin(previous_actor)


def acting_on_behalf(source=None, kind=None):
    """True when this request is an act-on-behalf dispatch.

    Pass ``source`` to require a particular surface ('ops' | 'link') and
    ``kind`` to require a particular member type. **Prefer naming the source.**
    A bare call means "any proxy at all", which is right only where a single
    proxy can reach the blueprint asking.
    """
    if getattr(g, IMPERSONATION_KEY, None) is None:
        return False
    if source is not None and getattr(g, IMPERSONATION_SOURCE_KEY, None) != source:
        return False
    return kind is None or getattr(g, IMPERSONATION_KIND_KEY, None) == kind


def acting_target():
    """The member row being acted upon, or ``None`` outside a dispatch."""
    return getattr(g, IMPERSONATION_KEY, None)


def acting_as_user_id():
    """The USER id being acted for, as a string, or ``None`` outside a dispatch.

    For the handful of places that need the acted-upon identity but can't read
    ``current_user`` to get it — chiefly the per-viewer pricing badges, which
    resolve the buyer from the raw token claims rather than the loaded user.
    Those claims stay the caller's by design, so without this they price the
    wrong person's membership.

    Stringified to match what ``get_jwt_identity()`` hands its callers.
    """
    target = acting_target()
    user_id = getattr(target, 'user_id', None) if target is not None else None
    return str(user_id) if user_id is not None else None


def resolve_view(subpath):
    """Resolve ``/api/v1/<subpath>`` to its *undecorated* view function + kwargs.

    Unwrapping is what lets the ``current_user`` swap survive: the decorated
    entry point would re-run ``@jwt_required()`` and reload the caller off the
    token. Every decorator in these stacks uses ``functools.wraps``, so
    ``inspect.unwrap`` reaches the route body.
    """
    adapter = current_app.url_map.bind(
        request.host,
        script_name=request.script_root or '/',
        url_scheme=request.scheme,
    )
    endpoint, view_args = adapter.match(f'/api/v1/{subpath}', method=request.method)
    view = current_app.view_functions.get(endpoint)
    if view is None:  # pragma: no cover — url_map and view_functions agree
        raise NotFound()
    return inspect.unwrap(view), view_args, endpoint


def dispatch_as(target, kind, source, actor, subpath, log_label='ACT_AS'):
    """Run ``/api/v1/<subpath>`` as ``target``. Returns ``(response, endpoint)``.

    Query string and body are forwarded implicitly: the nested view reads
    ``request.args`` / ``request.get_json()`` / ``request.files`` off this very
    request object.

    ``endpoint`` is ``None`` when the response is this function's own error —
    a caller stamping provenance by endpoint name uses that to tell "the view
    ran" from "it never got there".

    The caller must already have authorised the dispatch and matched
    ``subpath`` against its allowlist. Nothing here checks either.
    """
    try:
        view, view_args, endpoint = resolve_view(subpath)
    except MethodNotAllowed:
        return error_response('Method not allowed for this path.', status_code=405), None
    except NotFound:
        return not_found_response('Endpoint'), None

    with acting_as(target, kind, target.user, actor, source=source):
        try:
            response = view(**view_args)
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001 — mirror the nested routes' behaviour
            db.session.rollback()
            logger.exception(
                '[%s] failed %s=%s %s /api/v1/%s', log_label, kind,
                getattr(target, 'id', None), request.method, subpath,
            )
            return error_response('Act-on-behalf request failed.', status_code=500), None

    # Normalise (body, status) tuples / dicts to a Response so the status code
    # is readable — the nested views return whatever ``responses.py`` builds.
    resp = current_app.make_response(response)
    try:
        from app.common.client_context import audit_event
        audit_event('act_as.dispatch', source=source, target_kind=kind,
                    target=str(getattr(target, 'id', None)),
                    actor=str(getattr(actor, 'id', None)),
                    endpoint=endpoint, status=resp.status_code)
    except Exception:  # noqa: BLE001 — audit must not break the dispatch
        logger.exception('[ACT_AS] audit log failed')
    return resp, endpoint
