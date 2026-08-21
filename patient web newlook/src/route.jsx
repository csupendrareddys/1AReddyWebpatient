import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { CircularProgress, Box } from '@mui/material';

// Plan-feature route wrapper. Renders an "upgrade required" panel
// when the tenant's plan doesn't include the given feature path,
// preventing the page from mounting AND from firing API calls that
// are guaranteed to 403 from @feature_required on the backend.
import FeatureGuard from './common/components/FeatureGuard/FeatureGuard';

// Landing Page
const LandingPage = lazy(() => import('./pages/LandingPage/LandingPage'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound'));
const ModulePage = lazy(() => import('./pages/ModulePage/ModulePage'));
const ServiceDetailPage = lazy(() => import('./pages/ServiceDetailPage/ServiceDetailPage'));
const VideoGalleryPage = lazy(() => import('./pages/VideoGalleryPage/VideoGalleryPage'));
const SaasPricingPage = lazy(() => import('./pages/SaasPricingPage/SaasPricingPage'));
const JoinNetworkPage = lazy(() => import('./pages/JoinNetworkPage/JoinNetworkPage'));
const JoinReceiverPage = lazy(() => import('./pages/JoinReceiverPage/JoinReceiverPage'));
const PersonaChooserPage = lazy(() => import('./pages/PersonaChooserPage/PersonaChooserPage'));
const RedirectToJoinWithVertical = lazy(() =>
    import('./pages/RedirectToJoinWithVertical/RedirectToJoinWithVertical')
);

// Public anonymous-booking flow (anonymous → pay → auto-create account →
// first-login OTP → set password → patient dashboard).
const PublicDoctorListPage = lazy(() => import('./pages/public/PublicDoctorListPage'));
const PublicDoctorSlotsPage = lazy(() => import('./pages/public/PublicDoctorSlotsPage'));
const BookingConfirmationPage = lazy(() => import('./pages/public/BookingConfirmationPage'));
const FirstLoginOtpPage = lazy(() => import('./pages/public/FirstLoginOtpPage'));
const SetPasswordPage = lazy(() => import('./pages/public/SetPasswordPage'));

// Auth Pages
const ServiceReceiverLoginPage = lazy(() => import('./features/auth/pages/ServiceReceiverLoginPage/ServiceReceiverLoginPage'));
const ServiceProviderLoginPage = lazy(() => import('./features/auth/pages/ServiceProviderLoginPage/ServiceProviderLoginPage'));
const AdminLoginPage = lazy(() => import('./features/auth/pages/AdminLoginPage/AdminLoginPage'));
const PatientSignupPage = lazy(() => import('./features/auth/pages/PatientSignupPage/PatientSignupPage'));
const DoctorSignupPage = lazy(() => import('./features/auth/pages/DoctorSignupPage/DoctorSignupPage'));
const ClinicSignupPage = lazy(() => import('./features/auth/pages/ClinicSignupPage/ClinicSignupPage'));
const HospitalSignupPage = lazy(() => import('./features/auth/pages/HospitalSignupPage/HospitalSignupPage'));
const StaffLayout = lazy(() => import('./features/staff/layouts/StaffLayout'));
const StaffDashboard = lazy(() => import('./features/staff/pages/StaffDashboard/StaffDashboard'));
const StaffModuleGuard = lazy(() => import('./features/staff/components/StaffModuleGuard/StaffModuleGuard'));
const StaffTeamPage = lazy(() => import('./features/staff/pages/StaffTeamPage/StaffTeamPage'));
const StaffRolesPage = lazy(() => import('./features/staff/pages/StaffRolesPage/StaffRolesPage'));
const StaffPracticePage = lazy(() => import('./features/staff/pages/StaffPracticePage/StaffPracticePage'));
const StaffBillingPage = lazy(() => import('./features/staff/pages/StaffBillingPage/StaffBillingPage'));
const StaffDoctorProfilePage = lazy(() => import('./features/staff/pages/StaffDoctorProfilePage/StaffDoctorProfilePage'));
const ClinicLayout = lazy(() => import('./features/service-provider/layouts/ClinicLayout'));
const HospitalLayout = lazy(() => import('./features/service-provider/layouts/HospitalLayout'));
const ClinicDashboard = lazy(() => import('./features/service-provider/ClinicDashboard/pages/ClinicDashboard'));
const HospitalDashboard = lazy(() => import('./features/service-provider/HospitalDashboard/pages/HospitalDashboard'));
const FacilityComingSoonPage = lazy(() => import('./features/service-provider/common/pages/ComingSoonPage'));
const PharmacySignupPage = lazy(() => import('./features/auth/pages/PharmacySignupPage/PharmacySignupPage'));
const DiagnosisSignupPage = lazy(() => import('./features/auth/pages/DiagnosisSignupPage/DiagnosisSignupPage'));
const TermsAndConditionsPage = lazy(() => import('./features/auth/pages/TermsAndConditionsPage/TermsAndConditionsPage'));
const PrivacyPolicyPage = lazy(() => import('./features/auth/pages/PrivacyPolicyPage/PrivacyPolicyPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/pages/ForgotPasswordPage/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./features/auth/pages/ResetPasswordPage/ResetPasswordPage'));
const PreSignupPhoneOtpPage = lazy(() => import('./features/auth/pages/PreSignupPhoneOtpPage/PreSignupPhoneOtpPage'));
const PreSignupEmailOtpPage = lazy(() => import('./features/auth/pages/PreSignupEmailOtpPage/PreSignupEmailOtpPage'));
const ActivationPage = lazy(() => import('./features/auth/pages/ActivationPage/ActivationPage'));

// Dashboard Pages
const PatientDashboard = lazy(() => import('./features/service-receiver/PatientDashboard/pages/PatientDashboard/PatientDashboard'));
const ProfileSetting = lazy(() => import('./features/service-receiver/ProfileSetting/pages/ProfileSetting/ProfileSetting'));
const ChooseConsultationType = lazy(() => import('./features/service-receiver/pages/BookAppointment/ChooseConsultationType'));
const BookAppointment = lazy(() => import('./features/service-receiver/pages/BookAppointment/BookAppointment'));
const FindDoctors = lazy(() => import('./features/service-receiver/pages/FindDoctors/FindDoctors'));
const DoctorProfile = lazy(() => import('./features/service-receiver/pages/DoctorProfile/DoctorProfile'));

// BookByType flow (consultation-type-first). Filters / who-it's-for /
// symptoms are now popups on DoctorMatchPage rather than standalone routes.
const ConsultationTypeLanding = lazy(() => import('./features/service-receiver/pages/BookByType/ConsultationTypeLanding'));
const DoctorMatchPage = lazy(() => import('./features/service-receiver/pages/BookByType/DoctorMatchPage'));
const DoctorProfileSetting = lazy(() => import('./features/service-provider/ProfileSetting/pages/ProfileSetting/ProfileSetting'));
const DoctorDashboard = lazy(() => import('./features/service-provider/DoctorDashboard/pages/DoctorDashboard/DoctorDashboard'));
const AppointmentsPage = lazy(() => import('./features/service-provider/Appointments/pages/AppointmentsPage/AppointmentsPage'));
const AppointmentsServiceList = lazy(() => import('./features/service-provider/Appointments/pages/AppointmentsServiceList/AppointmentsServiceList'));
const ManageAppointmentsServices = lazy(() => import('./features/service-provider/Appointments/pages/ManageAppointmentsServices/ManageAppointmentsServices'));
const PharmacyDashboard = lazy(() => import('./features/service-provider/PharmacyDashboard/pages/PharmacyDashboard/PharmacyDashboard'));
const DiagnosisDashboard = lazy(() => import('./features/service-provider/DiagnosisDashboard/pages/DiagnosisDashboard/DiagnosisDashboard'));
const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard/pages/Dashboard/Dashboard'));
const AdminLayout = lazy(() => import('./features/admin/AdminDashboard/components/AdminLayout/AdminLayout'));
const ManageAdmins = lazy(() => import('./features/admin/ManageAdmins/pages/ManageAdmins/ManageAdmins'));
const ViewPatients = lazy(() => import('./features/admin/ViewPatients/pages/ViewPatients/ViewPatients'));
const ViewAppointments = lazy(() => import('./features/admin/ViewAppointments/pages/ViewAppointments/ViewAppointments'));
const ViewDoctors = lazy(() => import('./features/admin/ViewDoctors/pages/ViewDoctors/ViewDoctors'));
const ManageFacilities = lazy(() => import('./features/admin/ManageFacilities/ManageFacilities'));
const ViewVendor = lazy(() => import('./features/admin/ViewVendor/pages/ViewVendor/ViewVendor'));
const CustomerView = lazy(() => import('./features/admin/CustomerView/pages/CustomerView/CustomerView'));
const PatientFamilyDoctorPage = lazy(() => import('./features/family-doctor/pages/PatientFamilyDoctorPage'));
const FamilyPage = lazy(() => import('./features/service-receiver/Family/pages/FamilyPage'));
const FamilyScopeLayout = lazy(() => import('./features/service-receiver/Family/pages/FamilyScopeLayout'));
const SupportStaffPage = lazy(() => import('./features/service-receiver/SupportStaff/pages/SupportStaffPage'));
const PatientStaffLayout = lazy(() => import('./features/service-receiver/SupportStaff/pages/PatientStaffLayout'));
const PatientStaffLanding = lazy(() => import('./features/service-receiver/SupportStaff/pages/PatientStaffLanding'));
const PatientStaffScopeLayout = lazy(() => import('./features/service-receiver/SupportStaff/pages/PatientStaffScopeLayout'));
const PatientStaffMinorScopeLayout = lazy(() => import('./features/service-receiver/SupportStaff/pages/PatientStaffMinorScopeLayout'));
const DoctorPanelPatientsPage = lazy(() => import('./features/family-doctor/pages/DoctorPanelPatientsPage'));
const PageConfigEditor = lazy(() => import('./features/admin/AdminDashboard/pages/PageConfigEditor/PageConfigEditor'));
const LandingConfigEditor = lazy(() => import('./features/admin/AdminDashboard/pages/LandingConfigEditor/LandingConfigEditor'));
const LegacyLandingConfigRedirect = lazy(() => import('./features/admin/AdminDashboard/pages/LandingConfigEditor/LegacyLandingConfigRedirect'));
const ModuleConfigEditor = lazy(() => import('./features/admin/AdminDashboard/pages/ModuleConfigEditor/ModuleConfigEditor'));
const FeatureConfigEditor = lazy(() => import('./features/admin/AdminDashboard/pages/FeatureConfigEditor/FeatureConfigEditor'));
const PlatformTenantsList = lazy(() => import('./features/admin/PlatformOwner/pages/TenantsList/TenantsList'));
const PlatformTenantPermissions = lazy(() => import('./features/admin/PlatformOwner/pages/TenantPermissions/TenantPermissions'));
const PlatformTenantAdmins = lazy(() => import('./features/admin/PlatformOwner/pages/TenantAdmins/TenantAdmins'));
const PageControls = lazy(() => import('./features/admin/PageControls/pages/PageControls/PageControls'));
const Operations = lazy(() => import('./features/admin/Operations/pages/Operations/Operations'));
const PatientMemberList = lazy(() => import('./features/admin/Operations/pages/PatientMemberList/PatientMemberList'));
const PatientOpsDetail = lazy(() => import('./features/admin/Operations/pages/PatientOpsDetail/PatientOpsDetail'));
const RolesPermissions = lazy(() => import('./features/admin/Operations/permissions/pages/RolesPermissions/RolesPermissions'));
const DoctorProfileConfigLanding = lazy(() => import('./features/admin/DoctorProfileConfig/pages/DoctorProfileConfigLanding/DoctorProfileConfigLanding'));
const DoctorProfileConfigEditor = lazy(() => import('./features/admin/DoctorProfileConfig/pages/DoctorProfileConfigEditor/DoctorProfileConfigEditor'));
const DoctorSignupConfigEditor = lazy(() => import('./features/admin/DoctorSignupConfig/pages/DoctorSignupConfigEditor/DoctorSignupConfigEditor'));
const AdminProducts = lazy(() => import('./features/admin/AdminProducts/pages/AdminProducts/AdminProducts'));
const HoldingChats = lazy(() => import('./features/admin/HoldingChats/pages/HoldingChats/HoldingChats'));
const AvailabilityApprovals = lazy(() => import('./features/admin/AvailabilityApprovals/pages/AvailabilityApprovals/AvailabilityApprovals'));
const ServiceGroupApprovals = lazy(() => import('./features/admin/ServiceGroupApprovals/pages/ServiceGroupApprovals/ServiceGroupApprovals'));
const MarketplaceProductApprovals = lazy(() => import('./features/admin/MarketplaceProductApprovals/pages/MarketplaceProductApprovals/MarketplaceProductApprovals'));
const GroupOfferingsBuilder = lazy(() => import('./features/admin/GroupOfferings/pages/GroupOfferingsBuilder/GroupOfferingsBuilder'));
const ProviderVisibility = lazy(() => import('./features/admin/TenantSettings/pages/ProviderVisibility/ProviderVisibility'));
const PricingConfig = lazy(() => import('./features/admin/PricingConfig/pages/PricingConfig/PricingConfig'));
const FeatureProductLinking = lazy(() => import('./features/admin/FeatureProductLinking/pages/FeatureProductLinking/FeatureProductLinking'));
const AppointmentsLedger = lazy(() => import('./features/admin/AppointmentsLedger/pages/AppointmentsLedger'));
const PendingApprovals = lazy(() => import('./features/admin/PendingApprovals/pages/PendingApprovals/PendingApprovals'));
const AdminProfileConfigLanding = lazy(() => import('./features/admin/AdminProfileConfig/pages/AdminProfileConfigLanding/AdminProfileConfigLanding'));
const AdminProfileConfigEditor = lazy(() => import('./features/admin/AdminProfileConfig/pages/AdminProfileConfigEditor/AdminProfileConfigEditor'));
const PatientProfileConfigLanding = lazy(() => import('./features/admin/PatientProfileConfig/pages/PatientProfileConfigLanding/PatientProfileConfigLanding'));
const PatientProfileConfigEditor = lazy(() => import('./features/admin/PatientProfileConfig/pages/PatientProfileConfigEditor/PatientProfileConfigEditor'));
const AdminProfileSetting = lazy(() => import('./features/admin/AdminProfileSetting/pages/AdminProfileSetting/AdminProfileSetting'));
const PatientAppointmentConfigEditor = lazy(() => import('./features/admin/PatientAppointmentConfig/pages/PatientAppointmentConfigEditor'));

// RBAC Pages (Restored)
const Roles = lazy(() => import('./features/admin/ManageRoles/pages/ManageRoles/ManageRoles'));
const SubAdmins = lazy(() => import('./features/admin/ManageSubAdmins/pages/SubAdminList/SubAdminList'));
const SubAdminDetail = lazy(() => import('./features/admin/ManageSubAdmins/pages/SubAdminDetail/SubAdminDetail'));
const Approvals = lazy(() => import('./features/admin/Approvals/pages/ApprovalQueue/ApprovalQueue'));
const ApprovalDetail = lazy(() => import('./features/admin/Approvals/pages/ApprovalDetail/ApprovalDetail'));
const ApprovalsHub = lazy(() => import('./features/admin/Approvals/pages/ApprovalsHub/ApprovalsHub'));
const FieldApprovalQueue = lazy(() => import('./features/admin/Approvals/pages/FieldApprovalQueue/FieldApprovalQueue'));
const ApprovalMatrix = lazy(() => import('./features/admin/Approvals/pages/ApprovalMatrix/ApprovalMatrix'));
const ServiceInterestsPage = lazy(() => import('./features/admin/ServiceInterests/pages/ServiceInterestsPage'));
const AuditLogs = lazy(() => import('./features/admin/AuditLogs/pages/AuditLogViewer/AuditLogViewer'));
const MyAccessPage = lazy(() => import('./features/admin/MyAccess/pages/MyAccessPage/MyAccessPage'));

// Marketplace Pages
const BrowseMarketplace = lazy(() => import('./features/service-receiver/Marketplace/pages/BrowseMarketplace/BrowseMarketplace'));
const HealthPlans = lazy(() => import('./features/service-receiver/HealthPlans/pages/HealthPlans/HealthPlans'));
const PatientMyMembership = lazy(() => import('./features/service-receiver/Membership/pages/PatientMyMembership'));
const PatientSpending = lazy(() => import('./features/service-receiver/pages/PatientSpending/PatientSpending'));

// Patient Pages
const MyAppointments = lazy(() => import('./features/service-receiver/pages/MyAppointments/MyAppointments'));
const PatientPrescriptions = lazy(() => import('./features/service-receiver/pages/PatientPrescriptions/PatientPrescriptions'));
const PatientDocuments = lazy(() => import('./features/service-receiver/pages/PatientDocuments/PatientDocuments'));
const PatientRecords = lazy(() => import('./features/service-receiver/pages/PatientRecords/PatientRecords'));
const HealthRecords = lazy(() => import('./features/service-receiver/pages/HealthRecords/HealthRecords'));
// New-look patient screens — the mobile MVP's Home / Book / Bookings design,
// reading the same patient endpoints as the pages above.
const NewLookHome = lazy(() => import('./features/service-receiver/newlook/pages/Home/NewLookHome'));
const NewLookBook = lazy(() => import('./features/service-receiver/newlook/pages/Book/BookAppointments'));
const NewLookBookings = lazy(() => import('./features/service-receiver/newlook/pages/Bookings/Bookings'));
const NewLookSecondOpinion = lazy(() => import('./features/service-receiver/newlook/pages/SecondOpinion/SecondOpinion'));
const NewLookFindCare = lazy(() => import('./features/service-receiver/newlook/pages/FindCare/FindCare'));
const NewLookProfile = lazy(() => import('./features/service-receiver/newlook/pages/Profile/Profile'));
const NewLookWallet = lazy(() => import('./features/service-receiver/newlook/pages/Wallet/Wallet'));
const NewLookNotifications = lazy(() => import('./features/service-receiver/newlook/pages/Notifications/Notifications'));
const NewLookRecoveryPlans = lazy(() => import('./features/service-receiver/newlook/pages/RecoveryPlans/RecoveryPlans'));
const NewLookDiscover = lazy(() => import('./features/service-receiver/newlook/pages/Discover/Discover'));
const NewLookAgent = lazy(() => import('./features/service-receiver/newlook/pages/Agent/Agent'));
const NewLookLogin = lazy(() => import('./features/service-receiver/newlook/pages/Login/NLLogin'));
const NewLookCategory = lazy(() => import('./features/service-receiver/newlook/pages/Category/Category'));
const NewLookCategories = lazy(() => import('./features/service-receiver/newlook/pages/Categories/Categories'));
const NewLookConsultFlow = lazy(() => import('./features/service-receiver/newlook/pages/BookFlow/ConsultationFlow'));
const NewLookPlanFlow = lazy(() => import('./features/service-receiver/newlook/pages/BookFlow/PlanFlow'));
const NewLookRecords = lazy(() => import('./features/service-receiver/newlook/pages/Records/Records'));
const NewLookMoney = lazy(() => import('./features/service-receiver/newlook/pages/Money/Money'));
const NewLookAccount = lazy(() => import('./features/service-receiver/newlook/pages/Account/Account'));
const ComingSoonPlaceholder = lazy(() => import('./common/components/ComingSoonPlaceholder/ComingSoonPlaceholder'));
const MyServiceChannels = lazy(() => import('./features/communication/pages/MyServiceChannels'));
const MyPlanTeams = lazy(() => import('./features/service-provider/PlanTeams/pages/MyPlanTeams/MyPlanTeams'));

// Consultation Meeting (Video / Audio / Chat — routed by consultation type)
const ConsultationRouter = lazy(() => import('./features/video-meeting/pages/ConsultationRouter/ConsultationRouter'));
// Service-channel call — full-page voice/video for a purchased service
const ServiceMeetingPage = lazy(() => import('./features/communication/pages/ServiceMeetingPage'));

// Route Guards
import GuestRoute from './features/auth/components/GuestRoute/GuestRoute';
import ProtectedRoute from './features/auth/components/ProtectedRoute/ProtectedRoute';

// Common Components
import AuthLayout from './common/components/AuthLayout/AuthLayout';

// Role Layout Wrappers
const DoctorLayout = lazy(() => import('./features/service-provider/layouts/DoctorLayout'));
const MyPatientsPage = lazy(() => import('./features/service-provider/MyPatients/MyPatientsPage'));
const PatientContextPage = lazy(() => import('./features/service-provider/Appointments/pages/PatientContextPage/PatientContextPage'));
const MyPrescriptionsPage = lazy(() => import('./features/service-provider/Prescriptions/pages/MyPrescriptionsPage'));
const MyRecords = lazy(() => import('./features/service-provider/Prescriptions/pages/MyRecords'));
const MyDocumentsPage = lazy(() => import('./features/service-provider/Documents/pages/MyDocumentsPage'));
const DocumentFormPage = lazy(() => import('./features/service-provider/Documents/pages/DocumentFormPage'));
const DocumentViewPage = lazy(() => import('./features/service-provider/Documents/pages/DocumentViewPage'));
const DocumentPreviewPage = lazy(() => import('./features/service-provider/Documents/pages/DocumentPreviewPage'));
const PrescriptionFormPage = lazy(() => import('./features/service-provider/Prescriptions/pages/PrescriptionFormPage'));
const PrescriptionViewPage = lazy(() => import('./features/service-provider/Prescriptions/pages/PrescriptionViewPage'));
const PrescriptionPreviewPage = lazy(() => import('./features/service-provider/Prescriptions/pages/PrescriptionPreviewPage'));
const MyBillsPage = lazy(() => import('./features/service-provider/Billing/pages/MyBillsPage'));
const MyLinkPage = lazy(() => import('./features/service-provider/MyLink/pages/MyLinkPage'));
const LinkOperationDialog = lazy(() => import('./features/service-provider/MyLink/components/LinkOperationDialog'));
const MyNetworkPage = lazy(() => import('./features/service-provider/MyNetwork/pages/MyNetworkPage'));
const MyMembership = lazy(() => import('./features/service-provider/Membership/pages/MyMembership'));
const HealthCredits = lazy(() => import('./features/service-provider/Membership/pages/HealthCredits/HealthCredits'));
const MyAffiliations = lazy(() => import('./features/service-provider/Affiliation/pages/MyAffiliations'));
const ManageDoctors = lazy(() => import('./features/service-provider/Affiliation/pages/ManageDoctors'));
const BranchesPage = lazy(() => import('./features/service-provider/Branches/pages/BranchesPage'));
const BranchScopeLayout = lazy(() => import('./features/service-provider/Branches/pages/BranchScopeLayout'));
const FacilityNetworkRequests = lazy(() => import('./features/service-provider/MyNetwork/pages/FacilityNetworkRequests'));
const MedicineCatalogPage = lazy(() => import('./features/admin/MedicineCatalog/pages/MedicineCatalogPage'));
const PrescriptionTemplateEditor = lazy(() => import('./features/admin/PrescriptionConfig/pages/PrescriptionTemplateEditor'));
const BillingConfigPage = lazy(() => import('./features/admin/BillingConfig/pages/BillingConfigPage'));
const PlansAdmin = lazy(() => import('./features/admin/Pricing/pages/PlansAdmin'));
const AddonsAdmin = lazy(() => import('./features/admin/Pricing/pages/AddonsAdmin'));
const SaasSubscriptionsAdmin = lazy(() => import('./features/admin/Pricing/pages/SaasSubscriptionsAdmin'));
const MembershipPlansAdmin = lazy(() => import('./features/admin/Membership/pages/MembershipPlansAdmin'));
const CreditPoliciesAdmin = lazy(() => import('./features/admin/Membership/pages/CreditPoliciesAdmin'));
const ChargePoliciesAdmin = lazy(() => import('./features/admin/Membership/pages/ChargePoliciesAdmin'));
const FamilyQuotasAdmin = lazy(() => import('./features/admin/Membership/pages/FamilyQuotasAdmin'));
const MembershipSubscriptionsAdmin = lazy(() =>
    import('./features/admin/Membership/pages/MembershipSubscriptionsAdmin'),
);
const TenantProviderPlansAdmin = lazy(() =>
    import('./features/admin/TenantProviderPlans/pages/TenantProviderPlansAdmin'),
);
const TenantProviderSubscriptionsAdmin = lazy(() =>
    import('./features/admin/TenantProviderPlans/pages/TenantProviderSubscriptionsAdmin'),
);
const PlatformTenantEntitlements = lazy(() => import('./features/admin/PlatformOwner/pages/TenantEntitlements/TenantEntitlements'));
const MySubscription = lazy(() => import('./features/admin/Subscription/pages/MySubscription'));
const SubscriptionHub = lazy(() => import('./features/admin/Subscription/pages/SubscriptionHub/SubscriptionHub'));
const TenantSignup = lazy(() => import('./features/auth/pages/TenantSignup/TenantSignup'));
const PayoutManagementPage = lazy(() => import('./features/admin/PayoutManagement/pages/PayoutManagementPage'));
const PrescriptionApprovalsPage = lazy(() => import('./features/admin/PrescriptionConfig/pages/PrescriptionApprovalsPage'));
const DocumentApprovalsPage = lazy(() => import('./features/admin/DocumentConfig/pages/DocumentApprovalsPage'));
const AdminPrescriptionPreview = lazy(() => import('./features/admin/PrescriptionConfig/pages/AdminPrescriptionPreview'));
const PharmacyLayout = lazy(() => import('./features/service-provider/layouts/PharmacyLayout'));
const DiagnosisLayout = lazy(() => import('./features/service-provider/layouts/DiagnosisLayout'));
const PatientLayout = lazy(() => import('./features/service-receiver/layouts/PatientLayout'));

// Loading fallback component
const LoadingFallback = () => (
    <Box
        sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh'
        }}
    >
        <CircularProgress />
    </Box>
);

