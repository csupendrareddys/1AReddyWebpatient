"""
Consolidated Enum Definitions
All application enums in one place for clean imports.
"""
import enum


# ============================================================================
# USER & AUTH
# ============================================================================

class UserStatus(enum.Enum):
    ACTIVE = 'active'
    INACTIVE = 'inactive'
    PENDING = 'pending'
    BLOCKED = 'blocked'


class UserRole(enum.Enum):
    # PLATFORM_OWNER sits above SUPER_ADMIN and owns the tenancy graph:
    # it creates tenants and allocates which landing-page modules each
    # tenant's super-admin is allowed to configure.
    PLATFORM_OWNER = 'platform_owner'
    SUPER_ADMIN = 'super_admin'
    SUB_ADMIN = 'sub_admin'
    PATIENT = 'patient'
    DOCTOR = 'doctor'
    PHARMACY = 'pharmacy'
    DIAGNOSIS = 'diagnosis'
    # Marketplace facility admins (Round 3+4) — registered on the apex
    # alongside DOCTOR, distinct roles so each gets its own dashboard
    # layout + RBAC bypass story. The User who signs up at
    # /auth/service-provider/<vertical>/signup gets one of these; the
    # Clinic / Hospital row hangs off ``admin_user_id``.
    CLINIC = 'clinic'
    HOSPITAL = 'hospital'
    # A person who works FOR a provider (see models/provider_staff.py) —
    # a clinic's front desk, a doctor's assistant. They sign in through the
    # same /auth/service-provider portal as the practice they belong to,
    # because from their side it IS their clinic's login; what differs is
    # where they land and what they can reach, which comes from their roles
    # rather than from this value. One role for all three verticals: the
    # vertical is a fact about their ProviderStaff row, and duplicating it
    # here would mean three roles that behave identically everywhere.
    PROVIDER_STAFF = 'provider_staff'
    # A caregiver / support staff employed by ONE patient, with their own
    # login, who acts on that patient's behalf bounded by a PatientRole. The
    # patient they serve is a fact about their PatientStaff row.
    PATIENT_STAFF = 'patient_staff'


class Gender(enum.Enum):
    MALE = 'male'
    FEMALE = 'female'
    OTHER = 'other'


class BloodGroup(enum.Enum):
    A_POSITIVE = 'a_positive'
    A_NEGATIVE = 'a_negative'
    B_POSITIVE = 'b_positive'
    B_NEGATIVE = 'b_negative'
    O_POSITIVE = 'o_positive'
    O_NEGATIVE = 'o_negative'
    AB_POSITIVE = 'ab_positive'
    AB_NEGATIVE = 'ab_negative'


# ============================================================================
# TENANT
# ============================================================================

class TenantStatus(enum.Enum):
    ACTIVE = 'active'
    INACTIVE = 'inactive'
    SUSPENDED = 'suspended'


# ============================================================================
# DOCTOR & VERIFICATION
# ============================================================================

# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class UserVerificationStatus(enum.Enum):
    PENDING = 'pending'
    QUERY = 'Query'  # FIXME: should be 'query', requires data migration
    VERIFIED = 'verified'
    REJECTED = 'rejected'
    SUSPENDED = 'suspended'


class DocumentVerificationStatus(enum.Enum):
    PENDING = 'pending'
    VERIFIED = 'verified'
    REJECTED = 'rejected'


class EntityType(enum.Enum):
    """Legal-entity taxonomy for a registrant (hospital / clinic / corporate
    patient). ``INDIVIDUAL`` is the default; every other value marks a
    corporate entity that also carries entity-details + authorized-personnel
    info. Shared across all three surfaces via ``EntityProfile``."""
    INDIVIDUAL = 'individual'
    PROPRIETORSHIP = 'proprietorship'
    PARTNERSHIP = 'partnership'
    PRIVATE_LIMITED = 'private_limited'
    PUBLIC_LIMITED = 'public_limited'
    SECTION_8 = 'section_8'
    TRUST = 'trust'


# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class AcceptingAppointmentType(enum.Enum):
    AUTO_ACCEPT = 'auto_accept'
    AUTO_REJECT = 'auto_reject'
    MANUAL = 'manual'


class AcceptanceMethod(enum.Enum):
    """How an appointment was initially handled at booking time."""
    AUTO_APPROVED = 'auto_approved'
    MANUALLY_APPROVED = 'manually_approved'


class AvailabilityApprovalStatus(enum.Enum):
    NOT_SUBMITTED = 'not_submitted'
    PENDING = 'pending'
    APPROVED = 'approved'
    REJECTED = 'rejected'


class PublishStatus(enum.Enum):
    """Controls patient-facing visibility of doctor/admin profiles."""
    ACTIVE = 'active'
    INACTIVE = 'inactive'
    ON_HOLD = 'on_hold'
    SUSPENDED = 'suspended'


# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class DoctorComments(enum.Enum):
    DUTY_TIMING = 'duty_timing'
    WORKING_DAY = 'working_day'
    WORK_PLATFORM = 'work_platform'


# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class ServiceName(enum.Enum):
    ONLINE_CONSULTATION = 'online_consultation'
    INSTANT_CONSULTATION = 'instant_consultation'
    CLINICAL_CONSULTATION = 'clinical_consultation'
    PATIENT_HOME_VISIT = 'patient_home_visit'
    COUNSELING = 'counseling'
    VACCINATION = 'vaccination'


