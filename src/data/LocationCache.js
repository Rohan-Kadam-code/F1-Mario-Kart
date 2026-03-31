/**
 * LocationCache — Progressive fetcher and cache for OpenF1 car location data.
 *
 * Fetches location data in time chunks (30s windows) in the background,
 * stores per-driver location timelines, and computes the affine transform
 * that maps OpenF1's arbitrary coordinate system onto our projected track.
 *
 * Usage:
 *   1. cache.init(sessionKey, drivers, raceStartTime, raceEndTime, trackPoints)
 *   2. cache starts fetching data in the background
 *   3. cache.getDriverPosition(driverNumber, epochMs) → {x, y} in track coords
 */

import * as api from '../api/openf1.js';
import * as db from './db.js';

export class LocationCache {
  constructor() {
    // Raw data: Map<driverNumber, [{epoch, x, y}]> sorted by epoch
    this.data = new Map();

    // Affine transform: maps OpenF1 (x,y) → projected track (x,y)
    this.transform = null; // { a, b, c, d, tx, ty } → [a b tx; c d ty; 0 0 1]

    // Fetch state
    this.sessionKey = null;
    this.drivers = [];
    this.raceStartEpoch = 0;
    this.raceEndEpoch = 0;
    this.fetchedUpTo = 0;       // epoch ms — data fetched up to this time
    this.isFetching = false;
    this.isCalibrated = false;
    this.fetchIntervalId = null;

    // Reference track points (Mercator-projected from GeoJSON)
    this.trackPoints = [];

    // Stats
    this.totalPoints = 0;
    this.fetchProgress = 0;     // 0..1
  }

  /**
   * Initialise and begin progressive fetching.
   * @param {number} sessionKey
   * @param {Array} drivers — [{driver_number, ...}]
   * @param {number} raceStartEpoch — ms
   * @param {number} raceEndEpoch — ms
   * @param {Array} trackPoints — [{x, y}] projected Mercator points from TrackRenderer
   */
  async init(sessionKey, drivers, raceStartEpoch, raceEndEpoch, trackPoints) {
    this.sessionKey = sessionKey;
    this.drivers = drivers;
    this.raceStartEpoch = raceStartEpoch;
    this.raceEndEpoch = raceEndEpoch;
    this.trackPoints = trackPoints;
    this.fetchedUpTo = raceStartEpoch;
    this.data.clear();
    this.transform = null;
    this.isCalibrated = false;
    this.totalPoints = 0;
    this.fetchProgress = 0;

    // Initialise data arrays for each driver
    for (const d of drivers) {
      this.data.set(d.driver_number, []);
    }

    // Load existing data from IndexedDB
    await this._loadFromStorage();

    // Smart Hydration: If session is already fully cached, skip API calls
    if (this.fetchProgress >= 1.0) {
      console.log(`[LocationCache] Session ${this.sessionKey} fully hydrated from storage. Skipping API fetches.`);
      this.isCalibrated = true; // Assume high-fidelity data doesn't need re-calibration
      return; 
    }

    // Start fetching: first fetch calibration data, then continue in background
    await this._fetchCalibrationData();
    this._startBackgroundFetch();
  }

  /**
   * Load previously cached telemetry from IndexedDB.
   */
  async _loadFromStorage() {
    if (!this.sessionKey) return;
    console.log(`[LocationCache] Checking local storage for session ${this.sessionKey}...`);
    
    try {
      const keys = await db.getSessionLocationKeys(this.sessionKey);
      if (keys.length === 0) return;

      let pointsLoaded = 0;
      let latestEpoch = this.raceStartEpoch;

      for (const key of keys) {
        const chunk = await db.getLocationChunkCache(key);
        if (chunk && chunk.locations) {
          for (const loc of chunk.locations) {
            const dNum = loc.driver_number;
            let dData = this.data.get(dNum);
            if (!dData) {
              dData = [];
              this.data.set(dNum, dData);
            }
            dData.push({
              epoch: loc.epoch,
              x: loc.x,
              y: loc.y
            });
            if (loc.epoch > latestEpoch) latestEpoch = loc.epoch;
            pointsLoaded++;
          }
        }
      }

      // Sort all driver data
      for (const dData of this.data.values()) {
        dData.sort((a, b) => a.epoch - b.epoch);
      }

      this.totalPoints = pointsLoaded;
      this.fetchedUpTo = Math.min(latestEpoch, this.raceEndEpoch);
      this.fetchProgress = (this.fetchedUpTo - this.raceStartEpoch) / (this.raceEndEpoch - this.raceStartEpoch || 1);
      console.log(`[LocationCache] Successfully re-hydrated ${pointsLoaded} points from storage. Resume from: ${new Date(this.fetchedUpTo).toLocaleTimeString()}`);
    } catch (e) {
      console.warn('[LocationCache] Storage load failed:', e);
    }
  }

