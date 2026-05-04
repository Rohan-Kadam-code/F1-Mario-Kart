/**
 * useRenderLoop — 60fps requestAnimationFrame loop.
 * Reads stores via .getState() to avoid triggering React re-renders.
 * All heavy logic is imperative; only positionSnapshot is written back ~10fps for UI.
 */
import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { usePlaybackStore } from '../stores/playbackStore.js';
import { useSceneStore } from '../stores/sceneStore.js';
import { EFFECT_TYPES } from '../renderer/MarioEffects.js';
import {
  getPositionSnapshot,
  getDriverTrackProgress,
  getCurrentLap,
  getWeatherAtTime,
  getRaceControlAtTime,
} from '../lib/positioning.js';

export function useRenderLoop(sceneRefs) {
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const smoothedDeltaRef = useRef(16.66);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    function loop(ts) {
      rafRef.current = requestAnimationFrame(loop);

      const rawDt = lastTsRef.current > 0 ? ts - lastTsRef.current : 16.66;
      lastTsRef.current = ts;
      smoothedDeltaRef.current = smoothedDeltaRef.current * 0.8 + Math.min(rawDt, 100) * 0.2;
      const dt = smoothedDeltaRef.current;

      const pb = usePlaybackStore.getState();
      const sess = useSessionStore.getState();
      const scn = useSceneStore.getState();
      const refs = sceneRefs.current;

      // Advance time
      if (pb.isPlaying && sess.raceDuration > 0) {
        let next = pb.currentRaceTime + dt * pb.speed;
        if (next >= sess.raceDuration) {
          next = sess.raceDuration;
          usePlaybackStore.setState({ isPlaying: false });
        }
        usePlaybackStore.setState({ currentRaceTime: next });
      }

      const t = pb.currentRaceTime;
      const sm = refs?.sceneManager;
      const particles = refs?.particles3D;
      const mario = refs?.marioEffects;
      const raceInfo = refs?.raceInfo; // imperative RaceInfo instance

      // Update cache indicator
      const lc = sess.locationCache;
      if (lc?.sessionKey && refs?.cacheIndicator) {
        const ci = refs.cacheIndicator;
        const pct = Math.round(lc.fetchProgress * 100);
        ci.classList.remove('hidden');
        const fill = ci.querySelector('#cacheBarFill');
        const txt = ci.querySelector('#cachePercentage');
        if (fill) fill.style.width = pct + '%';
        if (txt) txt.innerText = pct + '%';
        if (pct >= 100) ci.classList.add('cached');
        else ci.classList.remove('cached');
      } else if (refs?.cacheIndicator) {
        refs.cacheIndicator.classList.add('hidden');
      }

      if (!sm || sm.trackPoints3D.length === 0) {
        sm?.render(ts);
        return;
      }

      // Position snapshot
      const posSnapshot = getPositionSnapshot(t, {
        drivers: sess.drivers,
        positions: sess.positions,
        intervals: sess.intervals,
        stints: sess.stints,
        raceStartTime: sess.raceStartTime,
        currentLap: pb.currentLap,
      });

      // Detect events
      if (sess.raceDuration > 0) {
        detectEvents(posSnapshot, t, sess, pb, sm, particles, mario, raceInfo);
      }

      // Start lights
      if (sm.track3D?.setStartLights) {
        if (t < 0 && t > -5000) {
          sm.track3D.setStartLights(Math.floor(Math.abs(t) / 1000) + 1);
        } else {
          sm.track3D.setStartLights(0);
        }
      }

      // ── Move Karts ──────────────────────────────────────────────────
      if (posSnapshot.size > 0 && !scn.garageMode) {
        const currentEpoch = sess.raceStartTime + t;
        const cache = sess.locationCache;
        const hasGPS  = cache?.isCalibrated && cache?.hasDataAt(currentEpoch);
        const karts   = refs?.karts;

        posSnapshot.forEach((data, driverNum) => {
          const kart = karts?.get(driverNum);
          if (!kart) return;

          // ── Race state from API data ──
          kart.position     = data.position;
          kart.gap          = data.gap;
          kart.tireCompound = data.tireCompound;

          // Pit detection from pitStops timestamps
          let isPitting = false;
          for (const p of sess.pitStops) {
            if (p.driver_number === driverNum) {
              const ps = new Date(p.date).getTime();
              if (currentEpoch >= ps && currentEpoch <= ps + p.pit_duration * 1000) {
                isPitting = true; break;
              }
            }
          }
          kart.isPitting = isPitting;
          if (isPitting) kart.gap = 'PIT';

          // ── Position: prefer real GPS, fall back to lap-progress ──
          let targetX = 0, targetY = 0, targetZ = 0, targetAngle = 0, targetPitch = 0;
          let foundPos = false;

          if (hasGPS) {
            const rawPos = cache.getDriverPosition(driverNum, currentEpoch);
            if (rawPos) {
              const world = sm.toWorldCoords(rawPos.x, rawPos.y);

              // Heading: GPS tangent (current → 200ms ahead) for smooth steering
              const t0 = cache.getDriverTangent(driverNum, currentEpoch);
              const t1 = cache.getDriverTangent(driverNum, currentEpoch + 200);
              let angle = kart.currentAngle;
              if (t0 && t1) {
                angle = Math.atan2((t0.x + t1.x) * 0.5, -(t0.y + t1.y) * 0.5);
              } else if (t0) {
                angle = Math.atan2(t0.x, -t0.y);
              }

              // Speed: from GPS magnitude (km/h)
              const spd = cache.getDriverSpeed(driverNum, currentEpoch);
              kart.speed = kart.speed * 0.85 + spd * 0.15; // smooth

              targetX = world.x; targetY = world.y; targetZ = world.z; targetAngle = angle;
              foundPos = true;
            }
          }

          if (!foundPos) {
            const progress = getDriverTrackProgress(driverNum, t, data.position, sess);
            const pos3D    = sm.getPositionOnTrack(progress);
            targetX = pos3D.x; targetY = pos3D.y; targetZ = pos3D.z; targetAngle = pos3D.angle; targetPitch = pos3D.pitch;
            kart.progress = progress;
            const dp = Math.abs(progress - (kart._prevProgress || 0));
            if (dp < 0.5 && dt > 0) {
              kart.speed = (dp * sess.worldTrackLength) / ((dt * pb.speed) / 1000);
            }
            kart._prevProgress = progress;
          }

          // ── Grid Alignment ──
          // Before race start (t < 0) and first few seconds, blend towards grid slots
          const gridPos = sm.getGridPosition(data.position);
          if (gridPos) {
            let gridMix = 0;
            if (t < 0) gridMix = 1.0;
            else if (t < 5000) gridMix = 1.0 - (t / 5000); // Blend out over 5s
            
            if (gridMix > 0) {
                targetX = targetX * (1 - gridMix) + gridPos.x * gridMix;
                targetY = targetY * (1 - gridMix) + gridPos.y * gridMix;
                targetZ = targetZ * (1 - gridMix) + gridPos.z * gridMix;
                targetAngle = targetAngle * (1 - gridMix) + gridPos.angle * gridMix;
                targetPitch = targetPitch * (1 - gridMix) + gridPos.pitch * gridMix;
            }
          }

          kart.updatePosition(targetX, targetY, targetZ, targetAngle, targetPitch);
          if (kart.hasStar && particles) particles.emitStarSparkle(targetX, targetY, targetZ);
          kart.hasMushroom = kart.speed > 310;
        });
      }


      // Update all kart animations (lerp positions, wheel spin, lights, etc.)
      // Must happen BEFORE sm.render() — updatePosition() only sets targets,
      // kart.update() is what moves mesh.position towards the target each frame.
      if (refs?.karts) {
        refs.karts.forEach((kart) => kart.update(ts));
      }

      // Minimap update
      if (refs?.miniMap && refs?.karts) {
        refs.miniMap.update(refs.karts, pb.trackedDriver);
      }

      // Throttled UI snapshot ~10fps
      if (ts - lastUiUpdateRef.current > 100) {
        lastUiUpdateRef.current = ts;
        const lap = getCurrentLap(t, sess);
        if (lap !== pb.currentLap) {
          usePlaybackStore.setState({ currentLap: lap });
        }
        usePlaybackStore.setState({ positionSnapshot: new Map(posSnapshot) });
      }

      sm.render(ts);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------------------------------------------
   Event detection (inline — reads from refs and stores directly)
   ------------------------------------------------------------------ */
function detectEvents(posSnapshot, t, sess, pb, sm, particles, mario, raceInfoInst) {
  const timeBucket = Math.floor(t / 1000);
  const eventKey = (type, extra) => `${type}:${extra}:${timeBucket}`;
  const { detectedEvents, lastPositionMap, lastIntervalMap } = pb;
  const karts = sm.karts;

  posSnapshot.forEach((data, driverNum) => {
    const kart = karts.get(driverNum);
    if (!kart) return;
    const prevPos = lastPositionMap.get(driverNum);

    // Overtake
    if (prevPos !== undefined && data.position < prevPos) {
      const key = eventKey('overtake', driverNum);
      if (!detectedEvents.has(key)) {
        detectedEvents.add(key);
        let overtaken = '';
        posSnapshot.forEach((d2, n2) => {
          if (n2 !== driverNum && d2.position === data.position + 1) {
            overtaken = karts.get(n2)?.abbreviation || '';
          }
        });
        particles?.emitBoost(kart.mesh.position.x, kart.mesh.position.y, kart.mesh.position.z, kart.teamColor, 20);
        particles?.emitSpotlight(kart.mesh.position.x, kart.mesh.position.y, kart.mesh.position.z, '#ff8000');
        mario?.trigger(EFFECT_TYPES.OVERTAKE, {
          driver1: kart.abbreviation, driver2: overtaken, cx: 0, cy: 0, color: kart.teamColor, lap: pb.currentLap,
        });
      }
    }

    // Poke
    const iv = data.intervalValue || 999;
    if (iv < 0.5 && data.position > 1) {
      const pk = `poke:${driverNum}:${Math.floor(t / 3000)}`;
      if (!detectedEvents.has(pk)) {
        detectedEvents.add(pk);
        particles?.emitSpotlight(kart.mesh.position.x, kart.mesh.position.y, kart.mesh.position.z, '#ff0000');
        mario?.trigger(EFFECT_TYPES.POKE, { driver: kart.abbreviation, cx: 0, cy: 0, lap: pb.currentLap });
      }
    }

    // Banana defense
    const prevIv = lastIntervalMap.get(driverNum) || 999;
    if (prevIv < 1.0 && iv >= 1.0 && data.position > 1) {
      const dk = `defense:${driverNum}:${timeBucket}`;
      if (!detectedEvents.has(dk)) {
        detectedEvents.add(dk);
        mario?.trigger(EFFECT_TYPES.YELLOW_FLAG, { cx: 0, cy: 0, lap: pb.currentLap });
      }
    }

    lastPositionMap.set(driverNum, data.position);
    lastIntervalMap.set(driverNum, iv);
  });

  // Retirement
  sess.drivers.forEach((d) => {
    const num = d.driver_number;
    if (lastPositionMap.has(num) && !posSnapshot.has(num)) {
      const key = `retire:${num}`;
      if (!detectedEvents.has(key)) {
        detectedEvents.add(key);
        const kart = karts.get(num);
        if (kart) {
          particles?.emitExplosion(kart.mesh.position.x, kart.mesh.position.y, kart.mesh.position.z, 40);
          mario?.trigger(EFFECT_TYPES.RETIREMENT, {
            driver: kart.abbreviation, sprite: kart, cx: 0, cy: 0, lap: pb.currentLap,
          });
        }
      }
    }
  });

  // Fastest lap (on lap change)
  const lap = getCurrentLap(t, sess);
  if (lap !== pb.currentLap) {
    usePlaybackStore.setState({ currentLap: lap });
    for (const l of sess.laps) {
      if (l.lap_number === lap - 1 && l.lap_duration) {
        if (l.lap_duration < pb.fastestLapTime) {
          usePlaybackStore.setState({ fastestLapTime: l.lap_duration, fastestLapDriver: l.driver_number });
          const key = eventKey('fastest', l.driver_number);
          if (!detectedEvents.has(key)) {
            detectedEvents.add(key);
            const kart = karts.get(l.driver_number);
            if (kart) {
              kart.hasStar = true; kart.starTimer = 180;
              particles?.emitStarSparkle(kart.mesh.position.x, kart.mesh.position.y, kart.mesh.position.z);
              mario?.trigger(EFFECT_TYPES.FASTEST_LAP, {
                driver: kart.abbreviation, sprite: kart, cx: 0, cy: 0, lap: pb.currentLap,
              });
            }
          }
        }
      }
    }
  }

  // Race control
  const rc = getRaceControlAtTime(t, sess);
  if (rc) {
    const rcKey = `rc:${rc.date}`;
    if (!detectedEvents.has(rcKey)) {
      detectedEvents.add(rcKey);
      raceInfoInst?.addRaceControlMessage(rc);
      usePlaybackStore.setState({ currentRaceControl: rc });
      const msg = (rc.message || '').toUpperCase();
      const flag = (rc.flag || '').toUpperCase();
      if (flag === 'RED' || msg.includes('RED FLAG')) mario?.trigger(EFFECT_TYPES.RED_FLAG, { lap: pb.currentLap });
      if (flag === 'YELLOW' || msg.includes('YELLOW')) mario?.trigger(EFFECT_TYPES.YELLOW_FLAG, { cx: 0, cy: 0, lap: pb.currentLap });
      if (msg.includes('SAFETY CAR') && !msg.includes('VIRTUAL')) mario?.trigger(EFFECT_TYPES.SAFETY_CAR, { canvasWidth: 0, canvasHeight: 0, lap: pb.currentLap });
      if (rc.status) raceInfoInst?.updateTrackStatus(rc.status);
    }
  }

  // Rain
  const weather = getWeatherAtTime(t, sess);
  if (weather && weather !== pb.currentWeather) {
    usePlaybackStore.setState({ currentWeather: weather });
    if (weather.rainfall > 0 && !mario?.isRaining) {
      mario?.trigger(EFFECT_TYPES.RAIN, { lap: pb.currentLap });
      sm.environment3D?.setRaining(true);
    } else if (!weather.rainfall && mario?.isRaining) {
      mario?.stopRain();
      sm.environment3D?.setRaining(false);
    }
    raceInfoInst?.updateWeather(weather);
  }

  // Race finish
  if (pb.currentLap === sess.totalLaps && sess.totalLaps > 0) {
    const key = 'finish';
    if (!detectedEvents.has(key)) {
      detectedEvents.add(key);
      const winner = [...posSnapshot.entries()].find(([, d]) => d.position === 1);
      const winnerKart = winner ? karts.get(winner[0]) : null;
      particles?.emitConfetti(sm.trackBounds, 80);
      setTimeout(() => particles?.emitConfetti(sm.trackBounds, 60), 500);
      setTimeout(() => particles?.emitConfetti(sm.trackBounds, 40), 1000);
      mario?.trigger(EFFECT_TYPES.RACE_FINISH, {
        driver: winnerKart?.abbreviation || '???', canvasWidth: 0, lap: sess.totalLaps,
      });
    }
  }
}
