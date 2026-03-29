/**
 * F1 Mario Kart Visualiser — Main Entry Point
 * Orchestrates data loading, timeline playback, rendering, and Mario Kart effects.
 *
 * Key design decisions for correctness:
 * - Playback is TIME-BASED: 1x speed = 1 second of race per 1 second real time
 * - Driver positions use per-driver lap-time interpolation from the laps API
 * - Track shape is extracted as a single clean lap from location data
 */

import { TrackRenderer } from './renderer/TrackRenderer.js';
import { DriverSprite, getTeamColor } from './renderer/DriverSprite.js';
import { ParticleSystem } from './renderer/ParticleSystem.js';
import { MarioEffects, EFFECT_TYPES } from './renderer/MarioEffects.js';
import { SessionSelector } from './components/SessionSelector.js';
import { DriverPanel } from './components/DriverPanel.js';
import { PlaybackControls } from './components/PlaybackControls.js';
import { RaceInfo } from './components/RaceInfo.js';
import * as api from './api/openf1.js';
import { findCircuit } from './data/circuitData.js';
import { LocationCache } from './data/LocationCache.js';

/* ============================================
   Global State
   ============================================ */
const state = {
  session: null,
  drivers: [],
  positions: [],          // sorted position records [{ date, driver_number, position }]
  laps: [],               // lap records from API
  stints: [],
  weather: [],
  raceControl: [],
  intervals: [],
  pitStops: [],

  // Per-driver lap timing: Map<driverNumber, [{lap, startTime, endTime, duration}]>
  driverLapTimes: new Map(),

  // Race timeline (time-based)
  raceStartTime: 0,       // epoch ms of first position record
  raceEndTime: 0,          // epoch ms of last position record
  raceDuration: 0,         // total race duration in ms
  currentRaceTime: 0,      // current playback time offset from raceStartTime (ms)

  isPlaying: false,
  speed: 1,
  totalLaps: 0,
  currentLap: 0,

  // Sprites
  sprites: new Map(),     // driverNumber -> DriverSprite

  // Track shape from first driver's location data
  trackShape: [],

  // Location cache for real car positions
  locationCache: new LocationCache(),

  // Event detection
  lastPositionMap: new Map(),
  fastestLapTime: Infinity,
  fastestLapDriver: null,
  detectedEvents: new Set(),
  trackedDriver: null,
};

/* ============================================
   DOM References
   ============================================ */
const canvas = document.getElementById('raceTrack');
const overlay = document.getElementById('effectOverlay');
const loadingOverlay = document.getElementById('loadingOverlay');
const loaderFill = document.getElementById('loaderFill');
const eventFeed = document.getElementById('eventFeed');

/* ============================================
   Core Systems
   ============================================ */
const trackRenderer = new TrackRenderer(canvas);
const particles = new ParticleSystem();
const marioEffects = new MarioEffects(overlay, particles, eventFeed);

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
    trackRenderer.trackingX = null;
    trackRenderer.trackingY = null;
  } else {
    state.trackedDriver = driverNum;
    // Auto-zoom in slightly if we aren't already
    if (trackRenderer.zoom < 2.5) trackRenderer.zoom = 2.5;
  }
  driverPanel.setTrackedDriver(state.trackedDriver);
  
  // Clear all cached sprite trails because sudden zoom/panning breaks point coherence
  for (const sprite of state.sprites.values()) {
    sprite.trail = [];
  }
}

// Clear tracking if user manually drags canvas
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

/* ============================================
   Initialise
   ============================================ */
function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  playbackControls.onPlay = () => { state.isPlaying = true; };
  playbackControls.onPause = () => { state.isPlaying = false; };
  playbackControls.onSeek = (val) => {
    state.currentRaceTime = val * state.raceDuration;
  };
  playbackControls.onSpeedChange = (speed) => { state.speed = speed; };

  // Zoom controls
  createZoomControls();

  requestAnimationFrame(renderLoop);
  drawWelcomeScreen();
}

