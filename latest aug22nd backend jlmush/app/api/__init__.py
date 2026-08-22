"""
API Blueprint Package
Main API blueprint that includes all sub-module blueprints
"""
from flask import Blueprint

# Create main API blueprint
api_bp = Blueprint('api', __name__)

# Import and register legal blueprint
# Import and register legal blueprint
from app.api.legal.routes import legal_bp
api_bp.register_blueprint(legal_bp, url_prefix='/legal')

# Import and register patient blueprint
from app.api.service_reciever.patient import patient_bp
api_bp.register_blueprint(patient_bp, url_prefix='/patient')

# Import and register admin blueprint
from app.api.admin import admin_bp
api_bp.register_blueprint(admin_bp, url_prefix='/admin')

# Import and register config blueprint (Dynamic UI Configuration)
from app.api.config import config_bp
api_bp.register_blueprint(config_bp, url_prefix='/config')

# Import and register page config blueprint (Configurable Login/Signup System v2)
from app.api.page_config import page_config_bp
api_bp.register_blueprint(page_config_bp, url_prefix='/page-config')

# Import and register landing blueprint (per-tenant 3-level landing editor)
from app.api.landing_page_config import landing_page_config_bp
api_bp.register_blueprint(landing_page_config_bp, url_prefix='/landing')

# Import and register platform blueprint (PLATFORM_OWNER-only tenant + allocation mgmt)
from app.api.platform import platform_bp
api_bp.register_blueprint(platform_bp, url_prefix='/platform')

# Import and register doctor profile config blueprint (Doctor Profile Page Control)
from app.api.doctor_profile_config import doctor_profile_config_bp
api_bp.register_blueprint(doctor_profile_config_bp, url_prefix='/doctor-profile-config')

# Import and register doctor signup config blueprint (Doctor Signup Page Control)
# plus level-scoped master-data CRUD (UG/PG/Super-Speciality colleges,
# specializations, degrees).
from app.api.doctor_signup_config import doctor_signup_config_bp
api_bp.register_blueprint(doctor_signup_config_bp, url_prefix='/doctor-signup-config')

# Import and register doctor blueprint (Public doctor listing + Doctor actions)
from app.api.service_provider.doctor import doctor_bp
api_bp.register_blueprint(doctor_bp, url_prefix='/doctor')

# Import and register appointment blueprint (Booking appointments)
from app.api.common.appointment import appointment_bp
api_bp.register_blueprint(appointment_bp, url_prefix='/appointment')

# Import and register payment blueprint (Razorpay)
from app.api.common.payment import payment_bp
api_bp.register_blueprint(payment_bp, url_prefix='/payment')

# In-app notification feed (all roles; live-pushed over Socket.IO)
from app.api.notifications import notifications_bp
api_bp.register_blueprint(notifications_bp, url_prefix='/notifications')

# Import and register video blueprint (Twilio Video meetings)
from app.api.common.video import video_bp
api_bp.register_blueprint(video_bp, url_prefix='/video')

# Import and register timeslot blueprint (Time Slot management)
from app.api.common.timeslot import timeslot_bp
api_bp.register_blueprint(timeslot_bp, url_prefix='/timeslot')

# Authenticated downloads for document files (doctor + admin + patient share
# one blueprint — same ownership question, answered in one place).
from app.api.common.document_files import document_files_bp
api_bp.register_blueprint(document_files_bp, url_prefix='/document-files')

# Shared media uploads (profile pictures for every vertical). Mounted bare so
# the route is /api/profile/image.
from app.api.common.media_routes import media_bp
api_bp.register_blueprint(media_bp)

# Stable media URLs: /api/v1/media/<asset_id> 302s to a fresh presigned /
# public S3 URL. Clients cache the stable path, never the signed one.
from app.api.media import media_assets_bp
api_bp.register_blueprint(media_assets_bp, url_prefix='/media')

# Import and register doctor analytics blueprint (Metrics, Settings, Live Status)
from app.api.doctor_analytics import doctor_analytics_bp
api_bp.register_blueprint(doctor_analytics_bp, url_prefix='/doctor-analytics')

# Import and register doctor attendance blueprint (Attendance & Activity module)
from app.api.doctor_attendance import doctor_attendance_bp
api_bp.register_blueprint(doctor_attendance_bp, url_prefix='/doctor-attendance')

# Import and register admin profile config blueprint (Admin Profile Page Control)
from app.api.admin_profile_config import admin_profile_config_bp
api_bp.register_blueprint(admin_profile_config_bp, url_prefix='/admin-profile-config')

# Import and register field approval blueprint (Field-Level Approval Workflow)
from app.api.field_approval import field_approval_bp
api_bp.register_blueprint(field_approval_bp, url_prefix='/field-approval')

# Import and register patient profile config blueprint (Patient Profile Page Control)
from app.api.patient_profile_config import patient_profile_config_bp
api_bp.register_blueprint(patient_profile_config_bp, url_prefix='/patient-profile-config')

# Import and register patient appointment config blueprint (Patient Appointment Page Control)
from app.api.patient_appointment_config import patient_appointment_config_bp
api_bp.register_blueprint(patient_appointment_config_bp, url_prefix='/patient-appointment-config')

# Import and register pricing blueprint (tenant-facing plan/subscription reads)
from app.api.pricing import pricing_bp
api_bp.register_blueprint(pricing_bp, url_prefix='/pricing')

