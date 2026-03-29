/**
 * TrackRenderer — Draws the race circuit on a canvas.
 *
 * Two data paths:
 *   1. setCircuitData(circuit) — Uses pre-built GeoJSON lat/lng coordinates
 *      with pit lane, DRS zones, sectors, and proper track width.
 *   2. setTrackData(locationPoints) — Legacy: extracts a single lap from
 *      OpenF1 telemetry x/y data (fallback if no circuit match).
 *
 * Features:
 *   - Zoom (scroll wheel) and pan (drag)
 *   - Simple pit lane as adjacent track
 *   - DRS zone highlights
 *   - Sector markers
 */

export class TrackRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Track geometry (canvas-projected)
    this.trackPoints = [];     // [{x, y}] — main circuit centerline
    this.pitLanePoints = [];   // [{x, y}] — pit lane centerline
    this.pitLaneLengths = [];  // cumulative arc lengths for pit lane
    this.pitLaneTotalLength = 0;
    this.trackBounds = null;
    this.trackLengths = [];    // cumulative arc lengths
    this.totalLength = 0;

    // View transform
    this.baseScale = 1;         // scale computed from bounds
    this.baseOffsetX = 0;
    this.baseOffsetY = 0;
    this.zoom = 1;              // user zoom multiplier
    this.panX = 0;              // user pan offset (pixels)
    this.panY = 0;
    
    // Tracking state
    this.trackingX = null;
    this.trackingY = null;

    // Drag state
    this._isDragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragPanStartX = 0;
    this._dragPanStartY = 0;

    // Track metadata
    this.trackWidth = 28;
    this.pitLaneWidth = 20;
    this.circuitData = null;
    this.isGeoData = false;
    this.drsZones = [];
    this.sectorIndices = [];
    this.pitEntryIdx = 0;
    this.pitExitIdx = 0;

    // Bind event handlers
    this._onWheel = this._onWheel.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._setupInteraction();
  }

  /* =============================================
     Zoom & Pan Interaction
     ============================================= */

  _setupInteraction() {
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(5, this.zoom * delta));

    // Zoom toward mouse position
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Adjust pan so zoom centers on mouse
    this.panX = mx - (mx - this.panX) * (newZoom / this.zoom);
    this.panY = my - (my - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._isDragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._dragPanStartX = this.panX;
    this._dragPanStartY = this.panY;
    this.canvas.style.cursor = 'grabbing';
    
    // Break tracking lock if user manually drags map
    this.trackingX = null;
    this.trackingY = null;
    window.dispatchEvent(new CustomEvent('track-pan-break'));
  }

  _onMouseMove(e) {
    if (!this._isDragging) return;
    this.panX = this._dragPanStartX + (e.clientX - this._dragStartX);
    this.panY = this._dragPanStartY + (e.clientY - this._dragStartY);
  }

  _onMouseUp() {
    this._isDragging = false;
    this.canvas.style.cursor = 'grab';
  }

  /** Reset zoom and pan to default */
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  /** Programmatic zoom in/out */
  zoomIn() {
    this.zoom = Math.min(5, this.zoom * 1.25);
  }

  zoomOut() {
    this.zoom = Math.max(0.5, this.zoom * 0.8);
  }

  /** Dynamically lock camera pan to a specific track coordinate */
  setTrackingFocus(x, y) {
    this.trackingX = x;
    this.trackingY = y;
    
    const w = this.canvas.clientWidth / 2;
    const h = this.canvas.clientHeight / 2;
    const cx_raw = x * this.baseScale + this.baseOffsetX;
    const cy_raw = -(y * this.baseScale) + this.baseOffsetY;
    
    // Force panX/panY to center the target coordinate
    this.panX = -(cx_raw - w) * this.zoom;
    this.panY = -(cy_raw - h) * this.zoom;
  }

  /* =============================================
     Data Loading
     ============================================= */

  setCircuitData(circuit) {
    if (!circuit || !circuit.trackCoords || circuit.trackCoords.length < 10) return;

    this.circuitData = circuit;
    this.isGeoData = true;

    this.trackPoints = circuit.trackCoords.map(([lng, lat]) =>
      this._projectLatLng(lng, lat)
    );

    if (circuit.pitLane && circuit.pitLane.length > 2) {
      this.pitLanePoints = circuit.pitLane.map(([lng, lat]) =>
        this._projectLatLng(lng, lat)
      );
    } else {
      this.pitLanePoints = [];
    }

    if (circuit.drsZones) {
      this.drsZones = circuit.drsZones.map(zone => ({
        startIdx: Math.floor(zone.start * this.trackPoints.length),
        endIdx: Math.floor(zone.end * this.trackPoints.length),
      }));
    }

    if (circuit.sectors) {
      this.sectorIndices = circuit.sectors.map(
        frac => Math.floor(frac * this.trackPoints.length)
      );
    }

    this.pitEntryIdx = Math.floor((circuit.pitEntryTrackFraction || 0) * this.trackPoints.length);
    this.pitExitIdx = Math.floor((circuit.pitExitTrackFraction || 0) * this.trackPoints.length);

    this._computeBounds();
    this._computeArcLengths();
    this._computePitLaneArcLengths();
    this._computeTransform();

    // Reset view on new circuit
    this.resetView();
  }

  setTrackData(locationPoints) {
    if (!locationPoints || locationPoints.length < 20) return;

    this.isGeoData = false;
    this.circuitData = null;
    this.pitLanePoints = [];
    this.drsZones = [];
    this.sectorIndices = [];

    const step = Math.max(1, Math.floor(locationPoints.length / 4000));
    const sampled = [];
    for (let i = 0; i < locationPoints.length; i += step) {
      const p = locationPoints[i];
      if (p.x !== undefined && p.y !== undefined) {
        sampled.push({ x: p.x, y: p.y });
      }
    }
    if (sampled.length < 50) return;

    const startIdx = Math.floor(sampled.length * 0.05);
    const startPt = sampled[startIdx];
    const closeDist = this._estimateTrackScale(sampled) * 0.06;

    let lapPoints = [];
    let bestLap = null;

    for (let i = startIdx; i < sampled.length; i++) {
      lapPoints.push(sampled[i]);
      if (lapPoints.length > 80) {
        const dx = sampled[i].x - startPt.x;
        const dy = sampled[i].y - startPt.y;
        if (Math.sqrt(dx * dx + dy * dy) < closeDist) {
          if (!bestLap || lapPoints.length > 100) {
            bestLap = [...lapPoints];
            break;
          }
        }
      }
      if (lapPoints.length > sampled.length * 0.3) {
        bestLap = lapPoints;
        break;
      }
    }

    if (!bestLap || bestLap.length < 50) {
      const segLen = Math.min(500, Math.floor(sampled.length / 5));
      bestLap = sampled.slice(0, segLen);
    }

    const filtered = [bestLap[0]];
    for (let i = 1; i < bestLap.length; i++) {
      const dx = bestLap[i].x - filtered[filtered.length - 1].x;
      const dy = bestLap[i].y - filtered[filtered.length - 1].y;
      if (Math.sqrt(dx * dx + dy * dy) > 2) {
        filtered.push(bestLap[i]);
      }
    }

    const smooth = [];
    const w = 4;
    for (let i = 0; i < filtered.length; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let j = -w; j <= w; j++) {
        const idx = (i + j + filtered.length) % filtered.length;
        sx += filtered[idx].x;
        sy += filtered[idx].y;
        c++;
      }
      smooth.push({ x: sx / c, y: sy / c });
    }

    this.trackPoints = smooth;
    this._computeBounds();
    this._computeArcLengths();
    this.resetView();
  }

  /* =============================================
     Projection & Geometry
     ============================================= */

  _projectLatLng(lng, lat) {
    const DEG2RAD = Math.PI / 180;
    const R = 6378137;
    return {
      x: R * lng * DEG2RAD,
      y: R * Math.log(Math.tan(Math.PI / 4 + lat * DEG2RAD / 2)),
    };
  }

  _estimateTrackScale(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return Math.max(maxX - minX, maxY - minY);
  }

  _computeBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.trackPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    for (const p of this.pitLanePoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.trackBounds = { minX, maxX, minY, maxY };
  }

  _computeArcLengths() {
    this.trackLengths = [0];
    let total = 0;
    for (let i = 1; i < this.trackPoints.length; i++) {
      const dx = this.trackPoints[i].x - this.trackPoints[i - 1].x;
      const dy = this.trackPoints[i].y - this.trackPoints[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
      this.trackLengths.push(total);
    }
    const dx = this.trackPoints[0].x - this.trackPoints[this.trackPoints.length - 1].x;
    const dy = this.trackPoints[0].y - this.trackPoints[this.trackPoints.length - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    this.totalLength = total;
  }

  _computePitLaneArcLengths() {
    if (this.pitLanePoints.length < 2) {
      this.pitLaneLengths = [];
      this.pitLaneTotalLength = 0;
      return;
    }
    this.pitLaneLengths = [0];
    let total = 0;
    for (let i = 1; i < this.pitLanePoints.length; i++) {
      const dx = this.pitLanePoints[i].x - this.pitLanePoints[i - 1].x;
      const dy = this.pitLanePoints[i].y - this.pitLanePoints[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
      this.pitLaneLengths.push(total);
    }
    this.pitLaneTotalLength = total;
  }

  /* =============================================
     Canvas Transform
     ============================================= */

  resize() {
    const container = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = container.clientWidth * dpr;
    this.canvas.height = container.clientHeight * dpr;
    this.canvas.style.width = container.clientWidth + 'px';
    this.canvas.style.height = container.clientHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._computeTransform();
    this.canvas.style.cursor = 'grab';
  }

  _computeTransform() {
    if (!this.trackBounds) return;
    const { minX, maxX, minY, maxY } = this.trackBounds;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const padding = 60;

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    this.baseScale = Math.min((w - padding * 2) / rangeX, (h - padding * 2) / rangeY);
    this.baseOffsetX = (w - rangeX * this.baseScale) / 2 - minX * this.baseScale;
    this.baseOffsetY = (h + rangeY * this.baseScale) / 2 + minY * this.baseScale;

    // Compute pixel track width
    if (this.isGeoData && this.circuitData) {
      const actualScale = this.baseScale;
      const trackWidthProjected = this.circuitData.trackWidthM;
      this.trackWidth = Math.max(12, Math.min(50, trackWidthProjected * actualScale));
      this.pitLaneWidth = Math.max(8, this.trackWidth * 0.7);
    }
  }

  /** Convert track coords to canvas pixel coords (Y-flipped for lat, with zoom+pan) */
  toCanvas(x, y) {
    const s = this.baseScale * this.zoom;
    const cx = x * this.baseScale + this.baseOffsetX;
    const cy = -(y * this.baseScale) + this.baseOffsetY;

    // Apply zoom from canvas center, then pan
    const w = this.canvas.clientWidth / 2;
    const h = this.canvas.clientHeight / 2;
    return {
      cx: (cx - w) * this.zoom + w + this.panX,
      cy: (cy - h) * this.zoom + h + this.panY,
    };
  }

  /* =============================================
     Drawing Methods
     ============================================= */

  drawTrack() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // Background
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, '#111118');
    bg.addColorStop(1, '#08080c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (this.trackPoints.length < 3) return;

    const tw = this.trackWidth * this.zoom;

    // 1. Grass runoff
    this._strokeTrack(ctx, tw + 22 * this.zoom, '#193319');
    // 2. Gravel trap
    this._strokeTrack(ctx, tw + 14 * this.zoom, '#2a2518');
    // 3. Kerbs
    this._strokeTrackDashed(ctx, tw + 8 * this.zoom, '#cc2200', '#fff', 10, 10);
    // 4. Asphalt
    this._strokeTrack(ctx, tw, '#333338');
    // 5. Center line
    this._strokeTrackDashed(ctx, 1, 'rgba(255,255,255,0.07)', null, 14, 18);

    // 6. DRS zones
    if (this.drsZones.length > 0) this._drawDRSZones(ctx, tw);

    // 7. Finish line
    this._drawFinishLine(ctx, tw);

    // 8. Sector markers
    this._drawSectorMarkers(ctx, tw);

    // 9. Circuit name
    if (this.circuitData) this._drawCircuitName(ctx, w, h);

    // 10. Zoom indicator
    this._drawZoomIndicator(ctx, w, h);

    // 11. HUD Minimap (Always shown if tracking OR zoomed in)
    if (this.trackingX !== null || this.zoom > 1.2) {
      this._drawMinimap(ctx, w, h);
    }
  }

  isPointInPitLane(x, y) {
    if (this.pitLanePoints.length < 2) return false;

    // Quick tolerance check
    const tolSq = 30 * 30; 
    let minPitDistSq = Infinity;

    for (const p of this.pitLanePoints) {
      const distSq = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (distSq < minPitDistSq) minPitDistSq = distSq;
    }

    if (minPitDistSq > tolSq) return false;

    // If we are near the pitlane, we must also ensure we are CLOSER to the pitlane 
    // than we are to the main track. This prevents false positives on the main straight.
    let minTrackDistSq = Infinity;
    for (const p of this.trackPoints) {
      const distSq = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (distSq < minTrackDistSq) minTrackDistSq = distSq;
    }

    return minPitDistSq < minTrackDistSq;
  }

  _strokeTrack(ctx, width, color) {
    ctx.beginPath();
    const first = this.toCanvas(this.trackPoints[0].x, this.trackPoints[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < this.trackPoints.length; i++) {
      const p = this.toCanvas(this.trackPoints[i].x, this.trackPoints[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  _strokeTrackDashed(ctx, width, color1, color2, dashOn, dashOff) {
    ctx.beginPath();
    const first = this.toCanvas(this.trackPoints[0].x, this.trackPoints[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < this.trackPoints.length; i++) {
      const p = this.toCanvas(this.trackPoints[i].x, this.trackPoints[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([dashOn, dashOff]);
    ctx.stroke();

    if (color2) {
      ctx.strokeStyle = color2;
      ctx.lineDashOffset = dashOn;
      ctx.stroke();
      ctx.lineDashOffset = 0;
    }
    ctx.setLineDash([]);
  }

  /** Draw DRS zones as green overlay */
  _drawDRSZones(ctx, tw) {
    for (const zone of this.drsZones) {
      ctx.beginPath();
      const startIdx = zone.startIdx % this.trackPoints.length;
      const endIdx = zone.endIdx % this.trackPoints.length;

      let i = startIdx;
      const first = this.toCanvas(this.trackPoints[i].x, this.trackPoints[i].y);
      ctx.moveTo(first.cx, first.cy);

      const count = this.trackPoints.length;
      let steps = 0;
      while (i !== endIdx && steps < count) {
        i = (i + 1) % count;
        const p = this.toCanvas(this.trackPoints[i].x, this.trackPoints[i].y);
        ctx.lineTo(p.cx, p.cy);
        steps++;
      }

      ctx.lineWidth = tw - 4;
      ctx.strokeStyle = 'rgba(0, 200, 83, 0.25)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Start marker
      const sp = this.toCanvas(this.trackPoints[startIdx].x, this.trackPoints[startIdx].y);
      ctx.beginPath();
      ctx.arc(sp.cx, sp.cy, 4 * this.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#00c853';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Draw pit lane as a simple adjacent track (same style, slightly thinner) */
  _drawPitLane(ctx, tw) {
    const pts = this.pitLanePoints;
    const ptw = tw * 0.65; // pit lane is thinner than main track

    // Kerb edge
    ctx.beginPath();
    let first = this.toCanvas(pts[0].x, pts[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const p = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.lineWidth = ptw + 4 * this.zoom;
    ctx.strokeStyle = '#444450';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Asphalt surface
    ctx.beginPath();
    first = this.toCanvas(pts[0].x, pts[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const p = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.lineWidth = ptw;
    ctx.strokeStyle = '#2a2a30';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Speed limit line (dashed white center)
    ctx.beginPath();
    first = this.toCanvas(pts[0].x, pts[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const p = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([6, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawFinishLine(ctx, tw) {
    if (this.trackPoints.length < 2) return;
    const p0 = this.toCanvas(this.trackPoints[0].x, this.trackPoints[0].y);
    const p1 = this.toCanvas(this.trackPoints[1].x, this.trackPoints[1].y);
    const angle = Math.atan2(p1.cy - p0.cy, p1.cx - p0.cx) + Math.PI / 2;
    const halfW = tw / 2 + 4;

    ctx.save();
    ctx.translate(p0.cx, p0.cy);
    ctx.rotate(angle);

    const cellSize = Math.max(3, 5 * this.zoom);
    const rows = 3;
    const cols = Math.floor(halfW * 2 / cellSize);
    ctx.translate(-halfW, -Math.floor(rows / 2) * cellSize);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#222';
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
    ctx.restore();
  }

  _drawSectorMarkers(ctx, tw) {
    if (this.isGeoData && this.sectorIndices.length > 0) {
      const colors = ['#e10600', '#0066ff'];
      const labels = ['S1/S2', 'S2/S3'];

      this.sectorIndices.forEach((idx, i) => {
        if (idx >= 0 && idx < this.trackPoints.length) {
          const p = this.toCanvas(this.trackPoints[idx].x, this.trackPoints[idx].y);
          const prevIdx = Math.max(0, idx - 1);
          const nextIdx = Math.min(this.trackPoints.length - 1, idx + 1);
          const pp = this.toCanvas(this.trackPoints[prevIdx].x, this.trackPoints[prevIdx].y);
          const pn = this.toCanvas(this.trackPoints[nextIdx].x, this.trackPoints[nextIdx].y);
          const angle = Math.atan2(pn.cy - pp.cy, pn.cx - pp.cx) + Math.PI / 2;
          const halfW = tw / 2 + 2;

          ctx.beginPath();
          ctx.moveTo(p.cx - Math.cos(angle) * halfW, p.cy - Math.sin(angle) * halfW);
          ctx.lineTo(p.cx + Math.cos(angle) * halfW, p.cy + Math.sin(angle) * halfW);
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.font = `600 ${Math.max(7, 8 * this.zoom)}px "Outfit", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = colors[i];
          ctx.fillText(labels[i], p.cx, p.cy - halfW - 4);
        }
      });
    } else {
      const count = this.trackPoints.length;
      const sectors = [Math.floor(count / 3), Math.floor(count * 2 / 3)];
      const colors = ['#e10600', '#0066ff'];

      sectors.forEach((idx, i) => {
        const p = this.toCanvas(this.trackPoints[idx].x, this.trackPoints[idx].y);
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 4 * this.zoom, 0, Math.PI * 2);
        ctx.fillStyle = colors[i];
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  _drawCircuitName(ctx, w, h) {
    ctx.save();
    ctx.font = '700 13px "Outfit", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(this.circuitData.name, w - 16, h - 30);
    ctx.font = '400 10px "Outfit", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    const lenKm = (this.circuitData.lengthM / 1000).toFixed(3);
    ctx.fillText(`${lenKm} km  •  ${this.circuitData.location}, ${this.circuitData.country}`, w - 16, h - 14);
    ctx.restore();
  }

  /** Small zoom level indicator in top-right of canvas */
  _drawZoomIndicator(ctx, w, h) {
    if (Math.abs(this.zoom - 1) < 0.01 && Math.abs(this.panX) < 1 && Math.abs(this.panY) < 1) return;

    ctx.save();
    ctx.font = '500 10px "Outfit", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText(`${Math.round(this.zoom * 100)}%`, w - 12, 8);

    // Reset hint
    ctx.font = '400 9px "Outfit", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillText('Scroll to zoom • Drag to pan', w - 12, 22);
    ctx.restore();
  }

  /** Mini HUD Map Overlay */
  _drawMinimap(ctx, w, h) {
    if (this.trackPoints.length < 2 || !this.trackBounds) return;
    
    const mapSize = 140; 
    const padding = 10;
    const margin = 20;
    const startX = w - mapSize - margin;
    const startY = h - mapSize - margin - 50; // Above circuit name
    
    // Map background
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(startX, startY, mapSize, mapSize, 8);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();
    ctx.clip();
    
    // Calculate mini scale
    const { minX, maxX, minY, maxY } = this.trackBounds;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const miniScale = Math.min((mapSize - padding * 2) / rangeX, (mapSize - padding * 2) / rangeY);
    const miniOffX = startX + (mapSize - rangeX * miniScale) / 2 - minX * miniScale;
    const miniOffY = startY + (mapSize + rangeY * miniScale) / 2 + minY * miniScale;

    const toMiniCanvas = (x, y) => ({
      cx: x * miniScale + miniOffX,
      cy: -(y * miniScale) + miniOffY
    });

    // Draw main track shape
    ctx.beginPath();
    let first = toMiniCanvas(this.trackPoints[0].x, this.trackPoints[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < this.trackPoints.length; i++) {
        const p = toMiniCanvas(this.trackPoints[i].x, this.trackPoints[i].y);
        ctx.lineTo(p.cx, p.cy);
    }
    ctx.closePath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw tracking dot if active
    if (this.trackingX !== null) {
      const p = toMiniCanvas(this.trackingX, this.trackingY);
      
      // Outer ping
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(225, 6, 0, 0.4)';
      ctx.fill();
      
      // Inner dot
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6b35';
      ctx.fill();
    }
    
    // Draw current viewport bounds mapping
    if (this.zoom > 1) {
      // Map the 4 corners of the canvas back to un-transformed coordinates, then to minimap
      const cwCenterRaw = (w / 2 - this.panX) / this.zoom;
      const chCenterRaw = (h / 2 - this.panY) / this.zoom;
      
      const tlRaw_cx = cwCenterRaw - (w / 2) / this.zoom;
      const tlRaw_cy = chCenterRaw - (h / 2) / this.zoom;
      const brRaw_cx = cwCenterRaw + (w / 2) / this.zoom;
      const brRaw_cy = chCenterRaw + (h / 2) / this.zoom;
      
      // Inverse of raw projection
      const getRawCoords = (c_x, c_y) => {
        return {
           x: (c_x - this.baseOffsetX) / this.baseScale,
           y: -(c_y - this.baseOffsetY) / this.baseScale
        };
      };
      
      const tl = getRawCoords(tlRaw_cx, tlRaw_cy);
      const br = getRawCoords(brRaw_cx, brRaw_cy);
      const miniTL = toMiniCanvas(tl.x, tl.y);
      const miniBR = toMiniCanvas(br.x, br.y);
      
      // Draw standard box
      ctx.beginPath();
      ctx.rect(miniTL.cx, miniTL.cy, miniBR.cx - miniTL.cx, miniBR.cy - miniTL.cy);
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    ctx.restore();
  }

  /* =============================================
     Position Interpolation
     ============================================= */

  /** Main track position for progress 0..1 */
  getPositionOnTrack(progress) {
    if (this.trackPoints.length === 0) return { cx: 0, cy: 0, angle: 0 };

    const p = ((progress % 1) + 1) % 1;
    const targetLen = p * this.totalLength;

    let lo = 0, hi = this.trackLengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.trackLengths[mid] < targetLen) lo = mid + 1;
      else hi = mid;
    }

    const i0 = Math.max(0, lo - 1);
    const i1 = lo < this.trackPoints.length ? lo : 0;

    const segStart = this.trackLengths[i0] || 0;
    const segEnd = i1 < this.trackLengths.length
      ? this.trackLengths[i1]
      : this.totalLength;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (targetLen - segStart) / segLen : 0;

    const pt0 = this.trackPoints[i0];
    const pt1 = this.trackPoints[i1 < this.trackPoints.length ? i1 : 0];

    const x = pt0.x + (pt1.x - pt0.x) * t;
    const y = pt0.y + (pt1.y - pt0.y) * t;

    const angle = Math.atan2(pt1.y - pt0.y, pt1.x - pt0.x);

    return { ...this.toCanvas(x, y), angle };
  }

  /** Pit lane position for progress 0..1 along the pit lane */
  getPositionOnPitLane(progress) {
    if (this.pitLanePoints.length < 2) return this.getPositionOnTrack(0);

    const p = Math.max(0, Math.min(1, progress));
    const targetLen = p * this.pitLaneTotalLength;

    let lo = 0, hi = this.pitLaneLengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pitLaneLengths[mid] < targetLen) lo = mid + 1;
      else hi = mid;
    }

    const i0 = Math.max(0, lo - 1);
    const i1 = Math.min(lo, this.pitLanePoints.length - 1);

    const segStart = this.pitLaneLengths[i0] || 0;
    const segEnd = this.pitLaneLengths[i1] || this.pitLaneTotalLength;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (targetLen - segStart) / segLen : 0;

    const pt0 = this.pitLanePoints[i0];
    const pt1 = this.pitLanePoints[i1];

    const x = pt0.x + (pt1.x - pt0.x) * t;
    const y = pt0.y + (pt1.y - pt0.y) * t;
    const angle = Math.atan2(pt1.y - pt0.y, pt1.x - pt0.x);

    return { ...this.toCanvas(x, y), angle };
  }

  /** Clear canvas for next frame */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}