/** Create zoom +/- and reset buttons overlaid on the canvas container */
function createZoomControls() {
  const container = document.getElementById('canvasContainer');
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'zoom-controls';
  controlsDiv.innerHTML = `
    <button id="zoomIn" title="Zoom In">+</button>
    <button id="zoomOut" title="Zoom Out">−</button>
    <button id="zoomReset" title="Reset View">⟲</button>
  `;
  container.appendChild(controlsDiv);

  document.getElementById('zoomIn').addEventListener('click', () => trackRenderer.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => trackRenderer.zoomOut());
  document.getElementById('zoomReset').addEventListener('click', () => trackRenderer.resetView());

  document.getElementById('fullWindowToggle').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('full-window');
    setTimeout(() => resizeCanvas(), 50); // Small delay to let CSS transition finish
  });
}

function resizeCanvas() {
  trackRenderer.resize();
}

function drawWelcomeScreen() {
  const ctx = trackRenderer.ctx;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.fillStyle = '#0f0f14';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.font = '800 2.5rem "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('🏎️  F1 Mario Kart Visualiser', w / 2, h / 2 - 30);

  ctx.font = '400 1rem "Outfit", sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('Select a year, meeting, and session above to begin', w / 2, h / 2 + 20);
  ctx.fillText('Powered by OpenF1 API', w / 2, h / 2 + 50);
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
        api.getDrivers(session.session_key),
        api.getPositions(session.session_key),
        api.getLaps(session.session_key),
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

    // --- Track Loading: Try circuit database first, then fallback to telemetry ---
    const matchedCircuit = findCircuit(session);
    if (matchedCircuit) {
      console.log(`✅ Matched circuit: ${matchedCircuit.name} (${matchedCircuit.id})`);
      trackRenderer.setCircuitData(matchedCircuit);
      state.trackShape = matchedCircuit.trackCoords;
    } else {
      // Fallback: fetch location data from OpenF1 API for one lap
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

          console.log(`Fetching track shape for driver ${firstDriver.driver_number} from ${dateStart} to ${dateEnd}`);
          const locations = await api.getLocations(
            session.session_key, firstDriver.driver_number, dateStart, dateEnd
          );
          if (locations && locations.length > 20) {
            state.trackShape = locations;
            trackRenderer.setTrackData(locations);
            console.log(`Track shape loaded: ${locations.length} points`);
          } else {
            console.warn('Insufficient location data, using fallback track');
            generateFallbackTrack();
          }
        } catch (e) {
          console.warn('Could not load location data, generating fallback track:', e);
          generateFallbackTrack();
        }
      } else {
        generateFallbackTrack();
      }
    }

    updateLoadProgress(70);

    // Build timeline from actual timestamps
    buildTimeline();
    buildDriverLapTimes();
    updateLoadProgress(80);

    createSprites();
    updateLoadProgress(90);

    driverPanel.init(drivers);
    playbackControls.setTotalLaps(state.totalLaps);
    playbackControls.reset();

    if (weather.length > 0) {
      raceInfo.updateWeather(weather[0]);
    }

    updateLoadProgress(100);

    resizeCanvas();
    trackRenderer.resize();

    // Start progressive location data fetching (only for matched circuits)
    if (matchedCircuit && trackRenderer.trackPoints.length > 0) {
      state.locationCache.destroy(); // Clean up any previous cache
      state.locationCache = new LocationCache();
      state.locationCache.init(
        session.session_key,
        drivers,
        state.raceStartTime,
        state.raceEndTime,
        trackRenderer.trackPoints
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

/** Generate a generic oval track if location data is unavailable */
function generateFallbackTrack() {
  const points = [];
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: Math.cos(t) * 4000 + (Math.cos(t * 3) * 500),
      y: Math.sin(t) * 2500 + (Math.sin(t * 2) * 400),
    });
  }
  trackRenderer.setTrackData(points);
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
  if (state.positions.length === 0) return;

  // Determine total laps
  const maxLap = state.laps.reduce((max, l) => Math.max(max, l.lap_number || 0), 0);
  state.totalLaps = maxLap || 0;
  state.currentLap = 0;

  // Find the exact "Lights Out" start of Lap 1 and Checkered flag end
  let earliestLapStart = Infinity;
  let latestLapEnd = 0;

  for (const l of state.laps) {
    if (l.date_start) {
      const time = new Date(l.date_start).getTime();
      // Track earliest Lap 1 start
      if ((l.lap_number === 1 || l.lap_number === 0) && time < earliestLapStart) {
        earliestLapStart = time;
      }
      // Track finishing time
      if (l.lap_duration) {
        const endTime = time + (l.lap_duration * 1000);
        if (endTime > latestLapEnd) {
          latestLapEnd = endTime;
        }
      }
    }
  }

  // Restrict timeline to actual racing action (not pre-race grid sitting)
  if (earliestLapStart !== Infinity) {
    state.raceStartTime = earliestLapStart - 5000; // 5 seconds before lights out
  } else {
    state.raceStartTime = new Date(state.positions[0].date).getTime();
  }

  if (latestLapEnd !== 0) {
    state.raceEndTime = latestLapEnd + 10000; // 10 seconds post-checkered
  } else {
    state.raceEndTime = new Date(state.positions[state.positions.length - 1].date).getTime();
  }

  state.raceDuration = state.raceEndTime - state.raceStartTime;
  state.currentRaceTime = 0;

  // Reset event detection
  state.lastPositionMap.clear();
  state.fastestLapTime = Infinity;
  state.fastestLapDriver = null;
  state.detectedEvents.clear();
}

