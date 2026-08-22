"""
Admin Module - Blueprint Registration
"""
from flask import Blueprint

admin_bp = Blueprint('admin', __name__)

from app.api.admin import routes  # noqa

# Register super_admin routes under /super-admin prefix
from app.api.admin.super_admin import super_admin_bp
admin_bp.register_blueprint(super_admin_bp, url_prefix='/super-admin')

# Register RBAC routes under /rbac prefix
from app.api.admin.rbac import rbac_bp
admin_bp.register_blueprint(rbac_bp, url_prefix='/rbac')

# Register availability approval routes
from app.api.admin.availability_products import availability_bp, products_bp
admin_bp.register_blueprint(availability_bp, url_prefix='/availability-approvals')
admin_bp.register_blueprint(products_bp, url_prefix='/products')

from app.api.admin.holding_channels import holding_channels_bp
admin_bp.register_blueprint(holding_channels_bp, url_prefix='/holding-channels')

# Register group service offering approval routes
from app.api.admin.service_groups import service_groups_bp
admin_bp.register_blueprint(service_groups_bp, url_prefix='/service-groups')

# Register individual marketplace-product approval routes
from app.api.admin.marketplace_products import marketplace_products_bp
admin_bp.register_blueprint(marketplace_products_bp, url_prefix='/marketplace-products')

# Register admin-authored group offering (healthcare plan) builder routes
from app.api.admin.group_offerings import group_offerings_bp
admin_bp.register_blueprint(group_offerings_bp, url_prefix='/group-offerings')

# Register admin group-offering team management (teams fulfil a plan)
from app.api.admin.group_offering_teams import group_offering_teams_bp
admin_bp.register_blueprint(group_offering_teams_bp, url_prefix='/group-offerings')

# Register super-admin tenant settings (provider directory visibility)
from app.api.admin.tenant_settings import tenant_settings_bp
admin_bp.register_blueprint(tenant_settings_bp, url_prefix='/tenant-settings')

# Tenant self-serve routing + first-run onboarding. Deliberately here
# and not under /api/platform: the tenant id is taken from the request
# context, so a SUPER_ADMIN can only ever act on their own tenant.
from app.api.admin.tenant_domain import tenant_domain_bp
admin_bp.register_blueprint(tenant_domain_bp, url_prefix='/tenant-domain')

# Tenant self-serve payment gateway (their own Razorpay + Cashfree creds —
# collections have NO platform-key fallback).
from app.api.admin.payment_gateway import payment_gateway_bp
admin_bp.register_blueprint(payment_gateway_bp, url_prefix='/payment-gateway')

from app.api.admin.contact_identity import contact_identity_bp
admin_bp.register_blueprint(contact_identity_bp, url_prefix='/contact-change')

from app.api.admin.support_thread import support_thread_bp
admin_bp.register_blueprint(support_thread_bp, url_prefix='/support')

# Tenant self-serve DLT / SMS (own sender + templates, plan-gated).
from app.api.admin.sms_config import sms_config_bp
admin_bp.register_blueprint(sms_config_bp, url_prefix='/sms-config')

from app.api.admin.email_config import email_config_bp
admin_bp.register_blueprint(email_config_bp, url_prefix='/email-config')

# Register doctor billing (type conversion, employment agreement, salary)
from app.api.admin.doctor_billing import doctor_billing_bp
admin_bp.register_blueprint(doctor_billing_bp, url_prefix='/doctor-billing')

# Register medicine catalog routes
from app.api.admin.medicine_catalog import medicine_bp
admin_bp.register_blueprint(medicine_bp, url_prefix='/medicine-catalog')

# Register prescription config routes
from app.api.admin.prescription_config import prescription_config_bp
admin_bp.register_blueprint(prescription_config_bp, url_prefix='/prescription-config')

# Register document approval routes (documents reuse the prescription template)
from app.api.admin.document_config import document_config_bp
admin_bp.register_blueprint(document_config_bp, url_prefix='/document-config')

# Register billing config routes
from app.api.admin.billing_config import billing_config_bp
admin_bp.register_blueprint(billing_config_bp, url_prefix='/billing-config')

# Register display pricing config (platform markup over doctor fees)
from app.api.admin.display_pricing import display_pricing_bp
admin_bp.register_blueprint(display_pricing_bp, url_prefix='/display-pricing')

# Register GST/TDS tax config (two-supply Indian tax model + breakdown preview)
from app.api.admin.tax_config import tax_config_bp
admin_bp.register_blueprint(tax_config_bp, url_prefix='/tax-config')

# Register payout routes
from app.api.admin.payout import payout_bp
admin_bp.register_blueprint(payout_bp, url_prefix='/payouts')

# Register read-only aggregated appointments ledger
from app.api.admin.appointments_ledger import appointments_ledger_bp
admin_bp.register_blueprint(appointments_ledger_bp, url_prefix='/appointments-ledger')

# Register Operations (super-admin IT-support act-on-behalf) routes
from app.api.admin.operations import operations_bp
admin_bp.register_blueprint(operations_bp, url_prefix='/operations')

# Register provider-staff RBAC (roles + permissions for a doctor's / clinic's /
# hospital's own staff). Distinct from the admin RBAC registered above: that
# one governs platform staff, this one governs a provider's staff, and the two
# share no module keys. See app/models/provider_staff.py.
from app.api.admin.provider_rbac import provider_rbac_bp
admin_bp.register_blueprint(provider_rbac_bp, url_prefix='/provider-rbac')

# Register Feature ↔ Product linking (persists the admin linking grid)
from app.api.admin.feature_product_links import feature_product_links_bp
admin_bp.register_blueprint(feature_product_links_bp, url_prefix='/feature-product-links')

# Apex reseller console — plan authoring + child-tenant operation for
# tenants whose plan carries the 'apex' entitlement (ResellerPolicy).
from app.api.admin.reseller import reseller_bp
admin_bp.register_blueprint(reseller_bp, url_prefix='/reseller')
