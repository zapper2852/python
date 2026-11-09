import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSimpleCar, CAR_COLORS } from './vehicles.js';

export const CITY = {
  spacing: 84,
  roadHalf: 7,
  lane: 3.5,
  blocks: 3,
  curb: 0.08,
};

const EXT = CITY.blocks * CITY.spacing;

export const ROAD_LINES = [];
for (let i = -CITY.blocks; i <= CITY.blocks; i += 1) ROAD_LINES.push(i * CITY.spacing);

/** Wet patches: low-grip zones the car has to respect. */
const WET_SPOTS = [
  { x: 0, z: -46, rx: 15, rz: 30 },
  { x: 84, z: 58, rx: 13, rz: 24 },
  { x: -168, z: 4, rx: 18, rz: 14 },
  { x: 4, z: 168, rx: 17, rz: 13 },
  { x: 168, z: -80, rx: 13, rz: 20 },
];

export function onRoad(x, z) {
  for (const line of ROAD_LINES) {
    if (Math.abs(x - line) <= CITY.roadHalf) return true;
    if (Math.abs(z - line) <= CITY.roadHalf) return true;
  }
  return false;
}

/** Sidewalks and plazas are a low curb above the asphalt. */
export function groundHeightAt(x, z) {
  return onRoad(x, z) ? 0 : CITY.curb;
}

/** 1 = dry asphalt, lower on wet tarmac or when off the road. */
export function gripAt(x, z) {
  for (const wet of WET_SPOTS) {
    const dx = (x - wet.x) / wet.rx;
    const dz = (z - wet.z) / wet.rz;
    if (dx * dx + dz * dz < 1) return 0.55;
  }
  return onRoad(x, z) ? 1 : 0.82;
}

export function isWet(x, z) {
  for (const wet of WET_SPOTS) {
    const dx = (x - wet.x) / wet.rx;
    const dz = (z - wet.z) / wet.rz;
    if (dx * dx + dz * dz < 1) return true;
  }
  return false;
}

// --- helpers ---------------------------------------------------------------

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function box(material, size, position, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  return mesh;
}

function flatQuad(w, d, x, z, y) {
  const geometry = new THREE.PlaneGeometry(w, d);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

function facadeTexture(base, windowTop, windowBottom) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  // subtle floor bands
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < size; y += 32) g.fillRect(0, y + 30, size, 2);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * 32 + 6;
      const y = row * 32 + 6;
      const glass = g.createLinearGradient(x, y, x, y + 20);
      glass.addColorStop(0, windowTop);
      glass.addColorStop(1, windowBottom);
      g.fillStyle = glass;
      g.fillRect(x, y, 19, 19);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, y, 19, 5);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function facadeMaterial(base, top, bottom) {
  return new THREE.MeshStandardMaterial({
    map: facadeTexture(base, top, bottom),
    roughness: 0.85,
    metalness: 0.05,
  });
}

// --- city pieces -----------------------------------------------------------

function buildRoads(scene) {
  const roadGeos = [];
  const markGeos = [];
  const length = EXT * 2 + 120;

  for (const line of ROAD_LINES) {
    roadGeos.push(flatQuad(CITY.roadHalf * 2, length, line, 0, 0.02));
    roadGeos.push(flatQuad(length, CITY.roadHalf * 2, 0, line, 0.02));
  }

  for (const line of ROAD_LINES) {
    for (let s = -EXT; s <= EXT; s += 9) {
      const nearCross = ROAD_LINES.some((c) => Math.abs(c - s) < CITY.roadHalf + 4);
      if (nearCross) continue;
      markGeos.push(flatQuad(0.18, 4.4, line, s, 0.035));
      markGeos.push(flatQuad(4.4, 0.18, s, line, 0.035));
    }
    // edge lines, broken at every junction
    for (let i = 0; i < ROAD_LINES.length - 1; i += 1) {
      const a = ROAD_LINES[i] + CITY.roadHalf;
      const b = ROAD_LINES[i + 1] - CITY.roadHalf;
      const mid = (a + b) / 2;
      const len = b - a;
      for (const side of [-1, 1]) {
        markGeos.push(flatQuad(0.14, len, line + side * 6.3, mid, 0.035));
        markGeos.push(flatQuad(len, 0.14, mid, line + side * 6.3, 0.035));
      }
    }
  }

  const asphalt = new THREE.MeshStandardMaterial({ color: '#3a4046', roughness: 0.96 });
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), asphalt);
  roads.receiveShadow = true;
  scene.add(roads);

  const paint = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.85 });
  const markings = new THREE.Mesh(mergeGeometries(markGeos), paint);
  markings.receiveShadow = true;
  scene.add(markings);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: '#5f7350', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Wet tarmac patches.
  const wetMat = new THREE.MeshStandardMaterial({
    color: '#1c2229',
    roughness: 0.25,
    metalness: 0.15,
    transparent: true,
    opacity: 0.55,
  });
  for (const wet of WET_SPOTS) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 28), wetMat);
    patch.rotation.x = -Math.PI / 2;
    patch.scale.set(wet.rx, wet.rz, 1);
    patch.position.set(wet.x, 0.04, wet.z);
    scene.add(patch);
  }
}

