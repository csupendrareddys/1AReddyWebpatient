/**
 * ManageAppointmentsServices — "Manage Appointments / Services".
 *
 * The management counterpart to the My Appointments / Service List view.
 * Three top-level sections:
 *   Appointments   → Availability / Schedule (relocated here from the Profile
 *                    page) — when the doctor takes appointments.
 *   Service List   → the doctor's individual service catalog (My Products).
 *   Group Offering → multi-doctor, admin-approved group offerings.
 */
import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box, Container, Typography, ToggleButtonGroup, ToggleButton, Button,
    CircularProgress, Paper,
} from '@mui/material';
import EditCalendarIcon from '@mui/icons-material/EditCalendar';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import SaveIcon from '@mui/icons-material/Save';

import usePermissions from '../../../../../common/hooks/usePermissions';
import AvailabilitySection from '../../../ProfileSetting/sections/AvailabilitySection';
import MyProductsPanel from '../../../Marketplace/components/MyProductsPanel';
import GroupOfferingsPanel from '../../../Marketplace/components/GroupOfferingsPanel';
import AppointmentSettingsPanel from '../../components/AppointmentSettingsPanel';

/** Hosts the relocated Availability section with its own Save button
 *  (mirrors the Profile page's registerSave + footer-save pattern). */
const ManageAvailabilityPanel = () => {
    const [saveInfo, setSaveInfo] = useState({ handler: null, label: 'Save Availability', disabled: false });
    const registerSave = useCallback((handler, label, disabled) => {
        setSaveInfo({ handler, label: label || 'Save', disabled: !!disabled });
    }, []);

    return (
        <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Suspense fallback={<Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>}>
                <AvailabilitySection registerSave={registerSave} />
            </Suspense>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={() => saveInfo.handler && saveInfo.handler()}
                    disabled={saveInfo.disabled}
                    sx={{ px: 4 }}
                >
                    {saveInfo.label}
                </Button>
            </Box>
        </Paper>
    );
};

const VIEWS = ['appointments', 'services', 'groups'];

/** ``embedded`` drops the page heading — the Operations detail screen that
 *  mounts this already names the doctor and the tab above it. */
const ManageAppointmentsServices = ({ embedded = false }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { hasFeature } = usePermissions();

    const canAppointments = hasFeature('doctor.calendar');
    const canServices = hasFeature('clinic.marketplace');

    const viewParam = searchParams.get('view');
    const initial = VIEWS.includes(viewParam)
        ? viewParam
        : (canAppointments ? 'appointments' : 'services');
    const [view, setView] = useState(initial);

    const handleChange = (_, next) => {
        if (!next) return;
        setView(next);
        // 'appointments' is the default → keep the URL clean.
        setSearchParams(next === 'appointments' ? {} : { view: next }, { replace: true });
    };

    const unavailable =
        (view === 'appointments' && !canAppointments) ||
        ((view === 'services' || view === 'groups') && !canServices);

    return (
        <Container maxWidth="lg" sx={{ py: 3 }} disableGutters={embedded}>
            {!embedded && (
                <Typography variant="h4" fontWeight="bold" sx={{ mb: 2 }}>Manage Appointments / Services</Typography>
            )}
            <Box sx={{ mb: 3 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleChange} color="primary" size="small">
                    {canAppointments && (
                        <ToggleButton value="appointments">
                            <EditCalendarIcon fontSize="small" sx={{ mr: 1 }} /> Appointments
                        </ToggleButton>
                    )}
                    {canServices && (
                        <ToggleButton value="services">
                            <StorefrontIcon fontSize="small" sx={{ mr: 1 }} /> Service List
                        </ToggleButton>
                    )}
                    {canServices && (
                        <ToggleButton value="groups">
                            <GroupsIcon fontSize="small" sx={{ mr: 1 }} /> Group Offering
                        </ToggleButton>
                    )}
                </ToggleButtonGroup>
            </Box>

            {view === 'appointments' && canAppointments && (
                <>
                    <AppointmentSettingsPanel />
                    <ManageAvailabilityPanel />
                </>
            )}
            {view === 'services' && canServices && <MyProductsPanel />}
            {view === 'groups' && canServices && <GroupOfferingsPanel />}

            {unavailable && (
                <Typography color="text.secondary" sx={{ mt: 4 }}>
                    This section isn't available on your current plan.
                </Typography>
            )}
        </Container>
    );
};

export default ManageAppointmentsServices;
