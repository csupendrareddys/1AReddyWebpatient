"""Operations module — admin IT-support surfaces (act on behalf).

Registered under ``/api/admin/operations``. Open to SUPER_ADMIN and SUB_ADMIN
(and PLATFORM_OWNER by bypass), but ``@role_required`` is only the coarse cut:
every route also carries ``@rbac_required(OPERATIONS_*, <action>)``, which is a
no-op for super_admin/platform_owner and IS the real gate for a sub-admin —
they reach nothing here without that module granted on an assigned role.

Getting in and being trusted to self-approve are separate questions. A
sub-admin junior to
:data:`~app.common.profile_audit.SELF_APPROVE_MIN_ROLE_LEVEL` can make the same
support edits, but theirs land in the approvals queue exactly like the member's
own would; a senior one's apply on submission. See
:func:`~app.common.profile_audit.self_approving_admin`.
"""
from flask import Blueprint

operations_bp = Blueprint('admin_operations', __name__)

from app.api.admin.operations import routes  # noqa: E402,F401
from app.api.admin.operations import act_on_behalf  # noqa: E402,F401
from app.api.admin.operations import settle_payment  # noqa: E402,F401
