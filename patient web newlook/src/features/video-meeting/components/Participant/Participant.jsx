import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Avatar } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';

/**
 * Participant component - renders a single participant's video/audio tracks.
 *
 * Handles:
 * - Subscribing/unsubscribing to video and audio tracks
 * - Attaching tracks to DOM elements
 * - Showing avatar placeholder when video is off
 * - Displaying participant identity label
 */
const Participant = ({ participant, isLocal = false }) => {
    const [videoTracks, setVideoTracks] = useState([]);
    const [audioTracks, setAudioTracks] = useState([]);
    const videoRef = useRef();
    const audioRef = useRef();

    // Subscribe to track events
    useEffect(() => {
        const trackSubscribed = (track) => {
            if (track.kind === 'video') {
                setVideoTracks((prev) => [...prev, track]);
            } else if (track.kind === 'audio') {
                setAudioTracks((prev) => [...prev, track]);
            }
        };

        const trackUnsubscribed = (track) => {
            if (track.kind === 'video') {
                setVideoTracks((prev) => prev.filter((t) => t !== track));
            } else if (track.kind === 'audio') {
                setAudioTracks((prev) => prev.filter((t) => t !== track));
            }
        };

        // Get already-published tracks
        const existingTracks = Array.from(participant.tracks.values())
            .filter((pub) => pub.track)
            .map((pub) => pub.track);

        setVideoTracks(existingTracks.filter((t) => t.kind === 'video'));
        setAudioTracks(existingTracks.filter((t) => t.kind === 'audio'));

        participant.on('trackSubscribed', trackSubscribed);
        participant.on('trackUnsubscribed', trackUnsubscribed);

        return () => {
            participant.off('trackSubscribed', trackSubscribed);
            participant.off('trackUnsubscribed', trackUnsubscribed);
        };
    }, [participant]);

    // Attach the CAMERA track to the tile — never the screen-share track (name
    // 'screen'). The screen is rendered separately in its own pane, so it must
    // not hijack the participant's camera tile.
    const cameraTrack = videoTracks.find((t) => t.name !== 'screen');
    useEffect(() => {
        if (cameraTrack && videoRef.current) {
            cameraTrack.attach(videoRef.current);
            return () => {
                cameraTrack.detach();
            };
        }
    }, [cameraTrack]);

    // Attach audio track to DOM
    useEffect(() => {
        const audioTrack = audioTracks[0];
        if (audioTrack && audioRef.current) {
            audioTrack.attach(audioRef.current);
            return () => {
                audioTrack.detach();
            };
        }
    }, [audioTracks]);

    const hasVideo = videoTracks.length > 0;

    return (
        <Box
            sx={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16/9',
                bgcolor: 'grey.900',
                borderRadius: 2,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {hasVideo ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted={isLocal}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: isLocal ? 'scaleX(-1)' : 'none',
                    }}
                />
            ) : (
                <Avatar sx={{ width: 80, height: 80, bgcolor: 'primary.main' }}>
                    <PersonIcon sx={{ fontSize: 48 }} />
                </Avatar>
            )}

            <audio ref={audioRef} autoPlay muted={isLocal} />

            <Typography
                variant="caption"
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    bgcolor: 'rgba(0,0,0,0.6)',
                    color: 'white',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                }}
            >
                {participant.identity} {isLocal ? '(You)' : ''}
            </Typography>
        </Box>
    );
};

export default Participant;
