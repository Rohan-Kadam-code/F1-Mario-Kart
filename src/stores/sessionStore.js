import { create } from 'zustand';
import { LocationCache } from '../data/LocationCache.js';

export const useSessionStore = create((set, get) => ({
  // Raw API data
  session: null,
  drivers: [],
  positions: [],
  laps: [],
  stints: [],
  weather: [],
  raceControl: [],
  intervals: [],
  pitStops: [],

  // Timeline
  raceStartTime: 0,
  raceEndTime: 0,
  raceDuration: 0,
  totalLaps: 0,

  // Track geometry
  trackPoints2D: [],
  pitLanePoints2D: [],
  matchedCircuit: null,
  worldTrackLength: 0,
  gridSlots: [],

  // Per-driver lap timing map: driverNum → [{lap, startTime, endTime, duration}]
  driverLapTimes: new Map(),

  // Progressive GPS cache
  locationCache: new LocationCache(),

  // Actions
  setSession: (data) => set(data),
  setLocationCache: (lc) => set({ locationCache: lc }),
  reset: () => set({
    session: null, drivers: [], positions: [], laps: [], stints: [],
    weather: [], raceControl: [], intervals: [], pitStops: [],
    raceStartTime: 0, raceEndTime: 0, raceDuration: 0, totalLaps: 0,
    trackPoints2D: [], pitLanePoints2D: [], matchedCircuit: null,
    worldTrackLength: 0, gridSlots: [], driverLapTimes: new Map(),
  }),
}));
