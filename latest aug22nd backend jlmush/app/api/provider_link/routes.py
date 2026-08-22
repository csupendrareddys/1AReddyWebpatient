"""A facility's My Link doctors, and operating one of them.

Mounted at ``/api/facility/link``.

Two things live here, and the first was missing entirely. My Link connections
are stored doctor-side (``CareNetworkConnection.doctor_id`` is always the
doctor; the facility is the *target*), and every read of them sat on
``/api/doctor/network/*`` behind ``@role_required(DOCTOR)``. So a clinic could
be linked to a dozen doctors and had no way to see it — its own My Link page
showed an empty Affiliations tab. :func:`list_linked_doctors` is that read,
from the facility's side.

The second is the Operation Page: the facility running one of those doctors'
own screens, with the breadth decided by the relationship the doctor declared.
See :mod:`app.api.provider_link.authority` for the ladder and for why the
relationship is a sound basis for it at all.

Authorisation is two independent checks, and both must pass:

1. **May this caller act for the facility?** ``@provider_access`` — the owner
   passes by construction, their staff need ``doctors_network.linked_doctors``
   at the action the verb implies. A facility's practice manager can be given
   this; a receptionist with a view-only grant reads and cannot write.
2. **May the facility act on this doctor?** An active ``context='link'``
   connection between the two, whose ``relationship_type`` maps to a tier that
   holds the requested path.

Neither check subsumes the other: the first is about the person, the second
about the two organisations.
"""
import logging

from flask import request
from flask_jwt_extended import current_user

from app.api.provider_link import provider_link_bp
from app.api.provider_link.authority import describe, paths_for, tier_for
from app.common.act_as import dispatch_as, match_path
from app.common.provider_access import current_principal, provider_access
from app.common.responses import (
    success_response, error_response, forbidden_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    CareNetworkConnection, Doctor, StaffProviderType, record_ops_action,
)

logger = logging.getLogger(__name__)

#: The catalog leaf a staff member needs to reach any of this. Owners never
#: consult it. New — so no existing role grants it, and this surface opens for
#: staff only when somebody deliberately ticks it.
_MODULE = 'doctors_network.linked_doctors'

_FACILITIES = [StaffProviderType.CLINIC, StaffProviderType.HOSPITAL]

#: ``connection_type`` and the target column, per facility vertical. A link row
#: names the facility in one of three mutually exclusive columns, so the
#: vertical decides which one to filter on.
_TARGET_COLUMN = {
    StaffProviderType.CLINIC: ('clinic', 'target_clinic_id'),
    StaffProviderType.HOSPITAL: ('hospital', 'target_hospital_id'),
}


def _facility_links():
    """``(principal, query)`` over this facility's active My Link rows.

    Raises nothing: the vertical was already checked by ``@provider_access``,
    so ``_TARGET_COLUMN`` cannot miss.
    """
    principal = current_principal()
    connection_type, column = _TARGET_COLUMN[principal.provider_type]
    query = CareNetworkConnection.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        context='link',
        status='active',
        connection_type=connection_type,
        **{column: principal.provider.id},
    )
    return principal, query


def _link_row(conn):
    """One linked doctor, with what the relationship allows over them."""
    doctor = conn.doctor
    tier = tier_for(conn.relationship_type)
    return {
        'connection_id': str(conn.id),
        'doctor_id': str(doctor.id) if doctor else None,
        'name': doctor.full_name if doctor else None,
        'contact': doctor.user.phone_number if (doctor and doctor.user) else None,
        'registration_number': getattr(doctor, 'registration_number', None),
        'relationship_type': conn.relationship_type,
        'linked_at': conn.created_at.isoformat() if conn.created_at else None,
        **describe(tier),
    }


def _resolve_target(doctor_id):
    """``(doctor, tier)`` for a doctor this facility may operate.

    Returns ``(None, error_response)``-shaped failure through the caller: a
    doctor who exists but is not linked, and one who does not exist at all,
    are the same answer from here — 404. Distinguishing them would let a
    facility enumerate the tenant's doctors by id.
    """
    _, query = _facility_links()
    conn = query.filter_by(doctor_id=doctor_id).first()
    if conn is None:
        return None, None, not_found_response('Linked doctor')

    doctor = conn.doctor
    if doctor is None or doctor.is_deleted:
        return None, None, not_found_response('Linked doctor')

    tier = tier_for(conn.relationship_type)
    return doctor, tier, None


@provider_link_bp.route('/doctors', methods=['GET'])
@provider_access(module=_MODULE, action='can_view', verticals=_FACILITIES)
def list_linked_doctors():
    """Every doctor affiliated to this facility through My Link."""
    _, query = _facility_links()
    rows = query.order_by(CareNetworkConnection.created_at.desc()).all()
    return success_response(data={
        'doctors': [_link_row(c) for c in rows if c.doctor and not c.doctor.is_deleted],
    })


