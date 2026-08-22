"""
Admin Group Offering (multidisciplinary healthcare plan) builder routes.

  GET    /admin/group-offerings?status=draft|published|archived|all
  GET    /admin/group-offerings/<id>
  POST   /admin/group-offerings                 (create draft)
  PUT    /admin/group-offerings/<id>            (update basics + slots)
  POST   /admin/group-offerings/<id>/publish    (validate + publish)
  POST   /admin/group-offerings/<id>/archive
  GET    /admin/group-offerings/candidates?qualification_id=<cat>

Admin-only (SUPER_ADMIN / SUB_ADMIN). This is the new admin-authored plan
builder; the doctor-led ``MarketplaceServiceGroup`` flow is separate and
untouched. Phase 1 = plan + qualification slots + budget validation + publish
gate. Payment schedule / taxes / payout wiring come in later phases.
"""
import logging

from flask import request, Blueprint
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    UserRole, GroupOffering, GroupOfferingMember, GroupOfferingInstallment,
    Category, Doctor, ProfileEducationSpecialization, ProfileWorkQualification,
)
from app.models.catalog import CATEGORY_TYPE_GROUP_OFFERING
from app.models.group_offering import DURATION_PRESET_DAYS
from app.extensions import db

logger = logging.getLogger(__name__)

group_offerings_bp = Blueprint('group_offerings_admin', __name__)

_MANAGE_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]
_VALID_STATUSES = {'draft', 'published', 'archived'}


def _resolve_duration(duration_type, duration_value):
    """Return the day count for a duration, resolving presets."""
    if duration_type in DURATION_PRESET_DAYS:
        return DURATION_PRESET_DAYS[duration_type]
    try:
        return max(1, int(duration_value or 0))
    except (TypeError, ValueError):
        return 1


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _snapshot_names(tid, ids):
    """Resolve category names for a list of ids (order preserved)."""
    if not ids:
        return []
    rows = {str(c.id): c.name for c in Category.query.filter(
        Category.tenant_id == tid, Category.id.in_(ids),
    ).all()}
    return [rows.get(str(i)) for i in ids]


def _normalize_eligibility(tid, m):
    """Normalize a slot's doctor-eligibility rule (the same model a service
    uses): any-of specialization ids + any-of work-qualification ids + a DNF
    experience rule. Accepts the new ``eligibility`` dict, or falls back to the
    legacy single ``qualification_id``/``qualification_kind`` fields."""
    from app.api.admin.product_eligibility import clean_id_list, clean_experience_rule

    elig = m.get('eligibility')
    if not isinstance(elig, dict):
        # Legacy single-qualification payload → one-item rule.
        qid = m.get('qualification_id')
        kind = m.get('qualification_kind', 'specialization')
        elig = {
            'specialization_ids': [qid] if (qid and kind != 'work_qualification') else [],
            'work_qualification_ids': [qid] if (qid and kind == 'work_qualification') else [],
            'experience_rule': [],
        }

    spec_ids = clean_id_list(elig.get('specialization_ids'), 'specialization_ids') or []
    work_ids = clean_id_list(elig.get('work_qualification_ids'), 'work_qualification_ids') or []
    exp_rule = clean_experience_rule(elig.get('experience_rule')) or []
    return {
        'specialization_ids': spec_ids,
        'specialization_names': _snapshot_names(tid, spec_ids),
        'work_qualification_ids': work_ids,
        'work_qualification_names': _snapshot_names(tid, work_ids),
        'experience_rule': exp_rule,
    }


