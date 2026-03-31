/**
 * MiniMap — Real-time 2D top-down overview of the track and karts.
 * Renders an SVG or Canvas HUD overlay with team-colored driver dots.
 */
export class MiniMap {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.trackPoints = [];
    this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.padding = 10;
    this.scale = 1;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setTrackData(points) {
    this.trackPoints = points || [];
    if (this.trackPoints.length === 0) return;

    // Calculate bounds for normalized rendering
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.trackPoints.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });

    this.bounds = { minX, minY, maxX, maxY };
    this.drawStaticTrack();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.drawStaticTrack();
  }

  /** Normalise track/kart coordinates to canvas space */
  _mapCoord(x, y) {
    const w = this.canvas.width / window.devicePixelRatio;
    const h = this.canvas.height / window.devicePixelRatio;
    
    const rangeX = this.bounds.maxX - this.bounds.minX || 1;
    const rangeY = this.bounds.maxY - this.bounds.minY || 1;
    
    const aspect = rangeX / rangeY;
    const canvasAspect = w / h;
    
    let drawW, drawH;
    if (aspect > canvasAspect) {
      drawW = w - this.padding * 2;
      drawH = drawW / aspect;
    } else {
      drawH = h - this.padding * 2;
      drawW = drawH * aspect;
    }

    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    const nx = (x - this.bounds.minX) / rangeX;
    const ny = (y - this.bounds.minY) / rangeY;

    // Flip Y for screen space (Wait, in our SceneManager, top-down is Y)
    // Actually, trackPoints2D are already in projected space.
    return {
      x: offsetX + nx * drawW,
      y: offsetY + (1 - ny) * drawH // Flip for screen Y
    };
  }

  drawStaticTrack() {
    if (this.trackPoints.length < 2) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const p0 = this._mapCoord(this.trackPoints[0].x, this.trackPoints[0].y);
    this.ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < this.trackPoints.length; i++) {
      const p = this._mapCoord(this.trackPoints[i].x, this.trackPoints[i].y);
      this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
    
    // Cache the background
    this.bgImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  update(karts, trackedDriverNum) {
    if (this.trackPoints.length < 2) return;
    
    // Clear dynamic layer
    this.ctx.clearRect(0, 0, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);

    // 1. Draw static track shape as background
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    const p0t = this._mapCoord(this.trackPoints[0].x, this.trackPoints[0].y);
    this.ctx.moveTo(p0t.x, p0t.y);
    for (let i = 1; i < this.trackPoints.length; i++) {
        const p = this._mapCoord(this.trackPoints[i].x, this.trackPoints[i].y);
        this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.closePath();
    this.ctx.stroke();

    // 2. Draw Karts
    const sm = window.sceneManager;
    if (!sm) return;
    for (const kart of karts.values()) {
      if (!kart.mesh.visible) continue;

      // Extract 2D projected coords from world (X, Z) back to (X, Y)
      // Reciprocal of SceneManager.toWorldCoords:
      // xWorld = (x - centerX) * scale  =>  x = (xWorld / scale) + centerX
      // zWorld = -(y - centerY) * scale =>  y = -(zWorld / scale) + centerY
      const sm = kart._sceneManagerReference || window.sceneManager; // Fallback
      if (!sm) continue;

      const trackX = (kart.mesh.position.x / sm._trackScale) + sm._trackCenterX;
      const trackY = -(kart.mesh.position.z / sm._trackScale) + sm._trackCenterY;

      const p = this._mapCoord(trackX, trackY);
      const isTracked = kart.driverNumber === trackedDriverNum;

      // Draw dot
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, isTracked ? 6 : 4, 0, Math.PI * 2);
      this.ctx.fillStyle = kart.teamColor;
      this.ctx.fill();
      
      // Add a subtle stroke to all dots for better definition on the dark track
      this.ctx.strokeStyle = isTracked ? '#fff' : 'rgba(255,255,255,0.3)';
      this.ctx.lineWidth = isTracked ? 2 : 1;
      this.ctx.stroke();
    }
  }
}
