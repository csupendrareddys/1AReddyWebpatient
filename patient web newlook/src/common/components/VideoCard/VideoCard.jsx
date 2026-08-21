import { useState } from 'react';
import {
  Typography,
  IconButton,
  Dialog,
  DialogContent,
} from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import CloseIcon from '@mui/icons-material/Close';
import VideocamIcon from '@mui/icons-material/Videocam';
import './VideoCard.css';

function youtubeIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
    }
  } catch {}
  return null;
}

function resolvePlayer(video) {
  const url =
    video.video_asset_url ||
    video.video_url ||
    video.url;

  if (!url) return null;

  if (video.video_asset_url) {
    return { kind: 'native', src: video.video_asset_url };
  }

  const yt = youtubeIdFromUrl(url);
  if (yt) {
    // ``mute=1`` is required by every current browser for unattended
    // autoplay inside an iframe — without it the embed opens paused
    // and the user has to click play even though they already clicked
    // the card to open the modal. ``playsinline=1`` keeps iOS Safari
    // from kicking into fullscreen on first play.
    return {
      kind: 'iframe',
      src: `https://www.youtube.com/embed/${yt}?autoplay=1&mute=1&playsinline=1`,
      youtubeId: yt,
    };
  }

  return { kind: 'native', src: url };
}


// Best-effort thumbnail for the card preview. Priority:
//   1. Admin-uploaded thumbnail (``thumbnail_url`` from the model).
//   2. YouTube's auto-generated frame (``hqdefault`` is always present;
//      ``maxresdefault`` is 1280x720 but missing on older / private
//      videos so we don't rely on it).
//   3. Nothing — the caller renders a placeholder icon.
function resolveThumbnail(video, player) {
  if (video.thumbnail_url) return video.thumbnail_url;
  if (player?.youtubeId) {
    return `https://img.youtube.com/vi/${player.youtubeId}/hqdefault.jpg`;
  }
  return null;
}

export default function VideoCard({ video }) {
  const [open, setOpen] = useState(false);

  const player = resolvePlayer(video);
  const isPlayable = !!player;
  const thumbnail = resolveThumbnail(video, player);

  // Card preview rules:
  //   - If an admin uploaded a thumbnail OR the source is a YouTube
  //     video, show the still image — clicking opens the modal where
  //     the actual playback happens.
  //   - If the source is a native (uploaded) video and no thumbnail
  //     was attached, show the muted/looping preview as before so the
  //     card has motion.
  //   - Otherwise show the placeholder icon.
  const previewKind = thumbnail
    ? 'image'
    : (player?.kind === 'native' ? 'native' : 'placeholder');

  return (
    <>
      <div className="video-card">

        {/* VIDEO */}
        <div
          className="video-card__media-container"
          onClick={() => isPlayable && setOpen(true)}
        >
          {previewKind === 'image' && (
            <img
              src={thumbnail}
              alt={video.title || 'Video thumbnail'}
              className="video-card__media"
              loading="lazy"
            />
          )}
          {previewKind === 'native' && (
            <video
              src={player.src}
              muted
              autoPlay
              loop
              playsInline
              className="video-card__media"
            />
          )}
          {previewKind === 'placeholder' && (
            <div className="video-card__placeholder">
              <VideocamIcon />
            </div>
          )}

          {isPlayable && (
            <div className="video-card__play">
              <PlayArrowRoundedIcon />
            </div>
          )}
        </div>

        {/* TEXT BELOW VIDEO */}
        <div className="video-card__content">
          <Typography variant="subtitle1">
            {video.title}
          </Typography>

          {video.description && (
            <Typography variant="body2" color="text.secondary">
              {video.description}
            </Typography>
          )}
        </div>
      </div>

      {/* DIALOG */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <IconButton onClick={() => setOpen(false)} className="video-card__close">
          <CloseIcon />
        </IconButton>

        <DialogContent className="video-card__dialog">
          {player && (
            <div className="video-card__player">
              {player.kind === 'iframe' ? (
                <iframe
                  src={player.src}
                  // ``allow="autoplay"`` is the feature-policy that lets
                  // the YouTube embed's autoplay=1 actually kick in;
                  // without it the iframe is silently blocked even
                  // though we asked for autoplay in the URL.
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  title={video.title}
                />
              ) : (
                <video
                  src={player.src}
                  controls
                  autoPlay
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}