def _build_members(tid, offering, members_payload):
    """Replace an offering's slots from the payload list."""
    offering.members.clear()
    for idx, m in enumerate(members_payload or []):
        elig = _normalize_eligibility(tid, m)
        # Legacy single columns mirror the first specialization (else first
        # work-qual) so the payout label + older readers still work.
        if elig['specialization_ids']:
            qualification_id = elig['specialization_ids'][0]
            qualification_name = (elig.get('specialization_names') or [None])[0]
            kind = 'specialization'
        elif elig['work_qualification_ids']:
            qualification_id = elig['work_qualification_ids'][0]
            qualification_name = (elig.get('work_qualification_names') or [None])[0]
            kind = 'work_qualification'
        else:
            qualification_id, qualification_name, kind = None, None, 'specialization'
        min_c = max(1, _to_int(m.get('min_consultations'), 1))
        max_c = max(min_c, _to_int(m.get('max_consultations'), min_c))
        offering.members.append(GroupOfferingMember(
            tenant_id=tid,
            eligibility=elig,
            qualification_id=qualification_id,
            qualification_name=qualification_name,
            qualification_kind=kind,
            min_consultations=min_c,
            max_consultations=max_c,
            voice_enabled=bool(m.get('voice_enabled', True)),
            voice_min_duration=max(1, _to_int(m.get('voice_min_duration'), 5)),
            voice_max_duration=max(1, _to_int(m.get('voice_max_duration'), 30)),
            video_enabled=bool(m.get('video_enabled', True)),
            video_min_duration=max(1, _to_int(m.get('video_min_duration'), 5)),
            video_max_duration=max(1, _to_int(m.get('video_max_duration'), 30)),
            chat_enabled=bool(m.get('chat_enabled', True)),
            allocated_budget=max(0.0, _to_float(m.get('allocated_budget'), 0)),
            # keep legacy single-duration columns roughly in sync
            consultation_count=max_c,
            min_duration=max(1, _to_int(m.get('voice_min_duration'), 5)),
            max_duration=max(1, _to_int(m.get('voice_max_duration'), 30)),
            sort_order=idx,
        ))


_VALID_TAX_MODES = {'none', 'intra_state', 'inter_state'}


def _apply_basics(offering, data):
    if 'name' in data:
        offering.name = (data.get('name') or '').strip()
    if 'category' in data:
        offering.category = (data.get('category') or 'Healthcare Plan').strip()
    if 'duration_type' in data or 'duration_value' in data:
        dtype = data.get('duration_type', offering.duration_type)
        dval = data.get('duration_value', offering.duration_value)
        offering.duration_type = dtype
        offering.duration_value = _resolve_duration(dtype, dval)
    if 'patient_price' in data:
        offering.patient_price = max(0.0, _to_float(data.get('patient_price'), 0))
    if 'doctor_budget' in data:
        offering.doctor_budget = max(0.0, _to_float(data.get('doctor_budget'), 0))
    if 'description' in data:
        offering.description = data.get('description')
    if 'working_hours' in data:
        wh = data.get('working_hours')
        offering.working_hours = wh if isinstance(wh, dict) else None
    if 'targeting' in data:
        # Same canonical shape as DoctorProduct.targeting. _apply_basics has
        # no error channel (its callers don't catch), so follow its tolerant
        # idiom: a malformed payload leaves the stored value untouched.
        from app.api.admin.product_eligibility import (
            clean_targeting, EligibilityRuleError,
        )
        try:
            offering.targeting = clean_targeting(data.get('targeting'))
        except EligibilityRuleError:
            pass
    # Tax config (Section 3).
    if 'tax_mode' in data:
        tm = (data.get('tax_mode') or 'none')
        offering.tax_mode = tm if tm in _VALID_TAX_MODES else 'none'
    for field in ('cgst_rate', 'sgst_rate', 'igst_rate'):
        if field in data:
            v = data.get(field)
            setattr(offering, field, None if v in (None, '') else max(0.0, _to_float(v, 0)))


def _build_installments(tid, offering, installments_payload):
    """Replace an offering's payment schedule from the payload list."""
    offering.installments.clear()
    for idx, i in enumerate(installments_payload or []):
        ptype = i.get('payment_type', 'fixed')
        ptype = ptype if ptype in ('fixed', 'percentage') else 'fixed'
        offering.installments.append(GroupOfferingInstallment(
            tenant_id=tid,
            installment_no=_to_int(i.get('installment_no'), idx + 1),
            payment_type=ptype,
            amount=(None if ptype == 'percentage' else max(0.0, _to_float(i.get('amount'), 0))),
            percentage=(max(0.0, _to_float(i.get('percentage'), 0)) if ptype == 'percentage' else None),
            due_after_days=max(0, _to_int(i.get('due_after_days'), 0)),
            due_label=(i.get('due_label') or None),
            is_booking=bool(i.get('is_booking', idx == 0)),
        ))


