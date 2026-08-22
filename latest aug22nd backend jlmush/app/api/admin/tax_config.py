"""Admin "Tax Configuration" — the two-supply GST/TDS setup + live preview.

Backs the tax split shown on ``/dashboard/admin/pricing-config``. Deliberately
separate from ``billing_config.py`` (which still owns the legacy flat
cgst/sgst/tds fields and the bill template): this blueprint owns the
*two-supply* model introduced in ``app.common.tax`` — the doctor's
professional supply and the platform's facilitation supply, each with its own
taxable value, mode and rates.

Routes (all SUPER_ADMIN, mounted at ``/api/admin/tax-config``):

  GET  ``/``           the tenant's resolved tax configuration + metadata
  PUT  ``/``           update the tax columns on BillingConfig
  POST ``/breakdown``  itemised tax split for one or many priced rows —
                       exactly the shape the pricing table needs

``/breakdown`` is the authoritative money math. The frontend mirrors it for
instant feedback while the admin types, the way the page already mirrors
``apply_rule``, but the server number is the one that must be believed.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.common.responses import error_response, success_response
from app.common.tax import (
    SERVICE_SCOPE, TAX_MODES, compute_tax_breakdown, doctor_state,
    platform_state, resolve_doctor_rates, resolve_platform_rates,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import (
    BillingConfig, Doctor, DoctorMarketplaceProduct, UserRole,
)

logger = logging.getLogger(__name__)

tax_config_bp = Blueprint('tax_config', __name__)

#: Rate columns this blueprint owns. Percentages, non-negative.
RATE_FIELDS = (
    'cgst_rate', 'sgst_rate', 'igst_rate',
    'platform_fee_cgst_rate', 'platform_fee_sgst_rate', 'platform_fee_igst_rate',
    'tds_rate',
)
MODE_FIELDS = ('doctor_tax_mode', 'platform_tax_mode')
BOOL_FIELDS = ('platform_fee_tax_inclusive', 'tds_exclude_gst')

#: Rows are capped so a malformed client can't ask for unbounded work.
MAX_BREAKDOWN_ROWS = 500


def _get_or_create_config(tenant_id):
    config = BillingConfig.query.filter_by(
        tenant_id=tenant_id, is_active=True,
    ).first()
    if config is None:
        config = BillingConfig(tenant_id=tenant_id,
                               created_by_id=getattr(current_user, 'id', None))
        db.session.add(config)
        db.session.commit()
        logger.info('[TAX_CONFIG] created default BillingConfig id=%s', config.id)
    return config


def _config_payload(config):
    """The tax half of BillingConfig, plus what the rates resolve to today."""
    plat_state = platform_state(config)
    doctor_rates = resolve_doctor_rates(config, supplier_state=plat_state,
                                        place_of_supply=plat_state)
    platform_rates = resolve_platform_rates(config, supplier_state=plat_state,
                                            place_of_supply=plat_state)
    return {
        'doctor_supply': {
            'tax_mode': config.doctor_tax_mode,
            'cgst_rate': str(config.cgst_rate),
            'sgst_rate': str(config.sgst_rate),
            'igst_rate': (str(config.igst_rate)
                          if config.igst_rate is not None else None),
            'effective_igst_rate': str(doctor_rates.igst_rate),
            'tax_inclusive': True,  # structural: the doctor's fee IS the payout
            'by_consultation_type': config.gst_by_consultation_type or {},
        },
        'platform_supply': {
            'tax_mode': config.platform_tax_mode,
            'cgst_rate': str(config.platform_fee_cgst_rate),
            'sgst_rate': str(config.platform_fee_sgst_rate),
            'igst_rate': (str(config.platform_fee_igst_rate)
                          if config.platform_fee_igst_rate is not None else None),
            'effective_igst_rate': str(platform_rates.igst_rate),
            'tax_inclusive': bool(config.platform_fee_tax_inclusive),
        },
        'tds': {
            'rate': str(config.tds_rate),
            'exclude_gst': bool(config.tds_exclude_gst),
            'section': '194J',
        },
        'place_of_supply': {
            'platform_state': plat_state,
            'gstin': config.bill_gst_reg,
        },
        'tax_modes': list(TAX_MODES),
        # Flat mirrors so a form can bind straight to the column names.
        'flat': {
            **{f: (str(getattr(config, f))
                   if getattr(config, f) is not None else None)
               for f in RATE_FIELDS},
            **{f: getattr(config, f) for f in MODE_FIELDS},
            **{f: bool(getattr(config, f)) for f in BOOL_FIELDS},
        },
    }


# ─── read ──────────────────────────────────────────────────────────────────

@tax_config_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def get_tax_config():
    """The tenant's GST/TDS configuration for both supplies."""
    return success_response(
        data=_config_payload(_get_or_create_config(current_tenant_id_strict())))


# ─── write ─────────────────────────────────────────────────────────────────

