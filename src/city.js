import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSimpleCar, CAR_COLORS } from './vehicles.js';
import { signalState } from './signals.js';

export const CITY = {
  spacing: 84,
  roadHalf: 7,
  lane: 3.5,
  blocks: 3,
  curb: 0.12,
  highway: 298,
  highwayHalf: 11,
};

export const EXT = CITY.blocks * CITY.spacing;
export const CITY_LIMIT = EXT + 40;

export const ROAD_LINES = [];
for (let i = -CITY.blocks; i <= CITY.blocks; i += 1) ROAD_LINES.push(i * CITY.spacing);

/** Wet patches: low-grip zones the car has to respect. */
const WET_SPOTS = [
  { x: 0, z: -46, rx: 15, rz: 30 },
  { x: 84, z: 58, rx: 13, rz: 24 },
  { x: -168, z: 4, rx: 18, rz: 14 },
  { x: 4, z: 168, rx: 17, rz: 13 },
  { x: 168, z: -80, rx: 13, rz: 20 },
  { x: -84, z: -128, rx: 16, rz: 18 },
  { x: 126, z: 126, rx: 14, rz: 16 },
  { x: -10, z: 84, rx: 12, rz: 9 },
];

/** Standing water hides potholes: these bite at random off the racing line. */
const POTHOLE_SPOTS = [
  { x: 62, z: -20, r: 2.6 },
  { x: -46, z: 12, r: 2.1 },
  { x: -140, z: -60, r: 2.8 },
  { x: 30, z: 150, r: 2.2 },
  { x: 176, z: 40, r: 2.5 },
  { x: -190, z: 130, r: 2.4 },
];

/** Loose gravel around the construction site. */
const GRAVEL_SPOTS = [
  { x: 126, z: 126, r: 34 },
  { x: 100, z: 100, r: 16 },
];

export function onRoad(x, z) {
  for (const line of ROAD_LINES) {
    if (Math.abs(x - line) <= CITY.roadHalf) return true;
    if (Math.abs(z - line) <= CITY.roadHalf) return true;
  }
  // Ring highway: two straights in each direction.
  const ring = CITY.highway;
  if (Math.abs(Math.abs(x) - ring) <= CITY.highwayHalf) return true;
  if (Math.abs(Math.abs(z) - ring) <= CITY.highwayHalf) return true;
  return false;
}

/** Sidewalks and plazas are a curb above the asphalt. */
export function groundHeightAt(x, z) {
  return onRoad(x, z) ? 0 : CITY.curb;
}

function inEllipse(x, z, spot) {
  const dx = (x - spot.x) / spot.rx;
  const dz = (z - spot.z) / spot.rz;
  return dx * dx + dz * dz < 1;
}

/** 1 = dry asphalt, lower on wet tarmac, gravel, potholes or off the road. */
export function gripAt(x, z) {
  for (const wet of WET_SPOTS) if (inEllipse(x, z, wet)) return 0.55;
  for (const gravel of GRAVEL_SPOTS) {
    if (Math.hypot(x - gravel.x, z - gravel.z) < gravel.r) return 0.68;
  }
  for (const hole of POTHOLE_SPOTS) {
    if (Math.hypot(x - hole.x, z - hole.z) < hole.r) return 0.82;
  }
  return onRoad(x, z) ? 1 : 0.82;
}

export function isWet(x, z) {
  return WET_SPOTS.some((wet) => inEllipse(x, z, wet));
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

function disc(rx, rz, x, z, y) {
  const geometry = new THREE.CircleGeometry(1, 24);
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(rx, 1, rz);
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

function glassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#9fc4d8',
    metalness: 0.35,
    roughness: 0.12,
    transparent: true,
    opacity: 0.55,
  });
}

// --- collision registry -----------------------------------------------------

let colliders = [];
let gasStations = [];
let parkingLots = [];
let policeStation = { x: -42, z: 42 };
let lampMaterial = null;

/** Registers a solid box so the physics world can be built from the city. */
function solid(size, position, rotationY = 0) {
  colliders.push({ size, position, rotationY });
}

