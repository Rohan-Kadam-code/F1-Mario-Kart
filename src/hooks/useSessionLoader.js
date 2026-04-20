/**
 * useSessionLoader — loads a session, builds track + karts, initialises LocationCache.
 * Writes results into sessionStore and sceneStore.
 * Receives sceneRefs (imperative refs to Three.js objects) to build 3D geometry.
 */
import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { usePlaybackStore } from '../stores/playbackStore.js';
import { useSceneStore } from '../stores/sceneStore.js';
import * as api from '../api/openf1.js';
import { findCircuit } from '../data/circuitData.js';
import { LocationCache } from '../data/LocationCache.js';
import { projectLatLng, generateFallbackTrackPoints, computeArcLengths, walkBackFromStart, computeWorldTrackLength } from '../lib/geometry.js';
import { buildTimeline, buildDriverLapTimes } from '../lib/timeline.js';
import { createKarts } from '../lib/kartFactory.js';

export function useSessionLoader(sceneRefs) {
  const setLoading = useSceneStore((s) => s.setLoading);
  const setLoadProgress = useSceneStore((s) => s.setLoadProgress);

  const loadSession = useCallback(async (session) => {
    const refs = sceneRefs.current;
    setLoading(true, 5, 'Fetching session data…');

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

      setLoadProgress(40, 'Building track…');

      const sortedPositions = positions.sort((a, b) => new Date(a.date) - new Date(b.date));
      const sortedWeather = weather.sort((a, b) => new Date(a.date) - new Date(b.date));
      const sortedRaceControl = raceControl.sort((a, b) => new Date(a.date) - new Date(b.date));
      const sortedIntervals = intervals.sort((a, b) => new Date(a.date) - new Date(b.date));

      // Track loading
      let trackPoints2D = [];
      let pitLanePoints2D = [];
      const matchedCircuit = findCircuit(session);

      if (matchedCircuit) {
        console.log(`✅ Matched circuit: ${matchedCircuit.name} (${matchedCircuit.id})`);
        trackPoints2D = matchedCircuit.trackCoords.map(([lng, lat]) => projectLatLng(lng, lat));
        if (matchedCircuit.pitLane && matchedCircuit.pitLane.length > 2) {
          pitLanePoints2D = matchedCircuit.pitLane.map(([lng, lat]) => projectLatLng(lng, lat));
        }
      } else {
        console.log('No circuit match — falling back to telemetry');
        const firstDriver = drivers[0];
        if (firstDriver) {
          try {
            const driverLaps = laps
              .filter((l) => l.driver_number === firstDriver.driver_number && l.date_start && l.lap_duration)
              .sort((a, b) => (a.lap_number || 0) - (b.lap_number || 0));

            let dateStart, dateEnd;
            if (driverLaps.length > 2) {
              const mid = driverLaps[Math.floor(driverLaps.length / 2)];
              dateStart = mid.date_start;
              dateEnd = new Date(new Date(dateStart).getTime() + (mid.lap_duration + 5) * 1000).toISOString();
            } else {
              dateStart = session.date_start;
              dateEnd = new Date(new Date(dateStart).getTime() + 120000).toISOString();
            }

            const locations = await api.getLocations(session.session_key, firstDriver.driver_number, dateStart, dateEnd);
            if (locations && locations.length > 20) {
              trackPoints2D = locations.map((p) => ({ x: p.x, y: p.y }));
            } else {
              trackPoints2D = generateFallbackTrackPoints();
            }
          } catch {
            trackPoints2D = generateFallbackTrackPoints();
          }
        } else {
          trackPoints2D = generateFallbackTrackPoints();
        }
      }

      // Build 3D track — defer SceneManager construction to after layout settled
      const sm = refs?.sceneManager;
      const track3D = refs?.track3D;
      const miniMap = refs?.miniMap;

      if (sm && track3D) {
        sm.setTrackData(trackPoints2D, pitLanePoints2D, matchedCircuit);
        track3D.build(sm.trackPoints3D, sm.pitLanePoints3D || [], matchedCircuit);
        miniMap?.setTrackData(trackPoints2D, matchedCircuit);
        sm.resize(); // Re-frame camera now that track bounds are known
      }

      const { lengths, totalLength } = computeArcLengths(trackPoints2D);

      // World track length and grid slots
      const pts3D = sm?.trackPoints3D || [];
      const worldTrackLength = computeWorldTrackLength(pts3D);
      console.log(`[Grid] 3D world track length: ${worldTrackLength.toFixed(0)} units`);

      const gridSlots = [];
      if (pts3D.length > 1) {
        for (let slot = 0; slot < 20; slot++) {
          const dist = 2 + slot * 8;
          gridSlots.push(walkBackFromStart(pts3D, dist));
        }
        console.log(`[Grid] Pre-computed ${gridSlots.length} grid slot positions`);
      }

      setLoadProgress(60, 'Computing timeline…');

      const timeline = buildTimeline(laps, sortedPositions, session);
      const driverLapTimes = buildDriverLapTimes(laps, timeline.raceStartTime);

      setLoadProgress(75, 'Creating karts…');

      const year = session.year || 2026;
      const scene = sm?.scene;
      const oldKarts = refs?.karts;
      const newKarts = await createKarts(drivers, scene, year, oldKarts);

      // Store karts in refs AND sceneManager
      if (refs) refs.karts = newKarts;
      if (sm) sm.karts = newKarts;

      setLoadProgress(85, 'Initialising GPS cache…');

      // Progressive GPS cache
      const oldCache = useSessionStore.getState().locationCache;
      oldCache?.destroy?.();
      const locationCache = new LocationCache();

      if (matchedCircuit && pts3D.length > 0) {
        locationCache
          .init(session.session_key, drivers, timeline.raceStartTime, timeline.raceEndTime, trackPoints2D)
          .then(() => console.log(`[LocationCache] Calibrated: ${locationCache.isCalibrated}`))
          .catch((e) => console.warn('[LocationCache] Init failed:', e));
      }

      // Write everything to stores
      useSessionStore.setState({
        session,
        drivers,
        positions: sortedPositions,
        laps,
        stints,
        weather: sortedWeather,
        raceControl: sortedRaceControl,
        intervals: sortedIntervals,
        pitStops,
        raceStartTime: timeline.raceStartTime,
        raceEndTime: timeline.raceEndTime,
        raceDuration: timeline.raceDuration,
        totalLaps: timeline.totalLaps,
        trackPoints2D,
        pitLanePoints2D,
        matchedCircuit,
        worldTrackLength,
        gridSlots,
        driverLapTimes,
        locationCache,
      });

      usePlaybackStore.setState({
        currentRaceTime: 0,
        isPlaying: false,
        currentLap: 0,
        positionSnapshot: new Map(),
        lastPositionMap: new Map(),
        lastIntervalMap: new Map(),
        fastestLapTime: Infinity,
        fastestLapDriver: null,
        detectedEvents: new Set(),
      });

      setLoadProgress(100, 'Ready!');
      setTimeout(() => setLoading(false, 100, 'Ready!'), 400);
    } catch (err) {
      console.error('Failed to load session:', err);
      setLoading(false, 0, '');
      alert('Failed to load session data. Please try another session.');
    }
  }, [sceneRefs, setLoading, setLoadProgress]);

  return { loadSession };
}
