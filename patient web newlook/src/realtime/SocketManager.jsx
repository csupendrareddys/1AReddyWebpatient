/**
 * SocketManager — connects the Socket.IO client to the app's auth lifecycle and
 * turns server events into RTK Query cache invalidations.
 *
 * Mounted once (in App.jsx) under the Redux Provider. It renders nothing.
 *
 * Design: the communication feature (Service Chats) is deliberately transport-
 * agnostic — it reads over REST and refetches on cache invalidation. So the
 * socket's only job here is to dispatch ``invalidateTags`` for the affected
 * queries; RTK Query then refetches whatever is currently on screen. A modest
 * REST poll remains as a fallback for when the socket is down.
 */
import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { apiSlice } from '../app/api/apiSlice';
import { connectSocket, disconnectSocket, getSocket } from './socket';

export default function SocketManager() {
    const dispatch = useDispatch();
    const isAuthenticated = useSelector((s) => s.auth?.isAuthenticated);

    useEffect(() => {
        if (!isAuthenticated) {
            // Covers logout, forced/expired-session logout, and refresh failure
            // (all flip isAuthenticated false).
            disconnectSocket();
            return undefined;
        }

        const socket = connectSocket();
        if (!socket) return undefined; // no VITE_SOCKET_URL configured

        const invalidate = (tags) => dispatch(apiSlice.util.invalidateTags(tags));

        // A new message → refresh that channel's thread + timeline, and the
        // channel list (ordering/unread).
        const onMessageNew = (msg) => {
            const cid = msg?.channel_id;
            if (!cid) return;
            invalidate([
                { type: 'ChannelMessages', id: cid },
                { type: 'ChannelTimeline', id: cid },
                { type: 'ServiceChannel', id: 'LIST' },
            ]);
        };

        // A channel the user participates in had activity (they may not have it
        // open) → refresh the list badge/ordering.
        const onActivity = (data) => {
            const cid = data?.channel_id;
            invalidate([
                { type: 'ServiceChannel', id: 'LIST' },
                ...(cid ? [{ type: 'ServiceChannel', id: cid }] : []),
            ]);
        };

        // The other side read the channel → refresh receipts + list.
        const onRead = (data) => {
            const cid = data?.channel_id;
            invalidate([
                { type: 'ServiceChannel', id: 'LIST' },
                ...(cid ? [{ type: 'ChannelMessages', id: cid }] : []),
            ]);
        };

        // A call/document/form/status change → refresh the relevant panels.
        const onTimeline = (data) => {
            const cid = data?.channel_id;
            if (!cid) return;
            invalidate([
                { type: 'ChannelTimeline', id: cid },
                { type: 'ChannelCalls', id: cid },
                { type: 'ChannelDocuments', id: cid },
                { type: 'ChannelForms', id: cid },
                { type: 'ServiceChannel', id: 'LIST' },
            ]);
        };

        socket.on('message:new', onMessageNew);
        socket.on('channel:activity', onActivity);
        socket.on('message:read', onRead);
        socket.on('timeline:event', onTimeline);

        return () => {
            socket.off('message:new', onMessageNew);
            socket.off('channel:activity', onActivity);
            socket.off('message:read', onRead);
            socket.off('timeline:event', onTimeline);
        };
    }, [isAuthenticated, dispatch]);

    return null;
}