let parkedCars = [];

function addParkedCar(x, z, rotationY, rngFn) {
  const model = createSimpleCar(CAR_COLORS[Math.floor(rngFn() * CAR_COLORS.length)], {
    brakeLights: false,
  });
  model.group.position.set(x, CITY.curb, z);
  model.group.rotation.y = rotationY;
  parkedCars.push(model.group);
  solid([1.9, 1.35, 4.4], [x, CITY.curb + 0.7, z], rotationY);
}

/** Parked cars never move, so bake them into one mesh per material. */
function mergeParkedCars(scene) {
  const byMaterial = new Map();
  for (const group of parkedCars) {
    group.updateMatrixWorld(true);
    group.traverse((node) => {
      if (!node.isMesh) return;
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      if (!byMaterial.has(node.material)) byMaterial.set(node.material, []);
      byMaterial.get(node.material).push(geometry);
    });
  }
  for (const [material, geometries] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  parkedCars = [];
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

  // Crosswalks and stop lines on every approach.
  for (const lx of ROAD_LINES) {
    for (const lz of ROAD_LINES) {
      const band = CITY.roadHalf + 2.3;
      for (const side of [-1, 1]) {
        for (let t = -CITY.roadHalf + 0.7; t <= CITY.roadHalf - 0.7; t += 1.3) {
          markGeos.push(flatQuad(3.0, 0.6, lx + side * band, lz + t, 0.042));
          markGeos.push(flatQuad(0.6, 3.0, lx + t, lz + side * band, 0.042));
        }
      }
      // stop bars sit just outside the crosswalk, on the right-hand approach
      const stop = CITY.roadHalf + 4.6;
      markGeos.push(flatQuad(0.45, CITY.roadHalf, lx - stop, lz + CITY.roadHalf / 2, 0.042));
      markGeos.push(flatQuad(0.45, CITY.roadHalf, lx + stop, lz - CITY.roadHalf / 2, 0.042));
      markGeos.push(flatQuad(CITY.roadHalf, 0.45, lx - CITY.roadHalf / 2, lz - stop, 0.042));
      markGeos.push(flatQuad(CITY.roadHalf, 0.45, lx + CITY.roadHalf / 2, lz + stop, 0.042));
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

  buildRoadConditions(scene);
}

function buildRoadConditions(scene) {
  const wetGeos = WET_SPOTS.map((wet) => disc(wet.rx, wet.rz, wet.x, wet.z, 0.04));
  const wetMat = new THREE.MeshStandardMaterial({
    color: '#1c2229',
    roughness: 0.25,
    metalness: 0.15,
    transparent: true,
    opacity: 0.55,
  });
  const wetMesh = new THREE.Mesh(mergeGeometries(wetGeos), wetMat);
  wetMesh.receiveShadow = true;
  scene.add(wetMesh);

  const gravelGeos = GRAVEL_SPOTS.map((gravel) => disc(gravel.r, gravel.r * 0.8, gravel.x, gravel.z, 0.045));
  const gravelMat = new THREE.MeshStandardMaterial({ color: '#8a7a5e', roughness: 1 });
  scene.add(new THREE.Mesh(mergeGeometries(gravelGeos), gravelMat));

  const holeGeos = POTHOLE_SPOTS.map((hole) => disc(hole.r, hole.r * 0.75, hole.x, hole.z, 0.048));
  const holeMat = new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 1 });
  scene.add(new THREE.Mesh(mergeGeometries(holeGeos), holeMat));

  const rimGeos = POTHOLE_SPOTS.map((hole) => disc(hole.r + 0.35, hole.r * 0.75 + 0.3, hole.x, hole.z, 0.044));
  const rimMat = new THREE.MeshStandardMaterial({ color: '#4a4a42', roughness: 1 });
  scene.add(new THREE.Mesh(mergeGeometries(rimGeos), rimMat));
}

function buildBlockPads(scene) {
  const padMat = new THREE.MeshStandardMaterial({ color: '#9ba1a6', roughness: 0.95 });
  const walkMat = new THREE.MeshStandardMaterial({ color: '#848b92', roughness: 0.94 });
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
      solid([w, CITY.curb, d], [cx, CITY.curb / 2, cz]);

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

const ROOF_MAT = new THREE.MeshStandardMaterial({ color: '#6f7479', roughness: 0.95 });

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
  solid([w, h, d], [x, CITY.curb + h / 2, z]);

  scene.add(box(ROOF_MAT, [w + 0.5, 0.35, d + 0.5], [x, CITY.curb + h + 0.1, z]));
  // rooftop unit
  if (h > 14 && rngFn() > 0.35) {
    scene.add(
      box(ROOF_MAT, [w * 0.3, 1.6, d * 0.3], [x + w * 0.15, CITY.curb + h + 1, z - d * 0.15])
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

function buildGasStation(scene, bounds, brandColor, price, rngFn) {
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
      const px = cx - 2 + sx * 10;
      const pz = cz - 2 + sz * 6;
      scene.add(box(white, [0.7, 4.8, 0.7], [px, 2.4, pz]));
      solid([0.7, 4.8, 0.7], [px, 2.4, pz]);
    }
  }

  // pump islands
  for (const offset of [-6, 4]) {
    scene.add(box(white, [1.6, 0.18, 6], [cx - 2 + offset, 0.12, cz - 2]));
    for (const pz of [-1.5, 1.5]) {
      const px = cx - 2 + offset;
      const zp = cz - 2 + pz;
      scene.add(box(brand, [0.75, 1.55, 0.55], [px, 0.95, zp]));
      scene.add(box(dark, [0.6, 0.4, 0.06], [px, 1.25, zp - 0.3]));
      solid([0.75, 1.55, 0.55], [px, 0.95, zp]);
    }
  }

  // shop
  const shopW = 18;
  const shopD = 10;
  const shopZ = bounds.z1 - shopD / 2 - 1;
  scene.add(box(white, [shopW, 4.2, shopD], [cx + 2, CITY.curb + 2.1, shopZ]));
  scene.add(box(brand, [shopW + 0.4, 0.7, shopD + 0.4], [cx + 2, CITY.curb + 4.3, shopZ]));
  scene.add(box(glassMaterial(), [shopW - 2, 2.2, 0.12], [cx + 2, CITY.curb + 1.7, shopZ - shopD / 2]));
  solid([shopW, 4.2, shopD], [cx + 2, CITY.curb + 2.1, shopZ]);

  // price pylon
  scene.add(box(dark, [0.5, 6, 0.5], [bounds.x0 + 4, CITY.curb + 3, bounds.z0 + 4]));
  scene.add(box(brand, [3, 2.4, 0.4], [bounds.x0 + 4, CITY.curb + 7.2, bounds.z0 + 4]));
  scene.add(box(white, [2.5, 1.7, 0.12], [bounds.x0 + 4, CITY.curb + 7.2, bounds.z0 + 3.78]));
  solid([0.5, 6, 0.5], [bounds.x0 + 4, CITY.curb + 3, bounds.z0 + 4]);

  // a couple of parked cars by the shop
  for (let i = 0; i < 2; i += 1) {
    addParkedCar(bounds.x0 + 8 + i * 3, bounds.z1 - 16, Math.PI / 2, rngFn);
  }

  gasStations.push({ x: cx - 2, z: cz - 2, price, brand: brandColor });
}

function buildParkingLot(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const asphalt = new THREE.MeshStandardMaterial({ color: '#4a5057', roughness: 0.95 });
  const paint = new THREE.MeshStandardMaterial({ color: '#ecefF1', roughness: 0.8 });

  scene.add(box(asphalt, [bounds.x1 - bounds.x0, 0.05, bounds.z1 - bounds.z0], [cx, CITY.curb, cz]));

  const bayW = 2.6;
  const bayD = 5.2;
  const perRow = 11;
  // Two bays in the front row are kept clear for motorcycles.
  const motoBays = [2, 8];
  const lines = [];
  for (const rowZ of [cz - 8, cz + 8]) {
    for (let i = 0; i <= perRow; i += 1) {
      const x = cx - (perRow * bayW) / 2 + i * bayW;
      lines.push(flatQuad(0.12, bayD, x, rowZ, CITY.curb + 0.06));
    }
    for (let i = 0; i < perRow; i += 1) {
      const x = cx - (perRow * bayW) / 2 + bayW / 2 + i * bayW;
      const roll = rngFn();
      if (rowZ > cz && motoBays.includes(i)) continue;
      if (roll < 0.7) {
        // Nose-in parking with a little human variation, not a perfect grid.
        const backing = rowZ < cz;
        const jitter = (rngFn() - 0.5) * 0.3;
        addParkedCar(
          x + jitter,
          rowZ + (backing ? -bayD : bayD) * 0.5,
          (backing ? Math.PI : 0) + jitter,
          rngFn
        );
      }
    }
  }
  parkingLots.push({
    x: cx,
    z: cz,
    bayW,
    motos: motoBays.map((index) => ({
      x: cx - (perRow * bayW) / 2 + bayW * (index + 0.5),
      z: cz + 8 + bayD * 0.45,
      yaw: 0,
    })),
  });
  const paintMesh = new THREE.Mesh(mergeGeometries(lines), paint);
  paintMesh.receiveShadow = true;
  scene.add(paintMesh);

  // sign
  const blue = new THREE.MeshStandardMaterial({ color: '#1f5fa8', roughness: 0.6 });
  scene.add(box(blue, [0.35, 4.5, 0.35], [bounds.x0 + 3, CITY.curb + 2.25, bounds.z0 + 3]));
  scene.add(box(blue, [2.4, 2.4, 0.3], [bounds.x0 + 3, CITY.curb + 5.6, bounds.z0 + 3]));
  solid([0.35, 4.5, 0.35], [bounds.x0 + 3, CITY.curb + 2.25, bounds.z0 + 3]);
}

const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.95 });
const LEAF_MAT = new THREE.MeshStandardMaterial({ color: '#3f7038', roughness: 0.9 });

