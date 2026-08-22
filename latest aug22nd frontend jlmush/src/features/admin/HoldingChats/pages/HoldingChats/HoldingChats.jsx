/**
 * HoldingChats — admin "Onboarding / Holding" chats.
 *
 * Lists vendors currently held (pending verification / inactive / trial
 * expired) and lets the admin chat, exchange documents, and schedule calls
 * with them. Only the admin can schedule calls on a holding channel.
 */
import { useState, useMemo } from 'react';
import {
    Box, Paper, Typography, List, ListItemButton, ListItemText, Chip,
    CircularProgress, Alert, Stack, Divider, Badge, Tabs, Tab,
} from '@mui/material';

import {
    useGetHeldVendorsQuery,
    useOpenHoldingChannelMutation,
    useGetServiceChannelQuery,
    useMarkChannelReadMutation,
} from '../../../api/serviceCommunicationEndpoints';
import ChannelChat from '../../../../communication/components/ChannelChat';
import ChannelDocumentsPanel from '../../../../communication/components/ChannelDocumentsPanel';
import ScheduledCallsPanel from '../../../../communication/components/ScheduledCallsPanel';

const REASON_LABEL = {
    pending_verification: { label: 'Pending verification', color: 'info' },
    inactive: { label: 'Inactive', color: 'warning' },
    trial_expired: { label: 'Trial expired', color: 'warning' },
    plan_expired: { label: 'Membership expired', color: 'warning' },
    disciplinary: { label: 'Disciplinary hold', color: 'error' },
};

// Held members are grouped into a tab per vertical. Order is fixed; a vertical
// with no held members is hidden.
const VERTICAL_ORDER = ['doctor', 'clinic', 'hospital', 'corporate', 'patient'];
const VERTICAL_LABEL = {
    doctor: 'Doctors', clinic: 'Clinics', hospital: 'Hospitals',
    corporate: 'Corporate', patient: 'Patients',
};
const vendorKey = (v) => v.doctor_id || v.user_id;

export default function HoldingChats() {
    // Poll so new messages bump the unread badge + re-sort the list (WhatsApp-style).
    const { data: vendors = [], isLoading, refetch } = useGetHeldVendorsQuery(undefined, {
        pollingInterval: 15000,
    });
    const [openChannel] = useOpenHoldingChannelMutation();
    const [markRead] = useMarkChannelReadMutation();
    const [activeChannelId, setActiveChannelId] = useState(null);
    const [activeVendor, setActiveVendor] = useState(null);
    const [activeVertical, setActiveVertical] = useState(null);

    // Split the flat list into a separate session list per vertical.
    const groups = useMemo(() => {
        const byV = {};
        for (const v of vendors) {
            const key = v.vertical || 'patient';
            (byV[key] = byV[key] || []).push(v);
        }
        return byV;
    }, [vendors]);

    const verticals = useMemo(
        () => VERTICAL_ORDER.filter((k) => groups[k]?.length)
            .concat(Object.keys(groups).filter((k) => !VERTICAL_ORDER.includes(k))),
        [groups],
    );
    const currentVertical = activeVertical && groups[activeVertical]?.length
        ? activeVertical : verticals[0];
    const shownVendors = groups[currentVertical] || [];

    const { data: channel } = useGetServiceChannelQuery(activeChannelId, {
        skip: !activeChannelId,
    });

    const selectVendor = async (v) => {
        setActiveVendor(v);
        let channelId = v.channel_id || null;
        try {
            const res = await openChannel({ doctor_id: v.doctor_id, user_id: v.user_id }).unwrap();
            channelId = res.channel_id;
        } catch { /* fall back to the existing channel id */ }
        setActiveChannelId(channelId);
        // Opening the chat clears the unread badge.
        if (channelId) {
            try { await markRead(channelId).unwrap(); } catch { /* best-effort */ }
            refetch();
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>Onboarding / Holding Chats</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
                Vendors whose accounts are on hold. Chat, share documents, and schedule
                calls with them — you are the only one who can schedule a call here.
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
                <Paper variant="outlined" sx={{ width: { md: 340 }, flexShrink: 0, borderRadius: 2, overflow: 'hidden' }}>
                    {isLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                    ) : vendors.length === 0 ? (
                        <Alert severity="success" sx={{ m: 2 }}>No members are on hold.</Alert>
                    ) : (
                        <>
                            {/* One session list per vertical. */}
                            <Tabs
                                value={currentVertical || false}
                                onChange={(_, v) => setActiveVertical(v)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
                            >
                                {verticals.map((k) => {
                                    const unread = groups[k].reduce((n, x) => n + (x.unread_count || 0), 0);
                                    return (
                                        <Tab
                                            key={k}
                                            value={k}
                                            sx={{ minHeight: 44, textTransform: 'none' }}
                                            label={(
                                                <Stack direction="row" spacing={1} alignItems="center">
                                                    <span>{VERTICAL_LABEL[k] || k}</span>
                                                    <Chip size="small" label={groups[k].length}
                                                        color={unread ? 'error' : 'default'}
                                                        variant={unread ? 'filled' : 'outlined'} />
                                                </Stack>
                                            )}
                                        />
                                    );
                                })}
                            </Tabs>
                            <List dense sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
                                {shownVendors.map((v) => {
                                    const r = REASON_LABEL[v.reason] || { label: v.reason, color: 'default' };
                                    return (
                                        <ListItemButton key={vendorKey(v)}
                                            selected={activeVendor && vendorKey(activeVendor) === vendorKey(v)}
                                            onClick={() => selectVendor(v)}>
                                            <ListItemText
                                                primary={(
                                                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                                                        <Typography
                                                            fontWeight={v.unread_count ? 700 : 400}
                                                            noWrap
                                                        >
                                                            {v.name || v.doctor_name}
                                                        </Typography>
                                                        {v.unread_count > 0 && (
                                                            <Badge badgeContent={v.unread_count} color="error" sx={{ mr: 1.5 }} />
                                                        )}
                                                    </Stack>
                                                )}
                                                secondary={<Chip size="small" label={r.label} color={r.color} sx={{ mt: 0.5 }} />}
                                            />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </>
                    )}
                </Paper>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {!activeChannelId ? (
                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
                            <Typography color="text.secondary">Select a vendor to open their chat.</Typography>
                        </Paper>
                    ) : !channel ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
                    ) : (
                        <Stack spacing={2}>
                            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                                <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                                    <Typography fontWeight={600}>{activeVendor?.name || activeVendor?.doctor_name}</Typography>
                                </Box>
                                <Box sx={{ height: '52vh' }}>
                                    <ChannelChat channel={channel} />
                                </Box>
                            </Paper>
                            <ScheduledCallsPanel channel={channel} />
                            <Divider />
                            <ChannelDocumentsPanel channel={channel} />
                        </Stack>
                    )}
                </Box>
            </Stack>
        </Box>
    );
}
