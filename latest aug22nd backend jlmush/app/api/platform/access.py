"""platform_access — who may operate the vendor console.

Replaces the blanket ``role_required(PLATFORM_OWNER)`` on ``/platform``
endpoints so the console stops being single-seat:

* PLATFORM_OWNER passes everything, as before.
* VENDOR-tenant staff enter by RBAC — SUPER_ADMIN passes outright
  (the same bypass the product side gives that role), SUB_ADMIN needs
  the (module, action) grant from an assigned role. The grantable
  vocabulary is the vendor catalog in ``modules_for_tenant``.
* Staff of any OTHER tenant never pass, whatever their role: the check
  is tenant identity first, role second, permission third.

Must be used AFTER ``@jwt_required()``.
"""
import logging
from functools import wraps

from flask_jwt_extended import current_user

from app.common.responses import forbidden_response
from app.models import UserRole

logger = logging.getLogger(__name__)


def platform_access(module, action):
    """Guard one console endpoint with a vendor-catalog (module, action)."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user
            if user is None:
                return forbidden_response('Authentication required')
            if user.role == UserRole.PLATFORM_OWNER:
                return fn(*args, **kwargs)
            if user.role not in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN):
                return forbidden_response('Access denied')

            from app.models import Tenant
            tenant = Tenant.query.filter_by(
                id=user.tenant_id, is_deleted=False).first()
            if tenant is None or not tenant.is_platform:
                logger.debug(
                    '[PLATFORM_ACCESS] non-vendor staff refused user=%s',
                    user.id)
                return forbidden_response('Access denied')

            if user.role == UserRole.SUPER_ADMIN:
                return fn(*args, **kwargs)

            from app.models import PermissionService
            profile = user.admin_profile
            if profile is None or not PermissionService.check(
                    profile, module, action):
                return forbidden_response(
                    'You do not have access to this area')
            return fn(*args, **kwargs)
        return wrapper
    return decorator