let treeTrunks = [];
let treeCrowns = [];

function addTree(x, z, scale = 1) {
  const trunk = new THREE.CylinderGeometry(0.22 * scale, 0.3 * scale, 3 * scale, 7);
  trunk.translate(x, CITY.curb + 1.5 * scale, z);
  treeTrunks.push(trunk);

  const crown = new THREE.IcosahedronGeometry(1.9 * scale, 0);
  crown.scale(1, 0.9, 1);
  crown.translate(x, CITY.curb + 3.8 * scale, z);
  treeCrowns.push(crown);

  solid([0.6 * scale, 3 * scale, 0.6 * scale], [x, CITY.curb + 1.5 * scale, z]);
}

/** All street and park trees share two materials, so two draw calls do it. */
function mergeTrees(scene) {
  const trunks = new THREE.Mesh(mergeGeometries(treeTrunks), TRUNK_MAT);
  trunks.castShadow = true;
  scene.add(trunks);

  const crowns = new THREE.Mesh(mergeGeometries(treeCrowns), LEAF_MAT);
  crowns.castShadow = true;
  scene.add(crowns);

  treeTrunks = [];
  treeCrowns = [];
}

function buildPark(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const grass = new THREE.MeshStandardMaterial({ color: '#5f7f48', roughness: 1 });
  scene.add(box(grass, [bounds.x1 - bounds.x0, 0.06, bounds.z1 - bounds.z0], [cx, CITY.curb, cz]));

  for (let i = 0; i < 9; i += 1) {
    const x = bounds.x0 + 8 + rngFn() * (bounds.x1 - bounds.x0 - 16);
    const z = bounds.z0 + 8 + rngFn() * (bounds.z1 - bounds.z0 - 16);
    addTree(x, z, 0.9 + rngFn() * 0.4);
  }

  // bench
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 });
  scene.add(box(wood, [2.4, 0.12, 0.6], [cx, CITY.curb + 0.45, cz - 4]));
  scene.add(box(wood, [2.4, 0.5, 0.12], [cx, CITY.curb + 0.72, cz - 4.25]));
  solid([2.4, 0.9, 0.6], [cx, CITY.curb + 0.45, cz - 4]);
}

