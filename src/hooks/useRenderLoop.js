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

      // Move karts
      if (posSnapshot.size > 0 && !scn.garageMode) {
        const currentEpoch = sess.raceStartTime + t;
        const cache = sess.locationCache;
        const useRealPos = cache?.isCalibrated && cache?.hasDataAt(currentEpoch);
        const karts = refs?.karts;

        posSnapshot.forEach((data, driverNum) => {
          const kart = karts?.get(driverNum);
          if (!kart) return;

          kart.position = data.position;
          kart.gap = data.gap;
          kart.tireCompound = data.tireCompound;

          // Pit stop detection
          let isPitting = false;
          for (const p of sess.pitStops) {
            if (p.driver_number === driverNum) {
              const ps = new Date(p.date).getTime();
              const pe = ps + p.pit_duration * 1000;
              if (currentEpoch >= ps && currentEpoch <= pe) { isPitting = true; break; }
            }
          }
          kart.isPitting = isPitting;
          if (isPitting) { kart.gap = 'PIT'; data.gap = 'PIT'; }

          // Try real GPS position
          if (useRealPos) {
            const realPos = cache.getDriverPosition(driverNum, currentEpoch);
            if (realPos) {
              const progress = getDriverTrackProgress(driverNum, t, data.position, sess);
              let world = sm.toWorldCoords(realPos.x, realPos.y, kart._currentPos?.y ?? 0, progress);

              const tCur = cache.getDriverTangent(driverNum, currentEpoch);
              const tFut = cache.getDriverTangent(driverNum, currentEpoch + 250);
              let angle = kart.currentAngle;
              if (tCur && tFut) angle = Math.atan2((tCur.x + tFut.x) * 0.5, -(tCur.y + tFut.y) * 0.5);
              else if (tCur) angle = Math.atan2(tCur.x, -tCur.y);

              // Grid stagger blend for race start
              const gw = Math.max(0, 1 - t / 5000);
              if (gw > 0 && sess.gridSlots && data.position >= 1 && data.position <= 20) {
                const slot = sess.gridSlots[data.position - 1];
                const mc = sess.matchedCircuit;
                const isPoleRight = !mc || mc.poleSide !== 'left';
                const isRight = (data.position % 2 === 1) ? isPoleRight : !isPoleRight;
                const rX = Math.cos(slot.angle), rZ = -Math.sin(slot.angle);
                const gx = slot.x + rX * (isRight ? 4 : -4);
                const gz = slot.z + rZ * (isRight ? 4 : -4);
                world.x = world.x * (1 - gw) + gx * gw;
                world.z = world.z * (1 - gw) + gz * gw;
              }

              const s = cache.getDriverSpeed(driverNum, currentEpoch);
              kart.speed = kart.speed * 0.8 + s * 0.2;
              kart.updatePosition(world.x, world.y, world.z, angle, world.pitch);
              kart.progress = 0;
              if (kart.hasStar && particles) particles.emitStarSparkle(world.x, 0, world.z);
              return;
            }
          }

          // Fallback: lap-timing interpolation
          const progress = getDriverTrackProgress(driverNum, t, data.position, sess);
          const pos3D = sm.getPositionOnTrack(progress);

          const gw = Math.max(0, 1 - t / 5000);
          if (gw > 0 && sess.gridSlots && data.position >= 1 && data.position <= 20) {
            const slot = sess.gridSlots[data.position - 1];
            const mc = sess.matchedCircuit;
            const isPoleRight = !mc || mc.poleSide !== 'left';
            const isRight = (data.position % 2 === 1) ? isPoleRight : !isPoleRight;
            const rX = Math.cos(slot.angle), rZ = -Math.sin(slot.angle);
            pos3D.x = pos3D.x * (1 - gw) + (slot.x + rX * (isRight ? 4 : -4)) * gw;
            pos3D.z = pos3D.z * (1 - gw) + (slot.z + rZ * (isRight ? 4 : -4)) * gw;
            pos3D.angle = pos3D.angle * (1 - gw) + slot.angle * gw;
          }

          kart.updatePosition(pos3D.x, pos3D.y, pos3D.z, pos3D.angle, pos3D.pitch);
          kart.progress = progress;

          const dProg = Math.abs(progress - (kart._prevProgress || 0));
          if (dProg < 0.5 && dt > 0) {
            kart.speed = (dProg * 5) / ((dt * pb.speed) / 3600000);
          }
          kart._prevProgress = progress;

          if (kart.hasStar && particles) particles.emitStarSparkle(pos3D.x, pos3D.y, pos3D.z);
          kart.hasMushroom = kart.speed > 315 || (kart.speed > 200 && kart.speed > (kart._prevSpeed || 0) * 1.05);
          kart._prevSpeed = kart.speed;
        });

        // Side-by-side avoidance
        const activeKarts = refs?.karts ? [...refs.karts.values()].filter((k) => k.mesh.visible) : [];
        for (const k of activeKarts) k.targetLateralOffset = 0;
        for (let i = 0; i < activeKarts.length; i++) {
          for (let j = i + 1; j < activeKarts.length; j++) {
            const kA = activeKarts[i], kB = activeKarts[j];
            const dx = kB._targetPos.x - kA._targetPos.x;
            const dz = kB._targetPos.z - kA._targetPos.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < 22 * 22 && distSq > 0.001) {
              const dist = Math.sqrt(distSq);
              const fw = { x: Math.sin(kA.currentAngle), z: Math.cos(kA.currentAngle) };
              const rt = { x: Math.cos(kA.currentAngle), z: -Math.sin(kA.currentAngle) };
              const dot = dx * rt.x + dz * rt.z;
              const fwdDot = dx * fw.x + dz * fw.z;
              const separationForce = Math.max(0, (22 - dist) / 22);
              if (Math.abs(dot) < 16 && Math.abs(fwdDot) < 20) {
                kA.targetLateralOffset -= separationForce * Math.sign(dot) * 2.0;
                kB.targetLateralOffset += separationForce * Math.sign(dot) * 2.0;
              }
            }
          }
        }
        for (const k of activeKarts) {
          k._lateralOffset = (k._lateralOffset || 0) * 0.9 + (k.targetLateralOffset || 0) * 0.1;
          if (Math.abs(k._lateralOffset) > 0.1) {
            const rt = { x: Math.cos(k.currentAngle), z: -Math.sin(k.currentAngle) };
            k.mesh.position.x += rt.x * k._lateralOffset;
            k.mesh.position.z += rt.z * k._lateralOffset;
          }
        }
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