def ensure_plan_product(tid, offering):
    """Ensure the plan has a hidden backing DoctorProduct + communication config
    so its team channels (group chat + per-doctor 1:1) can open — the channel
    machinery is product-scoped. Flush-only (no commit) so it is safe to call
    inside any open transaction. Idempotent. Returns the product."""
    from app.models import DoctorProduct, ServiceCommunicationConfig

    prod = None
    if offering.backing_product_id:
        prod = DoctorProduct.query.filter_by(
            id=offering.backing_product_id, tenant_id=tid, is_deleted=False,
        ).first()
    if prod is None:
        prod = DoctorProduct(
            tenant_id=tid,
            name=f'{offering.name} — Plan',
            description=offering.description or None,
            min_price=offering.patient_price or 0,
            max_price=offering.patient_price or 0,
            is_group_service=True,
            is_active=True,
        )
        db.session.add(prod)
        db.session.flush()
        offering.backing_product_id = prod.id

    any_voice = any(getattr(m, 'voice_enabled', False) for m in offering.members)
    any_video = any(getattr(m, 'video_enabled', False) for m in offering.members)
    days = _resolve_duration(offering.duration_type, offering.duration_value)

    cfg = ServiceCommunicationConfig.query.filter_by(
        tenant_id=tid, product_id=prod.id,
    ).first()
    if cfg is None:
        cfg = ServiceCommunicationConfig(tenant_id=tid, product_id=prod.id)
        db.session.add(cfg)
    cfg.is_enabled = True
    cfg.chat_enabled = True
    cfg.audio_enabled = bool(any_voice)
    cfg.video_enabled = bool(any_video)
    cfg.documents_enabled = True
    cfg.validity_days = days
    db.session.flush()
    return prod


def _validation_errors(offering):
    """Reasons the PLAN TEMPLATE can't be published. Doctors are assigned per
    team, not on the template, so publish only checks the plan shape."""
    errors = []
    if not (offering.name or '').strip():
        errors.append('Plan name is required.')
    if _to_float(offering.patient_price) <= 0:
        errors.append('Patient price must be greater than 0.')
    if not offering.members:
        errors.append('Add at least one qualification slot.')

    allocated = offering.allocated_budget_total  # Σ slot fees
    if allocated > _to_float(offering.patient_price) + 1e-6:
        errors.append('Total slot fees cannot exceed the patient price.')

    for m in offering.members:
        label = m.qualification_name or 'a slot'
        elig = m.eligibility or {}
        has_qual = bool(elig.get('specialization_ids') or elig.get('work_qualification_ids')
                        or m.qualification_id)
        if not has_qual:
            errors.append('Every slot needs at least one education or work qualification.')
        if (m.min_consultations or 0) > (m.max_consultations or 0):
            errors.append(f'{label}: min consultations cannot exceed max.')
        if (m.voice_min_duration or 0) > (m.voice_max_duration or 0):
            errors.append(f'{label}: voice min time cannot exceed max.')
        if (m.video_min_duration or 0) > (m.video_max_duration or 0):
            errors.append(f'{label}: video min time cannot exceed max.')

    # Tax: a chosen tax mode needs its rate(s).
    if offering.tax_mode == 'intra_state' and not (offering.cgst_rate or offering.sgst_rate):
        errors.append('Set CGST / SGST rates for intra-state tax.')
    if offering.tax_mode == 'inter_state' and not offering.igst_rate:
        errors.append('Set the IGST rate for inter-state tax.')
    return errors


