import * as THREE from 'three';
import { buildInterior } from './interior.js';

/** Wheel dimensions shared by the physics wheels and the rendered wheels. */
export const wheelGeometry = {
  radius: 0.36,
  width: 0.24,
  trackHalf: 0.86,
  baseHalf: 1.32,
};

/**
 * The model is built in "car space" with y = 0 on the road. The controller holds
 * it at the settled centre-of-mass height, so lowering this value sits the whole
 * body lower on the wheels.
 */
export const groundOffsetY = -0.81;

const BODY_WIDTH = 1.58;

function materials() {
  return {
    paint: new THREE.MeshStandardMaterial({
      color: '#b3271f',
      metalness: 0.65,
      roughness: 0.3,
    }),
    trim: new THREE.MeshStandardMaterial({ color: '#14171b', metalness: 0.35, roughness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.16 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#8fa8bd',
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
    rubber: new THREE.MeshStandardMaterial({ color: '#101214', roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: '#b9c0c8', metalness: 0.95, roughness: 0.22 }),
    disc: new THREE.MeshStandardMaterial({ color: '#4a5058', metalness: 0.8, roughness: 0.45 }),
    headlight: new THREE.MeshStandardMaterial({
      color: '#fff6e2',
      emissive: '#ffeccd',
      emissiveIntensity: 2.2,
      roughness: 0.25,
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: '#4d0c08',
      emissive: '#ff2d16',
      emissiveIntensity: 0.55,
      roughness: 0.4,
    }),
    leather: new THREE.MeshStandardMaterial({ color: '#171a1e', roughness: 0.88 }),
    headliner: new THREE.MeshStandardMaterial({ color: '#a9adb1', roughness: 0.95 }),
    cabin: new THREE.MeshStandardMaterial({ color: '#242a31', roughness: 0.72 }),
    aluminium: new THREE.MeshStandardMaterial({ color: '#6e7a86', metalness: 0.85, roughness: 0.3 }),
  };
}

/** A thin panel spanning two points in the car's side profile. */
function panel(material, { z1, y1, z2, y2, width, thickness = 0.035 }) {
  const dz = z2 - z1;
  const dy = y2 - y1;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, Math.hypot(dz, dy)),
    material
  );
  mesh.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2);
  mesh.rotation.x = -Math.atan2(dy, dz);
  return mesh;
}

/** Narrow bar along a sloped edge, at one side of the car. */
function bar(material, { x, y1, z1, y2, z2, width = 0.055, thickness = 0.055 }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, Math.hypot(z2 - z1, y2 - y1)),
    material
  );
  mesh.position.set(x, (y1 + y2) / 2, (z1 + z2) / 2);
  mesh.rotation.x = -Math.atan2(y2 - y1, z2 - z1);
  return mesh;
}

function box(material, size, position, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  return mesh;
}

/** The lower body, extruded from its side profile so it has a real silhouette. */
function bodyShell(material) {
  // The cabin section is notched down to floor height so the body is a tub,
  // not a solid block: the interior is actually visible through the glass.
  const profile = [
    [-2.06, 0.3],
    [-2.1, 0.58],
    [-1.8, 0.72],
    [-0.78, 0.82],
    [-0.74, 0.44],
    [1.5, 0.44],
    [1.55, 0.86],
    [2.04, 0.82],
    [2.08, 0.62],
    [2.0, 0.3],
  ];

  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i += 1) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: BODY_WIDTH,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.045,
    bevelSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -BODY_WIDTH / 2);
  geometry.rotateY(-Math.PI / 2); // profile x becomes the car's z

  return new THREE.Mesh(geometry, material);
}

