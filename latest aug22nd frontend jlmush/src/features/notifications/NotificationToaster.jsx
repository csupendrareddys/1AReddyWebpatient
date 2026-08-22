/**
 * NotificationToaster — live toast for incoming notifications.
 *
 * Subscribes to the shared socket's ``notification:new`` (the server
 * emits it to the user's personal room after committing the row) and
 * shows a corner snackbar wherever the user is — no refresh, no bell
 * click needed. Cache invalidation for the bell + affected pages lives
 * in SocketManager; this component is presentation only.
 *
 * Mounted once in App.jsx, renders nothing until an event arrives.
 */
import { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { getSocket } from '../../realtime/socket';

export default function NotificationToaster() {
    const isAuthenticated = useSelector((s) => s.auth?.isAuthenticated);
    const navigate = useNavigate();
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (!isAuthenticated) return undefined;
        const socket = getSocket();
        const onNew = (n) => {
            if (n && n.title) setToast(n);
        };
        socket.on('notification:new', onNew);
        return () => socket.off('notification:new', onNew);
    }, [isAuthenticated]);

    if (!toast) return null;

    return (
        <Snackbar
            open
            key={toast.id}
            autoHideDuration={6000}
            onClose={(_, reason) => {
                if (reason !== 'clickaway') setToast(null);
            }}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
            <Alert
                severity="info"
                variant="filled"
                onClose={() => setToast(null)}
                sx={{ cursor: toast?.data?.url ? 'pointer' : 'default',
                      maxWidth: 380 }}
                onClick={() => {
                    const url = toast?.data?.url;
                    setToast(null);
                    if (url) navigate(url);
                }}
            >
                <strong>{toast.title}</strong>
                {toast.body ? <> — {toast.body}</> : null}
            </Alert>
        </Snackbar>
    );
}
