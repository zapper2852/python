import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAR_COLORS = [
  '#c9d1d9',
  '#3b6fb6',
  '#8f2f2f',
  '#c9a227',
  '#2b7a5b',
  '#2a2f38',
  '#d97b2b',
  '#7a3f8f',
  '#e6e8ea',
];

const shared = {
  glass: null,
  tyre: null,
  rim: null,
  dark: null,
  head: null,
  tail: null,
};

function materials() {
  if (!shared.glass) {
    shared.glass = new THREE.MeshStandardMaterial({
      color: '#16232e',
      metalness: 0.6,
      roughness: 0.12,
    });
    shared.tyre = new THREE.MeshStandardMaterial({ color: '#121417', roughness: 0.95 });
    shared.rim = new THREE.MeshStandardMaterial({
      color: '#b4bbc3',
      metalness: 0.9,
      roughness: 0.3,
    });
    shared.dark = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.8 });
    shared.head = new THREE.MeshStandardMaterial({
      color: '#fff7e4',
      emissive: '#ffe9bd',
      emissiveIntensity: 1.1,
      roughness: 0.3,
    });
    shared.tail = new THREE.MeshStandardMaterial({
      color: '#4a0d08',
      emissive: '#ff2a12',
      emissiveIntensity: 0.85,
      roughness: 0.4,
    });
  }
  return shared;
}

function box(material, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  return mesh;
}

/**
 * A generic road car, nose pointing down -Z like the player's car.
 * Returns the group plus the wheel meshes so callers can spin them.
 */
const paintCache = new Map();

function paintMaterial(color) {
  if (!paintCache.has(color)) {
    paintCache.set(
      color,
      new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 })
    );
  }
  return paintCache.get(color);
}

export function createSimpleCar(color = '#c9d1d9', { taxi = false, brakeLights = true } = {}) {
  const m = materials();
  const group = new THREE.Group();

  const paint = paintMaterial(color);
  const accent = paintMaterial('#f2c200');
  // Own tail material per car so brake lights can light up independently.
  const brakeLight = brakeLights ? m.tail.clone() : m.tail;

  // Body panels are merged per material: one draw call each instead of dozens.
  const parts = [
    [paint, [1.84, 0.56, 4.34], [0, 0.68, 0]],
    [paint, [1.8, 0.22, 4.1], [0, 0.98, 0]],
    [m.dark, [1.86, 0.16, 4.36], [0, 0.44, 0]],
    [m.dark, [1.7, 0.12, 0.22], [0, 0.56, -2.2]],
    [m.dark, [1.7, 0.12, 0.2], [0, 0.56, 2.2]],
    [m.glass, [1.66, 0.52, 2.16], [0, 1.2, 0.12]],
    [paint, [1.5, 0.1, 1.5], [0, 1.48, 0.16]],
    [m.dark, [1.1, 0.18, 0.05], [0, 0.66, -2.2]],
    [m.dark, [0.5, 0.12, 0.04], [0, 0.55, 2.22]],
  ];
  for (const side of [-1, 1]) {
    parts.push([paint, [0.07, 0.5, 0.12], [side * 0.8, 1.2, 0.05]]);
    parts.push([paint, [0.07, 0.46, 0.12], [side * 0.78, 1.2, 0.98]]);
    parts.push([m.dark, [0.14, 0.09, 0.06], [side * 0.96, 1.16, -0.72]]);
    parts.push([m.head, [0.42, 0.14, 0.06], [side * 0.58, 0.8, -2.18]]);
    parts.push([brakeLight, [0.4, 0.12, 0.06], [side * 0.6, 0.84, 2.18]]);
  }
  if (taxi) {
    parts.push([accent, [0.5, 0.18, 0.2], [0, 1.6, 0.3]]);
    parts.push([accent, [1.9, 0.1, 1.2], [0, 0.66, 0.2]]);
  }

  const byMaterial = new Map();
  for (const [material, size, position] of parts) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometry.translate(position[0], position[1], position[2]);
    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material).push(geometry);
  }
  for (const [material, geometries] of byMaterial) {
    group.add(new THREE.Mesh(mergeGeometries(geometries), material));
  }

  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 10);
  rimGeo.rotateZ(Math.PI / 2);

  for (const [x, z] of [
    [-0.88, -1.36],
    [0.88, -1.36],
    [-0.88, 1.36],
    [0.88, 1.36],
  ]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.34, z);
    wheel.add(new THREE.Mesh(tyreGeo, m.tyre));
    wheel.add(new THREE.Mesh(rimGeo, m.rim));
    wheel.userData.front = z < 0;
    group.add(wheel);
    wheels.push(wheel);
  }

  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }
  });

  return { group, wheels, brakeLight };
}
