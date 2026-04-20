/**
 * GLB Model Loader — Singleton that loads the F1 car model once
 * and provides cloned, team-colored instances.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let _loadPromise = null;
let _originalScene = null;

const MODEL_URL = '/models/f1_car.glb';

/**
 * Load the base GLB model once. Returns a Promise that resolves
 * when the model is ready to be cloned.
 */
export function preloadCarModel() {
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();

    // Optional: use Draco decoder if the model is Draco-compressed
    try {
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      loader.setDRACOLoader(dracoLoader);
    } catch (e) { /* Draco not needed */ }

    console.log('[CarModel] Loading GLB model...');
    loader.load(
      MODEL_URL,
      (gltf) => {
        _originalScene = gltf.scene;

        // Normalize the model: center it and scale to a reasonable size
        const box = new THREE.Box3().setFromObject(_originalScene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Log model info
        console.log(`[CarModel] Loaded — size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`);

        // We'll handle scaling per-clone since we need to match the existing kart size
        // Store metadata
        _originalScene.userData.originalSize = size;
        _originalScene.userData.originalCenter = center;

        // Log all mesh names and material names for debugging
        _originalScene.traverse((child) => {
          if (child.isMesh) {
            console.log(`[CarModel]   Mesh: "${child.name}" | Material: "${child.material?.name || 'unnamed'}" | Color: #${child.material?.color?.getHexString?.() || '???'}`);
          }
        });

        resolve(_originalScene);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[CarModel] Loading: ${pct}%`);
        }
      },
      (error) => {
        console.error('[CarModel] Failed to load:', error);
        reject(error);
      }
    );
  });

  return _loadPromise;
}

/**
 * Clone the base model and apply a team color.
 * Returns a THREE.Group ready to add to a kart.
 *
 * @param {number} teamColorHex — e.g. 0xe10600
 * @param {number} targetLength — desired car length in world units (default ~8 to match the procedural kart)
 * @returns {THREE.Group|null}
 */
export function cloneCarModel(teamColorHex, targetLength = 8) {
  if (!_originalScene) return null;

  const clone = _originalScene.clone(true);

  // Deep-clone materials so each car has independent colors
  clone.traverse((child) => {
    if (child.isMesh) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(m => m.clone());
      } else {
        child.material = child.material.clone();
      }
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // Scale to target length
  const origSize = _originalScene.userData.originalSize;
  const origCenter = _originalScene.userData.originalCenter;

  // The car's longest axis (usually Z or X) should become targetLength
  const maxDim = Math.max(origSize.x, origSize.y, origSize.z);
  const scaleFactor = targetLength / maxDim;
  clone.scale.setScalar(scaleFactor);

  // Center on origin
  clone.position.set(
    -origCenter.x * scaleFactor,
    -origCenter.y * scaleFactor + 0.5, // lift slightly so wheels sit on ground
    -origCenter.z * scaleFactor
  );

  // Apply team color to body materials
  applyTeamColor(clone, teamColorHex);

  return clone;
}

/**
 * Apply team color to a cloned car model.
 * Tries to identify body/paint materials and tint them.
 */
export function applyTeamColor(carGroup, teamColorHex) {
  const teamColor = new THREE.Color(teamColorHex);

  // Colors that are likely "body paint" — reds (Ferrari), but we generalize
  // by targeting any non-black, non-grey, non-carbon material
  carGroup.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const mat = child.material;
    
    // Unconditionally apply flatShading to match the low-poly toy island look
    mat.flatShading = true;
    mat.needsUpdate = true;

    const name = (mat.name || child.name || '').toLowerCase();

    // Skip obvious non-body parts: tires, carbon, glass, chrome
    if (name.includes('tire') || name.includes('tyre') || name.includes('rubber') || name.includes('wheel') || name.includes('rim')) return;
    if (name.includes('glass') || name.includes('visor') || name.includes('windshield') || name.includes('transparent')) return;
    if (name.includes('chrome') || name.includes('metal') || name.includes('steel') || name.includes('carbon')) return;

    const hsl = {};
    mat.color.getHSL(hsl);

    // If it's a very dark gray/black material, it's likely internal chassis or underbody
    if (hsl.l < 0.1) return;

    // At this point, we assume the material is part of the body paint (which might currently have a red texture)
    // To ensure the car takes the teamColor cleanly, we must remove any existing painted textures
    mat.map = null;
    mat.color.copy(teamColor);
    mat.needsUpdate = true;

    mat.name = 'teamPaint'; // Tag for later updates
    if (mat.roughness !== undefined) mat.roughness = Math.min(mat.roughness, 0.3);
    if (mat.metalness !== undefined) mat.metalness = Math.max(mat.metalness, 0.5);
    if (mat.clearcoat !== undefined) {
      mat.clearcoat = 0.8;
      mat.clearcoatRoughness = 0.1;
    }
  });
}

/**
 * Check if the model has been loaded
 */
export function isModelLoaded() {
  return _originalScene !== null;
}
