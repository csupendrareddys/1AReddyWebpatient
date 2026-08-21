/**
 * ProfileImageUpload — a reusable avatar + camera-button that actually uploads.
 *
 * Drops into any profile page (doctor / patient / clinic / hospital / admin):
 * clicking the camera opens a file picker, POSTs the image to the shared
 * ``/api/profile/image`` endpoint (which stores it and sets the user's
 * ``profile_image``), then calls ``onChange(url)`` so the page reflects the new
 * picture immediately.
 */
import { useRef, useState } from 'react';
import { Avatar, Box, IconButton, CircularProgress, Typography } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

import axiosInstance from '../../../api/axiosConfig';

export default function ProfileImageUpload({ value, onChange, fallback, size = 100 }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [pendingMsg, setPendingMsg] = useState('');

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';            // let the same file be re-picked later
        if (!file) return;
        setBusy(true);
        setErr('');
        setPendingMsg('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await axiosInstance.post('/api/profile/image', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const payload = res?.data?.data || res?.data || {};
            const url = payload.url;
            if (payload.pending) {
                // Doctor: change is queued — keep the old approved photo showing.
                setPendingMsg('New photo submitted — waiting for admin approval.');
            } else if (url) {
                onChange?.(url);
            }
        } catch (e2) {
            setErr(e2?.response?.data?.error || 'Upload failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box>
            <Box sx={{ position: 'relative', width: size, height: size }}>
                <Avatar
                    src={value || undefined}
                    sx={{ width: size, height: size, border: '3px solid #e0e0e0', fontSize: size * 0.4 }}
                >
                    {fallback}
                </Avatar>
                <IconButton
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                    size="small"
                    sx={{
                        position: 'absolute', bottom: 0, right: 0,
                        bgcolor: 'primary.main', color: 'white',
                        '&:hover': { bgcolor: 'primary.dark' },
                        width: 32, height: 32,
                    }}
                >
                    {busy
                        ? <CircularProgress size={16} sx={{ color: 'white' }} />
                        : <PhotoCameraIcon fontSize="small" />}
                </IconButton>
                <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
            </Box>
            {err && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    {err}
                </Typography>
            )}
            {pendingMsg && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main', fontWeight: 600 }}>
                    ⏳ {pendingMsg}
                </Typography>
            )}
        </Box>
    );
}