# ============================================================================
# PATIENT
# ============================================================================

# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class PatientQuestionType(enum.Enum):
    VITAL = 'vital'
    HEALTH_HABITS = 'health_habits'
    DISEASES = 'diseases'
    PREGNANCY = 'pregnancy'
    LIFESTYLE = 'lifestyle'


class HouseGroupRequestStatus(enum.Enum):
    PENDING = 'pending'
    ACCEPTED = 'accepted'
    REJECTED = 'rejected'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'


# Lifecycle of a doctor↔hospital affiliation as it is created.
# Hospital admin (apex marketplace) initiates either via code-redemption
# or direct-create; the row exists in PENDING until the doctor accepts
# (then APPROVED) or rejects (then REJECTED). CANCELLED is set when the
# hospital admin withdraws their request before the doctor has acted.
# Direct-create requests are minted as APPROVED immediately because the
# hospital is also vouching for the new doctor's identity.
class DoctorAffiliationRequestStatus(enum.Enum):
    PENDING = 'pending'
    APPROVED = 'approved'
    REJECTED = 'rejected'
    CANCELLED = 'cancelled'


# ============================================================================
# ADDRESS
# ============================================================================

# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class AddressType(enum.Enum):
    HOME = 'home'
    RELATIVE = 'relative'
    OFFICE = 'office'
    TEMPORARY = 'temporary'


# ============================================================================
# APPOINTMENT
# ============================================================================

# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class AppointmentStatus(enum.Enum):
    PENDING_PAYMENT = 'pending_payment'
    PENDING = 'pending'
    CONFIRMED = 'confirmed'
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'
    CANCELLED = 'cancelled'
    EXPIRED = 'expired'
    NO_SHOW = 'no_show'


class AppointmentType(enum.Enum):
    ONLINE = 'online'
    IN_CLINIC = 'in_clinic'
    HOME_VISIT = 'home_visit'


class ConsultationType(enum.Enum):
    """The consultation mode a doctor offers for a time slot."""
    VIDEO = 'video'
    AUDIO = 'audio'
    CHAT = 'chat'
    COMPLETE = 'complete'
    HOME_VISIT = 'home_visit'
    CAMP = 'camp'


# All schedulable consultation type values
SCHEDULABLE_CONSULTATION_TYPES = [e.value for e in ConsultationType]


class FollowUpType(enum.Enum):
    """How a follow-up appointment was initiated."""
    FREE_DOCTOR = 'free_doctor'
    PAID_PATIENT_PICKS = 'paid_patient_picks'
    PAID_DOCTOR_PICKS = 'paid_doctor_picks'


class FollowUpInviteStatus(enum.Enum):
    PENDING = 'pending'
    BOOKED = 'booked'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'


# ============================================================================
# PRESCRIPTION
# ============================================================================

class PrescriptionStatus(enum.Enum):
    DRAFT = 'draft'
    PENDING_APPROVAL = 'pending_approval'
    APPROVED = 'approved'
    ACTIVE = 'active'
    REJECTED = 'rejected'
    REVISED = 'revised'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'


class DocumentStatus(enum.Enum):
    """Lifecycle of a doctor-authored patient Document.

    Deliberately identical to :class:`PrescriptionStatus` — the doctor's
    "My Documents" hub is the same draft → approval → push workflow as
    "My Prescriptions", just for a non-prescription artefact. Kept as a
    separate enum (and PG type) so the two lifecycles can diverge later
    without a destructive migration.
    """
    DRAFT = 'draft'
    PENDING_APPROVAL = 'pending_approval'
    APPROVED = 'approved'
    ACTIVE = 'active'
    REJECTED = 'rejected'
    REVISED = 'revised'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'


class QuestionType(enum.Enum):
    TEXT = 'text'
    NUMBER = 'number'
    BOOLEAN = 'boolean'
    SINGLE_CHOICE = 'single_choice'
    MULTIPLE_CHOICE = 'multiple_choice'
    DATE = 'date'
    SCALE = 'scale'


# ============================================================================
# PAYMENT
# ============================================================================

class PaymentStatus(enum.Enum):
    CREATED = 'created'
    PENDING = 'pending'
    PROCESSING = 'processing'
    AUTHORIZED = 'authorized'
    SUCCESS = 'success'
    FAILED = 'failed'
    REFUNDED = 'refunded'


class PayoutStatus(enum.Enum):
    ON_HOLD = 'on_hold'        # earning held for T days before it becomes payable
    CLAIMABLE = 'claimable'    # T elapsed, claim-mode doctor may Claim it
    PENDING = 'pending'        # in the admin settle queue ("pay me now")
    PROCESSING = 'processing'
    COMPLETED = 'completed'
    FAILED = 'failed'
    REVERSED = 'reversed'


class DoctorBillingType(enum.Enum):
    """How a doctor is paid. All doctors start as PLAN; admin may convert."""
    PLAN = 'plan'
    EMPLOYEE = 'employee'
    CONSULTANT = 'consultant'


class PayoutMode(enum.Enum):
    """Per-doctor release mode after the T-day hold (admin always settles)."""
    AUTOPAY = 'autopay'   # auto-enters the admin payout queue
    CLAIM = 'claim'       # doctor must Claim to enter the queue


class SalaryCadence(enum.Enum):
    """How often an employee/consultant is paid their fixed salary/retainer."""
    MONTHLY = 'monthly'
    FORTNIGHTLY = 'fortnightly'   # every 15 days


