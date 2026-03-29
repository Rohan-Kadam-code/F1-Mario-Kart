/**
 * DriverSprite — Renders a driver kart on the track canvas.
 * Color-coded by team, with speed trails and position badge.
 */

/** Team color map (driver acronym -> team -> color) */
const TEAM_COLORS = {
  'Red Bull Racing': '#3671C6',
  'Ferrari': '#E8002D',
  'Mercedes': '#27F4D2',
  'McLaren': '#FF8000',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC',
  'Williams': '#64C4FF',
  'Haas F1 Team': '#B6BABD',
  'Kick Sauber': '#52E252',
  'RB': '#6692FF',
  // Fallbacks
  'default': '#999',
};

export function getTeamColor(teamName) {
  if (!teamName) return TEAM_COLORS.default;
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (teamName.toLowerCase().includes(key.toLowerCase())) return color;
  }
  // Partial matches
  if (teamName.toLowerCase().includes('red bull')) return TEAM_COLORS['Red Bull Racing'];
  if (teamName.toLowerCase().includes('sauber') || teamName.toLowerCase().includes('stake')) return TEAM_COLORS['Kick Sauber'];
  if (teamName.toLowerCase().includes('racing bulls') || teamName.toLowerCase().includes('alphatauri') || teamName.toLowerCase().includes('toro')) return TEAM_COLORS['RB'];
  return TEAM_COLORS.default;
}

export class DriverSprite {
  constructor(driverInfo) {
    this.number = driverInfo.driver_number;
    this.abbreviation = driverInfo.name_acronym || driverInfo.broadcast_name?.slice(0, 3)?.toUpperCase() || '???';
    this.fullName = driverInfo.full_name || driverInfo.broadcast_name || 'Unknown';
    this.teamName = driverInfo.team_name || '';
    this.teamColor = getTeamColor(this.teamName);
    this.position = 20;
    this.progress = 0;        // 0..1 around the track
    this.speed = 0;
    this.gap = '';
    this.tireCompound = '';
    this.cx = 0;
    this.cy = 0;
    this.angle = 0;

    // Trail history
    this.trail = [];
    this.maxTrail = 12;

    // Mario effects state
    this.hasStar = false;
    this.starTimer = 0;
    this.hasDRS = false;
    this.isPitting = false;
    this.isRetired = false;
  }

  updatePosition(cx, cy, angle) {
    // Record trail
    this.trail.push({ cx: this.cx, cy: this.cy });
    if (this.trail.length > this.maxTrail) this.trail.shift();

    this.cx = cx;
    this.cy = cy;
    this.angle = angle;
  }

  /**
   * Adjust screen coordinates when camera moves natively.
   */
  pan(dx, dy) {
    this.cx += dx;
    this.cy += dy;
    for (const pt of this.trail) {
      pt.cx += dx;
      pt.cy += dy;
    }
  }

  /**
   * Render this driver kart on the canvas.
   */
  draw(ctx, frameTime) {
    if (this.isRetired || this.isPitting) return;

    // Draw speed trail
    this._drawTrail(ctx);

    // Star power glow
    if (this.hasStar) {
      this._drawStarGlow(ctx, frameTime);
    }

    // DRS boost indicator
    if (this.hasDRS) {
      this._drawDRSBoost(ctx);
    }

    // Draw kart body
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.angle);

    // Kart body
    const w = 18, h = 10;
    ctx.fillStyle = this.teamColor;
    ctx.shadowColor = this.teamColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Windshield
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(4, -3, 4, 6);

    // Wheels
    ctx.fillStyle = '#111';
    ctx.fillRect(-w / 2 - 1, -h / 2 - 2, 5, 3);  // front-left
    ctx.fillRect(-w / 2 - 1, h / 2 - 1, 5, 3);    // rear-left
    ctx.fillRect(w / 2 - 4, -h / 2 - 2, 5, 3);    // front-right
    ctx.fillRect(w / 2 - 4, h / 2 - 1, 5, 3);      // rear-right

    ctx.restore();

    // Driver abbreviation label
    ctx.font = '600 9px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(this.abbreviation, this.cx, this.cy - 12);
    ctx.shadowBlur = 0;

    // Position badge
    this._drawPositionBadge(ctx);
  }

  _drawTrail(ctx) {
    if (this.trail.length < 2) return;
    for (let i = 0; i < this.trail.length - 1; i++) {
      const alpha = (i / this.trail.length) * 0.4;
      ctx.beginPath();
      ctx.arc(this.trail[i].cx, this.trail[i].cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = this.teamColor + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
    }
  }

  _drawPositionBadge(ctx) {
    const badgeX = this.cx + 14;
    const badgeY = this.cy - 8;

    if (this.isPitting) {
      // Pit badge — red "P"
      const text = 'P';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      const pw = 16;
      const ph = 14;

      ctx.fillStyle = '#e10600';
      ctx.beginPath();
      ctx.roundRect(badgeX - pw / 2, badgeY - ph / 2, pw, ph, 3);
      ctx.fill();

      // White border
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, badgeX, badgeY);
      ctx.textBaseline = 'alphabetic';
      return;
    }

    const text = '' + this.position;

    ctx.font = '700 8px "JetBrains Mono", monospace';
    const metrics = ctx.measureText(text);
    const pw = metrics.width + 6;
    const ph = 12;

    let badgeColor = '#333';
    if (this.position === 1) badgeColor = '#d4a017';
    else if (this.position === 2) badgeColor = '#888';
    else if (this.position === 3) badgeColor = '#8B5E3C';

    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(badgeX - pw / 2, badgeY - ph / 2, pw, ph, 3);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, badgeX, badgeY);
    ctx.textBaseline = 'alphabetic';
  }

  _drawStarGlow(ctx, frameTime) {
    const pulse = Math.sin(frameTime * 0.006) * 0.4 + 0.6;
    const colors = ['#ff0', '#f80', '#f00', '#0f0', '#08f', '#f0f'];
    const colorIdx = Math.floor(frameTime / 100) % colors.length;

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = colors[colorIdx] + '30';
    ctx.fill();
    ctx.strokeStyle = colors[colorIdx] + '80';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawDRSBoost(ctx) {
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.angle);

    // Boost arrow behind car
    ctx.fillStyle = 'rgba(168, 85, 247, 0.5)';
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-30, -6);
    ctx.lineTo(-26, 0);
    ctx.lineTo(-30, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