  /** Stop background fetching */
  destroy() {
    if (this.fetchIntervalId) {
      clearInterval(this.fetchIntervalId);
      this.fetchIntervalId = null;
    }
  }

  /* =============================================
     Calibration — Compute affine transform
     ============================================= */

  /**
   * Fetch one lap of data for the first driver to calibrate the coordinate mapping.
   */
  async _fetchCalibrationData() {
    // If we already have points in memory (from DB), use a clean 2-minute window for calibration
    const firstDriver = this.drivers[0];
    const dData = this.data.get(firstDriver?.driver_number);
    if (dData && dData.length > 50) {
      // GRID-SKIP LOGIC: Find the first moment of significant movement (>20km/h)
      // Standard F1 pit limiter is 80; grid pull-away is usually fast.
      let activeStart = this.raceStartEpoch;
      for (let i = 0; i < Math.min(dData.length, 500); i++) {
        const p = dData[i];
        const nextP = dData[i+1];
        if (!nextP) break;
        
        const dt = (nextP.epoch - p.epoch) / 1000;
        const dx = nextP.x - p.x;
        const dy = nextP.y - p.y;
        const speedKms = Math.sqrt(dx*dx + dy*dy) / (dt || 1);
        const speedKmh = speedKms * 3.6; 
        
        if (speedKmh > 20) {
          activeStart = p.epoch; 
          console.log(`[LocationCache] Active movement detected at T+${(activeStart - this.raceStartEpoch)/1000}s`);
          break;
        }
      }

      const windowEnd = activeStart + 120000; // 2 minutes from first movement
      const calibrationWindow = dData.filter(p => p.epoch >= activeStart && p.epoch <= windowEnd);
      
      if (calibrationWindow.length > 20) {
        console.log(`[LocationCache] Using 2-minute active window for calibration (Driver ${firstDriver.driver_number})`);
        this._computeTransform(calibrationWindow);
        return;
      }
    }

    if (!firstDriver) return;

    const windowMs = 120000; // 2 minutes of data
    const dateStart = new Date(this.raceStartEpoch).toISOString();
    const dateEnd = new Date(this.raceStartEpoch + windowMs).toISOString();

    try {
      console.log(`[LocationCache] Fetching calibration data for driver ${firstDriver.driver_number}...`);
      const locations = await api.getLocations(
        this.sessionKey, firstDriver.driver_number, dateStart, dateEnd
      );

      if (!locations || locations.length < 20) {
        console.warn('[LocationCache] Insufficient calibration data');
        return;
      }

      // Store the calibration data
      const driverData = this.data.get(firstDriver.driver_number) || [];
      for (const loc of locations) {
        if (loc.x !== undefined && loc.y !== undefined) {
          driverData.push({
            epoch: new Date(loc.date).getTime(),
            x: loc.x,
            y: loc.y,
          });
        }
      }
      this.data.set(firstDriver.driver_number, driverData);
      this.totalPoints += driverData.length;

      // Compute the transform
      this._computeTransform(locations);

      console.log(`[LocationCache] Calibration complete with ${locations.length} points. Transform ready: ${this.isCalibrated}`);
    } catch (e) {
      console.warn('[LocationCache] Calibration fetch failed:', e);
    }
  }

