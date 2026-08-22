"""
Admin Medicine Catalog Routes
CRUD for medicines, brands, banned list, and allergy master.
"""
import logging
from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, permission_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole, AdminPermission

logger = logging.getLogger(__name__)

medicine_bp = Blueprint('medicine_catalog', __name__)


# ═══════════════════════════════════════════════════════════════════════
#  GENERIC MEDICINES  (admin-managed catalog)
# ═══════════════════════════════════════════════════════════════════════

@medicine_bp.route('/medicines', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.DOCTOR])
def list_medicines():
    """
    List / search medicines.  Supports typeahead via ?search=... query param.
    Doctors can also call this for autocomplete while prescribing.
    """
    from app.models import Medicine, MedicineBrand

    search = request.args.get('search', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 30, type=int)
    active_only = request.args.get('active_only', 'true').lower() == 'true'

    q = Medicine.query.filter(Medicine.tenant_id == current_tenant_id_strict())
    if active_only:
        q = q.filter(Medicine.is_active == True)
    if search:
        like = f'%{search}%'
        q = q.filter(
            db.or_(
                Medicine.generic_name.ilike(like),
                Medicine.name.ilike(like),
                Medicine.composition.ilike(like),
            )
        )
    q = q.order_by(Medicine.generic_name, Medicine.name)
    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    return success_response(data={
        'medicines': [m.to_dict() for m in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@medicine_bp.route('/medicines', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def create_medicine():
    """Add a medicine to the catalog."""
    from app.models import Medicine, MedicineBrand, BannedMedicine

    data = request.get_json() or {}
    generic_name = (data.get('generic_name') or '').strip()
    brand_name = (data.get('name') or '').strip()

    if not generic_name and not brand_name:
        return error_response('generic_name or name is required', status_code=400)

    # Check duplicate
    if generic_name:
        dup = Medicine.query.filter(
            db.func.lower(Medicine.generic_name) == generic_name.lower(),
            Medicine.is_active == True,
        ).first()
        if dup:
            return error_response(
                f'A medicine with generic name "{generic_name}" already exists', status_code=409,
            )

    # Check banned list
    if generic_name:
        banned = BannedMedicine.query.filter(
            db.func.lower(BannedMedicine.generic_name) == generic_name.lower(),
            BannedMedicine.is_active == True,
        ).first()
        if banned:
            return error_response(
                f'"{generic_name}" is on the banned substances list. Reason: {banned.reason or "N/A"}',
                status_code=409,
            )

    # Optional brand link
    brand_id = data.get('brand_id')
    if not brand_id and data.get('brand_name'):
        brand = MedicineBrand.query.filter(
            db.func.lower(MedicineBrand.name) == data['brand_name'].strip().lower()
        ).first()
        if not brand:
            brand = MedicineBrand(name=data['brand_name'].strip())
            db.session.add(brand)
            db.session.flush()
        brand_id = brand.id

    med = Medicine(
        name=brand_name or generic_name,
        generic_name=generic_name,
        brand_id=brand_id,
        composition=data.get('composition'),
        form=data.get('form'),
        strength=data.get('strength'),
        requires_prescription=data.get('requires_prescription', True),
        mrp=data.get('mrp'),
    )
    db.session.add(med)
    db.session.commit()
    return created_response(data=med.to_dict(), message='Medicine added')


@medicine_bp.route('/medicines/<medicine_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def update_medicine(medicine_id):
    from app.models import Medicine, BannedMedicine
    med = Medicine.query.get(medicine_id)
    if not med:
        return not_found_response('Medicine not found')
    data = request.get_json() or {}

    # If generic_name is being changed, check for duplicates and banned list
    new_gn = (data.get('generic_name') or '').strip()
    if new_gn and new_gn.lower() != (med.generic_name or '').lower():
        # Check banned
        banned = BannedMedicine.query.filter(
            db.func.lower(BannedMedicine.generic_name) == new_gn.lower(),
            BannedMedicine.is_active == True,
        ).first()
        if banned:
            return error_response(
                f'"{new_gn}" is on the banned substances list', status_code=409,
            )
        # Check duplicate
        dup = Medicine.query.filter(
            db.func.lower(Medicine.generic_name) == new_gn.lower(),
            Medicine.is_active == True,
            Medicine.id != med.id,
        ).first()
        if dup:
            return error_response(
                f'A medicine with generic name "{new_gn}" already exists', status_code=409,
            )

    for f in ('name', 'generic_name', 'composition', 'form', 'strength', 'mrp', 'is_active', 'requires_prescription'):
        if f in data:
            setattr(med, f, data[f])
    db.session.commit()
    return success_response(data=med.to_dict(), message='Medicine updated')


@medicine_bp.route('/medicines/<medicine_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def delete_medicine(medicine_id):
    from app.models import Medicine
    med = Medicine.query.get(medicine_id)
    if not med:
        return not_found_response('Medicine not found')
    med.is_active = False
    db.session.commit()
    return success_response(message='Medicine deactivated')


# Bulk upload
@medicine_bp.route('/medicines/bulk', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def bulk_upload_medicines():
    """
    Upload many medicines at once.
    Body: { "medicines": [ { name, generic_name, form, strength, mrp, ... }, ... ] }
    Skips any generic names that are on the banned list.
    """
    from app.models import Medicine, BannedMedicine
    data = request.get_json() or {}
    items = data.get('medicines', [])
    created = 0
    skipped_banned = 0
    errors = []

    # Pre-load banned set for fast lookup
    banned_set = set(
        b.generic_name.lower() for b in
        BannedMedicine.query.filter(BannedMedicine.is_active == True).all()
    )
    # Pre-load existing medicines for duplicate check
    existing_set = set(
        m.generic_name.lower() for m in
        Medicine.query.filter(Medicine.is_active == True, Medicine.generic_name.isnot(None)).all()
    )
    skipped_duplicate = 0

    for i, item in enumerate(items):
        gn = (item.get('generic_name') or '').strip()
        bn = (item.get('name') or gn).strip()
        if not bn:
            errors.append(f'Row {i+1}: name or generic_name required')
            continue
        # Check banned list
        if gn and gn.lower() in banned_set:
            skipped_banned += 1
            errors.append(f'Row {i+1}: "{gn}" is on the banned list — skipped')
            continue
        # Check duplicate
        if gn and gn.lower() in existing_set:
            skipped_duplicate += 1
            errors.append(f'Row {i+1}: "{gn}" already exists — skipped')
            continue
        existing_set.add(gn.lower())  # track within this batch too
        med = Medicine(
            name=bn,
            generic_name=gn or None,
            form=item.get('form'),
            strength=item.get('strength'),
            mrp=item.get('mrp'),
            composition=item.get('composition'),
        )
        db.session.add(med)
        created += 1

    db.session.commit()
    return success_response(
        data={'created': created, 'skipped_banned': skipped_banned, 'skipped_duplicate': skipped_duplicate, 'errors': errors},
        message=f'{created} medicines uploaded' + (
            f', {skipped_banned} skipped (banned)' if skipped_banned else ''
        ) + (
            f', {skipped_duplicate} skipped (duplicate)' if skipped_duplicate else ''
        ),
    )


# ═══════════════════════════════════════════════════════════════════════
#  BANNED MEDICINES
# ═══════════════════════════════════════════════════════════════════════

@medicine_bp.route('/banned-medicines', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_banned_medicines():
    from app.models import BannedMedicine
    search = request.args.get('search', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 30, type=int)
    active_only = request.args.get('active_only', 'true').lower() == 'true'

    q = BannedMedicine.query.filter(BannedMedicine.tenant_id == current_tenant_id_strict())
    if active_only:
        q = q.filter(BannedMedicine.is_active == True)
    if search:
        q = q.filter(BannedMedicine.generic_name.ilike(f'%{search}%'))
    q = q.order_by(BannedMedicine.generic_name)
    paginated = q.paginate(page=page, per_page=per_page, error_out=False)

    return success_response(data={
        'banned_medicines': [b.to_dict() for b in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        },
    })


@medicine_bp.route('/banned-medicines', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def add_banned_medicine():
    from app.models import BannedMedicine, Medicine
    data = request.get_json() or {}
    generic_name = (data.get('generic_name') or '').strip()
    if not generic_name:
        return error_response('generic_name is required', status_code=400)

    existing = BannedMedicine.query.filter(
        db.func.lower(BannedMedicine.generic_name) == generic_name.lower(),
        BannedMedicine.is_active == True,
    ).first()
    if existing:
        return error_response('Already in banned list', status_code=409)

    # Cross-check: deactivate from medicines list if present
    conflicting_meds = Medicine.query.filter(
        db.func.lower(Medicine.generic_name) == generic_name.lower(),
        Medicine.is_active == True,
    ).all()
    for med in conflicting_meds:
        med.is_active = False

    banned = BannedMedicine(
        generic_name=generic_name,
        reason=data.get('reason'),
        banned_by=current_user.id,
    )
    db.session.add(banned)
    db.session.commit()

    msg = 'Medicine banned'
    if conflicting_meds:
        msg += f' (also removed {len(conflicting_meds)} matching entries from medicines list)'
    return created_response(data=banned.to_dict(), message=msg)


@medicine_bp.route('/banned-medicines/<banned_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def update_banned_medicine(banned_id):
    from app.models import BannedMedicine
    banned = BannedMedicine.query.get(banned_id)
    if not banned:
        return not_found_response('Not found')
    data = request.get_json() or {}

    new_gn = (data.get('generic_name') or '').strip()
    if new_gn and new_gn.lower() != (banned.generic_name or '').lower():
        # Check duplicate
        dup = BannedMedicine.query.filter(
            db.func.lower(BannedMedicine.generic_name) == new_gn.lower(),
            BannedMedicine.is_active == True,
            BannedMedicine.id != banned.id,
        ).first()
        if dup:
            return error_response(
                f'"{new_gn}" is already in the banned list', status_code=409,
            )

    for f in ('generic_name', 'reason', 'is_active'):
        if f in data:
            setattr(banned, f, data[f])
    db.session.commit()
    return success_response(data=banned.to_dict(), message='Banned medicine updated')


@medicine_bp.route('/banned-medicines/<banned_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def remove_banned_medicine(banned_id):
    from app.models import BannedMedicine
    banned = BannedMedicine.query.get(banned_id)
    if not banned:
        return not_found_response('Not found')
    banned.is_active = False
    db.session.commit()
    return success_response(message='Removed from banned list')


# Bulk upload banned
@medicine_bp.route('/banned-medicines/bulk', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_MEDICINE_CATALOG)
def bulk_upload_banned():
    from app.models import BannedMedicine, Medicine
    data = request.get_json() or {}
    items = data.get('banned_medicines', [])
    created = 0
    removed_from_medicines = 0
    for item in items:
        gn = (item.get('generic_name') or '').strip()
        if not gn:
            continue
        existing = BannedMedicine.query.filter(
            db.func.lower(BannedMedicine.generic_name) == gn.lower(),
            BannedMedicine.is_active == True,
        ).first()
        if existing:
            continue

        # Cross-check: deactivate from medicines list if present
        conflicting = Medicine.query.filter(
            db.func.lower(Medicine.generic_name) == gn.lower(),
            Medicine.is_active == True,
        ).all()
        for med in conflicting:
            med.is_active = False
            removed_from_medicines += 1

        db.session.add(BannedMedicine(
            generic_name=gn,
            reason=item.get('reason'),
            banned_by=current_user.id,
        ))
        created += 1
    db.session.commit()
    return success_response(
        data={'created': created, 'removed_from_medicines': removed_from_medicines},
        message=f'{created} entries added to banned list' + (
            f', {removed_from_medicines} removed from medicines list' if removed_from_medicines else ''
        ),
    )


# ═══════════════════════════════════════════════════════════════════════
#  ALLERGY MASTER
# ═══════════════════════════════════════════════════════════════════════

@medicine_bp.route('/allergies', methods=['GET'])
@jwt_required()
def list_allergies():
    """List all active allergies. Any authenticated user can read this."""
    from app.models import AllergyMaster
    search = request.args.get('search', '').strip()
    q = AllergyMaster.query.filter(
        AllergyMaster.tenant_id == current_tenant_id_strict(),
        AllergyMaster.is_active == True,
    )
    if search:
        q = q.filter(AllergyMaster.name.ilike(f'%{search}%'))
    return success_response(data={
        'allergies': [a.to_dict() for a in q.order_by(AllergyMaster.name).all()],
    })


@medicine_bp.route('/allergies', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_ALLERGY_CATALOG)
def create_allergy():
    from app.models import AllergyMaster
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('name is required', status_code=400)
    existing = AllergyMaster.query.filter(
        db.func.lower(AllergyMaster.name) == name.lower()
    ).first()
    if existing:
        return error_response('Allergy already exists', status_code=409)
    allergy = AllergyMaster(name=name, category=data.get('category'))
    db.session.add(allergy)
    db.session.commit()
    return created_response(data=allergy.to_dict(), message='Allergy added')


@medicine_bp.route('/allergies/<allergy_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_ALLERGY_CATALOG)
def delete_allergy(allergy_id):
    from app.models import AllergyMaster
    allergy = AllergyMaster.query.get(allergy_id)
    if not allergy:
        return not_found_response('Not found')
    allergy.is_active = False
    db.session.commit()
    return success_response(message='Allergy deactivated')


@medicine_bp.route('/allergies/bulk', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_ALLERGY_CATALOG)
def bulk_upload_allergies():
    from app.models import AllergyMaster
    data = request.get_json() or {}
    items = data.get('allergies', [])
    created = 0
    for item in items:
        name = (item.get('name') or '').strip()
        if not name:
            continue
        existing = AllergyMaster.query.filter(
            db.func.lower(AllergyMaster.name) == name.lower()
        ).first()
        if existing:
            continue
        db.session.add(AllergyMaster(name=name, category=item.get('category')))
        created += 1
    db.session.commit()
    return success_response(data={'created': created}, message=f'{created} allergies added')
