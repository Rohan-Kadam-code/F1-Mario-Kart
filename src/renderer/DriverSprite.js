/**
 * DriverSprite — Renders a driver kart on the track canvas.
 * Color-coded by team, with speed trails and position badge.
 */

/** Team color map (refined by season for 2023-2026) */
const TEAM_COLORS = {
  // 2026 & Generic
  'Red Bull Racing': '#3671C6',
  'Ferrari': '#E8002D',
  'Mercedes': '#27F4D2',
  'McLaren': '#FF8000',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC',
  'Williams': '#64C4FF',
  'Haas F1 Team': '#F10F2E',
  'Kick Sauber': '#52E252',
  'RB': '#6692FF',
  'Audi': '#E00000',
  'Cadillac': '#FFD700',
  
  // Historical Overrides
  '2023_Mercedes': '#C0C0C0', // Silver
  '2024_Mercedes': '#000000', // Black
  '2023_Sauber': '#A00000',   // Alfa Romeo Red
  '2023_RB': '#00293F',       // AlphaTauri Navy
  
  'default': '#999',
};

export function getTeamColor(teamName, year = 2026) {
  if (!teamName) return TEAM_COLORS.default;
  
  const tn = teamName.toLowerCase();
  
  // Year-specific overrides
  if (year === 2023) {
    if (tn.includes('mercedes')) return TEAM_COLORS['2023_Mercedes'];
    if (tn.includes('sauber') || tn.includes('alfa romeo')) return TEAM_COLORS['2023_Sauber'];
    if (tn.includes('alphatauri') || tn.includes('toro')) return TEAM_COLORS['2023_RB'];
  } else if (year === 2024) {
    if (tn.includes('mercedes')) return TEAM_COLORS['2024_Mercedes'];
  }

  // Current / Standard colors
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (key.includes('_')) continue; // Skip historical markers
    if (tn.includes(key.toLowerCase())) return color;
  }
  
  // Partial matches & 2026 New Entries
  if (tn.includes('red bull')) return TEAM_COLORS['Red Bull Racing'];
  if (tn.includes('kick') || tn.includes('stake') || (tn.includes('sauber') && year < 2026)) return TEAM_COLORS['Kick Sauber'];
  if (tn.includes('audi') || (tn.includes('sauber') && year >= 2026)) return TEAM_COLORS['Audi'];
  if (tn.includes('cadillac') || tn.includes('andretti')) return TEAM_COLORS['Cadillac'];
  if (tn.includes('haas') || tn.includes('hass')) return TEAM_COLORS['Haas F1 Team'];
  if (tn.includes('racing bulls') || tn.includes('rb')) return TEAM_COLORS['RB'];
  
  return TEAM_COLORS.default;
}

export class DriverSprite {
  constructor(driverInfo, year = 2026) {
    this.number = driverInfo.driver_number;
    this.abbreviation = driverInfo.name_acronym || driverInfo.broadcast_name?.slice(0, 3)?.toUpperCase() || '???';
    this.fullName = driverInfo.full_name || driverInfo.broadcast_name || 'Unknown';
    this.teamName = driverInfo.team_name || '';
    this.teamColor = getTeamColor(this.teamName, year);
    this.position = 20;
    this.progress = 0;        // 0..1 around the track
    this.speed = 0;
    this.gap = '';
    this.tireCompound = '';
    this.cx = 0;
    this.cy = 0;
    this.angle = 0;
    this.year = year;

    // Trail history
    this.trail = [];
    this.maxTrail = 12;

    // Mario effects state
    this.hasStar = false;
    this.starTimer = 0;
    this.hasDRS = false;
    this.hasMushroom = false; // Battery boost animation
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

    // DRS / Mushroom boost indicators
    if (this.hasDRS || this.hasMushroom) {
      this._drawDRSBoost(ctx);
      this._drawMushroom(ctx, frameTime);
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

  _drawMushroom(ctx, frameTime) {
    const bounce = Math.sin(frameTime * 0.01) * 3 - 18;
    const mx = this.cx;
    const my = this.cy + bounce;

    ctx.save();
    ctx.translate(mx, my);

    // Mushroom Cap (Red)
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(0, 0, 8, Math.PI, 0);
    ctx.fill();

    // White Spots
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-3, -3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -1, 1.5, 0, Math.PI * 2); ctx.fill();

    // Mushroom Stem
    ctx.fillStyle = '#fce4ec';
    ctx.beginPath();
    ctx.roundRect(-4, 0, 8, 5, 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(-1.5, 1, 1, 2);
    ctx.fillRect(0.5, 1, 1, 2);

    ctx.restore();
  }
}
