/**
 * F1 Mario Kart Visualiser — Main Entry Point (Three.js 3D Edition)
 * Orchestrates data loading, timeline playback, rendering, and Mario Kart effects.
 *
 * Key design decisions for correctness:
 * - Playback is TIME-BASED: 1x speed = 1 second of race per 1 second real time
 * - Driver positions use per-driver lap-time interpolation from the laps API
 * - Track shape is extracted as a single clean lap from location data
 * - Rendering is powered by Three.js (SceneManager, Track3D, Kart3D, Particles3D, Environment3D)
 */

import { SceneManager } from './renderer3d/SceneManager.js';
import { Track3D } from './renderer3d/Track3D.js';
import { Kart3D } from './renderer3d/Kart3D.js';
import { preloadCarModel, isModelLoaded } from './renderer3d/CarModelLoader.js';
import { Particles3D } from './renderer3d/Particles3D.js';
import { Environment3D } from './renderer3d/Environment3D.js';
import { getTeamColor } from './renderer/DriverSprite.js';
import { AudioEffects } from './renderer/AudioEffects.js';
import { MarioEffects, EFFECT_TYPES } from './renderer/MarioEffects.js';
import { SessionSelector } from './components/SessionSelector.js';
import { DriverPanel } from './components/DriverPanel.js';
import { PlaybackControls } from './components/PlaybackControls.js';
import { RaceInfo } from './components/RaceInfo.js';
import { MiniMap } from './components/MiniMap.js';
import { GaragePanel } from './components/GaragePanel.js';
import * as api from './api/openf1.js';
import { findCircuit } from './data/circuitData.js';
import { LocationCache } from './data/LocationCache.js';

/* ============================================
   Global State
   ============================================ */
const state = {
  session: null,
  drivers: [],
  positions: [],
  laps: [],
  stints: [],
  weather: [],
  raceControl: [],
  intervals: [],
  pitStops: [],
  driverLapTimes: new Map(),
  raceStartTime: 0,
  raceEndTime: 0,
  raceDuration: 0,
  currentRaceTime: 0,
  isPlaying: false,
  speed: 1,
  totalLaps: 0,
  currentLap: 0,
  karts: new Map(),       // driverNumber → Kart3D
  trackShape: [],
  locationCache: new LocationCache(),
  lastPositionMap: new Map(),
  lastIntervalMap: new Map(),
  fastestLapTime: Infinity,
  fastestLapDriver: null,
  detectedEvents: new Set(),
  trackedDriver: null,

  // 2D track points (from TrackRenderer path) for fallback positioning
  trackPoints2D: [],
  trackLengths: [],
  totalLength: 0,
};

/* ============================================
   DOM References
   ============================================ */
const container3D = document.getElementById('raceTrack3D');
const overlay = document.getElementById('effectOverlay');
const loadingOverlay = document.getElementById('loadingOverlay');
const loaderFill = document.getElementById('loaderFill');
const eventFeed = document.getElementById('eventFeed');

/* ============================================
   Core Systems
   ============================================ */
const sceneManager = new SceneManager(container3D);
window.sceneManager = sceneManager;
const track3D = new Track3D(sceneManager.scene);
const miniMap = new MiniMap(document.getElementById('miniMap'));
const particles3D = new Particles3D(sceneManager.scene);
const environment3D = new Environment3D(sceneManager.scene);

sceneManager.track3D = track3D;
sceneManager.environment3D = environment3D;
sceneManager.particles3D = particles3D;

// Audio and Mario effects remain DOM/canvas-based
const audioController = new AudioEffects();

// MarioEffects needs a 2D canvas for the particles arg, but we can pass a
// lightweight adapter that routes particle calls to Particles3D
const particleAdapter = {
  emitBoost(cx, cy, color, count) {
    // Convert screen coords to approx world coords is complex;
    // for simplicity, use the tracked kart's 3D position or center
    // In practice these fire alongside kart position updates so we
    // re-emit in detectEvents with 3D coords
  },
  emitSpotlight(cx, cy, color) {},
  emitExplosion(cx, cy, count) {},
  emitConfetti(canvasWidth, count) {
    particles3D.emitConfetti(sceneManager.trackBounds, count);
  },
  emitRain(w, h, count) {
    particles3D.emitRain(sceneManager.trackBounds, count);
  },
  emitSmoke(cx, cy, count) {},
  emitStarSparkle(cx, cy) {},
  update() { particles3D.update(); },
  draw() {}, // No-op — Three.js renders automatically
  clear() { particles3D.clear(); },
  get count() { return particles3D.count; },
};

const marioEffects = new MarioEffects(overlay, particleAdapter, eventFeed, audioController);

const sessionSelector = new SessionSelector(
  document.getElementById('sessionSelectorContainer'),
  onSessionSelected
);

const driverPanel = new DriverPanel(
  document.getElementById('driverList'),
  document.getElementById('lapIndicator'),
  (driverNum) => toggleDriverTracking(driverNum)
);

function toggleDriverTracking(driverNum) {
  if (state.trackedDriver === driverNum) {
    state.trackedDriver = null;
    sceneManager.followKart(null);
  } else {
    state.trackedDriver = driverNum;
    const kart = state.karts.get(driverNum);
    if (kart) sceneManager.followKart(kart);
  }
  driverPanel.setTrackedDriver(state.trackedDriver);
}

window.addEventListener('track-pan-break', () => {
  if (state.trackedDriver !== null) {
    state.trackedDriver = null;
    driverPanel.setTrackedDriver(null);
  }
});

const playbackControls = new PlaybackControls(
  document.getElementById('playbackControls')
);

const raceInfo = new RaceInfo(
  document.getElementById('raceInfoBar'),
  document.getElementById('weatherWidget')
);

