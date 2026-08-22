"""Administering the My Link relationship tiers.

Sits on the provider-RBAC blueprint because it answers the same question from
the other side. That screen says *what a practice may grant its own staff*;
this says *what one organisation may do to another* when a doctor calls them
Partner, Associate or Employee. Both are "who can do what to a provider", both
belong to the provider desk, and both are gated on ``OPERATIONS_DOCTOR``.

They are not the same mechanism and shouldn't be merged. A staff role is
assigned by a practice to a person it employs; a relationship is declared by
the DOCTOR about an organisation, and no operator assigns it. What is editable
here is only what each relationship *means* — never who holds one.

**Cells, not endpoints.** A PUT names (relationship, section, access). It
cannot name a route, which is what keeps the permanent exclusions — a doctor's
bank accounts, their payouts, joining a live call — out of reach of any
configuration: they are on no section's path list at all. An editor over routes
would have been an editor that could grant them.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.provider_rbac import provider_rbac_bp
from app.api.provider_link.authority import (
    ACCESS_LABELS, ACCESS_LEVELS, DEFAULT_MATRIX, NONE, SECTION_LABELS,
    SECTION_PATHS, TIER_SUMMARY, matrix,
)
from app.common.decorators import role_required, rbac_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    LinkRelationshipPolicy, PermissionAction, PermissionModule, UserRole,
)

logger = logging.getLogger(__name__)

_OPS_DOC = PermissionModule.OPERATIONS_DOCTOR

#: Weakest first, so the UI can render the tiers as a ladder rather than in
#: whatever order a dict iterates.
_TIER_ORDER = ('partner', 'associate', 'employee')


def _payload():
    """The whole matrix, with everything the editor needs to explain itself."""
    resolved = matrix()
    return {
        'access_levels': [
            {'key': key, 'label': ACCESS_LABELS[key]} for key in ACCESS_LEVELS
        ],
        'sections': [
            {
                'key': key,
                'label': SECTION_LABELS[key],
                # How much of the doctor's API the section covers. Shown so an
                # operator ticking a box has some sense of its weight.
                'endpoint_count': len(SECTION_PATHS[key]),
            }
            for key in SECTION_LABELS
        ],
        'relationships': [
            {
                'key': tier,
                'label': tier.title(),
                'summary': TIER_SUMMARY.get(tier, ''),
                'access': {
                    section: resolved.get(tier, {}).get(section, NONE)
                    for section in SECTION_LABELS
                },
                # The shipped ladder, so the editor can show what was changed
                # and offer a way back to it.
                'defaults': {
                    section: DEFAULT_MATRIX.get(tier, {}).get(section, NONE)
                    for section in SECTION_LABELS
                },
            }
            for tier in _TIER_ORDER
        ],
    }


@provider_rbac_bp.route('/link-relationships', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def get_link_relationship_policy():
    """The current matrix for this tenant, plus the shipped defaults."""
    return success_response(data=_payload())


@provider_rbac_bp.route('/link-relationships', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def update_link_relationship_policy():
    """Save the matrix.

    Takes the whole thing rather than one cell: an operator reasons about a
    relationship as a row, and a per-cell endpoint would let a half-applied
    save leave a tier in a state nobody chose.

    A cell equal to the shipped default is DELETED rather than stored. Only
    real exceptions live in the table, so "what did this tenant change?" is
    answerable by looking at it, and a later change to the defaults reaches
    every tenant that hadn't deliberately opted out.
    """
    data = request.get_json() or {}
    incoming = data.get('relationships') or {}
    if not isinstance(incoming, dict):
        return error_response('relationships must be an object.', status_code=400)

    tenant_id = current_tenant_id_strict()
    existing = {
        (row.relationship, row.section): row
        for row in LinkRelationshipPolicy.query.filter_by(tenant_id=tenant_id).all()
    }

    changed = 0
    for tier, cells in incoming.items():
        if tier not in DEFAULT_MATRIX:
            return error_response(f"Unknown relationship '{tier}'.", status_code=400)
        if not isinstance(cells, dict):
            return error_response(
                f"'{tier}' must map sections to an access level.", status_code=400)
        for section, access in cells.items():
            if section not in SECTION_PATHS:
                return error_response(f"Unknown section '{section}'.", status_code=400)
            if access not in ACCESS_LEVELS:
                return error_response(
                    f"'{access}' is not an access level.", status_code=400)

            default = DEFAULT_MATRIX.get(tier, {}).get(section, NONE)
            row = existing.get((tier, section))
            if access == default:
                if row is not None:
                    db.session.delete(row)
                    changed += 1
                continue
            if row is None:
                db.session.add(LinkRelationshipPolicy(
                    relationship=tier, section=section, access=access,
                    updated_by_id=getattr(current_user, 'id', None),
                ))
                changed += 1
            elif row.access != access:
                row.access = access
                row.updated_by_id = getattr(current_user, 'id', None)
                changed += 1

    db.session.commit()
    logger.info(
        '[LINK_POLICY] tenant=%s actor=%s cells_changed=%s',
        tenant_id, getattr(current_user, 'id', None), changed,
    )

    # Recompute from the DB rather than echoing the request: what the next
    # request will enforce is the only answer worth returning.
    from flask import g
    for key in ('_link_relationship_matrix', '_link_relationship_paths'):
        if hasattr(g, key):
            delattr(g, key)
    return success_response(
        data=_payload(),
        message=f'{changed} change(s) saved.' if changed else 'No changes.',
    )
