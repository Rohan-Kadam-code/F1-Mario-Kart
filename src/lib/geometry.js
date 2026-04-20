/**
 * Geometry utilities — extracted from main.js (untouched logic).
 */

export function projectLatLng(lng, lat) {
  const DEG2RAD = Math.PI / 180;
  const R = 6378137;
  return {
    x: R * lng * DEG2RAD,
    y: R * Math.log(Math.tan(Math.PI / 4 + lat * DEG2RAD / 2)),
  };
}

export function generateFallbackTrackPoints() {
  const points = [];
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: Math.cos(t) * 4000 + Math.cos(t * 3) * 500,
      y: Math.sin(t) * 2500 + Math.sin(t * 2) * 400,
    });
  }
  return points;
}

/**
 * Computes cumulative arc lengths for a closed 2D track.
 * Returns { lengths, totalLength }.
 */
export function computeArcLengths(points) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    lengths.push(total);
  }
  if (points.length > 1) {
    const dx = points[0].x - points[points.length - 1].x;
    const dy = points[0].y - points[points.length - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return { lengths, totalLength: total };
}

/**
 * Walk backward along a closed 3D track path by `distance` units from start.
 * Points must have { x, z } (3D world space).
 * Returns { x, z, angle }.
 */
export function walkBackFromStart(points, distance) {
  if (!points || points.length === 0) return { x: 0, z: 0, angle: 0 };
  let remaining = distance;
  for (let step = 0; step < points.length; step++) {
    const fromIdx = (points.length - step) % points.length;
    const toIdx = (points.length - step - 1 + points.length) % points.length;
    const pFrom = points[fromIdx];
    const pTo = points[toIdx];
    if (!pFrom || !pTo) continue;
    const dx = (pTo.x ?? 0) - (pFrom.x ?? 0);
    const dz = (pTo.z ?? 0) - (pFrom.z ?? 0);
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (remaining <= segLen && segLen > 0) {
      const t = remaining / segLen;
      const fwdAngle = Math.atan2(
        (pFrom.x ?? 0) - (pTo.x ?? 0),
        (pFrom.z ?? 0) - (pTo.z ?? 0)
      );
      return {
        x: (pFrom.x ?? 0) + dx * t,
        z: (pFrom.z ?? 0) + dz * t,
        angle: fwdAngle,
      };
    }
    remaining -= segLen;
  }
  return { x: points[0]?.x ?? 0, z: points[0]?.z ?? 0, angle: 0 };
}

/**
 * Compute total length of a 3D track path (closed loop).
 */
export function computeWorldTrackLength(pts3D) {
  let total = 0;
  for (let i = 1; i < pts3D.length; i++) {
    const dx = pts3D[i].x - pts3D[i - 1].x;
    const dz = pts3D[i].z - pts3D[i - 1].z;
    total += Math.sqrt(dx * dx + dz * dz);
  }
  if (pts3D.length > 1) {
    const dx = pts3D[0].x - pts3D[pts3D.length - 1].x;
    const dz = pts3D[0].z - pts3D[pts3D.length - 1].z;
    total += Math.sqrt(dx * dx + dz * dz);
  }
  return total;
}
