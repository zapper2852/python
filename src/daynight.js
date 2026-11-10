import * as THREE from 'three';

/**
 * A 20 minute day/night cycle: sunrise, blue sky, sunset, stars and moonlit
 * night. Street lamps, headlights and shop signs follow the same darkness
 * value, so everything switches over at the same moment.
 */

const CYCLE_SECONDS = 20 * 60;

const PALETTES = {
  day: {
    top: new THREE.Color('#2f7fc4'),
    bottom: new THREE.Color('#cfe6f6'),
    fog: new THREE.Color('#b7d7ee'),
    sun: new THREE.Color('#fff2dc'),
    hemi: 1.05,
    sunIntensity: 2.6,
  },
  golden: {
    top: new THREE.Color('#3f5f96'),
    bottom: new THREE.Color('#ffb072'),
    fog: new THREE.Color('#dfa884'),
    sun: new THREE.Color('#ffc890'),
    hemi: 0.62,
    sunIntensity: 1.7,
  },
  night: {
    top: new THREE.Color('#050a1a'),
    bottom: new THREE.Color('#101c33'),
    fog: new THREE.Color('#080f1c'),
    sun: new THREE.Color('#8fa4d8'),
    hemi: 0.14,
    sunIntensity: 0.22,
  },
};

const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function mixColors(target, a, b, t) {
  target.copy(a).lerp(b, t);
  return target;
}

export class DayNight {
  constructor(scene, { lampMaterial = null, startTime = 0.28 } = {}) {
    this.scene = scene;
    this.lampMaterial = lampMaterial;
    this.time = startTime; // 0..1, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
    this.darkness = 0;
    this.sunOffset = new THREE.Vector3(70, 110, 45);
    this.stars = null;

    this.sun = scene.userData.sun;
    this.hemi = null;
    scene.traverse((node) => {
      if (node.isHemisphereLight) this.hemi = node;
    });

    let skyMaterial = null;
    scene.traverse((node) => {
      if (node.material && node.material.uniforms && node.material.uniforms.top) {
        skyMaterial = node.material;
      }
    });
    this.skyMaterial = skyMaterial;
    this.buildStars();
    this.update(0);
  }

  buildStars() {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const elevation = Math.acos(Math.random() * 0.95);
      const radius = 900;
      positions[i * 3] = Math.sin(elevation) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(elevation) * radius + 40;
      positions[i * 3 + 2] = Math.sin(elevation) * Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#eef3ff',
      size: 2.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(geometry, material);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  get clockLabel() {
    const hours = (this.time * 24 + 6) % 24; // start the day at 06:00
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt) {
    this.time = (this.time + dt / CYCLE_SECONDS) % 1;

    // Sun sits on a tilted circle; elevation drives everything else.
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const elevation = Math.sin(angle);
    const radius = 240;
    this.sunOffset.set(Math.cos(angle) * radius, elevation * radius, radius * 0.35);

    const day = smooth(Math.min(1, Math.max(0, (elevation - 0.02) / 0.32)));
    const golden = smooth(Math.min(1, Math.max(0, (elevation + 0.18) / 0.24)));
    const night = 1 - day;

    this.darkness = Math.min(1, Math.max(0, (0.09 - elevation) / 0.22));

    const top = new THREE.Color();
    const bottom = new THREE.Color();
    const fog = new THREE.Color();

    if (elevation > 0) {
      mixColors(top, PALETTES.golden.top, PALETTES.day.top, day);
      mixColors(bottom, PALETTES.golden.bottom, PALETTES.day.bottom, day);
      mixColors(fog, PALETTES.golden.fog, PALETTES.day.fog, day);
    } else {
      mixColors(top, PALETTES.night.top, PALETTES.golden.top, golden);
      mixColors(bottom, PALETTES.night.bottom, PALETTES.golden.bottom, golden);
      mixColors(fog, PALETTES.night.fog, PALETTES.golden.fog, golden);
    }

    if (this.skyMaterial) {
      this.skyMaterial.uniforms.top.value.copy(top);
      this.skyMaterial.uniforms.bottom.value.copy(bottom);
    }
    this.scene.background.copy(bottom).lerp(top, 0.25);
    if (this.scene.fog) this.scene.fog.color.copy(fog);

    if (this.sun) {
      this.sun.color.copy(PALETTES.day.sun).lerp(PALETTES.golden.sun, 1 - day);
      if (elevation < 0) this.sun.color.copy(PALETTES.night.sun);
      this.sun.intensity =
        elevation > 0
          ? mix(PALETTES.golden.sunIntensity, PALETTES.day.sunIntensity, day)
          : mix(PALETTES.night.sunIntensity, PALETTES.golden.sunIntensity, golden);
    }

    if (this.hemi) {
      this.hemi.intensity =
        elevation > 0
          ? mix(PALETTES.golden.hemi, PALETTES.day.hemi, day)
          : mix(PALETTES.night.hemi, PALETTES.golden.hemi, golden);
    }

    if (this.stars) {
      this.stars.material.opacity = Math.min(1, Math.max(0, (this.darkness - 0.25) / 0.5));
      this.stars.rotation.y += dt * 0.002;
    }

    if (this.lampMaterial) {
      this.lampMaterial.emissiveIntensity = 0.2 + this.darkness * 3.4;
      this.lampMaterial.color.setHex(this.darkness > 0.35 ? 0xfff3c4 : 0xe8eef2);
    }

    return this.darkness;
  }
}