const garagePanel = new GaragePanel(
  'garagePanel',
  [],
  (kart) => {
    // On kart changed in garage
    if (sceneManager.garageMode) sceneManager.setGarageMode(true, kart);
  },
  () => {
    // On close garage
    sceneManager.setGarageMode(false);
    garagePanel.hide();
    document.getElementById('garageToggleBtn').classList.remove('active');
    document.getElementById('app').classList.remove('garage-active');
    setTimeout(() => sceneManager.resize(), 100);
  },
  (settings) => {
    // On studio settings change (Lights, Bloom, Base)
    sceneManager.updateStudioSettings(settings);
  }
);

/* ============================================
   Initialise
   ============================================ */
function init() {
  playbackControls.onPlay = () => {
    state.isPlaying = true;
    audioController.init();
  };
  playbackControls.onPause = () => { state.isPlaying = false; };
  playbackControls.onAudioToggle = (enabled) => {
    audioController.toggle(enabled);
  };
  playbackControls.onSeek = (val) => {
    state.currentRaceTime = val * state.raceDuration;
  };
  playbackControls.onSpeedChange = (speed) => { state.speed = speed; };

  createZoomControls();
  createQualityControls();
  createCacheIndicator();
  createGarageControls();

  requestAnimationFrame(renderLoop);
  drawWelcomeScreen();
}

function createZoomControls() {
  const container = document.getElementById('canvasContainer');
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'zoom-controls';
  controlsDiv.innerHTML = `
    <button id="zoomIn" title="Zoom In">+</button>
    <button id="zoomOut" title="Zoom Out">−</button>
    <button id="zoomReset" title="Reset View">⟲</button>
    <button id="camCycle" title="Cycle Camera (C)" style="margin-top: 8px; font-size: 1.2rem;">📹</button>
  `;
  container.appendChild(controlsDiv);

  document.getElementById('zoomIn').addEventListener('click', () => sceneManager.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => sceneManager.zoomOut());
  document.getElementById('zoomReset').addEventListener('click', () => sceneManager.resetView());
  document.getElementById('camCycle').addEventListener('click', () => sceneManager.cycleCameraMode());

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'c') {
      sceneManager.cycleCameraMode();
    }
  });

  document.getElementById('fullWindowToggle').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('full-window');
    setTimeout(() => sceneManager.resize(), 50);
  });
}

