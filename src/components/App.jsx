/**
 * App — root component.
 * Holds all imperative refs, initialises AudioEffects + MarioEffects,
 * wires up useSessionLoader and useRenderLoop.
 */
import { useEffect, useRef, useState } from 'react';
import { AudioEffects } from '../renderer/AudioEffects.js';
import { MarioEffects } from '../renderer/MarioEffects.js';
import { useSessionLoader } from '../hooks/useSessionLoader.js';
import { useRenderLoop } from '../hooks/useRenderLoop.js';
import { usePlaybackStore } from '../stores/playbackStore.js';
import { useSceneStore } from '../stores/sceneStore.js';
import { useSessionStore } from '../stores/sessionStore.js';

import { SessionSelector } from './SessionSelector.jsx';
import { DriverPanel } from './DriverPanel.jsx';
import { RaceCanvas } from './RaceCanvas.jsx';
import { PlaybackControls } from './PlaybackControls.jsx';
import { EventFeed } from './EventFeed.jsx';
import { RaceInfo } from './RaceInfo.jsx';
import { GaragePanel } from './GaragePanel.jsx';
import { LoadingOverlay } from './LoadingOverlay.jsx';

import '../styles/globals.css';
import '../styles/mario-effects.css';

export function App() {
  // All imperative references live here — not in React state
  const sceneRefs = useRef({});
  const audioRef = useRef(null);
  const marioRef = useRef(null);
  const raceInfoRef = useRef(null);
  const eventFeedRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);

  const setTrackedDriver = usePlaybackStore((s) => s.setTrackedDriver);
  const trackedDriver = usePlaybackStore((s) => s.trackedDriver);
  const garageMode = useSceneStore((s) => s.garageMode);
  const setGarageMode = useSceneStore((s) => s.setGarageMode);
  const drivers = useSessionStore((s) => s.drivers);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  // Load session hook
  const { loadSession } = useSessionLoader(sceneRefs);

  // Render loop (starts immediately — guards against missing scene internally)
  useRenderLoop(sceneRefs);

  // Initialise imperative audio + mario systems after first render
  useEffect(() => {
    const overlay = document.getElementById('effectOverlay');
    // eventFeedRef.current is the real DOM div — MarioEffects calls appendChild on it directly
    const feedEl = eventFeedRef.current;

    const audio = new AudioEffects();
    audioRef.current = audio;

    // Particle adapter — routes 2D calls to Three.js particles3D
    const particleAdapter = {
      emitBoost() {}, emitSpotlight() {}, emitExplosion() {},
      emitConfetti(cw, count) { sceneRefs.current.particles3D?.emitConfetti(sceneRefs.current.sceneManager?.trackBounds, count); },
      emitRain(w, h, count) { sceneRefs.current.particles3D?.emitRain(sceneRefs.current.sceneManager?.trackBounds, count); },
      emitSmoke() {}, emitStarSparkle() {}, update() { sceneRefs.current.particles3D?.update(); },
      draw() {}, clear() { sceneRefs.current.particles3D?.clear(); },
      get count() { return sceneRefs.current.particles3D?.count ?? 0; },
    };

    const mario = new MarioEffects(overlay, particleAdapter, feedEl, audio);
    marioRef.current = mario;

    // Expose to render loop via sceneRefs
    sceneRefs.current.marioEffects = mario;
    sceneRefs.current.raceInfo = raceInfoRef.current;

    // Key shortcuts
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'c') sceneRefs.current.sceneManager?.cycleCameraMode();
    };
    window.addEventListener('keydown', onKey);

    // Track pan break
    const onPanBreak = () => setTrackedDriver(null);
    window.addEventListener('track-pan-break', onPanBreak);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('track-pan-break', onPanBreak);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep raceInfo ref in sceneRefs fresh
  useEffect(() => {
    sceneRefs.current.raceInfo = raceInfoRef.current;
  });

  // Driver tracking → scene camera
  function handleDriverClick(driverNum) {
    const sm = sceneRefs.current.sceneManager;
    if (!sm) return;
    if (driverNum === null) {
      sm.followKart(null);
    } else {
      const kart = sceneRefs.current.karts?.get(driverNum);
      if (kart) sm.followKart(kart);
    }
  }

  // Garage toggle
  function openGarage() {
    if (drivers.length === 0) {
      alert('Please load a session before entering the Garage!');
      return;
    }
    if (garageMode) {
      closeGarage();
      return;
    }
    usePlaybackStore.getState().pause();
    const firstKart = sceneRefs.current.karts?.values().next().value;
    sceneRefs.current.sceneManager?.setGarageMode(true, firstKart);
    setGarageMode(true);
    setTimeout(() => sceneRefs.current.sceneManager?.resize(), 100);
  }

  function closeGarage() {
    sceneRefs.current.sceneManager?.setGarageMode(false);
    setGarageMode(false);
    setTimeout(() => sceneRefs.current.sceneManager?.resize(), 100);
  }

  function handleAudioToggle(enabled) {
    audioRef.current?.toggle(enabled);
  }

  const session = useSessionStore((s) => s.session);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {/* ── Header ── */}
      <header
        className="glass-panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          height: 44,
          gap: 12,
          flexShrink: 0,
          zIndex: 30,
          borderRadius: 0,
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: '1.2rem', filter: 'drop-shadow(0 0 6px rgba(225,6,0,0.5))' }}>🏎️</span>
          <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--text-primary)' }}>F1</span>
            <span style={{ color: 'var(--accent-primary)', fontWeight: 900 }}>.</span>
            <span style={{ background: 'linear-gradient(135deg,#e10600,#ff6b35)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Mario</span>
          </h1>
        </div>

        {/* Garage toggle */}
        <button
          className={`action-btn ${garageMode ? 'active' : ''}`}
          onClick={openGarage}
          style={garageMode ? { borderColor: 'rgba(225,6,0,0.4)', background: 'rgba(225,6,0,0.08)', color: 'var(--accent-primary)' } : {}}
        >
          🛠️ Garage
        </button>

        {/* Session selector */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <SessionSelector onLoad={loadSession} />
        </div>

        {/* Status badge */}
        {session && (
          <span className="status-badge">SESSION STARTED</span>
        )}

        {/* Fullscreen */}
        <button className="icon-button" title="Toggle fullscreen" onClick={() => {
          document.documentElement.requestFullscreen?.();
          setTimeout(() => sceneRefs.current.sceneManager?.resize(), 200);
        }}>
          <svg viewBox="0 0 24 24" width={18} height={18} stroke="currentColor" strokeWidth={2} fill="none">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </header>

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        {/* Left sidebar — hidden in garage mode */}
        {!garageMode && <DriverPanel onDriverClick={handleDriverClick} />}

        {/* Center — 3D canvas always rendered so Three.js stays alive */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, position: 'relative' }}>
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <RaceCanvas
              sceneRefs={sceneRefs}
              onSceneReady={() => setSceneReady(true)}
            />
            <LoadingOverlay />

            {/* Garage sidebar overlaid directly on the canvas — transparent outside sidebar */}
            <GaragePanel sceneRefs={sceneRefs} onClose={closeGarage} />
          </div>

          {/* Playback controls — hidden in garage mode */}
          {!garageMode && <PlaybackControls onAudioToggle={handleAudioToggle} audioRef={audioRef} />}
        </div>

        {/* Right sidebar — hidden in garage mode */}
        {!garageMode && <EventFeed ref={eventFeedRef} />}
      </div>

      {/* ── Footer — hidden in garage mode ── */}
      {!garageMode && <RaceInfo ref={raceInfoRef} />}
    </div>
  );
}