function buildPlaza(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const pave = new THREE.MeshStandardMaterial({ color: '#b0aca4', roughness: 0.95 });
  scene.add(box(pave, [bounds.x1 - bounds.x0, 0.05, bounds.z1 - bounds.z0], [cx, CITY.curb + 0.01, cz]));

  // fountain
  const stone = new THREE.MeshStandardMaterial({ color: '#c2bdb2', roughness: 0.9 });
  const water = new THREE.MeshStandardMaterial({ color: '#39708f', roughness: 0.12, metalness: 0.35 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.9, 28), stone);
  basin.position.set(cx, CITY.curb + 0.45, cz);
  basin.receiveShadow = true;
  scene.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.0, 28), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(cx, CITY.curb + 0.86, cz);
  scene.add(pool);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 16), stone);
  column.position.set(cx, CITY.curb + 2.1, cz);
  scene.add(column);
  solid([9, 1.0, 9], [cx, CITY.curb + 0.5, cz]);

  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    addTree(cx + Math.cos(angle) * 18, cz + Math.sin(angle) * 18, 1.05);
  }

  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 });
  for (const [dx, dz] of [[-12, -6], [12, 6], [-6, 12], [6, -12]]) {
    scene.add(box(wood, [2.2, 0.12, 0.6], [cx + dx, CITY.curb + 0.45, cz + dz]));
    solid([2.2, 0.9, 0.6], [cx + dx, CITY.curb + 0.45, cz + dz]);
  }
}

