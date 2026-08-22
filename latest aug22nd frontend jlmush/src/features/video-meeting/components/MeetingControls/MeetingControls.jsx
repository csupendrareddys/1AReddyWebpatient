import { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import CallEndIcon from '@mui/icons-material/CallEnd';

/**
 * MeetingControls - Bottom toolbar for video meeting.
 *
 * Controls:
 * - Toggle microphone (mute/unmute)
 * - Toggle camera (on/off)
 * - Toggle screen sharing
 * - End call
 */
const MeetingControls = ({ room, onDisconnect }) => {
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);

    const toggleAudio = () => {
        if (!room) return;
        room.localParticipant.audioTracks.forEach((pub) => {
            if (isAudioMuted) {
                pub.track.enable();
            } else {
                pub.track.disable();
            }
        });
        setIsAudioMuted(!isAudioMuted);
    };

    const toggleVideo = () => {
        if (!room) return;
        room.localParticipant.videoTracks.forEach((pub) => {
            // Don't toggle the screen share track
            if (pub.track.name !== 'screen') {
                if (isVideoOff) {
                    pub.track.enable();
                } else {
                    pub.track.disable();
                }
            }
        });
        setIsVideoOff(!isVideoOff);
    };

    const toggleScreenShare = async () => {
        if (!room) return;

        if (isScreenSharing) {
            // Stop screen sharing — remove the screen track
            room.localParticipant.videoTracks.forEach((pub) => {
                if (pub.track.name === 'screen') {
                    pub.track.stop();
                    room.localParticipant.unpublishTrack(pub.track);
                }
            });
            setIsScreenSharing(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                });
                const screenTrack = stream.getTracks()[0];

                // Dynamically import to create LocalVideoTrack
                const Video = await import('twilio-video');
                const localScreenTrack = new Video.LocalVideoTrack(
                    screenTrack,
                    { name: 'screen' }
                );

                room.localParticipant.publishTrack(localScreenTrack);
                setIsScreenSharing(true);

                // Handle user stopping share via the browser's native UI
                screenTrack.onended = () => {
                    room.localParticipant.unpublishTrack(localScreenTrack);
                    setIsScreenSharing(false);
                };
            } catch (err) {
                // User cancelled the screen share dialog or an error occurred
                console.warn('Screen share failed:', err);
            }
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                gap: 2,
                p: 2,
                bgcolor: 'background.paper',
                borderTop: '1px solid',
                borderColor: 'divider',
            }}
        >
            <Tooltip title={isAudioMuted ? 'Unmute' : 'Mute'}>
                <IconButton
                    onClick={toggleAudio}
                    color={isAudioMuted ? 'error' : 'default'}
                    sx={{
                        bgcolor: isAudioMuted ? 'error.light' : 'action.hover',
                        '&:hover': {
                            bgcolor: isAudioMuted ? 'error.main' : 'action.selected',
                        },
                    }}
                >
                    {isAudioMuted ? <MicOffIcon /> : <MicIcon />}
                </IconButton>
            </Tooltip>

            <Tooltip title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}>
                <IconButton
                    onClick={toggleVideo}
                    color={isVideoOff ? 'error' : 'default'}
                    sx={{
                        bgcolor: isVideoOff ? 'error.light' : 'action.hover',
                        '&:hover': {
                            bgcolor: isVideoOff ? 'error.main' : 'action.selected',
                        },
                    }}
                >
                    {isVideoOff ? <VideocamOffIcon /> : <VideocamIcon />}
                </IconButton>
            </Tooltip>

            <Tooltip title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
                <IconButton
                    onClick={toggleScreenShare}
                    color={isScreenSharing ? 'warning' : 'default'}
                    sx={{
                        bgcolor: isScreenSharing ? 'warning.light' : 'action.hover',
                        '&:hover': {
                            bgcolor: isScreenSharing ? 'warning.main' : 'action.selected',
                        },
                    }}
                >
                    {isScreenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                </IconButton>
            </Tooltip>

            <Tooltip title="End call">
                <IconButton
                    onClick={onDisconnect}
                    sx={{
                        bgcolor: 'error.main',
                        color: 'white',
                        '&:hover': { bgcolor: 'error.dark' },
                    }}
                >
                    <CallEndIcon />
                </IconButton>
            </Tooltip>
        </Box>
    );
};

export default MeetingControls;