  /**
   * Compute the best-fit affine transform from OpenF1 coords to track coords.
   *
   * Strategy: Find the closest track point for each location point,
   * then solve for the least-squares affine transform using SVD-like approach.
   *
   * We use a simpler approach: compute centroid, scale, and rotation from
   * the bounding boxes and principal axes of both point sets.
   */
  _computeTransform(rawLocations) {
    if (!this.trackPoints || this.trackPoints.length < 10) return;

    // Extract clean points from raw locations
    const srcPoints = [];
    for (const loc of rawLocations) {
      if (loc.x !== undefined && loc.y !== undefined) {
        srcPoints.push({ x: loc.x, y: loc.y });
      }
    }
    if (srcPoints.length < 20) return;

    // Subsample source to ~200 points for speed
    const step = Math.max(1, Math.floor(srcPoints.length / 200));
    const src = [];
    for (let i = 0; i < srcPoints.length; i += step) {
      src.push(srcPoints[i]);
    }

    const dst = this.trackPoints; // Already projected Mercator coords

    // Compute scale from bounding box ratios
    const srcBounds = this._bounds(src);
    const dstBounds = this._bounds(dst);

    // Compute centroids strictly from geometric bounds, NOT point density average
    // This perfectly centers the tracks regardless of if cars sat idle on the grid for long periods
    const srcCentroid = {
      x: (srcBounds.minX + srcBounds.maxX) / 2,
      y: (srcBounds.minY + srcBounds.maxY) / 2
    };
    const dstCentroid = {
      x: (dstBounds.minX + dstBounds.maxX) / 2,
      y: (dstBounds.minY + dstBounds.maxY) / 2
    };

    const srcRangeX = srcBounds.maxX - srcBounds.minX || 1;
    const srcRangeY = srcBounds.maxY - srcBounds.minY || 1;
    const dstRangeX = dstBounds.maxX - dstBounds.minX || 1;
    const dstRangeY = dstBounds.maxY - dstBounds.minY || 1;

    const scaleX = dstRangeX / srcRangeX || 1;
    const scaleY = dstRangeY / srcRangeY || 1;

    // Center both sets
    const srcC = src.map(p => ({ x: p.x - srcCentroid.x, y: p.y - srcCentroid.y }));
    const dstC = dst.map(p => ({ x: p.x - dstCentroid.x, y: p.y - dstCentroid.y }));

    // Real ICP over basic orientations (FlipY and Angle)
    let bestAngle = 0;
    let bestFlipY = false;
    let bestError = Infinity;

    // Test a subset of points and both flip states
    const sampleStep = Math.max(1, Math.floor(srcC.length / 50));
    const dstLen = dstC.length;

    for (const flipY of [false, true]) {
      const yMultiplier = flipY ? -1 : 1;
      
      for (let angleDeg = 0; angleDeg < 360; angleDeg += 2) {
        const angle = angleDeg * Math.PI / 180;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        let shapeError = 0;
        let count = 0;

        // Measure distance to closest track point
        for (let i = 0; i < srcC.length; i += sampleStep) {
          const sp = srcC[i];
          const scaledX = sp.x * scaleX;
          const scaledY = sp.y * yMultiplier * scaleY;

          const rx = scaledX * cosA - scaledY * sinA;
          const ry = scaledX * sinA + scaledY * cosA;

          let minDist = Infinity;
          for (let j = 0; j < dstLen; j += 2) {
            const dp = dstC[j];
            const d = (rx - dp.x) ** 2 + (ry - dp.y) ** 2;
            if (d < minDist) minDist = d;
          }
          shapeError += minDist;
          count++;
        }
        shapeError /= count;

        // Add a penalty if the start of the telemetry (the Grid) maps to the back of the track
        // GeoJSON implicitly starts near the actual Start/Finish line (index 0)
        const spStart = srcC[0];
        const scaledXStart = spStart.x * scaleX;
        const scaledYStart = spStart.y * yMultiplier * scaleY;
        const rxStart = scaledXStart * cosA - scaledYStart * sinA;
        const ryStart = scaledXStart * sinA + scaledYStart * cosA;
        
        // Distance from grid mapping to the actual start finish line area (dstC[0])
        const startDistError = (rxStart - dstC[0].x) ** 2 + (ryStart - dstC[0].y) ** 2;
        
        // Total error = shape error + weight * start line alignment error
        const totalError = shapeError + (startDistError * 0.1);

        if (totalError < bestError) {
          bestError = totalError;
          bestAngle = angle;
          bestFlipY = flipY;
        }
      }
    }

    const cosA = Math.cos(bestAngle);
    const sinA = Math.sin(bestAngle);
    const flipMult = bestFlipY ? -1 : 1;

    // --- Fine-Tune ICP Translation Offset ---
    // Now that shape/rotation is rigorously locked, calculate the minor translation 
    // offset needed to map the squiggly source line perfectly dead-center onto the destination line.
    let shiftX = 0;
    let shiftY = 0;
    let shiftCount = 0;

    for (const sp of srcC) {
      const scaledX = sp.x * scaleX;
      const scaledY = sp.y * flipMult * scaleY;
      const rx = scaledX * cosA - scaledY * sinA;
      const ry = scaledX * sinA + scaledY * cosA;

      let minDist = Infinity;
      let closestD = null;
      for (const dp of dstC) {
        const d = (rx - dp.x) ** 2 + (ry - dp.y) ** 2;
        if (d < minDist) {
          minDist = d;
          closestD = dp;
        }
      }
      // Increased tolerance filter slightly because independent scale might adjust distances
      if (closestD && minDist < (300 * 300)) { 
        shiftX += (closestD.x - rx);
        shiftY += (closestD.y - ry);
        shiftCount++;
      }
    }

    if (shiftCount > 0) {
      dstCentroid.x += shiftX / shiftCount;
      dstCentroid.y += shiftY / shiftCount;
    }

    this.transform = {
      scaleX,
      scaleY,
      flipMult,
      cosA,
      sinA,
      srcCentroid,
      dstCentroid,
    };

    this.isCalibrated = true;
    console.log(`[LocationCache] Transform: scaleX=${scaleX.toFixed(4)}, scaleY=${scaleY.toFixed(4)}, angle=${(bestAngle * 180 / Math.PI).toFixed(1)}°, flipY=${bestFlipY}, error=${bestError.toFixed(2)}`);
  }

