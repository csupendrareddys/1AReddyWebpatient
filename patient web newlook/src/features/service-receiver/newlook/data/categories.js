/**
 * The mobile MVP's eight booking categories — the shelf the mobile Home is
 * built around, ported as navigation CONFIG (names, taglines, icons, tints).
 *
 * Deliberately config, not data: the mobile app ships these same eight as
 * static config too. What's IN each category (the priced items) is data and
 * comes from ASSUMED endpoint #11 — never bundled here, so the app can't show
 * a price the backend never quoted.
 *
 * ``realTarget`` is where this category can genuinely be booked TODAY, while
 * the catalogue endpoint doesn't exist — every category keeps a live path.
 */
export const NL_CATEGORIES = [
    {
        key: 'instant',
        name: 'Instant Consultation',
        tagline: 'Talk to a doctor now — no appointment',
        short: 'Available now',
        icon: 'flash-outline',
        tint: '#E8833A',
        realTarget: 'newlook/book',
        realLabel: 'Book a consultation',
    },
    {
        key: 'online',
        name: 'Online Consultation',
        tagline: 'Book a video, voice or chat consult',
        short: 'Video, voice, chat',
        icon: 'videocam-outline',
        tint: '#1976d2',
        realTarget: 'newlook/book',
        realLabel: 'Book a consultation',
    },
    {
        key: 'physical',
        name: 'Physical Consultation',
        tagline: 'See a doctor in person',
        short: 'Clinic or home',
        icon: 'business-outline',
        tint: '#26a69a',
        realTarget: 'newlook/book',
        realLabel: 'Book a visit',
    },
    {
        key: 'hybrid',
        name: 'Hybrid Consultation',
        tagline: 'In-person visit paired with online follow-ups',
        short: 'In-person + online',
        icon: 'git-merge-outline',
        tint: '#5e35b1',
        realTarget: 'marketplace',
        realLabel: 'Browse services',
    },
    {
        key: 'recovery',
        name: 'Recovery Plans',
        tagline: 'Guided plans for a specific illness',
        short: 'Illness programmes',
        icon: 'thermometer-outline',
        tint: '#f44336',
        realTarget: 'newlook/recovery-plans',
        realLabel: 'Browse recovery plans',
    },
    {
        key: 'healthcare',
        name: 'Healthcare Plans',
        tagline: 'Preventive checks and ongoing management',
        short: 'Preventive care',
        icon: 'shield-checkmark-outline',
        tint: '#5e35b1',
        realTarget: 'marketplace',
        realLabel: 'Browse services',
    },
    {
        key: 'advanced',
        name: 'Advance Care Plans',
        tagline: 'Surgical recovery and chronic management',
        short: 'Surgical & chronic',
        icon: 'heart-circle-outline',
        tint: '#00897b',
        realTarget: 'health-plans',
        realLabel: 'Browse health plans',
    },
    {
        key: 'longevity',
        name: 'Longevity Plans',
        tagline: 'Long-term healthy ageing programmes',
        short: 'Healthy ageing',
        icon: 'infinite-outline',
        tint: '#E8833A',
        realTarget: 'health-plans',
        realLabel: 'Browse health plans',
    },
];

export const categoryByKey = (key) => NL_CATEGORIES.find((c) => c.key === key) || null;

/** Product kind → badge label, as the mobile app names them. */
export const KIND_LABEL = {
    appointment: 'Appointment',
    service: 'Service',
    group_service: 'Group Service',
};

/** Badge tone per product kind, so the three types stay visually distinct. */
export const KIND_TONE = {
    appointment: 'primary',
    service: 'secondary',
    group_service: 'warning',
};
