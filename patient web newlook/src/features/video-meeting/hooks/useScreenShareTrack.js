import { useState, useEffect } from 'react';

/**
 * Detects an active screen-share across every participant (local + remote).
 *
 * A screen-share is a published video track named 'screen' (the name
 * MeetingControls tags it with). Returns `{ track, sharerName }` — `track`
 * is null when nobody is sharing. Reacts to publish/subscribe/unpublish
 * events, so a share started mid-call is picked up immediately rather than
 * only after a reconnect.
 *
 * Shared by <ScreenShare> (renders the track) and the meeting layouts (which
 * reflow — screen to the main stage, cameras to a strip — while sharing).
 */
const SCREEN_EVENTS = [
    'trackSubscribed',
    'trackUnsubscribed',
    'trackPublished',
    'trackUnpublished',
];

const findScreen = (participants) => {
    for (const p of participants) {
        if (!p) continue;
        for (const pub of p.videoTracks.values()) {
            const track = pub.track;
            if (track && track.name === 'screen') {
                return { track, sharerName: p.identity || 'Someone' };
            }
        }
    }
    return null;
};

const useScreenShareTrack = (participants = [], localParticipant = null) => {
    const [state, setState] = useState({ track: null, sharerName: '' });

    useEffect(() => {
        const all = [localParticipant, ...participants].filter(Boolean);

        const update = () => {
            const found = findScreen(all);
            setState(found || { track: null, sharerName: '' });
        };

        update();

        all.forEach((p) => SCREEN_EVENTS.forEach((e) => p.on(e, update)));
        return () => {
            all.forEach((p) => SCREEN_EVENTS.forEach((e) => p.off(e, update)));
        };
    }, [participants, localParticipant]);

    return state;
};

export default useScreenShareTrack;
