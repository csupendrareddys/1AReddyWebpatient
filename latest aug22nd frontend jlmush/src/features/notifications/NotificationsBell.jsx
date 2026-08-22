/**
 * NotificationsBell — the live bell + dropdown, shared by every role.
 *
 * Replaces the decorative Notifications buttons in DashboardTopBar
 * (patient / doctor / clinic / hospital) and AdminTopBar.
 *
 * State is driven by IMPERATIVE fetches (lazy query + unwrap), refreshed
 * on mount, on every ``notification:new`` socket event, on menu open,
 * after mark-read mutations, and by a 60s socket-down fallback timer.
 * Deliberately NOT rendered from the cache subscription: this codebase's
 * known RTK wedge (see frontend CLAUDE.md) can freeze a selector at a
 * stale value while the network returns fresh bodies — verified live on
 * this very badge — and a notification count that lies is worse than no
 * badge at all. The unwrap path is immune.
 *
 * Clicking an item marks it read and follows its ``data.url`` deep link.
 */
import { useCallback, useEffect, useState } from 'react';
import {
    Badge, Box, Button, CircularProgress, Divider, IconButton,
    ListItemText, Menu, MenuItem, Tooltip, Typography,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useNavigate } from 'react-router-dom';

import { getSocket } from '../../realtime/socket';
import {
    useLazyGetNotificationsQuery,
    useMarkNotificationReadMutation,
    useMarkAllNotificationsReadMutation,
} from './api/notificationEndpoints';

const timeAgo = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString(undefined,
        { day: 'numeric', month: 'short' });
};

export default function NotificationsBell({ className, size = 'small' }) {
    const navigate = useNavigate();
    const [anchor, setAnchor] = useState(null);
    const [feed, setFeed] = useState(null); // {notifications, unread_count}

    const [fetchFeed] = useLazyGetNotificationsQuery();
    const [markRead] = useMarkNotificationReadMutation();
    const [markAllRead] = useMarkAllNotificationsReadMutation();

    const load = useCallback(async () => {
        try {
            // preferCacheValue=false → always hits the network; unwrap
            // resolves independently of the (wedgeable) selector.
            const d = await fetchFeed(undefined, false).unwrap();
            setFeed(d);
        } catch { /* transient — next trigger heals */ }
    }, [fetchFeed]);

    // One fetch on mount; after that the SOCKET is the delivery path and
    // the interval is purely a degraded-mode fallback: it only fires when
    // the socket is actually down AND the tab is visible, so a healthy
    // client costs the backend zero polling. A reconnect refetches once,
    // healing anything missed during the outage.
    useEffect(() => {
        load();
        const socket = getSocket();
        const onReconnect = () => load();
        socket.on('connect', onReconnect);
        const iv = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            if (socket.connected) return;
            load();
        }, 60000);
        return () => {
            clearInterval(iv);
            socket.off('connect', onReconnect);
        };
    }, [load]);

    // Instant badge bump on the live event.
    useEffect(() => {
        const socket = getSocket();
        const onNew = () => load();
        socket.on('notification:new', onNew);
        return () => socket.off('notification:new', onNew);
    }, [load]);

    const items = feed?.notifications || [];
    const unread = feed?.unread_count || 0;
    const loading = feed === null;

    const open = (e) => {
        setAnchor(e.currentTarget);
        load();
    };
    const close = () => setAnchor(null);

    const onItem = async (n) => {
        close();
        if (!n.read_at) {
            try { await markRead(n.id).unwrap(); } catch { /* load() heals */ }
            load();
        }
        const url = n?.data?.url;
        if (url) navigate(url);
    };

    return (
        <>
            <Tooltip title="Notifications">
                <IconButton className={className} size={size} onClick={open}>
                    <Badge badgeContent={unread} color="error" max={99}>
                        <NotificationsNoneIcon fontSize={size} />
                    </Badge>
                </IconButton>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={close}
                slotProps={{ paper: { sx: { width: 360, maxHeight: 480 } } }}>
                <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                        Notifications
                    </Typography>
                    {unread > 0 && (
                        <Button size="small" onClick={async () => {
                            try { await markAllRead().unwrap(); } catch { /* load() heals */ }
                            load();
                        }}>
                            Mark all read
                        </Button>
                    )}
                </Box>
                <Divider />
                {loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}
                {!loading && items.length === 0 && (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                            Nothing yet — you&apos;ll see appointment and
                            account updates here.
                        </Typography>
                    </Box>
                )}
                {items.map((n) => (
                    <MenuItem key={n.id} onClick={() => onItem(n)}
                        sx={{
                            whiteSpace: 'normal', alignItems: 'flex-start',
                            bgcolor: n.read_at ? 'transparent' : 'action.hover',
                        }}>
                        <ListItemText
                            primary={(
                                <Typography variant="body2"
                                    sx={{ fontWeight: n.read_at ? 400 : 600 }}>
                                    {n.title}
                                </Typography>
                            )}
                            secondary={(
                                <>
                                    {n.body && (
                                        <Typography variant="caption"
                                            color="text.secondary"
                                            sx={{ display: 'block' }}>
                                            {n.body}
                                        </Typography>
                                    )}
                                    <Typography variant="caption"
                                        color="text.disabled">
                                        {timeAgo(n.created_at)}
                                    </Typography>
                                </>
                            )}
                        />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}
