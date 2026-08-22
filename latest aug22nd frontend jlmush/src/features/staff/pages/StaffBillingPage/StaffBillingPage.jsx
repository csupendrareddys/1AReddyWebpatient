/**
 * StaffBillingPage — Membership and Bills, for whichever of them this staff
 * member was granted.
 *
 * The same two things live at different catalog paths per vertical: a facility
 * has ``billing.membership`` / ``billing.bills.*``, a doctor has
 * ``practice.membership`` / ``practice.billing``. One screen serves both by
 * asking about both paths rather than by branching on the vertical, because
 * only one of the pair can ever be held.
 *
 * Membership is real for both: ``/api/v1/membership/me`` resolves a staff caller
 * to their employer, so this shows the practice's tier rather than the empty
 * record a staff account would otherwise have (which would read as "your
 * practice isn't a member").
 *
 * Bills differ. A doctor has a real bills page; a facility's is a placeholder
 * the practice sees too. Mapping a grant to a placeholder looks odd until you
 * consider the alternative — pretending the module has no screen when the
 * practice can see one.
 */
import { useState } from 'react';
import { Box, Paper, Tab, Tabs } from '@mui/material';

import ComingSoonPage from '../../../service-provider/common/pages/ComingSoonPage';
import MyBillsPage from '../../../service-provider/Billing/pages/MyBillsPage';
import MyMembership from '../../../service-provider/Membership/pages/MyMembership';
import useStaffAccess from '../../hooks/useStaffAccess';

const MEMBERSHIP = ['billing.membership', 'practice.membership'];
const FACILITY_BILLS = ['billing.bills.invoices', 'billing.bills.payments'];
const DOCTOR_BILLS = ['practice.billing'];

export default function StaffBillingPage() {
    const { can, provider } = useStaffAccess();
    const isDoctor = provider?.type === 'doctor';

    const showMembership = MEMBERSHIP.some((leaf) => can(leaf, 'can_view'));
    const billLeaves = isDoctor ? DOCTOR_BILLS : FACILITY_BILLS;
    const showBills = billLeaves.some((leaf) => can(leaf, 'can_view'));
    const [tab, setTab] = useState(0);

    const tabs = [
        ...(showMembership ? [{ key: 'membership', label: 'Membership' }] : []),
        ...(showBills ? [{ key: 'bills', label: 'Bills' }] : []),
    ];
    const active = tabs[Math.min(tab, tabs.length - 1)];

    return (
        <Box>
            {tabs.length > 1 && (
                <Paper sx={{ mb: 2 }}>
                    <Tabs value={Math.min(tab, tabs.length - 1)} onChange={(_, v) => setTab(v)}>
                        {tabs.map((t) => <Tab key={t.key} label={t.label} />)}
                    </Tabs>
                </Paper>
            )}

            {active?.key === 'membership' && <MyMembership />}
            {active?.key === 'bills' && (isDoctor ? <MyBillsPage /> : (
                <ComingSoonPage
                    title="Bills & Revenue"
                    subtitle={`Platform-fee deductions and payouts for ${provider?.name || 'your practice'}. `
                        + 'This screen is not built for anyone yet — the practice sees the same placeholder.'}
                />
            ))}
        </Box>
    );
}
