/**
 * SceneManager — Central Three.js orchestrator.
 * Manages WebGLRenderer, cameras (isometric + chase), lighting, and interaction.
 * Replaces the 2D TrackRenderer as the main rendering engine.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const CAMERA_MODES = {
  ORBIT: 'orbit',   // Isometric / Top-down
  CHASE: 'chase',   // Behind the kart
  TCAM: 'tcam'      // Onboard (T-cam) view
};

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();

    // Quality setting: 'low', 'medium', 'high'
    this.quality = 'high';

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    // ── Main Camera (Perspective) ──
    const aspect = container.clientWidth / container.clientHeight;
    // FOV increased from 45 to 70 to radically improve the sensation of speed
    // (A 45 FOV compresses depth and acts like a telephoto lens, making high speeds feel slow)
    this.camera = new THREE.PerspectiveCamera(70, aspect, 1.0, 60000);
    this.camera.position.set(0, 800, 600);
    this.camera.lookAt(0, 0, 0);

    // ── Camera state ──
    this.cameraMode = CAMERA_MODES.ORBIT;
    this.isChaseMode = false;
    this.chaseTarget = null;       // Kart3D instance to follow
    this.chaseLerpSpeed = 0.1;    // Faster lock
    this.tcamLerpSpeed = 0.3;     // Rock-solid onboard
    
    // ── Garage state ──
    this.garageMode = false;
    this.garageTarget = null;
    this._setupGarageEnvironment();

    // ── Orbit state (isometric view) ──
    this.orbitTheta = 0;            // horizontal angle (radians)
    this.orbitPhi = Math.PI / 4;    // vertical angle (radians) — 45°
    this.orbitRadius = 1000;
    this.orbitCenter = new THREE.Vector3(0, 0, 0);
    this.defaultOrbitRadius = 1000; // set after track load

    // ── Pan state ──
    this._isDragging = false;
    this._isRightDragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragPanStartCenter = new THREE.Vector3();
    this._dragStartTheta = 0;
    this._dragStartPhi = 0;

    // ── Track data ──
    this.trackBounds = null;        // { minX, maxX, minZ, maxZ }
    this.trackPoints3D = [];        // [{x, y, z}] — world-space track centerline

    // ── Children ──
    this.track3D = null;
    this.environment3D = null;
    this.particles3D = null;
    this.karts = new Map();         // driverNumber → Kart3D

    // ── Lighting ──
    this._setupLighting();

    // ── Post-processing ──
    this.composer = null;
    this.bloomPass = null;
    this._setupPostProcessing();

    // ── Interaction ──
    this._setupInteraction();
    this.resize();

    window.addEventListener('resize', () => this.resize());
  }

  /* =========================================
     Lighting
     ========================================= */

  _setupLighting() {
    // Ambient light — base illumination
    this.ambientLight = new THREE.AmbientLight(0x8899bb, 0.6);
    this.scene.add(this.ambientLight);

    // Hemisphere light — sky/ground color blending
    this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3a6b35, 0.4);
    this.scene.add(this.hemiLight);

    // Directional light — sun
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sunLight.position.set(300, 600, 200);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 3000;
    this.sunLight.shadow.camera.left = -1500;
    this.sunLight.shadow.camera.right = 1500;
    this.sunLight.shadow.camera.top = 1500;
    this.sunLight.shadow.camera.bottom = -1500;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  _createStudioBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 16, 64, 64, 128);
    grad.addColorStop(0, '#f8f8f8'); // Off-White
    grad.addColorStop(1, '#c0c0c0'); // Silver Studio
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* =========================================
     Garage Environment
     ========================================= */

  _setupGarageEnvironment() {
    this.garageGroup = new THREE.Group();
    this.garageGroup.visible = false;
    this.scene.add(this.garageGroup);

    // Premium Physical Floor (Light Studio)
    const floorGeo = new THREE.PlaneGeometry(1000, 1000);
    const floorMat = new THREE.MeshPhysicalMaterial({ 
      color: 0xcccccc, 
      roughness: 0.2, 
      metalness: 0.1,
      clearcoat: 0.8, 
      clearcoatRoughness: 0.2,
      reflectivity: 0.5
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.garageGroup.add(floor);

    // 1. Key Light (Main highlight)
    this.keyLight = new THREE.SpotLight(0xffffff, 500);
    this.keyLight.position.set(-20, 30, 20);
    this.keyLight.angle = Math.PI / 6;
    this.keyLight.penumbra = 0.5;
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.garageGroup.add(this.keyLight);
    
    // 2. Fill Light (Soften shadows)
    this.fillLight = new THREE.RectAreaLight(0xfff5e6, 2, 40, 20);
    this.fillLight.position.set(30, 10, 10);
    this.fillLight.lookAt(0, 0, 0);
    this.garageGroup.add(this.fillLight);

    // 3. Rim Light (Edge highlights)
    this.rimLight = new THREE.SpotLight(0xccddff, 800);
    this.rimLight.position.set(0, 40, -30);
    this.rimLight.angle = Math.PI / 4;
    this.rimLight.penumbra = 1.0;
    this.garageGroup.add(this.rimLight);
    
    // --- NEW: Podium Base ---
    const podiumGeo = new THREE.CylinderGeometry(5, 5, 0.7, 64);
    const podiumMat = new THREE.MeshPhysicalMaterial({ 
      color: 0x222222, 
      roughness: 0.3,
      metalness: 0.8,
      clearcoat: 1.0
    });
    this.studioBase = new THREE.Mesh(podiumGeo, podiumMat);
    this.studioBase.position.y = -0.01; // Slightly above floor
    this.studioBase.receiveShadow = true;
    this.studioBase.castShadow = true;
    this.garageGroup.add(this.studioBase);
    
    this.studioBackground = this._createStudioBackground();
  }

  setGarageMode(enabled, kart = null) {
    this.garageMode = enabled;
    this.garageGroup.visible = enabled;

    // Toggle track environment visibility
    if (this.track3D && this.track3D.group) this.track3D.group.visible = !enabled;
    if (this.environment3D && this.environment3D.group) this.environment3D.group.visible = !enabled;
    if (this.particles3D) {
      if (this.particles3D.points) this.particles3D.points.visible = !enabled;
      if (this.particles3D.rainGroup) this.particles3D.rainGroup.visible = !enabled;
    }

    // ── Handle Garage Mode ──
    if (enabled) {
      // Cleanup previous target if we are switching while in garage mode
      if (this.garageTarget && this.garageTarget !== kart) {
        const old = this.garageTarget;
        old.inGarage = false;
        old.toggleLabels(true);
        if (old._storedPos) {
          old.mesh.position.copy(old._storedPos);
          old.mesh.rotation.y = old._storedRotY;
        }
      }

      this.garageTarget = kart;

      // Ensure all karts except the target are hidden
      if (this.karts) {
        this.karts.forEach(k => { k.isVisible = false; });
      }

      // Setup Studio View
      this.camera.position.set(10, 5, 12);
      this.camera.lookAt(0, 0, 0);
      this.scene.background = this.studioBackground;
      this.sunLight.intensity = 0.1; // Dim main sun significantly

      if (kart) {
        kart.isVisible = true; 
        kart.mesh.visible = true;
        kart.inGarage = true;
        kart.toggleLabels(false);
        // Backup original pos/rot
        kart._storedPos = kart.mesh.position.clone();
        kart._storedRotY = kart.mesh.rotation.y;
        kart.mesh.position.set(0, 0, 0);
        kart.mesh.rotation.set(0, 0, 0);

        // Adjust camera for studio
        this.orbitRadius = 15;
        this.orbitTheta = 0.5;
        this.orbitPhi = 0.45;
        this.orbitCenter.set(0, 0, 0);

        // --- NEW: Generate Reflections from Studio ---
        if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = this._pmrem.fromScene(this.garageGroup).texture;
      }
    } else {
      // Restore ALL karts visibility
      if (this.karts) {
        this.karts.forEach(k => { k.isVisible = true; });
      }

      // Restore
      this.scene.environment = null; // Clear reflections
      this.sunLight.intensity = 1.2;
      this.scene.background = null;
      if (kart) {
        kart.inGarage = false;
        kart.toggleLabels(true);
        if (kart._storedPos) {
          kart.mesh.position.copy(kart._storedPos);
          kart.mesh.rotation.y = kart._storedRotY;
        }
      }
      this.resetView();
    }
  }

  updateStudioSettings(settings) {
    if (this.keyLight) this.keyLight.intensity = settings.intensity;
    if (this.rimLight) this.rimLight.intensity = settings.intensity * 1.5;
    if (this.bloomPass) this.bloomPass.strength = settings.bloom;
    if (this.studioBase) this.studioBase.visible = settings.showBase;
  }

  /* =========================================
     Post-Processing (Bloom)
     ========================================= */

  _setupPostProcessing() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(w, h);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.4,   // strength
      0.3,   // radius
      0.85   // threshold
    );
    this.composer.addPass(this.bloomPass);
  }

  setQuality(quality) {
    this.quality = quality;
    const dpr = quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);

    if (this.bloomPass) {
      this.bloomPass.enabled = quality !== 'low';
      this.bloomPass.strength = quality === 'high' ? 0.4 : 0.2;
    }

    this.renderer.shadowMap.enabled = quality !== 'low';
    this.resize();
  }

  /* =========================================
     Interaction (Zoom / Pan / Orbit)
     ========================================= */

  _setupInteraction() {
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.05 : 0.95;
      const minR = this.garageMode ? 2 : 100;
      const maxR = this.garageMode ? 100 : 8000;
      this.orbitRadius = Math.max(minR, Math.min(maxR, this.orbitRadius * factor));
      this._breakChaseMode();
    }, { passive: false });

    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // Left click = pan
        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._dragPanStartCenter = this.orbitCenter.clone();
        el.style.cursor = 'grabbing';
      } else if (e.button === 2) {
        // Right click = orbit
        this._isRightDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._dragStartTheta = this.orbitTheta;
        this._dragStartPhi = this.orbitPhi;
        el.style.cursor = 'move';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this._isDragging) {
        const dx = e.clientX - this._dragStartX;
        const dy = e.clientY - this._dragStartY;

        // Pan in camera-relative XZ plane
        const panScale = this.orbitRadius * 0.002;
        const sinT = Math.sin(this.orbitTheta);
        const cosT = Math.cos(this.orbitTheta);

        this.orbitCenter.x = this._dragPanStartCenter.x - (dx * cosT + dy * sinT) * panScale;
        this.orbitCenter.z = this._dragPanStartCenter.z - (-dx * sinT + dy * cosT) * panScale;
        this._breakChaseMode();
      }
      if (this._isRightDragging) {
        const dx = e.clientX - this._dragStartX;
        const dy = e.clientY - this._dragStartY;
        this.orbitTheta = this._dragStartTheta - dx * 0.005;
        this.orbitPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05,
          this._dragStartPhi - dy * 0.005));
      }
    });

    window.addEventListener('mouseup', () => {
      this._isDragging = false;
      this._isRightDragging = false;
      el.style.cursor = 'grab';
    });

    // Prevent context menu on right-click
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _breakChaseMode() {
    if (this.cameraMode !== CAMERA_MODES.ORBIT) {
      this.cameraMode = CAMERA_MODES.ORBIT;
      this.isChaseMode = false;
      this.chaseTarget = null;
      window.dispatchEvent(new CustomEvent('track-pan-break'));
    }
  }

  /* =========================================
     Camera Controls
     ========================================= */

  /** Enable chase camera on a specific kart */
  followKart(kart, mode = null) {
    if (!kart) {
      this.cameraMode = CAMERA_MODES.ORBIT;
      this.isChaseMode = false;
      this.chaseTarget = null;
      return;
    }

    // Default to CHASE if not specified and currently in ORBIT
    if (!mode) {
      this.cameraMode = this.cameraMode === CAMERA_MODES.ORBIT ? CAMERA_MODES.CHASE : this.cameraMode;
    } else {
      this.cameraMode = mode;
    }

    this.isChaseMode = true;
    this.chaseTarget = kart;

    if (this.cameraMode === CAMERA_MODES.CHASE) {
      this.orbitRadius = Math.min(this.orbitRadius, 250);
      this.orbitPhi = Math.PI / 6; // Lower angle — behind the car
    }
  }

  /** Cycle through available camera modes for a tracked kart */
  cycleCameraMode() {
    if (!this.isChaseMode || !this.chaseTarget) return null;

    if (this.cameraMode === CAMERA_MODES.CHASE) {
      this.cameraMode = CAMERA_MODES.TCAM;
    } else {
      this.cameraMode = CAMERA_MODES.CHASE;
    }

    return this.cameraMode;
  }

  /** Zoom controls */
  zoomIn() {
    const minR = this.garageMode ? 2 : 100;
    this.orbitRadius = Math.max(minR, this.orbitRadius * 0.75);
  }

  zoomOut() {
    const maxR = this.garageMode ? 100 : 8000;
    this.orbitRadius = Math.min(maxR, this.orbitRadius * 1.3);
  }

  resetView() {
    this.orbitRadius = this.defaultOrbitRadius;
    this.orbitTheta = 0;
    this.orbitPhi = Math.PI / 4;
    this.orbitCenter.set(0, 0, 0);
    this.isChaseMode = false;
    this.chaseTarget = null;
  }

  /* =========================================
     Track Data → 3D coordinates
     ========================================= */

  /**
   * Convert 2D projected track points ({x, y}) to 3D world coords ({x, 0, z}).
   * The track is laid on the XZ plane at Y=0.
   * We normalise & center the data so the track fits nicely in the scene.
   */
  setTrackData(trackPoints, pitLanePoints = []) {
    if (!trackPoints || trackPoints.length < 3) return;

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of trackPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const maxRange = Math.max(rangeX, rangeY);

    // Scale to fit within ~1000 units, centered at origin
    const scale = 1000 / maxRange;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    this.trackPoints3D = trackPoints.map(p => ({
      x: (p.x - cx) * scale,
      y: 0,  // on the ground
      z: -(p.y - cy) * scale, // flip Y → Z (Y-up in 3D, Y was screen-up in 2D)
    }));

    this.pitLanePoints3D = pitLanePoints.map(p => ({
      x: (p.x - cx) * scale,
      y: 0,
      z: -(p.y - cy) * scale,
    }));

    // Store transform params for toWorldCoords
    this._trackScale = scale;
    this._trackCenterX = cx;
    this._trackCenterY = cy;

    // Compute bounds
    let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
    for (const p of this.trackPoints3D) {
      if (p.x < bMinX) bMinX = p.x;
      if (p.x > bMaxX) bMaxX = p.x;
      if (p.z < bMinZ) bMinZ = p.z;
      if (p.z > bMaxZ) bMaxZ = p.z;
    }

    this.trackBounds = { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ };

    // Set default orbit to see whole track
    const trackSpan = Math.max(bMaxX - bMinX, bMaxZ - bMinZ);
    this.defaultOrbitRadius = trackSpan * 1.1;
    this.orbitRadius = this.defaultOrbitRadius;
    this.orbitCenter.set(
      (bMinX + bMaxX) / 2,
      0,
      (bMinZ + bMaxZ) / 2
    );
  }

  /**
   * Convert raw track coordinate {x, y} to 3D world position.
   * Used by main.js to position karts from LocationCache data.
   */
  toWorldCoords(x, y) {
    if (!this._trackScale) return { x: 0, y: 0, z: 0 };
    return {
      x: (x - this._trackCenterX) * this._trackScale,
      y: 0,
      z: -(y - this._trackCenterY) * this._trackScale,
    };
  }

  /**
   * Get world position for a track progress value (0..1).
   * Linearly interpolates along the 3D track centerline.
   */
  getPositionOnTrack(progress) {
    const pts = this.trackPoints3D;
    if (!pts || pts.length < 2) return { x: 0, y: 0, z: 0, angle: 0 };

    const p = ((progress % 1) + 1) % 1;
    const idx = p * (pts.length - 1);
    const i0 = Math.floor(idx);
    const i1 = (i0 + 1) % pts.length;
    const t = idx - i0;

    const pt0 = pts[i0];
    const pt1 = pts[i1];

    const x = pt0.x + (pt1.x - pt0.x) * t;
    const z = pt0.z + (pt1.z - pt0.z) * t;
    const angle = Math.atan2(pt1.x - pt0.x, pt1.z - pt0.z);

    return { x, y: 0, z, angle };
  }

  /* =========================================
     Resize
     ========================================= */

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  /* =========================================
     Render
     ========================================= */

  render(timestamp) {
    // ── Handle Garage Mode ──
    if (this.garageMode && this.garageTarget) {
      // Turntable rotation (slow auto-spin)
      this.garageTarget.mesh.rotation.y += 0.005;

      // Orbit Position Logic
      const r = this.orbitRadius;
      const theta = this.orbitTheta;
      const phi = this.orbitPhi;
      
      this.camera.position.set(
        this.orbitCenter.x + r * Math.sin(phi) * Math.sin(theta),
        this.orbitCenter.y + r * Math.cos(phi),
        this.orbitCenter.z + r * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.lookAt(this.orbitCenter);

      if (this.quality !== 'low' && this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    // ── Update camera position ──
    if (this.isChaseMode && this.chaseTarget) {
      const kart = this.chaseTarget;
      const angle = kart.currentAngle || 0;
      const kartPos = new THREE.Vector3(kart.mesh.position.x, 0, kart.mesh.position.z);

      if (this.cameraMode === CAMERA_MODES.TCAM) {
        // T-cam onboard view
        // Position relative to car: Above cockpit (y=2.5), looking forward (+z in car space)
        // Kart nose is at +3.8, cockpit is at -0.2
        const tcamOffset = new THREE.Vector3(0, 2.5, 0.4);

        // Transform offset to world space
        const camWorldPos = tcamOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(kartPos);

        // Rigid lock-on for onboard (Zero-Latency)
        this.camera.position.copy(camWorldPos);

        // Add dynamic speed-based camera shake to give a visceral feeling of high speed
        const speed = kart._smoothSpeed || kart.speed || 0;
        if (speed > 150) { // Shake activates above 150 km/h
          const shakeMag = (speed - 150) * 0.0015; // Scales with speed
          this.camera.position.x += (Math.random() - 0.5) * shakeMag;
          this.camera.position.y += (Math.random() - 0.5) * shakeMag;
          this.camera.position.z += (Math.random() - 0.5) * shakeMag;
        }

        // Look ahead along car orientation
        const lookAheadDist = 50;
        const lookTarget = new THREE.Vector3(
          kartPos.x + Math.sin(angle) * lookAheadDist,
          2.0, // Eye level
          kartPos.z + Math.cos(angle) * lookAheadDist
        );

        this.camera.lookAt(lookTarget);

        // Hide name label of followed kart so it doesn't block view
        if (kart.nameSprite) kart.nameSprite.visible = false;

      } else {
        // Chase camera: position behind the kart
        const behindDist = 60;
        const heightAbove = 30;
        const lookAheadDist = 30;

        const camTargetX = kartPos.x - Math.sin(angle) * behindDist;
        const camTargetZ = kartPos.z - Math.cos(angle) * behindDist;
        const camTargetY = heightAbove;

        this.camera.position.copy(new THREE.Vector3(camTargetX, camTargetY, camTargetZ));

        // Look at kart (slightly ahead)
        const lookX = kartPos.x + Math.sin(angle) * lookAheadDist;
        const lookZ = kartPos.z + Math.cos(angle) * lookAheadDist;
        const lookTarget = new THREE.Vector3(lookX, 5, lookZ);

        // Rigid look target (kart is already smoothed)
        this.camera.lookAt(lookTarget);

        // Ensure label is visible
        if (kart.nameSprite) kart.nameSprite.visible = true;
      }

    } else {
      // Isometric orbit camera
      const r = this.orbitRadius;
      const theta = this.orbitTheta;
      const phi = this.orbitPhi;

      this.camera.position.set(
        this.orbitCenter.x + r * Math.sin(phi) * Math.sin(theta),
        this.orbitCenter.y + r * Math.cos(phi),
        this.orbitCenter.z + r * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.lookAt(this.orbitCenter);
    }

    // ── Update sun to follow camera roughly ──
    this.sunLight.position.copy(this.camera.position).add(new THREE.Vector3(200, 400, 100));
    this.sunLight.target.position.copy(this.orbitCenter);

    // ── Render with post-processing ──
    if (this.quality !== 'low' && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