class PlatformFeeMode(enum.Enum):
    """Platform-fee treatment for employee/consultant salary.
    Employees default to zero; a plan-based deduction or a custom value are
    options, and a super-admin may force zero."""
    ZERO = 'zero'
    PLAN = 'plan'
    CUSTOM = 'custom'


# ============================================================================
# HOSPITAL & EMPLOYMENT
# ============================================================================

# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class EmploymentType(enum.Enum):
    FULL_TIME = 'full_time'
    PART_TIME = 'part_time'
    INTERNSHIP = 'internship'
    CONSULTANT = 'consultant'
    PARTNER = 'partner'


# OTHER1/OTHER2 removed -- were placeholder values with no real usage
class References(enum.Enum):
    FAMILY = 'family'
    FRIEND = 'friend'

Refernces = References  # backward compat alias


# ============================================================================
# FIELD APPROVAL
# ============================================================================

class FieldApprovalStatus(enum.Enum):
    PENDING = 'pending'
    APPROVED = 'approved'
    REJECTED = 'rejected'
    QUERY = 'query'


class ApprovalType(enum.Enum):
    QUERY = 'Query'  # FIXME: should be 'query', requires data migration
    INVALID = 'invalid'
    HOLD = 'Hold'  # FIXME: should be 'hold', requires data migration
    TEMPORARILY_APPROVED = 'temporarly approved'  # FIXME: typo 'temporarly', should be 'temporarily_approved', requires data migration
    VERIFIED_1 = 'Verified 1'  # FIXME: should be 'verified_1', requires data migration
    VERIFIED_2 = 'Verified 2'  # FIXME: should be 'verified_2', requires data migration
    VERIFIED_3 = 'Verified 3'  # FIXME: should be 'verified_3', requires data migration
    COMPLETED = 'Completed'  # FIXME: should be 'completed', requires data migration

Approval_Type = ApprovalType  # backward compat alias


class MetricOverrideStatus(enum.Enum):
    PENDING = 'pending'
    APPROVED = 'approved'
    REJECTED = 'rejected'


# ============================================================================
# ADMIN PERMISSIONS (Legacy)
# ============================================================================

class AdminPermission(enum.Enum):
    """
    DEPRECATED -- Do NOT use this enum for new permission checks.

    This enum is superseded by the RBAC system:
        PermissionModule + PermissionAction + PermissionService (see below).

    The class is kept alive only because existing route decorators still
    reference its members via the ``_LEGACY_TO_RBAC`` mapping in
    decorators.py.  Once all legacy decorator call-sites have been migrated
    to the new RBAC helpers, this class should be removed.

    Original purpose: granular permissions for sub-admins.
    Super admins have ALL permissions by default and bypass permission checks.
    """
    VIEW_PATIENTS = 'view_patients'
    EDIT_PATIENT_STATUS = 'edit_patient_status'
    VIEW_APPOINTMENTS = 'view_appointments'
    VIEW_DOCTORS = 'view_doctors'
    EDIT_DOCTOR_STATUS = 'edit_doctor_status'
    VERIFY_DOCTORS = 'verify_doctors'
    # Marketplace facility verification (Round 3+4). Sub-admins can be
    # granted these independently of VERIFY_DOCTORS so verification
    # responsibilities split cleanly between credentialing teams.
    VERIFY_CLINICS = 'verify_clinics'
    VERIFY_HOSPITALS = 'verify_hospitals'
    MANAGE_LOGIN_CONFIG = 'manage_login_config'
    APPROVE_FIELD_CHANGES = 'approve_field_changes'
    MANAGE_PUBLISH_STATUS = 'manage_publish_status'
    MANAGE_MEDICINE_CATALOG = 'manage_medicine_catalog'
    MANAGE_ALLERGY_CATALOG = 'manage_allergy_catalog'
    # ── Round 9 invite add-ons ─────────────────────────────────
    # Distinct from VERIFY_* (which gates reviewing pending
    # verifications). The INVITE_* set gates the operator's
    # ability to CREATE new roster rows via the admin-side
    # invite endpoints. Super_admin can delegate any subset to a
    # sub_admin via ManageSubAdmins. Plan-gating runs in
    # parallel via the ``admin.invite_*`` feature paths so a
    # subscriber tenant whose plan doesn't include the add-on
    # gets the FeatureGate 403 even if RBAC says yes.
    INVITE_DOCTORS = 'invite_doctors'
    INVITE_PATIENTS = 'invite_patients'
    INVITE_HOSPITALS = 'invite_hospitals'
    INVITE_CLINICS = 'invite_clinics'
    # ── Round 10 provider-subscription management ──────────────
    # Tenant SUPER_ADMIN can change which TenantProviderPlan a
    # specific provider (doctor / clinic / hospital) is on, or
    # cancel their subscription entirely. Delegatable to a
    # sub_admin so the super_admin doesn't have to do every
    # routine reassignment themselves. View permission is a
    # weaker grant (read-only roster + plan visibility).
    VIEW_PROVIDER_SUBSCRIPTIONS = 'view_provider_subscriptions'
    MANAGE_PROVIDER_SUBSCRIPTIONS = 'manage_provider_subscriptions'

    @classmethod
    def all_permissions(cls):
        return [p.value for p in cls]

    @classmethod
    def validate_permissions(cls, permissions_list):
        valid_perms = cls.all_permissions()
        invalid = [p for p in permissions_list if p not in valid_perms]
        return invalid == [], invalid


