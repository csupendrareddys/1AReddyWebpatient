"""
Admin Availability Approval Routes

Endpoints for admin to review and approve/reject doctor availability configs:
  GET  /admin/availability-approvals              - List pending availability requests
  POST /admin/availability-approvals/<id>/approve - Approve a doctor's config
  POST /admin/availability-approvals/<id>/reject  - Reject with a reason

Admin Products (Marketplace Catalog):
  GET    /admin/products           - List products
  POST   /admin/products           - Create product
  PUT    /admin/products/<id>      - Update product
  DELETE /admin/products/<id>      - Soft delete product
"""
import logging
from datetime import datetime, timezone
from flask import request, Blueprint
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, rbac_required
from app.models import PermissionModule, PermissionAction
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, Doctor, AvailabilityApprovalStatus, DoctorProduct, UserVerificationStatus, Product_Category, ProductSubcategory
from app.api.admin.product_eligibility import (
    EligibilityRuleError, clean_id_list, clean_experience_rule,
)
from app.models.catalog import CATEGORY_TYPE_WORK_QUALIFICATION
from app.extensions import db

logger = logging.getLogger(__name__)

availability_bp = Blueprint('availability_admin', __name__)
products_bp = Blueprint('products_admin', __name__)


# ─────────────────────────────────────────────
#  Availability Approval Endpoints
# ─────────────────────────────────────────────

@availability_bp.route('', methods=['GET'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_APPOINTMENT, PermissionAction.VIEW)
def list_availability_approvals():
    """
    List all pending granular availability approval requests.
    Query Params:
        - status: filter by approval status (pending|completed|rejected), default: pending
        - page, per_page
    """
    from app.models import ApprovalRequest, ApprovalRequestStatus, ApprovalEntityType
    
    status_str = request.args.get('status', 'pending').lower()
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 50)

    try:
        status_filter = ApprovalRequestStatus[status_str.upper()]
    except KeyError:
        status_filter = ApprovalRequestStatus.PENDING

    query = ApprovalRequest.query.filter(
        ApprovalRequest.entity_type.in_([ApprovalEntityType.DOCTOR_AVAILABILITY, ApprovalEntityType.DOCTOR_FEE]),
        ApprovalRequest.status == status_filter
    ).order_by(ApprovalRequest.created_at.desc())

    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    result = []
    for req in paginated.items:
        doctor = Doctor.query.get(req.entity_id)
        if not doctor: continue
        
        meta = req.changes.get('_meta', {}) if req.changes else {}
        cat = meta.get('category', 'unknown')
        typ = meta.get('type', 'global')
        data = req.changes.get('data') if req.changes else None
        # Per-slot requests carry a day (weekly) or date (calendar) + the slot
        # timing — surface a specific title so the queue reads as one slot per row.
        where = meta.get('date') or meta.get('day')
        if isinstance(data, dict) and data.get('_deleted'):
            title = f"Remove {cat.replace('_', ' ')} — {where or typ}"
        elif cat in ('working_hours', 'calendar') and isinstance(data, dict):
            when = f"{data.get('start', '?')}-{data.get('end', '?')}"
            title = f"{typ} {where or ''} {when}".strip()
        else:
            title = f"{typ.capitalize()} {cat.replace('_', ' ').capitalize()}"
        
        # profile_image moved to User (Doctor used to carry it but
        # was split out a few rounds back). Reading ``doctor.profile_image``
        # directly AttributeError'd, which is what 500'd this whole
        # endpoint. Use the User relationship and tolerate missing
        # users so a half-deleted doctor row doesn't take the list down.
        profile_image = (
            getattr(doctor.user, 'profile_image', None) if doctor.user else None
        )
        result.append({
            'request_id': str(req.id),
            'doctor_id': str(doctor.id),
            'full_name': doctor.full_name,
            'profile_image': profile_image,
            'category': cat,
            'type': typ,
            'day': meta.get('day'),
            'date': meta.get('date'),
            'slot_id': meta.get('slot_id'),
            'title': title,
            'changes_data': data,
            'meta': meta,
            'status': req.status.value,
            'requested_at': req.created_at.isoformat() if req.created_at else None,
            'reason': req.reason,
        })

    return success_response(data={
        'requests': result,
        'pagination': {
            'page': paginated.page,
            'per_page': paginated.per_page,
            'total': paginated.total,
            'pages': paginated.pages,
        }
    })


