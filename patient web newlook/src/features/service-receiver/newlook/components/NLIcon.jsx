/**
 * NLIcon — renders an MUI icon from the Ionicons name the mobile design uses.
 *
 * The ported screens carry the mobile MVP's icon names in their config objects
 * (``icon: 'calendar-outline'``), so this is the one place that translates.
 * Deliberately a static map with deep imports rather than the app's async
 * ``MuiIcon`` helper: these glyphs are on the first paint of every shelf and
 * tile, and resolving them through a dynamic ``import()`` makes the whole page
 * flash empty circles before it settles.
 *
 * Every name below was checked against @mui/icons-material's export list — an
 * import of an icon that doesn't exist fails the build, not the render.
 */
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AllInclusiveOutlinedIcon from '@mui/icons-material/AllInclusiveOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import CallOutlinedIcon from '@mui/icons-material/CallOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DoneAllOutlinedIcon from '@mui/icons-material/DoneAllOutlined';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined';
import FestivalOutlinedIcon from '@mui/icons-material/FestivalOutlined';
import FolderCopyOutlinedIcon from '@mui/icons-material/FolderCopyOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HeadsetMicOutlinedIcon from '@mui/icons-material/HeadsetMicOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import LocalHospitalOutlinedIcon from '@mui/icons-material/LocalHospitalOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import LockIcon from '@mui/icons-material/Lock';
import MedicalServicesOutlinedIcon from '@mui/icons-material/MedicalServicesOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import PauseIcon from '@mui/icons-material/Pause';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import ReorderOutlinedIcon from '@mui/icons-material/ReorderOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import StarIcon from '@mui/icons-material/Star';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import ThermostatOutlinedIcon from '@mui/icons-material/ThermostatOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';

const MAP = {
    'accessibility-outline': MonitorHeartOutlinedIcon,
    'add-circle-outline': AddCircleOutlineIcon,
    'albums-outline': ReorderOutlinedIcon,
    'alert-circle-outline': ErrorOutlineIcon,
    'analytics-outline': TrendingUpOutlinedIcon,
    'arrow-back': ArrowBackIcon,
    'arrow-forward': ArrowForwardIcon,
    attach: AttachFileOutlinedIcon,
    'attach-outline': AttachFileOutlinedIcon,
    'business-outline': BusinessOutlinedIcon,
    'calendar-outline': CalendarMonthOutlinedIcon,
    'call-outline': CallOutlinedIcon,
    'card-outline': CreditCardOutlinedIcon,
    'caret-down': ExpandMoreIcon,
    'chatbubble-outline': ChatBubbleOutlineIcon,
    'chatbubbles-outline': ForumOutlinedIcon,
    checkmark: CheckIcon,
    'checkmark-circle': CheckCircleIcon,
    'checkmark-done-outline': DoneAllOutlinedIcon,
    'chevron-back': ChevronLeftIcon,
    'chevron-down': ExpandMoreIcon,
    'chevron-forward': ChevronRightIcon,
    'clipboard-outline': AssignmentOutlinedIcon,
    close: CloseIcon,
    'close-circle': CancelOutlinedIcon,
    'close-circle-outline': CancelOutlinedIcon,
    'document-attach-outline': AttachFileOutlinedIcon,
    'document-text-outline': DescriptionOutlinedIcon,
    'documents-outline': FolderCopyOutlinedIcon,
    'eye-outline': VisibilityOutlinedIcon,
    'flash-outline': BoltOutlinedIcon,
    'git-merge-outline': CallMergeOutlinedIcon,
    'grid-outline': GridViewOutlinedIcon,
    'happy-outline': EmojiEmotionsOutlinedIcon,
    'headset-outline': HeadsetMicOutlinedIcon,
    'heart-circle-outline': FavoriteBorderOutlinedIcon,
    'heart-outline': FavoriteBorderOutlinedIcon,
    'home-outline': HomeOutlinedIcon,
    'hourglass-outline': HourglassEmptyOutlinedIcon,
    'infinite-outline': AllInclusiveOutlinedIcon,
    'list-outline': TableRowsOutlinedIcon,
    'lock-closed': LockIcon,
    'medical-outline': MedicalServicesOutlinedIcon,
    medkit: LocalHospitalOutlinedIcon,
    'medkit-outline': LocalHospitalOutlinedIcon,
    'notifications-outline': NotificationsOutlinedIcon,
    'options-outline': TuneOutlinedIcon,
    pause: PauseIcon,
    'people-circle-outline': GroupsOutlinedIcon,
    'people-outline': PeopleOutlineIcon,
    'person-outline': PersonOutlineIcon,
    pricetag: LocalOfferOutlinedIcon,
    'pulse-outline': MonitorHeartOutlinedIcon,
    'receipt-outline': ReceiptLongOutlinedIcon,
    'reorder-four-outline': ReorderOutlinedIcon,
    'ribbon-outline': WorkspacePremiumOutlinedIcon,
    'search-outline': SearchOutlinedIcon,
    star: StarIcon,
    'shield-checkmark-outline': VerifiedUserOutlinedIcon,
    sparkles: AutoAwesomeOutlinedIcon,
    'sparkles-outline': AutoAwesomeOutlinedIcon,
    'storefront-outline': StorefrontOutlinedIcon,
    'swap-horizontal-outline': SwapHorizOutlinedIcon,
    'tent-outline': FestivalOutlinedIcon,
    'thermometer-outline': ThermostatOutlinedIcon,
    'time-outline': AccessTimeOutlinedIcon,
    'trending-up-outline': TrendingUpOutlinedIcon,
    'videocam-outline': VideocamOutlinedIcon,
    'wallet-outline': AccountBalanceWalletOutlinedIcon,
    'warning-outline': WarningAmberOutlinedIcon,
    'wallet-payments': PaymentsOutlinedIcon,
};

/** Whether a name resolves to a real glyph. */
export const hasIcon = (name) => !!MAP[name];

const NLIcon = ({ name, size = 18, color, sx, ...rest }) => {
    // An unmapped name draws a neutral circle instead of throwing — a missing
    // glyph should never be what takes the dashboard down.
    const Component = MAP[name] || CircleOutlinedIcon;
    return (
        <Component
            sx={{ fontSize: size, color, flexShrink: 0, ...sx }}
            {...rest}
        />
    );
};

export default NLIcon;
