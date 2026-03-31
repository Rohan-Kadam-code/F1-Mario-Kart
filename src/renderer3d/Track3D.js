/**
 * Track3D — Builds the 3D race circuit mesh.
 * Creates asphalt road surface, kerbs, grass, finish line, DRS zones,
 * sector markers, pit lane, and circuit name label.
 */
import * as THREE from 'three';

export class Track3D {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Track3D';
    scene.add(this.group);

    // Track metadata
    this.trackWidth = 14;
    this.pitLaneWidth = 10;
    this.circuitData = null;
    this.drsZones = [];
    this.sectorIndices = [];
  }

  /**
   * Build the track from 3D points.
   * @param {Array<{x,y,z}>} trackPoints — centerline in world space
   * @param {Array<{x,y,z}>} pitLanePoints — pit lane centerline
   * @param {Object|null} circuitData — from circuitData.js
   */
  build(trackPoints, pitLanePoints = [], circuitData = null) {
    // Clear previous
    this._clearGroup();

    this.circuitData = circuitData;
    if (circuitData) {
      this.trackWidth = Math.max(8, circuitData.trackWidthM * 0.8);
      this.pitLaneWidth = Math.max(6, (circuitData.pitLaneWidthM || 10) * 0.7);
      this.drsZones = circuitData.drsZones || [];
      this.sectorIndices = (circuitData.sectors || []).map(
        frac => Math.floor(frac * trackPoints.length)
      );
    }

    if (trackPoints.length < 3) return;

    // Build components
    this._buildGroundPlane();
    this._buildRoadSurface(trackPoints);
    this._buildKerbs(trackPoints);
    this._buildRunoff(trackPoints);
    this._buildFinishLine(trackPoints);
    this._buildDRSZones(trackPoints);
    this._buildSectorMarkers(trackPoints);
    this._buildCenterLine(trackPoints);

    if (pitLanePoints.length > 2) {
      this._buildPitLane(pitLanePoints);
    }

    if (circuitData) {
      this._buildCircuitNameLabel(circuitData);
    }
  }

  _clearGroup() {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  }

  /* ── Ground Plane ── */
  _buildGroundPlane() {
    const geo = new THREE.PlaneGeometry(6000, 6000);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2d5a27,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.5;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ── Road Surface ── */
  _buildRoadSurface(points) {
    const { geometry, material } = this._extrudeTrackStrip(points, this.trackWidth, {
      color: 0x333338,
      roughness: 0.7,
      metalness: 0.1,
      yOffset: 0.1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ── Kerbs (red/white stripes along edges) ── */
  _buildKerbs(points) {
    const kerbWidth = 2;
    const outerW = this.trackWidth / 2 + kerbWidth;
    const innerW = this.trackWidth / 2;

    // Left kerb
    const leftGeo = this._buildEdgeStrip(points, innerW, outerW, 0.15);
    const leftMat = new THREE.MeshStandardMaterial({
      color: 0xcc2200,
      roughness: 0.5,
    });
    this.group.add(new THREE.Mesh(leftGeo, leftMat));

    // Right kerb
    const rightGeo = this._buildEdgeStrip(points, -outerW, -innerW, 0.15);
    const rightMat = new THREE.MeshStandardMaterial({
      color: 0xcc2200,
      roughness: 0.5,
    });
    this.group.add(new THREE.Mesh(rightGeo, rightMat));
  }

  /* ── Runoff strip ── */
  _buildRunoff(points) {
    const kerbEnd = this.trackWidth / 2 + 2;
    const runoffEnd = kerbEnd + 8;

    // Left runoff — gravel
    const leftGeo = this._buildEdgeStrip(points, kerbEnd, runoffEnd, 0.05);
    const leftMat = new THREE.MeshStandardMaterial({
      color: 0x5a4d3a,
      roughness: 0.95,
    });
    this.group.add(new THREE.Mesh(leftGeo, leftMat));

    // Right runoff
    const rightGeo = this._buildEdgeStrip(points, -runoffEnd, -kerbEnd, 0.05);
    this.group.add(new THREE.Mesh(rightGeo, leftMat.clone()));
  }

  /* ── Center dashed line ── */
  _buildCenterLine(points) {
    const dashLength = 3;
    const gapLength = 4;
    let accumulated = 0;
    let drawing = true;
    const positions = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i > 0) {
        const prev = points[i - 1];
        const dx = p.x - prev.x;
        const dz = p.z - prev.z;
        accumulated += Math.sqrt(dx * dx + dz * dz);
      }

      const threshold = drawing ? dashLength : gapLength;
      if (accumulated > threshold) {
        drawing = !drawing;
        accumulated = 0;
      }

      if (drawing) {
        positions.push(p.x, 0.2, p.z);
      }
    }

    if (positions.length > 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
      });
      this.group.add(new THREE.Line(geo, mat));
    }
  }

  /* ── Finish Line ── */
  _buildFinishLine(points) {
    if (points.length < 2) return;
    const p0 = points[0];
    const p1 = points[1];
    const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);

    const checkerSize = 1.2;
    const cols = Math.ceil(this.trackWidth / checkerSize);
    const rows = 3;

    const checkerGroup = new THREE.Group();
    checkerGroup.position.set(p0.x, 0.12, p0.z);
    checkerGroup.rotation.y = angle;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isWhite = (r + c) % 2 === 0;
        const geo = new THREE.PlaneGeometry(checkerSize, checkerSize);
        const mat = new THREE.MeshStandardMaterial({
          color: isWhite ? 0xffffff : 0x222222,
          roughness: 0.3,
        });
        const tile = new THREE.Mesh(geo, mat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(
          (c - cols / 2 + 0.5) * checkerSize,
          0,
          (r - rows / 2 + 0.5) * checkerSize
        );
        checkerGroup.add(tile);
      }
    }

    this.group.add(checkerGroup);

    // Start/finish gantry (simple arch)
    const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, 12, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.3 });

    const leftPole = new THREE.Mesh(poleGeo, poleMat);
    leftPole.position.set(p0.x + Math.cos(angle) * (this.trackWidth / 2 + 3), 6, p0.z - Math.sin(angle) * (this.trackWidth / 2 + 3));
    this.group.add(leftPole);

    const rightPole = new THREE.Mesh(poleGeo, poleMat);
    rightPole.position.set(p0.x - Math.cos(angle) * (this.trackWidth / 2 + 3), 6, p0.z + Math.sin(angle) * (this.trackWidth / 2 + 3));
    this.group.add(rightPole);

    // Crossbar
    const crossGeo = new THREE.BoxGeometry(this.trackWidth + 8, 1, 1.5);
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
    const cross = new THREE.Mesh(crossGeo, crossMat);
    cross.position.set(p0.x, 12, p0.z);
    cross.rotation.y = angle;
    this.group.add(cross);
  }

  /* ── DRS Zones ── */
  _buildDRSZones(points) {
    if (!this.drsZones || this.drsZones.length === 0) return;

    for (const zone of this.drsZones) {
      const startIdx = Math.floor(zone.start * points.length) % points.length;
      const endIdx = Math.floor(zone.end * points.length) % points.length;

      // Extract a slice of the track for DRS
      const drsPoints = [];
      let i = startIdx;
      let steps = 0;
      while (steps < points.length) {
        drsPoints.push(points[i]);
        if (i === endIdx) break;
        i = (i + 1) % points.length;
        steps++;
      }

      if (drsPoints.length < 2) continue;

      const { geometry } = this._extrudeTrackStrip(drsPoints, this.trackWidth - 1, {
        yOffset: 0.15,
      });

      const mat = new THREE.MeshStandardMaterial({
        color: 0x00c853,
        transparent: true,
        opacity: 0.3,
        emissive: 0x00c853,
        emissiveIntensity: 0.3,
        roughness: 0.6,
      });

      this.group.add(new THREE.Mesh(geometry, mat));

      // DRS start marker — glowing beacon
      const sp = drsPoints[0];
      const beaconGeo = new THREE.CylinderGeometry(0.5, 0.5, 5, 8);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0x00ff88,
        emissive: 0x00ff88,
        emissiveIntensity: 1.0,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(sp.x, 2.5, sp.z);
      this.group.add(beacon);
    }
  }

  /* ── Sector Markers ── */
  _buildSectorMarkers(points) {
    const indices = this.sectorIndices.length > 0
      ? this.sectorIndices
      : [Math.floor(points.length / 3), Math.floor(points.length * 2 / 3)];

    const colors = [0xe10600, 0x0066ff];
    const labels = ['S1/S2', 'S2/S3'];

    indices.forEach((idx, i) => {
      if (idx < 0 || idx >= points.length) return;
      const p = points[idx];
      const col = colors[i % colors.length];

      // Vertical pole
      const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 6);
      const poleMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.5,
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, 4, p.z);
      this.group.add(pole);

      // Label sprite
      this._addTextSprite(labels[i] || `S${i + 1}`, p.x, 10, p.z, col);
    });
  }

  /* ── Pit Lane ── */
  _buildPitLane(points) {
    // Pit asphalt
    const { geometry } = this._extrudeTrackStrip(points, this.pitLaneWidth, {
      yOffset: 0.08,
    });
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      roughness: 0.8,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Pit lane edge
    const edgeGeo = this._buildEdgeStrip(points, this.pitLaneWidth / 2, this.pitLaneWidth / 2 + 1, 0.1);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x444450 });
    this.group.add(new THREE.Mesh(edgeGeo, edgeMat));

    const edgeGeo2 = this._buildEdgeStrip(points, -this.pitLaneWidth / 2 - 1, -this.pitLaneWidth / 2, 0.1);
    this.group.add(new THREE.Mesh(edgeGeo2, edgeMat.clone()));
  }

  /* ── Circuit Name Label ── */
  _buildCircuitNameLabel(circuitData) {
    const text = circuitData.name;
    this._addTextSprite(text, 0, 30, 0, 0xffffff, 256, 32);
  }

  /* ═══════════════════════════════════════════
     Geometry Helpers
     ═══════════════════════════════════════════ */

  /**
   * Extrude a strip (road surface) along the centerline.
   * Returns { geometry, material }.
   */
  _extrudeTrackStrip(points, width, opts = {}) {
    const { color = 0x333338, roughness = 0.7, metalness = 0.1, yOffset = 0.1 } = opts;
    const halfW = width / 2;
    const vertices = [];
    const indices = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const pNext = points[(i + 1) % points.length];
      const pPrev = points[(i - 1 + points.length) % points.length];

      // Tangent direction
      const tx = pNext.x - pPrev.x;
      const tz = pNext.z - pPrev.z;
      const len = Math.sqrt(tx * tx + tz * tz) || 1;

      // Normal (perpendicular to tangent, in XZ plane)
      const nx = -tz / len;
      const nz = tx / len;

      // Left and right vertices
      vertices.push(
        p.x + nx * halfW, yOffset, p.z + nz * halfW,
        p.x - nx * halfW, yOffset, p.z - nz * halfW
      );

      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(i / points.length, 0, i / points.length, 1);

      // Create two triangles per segment
      if (i < points.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    // Close the loop
    const last = (points.length - 1) * 2;
    indices.push(last, last + 1, 0);
    indices.push(last + 1, 1, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });

    return { geometry: geo, material: mat };
  }

  /**
   * Build an edge strip offset from track centerline.
   * offsetInner/offsetOuter are signed distances from center.
   */
  _buildEdgeStrip(points, offsetInner, offsetOuter, yOffset = 0.12) {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const pNext = points[(i + 1) % points.length];
      const pPrev = points[(i - 1 + points.length) % points.length];

      const tx = pNext.x - pPrev.x;
      const tz = pNext.z - pPrev.z;
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;

      vertices.push(
        p.x + nx * offsetInner, yOffset, p.z + nz * offsetInner,
        p.x + nx * offsetOuter, yOffset, p.z + nz * offsetOuter
      );
      normals.push(0, 1, 0, 0, 1, 0);

      if (i < points.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    // Close loop
    const last = (points.length - 1) * 2;
    indices.push(last, last + 1, 0);
    indices.push(last + 1, 1, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    return geo;
  }

  /**
   * Create a text label as a THREE.Sprite
   */
  _addTextSprite(text, x, y, z, color = 0xffffff, canvasW = 128, canvasH = 32) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.font = `bold ${Math.floor(canvasH * 0.7)}px "Outfit", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = typeof color === 'number'
      ? `#${color.toString(16).padStart(6, '0')}`
      : color;
    ctx.fillText(text, canvasW / 2, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(canvasW / 4, canvasH / 4, 1);
    this.group.add(sprite);
  }
}
