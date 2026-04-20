/**
 * RaceCanvas — hosts the Three.js WebGL canvas.
 * SceneManager construction is deferred to requestAnimationFrame so the
 * container has non-zero dimensions when the renderer is initialised.
 */
import { useEffect, useRef } from 'react';
import { SceneManager } from '../renderer3d/SceneManager.js';
import { Track3D } from '../renderer3d/Track3D.js';
import { Particles3D } from '../renderer3d/Particles3D.js';
import { Environment3D } from '../renderer3d/Environment3D.js';
import { MiniMap } from '../components/MiniMap.jsx';
import { useSceneStore } from '../stores/sceneStore.js';

export function RaceCanvas({ sceneRefs, onSceneReady }) {
  const containerRef = useRef(null);
  const miniMapRef = useRef(null);
  const quality = useSceneStore((s) => s.quality);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let sm, rafId, cleanedUp = false;

    // Defer construction so the browser has completed layout and
    // container.clientWidth/clientHeight are non-zero.
    rafId = requestAnimationFrame(() => {
      if (cleanedUp) return;

      sm = new SceneManager(container);
      window.sceneManager = sm;

      const track3D = new Track3D(sm.scene);
      const particles3D = new Particles3D(sm.scene);
      const environment3D = new Environment3D(sm.scene);

      sm.track3D = track3D;
      sm.environment3D = environment3D;
      sm.particles3D = particles3D;

      // Wire resize
      const handleResize = () => sm.resize();
      window.addEventListener('resize', handleResize);

      // Store refs
      sceneRefs.current = {
        ...sceneRefs.current,
        sceneManager: sm,
        track3D,
        particles3D,
        environment3D,
        miniMap: miniMapRef.current,
        karts: new Map(),
      };

      // Second rAF to ensure canvas is in DOM and sized correctly before notify
      requestAnimationFrame(() => {
        if (cleanedUp) return;
        sm.resize();
        onSceneReady?.();
      });

      // Track pan-break event
      const panBreak = () => {
        const pb = sceneRefs.current?.playbackStore;
        if (pb) pb.setTrackedDriver(null);
      };
      window.addEventListener('track-pan-break', panBreak);

      sm._cleanupFns = [
        () => window.removeEventListener('resize', handleResize),
        () => window.removeEventListener('track-pan-break', panBreak),
      ];
    });

    return () => {
      cleanedUp = true;
      cancelAnimationFrame(rafId);
      if (sm) {
        sm._cleanupFns?.forEach((fn) => fn());
        const canvas = sm.renderer?.domElement;
        sm.renderer?.dispose();
        if (canvas?.parentElement === container) container.removeChild(canvas);
        if (window.sceneManager === sm) window.sceneManager = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quality changes propagate to SceneManager
  useEffect(() => {
    const sm = sceneRefs.current?.sceneManager;
    if (sm) sm.setQuality?.(quality);
  }, [quality, sceneRefs]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Overlay for MarioEffects DOM elements */}
      <div
        id="effectOverlay"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 }}
      />

      {/* Canvas controls */}
      <CanvasControls sceneRefs={sceneRefs} />

      {/* Cache indicator */}
      <div id="cacheIndicator" className="cache-indicator hidden">
        <div className="cache-info">Telemetry Cache</div>
        <div className="cache-bar"><div id="cacheBarFill" /></div>
        <div id="cachePercentage">0%</div>
      </div>

      {/* MiniMap */}
      <MiniMap ref={miniMapRef} sceneRefs={sceneRefs} />
    </div>
  );
}

function CanvasControls({ sceneRefs }) {
  function sm() { return sceneRefs.current?.sceneManager; }

  return (
    <>
      {/* Zoom controls — top right */}
      <div className="zoom-controls" style={{ top: 12, right: 12 }}>
        <button className="canvas-controls-btn" onClick={() => sm()?.zoomIn()} title="Zoom In">+</button>
        <button className="canvas-controls-btn" onClick={() => sm()?.zoomOut()} title="Zoom Out">−</button>
        <button className="canvas-controls-btn" onClick={() => sm()?.resetView()} title="Reset View">⟲</button>
        <button className="canvas-controls-btn" onClick={() => sm()?.cycleCameraMode()} title="Cycle Camera (C)" style={{ marginTop: 8, fontSize: '1.2rem' }}>📹</button>
      </div>

      {/* Quality controls — top left */}
      <QualityControls sceneRefs={sceneRefs} />
    </>
  );
}

function QualityControls({ sceneRefs }) {
  const setQuality = useSceneStore((s) => s.setQuality);
  const quality = useSceneStore((s) => s.quality);

  function handleQuality(q) {
    setQuality(q);
    sceneRefs.current?.sceneManager?.setQuality?.(q);
  }

  return (
    <div className="quality-toggle" style={{ top: 12, left: 12 }}>
      {['low', 'medium', 'high'].map((q) => (
        <button
          key={q}
          className={`canvas-controls-btn ${quality === q ? 'active' : ''}`}
          data-q={q}
          onClick={() => handleQuality(q)}
        >
          {q === 'low' ? 'Low' : q === 'medium' ? 'Med' : 'High'}
        </button>
      ))}
    </div>
  );
}