# ============================================================================
# PAGE CONFIG
# ============================================================================

class PageType(enum.Enum):
    PATIENT_LOGIN = 'patient_login'
    DOCTOR_LOGIN = 'doctor_login'
    ADMIN_LOGIN = 'admin_login'
    PATIENT_SIGNUP = 'patient_signup'
    DOCTOR_SIGNUP = 'doctor_signup'
    PHARMACY_SIGNUP = 'pharmacy_signup'
    DIAGNOSIS_SIGNUP = 'diagnosis_signup'
    DOCTOR_PROFILE = 'doctor_profile'
    ADMIN_PROFILE = 'admin_profile'
    PATIENT_PROFILE = 'patient_profile'
    PATIENT_APPOINTMENT_FILTER = 'patient_appointment_filter'
    PATIENT_APPOINTMENT_SYMPTOMS = 'patient_appointment_symptoms'


class AssetType(enum.Enum):
    LOGO = 'logo'
    FAVICON = 'favicon'
    BACKGROUND_IMAGE = 'background_image'
    TERMS_DOCUMENT = 'terms_document'
    PRIVACY_DOCUMENT = 'privacy_document'
    # Landing video gallery — uploaded mp4/webm/mov clips and their square
    # thumbnail images. Capped at 5 MB / 1 MB respectively in
    # ``S3Service.upload_file``.
    VIDEO = 'video'
    THUMBNAIL = 'thumbnail'


class ConfigStatus(enum.Enum):
    DRAFT = 'draft'
    PREVIEW = 'preview'
    LIVE = 'live'
    ARCHIVED = 'archived'


class AuditAction(enum.Enum):
    CREATE = 'create'
    UPDATE = 'update'
    PREVIEW = 'preview'
    PUBLISH = 'publish'
    ARCHIVE = 'archive'
    ASSET_UPLOAD = 'asset_upload'
    ASSET_DELETE = 'asset_delete'


INDIAN_LANGUAGES = [
    {'code': 'as', 'name': 'Assamese', 'native': '\u0985\u09b8\u09ae\u09c0\u09af\u09bc\u09be'},
    {'code': 'bn', 'name': 'Bengali', 'native': '\u09ac\u09be\u0982\u09b2\u09be'},
    {'code': 'gu', 'name': 'Gujarati', 'native': '\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0'},
    {'code': 'hi', 'name': 'Hindi', 'native': '\u0939\u093f\u0928\u094d\u0926\u0940'},
    {'code': 'kn', 'name': 'Kannada', 'native': '\u0c95\u0ca8\u0ccd\u0ca8\u0ca1'},
    {'code': 'ks', 'name': 'Kashmiri', 'native': '\u0915\u0949\u0936\u0941\u0930'},
    {'code': 'kok', 'name': 'Konkani', 'native': '\u0915\u094b\u0902\u0915\u0923\u0940'},
    {'code': 'ml', 'name': 'Malayalam', 'native': '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02'},
    {'code': 'mr', 'name': 'Marathi', 'native': '\u092e\u0930\u093e\u0920\u0940'},
    {'code': 'or', 'name': 'Odia', 'native': '\u0b13\u0b21\u0b3c\u0b3f\u0b06'},
    {'code': 'pa', 'name': 'Punjabi', 'native': '\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40'},
    {'code': 'sa', 'name': 'Sanskrit', 'native': '\u0938\u0902\u0938\u094d\u0915\u0943\u0924\u092e\u094d'},
    {'code': 'ta', 'name': 'Tamil', 'native': '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd'},
    {'code': 'te', 'name': 'Telugu', 'native': '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41'},
    {'code': 'ur', 'name': 'Urdu', 'native': '\u0627\u0631\u062f\u0648'},
    {'code': 'en', 'name': 'English', 'native': 'English'},
]


# ============================================================================
# RBAC (Role-Based Access Control)
# ============================================================================

class PermissionAction(enum.Enum):
    """Core permission actions."""
    FULL_ACCESS = 'full_access'
    VIEW = 'view'
    CREATE = 'create'
    EDIT = 'edit'
    UPDATE = 'update'
    DELETE = 'delete'
    L1_VERIFIER = 'l1_verifier'
    L2_VERIFIER = 'l2_verifier'
    L3_VERIFIER = 'l3_verifier'
    LOCK = 'lock'
    UNLOCK = 'unlock'