  applyTransform(rawX, rawY) {
    if (!this.transform) return null;

    const { scaleX, scaleY, flipMult, cosA, sinA, srcCentroid, dstCentroid } = this.transform;

    // Center on source centroid
    const cx = rawX - srcCentroid.x;
    const cy = rawY - srcCentroid.y;

    // Scale and flip independently
    const sx = cx * scaleX;
    const sy = cy * flipMult * scaleY;

    // Rotate
    const rx = sx * cosA - sy * sinA;
    const ry = sx * sinA + sy * cosA;

    // Translate to destination centroid
    return {
      x: rx + dstCentroid.x,
      y: ry + dstCentroid.y,
    };
  }

  /* =============================================
     Background Fetching
     ============================================= */

  _startBackgroundFetch() {
    // Fetch data in larger chunks every second to quickly cache the whole race
    this.fetchIntervalId = setInterval(() => {
      if (this.isFetching) return;
      if (this.fetchedUpTo >= this.raceEndEpoch) {
        // All data fetched
        clearInterval(this.fetchIntervalId);
        this.fetchIntervalId = null;
        this.fetchProgress = 1;
        console.log(`[LocationCache] Full session cached successfully. Total: ${this.totalPoints} points`);
        return;
      }
      this._fetchNextChunk();
    }, 1000); // Faster interval for deep-caching
  }

