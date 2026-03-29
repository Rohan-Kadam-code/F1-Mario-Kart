/**
 * ParticleSystem — Lightweight canvas particle engine.
 * Handles speed trails, boost sparkles, explosion bursts, rain, and confetti.
 */

class Particle {
  constructor(x, y, vx, vy, life, size, color, type = 'circle') {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.color = color;
    this.type = type;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.2;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    this.rotation += this.rotSpeed;

    // Gravity for some types
    if (this.type === 'confetti') {
      this.vy += 0.08;
      this.vx *= 0.99;
    }
  }

  get alpha() {
    return Math.max(0, this.life / this.maxLife);
  }

  get isDead() {
    return this.life <= 0;
  }
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].isDead) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;

      if (p.type === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -1, p.size, 2);
        ctx.fillRect(-1, -p.size / 2, 2, p.size);
      } else if (p.type === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.type === 'rain') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 2, p.y + p.vy * 2);
        ctx.stroke();
      } else if (p.type === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + (1 - p.alpha) * 2), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else if (p.type === 'spotlight') {
        const radius = p.size + (p.maxLife - p.life) * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = p.color;
        ctx.stroke();
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/g, `${0.2 * p.alpha})`); // inner glow
        ctx.fill();
      }

      ctx.restore();
    }
  }

  /** Emit a speed boost sparkle burst */
  emitBoost(x, y, color, count = 15) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        20 + Math.random() * 20,
        2 + Math.random() * 3,
        color,
        'spark'
      ));
    }
  }

  /** Emit a cinematic spotlight ring to draw attention */
  emitSpotlight(x, y, color = 'rgba(255, 200, 0, 0.8)') {
    this.particles.push(new Particle(
      x, y, 0, 0, 
      45, // frames life
      10, // initial size
      color,
      'spotlight'
    ));
  }

  /** Emit explosion burst (for retirement / blue shell) */
  emitExplosion(x, y, count = 30) {
    const colors = ['#ff4400', '#ff8800', '#ffcc00', '#fff', '#6692FF'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        30 + Math.random() * 30,
        3 + Math.random() * 5,
        colors[Math.floor(Math.random() * colors.length)],
        'circle'
      ));
    }
  }

  /** Emit confetti (for race finish / podium) */
  emitConfetti(canvasWidth, count = 60) {
    const colors = ['#e10600', '#fbbf24', '#00ff88', '#3671C6', '#FF8000', '#a855f7', '#fff'];
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(
        Math.random() * canvasWidth,
        -20,
        (Math.random() - 0.5) * 4,
        1 + Math.random() * 2,
        120 + Math.random() * 60,
        4 + Math.random() * 6,
        colors[Math.floor(Math.random() * colors.length)],
        'confetti'
      ));
    }
  }

  /** Emit rain particles */
  emitRain(canvasWidth, canvasHeight, count = 20) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(
        Math.random() * canvasWidth,
        Math.random() * canvasHeight * 0.1,
        -1,
        8 + Math.random() * 6,
        30 + Math.random() * 20,
        1,
        'rgba(100, 160, 255, 0.4)',
        'rain'
      ));
    }
  }

  /** Emit tire smoke */
  emitSmoke(x, y, count = 8) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * 10,
        y + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 0.5,
        -0.5 - Math.random() * 0.5,
        40 + Math.random() * 30,
        3 + Math.random() * 4,
        'rgba(180, 180, 180, 0.3)',
        'smoke'
      ));
    }
  }

  /** Emit star power sparkles around a driver */
  emitStarSparkle(x, y) {
    const colors = ['#ff0', '#f80', '#f00', '#0f0', '#08f', '#f0f'];
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 10;
      this.particles.push(new Particle(
        x + Math.cos(angle) * dist,
        y + Math.sin(angle) * dist,
        Math.cos(angle) * 0.5,
        Math.sin(angle) * 0.5,
        15 + Math.random() * 10,
        2 + Math.random() * 2,
        colors[Math.floor(Math.random() * colors.length)],
        'spark'
      ));
    }
  }

  clear() {
    this.particles = [];
  }

  get count() {
    return this.particles.length;
  }
}
