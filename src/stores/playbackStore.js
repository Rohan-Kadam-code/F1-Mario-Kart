import { create } from 'zustand';

export const usePlaybackStore = create((set, get) => ({
  currentRaceTime: 0,
  isPlaying: false,
  speed: 1,
  currentLap: 0,
  trackedDriver: null,

  // Throttled UI snapshot — updated ~10fps from render loop
  positionSnapshot: new Map(),
  lastPositionMap: new Map(),
  lastIntervalMap: new Map(),

  // Event tracking
  fastestLapTime: Infinity,
  fastestLapDriver: null,
  detectedEvents: new Set(),

  // Weather / race info
  currentWeather: null,
  currentRaceControl: null,

  // Actions
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setSpeed: (speed) => set({ speed }),
  setTrackedDriver: (num) => set({ trackedDriver: num }),
  seek: (raceTimeMs) => set({ currentRaceTime: raceTimeMs }),
  setCurrentLap: (lap) => set({ currentLap: lap }),
  setPositionSnapshot: (snap) => set({ positionSnapshot: snap }),
  setCurrentWeather: (w) => set({ currentWeather: w }),
  setCurrentRaceControl: (rc) => set({ currentRaceControl: rc }),
  markEvent: (key) => {
    const s = get().detectedEvents;
    s.add(key);
  },
  setFastestLap: (time, driver) => set({ fastestLapTime: time, fastestLapDriver: driver }),
  reset: () => set({
    currentRaceTime: 0, isPlaying: false, currentLap: 0,
    positionSnapshot: new Map(), lastPositionMap: new Map(),
    lastIntervalMap: new Map(), fastestLapTime: Infinity,
    fastestLapDriver: null, detectedEvents: new Set(),
    currentWeather: null, currentRaceControl: null,
  }),
}));
