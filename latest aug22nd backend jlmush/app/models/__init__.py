"""
Central Model Registry
======================
All models, enums, and utilities are re-exported here so that:
  1. Alembic discovers all models for migration autogeneration
  2. ``from app.models import X`` works for any model, enum, or utility
  3. Backward-compat shims in root model.py / Rbac.py can re-export

Import order matters: base/enums first, then models in FK-dependency order.
"""

# ── Utilities & Mixins ──────────────────────────────────────────────────────
from app.models._base import (
    utcnow,
    TenantMixin,
    TimestampMixin,
    SoftDeleteMixin,
    AuditMixin,
    soft_delete_record,
    restore_record,
    set_tenant_context,
    generate_rls_sql,
    create_profile_for_user,
    get_or_create_profile_owner,
)

# ── All Enums ────────────────────────────────────────────────────────────────
from app.models._enums import (
    # User & Auth
    UserStatus, UserRole, Gender, BloodGroup,
    # Tenant
    TenantStatus,
    # Doctor & Verification
    UserVerificationStatus, DocumentVerificationStatus,
    # Entity (hospital / clinic / corporate patient)
    EntityType,
    AcceptingAppointmentType, AcceptanceMethod,
    AvailabilityApprovalStatus, PublishStatus,
    DoctorComments, ServiceName,
    # Patient
    PatientQuestionType, HouseGroupRequestStatus,
    # Doctor↔Hospital affiliation request lifecycle
    DoctorAffiliationRequestStatus,
    # Address
    AddressType,
    # Appointment
    AppointmentStatus, AppointmentType, ConsultationType,
    SCHEDULABLE_CONSULTATION_TYPES,
    FollowUpType, FollowUpInviteStatus,
    # Prescription
    PrescriptionStatus, DocumentStatus, QuestionType,
    # Payment
    PaymentStatus, PayoutStatus, DoctorBillingType, PayoutMode,
    SalaryCadence, PlatformFeeMode,
    # Hospital & Employment
    EmploymentType, Refernces, References,
    # Approval
    FieldApprovalStatus, Approval_Type, ApprovalType, MetricOverrideStatus,
    # Constants
    INDIAN_LANGUAGES,
    # Admin Permissions (legacy)
    AdminPermission,
    # Page Config
    PageType, AssetType, ConfigStatus, AuditAction,
    # RBAC
    PermissionAction, PermissionModule, DataRange, RoleLevel,
    # Provider staff RBAC (doctor / clinic / hospital) — separate key space
    # and scope from the admin RBAC above; see models/provider_staff.py.
    StaffProviderType, ProviderStaffStatus, PatientStaffStatus,
    ApprovalRequestStatus, ApprovalEntityType, OverrideType,
    ApprovalActionType, ConsultationStatus,
    # Pricing / Plans
    PlanStatus, SubscriptionStatus, BillingCycle, OverLimitAction,
    AddonStatus, AddonSubscriptionStatus,
    # Marketplace Membership (apex larazen.in — separate from SaaS Plan)
    MembershipVertical, MembershipTier,
    MembershipPlanStatus, MembershipSubscriptionStatus,
    # Service Communication (communication bundled into an admin Service /
    # Product — distinct from the appointment consultation vocabulary above)
    PurchasedServiceStatus, PurchasedServiceKind,
    ServiceChannelStatus, ServiceChannelKind, ChannelParticipantRole,
    ChannelMessageKind, ScheduledCallMode, ScheduledCallStatus,
    ChannelDocumentCategory, ChannelEventType,
)

# ── Tenant ───────────────────────────────────────────────────────────────────
from app.models.tenant import Tenant
from app.models.tenant_domain_migration_audit import TenantDomainMigrationAudit

# ── User & Auth ──────────────────────────────────────────────────────────────
from app.models.user import User, UserSession

# ── Core Profiles ────────────────────────────────────────────────────────────
from app.models.doctor import Doctor
from app.models.patient import Patient
from app.models.pharmacy import Pharmacy
from app.models.admin import Admin

# ── Shared Profile Sub-models (polymorphic) ──────────────────────────────────
from app.models.profile_shared import (
    ProfileOwner, ProfileExtended, ProfileEducationSpecialization, ProfileEducationDegree,
    ProfileWorkQualification,
    ProfileSignature, ProfileAbout, ProfileEducation,
    ProfileBankAccount, ProfileDeclarationResponse, ProfileDocument,
    DeclarationConfig,
)
from app.models.entity import EntityProfile
from app.models.authorized_personnel import AuthorizedPersonnel

# ── Hospital ─────────────────────────────────────────────────────────────────
from app.models.hospital import Hospital, DoctorHospitalAffiliation

# ── Clinic (marketplace — Round 3+4) ────────────────────────────────────────
# Sibling of Hospital but lighter (no facility / images / hospital_type).
# Apex larazen.in marketplace participants — bound to their admin User
# via ``admin_user_id`` for membership lookup.
from app.models.clinic import Clinic

# ── Catalog / Master Data ────────────────────────────────────────────────────
from app.models.catalog import Category, MasterCollege, Symptom, AllergyMaster, Product_Category, ProductSubcategory