class PermissionModule(enum.Enum):
    """Every page/feature in the application that needs access control."""
    # Login & Signup Pages
    LOGIN_PAGE_CONFIG = 'login_page_config'
    PATIENT_LOGIN_PAGE = 'patient_login_page'
    DOCTOR_LOGIN_PAGE = 'doctor_login_page'
    ADMIN_LOGIN_PAGE = 'admin_login_page'
    PATIENT_SIGNUP_PAGE = 'patient_signup_page'
    DOCTOR_SIGNUP_PAGE = 'doctor_signup_page'
    PHARMACY_SIGNUP_PAGE = 'pharmacy_signup_page'
    DIAGNOSIS_SIGNUP_PAGE = 'diagnosis_signup_page'
    # Patient Management
    PATIENT_LIST = 'patient_list'
    PATIENT_PROFILE = 'patient_profile'
    PATIENT_PERSONAL_INFO = 'patient_personal_info'
    PATIENT_HEALTH_RECORDS = 'patient_health_records'
    PATIENT_INSURANCE = 'patient_insurance'
    PATIENT_EMERGENCY_CONTACT = 'patient_emergency_contact'
    PATIENT_HOUSE_GROUP = 'patient_house_group'
    PATIENT_DOCUMENTS = 'patient_documents'
    PATIENT_QUESTION_ANSWERS = 'patient_question_answers'
    # Doctor Management
    DOCTOR_LIST = 'doctor_list'
    DOCTOR_PROFILE = 'doctor_profile'
    DOCTOR_PERSONAL_INFO = 'doctor_personal_info'
    DOCTOR_PROFESSIONAL_INFO = 'doctor_professional_info'
    DOCTOR_QUALIFICATIONS = 'doctor_qualifications'
    DOCTOR_SPECIALIZATIONS = 'doctor_specializations'
    DOCTOR_SERVICES = 'doctor_services'
    DOCTOR_HOSPITAL_AFFILIATIONS = 'doctor_hospital_affiliations'
    DOCTOR_AVAILABILITY_SLOTS = 'doctor_availability_slots'
    DOCTOR_CONSULTATION_FEE = 'doctor_consultation_fee'
    DOCTOR_VERIFICATION = 'doctor_verification'
    DOCTOR_QUESTIONS = 'doctor_questions'
    # Appointment Management
    APPOINTMENT_LIST = 'appointment_list'
    APPOINTMENT_DETAILS = 'appointment_details'
    APPOINTMENT_SCHEDULING = 'appointment_scheduling'
    APPOINTMENT_CANCELLATION = 'appointment_cancellation'
    APPOINTMENT_SYMPTOMS = 'appointment_symptoms'
    APPOINTMENT_RATINGS = 'appointment_ratings'
    APPOINTMENT_DOCUMENTS = 'appointment_documents'
    APPOINTMENT_FOLLOW_UPS = 'appointment_follow_ups'
    # Consultation / Chat
    CONSULTATION_LIST = 'consultation_list'
    CONSULTATION_CHAT = 'consultation_chat'
    CONSULTATION_ATTACHMENTS = 'consultation_attachments'
    CONSULTATION_STATUS = 'consultation_status'
    # Prescription
    PRESCRIPTION_LIST = 'prescription_list'
    PRESCRIPTION_DETAILS = 'prescription_details'
    PRESCRIPTION_MEDICINES = 'prescription_medicines'
    # Pharmacy
    PHARMACY_LIST = 'pharmacy_list'
    PHARMACY_PROFILE = 'pharmacy_profile'
    PHARMACY_VERIFICATION = 'pharmacy_verification'
    # Hospital
    HOSPITAL_LIST = 'hospital_list'
    HOSPITAL_PROFILE = 'hospital_profile'
    HOSPITAL_VERIFICATION = 'hospital_verification'
    # Clinic (marketplace — Round 3+4)
    CLINIC_LIST = 'clinic_list'
    CLINIC_PROFILE = 'clinic_profile'
    CLINIC_VERIFICATION = 'clinic_verification'
    # Payment & Billing
    PAYMENT_LIST = 'payment_list'
    PAYMENT_DETAILS = 'payment_details'
    PAYMENT_REFUNDS = 'payment_refunds'
    # Category / Specialization
    CATEGORY_MANAGEMENT = 'category_management'
    # Medicine
    MEDICINE_LIST = 'medicine_list'
    MEDICINE_BRANDS = 'medicine_brands'
    # Symptom
    SYMPTOM_MANAGEMENT = 'symptom_management'
    # Questionnaire
    QUESTIONNAIRE_BLOCKS = 'questionnaire_blocks'
    # Admin Management
    ADMIN_LIST = 'admin_list'
    ADMIN_ROLES = 'admin_roles'
    ADMIN_PERMISSIONS = 'admin_permissions'
    SUB_ADMIN_MANAGEMENT = 'sub_admin_management'
    # Approval Workflow
    APPROVAL_REQUESTS = 'approval_requests'
    APPROVAL_PROCESSING = 'approval_processing'
    # Approvals hub — per-module scopes (assignable to sub-admins). One per
    # module card on the Approvals hub so a sub-admin can be given only the
    # approval types they own.
    APPROVE_REGISTRATION = 'approve_registration'
    APPROVE_APPOINTMENT = 'approve_appointment'
    APPROVE_PROFILE = 'approve_profile'
    APPROVE_WORKING_DAYS = 'approve_working_days'
    APPROVE_EDUCATION = 'approve_education'
    APPROVE_BANK = 'approve_bank'
    APPROVE_BANK_ACCOUNT = 'approve_bank_account'
    APPROVE_PAYOUT = 'approve_payout'
    # System / Config
    SYSTEM_SETTINGS = 'system_settings'
    AUDIT_LOGS = 'audit_logs'
    # Reports & Analytics
    REPORTS_DASHBOARD = 'reports_dashboard'
    REPORTS_PATIENTS = 'reports_patients'
    REPORTS_DOCTORS = 'reports_doctors'
    REPORTS_APPOINTMENTS = 'reports_appointments'
    REPORTS_REVENUE = 'reports_revenue'
    # Landing Page Configuration (per-tenant, gated by PLATFORM_OWNER allocation)
    LANDING_HERO = 'landing_hero'
    LANDING_NAV = 'landing_nav'
    LANDING_FEATURES = 'landing_features'
    # Dynamic 3-level landing: coarse landing-wide perm + instance-scoped module
    # perm. ``landing_config`` grants edit on hero + full landing lifecycle;
    # ``landing_module`` is used with a ``resource_id`` = LandingModule.id for
    # per-module instance ACL (sub-admin X can edit one module but not others).
    LANDING_CONFIG = 'landing_config'
    LANDING_MODULE = 'landing_module'
    # Platform / Tenant Management (PLATFORM_OWNER only)
    TENANT_MANAGEMENT = 'tenant_management'
    TENANT_PERMISSIONS = 'tenant_permissions'
    # Pricing / Plans (PLATFORM_OWNER writes; tenant reads own subscription)
    PLAN_CATALOG = 'plan_catalog'
    PLAN_SUBSCRIPTION = 'plan_subscription'
    ADDON_CATALOG = 'addon_catalog'
    # Round 10 — tenant SUPER_ADMIN manages provider subscriptions
    # (doctor/clinic/hospital plan + cancel). Distinct from
    # PLAN_SUBSCRIPTION (which is the tenant's OWN SaaS plan with
    # larazen). Tenant-scoped — never crosses tenant boundaries.
    PROVIDER_SUBSCRIPTION_LIST = 'provider_subscription_list'
    # ── Operations module (super-admin IT-support; RBAC-grantable later) ──
    # Act-on-behalf surfaces. Super_admin bypasses the RBAC check today, so
    # these gate nothing yet — they exist so a sub-admin can later be granted
    # scoped view/edit/create on the Operations sub-modules with no route
    # rewrites. OPERATIONS_PATIENT covers patient profile view/edit; the
    # rest are reserved for the sub-modules that follow.
    # Support chat — the seller<->tenant support surface (holding-page
    # "contact your provider" flow). Grantable to sub-admins on BOTH
    # sides: a tenant's sub-admin who talks to the seller, and the
    # seller's staff who answer.
    SUPPORT_CHAT = 'support_chat'
    OPERATIONS_PATIENT = 'operations_patient'
    OPERATIONS_BOOKING = 'operations_booking'
    OPERATIONS_DOCTOR = 'operations_doctor'
    OPERATIONS_ADMIN = 'operations_admin'


