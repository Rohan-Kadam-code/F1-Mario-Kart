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

  /* ── Ground Plane (natural grass) ── */
  _buildGroundPlane() {
    const geo = new THREE.PlaneGeometry(6000, 6000);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a6b3a,   // Muted, natural grass — not cartoon green
      roughness: 0.95,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.5;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ── Road Surface (worn asphalt) ── */
  _buildRoadSurface(points) {
    const { geometry, material } = this._extrudeTrackStrip(points, this.trackWidth, {
      color: 0x2c2c2e,   // Dark grey asphalt — realistic tarmac
      roughness: 0.82,
      metalness: 0.05,
      yOffset: 0.1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Track edge white lines
    const lineW = 0.6;
    const edgeOuter = this.trackWidth / 2;
    const edgeInner = edgeOuter - lineW;
    const leftLineGeo = this._buildEdgeStrip(points, edgeInner, edgeOuter, 0.12);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
    this.group.add(new THREE.Mesh(leftLineGeo, lineMat));
    const rightLineGeo = this._buildEdgeStrip(points, -edgeOuter, -edgeInner, 0.12);
    this.group.add(new THREE.Mesh(rightLineGeo, lineMat.clone()));
  }

  /* ── Kerbs (red/white alternating) ── */
  _buildKerbs(points) {
    const kerbWidth = 2.2;
    const outerW = this.trackWidth / 2 + kerbWidth;
    const innerW = this.trackWidth / 2;

    // Red stripe
    const leftRedGeo = this._buildEdgeStrip(points, innerW, innerW + kerbWidth * 0.5, 0.18);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1100, roughness: 0.45 });
    this.group.add(new THREE.Mesh(leftRedGeo, redMat));

    // White stripe  
    const leftWhiteGeo = this._buildEdgeStrip(points, innerW + kerbWidth * 0.5, outerW, 0.18);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4 });
    this.group.add(new THREE.Mesh(leftWhiteGeo, whiteMat));

    // Right side (mirrored)
    const rightRedGeo = this._buildEdgeStrip(points, -innerW - kerbWidth * 0.5, -innerW, 0.18);
    this.group.add(new THREE.Mesh(rightRedGeo, redMat.clone()));
    const rightWhiteGeo = this._buildEdgeStrip(points, -outerW, -innerW - kerbWidth * 0.5, 0.18);
    this.group.add(new THREE.Mesh(rightWhiteGeo, whiteMat.clone()));
  }

  /* ── Runoff (paved runoff + gravel trap) ── */
  _buildRunoff(points) {
    const kerbEnd = this.trackWidth / 2 + 2.2;

    // Paved runoff (slightly lighter asphalt) — 4 units wide
    const pavedEnd = kerbEnd + 4;
    const leftPavedGeo = this._buildEdgeStrip(points, kerbEnd, pavedEnd, 0.06);
    const pavedMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.85 });
    this.group.add(new THREE.Mesh(leftPavedGeo, pavedMat));
    const rightPavedGeo = this._buildEdgeStrip(points, -pavedEnd, -kerbEnd, 0.06);
    this.group.add(new THREE.Mesh(rightPavedGeo, pavedMat.clone()));

    // Gravel trap — warm sandy colour, 10 units wide
    const gravelEnd = pavedEnd + 10;
    const leftGravelGeo = this._buildEdgeStrip(points, pavedEnd, gravelEnd, 0.02);
    const gravelMat = new THREE.MeshStandardMaterial({
      color: 0xc4a96a,   // Sandy/beige gravel — realistic
      roughness: 0.98,
      metalness: 0.0,
    });
    this.group.add(new THREE.Mesh(leftGravelGeo, gravelMat));
    const rightGravelGeo = this._buildEdgeStrip(points, -gravelEnd, -pavedEnd, 0.02);
    this.group.add(new THREE.Mesh(rightGravelGeo, gravelMat.clone()));
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

    // ── Professional Start/Finish Gantry ──
    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(p0.x, 0, p0.z);
    gantryGroup.rotation.y = angle;
    this.group.add(gantryGroup);

    const poleGeo = new THREE.CylinderGeometry(0.4, 0.45, 14, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.2 });

    const leftPole = new THREE.Mesh(poleGeo, poleMat);
    leftPole.position.set(this.trackWidth / 2 + 4, 7, 0);
    gantryGroup.add(leftPole);

    const rightPole = new THREE.Mesh(poleGeo, poleMat);
    rightPole.position.set(-(this.trackWidth / 2 + 4), 7, 0);
    gantryGroup.add(rightPole);

    // Heavy-duty Crossbar with Display Panel
    const crossBarGeo = new THREE.BoxGeometry(this.trackWidth + 10, 1.5, 2.5);
    const crossBarMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7 });
    const crossBar = new THREE.Mesh(crossBarGeo, crossBarMat);
    crossBar.position.set(0, 14, 0);
    gantryGroup.add(crossBar);

    // Central Status Panel (F1 Logo / Status)
    const panelGeo = new THREE.PlaneGeometry(8, 3.5);
    const panelCanvas = document.createElement('canvas');
    panelCanvas.width = 512;
    panelCanvas.height = 256;
    const pctx = panelCanvas.getContext('2d');
    pctx.fillStyle = '#000000';
    pctx.fillRect(0, 0, 512, 256);
    pctx.fillStyle = '#e10600'; // F1 Red
    pctx.font = 'bold 120px "Outfit", sans-serif';
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.fillText('F1', 256, 128);
    
    // Add border to panel
    pctx.strokeStyle = '#ffffff';
    pctx.lineWidth = 10;
    pctx.strokeRect(5, 5, 502, 246);

    const panelTex = new THREE.CanvasTexture(panelCanvas);
    const panelMat = new THREE.MeshBasicMaterial({ map: panelTex });
    const statusPanel = new THREE.Mesh(panelGeo, panelMat);
    statusPanel.position.set(0, 0, 1.3); // Facing track
    crossBar.add(statusPanel);

    // F1 Start Lights (5 Red LED Pairs, scaled per the reference gantry)
    this.startLights = [];
    const ledGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16);
    const ledOffMat = new THREE.MeshStandardMaterial({ color: 0x110505, roughness: 0.9 });
    
    for (let i = 0; i < 5; i++) {
        const lightBoxGeo = new THREE.BoxGeometry(1.2, 1.8, 0.5);
        const lightBox = new THREE.Mesh(lightBoxGeo, new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
        lightBox.position.set((i - 2) * 1.5, -2, 1.3);
        crossBar.add(lightBox);

        const ledTop = new THREE.Mesh(ledGeo, ledOffMat.clone());
        ledTop.rotation.x = Math.PI / 2;
        ledTop.position.set(0, 0.35, 0.2);
        lightBox.add(ledTop);
        
        const ledBottom = new THREE.Mesh(ledGeo, ledOffMat.clone());
        ledBottom.rotation.x = Math.PI / 2;
        ledBottom.position.set(0, -0.35, 0.2);
        lightBox.add(ledBottom);
        
        this.startLights.push({ top: ledTop, bottom: ledBottom });
    }

    // Process Grid Markers
    this._buildGridMarkers(points, angle);
    // Process Marshal Panels
    this._buildMarshalPanels(points);
  }

  /**
   * Set F1 start lights state (0-5)
   * @param {number} count - number of red light pairs to turn on
   */
  setStartLights(count) {
    if (!this.startLights) return;
    const onColor = 0xff1100;
    this.startLights.forEach((light, i) => {
      const isOn = i < count;
      light.top.material.color.setHex(isOn ? onColor : 0x221111);
      light.top.material.emissive.setHex(isOn ? onColor : 0x000000);
      light.top.material.emissiveIntensity = isOn ? 1.5 : 0;
      
      light.bottom.material.color.setHex(isOn ? onColor : 0x221111);
      light.bottom.material.emissive.setHex(isOn ? onColor : 0x000000);
      light.bottom.material.emissiveIntensity = isOn ? 1.5 : 0;
    });
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
      color: 0x2a2a2c,   // Pit lane — slightly lighter than main track
      roughness: 0.85,
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

  /**
   * Walk backward along a closed track path by a given distance (meters).
   * Returns { x, z, angle } where angle is the forward racing direction.
   * points[0] = start/finish, points[N-1] = last point before the line.
   * "Backward" means: 0 → N-1 → N-2 → ... (against racing direction).
   */
  _walkBackFromStart(points, distance) {
    let remaining = distance;
    for (let step = 0; step < points.length; step++) {
      const fromIdx = (points.length - step) % points.length;   // 0, N-1, N-2, ...
      const toIdx   = (points.length - step - 1) % points.length; // N-1, N-2, N-3, ...

      const dx = points[toIdx].x - points[fromIdx].x;
      const dz = points[toIdx].z - points[fromIdx].z;
      const segLen = Math.sqrt(dx * dx + dz * dz);

      if (remaining <= segLen && segLen > 0) {
        const t = remaining / segLen;
        // Forward racing direction: from toIdx toward fromIdx (toward start)
        const fwdAngle = Math.atan2(
          points[fromIdx].x - points[toIdx].x,
          points[fromIdx].z - points[toIdx].z
        );
        return {
          x: points[fromIdx].x + dx * t,
          z: points[fromIdx].z + dz * t,
          angle: fwdAngle,
        };
      }
      remaining -= segLen;
    }
    return { x: points[0].x, z: points[0].z, angle: 0 };
  }

  /**
   * Build staggered grid numbers 1-20 on the track surface.
   * Walks backward along the actual track path so markers follow the curve.
   */
  _buildGridMarkers(points, angle) {
    if (points.length < 3) return;

    const isPoleRight = !this.circuitData || (this.circuitData.poleSide !== 'left');
    const lateralShift = 4.0;
    const markerSize = 2.5;
    const gridSpacing = 8; // meters between grid rows

    for (let i = 0; i < 20; i++) {
      const distance = 2 + i * gridSpacing;
      const pos = this._walkBackFromStart(points, distance);
      const isRightSlot = (i % 2 === 0) ? isPoleRight : !isPoleRight;

      // Lateral offset using the local track angle at this point
      const rightX = Math.cos(pos.angle);
      const rightZ = -Math.sin(pos.angle);
      const x = pos.x + rightX * (isRightSlot ? lateralShift : -lateralShift);
      const z = pos.z + rightZ * (isRightSlot ? lateralShift : -lateralShift);

      // Draw grid position number on asphalt
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = 'bold 100px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i + 1, 64, 64);

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 });
      const geo = new THREE.PlaneGeometry(markerSize, markerSize);
      const marker = new THREE.Mesh(geo, mat);

      marker.position.set(x, 0.15, z);
      marker.rotation.x = -Math.PI / 2;
      marker.rotation.z = -pos.angle; // Rotate to LOCAL track heading
      this.group.add(marker);

      // White lateral line behind the number
      const fwdX = Math.sin(pos.angle);
      const fwdZ = Math.cos(pos.angle);
      const boxGeo = new THREE.PlaneGeometry(markerSize * 1.6, 0.2);
      const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.set(x - fwdX * 0.8, 0.14, z - fwdZ * 0.8);
      box.rotation.x = -Math.PI / 2;
      box.rotation.z = -pos.angle;
      this.group.add(box);
    }
  }

  /**
   * Add digital LED flag boards along the track periphery.
   */
  _buildMarshalPanels(points) {
    const spacing = 15; // Point indices
    const panelGeo = new THREE.BoxGeometry(0.2, 1.2, 1.8);
    const screenGeo = new THREE.PlaneGeometry(1.7, 1.1);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    
    // Green Status Screen
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#00ff00';
    // Draw 4x4 LED grid pattern
    for(let x=0; x<4; x++) for(let y=0; y<4; y++) ctx.fillRect(x*32+4, y*32+4, 24, 24);
    
    const screenTex = new THREE.CanvasTexture(canvas);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, emissive: 0x00ff00, emissiveIntensity: 1 });

    for (let i = 0; i < points.length; i += spacing) {
        if (i > points.length * 0.15) break; // Only first 15% (Pit wall area)
        
        const p = points[i];
        const p1 = points[(i + 1) % points.length];
        const ang = Math.atan2(p1.x - p.x, p1.z - p.z) + Math.PI/2;
        
        const panel = new THREE.Mesh(panelGeo, panelMat);
        // Place on the left (pit wall)
        panel.position.set(p.x + Math.cos(ang) * (this.trackWidth/2 + 1), 1.5, p.z - Math.sin(ang) * (this.trackWidth/2 + 1));
        panel.rotation.y = ang;
        this.group.add(panel);
        
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(0.11, 0, 0); // Offset from panel surface
        screen.rotation.y = Math.PI / 2;
        panel.add(screen);
    }
  }
}