@availability_bp.route('/<request_id>/approve', methods=['POST'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_APPOINTMENT, PermissionAction.EDIT)
def approve_availability(request_id):
    """Approve a specific granular availability request."""
    # We defer to the RBAC webhook which handles merging via process_action
    from app.models import ApprovalRequest
    from app.api.admin.rbac.services import ApprovalService
    
    req = ApprovalRequest.query.get(request_id)
    if not req: return error_response('Request not found', status_code=404)
    
    try:
        approval = ApprovalService.process_action(request_id, 'approve', current_user.id, "Approved via Admin UI")
        # Mirror the approval into the Doctor row + re-materialise
        # time_slots. The shared helper handles the entire doctor-side
        # update for DOCTOR_AVAILABILITY / DOCTOR_FEE entity types.
        # Previously this route just marked the approval COMPLETED
        # without touching the doctor — so ``availability_approval_status``
        # stayed at 'pending' and the patient slot endpoint kept
        # returning ``approved=False``.
        ApprovalService.apply_doctor_availability_sync(
            approval, current_user.id,
        )
        return success_response(message=f"Request approved. Doctor's {req.changes.get('_meta',{}).get('type','')} config updated.")
    except Exception as e:
        logger.error(f"[AVAILABILITY:APPROVE] failed: {str(e)}")
        return error_response(str(e), status_code=400)


@availability_bp.route('/approve-all', methods=['POST'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_APPOINTMENT, PermissionAction.EDIT)
def approve_all_availability():
    """Approve EVERY pending doctor-availability/fee request in one shot
    (optionally scoped to ``?doctor_id=``).

    Availability is diffed per-slot, so one doctor generating a schedule spawns
    dozens/hundreds of individual approval requests — infeasible to clear one at
    a time. This walks the whole pending queue, applying each the same way the
    single-approve route does (mark COMPLETED + mirror to the doctor snapshot +
    re-materialise time_slots). A failure on one request is logged and skipped
    so a single bad row can't block the rest."""
    from app.models import ApprovalRequest, ApprovalRequestStatus, ApprovalEntityType
    from app.api.admin.rbac.services import ApprovalService

    doctor_id = request.args.get('doctor_id')
    q = ApprovalRequest.query.filter(
        ApprovalRequest.entity_type.in_(
            [ApprovalEntityType.DOCTOR_AVAILABILITY, ApprovalEntityType.DOCTOR_FEE]),
        ApprovalRequest.status == ApprovalRequestStatus.PENDING,
    )
    if doctor_id:
        q = q.filter(ApprovalRequest.entity_id == doctor_id)
    pending = q.order_by(ApprovalRequest.created_at.asc()).all()

    approved, errors = 0, 0
    for req in pending:
        try:
            approval = ApprovalService.process_action(
                str(req.id), 'approve', current_user.id, 'Bulk approved via Admin UI')
            ApprovalService.apply_doctor_availability_sync(approval, current_user.id)
            approved += 1
        except Exception as e:  # one bad row shouldn't abort the batch
            errors += 1
            logger.error('[AVAILABILITY:APPROVE_ALL] request %s failed: %s', req.id, e)

    msg = f"Approved {approved} request(s)."
    if errors:
        msg += f" {errors} could not be approved."
    return success_response(message=msg, data={'approved': approved, 'errors': errors})


@availability_bp.route('/approve-batch', methods=['POST'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_APPOINTMENT, PermissionAction.EDIT)
def approve_batch_availability():
    """Approve a chosen set of pending requests (the admin's ticked rows /
    a doctor's whole batch). Body: ``{"request_ids": ["...", ...]}``. Same
    per-request apply as the single-approve route; bad rows are skipped."""
    from app.models import ApprovalRequest, ApprovalRequestStatus, ApprovalEntityType
    from app.api.admin.rbac.services import ApprovalService

    ids = (request.get_json(silent=True) or {}).get('request_ids') or []
    if not isinstance(ids, list) or not ids:
        return error_response('request_ids must be a non-empty list', status_code=400)

    reqs = ApprovalRequest.query.filter(
        ApprovalRequest.id.in_(ids),
        ApprovalRequest.entity_type.in_(
            [ApprovalEntityType.DOCTOR_AVAILABILITY, ApprovalEntityType.DOCTOR_FEE]),
        ApprovalRequest.status == ApprovalRequestStatus.PENDING,
    ).all()

    approved, errors = 0, 0
    for req in reqs:
        try:
            approval = ApprovalService.process_action(
                str(req.id), 'approve', current_user.id, 'Batch approved via Admin UI')
            ApprovalService.apply_doctor_availability_sync(approval, current_user.id)
            approved += 1
        except Exception as e:
            errors += 1
            logger.error('[AVAILABILITY:APPROVE_BATCH] request %s failed: %s', req.id, e)

    msg = f"Approved {approved} request(s)."
    if errors:
        msg += f" {errors} could not be approved."
    return success_response(message=msg, data={'approved': approved, 'errors': errors})


@availability_bp.route('/<request_id>/reject', methods=['POST'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_APPOINTMENT, PermissionAction.EDIT)
def reject_availability(request_id):
    """Reject a specific granular availability request."""
    data = request.get_json() or {}
    reason = data.get('reason')
    if not reason: return error_response('Reason is required for rejection', status_code=400)
    
    from app.models import ApprovalRequest
    from app.api.admin.rbac.services import ApprovalService
    
    req = ApprovalRequest.query.get(request_id)
    if not req: return error_response('Request not found', status_code=404)

    try:
        approval = ApprovalService.process_action(request_id, 'reject', current_user.id, reason)
        # Mirror per-slot rejection onto the doctor's live draft (mark the slot
        # rejected) without disturbing already-approved slots.
        ApprovalService.apply_doctor_availability_reject(approval, current_user.id)
        return success_response(message='Request rejected.')
    except Exception as e:
        logger.error(f"[AVAILABILITY:REJECT] failed: {str(e)}")
        return error_response(str(e), status_code=400)


# ─────────────────────────────────────────────
#  Product Catalog Endpoints
# ─────────────────────────────────────────────

@products_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.DOCTOR])
def list_products():
    """List all active admin-defined products."""
    query = DoctorProduct.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_deleted=False,
    )

    # Doctors should only see active items they can pick from
    if current_user.role == UserRole.DOCTOR:
        query = query.filter_by(is_active=True)

    products = query.order_by(DoctorProduct.name).all()

    # For a doctor, annotate each item with whether they actually qualify and
    # why not — otherwise the criteria would only surface as a failure at the
    # moment they try to offer it.
    if current_user.role == UserRole.DOCTOR:
        from app.api.admin.product_eligibility import check_product_eligibility
        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), user_id=current_user.id,
        ).first()
        rows = []
        for p in products:
            item = p.to_dict()
            if doctor:
                eligible, reason = check_product_eligibility(
                    p, doctor.id, current_tenant_id_strict())
                item['eligible'] = eligible
                item['ineligible_reason'] = reason
            rows.append(item)
        return success_response(data={'products': rows})

    return success_response(data={'products': [p.to_dict() for p in products]})


