/**
 * OpenF1 API Service Layer
 * Centralised fetch wrapper with rate limiting for all OpenF1 endpoints.
 */

const BASE = '/api/v1';

/** Simple rate limiter — max 2 requests per second */
class RateLimiter {
  constructor(maxPerSecond = 2) {
    this.max = maxPerSecond;
    this.queue = [];
    this.running = 0;
    this.interval = 1000 / maxPerSecond;
  }

  async schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._process();
    });
  }

  _process() {
    if (this.queue.length === 0 || this.running >= this.max) return;
    this.running++;
    const { fn, resolve, reject } = this.queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        setTimeout(() => {
          this.running--;
          this._process();
        }, this.interval);
      });
  }
}

const limiter = new RateLimiter(2);

import { getApiCache, setApiCache, getLocationChunkCache, setLocationChunkCache } from '../data/db.js';

async function fetchAPI(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const cacheKey = url.toString();
  const isLocation = endpoint.includes('/location');

  return limiter.schedule(async () => {
    // Check IndexedDB for offline access
    const cachedData = isLocation ? await getLocationChunkCache(cacheKey) : await getApiCache(cacheKey);
    if (cachedData) {
      console.log(`[Cache Hit] ${endpoint}`);
      return cachedData;
    }

    console.log(`[API Fetch] ${endpoint}`);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API error ${res.status}: ${endpoint}`);
    const data = await res.json();
    
    // Save response to IndexedDB payload
    if (isLocation) {
      await setLocationChunkCache(cacheKey, data);
    } else {
      await setApiCache(cacheKey, data);
    }
    return data;
  });
}

/* ---------- Endpoint wrappers ---------- */

export async function getMeetings(year) {
  return fetchAPI('/meetings', { year });
}

export async function getSessions(meetingKey) {
  return fetchAPI('/sessions', { meeting_key: meetingKey });
}

export async function getSessionsByYear(year) {
  return fetchAPI('/sessions', { year });
}

export async function getDrivers(sessionKey) {
  return fetchAPI('/drivers', { session_key: sessionKey });
}

export async function getPositions(sessionKey) {
  return fetchAPI('/position', { session_key: sessionKey });
}

export async function getLocations(sessionKey, driverNumber, dateStart, dateEnd) {
  const params = { session_key: sessionKey, driver_number: driverNumber };
  if (dateStart) params['date>'] = dateStart;
  if (dateEnd) params['date<'] = dateEnd;
  return fetchAPI('/location', params);
}

export async function getLocationsAll(sessionKey, dateStart, dateEnd) {
  const params = { session_key: sessionKey };
  if (dateStart) params['date>'] = dateStart;
  if (dateEnd) params['date<'] = dateEnd;
  return fetchAPI('/location', params);
}

export async function getLaps(sessionKey) {
  return fetchAPI('/laps', { session_key: sessionKey });
}

export async function getIntervals(sessionKey) {
  return fetchAPI('/intervals', { session_key: sessionKey });
}

export async function getPitStops(sessionKey) {
  return fetchAPI('/pit', { session_key: sessionKey });
}

export async function getStints(sessionKey) {
  return fetchAPI('/stints', { session_key: sessionKey });
}

export async function getWeather(sessionKey) {
  return fetchAPI('/weather', { session_key: sessionKey });
}

export async function getRaceControl(sessionKey) {
  return fetchAPI('/race_control', { session_key: sessionKey });
}

export async function getCarData(sessionKey, driverNumber) {
  return fetchAPI('/car_data', { session_key: sessionKey, driver_number: driverNumber });
}