@group_offerings_bp.route('', methods=['GET'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def list_group_offerings():
    status = request.args.get('status', 'all').lower()
    tid = current_tenant_id_strict()
    query = GroupOffering.query.filter_by(tenant_id=tid, is_deleted=False)
    if status in _VALID_STATUSES:
        query = query.filter_by(status=status)
    offerings = query.order_by(GroupOffering.created_at.desc()).all()

    # A PUBLISHED offering must have a backing DoctorProduct for its marketplace
    # team + feature-product links to resolve against. Offerings published
    # before that machinery existed lack one, which made them invisible on the
    # Feature-Product Linking page. Backfill it idempotently here so they show
    # up and are linkable (no-op once populated).
    changed = False
    for o in offerings:
        if o.status == 'published' and not o.backing_product_id:
            try:
                ensure_plan_product(tid, o)
                changed = True
            except Exception:  # noqa: BLE001 — never fail the list on backfill
                logger.exception('[GROUP_OFFERING] backing-product backfill failed for %s', o.id)
    if changed:
        db.session.commit()

    return success_response(data={'offerings': [o.to_dict() for o in offerings]})


def _doctors_holding(model, tid, category_ids):
    """{doctor_id: name} for doctors holding ANY of the category ids."""
    if not category_ids:
        return {}
    out = {}
    for r in model.query.filter(
        model.tenant_id == tid, model.category_id.in_(category_ids),
    ).all():
        d = r.doctor
        if d and not d.is_deleted:
            out[str(d.id)] = d.full_name
    return out


def _slot_candidates(tid, elig):
    """Doctors eligible for a slot: hold ANY required specialization AND ANY
    required work-qual AND meet the experience rule (empty criteria skipped).
    Mirrors the marketplace service's eligibility model."""
    spec_ids = elig.get('specialization_ids') or []
    work_ids = elig.get('work_qualification_ids') or []
    exp_rule = elig.get('experience_rule') or []

    names = {}
    id_sets = []
    if spec_ids:
        m = _doctors_holding(ProfileEducationSpecialization, tid, spec_ids)
        names.update(m)
        id_sets.append(set(m.keys()))
    if work_ids:
        m = _doctors_holding(ProfileWorkQualification, tid, work_ids)
        names.update(m)
        id_sets.append(set(m.keys()))
    if not id_sets:
        return []
    doctor_ids = set.intersection(*id_sets) if len(id_sets) > 1 else id_sets[0]

    if exp_rule and doctor_ids:
        from app.api.admin.product_eligibility import doctor_experience_by_level
        doctor_ids = {
            did for did in doctor_ids
            if any(all(doctor_experience_by_level(did, tid).get(c['level'], 0) >= c['years']
                       for c in group) for group in exp_rule)
        }
    return [{'id': did, 'name': names.get(did)} for did in doctor_ids]


@group_offerings_bp.route('/candidates', methods=['GET'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def qualification_candidates():
    """Doctors eligible to fill a slot, for team allocation.

    Preferred: ``member_id`` — matches against the slot's full eligibility
    (specializations + work-quals + experience, same model as a service).
    Legacy fallback: ``qualification_id`` (+ ``kind``) for a single category.
    """
    tid = current_tenant_id_strict()
    member_id = request.args.get('member_id')
    if member_id:
        slot = GroupOfferingMember.query.filter_by(id=member_id, tenant_id=tid).first()
        if not slot:
            return not_found_response('Slot')
        elig = slot.eligibility or {
            'specialization_ids': [str(slot.qualification_id)] if (
                slot.qualification_id and slot.qualification_kind != 'work_qualification') else [],
            'work_qualification_ids': [str(slot.qualification_id)] if (
                slot.qualification_id and slot.qualification_kind == 'work_qualification') else [],
            'experience_rule': [],
        }
        return success_response(data={'candidates': _slot_candidates(tid, elig)})

    # Legacy single-category path.
    qualification_id = request.args.get('qualification_id')
    if not qualification_id:
        return error_response('member_id or qualification_id is required', status_code=400)
    kind = (request.args.get('kind') or 'specialization').strip()
    model = (ProfileWorkQualification if kind == 'work_qualification'
             else ProfileEducationSpecialization)
    m = _doctors_holding(model, tid, [qualification_id])
    return success_response(data={'candidates': [
        {'id': did, 'name': nm} for did, nm in m.items()
    ]})


# ── Group Offering categories (admin-managed, reuses the Category master) ──────

@group_offerings_bp.route('/categories', methods=['GET'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def list_group_offering_categories():
    """The admin-managed Category dropdown for the plan builder."""
    rows = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        category_type=CATEGORY_TYPE_GROUP_OFFERING,
    ).order_by(Category.name).all()
    return success_response(data={'categories': [
        {'id': str(r.id), 'name': r.name} for r in rows
    ]})


@group_offerings_bp.route('/categories', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def create_group_offering_category():
    """Add a category to the plan-builder dropdown."""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('Category name is required', status_code=400)
    tid = current_tenant_id_strict()
    existing = Category.query.filter(
        Category.tenant_id == tid,
        Category.category_type == CATEGORY_TYPE_GROUP_OFFERING,
        db.func.lower(Category.name) == name.lower(),
    ).first()
    if existing:
        return error_response(f'"{name}" already exists', status_code=409)
    row = Category(
        tenant_id=tid, name=name,
        category_type=CATEGORY_TYPE_GROUP_OFFERING, is_active=True,
    )
    db.session.add(row)
    db.session.commit()
    return created_response({'id': str(row.id), 'name': row.name},
                            message='Category added')


@group_offerings_bp.route('/categories/<category_id>', methods=['DELETE'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def delete_group_offering_category(category_id):
    """Remove a category from the dropdown. Existing plans keep their stored
    category name (it's snapshotted as a string on the plan)."""
    row = Category.query.filter_by(
        id=category_id, tenant_id=current_tenant_id_strict(),
        category_type=CATEGORY_TYPE_GROUP_OFFERING,
    ).first()
    if not row:
        return not_found_response('Category')
    db.session.delete(row)
    db.session.commit()
    return success_response(message='Category removed')


@group_offerings_bp.route('/<offering_id>', methods=['GET'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def get_group_offering(offering_id):
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')
    return success_response(data=offering.to_dict())


@group_offerings_bp.route('', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def create_group_offering():
    tid = current_tenant_id_strict()
    data = request.get_json() or {}
    if not (data.get('name') or '').strip():
        return error_response('Plan name is required', status_code=400)

    offering = GroupOffering(
        tenant_id=tid,
        name=data['name'].strip(),
        status='draft',
        created_by_id=current_user.id,
    )
    _apply_basics(offering, data)
    _build_members(tid, offering, data.get('members'))
    _build_installments(tid, offering, data.get('installments'))
    db.session.add(offering)
    db.session.commit()
    return created_response(offering.to_dict(), message='Group offering saved as draft')


@group_offerings_bp.route('/<offering_id>', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def update_group_offering(offering_id):
    tid = current_tenant_id_strict()
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=tid, is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')

    data = request.get_json() or {}
    _apply_basics(offering, data)
    if 'members' in data:
        _build_members(tid, offering, data.get('members'))
    if 'installments' in data:
        _build_installments(tid, offering, data.get('installments'))
    offering.updated_by_id = current_user.id
    db.session.commit()
    return success_response(offering.to_dict(), message='Group offering updated')


@group_offerings_bp.route('/<offering_id>/publish', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def publish_group_offering(offering_id):
    tid = current_tenant_id_strict()
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=tid, is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')

    # Allow the caller to save latest edits alongside publish.
    data = request.get_json(silent=True) or {}
    if data:
        _apply_basics(offering, data)
        if 'members' in data:
            _build_members(tid, offering, data.get('members'))
        if 'installments' in data:
            _build_installments(tid, offering, data.get('installments'))

    errors = _validation_errors(offering)
    if errors:
        return error_response(
            'Cannot publish: ' + ' '.join(errors),
            status_code=400, errors={'validation': errors},
        )

    offering.status = 'published'
    offering.updated_by_id = current_user.id
    # A published plan is bookable, so it needs its backing product + comms
    # config in place for team channels to open on payment.
    ensure_plan_product(tid, offering)
    db.session.commit()
    return success_response(offering.to_dict(), message='Group offering published')


@group_offerings_bp.route('/<offering_id>/archive', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def archive_group_offering(offering_id):
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')
    offering.status = 'archived'
    offering.is_active = False
    offering.updated_by_id = current_user.id
    db.session.commit()
    return success_response(offering.to_dict(), message='Group offering archived')


@group_offerings_bp.route('/<offering_id>', methods=['DELETE'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def delete_group_offering(offering_id):
    from app.models._base import utcnow
    offering = GroupOffering.query.filter_by(
        id=offering_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not offering:
        return not_found_response('GroupOffering')
    offering.is_deleted = True
    offering.deleted_at = utcnow()
    db.session.commit()
    return success_response(message='Group offering deleted')