  async _fetchNextChunk() {
    this.isFetching = true;
    const chunkMs = 300000; // 5-minute chunks for faster retrieval
    const chunkStart = this.fetchedUpTo;
    const chunkEnd = Math.min(chunkStart + chunkMs, this.raceEndEpoch);

    const dateStart = new Date(chunkStart).toISOString();
    const dateEnd = new Date(chunkEnd).toISOString();

    try {
      const locations = await api.getLocationsAll(this.sessionKey, dateStart, dateEnd);

      if (locations && locations.length > 0) {
        const chunkData = [];
        for (const loc of locations) {
          if (loc.x === undefined || loc.y === undefined) continue;
          
          const epoch = new Date(loc.date).getTime();
          const driverNum = loc.driver_number;
          
          // Prepare for memory
          let driverData = this.data.get(driverNum);
          if (!driverData) {
            driverData = [];
            this.data.set(driverNum, driverData);
          }
          const p = { epoch, x: loc.x, y: loc.y };
          driverData.push(p);

          // Prepare for DB
          chunkData.push({ driver_number: driverNum, ...p });
        }
        
        this.totalPoints += locations.length;

        // Persist to IndexedDB
        const chunkKey = `loc_${this.sessionKey}_${chunkStart}`;
        await db.setLocationChunkCache(chunkKey, {
          sessionKey: this.sessionKey,
          startEpoch: chunkStart,
          endEpoch: chunkEnd,
          locations: chunkData
        });
      }

      this.fetchedUpTo = chunkEnd;
      this.fetchProgress = (chunkEnd - this.raceStartEpoch) / (this.raceEndEpoch - this.raceStartEpoch || 1);
    } catch (e) {
      console.warn('[LocationCache] Chunk fetch error:', e);
      await new Promise(r => setTimeout(r, 5000));
    } finally {
      this.isFetching = false;
    }
  }

  /* =============================================
     Position Lookup
     ============================================= */

  /**
   * Get a driver's transformed position at a given epoch time.
   * Uses Catmull-Rom (Cubic Hermite) spline interpolation for ultra-smooth movement.
   * @param {number} driverNumber
   * @param {number} epochMs
   * @returns {{x, y}} track-projected coordinates
   */
  getDriverPosition(driverNumber, epochMs) {
    if (!this.isCalibrated) return null;

    const data = this.data.get(driverNumber);
    if (!data || data.length === 0) return null;

    // Linear fallback if only 1-2 points
    if (data.length < 3) {
      return this._getLinearPosition(data, epochMs);
    }

    // Binary search for i1 where data[i1].epoch >= epochMs
    let lo = 0, hi = data.length - 1;
    if (epochMs <= data[0].epoch) return this.applyTransform(data[0].x, data[0].y);
    if (epochMs >= data[hi].epoch) return this.applyTransform(data[hi].x, data[hi].y);

    while (lo < hi) {
       const mid = (lo + hi) >> 1;
       if (data[mid].epoch < epochMs) lo = mid + 1;
       else hi = mid;
    }
    const i1 = lo;
    const i0 = i1 - 1;

    // Catmull-Rom needs 4 points: i-1, i, i+1, i+2
    // We use indices: i_m1, i0, i1, i2
    const i_m1 = Math.max(0, i0 - 1);
    const i2 = Math.min(data.length - 1, i1 + 1);

    const p_m1 = data[i_m1];
    const p0 = data[i0];
    const p1 = data[i1];
    const p2 = data[i2];

    const t = (epochMs - p0.epoch) / (p1.epoch - p0.epoch || 1);
    
    // Spline interpolation
    const rawX = this._catmullRom(p_m1.x, p0.x, p1.x, p2.x, t);
    const rawY = this._catmullRom(p_m1.y, p0.y, p1.y, p2.y, t);

    return this.applyTransform(rawX, rawY);
  }