class PlanStatus(enum.Enum):
    DRAFT = 'draft'
    ACTIVE = 'active'
    ARCHIVED = 'archived'


class SubscriptionStatus(enum.Enum):
    TRIAL = 'trial'
    ACTIVE = 'active'
    PAST_DUE = 'past_due'
    CANCELLED = 'cancelled'
    SUSPENDED = 'suspended'
    OVER_LIMIT = 'over_limit'


class BillingCycle(enum.Enum):
    # Keys match ``PRICING_PERIODS`` in plan_catalog_service and the
    # ``price_inr_<period>`` keys in Plan.pricing, so a period that can
    # be PRICED can also be BOUGHT. Adding a member here without adding
    # it to ``PERIOD_DAYS`` re-opens the priceable-but-unbuyable gap.
    MONTHLY = 'monthly'
    QUARTERLY = 'quarterly'
    SEMI_ANNUAL = 'semi_annual'
    ANNUAL = 'annual'
    BIENNIAL = 'biennial'
    TRIENNIAL = 'triennial'
    # Charged once; the add-on then lives and dies with the main plan
    # (no expiry of its own). Only valid for ADD-ON purchases — the
    # subscription rails never emit it (it is not in PERIOD_DAYS).
    ONE_TIME = 'one_time'


class OverLimitAction(enum.Enum):
    BLOCK_NEW = 'block_new'
    GRACE_THEN_SUSPEND = 'grace_then_suspend'
    SUSPEND_IMMEDIATELY = 'suspend_immediately'


class AddonStatus(enum.Enum):
    DRAFT = 'draft'
    ACTIVE = 'active'
    ARCHIVED = 'archived'


class AddonSubscriptionStatus(enum.Enum):
    ACTIVE = 'active'
    CANCELLED = 'cancelled'
    SUSPENDED = 'suspended'


# ============================================================================
# Marketplace Membership (apex larazen.in product line — separate from the
# SaaS tenant ``Plan`` catalog above). Doctors, clinics, and hospitals
# register *on* the apex and pick one of three tiers per vertical.
# Subscription rows in ``membership_subscriptions`` bind a provider profile
# (Doctor / Clinic / Hospital) to a ``MembershipPlan`` row.
# ============================================================================

class MembershipVertical(enum.Enum):
    """Which kind of marketplace participant a plan / subscription is for.

    Doubles as the ``provider_type`` discriminator on
    ``MembershipSubscription`` — the polymorphic ``provider_id`` points at
    a row in ``doctors`` / ``clinics`` / ``hospitals`` accordingly.
    """
    DOCTOR = 'doctor'
    CLINIC = 'clinic'
    HOSPITAL = 'hospital'
    # A patient can also hold a marketplace membership (a "receiver" plan),
    # chosen at registration. ``provider_id`` then points at a ``patients`` row.
    PATIENT = 'patient'


class MembershipTier(enum.Enum):
    """Logical ordering within a vertical. Pairs with the row's display
    ``name`` — Hospital's PRO tier renders as "Enterprise" without the
    enum needing a separate value."""
    BASIC = 'basic'
    GROWTH = 'growth'
    PRO = 'pro'