function buildConstruction(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const dirt = new THREE.MeshStandardMaterial({ color: '#7c6a4f', roughness: 1 });
  scene.add(box(dirt, [bounds.x1 - bounds.x0, 0.05, bounds.z1 - bounds.z0], [cx, CITY.curb + 0.01, cz]));

  const orange = new THREE.MeshStandardMaterial({ color: '#e2621f', roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: '#f0f0ea', roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa2aa', metalness: 0.6, roughness: 0.4 });

  // hoarding along the two road-facing sides
  for (let t = -26; t <= 26; t += 4) {
    for (const [x, z, rot] of [
      [cx + t, bounds.z0 + 1.5, 0],
      [bounds.x0 + 1.5, cz + t, Math.PI / 2],
    ]) {
      scene.add(box(orange, [3.6, 1.1, 0.18], [x, CITY.curb + 0.85, z], [0, rot, 0]));
      scene.add(box(white, [3.6, 0.24, 0.2], [x, CITY.curb + 1.35, z], [0, rot, 0]));
      solid([3.6, 1.4, 0.3], [x, CITY.curb + 0.8, z], rot);
    }
  }

  // dirt piles
  for (let i = 0; i < 4; i += 1) {
    const px = cx + 6 + rngFn() * 26;
    const pz = cz - 4 + rngFn() * 22;
    const pile = new THREE.Mesh(new THREE.ConeGeometry(3, 2.4, 9), dirt);
    pile.position.set(px, CITY.curb + 1.2, pz);
    pile.castShadow = true;
    scene.add(pile);
    solid([5, 2.4, 5], [px, CITY.curb + 1.2, pz]);
  }

  // excavator
  const base = box(steel, [3.4, 0.8, 5.2], [cx - 12, CITY.curb + 0.7, cz + 8]);
  scene.add(base);
  scene.add(box(orange, [2.6, 1.9, 3.2], [cx - 12, CITY.curb + 2.0, cz + 8]));
  scene.add(box(orange, [0.7, 0.7, 5.4], [cx - 12, CITY.curb + 2.8, cz + 4.2], [0.5, 0, 0]));
  solid([3.4, 2.6, 5.2], [cx - 12, CITY.curb + 1.4, cz + 8]);

  // traffic cones
  const coneGeo = new THREE.ConeGeometry(0.3, 0.8, 10);
  for (let i = 0; i < 8; i += 1) {
    const cone = new THREE.Mesh(coneGeo, orange);
    cone.position.set(bounds.x0 + 6 + i * 5.2, CITY.curb + 0.45, bounds.z1 - 4);
    cone.castShadow = true;
    scene.add(cone);
  }
}

function signTexture(text, bg, fg) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = fg;
  g.font = 'bold 84px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildPoliceStation(scene, bounds, rngFn) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const padMat = new THREE.MeshStandardMaterial({ color: '#8f969d', roughness: 0.94 });
  const wall = new THREE.MeshStandardMaterial({ color: '#59636f', roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: '#e4eaf0', roughness: 0.6 });
  const blue = new THREE.MeshStandardMaterial({ color: '#123a6b', roughness: 0.5 });

  scene.add(box(padMat, [bounds.x1 - bounds.x0, 0.05, bounds.z1 - bounds.z0], [cx, CITY.curb + 0.01, cz]));

  // Two-storey precinct block.
  const w = 32;
  const d = 20;
  const h = 9;
  const bz = cz + 9;
  scene.add(box(wall, [w, h, d], [cx, CITY.curb + h / 2, bz]));
  solid([w, h, d], [cx, CITY.curb + h / 2, bz]);
  scene.add(box(trim, [w + 0.7, 0.7, d + 0.7], [cx, CITY.curb + h + 0.2, bz]));
  scene.add(box(blue, [w + 0.2, 1.1, 0.24], [cx, CITY.curb + 4.4, bz - d / 2 - 0.12]));
  scene.add(box(glassMaterial(), [11, 3.1, 0.18], [cx, CITY.curb + 1.7, bz - d / 2 - 0.1]));

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 2.7),
    new THREE.MeshBasicMaterial({ map: signTexture('POLICE', '#0f2f57', '#eaf2ff') })
  );
  sign.position.set(cx, CITY.curb + 6.3, bz - d / 2 - 0.2);
  scene.add(sign);

  // Forecourt bays with cruisers parked nose-out.
  const paint = new THREE.MeshStandardMaterial({ color: '#e8edf2', roughness: 0.8 });
  for (let i = 0; i < 4; i += 1) {
    const x = cx - 12 + i * 7;
    scene.add(box(paint, [0.14, 0.02, 5.4], [x, CITY.curb + 0.07, bz - d / 2 - 5]));
  }

  // Flagpole.
  scene.add(box(trim, [0.14, 7, 0.14], [cx + w / 2 + 3, CITY.curb + 3.5, bz - 2]));
  solid([0.4, 7, 0.4], [cx + w / 2 + 3, CITY.curb + 3.5, bz - 2]);

  policeStation = { x: cx, z: bz - d / 2 - 6 };
}

