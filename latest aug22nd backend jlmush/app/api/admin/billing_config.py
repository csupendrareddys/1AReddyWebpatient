"""
Admin Billing Config Routes
Manage platform charges, GST, and TDS rates for doctor billing.
"""
import logging
from flask import Blueprint, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, feature_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict, current_tenant_id_or_default
from app.extensions import db
from app.models import UserRole, BillingConfig

logger = logging.getLogger(__name__)

billing_config_bp = Blueprint('billing_config', __name__)

UPDATABLE_FIELDS = [
    # NOTE: the three platform charges (charge1/2/3) were moved to each
    # marketplace MembershipPlan (see app/models/membership.py). BillingConfig
    # still owns the columns for back-compat, but the admin UI no longer edits
    # them and payout math no longer reads them.
    'cgst_rate', 'sgst_rate', 'tds_rate',
    # IGST — the inter-state leg. Nullable: NULL means "derive it as
    # cgst + sgst", which is what it must equal anyway (a supply is taxed the
    # same total whichever side of a state line it lands on). Editable here so
    # a tenant whose GSTIN state differs from its doctors' can state the rate
    # explicitly rather than relying on the derivation.
    'igst_rate',
    # Per-consultation-type CGST/SGST(/IGST) overrides (JSONB map). Unlisted
    # types fall back to the flat rates above.
    'gst_by_consultation_type',
    # Tenant-default payout hold (T days) for Plan doctors
    'default_hold_days',
    # Tenant-wide % off every patient-facing price. Validated below rather
    # than by the generic ``endswith('_rate')`` branch — it also has an upper
    # bound, since a >100% discount would mean paying patients to book.
    'platform_discount_pct',
    # Bill template fields
    'bill_company_name', 'bill_company_tagline',
    'bill_pan', 'bill_gst_reg', 'bill_cin', 'bill_sac',
    'bill_support_email', 'bill_footer_note', 'bill_logo_url',
]


@billing_config_bp.route('', methods=['GET'])
@jwt_required()
@feature_required('admin.billing_config')
@role_required([UserRole.SUPER_ADMIN])
def get_billing_config():
    """Get the active billing configuration for the current tenant."""
    tenant_id = current_tenant_id_strict()
    config = BillingConfig.query.filter_by(
        tenant_id=tenant_id, is_active=True,
    ).first()
    if not config:
        # Return defaults (no row yet). ``tenant_id`` is set explicitly so the
        # auto-created row belongs to the current tenant, not to whatever RLS
        # would infer from session state.
        config = BillingConfig(tenant_id=tenant_id)
        db.session.add(config)
        config.created_by_id = current_user.id
        db.session.commit()
        logger.info(f"[BILLING_CONFIG] Created default billing config id={config.id}")

    return success_response(data=config.to_dict())


