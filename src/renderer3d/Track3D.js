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
    if (circuitData && circuitData.trackWidthM) {
      this.trackWidth = Math.max(8, circuitData.trackWidthM * 0.8);
      this.pitLaneWidth = Math.max(6, (circuitData.pitLaneWidthM || 10) * 0.7);
      this.drsZones = circuitData.drsZones || [];
      this.sectorIndices = (circuitData.sectors || []).map(
        frac => Math.floor(frac * trackPoints.length)
      );
    } else {
      // Default values if data is missing
      this.trackWidth = 14;
      this.pitLaneWidth = 10;
      this.drsZones = [];
      this.sectorIndices = [];
    }

    if (trackPoints.length < 3) return;

    // Build components
    this._buildTerrain(trackPoints);
    this._buildRoadSurface(trackPoints);
    this._buildKerbs(trackPoints);
    this._buildRunoff(trackPoints);
    this._buildFinishLine(trackPoints);
    this._buildTrees(trackPoints);
    this._buildJapanProps(trackPoints);
    this._buildQuestionBlocks(trackPoints);
    this._buildCenterLine(trackPoints);
    this._buildDRSZones(trackPoints);
    this._buildSectorMarkers(trackPoints);

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

  /* ── Procedural Terrain (Molded Grass) ── */
  _buildTerrain(points) {
    if (!points || points.length === 0) return;

    // Use a high-density plane for the heightmap
    const size = 6000;
    const segs = 120; // 120x120 segments (14,400 vertices)
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const trackP = new THREE.Vector3();

    // Pre-calculate track bounding box for performance optimization
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      
      // Find nearest point on track to determine Y height
      let minDistSq = Infinity;
      let nearestY = 0;

      // Only check points if within a reasonable distance of the track bounds
      const margin = 200;
      if (v.x > minX - margin && v.x < maxX + margin && v.z > minZ - margin && v.z < maxZ + margin) {
        // Optimization: Sample track points
        for (let j = 0; j < points.length; j += 2) {
          const pt = points[j];
          const dx = v.x - pt.x;
          const dz = v.z - pt.z;
          const d2 = dx*dx + dz*dz;
          if (d2 < minDistSq) {
            minDistSq = d2;
            nearestY = pt.y || 0;
          }
        }
      }

      const dist = Math.sqrt(minDistSq);
      const trackRadius = 40; // Area around track that matches track height
      const falloff = 150;    // Smooth transition to ground level

      if (dist < trackRadius) {
        v.y = nearestY - 0.5; // Slightly below track to avoid Z-fighting
      } else if (dist < trackRadius + falloff) {
        const t = 1.0 - (dist - trackRadius) / falloff;
        // Smoothstep interpolation for natural hills
        const smoothT = t * t * (3 - 2 * t);
        
        // Add random terrain jitter for "detailed" organic look
        const jitter = (Math.sin(v.x * 0.1) * Math.cos(v.z * 0.1)) * 5 * (1.0 - smoothT);
        v.y = (nearestY - 0.5) * smoothT + jitter;
      } else {
        // Base ground level with larger rolling noise
        v.y = -10 + (Math.sin(v.x * 0.02) * Math.sin(v.z * 0.02)) * 15;
      }

      pos.setXYZ(i, v.x, v.y, v.z);
    }

    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x5ddb3e,   // Vibrant Mario Kart green
      roughness: 0.7,
      metalness: 0.0,
      flatShading: false
    });
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ── Road Surface (Realistic Grey Asphalt) ── */
  _buildRoadSurface(points) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Base Realistic Grey Tarmac
    ctx.fillStyle = '#515355ff'; 
    ctx.fillRect(0, 0, 256, 256);
    
    // Procedural "Stony" grain
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const s = Math.random() * 0.2;
        ctx.fillStyle = `rgba(255,255,255,${s})`;
        ctx.fillRect(x, y, 1, 1);
    }
    
    // Subtle slab lines
    ctx.strokeStyle = 'rgba(150, 149, 154, 0.47)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 400); 
    
    const material = new THREE.MeshStandardMaterial({
      color: '#888a8d', // Lightened grey
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x444448, // Stronger emissive to maintain grey appearance in chase-cam
      emissiveIntensity: 0.8,
      side: THREE.DoubleSide
    });
    
    const { geometry } = this._extrudeTrackStrip(points, this.trackWidth, {
      yOffset: 0.2
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Clean white boundary lines
    const lineW = 0.5;
    const edgeOuter = this.trackWidth / 2;
    const edgeInner = edgeOuter - lineW;
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    
    const leftLineGeo = this._buildEdgeStrip(points, edgeInner, edgeOuter, 0.22);
    this.group.add(new THREE.Mesh(leftLineGeo, lineMat));
    
    const rightLineGeo = this._buildEdgeStrip(points, -edgeOuter, -edgeInner, 0.22);
    this.group.add(new THREE.Mesh(rightLineGeo, lineMat.clone()));
  }

  /* ── 3D Stepped Kerbs (Discrete 3D Blocks) ── */
  _buildKerbs(points) {
    const kerbWidth = 3.5;
    const innerW = this.trackWidth / 2;
    const blockHeight = 0.8; 
    const blockLength = 3.0; // Distance along track

    // Materials
    const matRed = new THREE.MeshStandardMaterial({ color: 0xff1a1a, roughness: 0.4 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    
    const blockGeo = new THREE.BoxGeometry(kerbWidth, blockHeight, blockLength);

    for (let i = 0; i < points.length; i += 2) {
      const p = points[i];
      const pNext = points[(i + 1) % points.length];
      const dx = pNext.x - p.x;
      const dz = pNext.z - p.z;
      const angle = Math.atan2(dx, dz);
      
      const mat = (Math.floor(i / 1.5) % 2 === 0) ? matRed : matWhite;

      // Left Side Blocks
      const lBlock = new THREE.Mesh(blockGeo, mat);
      const lx = p.x + Math.cos(angle) * (innerW + kerbWidth/2);
      const lz = p.z - Math.sin(angle) * (innerW + kerbWidth/2);
      lBlock.position.set(lx, (p.y||0) + blockHeight/2, lz);
      lBlock.rotation.y = angle;
      lBlock.castShadow = true;
      this.group.add(lBlock);

      // Right Side Blocks
      const rBlock = new THREE.Mesh(blockGeo, mat.clone());
      const rx = p.x - Math.cos(angle) * (innerW + kerbWidth/2);
      const rz = p.z + Math.sin(angle) * (innerW + kerbWidth/2);
      rBlock.position.set(rx, (p.y||0) + blockHeight/2, rz);
      rBlock.rotation.y = angle;
      rBlock.castShadow = true;
      this.group.add(rBlock);
    }
  }

  /* ── Runoff Area (Cleaned) ── */
  _buildRunoff(points) {
    const kerbEnd = this.trackWidth / 2 + 3.5; // Offset to sit outside stepped kerbs

    // Border Walls (High-contrast Blue/White)
    const wallHeight = 1.4;
    const borderMatBlue = new THREE.MeshStandardMaterial({ color: 0x0066ee, roughness: 0.2 });
    const borderMatWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });

    const segmentCount = points.length;
    for (let i = 0; i < segmentCount; i += 6) {
      const segPoints = points.slice(i, i + 8);
      if (segPoints.length < 2) continue;
      
      const mat = (Math.floor(i / 12) % 2 === 0) ? borderMatBlue : borderMatWhite;
      
      const lWall = this._buildEdgeStrip(segPoints, kerbEnd, kerbEnd + 1.2, 0.15, false);
      this.group.add(new THREE.Mesh(lWall, mat));
      
      const rWall = this._buildEdgeStrip(segPoints, -kerbEnd - 1.2, -kerbEnd, 0.15, false);
      this.group.add(new THREE.Mesh(rWall, mat));
    }
  }

  /* ── Japan Aesthetics: Sakura & Pom-Pom Trees ── */

  _buildTrees(points) {
    // Find track bounds to scatter trees outside
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }

    const treeCount = 150;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d2600 });
    const sakuraMat = new THREE.MeshStandardMaterial({ 
        color: 0xffb7c5, 
        roughness: 0.8,
        emissive: 0xffb7c5,
        emissiveIntensity: 0.2 // Soft pink glow
    }); 
    const greenMat = new THREE.MeshStandardMaterial({ 
        color: 0x2d5a27, 
        roughness: 0.8,
        emissive: 0x2d5a27,
        emissiveIntensity: 0.1
    }); 

    for (let i = 0; i < treeCount; i++) {
        const x = minX - 200 + Math.random() * (maxX - minX + 400);
        const z = minZ - 200 + Math.random() * (maxZ - minZ + 400);
        
        // Find distance to nearest track point
        let minDistSq = Infinity;
        let nearestY = 0;
        for (let j = 0; j < points.length; j += 10) {
            const pt = points[j];
            const d2 = (x - pt.x)**2 + (z - pt.z)**2;
            if (d2 < minDistSq) { minDistSq = d2; nearestY = pt.y || 0; }
        }

        const dist = Math.sqrt(minDistSq);
        if (dist > 35 && dist < 300) {
            const treeGroup = new THREE.Group();
            
            // Randomly choose Sakura or Green
            const isSakura = Math.random() > 0.4;
            const leafMat = isSakura ? sakuraMat : greenMat;
            
            // Trunk
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 8), trunkMat);
            trunk.position.y = 2;
            treeGroup.add(trunk);

            // Foliage (Refined clusters)
            const foliageCount = isSakura ? 4 : 3;
            for (let j = 0; j < foliageCount; j++) {
                const fSize = isSakura ? (1.2 + Math.random() * 0.8) : (1.5 + Math.random() * 1.0);
                const foliage = new THREE.Mesh(new THREE.SphereGeometry(fSize, 8, 8), leafMat);
                
                // Randomly offset around the top of the trunk
                const angle = (j / foliageCount) * Math.PI * 2;
                const radius = isSakura ? 1.5 : 1.0;
                foliage.position.set(
                    Math.cos(angle) * radius,
                    4 + Math.random() * 2,
                    Math.sin(angle) * radius
                );
                treeGroup.add(foliage);
            }

            treeGroup.position.set(x, nearestY - 5 + (Math.random() * 2), z); // Sit on terrain
            if (nearestY < -5) treeGroup.position.y = -10; // Floor limit
            
            treeGroup.scale.setScalar(0.8 + Math.random() * 1.5);
            treeGroup.rotation.y = Math.random() * Math.PI;
            this.group.add(treeGroup);
        }
    }
  }

  /* ── Japan Aesthetics: Castle & Torii Gate ── */
  _buildJapanProps(points) {
    // 1. Japanese Castle Keep (Background)
    const castle = new THREE.Group();
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 }); // Dark blue/grey roof
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1 }); // White walls
    
    // Base tier
    const base = new THREE.Mesh(new THREE.BoxGeometry(20, 15, 20), wallMat);
    base.position.y = 7.5;
    castle.add(base);
    
    // Roof 1
    const roof1 = new THREE.Mesh(new THREE.ConeGeometry(18, 8, 4), roofMat);
    roof1.position.y = 15;
    roof1.rotation.y = Math.PI/4;
    castle.add(roof1);
    
    // Tier 2
    const tier2 = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 12), wallMat);
    tier2.position.y = 20;
    castle.add(tier2);

    // Roof 2
    const roof2 = new THREE.Mesh(new THREE.ConeGeometry(10, 6, 4), roofMat);
    roof2.position.y = 26;
    roof2.rotation.y = Math.PI/4;
    castle.add(roof2);

    castle.position.set(250, 60, -200); // Further back
    castle.scale.setScalar(3.5); // Slightly smaller
    this.group.add(castle);

    // 2. Torii Gate (Finish Line Area)
    const p0 = points[0];
    const p1 = points[1];
    const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    
    const torii = new THREE.Group();
    const toriiMat = new THREE.MeshStandardMaterial({ 
        color: 0xe74c3c, 
        roughness: 0.3,
        emissive: 0x330000, // Very subtle dark red glow for depth
        emissiveIntensity: 1.0
    });
    
    // Pillars (Slightly shorter and thinner)
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 12, 8), toriiMat);
    lp.position.set(this.trackWidth/2 + 1.5, 6, 0);
    torii.add(lp);
    
    const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 12, 8), toriiMat);
    rp.position.set(-(this.trackWidth/2 + 1.5), 6, 0);
    torii.add(rp);
    
    // Top Beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.trackWidth + 6, 1.2, 1.5), toriiMat);
    beam.position.y = 11;
    torii.add(beam);
    
    const beamTop = new THREE.Mesh(new THREE.BoxGeometry(this.trackWidth + 10, 1.0, 2.0), toriiMat);
    beamTop.position.y = 12.5;
    torii.add(beamTop);

    torii.position.set(p0.x, p0.y, p0.z);
    torii.rotation.y = angle;
    this.group.add(torii);
  }

  /* ── Question Blocks (Rotating) ── */
  _buildQuestionBlocks(points) {
    const blockGeo = new THREE.BoxGeometry(3, 3, 3);
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.5 });
    
    // Place a few blocks at key points
    const indices = [Math.floor(points.length * 0.2), Math.floor(points.length * 0.5), Math.floor(points.length * 0.8)];
    
    this.questionBlocks = [];
    for (const idx of indices) {
        const p = points[idx];
        const block = new THREE.Mesh(blockGeo, blockMat);
        block.position.set(p.x, (p.y||0) + 8, p.z);
        this.group.add(block);
        this.questionBlocks.push(block);
    }
  }

  /* ── Center dashed line ── */
  _buildCenterLine(points) {
    const dashLength = 3;
    const gapLength = 6;
    const positions = [];

    for (let i = 0; i < points.length; i += 2) {
      const p = points[i];
      if (Math.floor(i / 10) % 2 === 0) {
        positions.push(p.x, p.y + 0.22, p.z);
      }
    }

    if (positions.length > 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
      });
      const centerLine = new THREE.Line(geo, mat);
      this.group.add(centerLine);
    }
  }

  /* ── Finish Line ── */
  _buildFinishLine(points) {
    if (points.length < 2) return;
    const p0 = points[0];
    const p1 = points[1];
    const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    
    // Calculate pitch for the start line
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const dy = p1.y - p0.y;
    const lenXZ = Math.sqrt(dx*dx + dz*dz) || 1;
    const pitch = Math.atan2(dy, lenXZ);

    const checkerSize = 1.2;
    const cols = Math.ceil(this.trackWidth / checkerSize);
    const rows = 3;

    const checkerGroup = new THREE.Group();
    checkerGroup.position.set(p0.x, p0.y + 0.12, p0.z);
    checkerGroup.rotation.y = angle;
    checkerGroup.rotation.x = -pitch;

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
    gantryGroup.position.set(p0.x, p0.y, p0.z);
    gantryGroup.rotation.y = angle;
    // Don't pitch the gantry so pillars stay vertical, but Y offset is correct
    this.group.add(gantryGroup);

    const poleGeo = new THREE.CylinderGeometry(0.4, 0.45, 14, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.2 });

    const leftPole = new THREE.Mesh(poleGeo, poleMat);
    leftPole.position.set(this.trackWidth / 2 + 4, 7, 0);
    gantryGroup.add(leftPole);

    const rightPole = new THREE.Mesh(poleGeo, poleMat);
    rightPole.position.set(-(this.trackWidth / 2 + 4), 7, 0);
    gantryGroup.add(rightPole);

    // Start/Finish Gantry (Slightly more compact)
    const crossBarGeo = new THREE.BoxGeometry(this.trackWidth + 8, 1.2, 2.0);
    const crossBarMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7 });
    const crossBar = new THREE.Mesh(crossBarGeo, crossBarMat);
    crossBar.position.set(0, 11, 0);
    gantryGroup.add(crossBar);

    // Central Status Panel (F1 Logo / Status)
    const panelGeo = new THREE.PlaneGeometry(8, 3.5);
    const panelCanvas = document.createElement('canvas');
    panelCanvas.width = 512;
    panelCanvas.height = 256;
    const pctx = panelCanvas.getContext('2d');
    pctx.fillStyle = '#000000ff';
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

  /* ── DRS Zones (Mario Kart Style Glowing Cyan) ── */
  _buildDRSZones(points) {
    if (!this.drsZones || this.drsZones.length === 0) return;

    for (const zone of this.drsZones) {
      const startIdx = Math.floor(zone.start * points.length) % points.length;
      const endIdx = Math.floor(zone.end * points.length) % points.length;

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

      const { geometry: drsGeo } = this._extrudeTrackStrip(drsPoints, this.trackWidth - 0.5, {
        yOffset: 0.22,
        closeLoop: false // CRITICAL: DRS is an open segment
      });

      const drsMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.25,
        emissive: 0x00ffff,
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide
      });

      this.group.add(new THREE.Mesh(drsGeo, drsMat));
    }
  }

  /* ── Sector Markers (Japan Themed Lanterns) ── */
  _buildSectorMarkers(points) {
    const indices = this.sectorIndices.length > 0 ? this.sectorIndices : [Math.floor(points.length / 3), Math.floor(points.length * 2 / 3)];

    indices.forEach((idx, i) => {
      if (idx < 0 || idx >= points.length) return;
      const p = points[idx];
      const color = (i % 2 === 0) ? 0xe74c3c : 0xf1c40f; // Red or Yellow

      // Glowing Ground Strip
      const { geometry: stripGeo } = this._extrudeTrackStrip([points[idx], points[(idx+1)%points.length]], this.trackWidth, { 
        yOffset: 0.23,
        closeLoop: false // CRITICAL: Sector line is an open segment
      });
      const stripMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0 });
      this.group.add(new THREE.Mesh(stripGeo, stripMat));

      // Japan Paper Lanterns on sides
      const createLantern = (offset) => {
          const lGroup = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.8 }));
          lGroup.add(body);
          const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 2.8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
          top.position.y = 1.7;
          lGroup.add(top);
          
          lGroup.position.set(p.x + offset.x, (p.y||0) + 10, p.z + offset.z);
          this.group.add(lGroup);
      };

      const nx = -(points[(idx+1)%points.length].z - points[idx].z);
      const nz = (points[(idx+1)%points.length].x - points[idx].x);
      const len = Math.sqrt(nx*nx + nz*nz) || 1;
      const offX = nx/len * (this.trackWidth/2 + 5);
      const offZ = nz/len * (this.trackWidth/2 + 5);

      createLantern({ x: offX, z: offZ });
      createLantern({ x: -offX, z: -offZ });

      this._addTextSprite(`SECTOR ${i+1}`, p.x, 15, p.z, color);
    });
  }

  /* ── Pit Lane ── */
  _buildPitLane(points) {
    // Extrude the pit lane surface
    const { geometry, material } = this._extrudeTrackStrip(points, this.pitLaneWidth, {
      color: 0x33333a,
      roughness: 0.7,
      metalness: 0.05,
      yOffset: 0.15,
      closeLoop: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Pit lane edge
    const edgeGeo = this._buildEdgeStrip(points, this.pitLaneWidth / 2, this.pitLaneWidth / 2 + 1, 0.15, false);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x444450 });
    this.group.add(new THREE.Mesh(edgeGeo, edgeMat));

    const edgeGeo2 = this._buildEdgeStrip(points, -this.pitLaneWidth / 2 - 1, -this.pitLaneWidth / 2, 0.15, false);
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
      const isLoop = opts.closeLoop !== false;
      
      let tx, tz;
      if (isLoop) {
        const pNext = points[(i + 1) % points.length];
        const pPrev = points[(i - 1 + points.length) % points.length];
        tx = pNext.x - pPrev.x;
        tz = pNext.z - pPrev.z;
      } else {
        // Open line: Use forward/backward difference at ends
        if (i === 0) {
          tx = points[1].x - p.x;
          tz = points[1].z - p.z;
        } else if (i === points.length - 1) {
          tx = p.x - points[i - 1].x;
          tz = p.z - points[i - 1].z;
        } else {
          tx = points[i + 1].x - points[i - 1].x;
          tz = points[i + 1].z - points[i - 1].z;
        }
      }
      
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;

      vertices.push(
        p.x + nx * halfW, (p.y || 0) + yOffset, p.z + nz * halfW,
        p.x - nx * halfW, (p.y || 0) + yOffset, p.z - nz * halfW
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
    if (opts.closeLoop !== false) {
      const last = (points.length - 1) * 2;
      indices.push(last, last + 1, 0);
      indices.push(last + 1, 1, 0);
    }

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
  _buildEdgeStrip(points, offsetInner, offsetOuter, yOffset = 0.12, closeLoop = true) {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const isLoop = closeLoop !== false;
      
      let tx, tz;
      if (isLoop) {
        const pNext = points[(i + 1) % points.length];
        const pPrev = points[(i - 1 + points.length) % points.length];
        tx = pNext.x - pPrev.x;
        tz = pNext.z - pPrev.z;
      } else {
        if (i === 0) {
          tx = points[1].x - p.x;
          tz = points[1].z - p.z;
        } else if (i === points.length - 1) {
          tx = p.x - points[i - 1].x;
          tz = p.z - points[i - 1].z;
        } else {
          tx = points[i + 1].x - points[i - 1].x;
          tz = points[i + 1].z - points[i - 1].z;
        }
      }
      
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;

      vertices.push(
        p.x + nx * offsetInner, (p.y || 0) + yOffset, p.z + nz * offsetInner,
        p.x + nx * offsetOuter, (p.y || 0) + yOffset, p.z + nz * offsetOuter
      );
      normals.push(0, 1, 0, 0, 1, 0);

      if (i < points.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    // Close loop
    if (closeLoop !== false) {
      const last = (points.length - 1) * 2;
      indices.push(last, last + 1, 0);
      indices.push(last + 1, 1, 0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    return geo;
  }

  /**
   * Build a vertical skirt to hide the underside of floating tracks.
   */
  _buildVerticalSkirt(points, offset, topYOffset, bottomYOffset) {
    const vertices = [];
    const indices = [];

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
          p.x + nx * offset, (p.y || 0) + topYOffset, p.z + nz * offset,
          p.x + nx * offset, bottomYOffset, p.z + nz * offset
        );
  
        if (i < points.length - 1) {
          const base = i * 2;
          // Triangle order matters for culling. Assuming offset is outer wall.
          if (offset > 0) {
              indices.push(base, base + 2, base + 1);
              indices.push(base + 1, base + 2, base + 3);
          } else {
              indices.push(base, base + 1, base + 2);
              indices.push(base + 1, base + 3, base + 2);
          }
        }
      }
  
      // Close loop
      const last = (points.length - 1) * 2;
      if (offset > 0) {
          indices.push(last, 0, last + 1);
          indices.push(last + 1, 0, 1);
      } else {
          indices.push(last, last + 1, 0);
          indices.push(last + 1, 1, 0);
      }
  
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.computeVertexNormals();
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
        const yDist = points[fromIdx].y - points[toIdx].y;
        const pitchAngle = Math.atan2(yDist, segLen);
        
        return {
          x: points[fromIdx].x + dx * t,
          y: points[fromIdx].y + (points[toIdx].y - points[fromIdx].y) * t,
          z: points[fromIdx].z + dz * t,
          angle: fwdAngle,
          pitch: pitchAngle,
        };
      }
      remaining -= segLen;
    }
    return { x: points[0].x, y: points[0].y, z: points[0].z, angle: 0, pitch: 0 };
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

      marker.position.set(x, pos.y + 0.15, z);
      
      // We apply pitch then yaw. 
      marker.rotation.order = 'YXZ';
      marker.rotation.y = -pos.angle;
      marker.rotation.x = -Math.PI / 2 - pos.pitch;
      this.group.add(marker);

      // White lateral line behind the number
      const fwdX = Math.sin(pos.angle);
      const fwdZ = Math.cos(pos.angle);
      const boxGeo = new THREE.PlaneGeometry(markerSize * 1.6, 0.2);
      const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.set(x - fwdX * 0.8, pos.y + 0.14, z - fwdZ * 0.8);
      box.rotation.order = 'YXZ';
      box.rotation.y = -pos.angle;
      box.rotation.x = -Math.PI / 2 - pos.pitch;
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
        panel.position.set(p.x + Math.cos(ang) * (this.trackWidth/2 + 1), (p.y||0) + 1.5, p.z - Math.sin(ang) * (this.trackWidth/2 + 1));
        panel.rotation.y = ang;
        this.group.add(panel);
        
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(0.11, 0, 0); // Offset from panel surface
        screen.rotation.y = Math.PI / 2;
        panel.add(screen);
    }
  }

  /**
   * Build an edge strip with independent height mapping for each edge (Inner vs Outer).
   * Creates a sloped profile suitable for 3D kerbs.
   */
  _buildEdgeStripProfile(points, offsetInner, offsetOuter, heightInner, heightOuter) {
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
  
        // Vertex 1: Inner
        vertices.push(p.x + nx * offsetInner, (p.y||0) + heightInner, p.z + nz * offsetInner);
        // Vertex 2: Outer
        vertices.push(p.x + nx * offsetOuter, (p.y||0) + heightOuter, p.z + nz * offsetOuter);

        // Face Normal (Approximation pointing mostly up but sloped)
        const dy = heightOuter - heightInner;
        const dw = offsetOuter - offsetInner;
        const slantNormal = new THREE.Vector3(-nx * dy, dw, -nz * dy).normalize();
        normals.push(slantNormal.x, slantNormal.y, slantNormal.z, slantNormal.x, slantNormal.y, slantNormal.z);
  
        if (i < points.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }
  
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setIndex(indices);
      return geo;
  }

  update(timestamp) {
    if (this.questionBlocks) {
        for (let i = 0; i < this.questionBlocks.length; i++) {
            const block = this.questionBlocks[i];
            block.rotation.y = timestamp * 0.002 + i;
            block.position.y += Math.sin(timestamp * 0.003 + i) * 0.02;
        }
    }
  }
}
