/**
 * Pure positioning helpers — extracted from main.js.
 * All functions take session state as explicit arguments (no global state).
 */

/**
 * Position snapshot: for each driver, their current race position, gap, tire.
 * Returns Map<driverNum, { position, gap, intervalValue, tireCompound }>
 */
export function getPositionSnapshot(
  raceTimeMs,
  { drivers, positions, intervals, stints, raceStartTime, currentLap }
) {
  if (drivers.length === 0) return new Map();
  const currentEpoch = raceStartTime + raceTimeMs;
  const currentTimeStr = new Date(currentEpoch).toISOString();
  const snapshot = new Map();

  for (const p of positions) {
    if (p.date > currentTimeStr) break;
    snapshot.set(p.driver_number, { position: p.position, date: p.date });
  }

  drivers.forEach((driver, index) => {
    if (!snapshot.has(driver.driver_number)) {
      const firstEver = positions.find((p) => p.driver_number === driver.driver_number);
      snapshot.set(driver.driver_number, {
        position: firstEver ? firstEver.position : index + 1,
        date: firstEver ? firstEver.date : currentTimeStr,
      });
    }
  });

  // Interval snapshot
  const intervalSnapshot = new Map();
  for (const iv of intervals) {
    if (iv.date > currentTimeStr) break;
    intervalSnapshot.set(iv.driver_number, iv);
  }

  // Stint snapshot
  const stintSnapshot = new Map();
  const activeLap = currentLap === 0 ? 1 : currentLap;
  for (const s of stints) {
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
      if (interval.gap_to_leader != null) {
        gap = data.position === 1 ? 'Leader' : `+${Number(interval.gap_to_leader).toFixed(1)}s`;
      } else if (interval.interval != null) {
        gap = `+${Number(interval.interval).toFixed(1)}s`;
      }
    }
    result.set(driverNum, {
      position: data.position,
      gap,
      intervalValue: interval ? interval.gap_to_leader ?? interval.interval ?? 999 : 999,
      tireCompound: stint?.compound || '',
    });
  });
  return result;
}

/**
 * Compute a driver's fractional track progress (0..1) based on lap timing.
 */
export function getDriverTrackProgress(
  driverNum,
  raceTimeMs,
  position,
  { driverLapTimes, totalLaps, worldTrackLength, raceDuration }
) {
  const lapTimes = driverLapTimes.get(driverNum);
  if (lapTimes && lapTimes.length > 0) {
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
      const lapProgress = Math.min(
        1,
        Math.max(0, (raceTimeMs - currentLapData.startTime) / currentLapData.duration)
      );
      const totalProgress =
        totalLaps > 0 ? (currentLapNum - 1 + lapProgress) / totalLaps : lapProgress;
      const staggerDistance = 2 + (position - 1) * 8;
      const staggerFraction = worldTrackLength > 0 ? staggerDistance / worldTrackLength : 0;
      return (totalProgress - staggerFraction + 10) % 1;
    }
  }
  const linearProgress = raceDuration > 0 ? raceTimeMs / raceDuration : 0;
  const staggerDistance = 2 + (position - 1) * 8;
  const staggerFraction = worldTrackLength > 0 ? staggerDistance / worldTrackLength : 0;
  return (linearProgress - staggerFraction + 10) % 1;
}

/** Current race lap number based on laps data. */
export function getCurrentLap(raceTimeMs, { laps, raceStartTime }) {
  if (laps.length === 0) return 0;
  const currentTimeStr = new Date(raceStartTime + raceTimeMs).toISOString();
  let lap = 0;
  for (const l of laps) {
    if (l.date_start && l.date_start <= currentTimeStr) {
      lap = Math.max(lap, l.lap_number || 0);
    }
  }
  return lap;
}

/** Latest weather entry at or before raceTimeMs. */
export function getWeatherAtTime(raceTimeMs, { weather, raceStartTime }) {
  if (weather.length === 0) return null;
  const ts = new Date(raceStartTime + raceTimeMs).toISOString();
  let w = weather[0];
  for (const ww of weather) {
    if (ww.date <= ts) w = ww;
    else break;
  }
  return w;
}

/** Latest race control message at or before raceTimeMs. */
export function getRaceControlAtTime(raceTimeMs, { raceControl, raceStartTime }) {
  if (raceControl.length === 0) return null;
  const ts = new Date(raceStartTime + raceTimeMs).toISOString();
  let latest = null;
  for (const rc of raceControl) {
    if (rc.date <= ts) latest = rc;
    else break;
  }
  return latest;
}
