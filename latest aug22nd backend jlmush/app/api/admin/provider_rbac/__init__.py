"""Provider-staff RBAC — roles and permissions for the people who work for a
doctor, clinic or hospital.

Registered under ``/api/admin/provider-rbac``. This is the backend behind
Operations → Manage Roles & Permissions → Service Provider → <vertical>.

Two RBACs, on purpose. ``app/api/admin/rbac`` administers ADMIN roles: who on
the platform staff may open which admin screen. This one administers PROVIDER
roles: who inside a clinic may open which of that clinic's screens. They share
a vocabulary (roles, modules, the same eleven verbs) and nothing else — the
module key spaces don't overlap, and a row in one can never grant anything in
the other. See ``app/models/provider_staff.py`` for why that separation is
structural rather than stylistic.

Gate: SUPER_ADMIN / SUB_ADMIN by role, then ``@rbac_required`` on the
Operations modules, same as the rest of Operations — a sub-admin without
``operations_doctor`` granted reaches none of it.

Nothing here authenticates a staff member. There is no staff login yet;
``ProviderStaff.user_id`` is the seat for one and is null on every row.

The blueprint also carries the My Link relationship tiers
(``link_policy_routes``) — the same question from the other side: not what a
practice grants its own staff, but what one organisation may do to another when
a doctor calls them Partner, Associate or Employee.
"""
from flask import Blueprint

provider_rbac_bp = Blueprint('admin_provider_rbac', __name__)

from app.api.admin.provider_rbac import routes  # noqa: E402,F401
from app.api.admin.provider_rbac import link_policy_routes  # noqa: E402,F401
