/**
 * useMemberDiscount — the flat % the signed-in user's membership tier takes
 * off every consultation and catalog service.
 *
 * The one place the patient-facing surfaces agree on that number: the doctor
 * tiles, the marketplace service cards, the landing service grid and the
 * booking summary all badge or subtract it, and each computing it from its
 * own fetch is how two screens end up quoting different totals for the same
 * slot.
 *
 * Anonymous visitors get 0 without a request — the landing page renders for
 * logged-out users, and firing an authenticated read there would 401 on every
 * paint. The number is advisory anyway: the server re-resolves the discount
 * from the buyer's own subscription when it prices the booking, so a stale or
 * absent value here can only under-promise, never overcharge.
 *
 * Under the Operations act-on-behalf scope this reads the TARGET patient's
 * tier, not the admin's — an admin booking for a patient has to be quoted the
 * patient's discount, and the admin's own tier is meaningless on that screen.
 */
import { useSelector } from 'react-redux';

import { useGetMyMemberBenefitsQuery } from '../api/memberBenefitsEndpoints';
import { usePatientScope } from
    '../../features/service-receiver/ProfileSetting/context/PatientScopeContext';
import { withScope } from '../../features/service-receiver/api/patientScope';

export default function useMemberDiscount() {
    const isAuthenticated = useSelector((state) => state.auth?.isAuthenticated);
    const { patientId } = usePatientScope();

    const { data, isLoading } = useGetMyMemberBenefitsQuery(
        withScope(patientId, undefined),
        { skip: !isAuthenticated },
    );

    const raw = Number(data?.member_discount_pct);
    const pct = Number.isFinite(raw) && raw > 0 ? raw : 0;

    return {
        /** Positive percentage, or 0 when there's no membership benefit. */
        discountPct: pct,
        /** True when a discount actually applies — reads better at call sites. */
        hasDiscount: pct > 0,
        planName: data?.plan_name || null,
        isLoading: isAuthenticated ? isLoading : false,
        /**
         * ``amount`` net of the discount, rounded to 2dp. Null/blank passes
         * through untouched so an unpriced row stays unpriced rather than
         * becoming free. Mirrors ``apply_member_discount`` server-side.
         */
        applyDiscount: (amount) => {
            const value = Number(amount);
            if (amount == null || amount === '' || !Number.isFinite(value)) return amount;
            if (!pct) return value;
            return Math.round(value * (1 - pct / 100) * 100) / 100;
        },
    };
}
