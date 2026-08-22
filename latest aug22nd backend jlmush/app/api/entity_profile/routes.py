"""Entity-profile endpoints — the logged-in account's own EntityProfile.

Owner is resolved from the caller's role: HOSPITAL/CLINIC via the facility they
admin, PATIENT via their own profile. Phase 1 covers the entity type + core
text fields (numbers). Logos, document attachments and authorized personnel are
layered on later.

A facility's own staff reach this too, when their roles grant a leaf under
``entity_profile.entity_details``. They resolve to their employer's profile —
see ``app.common.provider_access``. Patients are unaffected and keep the plain
role gate, since a patient has no staff.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.entity_profile import entity_profile_bp
from app.common.decorators import role_required
from app.common.provider_access import ProviderAccessError, current_principal
from app.common.responses import (
    success_response, error_response, forbidden_response,
)
from app.extensions import db
from app.models import (
    EntityProfile, EntityType, StaffProviderType, UserRole, Hospital, Clinic,
    Patient, DocumentVerificationStatus,
)
from app.services.s3_service import S3Service

_OWNER_ROLES = [UserRole.HOSPITAL, UserRole.CLINIC, UserRole.PATIENT]

_FACILITIES = [StaffProviderType.CLINIC, StaffProviderType.HOSPITAL]

# One screen, four sub-tabs, one endpoint behind all of them. A staff member
# holding any leaf of Entity Details can read the record; the finer split is
# what the tabs show, not what the server returns.
M_DETAILS = 'entity_profile.entity_details.entity_type_name'
_DETAIL_LEAVES = (
    'entity_profile.entity_details.entity_type_name',
    'entity_profile.entity_details.registration_licence',
    'entity_profile.entity_details.tax_identifiers',
    'entity_profile.entity_details.promoters',
)


def _staff_holds_any_detail(action):
    """True if a staff caller holds ``action`` on any Entity Details leaf.

    The four leaves are tabs of one record, and the endpoint returns the whole
    record either way. Requiring a specific leaf would mean a staff member
    granted only "Tax Identifiers" gets nothing, which is not what granting it
    was meant to do.
    """
    try:
        principal = current_principal()
    except ProviderAccessError:
        return False
    if not principal.is_staff:
        return True
    return any(principal.can(leaf, action) for leaf in _DETAIL_LEAVES)

_CORE_FIELDS = (
    'entity_name', 'legal_name', 'trade_name', 'promoters',
    'year_of_establishment', 'registration_license_number',
    'cin_number', 'gst_number', 'pan_number',
)

# Public brand/entity images — column prefix per upload ``kind``.
_IMAGE_KINDS = {'logo', 'entity_logo', 'entity_image'}
# Private statutory documents — column prefix per upload ``kind``.
_DOC_KINDS = {'registration_license', 'cin', 'gst', 'pan'}


def _enriched_dict(ep):
    """``to_dict()`` plus presigned URLs for the private statutory docs
    (the model omits them; the private bucket needs a signed URL)."""
    data = ep.to_dict()
    for kind in _DOC_KINDS:
        key = getattr(ep, f'{kind}_doc_s3_key', None)
        bucket = getattr(ep, f'{kind}_doc_s3_bucket', None)
        if key and isinstance(data.get(kind), dict):
            data[kind]['doc_url'] = (
                S3Service.generate_presigned_url(bucket, key) if bucket
                else S3Service.get_signed_url(key)
            )
    return data


def _owner_kwargs():
    """Resolve {hospital_id|clinic_id|patient_id} for the current user, or None."""
    role = current_user.role
    if role == UserRole.HOSPITAL:
        h = Hospital.query.filter_by(admin_user_id=current_user.id, is_deleted=False).first()
        return {'hospital_id': h.id} if h else None
    if role == UserRole.CLINIC:
        c = Clinic.query.filter_by(admin_user_id=current_user.id, is_deleted=False).first()
        return {'clinic_id': c.id} if c else None
    if role == UserRole.PATIENT:
        p = Patient.query.filter_by(user_id=current_user.id, is_deleted=False).first()
        return {'patient_id': p.id} if p else None
    if role == UserRole.PROVIDER_STAFF:
        # A staff member edits their employer's record, never one of their own.
        try:
            principal = current_principal()
        except ProviderAccessError:
            return None
        if principal.provider_type not in _FACILITIES:
            return None
        key = ('clinic_id' if principal.provider_type == StaffProviderType.CLINIC
               else 'hospital_id')
        return {key: principal.provider.id}
    return None


def _get_or_create(owner):
    """The owner's PRIMARY entity — created if none exists yet."""
    ep = (EntityProfile.query
          .filter_by(is_deleted=False, is_primary=True, **owner)
          .first())
    if not ep:
        # Fall back to any existing row (legacy) and promote it, else create.
        ep = EntityProfile.query.filter_by(is_deleted=False, **owner).first()
        if ep:
            ep.is_primary = True
        else:
            ep = EntityProfile(tenant_id=current_user.tenant_id, is_primary=True, **owner)
            db.session.add(ep)
        db.session.commit()
    return ep


