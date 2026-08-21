/**
 * useProviderCan — "may the person looking at this screen do X?", answered the
 * same way whether they own the practice or work for it.
 *
 * The practice's screens are now shared: a clinic admin and their receptionist
 * open the very same ManageDoctors. The admin may do everything on it; the
 * receptionist may do whatever her roles grant, which is usually less. Without
 * this the screen would keep offering her buttons the server rejects, and a
 * button that always fails is worse than no button — it reads as the product
 * being broken rather than as her not having been given that.
 *
 * An owner short-circuits to ``true`` and never fetches: they hold everything
 * by construction, and a provider has no staff profile to ask about.
 *
 * This governs what is OFFERED, never what is allowed. The grant is enforced
 * per-endpoint by ``@provider_access`` server-side; hiding a control is a
 * courtesy on top of that, not a substitute for it.
 */
import { useSelector } from 'react-redux';

import useStaffAccess from './useStaffAccess';

const useProviderCan = () => {
    const role = useSelector((state) => state.auth?.user?.role);
    const isStaff = role === 'provider_staff';

    const { can, isLoading, provider } = useStaffAccess({ skip: !isStaff });

    return {
        isStaff,
        // While ``/me`` is in flight a staff member is treated as holding
        // nothing. Erring the other way would flash a control into view and
        // then withdraw it, which is how someone clicks the thing that is
        // about to disappear.
        can: isStaff ? can : () => true,
        isLoading: isStaff && isLoading,
        provider,
    };
};

export default useProviderCan;