@provider_link_bp.route('/doctors/<doctor_id>', methods=['DELETE'])
@provider_access(module=_MODULE, action='can_delete', verticals=_FACILITIES)
def unlink_doctor(doctor_id):
    """Delink — end this facility's My Link affiliation with a doctor.

    The facility's half of the revocation; the doctor's is
    ``DELETE /api/doctor/network/connections/<id>``. Either party can end it
    alone, because consent is needed to start a relationship and not to leave
    one — and because the alternative is a facility stuck advertising an
    affiliation it no longer has.

    Ending it removes this facility's control immediately: the connection is
    what :func:`link_act_on_behalf` resolves against, so the next request finds
    nothing and 404s. It cannot be undone from this side either — every path
    that creates a My Link row runs on the doctor's blueprint, so a facility
    can drop a doctor but never re-add one.
    """
    from app.api.service_provider.doctor.network_service import DoctorNetworkService

    principal, query = _facility_links()
    conn = query.filter_by(doctor_id=doctor_id).first()
    if conn is None:
        return not_found_response('Linked doctor')

    doctor = conn.doctor
    tier = tier_for(conn.relationship_type)
    DoctorNetworkService.remove_connection(conn)

    record_ops_action(
        current_user.id, 'doctor', conn.doctor_id, 'link_removed',
        {
            'relationship': tier,
            'facility_type': principal.provider_type.value,
            'facility_id': str(principal.provider.id),
        },
    )
    db.session.commit()

    name = doctor.full_name if doctor else 'That doctor'
    return success_response(message=f'{name} is no longer linked to your practice.')


@provider_link_bp.route('/doctors/<doctor_id>/capabilities', methods=['GET'])
@provider_access(module=_MODULE, action='can_view', verticals=_FACILITIES)
def linked_doctor_capabilities(doctor_id):
    """What this facility may do to one linked doctor, and under what name.

    The Operation Page builds its tab strip from this rather than from a copy
    of the ladder, so a tier that grants nothing renders as an explanation
    instead of an empty dialog.
    """
    doctor, tier, failure = _resolve_target(doctor_id)
    if failure is not None:
        return failure
    return success_response(data={
        'doctor_id': str(doctor.id),
        'name': doctor.full_name,
        **describe(tier),
    })


@provider_link_bp.route(
    '/doctors/<doctor_id>/act/<path:subpath>',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
)
@provider_access(module=_MODULE, action='can_view', verticals=_FACILITIES)
def link_act_on_behalf(doctor_id, subpath):
    """Run one of the doctor's own endpoints as that doctor.

    ``@provider_access`` asks only for ``can_view`` because that is the floor
    for reaching this route at all; a non-GET is re-checked against
    ``can_edit`` below. Declaring ``can_edit`` on the decorator instead would
    lock a view-only staff member out of the reads too.
    """
    from app.api.pricing.service import FeatureDisabled, FeatureGate

    principal = current_principal()
    if request.method != 'GET' and not principal.can(_MODULE, 'can_edit'):
        return forbidden_response(
            f'Your roles allow viewing linked doctors, not acting for them. '
            f'Ask {principal.provider_name} to grant it.')

    doctor, tier, failure = _resolve_target(doctor_id)
    if failure is not None:
        return failure

    subpath = subpath.strip('/')
    allowed, feature = match_path(paths_for(tier), subpath, request.method)
    if not allowed:
        logger.info(
            '[LINK_ACT] blocked %s %s /api/%s facility=%s doctor=%s tier=%s',
            principal.provider_type, request.method, subpath,
            principal.provider.id, doctor.id, tier,
        )
        return forbidden_response(
            describe(tier)['summary'] if not tier
            else 'This screen is not part of a '
                 f'{(tier or "").title()} relationship.')

    if not doctor.user:
        return error_response(
            'That doctor has no linked user account.', status_code=400)

    # The plan gate the nested ``@feature_required`` would have applied. The
    # tenant is the same for both parties, so this is the doctor's own gate.
    if feature:
        try:
            FeatureGate.require_feature(current_tenant_id_strict(), feature)
        except FeatureDisabled:
            return error_response(
                "This section isn't available on your plan.",
                status_code=403, code='feature_disabled', data={'feature': feature},
            )

    # Resolve the caller to a real User before the swap — ``current_user`` is a
    # LocalProxy over the very ``g`` key ``acting_as`` replaces, and a
    # reference held across the dispatch starts answering with the DOCTOR.
    actor = current_user._get_current_object()
    actor_id = actor.id

    response, _endpoint = dispatch_as(
        doctor, 'doctor', 'link', actor, subpath, log_label='LINK_ACT',
    )

    if request.method != 'GET' and response.status_code < 400:
        # After the nested view committed, and only if it succeeded — a
        # refused edit must not leave a log row claiming it happened.
        record_ops_action(
            actor_id, 'doctor', doctor.id, 'link_act_on_behalf',
            {
                'method': request.method,
                'path': f'/api/v1/{subpath}',
                'relationship': tier,
                'facility_type': principal.provider_type.value,
                'facility_id': str(principal.provider.id),
            },
        )
        db.session.commit()

    return response