def _resolve_entity(owner, entity_id):
    """A specific entity of this owner by id, or the primary when id is None.
    Returns None if the id doesn't belong to the owner."""
    if not entity_id:
        return _get_or_create(owner)
    return (EntityProfile.query
            .filter_by(id=entity_id, is_deleted=False, **owner)
            .first())


@entity_profile_bp.after_request
def _stamp_profile_provenance(response):
    """Entity Details is a tab of the patient profile, so a save here counts
    as a profile edit. Mirrors the patient blueprint's hook; a no-op for
    hospital/clinic accounts, which have no Patient row to stamp.
    """
    from flask import request as _req
    from app.common.profile_audit import PROFILE_WRITE_ENDPOINTS, stamp_profile_update

    if (
        _req.method == 'GET'
        or response.status_code >= 400
        or _req.endpoint not in PROFILE_WRITE_ENDPOINTS
        or current_user.role != UserRole.PATIENT
    ):
        return response
    patient = Patient.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    stamp_profile_update(patient)
    return response


@entity_profile_bp.route('/me', methods=['GET'])
@jwt_required()
@role_required(_OWNER_ROLES + [UserRole.PROVIDER_STAFF])
def get_my_entity_profile():
    if not _staff_holds_any_detail('can_view'):
        return forbidden_response('Your roles do not allow viewing entity details.')
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    return success_response(data=_enriched_dict(_get_or_create(owner)))


@entity_profile_bp.route('/me/entities', methods=['GET'])
@jwt_required()
@role_required(_OWNER_ROLES)
def list_my_entities():
    """All entities attached to this owner (primary first)."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    _get_or_create(owner)  # ensure at least the primary exists
    rows = (EntityProfile.query
            .filter_by(is_deleted=False, **owner)
            .order_by(EntityProfile.is_primary.desc(), EntityProfile.created_at.asc())
            .all())
    return success_response(data={'entities': [_enriched_dict(e) for e in rows]})


@entity_profile_bp.route('/me/entities', methods=['POST'])
@jwt_required()
@role_required(_OWNER_ROLES)
def create_my_entity():
    """Attach an additional (non-primary) entity to this owner. Optionally
    copy the primary's core info (``copy_from_primary``)."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    data = request.get_json() or {}

    new = EntityProfile(tenant_id=current_user.tenant_id, is_primary=False, **owner)
    if data.get('copy_from_primary'):
        primary = _get_or_create(owner)
        for f in ('entity_type',) + _CORE_FIELDS:
            setattr(new, f, getattr(primary, f))
    if 'entity_type' in data:
        try:
            new.entity_type = EntityType(data['entity_type'])
        except ValueError:
            return error_response('Invalid entity_type.', status_code=400)
    for f in _CORE_FIELDS:
        if f in data:
            setattr(new, f, data[f])
    db.session.add(new)
    db.session.commit()
    return success_response(data=_enriched_dict(new), message='Entity added.')


@entity_profile_bp.route('/me/entities/<entity_id>/primary', methods=['POST'])
@jwt_required()
@role_required(_OWNER_ROLES)
def set_primary_entity(entity_id):
    """Make one entity the primary; demote the current primary."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    target = _resolve_entity(owner, entity_id)
    if not target:
        return error_response('Entity not found.', status_code=404)
    # Demote everything else first so the partial-unique index never conflicts.
    EntityProfile.query.filter_by(is_deleted=False, **owner).update({'is_primary': False})
    target.is_primary = True
    db.session.commit()
    return success_response(data=_enriched_dict(target), message='Primary entity updated.')


@entity_profile_bp.route('/me/entities/<entity_id>', methods=['DELETE'])
@jwt_required()
@role_required(_OWNER_ROLES)
def delete_my_entity(entity_id):
    """Soft-delete a non-primary entity. The primary cannot be deleted
    (set another entity primary first)."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    target = _resolve_entity(owner, entity_id)
    if not target:
        return error_response('Entity not found.', status_code=404)
    if target.is_primary:
        return error_response('Cannot delete the primary entity.', status_code=400)
    target.is_deleted = True
    db.session.commit()
    return success_response(data={'id': str(target.id)}, message='Entity removed.')


