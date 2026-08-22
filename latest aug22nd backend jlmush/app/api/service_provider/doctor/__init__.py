"""
Doctor Module - Blueprint Registration

A doctor's own support staff (an assistant, a practice manager) reach these
routes too, acting for the doctor who employs them. That is gated by one
before_request over a path-prefix table rather than by ~129 decorators — see
``staff_access.py`` for the table and ``app.common.provider_access`` for the
mechanism. Anything the table doesn't name is refused to staff, so a route
added later fails closed instead of inheriting a neighbour's rule.
"""
from flask import Blueprint

from app.common.provider_access import staff_prefix_gate

doctor_bp = Blueprint('doctor', __name__)

# Import routes AFTER blueprint creation to avoid circular imports
# The routes module will import doctor_bp from this file
from . import routes  # noqa
from . import document_routes  # noqa  — /documents hub, sibling of prescriptions
from . import network_routes  # noqa  — care-network endpoints on the same bp
from . import service_group_routes  # noqa  — group service offerings
from . import group_offering_routes  # noqa  — admin-plan payout earnings
from . import holding_routes  # noqa  — vendor holding-page (account-state)

from .staff_access import (  # noqa: E402
    DOCTOR_PUBLIC_PREFIXES, DOCTOR_STAFF_RULES, DOCTOR_VERTICAL,
)

doctor_bp.before_request(staff_prefix_gate(
    base='/api/v1/doctor',
    rules=DOCTOR_STAFF_RULES,
    vertical=DOCTOR_VERTICAL,
    public=DOCTOR_PUBLIC_PREFIXES,
))
