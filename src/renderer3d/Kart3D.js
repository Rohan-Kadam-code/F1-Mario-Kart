/**
 * Kart3D — Procedurally generated 3D F1 kart.
 * Car-shaped mesh with team colors, rotating wheels, T-cam, labels,
 * speed trail, star power, mushroom boost, and DRS animation.
 */
import * as THREE from 'three';

export class Kart3D {
  constructor(driverInfo, teamColor, scene, year = 2026) {
    this.driverNumber = driverInfo.driver_number;
    this.abbreviation = driverInfo.name_acronym || driverInfo.broadcast_name?.slice(0, 3)?.toUpperCase() || '???';
    this.fullName = driverInfo.full_name || driverInfo.broadcast_name || 'Unknown';
    this.teamName = driverInfo.team_name || '';
    this.teamColor = teamColor;
    this.teamColorHex = parseInt(teamColor.replace('#', ''), 16);
    this.scene = scene;
    this.year = year;
    this.position = 20;
    this.progress = 0;
    this.speed = 0;
    this.gap = '';
    this.tireCompound = '';
    this.currentAngle = 0;
    this.targetAngle = 0;
    this.hasStar = false;
    this.starTimer = 0;
    this.hasDRS = false;
    this.hasMushroom = false;
    this.isPitting = false;
    this.isRetired = false;

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
    this._lerpFactor = 0.12;
  }

  _buildKart() {
    const bodyColor = this.teamColorHex;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3, metalness: 0.6 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 5.5), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    this.mesh.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.5, 4), bodyMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.9, 3.8);
    nose.castShadow = true;
    this.mesh.add(nose);

    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }));
    cockpit.position.set(0, 1.5, -0.2);
    this.mesh.add(cockpit);

    const wingMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3, metalness: 0.5 });
    this.rearWing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 0.6), wingMat);
    this.rearWing.position.set(0, 2.2, -3.0);
    this.rearWing.castShadow = true;
    this.mesh.add(this.rearWing);

    const epMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.5, roughness: 0.3 });
    const epGeo = new THREE.BoxGeometry(0.1, 1.0, 0.8);
    const lp = new THREE.Mesh(epGeo, epMat); lp.position.set(1.6, 1.7, -3.0); this.mesh.add(lp);
    const rp = new THREE.Mesh(epGeo, epMat); rp.position.set(-1.6, 1.7, -3.0); this.mesh.add(rp);

    const fw = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.4), wingMat);
    fw.position.set(0, 0.4, 4.5);
    this.mesh.add(fw);

    const tcamColor = (this.driverNumber % 2 === 1) ? 0xffdd00 : 0x111111;
    const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.6),
      new THREE.MeshStandardMaterial({ color: tcamColor, emissive: tcamColor, emissiveIntensity: 0.5 }));
    tcam.position.set(0, 1.85, 0.8);
    this.mesh.add(tcam);

    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.2 });
    const wpos = [
      { x: 1.5, y: 0.55, z: 3.2 }, { x: -1.5, y: 0.55, z: 3.2 },
      { x: 1.5, y: 0.55, z: -2.0 }, { x: -1.5, y: 0.55, z: -2.0 },
    ];
    for (const wp of wpos) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wp.x, wp.y, wp.z);
      w.castShadow = true;
      this.mesh.add(w);
      this.wheels.push(w);
    }

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.08, 8, 16, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 }));
    halo.rotation.x = -Math.PI / 2;
    halo.rotation.z = Math.PI;
    halo.position.set(0, 1.7, 0.6);
    this.mesh.add(halo);

    this.exhaustLight = new THREE.PointLight(0xff6600, 0, 15);
    this.exhaustLight.position.set(0, 0.8, -3.5);
    this.mesh.add(this.exhaustLight);
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
    this.nameSprite.scale.set(8, 2, 1);
    this.nameSprite.position.set(0, 5, 0);
    this.mesh.add(this.nameSprite);
  }

  _buildPositionBadge() {
    this._posBadgeCanvas = document.createElement('canvas');
    this._posBadgeCanvas.width = 64; this._posBadgeCanvas.height = 64;
    this._posBadgeTexture = new THREE.CanvasTexture(this._posBadgeCanvas);
    this.posBadgeSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._posBadgeTexture, transparent: true, depthTest: false }));
    this.posBadgeSprite.scale.set(3, 3, 1);
    this.posBadgeSprite.position.set(3, 4, 0);
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

  updatePosition(worldX, worldY, worldZ, angle) {
    this._targetPos.set(worldX, worldY || 0, worldZ);
    this.targetAngle = angle;
  }

  update(timestamp) {
    if (this.isRetired || this.isPitting) {
      this.mesh.visible = false;
      if (this.trailLine) this.trailLine.visible = false;
      return;
    }
    this.mesh.visible = true;
    if (this.trailLine) this.trailLine.visible = true;

    this._currentPos.lerp(this._targetPos, this._lerpFactor);
    this.mesh.position.copy(this._currentPos);

    let ad = this.targetAngle - this.currentAngle;
    while (ad > Math.PI) ad -= Math.PI * 2;
    while (ad < -Math.PI) ad += Math.PI * 2;
    this.currentAngle += ad * this._lerpFactor;
    this.mesh.rotation.y = this.currentAngle;

    const ws = Math.min(this.speed, 350) * 0.005;
    for (const w of this.wheels) w.rotation.x += ws;

    this._updateTrail();

    if (this.hasStar) {
      this.starTimer--;
      if (this.starTimer <= 0) {
        this.hasStar = false; this.starLight.intensity = 0;
        this.mesh.children[0].material.emissive.setHex(0); this.mesh.children[0].material.emissiveIntensity = 0;
      } else {
        const c = new THREE.Color().setHSL(((timestamp || 0) * 0.003) % 1, 1, 0.5);
        this.starLight.color = c; this.starLight.intensity = 3;
        this.mesh.children[0].material.emissive = c; this.mesh.children[0].material.emissiveIntensity = 0.6;
      }
    }

    this.exhaustLight.intensity = this.hasMushroom
      ? 4 + Math.sin((timestamp || 0) * 0.02) * 2
      : Math.max(0, this.exhaustLight.intensity - 0.5);

    if (this.rearWing) {
      const t = this.hasDRS ? -0.25 : 0;
      this.rearWing.rotation.x += (t - this.rearWing.rotation.x) * 0.1;
    }

    this._updatePositionBadge();
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