  /**
   * Get the tangent (forward vector) of the driver's path at epochMs.
   * Useful for smooth steering.
   */
  getDriverTangent(driverNumber, epochMs) {
    const data = this.data.get(driverNumber);
    if (!data || data.length < 2) return null;

    let lo = 0, hi = data.length - 1;
    if (epochMs <= data[0].epoch) epochMs = data[0].epoch + 1;
    if (epochMs >= data[hi].epoch) epochMs = data[hi].epoch - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].epoch < epochMs) lo = mid + 1;
      else hi = mid;
    }
    const i1 = lo;
    const i0 = i1 - 1;

    const p0 = data[i0];
    const p1 = data[i1];
    const t = (epochMs - p0.epoch) / (p1.epoch - p0.epoch || 1);

    // Tangent is the derivative of the spline
    const i_m1 = Math.max(0, i0 - 1);
    const i2 = Math.min(data.length - 1, i1 + 1);
    
    const tx = this._catmullRomTangent(data[i_m1].x, data[i0].x, data[i1].x, data[i2].x, t);
    const ty = this._catmullRomTangent(data[i_m1].y, data[i0].y, data[i1].y, data[i2].y, t);

    // Transform vector (only rotation/scale, no translation)
    if (!this.transform) return { x: p1.x - p0.x, y: p1.y - p0.y };
    const { cosA, sinA, flipMult, scaleX, scaleY } = this.transform;
    const sx = tx * scaleX;
    const sy = ty * flipMult * scaleY;
    return {
      x: sx * cosA - sy * sinA,
      y: sx * sinA + sy * cosA
    };
  }

  /**
   * Get the absolute speed of the driver at epochMs.
   * Magnitude of the path tangent (spline derivative).
   */
  getDriverSpeed(driverNumber, epochMs) {
    const data = this.data.get(driverNumber);
    if (!data || data.length < 2) return 0;

    let lo = 0, hi = data.length - 1;
    if (epochMs <= data[0].epoch) epochMs = data[0].epoch + 1;
    if (epochMs >= data[hi].epoch) epochMs = data[hi].epoch - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].epoch < epochMs) lo = mid + 1;
      else hi = mid;
    }
    const i1 = lo;
    const i0 = i1 - 1;

    const p0 = data[i0];
    const p1 = data[i1];
    const dt = p1.epoch - p0.epoch || 1;
    const t = (epochMs - p0.epoch) / dt;

    const i_m1 = Math.max(0, i0 - 1);
    const i2 = Math.min(data.length - 1, i1 + 1);

    const tx = this._catmullRomTangent(data[i_m1].x, data[i0].x, data[i1].x, data[i2].x, t);
    const ty = this._catmullRomTangent(data[i_m1].y, data[i0].y, data[i1].y, data[i2].y, t);

    // Magnitude in untransformed units per ms
    const rawSpeed = Math.sqrt(tx * tx + ty * ty) / dt;

    // Apply average scale factor for world units (approximation)
    if (!this.transform) return rawSpeed * 1000;
    const avgScale = (this.transform.scaleX + this.transform.scaleY) * 0.5;
    return rawSpeed * avgScale * 1000; // Speed in units/sec
  }

  _catmullRom(p0, p1, p2, p3, t) {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
  }

  _catmullRomTangent(p0, p1, p2, p3, t) {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    return 3 * (2 * p1 - 2 * p2 + v0 + v1) * t2 + 2 * (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t + v0;
  }

  _getLinearPosition(driverData, epochMs) {
    if (epochMs <= driverData[0].epoch) return this.applyTransform(driverData[0].x, driverData[0].y);
    const hi = driverData.length - 1;
    if (epochMs >= driverData[hi].epoch) return this.applyTransform(driverData[hi].x, driverData[hi].y);
    
    let lo = 0, h = hi;
    while (lo < h) {
      const mid = (lo + h) >> 1;
      if (driverData[mid].epoch < epochMs) lo = mid + 1;
      else h = mid;
    }
    const p1 = driverData[lo];
    const p0 = driverData[lo - 1];
    const t = (epochMs - p0.epoch) / (p1.epoch - p0.epoch || 1);
    return this.applyTransform(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t);
  }

  /**
   * Check if we have location data for a given time.
   */
  hasDataAt(epochMs) {
    return this.isCalibrated && epochMs <= this.fetchedUpTo;
  }

  /* =============================================
     Helpers
     ============================================= */

  _centroid(points) {
    let sx = 0, sy = 0;
    for (const p of points) { sx += p.x; sy += p.y; }
    return { x: sx / points.length, y: sy / points.length };
  }

  _bounds(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  }
}
