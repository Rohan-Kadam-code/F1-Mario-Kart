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

    // Start fetching: first fetch calibration data, then continue in background
    await this._fetchCalibrationData();
    this._startBackgroundFetch();
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
    const firstDriver = this.drivers[0];
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
    // Fetch data in 30-second chunks every 2 seconds
    this.fetchIntervalId = setInterval(() => {
      if (this.isFetching) return;
      if (this.fetchedUpTo >= this.raceEndEpoch) {
        // All data fetched
        clearInterval(this.fetchIntervalId);
        this.fetchIntervalId = null;
        this.fetchProgress = 1;
        console.log(`[LocationCache] All data fetched. Total: ${this.totalPoints} points`);
        return;
      }
      this._fetchNextChunk();
    }, 2000);
  }

  async _fetchNextChunk() {
    this.isFetching = true;
    const chunkMs = 30000; // 30-second chunks
    const chunkStart = this.fetchedUpTo;
    const chunkEnd = Math.min(chunkStart + chunkMs, this.raceEndEpoch);

    const dateStart = new Date(chunkStart).toISOString();
    const dateEnd = new Date(chunkEnd).toISOString();

    try {
      // Fetch for ALL drivers at once (no driver_number filter) to get all positions
      const locations = await api.getLocationsAll(this.sessionKey, dateStart, dateEnd);

      if (locations && locations.length > 0) {
        for (const loc of locations) {
          if (loc.x === undefined || loc.y === undefined) continue;
          const driverNum = loc.driver_number;
          let driverData = this.data.get(driverNum);
          if (!driverData) {
            driverData = [];
            this.data.set(driverNum, driverData);
          }
          driverData.push({
            epoch: new Date(loc.date).getTime(),
            x: loc.x,
            y: loc.y,
          });
        }
        this.totalPoints += locations.length;
      }

      this.fetchedUpTo = chunkEnd;
      this.fetchProgress = (chunkEnd - this.raceStartEpoch) / (this.raceEndEpoch - this.raceStartEpoch);
    } catch (e) {
      console.warn('[LocationCache] Chunk fetch error:', e);
      // Retry by not advancing fetchedUpTo, but wait a bit longer
      await new Promise(r => setTimeout(r, 3000));
    } finally {
      this.isFetching = false;
    }
  }

  /* =============================================
     Position Lookup
     ============================================= */

  /**
   * Get a driver's transformed position at a given epoch time.
   * Returns {x, y} in track-projected coordinates, or null if no data.
   */
  getDriverPosition(driverNumber, epochMs) {
    if (!this.isCalibrated) return null;

    const driverData = this.data.get(driverNumber);
    if (!driverData || driverData.length === 0) return null;

    // Binary search for the closest time entry
    let lo = 0, hi = driverData.length - 1;

    // Quick bounds check
    if (epochMs <= driverData[0].epoch) {
      return this.applyTransform(driverData[0].x, driverData[0].y);
    }
    if (epochMs >= driverData[hi].epoch) {
      return this.applyTransform(driverData[hi].x, driverData[hi].y);
    }

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (driverData[mid].epoch < epochMs) lo = mid + 1;
      else hi = mid;
    }

    const i1 = lo;
    const i0 = Math.max(0, lo - 1);

    // Interpolate between the two nearest points
    const p0 = driverData[i0];
    const p1 = driverData[i1];
    const dt = p1.epoch - p0.epoch;
    const t = dt > 0 ? (epochMs - p0.epoch) / dt : 0;

    const rawX = p0.x + (p1.x - p0.x) * t;
    const rawY = p0.y + (p1.y - p0.y) * t;

    return this.applyTransform(rawX, rawY);
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