/**
 * Build per-driver lap timing data for accurate track position interpolation.
 * Each driver gets an array of { lap, startTime, endTime, duration } entries.
 */
function buildDriverLapTimes() {
  state.driverLapTimes.clear();

  // Group laps by driver
  const byDriver = new Map();
  for (const l of state.laps) {
    const num = l.driver_number;
    if (!byDriver.has(num)) byDriver.set(num, []);
    byDriver.get(num).push(l);
  }

  byDriver.forEach((laps, driverNum) => {
    // Sort by lap number
    laps.sort((a, b) => (a.lap_number || 0) - (b.lap_number || 0));

    const timing = [];
    for (const l of laps) {
      const lapNum = l.lap_number || 0;
      const duration = l.lap_duration || null;
      const startTime = l.date_start ? new Date(l.date_start).getTime() : null;

      if (startTime !== null && duration !== null) {
        timing.push({
          lap: lapNum,
          startTime: startTime - state.raceStartTime,  // offset from race start
          endTime: startTime - state.raceStartTime + duration * 1000,
          duration: duration * 1000, // in ms
        });
      } else if (startTime !== null) {
        // Duration unknown, estimate ~90 seconds
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

function createSprites() {
  state.sprites.clear();
  state.drivers.forEach(d => {
    state.sprites.set(d.driver_number, new DriverSprite(d));
  });
}

/**
 * Get the current position data at a given race time.
 * Returns a Map of driverNumber -> { position, gap, tireCompound }
 */
function getPositionSnapshot(raceTimeMs) {
  if (state.positions.length === 0) return new Map();

  const currentEpoch = state.raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();
  const snapshot = new Map();

  // Find latest position for each driver up to currentTime
  for (const p of state.positions) {
    if (p.date > currentTimeStr) break;
    snapshot.set(p.driver_number, {
      position: p.position,
      date: p.date,
    });
  }

  // Add gap info from intervals
  const intervalSnapshot = new Map();
  for (const iv of state.intervals) {
    if (iv.date > currentTimeStr) break;
    intervalSnapshot.set(iv.driver_number, iv);
  }

  // Add stint/tire info (use current lap to find active stint)
  const stintSnapshot = new Map();
  for (const s of state.stints) {
    const lapStart = s.lap_start || 0;
    const lapEnd = s.lap_end || 999;
    if (state.currentLap >= lapStart && state.currentLap <= lapEnd) {
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
      tireCompound: stint?.compound || '',
    });
  });

  return result;
}

/**
 * Get a driver's progress around the track (0..1) at the current race time.
 * Uses per-driver lap timing for accurate interpolation.
 */
function getDriverTrackProgress(driverNum, raceTimeMs, position, totalDrivers) {
  const lapTimes = state.driverLapTimes.get(driverNum);

  if (lapTimes && lapTimes.length > 0) {
    // Find which lap this driver is currently on
    let currentLapData = null;
    let currentLapNum = 0;

    for (const lt of lapTimes) {
      if (raceTimeMs >= lt.startTime && raceTimeMs < lt.endTime) {
        currentLapData = lt;
        currentLapNum = lt.lap;
        break;
      }
      if (raceTimeMs >= lt.startTime) {
        currentLapData = lt;
        currentLapNum = lt.lap;
      }
    }

    if (currentLapData) {
      // Progress within this lap (0..1)
      const lapProgress = Math.min(1, Math.max(0,
        (raceTimeMs - currentLapData.startTime) / currentLapData.duration
      ));

      // Total progress: completed laps + fraction of current lap
      // Normalise to 0..1 based on total race laps
      const totalProgress = state.totalLaps > 0
        ? ((currentLapNum - 1 + lapProgress) / state.totalLaps)
        : lapProgress;

      // Add a small stagger offset based on position to prevent overlap
      const stagger = (position - 1) * 0.008;

      return (totalProgress - stagger + 10) % 1;
    }
  }

  // Fallback: use linear time-based estimate with position stagger
  const linearProgress = state.raceDuration > 0
    ? raceTimeMs / state.raceDuration
    : 0;
  const stagger = (position - 1) / Math.max(1, totalDrivers) * 0.06;
  return ((linearProgress - stagger) + 10) % 1;
}

/**
 * Get current lap number from race time.
 */
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

/**
 * Get weather at current race time.
 */
function getWeatherAtTime(raceTimeMs) {
  if (state.weather.length === 0) return null;
  const currentEpoch = state.raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();

  let weather = state.weather[0];
  for (const w of state.weather) {
    if (w.date <= currentTimeStr) weather = w;
    else break;
  }
  return weather;
}

/**
 * Get race control messages up to current race time.
 */
function getRaceControlAtTime(raceTimeMs) {
  if (state.raceControl.length === 0) return null;
  const currentEpoch = state.raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();

  let latest = null;
  for (const rc of state.raceControl) {
    if (rc.date <= currentTimeStr) latest = rc;
    else break;
  }
  return latest;
}

/* ============================================
   Event Detection — Triggers Mario Kart effects
   ============================================ */
function detectEvents(posSnapshot, raceTimeMs) {
  // Use time-bucketed keys to prevent duplicate events (bucket = 5 second windows)
  const timeBucket = Math.floor(raceTimeMs / 5000);
  const eventKey = (type, extra) => `${type}:${extra}:${timeBucket}`;

  posSnapshot.forEach((data, driverNum) => {
    const sprite = state.sprites.get(driverNum);
    if (!sprite) return;

    const prevPos = state.lastPositionMap.get(driverNum);

    // --- Overtake detection ---
    if (prevPos !== undefined && data.position < prevPos) {
      const key = eventKey('overtake', driverNum);
      if (!state.detectedEvents.has(key)) {
        state.detectedEvents.add(key);

        let overtakenDriver = '';
        posSnapshot.forEach((d2, num2) => {
          if (num2 !== driverNum && d2.position === data.position + 1) {
            const sp2 = state.sprites.get(num2);
            overtakenDriver = sp2?.abbreviation || '';
          }
        });

        marioEffects.trigger(EFFECT_TYPES.OVERTAKE, {
          driver1: sprite.abbreviation,
          driver2: overtakenDriver,
          cx: sprite.cx,
          cy: sprite.cy,
          color: sprite.teamColor,
          lap: state.currentLap,
        });
      }
    }

    state.lastPositionMap.set(driverNum, data.position);
  });

  // --- Fastest lap detection ---
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
            const sprite = state.sprites.get(l.driver_number);
            if (sprite) {
              marioEffects.trigger(EFFECT_TYPES.FASTEST_LAP, {
                driver: sprite.abbreviation,
                sprite,
                cx: sprite.cx,
                cy: sprite.cy,
                lap: state.currentLap,
              });
            }
          }
        }
      }
    }
  }

  // --- Race control events ---
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
        marioEffects.trigger(EFFECT_TYPES.YELLOW_FLAG, {
          cx: canvas.clientWidth * (0.3 + Math.random() * 0.4),
          cy: canvas.clientHeight * (0.3 + Math.random() * 0.4),
          lap: state.currentLap,
        });
      }
      if (msg.includes('SAFETY CAR') && !msg.includes('VIRTUAL')) {
        marioEffects.trigger(EFFECT_TYPES.SAFETY_CAR, {
          canvasWidth: canvas.clientWidth,
          canvasHeight: canvas.clientHeight,
          lap: state.currentLap,
        });
      }
      if (rc.status) {
        raceInfo.updateTrackStatus(rc.status);
      }
    }
  }

  // --- Rain detection ---
  const weather = getWeatherAtTime(raceTimeMs);
  if (weather) {
    if (weather.rainfall && weather.rainfall > 0 && !marioEffects.isRaining) {
      marioEffects.trigger(EFFECT_TYPES.RAIN, { lap: state.currentLap });
    } else if ((!weather.rainfall || weather.rainfall === 0) && marioEffects.isRaining) {
      marioEffects.stopRain();
    }
    raceInfo.updateWeather(weather);
  }

  // --- Race finish ---
  if (state.currentLap === state.totalLaps && state.totalLaps > 0) {
    const key = 'finish';
    if (!state.detectedEvents.has(key)) {
      state.detectedEvents.add(key);
      const winner = [...posSnapshot.entries()].find(([, d]) => d.position === 1);
      const winnerSprite = winner ? state.sprites.get(winner[0]) : null;
      marioEffects.trigger(EFFECT_TYPES.RACE_FINISH, {
        driver: winnerSprite?.abbreviation || '???',
        canvasWidth: canvas.clientWidth,
        lap: state.totalLaps,
      });
    }
  }
}