const AppRoutes = () => {
    return (
        <Suspense fallback={<LoadingFallback/>}>
        <Routes>
            {/* Default redirect */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/module/:moduleSlug" element={<ModulePage />} />
            <Route path="/service/:serviceSlug" element={<ServiceDetailPage />} />
            {/* Public video gallery — linked from the landing page's video
                strip when the tenant has more than 3 visible videos. */}
            <Route path="/gallery/videos" element={<VideoGalleryPage />} />
            {/* SaaS pricing page — sells tenant subdomains (clinics
                running their own larazen install). Separate from the
                marketplace "Join Our Network" flow below. */}
            <Route path="/pricing" element={<SaasPricingPage />} />
            {/* Marketplace funnel — persona picker → vertical pricing
                → signup with ?plan=<code>. Drives ALL marketplace
                signups; direct hits on the underlying signup URLs
                without a plan code redirect back here. */}
            <Route path="/join" element={<JoinNetworkPage />} />
            <Route path="/join/:vertical" element={<RedirectToJoinWithVertical />} />
            {/* Patient (service-receiver) plans. Deliberately outside the
                /join marketplace funnel — patients don't join the network —
                but reuses the same pricing furniture. Resolves its plan type
                via the backend's is_receiver flag. */}
            <Route path="/join_receiver" element={<JoinReceiverPage />} />

            {/* Persona pickers for sign-in / signup. The navbar's Login and
                Register dropdowns are the shortcut past these pages; clicking
                either button itself lands here. Tiles route exactly where the
                matching dropdown entry would. */}
            <Route path="/login" element={<PersonaChooserPage mode="login" />} />
            <Route path="/register" element={<PersonaChooserPage mode="register" />} />

            {/* Public anonymous-booking flow. Visitors enter via the
                landing-page consultation-type cards. ``/book/set-password``
                is only reachable AFTER OTP login but lives in the public
                tree so the unauth'd user can't see other dashboard
                routes mid-flow. The patient ProtectedRoute force-routes
                ``must_set_password=true`` users back here automatically. */}
            <Route path="/book/:consultationType" element={<PublicDoctorListPage />} />
            <Route path="/book/:consultationType/doctor/:doctorId" element={<PublicDoctorSlotsPage />} />
            <Route path="/book/confirmation" element={<BookingConfirmationPage />} />
            <Route path="/book/first-login" element={<FirstLoginOtpPage />} />
            <Route path="/book/set-password" element={<SetPasswordPage />} />

            {/* Public self-serve tenant signup (from landing-page pricing CTA) */}
            <Route path="/signup/tenant" element={<TenantSignup />} />

            {/* Service Receiver (Patient) Auth Routes */}
            {/* New-look patient login — the mobile MVP's welcome + sign-in as one
                page, on the same auth thunk as the classic login. Outside
                AuthLayout: it brings its own chrome. */}
            <Route path="/auth/service-receiver/newlook" element={
                <GuestRoute>
                    <NewLookLogin />
                </GuestRoute>
            } />
            <Route path="/auth/service-receiver" element={<AuthLayout />}>
                <Route path="login" element={
                    <GuestRoute>
                        <ServiceReceiverLoginPage />
                    </GuestRoute>
                } />
                <Route path="signup" element={
                    <GuestRoute>
                        <PatientSignupPage />
                    </GuestRoute>
                } />
            </Route>

            {/* Service Provider Auth Routes */}
            <Route path="/auth/service-provider" element={<AuthLayout />}>
                <Route path="login" element={
                    <GuestRoute>
                        <ServiceProviderLoginPage />
                    </GuestRoute>
                } />
                <Route path="doctor/signup" element={
                    <GuestRoute>
                        <DoctorSignupPage />
                    </GuestRoute>
                } />
                {/* Marketplace facility signups (Round 3+4) — both are
                    multipart with two file uploads + OTP gating, same
                    pattern as doctor signup minus qualifications. */}
                <Route path="clinic/signup" element={
                    <GuestRoute>
                        <ClinicSignupPage />
                    </GuestRoute>
                } />
                <Route path="hospital/signup" element={
                    <GuestRoute>
                        <HospitalSignupPage />
                    </GuestRoute>
                } />
                <Route path="pharmacy/signup" element={
                    <GuestRoute>
                        <PharmacySignupPage />
                    </GuestRoute>
                } />
                <Route path="diagnosis/signup" element={
                    <GuestRoute>
                        <DiagnosisSignupPage />
                    </GuestRoute>
                } />
            </Route>

            {/* Admin Auth Routes */}
            <Route path="/auth/admin" element={<AuthLayout />}>
                <Route path="login" element={
                    <GuestRoute>
                        <AdminLoginPage />
                    </GuestRoute>
                } />
            </Route>

            {/* Static Pages */}
            <Route path="/terms-and-conditions" element={<TermsAndConditionsPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />

            {/* Forgot / Reset Password / Verify Email — shared across all user types */}
            <Route path="/auth" element={<AuthLayout />}>
                <Route path="forgot-password" element={
                    <GuestRoute>
                        <ForgotPasswordPage />
                    </GuestRoute>
                } />
                <Route path="reset-password" element={
                    <GuestRoute>
                        <ResetPasswordPage />
                    </GuestRoute>
                } />
            </Route>
            {/* Pre-signup OTP — phone (Combirds SMS) is mandatory; email
                (SendClean) is conditional, only entered when the user
                supplied an email on the signup form. The phone page
                navigates to the email page when ``formData.email`` is
                set; otherwise it submits signup directly. */}
            {/* Activation page for hospital/clinic-invited doctors. The
                token in the query string is the only auth — no GuestRoute
                gate (an already-logged-in user might be here finishing
                activation for an account they were invited to). */}
            <Route path="/auth/activate" element={<ActivationPage />} />
            <Route path="/auth/signup/verify-phone" element={
                <GuestRoute>
                    <PreSignupPhoneOtpPage />
                </GuestRoute>
            } />
            <Route path="/auth/signup/verify-email" element={
                <GuestRoute>
                    <PreSignupEmailOtpPage />
                </GuestRoute>
            } />

            {/* Patient / Service Receiver — wrapped in PatientLayout with sidebar */}
            <Route path="/dashboard/patient" element={
                <ProtectedRoute allowedRoles={['patient']}>
                    <PatientLayout />
                </ProtectedRoute>
            }>
                <Route index element={<PatientDashboard />} />
                {/* New look — the patient mobile MVP's Home, Book Appointments and
                    Bookings screens, ported to the web and reading the same
                    endpoints as the classic pages below. Mounted alongside them
                    rather than over them, so both are reachable while the design
                    is being evaluated. No FeatureGuard: each section inside
                    checks its own feature (patient.family, clinic.marketplace). */}
                <Route path="newlook" element={<NewLookHome />} />
                <Route path="newlook/book" element={<NewLookBook />} />
                <Route path="newlook/bookings" element={<NewLookBookings />} />
                <Route path="newlook/second-opinion" element={<NewLookSecondOpinion />} />
                <Route path="newlook/find-care" element={<NewLookFindCare />} />
                <Route path="newlook/profile" element={<NewLookProfile />} />
                {/* These four ride ASSUMED endpoints — see
                    features/service-receiver/newlook/api/assumedEndpoints.js. */}
                <Route path="newlook/wallet" element={<NewLookWallet />} />
                <Route path="newlook/notifications" element={<NewLookNotifications />} />
                <Route path="newlook/recovery-plans" element={<NewLookRecoveryPlans />} />
                <Route path="newlook/discover" element={<NewLookDiscover />} />
                <Route path="newlook/agent" element={<NewLookAgent />} />
                <Route path="newlook/categories" element={<NewLookCategories />} />
                {/* The app's two booking flows: a consultation adds slot
                    selection, everything else settles through one checkout. */}
                <Route path="newlook/book/consult/:doctorId" element={<NewLookConsultFlow />} />
                <Route path="newlook/book/checkout" element={<NewLookPlanFlow />} />
                <Route path="newlook/category/:key" element={<NewLookCategory />} />
                <Route path="newlook/records" element={<NewLookRecords />} />
                <Route path="newlook/money" element={<NewLookMoney />} />
                <Route path="newlook/account" element={<NewLookAccount />} />
                <Route path="profile" element={
                    <FeatureGuard featurePath="patient.basic_info" fallbackPath="/dashboard/patient">
                        <ProfileSetting />
                    </FeatureGuard>
                } />
                <Route path="book/:doctorId" element={<ChooseConsultationType />} />
                <Route path="book/:doctorId/:consultationType" element={<BookAppointment />} />
                <Route path="find-doctors" element={<FindDoctors />} />
                <Route path="doctor/:doctorId" element={<DoctorProfile />} />
                <Route path="book-by-type" element={<ConsultationTypeLanding />} />
                {/* Land directly on the matched-doctors hub. Preferences,
                    who-it's-for, and symptoms/records are popups here. */}
                <Route path="book-by-type/:consultationType" element={<DoctorMatchPage />} />
                {/* Marketplace is a paid add-on (clinic.marketplace).
                    Plans without it shouldn't expose the page at all. */}
                <Route path="marketplace" element={
                    <FeatureGuard featurePath="clinic.marketplace" fallbackPath="/dashboard/patient">
                        <BrowseMarketplace />
                    </FeatureGuard>
                } />
                {/* Family / intake-form gating now lives on the match-page
                    popups (patient.family gates the member picker's family
                    list; patient.intake_forms gates the Symptoms button). The
                    backend's appointment-create call still enforces per-mode
                    consultation gating at submission. */}
                <Route path="health-plans" element={<HealthPlans />} />
                <Route path="my-membership" element={<PatientMyMembership />} />
                <Route path="my-appointments" element={<MyAppointments />} />
                <Route path="spending" element={<PatientSpending />} />
                {/* Unified "My Prescriptions / Documents" (one page, two tabs).
                    The standalone routes stay for direct links. */}
                <Route path="my-records" element={<PatientRecords />} />
                {/* Read-only view of the full health profile (vitals … others). */}
                <Route path="health-records" element={<HealthRecords />} />
                {/* Placeholder — reserved nav entry, not yet functional. */}
                <Route path="family-doctor" element={<PatientFamilyDoctorPage />} />
                <Route path="family" element={
                    <FeatureGuard featurePath="patient.family" fallbackPath="/dashboard/patient">
                        <FamilyPage />
                    </FeatureGuard>
                } />
                <Route path="family/:memberId/*" element={
                    <FeatureGuard featurePath="patient.family" fallbackPath="/dashboard/patient">
                        <FamilyScopeLayout />
                    </FeatureGuard>
                } />
                {/* Support staff — the patient provisions caregivers with their own
                    login + a role-bounded scope. Reuses the family role machinery,
                    so it rides the same feature flag. */}
                <Route path="support-staff" element={
                    <FeatureGuard featurePath="patient.family" fallbackPath="/dashboard/patient">
                        <SupportStaffPage />
                    </FeatureGuard>
                } />
                <Route path="my-prescriptions" element={<PatientPrescriptions />} />
                {/* Documents a doctor pushed to the patient (order-based flow —
                    sibling of prescriptions). */}
                <Route path="my-documents" element={<PatientDocuments />} />
                {/* Service Communication — channels from communication-enabled
                    services the patient bought (chat + scheduled calls). */}
                <Route path="my-services" element={<MyServiceChannels />} />
            </Route>

            {/* Support-staff CAREGIVER portal — role patient_staff. The caregiver
                signs in at the patient door and lands here: the patient(s) they
                support, then a role-bounded replica of that patient's dashboard.
                Two flat routes (the scope layout is self-contained — no sidebar
                chrome), each gated to patient_staff. */}
            <Route path="/dashboard/patient-staff" element={
                <ProtectedRoute allowedRoles={['patient_staff']}>
                    <PatientStaffLayout />
                </ProtectedRoute>
            }>
                <Route index element={<PatientStaffLanding />} />
                <Route path="minor/:memberId/*" element={<PatientStaffMinorScopeLayout />} />
                <Route path=":patientId/*" element={<PatientStaffScopeLayout />} />
            </Route>

            {/* Doctor — wrapped in DoctorLayout with sidebar */}
            <Route path="/dashboard/doctor" element={
                <ProtectedRoute allowedRoles={['doctor']}>
                    <DoctorLayout />
                </ProtectedRoute>
            }>
                <Route index element={<DoctorDashboard />} />
                {/* Calendar / appointments management is the doctor.calendar
                    plan feature. ``patient-context`` is a sub-screen of the
                    same workflow (the doctor reviewing the patient's intake
                    notes for an upcoming appointment) — share the gate. */}
                {/* Merged "My Appointments / Service List" — the page gates its
                    Appointments (doctor.calendar) and Service List
                    (clinic.marketplace) sub-views internally via hasFeature,
                    so a doctor entitled to only one still gets in. */}
                <Route path="appointments" element={<AppointmentsServiceList />} />
                {/* Management counterpart — service catalog + availability/schedule
                    (the availability section was relocated here from Profile). */}
                <Route path="manage" element={<ManageAppointmentsServices />} />
                <Route path="plan-teams" element={<MyPlanTeams />} />
                {/* Round 9 — doctor invites patients into their tenant.
                    List view is a placeholder until the per-doctor
                    patient list endpoint ships; the invite flow works
                    today and lands the new patient row on the tenant
                    roster (visible to admins). */}
                <Route path="patients" element={<MyPatientsPage />} />
                {/* Placeholder — reserved nav entry for paneled/empanelled cohorts. */}
                <Route path="panel-patients" element={<DoctorPanelPatientsPage />} />
                <Route path="appointments/:appointmentId/patient-context" element={
                    <FeatureGuard featurePath="doctor.calendar" fallbackPath="/dashboard/doctor">
                        <PatientContextPage />
                    </FeatureGuard>
                } />
                {/* ``billing`` is "view my own bills as a doctor" — core,
                    no plan feature. Leave open. */}
                <Route path="billing" element={<MyBillsPage />} />
                {/* Unified "My Prescriptions / Documents" — one page, two tabs.
                    The old standalone list routes stay (detail pages link to
                    them), but the sidebar points here. */}
                <Route path="records" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <MyRecords />
                    </FeatureGuard>
                } />
                <Route path="prescriptions" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <MyPrescriptionsPage />
                    </FeatureGuard>
                } />
                {/* Provider side of Service Communication — reuses the same
                    channels page as the patient (role-agnostic). No FeatureGuard:
                    a doctor only ever sees channels they're a participant in. */}
                <Route path="service-chats" element={<MyServiceChannels />} />
                <Route path="prescriptions/new" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <PrescriptionFormPage />
                    </FeatureGuard>
                } />
                <Route path="prescriptions/:id" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <PrescriptionViewPage />
                    </FeatureGuard>
                } />
                <Route path="prescriptions/:id/preview" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <PrescriptionPreviewPage />
                    </FeatureGuard>
                } />
                <Route path="prescriptions/:id/edit" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <PrescriptionFormPage />
                    </FeatureGuard>
                } />
                <Route path="documents" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <MyDocumentsPage />
                    </FeatureGuard>
                } />
                <Route path="documents/new" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <DocumentFormPage />
                    </FeatureGuard>
                } />
                <Route path="documents/:id" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <DocumentViewPage />
                    </FeatureGuard>
                } />
                <Route path="documents/:id/preview" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <DocumentPreviewPage />
                    </FeatureGuard>
                } />
                <Route path="documents/:id/edit" element={
                    <FeatureGuard featurePath="doctor.prescriptions" fallbackPath="/dashboard/doctor">
                        <DocumentFormPage />
                    </FeatureGuard>
                } />
                <Route path="profile" element={
                    <FeatureGuard featurePath="doctor.profile" fallbackPath="/dashboard/doctor">
                        <DoctorProfileSetting />
                    </FeatureGuard>
                } />
                {/* Marketplace merged into the Service List side of
                    /appointments. Keep the old path as a redirect for
                    back-compat with bookmarks / deep links. */}
                <Route path="marketplace" element={<Navigate to="/dashboard/doctor/appointments?view=services" replace />} />
                {/* my-link / my-network are doctor-profile-adjacent —
                    no specific plan feature exists for them, leave open. */}
                <Route path="my-link" element={<MyLinkPage />} />
                <Route path="my-network" element={<MyNetworkPage />} />
                {/* Marketplace membership tier the doctor picked at apex
                    signup. Page renders an empty-state card when the
                    doctor has no MembershipSubscription (back-compat). */}
                <Route path="membership" element={<MyMembership />} />
                {/* Health-credit wallet — balance + ledger. Vertical-agnostic
                    page shared with clinic + hospital. */}
                <Route path="health-credits" element={<HealthCredits />} />
                {/* Hospital affiliations — generate an invite code,
                    approve/reject hospital roster requests. */}
                <Route path="affiliations" element={<MyAffiliations />} />
            </Route>

            {/* Clinic — marketplace dashboard (Round 3+4).
                Sidebar shape: Dashboard / My Membership / Settings /
                Manage Doctors (stub) / Bills (stub). The MyMembership
                page is vertical-agnostic — shared with doctor + hospital. */}
            <Route path="/dashboard/clinic" element={
                <ProtectedRoute allowedRoles={['clinic']}>
                    <ClinicLayout />
                </ProtectedRoute>
            }>
                <Route index element={<ClinicDashboard />} />
                <Route path="network-requests" element={<FacilityNetworkRequests />} />
                <Route path="membership" element={<MyMembership />} />
                <Route path="health-credits" element={<HealthCredits />} />
                <Route path="settings" element={<DoctorProfileSetting />} />
                <Route path="doctors" element={<ManageDoctors />} />
                {/* Clinic branches — login-less sub-clinics the main clinic
                    manages and "switches into" (scoped Entity Profile). */}
                <Route path="branches" element={<BranchesPage />} />
                <Route path="branches/:branchId/*" element={<BranchScopeLayout />} />
                {/* Same page the doctor gets. A facility has more reason to
                    need it than a doctor does — a clinic's front desk and
                    billing clerk are exactly the people who have no platform
                    account and so can't be recorded as an affiliation.
                    ``operate/:doctorId`` is the Operation Page: a full-screen
                    dialog rendered over this list, on a real nested route
                    because the doctor pages inside it read their scope from
                    the URL (see LinkOperationDialog). */}
                <Route path="my-link" element={<MyLinkPage />}>
                    <Route path="operate/:doctorId/*" element={<LinkOperationDialog />} />
                </Route>
                <Route path="bills" element={
                    <FacilityComingSoonPage
                        title="Bills & Revenue"
                        subtitle="Track your platform-fee deductions and clinic payouts."
                    />
                } />
            </Route>

            {/* Hospital — marketplace dashboard (Round 3+4). Mirror of
                Clinic with a different accent + role gate. */}
            <Route path="/dashboard/hospital" element={
                <ProtectedRoute allowedRoles={['hospital']}>
                    <HospitalLayout />
                </ProtectedRoute>
            }>
                <Route index element={<HospitalDashboard />} />
                <Route path="network-requests" element={<FacilityNetworkRequests />} />
                <Route path="membership" element={<MyMembership />} />
                <Route path="health-credits" element={<HealthCredits />} />
                <Route path="settings" element={<DoctorProfileSetting />} />
                <Route path="doctors" element={<ManageDoctors />} />
                {/* Mirrors the clinic's — same page, same Operation Page. */}
                <Route path="my-link" element={<MyLinkPage />}>
                    <Route path="operate/:doctorId/*" element={<LinkOperationDialog />} />
                </Route>
                <Route path="bills" element={
                    <FacilityComingSoonPage
                        title="Bills & Revenue"
                        subtitle="Track platform-fee deductions and hospital payouts."
                    />
                } />
            </Route>

            {/* Pharmacy — wrapped in PharmacyLayout with sidebar */}
            <Route path="/dashboard/pharmacy" element={
                <ProtectedRoute allowedRoles={['pharmacy']}>
                    <PharmacyLayout />
                </ProtectedRoute>
            }>
                <Route index element={<PharmacyDashboard />} />
            </Route>

            {/* Diagnosis — wrapped in DiagnosisLayout with sidebar */}
            <Route path="/dashboard/diagnosis" element={
                <ProtectedRoute allowedRoles={['diagnosis']}>
                    <DiagnosisLayout />
                </ProtectedRoute>
            }>
                <Route index element={<DiagnosisDashboard />} />
            </Route>

            {/* Provider staff — a doctor's assistant, a clinic's front desk.
                They sign in through their practice's portal and land here;
                the sidebar is built from the grants their roles carry. */}
            <Route path="/dashboard/staff" element={
                <ProtectedRoute allowedRoles={['provider_staff']}>
                    <StaffLayout />
                </ProtectedRoute>
            }>
                <Route index element={<StaffDashboard />} />
                {/* The practice's own screens, not staff copies of them. The
                    backend resolves the practice from the principal now, so
                    ManageDoctors asking for "my roster" gets the roster of the
                    clinic this person works for. See staffModules.js. */}
                <Route path="doctors" element={
                    <StaffModuleGuard entryKey="doctors"><ManageDoctors /></StaffModuleGuard>
                } />
                <Route path="network-requests" element={
                    <StaffModuleGuard entryKey="network-requests">
                        <FacilityNetworkRequests />
                    </StaffModuleGuard>
                } />
                <Route path="team" element={
                    <StaffModuleGuard entryKey={['team', 'doctor-link']}>
                        <StaffTeamPage />
                    </StaffModuleGuard>
                } />
                <Route path="roles" element={
                    <StaffModuleGuard entryKey="roles"><StaffRolesPage /></StaffModuleGuard>
                } />
                <Route path="practice" element={
                    <StaffModuleGuard entryKey="practice"><StaffPracticePage /></StaffModuleGuard>
                } />
                {/* One path, two entry keys: a facility reaches Billing through
                    billing.*, a doctor through practice.membership. The guard
                    takes whichever of the two this person actually holds. */}
                <Route path="billing" element={
                    <StaffModuleGuard entryKey={['billing', 'doctor-billing']}>
                        <StaffBillingPage />
                    </StaffModuleGuard>
                } />

                {/* Doctor vertical. Same components the doctor uses — the
                    endpoints resolve an assistant to the doctor who employs
                    them, gated by the prefix table in
                    app/api/service_provider/doctor/staff_access.py. */}
                <Route path="doctor-profile" element={
                    <StaffModuleGuard entryKey="doctor-profile">
                        <StaffDoctorProfilePage />
                    </StaffModuleGuard>
                } />
                <Route path="appointments" element={
                    <StaffModuleGuard entryKey="doctor-appointments">
                        <AppointmentsServiceList />
                    </StaffModuleGuard>
                } />
                <Route path="manage" element={
                    <StaffModuleGuard entryKey="doctor-manage">
                        <ManageAppointmentsServices />
                    </StaffModuleGuard>
                } />
                <Route path="records" element={
                    <StaffModuleGuard entryKey="doctor-records"><MyRecords /></StaffModuleGuard>
                } />
                {/* Staff speak through the doctor's participant row, but every
                    message they send is stamped and rendered "Support staff ·
                    <name>" — see _on_behalf() in the backend service. */}
                <Route path="service-chats" element={
                    <StaffModuleGuard entryKey="doctor-chats">
                        <MyServiceChannels />
                    </StaffModuleGuard>
                } />
                <Route path="patients" element={
                    <StaffModuleGuard entryKey="doctor-patients"><MyPatientsPage /></StaffModuleGuard>
                } />
                <Route path="network" element={
                    <StaffModuleGuard entryKey="doctor-network"><MyNetworkPage /></StaffModuleGuard>
                } />
                <Route path="affiliations" element={
                    <StaffModuleGuard entryKey="doctor-affiliations">
                        <MyAffiliations />
                    </StaffModuleGuard>
                } />
                <Route path="plan-teams" element={
                    <StaffModuleGuard entryKey="doctor-teams"><MyPlanTeams /></StaffModuleGuard>
                } />
            </Route>

            {/* Admin Dashboard Routes — wrapped in AdminLayout with sidebar */}
            <Route path="/dashboard/admin" element={
                <ProtectedRoute allowedRoles={['super_admin', 'sub_admin', 'platform_owner']}>
                    <AdminLayout />
                </ProtectedRoute>
            }>
                <Route index element={<AdminDashboard />} />
                <Route path="customers" element={<CustomerView />} />
                <Route path="patients" element={<ViewPatients />} />
                <Route path="appointments" element={<ViewAppointments />} />
                <Route path="vendors" element={<ViewVendor />} />
                <Route path="doctors" element={<ViewDoctors />} />
                <Route path="hospitals" element={<ManageFacilities vertical="hospital" />} />
                <Route path="clinics" element={<ManageFacilities vertical="clinic" />} />
                <Route path="manage-admins" element={
                    <FeatureGuard featurePath="admin.manage_users"><ManageAdmins /></FeatureGuard>
                } />
                <Route path="page-controls" element={
                    <FeatureGuard featurePath="admin.page_configuration"><PageControls /></FeatureGuard>
                } />
                {/* Operations — super-admin IT-support (act on behalf). No plan
                    feature gate; page-level isSuperAdmin check + backend RBAC
                    are the boundary. */}
                <Route path="operations" element={<Operations />} />
                {/* Roles & Permissions matrix. Ranks above the
                    :memberType/:opType pair below because its middle segment
                    is static, and it takes no member id — a grant belongs to a
                    role, not to one person. */}
                <Route path="operations/roles-permissions/:entity" element={<RolesPermissions />} />
                <Route path="operations/:memberType/:opType" element={<PatientMemberList />} />
                {/* Splat: the member-detail page owns a nested route subtree —
                    the patient's own booking screens, mounted under
                    /bookings/*. See PatientBookingBox. */}
                <Route path="operations/:memberType/:opType/:memberId/*" element={<PatientOpsDetail />} />
                <Route path="pending-approvals" element={<PendingApprovals />} />
                <Route path="page-config" element={
                    <FeatureGuard featurePath="admin.page_configuration"><PageConfigEditor /></FeatureGuard>
                } />
                {/* Tenant super-admin's clinic landing page (renders at
                    <slug>.larazen.in). Conceptually distinct from the
                    platform marketing landing — same backend table, but
                    each tenant_id has its own row. */}
                <Route path="tenant-landing" element={
                    <FeatureGuard featurePath="admin.landing_builder"><LandingConfigEditor mode="tenant" /></FeatureGuard>
                } />
                <Route path="tenant-landing/modules/:moduleId" element={
                    <FeatureGuard featurePath="admin.landing_builder"><ModuleConfigEditor /></FeatureGuard>
                } />
                <Route path="tenant-landing/modules/:moduleId/features/:slug" element={
                    <FeatureGuard featurePath="admin.landing_builder"><FeatureConfigEditor /></FeatureGuard>
                } />
                {/* Legacy path — old bookmarks still resolve but are now
                    routed by role: platform_owners go to the platform
                    editor (writes ``platform_landing_configs``, which the
                    apex marketing site actually reads); everyone else goes
                    to the proper tenant editor. The old behaviour mounted
                    the tenant editor for every visitor, so platform_owners
                    saved edits into the wrong table and the apex never
                    reflected them — see LegacyLandingConfigRedirect.jsx. */}
                <Route path="landing-config" element={<LegacyLandingConfigRedirect />} />
                <Route path="landing-config/modules/:moduleId" element={<LegacyLandingConfigRedirect subpath="modules" />} />
                <Route path="landing-config/modules/:moduleId/features/:slug" element={<LegacyLandingConfigRedirect subpath="features" />} />
                {/* Back-compat redirect — old sidebar links still pointing at /landing-page-config land on the new editor. */}
                <Route path="landing-page-config" element={<Navigate to="/dashboard/admin/landing-config" replace />} />
                {/* Per-user-type page-config sub-routes. The Page Controls
                    hub at /page-controls is a navigation page that funnels
                    each user type into one of these editors — they all
                    edit slices of the SAME admin.page_configuration
                    feature, so they share the gate. Without this, clicking
                    through Page Controls into a sub-config landed on an
                    unguarded route that mounted, fired API calls, and
                    spun forever when the backend 403'd. */}
                <Route path="doctor-profile-config" element={
                    <FeatureGuard featurePath="admin.page_configuration"><DoctorProfileConfigLanding /></FeatureGuard>
                } />
                <Route path="doctor-profile-config/editor" element={
                    <FeatureGuard featurePath="admin.page_configuration"><DoctorProfileConfigEditor /></FeatureGuard>
                } />
                <Route path="doctor-signup-config/editor" element={
                    <FeatureGuard featurePath="admin.page_configuration"><DoctorSignupConfigEditor /></FeatureGuard>
                } />
                <Route path="admin-profile-config" element={
                    <FeatureGuard featurePath="admin.page_configuration"><AdminProfileConfigLanding /></FeatureGuard>
                } />
                <Route path="admin-profile-config/editor" element={
                    <FeatureGuard featurePath="admin.page_configuration"><AdminProfileConfigEditor /></FeatureGuard>
                } />
                <Route path="patient-profile-config" element={
                    <FeatureGuard featurePath="admin.page_configuration"><PatientProfileConfigLanding /></FeatureGuard>
                } />
                <Route path="patient-profile-config/editor" element={
                    <FeatureGuard featurePath="admin.page_configuration"><PatientProfileConfigEditor /></FeatureGuard>
                } />
                <Route path="patient-appointment-config/:pageType" element={
                    <FeatureGuard featurePath="admin.page_configuration"><PatientAppointmentConfigEditor /></FeatureGuard>
                } />
                <Route path="profile" element={<AdminProfileSetting />} />

                {/* RBAC Routes — same admin.manage_users plan feature
                    that gates ManageAdmins. Without this, a tenant on a
                    plan that excludes manage_users could still navigate
                    to /roles and /sub-admins from a deep-linked URL and
                    see the page mount before any backend 403 hit. */}
                <Route path="roles" element={
                    <FeatureGuard featurePath="admin.manage_users"><Roles /></FeatureGuard>
                } />
                <Route path="sub-admins" element={
                    <FeatureGuard featurePath="admin.manage_users"><SubAdmins /></FeatureGuard>
                } />
                <Route path="sub-admins/:adminId" element={
                    <FeatureGuard featurePath="admin.manage_users"><SubAdminDetail /></FeatureGuard>
                } />
                <Route path="approvals" element={
                    <FeatureGuard featurePath="admin.field_approval"><ApprovalsHub /></FeatureGuard>
                } />
                <Route path="approvals/module/:moduleKey" element={
                    <FeatureGuard featurePath="admin.field_approval"><FieldApprovalQueue /></FeatureGuard>
                } />
                <Route path="approvals/matrix" element={
                    <FeatureGuard featurePath="admin.field_approval"><ApprovalMatrix /></FeatureGuard>
                } />
                <Route path="service-interests" element={<ServiceInterestsPage />} />
                <Route path="approvals/queue" element={
                    <FeatureGuard featurePath="admin.field_approval"><Approvals /></FeatureGuard>
                } />
                <Route path="approvals/request/:requestId" element={
                    <FeatureGuard featurePath="admin.field_approval"><ApprovalDetail /></FeatureGuard>
                } />
                <Route path="audit-logs" element={
                    <FeatureGuard featurePath="admin.audit_logs"><AuditLogs /></FeatureGuard>
                } />
                <Route path="my-access" element={<MyAccessPage />} />
                <Route path="products" element={<AdminProducts />} />
                <Route path="availability-approvals" element={<AvailabilityApprovals />} />
                <Route path="service-group-approvals" element={<ServiceGroupApprovals />} />
                <Route path="service-product-approvals" element={<MarketplaceProductApprovals />} />
                <Route path="group-offerings" element={<GroupOfferingsBuilder />} />
                <Route path="provider-visibility" element={<ProviderVisibility />} />
                <Route path="pricing-config" element={<PricingConfig />} />
                <Route path="feature-product-linking" element={<FeatureProductLinking />} />
                <Route path="appointments-ledger" element={<AppointmentsLedger />} />
                <Route path="medicine-catalog" element={<MedicineCatalogPage />} />
                <Route path="prescription-template" element={
                    <FeatureGuard featurePath="doctor.prescriptions_pdf"><PrescriptionTemplateEditor /></FeatureGuard>
                } />
                <Route path="prescription-approvals" element={
                    <FeatureGuard featurePath="doctor.prescriptions_pdf"><PrescriptionApprovalsPage /></FeatureGuard>
                } />
                <Route path="prescription-approvals/:id/review" element={
                    <FeatureGuard featurePath="doctor.prescriptions_pdf"><AdminPrescriptionPreview /></FeatureGuard>
                } />
                {/* Same feature gate as the prescription queue — the backend
                    list route guards on doctor.prescriptions_pdf too. */}
                <Route path="document-approvals" element={
                    <FeatureGuard featurePath="doctor.prescriptions_pdf"><DocumentApprovalsPage /></FeatureGuard>
                } />
                <Route path="billing-config" element={
                    <FeatureGuard featurePath="admin.billing_config"><BillingConfigPage /></FeatureGuard>
                } />
                <Route path="payout-management" element={<PayoutManagementPage />} />
                <Route path="holding-chats" element={<HoldingChats />} />
                {/* Subscription hub — Page-Controls-style organizer that
                    funnels to the SaaS / Marketplace / In-Tenant Provider
                    subscription pages. The tenant's own subscription now
                    lives at the /my sub-route; the hub cards link to it and
                    to the platform catalog + provider-plan pages. */}
                <Route path="subscription" element={<SubscriptionHub />} />
                <Route path="subscription/my" element={<MySubscription />} />
                {/* In-tenant provider-plan catalog. Each vertical (doctor /
                    clinic / hospital) is independently gated on
                    ``tenant.can_create_<vertical>_plans``; the page itself
                    is reachable so the tenant admin can see the upsell
                    explanation for verticals they don't currently have the
                    add-on for. Mount without a wrapping FeatureGuard so
                    *all three* tabs surface the same UI (locked or open). */}
                <Route path="provider-plans" element={<TenantProviderPlansAdmin />} />
                {/* Round 10 — tenant SUPER_ADMIN manages each provider's
                    in-tenant subscription (change plan, cancel). */}
                <Route path="provider-subscriptions" element={<TenantProviderSubscriptionsAdmin />} />
                {/* Marketplace MEMBERSHIP plans ("who pays us") — now
                    tenant-scoped. Same page for a tenant SUPER_ADMIN (their
                    tenant) and the PLATFORM_OWNER (the apex/default tenant,
                    who is allowed into this AdminLayout too). Reachable
                    unwrapped; the Subscription hub gates the ENTRY card on
                    the per-vertical membership feature. */}
                <Route path="membership-plans" element={<MembershipPlansAdmin />} />
                {/* Health credits — each plan's credit grant + per-offering
                    redemption caps, on their own page so they can be retuned
                    live (no plan re-version / renewal). */}
                <Route path="membership-credits" element={<CreditPoliciesAdmin />} />
                {/* Platform charges (c1/c2/c3 + per-charge tax) off the plan,
                    retunable live for the next payout. */}
                <Route path="membership-charges" element={<ChargePoliciesAdmin />} />
                {/* Per-plan Patient Family quotas (minors / links / roles),
                    retunable live for the next create. Receiver plans only. */}
                <Route path="membership-family-quotas" element={<FamilyQuotasAdmin />} />
                {/* Marketplace subscriber roster — change which membership
                    tier an already-subscribed provider / receiver is on,
                    grouped by vertical plan type. Same tenant scope and
                    role gate as the catalog page above. */}
                <Route path="membership-subscriptions" element={<MembershipSubscriptionsAdmin />} />
            </Route>

            {/* Platform Owner Dashboard — cross-tenant administration */}
            <Route path="/dashboard/platform" element={
                <ProtectedRoute allowedRoles={['platform_owner']}>
                    <AdminLayout />
                </ProtectedRoute>
            }>
                <Route index element={<Navigate to="tenants" replace />} />
                <Route path="tenants" element={<PlatformTenantsList />} />
                <Route path="tenants/:tenantId/admins" element={<PlatformTenantAdmins />} />
                <Route path="tenants/:tenantId/permissions" element={<PlatformTenantPermissions />} />
                {/* New consolidated per-tenant entitlements page (Subscription /
                    Add-ons / Permissions tabs). The /permissions route above is
                    kept for back-compat with bookmarks. */}
                <Route path="tenants/:tenantId/entitlements" element={<PlatformTenantEntitlements />} />
                <Route path="plans" element={<PlansAdmin />} />
                <Route path="addons" element={<AddonsAdmin />} />
                {/* Cross-tenant SaaS roster — "who is on plan type X?", the
                    inverse of the per-tenant Entitlements page. Change-plan
                    here reuses the same assign endpoint that page calls. */}
                <Route path="subscriptions" element={<SaasSubscriptionsAdmin />} />
                {/* Unified onto the tenant page — membership plans are now
                    tenant-scoped and the platform owner authors the apex's on
                    /dashboard/admin/membership-plans. Old bookmark redirects. */}
                <Route path="membership-plans" element={<Navigate to="/dashboard/admin/membership-plans" replace />} />
                {/* Single platform-landing surface. Two scopes (apex marketing
                    vs new-tenant default template) are toggled inside the
                    editor — one sidebar entry, one route, scope picker at top.
                    The per-module / per-feature sub-routes mount the SAME
                    editors as the tenant tree; the hooks detect the URL
                    prefix and switch to the platform endpoints — that's how
                    feature edits on a platform module reach
                    ``platform_landing_features`` instead of the tenant table. */}
                <Route path="landing-config" element={<LandingConfigEditor mode="platform" />} />
                <Route path="landing-config/modules/:moduleId" element={<ModuleConfigEditor />} />
                <Route path="landing-config/modules/:moduleId/features/:slug" element={<FeatureConfigEditor />} />
                <Route path="our-landing" element={<Navigate to="/dashboard/platform/landing-config" replace />} />
                <Route path="tenants-landing" element={<Navigate to="/dashboard/platform/landing-config?scope=default_template" replace />} />
            </Route>

            {/* Consultation Meeting — appointment-based, routes to video/audio/chat based on type */}
            <Route path="/meeting/:appointmentId" element={
                <ProtectedRoute allowedRoles={['doctor', 'patient']}>
                    <ConsultationRouter />
                </ProtectedRoute>
            } />

            {/* Service-channel call — full-page voice/video for a purchased
                service, or a vendor holding channel (admin ↔ held vendor). The
                admin schedules + joins holding-channel calls, so admin roles
                must be allowed here too or their "Join" redirects away. */}
            <Route path="/service-call/:channelId/:callId" element={
                <ProtectedRoute allowedRoles={['doctor', 'patient', 'super_admin', 'sub_admin', 'platform_owner']}>
                    <ServiceMeetingPage />
                </ProtectedRoute>
            } />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
    );
};

export default AppRoutes;
