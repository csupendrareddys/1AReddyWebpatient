import { useState, useEffect, useCallback, useRef } from 'react';
import Video from 'twilio-video';

/**
 * Custom hook for managing Twilio Video room connection.
 *
 * Handles:
 * - Connecting to a Twilio Video room with audio, video, and a DataTrack
 * - Tracking remote participants (join/leave)
 * - Providing a LocalDataTrack for chat and whiteboard sync
 * - Clean disconnection on unmount
 *
 * @param {string} token - Twilio access token from backend
 * @param {string} roomName - Room name to connect to
 * @param {'video'|'audio'|'chat'} mode - Consultation mode controlling which tracks to create
 * @returns {{ room, participants, localParticipant, dataTrack, isConnecting, error, disconnect }}
 */
const useTwilioRoom = (token, roomName, mode = 'video') => {
    const [room, setRoom] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);
    const dataTrackRef = useRef(null);
    // Registered message handlers — keyed by component name
    const messageHandlersRef = useRef(new Map());

    /** Register a listener for all incoming remote DataTrack messages. Returns a cleanup fn. */
    const onMessage = useCallback((key, handler) => {
        messageHandlersRef.current.set(key, handler);
        return () => messageHandlersRef.current.delete(key);
    }, []);

    /** Dispatch an incoming message to all registered handlers */
    const dispatchMessage = useCallback((data) => {
        messageHandlersRef.current.forEach((handler) => {
            try { handler(data); } catch { /* noop */ }
        });
    }, []);

    /** Subscribe to all data tracks from a remote participant */
    const subscribeParticipantDataTracks = useCallback((participant) => {
        const onTrackSubscribed = (track) => {
            if (track.kind === 'data') {
                track.on('message', dispatchMessage);
            }
        };
        participant.on('trackSubscribed', onTrackSubscribed);
        // Handle already-subscribed tracks
        participant.tracks.forEach((pub) => {
            if (pub.track && pub.track.kind === 'data') {
                pub.track.on('message', dispatchMessage);
            }
        });
        // Return cleanup
        return () => {
            participant.off('trackSubscribed', onTrackSubscribed);
            participant.tracks.forEach((pub) => {
                if (pub.track && pub.track.kind === 'data') {
                    pub.track.off('message', dispatchMessage);
                }
            });
        };
    }, [dispatchMessage]);

    const participantCleanups = useRef(new Map());

    const connect = useCallback(async () => {
        if (!token || !roomName) return;

        setIsConnecting(true);
        setError(null);

        try {
            // Create a LocalDataTrack for chat and whiteboard sync
            const localDataTrack = new Video.LocalDataTrack();
            dataTrackRef.current = localDataTrack;

            // Create tracks based on consultation mode:
            // - 'video': audio + video + data
            // - 'audio': audio + data (no video)
            // - 'chat':  data only (no audio/video)
            let localAudioTrack = null;
            let localVideoTrack = null;

            if (mode !== 'chat') {
                try {
                    localAudioTrack = await Video.createLocalAudioTrack();
                } catch (e) {
                    console.warn('[Twilio] Could not access microphone:', e.message);
                }
            }

            if (mode === 'video') {
                try {
                    localVideoTrack = await Video.createLocalVideoTrack({ width: 640 });
                } catch (e) {
                    console.warn('[Twilio] Could not access camera:', e.message);
                }
            }

            const tracks = [localDataTrack];
            if (localAudioTrack) tracks.push(localAudioTrack);
            if (localVideoTrack) tracks.push(localVideoTrack);

            const connectedRoom = await Video.connect(token, {
                name: roomName,
                tracks,
                dominantSpeaker: true,
            });

            setRoom(connectedRoom);

            // Initialize with existing participants
            const existingParticipants = Array.from(
                connectedRoom.participants.values()
            );
            setParticipants(existingParticipants);

            // Listen for participant events
            connectedRoom.on('participantConnected', (participant) => {
                const cleanup = subscribeParticipantDataTracks(participant);
                participantCleanups.current.set(participant.sid, cleanup);
                setParticipants((prev) => [...prev, participant]);
            });

            connectedRoom.on('participantDisconnected', (participant) => {
                const cleanup = participantCleanups.current.get(participant.sid);
                if (cleanup) { cleanup(); participantCleanups.current.delete(participant.sid); }
                setParticipants((prev) =>
                    prev.filter((p) => p !== participant)
                );
            });

            connectedRoom.on('disconnected', () => {
                // Stop local tracks on disconnect to release camera/mic
                if (localAudioTrack) localAudioTrack.stop();
                if (localVideoTrack) localVideoTrack.stop();
                participantCleanups.current.forEach((fn) => fn());
                participantCleanups.current.clear();
                setRoom(null);
                setParticipants([]);
            });

            // Subscribe to existing participants' data tracks
            connectedRoom.participants.forEach((participant) => {
                const cleanup = subscribeParticipantDataTracks(participant);
                participantCleanups.current.set(participant.sid, cleanup);
            });
        } catch (err) {
            setError(err.message || 'Failed to connect to room');
        } finally {
            setIsConnecting(false);
        }
    }, [token, roomName]);

    const disconnect = useCallback(() => {
        if (room) {
            room.disconnect();
        }
    }, [room]);

    // Auto-connect when token is available
    useEffect(() => {
        if (token && roomName) {
            connect();
        }

        // Cleanup on unmount
        return () => {
            if (room) {
                room.disconnect();
            }
        };
    }, [token, roomName]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        room,
        participants,
        localParticipant: room?.localParticipant || null,
        dataTrack: dataTrackRef.current,
        onMessage,
        isConnecting,
        error,
        disconnect,
    };
};

export default useTwilioRoom;
