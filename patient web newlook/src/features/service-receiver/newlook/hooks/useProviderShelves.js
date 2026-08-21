/**
 * useProviderShelves — the two provider-anchored shelves the mobile Home
 * carries, shared by the Home page and the Book Appointments sub-heads so the
 * two can't drift:
 *
 *   • fdShelf   — REAL: the family doctor's marketplace catalogue, led by a
 *                 book-a-consultation tile (card id ``book:<doctorId>``).
 *   • favShelf  — REAL: derived from actual booking history — the provider
 *                 this account books most, never the family doctor twice.
 */
import { useMemo } from 'react';
import { useBrowseMarketplaceQuery } from '../../api/scopedBookingApi';
import { useGetMyFamilyDoctorQuery } from '../../../family-doctor/api/familyDoctorEndpoints';
import useNewLookBookings from './useNewLookBookings';
import usePermissions from '../../../../common/hooks/usePermissions';
import { colors } from '../theme/tokens';
import { inr } from '../utils/format';

/** One catalogue product as a shelf card. */
export const productCard = (p, badge) => ({
    id: String(p.id),
    title: p.product_name || 'Service',
    subtitle: p.doctor_name ? `Dr. ${p.doctor_name}` : 'Provider',
    meta: p.doctor_price != null ? inr(p.doctor_price) : undefined,
    badge: badge ?? (p.offering_type === 'group' ? 'Group service' : 'Service'),
    icon: 'storefront-outline',
    tint: colors.secondary,
});

export default function useProviderShelves() {
    const { hasFeature } = usePermissions();
    const { data: fdLink } = useGetMyFamilyDoctorQuery();
    const { data: products = [] } = useBrowseMarketplaceQuery(undefined, {
        skip: !hasFeature('clinic.marketplace'),
    });
    const { rows } = useNewLookBookings();

    const fdShelf = useMemo(() => {
        if (!fdLink?.doctor_id) return [];
        const theirs = products
            .filter((p) => String(p.doctor_id) === String(fdLink.doctor_id))
            .slice(0, 11)
            .map((p) => productCard(p, 'Your family doctor'));
        return [{
            id: `book:${fdLink.doctor_id}`,
            title: 'Book a consultation',
            subtitle: fdLink.doctor_name ? `Dr. ${fdLink.doctor_name}` : 'Your family doctor',
            meta: 'Pick a slot',
            badge: 'Your family doctor',
            icon: 'videocam-outline',
            tint: colors.primary,
        }, ...theirs];
    }, [fdLink, products]);

    const favourite = useMemo(() => {
        const tally = new Map();
        rows.forEach((r) => {
            if (!r.doctorId || String(r.doctorId) === String(fdLink?.doctor_id || '')) return;
            const cur = tally.get(r.doctorId) || { count: 0, name: r.providerName };
            cur.count += 1;
            cur.name = cur.name || r.providerName;
            tally.set(r.doctorId, cur);
        });
        let top = null;
        tally.forEach((v, id) => {
            if (!top || v.count > top.count) top = { id, ...v };
        });
        return top;
    }, [rows, fdLink]);

    const favShelf = useMemo(() => {
        if (!favourite) return [];
        const theirs = products
            .filter((p) => String(p.doctor_id) === String(favourite.id))
            .slice(0, 11)
            .map((p) => productCard(p, `Booked ${favourite.count}× by you`));
        return [{
            id: `book:${favourite.id}`,
            title: 'Book again',
            subtitle: favourite.name ? `Dr. ${favourite.name}` : 'Your usual provider',
            meta: `You've booked them ${favourite.count} time${favourite.count === 1 ? '' : 's'}`,
            badge: 'Your favourite',
            icon: 'star',
            tint: colors.warning,
        }, ...theirs];
    }, [favourite, products]);

    return { fdLink, products, fdShelf, favourite, favShelf };
}
