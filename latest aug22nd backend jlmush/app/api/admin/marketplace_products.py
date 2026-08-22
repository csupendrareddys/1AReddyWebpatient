"""
Admin individual marketplace-product approval routes.

  GET    /admin/marketplace-products?status=pending|approved|rejected|all
  POST   /admin/marketplace-products/<id>/approve
  POST   /admin/marketplace-products/<id>/reject   (reason required)

Individual doctor products (a doctor picking a catalog item to sell at their
own price) go through the same admin-approval gate as multi-doctor group
offerings — see ``service_groups.py``, which this mirrors. A product is only
bookable by patients once approved; a doctor edit resets it to pending.
"""
import logging
from flask import request, Blueprint
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, DoctorMarketplaceProduct
from app.extensions import db

logger = logging.getLogger(__name__)

marketplace_products_bp = Blueprint('marketplace_products_admin', __name__)

_VALID_STATUSES = {'pending', 'approved', 'rejected'}


def _serialize(mp):
    """Product dict enriched with the selling doctor's name for the queue."""
    data = mp.to_dict()
    data['doctor_name'] = mp.doctor.full_name if mp.doctor else None
    return data


@marketplace_products_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_marketplace_products():
    """List individual marketplace products, filtered by ?status (default pending)."""
    status = request.args.get('status', 'pending').lower()
    query = DoctorMarketplaceProduct.query.filter_by(tenant_id=current_tenant_id_strict())
    if status in _VALID_STATUSES:
        query = query.filter_by(approval_status=status)
    products = query.order_by(DoctorMarketplaceProduct.created_at.desc()).all()
    return success_response(data={'products': [_serialize(p) for p in products]})


@marketplace_products_bp.route('/<mp_id>/approve', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_marketplace_product(mp_id):
    mp = DoctorMarketplaceProduct.query.filter_by(
        id=mp_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not mp:
        return error_response('Marketplace product not found', status_code=404)
    # The admin may override this vendor's payout installment schedule (% + days)
    # before approving. When provided, it becomes the per-vendor override the
    # service payout slices by.
    data = request.get_json(silent=True) or {}
    if 'payout_installments' in data:
        insts = data.get('payout_installments')
        cleaned = []
        for idx, i in enumerate(insts or []):
            if not isinstance(i, dict):
                continue
            ptype = 'percentage' if i.get('payment_type') == 'percentage' else 'fixed'
            cleaned.append({
                'installment_no': idx + 1,
                'payment_type': ptype,
                'amount': None if ptype == 'percentage' else (float(i.get('amount') or 0)),
                'percentage': (float(i.get('percentage') or 0)) if ptype == 'percentage' else None,
                'due_after_days': max(0, int(i.get('due_after_days') or 0)),
            })
        mp.payout_installments = cleaned or None
    mp.approval_status = 'approved'
    mp.rejection_reason = None
    db.session.commit()
    return success_response(message='Product approved', data=_serialize(mp))


@marketplace_products_bp.route('/<mp_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_marketplace_product(mp_id):
    data = request.get_json() or {}
    reason = (data.get('reason') or '').strip()
    if not reason:
        return error_response('Reason is required for rejection', status_code=400)
    mp = DoctorMarketplaceProduct.query.filter_by(
        id=mp_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not mp:
        return error_response('Marketplace product not found', status_code=404)
    mp.approval_status = 'rejected'
    mp.rejection_reason = reason
    db.session.commit()
    return success_response(message='Product rejected', data=_serialize(mp))
