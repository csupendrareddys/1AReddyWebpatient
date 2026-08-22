"""Facility self-profile — the clinic/hospital HEAD (the facility's admin user)
views and edits their facility record + their own personal (head) details.

The facility record is resolved from ``admin_user_id`` (mirrors the
``entity_profile`` owner resolution). Head phone/email are encrypted and
verification-gated, so they are read-only here; name/gender/dob/photo and the
facility's own fields are directly editable.
"""
from datetime import date

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.facility_profile import facility_profile_bp
from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.extensions import db
from app.models import UserRole, Hospital, Clinic, Gender

_ROLES = [UserRole.CLINIC, UserRole.HOSPITAL]

# Facility columns that are NOT NULL — only overwritten when a non-empty value
# is supplied, so a blanked field can't violate the constraint.
_REQUIRED_FACILITY = ('name', 'address', 'city', 'state', 'pincode')
# Facility columns that may be cleared to NULL.
_OPTIONAL_FACILITY = ('registration_number', 'phone', 'email', 'website')
# Head-user text columns (nullable except first_name).
_HEAD_TEXT = ('middle_name', 'last_name', 'profile_image')


def _resolve_facility():
    """(kind, facility_row) for the caller, resolved via admin_user_id."""
    role = current_user.role
    if role == UserRole.HOSPITAL:
        f = Hospital.query.filter_by(
            admin_user_id=current_user.id, is_deleted=False).first()
        return 'hospital', f
    if role == UserRole.CLINIC:
        f = Clinic.query.filter_by(
            admin_user_id=current_user.id, is_deleted=False).first()
        return 'clinic', f
    return None, None


def _head_dict(user):
    return {
        'first_name': user.first_name,
        'middle_name': user.middle_name,
        'last_name': user.last_name,
        'gender': user.gender.value if user.gender else None,
        'dob': user.dob.isoformat() if user.dob else None,
        'profile_image': user.profile_image,
        # Read-only (encrypted + OTP-verified) — shown for reference.
        'phone_number': user.phone_number,
        'email': user.email,
    }


def _facility_dict(kind, f):
    d = {
        'id': str(f.id),
        'name': f.name,
        'registration_number': f.registration_number,
        'phone': getattr(f, 'phone', None),
        'email': getattr(f, 'email', None),
        'website': getattr(f, 'website', None),
        'address': f.address,
        'city': f.city,
        'state': f.state,
        'pincode': f.pincode,
        'verification_status': (
            f.verification_status.value if f.verification_status else None
        ),
    }
    if kind == 'hospital':
        d['hospital_type'] = getattr(f, 'hospital_type', None)
    return d


def _payload(kind, f):
    return {
        'kind': kind,
        'head': _head_dict(current_user),
        'facility': _facility_dict(kind, f),
    }


@facility_profile_bp.route('/profile', methods=['GET'])
@jwt_required()
@role_required(_ROLES)
def get_facility_profile():
    """The caller's facility record + head-user details."""
    kind, f = _resolve_facility()
    if not f:
        return error_response('Facility not found for this account', status_code=404)
    return success_response(data=_payload(kind, f))


@facility_profile_bp.route('/profile', methods=['PUT'])
@jwt_required()
@role_required(_ROLES)
def update_facility_profile():
    """Update the head-user personal fields + the facility record."""
    kind, f = _resolve_facility()
    if not f:
        return error_response('Facility not found for this account', status_code=404)

    data = request.get_json() or {}
    head = data.get('head') or {}
    facility = data.get('facility') or {}

    # ── Head user ──────────────────────────────────────────────────────
    if 'first_name' in head:
        current_user.first_name = (head.get('first_name') or '').strip()
    for k in _HEAD_TEXT:
        if k in head:
            v = head.get(k)
            setattr(current_user, k, (v.strip() if isinstance(v, str) else v) or None)
    if 'gender' in head:
        g = head.get('gender')
        try:
            current_user.gender = Gender(g) if g else None
        except ValueError:
            return error_response('Invalid gender', status_code=400)
    if 'dob' in head:
        raw = head.get('dob')
        if raw:
            try:
                current_user.dob = date.fromisoformat(raw)
            except ValueError:
                return error_response('Invalid dob — expected YYYY-MM-DD', status_code=400)
        else:
            current_user.dob = None

    # ── Facility record ────────────────────────────────────────────────
    for k in _REQUIRED_FACILITY:
        if facility.get(k):                 # never blank a NOT NULL column
            setattr(f, k, facility[k])
    for k in _OPTIONAL_FACILITY:
        if k in facility:
            v = facility.get(k)
            setattr(f, k, (v.strip() if isinstance(v, str) else v) or None)
    if kind == 'hospital' and 'hospital_type' in facility:
        f.hospital_type = facility.get('hospital_type') or None

    db.session.commit()
    return success_response(data=_payload(kind, f), message='Profile saved.')