@tax_config_bp.route('', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_tax_config():
    """Update the tax columns. Accepts the flat column names.

    Body (all keys optional)::

        {"doctor_tax_mode": "none", "igst_rate": 18,
         "platform_fee_cgst_rate": 9, "platform_fee_sgst_rate": 9,
         "platform_tax_mode": "auto", "platform_fee_tax_inclusive": true,
         "tds_rate": 10, "tds_exclude_gst": true}
    """
    data = request.get_json() or {}
    config = _get_or_create_config(current_tenant_id_strict())

    for field in RATE_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if value in (None, ''):
            # Only the two IGST legs are nullable ("derive from cgst+sgst").
            if field not in ('igst_rate', 'platform_fee_igst_rate'):
                return error_response(f'{field} is required')
            setattr(config, field, None)
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            return error_response(f'Invalid numeric value for {field}')
        if value < 0 or value > 100:
            return error_response(f'{field} must be between 0 and 100')
        setattr(config, field, value)

    for field in MODE_FIELDS:
        if field not in data:
            continue
        mode = (data[field] or '').strip().lower()
        if mode not in TAX_MODES:
            return error_response(
                f"{field} must be one of {', '.join(TAX_MODES)}")
        setattr(config, field, mode)

    for field in BOOL_FIELDS:
        if field in data:
            setattr(config, field, bool(data[field]))

    # IGST must equal CGST + SGST or the inter-state leg silently under/over
    # charges relative to the intra-state one.
    for igst_f, cgst_f, sgst_f in (
        ('igst_rate', 'cgst_rate', 'sgst_rate'),
        ('platform_fee_igst_rate', 'platform_fee_cgst_rate',
         'platform_fee_sgst_rate'),
    ):
        igst = getattr(config, igst_f)
        if igst is None:
            continue
        combined = float(getattr(config, cgst_f) or 0) + float(getattr(config, sgst_f) or 0)
        if abs(float(igst) - combined) > 0.001:
            return error_response(
                f'{igst_f} ({igst}) must equal {cgst_f} + {sgst_f} ({combined}) — '
                'IGST is the sum of the intra-state pair.')

    db.session.commit()
    logger.info('[TAX_CONFIG] updated by user=%s', current_user.id)
    return success_response(data=_config_payload(config),
                            message='Tax configuration saved.')


# ─── preview ───────────────────────────────────────────────────────────────

@tax_config_bp.route('/breakdown', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def breakdown():
    """Itemised tax split for one or many priced rows.

    Body::

        {"scope_type": "video",            # or "service"
         "scope_key":  "10-20",            # product id when scope_type=service
         "rows": [{"doctor_id": "...", "doctor_fee": 500,
                   "display_price": 575}]}

    A single row may also be posted flat (``doctor_fee`` / ``display_price`` at
    the top level) — the response then carries one entry in ``rows``.

    Returns ``{"rows": [<breakdown>, ...], "totals": {...}}`` where each
    breakdown is :meth:`app.common.tax.TaxBreakdown.as_dict`.
    """
    data = request.get_json() or {}
    tenant_id = current_tenant_id_strict()
    config = _get_or_create_config(tenant_id)

    scope_type = (data.get('scope_type') or data.get('consultation_type') or '').strip()
    scope_key = (data.get('scope_key') or '').strip()

    rows = data.get('rows')
    if not isinstance(rows, list):
        if data.get('doctor_fee') is None:
            return error_response('rows must be a list, or pass doctor_fee directly')
        rows = [{
            'doctor_id': data.get('doctor_id'),
            'doctor_fee': data.get('doctor_fee'),
            'display_price': data.get('display_price'),
        }]
    if len(rows) > MAX_BREAKDOWN_ROWS:
        return error_response(f'At most {MAX_BREAKDOWN_ROWS} rows per request')

    # One query for every doctor referenced, tenant-scoped — a doctor_id from
    # the client must never reach another tenant's row.
    doctor_ids = {str(r.get('doctor_id')) for r in rows
                  if isinstance(r, dict) and r.get('doctor_id')}
    doctors = {}
    if doctor_ids:
        try:
            doctors = {
                str(d.id): d for d in Doctor.query.filter(
                    Doctor.tenant_id == tenant_id,
                    Doctor.id.in_(doctor_ids),
                ).all()
            }
        except Exception:
            logger.exception('[TAX_CONFIG] doctor lookup failed; using flat rates')

    # For a catalog service the product's own tax_mode/rates govern the
    # doctor's supply, so resolve the listing per doctor once.
    products = {}
    if scope_type == SERVICE_SCOPE and scope_key:
        try:
            products = {
                str(m.doctor_id): m for m in DoctorMarketplaceProduct.query.filter(
                    DoctorMarketplaceProduct.tenant_id == tenant_id,
                    DoctorMarketplaceProduct.product_id == scope_key,
                ).all()
            }
        except Exception:
            logger.exception('[TAX_CONFIG] listing lookup failed; using flat rates')

    out, totals = [], {
        'doctor_taxable_value': 0.0, 'doctor_gst_total': 0.0,
        'platform_taxable_value': 0.0, 'platform_gst_total': 0.0,
        'tds_amount': 0.0, 'net_to_doctor': 0.0, 'total_to_patient': 0.0,
    }
    for row in rows:
        if not isinstance(row, dict):
            return error_response('Each row must be an object')
        doctor_id = str(row.get('doctor_id')) if row.get('doctor_id') else None
        result = compute_tax_breakdown(
            row.get('doctor_fee'),
            row.get('display_price'),
            config=config,
            doctor=doctors.get(doctor_id),
            consultation_type=scope_type or None,
            product=products.get(doctor_id),
            tenant_id=tenant_id,
        )
        entry = result.as_dict()
        entry['doctor_id'] = doctor_id
        out.append(entry)
        for key in totals:
            totals[key] += float(getattr(result, key))

    return success_response(data={
        'scope_type': scope_type,
        'scope_key': scope_key,
        'rows': out,
        'totals': {k: f'{v:.2f}' for k, v in totals.items()},
    })
