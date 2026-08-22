/**
 * MyAppointments — Patient's "My Appointments / Services" hub.
 *
 * A top-level toggle splits consultations from the Service List — the
 * marketplace services the patient has purchased.
 *
 * The Appointments side is organised into four status tabs
 * (Pending / Upcoming / In Progress / Completed). Each appointment renders
 * as a card with date/time/type on the left and Join + Attach-Document
 * actions on the right (see AppointmentCard).
 */
import { useEffect, useRef, useState } from 'react';
import {
    Box, Typography, Tabs, Tab, Paper, CircularProgress,
    ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import StorefrontIcon from '@mui/icons-material/Storefront';
import {
    useGetUpcomingOrdersQuery,
    useGetPreviousOrdersQuery,
    useAddOrderDocumentMutation,
} from '../../api/scopedBookingApi';
import FollowUpBanner from '../../components/FollowUpBanner/FollowUpBanner';
import DocumentUploadDialog from '../../components/DocumentUploadDialog/DocumentUploadDialog';
import useScopeGrantedModules from '../../ProfileSetting/hooks/useScopeGrantedModules';
import MyPurchases from '../../Marketplace/pages/MyPurchases/MyPurchases';
import AppointmentCard from './AppointmentCard';

// Tab index → which statuses land in that bucket, and the data source.
const TABS = [
    { key: 'pending', label: 'Pending', statuses: ['pending', 'pending_payment'], source: 'upcoming' },
    { key: 'upcoming', label: 'Upcoming', statuses: ['confirmed'], source: 'upcoming' },
    { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'], source: 'upcoming' },
    { key: 'completed', label: 'Completed', statuses: ['completed'], source: 'past' },
];

const MyAppointments = () => {
    // 'appointments' | 'services'
    const [view, setView] = useState('appointments');
    const [tab, setTab] = useState(0);

    // Document-attach dialog
    const [docDialogOpen, setDocDialogOpen] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [addOrderDocument, { isLoading: uploading, error: uploadError }] =
        useAddOrderDocumentMutation();

    const showAppointments = view === 'appointments';

    const { data: upcomingData, isLoading: upcomingLoading } = useGetUpcomingOrdersQuery(
        undefined, { skip: !showAppointments }
    );
    const { data: pastData, isLoading: pastLoading } = useGetPreviousOrdersQuery(
        undefined, { skip: !showAppointments }
    );

    const upcoming = upcomingData?.orders || [];
    const past = pastData?.orders || [];

    const bucketFor = (t) => {
        const src = t.source === 'upcoming' ? upcoming : past;
        return src.filter((a) => t.statuses.includes(a.status));
    };
    // Caregiver grant scope (null = full access for the patient / admin / guardian).
    // The upcoming/pending/in-progress tabs read the upcoming list (``appt_upcoming``);
    // Completed is a slice of the history list (``appt_history``); the Service List
    // view needs ``appt_service_list``. Hidden, not just empty, when the grant is absent.
    const grants = useScopeGrantedModules();
    const SRC_MODULE = { upcoming: 'appt_upcoming', past: 'appt_history' };
    const visibleTabs = TABS.filter((t) => !grants || grants.has(SRC_MODULE[t.source]));
    const canServices = !grants || grants.has('appt_service_list');

    // Keep the Appointments/Service-List toggle on something the caregiver may see.
    useEffect(() => {
        if (view === 'services' && !canServices) setView('appointments');
        else if (view === 'appointments' && !visibleTabs.length && canServices) setView('services');
    }, [view, canServices, visibleTabs.length]);

    const counts = visibleTabs.map(bucketFor);
    const safeTab = Math.min(tab, Math.max(0, visibleTabs.length - 1));

    // On first load, land on the first status tab that actually has items — a
    // patient (or a caregiver acting for them) whose only appointments are
    // completed should see them, not an empty "Pending" tab. Runs once, and
    // never fights a later manual tab click.
    const didAutoTab = useRef(false);
    useEffect(() => {
        if (didAutoTab.current || upcomingLoading || pastLoading) return;
        didAutoTab.current = true;
        if ((counts[safeTab]?.length || 0) === 0) {
            const firstNonEmpty = counts.findIndex((c) => c.length > 0);
            if (firstNonEmpty > 0) setTab(firstNonEmpty);
        }
    }, [upcomingLoading, pastLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const activeTab = visibleTabs[safeTab];
    const list = counts[safeTab] || [];
    const isLoading = activeTab && activeTab.source === 'upcoming' ? upcomingLoading : pastLoading;

    const handleAttachClick = (orderId) => {
        setSelectedOrderId(orderId);
        setDocDialogOpen(true);
    };

    const handleDocumentSubmit = async (documentData) => {
        try {
            await addOrderDocument({ orderId: selectedOrderId, ...documentData }).unwrap();
            setDocDialogOpen(false);
        } catch {
            // Error surfaced by the dialog via uploadError.
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <EventIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">My Appointments / Services</Typography>
            </Box>

            <ToggleButtonGroup
                value={view}
                exclusive
                onChange={(_, next) => { if (next) { setView(next); setTab(0); } }}
                color="primary"
                size="small"
                sx={{ mb: 3 }}
            >
                <ToggleButton value="appointments">
                    <CalendarMonthIcon fontSize="small" sx={{ mr: 1 }} /> Appointments
                </ToggleButton>
                {canServices && (
                    <ToggleButton value="services">
                        <StorefrontIcon fontSize="small" sx={{ mr: 1 }} /> Service List
                    </ToggleButton>
                )}
            </ToggleButtonGroup>

            {!showAppointments && <MyPurchases embedded />}

            {showAppointments && (visibleTabs.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        You don&apos;t have access to this patient&apos;s appointments.
                    </Typography>
                </Paper>
            ) : (
                <>
                    {/* Follow-up invites from doctors */}
                    <FollowUpBanner />

                    <Paper sx={{ mb: 3 }}>
                        <Tabs
                            value={safeTab}
                            onChange={(_, v) => setTab(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                        >
                            {visibleTabs.map((t, i) => (
                                <Tab key={t.key} label={`${t.label} (${counts[i].length})`} />
                            ))}
                        </Tabs>
                    </Paper>

                    {isLoading ? (
                        <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                    ) : list.length === 0 ? (
                        <Paper sx={{ p: 6, textAlign: 'center' }}>
                            <Typography color="text.secondary">
                                No {activeTab?.label.toLowerCase()} appointments.
                            </Typography>
                        </Paper>
                    ) : (
                        list.map((appt) => (
                            <AppointmentCard
                                key={appt.id}
                                appt={appt}
                                onAttachDocument={handleAttachClick}
                            />
                        ))
                    )}
                </>
            ))}

            <DocumentUploadDialog
                open={docDialogOpen}
                onClose={() => setDocDialogOpen(false)}
                onSubmit={handleDocumentSubmit}
                loading={uploading}
                error={uploadError ? (uploadError.data?.message || 'Failed to attach document.') : null}
            />
        </Box>
    );
};

export default MyAppointments;
