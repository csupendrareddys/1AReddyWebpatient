"""Admin "Feature ↔ Product Linking" persistence.

Backs the existing per-offering linking grid. Each offering bucket (a
consultation-type value, or ``service`` / ``group``) owns a set of rows linking
a provider (doctor) to a bookable product plus a free-text feature list and two
priority-formula placeholders. The grid saves an offering's rows wholesale, so
the PUT replaces every row for that offering in one shot.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole, FeatureProductLink, LandingFeature

logger = logging.getLogger(__name__)

feature_product_links_bp = Blueprint('admin_feature_product_links', __name__)

_MANAGE = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]


def _clean_uuid(v):
    """Empty string / falsy → None; otherwise the value as-is (UUID string)."""
    return v or None


def _group_teams(tid, product_id):
    """Active teams that fulfil a group offering.

    A team (``MarketplaceServiceGroup``) linked to an admin-authored Group
    Offering points at the OFFERING (``group_offering_id``); its ``product_id``
    is null. The linking grid passes the offering's backing product id, so
    resolve the offering from that and match teams on ``group_offering_id``.
    Falls back to ``product_id`` for doctor-led marketplace groups.
    """
    from app.models import (
        GroupOffering, MarketplaceServiceGroup as _MSG,
    )
    q = _MSG.query.filter_by(tenant_id=tid, is_active=True)
    go = GroupOffering.query.filter_by(
        tenant_id=tid, backing_product_id=product_id).first()
    if go:
        return q.filter_by(group_offering_id=go.id).all()
    return q.filter_by(product_id=product_id).all()


@feature_product_links_bp.route('/providers', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_providers():
    """The providers that ACTUALLY offer a given product — so the linking grid
    only lets you attach the right people, not any doctor:
      • service (``?offering=service&product_id=``): doctors who list that service.
      • group   (``?offering=group&product_id=``): members of the teams that
        fulfil that group offering.
      • consultation (or no product): every active doctor.
    """
    from app.models import (
        Doctor, DoctorMarketplaceProduct,
        MarketplaceServiceGroup, MarketplaceServiceGroupMember,
    )
    tid = current_tenant_id_strict()
    offering = (request.args.get('offering') or '').strip()
    product_id = request.args.get('product_id')
    out, seen = [], set()

    def _add(doctor_id, name=None):
        did = str(doctor_id)
        if did in seen:
            return
        seen.add(did)
        d = Doctor.query.get(doctor_id)
        out.append({'id': did, 'name': (d.full_name if d else name) or 'Doctor'})

    flat = request.args.get('flat') in ('1', 'true', 'yes')

    if offering == 'group' and product_id and flat:
        # Flat mode (for the care-team picker): the individual member doctors.
        for g in _group_teams(tid, product_id):
            for m in (MarketplaceServiceGroupMember.query
                      .filter_by(tenant_id=tid, group_id=g.id).all()):
                _add(m.doctor_id, m.doctor_name)
        return success_response(data={'providers': out})

    if offering == 'group' and product_id:
        # A group offering is delivered by a TEAM — return teams (each with its
        # members), not individual doctors.
        teams = []
        for g in _group_teams(tid, product_id):
            members = [m.doctor_name for m in g.members if m.doctor_name]
            teams.append({
                'id': str(g.id),
                'name': (g.lead.full_name + "'s team") if g.lead else 'Team',
                'members': members,
                'is_team': True,
            })
        return success_response(data={'providers': teams})

    if offering == 'service' and product_id:
        for r in DoctorMarketplaceProduct.query.filter_by(
                tenant_id=tid, product_id=product_id, is_active=True).all():
            _add(r.doctor_id)
    else:
        for d in Doctor.query.filter_by(tenant_id=tid, is_deleted=False).all():
            _add(d.id, d.full_name)

    return success_response(data={'providers': out})


@feature_product_links_bp.route('/landing-features', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_landing_features():
    """The tenant's landing-page features — the options for the grid's
    "List of features" column. Deduplicated by title (a draft + live config can
    both hold the same feature).

    The SaaS vendor (``is_platform``) authors its marketing site on the
    ``PlatformLandingFeature`` stack, not the tenant ``LandingFeature`` stack —
    so on the vendor tenant we read the former, falling back to the latter only
    if empty. Every customer tenant uses its own ``LandingFeature`` rows.
    """
    from app.models import Tenant
    tid = current_tenant_id_strict()
    is_vendor = db.session.query(
        Tenant.query.filter_by(id=tid, is_platform=True).exists()
    ).scalar()

    seen, out = set(), []

    def _add(fid, title):
        key = (title or '').strip().lower()
        if not key or key in seen:
            return
        seen.add(key)
        out.append({'id': str(fid), 'title': title})

    if is_vendor:
        from app.models.platform_landing_page_config import PlatformLandingFeature
        for f in PlatformLandingFeature.query.order_by(PlatformLandingFeature.title).all():
            _add(f.id, f.title)

    # Tenant landing features (the only source for customer tenants; a fallback
    # for the vendor when the platform stack has none yet).
    if not is_vendor or not out:
        for f in (LandingFeature.query
                  .filter_by(tenant_id=tid)
                  .order_by(LandingFeature.title).all()):
            _add(f.id, f.title)

    return success_response(data={'features': out})


@feature_product_links_bp.route('', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_links():
    """Rows for one offering bucket (``?offering=<key>``), ordered for display."""
    offering = (request.args.get('offering') or '').strip()
    if not offering:
        return error_response('offering is required', status_code=400)
    tid = current_tenant_id_strict()
    rows = (FeatureProductLink.query
            .filter_by(tenant_id=tid, offering_key=offering)
            .order_by(FeatureProductLink.display_order, FeatureProductLink.created_at)
            .all())
    return success_response(data={'links': [r.to_dict() for r in rows]})


@feature_product_links_bp.route('/all', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_all_links():
    """Every link for the tenant, grouped by offering bucket.

    Lets a surface that shows all offerings at once (the feature editor's
    product-linking section) load in a single request and stay in sync with the
    per-offering standalone page, which reads/writes the same rows.
    """
    tid = current_tenant_id_strict()
    rows = (FeatureProductLink.query
            .filter_by(tenant_id=tid)
            .order_by(FeatureProductLink.display_order, FeatureProductLink.created_at)
            .all())
    grouped = {}
    for r in rows:
        grouped.setdefault(r.offering_key, []).append(r.to_dict())
    return success_response(data={'links_by_offering': grouped})


@feature_product_links_bp.route('', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE)
def replace_links():
    """Replace every row for one offering bucket with the posted set."""
    offering = (request.args.get('offering') or '').strip()
    if not offering:
        return error_response('offering is required', status_code=400)
    payload = request.get_json(silent=True) or {}
    rows = payload.get('rows')
    if not isinstance(rows, list):
        return error_response('rows must be a list', status_code=400)

    tid = current_tenant_id_strict()
    # Wholesale replace: drop the offering's existing rows, insert the new set.
    FeatureProductLink.query.filter_by(tenant_id=tid, offering_key=offering).delete()
    for idx, r in enumerate(rows):
        doctor_id = _clean_uuid(r.get('doctor_id'))
        team_id = _clean_uuid(r.get('team_id'))
        if not doctor_id and not team_id:
            continue  # a row must name a provider (doctor) or a team to persist
        feats = r.get('features')
        db.session.add(FeatureProductLink(
            tenant_id=tid,
            offering_key=offering,
            plan_ref=(r.get('plan_ref') or None),
            doctor_id=doctor_id,
            team_id=team_id,
            product_id=_clean_uuid(r.get('product_id')),
            features=feats if isinstance(feats, list) else [],
            formula1=(r.get('formula1') or None),
            formula2=(r.get('formula2') or None),
            display_order=int(r.get('display_order') or idx),
        ))
    db.session.commit()
    saved = (FeatureProductLink.query
             .filter_by(tenant_id=tid, offering_key=offering)
             .order_by(FeatureProductLink.display_order, FeatureProductLink.created_at)
             .all())
    return success_response(data={'links': [s.to_dict() for s in saved]})
