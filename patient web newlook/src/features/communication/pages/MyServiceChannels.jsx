/**
 * MyServiceChannels — a person's service-communication channels.
 *
 * Master/detail: the left rail lists every channel the caller participates in
 * (from a purchased communication-enabled service); the right pane is the
 * chat. Role-agnostic — a patient sees the services they bought, a provider
 * sees the ones they deliver, both through the same ``/channels`` endpoint.
 *
 * Group services add a wrinkle: one purchase yields several channels — a group
 * chat (patient + every doctor) plus a 1:1 leg with each doctor. Those share a
 * ``purchased_service.service_group_id``, so we cluster them under one heading
 * instead of scattering them through a flat list.
 *
 * This is the container; the message thread + composer live in
 * ``ChannelChat`` so a future provider-specific surface (with the scheduled-
 * calls panel, documents tab, forms) can reuse it unchanged.
 *
 * Mounted in several scopes — a patient's own page, a DOCTOR's, an admin acting
 * on a doctor from Operations, and a GUARDIAN acting on a MINOR sub-profile —
 * so the hooks come from ``api/scopedChannelApi``, which folds whichever scope
 * is active (doctor or patient/family) into each request. That's what makes the
 * minor's conversations load here rather than the guardian's. Ops reads only:
 * the child panels drop compose / upload / schedule / join when the scope is an
 * ops one, and the proxy allowlist carries no write for that side.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Avatar, AvatarGroup, Box, Card, Chip, CircularProgress, Divider, List,
    ListItemButton, ListItemText, ListSubheader, Stack, Typography,
    useMediaQuery, useTheme, IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';

import {
    useListMyServiceChannelsQuery,
    useGetServiceChannelQuery,
} from '../api/scopedChannelApi';
import ChannelChat from '../components/ChannelChat';
import ScheduledCallsPanel from '../components/ScheduledCallsPanel';
import ChannelDocumentsPanel from '../components/ChannelDocumentsPanel';

const STATUS_CHIP = {
    active: { label: 'Active', color: 'success' },
    read_only: { label: 'Ended', color: 'default' },
    archived: { label: 'Archived', color: 'default' },
};

function validityLabel(ps) {
    if (!ps?.valid_until) return null;
    const end = new Date(ps.valid_until);
    const days = Math.ceil((end - new Date()) / 86400000);
    if (ps.status !== 'active' || days < 0) return 'Ended';
    if (days === 0) return 'Ends today';
    return `${days} day${days === 1 ? '' : 's'} left`;
}

function initials(name) {
    if (!name) return '?';
    return name.split(' ').filter(Boolean).slice(0, 2)
        .map((s) => s[0].toUpperCase()).join('') || '?';
}

// A channel's one-line title. The group chat is named generically; a 1:1 leg
// is named after the other person (the doctor, from the patient's side).
function channelTitle(c) {
    if (c.kind === 'group') return 'Group chat';
    const other = (c.counterparts || [])[0];
    return other?.display_name || c.purchased_service?.product_name || 'Service';
}

export default function MyServiceChannels() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const { data: channels = [], isLoading } = useListMyServiceChannelsQuery(undefined, {
        pollingInterval: 15000,
    });
    const [selectedId, setSelectedId] = useState(null);

    // "Service Chat" on the patient's service list deep-links here with the
    // channel's own id. Only honour it if that channel is really one of mine —
    // and if it isn't, select NOTHING rather than falling through to the
    // first-channel default, which would silently open an unrelated
    // conversation and read as if it were the service you clicked.
    const [searchParams, setSearchParams] = useSearchParams();
    const channelParam = searchParams.get('channel');
    const [deepLinkMissed, setDeepLinkMissed] = useState(false);
    useEffect(() => {
        if (!channelParam || !channels.length) return;
        const target = channels.find((c) => c.id === channelParam);
        if (target) setSelectedId(target.id);
        else setDeepLinkMissed(true);
        // Drop the param so a later manual pick isn't overridden on re-render.
        const next = new URLSearchParams(searchParams);
        next.delete('channel');
        setSearchParams(next, { replace: true });
    }, [channelParam, channels, searchParams, setSearchParams]);

    // Auto-select the first channel on desktop so the pane is never blank.
    // Held back while a deep-link is pending (so it can't win the race) and
    // after one missed (so the miss stays visible instead of being papered
    // over with the wrong conversation).
    useEffect(() => {
        if (!isMobile && !selectedId && !channelParam && !deepLinkMissed && channels.length) {
            setSelectedId(channels[0].id);
        }
    }, [isMobile, selectedId, channels, channelParam, deepLinkMissed]);

    // The list payload already carries most of what we need, but fetch the
    // single channel for ``my_participant_id`` (which side am I) + participants.
    const { data: activeChannel } = useGetServiceChannelQuery(selectedId, {
        skip: !selectedId,
    });

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    // Partition the flat channel list into group clusters (shared
    // ``service_group_id``) and standalone individual channels, preserving the
    // server's newest-activity ordering.
    const clustersById = new Map();
    const solo = [];
    channels.forEach((c) => {
        const gid = c.purchased_service?.service_group_id;
        if (!gid) { solo.push(c); return; }
        if (!clustersById.has(gid)) {
            clustersById.set(gid, {
                id: gid,
                productName: c.purchased_service?.product_name || 'Group service',
                group: null,
                legs: [],
            });
        }
        const bucket = clustersById.get(gid);
        if (c.kind === 'group') bucket.group = c;
        else bucket.legs.push(c);
    });
    const clusters = Array.from(clustersById.values());

    const renderRow = (c, { title, subtitle }) => {
        const chip = STATUS_CHIP[c.status] || STATUS_CHIP.active;
        const ps = c.purchased_service;
        return (
            <ListItemButton
                key={c.id}
                selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                sx={{ alignItems: 'flex-start' }}
            >
                <ListItemText
                    primary={(
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                                {c.kind === 'group' && (
                                    <GroupsOutlinedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                                )}
                                <Typography variant="subtitle2" fontWeight={700} noWrap>
                                    {title}
                                </Typography>
                            </Stack>
                            <Chip size="small" label={chip.label} color={chip.color} sx={{ height: 20 }} />
                        </Stack>
                    )}
                    secondary={(
                        <Typography variant="caption" color="text.secondary">
                            {subtitle}
                            {validityLabel(ps) ? ` · ${validityLabel(ps)}` : ''}
                        </Typography>
                    )}
                />
            </ListItemButton>
        );
    };

    const listPane = (
        <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 2, pb: 1.5 }}>
                <Typography variant="h6" fontWeight={700}>My Services</Typography>
                <Typography variant="caption" color="text.secondary">
                    Conversations from services you purchased
                </Typography>
            </Box>
            <Divider />
            {channels.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                    <ForumOutlinedIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
                    <Typography variant="body2">
                        No service conversations yet. When you buy a service that
                        includes chat or calls, it will appear here.
                    </Typography>
                </Box>
            ) : (
                <List sx={{ overflowY: 'auto', flex: 1, py: 0 }}>
                    {/* Standalone individual channels. A family-doctor second-
                        opinion channel has no purchase, so it's labelled as such
                        rather than "you bought this". */}
                    {solo.map((c) => renderRow(c, {
                        title: c.is_second_opinion ? (c.title || 'Second opinion') : channelTitle(c),
                        subtitle: c.is_second_opinion
                            ? (c.my_role === 'provider' ? 'Second opinion · empanelled patient' : 'Second opinion · your family doctor')
                            : (c.my_role === 'provider' ? 'You provide this' : 'You bought this'),
                    }))}

                    {/* One cluster per group service: the group chat pinned on
                        top, then a 1:1 leg for each doctor. */}
                    {clusters.map((cl) => (
                        <li key={`cluster-${cl.id}`}>
                            <ul style={{ padding: 0 }}>
                                <ListSubheader
                                    disableSticky
                                    sx={{
                                        bgcolor: 'grey.50', lineHeight: '32px',
                                        display: 'flex', alignItems: 'center', gap: 0.75,
                                    }}
                                >
                                    <GroupsOutlinedIcon sx={{ fontSize: 16 }} />
                                    <Typography variant="caption" fontWeight={700} noWrap sx={{ flex: 1 }}>
                                        {cl.productName}
                                    </Typography>
                                    <Chip size="small" label="Group" color="primary" variant="outlined" sx={{ height: 18 }} />
                                </ListSubheader>
                                {cl.group && renderRow(cl.group, {
                                    title: 'Group chat',
                                    subtitle: `${cl.group.participant_count || (cl.legs.length + 1)} members`,
                                })}
                                {cl.legs.map((leg) => renderRow(leg, {
                                    title: channelTitle(leg),
                                    subtitle: leg.my_role === 'provider' ? 'Your patient' : 'Direct line',
                                }))}
                            </ul>
                        </li>
                    ))}
                </List>
            )}
        </Card>
    );

    const isGroupDetail = activeChannel?.kind === 'group';
    const roster = activeChannel?.participants || [];

    const detailPane = activeChannel ? (
        <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'grey.200' }}>
                {isMobile && (
                    <IconButton size="small" onClick={() => setSelectedId(null)}>
                        <ArrowBackIcon />
                    </IconButton>
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                        {activeChannel.is_second_opinion
                            ? (activeChannel.title || 'Second opinion')
                            : isGroupDetail
                                ? `${activeChannel.purchased_service?.product_name || 'Service'} · Group chat`
                                : activeChannel.purchased_service?.product_name || 'Service'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {activeChannel.is_second_opinion
                            ? (activeChannel.my_role === 'provider'
                                ? 'Second opinion · your empanelled patient · up to 5 messages & 5-min calls'
                                : 'Second opinion · your family doctor · up to 5 messages & 5-min calls')
                            : isGroupDetail
                                ? `Group · ${roster.length} members`
                                : (activeChannel.my_role === 'provider' ? 'Patient conversation' : 'Provider conversation')}
                        {!activeChannel.is_second_opinion && validityLabel(activeChannel.purchased_service)
                            ? ` · ${validityLabel(activeChannel.purchased_service)}` : ''}
                    </Typography>
                </Box>
                {isGroupDetail && roster.length > 0 && (
                    <AvatarGroup
                        max={5}
                        sx={{ '& .MuiAvatar-root': { width: 30, height: 30, fontSize: '0.75rem' } }}
                    >
                        {roster.map((p) => (
                            <Avatar
                                key={p.id}
                                title={`${p.display_name || 'Member'}${p.role === 'provider' ? ' · Doctor' : ''}`}
                                sx={{ bgcolor: p.role === 'provider' ? 'primary.main' : 'secondary.main' }}
                            >
                                {initials(p.display_name)}
                            </Avatar>
                        ))}
                    </AvatarGroup>
                )}
            </Stack>
            <ScheduledCallsPanel channel={activeChannel} />
            <ChannelDocumentsPanel channel={activeChannel} />
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <ChannelChat channel={activeChannel} />
            </Box>
        </Card>
    ) : (
        <Card variant="outlined" sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
            <Typography variant="body2" color="text.secondary" align="center">
                {deepLinkMissed
                    ? 'That service doesn’t have a conversation you can open. Pick one from the list.'
                    : 'Select a conversation to open it.'}
            </Typography>
        </Card>
    );

    // ~72vh keeps the composer on screen without the whole page scrolling.
    const paneHeight = { height: 'calc(100vh - 160px)', minHeight: 420 };

    if (isMobile) {
        return (
            <Box sx={{ p: 2, ...paneHeight }}>
                {selectedId ? detailPane : listPane}
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: 'flex', gap: 2, ...paneHeight }}>
            <Box sx={{ width: 320, flexShrink: 0 }}>{listPane}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>{detailPane}</Box>
        </Box>
    );
}