/* ============================================
   Render Loop — TIME-BASED playback
   ============================================ */
let lastTimestamp = 0;

function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  const dtMs = lastTimestamp > 0 ? (timestamp - lastTimestamp) : 0;
  lastTimestamp = timestamp;

  // --- Advance race time based on wall-clock dt and speed multiplier ---
  if (state.isPlaying && state.raceDuration > 0) {
    state.currentRaceTime += dtMs * state.speed;

    if (state.currentRaceTime >= state.raceDuration) {
      state.currentRaceTime = state.raceDuration;
      state.isPlaying = false;
      playbackControls.isPlaying = false;
      playbackControls.playBtn.textContent = '▶';
    }
  }

  // --- Get position snapshot at current race time ---
  const posSnapshot = getPositionSnapshot(state.currentRaceTime);

  // --- Detect events ---
  if (state.raceDuration > 0) {
    detectEvents(posSnapshot, state.currentRaceTime);
  }

  // --- Update driver sprite positions ---
  if (trackRenderer.trackPoints.length > 0 && posSnapshot.size > 0) {
    const totalDrivers = posSnapshot.size;
    const currentEpoch = state.raceStartTime + state.currentRaceTime;
    const cache = state.locationCache;
    const useRealPos = cache.isCalibrated && cache.hasDataAt(currentEpoch);

    // --- Pre-Render: Camera Follow ---
    if (state.trackedDriver !== null) {
      const data = posSnapshot.get(state.trackedDriver);
      const sprite = state.sprites.get(state.trackedDriver);
      if (data && sprite && !sprite.isPitting && !sprite.isRetired) {
        const oldPanX = trackRenderer.panX;
        const oldPanY = trackRenderer.panY;
        
        let didFocus = false;
        if (useRealPos) {
          const realPos = cache.getDriverPosition(state.trackedDriver, currentEpoch);
          if (realPos) {
            trackRenderer.setTrackingFocus(realPos.x, realPos.y);
            didFocus = true;
          }
        } 
        if (!didFocus) {
          // Fallback tracking
          const progress = getDriverTrackProgress(state.trackedDriver, state.currentRaceTime, data.position, totalDrivers);
          const p = ((progress % 1) + 1) % 1;
          const targetLen = p * trackRenderer.totalLength;
          let lo = 0, hi = trackRenderer.trackLengths.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (trackRenderer.trackLengths[mid] < targetLen) lo = mid + 1;
            else hi = mid;
          }
          const pt0 = trackRenderer.trackPoints[Math.max(0, lo - 1)];
          if (pt0) trackRenderer.setTrackingFocus(pt0.x, pt0.y);
        }

        const dx = trackRenderer.panX - oldPanX;
        const dy = trackRenderer.panY - oldPanY;
        if (dx !== 0 || dy !== 0) {
          for (const s of state.sprites.values()) {
            s.pan(dx, dy);
          }
        }
      }
    }

    posSnapshot.forEach((data, driverNum) => {
      const sprite = state.sprites.get(driverNum);
      if (!sprite) return;

      sprite.position = data.position;
      sprite.gap = data.gap;
      sprite.tireCompound = data.tireCompound;

      // Exact millisecond pit hit-detection tracking using OpenF1 /pit endpoint
      let isPittingExact = false;
      if (state.pitStops) {
        for (const p of state.pitStops) {
          if (p.driver_number === driverNum) {
            const pitStart = new Date(p.date).getTime();
            const pitEnd = pitStart + (p.pit_duration * 1000);
            if (currentEpoch >= pitStart && currentEpoch <= pitEnd) {
              isPittingExact = true;
              break;
            }
          }
        }
      }

      sprite.isPitting = isPittingExact;

      // Update data for sidebar when pitting
      if (sprite.isPitting) {
        sprite.gap = 'PIT';
        data.gap = 'PIT';
      }

      // --- Try real position data from LocationCache ---
      if (useRealPos) {
        const realPos = cache.getDriverPosition(driverNum, currentEpoch);
        if (realPos) {
          const canvasPos = trackRenderer.toCanvas(realPos.x, realPos.y);
          // Compute angle from previous position
          const dx = canvasPos.cx - sprite.cx;
          const dy = canvasPos.cy - sprite.cy;
          const angle = (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1)
            ? Math.atan2(dy, dx) : sprite.angle;
          sprite.updatePosition(canvasPos.cx, canvasPos.cy, angle);
          sprite.progress = 0; // Not used with real positioning

          // Update star timer
          if (sprite.hasStar) {
            sprite.starTimer--;
            if (sprite.starTimer <= 0) sprite.hasStar = false;
            else particles.emitStarSparkle(sprite.cx, sprite.cy);
          }
          return; // Done for this driver
        }
      }

      // --- Fallback: lap-timing interpolation ---
      if (sprite.isPitting && trackRenderer.pitLanePoints.length > 2) {
        // Here we just flag them as in pit and hide them if we are falling back
        sprite.isPitting = true;
        sprite.gap = 'PIT';
        data.gap = 'PIT';
        const progress = getDriverTrackProgress(
          driverNum, state.currentRaceTime, data.position, totalDrivers
        );
        const { cx, cy, angle } = trackRenderer.getPositionOnTrack(progress);
        sprite.updatePosition(cx, cy, angle);
        sprite.progress = progress;
      } else {
        const progress = getDriverTrackProgress(
          driverNum, state.currentRaceTime, data.position, totalDrivers
        );
        const { cx, cy, angle } = trackRenderer.getPositionOnTrack(progress);
        sprite.updatePosition(cx, cy, angle);
        sprite.progress = progress;
      }

      // Update star timer
      if (sprite.hasStar) {
        sprite.starTimer--;
        if (sprite.starTimer <= 0) sprite.hasStar = false;
        else particles.emitStarSparkle(sprite.cx, sprite.cy);
      }
    });
  }

  // --- Draw frame ---
  trackRenderer.clear();
  trackRenderer.drawTrack();

  // Draw sprites (sorted by position so leader draws on top)
  const sortedSprites = [...state.sprites.values()]
    .filter(s => !s.isRetired)
    .sort((a, b) => b.position - a.position); // Draw back-of-pack first
  for (const sprite of sortedSprites) {
    sprite.draw(trackRenderer.ctx, timestamp);
  }

  // Draw particles
  particles.update();
  particles.draw(trackRenderer.ctx);

  // Update Mario effects
  marioEffects.update(canvas.clientWidth, canvas.clientHeight);

  // --- Update UI ---
  if (state.raceDuration > 0) {
    const lap = getCurrentLap(state.currentRaceTime);
    state.currentLap = lap;

    driverPanel.update(posSnapshot);
    driverPanel.updateLap(state.currentLap, state.totalLaps);
    playbackControls.setProgress(
      state.currentRaceTime / Math.max(1, state.raceDuration),
      state.currentLap
    );
  }

  // Draw welcome if no data
  if (state.raceDuration === 0 && state.drivers.length === 0) {
    drawWelcomeScreen();
  }
}

/* ============================================
   Start
   ============================================ */
showLoading(false);
init();
