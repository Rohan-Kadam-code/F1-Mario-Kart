import { usePlaybackStore } from '../stores/playbackStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useSceneStore } from '../stores/sceneStore.js';

const SPEEDS = [1, 2, 5, 10];

export function PlaybackControls({ onAudioToggle, audioRef }) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentRaceTime = usePlaybackStore((s) => s.currentRaceTime);
  const currentLap = usePlaybackStore((s) => s.currentLap);
  const play = usePlaybackStore((s) => s.play);
  const pause = usePlaybackStore((s) => s.pause);
  const setSpeed = usePlaybackStore((s) => s.setSpeed);
  const seek = usePlaybackStore((s) => s.seek);
  const raceDuration = useSessionStore((s) => s.raceDuration);
  const totalLaps = useSessionStore((s) => s.totalLaps);
  const isAudioEnabled = useSceneStore((s) => s.isAudioEnabled);
  const setAudioEnabled = useSceneStore((s) => s.setAudioEnabled);

  const progress = raceDuration > 0 ? currentRaceTime / raceDuration : 0;

  function toggle() {
    if (isPlaying) {
      pause();
    } else {
      audioRef?.current?.init();
      play();
    }
  }

  function handleSeek(e) {
    const val = parseInt(e.target.value) / 100000;
    seek(val * raceDuration);
  }

  function toggleAudio() {
    const next = !isAudioEnabled;
    setAudioEnabled(next);
    onAudioToggle?.(next);
  }

  return (
    <div className="playback-bar glass-panel">
      <button className="play-btn" onClick={toggle} title="Play / Pause">
        {isPlaying ? '⏸' : '▶'}
      </button>

      <div className="scrubber-wrap">
        <span className="time-label">Lap {currentLap}</span>
        <input
          type="range"
          className="scrubber"
          min={0}
          max={100000}
          value={Math.floor(progress * 100000)}
          onChange={handleSeek}
        />
        <span className="time-label">/ {totalLaps}</span>
      </div>

      <div className="speed-selector">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`speed-btn ${speed === s ? 'active' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>

      <button className="icon-button" onClick={toggleAudio} title="Toggle Sound Effects" style={{ fontSize: '1.2rem', marginLeft: 8 }}>
        {isAudioEnabled ? '🔊' : '🔇'}
      </button>
    </div>
  );
}
