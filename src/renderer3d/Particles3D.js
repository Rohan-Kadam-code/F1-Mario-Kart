/**
 * Particles3D — GPU-accelerated particle system using THREE.Points.
 * Handles boost sparkles, explosions, confetti, rain, smoke, and star sparkles.
 */
import * as THREE from 'three';

const MAX_PARTICLES = 2000;

class Particle3D {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.life = 0; this.maxLife = 1;
    this.size = 1;
    this.r = 1; this.g = 1; this.b = 1;
    this.type = 'circle';
    this.active = false;
  }
  get alpha() { return Math.max(0, this.life / this.maxLife); }
}

export class Particles3D {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) this.pool.push(new Particle3D());

    // Buffer geometry for GPU points
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 4);
    this.sizes = new Float32Array(MAX_PARTICLES);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Custom shader material for round, glowing particles
    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (150.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = vColor.a * smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(vColor.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Rain lines (separate mesh)
    this.rainLines = [];
    this.rainGroup = new THREE.Group();
    scene.add(this.rainGroup);

    this.activeCount = 0;
  }

  _getParticle() {
    for (const p of this.pool) {
      if (!p.active) { p.active = true; return p; }
    }
    return null; // pool exhausted
  }

  update() {
    let count = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      p.life--;

      if (p.type === 'confetti') { p.vy -= 0.02; p.vx *= 0.99; }
      if (p.type === 'smoke') { p.vy += 0.01; }

      if (p.life <= 0) { p.active = false; continue; }

      const i = count;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 4] = p.r;
      this.colors[i * 4 + 1] = p.g;
      this.colors[i * 4 + 2] = p.b;
      this.colors[i * 4 + 3] = p.alpha;
      this.sizes[i] = p.size * p.alpha;
      count++;
    }

    // Zero out remaining
    for (let i = count; i < this.activeCount; i++) {
      this.sizes[i] = 0;
      this.colors[i * 4 + 3] = 0;
    }

    this.activeCount = count;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.setDrawRange(0, count);
  }

  /* ── Emitters ── */

  emitBoost(x, y, z, color, count = 15) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const p = this._getParticle(); if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const s = 0.3 + Math.random() * 0.8;
      p.x = x; p.y = y + 1; p.z = z;
      p.vx = Math.cos(a) * s; p.vy = Math.random() * 0.5; p.vz = Math.sin(a) * s;
      p.life = 20 + Math.random() * 20; p.maxLife = p.life;
      p.size = 2 + Math.random() * 3;
      p.r = c.r; p.g = c.g; p.b = c.b;
      p.type = 'spark';
    }
  }

  emitSpotlight(x, y, z, color = '#ffcc00') {
    const c = new THREE.Color(color);
    for (let i = 0; i < 8; i++) {
      const p = this._getParticle(); if (!p) return;
      const a = Math.random() * Math.PI * 2;
      p.x = x; p.y = y + 2; p.z = z;
      p.vx = Math.cos(a) * 0.15; p.vy = 0.3 + Math.random() * 0.3; p.vz = Math.sin(a) * 0.15;
      p.life = 40; p.maxLife = 40;
      p.size = 5 + Math.random() * 5;
      p.r = c.r; p.g = c.g; p.b = c.b;
    }
  }

  emitExplosion(x, y, z, count = 30) {
    const colors = [
      new THREE.Color('#ff4400'), new THREE.Color('#ff8800'),
      new THREE.Color('#ffcc00'), new THREE.Color('#ffffff'),
    ];
    for (let i = 0; i < count; i++) {
      const p = this._getParticle(); if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI - Math.PI / 2;
      const s = 0.5 + Math.random() * 1.5;
      p.x = x; p.y = y + 1; p.z = z;
      p.vx = Math.cos(a) * Math.cos(el) * s;
      p.vy = Math.sin(el) * s + 0.5;
      p.vz = Math.sin(a) * Math.cos(el) * s;
      p.life = 30 + Math.random() * 30; p.maxLife = p.life;
      p.size = 3 + Math.random() * 5;
      const c = colors[Math.floor(Math.random() * colors.length)];
      p.r = c.r; p.g = c.g; p.b = c.b;
    }
  }

  emitConfetti(bounds, count = 60) {
    const colors = ['#e10600', '#fbbf24', '#00ff88', '#3671C6', '#FF8000', '#a855f7', '#fff'];
    const spanX = (bounds?.maxX || 500) - (bounds?.minX || -500);
    const spanZ = (bounds?.maxZ || 500) - (bounds?.minZ || -500);
    for (let i = 0; i < count; i++) {
      const p = this._getParticle(); if (!p) return;
      p.x = (bounds?.minX || -500) + Math.random() * spanX;
      p.y = 60 + Math.random() * 40;
      p.z = (bounds?.minZ || -500) + Math.random() * spanZ;
      p.vx = (Math.random() - 0.5) * 0.5;
      p.vy = -0.2 - Math.random() * 0.3;
      p.vz = (Math.random() - 0.5) * 0.5;
      p.life = 120 + Math.random() * 60; p.maxLife = p.life;
      p.size = 4 + Math.random() * 6;
      const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
      p.r = c.r; p.g = c.g; p.b = c.b;
      p.type = 'confetti';
    }
  }

  emitRain(bounds, count = 20) {
    const spanX = (bounds?.maxX || 500) - (bounds?.minX || -500);
    const spanZ = (bounds?.maxZ || 500) - (bounds?.minZ || -500);
    for (let i = 0; i < count; i++) {
      const p = this._getParticle(); if (!p) return;
      p.x = (bounds?.minX || -500) + Math.random() * spanX;
      p.y = 50 + Math.random() * 30;
      p.z = (bounds?.minZ || -500) + Math.random() * spanZ;
      p.vx = -0.1; p.vy = -1.5 - Math.random(); p.vz = -0.05;
      p.life = 30 + Math.random() * 20; p.maxLife = p.life;
      p.size = 1.5;
      p.r = 0.4; p.g = 0.6; p.b = 1.0;
      p.type = 'rain';
    }
  }

  emitSmoke(x, y, z, count = 8) {
    for (let i = 0; i < count; i++) {
      const p = this._getParticle(); if (!p) return;
      p.x = x + (Math.random() - 0.5) * 3;
      p.y = y + 1;
      p.z = z + (Math.random() - 0.5) * 3;
      p.vx = (Math.random() - 0.5) * 0.1;
      p.vy = 0.1 + Math.random() * 0.1;
      p.vz = (Math.random() - 0.5) * 0.1;
      p.life = 40 + Math.random() * 30; p.maxLife = p.life;
      p.size = 3 + Math.random() * 4;
      p.r = 0.7; p.g = 0.7; p.b = 0.7;
      p.type = 'smoke';
    }
  }

  emitStarSparkle(x, y, z) {
    const colors = [new THREE.Color('#ff0'), new THREE.Color('#f80'), new THREE.Color('#f0f'), new THREE.Color('#0f0')];
    for (let i = 0; i < 3; i++) {
      const p = this._getParticle(); if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const d = 2 + Math.random() * 3;
      p.x = x + Math.cos(a) * d; p.y = y + 2; p.z = z + Math.sin(a) * d;
      p.vx = Math.cos(a) * 0.15; p.vy = 0.2; p.vz = Math.sin(a) * 0.15;
      p.life = 15 + Math.random() * 10; p.maxLife = p.life;
      p.size = 2 + Math.random() * 2;
      const c = colors[Math.floor(Math.random() * colors.length)];
      p.r = c.r; p.g = c.g; p.b = c.b;
    }
  }

  clear() {
    for (const p of this.pool) p.active = false;
    this.activeCount = 0;
  }

  get count() { return this.activeCount; }
}