function buildBlockPads(scene) {
  const padMat = new THREE.MeshStandardMaterial({ color: '#9ba1a6', roughness: 0.95 });
  const walkMat = new THREE.MeshStandardMaterial({ color: '#b4babf', roughness: 0.9 });
  const pads = [];
  const walks = [];

  for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
    for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
      const x0 = i * CITY.spacing + CITY.roadHalf;
      const x1 = (i + 1) * CITY.spacing - CITY.roadHalf;
      const z0 = j * CITY.spacing + CITY.roadHalf;
      const z1 = (j + 1) * CITY.spacing - CITY.roadHalf;
      const w = x1 - x0;
      const d = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;

      pads.push(flatQuad(w, d, cx, cz, CITY.curb));

      // sidewalk ring
      const sw = 3.4;
      walks.push(flatQuad(w, sw, cx, z0 + sw / 2, CITY.curb + 0.012));
      walks.push(flatQuad(w, sw, cx, z1 - sw / 2, CITY.curb + 0.012));
      walks.push(flatQuad(sw, d - sw * 2, x0 + sw / 2, cz, CITY.curb + 0.012));
      walks.push(flatQuad(sw, d - sw * 2, x1 - sw / 2, cz, CITY.curb + 0.012));
    }
  }

  const pad = new THREE.Mesh(mergeGeometries(pads), padMat);
  pad.receiveShadow = true;
  scene.add(pad);
  const walk = new THREE.Mesh(mergeGeometries(walks), walkMat);
  walk.receiveShadow = true;
  scene.add(walk);
}

export function blockBounds(i, j) {
  return {
    x0: i * CITY.spacing + CITY.roadHalf + 4,
    x1: (i + 1) * CITY.spacing - CITY.roadHalf - 4,
    z0: j * CITY.spacing + CITY.roadHalf + 4,
    z1: (j + 1) * CITY.spacing - CITY.roadHalf - 4,
  };
}

function addBuilding(scene, materials, x, z, w, d, h, rngFn) {
  const material = materials[Math.floor(rngFn() * materials.length)];
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const ru = Math.max(1, Math.round(w / 7));
  const rv = Math.max(2, Math.round(h / 3.4));
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, CITY.curb + h / 2, z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const roofMat = new THREE.MeshStandardMaterial({ color: '#6f7479', roughness: 0.95 });
  scene.add(box(roofMat, [w + 0.5, 0.35, d + 0.5], [x, CITY.curb + h + 0.1, z]));
  // rooftop unit
  if (h > 14 && rngFn() > 0.35) {
    scene.add(
      box(roofMat, [w * 0.3, 1.6, d * 0.3], [x + w * 0.15, CITY.curb + h + 1, z - d * 0.15])
    );
  }
}

function buildBuildingBlock(scene, materials, bounds, rngFn) {
  const cols = rngFn() < 0.6 ? 2 : 1;
  const rows = rngFn() < 0.6 ? 2 : 1;
  const gap = 5;
  const cw = (bounds.x1 - bounds.x0 - gap * (cols - 1)) / cols;
  const cd = (bounds.z1 - bounds.z0 - gap * (rows - 1)) / rows;

  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const x = bounds.x0 + cw / 2 + i * (cw + gap);
      const z = bounds.z0 + cd / 2 + j * (cd + gap);
      const roll = rngFn();
      const h = roll > 0.9 ? 42 + rngFn() * 30 : 12 + rngFn() * 24;
      addBuilding(scene, materials, x, z, cw - 2, cd - 2, h, rngFn);
    }
  }
}

