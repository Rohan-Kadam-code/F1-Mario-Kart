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
   * @param {Object|null} transform — { scale, cx, cy }
   */
  build(trackPoints, pitLanePoints = [], circuitData = null, transform = null) {
    this.transform = transform;
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
    
    // Bridge Elevation is now applied via SceneManager before build()
    // but we can still store indices for structural building
    this._detectBridgeIntersection(trackPoints);

    // Build components
    this._buildTerrain(trackPoints, pitLanePoints);
    this._buildRoadSurface(trackPoints);
    this._buildKerbs(trackPoints);
    this._buildRunoff(trackPoints);
    this._buildFinishLine(trackPoints);
    this._buildTrees(trackPoints, pitLanePoints);
    this._buildJapanProps(trackPoints);
    this._buildQuestionBlocks(trackPoints);
    this._buildCenterLine(trackPoints);
    this._buildDRSZones(trackPoints);
    this._buildSectionMarkers(trackPoints);
    this._buildBridgeStructure(trackPoints);

    if (pitLanePoints.length > 2) {
      this._buildPitLane(pitLanePoints);
    }


    if (circuitData) {
      this._buildCircuitNameLabel(circuitData);
      this._buildEnvironment(trackPoints);
      this._buildLandmarks(trackPoints);
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

  /* ── Figure-Eight Flyover (Suzuka Bridge) ── */
  _detectBridgeIntersection(points) {
    if (this.circuitData && this.circuitData.bridge) {
      // Bridge explicitly defined in data, we don't need detection for rendering structs
      // However, we mark the overIdx points as bridges so the terrain builder knows to clear the deck
      const range = this.circuitData.bridge.overIdxRange;
      if (range) {
        for (let i = range[0]; i <= range[1]; i++) {
          if (points[i]) points[i].isBridge = true;
        }
      }
    }
  }

  /* ── Bridge & Tunnel Structural Details ── */
  _buildBridgeStructure(points) {
    if (!this.circuitData || !this.circuitData.bridge || !this.circuitData.bridge.overIdxRange) return;

    const range = this.circuitData.bridge.overIdxRange;
    const bridgePoints = [];
    
    // Extract strictly the top part of the bridge
    for (let i = range[0]; i <= range[1]; i++) {
        if (points[i]) bridgePoints.push(points[i]);
    }

    if (bridgePoints.length < 2) return;

    // 1. Concrete Skirts (Dense walls from bridge deck to ground)
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8 });
    
    // Relative drop of 2.5 units (creates a solid deck but leaves the lower track completely clear)
    const leftSkirt = this._buildVerticalSkirt(bridgePoints, this.trackWidth/2 + 0.5, 0.1, -2.5, false);
    this.group.add(new THREE.Mesh(leftSkirt, bridgeMat));
    
    const rightSkirt = this._buildVerticalSkirt(bridgePoints, -(this.trackWidth/2 + 0.5), 0.1, -2.5, false);
    this.group.add(new THREE.Mesh(rightSkirt, bridgeMat));

    // 2. Giant Side-Banners (Pirelli-style)
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512; bannerCanvas.height = 128;
    const bctx = bannerCanvas.getContext('2d');
    bctx.fillStyle = '#ffcc00'; bctx.fillRect(0,0,512,128);
    bctx.fillStyle = '#e10600'; bctx.font = 'bold 80px "Inter", sans-serif';
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.fillText('SUZUKA CIRCUIT', 256, 64);
    
    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    bannerTex.wrapS = THREE.RepeatWrapping;
    bannerTex.repeat.set(10, 1); // Tile the text along the bridge
    
    const bannerMat = new THREE.MeshStandardMaterial({ 
        map: bannerTex,
        roughness: 0.4,
        emissive: 0x221100,
        emissiveIntensity: 0.5
    });

    const leftPanel = this._buildVerticalSkirt(bridgePoints, this.trackWidth/2 + 0.7, 0.4, -4.5, false);
    const lpMesh = new THREE.Mesh(leftPanel, bannerMat);
    this.group.add(lpMesh);

    const rightPanel = this._buildVerticalSkirt(bridgePoints, -(this.trackWidth/2 + 0.7), 0.4, -4.5, false);
    const rpMesh = new THREE.Mesh(rightPanel, bannerMat);
    this.group.add(rpMesh);

    // 3. Safety Railings (Triple metal rails)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8 });
    for (let h = 1.0; h <= 2.2; h += 0.6) {
        const lr = this._buildEdgeStrip(bridgePoints, this.trackWidth/2 + 0.4, this.trackWidth/2 + 0.5, h, false);
        this.group.add(new THREE.Mesh(lr, railMat));
        const rr = this._buildEdgeStrip(bridgePoints, -(this.trackWidth/2 + 0.5), -(this.trackWidth/2 + 0.4), h, false);
        this.group.add(new THREE.Mesh(rr, railMat));
    }

    // 4. Concrete Bridge Supports (Pillars)
    // Find the exact crossover point by finding the closest point in overIdx to underIdx
    const underRange = this.circuitData.bridge.underIdxRange;
    if (underRange) {
        let minD2 = Infinity;
        let bridgeCenterPoint = null;
        let underpassY = 0;
        let fwdIdx = 0;
        let bwdIdx = 0;

        for (let i = range[0]; i <= range[1]; i++) {
            const overPt = points[i];
            if (!overPt) continue;
            for (let j = underRange[0]; j <= underRange[1]; j++) {
                const underPt = points[j];
                if (!underPt) continue;
                const dist2 = (overPt.x - underPt.x)**2 + (overPt.z - underPt.z)**2;
                if (dist2 < minD2) {
                    minD2 = dist2;
                    bridgeCenterPoint = overPt;
                    underpassY = underPt.y;
                    fwdIdx = Math.min(i + 1, points.length - 1);
                    bwdIdx = Math.max(i - 1, 0);
                }
            }
        }

        if (bridgeCenterPoint) {
            // Find track perpendicular direction
            const dx = points[fwdIdx].x - points[bwdIdx].x;
            const dz = points[fwdIdx].z - points[bwdIdx].z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const nx = -dz / len;
            const nz = dx / len;

            // Height drops from bridge deck to underpass level
            const pillarHeight = bridgeCenterPoint.y - underpassY;
            if (pillarHeight > 0) {
                const pillarGeo = new THREE.CylinderGeometry(2, 2, pillarHeight, 8);
                const pillarMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
                
                // Y is centered in cylinder, so midpoint is underpassY + height / 2
                const midY = underpassY + pillarHeight / 2;

                const lp1 = new THREE.Mesh(pillarGeo, pillarMat);
                lp1.position.set(bridgeCenterPoint.x + nx * (this.trackWidth/2 + 0.5), midY, bridgeCenterPoint.z + nz * (this.trackWidth/2 + 0.5));
                this.group.add(lp1);
                
                const rp1 = new THREE.Mesh(pillarGeo, pillarMat);
                rp1.position.set(bridgeCenterPoint.x - nx * (this.trackWidth/2 + 0.5), midY, bridgeCenterPoint.z - nz * (this.trackWidth/2 + 0.5));
                this.group.add(rp1);
            }
        }
    }
  }

  /* ── Procedural Terrain (Molded Grass Island) ── */
  _buildTerrain(trackPoints, pitLanePoints = []) {
    const allPoints = [];
    const rawLists = [trackPoints, pitLanePoints];
    
    for (const list of rawLists) {
      if (!list || list.length < 2) {
          if (list && list.length === 1) allPoints.push(list[0]);
          continue;
      }
      for (let i = 0; i < list.length; i++) {
        const p1 = list[i];
        allPoints.push(p1);
        
        const next = list[(i + 1) % list.length];
        if (i === list.length - 1 && list === pitLanePoints) continue;
        
        const dx = next.x - p1.x;
        const dy = next.y - p1.y;
        const dz = next.z - p1.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        
        if (dist > 5) {
          const steps = Math.floor(dist / 5);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            allPoints.push({
              x: p1.x + dx * t,
              y: p1.y + dy * t,
              z: p1.z + dz * t,
              isBridge: p1.isBridge || next.isBridge
            });
          }
        }
      }
    }

    if (allPoints.length === 0) return;

    // High-resolution plane for island cliffs
    const size = 6000;
    const segs = 400; // 160k vertices for decent cliff resolutions
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    const margin = 150; 
    minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;

    const baseLevel = -50; // Deep cutoff point for floating islands

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      
      let minDistSq = Infinity;
      let nearestY = null;

      // Only check points if within bounding box
      if (v.x > minX && v.x < maxX && v.z > minZ && v.z < maxZ) {
        for (let j = 0; j < allPoints.length; j += 4) { 
          const pt = allPoints[j];
          if (pt.isBridge) continue; // Ignore overhead bridge points for floor contour

          const dx = v.x - pt.x;
          const dz = v.z - pt.z;
          const d2 = dx*dx + dz*dz;
          
          if (d2 < 14400) { // 120m radius Search
              if (nearestY === null || pt.y < nearestY) {
                  nearestY = pt.y || 0;
              }
              if (d2 < minDistSq) minDistSq = d2;
          } else if (d2 < minDistSq) {
              minDistSq = d2;
              if (nearestY === null) nearestY = pt.y || 0;
          }
        }
      }

      const dist = Math.sqrt(minDistSq);
      
      const islandRadius = 70.0;
      const cliffDrop = 15.0; // Distance over which steep drop occurs
      
      if (nearestY === null) {
          v.y = baseLevel;
      } else {
          // Inner island surface
          if (dist < islandRadius) {
            // Grass level (+ slight low-poly noise)
            // Track is generated at +3.0 offset, so grass should sit right below it (2.85)
            const noise = (Math.sin(v.x * 0.1) * Math.cos(v.z * 0.1)) * 1.5;
            v.y = nearestY + 2.85 + noise; 
          } else if (dist < islandRadius + cliffDrop) {
            // Cliff face drop
            const t = (dist - islandRadius) / cliffDrop;
            const smoothT = Math.pow(t, 0.5); // Curves out over the bottom
            v.y = THREE.MathUtils.lerp(nearestY + 2.85, baseLevel, smoothT);
          } else {
             // Under void (island bottom)
             v.y = baseLevel;
          }
      }
      
      pos.setXYZ(i, v.x, v.y, v.z);

      // Vertex Colors: Grass vs Sand/Cliff
      const color = new THREE.Color();
      // Only vertices that are near the surface level are green, others are sandy cliff
      if (nearestY !== null && v.y > nearestY && v.y > baseLevel + 1) {
          color.setHex(0x5ddb3e); // Vibrant green
      } else {
          color.setHex(0xe0cda9); // Sand/Rock cliff
      }
      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true, // LOW-POLY effect
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2
    });
    
    // Removed geo.scale(1, 1.5, 1) entirely to preserve true Y coordinates
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ── Road Surface (Stylized Tarmac) ── */
  _buildRoadSurface(points) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x3a3c3d, // Dark flat grey
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true, // Clean look
      side: THREE.DoubleSide
    });
    
    const { geometry } = this._extrudeTrackStrip(points, this.trackWidth, {
      yOffset: 3.0 // Restored basic Track lift (+3m)
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Clean white boundary lines
    const lineW = 0.5;
    const edgeOuter = this.trackWidth / 2;
    const edgeInner = edgeOuter - lineW;
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true });
    
    const leftLineGeo = this._buildEdgeStrip(points, edgeInner, edgeOuter, 3.01); 
    this.group.add(new THREE.Mesh(leftLineGeo, lineMat));
    
    const rightLineGeo = this._buildEdgeStrip(points, -edgeOuter, -edgeInner, 3.01); 
    this.group.add(new THREE.Mesh(rightLineGeo, lineMat.clone()));
  }

  /* ── 1.5m Wide Ribbon Kerbs (Flat Shaded) ── */
  _buildKerbs(points) {
    const kerbWidth = 1.5; 
    const innerW = this.trackWidth / 2;
    const outerW = innerW + kerbWidth;
    
    const kerbMat = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.1,
        vertexColors: true,
        flatShading: true
    });

    const vertices = [];
    const colors = [];
    const indices = [];

    const colorRed = new THREE.Color(0xff1a1a);
    const colorWhite = new THREE.Color(0xffffff);

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const pNext = points[(i+1)%points.length];
        const pPrev = points[(i-1+points.length)%points.length];
        
        const tx = pNext.x - pPrev.x;
        const tz = pNext.z - pPrev.z;
        const len = Math.sqrt(tx*tx + tz*tz) || 1;
        const nx = -tz / len;
        const nz = tx / len;

        // Stripe color
        const color = (Math.floor(i / 3) % 2 === 0) ? colorRed : colorWhite;

        // Left Kerb
        const l_idx = vertices.length / 3;
        vertices.push(p.x + nx * innerW, (p.y||0) + 3.02, p.z + nz * innerW);
        vertices.push(p.x + nx * outerW, (p.y||0) + 3.02, p.z + nz * outerW);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);

        // Right Kerb
        const r_idx = vertices.length / 3;
        vertices.push(p.x - nx * outerW, (p.y||0) + 3.02, p.z - nz * outerW);
        vertices.push(p.x - nx * innerW, (p.y||0) + 3.02, p.z - nz * innerW);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);

        if (i < points.length - 1) {
            const next_l = l_idx + 4;
            const next_r = r_idx + 4;
            indices.push(l_idx, l_idx+1, next_l);
            indices.push(l_idx+1, next_l+1, next_l);
            indices.push(r_idx, r_idx+1, next_r);
            indices.push(r_idx+1, next_r+1, next_r);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    this.group.add(new THREE.Mesh(geo, kerbMat));
  }

  /* ── 15m Wide Runoff Area (Flat shaded, Clean) ── */
  _buildRunoff(points) {
    const runoffWidth = 15.0;
    const innerW = this.trackWidth / 2 + 1.5; 
    const outerW = innerW + runoffWidth;
    
    const runoffY = 2.85; 

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0x44444a, 
        roughness: 0.9,
        side: THREE.DoubleSide,
        flatShading: true
    });

    const lGeo = this._buildEdgeStrip(points, innerW, outerW, runoffY, false);
    this.group.add(new THREE.Mesh(lGeo, mat));

    const rGeo = this._buildEdgeStrip(points, -outerW, -innerW, runoffY, false);
    this.group.add(new THREE.Mesh(rGeo, mat.clone()));
  }


  /* ── Aesthetic: Low-Poly Trees ── */
  _buildTrees(trackPoints, pitLanePoints = []) {
    const allPoints = [...trackPoints, ...pitLanePoints];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }

    const treeCount = 600; // Dense forest
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d2600, flatShading: true });
    
    // Various shades of green for depth
    const greens = [0x2d5a27, 0x3d7a37, 0x1d3a17];
    const leafMats = greens.map(c => new THREE.MeshStandardMaterial({ 
        color: c, 
        roughness: 0.9,
        flatShading: true
    }));

    for (let i = 0; i < treeCount; i++) {
        const x = minX - 100 + Math.random() * (maxX - minX + 200);
        const z = minZ - 100 + Math.random() * (maxZ - minZ + 200);
        
        let minDistSq = Infinity;
        let nearestY = 0;
        for (let j = 0; j < allPoints.length; j += 10) {
            const pt = allPoints[j];
            const d2 = (x - pt.x)**2 + (z - pt.z)**2;
            if (d2 < minDistSq) { minDistSq = d2; nearestY = pt.y || 0; }
        }

        const dist = Math.sqrt(minDistSq);
        
        // Place trees tightly packed on the island but off the track
        if (dist > 25 && dist < 68) {
            const treeGroup = new THREE.Group();
            const leafMat = leafMats[Math.floor(Math.random() * leafMats.length)];
            
            // Pine tree structure
            const layers = 2 + Math.floor(Math.random() * 2);
            for(let l = 0; l < layers; l++) {
                 const t = new THREE.Mesh(new THREE.ConeGeometry(1.5 - l*0.3, 3 - l*0.5, 5), leafMat);
                 t.position.y = 2 + l * 1.5;
                 treeGroup.add(t);
            }
            
            // Trunk
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 5), trunkMat);
            trunk.position.y = 1;
            treeGroup.add(trunk);

            // Calculate exact terrain height
            const noise = (Math.sin(x * 0.1) * Math.cos(z * 0.1)) * 1.5;
            let terrainY = nearestY + 2.85 + noise; 
            
            treeGroup.position.set(x, terrainY, z);
            treeGroup.scale.setScalar(0.8 + Math.random() * 1.2);
            treeGroup.rotation.y = Math.random() * Math.PI;
            this.group.add(treeGroup);
        }
    }
  }

  /* ── Island Props: Ferris Wheel, Balloons, Tents ── */
  _buildJapanProps(points) {
    // We repurpose the Japan Props function to build the generic Island Amusement Props

    // 1. Hot Air Balloons
    const balloonMat = new THREE.MeshStandardMaterial({ color: 0xff3366, flatShading: true });
    const balloonGeo = new THREE.SphereGeometry(6, 8, 8); // Low poly
    const basketGeo = new THREE.BoxGeometry(2, 2, 2);
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true });
    
    const balloonColors = [0xff3366, 0x33ccff, 0xffcc00, 0x66ff66];

    for(let i=0; i<5; i++) {
        const bg = new THREE.Group();
        const bm = new THREE.Mesh(balloonGeo, new THREE.MeshStandardMaterial({ color: balloonColors[i%4], flatShading: true }));
        bg.add(bm);
        const bk = new THREE.Mesh(basketGeo, basketMat);
        bk.position.y = -8;
        bg.add(bk);
        
        bg.position.set(
            points[0].x - 300 + Math.random() * 600,
            80 + Math.random() * 60, // Very high in the sky
            points[0].z - 300 + Math.random() * 600
        );
        this.group.add(bg);
    }

    // 2. Ferris Wheel
    const wheelGroup = new THREE.Group();
    const ironMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.5, flatShading: true });
    
    // Stands
    const leftStand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2, 40, 4), ironMat);
    leftStand.position.set(-6, 20, 0); leftStand.rotation.z = -0.2;
    wheelGroup.add(leftStand);
    const rightStand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2, 40, 4), ironMat);
    rightStand.position.set(6, 20, 0); rightStand.rotation.z = 0.2;
    wheelGroup.add(rightStand);
    
    // Main Wheel
    const wheel = new THREE.Group();
    const wRim = new THREE.Mesh(new THREE.TorusGeometry(20, 0.5, 8, 16), ironMat);
    wheel.add(wRim);
    
    // Spokes and Cars
    for(let i=0; i<12; i++) {
        const angle = (i/12) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 40, 4), ironMat);
        spoke.rotation.x = Math.PI/2;
        spoke.rotation.z = angle;
        wheel.add(spoke);

        // Car
        const car = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshStandardMaterial({ color: balloonColors[i%4], flatShading: true }));
        car.position.set(Math.cos(angle)*20, Math.sin(angle)*20, 0);
        wheel.add(car);
    }
    wheel.position.y = 40;
    wheelGroup.add(wheel);

    // Place Ferris wheel on a safe grass spot
    const pFar = points[Math.floor(points.length * 0.4)];
    if(pFar) {
         wheelGroup.position.set(pFar.x + 80, (pFar.y || 0) + 2.85, pFar.z - 80);
         wheelGroup.rotation.y = Math.PI/4;
         this.group.add(wheelGroup);
    }
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
        block.position.set(p.x, (p.y||0) + 1.5 + 8, p.z);
        this.group.add(block);
        this.questionBlocks.push(block);
    }
  }

  /* ── Center dashed line ── */
  _buildCenterLine(points) {
    const dashMod = 20; // Every 20 points
    const dashLength = 8; // Dash is 8 points long

    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        roughness: 0.3,
        metalness: 0.1,
        emissive: 0x444444,
        side: THREE.DoubleSide,
        depthWrite: false, 
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    for (let i = 0; i < points.length - dashMod; i += dashMod) {
        const segPoints = points.slice(i, i + dashLength + 1);
        if (segPoints.length < 2) continue;
        
        const { geometry } = this._extrudeTrackStrip(segPoints, 0.6, { 
            yOffset: 1.53, // Above main road (1.5)
            closeLoop: false 
        });
        
        const dash = new THREE.Mesh(geometry, mat);
        this.group.add(dash);
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
    checkerGroup.position.set(p0.x, p0.y + 0.25, p0.z); // Layer 5
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
        yOffset: 1.55, // Layer 2
        closeLoop: false 
      });

      const drsMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.25,
        emissive: 0x00ffff,
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

      this.group.add(new THREE.Mesh(drsGeo, drsMat));
    }
  }

  _buildSectorMarkers(points) {
    const indices = this.sectorIndices.length > 0 ? this.sectorIndices : [Math.floor(points.length / 3), Math.floor(points.length * 2 / 3)];

    indices.forEach((idx, i) => {
      if (idx < 0 || idx >= points.length) return;
      const p = points[idx];
      const color = (i % 2 === 0) ? 0xe74c3c : 0xf1c40f; // Red or Yellow

      // Glowing Ground Strip
      const { geometry: stripGeo } = this._extrudeTrackStrip([points[idx], points[(idx+1)%points.length]], this.trackWidth, { 
        yOffset: 1.54, // Layer 4
        closeLoop: false 
      });
      const stripMat = new THREE.MeshStandardMaterial({ 
          color, 
          emissive: color, 
          emissiveIntensity: 1.0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
      });
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
      yOffset: 1.5, // Match main road (1.5)
      closeLoop: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Pit lane edge
    const edgeGeo = this._buildEdgeStrip(points, this.pitLaneWidth / 2, this.pitLaneWidth / 2 + 1, 1.51, false);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x444450 });
    this.group.add(new THREE.Mesh(edgeGeo, edgeMat));

    const edgeGeo2 = this._buildEdgeStrip(points, -this.pitLaneWidth / 2 - 1, -this.pitLaneWidth / 2, 1.51, false);
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
   * Build a vertical wall/skirt following the track points
   */
  _buildVerticalSkirt(points, offset, topYOffset = 0, bottomYOffset = -2, closeLoop = true) {
      if (points.length < 2) return new THREE.BufferGeometry();
  
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
          p.x + nx * offset, (p.y || 0) + bottomYOffset, p.z + nz * offset
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
      if (closeLoop) {
          const last = (points.length - 1) * 2;
          if (offset > 0) {
              indices.push(last, 0, last + 1);
              indices.push(last + 1, 0, 1);
          } else {
              indices.push(last, last + 1, 0);
              indices.push(last + 1, 1, 0);
          }
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
  }

  /* ─────────────────────────────────────────────
     Suzuka-Specific 3D Environment (Ponds & Buildings)
     ───────────────────────────────────────────── */

  /** Create 3D water features (ponds/lakes) */
  _buildEnvironment() {
    if (!this.circuitData || !this.circuitData.ponds || !this.transform) return;

    const { scale, cx, cy } = this.transform;
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x009dff,
        metalness: 0.1,
        roughness: 0.2,
        transparent: true,
        opacity: 0.8,
        emissive: 0x003366,
        emissiveIntensity: 0.8
    });

    for (const pond of this.circuitData.ponds) {
      const shape = new THREE.Shape();
      let avgX = 0, avgZ = 0;
      pond.coords.forEach((c, i) => {
        const p_raw = this._projectLatLng(c[0], c[1]);
        const x = (p_raw.x - cx) * scale;
        const z = -(p_raw.y - cy) * scale;
        if (i === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
        avgX += x; avgZ += z;
      });
      avgX /= pond.coords.length;
      avgZ /= pond.coords.length;
      
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2); // Sit flat on the XZ plane
      const mesh = new THREE.Mesh(geo, waterMat);
      
      // Sample elevation at pond center to avoid being buried
      const elev = this._getElevationAtWorld(avgX, avgZ);
      mesh.position.y = elev - 1.2; // Sit firmly ON the recessed terrain
      this.group.add(mesh);
    }
  }

  /** Build 3D models for landmarks (Podium, Pit Building) */
  _buildLandmarks() {
    if (!this.circuitData || !this.circuitData.buildings || !this.transform) return;

    const { scale, cx, cy } = this.transform;
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8, side: THREE.DoubleSide });

    for (const building of this.circuitData.buildings) {
        const shape = new THREE.Shape();
        let avgX = 0, avgZ = 0;
        building.coords.forEach((c, i) => {
            const p_raw = this._projectLatLng(c[0], c[1]);
            const x = (p_raw.x - cx) * scale;
            const z = -(p_raw.y - cy) * scale;
            if (i === 0) shape.moveTo(x, z);
            else shape.lineTo(x, z);
            avgX += x; avgZ += z;
        });
        avgX /= building.coords.length;
        avgZ /= building.coords.length;

        // Correct Extrusion: grow UP along +Y
        const height = building.heightM * scale;
        const extrudeSettings = { depth: height, bevelEnabled: false };
        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        // Shape is in XY plane. Extrusion is in +Z.
        // We want +Z to become +Y.
        // Rotate +90 around X: X stays X, Y becomes -Z, Z becomes Y.
        geo.rotateX(Math.PI / 2);
        
        const mesh = new THREE.Mesh(geo, buildingMat);
        const elev = this._getElevationAtWorld(avgX, avgZ);
        mesh.position.y = elev + 1.5; // Match elevated track level
        this.group.add(mesh);

        // Add a "Roof" (top face)
        const roofGeo = new THREE.ShapeGeometry(shape);
        roofGeo.rotateX(Math.PI / 2);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = elev + height + 1.6;
        this.group.add(roof);

        // Podium Detail
        if (building.type === 'pit') {
            const p0_raw = this._projectLatLng(building.coords[0][0], building.coords[0][1]);
            const p0_x = (p0_raw.x - cx) * scale;
            const p0_z = -(p0_raw.y - cy) * scale;

            const podiumGeo = new THREE.BoxGeometry(15, 3, 8);
            const podiumMat = new THREE.MeshStandardMaterial({ color: 0xe10600, emissive: 0x440000 });
            const podium = new THREE.Mesh(podiumGeo, podiumMat);
            podium.position.set(p0_x, elev + height + 3.0, p0_z);
            this.group.add(podium);
        }
    }
  }

  /** Sample elevation based on nearest track fraction */
  _getElevationAtWorld(wx, wz) {
    if (!this.circuitData.elevationProfile || !this.trackPoints || this.trackPoints.length === 0) return 0;
    
    // Find nearest track point to find the local fraction
    let minDistSq = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < this.trackPoints.length; i += 4) {
        const pt = this.trackPoints[i];
        const d2 = (wx - pt.x)**2 + (wz - pt.z)**2;
        if (d2 < minDistSq) {
            minDistSq = d2;
            nearestIdx = i;
        }
    }
    
    const fraction = nearestIdx / this.trackPoints.length;
    return this._interpolateElevation(fraction, this.circuitData.elevationProfile);
  }

  /** Mercator projection for lat/lng to world coordinates */
  _projectLatLng(lng, lat) {
    const DEG2RAD = Math.PI / 180;
    const R = 6378137;
    return {
      x: R * lng * DEG2RAD,
      y: R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2)),
    };
  }

  /** Build high-fidelity bridge details: underside slab and railings */
  _buildBridgeStructure(points) {
    if (!this.circuitData || !this.circuitData.bridge) return;
    const bridge = this.circuitData.bridge;
    const overRange = bridge.overIdxRange;
    if (!overRange) return;

    const overPoints = points.slice(overRange[0], overRange[1]);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x88888a, roughness: 0.8 });
    const railingMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });

    // 1. Concrete Underside Slab (Prompt Logic)
    const slabGeo = this._buildEdgeStrip(overPoints, -this.trackWidth/2, this.trackWidth/2, 2.7, false); // Recessed -0.3m
    const slab = new THREE.Mesh(slabGeo, bridgeMat);
    this.group.add(slab);

    // 2. Railing Pillars & Horizontal Bars
    const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 4);
    const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4); 
    barGeo.rotateZ(Math.PI / 2);

    for (let i = 0; i < overPoints.length; i += 2) {
        const p = overPoints[i];
        const pNext = overPoints[(i+1)%overPoints.length];
        const angle = Math.atan2(pNext.x - p.x, pNext.z - p.z) + Math.PI/2;
        const dist = Math.sqrt((pNext.x - p.x)**2 + (pNext.z - p.z)**2);

        // Left Railing Post
        const lPost = new THREE.Mesh(postGeo, railingMat);
        lPost.position.set(p.x + Math.cos(angle) * (this.trackWidth/2 + 0.2), p.y + 3.6, p.z - Math.sin(angle) * (this.trackWidth/2 + 0.2));
        this.group.add(lPost);

        // Right Railing Post
        const rPost = new THREE.Mesh(postGeo, railingMat);
        rPost.position.set(p.x - Math.cos(angle) * (this.trackWidth/2 + 0.2), p.y + 3.6, p.z + Math.sin(angle) * (this.trackWidth/2 + 0.2));
        this.group.add(rPost);

        if (i < overPoints.length - 1) {
            // Horizontal Bar (scaled to segment distance)
            const lBar = new THREE.Mesh(barGeo, railingMat);
            lBar.scale.x = dist;
            lBar.position.set(p.x + Math.cos(angle) * (this.trackWidth/2 + 0.2), p.y + 3.9, p.z - Math.sin(angle) * (this.trackWidth/2 + 0.2));
            lBar.rotation.y = angle;
            this.group.add(lBar);
        }
    }
  }

  /** Build 3D Section Labels (Spoon, 130R, etc.) */
  _buildSectionMarkers(points) {
    if (!this.circuitData || !this.circuitData.sectionMarkers) return;

    for (const marker of this.circuitData.sectionMarkers) {
        const pIdx = Math.floor(marker.t * points.length);
        const p = points[pIdx];
        if (!p) continue;

        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';
        ctx.fillText(marker.label, 128, 45);

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(30, 7, 1);
        sprite.position.set(p.x, p.y + 12.0, p.z); // High hover visibility
        this.group.add(sprite);
    }
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
