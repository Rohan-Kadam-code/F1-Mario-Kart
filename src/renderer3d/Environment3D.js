/**
 * Environment3D — Scene dressing and atmosphere.
 * Sky dome, fog, ground lighting, weather transitions, and post-processing hooks.
 */
import * as THREE from 'three';

export class Environment3D {
  constructor(scene) {
    this.scene = scene;
    this.isRaining = false;
    this.isNight = false;

    this.group = new THREE.Group();
    this.group.name = 'EnvironmentGroup';
    this.scene.add(this.group);

    this._buildSkyDome();
    this._setupFog();
  }

  /* ── Sky Dome / Void ── */
  _buildSkyDome() {
    // Solid vibrant cyan background for the floating island effect
    this.scene.background = new THREE.Color(0x38bdf8);
    // Remove default sky dome geometry
    this.skyDome = null;
  }

  /* ── Fog ── */
  _setupFog() {
    // No fog so the edges of the floating island stand out cleanly against the perfect background
    this.scene.fog = null;
  }

  /* ── Weather Transitions ── */
  setRaining(raining) {
    this.isRaining = raining;
    if (raining) {
      this.scene.background = new THREE.Color(0x1a2a3a);
    } else {
      this.scene.background = new THREE.Color(0x38bdf8);
    }
  }

  /**
   * Per-frame update.
   */
  update(timestamp) {
    // Kept for structural compatibility
  }
}