function buildExterior(root, m) {
  const shell = bodyShell(m.paint);
  root.add(shell);

  // Greenhouse: pillars, glass and roof.
  const pillars = [
    [-0.78, 0.82, -0.06, 1.34], // windscreen edge
    [1.02, 1.34, 1.6, 0.86], // rear screen edge
  ];
  for (const [z1, y1, z2, y2] of pillars) {
    for (const side of [-1, 1]) {
      root.add(bar(m.trim, { x: side * 0.735, z1, y1, z2, y2 }));
    }
  }
  for (const side of [-1, 1]) {
    root.add(
      bar(m.trim, { x: side * 0.735, z1: 0.34, y1: 0.84, z2: 0.34, y2: 1.34, width: 0.07 })
    );
  }

  root.add(panel(m.glass, { z1: -0.78, y1: 0.845, z2: -0.06, y2: 1.33, width: 1.4 }));
  root.add(panel(m.glass, { z1: 1.02, y1: 1.33, z2: 1.57, y2: 0.885, width: 1.4 }));

  for (const side of [-1, 1]) {
    // Side glass sits inside the pillars and above the beltline so it never
    // pokes out through the door skin.
    root.add(box(m.glass, [0.02, 0.44, 1.0], [side * 0.735, 1.08, -0.22]));
    root.add(box(m.glass, [0.02, 0.42, 0.56], [side * 0.735, 1.08, 0.7]));
    root.add(box(m.trim, [0.025, 0.44, 0.06], [side * 0.737, 1.08, 0.33]));

    // Door and quarter-panel skins close the notched cabin.
    root.add(box(m.paint, [0.05, 0.435, 2.26], [side * 0.77, 0.6375, 0.38]));
    root.add(box(m.paint, [0.032, 0.03, 2.26], [side * 0.786, 0.838, 0.38]));

    // door shut line + handle
    root.add(box(m.trim, [0.015, 0.02, 1.42], [side * 0.803, 0.62, 0.35]));
    root.add(box(m.chrome, [0.03, 0.05, 0.16], [side * 0.808, 0.78, 0.12]));
    // mirror
    root.add(box(m.trim, [0.1, 0.06, 0.08], [side * 0.86, 0.92, -0.62]));
    root.add(box(m.chrome, [0.06, 0.1, 0.16], [side * 0.93, 0.94, -0.6]));
  }

  const roof = box(m.paint, [1.44, 0.06, 1.08], [0, 1.36, 0.48]);
  root.add(roof);
  root.add(box(m.headliner, [1.3, 0.03, 0.96], [0, 1.32, 0.48])); // headliner

  // Rocker panels, bumpers, arches.
  for (const side of [-1, 1]) {
    root.add(box(m.trim, [0.08, 0.1, 2.6], [side * 0.78, 0.32, 0]));
    for (const z of [-wheelGeometry.baseHalf, wheelGeometry.baseHalf]) {
      root.add(box(m.trim, [0.1, 0.34, 1.0], [side * 0.79, 0.36, z]));
    }
  }
  root.add(box(m.trim, [1.5, 0.16, 0.14], [0, 0.34, -2.1])); // front lip
  root.add(box(m.trim, [1.44, 0.12, 0.1], [0, 0.72, -2.2])); // grille
  root.add(box(m.trim, [1.4, 0.14, 0.12], [0, 0.4, 2.1])); // rear diffuser

  // Lights.
  for (const side of [-1, 1]) {
    root.add(box(m.headlight, [0.42, 0.11, 0.09], [side * 0.5, 0.66, -2.11]));
    root.add(box(m.chrome, [0.3, 0.03, 0.1], [side * 0.5, 0.6, -2.13]));
    root.add(box(m.taillight, [0.44, 0.1, 0.08], [side * 0.5, 0.74, 2.09]));
  }

  // Plate and exhausts.
  root.add(box(m.chrome, [0.34, 0.12, 0.03], [0, 0.5, 2.11]));
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12), m.chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.45, 0.32, 2.08);
    root.add(pipe);
  }

  return { taillights: m.taillight };
}

export function createCarModel() {
  const m = materials();
  const root = new THREE.Group();

  const exterior = buildExterior(root, m);
  const interior = buildInterior(root, m);

  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return {
    root,
    steeringWheel: interior.steeringWheel,
    /** Driver eye point, in car space (y = 0 on the road). */
    driverEye: new THREE.Vector3(0.34, 1.16, 0.12),
    setBrakeLights(on) {
      exterior.taillights.emissiveIntensity = on ? 3.2 : 0.55;
    },
    /** Live speedometer and tachometer needles. */
    setDashboard(speedKmh) {
      interior.setDashboard(speedKmh);
    },
  };
}

export function createWheelMesh() {
  const m = materials();
  const group = new THREE.Group();
  const { radius, width } = wheelGeometry;

  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 26), m.rubber);
  tyre.geometry.rotateZ(Math.PI / 2);
  group.add(tyre);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, width + 0.01, 24),
    m.rim
  );
  rim.geometry.rotateZ(Math.PI / 2);
  group.add(rim);

  for (let i = 0; i < 3; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.05, radius * 1.24), m.rim);
    spoke.rotation.x = (i / 3) * Math.PI;
    group.add(spoke);
  }

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.03, 20),
    m.disc
  );
  disc.geometry.rotateZ(Math.PI / 2);
  disc.position.x = -width * 0.15;
  group.add(disc);

  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return group;
}
