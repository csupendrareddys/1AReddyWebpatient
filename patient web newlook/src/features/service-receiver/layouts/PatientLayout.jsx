/**
 * PatientLayout — Patient / Service Receiver role layout configuration
 * Wraps DashboardLayout with Patient-specific sidebar config
 */
import { Box, CircularProgress } from '@mui/material';
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import useNewLookBookings from '../newlook/hooks/useNewLookBookings';
import useSettledOrTimeout from '../../../common/hooks/useSettledOrTimeout';
import { useGetHoldingAccountStateQuery } from '../../admin/api/serviceCommunicationEndpoints';
import VendorHoldingPage from '../../service-provider/pages/VendorHoldingPage/VendorHoldingPage';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import SickIcon from '@mui/icons-material/Sick';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import PsychologyIcon from '@mui/icons-material/Psychology';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import PersonIcon from '@mui/icons-material/Person';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import SettingsIcon from '@mui/icons-material/Settings';
import FavoriteIcon from '@mui/icons-material/Favorite';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventNoteIcon from '@mui/icons-material/EventNote';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventIcon from '@mui/icons-material/Event';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CancelIcon from '@mui/icons-material/Cancel';
import GridViewIcon from '@mui/icons-material/GridView';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import BusinessIcon from '@mui/icons-material/Business';
import PaymentsIcon from '@mui/icons-material/Payments';
import DescriptionIcon from '@mui/icons-material/Description';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';