class MembershipPlanStatus(enum.Enum):
    """Same shape as ``PlanStatus`` but kept distinct so the two product
    lines (SaaS plans vs marketplace memberships) never alias into the
    same Postgres enum type."""
    DRAFT = 'draft'
    ACTIVE = 'active'
    ARCHIVED = 'archived'


class MembershipSubscriptionStatus(enum.Enum):
    """Lifecycle states for a marketplace membership.

    ``PENDING`` (Round 2) — created at signup, before admin approval.
    Trial clock is paused: ``trial_ends_at`` stays NULL so the
    provider doesn't burn trial days while waiting for credential
    verification. The doctor-approval handler flips PENDING → TRIAL
    and sets ``trial_ends_at = approval_time + plan.trial_days``.

    ``TRIAL`` / ``ACTIVE`` / ``PAST_DUE`` / ``CANCELLED`` / ``SUSPENDED``
    mirror ``SubscriptionStatus`` for symmetry.
    """
    PENDING = 'pending'
    TRIAL = 'trial'
    ACTIVE = 'active'
    PAST_DUE = 'past_due'
    CANCELLED = 'cancelled'
    SUSPENDED = 'suspended'


class StaffProviderType(enum.Enum):
    """Which kind of service provider a ``ProviderStaff`` row hangs off.

    Deliberately NOT ``MembershipVertical``, which carries a fourth value
    (PATIENT). A patient has no staff, and reusing that enum here would make
    "patient's front desk" a state the schema permits and the code has to keep
    rejecting by hand. Three values means the database refuses it instead.
    """
    DOCTOR = 'doctor'
    CLINIC = 'clinic'
    HOSPITAL = 'hospital'


class ProviderStaffStatus(enum.Enum):
    """Whether a staff member's grants currently apply.

    No INVITED / PENDING value: staff cannot log in yet, so there is nothing to
    invite them to. Add it when the login seat (``ProviderStaff.user_id``) is
    actually wired, not before — an unreachable state in an enum reads as a
    feature that exists.
    """
    ACTIVE = 'active'
    SUSPENDED = 'suspended'


class PatientStaffStatus(enum.Enum):
    """Whether a patient support-staff caregiver's grants currently apply.

    Unlike ``ProviderStaffStatus``, a patient caregiver DOES log in (the seat is
    provisioned with a real login), so SUSPENDED is a live state — it stands the
    caregiver down without deleting the person or their audit trail.
    """
    ACTIVE = 'active'
    SUSPENDED = 'suspended'


class DataRange(enum.Enum):
    """How far back in time a role can access data."""
    LAST_15_DAYS = 15
    LAST_30_DAYS = 30
    LAST_60_DAYS = 60
    LAST_90_DAYS = 90
    LAST_180_DAYS = 180
    LAST_360_DAYS = 360
    ALL = 99999

    @property
    def days(self):
        return self.value

    @property
    def label(self):
        labels = {
            15: 'Last 15 Days', 30: 'Last 30 Days', 60: 'Last 60 Days',
            90: 'Last 90 Days', 180: 'Last 180 Days', 360: 'Last 360 Days',
            99999: 'All Time',
        }
        return labels.get(self.value, f'Last {self.value} Days')


class RoleLevel(enum.Enum):
    LEVEL_1 = 1
    LEVEL_2 = 2
    LEVEL_3 = 3
    LEVEL_4 = 4
    LEVEL_5 = 5


class ApprovalRequestStatus(enum.Enum):
    PENDING = 'pending'
    UNDER_REVIEW = 'under_review'
    QUERY = 'query'
    APPROVED_L1 = 'approved_l1'
    APPROVED_L2 = 'approved_l2'
    APPROVED_L3 = 'approved_l3'
    COMPLETED = 'completed'
    REJECTED = 'rejected'
    # A still-pending request the doctor superseded by re-submitting a change
    # that matches the already-approved state (so no review is needed).
    CANCELLED = 'cancelled'


class ApprovalEntityType(enum.Enum):
    DOCTOR_PROFILE = 'doctor_profile'
    DOCTOR_QUALIFICATION = 'doctor_qualification'
    DOCTOR_SPECIALIZATION = 'doctor_specialization'
    DOCTOR_SERVICE = 'doctor_service'
    DOCTOR_HOSPITAL = 'doctor_hospital'
    DOCTOR_AVAILABILITY = 'doctor_availability'
    DOCTOR_FEE = 'doctor_fee'
    DOCTOR_SIGNATURE = 'doctor_signature'
    DOCTOR_ABOUT = 'doctor_about'
    DOCTOR_EDUCATION = 'doctor_education'
    PATIENT_PROFILE = 'patient_profile'
    PATIENT_INSURANCE = 'patient_insurance'
    PHARMACY_PROFILE = 'pharmacy_profile'
    HOSPITAL_PROFILE = 'hospital_profile'


class OverrideType(enum.Enum):
    GRANT = 'grant'
    DENY = 'deny'


class ApprovalActionType(enum.Enum):
    APPROVE = 'approve'
    REJECT = 'reject'
    QUERY = 'query'
    RESPOND = 'respond'
    ESCALATE = 'escalate'
    CANCEL = 'cancel'


class ConsultationStatus(enum.Enum):
    PENDING = 'pending'
    ASSIGNED = 'assigned'
    IN_PROGRESS = 'in_progress'
    QUERY_RAISED = 'query_raised'
    PATIENT_RESPONDED = 'patient_responded'
    COMPLETED = 'completed'
    CANCELLED = 'cancelled'


