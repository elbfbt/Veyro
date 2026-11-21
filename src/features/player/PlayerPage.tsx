import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, MonitorPlay, Play, ShieldCheck } from 'lucide-react';
import { getChannelStream, getMovieStream, getEpisodeStream } from '../../lib/contentApi';

type PlayerKind = 'channel' | 'movie' | 'episode';

interface StreamResolution {
  playable: boolean;
  streamUrl?: string;
  reason?: string;
}

export function PlayerPage() {
  const { id = '' } = useParams();

  const channelMatch = useMatch({ path: '/player/channel/:id' });
  const movieMatch = useMatch({ path: '/player/movie/:id' });
  const episodeMatch = useMatch({ path: '/player/episode/:id' });

  const kind: PlayerKind | null =
    channelMatch ? 'channel' : movieMatch ? 'movie' : episodeMatch ? 'episode' : null;
  const contentId =
    channelMatch?.params.id ?? movieMatch?.params.id ?? episodeMatch?.params.id ?? id;

  const [stream, setStream] = useState<StreamResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!kind || !contentId) {
      setApiError('Invalid player route.');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setApiError(null);
    setPlayError(null);

    const load = async () => {
      try {
        const result =
          kind === 'channel'
            ? await getChannelStream(contentId)
            : kind === 'movie'
              ? await getMovieStream(contentId)
              : await getEpisodeStream(contentId);
        if (!active) return;
        setStream(result.stream);
      } catch (caught) {
        if (!active) return;
        setApiError(caught instanceof Error ? caught.message : 'Could not resolve stream.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [kind, contentId]);

  const handlePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlayError(null);
    } catch {
      setPlayError('Autoplay was blocked by the browser. Click play to start.');
    }
  }, []);

  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const err = video.error;
    if (!err) {
      setPlayError('Playback failed.');
      return;
    }
    const messages: Record<number, string> = {
      1: 'Media playback was aborted.',
      2: 'Network error loading the stream.',
      3: 'The stream format is not supported by this browser.',
      4: 'The stream could not be decrypted or is not accessible.',
    };
    setPlayError(messages[err.code] ?? 'Playback failed.');
  }, []);

  if (!kind) {
    return (
      <div className="inner-page phase-page">
        <div className="empty-state">
          <h1>Invalid player route</h1>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="inner-page player-page">
        <p className="provider-message">Resolving stream…</p>
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <AlertCircle size={32} />
          <h1>Stream unavailable</h1>
          <p>{apiError}</p>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  const resolution = stream;
  if (!resolution) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <h1>No stream data</h1>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  if (!resolution.playable) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <AlertCircle size={32} />
          <h1>Web playback not supported</h1>
          <p>
            {resolution.reason === 'xtream_web_playback_unsupported'
              ? 'This provider requires native playback (Android/Android TV). Web browser playback is not available for Xtream providers.'
              : resolution.reason || 'This content cannot be played in the browser.'}
          </p>
          <p className="player-details__privacy">
            <ShieldCheck size={16} /> No provider credentials are exposed to the browser.
          </p>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  const streamUrl = resolution.streamUrl!;
  const isHls = /\.m3u8([?#]|$)/i.test(streamUrl);

  const probe = (type: string) => {
    const video = document.createElement('video');
    return video.canPlayType(type) !== '';
  };
  const canPlay = isHls ? probe('application/vnd.apple.mpegurl') : probe('video/mp4');

  return (
    <div className="player-page">
      <div className="player-frame">
        <Link to="/" className="button button--quiet" aria-label="Exit player">
          <ArrowLeft size={18} /> Exit player
        </Link>
        <span className="badge badge--neutral">
          <MonitorPlay size={14} /> Direct provider stream
        </span>
        <div className="player-frame__center">
          {canPlay ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              onError={handleVideoError}
              className="player-video"
              onPlay={() => setPlayError(null)}
            >
              <source src={streamUrl} />
            </video>
          ) : null}
          {!canPlay && !playError ? (
            <div className="player-frame__unsupported">
              <AlertCircle size={32} />
              <h2>Stream format not supported</h2>
              <p>
                {isHls
                  ? 'This browser cannot play HLS (.m3u8) streams natively.'
                  : 'This browser cannot play this stream format natively.'}
              </p>
              <p>Use the Veyro native app on Android/Android TV for direct provider playback.</p>
            </div>
          ) : null}
          {playError && (
            <button type="button" className="button button--primary" onClick={handlePlay}>
              <Play size={18} />
              {playError.includes('blocked') ? 'Click to Play' : 'Retry Playback'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