const buildPatientConfig = (counts = {}) => ({
    portalName: 'Healthcare',
    portalIcon: FavoriteIcon,
    accentColor: '#E8833A',
    accentDark: '#D4702E',
    // After logout, the patient lands here. ``/login`` was never a
    // valid React Router path (it 404s); the real patient login lives
    // at the service-receiver portal.
    loginPath: '/auth/service-receiver/login',
    roleLabel: 'PATIENT',
    navItems: [
        // ── New look ──
        // The patient mobile MVP's screens, ported to the web. Grouped under
        // their own caption because "Home" appears in both groups: these are the
        // same journeys as the classic entries below, drawn the new way, and the
        // captions are what keep the two tellable apart in the rail.
        { type: 'header', label: 'NEW LOOK' },
        { label: 'Home', icon: HomeIcon, path: '/dashboard/patient/newlook', exact: true },
        // ``exact`` matters here: "…/newlook/book" is a prefix of
        // "…/newlook/bookings", so a prefix match would light both rows up at
        // once whenever the Bookings page is open.
        { label: 'Book Appointments', icon: EventAvailableIcon, path: '/dashboard/patient/newlook/book', exact: true, groupKey: 'book' },
        // The page's nine sub-heads, mirrored into the rail. Each deep-links via
        // ?tab=; Category is the default, so its row carries no tab param and
        // the bare "Book Appointments" entry above lands on it too.
        { label: 'Category', icon: GridViewIcon, path: '/dashboard/patient/newlook/book', exact: true, indent: true, parentKey: 'book' },
        { label: 'Recommended for you', icon: AutoAwesomeIcon, path: '/dashboard/patient/newlook/book?tab=reco_you', indent: true, parentKey: 'book' },
        { label: 'For your child & family', icon: EmojiEmotionsIcon, path: '/dashboard/patient/newlook/book?tab=reco_family', indent: true, parentKey: 'book' },
        { label: 'Fits for you', icon: CheckCircleIcon, path: '/dashboard/patient/newlook/book?tab=fits', indent: true, parentKey: 'book' },
        { label: 'Family Doctor Services', icon: MedicalServicesIcon, path: '/dashboard/patient/newlook/book?tab=fd', indent: true, parentKey: 'book' },
        { label: 'Favourite Doc / Clinic / Hospital', icon: StarIcon, path: '/dashboard/patient/newlook/book?tab=favourite', indent: true, parentKey: 'book' },
        { label: 'Find by Doctor', icon: PersonSearchIcon, path: '/dashboard/patient/newlook/book?tab=find_doctor', indent: true, parentKey: 'book' },
        { label: 'Find by Clinic', icon: BusinessIcon, path: '/dashboard/patient/newlook/book?tab=find_clinic', indent: true, parentKey: 'book' },
        { label: 'Find by Hospital', icon: LocalHospitalIcon, path: '/dashboard/patient/newlook/book?tab=find_hospital', indent: true, parentKey: 'book' },
        // Bookings + its four stages. The bare entry opens the page's default
        // (In progress); each stage deep-links via ?view=, which the sidebar's
        // query-aware isActive already highlights correctly.
        { label: 'Find Care', icon: SearchIcon, path: '/dashboard/patient/newlook/find-care' },
        { label: 'My Appointments', icon: EventNoteIcon, path: '/dashboard/patient/newlook/bookings', groupKey: 'bookings', defaultOpen: true },
        { label: 'Pending', icon: AccessTimeIcon, path: '/dashboard/patient/newlook/bookings?view=pending', indent: true, parentKey: 'bookings' , count: counts.pending },
        { label: 'Upcoming', icon: EventIcon, path: '/dashboard/patient/newlook/bookings?view=upcoming', indent: true, parentKey: 'bookings' , count: counts.upcoming },
        { label: 'In progress', icon: HourglassEmptyIcon, path: '/dashboard/patient/newlook/bookings?view=in_progress', indent: true, parentKey: 'bookings' , count: counts.in_progress },
        { label: 'Free follow-up', icon: AddCircleOutlineIcon, path: '/dashboard/patient/newlook/bookings?view=free_follow_up', indent: true, parentKey: 'bookings' , count: counts.free_follow_up },
        { label: 'Completed', icon: DoneAllIcon, path: '/dashboard/patient/newlook/bookings?view=completed', indent: true, parentKey: 'bookings' , count: counts.completed },
        { label: 'Family Doc Second Opinion', icon: MedicalServicesIcon, path: '/dashboard/patient/newlook/second-opinion', indent: true, parentKey: 'bookings' , count: counts.second_opinion },
        { label: 'Cancelled', icon: CancelIcon, path: '/dashboard/patient/newlook/bookings?view=cancelled', indent: true, parentKey: 'bookings', count: counts.cancelled },
        // Everything bought, grouped by what KIND of product it is rather than
        // by which stage it's at — the other way to read the same rows.
        { label: 'My Bookings (category wise)', icon: GridViewIcon, path: '/dashboard/patient/newlook/categories', exact: true, groupKey: 'catwise' },
        { label: 'My Appointments', icon: EventNoteIcon, path: '/dashboard/patient/newlook/categories?kind=consultation', indent: true, parentKey: 'catwise' },
        { label: 'Health Care Plans', icon: GroupsIcon, path: '/dashboard/patient/newlook/categories?kind=plans', indent: true, parentKey: 'catwise', groupKey: 'hcp' },
        { label: 'My Service Plans', icon: StorefrontIcon, path: '/dashboard/patient/newlook/categories?kind=service', indent: true, parentKey: 'hcp' },
        { label: 'My Group Service Plans (Health)', icon: FavoriteIcon, path: '/dashboard/patient/newlook/categories?kind=group', indent: true, parentKey: 'hcp' },
        { label: 'Records', icon: MonitorHeartIcon, path: '/dashboard/patient/newlook/records' },
        { label: 'Money', icon: PaymentsIcon, path: '/dashboard/patient/newlook/money' },
        { label: 'Account', icon: PersonIcon, path: '/dashboard/patient/newlook/account' },
        { label: 'Profile', icon: AccountCircleIcon, path: '/dashboard/patient/newlook/profile' },
        { type: 'divider' },
        { type: 'header', label: 'CURRENT' },
        { label: 'Home', icon: HomeIcon, path: '/dashboard/patient', exact: true },
        { label: 'Book Consultation', icon: EventAvailableIcon, path: '/dashboard/patient/book-by-type' },
        { label: 'Find a Doctor', icon: MedicalServicesIcon, path: '/dashboard/patient/find-doctors' },
        { label: 'Services', icon: StorefrontIcon, path: '/dashboard/patient/marketplace' },
        { label: 'Health Plans', icon: GroupsIcon, path: '/dashboard/patient/health-plans' },
        { label: 'My Membership', icon: WorkspacePremiumIcon, path: '/dashboard/patient/my-membership' },
        { type: 'divider' },
        { label: 'My Appointments / Services', icon: EventNoteIcon, path: '/dashboard/patient/my-appointments' },
        { label: 'My Spending', icon: PaymentsIcon, path: '/dashboard/patient/spending' },
        // Prescriptions + Documents unified into one page with a top toggle.
        { label: 'Prescriptions / Documents', icon: DescriptionIcon, path: '/dashboard/patient/my-records' },
        { label: 'Health Records', icon: MonitorHeartIcon, path: '/dashboard/patient/health-records' },
        { label: 'Family Doctor', icon: MedicalServicesIcon, path: '/dashboard/patient/family-doctor' },
        { label: 'Family', icon: FamilyRestroomIcon, path: '/dashboard/patient/family' },
        { label: 'Support Staff', icon: BadgeOutlinedIcon, path: '/dashboard/patient/support-staff' },
        { label: 'My Services', icon: ForumOutlinedIcon, path: '/dashboard/patient/my-services' },
        { type: 'divider' },
        { label: 'Book by Symptoms', icon: SickIcon, path: '/dashboard/patient?view=symptoms' },
        { label: 'Instant Consultation', icon: FlashOnIcon, path: '/dashboard/patient?view=instant' },
        { label: 'Clinical Visit', icon: LocalHospitalIcon, path: '/dashboard/patient?view=clinic' },
        { label: 'Counselling', icon: PsychologyIcon, path: '/dashboard/patient?view=counselling' },
        { label: 'Vaccination', icon: VaccinesIcon, path: '/dashboard/patient?view=vaccination' },
        { type: 'divider' },
        { label: 'Profile Settings', icon: SettingsIcon, path: '/dashboard/patient/profile' },
    ],
});

const PatientLayout = () => {
    // A held patient (inactive / disciplinary hold) is routed to the holding
    // page (admin chat) instead of their dashboard.
    //
    // This "is the account held?" check must never brick the dashboard. Under
    // React-18 StrictMode the RTK-Query subscription can race on remount and
    // pin `isLoading` true forever even though the request returned 200, which
    // used to freeze the whole app on a spinner. Cap the wait: show the spinner
    // only while the check is genuinely in flight, but fall through to the
    // dashboard if it hasn't settled in time rather than hang. A confirmed hold
    // still diverts.
    // Stage counts for the sidebar. The same source the pages read, so a
    // number in the rail can never disagree with the list it opens.
    const { counts } = useNewLookBookings();
    const { data: state, isLoading } = useGetHoldingAccountStateQuery();
    const gateReady = useSettledOrTimeout(!isLoading);
    if (!gateReady) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }
    if (state?.held) return <VendorHoldingPage stateOverride={state} />;
    return <DashboardLayout config={buildPatientConfig(counts)} />;
};

export default PatientLayout;
