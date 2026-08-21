/**
 * AppointmentsServiceList — the tracking view: "My Appointments / Service List".
 *
 * The top-level toggle divides upcoming/active appointments from active
 * service orders (pending / under process / completed) and from plan bookings
 * on the teams this doctor leads. Catalog + availability management lives in
 * the separate "Manage Appointments / Services" page.
 *
 * Admin Operations mounts this whole page (see ``DoctorOpsBox``) rather than
 * just its Appointments third, so an operator tracking a doctor's work sees the
 * same three buckets the doctor does. ``embedded`` drops the outer padding —
 * the Operations screen already names the doctor and the tab above it.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box, Container, Typography, ToggleButtonGroup, ToggleButton, Stack,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';

import usePermissions from '../../../../../common/hooks/usePermissions';
import AppointmentsPage from '../AppointmentsPage/AppointmentsPage';
import MarketplaceOrders from '../../../Marketplace/pages/MarketplaceOrders/MarketplaceOrders';
import GroupOfferingBookingsPanel from '../../components/GroupOfferingBookingsPanel';

/** The ``?view=`` values this page answers to, in toggle order. */
const VIEWS = ['appointments', 'services', 'group_offering'];

const AppointmentsServiceList = ({ embedded = false }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { hasFeature } = usePermissions();

    const canAppointments = hasFeature('doctor.calendar');
    const canServices = hasFeature('clinic.marketplace');

    // Default view: appointments unless only services are entitled, or the URL
    // names one. Read against the full set, not just 'services' — ``handleChange``
    // writes ?view=group_offering too, so recognising only one of the two meant a
    // reload (or a pasted link) silently landed on Appointments instead.
    const viewParam = searchParams.get('view');
    const initial = VIEWS.includes(viewParam)
        ? viewParam
        : (canAppointments ? 'appointments' : 'services');
    const [view, setView] = useState(initial);

    const handleChange = (_, next) => {
        if (!next) return;
        setView(next);
        setSearchParams(
            next === 'appointments' ? {} : { view: next },
            { replace: true },
        );
    };

    return (
        <Container maxWidth="lg" sx={{ py: embedded ? 0 : 3 }} disableGutters={embedded}>
            <Box sx={{ mb: 3 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleChange} color="primary" size="small">
                    {canAppointments && (
                        <ToggleButton value="appointments">
                            <CalendarMonthIcon fontSize="small" sx={{ mr: 1 }} /> Appointments
                        </ToggleButton>
                    )}
                    {canServices && (
                        <ToggleButton value="services">
                            <StorefrontIcon fontSize="small" sx={{ mr: 1 }} /> Service List
                        </ToggleButton>
                    )}
                    <ToggleButton value="group_offering">
                        <GroupsIcon fontSize="small" sx={{ mr: 1 }} /> My Group Offering
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {view === 'appointments' && canAppointments && <AppointmentsPage embedded />}
            {view === 'services' && canServices && (
                <Box>
                    <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                        <StorefrontIcon color="primary" sx={{ fontSize: 28 }} />
                        <Typography variant="h5" fontWeight="bold">Service Orders</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Track your service orders — pending, under process, and completed.
                        Manage your catalog under <strong>Manage Appointments / Services</strong>.
                    </Typography>
                    <MarketplaceOrders />
                </Box>
            )}

            {view === 'group_offering' && <GroupOfferingBookingsPanel />}

            {/* Fallback when the chosen view isn't entitled */}
            {((view === 'appointments' && !canAppointments) || (view === 'services' && !canServices)) && (
                <Typography color="text.secondary" sx={{ mt: 4 }}>
                    This section isn't available on your current plan.
                </Typography>
            )}
        </Container>
    );
};

export default AppointmentsServiceList;
