/**
 * useChannelRoom — join the Socket.IO room for the currently-open conversation
 * so this client receives its ``message:new`` / ``presence:typing`` events, and
 * leave it on unmount / channel switch.
 *
 * The server authorizes the join against channel membership (participant gate)
 * and derives the tenant from the connection's verified JWT — the client only
 * sends the channel id. Re-joins automatically on (re)connect so a dropped
 * socket doesn't silently stop delivering messages for the open chat.
 */
import { useEffect } from 'react';
import { getSocket } from './socket';

export default function useChannelRoom(channelId) {
    useEffect(() => {
        if (!channelId) return undefined;
        const socket = getSocket();

        const join = () => socket.emit('join', { channel_id: channelId });

        // Join now if already connected, and on every (re)connect + server-ready.
        if (socket.connected) join();
        socket.on('connect', join);
        socket.on('ready', join);

        return () => {
            socket.off('connect', join);
            socket.off('ready', join);
            if (socket.connected) socket.emit('leave', { channel_id: channelId });
        };
    }, [channelId]);
}