function buildHighway(scene) {
  const R = CITY.highway;
  const half = CITY.highwayHalf;
  const span = R * 2 + half * 2;
  const geos = [];
  const marks = [];
  // Four straights forming the ring.
  geos.push(flatQuad(half * 2, span, R, 0, 0.03));
  geos.push(flatQuad(half * 2, span, -R, 0, 0.03));
  geos.push(flatQuad(span, half * 2, 0, R, 0.03));
  geos.push(flatQuad(span, half * 2, 0, -R, 0.03));

  for (let s = -R; s <= R; s += 12) {
    marks.push(flatQuad(0.16, 5, R, s, 0.045));
    marks.push(flatQuad(0.16, 5, -R, s, 0.045));
    marks.push(flatQuad(5, 0.16, s, R, 0.045));
    marks.push(flatQuad(5, 0.16, s, -R, 0.045));
  }

  const asphalt = new THREE.MeshStandardMaterial({ color: '#34393f', roughness: 0.95 });
  const road = new THREE.Mesh(mergeGeometries(geos), asphalt);
  road.receiveShadow = true;
  scene.add(road);

  const paint = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.85 });
  const marking = new THREE.Mesh(mergeGeometries(marks), paint);
  marking.receiveShadow = true;
  scene.add(marking);

  // Guardrail along the outside edge.
  const railMat = new THREE.MeshStandardMaterial({ color: '#9aa3ab', metalness: 0.7, roughness: 0.4 });
  const railGeos = [];
  const edge = R + half + 0.5;
  const railLength = R * 2 + half * 2 + 2;
  for (const [x, z, w, d] of [
    [edge, 0, 0.3, railLength],
    [-edge, 0, 0.3, railLength],
    [0, edge, railLength, 0.3],
    [0, -edge, railLength, 0.3],
  ]) {
    const bar = new THREE.BoxGeometry(w, 0.28, d);
    bar.translate(x, 1.05, z);
    railGeos.push(bar);
    const lower = new THREE.BoxGeometry(w, 0.18, d);
    lower.translate(x, 0.62, z);
    railGeos.push(lower);
    solid([w, 1.2, d], [x, 0.65, z]);
  }
  const rails = new THREE.Mesh(mergeGeometries(railGeos), railMat);
  rails.castShadow = true;
  scene.add(rails);

  // Street lamps spaced along the ring.
  const poleMat = new THREE.MeshStandardMaterial({ color: '#6b7178', roughness: 0.6, metalness: 0.5 });
  const heads = [];
  for (let s = -R + 24; s < R; s += 48) {
    for (const [x, z] of [[R + half + 1.6, s], [-R - half - 1.6, s], [s, R + half + 1.6], [s, -R - half - 1.6]]) {
      const pole = new THREE.BoxGeometry(0.24, 7, 0.24);
      pole.translate(x, 3.5, z);
      heads.push(pole);
    }
  }
  const poles = new THREE.Mesh(mergeGeometries(heads), poleMat);
  scene.add(poles);
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
        solid([0.4, 6.4, 0.4], [x, CITY.curb + 3.2, z]);
      }
    }
  }

  const poleMesh = new THREE.Mesh(mergeGeometries(poles), poleMat);
  poleMesh.castShadow = true;
  scene.add(poleMesh);
  scene.add(new THREE.Mesh(mergeGeometries(heads), headMat));

  // Street trees on the sidewalk corners, clear of the driveways.
  for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
    for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
      const px0 = i * CITY.spacing + CITY.roadHalf;
      const px1 = (i + 1) * CITY.spacing - CITY.roadHalf;
      const pz0 = j * CITY.spacing + CITY.roadHalf;
      const pz1 = (j + 1) * CITY.spacing - CITY.roadHalf;
      addTree(px1 - 1.8, pz0 + 1.8, 0.85);
      addTree(px0 + 1.8, pz1 - 1.8, 0.85);
    }
  }
  return headMat;
}