function buildGasStation(scene, bounds, brandColor, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const concrete = new THREE.MeshStandardMaterial({ color: '#a8adb1', roughness: 0.92 });
  const white = new THREE.MeshStandardMaterial({ color: '#eef1f3', roughness: 0.7 });
  const brand = new THREE.MeshStandardMaterial({ color: brandColor, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.8 });

  scene.add(box(concrete, [bounds.x1 - bounds.x0, 0.04, bounds.z1 - bounds.z0], [cx, CITY.curb + 0.01, cz]));

  // canopy
  scene.add(box(brand, [26, 0.8, 16], [cx - 2, 5.3, cz - 2]));
  scene.add(box(white, [26.2, 0.5, 16.2], [cx - 2, 4.75, cz - 2]));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      scene.add(box(white, [0.7, 4.8, 0.7], [cx - 2 + sx * 10, 2.4, cz - 2 + sz * 6]));
    }
  }

  // pump islands
  for (const offset of [-6, 4]) {
    scene.add(box(white, [1.6, 0.18, 6], [cx - 2 + offset, 0.12, cz - 2]));
    for (const pz of [-1.5, 1.5]) {
      scene.add(box(brand, [0.75, 1.55, 0.55], [cx - 2 + offset, 0.95, cz - 2 + pz]));
      scene.add(box(dark, [0.6, 0.4, 0.06], [cx - 2 + offset, 1.25, cz - 2 + pz - 0.3]));
    }
  }

  // shop
  const shopW = 18;
  const shopD = 10;
  scene.add(box(white, [shopW, 4.2, shopD], [cx + 2, CITY.curb + 2.1, bounds.z1 - shopD / 2 - 1]));
  scene.add(box(brand, [shopW + 0.4, 0.7, shopD + 0.4], [cx + 2, CITY.curb + 4.3, bounds.z1 - shopD / 2 - 1]));
  scene.add(box(glassMaterial(), [shopW - 2, 2.2, 0.12], [cx + 2, CITY.curb + 1.7, bounds.z1 - shopD - 1]));

  // price pylon
  scene.add(box(dark, [0.5, 6, 0.5], [bounds.x0 + 4, CITY.curb + 3, bounds.z0 + 4]));
  scene.add(box(brand, [3, 2.4, 0.4], [bounds.x0 + 4, CITY.curb + 7.2, bounds.z0 + 4]));
  scene.add(box(white, [2.5, 1.7, 0.12], [bounds.x0 + 4, CITY.curb + 7.2, bounds.z0 + 3.78]));

  // a couple of parked cars by the shop
  for (let i = 0; i < 2; i += 1) {
    const car = createSimpleCar(CAR_COLORS[Math.floor(rngFn() * CAR_COLORS.length)]);
    car.group.position.set(bounds.x0 + 8 + i * 3, CITY.curb, bounds.z1 - 16);
    car.group.rotation.y = Math.PI / 2;
    scene.add(car.group);
  }
}

function buildParkingLot(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const asphalt = new THREE.MeshStandardMaterial({ color: '#4a5057', roughness: 0.95 });
  const paint = new THREE.MeshStandardMaterial({ color: '#ecefF1', roughness: 0.8 });

  scene.add(box(asphalt, [bounds.x1 - bounds.x0, 0.05, bounds.z1 - bounds.z0], [cx, CITY.curb, cz]));

  const bayW = 2.7;
  const bayD = 5.2;
  const perRow = 8;
  const lines = [];
  for (const rowZ of [cz - 7, cz + 7]) {
    for (let i = 0; i <= perRow; i += 1) {
      const x = cx - (perRow * bayW) / 2 + i * bayW;
      lines.push(flatQuad(0.12, bayD, x, rowZ, CITY.curb + 0.06));
    }
    for (let i = 0; i < perRow; i += 1) {
      const x = cx - (perRow * bayW) / 2 + bayW / 2 + i * bayW;
      if (rngFn() < 0.62) {
        const car = createSimpleCar(CAR_COLORS[Math.floor(rngFn() * CAR_COLORS.length)]);
        car.group.position.set(x, CITY.curb, rowZ + (rowZ < cz ? -bayD : bayD) * 0.5);
        car.group.rotation.y = rowZ < cz ? Math.PI : 0;
        scene.add(car.group);
      }
    }
  }
  const paintMesh = new THREE.Mesh(mergeGeometries(lines), paint);
  paintMesh.receiveShadow = true;
  scene.add(paintMesh);

  // sign
  const blue = new THREE.MeshStandardMaterial({ color: '#1f5fa8', roughness: 0.6 });
  scene.add(box(blue, [0.35, 4.5, 0.35], [bounds.x0 + 3, CITY.curb + 2.25, bounds.z0 + 3]));
  scene.add(box(blue, [2.4, 2.4, 0.3], [bounds.x0 + 3, CITY.curb + 5.6, bounds.z0 + 3]));
}

function glassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#9fc4d8',
    metalness: 0.35,
    roughness: 0.12,
    transparent: true,
    opacity: 0.55,
  });
}

function buildPark(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const grass = new THREE.MeshStandardMaterial({ color: '#5f7f48', roughness: 1 });
  scene.add(box(grass, [bounds.x1 - bounds.x0, 0.06, bounds.z1 - bounds.z0], [cx, CITY.curb, cz]));

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3f7038', roughness: 0.9 });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 3, 7);
  const leafGeo = new THREE.IcosahedronGeometry(1.9, 0);

  for (let i = 0; i < 9; i += 1) {
    const x = bounds.x0 + 8 + rngFn() * (bounds.x1 - bounds.x0 - 16);
    const z = bounds.z0 + 8 + rngFn() * (bounds.z1 - bounds.z0 - 16);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, CITY.curb + 1.5, z);
    trunk.castShadow = true;
    scene.add(trunk);
    const crown = new THREE.Mesh(leafGeo, leafMat);
    crown.position.set(x, CITY.curb + 3.8, z);
    crown.scale.set(1, 0.9, 1);
    crown.castShadow = true;
    scene.add(crown);
  }

  // bench
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 });
  scene.add(box(wood, [2.4, 0.12, 0.6], [cx, CITY.curb + 0.45, cz - 4]));
  scene.add(box(wood, [2.4, 0.5, 0.12], [cx, CITY.curb + 0.72, cz - 4.25]));
}

function buildStreetFurniture(scene) {
  const poleMat = new THREE.MeshStandardMaterial({ color: '#6b7178', roughness: 0.6, metalness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({
    color: '#e8eef2',
    emissive: '#fff2cf',
    emissiveIntensity: 0.25,
    roughness: 0.4,
  });

  const poles = [];
  const heads = [];
  const lampGeo = new THREE.BoxGeometry(0.22, 6.4, 0.22);
  const headGeo = new THREE.BoxGeometry(0.9, 0.18, 0.4);

  for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
    for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
      const bounds = blockBounds(i, j);
      for (const [x, z, rz] of [
        [bounds.x0 - 1.6, bounds.z0 - 1.6, 0],
        [bounds.x1 + 1.6, bounds.z1 + 1.6, Math.PI],
      ]) {
        const pole = lampGeo.clone();
        pole.translate(x, CITY.curb + 3.2, z);
        poles.push(pole);
        const head = headGeo.clone();
        head.rotateY(rz);
        head.translate(x, CITY.curb + 6.3, z);
        heads.push(head);
      }
    }
  }

  const poleMesh = new THREE.Mesh(mergeGeometries(poles), poleMat);
  poleMesh.castShadow = true;
  scene.add(poleMesh);
  scene.add(new THREE.Mesh(mergeGeometries(heads), headMat));
}

export function buildCity(scene) {
  const random = rng(20261109);
  const facades = [
    facadeMaterial('#b7b1a4', '#9fb6c6', '#3b4b57'),
    facadeMaterial('#8d8378', '#a8bcc8', '#39434e'),
    facadeMaterial('#a9b2ba', '#93aec0', '#2c3944'),
    facadeMaterial('#c3ab8e', '#a9c2d0', '#3a4a55'),
    facadeMaterial('#7f8890', '#8fa9ba', '#2b3742'),
  ];

  buildRoads(scene);
  buildBlockPads(scene);

  const special = new Map([
    ['1,-1', 'gas'],
    ['-2,1', 'gas'],
    ['0,1', 'parking'],
    ['2,0', 'parking'],
    ['-1,-2', 'parking'],
    ['-1,1', 'park'],
  ]);

  for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
    for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
      const bounds = blockBounds(i, j);
      const kind = special.get(`${i},${j}`);
      if (kind === 'gas') buildGasStation(scene, bounds, j > 0 ? '#1f6fb2' : '#c0392b', random);
      else if (kind === 'parking') buildParkingLot(scene, bounds, random);
      else if (kind === 'park') buildPark(scene, bounds, random);
      else buildBuildingBlock(scene, facades, bounds, random);
    }
  }

  buildStreetFurniture(scene);
}