# ---------------------------------------------------------------------------
# Service Communication module
# ---------------------------------------------------------------------------
# A patient buys an admin-authored Service/Product that INCLUDES ongoing
# communication (nutrition package, mental-wellness plan, chronic-disease
# management, legal document assistance...). That purchase gets its own
# channel with its own validity, permissions and quotas.
#
# Deliberately kept separate from the appointment/consultation vocabulary
# (``ConsultationType``, ``AppointmentStatus``): this module must not couple
# to the appointment system, so it does not reuse those enums even where a
# value happens to read the same.
# ---------------------------------------------------------------------------


class PurchasedServiceStatus(enum.Enum):
    """Lifecycle of a patient's purchased service entitlement."""
    PENDING = 'pending'      # paid/created, not yet activated
    ACTIVE = 'active'        # inside its validity window
    EXPIRED = 'expired'      # validity window elapsed
    CANCELLED = 'cancelled'  # refunded / revoked by admin


class PurchasedServiceKind(enum.Enum):
    """What role an entitlement plays.

    A plain individual purchase is INDIVIDUAL. A group service purchase mints
    several entitlements at once: one GROUP_PER_DOCTOR row per serving doctor
    (each backs a 1:1 patient↔doctor channel with its own quota/validity) plus
    one GROUP_SHARED row (backs the single group channel holding the patient +
    every doctor). The distinction lets the lead doctor hold BOTH a per-doctor
    leg and a share of the group entitlement without colliding on the
    active-entitlement unique index (see ``ux_purchased_services_active_group``).
    """
    INDIVIDUAL = 'individual'
    GROUP_PER_DOCTOR = 'group_per_doctor'
    GROUP_SHARED = 'group_shared'


class ServiceChannelStatus(enum.Enum):
    """Lifecycle of the communication channel itself."""
    ACTIVE = 'active'        # full read/write
    READ_ONLY = 'read_only'  # service expired: history visible, nothing new
    ARCHIVED = 'archived'    # awaiting retention purge


class ServiceChannelKind(enum.Enum):
    """Shape of a channel: a 1:1 conversation or a multi-doctor group chat."""
    SINGLE = 'single'
    GROUP = 'group'


class ChannelParticipantRole(enum.Enum):
    """Who a participant is in the channel.

    Only PATIENT and PROVIDER are created today; the rest exist so group
    consultations become an INSERT rather than a migration.
    """
    PATIENT = 'patient'
    PROVIDER = 'provider'
    NURSE = 'nurse'
    FAMILY = 'family'
    OBSERVER = 'observer'
    # An admin participating in a channel — used by the vendor "holding" channel
    # (admin ↔ held vendor). In a holding channel the ADMIN is the only one who
    # may schedule calls; the vendor (PROVIDER) can chat + send documents.
    ADMIN = 'admin'


class ChannelMessageKind(enum.Enum):
    """What a message row carries."""
    TEXT = 'text'
    ATTACHMENT = 'attachment'
    PROPOSAL = 'proposal'    # patient proposing a call time (they cannot schedule)


class ScheduledCallMode(enum.Enum):
    AUDIO = 'audio'
    VIDEO = 'video'


class ScheduledCallStatus(enum.Enum):
    PROPOSED = 'proposed'        # patient-suggested time, awaiting provider
    SCHEDULED = 'scheduled'      # provider created it
    ACCEPTED = 'accepted'        # patient accepted
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'
    CANCELLED = 'cancelled'
    NO_SHOW = 'no_show'


class ChannelDocumentCategory(enum.Enum):
    """Document buckets surfaced under "My Medical Records".

    There is deliberately NO ``prescription`` member — prescriptions are
    generated by the existing untouched workflow and are never uploaded here.
    """
    UPLOADED = 'uploaded'
    CONSULTATION = 'consultation'
    REPORT = 'report'


class ChannelEventType(enum.Enum):
    """System timeline entries — the channel's audit trail.

    Rendered inline with messages but visually distinct, so a reader (or an
    auditor) can reconstruct what happened over the service's lifetime
    without opening a separate activity log.
    """
    SERVICE_BOOKED = 'service_booked'
    CHANNEL_CREATED = 'channel_created'
    CALL_SCHEDULED = 'call_scheduled'
    CALL_ACCEPTED = 'call_accepted'
    PARTICIPANT_JOINED = 'participant_joined'
    CALL_COMPLETED = 'call_completed'
    CALL_CANCELLED = 'call_cancelled'
    FORM_SUBMITTED = 'form_submitted'
    DOCUMENT_UPLOADED = 'document_uploaded'
    SERVICE_EXPIRED = 'service_expired'
    CONVERSATION_ARCHIVED = 'conversation_archived'


class PlanKind:
    """SaaS plan kinds (plain constants — the column is varchar + CHECK,
    matching the ``dns_status`` precedent of avoiding DB enum churn).

    * ``NORMAL`` — a tenant subscription (run your own portal).
    * ``APEX``   — a RESELLER entitlement: the subscriber may author its
      own normal-kind plans and create child tenants up to the plan's
      ``max_child_subdomains`` / ``max_child_custom_domains`` quotas.
      Only the vendor authors apex plans (``owner_tenant_id IS NULL``).
    """
    NORMAL = 'normal'
    APEX = 'apex'
    ALL = (NORMAL, APEX)