// --- traffic signals -------------------------------------------------------

const SIGNAL_APPROACHES = [
  { axis: 'ew', ox: -1, oz: 1, yaw: -Math.PI / 2 },
  { axis: 'ew', ox: 1, oz: -1, yaw: Math.PI / 2 },
  { axis: 'ns', ox: 1, oz: 1, yaw: 0 },
  { axis: 'ns', ox: -1, oz: -1, yaw: Math.PI },
];

const LENS_POSITIONS = [0.34, 0, -0.34];
const LENS_LIT = [new THREE.Color('#ff3b30'), new THREE.Color('#ffcf3f'), new THREE.Color('#3ce06f')];
const LENS_DIM = [new THREE.Color('#331310'), new THREE.Color('#332c0d'), new THREE.Color('#0d2a17')];

function buildSignals(scene) {
  const intersections = [];
  for (const lx of ROAD_LINES) {
    for (const lz of ROAD_LINES) {
      intersections.push({
        ix: Math.round(lx / CITY.spacing),
        jz: Math.round(lz / CITY.spacing),
        x: lx,
        z: lz,
      });
    }
  }

  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6);
  const headGeo = new THREE.BoxGeometry(0.34, 1.16, 0.28);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5c636b', roughness: 0.55, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#23282e', roughness: 0.6, metalness: 0.3 });

  const poles = [];
  const heads = [];
  const matrices = [];
  const helper = new THREE.Object3D();
  const corner = CITY.roadHalf + 1.8;

  for (const node of intersections) {
    for (const approach of SIGNAL_APPROACHES) {
      const px = node.x + approach.ox * corner;
      const pz = node.z + approach.oz * corner;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, approach.yaw, 0));

      const pole = poleGeo.clone();
      pole.translate(px, CITY.curb + 2.2, pz);
      poles.push(pole);
      solid([0.35, 4.4, 0.35], [px, CITY.curb + 2.2, pz]);

      const head = headGeo.clone();
      head.applyQuaternion(quat);
      head.translate(px, CITY.curb + 3.85, pz);
      heads.push(head);

      const face = new THREE.Vector3(0, 0, 0.17).applyQuaternion(quat);
      for (let k = 0; k < 3; k += 1) {
        helper.position.set(
          px + face.x,
          CITY.curb + 3.85 + LENS_POSITIONS[k],
          pz + face.z
        );
        helper.updateMatrix();
        matrices.push(helper.matrix.clone());
      }
    }
  }

  const poleMesh = new THREE.Mesh(mergeGeometries(poles), poleMat);
  scene.add(poleMesh);
  const headMesh = new THREE.Mesh(mergeGeometries(heads), headMat);
  scene.add(headMesh);

  const lensMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.115, 10, 8),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    matrices.length
  );
  for (let i = 0; i < matrices.length; i += 1) {
    lensMesh.setMatrixAt(i, matrices[i]);
    lensMesh.setColorAt(i, LENS_DIM[i % 3]);
  }
  lensMesh.instanceMatrix.needsUpdate = true;
  if (lensMesh.instanceColor) lensMesh.instanceColor.needsUpdate = true;
  lensMesh.frustumCulled = false;
  scene.add(lensMesh);

  let last = -1;
  const tint = new THREE.Color();

  function update(time) {
    if (Math.abs(time - last) < 0.1) return;
    last = time;
    let index = 0;
    for (const node of intersections) {
      const state = signalState(time, node.ix, node.jz);
      for (const approach of SIGNAL_APPROACHES) {
        const color = approach.axis === 'ns' ? state.ns : state.ew;
        for (let k = 0; k < 3; k += 1) {
          const active =
            (k === 0 && color === 'red') ||
            (k === 1 && color === 'yellow') ||
            (k === 2 && color === 'green');
          tint.copy(active ? LENS_LIT[k] : LENS_DIM[k]);
          lensMesh.setColorAt(index, tint);
          index += 1;
        }
      }
    }
    if (lensMesh.instanceColor) lensMesh.instanceColor.needsUpdate = true;
  }

  update(0);

  return { update, stateAt: (time, ix, jz) => signalState(time, ix, jz) };
}