@entity_profile_bp.route('/me', methods=['PUT'])
@jwt_required()
@role_required(_OWNER_ROLES + [UserRole.PROVIDER_STAFF])
def update_my_entity_profile():
    if not _staff_holds_any_detail('can_edit'):
        return forbidden_response('Your roles do not allow editing entity details.')
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    data = request.get_json() or {}
    ep = _resolve_entity(owner, data.get('entity_id'))
    if not ep:
        return error_response('Entity not found.', status_code=404)

    if 'entity_type' in data:
        try:
            ep.entity_type = EntityType(data['entity_type'])
        except ValueError:
            return error_response('Invalid entity_type.', status_code=400)

    for f in _CORE_FIELDS:
        if f in data:
            setattr(ep, f, data[f])

    try:
        db.session.commit()
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        return error_response(f'Failed to save entity profile: {exc}', status_code=400)

    return success_response(data=_enriched_dict(ep), message='Entity details saved.')


@entity_profile_bp.route('/me/image', methods=['POST'])
@jwt_required()
@role_required(_OWNER_ROLES)
def upload_entity_image():
    """Upload a public entity image — ``kind`` in {logo, entity_logo,
    entity_image}, multipart field ``file``. Persists url/s3_key/s3_bucket."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    kind = (request.form.get('kind') or '').strip()
    if kind not in _IMAGE_KINDS:
        return error_response(
            f'kind must be one of {sorted(_IMAGE_KINDS)}.', status_code=400)
    file_obj = request.files.get('file')
    if not file_obj or not file_obj.filename:
        return error_response('No file provided.', status_code=400)

    ep = _resolve_entity(owner, request.form.get('entity_id'))
    if not ep:
        return error_response('Entity not found.', status_code=404)
    try:
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='image',
            original_filename=file_obj.filename, is_private=False,
            folder='entity-media',
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(f'Upload failed: {exc}', status_code=400)

    url = S3Service.get_public_url(
        result['s3_bucket'], result['s3_key'], result.get('s3_region'))
    setattr(ep, f'{kind}_url', url)
    setattr(ep, f'{kind}_s3_key', result['s3_key'])
    setattr(ep, f'{kind}_s3_bucket', result['s3_bucket'])
    db.session.commit()
    return success_response(data=_enriched_dict(ep), message='Image uploaded.')


@entity_profile_bp.route('/me/document', methods=['POST'])
@jwt_required()
@role_required(_OWNER_ROLES)
def upload_entity_document():
    """Upload a private statutory document — ``kind`` in {registration_license,
    cin, gst, pan}, multipart field ``file``, optional ``number``. A fresh
    upload resets verification to PENDING (re-approval required)."""
    owner = _owner_kwargs()
    if not owner:
        return error_response('No entity owner found for this account.', status_code=404)
    kind = (request.form.get('kind') or '').strip()
    if kind not in _DOC_KINDS:
        return error_response(
            f'kind must be one of {sorted(_DOC_KINDS)}.', status_code=400)
    file_obj = request.files.get('file')
    if not file_obj or not file_obj.filename:
        return error_response('No file provided.', status_code=400)

    ep = _resolve_entity(owner, request.form.get('entity_id'))
    if not ep:
        return error_response('Entity not found.', status_code=404)
    try:
        result = S3Service.upload_file(
            file_obj=file_obj, asset_type='medical_document',
            original_filename=file_obj.filename, is_private=True,
            folder='entity-documents',
        )
    except Exception as exc:  # noqa: BLE001
        return error_response(f'Upload failed: {exc}', status_code=400)

    number = request.form.get('number')
    if number is not None:
        setattr(ep, f'{kind}_number', number.strip())
    setattr(ep, f'{kind}_doc_s3_key', result['s3_key'])
    setattr(ep, f'{kind}_doc_s3_bucket', result['s3_bucket'])
    setattr(ep, f'{kind}_doc_url', result['s3_key'])  # signed at read time
    # A new file must be re-verified.
    setattr(ep, f'{kind}_doc_verification_status', DocumentVerificationStatus.PENDING)
    db.session.commit()
    return success_response(data=_enriched_dict(ep), message='Document uploaded.')
