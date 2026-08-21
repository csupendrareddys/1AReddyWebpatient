import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import useScreenShareTrack from '../../hooks/useScreenShareTrack';

/**
 * Dedicated screen-share stage.
 *
 * Renders the active screen-share track (a published video track named
 * 'screen') in its own large pane, separate from the camera tiles. Returns
 * null when nobody is sharing, so the caller only gives it the spotlight slot
 * while a share is active.
 *
 * Why this exists: the camera tiles (Participant.jsx) deliberately render only
 * the camera track, so without this pane a screen-share would have nowhere to
 * appear. Detection lives in useScreenShareTrack, which also drives the
 * layout's reflow — and picks up a mid-call share immediately (previously it
 * only surfaced after a reconnect reordered the participant's tracks).
 */
const ScreenShare = ({ participants = [], localParticipant = null }) => {
    const { track, sharerName } = useScreenShareTrack(participants, localParticipant);
    const videoRef = useRef();

    useEffect(() => {
        if (track && videoRef.current) {
            track.attach(videoRef.current);
            return () => track.detach();
        }
    }, [track]);

    if (!track) return null;

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                minHeight: 240,
                bgcolor: '#000',
                borderRadius: 2,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000',
                }}
            />
            <Box
                sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    bgcolor: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                }}
            >
                <ScreenShareIcon fontSize="small" />
                <Typography variant="caption">
                    {sharerName} is sharing their screen
                </Typography>
            </Box>
        </Box>
    );
};

export default ScreenShare;
