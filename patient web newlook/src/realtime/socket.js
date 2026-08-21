/**
 * Socket.IO client singleton for the real-time communication channel.
 *
 * One connection per browser tab, shared across the app. Auth is the Bearer
 * access token read FRESH from localStorage on every (re)connect (the same key
 * axios uses) — so after a token rotation a reconnect automatically picks up
 * the new token. We do NOT re-auth an already-open connection: the server
 * validates the session at connect and keeps the socket alive on session TTL,
 * so a mid-connection access-token expiry is harmless.
 *
 * Token auth travels in the handshake ``auth`` payload (not cookies), so
 * ``withCredentials`` is false — this keeps us compatible with a permissive
 * server CORS origin and the cross-site tenant-domain model where third-party
 * cookies are blocked.
 */
import { io } from 'socket.io-client';

// Same key as src/api/axiosConfig.js (ACCESS_TOKEN_KEY). Per-origin localStorage
// means each tenant domain carries its own token — read at connect time.
const ACCESS_TOKEN_KEY = 'auth.access_token';

const SOCKET_URL =
    import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || '';

let socket = null;

function readToken() {
    try {
        return window.localStorage.getItem(ACCESS_TOKEN_KEY) || null;
    } catch {
        return null;
    }
}

/** Lazily create (once) and return the shared socket instance. */
export function getSocket() {
    if (socket) return socket;
    socket = io(SOCKET_URL, {
        autoConnect: false, // we connect explicitly once authenticated
        withCredentials: false, // token in handshake auth, not cookies
        transports: ['websocket', 'polling'], // prefer WS, fall back to polling
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
        // Function form → re-read the freshest token on every (re)connect.
        auth: (cb) => cb({ token: readToken() }),
    });
    return socket;
}

/** Connect if we have somewhere to connect to and aren't already trying. */
export function connectSocket() {
    if (!SOCKET_URL) return null;
    const s = getSocket();
    // ``active`` is true while connected OR attempting/reconnecting — guard
    // against React StrictMode double-invoke opening two sockets.
    if (!s.active) s.connect();
    return s;
}

/** Tear down the connection (on logout / session loss). */
export function disconnectSocket() {
    if (socket && socket.active) socket.disconnect();
}
