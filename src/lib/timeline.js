/**
 * Timeline building — extracted from main.js buildTimeline / buildDriverLapTimes.
 */

/**
 * Compute race start/end and total lap count.
 * Returns { raceStartTime, raceEndTime, raceDuration, totalLaps }.
 */
export function buildTimeline(laps, positions, session) {
  const maxLap = laps.reduce((max, l) => Math.max(max, l.lap_number || 0), 0);
  const totalLaps = maxLap || (laps.length > 0 ? 1 : 0);

  let earliestLapStart = Infinity;
  let latestLapEnd = 0;

  for (const l of laps) {
    if (l.date_start) {
      const time = new Date(l.date_start).getTime();
      if ((l.lap_number === 1 || l.lap_number === 0) && time < earliestLapStart) {
        earliestLapStart = time;
      }
      if (l.lap_duration) {
        const endTime = time + l.lap_duration * 1000;
        if (endTime > latestLapEnd) latestLapEnd = endTime;
      }
    }
  }

  let fallbackStart = 0, fallbackEnd = 0;
  if (positions.length > 0) {
    fallbackStart = new Date(positions[0].date).getTime();
    fallbackEnd = new Date(positions[positions.length - 1].date).getTime();
  }

  const raceStartTime =
    earliestLapStart !== Infinity
      ? earliestLapStart - 5000
      : fallbackStart !== 0
      ? fallbackStart
      : session
      ? new Date(session.date_start).getTime()
      : Date.now();

  const raceEndTime =
    latestLapEnd !== 0
      ? latestLapEnd + 10000
      : fallbackEnd !== 0
      ? fallbackEnd
      : raceStartTime + 2 * 60 * 60 * 1000;

  return {
    raceStartTime,
    raceEndTime,
    raceDuration: raceEndTime - raceStartTime,
    totalLaps,
  };
}

/**
 * Build per-driver lap timing map.
 * Returns Map<driverNum, [{lap, startTime, endTime, duration}]>
 * startTime/endTime are relative to raceStartTime (ms).
 */
export function buildDriverLapTimes(laps, raceStartTime) {
  const byDriver = new Map();
  for (const l of laps) {
    const num = l.driver_number;
    if (!byDriver.has(num)) byDriver.set(num, []);
    byDriver.get(num).push(l);
  }

  const result = new Map();
  byDriver.forEach((driverLaps, driverNum) => {
    driverLaps.sort((a, b) => (a.lap_number || 0) - (b.lap_number || 0));
    const timing = [];
    for (const l of driverLaps) {
      const lapNum = l.lap_number || 0;
      const duration = l.lap_duration || null;
      const startMs = l.date_start ? new Date(l.date_start).getTime() : null;
      if (startMs !== null && duration !== null) {
        timing.push({
          lap: lapNum,
          startTime: startMs - raceStartTime,
          endTime: startMs - raceStartTime + duration * 1000,
          duration: duration * 1000,
        });
      } else if (startMs !== null) {
        timing.push({
          lap: lapNum,
          startTime: startMs - raceStartTime,
          endTime: startMs - raceStartTime + 90000,
          duration: 90000,
        });
      }
    }
    result.set(driverNum, timing);
  });
  return result;
}
