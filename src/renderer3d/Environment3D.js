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

    this._buildSkyDome();
    this._setupFog();
  }

  /* ── Sky Dome ── */
  _buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(4000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x1a1a2e) },
        bottomColor: { value: new THREE.Color(0x16213e) },
        horizonColor: { value: new THREE.Color(0x0f3460) },
        offset: { value: 10 },
        exponent: { value: 0.5 },
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
    this.scene.add(this.skyDome);
  }

  /* ── Fog ── */
  _setupFog() {
    this.scene.fog = new THREE.FogExp2(0x16213e, 0.00025);
  }

  /* ── Weather Transitions ── */
  setRaining(raining) {
    this.isRaining = raining;
    const sky = this.skyDome.material.uniforms;
    if (raining) {
      sky.topColor.value.set(0x0a0a15);
      sky.horizonColor.value.set(0x1a1a2a);
      sky.bottomColor.value.set(0x0c0c1a);
      this.scene.fog.density = 0.0004;
    } else {
      sky.topColor.value.set(0x1a1a2e);
      sky.horizonColor.value.set(0x0f3460);
      sky.bottomColor.value.set(0x16213e);
      this.scene.fog.density = 0.00025;
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
