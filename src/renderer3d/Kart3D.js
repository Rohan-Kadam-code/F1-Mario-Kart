/**
 * Kart3D — Procedurally generated 3D F1 kart.
 * Car-shaped mesh with team colors, rotating wheels, T-cam, labels,
 * speed trail, star power, mushroom boost, and DRS animation.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export class Kart3D {
  constructor(driverInfo, teamColor, scene, year = 2026) {
    this.driverNumber = driverInfo.driver_number;
    this.abbreviation = driverInfo.name_acronym || driverInfo.broadcast_name?.slice(0, 3)?.toUpperCase() || '???';
    this.fullName = driverInfo.full_name || driverInfo.broadcast_name || 'Unknown';
    this.teamName = driverInfo.team_name || '';
    this.teamColor = teamColor;
    this.teamColorHex = parseInt(teamColor.replace('#', ''), 16);
    this.defaultTeamColor = this.teamColorHex;
    this.scene = scene;
    this.year = year;
    this.position = 20;
    this.progress = 0;
    this.speed = 0;
    this.gap = '';
    this.tireCompound = '';
    this.currentAngle = 0;
    this.targetAngle = 0;
    this.currentPitch = 0;
    this.targetPitch = 0;
    this.inGarage = false; // Flag to pause track-physics
    this.hasStar = false;
    this.starTimer = 0;
    this.hasDRS = false;
    this.hasMushroom = false;
    this.isPitting = false;
    this.isRetired = false;
    this.labelsVisible = true;
    this.isVisible = true;

    this.mesh = new THREE.Group();
    this.mesh.name = `Kart_${this.driverNumber}`;
    this._buildKart();
    scene.add(this.mesh);

    this.trail = [];
    this.maxTrail = 30;
    this._buildTrail();
    this._buildNameLabel();
    this._buildPositionBadge();

    this.starLight = new THREE.PointLight(0xffdd00, 0, 40);
    this.starLight.position.set(0, 5, 0);
    this.mesh.add(this.starLight);

    this._targetPos = new THREE.Vector3(0, 0, 0);
    this._currentPos = new THREE.Vector3(0, 0, 0);
    this._lerpFactor = 0.4;       // 'Rubber-Band' smoothing (absorbs GPS irregularities)
    this._angleLerpFactor = 0.08; // Heavier, more stable steering

    // Side-by-Side Lateral Logic
    this.lateralOffset = 0;       // Current smoothed offset in meters
    this.targetLateralOffset = 0; // Target offset from center (Inside/Outside line)
    this._lateralLerp = 0.06;     // Gentle drift into overtaking lanes
  }

  _buildKart() {
    const bodyColor = this.teamColorHex;
    
    // Premium Material setup
    const bodyMat = new THREE.MeshPhysicalMaterial({ 
      color: bodyColor, 
      roughness: 0.15, 
      metalness: 0.8,
      clearcoat: 1.0, 
      clearcoatRoughness: 0.05,
      reflectivity: 1.0,
      name: 'teamPaint'
    });

    const blackMat = new THREE.MeshPhysicalMaterial({ 
      color: 0x111111, 
      roughness: 0.3, 
      metalness: 0.6,
      clearcoat: 0.5 
    });

    const carbonMat = new THREE.MeshStandardMaterial({ 
      color: 0x111111, 
      roughness: 0.8, 
      metalness: 0.2 
    });

    const wingMat = new THREE.MeshPhysicalMaterial({ 
      color: bodyColor, 
      roughness: 0.2, 
      metalness: 0.7,
      clearcoat: 0.4,
      name: 'teamPaint'
    });

    // ── Chassis Group (for Lean/Vibration) ──
    this.chassis = new THREE.Group();
    this.mesh.add(this.chassis);

    // Main Core Chassis (Narrower for Coke-Bottle)
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.65, 4.0, 3, 0.15), bodyMat);
    body.position.set(0, 0.95, 0.1);
    body.castShadow = true;
    this.chassis.add(body);

    // --- NEW: Carbon Floor Tray ---
    const floorGeo = new RoundedBoxGeometry(2.2, 0.05, 4.4, 2, 0.02);
    const floorTray = new THREE.Mesh(floorGeo, carbonMat);
    floorTray.position.set(0, 0.5, 0.4); 
    floorTray.castShadow = true;
    this.chassis.add(floorTray);

    // Refined Nose (High-segment Cone)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.5, 32), bodyMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.85, 3.2);
    nose.castShadow = true;
    this.chassis.add(nose);

    // Shark Fin (Slanted to match engine cover)
    const sfGeo = new THREE.BufferGeometry();
    const sfVertices = new Float32Array([
      0, 2.1, -1.0,   // Top front (nestled in airbox)
      0, 2.1, -2.8,   // Top rear (sweeping high to rear wing)
      0, 1.2, -2.8,   // Bottom rear
      0, 1.5, -1.0    // Bottom front
    ]);
    sfGeo.setAttribute('position', new THREE.BufferAttribute(sfVertices, 3));
    sfGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const sf = new THREE.Mesh(sfGeo, bodyMat);
    sf.material.side = THREE.DoubleSide; 
    this.chassis.add(sf);

    // --- NEW: Slanted Engine Spine (Aero Path from Airbox) ---
    const spineGeo = new THREE.BufferGeometry();
    const spineVertices = new Float32Array([
      -0.2, 2.0, -0.7,    // Top front L
       0.2, 2.0, -0.7,    // Top front R
       0.1, 1.2, -2.8,    // Top rear R
      -0.1, 1.2, -2.8,    // Top rear L
      -0.4, 1.1, -0.7,    // Bottom front L
       0.4, 1.1, -0.7,    // Bottom front R
       0.2, 1.1, -2.8,    // Bottom rear R
      -0.2, 1.1, -2.8     // Bottom rear L
    ]);
    spineGeo.setAttribute('position', new THREE.BufferAttribute(spineVertices, 3));
    spineGeo.setIndex([
      0, 2, 1, 0, 3, 2, // Top
      4, 5, 6, 4, 6, 7, // Bottom
      0, 1, 5, 0, 5, 4, // Front
      2, 3, 7, 2, 7, 6, // Back
      0, 4, 7, 0, 7, 3, // Left
      1, 2, 6, 1, 6, 5  // Right
    ]);
    const spine = new THREE.Mesh(spineGeo, bodyMat);
    this.chassis.add(spine);

    // --- NEW: Engine Cover "Cannons" (RB20 Style) ---
    const cannonGeo = new RoundedBoxGeometry(0.5, 0.5, 2.5, 2, 0.15);
    const lc = new THREE.Mesh(cannonGeo, bodyMat);
    lc.position.set(0.65, 1.3, -0.5);
    lc.rotation.x = -0.1;
    this.chassis.add(lc);

    const rc = new THREE.Mesh(cannonGeo, bodyMat);
    rc.position.set(-0.65, 1.3, -0.5);
    rc.rotation.x = -0.1;
    this.chassis.add(rc);

    // Sidepods (Tapered for Coke-Bottle)
    const spGeo = new RoundedBoxGeometry(0.85, 0.6, 2.4, 3, 0.2);
    const lsp = new THREE.Mesh(spGeo, bodyMat);
    lsp.position.set(1.0, 0.85, 0.4);
    lsp.rotation.y = 0.25; 
    this.chassis.add(lsp);

    const rsp = new THREE.Mesh(spGeo, bodyMat);
    rsp.position.set(-1.0, 0.85, 0.4);
    rsp.rotation.y = -0.25; 
    this.chassis.add(rsp);

    // Bargeboards (Repositioned for Coke-Bottle)
    const bbGeo = new RoundedBoxGeometry(0.05, 0.8, 1.2, 2, 0.02);
    const lbb = new THREE.Mesh(bbGeo, carbonMat); lbb.position.set(0.85, 0.8, 1.8); this.chassis.add(lbb);
    const rbb = new THREE.Mesh(bbGeo, carbonMat); rbb.position.set(-0.85, 0.8, 1.8); this.chassis.add(rbb);

    // Mirror Pods (Repositioned for the new shoulders)
    const mGeo = new THREE.SphereGeometry(0.15, 12, 10);
    const lm = new THREE.Mesh(mGeo, blackMat); lm.position.set(0.75, 1.5, 0.8); this.chassis.add(lm);
    const rm = new THREE.Mesh(mGeo, blackMat); rm.position.set(-0.75, 1.5, 0.8); this.chassis.add(rm);

    // Cockpit & Halo
    const cockpit = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.5, 1.5, 2, 0.1), blackMat);
    cockpit.position.set(0, 1.4, 0.0);
    this.chassis.add(cockpit);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 16, 32, Math.PI), blackMat);
    halo.rotation.x = -Math.PI / 2;
    halo.rotation.z = Math.PI;
    halo.position.set(0, 1.6, 0.6);
    this.chassis.add(halo);

    // Halo Front Pillar (V-Support)
    const hpGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.6, 8);
    const hp = new THREE.Mesh(hpGeo, blackMat);
    hp.position.set(0, 1.35, 1.05);
    hp.rotation.x = 0.4;
    this.chassis.add(hp);

    // Driver Helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 20), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    helmet.position.set(0, 1.8, 0.0);
    this.chassis.add(helmet);

    // Rear Wing (Multi-Element: Mainplane + Flap)
    const rwMain = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.08, 0.6, 2, 0.04), wingMat);
    rwMain.position.set(0, 2.1, -3.2);
    this.rearWing = rwMain; // Link for DRS
    this.chassis.add(rwMain);

    const rwFlap = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.06, 0.4, 2, 0.04), wingMat);
    rwFlap.position.set(0, 2.25, -3.25);
    rwFlap.rotation.x = -0.2;
    this.chassis.add(rwFlap);

    // Rear Wing Swan-Neck Struts
    const strutGeo = new THREE.BoxGeometry(0.1, 1.4, 0.4);
    const lStrut = new THREE.Mesh(strutGeo, carbonMat); 
    lStrut.position.set(0.3, 1.5, -2.4); 
    lStrut.rotation.x = -0.55; 
    this.chassis.add(lStrut);

    const rStrut = new THREE.Mesh(strutGeo, carbonMat); 
    rStrut.position.set(-0.3, 1.5, -2.4); 
    rStrut.rotation.x = -0.55; 
    this.chassis.add(rStrut);

    const epMat = wingMat;
    const epGeo = new RoundedBoxGeometry(0.1, 1.4, 1.2, 2, 0.05);
    const lep = new THREE.Mesh(epGeo, epMat); lep.position.set(1.8, 1.6, -3.2); this.chassis.add(lep);
    const rep = new THREE.Mesh(epGeo, epMat); rep.position.set(-1.8, 1.6, -3.2); this.chassis.add(rep);

    // --- NEW: Endplate LED Strips ---
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 2.0 });
    const ledGeo = new THREE.BoxGeometry(0.12, 0.6, 0.05);
    const leftLed = new THREE.Mesh(ledGeo, ledMat); leftLed.position.set(1.8, 1.6, -3.8); this.chassis.add(leftLed);
    const rightLed = new THREE.Mesh(ledGeo, ledMat); rightLed.position.set(-1.8, 1.6, -3.8); this.chassis.add(rightLed);

    // --- NEW: Beam Wing (Lower Rear Wing) ---
    const beamWing = new THREE.Mesh(new RoundedBoxGeometry(2.8, 0.05, 0.4, 2, 0.02), carbonMat);
    beamWing.position.set(0, 1.0, -2.8);
    beamWing.rotation.x = -0.15;
    this.chassis.add(beamWing);

    // Front Wing (Multi-Element)
    const fwMain = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.08, 0.5, 2, 0.04), wingMat);
    fwMain.position.set(0, 0.4, 4.3);
    this.chassis.add(fwMain);

    const fwFlap = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.06, 0.4, 2, 0.04), wingMat);
    fwFlap.position.set(0, 0.55, 4.2);
    fwFlap.rotation.x = 0.2;
    this.chassis.add(fwFlap);

    // --- NEW: Primary Airbox (Roll Hoop Intake) ---
    const airboxGeo = new RoundedBoxGeometry(0.7, 0.8, 1.1, 3, 0.15);
    const airbox = new THREE.Mesh(airboxGeo, bodyMat);
    airbox.position.set(0, 1.7, -0.8);
    this.chassis.add(airbox);

    // Intake Scoop (Recessed hole)
    const scoopGeo = new THREE.PlaneGeometry(0.45, 0.4);
    const scoop = new THREE.Mesh(scoopGeo, blackMat);
    scoop.position.set(0, 1.85, -0.24); // Front face of airbox
    this.chassis.add(scoop);

    // T-Cam & T-Wing (Repositioned correctly)
    const tcamColor = (this.driverNumber % 2 === 1) ? 0xffdd00 : 0x111111;
    const tcam = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.15, 0.4, 2, 0.05),
      new THREE.MeshStandardMaterial({ color: tcamColor, emissive: tcamColor, emissiveIntensity: 0.5 }));
    tcam.position.set(0, 2.18, -0.7);
    this.chassis.add(tcam);

    const twing = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.05, 0.2, 2, 0.02), carbonMat);
    twing.position.set(0, 2.15, -2.8);
    this.chassis.add(twing);

    // Diffuser Fins (Smoothened and Widened)
    for (let i = -1; i <= 1; i++) {
      const df = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.4, 0.8, 2, 0.02), carbonMat);
      df.position.set(i * 0.8, 0.4, -2.5);
      this.chassis.add(df);
    }

    // ── Wheels (Filleted & Textured) ──
    this.wheels = [];
    this.wheelGroups = []; 
    this.tireTextures = []; 
    
    // Profile for Front Tyre (Width: ~0.45)
    const frontPoints = [
      new THREE.Vector2(0.35, -0.225), new THREE.Vector2(0.50, -0.225), 
      new THREE.Vector2(0.53, -0.215), new THREE.Vector2(0.545, -0.20), 
      new THREE.Vector2(0.55, -0.175), new THREE.Vector2(0.55, 0.175),  
      new THREE.Vector2(0.545, 0.20),  new THREE.Vector2(0.53, 0.215),  
      new THREE.Vector2(0.50, 0.225),  new THREE.Vector2(0.35, 0.225)
    ];
    
    // Profile for Rear Tyre (Width: ~0.80, EXTREME wide)
    const rearPoints = [
      new THREE.Vector2(0.35, -0.40), new THREE.Vector2(0.50, -0.40), 
      new THREE.Vector2(0.53, -0.39), new THREE.Vector2(0.545, -0.375), 
      new THREE.Vector2(0.55, -0.35), new THREE.Vector2(0.55, 0.35),  
      new THREE.Vector2(0.545, 0.375),  new THREE.Vector2(0.53, 0.39),  
      new THREE.Vector2(0.50, 0.40),  new THREE.Vector2(0.35, 0.40)
    ];
    
    const frontWheelGeo = new THREE.LatheGeometry(frontPoints, 40); 
    const rearWheelGeo = new THREE.LatheGeometry(rearPoints, 40);

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.2 });
    const frontRimGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.46, 24);
    const rearRimGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.81, 24);
    const frontHubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.48, 12);
    const rearHubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.83, 12);

    const wpos = [
      { x: 1.4, y: 0.55, z: 3.1, front: true }, { x: -1.4, y: 0.55, z: 3.1, front: true },
      // Push rear wheels out slightly for better stance
      { x: 1.7, y: 0.55, z: -1.8, front: false }, { x: -1.7, y: 0.55, z: -1.8, front: false },
    ];

    for (const wp of wpos) {
      const wg = new THREE.Group();
      wg.position.set(wp.x, wp.y, wp.z);
      this.mesh.add(wg);

      // Tire Canvas Texture
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      this.tireTextures.push({ canvas, ctx, tex });
      this._drawTireTexture(canvas, ctx, tex, this.tireCompound);

      const tireMat = new THREE.MeshStandardMaterial({ 
        map: tex, 
        roughness: 0.8, 
        metalness: 0.2 
      });

      const isFront = wp.front;
      const wheelGeo = isFront ? frontWheelGeo : rearWheelGeo;
      const rimGeo = isFront ? frontRimGeo : rearRimGeo;
      const hubGeo = isFront ? frontHubGeo : rearHubGeo;

      const w = new THREE.Mesh(wheelGeo, tireMat);
      // Lathe matches world Y alignment, so for Side-to-Side we rotate
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      wg.add(w);

      // Rim & Hub
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      w.add(rim); 

      const hub = new THREE.Mesh(hubGeo, rimMat);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);

      // Brake Disk Glow
      const brakeGlowMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff6600, emissiveIntensity: 0 });
      const brakeGlow = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.05, 8, 16), brakeGlowMat);
      brakeGlow.rotation.y = Math.PI / 2;
      w.add(brakeGlow);
      w.brakeGlow = brakeGlowMat;

      this.wheels.push(w);
      if (wp.front) this.wheelGroups.push(wg);

      // --- Suspension Wishbones ---
      const wishMat = carbonMat;
      const armGeo = new THREE.BoxGeometry(0.08, 0.04, 1.5);
      
      // Top Arm
      const uArm = new THREE.Mesh(armGeo, wishMat);
      uArm.position.set(wp.x * 0.5, wp.y + 0.3, wp.z);
      uArm.lookAt(wp.x, wp.y + 0.3, wp.z);
      this.chassis.add(uArm);

      // Bottom Arm
      const lArm = new THREE.Mesh(armGeo, wishMat);
      lArm.position.set(wp.x * 0.5, wp.y - 0.2, wp.z);
      lArm.lookAt(wp.x, wp.y - 0.2, wp.z);
      this.chassis.add(lArm);
    }

    // --- NEW: Rear Crash Structure ---
    const crashGeo = new THREE.BoxGeometry(0.3, 0.4, 0.8);
    const crashStructure = new THREE.Mesh(crashGeo, carbonMat);
    crashStructure.position.set(0, 0.7, -2.7);
    this.chassis.add(crashStructure);

    // Exhaust Light & Cone
    this.exhaustLight = new THREE.PointLight(0xff6600, 0, 15);
    this.exhaustLight.position.set(0, 0.8, -3.5);
    this.mesh.add(this.exhaustLight);

    const exGeo = new THREE.CylinderGeometry(0.1, 0.2, 0.4, 16);
    this.exhaustCone = new THREE.Mesh(exGeo, new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff6600, emissiveIntensity: 2 }));
    this.exhaustCone.rotation.x = Math.PI / 2;
    this.exhaustCone.position.set(0, 0.8, -3.0); // Moved back slightly
    this.exhaustCone.visible = false;
    this.chassis.add(this.exhaustCone);

    // Neon Underglow
    this.underglow = new THREE.PointLight(this.teamColorHex, 0, 8);
    this.underglow.position.set(0, 0.2, 0);
    this.mesh.add(this.underglow);

    // Brake Light (Mounted on crash structure)
    const brakeMat = new THREE.MeshStandardMaterial({ 
      color: 0x330000, 
      emissive: 0xff0000, 
      emissiveIntensity: 0 
    });
    const brakeGeo = new RoundedBoxGeometry(0.4, 0.3, 0.05, 2, 0.02);
    this.brakeLightMesh = new THREE.Mesh(brakeGeo, brakeMat);
    this.brakeLightMesh.position.set(0, 0.7, -3.15); // End of crash structure
    this.chassis.add(this.brakeLightMesh);

    this.brakeLight = new THREE.PointLight(0xff0000, 0, 10);
    this.brakeLight.position.set(0, 0.7, -3.25);
    this.mesh.add(this.brakeLight);
  }

  _buildTrail() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: this.teamColorHex, transparent: true, opacity: 0.4 });
    this.trailLine = new THREE.Line(geo, mat);
    this.scene.add(this.trailLine);
  }

  _updateTrail() {
    if (!this.trailLine) return;
    this.trail.push({ x: this.mesh.position.x, y: this.mesh.position.y + 0.5, z: this.mesh.position.z });
    if (this.trail.length > this.maxTrail) this.trail.shift();
    const pos = this.trailLine.geometry.attributes.position.array;
    for (let i = 0; i < this.trail.length; i++) {
      pos[i * 3] = this.trail[i].x;
      pos[i * 3 + 1] = this.trail[i].y;
      pos[i * 3 + 2] = this.trail[i].z;
    }
    this.trailLine.geometry.attributes.position.needsUpdate = true;
    this.trailLine.geometry.setDrawRange(0, this.trail.length);
  }

  _buildNameLabel() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 20px "Outfit", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(this.abbreviation, 65, 17);
    ctx.fillStyle = '#ffffff'; ctx.fillText(this.abbreviation, 64, 16);
    const t = new THREE.CanvasTexture(c);
    this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    this.nameSprite.scale.set(5, 1.25, 1); // Reduced from (8, 2)
    this.nameSprite.position.set(0, 4.2, 0); // Lowered from 5
    this.mesh.add(this.nameSprite);
  }

  _buildPositionBadge() {
    this._posBadgeCanvas = document.createElement('canvas');
    this._posBadgeCanvas.width = 64; this._posBadgeCanvas.height = 64;
    this._posBadgeTexture = new THREE.CanvasTexture(this._posBadgeCanvas);
    this.posBadgeSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._posBadgeTexture, transparent: true, depthTest: false }));
    this.posBadgeSprite.scale.set(2, 2, 1); // Reduced from (3, 3)
    this.posBadgeSprite.position.set(2.2, 3.5, 0); // Lowered and brought closer
    this.mesh.add(this.posBadgeSprite);
    this._updatePositionBadge();
  }

  _updatePositionBadge() {
    const ctx = this._posBadgeCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    let bg = '#333';
    if (this.position === 1) bg = '#d4a017';
    else if (this.position === 2) bg = '#888';
    else if (this.position === 3) bg = '#8B5E3C';
    if (this.isPitting) bg = '#e10600';
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(8, 8, 48, 48, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 28px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(this.isPitting ? 'P' : String(this.position), 32, 34);
    this._posBadgeTexture.needsUpdate = true;
  }

  updatePosition(worldX, worldY, worldZ, angle, pitch = 0) {
    this._targetPos.set(worldX, worldY || 0, worldZ);
    this.targetAngle = angle;
    this.targetPitch = pitch;
  }

  // ── Garage Customization Setters ──

  setTeamColor(hexString) {
    if (typeof hexString === 'string') {
      this.teamColor = parseInt(hexString.replace('#', '0x'), 16);
    } else {
      this.teamColor = hexString; // Number
    }
    
    // Update materials iteratively if color is changed in garage
    this.chassis.traverse(child => {
      if (child.isMesh && child.material && child.material.name === 'teamPaint') {
        child.material.color.setHex(this.teamColor);
      }
    });

    // We also need to label materials so they can be dynamically updated:
    // This requires a minor refactor in _buildKart to name the materials.
  }

  setDriverDetails(abbr, num) {
    this.abbreviation = abbr.substring(0, 3).toUpperCase();
    if (this.driver) this.driver.driver_number = parseInt(num) || 1;
    
    // Rebuild sprites
    this.mesh.remove(this.nameSprite);
    if (this.nameSprite.material.map) this.nameSprite.material.map.dispose();
    this.nameSprite.material.dispose();
    this._buildNameTag();
  }

  setTireCompound(compound) {
    this.tireCompound = compound.toUpperCase();
    this._updateTireTextures();
  }

  toggleLabels(show) {
    this.labelsVisible = show;
    if (this.nameSprite) this.nameSprite.visible = show;
    if (this.posBadgeSprite) this.posBadgeSprite.visible = show;
    if (this.trailLine) this.trailLine.visible = show;
  }

  update(timestamp) {
    if (this.isRetired || this.isPitting || !this.isVisible) {
      this.mesh.visible = false;
      if (this.trailLine) this.trailLine.visible = false;
      return;
    }
    this.mesh.visible = true;
    
    // Manage label visibility
    if (this.nameSprite) this.nameSprite.visible = this.labelsVisible;
    if (this.posBadgeSprite) this.posBadgeSprite.visible = this.labelsVisible;
    if (this.trailLine) this.trailLine.visible = this.labelsVisible && !this.inGarage;

    // Track Deceleration for Brake Effects
    const decel = Math.max(0, (this._prevSpeed || 0) - this.speed);
    this._prevSpeed = this.speed;

    if (this.inGarage) return; // Skip position Smoothing in Garage

    // ── Suspension Physics (Isolated Vertical Dampening) ──
    // Horizontal tracking (snappy to follow telemetry accurately)
    this._currentPos.x += (this._targetPos.x - this._currentPos.x) * this._lerpFactor;
    this._currentPos.z += (this._targetPos.z - this._currentPos.z) * this._lerpFactor;

    // Vertical tracking (highly dampened to represent mass and prevent jump glitches)
    let dy = this._targetPos.y - this._currentPos.y;

    // Mathematical Jump Prevention: clamp maximum vertical velocity to 0.4 units per frame (~24m/s incline)
    // Ensures karts track hills perfectly but mathematically CANNOT "pop" up and down.
    if (Math.abs(dy) > 0.4) {
      dy = Math.sign(dy) * 0.4;
    }
    
    // Y applies its own smooth suspension lerp instead of snapping
    this._currentPos.y += dy * (this._lerpFactor * 0.8);

    // ── Apply Lateral Offset (Side-by-Side Lane Logic) ──
    // Smoothly shift target towards desired lane
    this.lateralOffset += (this.targetLateralOffset - this.lateralOffset) * this._lateralLerp;

    // Calculate 'Right' vector based on current forward angle to shift laterally
    // Right = Forward x Up = (sinA, 0, cosA) x (0, 1, 0) => (cosA, 0, -sinA)
    const rightX = Math.cos(this.currentAngle);
    const rightZ = -Math.sin(this.currentAngle);

    const posX = this._currentPos.x + (rightX * this.lateralOffset);
    const posZ = this._currentPos.z + (rightZ * this.lateralOffset);

    // Apply 0.25 offset so tires rest exactly on top of the asphalt layer (which is at +0.20)
    const tireGroundOffset = 0.25; 
    this.mesh.position.set(posX, this._currentPos.y + tireGroundOffset, posZ);

    let ad = this.targetAngle - this.currentAngle;
    while (ad > Math.PI) ad -= Math.PI * 2;
    while (ad < -Math.PI) ad += Math.PI * 2;
    this.currentAngle += ad * this._angleLerpFactor;

    let pd = this.targetPitch - this.currentPitch;
    this.currentPitch += pd * this._angleLerpFactor;

    this.mesh.rotation.order = 'YXZ'; // Yaw first, then pitch
    this.mesh.rotation.y = this.currentAngle;
    this.mesh.rotation.x = this.currentPitch; // Pitch the chassis

    // ── Advanced Animations ──

    // 1. Steering (Front Wheels)
    // Locked to max turning: Clamp to ~25 degrees (0.43 rad)
    const steerAngle = Math.max(-0.43, Math.min(0.43, ad * 4.0)); 
    for (const wg of this.wheelGroups) {
      wg.rotation.y = THREE.MathUtils.lerp(wg.rotation.y, steerAngle, 0.2);
    }

    // 2. Chassis Lean (Roll into corners)
    const targetRoll = Math.max(-0.1, Math.min(0.1, -ad * 0.4)); 
    this.chassis.rotation.z += (targetRoll - this.chassis.rotation.z) * 0.1;

    // 3. High-Speed Vibration & Suspension
    this._smoothSpeed = (this._smoothSpeed || 0) * 0.95 + this.speed * 0.05;
    const speedFactor = Math.min(this._smoothSpeed / 300, 1.0);
    
    // Vertical vibration (subtle jitter)
    const jitter = (Math.random() - 0.5) * 0.02 * speedFactor;
    const bounce = Math.sin((timestamp || 0) * 0.01) * 0.01 * speedFactor;
    this.chassis.position.y = jitter + bounce;

    // 4. Wheel Rotation & Constraints
    // Normal: Spinning along axle. Abnormal: Y/Z locked to prevent tilt.
    const ws = Math.min(this._smoothSpeed, 400) * 0.005;
    for (const w of this.wheels) {
      w.rotation.x += ws; // Local spin
      w.rotation.z = Math.PI / 2; // Locked axle orientation
      w.rotation.y = 0; // Locked vertical
      
      // Dynamic Brake Heat Glow
      if (w.brakeGlow) {
        const brakeHeat = Math.min(decel / 10.0, 1.0); 
        w.brakeGlow.emissiveIntensity = THREE.MathUtils.lerp(w.brakeGlow.emissiveIntensity, brakeHeat * 5, 0.1);
      }
    }

    this._updateTrail();
    this._updateTireTextures();

    // 6. FX, Underglow & Brake Light
    if (this.underglow) {
      const pulse = 0.5 + Math.sin((timestamp || 0) * 0.005) * 0.5;
      this.underglow.intensity = (this.speed > 50) ? (2 + pulse * 2) : (0.5 + pulse * 0.5);
    }

    // Central Brake Light Physics
    if (this.brakeLight) {
      const brakeFactor = Math.min(decel / 8.0, 1.0); 
      this.brakeLight.intensity = THREE.MathUtils.lerp(this.brakeLight.intensity, brakeFactor * 4.0, 0.2);
      
      if (this.brakeLightMesh) {
        this.brakeLightMesh.material.emissiveIntensity = 2.0 + this.brakeLight.intensity * 2.0;
      }
    }

    if (this.exhaustCone) {
      this.exhaustCone.visible = this.speed > 100 || this.hasMushroom;
      this.exhaustCone.scale.setScalar(0.8 + Math.random() * 0.4);
    }

    if (this.hasStar) {
      this.starTimer--;
      if (this.starTimer <= 0) {
        this.hasStar = false; 
        if (this.starLight) this.starLight.intensity = 0;
        this.chassis.traverse(c => {
          if (c.isMesh && c.material && c.material.emissive) {
            c.material.emissive.setHex(0);
            c.material.emissiveIntensity = 0;
          }
        });
      } else {
        const c = new THREE.Color().setHSL(((timestamp || 0) * 0.003) % 1, 1, 0.5);
        if (this.starLight) {
          this.starLight.color = c; 
          this.starLight.intensity = 3;
        }
        this.chassis.traverse(mesh => {
          if (mesh.isMesh && mesh.material && mesh.material.emissive) {
            mesh.material.emissive = c;
            mesh.material.emissiveIntensity = 0.6;
          }
        });
      }
    }

    this.exhaustLight.intensity = this.hasMushroom
      ? 4 + Math.sin((timestamp || 0) * 0.02) * 2
      : Math.max(0, (this.speed > 200 ? 1 : 0), this.exhaustLight.intensity - 0.5);

    if (this.rearWing) {
      const t = this.hasDRS ? -0.25 : 0;
      this.rearWing.rotation.x += (t - this.rearWing.rotation.x) * 0.1;
    }

    this._updatePositionBadge();
  }

  _getCompoundColor(compound) {
    const c = (compound || 'MEDIUM').toUpperCase();
    if (c.includes('SOFT')) return 0xff0000;
    if (c.includes('MEDIUM')) return 0xffdd00;
    if (c.includes('HARD')) return 0xeeeeee;
    if (c.includes('INTER')) return 0x00ff00;
    if (c.includes('WET')) return 0x0000ff;
    return 0x444444;
  }

  _drawTireTexture(canvas, ctx, tex, compound) {
    const color = this._getCompoundColor(compound);
    const hex = '#' + color.toString(16).padStart(6, '0');
    
    // 1. Draw Black Base Tread
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 1, 128);
    
    // 2. Create Linear Gradient for smooth, feathered edges
    // We center a narrower stripe (approx 14px wide total) at index 64
    const grad = ctx.createLinearGradient(0, 50, 0, 78);
    grad.addColorStop(0.0, '#111111');     // Outer black
    grad.addColorStop(0.15, hex);          // Start of feathered color
    grad.addColorStop(0.5, hex);           // Center solid color
    grad.addColorStop(0.85, hex);          // End of solid color
    grad.addColorStop(1.0, '#111111');     // Fade back to black
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 50, 1, 28); 
    
    tex.needsUpdate = true;
  }

  _updateTireTextures() {
    if (!this.tireTextures) return;
    if (this._lastCompound === this.tireCompound) return;
    this._lastCompound = this.tireCompound;
    
    for (const t of this.tireTextures) {
      this._drawTireTexture(t.canvas, t.ctx, t.tex, this.tireCompound);
    }
  }

  // ── Garage Customization Setters ──

  setTeamColor(hexString) {
    if (typeof hexString === 'string') {
      this.teamColorHex = parseInt(hexString.replace('#', ''), 16);
    } else {
      this.teamColorHex = hexString;
    }
    
    // Update all materials tagged with 'teamPaint'
    this.chassis.traverse(child => {
      if (child.isMesh && child.material && child.material.name === 'teamPaint') {
        child.material.color.setHex(this.teamColorHex);
      }
    });
  }

  setDriverDetails(abbr, num) {
    this.abbreviation = abbr.substring(0, 3).toUpperCase();
    if (this.driver) this.driver.driver_number = parseInt(num) || 1;
    
    // Rebuild text sprites
    this.mesh.remove(this.nameSprite);
    if (this.nameSprite.material.map) this.nameSprite.material.map.dispose();
    this.nameSprite.material.dispose();
    this._buildNameLabel();
  }

  setTireCompound(compound) {
    this.tireCompound = compound.toUpperCase();
    this._updateTireTextures();
  }

  dispose() {
    this.scene.remove(this.mesh);
    if (this.trailLine) this.scene.remove(this.trailLine);
    this.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }
}
