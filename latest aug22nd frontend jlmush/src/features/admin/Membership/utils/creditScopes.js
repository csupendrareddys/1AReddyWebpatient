/**
 * The offering scopes a plan's health credits can be redeemed on, with the
 * per-booking caps. Keys match the backend ``offering_scope`` vocabulary read by
 * ``credit_service.quote_redeemable``.
 *
 * ``membership`` is the wallet-everywhere scope: it lets a member (e.g. a doctor)
 * spend credits toward RENEWING their own membership plan, capped like any other.
 */
export const CREDIT_SCOPES = [
    { key: 'video', label: 'Video consultation' },
    { key: 'audio', label: 'Audio consultation' },
    { key: 'chat', label: 'Chat consultation' },
    { key: 'complete', label: 'In-person / clinical' },
    { key: 'home_visit', label: 'Home visit' },
    { key: 'camp', label: 'Camp' },
    { key: 'service', label: 'Services (marketplace)' },
    { key: 'group', label: 'Health plans (group)' },
    { key: 'membership', label: 'Membership renewal' },
];

export default CREDIT_SCOPES;