@billing_config_bp.route('', methods=['PUT'])
@jwt_required()
@feature_required('admin.billing_config')
@role_required([UserRole.SUPER_ADMIN])
def update_billing_config():
    """Update the active billing configuration for the current tenant."""
    data = request.get_json() or {}

    tenant_id = current_tenant_id_strict()
    config = BillingConfig.query.filter_by(
        tenant_id=tenant_id, is_active=True,
    ).first()
    if not config:
        config = BillingConfig(tenant_id=tenant_id, created_by_id=current_user.id)
        db.session.add(config)

    for field in UPDATABLE_FIELDS:
        if field not in data:
            continue
        value = data[field]

        # Handled first and short-circuited: this field's NAME ends with
        # ``_type`` (it's a JSON map, not a charge type), so it must skip the
        # generic ``endswith('_type')`` / ``endswith('_rate')`` checks below —
        # otherwise the dict payload is wrongly rejected as not 'percentage'/'fixed'.
        if field == 'gst_by_consultation_type':
            # Map of {consultation_type: {cgst, sgst, igst?}} with numeric
            # non-negative rates. Unlisted types fall back to the flat rates, so
            # an empty/absent map is valid (means "use flat for all").
            if value in (None, ''):
                value = None
            elif isinstance(value, dict):
                cleaned = {}
                for ctype, rates in value.items():
                    if not isinstance(rates, dict):
                        return error_response(
                            f"Invalid GST override for '{ctype}': expected an object with cgst/sgst")
                    try:
                        cgst = float(rates.get('cgst'))
                        sgst = float(rates.get('sgst'))
                    except (ValueError, TypeError):
                        return error_response(
                            f"Invalid GST rates for '{ctype}': cgst/sgst must be numbers")
                    if cgst < 0 or sgst < 0:
                        return error_response(
                            f"GST rates for '{ctype}' cannot be negative")
                    entry = {'cgst': cgst, 'sgst': sgst}

                    # IGST is optional per type; omitting it means "derive it as
                    # cgst + sgst". When given it must match that sum, or the
                    # inter-state leg would tax the same supply differently from
                    # the intra-state one.
                    raw_igst = rates.get('igst')
                    if raw_igst not in (None, ''):
                        try:
                            igst = float(raw_igst)
                        except (ValueError, TypeError):
                            return error_response(
                                f"Invalid IGST rate for '{ctype}': must be a number")
                        if igst < 0:
                            return error_response(
                                f"IGST rate for '{ctype}' cannot be negative")
                        if abs(igst - (cgst + sgst)) > 0.001:
                            return error_response(
                                f"IGST for '{ctype}' ({igst}) must equal CGST + SGST "
                                f"({cgst + sgst}) — IGST is the sum of the intra-state pair.")
                        entry['igst'] = igst
                    cleaned[ctype] = entry
                value = cleaned
            else:
                return error_response("Invalid value for gst_by_consultation_type: expected an object")
            setattr(config, field, value)
            continue

        # Blank IGST means "derive from cgst + sgst" — store NULL rather than
        # coercing to 0, which would zero-rate every inter-state supply.
        if field == 'igst_rate' and value in (None, ''):
            config.igst_rate = None
            continue

        # Validate type fields
        if field.endswith('_type') and value not in ('percentage', 'fixed'):
            return error_response(f"Invalid value for {field}: must be 'percentage' or 'fixed'")
        # Validate numeric fields
        if field.endswith('_value') or field.endswith('_rate'):
            try:
                value = float(value)
                if value < 0:
                    return error_response(f"{field} cannot be negative")
            except (ValueError, TypeError):
                return error_response(f"Invalid numeric value for {field}")
        if field == 'default_hold_days':
            try:
                value = max(0, int(value))
            except (ValueError, TypeError):
                return error_response("Invalid value for default_hold_days")
        if field == 'platform_discount_pct':
            # Blank is how the form says "no sale on" — 0, not an error.
            if value in (None, ''):
                value = 0
            try:
                value = float(value)
            except (ValueError, TypeError):
                return error_response("Invalid value for platform_discount_pct")
            if value < 0 or value > 100:
                return error_response(
                    'platform_discount_pct must be between 0 and 100.')
        setattr(config, field, value)

    # Same rule the /tax-config surface enforces — the two write paths edit the
    # same columns, so they must not be able to disagree.
    if config.igst_rate is not None:
        combined = float(config.cgst_rate or 0) + float(config.sgst_rate or 0)
        # Read the rejected values BEFORE rolling back: the rollback expires the
        # instance, so touching an attribute afterwards re-loads the persisted
        # row and the message would quote the old value, not the bad one.
        rejected = float(config.igst_rate)
        if abs(rejected - combined) > 0.001:
            db.session.rollback()
            return error_response(
                f'IGST ({rejected}) must equal CGST + SGST ({combined}) — '
                'IGST is the sum of the intra-state pair.')

    db.session.commit()
    logger.info(f"[BILLING_CONFIG] Updated by user={current_user.id}")

    return success_response(data=config.to_dict(), message='Billing configuration updated successfully')


@billing_config_bp.route('/public', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR])
def get_billing_config_public():
    """Get billing config charge names and rates (for doctor billing page headers)."""
    config = BillingConfig.query.filter_by(
        tenant_id=current_tenant_id_strict(), is_active=True,
    ).first()
    if not config:
        config = BillingConfig()

    # Charge labels now come from the doctor's active membership plan, not
    # BillingConfig. GST/TDS remain tenant-wide.
    from app.models import Doctor
    from app.api.common.payment.billing_service import resolve_charge_names
    doctor = Doctor.query.filter_by(
        tenant_id=current_tenant_id_strict(), user_id=current_user.id,
    ).first()
    charge_names = resolve_charge_names(doctor) if doctor else (
        'Charge 1', 'Charge 2', 'Charge 3')

    return success_response(data={
        'charge1_name': charge_names[0],
        'charge2_name': charge_names[1],
        'charge3_name': charge_names[2],
        'cgst_rate': str(config.cgst_rate),
        'sgst_rate': str(config.sgst_rate),
        'tds_rate': str(config.tds_rate),
    })