export function buildCity(scene) {
  colliders = [];
  gasStations = [];
  parkedCars = [];
  parkingLots = [];
  treeTrunks = [];
  treeCrowns = [];
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
    ['0,-2', 'parking'],
    ['-1,1', 'park'],
    ['2,-2', 'park'],
    ['1,1', 'construction'],
    ['-2,-2', 'plaza'],
    ['-1,0', 'police'],
  ]);

  for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
    for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
      const bounds = blockBounds(i, j);
      const kind = special.get(`${i},${j}`);
      const price = gasStations.length === 0 ? 1.32 : 1.19;
      if (kind === 'gas') buildGasStation(scene, bounds, j > 0 ? '#1f6fb2' : '#c0392b', price, random);
      else if (kind === 'police') buildPoliceStation(scene, bounds, random);
      else if (kind === 'parking') buildParkingLot(scene, bounds, random);
      else if (kind === 'park') buildPark(scene, bounds, random);
      else if (kind === 'plaza') buildPlaza(scene, bounds, random);
      else if (kind === 'construction') buildConstruction(scene, bounds, random);
      else buildBuildingBlock(scene, facades, bounds, random);
    }
  }

  buildHighway(scene);
  lampMaterial = buildStreetFurniture(scene);
  mergeTrees(scene);
  mergeParkedCars(scene);
  const signals = buildSignals(scene);

  return { colliders, gasStations, signals, lampMaterial, policeStation, parkingLots };
}
