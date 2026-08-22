/**
 * PatientCreditChip — a compact health-credit balance chip for the dashboard
 * top bar. Health credits are a wallet-everywhere mechanism, so this renders for
 * ANY member vertical that has a balance (a patient, or a provider such as a
 * doctor spending credits toward their renewal). It self-hides for roles that
 * can't hold a wallet (admin / platform) and when the balance is 0.
 *
 * Tapping through goes to the role's natural credits surface — the patient's
 * spending page, or a provider's membership page.
 */
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Chip, Tooltip } from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';

import { useGetMyCreditsQuery } from '../../../service-provider/Membership/api/myMembershipEndpoints';

// Role → where the chip taps through. Only member verticals hold a wallet;
// listing a role here both enables the query and gives it a destination.
const CREDIT_ROUTE = {
    patient: '/dashboard/patient/spending',
    doctor: '/dashboard/doctor/membership',
    clinic: '/dashboard/clinic/membership',
    hospital: '/dashboard/hospital/membership',
    corporate: '/dashboard/corporate/membership',
};

export default function PatientCreditChip() {
    const navigate = useNavigate();
    const { user } = useSelector((s) => s.auth);
    const role = user?.role;
    const isMember = !!CREDIT_ROUTE[role];
    const { data } = useGetMyCreditsQuery(undefined, { skip: !isMember });
    const available = data?.available || 0;

    if (!isMember || available <= 0) return null;

    return (
        <Tooltip title="Health credits — spendable on eligible bookings & renewals">
            <Chip
                icon={<RedeemIcon />}
                color="success"
                size="small"
                clickable
                onClick={() => navigate(CREDIT_ROUTE[role])}
                label={`₹${Number(available).toLocaleString('en-IN')} credits`}
                sx={{ fontWeight: 700, ml: 1 }}
            />
        </Tooltip>
    );
}