@products_bp.route('', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def create_product():
    """
    Create a new product/service catalog item.

    Payload:
    {
        "name": "Medical Certificate",
        "description": "Official medical fitness certificate",
        "min_price": 200,
        "max_price": 500
    }
    """
    data = request.get_json() or {}

    name = data.get('name', '').strip()
    if not name:
        return error_response('Product name is required', status_code=400)

    min_price = data.get('min_price')
    max_price = data.get('max_price')
    if min_price is None or max_price is None:
        return error_response('min_price and max_price are required', status_code=400)

    try:
        min_price = float(min_price)
        max_price = float(max_price)
    except (TypeError, ValueError):
        return error_response('Prices must be numbers', status_code=400)

    if min_price > max_price:
        return error_response('min_price cannot exceed max_price', status_code=400)
    if min_price < 0:
        return error_response('Prices cannot be negative', status_code=400)

    product = DoctorProduct(
        name=name,
        description=data.get('description', '').strip() or None,
        min_price=min_price,
        max_price=max_price,
        is_active=True,
        is_group_service=bool(data.get('is_group_service')),
        created_by_id=current_user.id,
        allowed_specialization_ids=_clean_spec_ids(data.get('allowed_specialization_ids')),
    )
    try:
        _apply_eligibility(product, data)
    except EligibilityRuleError as e:
        return error_response(str(e), status_code=400)
    _apply_service_details(product, data)

    db.session.add(product)
    db.session.commit()

    return success_response(message='Product created', data=product.to_dict(), status_code=201)


_VALID_TAX_MODES = {'none', 'intra_state', 'inter_state'}


def _apply_service_details(product, data):
    """Admin-imposed tax + consultation config on a catalog service. The doctor
    only sets their price + description; these details come from the admin."""
    def _int(v, d):
        try:
            return max(1, int(v))
        except (TypeError, ValueError):
            return d

    def _int0(v, d):
        """Like _int but allows 0 (a mode may include zero calls)."""
        try:
            return max(0, int(v))
        except (TypeError, ValueError):
            return d
    if 'tax_mode' in data:
        tm = data.get('tax_mode') or 'none'
        product.tax_mode = tm if tm in _VALID_TAX_MODES else 'none'
    for f in ('cgst_rate', 'sgst_rate', 'igst_rate'):
        if f in data:
            v = data.get(f)
            try:
                setattr(product, f, None if v in (None, '') else max(0.0, float(v)))
            except (TypeError, ValueError):
                setattr(product, f, None)
    if 'min_consultations' in data:
        product.min_consultations = _int(data['min_consultations'], 1)
    if 'max_consultations' in data:
        product.max_consultations = _int(data['max_consultations'], 1)
    for f in ('voice_enabled', 'video_enabled', 'chat_enabled'):
        if f in data:
            setattr(product, f, bool(data[f]))
    # Per-mode consultation counts (audio / video), each min & max.
    for f in ('audio_min_consultations', 'audio_max_consultations',
              'video_min_consultations', 'video_max_consultations'):
        if f in data:
            setattr(product, f, _int0(data[f], 0))
    # Per-mode slot length (minimum / maximum minutes for a single call).
    for f in ('voice_min_duration', 'voice_max_duration',
              'video_min_duration', 'video_max_duration'):
        if f in data:
            setattr(product, f, _int(data[f], 5))
    if 'working_hours' in data:
        wh = data.get('working_hours')
        product.working_hours = wh if isinstance(wh, dict) else None
    if 'payout_installments' in data:
        _apply_payout_installments(product, data.get('payout_installments'))


def _apply_payout_installments(product, rows):
    """Rebuild the admin-set payout installment schedule from the payload.

    Each row: {payment_type: fixed|percentage, amount|percentage,
    due_after_days, period_label}. An empty/omitted list clears the schedule
    (the doctor is then paid in a single settlement, the legacy behaviour).
    """
    from app.models import DoctorProductInstallment
    product.payout_installments.clear()
    for idx, r in enumerate(rows or []):
        ptype = 'percentage' if (r or {}).get('payment_type') == 'percentage' else 'fixed'

        def _num(v):
            try:
                return None if v in (None, '') else max(0.0, float(v))
            except (TypeError, ValueError):
                return None

        def _days(v):
            try:
                return max(0, int(v))
            except (TypeError, ValueError):
                return 0
        product.payout_installments.append(DoctorProductInstallment(
            tenant_id=product.tenant_id or current_tenant_id_strict(),
            installment_no=idx + 1,
            payment_type=ptype,
            amount=_num(r.get('amount')) if ptype == 'fixed' else None,
            percentage=_num(r.get('percentage')) if ptype == 'percentage' else None,
            period_label=(r.get('period_label') or None),
            due_after_days=_days(r.get('due_after_days')),
        ))


def _clean_spec_ids(v):
    """Normalize an allowed-specialization list to str ids, or None for 'any'."""
    if not v or not isinstance(v, list):
        return None
    ids = [str(x).strip() for x in v if str(x).strip()]
    return ids or None


def _apply_eligibility(product, data):
    """Copy the eligibility criteria off the payload onto the product.

    Only keys actually present are touched, so a PUT that omits a criterion
    leaves it alone rather than silently clearing the gate. Raises
    EligibilityRuleError on anything malformed.
    """
    if 'required_degree_ids' in data:
        product.required_degree_ids = clean_id_list(
            data['required_degree_ids'], 'required_degree_ids')
    if 'required_work_qualification_ids' in data:
        product.required_work_qualification_ids = clean_id_list(
            data['required_work_qualification_ids'], 'required_work_qualification_ids')
    if 'experience_rule' in data:
        product.experience_rule = clean_experience_rule(data['experience_rule'])
    if 'targeting' in data:
        from app.api.admin.product_eligibility import clean_targeting
        product.targeting = clean_targeting(data['targeting'])
    if 'logo_asset_id' in data:
        product.logo_asset_id = str(data['logo_asset_id']).strip() or None if data['logo_asset_id'] else None


@products_bp.route('/<product_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_product(product_id):
    """Update an existing product."""
    product = DoctorProduct.query.filter_by(
        id=product_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not product:
        return error_response('Product not found', status_code=404)

    data = request.get_json() or {}

    if 'name' in data and data['name'].strip():
        product.name = data['name'].strip()
    if 'description' in data:
        product.description = data['description']
    if 'is_active' in data:
        product.is_active = bool(data['is_active'])

    if 'min_price' in data or 'max_price' in data:
        try:
            new_min = float(data.get('min_price', product.min_price))
            new_max = float(data.get('max_price', product.max_price))
        except (TypeError, ValueError):
            return error_response('Prices must be numbers', status_code=400)
        if new_min > new_max:
            return error_response('min_price cannot exceed max_price', status_code=400)
        if new_min < 0:
            return error_response('Prices cannot be negative', status_code=400)
        product.min_price = new_min
        product.max_price = new_max

    if 'allowed_specialization_ids' in data:
        product.allowed_specialization_ids = _clean_spec_ids(data['allowed_specialization_ids'])
    if 'is_group_service' in data:
        product.is_group_service = bool(data['is_group_service'])

    try:
        _apply_eligibility(product, data)
    except EligibilityRuleError as e:
        return error_response(str(e), status_code=400)
    _apply_service_details(product, data)

    db.session.commit()
    return success_response(message='Product updated', data=product.to_dict())


# ─────────────────────────────────────────────
#  Work-qualification master list
#
#  Admin-curated lookup that products gate on and doctors pick from on their
#  About-me profile. Stored as Category rows discriminated by category_type,
#  exactly like 'degree' and 'specialization'.
# ─────────────────────────────────────────────

@products_bp.route('/work-qualifications', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.DOCTOR])
def list_work_qualifications():
    """List work qualifications. Doctors see only active ones to pick from."""
    from app.models import Category

    query = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
    )
    if current_user.role == UserRole.DOCTOR or \
            request.args.get('active_only', 'false').lower() == 'true':
        query = query.filter_by(is_active=True)

    rows = query.order_by(Category.name).all()
    return success_response(data={'work_qualifications': [r.to_dict() for r in rows]})


@products_bp.route('/work-qualifications', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def create_work_qualification():
    """Add a work qualification to the master list."""
    from app.models import Category

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('Work qualification name is required', status_code=400)

    tid = current_tenant_id_strict()
    # Names are what doctors pick from and what admins gate products on, so a
    # duplicate would be genuinely ambiguous rather than merely untidy.
    existing = Category.query.filter(
        Category.tenant_id == tid,
        Category.category_type == CATEGORY_TYPE_WORK_QUALIFICATION,
        db.func.lower(Category.name) == name.lower(),
    ).first()
    if existing:
        return error_response(f'"{name}" already exists', status_code=409)

    row = Category(
        tenant_id=tid,
        name=name,
        description=(data.get('description') or '').strip() or None,
        category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
        is_active=True,
    )
    db.session.add(row)
    db.session.commit()
    logger.info('[PRODUCT] work qualification created: %s', name)
    return success_response(message='Work qualification added', data=row.to_dict(), status_code=201)


@products_bp.route('/work-qualifications/<qualification_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_work_qualification(qualification_id):
    """Rename or deactivate a work qualification."""
    from app.models import Category

    row = Category.query.filter_by(
        id=qualification_id,
        tenant_id=current_tenant_id_strict(),
        category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
    ).first()
    if not row:
        return error_response('Work qualification not found', status_code=404)

    data = request.get_json() or {}
    if 'name' in data and (data['name'] or '').strip():
        row.name = data['name'].strip()
    if 'description' in data:
        row.description = (data['description'] or '').strip() or None
    if 'is_active' in data:
        row.is_active = bool(data['is_active'])

    db.session.commit()
    return success_response(message='Work qualification updated', data=row.to_dict())


@products_bp.route('/<product_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def delete_product(product_id):
    """Soft delete a product."""
    product = DoctorProduct.query.filter_by(
        id=product_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()
    if not product:
        return error_response('Product not found', status_code=404)

    product.is_deleted = True
    product.deleted_at = datetime.now(timezone.utc)
    product.is_active = False
    db.session.commit()

    return success_response(message='Product deleted')


# --------------------------------------------------------------------------- #
# Product categories — catalog-level reference data (like work qualifications).
# Routes are namespaced under ``/product_category`` so the update PUT does not
# collide with ``PUT /<product_id>`` (update_product) above — a bare
# ``/<product_category_id>`` rule is the same Werkzeug pattern as
# ``/<product_id>`` and would be shadowed by whichever registers first.
# --------------------------------------------------------------------------- #

@products_bp.route('/product_category', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_product_categories():
    """List every product category for the current tenant.

    ``?active_only=1`` restricts the result to selectable categories.
    """
    query = Product_Category.query.filter_by(tenant_id=current_tenant_id_strict())
    if request.args.get('active_only') in ('1', 'true', 'True'):
        query = query.filter_by(is_active=True)
    rows = query.order_by(Product_Category.name.asc()).all()
    return success_response(data={'product_categories': [r.to_dict() for r in rows]})


@products_bp.route('/product_category', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def product_category():
    """
    Create a new product_category item.

    Payload:
    {
        "name": "Health Plan",
        "tag_line": "Book now",
        "icon": "text Line"
    }
    """
    data = request.get_json() or {}

    name = data.get('name', '').strip()
    if not name:
        return error_response('Product Category name is required', status_code=400)

    # tag_line and icon are optional — a category can be created with just a
    # name (the catalog page adds them later). The model allows both to be null.
    tag_line = data.get('tag_line')
    icon = data.get('icon')

    # Names are unique per tenant (product_category_tenant_name); catch the
    # duplicate before the DB does so the client gets a 409, not a 500.
    existing = Product_Category.query.filter_by(
        tenant_id=current_tenant_id_strict(), name=name,
    ).first()
    if existing:
        return error_response('A category with this name already exists', status_code=409)

    product_category = Product_Category(
        name=name,
        tag_line=(tag_line or '').strip() or None,
        icon=(icon or '').strip() or None,
    )

    db.session.add(product_category)
    db.session.commit()

    return success_response(message='product category created', data=product_category.to_dict(), status_code=201)


@products_bp.route('/product_category/<product_category_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_prodcut_category(product_category_id):
    """Rename, retag, re-icon, or deactivate a product category."""
    row = Product_Category.query.filter_by(
        id=product_category_id,
        tenant_id=current_tenant_id_strict()
    ).first()
    if not row:
        return error_response('Product Category not found', status_code=404)

    data = request.get_json() or {}
    if 'name' in data and (data['name'] or '').strip():
        new_name = data['name'].strip()
        # Guard the per-tenant unique name on rename too.
        clash = Product_Category.query.filter(
            Product_Category.tenant_id == current_tenant_id_strict(),
            Product_Category.name == new_name,
            Product_Category.id != row.id,
        ).first()
        if clash:
            return error_response('A category with this name already exists', status_code=409)
        row.name = new_name
    if 'tag_line' in data:
        row.tag_line = (data['tag_line'] or '').strip() or None
    if 'icon' in data:
        row.icon = (data['icon'] or '').strip() or None
    if 'is_active' in data:
        row.is_active = bool(data['is_active'])
    if 'features' in data:
        # A flat list of feature keys; ignore anything non-list / non-string.
        feats = data.get('features') or []
        if not isinstance(feats, list):
            return error_response('features must be a list', status_code=400)
        row.features = [str(f).strip() for f in feats if str(f).strip()]
    if 'category_types' in data:
        # Classification list — "Consultant type" / "Plan based type".
        cts = data.get('category_types') or []
        if not isinstance(cts, list):
            return error_response('category_types must be a list', status_code=400)
        row.category_types = [str(c).strip() for c in cts if str(c).strip()]

    db.session.commit()
    return success_response(message='Product Category is updated', data=row.to_dict())


@products_bp.route('/product_category/<product_category_id>/subcategory', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def add_product_subcategory(product_category_id):
    """Add a named subcategory under a product category."""
    tenant_id = current_tenant_id_strict()
    parent = Product_Category.query.filter_by(
        id=product_category_id, tenant_id=tenant_id,
    ).first()
    if not parent:
        return error_response('Product Category not found', status_code=404)

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('Subcategory name is required', status_code=400)

    # Unique per parent (product_subcategory_category_name).
    existing = ProductSubcategory.query.filter_by(
        category_id=parent.id, name=name,
    ).first()
    if existing:
        return error_response('A subcategory with this name already exists', status_code=409)

    sub = ProductSubcategory(category_id=parent.id, name=name, tenant_id=tenant_id)
    db.session.add(sub)
    db.session.commit()
    return success_response(message='Subcategory added', data=sub.to_dict(), status_code=201)


@products_bp.route(
    '/product_category/<product_category_id>/subcategory/<subcategory_id>',
    methods=['DELETE'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def delete_product_subcategory(product_category_id, subcategory_id):
    """Remove a subcategory from a product category."""
    tenant_id = current_tenant_id_strict()
    sub = ProductSubcategory.query.filter_by(
        id=subcategory_id, category_id=product_category_id, tenant_id=tenant_id,
    ).first()
    if not sub:
        return error_response('Subcategory not found', status_code=404)

    db.session.delete(sub)
    db.session.commit()
    return success_response(message='Subcategory removed')