# Import and register public blueprint (landing pricing + self-serve signup)
from app.api.public import public_bp
api_bp.register_blueprint(public_bp, url_prefix='/public')

# Import and register platform landing blueprint (PLATFORM_OWNER admin
# CRUD for the apex marketing site — separate from per-tenant landings)
from app.api.platform_landing import platform_landing_bp
api_bp.register_blueprint(platform_landing_bp, url_prefix='/platform-landing')

# Import and register marketplace membership blueprint (provider-facing
# ``/me`` read for the dashboard). Admin CRUD for the catalog lives on
# the platform blueprint; this one is the doctor / clinic / hospital
# user's view of their own subscription.
from app.api.membership import membership_bp
api_bp.register_blueprint(membership_bp, url_prefix='/membership')

from app.api.entity_profile import entity_profile_bp
api_bp.register_blueprint(entity_profile_bp, url_prefix='/entity-profile')

from app.api.facility_profile import facility_profile_bp
api_bp.register_blueprint(facility_profile_bp, url_prefix='/facility')

# Import and register tenant-provider-plan blueprint — the "in-tenant
# marketplace" CRUD authored by a SaaS tenant for their own in-tenant
# providers. Gated on ``tenant.can_create_<vertical>_plans`` add-ons.
# Distinct surface from ``/api/membership`` (apex marketplace) on
# purpose — see the module docstring.
from app.api.tenant_provider_plan import (
    tenant_provider_plan_bp, tenant_provider_subscription_bp,
)
api_bp.register_blueprint(
    tenant_provider_plan_bp, url_prefix='/tenant-provider-plans',
)
# Tenant-scoped marketplace MEMBERSHIP plans ("who pays us"). Each tenant
# (apex/default included) authors its own tiers; per-vertical feature-gated.
from app.api.membership_plan import membership_plan_bp
api_bp.register_blueprint(
    membership_plan_bp, url_prefix='/membership-plans',
)

# Tenant-owned VERTICALS (the personas a tenant sells to). Always was
# tenant-scoped data; the CRUD merely lived under /api/platform, which
# made a tenant-admin act look vendor-controlled. See app/api/verticals.
from app.api.verticals import verticals_bp
api_bp.register_blueprint(verticals_bp, url_prefix='/verticals')
# Service Communication — communication bundled INTO an admin Service/Product
# (nutrition package, wellness plan, ...). A purchase gets its own channel:
# chat, provider-scheduled calls, forms, documents, timeline, quotas.
# Deliberately independent of the appointment/consultation system.
from app.api.service_communication import service_communication_bp
api_bp.register_blueprint(
    service_communication_bp, url_prefix='/service-communication',
)
# Round 10 — tenant SUPER_ADMIN manages provider subscriptions
# (change-plan, cancel, list). Sibling surface to the plan CRUD above;
# strictly tenant-scoped so a super_admin can never see / write another
# tenant's subscriptions.
api_bp.register_blueprint(
    tenant_provider_subscription_bp,
    url_prefix='/tenant-provider-subscriptions',
)

# Import and register affiliation blueprint (Round 8) — doctor↔hospital
# roster CRUD: doctor generates an invite code, hospital admins claim
# doctors via the code OR direct-create new doctor accounts onto
# their roster. Surface is shared (one blueprint) but routes are
# gated by role; see app/api/affiliation/routes.py.
from app.api.affiliation import affiliation_bp
api_bp.register_blueprint(affiliation_bp, url_prefix='/affiliation')

# Facility (clinic/hospital) care-network inbox — accept/reject the pending
# connection requests doctors sent to this facility. Gated to CLINIC/HOSPITAL.
from app.api.facility_network import facility_network_bp
api_bp.register_blueprint(facility_network_bp, url_prefix='/facility/network')

# Facility-side My Link — the doctors affiliated to this clinic/hospital, and
# operating one of them under the relationship the doctor declared.
from app.api.provider_link import provider_link_bp
api_bp.register_blueprint(provider_link_bp, url_prefix='/facility/link')

# Family Doctor / Empanelment — patient<->doctor link (both sides).
from app.api.family_doctor import family_doctor_bp
api_bp.register_blueprint(family_doctor_bp, url_prefix='/family-doctor')

from app.api.patient_family import patient_family_bp
api_bp.register_blueprint(patient_family_bp, url_prefix='/patient-family')

from app.api.patient_staff import patient_staff_bp
api_bp.register_blueprint(patient_staff_bp, url_prefix='/patient-staff')

# Provider self-service staff (My Link → Support Staff). A doctor / clinic /
# hospital managing the people who work for them. Same tables the admin
# provider-rbac surface writes, scoped to the caller's own practice — roles
# stay admin-curated, and nothing here creates a login.
from app.api.provider_staff import provider_staff_bp
api_bp.register_blueprint(provider_staff_bp, url_prefix='/provider-staff')

# Clinic branches — a main clinic manages its login-less branch clinics and
# switches into one to operate it. /api/clinic/branches[...].
from app.api.clinic_branches import clinic_branches_bp
api_bp.register_blueprint(clinic_branches_bp, url_prefix='/clinic')

# The other side of the same tables: a staff member who has signed in, reading
# their own record, practice and effective grants. Separate blueprint because
# the caller is a different person with a different role — /provider-staff is
# the practice managing its people, /staff is one of those people.
from app.api.staff import staff_bp
api_bp.register_blueprint(staff_bp, url_prefix='/staff')
