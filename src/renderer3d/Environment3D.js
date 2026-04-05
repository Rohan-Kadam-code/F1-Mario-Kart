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

  /* ── Sky Dome ── */
  _buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(4000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x33b5e5) },      // Bright cyan-blue zenith
        bottomColor: { value: new THREE.Color(0xdceef7) },    // Very light blue at horizon base
        horizonColor: { value: new THREE.Color(0xffffff) },   // Crisp white horizon strip
        offset: { value: 20 },
        exponent: { value: 0.8 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 horizonColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          float t = max(pow(max(h, 0.0), exponent), 0.0);
          vec3 col = mix(horizonColor, topColor, t);
          if (h < 0.0) col = mix(horizonColor, bottomColor, min(-h * 3.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.group.add(this.skyDome);
  }

  /* ── Fog ── */
  _setupFog() {
    // Light blue haze, very low density to keep things vibrant and clear
    this.scene.fog = new THREE.FogExp2(0xdceef7, 0.00008); 
  }

  /* ── Weather Transitions ── */
  setRaining(raining) {
    this.isRaining = raining;
    const sky = this.skyDome.material.uniforms;
    if (raining) {
      sky.topColor.value.set(0x0e1520);
      sky.horizonColor.value.set(0x3a4a5a);
      sky.bottomColor.value.set(0x1a2a1a);
      this.scene.fog.density = 0.00035;
    } else {
      sky.topColor.value.set(0x33b5e5);
      sky.horizonColor.value.set(0xffffff);
      sky.bottomColor.value.set(0xdceef7);
      this.scene.fog.density = 0.00008;
    }
  }

  /**
   * Per-frame update — can be used for animated sky transitions.
   */
  update(timestamp) {
    // Subtle sky rotation for liveliness
    if (this.skyDome) {
      this.skyDome.rotation.y = (timestamp || 0) * 0.000005;
    }
  }
}
