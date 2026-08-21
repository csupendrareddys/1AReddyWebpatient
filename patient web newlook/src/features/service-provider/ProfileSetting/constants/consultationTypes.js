/**
 * Consultation type definitions shared across Pricing, Calendar, Working Hours, and Booking.
 *
 * Each time-slot can offer one or more of these types.
 * Booking one type on a time-slot blocks ALL other types for that slot.
 *
 * schedulable: false  — type does not participate in slot generation, working hours,
 *                       or pricing. It appears only in account-level status controls
 *                       (e.g. Marketplace products are toggled active/inactive by admin,
 *                       not booked via calendar slots).
 */

export const CONSULTATION_TYPES = [
    {
        value: 'audio',
        label: 'Voice Consultation',
        shortLabel: 'Voice',
        color: '#4CAF50',
        icon: '📞',
        description: 'Audio-only voice call',
    },
    {
        value: 'video',
        label: 'Video Consultation',
        shortLabel: 'Video',
        color: '#2196F3',
        icon: '📹',
        description: 'Video call with voice, chat, screen sharing & whiteboard',
    },
    {
        value: 'chat',
        label: 'Chat Consultation',
        shortLabel: 'Chat',
        color: '#FF9800',
        icon: '💬',
        description: 'Text-based chat consultation',
    },
    {
        value: 'complete',
        label: 'In-Person Consultation',
        shortLabel: 'In-Person',
        color: '#9C27B0',
        icon: '🏥',
        description: 'Physical clinic / in-person visit',
    },
    {
        value: 'home_visit',
        label: 'Home Visit Consultancy',
        shortLabel: 'Home',
        color: '#009688',
        icon: '🏠',
        description: 'Doctor visits the patient at their home',
    },
    {
        value: 'camp',
        label: 'Camp Consultancy',
        shortLabel: 'Camp',
        color: '#FF5722',
        icon: '⛺',
        description: 'Consultation conducted at an organized health camp',
    },
    {
        value: 'marketplace',
        label: 'Marketplace',
        shortLabel: 'Market',
        color: '#8D6E63',
        icon: '🛒',
        description: 'Doctor products visible to patients when admin activates this status',
        schedulable: false,  // No slots, working hours, or pricing — status-only
    },
];

/**
 * Types that participate in slot generation, working hours, and pricing.
 * Excludes non-schedulable types like Marketplace.
 */
export const SCHEDULABLE_CONSULTATION_TYPES = CONSULTATION_TYPES.filter(
    (t) => t.schedulable !== false,
);

/** Quick lookup map: value → full object */
export const CONSULTATION_TYPE_MAP = Object.fromEntries(
    CONSULTATION_TYPES.map((t) => [t.value, t]),
);

/** Default selection when nothing is specified (backward compat) */
export const DEFAULT_CONSULTATION_TYPE = 'complete';