function createQualityControls() {
  const container = document.getElementById('canvasContainer');
  const div = document.createElement('div');
  div.className = 'quality-toggle';
  div.innerHTML = `
    <button data-q="low">Low</button>
    <button data-q="medium">Med</button>
    <button data-q="high" class="active">High</button>
  `;
  container.appendChild(div);

  div.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const q = btn.dataset.q;
    sceneManager.setQuality(q);
    div.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

function createCacheIndicator() {
  const container = document.getElementById('canvasContainer');
  const div = document.createElement('div');
  div.id = 'cacheIndicator';
  div.className = 'cache-indicator hidden';
  div.innerHTML = `
    <div class="cache-info">Telemetry Cache</div>
    <div class="cache-bar"><div id="cacheBarFill"></div></div>
    <div id="cachePercentage">0%</div>
  `;
  container.appendChild(div);
}

function drawWelcomeScreen() {
  // The 3D scene shows the empty environment as a "welcome" state
  // We can add a text sprite
}

function createGarageControls() {
  const btn = document.getElementById('garageToggleBtn');
  btn.addEventListener('click', () => {
    if (state.drivers.length === 0) {
      alert("Please select and load a Session from the top menu before entering the Garage!");
      return; 
    }
    
    if (sceneManager.garageMode) {
      sceneManager.setGarageMode(false);
      garagePanel.hide();
      btn.classList.remove('active');
    } else {
      // Pause game naturally
      if (playbackControls.isPlaying) {
        playbackControls.toggle();
      }
      
      const firstKart = state.karts.values().next().value;
      garagePanel.show(state.karts);
      sceneManager.setGarageMode(true, firstKart);
      btn.classList.add('active');
      document.getElementById('app').classList.add('garage-active');
      setTimeout(() => sceneManager.resize(), 100);
    }
  });
}


/* ============================================
   Session Loading
   ============================================ */
async function onSessionSelected(session) {
  state.session = session;
  showLoading(true);
  updateLoadProgress(5);

  try {
    const [drivers, positions, laps, stints, weather, raceControl, intervals, pitStops] =
      await Promise.all([
        api.getDrivers(session.session_key).catch(() => []),
        api.getPositions(session.session_key).catch(() => []),
        api.getLaps(session.session_key).catch(() => []),
        api.getStints(session.session_key).catch(() => []),
        api.getWeather(session.session_key).catch(() => []),
        api.getRaceControl(session.session_key).catch(() => []),
        api.getIntervals(session.session_key).catch(() => []),
        api.getPitStops(session.session_key).catch(() => []),
      ]);

    updateLoadProgress(40);

    state.drivers = drivers;
    state.positions = positions.sort((a, b) => new Date(a.date) - new Date(b.date));
    state.laps = laps;
    state.stints = stints;
    state.weather = weather.sort((a, b) => new Date(a.date) - new Date(b.date));
    state.raceControl = raceControl.sort((a, b) => new Date(a.date) - new Date(b.date));
    state.intervals = intervals.sort((a, b) => new Date(a.date) - new Date(b.date));
    state.pitStops = pitStops;

    updateLoadProgress(50);

    // --- Track Loading ---
    let trackPoints2D = [];
    let pitLanePoints2D = [];
    const matchedCircuit = findCircuit(session);

    if (matchedCircuit) {
      console.log(`✅ Matched circuit: ${matchedCircuit.name} (${matchedCircuit.id})`);
      state.matchedCircuit = matchedCircuit; // Store for render loop (poleSide, etc.)
      // Project lat/lng to 2D for the scene manager
      trackPoints2D = matchedCircuit.trackCoords.map(([lng, lat]) => projectLatLng(lng, lat));
      if (matchedCircuit.pitLane && matchedCircuit.pitLane.length > 2) {
        pitLanePoints2D = matchedCircuit.pitLane.map(([lng, lat]) => projectLatLng(lng, lat));
      }
      state.trackShape = matchedCircuit.trackCoords;
    } else {
      console.log('No circuit match in database — falling back to telemetry track shape');
      const firstDriver = drivers[0];
      if (firstDriver) {
        try {
          const driverLaps = laps
            .filter(l => l.driver_number === firstDriver.driver_number && l.date_start && l.lap_duration)
            .sort((a, b) => (a.lap_number || 0) - (b.lap_number || 0));

          let dateStart, dateEnd;
          if (driverLaps.length > 2) {
            const midLap = driverLaps[Math.floor(driverLaps.length / 2)];
            dateStart = midLap.date_start;
            const endTime = new Date(new Date(dateStart).getTime() + (midLap.lap_duration + 5) * 1000);
            dateEnd = endTime.toISOString();
          } else {
            dateStart = session.date_start;
            dateEnd = new Date(new Date(dateStart).getTime() + 120000).toISOString();
          }

          const locations = await api.getLocations(
            session.session_key, firstDriver.driver_number, dateStart, dateEnd
          );
          if (locations && locations.length > 20) {
            state.trackShape = locations;
            trackPoints2D = locations.map(p => ({ x: p.x, y: p.y }));
          } else {
            trackPoints2D = generateFallbackTrackPoints();
          }
        } catch (e) {
          console.warn('Could not load location data, generating fallback track:', e);
          trackPoints2D = generateFallbackTrackPoints();
        }
      } else {
        trackPoints2D = generateFallbackTrackPoints();
      }
    }

    // Set track data in scene manager and build 3D track
    sceneManager.setTrackData(trackPoints2D, pitLanePoints2D, matchedCircuit);
    track3D.build(sceneManager.trackPoints3D, sceneManager.pitLanePoints3D || [], matchedCircuit);
    miniMap.setTrackData(trackPoints2D, matchedCircuit);

    // Store 2D track data for fallback position calculations
    state.trackPoints2D = trackPoints2D;
    computeArcLengths(trackPoints2D);

    // Compute 3D world track length for distance-based stagger
    const pts3D = sceneManager.trackPoints3D;
    let worldTrackLen = 0;
    for (let i = 1; i < pts3D.length; i++) {
      const dx = pts3D[i].x - pts3D[i - 1].x;
      const dz = pts3D[i].z - pts3D[i - 1].z;
      worldTrackLen += Math.sqrt(dx * dx + dz * dz);
    }
    if (pts3D.length > 1) {
      const dx = pts3D[0].x - pts3D[pts3D.length - 1].x;
      const dz = pts3D[0].z - pts3D[pts3D.length - 1].z;
      worldTrackLen += Math.sqrt(dx * dx + dz * dz);
    }
    state.worldTrackLength = worldTrackLen;
    console.log(`[Grid] 3D world track length: ${worldTrackLen.toFixed(0)} units`);

    // Pre-compute 20 grid slot positions by walking backward along the track path.
    // This guarantees car positioning matches the Track3D grid markers exactly.
    state.gridSlots = [];
    for (let slot = 0; slot < 20; slot++) {
      const distance = 2 + slot * 8; // 2m base + 8m per slot — matches Track3D
      const pos = walkBackFromStart(pts3D, distance);
      state.gridSlots.push(pos);
    }
    console.log(`[Grid] Pre-computed ${state.gridSlots.length} grid slot positions`);

    updateLoadProgress(70);

    // Build timeline
    buildTimeline();
    buildDriverLapTimes();
    updateLoadProgress(80);

    // Create 3D karts
    await createKarts();
    updateLoadProgress(90);

    driverPanel.init(drivers);
    playbackControls.setTotalLaps(state.totalLaps);
    playbackControls.reset();

    if (weather.length > 0) {
      raceInfo.updateWeather(weather[0]);
    }

    updateLoadProgress(100);
    sceneManager.resize();

    // Start progressive location data fetching
    if (matchedCircuit && sceneManager.trackPoints3D.length > 0) {
      state.locationCache.destroy();
      state.locationCache = new LocationCache();
      // We need to pass 2D trackPoints (in the original projected coord space) for calibration
      state.locationCache.init(
        session.session_key,
        drivers,
        state.raceStartTime,
        state.raceEndTime,
        trackPoints2D
      ).then(() => {
        console.log(`[LocationCache] Initialised. Calibrated: ${state.locationCache.isCalibrated}`);
      }).catch(e => {
        console.warn('[LocationCache] Init failed:', e);
      });
    }

    setTimeout(() => {
      showLoading(false);
      sessionSelector.enableLoadButton();
    }, 400);

  } catch (err) {
    console.error('Failed to load session data:', err);
    showLoading(false);
    sessionSelector.enableLoadButton();
    alert('Failed to load session data. Please try another session.');
  }
}

function projectLatLng(lng, lat) {
  const DEG2RAD = Math.PI / 180;
  const R = 6378137;
  return {
    x: R * lng * DEG2RAD,
    y: R * Math.log(Math.tan(Math.PI / 4 + lat * DEG2RAD / 2)),
  };
}

function generateFallbackTrackPoints() {
  const points = [];
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: Math.cos(t) * 4000 + (Math.cos(t * 3) * 500),
      y: Math.sin(t) * 2500 + (Math.sin(t * 2) * 400),
    });
  }
  return points;
}