# ── Address ──────────────────────────────────────────────────────────────────
from app.models.address import Address

# ── Doctor Qualifications & Services ─────────────────────────────────────────
from app.models.qualification import DoctorService

# ── Appointment Ecosystem ────────────────────────────────────────────────────
from app.models.appointment import (
    Appointment, FollowUpInvite, AppointmentMedicalContext,
    AppointmentSymptom, AppointmentRating, AppointmentDocument,
    AppointmentProduct,
)

# ── Scheduling ───────────────────────────────────────────────────────────────
from app.models.scheduling import TimeSlot, TimeSlotType, AttendancePageConfig

# ── Prescription & Medicine ──────────────────────────────────────────────────
from app.models.prescription import (
    MedicineBrand, Medicine, Prescription, PrescriptionMedicine,
    BannedMedicine, PrescriptionTemplate,
)

# ── Doctor Documents (generic sibling of Prescription) ───────────────────────
from app.models.document import DoctorDocument, DoctorDocumentFieldAttachment

# ── Clinical / Health Records ────────────────────────────────────────────────
from app.models.clinical import (
    HealthRecord, DoctorQuestion, PatientQuestionAnswer,
    QuestionnaireBlock, QuestionnaireBlockQuestion, DoctorSymptom,
)

# ── Payment & Billing ────────────────────────────────────────────────────────
from app.models.payment import Payment, BillingConfig, DoctorPayout

# ── Tenant payment gateway credentials (collection + payout rails) ───────────
from app.models.tenant_payment_config import TenantPaymentConfig

# ── Tenant DLT / SMS configuration (own sender + templates, plan-gated) ──────
from app.models.tenant_sms_config import TenantSmsConfig
from app.models.tenant_email_config import TenantEmailConfig

# ── Apex reseller's own Cloudflare zone (children's DNS home, P4) ────────────
from app.models.tenant_dns_config import TenantDnsConfig

# ── Account deletion register (DPDP 2023 accountability, permanent rows) ─────
from app.models.account_deletion import AccountDeletionRecord

# ── In-app notifications (persist-first, broadcast over Socket.IO) ───────────
from app.models.notification import Notification

# ── Transactional outbox for provider sends (SMS/email/push, retried) ────────
from app.models.outbound_message import OutboundMessage

# ── Device push tokens (mobile background delivery; Expo today) ──────────────
from app.models.device_push_token import DevicePushToken

# ── Media assets (stable /api/v1/media/<id> URLs over S3 objects) ────────────
from app.models.media_asset import MediaAsset

# ── Doctor Billing Profile + Employment Agreement + Salary ───────────────────
from app.models.doctor_billing import (
    DoctorBillingProfile, DoctorEmploymentAgreement, SalaryPayout,
)

# ── Display Pricing (platform markup over the doctor's quoted fee) ───────────
from app.models.display_pricing import DisplayPricingRule, SERVICE_SCOPE

# ── Vouchers / Coupons (flat ₹ reductions off the display price) ─────────────
from app.models.discount import Voucher, Coupon

# ── Pricing / Plans ──────────────────────────────────────────────────────────
from app.models.plan import (
    Plan, TenantSubscription, Addon, TenantAddon, TenantUsageCounter,
    SaasCategory, SAASPlanType,
)

# ── Marketplace Membership (apex product line) ───────────────────────────────
# Distinct from the SaaS ``Plan`` catalog above. Doctors / clinics / hospitals
# register on the apex (``larazen.in``) and subscribe to one of nine tiers
# (3 verticals × 3 tiers). Round 1 ships the schema + admin only — signup
# and payouts come in Round 2.
from app.models.membership import (
    MembershipPlan, MembershipSubscription,
)
from app.models.health_credit import (
    HealthCreditWallet, HealthCreditLedger,
)
from app.models.credit_policy import CreditPolicy
from app.models.charge_policy import ChargePolicy
from app.models.approval_policy import ApprovalPolicy
from app.models.pending_doctor_action import PendingDoctorAction
from app.models.service_interest import ServiceInterest

# ── Tenant Provider Plans (in-tenant marketplace) ─────────────────────────────
# A third product axis on top of ``Plan``/``TenantSubscription`` (SaaS) and
# ``MembershipPlan``/``MembershipSubscription`` (apex marketplace). Tenants
# author their own provider plans, gated by the
# ``tenant.can_create_<vertical>_plans`` feature add-ons. Provider profiles
# (Doctor / Clinic / Hospital) created inside a tenant subdomain bind to one
# of these via ``TenantProviderSubscription``.
from app.models.tenant_provider_plan import (
    TenantProviderPlan, TenantProviderSubscription,
)

# ── Marketplace ──────────────────────────────────────────────────────────────
from app.models.marketplace import (
    DoctorProduct, DoctorProductInstallment, DoctorMarketplaceProduct,
    MarketplaceOrder, MarketplaceServiceGroup, MarketplaceServiceGroupMember,
    ServiceGroupMemberInstallment, FeatureProductLink,
)

