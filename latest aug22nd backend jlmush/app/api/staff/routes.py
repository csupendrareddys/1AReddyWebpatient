"""Self-service routes for a signed-in provider staff member.

Everything resolves the staff row from ``current_user`` — never from a request
parameter — so there is nothing to tamper with. A staff member's identity is
the login they used; the practice, the roles and the grants all hang off that.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.provider_rbac import module_catalog
from app.api.admin.provider_rbac.service import ProviderPermissionService
from app.api.staff import staff_bp
from app.common.responses import (
    success_response, error_response, not_found_response, forbidden_response,
)
from app.common.staff_credentials import MIN_PASSWORD_LENGTH
from app.extensions import db
from app.models import (
    Clinic, Doctor, Hospital, ProviderStaff, StaffProviderType, UserRole,
)

logger = logging.getLogger(__name__)


def _me():
    """(staff, None) or (None, response).

    Two different failures, deliberately answered differently: a non-staff role
    is a wrong-portal mistake (403), while a PROVIDER_STAFF login with no staff
    row is a broken account — the login outlived the person's record — and that
    is a 404 the practice has to fix, not something the caller can retry.
    """
    if getattr(current_user, 'role', None) is not UserRole.PROVIDER_STAFF:
        return None, forbidden_response('This area is for provider staff accounts.')
    staff = ProviderStaff.query.filter_by(
        user_id=current_user.id, is_deleted=False,
    ).first()
    if staff is None:
        logger.warning('Staff login user=%s has no provider_staff row', current_user.id)
        return None, not_found_response('Your staff record')
    return staff, None


def _provider_summary(staff):
    """{type, id, name} for the practice this staff member works for.

    A doctor has no name column of its own — the display name lives on their
    User — so the doctor branch reads through the relationship instead of a
    ``.name`` attribute that doesn't exist.
    """
    provider_id = staff.provider_id
    name = None
    if staff.provider_type is StaffProviderType.DOCTOR:
        doctor = Doctor.query.filter_by(id=provider_id).first()
        user = doctor.user if doctor else None
        if user:
            name = ' '.join(p for p in (user.first_name, user.last_name) if p).strip() or None
    else:
        model = (Clinic if staff.provider_type is StaffProviderType.CLINIC
                 else Hospital)
        provider = model.query.filter_by(id=provider_id).first()
        name = provider.name if provider else None
    return {
        'type': staff.provider_type.value,
        'id': str(provider_id) if provider_id else None,
        'name': name,
    }


@staff_bp.route('/me', methods=['GET'])
@jwt_required()
def get_me():
    """Everything the staff dashboard needs to draw itself, in one call.

    ``modules`` is the FULL tree, not just the granted paths: the grants are
    leaves, and a client that only had those could render "Doctor Roster"
    without knowing it sits under Doctors & Network → Manage Doctors. The tree
    supplies the labels to hang the granted leaves off.
    """
    staff, err = _me()
    if err:
        return err

    return success_response(data={
        'staff': staff.to_dict(),
        'provider': _provider_summary(staff),
        'permissions': ProviderPermissionService.effective_for_staff(staff),
        'modules': module_catalog.tree_for(staff.provider_type.value),
        'roles': [
            a.role.name for a in staff.role_assignments
            if a.is_active and a.role and not a.role.is_deleted and a.role.is_active
        ],
    })


@staff_bp.route('/me/password', methods=['PUT'])
@jwt_required()
def change_my_password():
    """Change own password.

    A staff login is created FOR the person by their practice, so the first
    password is one somebody else chose and typed. Being able to replace it
    without going back through that person is the whole point of this route.
    """
    staff, err = _me()
    if err:
        return err

    data = request.get_json() or {}
    current_password = (data.get('current_password') or '').strip()
    new_password = (data.get('new_password') or '').strip()

    if not current_password or not new_password:
        return error_response('Current and new password are both required')
    if not current_user.check_password(current_password):
        return error_response('Current password is incorrect', status_code=400)
    if len(new_password) < MIN_PASSWORD_LENGTH:
        # Same floor ``ensure_staff_user`` applies when the practice sets the
        # initial password — a self-service reset must not be the cheap way
        # around it.
        return error_response(
            f'Password must be at least {MIN_PASSWORD_LENGTH} characters')

    current_user.set_password(new_password)
    db.session.commit()
    logger.info('Staff user=%s changed own password (staff=%s)',
                current_user.id, staff.id)
    return success_response(message='Password updated')