function computeArcLengths(points) {
  state.trackLengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    state.trackLengths.push(total);
  }
  if (points.length > 1) {
    const dx = points[0].x - points[points.length - 1].x;
    const dy = points[0].y - points[points.length - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  state.totalLength = total;
}

/**
 * Walk backward along a closed track path by a given distance.
 * Returns { x, z, angle } — same logic as Track3D._walkBackFromStart.
 * points[0] = start/finish, points[N-1] = last point before the line.
 */
function walkBackFromStart(points, distance) {
  let remaining = distance;
  for (let step = 0; step < points.length; step++) {
    const fromIdx = (points.length - step) % points.length;
    const toIdx   = (points.length - step - 1) % points.length;
    const dx = points[toIdx].x - points[fromIdx].x;
    const dz = points[toIdx].z - points[fromIdx].z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (remaining <= segLen && segLen > 0) {
      const t = remaining / segLen;
      const fwdAngle = Math.atan2(
        points[fromIdx].x - points[toIdx].x,
        points[fromIdx].z - points[toIdx].z
      );
      return {
        x: points[fromIdx].x + dx * t,
        z: points[fromIdx].z + dz * t,
        angle: fwdAngle,
      };
    }
    remaining -= segLen;
  }
  return { x: points[0].x, z: points[0].z, angle: 0 };
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}
function updateLoadProgress(pct) {
  loaderFill.style.width = pct + '%';
}

/* ============================================
   Timeline & Data Processing
   ============================================ */
function buildTimeline() {
  if (state.drivers.length === 0) return;
  const maxLap = state.laps.reduce((max, l) => Math.max(max, l.lap_number || 0), 0);
  state.totalLaps = maxLap || (state.drivers.length > 0 ? 1 : 0);
  state.currentLap = 0;

  let earliestLapStart = Infinity;
  let latestLapEnd = 0;

  for (const l of state.laps) {
    if (l.date_start) {
      const time = new Date(l.date_start).getTime();
      if ((l.lap_number === 1 || l.lap_number === 0) && time < earliestLapStart) {
        earliestLapStart = time;
      }
      if (l.lap_duration) {
        const endTime = time + (l.lap_duration * 1000);
        if (endTime > latestLapEnd) latestLapEnd = endTime;
      }
    }
  }

  let fallbackStart = 0, fallbackEnd = 0;
  if (state.positions.length > 0) {
    fallbackStart = new Date(state.positions[0].date).getTime();
    fallbackEnd = new Date(state.positions[state.positions.length - 1].date).getTime();
  }

  state.raceStartTime = earliestLapStart !== Infinity
    ? earliestLapStart - 5000
    : (fallbackStart !== 0 ? fallbackStart : (state.session ? new Date(state.session.date_start).getTime() : Date.now()));

  state.raceEndTime = latestLapEnd !== 0
    ? latestLapEnd + 10000
    : (fallbackEnd !== 0 ? fallbackEnd : state.raceStartTime + (2 * 60 * 60 * 1000));

  state.raceDuration = state.raceEndTime - state.raceStartTime;
  state.currentRaceTime = 0;
  state.lastPositionMap.clear();
  state.fastestLapTime = Infinity;
  state.fastestLapDriver = null;
  state.detectedEvents.clear();
}

function buildDriverLapTimes() {
  state.driverLapTimes.clear();
  const byDriver = new Map();
  for (const l of state.laps) {
    const num = l.driver_number;
    if (!byDriver.has(num)) byDriver.set(num, []);
    byDriver.get(num).push(l);
  }

  byDriver.forEach((laps, driverNum) => {
    laps.sort((a, b) => (a.lap_number || 0) - (b.lap_number || 0));
    const timing = [];
    for (const l of laps) {
      const lapNum = l.lap_number || 0;
      const duration = l.lap_duration || null;
      const startTime = l.date_start ? new Date(l.date_start).getTime() : null;

      if (startTime !== null && duration !== null) {
        timing.push({
          lap: lapNum,
          startTime: startTime - state.raceStartTime,
          endTime: startTime - state.raceStartTime + duration * 1000,
          duration: duration * 1000,
        });
      } else if (startTime !== null) {
        timing.push({
          lap: lapNum,
          startTime: startTime - state.raceStartTime,
          endTime: startTime - state.raceStartTime + 90000,
          duration: 90000,
        });
      }
    }
    state.driverLapTimes.set(driverNum, timing);
  });
}

async function createKarts() {
  // Dispose old karts
  for (const kart of state.karts.values()) kart.dispose();
  state.karts.clear();
  sceneManager.karts.clear();

  // Try to preload the GLB model (non-blocking — falls back to procedural)
  if (!isModelLoaded()) {
    try {
      await preloadCarModel();
      console.log('[main] GLB model loaded — using 3D model for all karts');
    } catch (e) {
      console.warn('[main] GLB model failed to load, using procedural karts:', e);
    }
  }

  const year = state.session ? (state.session.year || 2026) : 2026;
  state.drivers.forEach(d => {
    const color = getTeamColor(d.team_name, year);
    const kart = new Kart3D(d, color, sceneManager.scene, year);
    state.karts.set(d.driver_number, kart);
    sceneManager.karts.set(d.driver_number, kart);
  });
}

/* ============================================
   Position & Progress
   ============================================ */
function getPositionSnapshot(raceTimeMs) {
  if (state.drivers.length === 0) return new Map();
  const currentEpoch = state.raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();
  const snapshot = new Map();

  for (const p of state.positions) {
    if (p.date > currentTimeStr) break;
    snapshot.set(p.driver_number, { position: p.position, date: p.date });
  }

  state.drivers.forEach((driver, index) => {
    if (!snapshot.has(driver.driver_number)) {
      const firstEver = state.positions.find(p => p.driver_number === driver.driver_number);
      snapshot.set(driver.driver_number, {
        position: firstEver ? firstEver.position : (index + 1),
        date: firstEver ? firstEver.date : currentTimeStr,
      });
    }
  });

  const intervalSnapshot = new Map();
  for (const iv of state.intervals) {
    if (iv.date > currentTimeStr) break;
    intervalSnapshot.set(iv.driver_number, iv);
  }

  const stintSnapshot = new Map();
  const activeLap = state.currentLap === 0 ? 1 : state.currentLap;
  for (const s of state.stints) {
    const lapStart = s.lap_start || 0;
    const lapEnd = s.lap_end || 999;
    if (activeLap >= lapStart && activeLap <= lapEnd) {
      stintSnapshot.set(s.driver_number, s);
    }
  }

  const result = new Map();
  snapshot.forEach((data, driverNum) => {
    const interval = intervalSnapshot.get(driverNum);
    const stint = stintSnapshot.get(driverNum);
    let gap = '-';
    if (interval) {
      if (interval.gap_to_leader !== null && interval.gap_to_leader !== undefined) {
        gap = data.position === 1 ? 'Leader' : `+${Number(interval.gap_to_leader).toFixed(1)}s`;
      } else if (interval.interval !== null && interval.interval !== undefined) {
        gap = `+${Number(interval.interval).toFixed(1)}s`;
      }
    }
    result.set(driverNum, {
      position: data.position,
      gap,
      intervalValue: interval ? (interval.gap_to_leader || interval.interval || 999) : 999,
      tireCompound: stint?.compound || '',
    });
  });

  return result;
}

function getDriverTrackProgress(driverNum, raceTimeMs, position, totalDrivers) {
  const lapTimes = state.driverLapTimes.get(driverNum);
  if (lapTimes && lapTimes.length > 0) {
    let currentLapData = null;
    let currentLapNum = 0;
    for (const lt of lapTimes) {
      if (raceTimeMs >= lt.startTime && raceTimeMs < lt.endTime) {
        currentLapData = lt; currentLapNum = lt.lap; break;
      }
      if (raceTimeMs >= lt.startTime) {
        currentLapData = lt; currentLapNum = lt.lap;
      }
    }
    if (currentLapData) {
      const lapProgress = Math.min(1, Math.max(0,
        (raceTimeMs - currentLapData.startTime) / currentLapData.duration));
      const totalProgress = state.totalLaps > 0
        ? ((currentLapNum - 1 + lapProgress) / state.totalLaps) : lapProgress;
      const staggerDistance = 2 + (position - 1) * 8; // Match Track3D: 2m base + 8m per slot
      const staggerFraction = state.worldTrackLength > 0 ? (staggerDistance / state.worldTrackLength) : 0;
      return (totalProgress - staggerFraction + 10) % 1;
    }
  }
  const linearProgress = state.raceDuration > 0 ? raceTimeMs / state.raceDuration : 0;
  const staggerDistance = 2 + (position - 1) * 8;
  const staggerFraction = state.worldTrackLength > 0 ? (staggerDistance / state.worldTrackLength) : 0;
  return ((linearProgress - staggerFraction) + 10) % 1;
}

function getCurrentLap(raceTimeMs) {
  if (state.laps.length === 0) return 0;
  const currentEpoch = state.raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();
  let lap = 0;
  for (const l of state.laps) {
    if (l.date_start && l.date_start <= currentTimeStr) {
      lap = Math.max(lap, l.lap_number || 0);
    }
  }
  return lap;
}

function getWeatherAtTime(raceTimeMs) {
  if (state.weather.length === 0) return null;
  const currentTimeStr = new Date(state.raceStartTime + raceTimeMs).toISOString();
  let w = state.weather[0];
  for (const ww of state.weather) {
    if (ww.date <= currentTimeStr) w = ww; else break;
  }
  return w;
}

function getRaceControlAtTime(raceTimeMs) {
  if (state.raceControl.length === 0) return null;
  const currentTimeStr = new Date(state.raceStartTime + raceTimeMs).toISOString();
  let latest = null;
  for (const rc of state.raceControl) {
    if (rc.date <= currentTimeStr) latest = rc; else break;
  }
  return latest;
}

/* ============================================
   Event Detection — Triggers Mario Kart effects
   ============================================ */
function detectEvents(posSnapshot, raceTimeMs) {
  const timeBucket = Math.floor(raceTimeMs / 1000);
  const eventKey = (type, extra) => `${type}:${extra}:${timeBucket}`;

  posSnapshot.forEach((data, driverNum) => {
    const kart = state.karts.get(driverNum);
    if (!kart) return;
    const prevPos = state.lastPositionMap.get(driverNum);

    // Overtake
    if (prevPos !== undefined && data.position < prevPos) {
      const key = eventKey('overtake', driverNum);
      if (!state.detectedEvents.has(key)) {
        state.detectedEvents.add(key);
        let overtakenDriver = '';
        posSnapshot.forEach((d2, num2) => {
          if (num2 !== driverNum && d2.position === data.position + 1) {
            const k2 = state.karts.get(num2);
            overtakenDriver = k2?.abbreviation || '';
          }
        });
        // Emit 3D particles at kart position
        particles3D.emitBoost(
          kart.mesh.position.x, kart.mesh.position.y,
          kart.mesh.position.z, kart.teamColor, 20
        );
        particles3D.emitSpotlight(
          kart.mesh.position.x, kart.mesh.position.y,
          kart.mesh.position.z, '#ff8000'
        );
        marioEffects.trigger(EFFECT_TYPES.OVERTAKE, {
          driver1: kart.abbreviation, driver2: overtakenDriver,
          cx: 0, cy: 0, color: kart.teamColor, lap: state.currentLap,
        });
      }
    }

    // Poke
    const intervalVal = data.intervalValue || 999;
    if (intervalVal < 0.5 && data.position > 1) {
      const pokeBucket = Math.floor(raceTimeMs / 3000);
      const pokeKey = `poke:${driverNum}:${pokeBucket}`;
      if (!state.detectedEvents.has(pokeKey)) {
        state.detectedEvents.add(pokeKey);
        particles3D.emitSpotlight(
          kart.mesh.position.x, kart.mesh.position.y,
          kart.mesh.position.z, '#ff0000'
        );
        marioEffects.trigger(EFFECT_TYPES.POKE, {
          driver: kart.abbreviation, cx: 0, cy: 0, lap: state.currentLap,
        });
      }
    }

    // Banana defense
    const prevInterval = state.lastIntervalMap.get(driverNum) || 999;
    if (prevInterval < 1.0 && intervalVal >= 1.0 && data.position > 1) {
      const defenseKey = `defense:${driverNum}:${timeBucket}`;
      if (!state.detectedEvents.has(defenseKey)) {
        state.detectedEvents.add(defenseKey);
        for (const [num2, d2] of posSnapshot.entries()) {
          if (d2.position === data.position - 1) {
            const aheadKart = state.karts.get(num2);
            if (aheadKart) {
              marioEffects.trigger(EFFECT_TYPES.YELLOW_FLAG, {
                cx: 0, cy: 0, lap: state.currentLap,
              });
            }
            break;
          }
        }
      }
    }

    state.lastPositionMap.set(driverNum, data.position);
    state.lastIntervalMap.set(driverNum, intervalVal);
  });

  // Retirement
  state.drivers.forEach(d => {
    const num = d.driver_number;
    const wasPresent = state.lastPositionMap.has(num);
    const isNowMissing = wasPresent && !posSnapshot.has(num);
    if (isNowMissing) {
      const key = `retire:${num}`;
      if (!state.detectedEvents.has(key)) {
        state.detectedEvents.add(key);
        const kart = state.karts.get(num);
        if (kart) {
          particles3D.emitExplosion(
            kart.mesh.position.x, kart.mesh.position.y,
            kart.mesh.position.z, 40
          );
        }
        marioEffects.trigger(EFFECT_TYPES.RETIREMENT, {
          driver: kart?.abbreviation || num,
          sprite: kart, cx: 0, cy: 0, lap: state.currentLap,
        });
      }
    }
  });

  // Fastest lap
  const lap = getCurrentLap(raceTimeMs);
  if (lap !== state.currentLap) {
    state.currentLap = lap;
    for (const l of state.laps) {
      if (l.lap_number === lap - 1 && l.lap_duration) {
        if (l.lap_duration < state.fastestLapTime) {
          state.fastestLapTime = l.lap_duration;
          const key = eventKey('fastest', l.driver_number);
          if (!state.detectedEvents.has(key)) {
            state.detectedEvents.add(key);
            const kart = state.karts.get(l.driver_number);
            if (kart) {
              kart.hasStar = true;
              kart.starTimer = 180;
              particles3D.emitStarSparkle(
                kart.mesh.position.x, kart.mesh.position.y,
                kart.mesh.position.z
              );
              marioEffects.trigger(EFFECT_TYPES.FASTEST_LAP, {
                driver: kart.abbreviation, sprite: kart,
                cx: 0, cy: 0, lap: state.currentLap,
              });
            }
          }
        }
      }
    }
  }

  // Race control
  const rc = getRaceControlAtTime(raceTimeMs);
  if (rc) {
    const rcKey = `rc:${rc.date}`;
    if (!state.detectedEvents.has(rcKey)) {
      state.detectedEvents.add(rcKey);
      raceInfo.addRaceControlMessage(rc);
      const msg = (rc.message || '').toUpperCase();
      const flag = (rc.flag || '').toUpperCase();
      if (flag === 'RED' || msg.includes('RED FLAG')) {
        marioEffects.trigger(EFFECT_TYPES.RED_FLAG, { lap: state.currentLap });
      } else if (flag === 'YELLOW' || msg.includes('YELLOW')) {
        marioEffects.trigger(EFFECT_TYPES.YELLOW_FLAG, { cx: 0, cy: 0, lap: state.currentLap });
      }
      if (msg.includes('SAFETY CAR') && !msg.includes('VIRTUAL')) {
        marioEffects.trigger(EFFECT_TYPES.SAFETY_CAR, { canvasWidth: 0, canvasHeight: 0, lap: state.currentLap });
      }
      if (rc.status) raceInfo.updateTrackStatus(rc.status);
    }
  }

  // Rain
  const weather = getWeatherAtTime(raceTimeMs);
  if (weather) {
    if (weather.rainfall && weather.rainfall > 0 && !marioEffects.isRaining) {
      marioEffects.trigger(EFFECT_TYPES.RAIN, { lap: state.currentLap });
      environment3D.setRaining(true);
    } else if ((!weather.rainfall || weather.rainfall === 0) && marioEffects.isRaining) {
      marioEffects.stopRain();
      environment3D.setRaining(false);
    }
    raceInfo.updateWeather(weather);
  }

  // Race finish
  if (state.currentLap === state.totalLaps && state.totalLaps > 0) {
    const key = 'finish';
    if (!state.detectedEvents.has(key)) {
      state.detectedEvents.add(key);
      const winner = [...posSnapshot.entries()].find(([, d]) => d.position === 1);
      const winnerKart = winner ? state.karts.get(winner[0]) : null;
      particles3D.emitConfetti(sceneManager.trackBounds, 80);
      setTimeout(() => particles3D.emitConfetti(sceneManager.trackBounds, 60), 500);
      setTimeout(() => particles3D.emitConfetti(sceneManager.trackBounds, 40), 1000);
      marioEffects.trigger(EFFECT_TYPES.RACE_FINISH, {
        driver: winnerKart?.abbreviation || '???',
        canvasWidth: 0, lap: state.totalLaps,
      });
    }
  }
}

/* ============================================
   Render Loop — TIME-BASED playback
   ============================================ */
let lastTimestamp = 0;
let smoothedDelta = 16.66; // Assume 60fps start

function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  const rawDt = (lastTimestamp > 0) ? (timestamp - lastTimestamp) : 16.66;
  lastTimestamp = timestamp;

  // Smooth the clock to prevent sampling jitter (Low-pass filter)
  // Adaptive factor 0.2 (0.8/0.2) to quickly lock onto 144Hz/240Hz monitors
  smoothedDelta = (smoothedDelta * 0.8) + (Math.min(rawDt, 100) * 0.2);

  // Advance race time using smoothed clock
  if (state.isPlaying && state.raceDuration > 0) {
    state.currentRaceTime += smoothedDelta * state.speed;
    if (state.currentRaceTime >= state.raceDuration) {
      state.currentRaceTime = state.raceDuration;
      state.isPlaying = false;
      playbackControls.isPlaying = false;
      playbackControls.playBtn.textContent = '▶';
    }
  }

  // Update Cache indicator
  const cacheIndicator = document.getElementById('cacheIndicator');
  if (state.locationCache && state.locationCache.sessionKey) {
    cacheIndicator.classList.remove('hidden');
    const pct = Math.round(state.locationCache.fetchProgress * 100);
    const fill = document.getElementById('cacheBarFill');
    const text = document.getElementById('cachePercentage');
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.innerText = `${pct}%`;
    
    if (pct >= 100) {
      setTimeout(() => cacheIndicator.classList.add('cached'), 500);
    } else {
      cacheIndicator.classList.remove('cached');
    }
  } else {
    cacheIndicator.classList.add('hidden');
  }

  // Get position snapshot
  const posSnapshot = getPositionSnapshot(state.currentRaceTime);

  // Detect events
  if (state.raceDuration > 0) {
    detectEvents(posSnapshot, state.currentRaceTime);
  }

  // === F1 START LIGHTS LOGIC ===
  if (sceneManager.track3D && sceneManager.track3D.setStartLights) {
    // Simulate a 5-second countdown to Lights Out at T=0
    // T-5s: 1 light, T-4s: 2 lights, ..., T-1s: 5 lights, T=0: OFF
    if (state.currentRaceTime < 0 && state.currentRaceTime > -5000) {
      const lightsCount = Math.floor(Math.abs(state.currentRaceTime) / 1000);
      sceneManager.track3D.setStartLights(6 - lightsCount); // 1 to 5
    } else {
      sceneManager.track3D.setStartLights(0);
    }
  }

  // Update kart positions
  if (sceneManager.trackPoints3D.length > 0 && posSnapshot.size > 0 && !sceneManager.garageMode) {
    const totalDrivers = posSnapshot.size;
    const currentEpoch = state.raceStartTime + state.currentRaceTime;
    const cache = state.locationCache;
    const useRealPos = cache.isCalibrated && cache.hasDataAt(currentEpoch);

    posSnapshot.forEach((data, driverNum) => {
      const kart = state.karts.get(driverNum);
      if (!kart) return;

      kart.position = data.position;
      kart.gap = data.gap;
      kart.tireCompound = data.tireCompound;

      // Exact pit detection
      let isPittingExact = false;
      if (state.pitStops) {
        for (const p of state.pitStops) {
          if (p.driver_number === driverNum) {
            const pitStart = new Date(p.date).getTime();
            const pitEnd = pitStart + (p.pit_duration * 1000);
            if (currentEpoch >= pitStart && currentEpoch <= pitEnd) {
              isPittingExact = true; break;
            }
          }
        }
      }
      kart.isPitting = isPittingExact;
      if (kart.isPitting) { kart.gap = 'PIT'; data.gap = 'PIT'; }

      // Try real position data
      if (useRealPos) {
        const realPos = cache.getDriverPosition(driverNum, currentEpoch);
        if (realPos) {
          // Calculate expected chronological progress to constrain spatial search
          const progress = getDriverTrackProgress(driverNum, state.currentRaceTime, data.position, totalDrivers);
          
          // Pass the kart's expected progress so the nearest-neighbor search doesn't mistakenly jump to a bridge/underpass
          let world = sceneManager.toWorldCoords(realPos.x, realPos.y, kart._currentPos.y, progress);
          
          // Stable orientation from dual-sampling tangent (Current + Look-ahead)
          const tangentCurrent = cache.getDriverTangent(driverNum, currentEpoch);
          const tangentFuture = cache.getDriverTangent(driverNum, currentEpoch + 250); // 250ms look-ahead
          
          let angle = kart.currentAngle;
          if (tangentCurrent && tangentFuture) {
            const tx = (tangentCurrent.x + tangentFuture.x) * 0.5;
            const ty = (tangentCurrent.y + tangentFuture.y) * 0.5;
            angle = Math.atan2(tx, -ty);
          } else if (tangentCurrent) {
            angle = Math.atan2(tangentCurrent.x, -tangentCurrent.y);
          }

          // === PERFECT GRID STAGGER LOGIC ===
          // Blend GPS position toward pre-computed grid slot during start phase
          const gridWeight = Math.max(0, 1 - (state.currentRaceTime / 5000));
          if (gridWeight > 0 && state.gridSlots && data.position >= 1 && data.position <= 20) {
            const slot = state.gridSlots[data.position - 1];
            const mc = state.matchedCircuit;
            const isPoleRight = !mc || (mc.poleSide !== 'left');
            const isRightSlot = (data.position % 2 === 1) ? isPoleRight : !isPoleRight;
            const rX = Math.cos(slot.angle);
            const rZ = -Math.sin(slot.angle);
            const gridX = slot.x + rX * (isRightSlot ? 4.0 : -4.0);
            const gridZ = slot.z + rZ * (isRightSlot ? 4.0 : -4.0);
            world.x = world.x * (1 - gridWeight) + gridX * gridWeight;
            world.z = world.z * (1 - gridWeight) + gridZ * gridWeight;
          }

          // Direct speed from spline derivative
          const s = cache.getDriverSpeed(driverNum, currentEpoch);
          kart.speed = (kart.speed * 0.8) + (s * 0.2); // Light smoothing

          kart.updatePosition(world.x, world.y, world.z, angle, world.pitch);
          kart.progress = 0;

          // Star sparkle
          if (kart.hasStar) {
            particles3D.emitStarSparkle(world.x, 0, world.z);
          }
          return;
        }
      }

      // Fallback: lap-timing interpolation
      const progress = getDriverTrackProgress(
        driverNum, state.currentRaceTime, data.position, totalDrivers
      );
      const pos3D = sceneManager.getPositionOnTrack(progress);
      
      // === GRID STAGGER FOR INTERPOLATION PATH ===
      // Blend interpolation position toward pre-computed grid slot during start phase
      const gridWeight = Math.max(0, 1 - (state.currentRaceTime / 5000));
      if (gridWeight > 0 && state.gridSlots && data.position >= 1 && data.position <= 20) {
        const slot = state.gridSlots[data.position - 1];
        const mc = state.matchedCircuit;
        const isPoleRight = !mc || (mc.poleSide !== 'left');
        const isRightSlot = (data.position % 2 === 1) ? isPoleRight : !isPoleRight;
        const rX = Math.cos(slot.angle);
        const rZ = -Math.sin(slot.angle);
        const gridX = slot.x + rX * (isRightSlot ? 4.0 : -4.0);
        const gridZ = slot.z + rZ * (isRightSlot ? 4.0 : -4.0);
        pos3D.x = pos3D.x * (1 - gridWeight) + gridX * gridWeight;
        pos3D.z = pos3D.z * (1 - gridWeight) + gridZ * gridWeight;
        pos3D.angle = pos3D.angle * (1 - gridWeight) + slot.angle * gridWeight;
      }

      kart.updatePosition(pos3D.x, pos3D.y, pos3D.z, pos3D.angle, pos3D.pitch);
      kart.progress = progress;

      // Speed calc
      const dProgress = Math.abs(progress - (kart._prevProgress || 0));
      if (dProgress < 0.5 && smoothedDelta > 0) {
        const dtSec = (smoothedDelta * state.speed) / 1000;
        const trackLenKm = 5;
        kart.speed = (dProgress * trackLenKm) / (dtSec / 3600);
      }
      kart._prevProgress = progress;

      // Star sparkle
      if (kart.hasStar) {
        particles3D.emitStarSparkle(pos3D.x, pos3D.y, pos3D.z);
      }

      // Mushroom boost heuristic
      const speedKmh = kart.speed || 0;
      const prevSpeed = kart._prevSpeed || 0;
      kart.hasMushroom = speedKmh > 315 || (speedKmh > 200 && speedKmh > prevSpeed * 1.05);
      kart._prevSpeed = speedKmh;

    });

    // === DYNAMIC 'SIDE-BY-SIDE' RACING SYSTEM (V2: Persistent Virtual Lanes) ===
    // Prevents clipping and ghosting by anticipating overtakes and maintaining safety corridors.
    const activeKarts = Array.from(state.karts.values()).filter(k => k.mesh.visible);
    
    // Reset accumulation for this frame's force calculation
    for (const k of activeKarts) k.targetLateralOffset = 0;

    for (let i = 0; i < activeKarts.length; i++) {
        for (let j = i + 1; j < activeKarts.length; j++) {
            const kA = activeKarts[i];
            const kB = activeKarts[j];
            
            const dx = kB._targetPos.x - kA._targetPos.x;
            const dz = kB._targetPos.z - kA._targetPos.z;
            const distSq = dx * dx + dz * dz;
            
            // Reach out to 22m for anticipation (F1 cars are ~5.5m long)
            const range = 22.0;
            if (distSq < range * range && distSq > 0.001) {
                const dist = Math.sqrt(distSq);
                
                // Track orientation
                const forward = { x: Math.sin(kA.currentAngle), z: Math.cos(kA.currentAngle) };
                const right = { x: Math.cos(kA.currentAngle), z: -Math.sin(kA.currentAngle) };
                
                // Project delta into Track Space
                const dotRight = (dx * right.x) + (dz * right.z);
                const dotForward = (dx * forward.x) + (dz * forward.z);
                const absF = Math.abs(dotForward);
                const absR = Math.abs(dotRight);

                // Skip if they are extremely far apart longitudinally (drafting range)
                if (absF > 15.0) continue;

                // ANTICIPATION WEIGHT: Increase pressure as they get closer longitudinally
                // If F is near 0 (perfectly side-by-side), weight is 1.0. At F=15, weight is ~0.
                const fWeight = Math.max(0, 1.0 - (absF / 15.0));

                // LATERAL SEPARATION:
                // Dampen collision avoidance during grid phase to let staggered positions settle
                const gridWeight = Math.max(0, 1 - (state.currentRaceTime / 5000));
                const idealGap = 3.8;
                if (absR < idealGap) {
                    const overlap = idealGap - absR;
                    const push = overlap * 0.4 * fWeight * (1.0 - gridWeight * 0.8); 
                    const direction = dotRight > 0 ? 1 : -1;
                    
                    // Additive force
                    kA.targetLateralOffset -= direction * push;
                    kB.targetLateralOffset += direction * push;
                }
            }
        }
    }

    // Clamp offsets and slowly bleed back to racing line (0) if no neighbors present
    // Note: k.targetLateralOffset is NOT reset per frame anymore.
    // It's already decayed by the lerp in Kart3D.js
    const tarmacLimit = (track3D.trackWidth / 2) - 1.5; 
    for (const k of activeKarts) {
        k.targetLateralOffset = Math.max(-tarmacLimit, Math.min(tarmacLimit, k.targetLateralOffset));
        // Reset per-frame accumulation after k.update() has used it? 
        // No, let's keep it and let the force sum up.
        // Actually we need to reset the ACCUMULATION but not the target.
    }
  }

  // Update all karts (animation, trail, effects)
  for (const kart of state.karts.values()) {
    kart.update(timestamp);
  }

  // Update particles
  particles3D.update();

  // Update environment
  environment3D.update(timestamp);

  // Update Mario DOM effects
  marioEffects.update(container3D.clientWidth, container3D.clientHeight);

  // Render 3D scene
  sceneManager.render(timestamp);

  // Update MiniMap
  miniMap.update(state.karts, state.trackedDriver);

  // Update UI
  if (state.raceDuration > 0 && !sceneManager.garageMode) {
    const lap = getCurrentLap(state.currentRaceTime);
    state.currentLap = lap;

    driverPanel.update(posSnapshot);
    driverPanel.updateLap(state.currentLap, state.totalLaps);
    playbackControls.setProgress(
      state.currentRaceTime / Math.max(1, state.raceDuration),
      state.currentLap
    );

    // Audio engine
    if (state.trackedDriver) {
      const trackedKart = state.karts.get(state.trackedDriver);
      if (trackedKart) {
        const lastSpeed = trackedKart.lastSpeed ?? trackedKart.speed;
        const deltaSpeed = trackedKart.speed - lastSpeed;
        trackedKart.lastSpeed = trackedKart.speed;
        audioController.updateEngine(trackedKart.speed, deltaSpeed, state.isPlaying);
      }
    } else {
      audioController.updateEngine(0, 0, false);
    }
  }
}

/* ============================================
   Start
   ============================================ */
showLoading(false);
init();