# ── Group Offering (admin-authored multidisciplinary healthcare plan) ─────────
from app.models.group_offering import (
    GroupOffering, GroupOfferingMember, GroupOfferingInstallment,
    GroupOfferingBooking, GroupOfferingBookingInstallment,
)

# ── Service Communication ────────────────────────────────────────────────────
# Communication that comes bundled INTO an admin-authored Service/Product
# (nutrition package, wellness plan, chronic-disease management...). A purchase
# gets its own channel: chat, provider-scheduled calls, forms, documents, an
# audit timeline and its own quotas.
#
# Deliberately independent of the appointment/consultation system — no model
# here references appointments, time_slots, consultations or doctor_services.
# See the isolation contract at the top of ``service_communication.py``.
from app.models.service_communication import (
    ServiceCommunicationConfig, PurchasedService, ServiceChannel,
    ChannelParticipant, ChannelMessage, ScheduledCall, CallSession,
    ChannelDocument, ChannelFormResponse, ChannelEvent,
)

# ── House Group ──────────────────────────────────────────────────────────────
from app.models.house_group import HouseGroupMember, HouseGroupRequest
from app.models.patient_family import (
    PatientRole, PatientRolePermission, PatientFamilyPolicy,
)
# Patient support staff — a caregiver with their own login who acts on a
# patient's behalf, bounded by a PatientRole. See models/patient_staff.py.
from app.models.patient_staff import (
    PatientStaff, PatientStaffRole, PatientStaffMinorScope,
)

# ── Care Network (doctor professional connections) ───────────────────────────
from app.models.care_network import (
    CareNetworkConnection, CareNetworkRequest, LinkRelationshipPolicy,
)

# ── Family Doctor / Empanelment (patient <-> doctor) ─────────────────────────
from app.models.family_doctor import FamilyDoctorLink, FamilyDoctorRequest

# ── Page Config ──────────────────────────────────────────────────────────────
from app.models.page_config import (
    LoginPageConfig, LoginFieldConfig, UserTypeConfig, ExtraButtonConfig,
    PageConfigAsset, PageConfig, ConfigAuditLog, PageFieldConfig,
    # Round 9 — per-module publish lifecycle (see
    # docs/features/08-configuration-system/per-module-publish-design.md)
    ModuleConfig,
)

# ── Landing Page Config (per-tenant landing + platform-owner gating) ─────────
from app.models.landing_page_config import (
    LandingConfig, LandingModule, LandingFeature, FeatureDoctor,
    LandingConfigSnapshot,
    LandingRecognition, LandingVideo,
    LandingDoctor, LandingReview, LandingTrustedBrand,
    TenantPermissionAllocation,
)

# ── Public anonymous booking — transient state between /initiate and /verify
from app.models.public_booking import PendingPublicBooking

# ── Platform-owned Landing (apex marketing + tenant default-template) ────────
# Schema-separated from the per-tenant landing system; no TenantMixin / no RLS.
# Two scopes share the same tables: MARKETING (apex) and DEFAULT_TEMPLATE
# (seeds new tenants on signup).
from app.models.platform_landing_page_config import (
    PlatformLandingConfig, PlatformLandingModule, PlatformLandingFeature,
    PlatformFeatureDoctor, PlatformLandingConfigSnapshot,
    PlatformLandingRecognition, PlatformLandingVideo,
    PlatformLandingScope,
)

# ── RBAC ─────────────────────────────────────────────────────────────────────
from app.models.rbac import (
    Role, RolePermission, SubAdminRole, AdminPermissionOverride,
    PermissionService, seed_default_roles,
)

# ── Provider staff RBAC ──────────────────────────────────────────────────────
# The people who work for a doctor / clinic / hospital, and the roles set on
# them. Parallel to the admin RBAC above rather than part of it: different
# module key space (a path through the provider's own screen tree, not
# ``PermissionModule``) and different scope (one provider vertical, not the
# whole tenant). Nothing here can log in yet.
from app.models.provider_staff import (
    ProviderStaff, ProviderRole, ProviderRolePermission, ProviderStaffRole,
    ProviderStaffBranchScope, GRANT_COLUMNS,
)

# ── Approval Workflow ────────────────────────────────────────────────────────
from app.models.approval import ApprovalRequest, ApprovalAction

# ── Consultation / Chat ──────────────────────────────────────────────────────
from app.models.consultation import Consultation, ConsultationMessage

# ── Audit ────────────────────────────────────────────────────────────────────
from app.models.audit import (
    RolePermissionAuditLog, create_permission_audit,
    OperationsAuditLog, record_ops_action,
    PlanAuditLog, record_plan_action,
)

# ── Doctor Activity ──────────────────────────────────────────────────────────
from app.models.doctor_activity import (
    MetricOverride, DoctorAdminRequest, AssetLibraryUsage,
)

# ── Field Approval ───────────────────────────────────────────────────────────
# Vendor -> tenant support access grants. Global (not tenant-scoped):
# a grant is about the vendor/tenant relationship, and both sides need
# to be able to see it.
from app.models.support_session import SupportSession

from app.models.field_approval import FieldApprovalRequest

# ── Notification Templates (SMS / email / WhatsApp registry) ─────────────────
from app.models.notification_template import NotificationTemplate
