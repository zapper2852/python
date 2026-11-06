import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/** Physics world with a fixed gravity, matching Unity's default -9.81 m/s². */
export function createPhysicsWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0;
  return world;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e131a');
  scene.fog = new THREE.Fog('#0e131a', 70, 240);

  scene.add(new THREE.HemisphereLight('#9fc4e8', '#1a2029', 1.15));

  const sun = new THREE.DirectionalLight('#fff3e2', 2.1);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  return scene;
}

/**
 * Ground plus a handful of light obstacles to drive around.
 * Returns the dynamic props so the render loop can copy their poses.
 */
export function createTrack(world, scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(600, 300, '#39434f', '#2b333d');
  grid.position.y = 0.01;
  scene.add(grid);

  // A thick static box rather than an infinite plane: cannon's plane shape is
  // not hit reliably by the vehicle's suspension raycasts.
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(20000, 0.5, 20000)),
  });
  groundBody.position.set(0, -0.5, 0);
  world.addBody(groundBody);

  const props = [];
  const props3d = [];

  const coneGeometry = new THREE.ConeGeometry(0.26, 0.68, 14);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: '#ff7a45', roughness: 0.6 });
  const coneShape = new CANNON.Cylinder(0.06, 0.28, 0.68, 10);

  // Slalom line the car can weave through (the car drives towards -Z).
  for (let i = 0; i < 8; i += 1) {
    const x = i % 2 === 0 ? -3 : 3;
    const z = -12 - i * 7;
    const mesh = new THREE.Mesh(coneGeometry, coneMaterial);
    mesh.castShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 4, shape: coneShape });
    body.position.set(x, 0.34, z);
    world.addBody(body);

    props.push({ mesh, body });
    props3d.push(mesh);
  }

  const crateGeometry = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const crateMaterial = new THREE.MeshStandardMaterial({ color: '#55606e', roughness: 0.8 });
  const crateShape = new CANNON.Box(new CANNON.Vec3(0.55, 0.55, 0.55));

  const crateSpots = [
    [-12, -20],
    [14, -26],
    [-18, -34],
    [20, -40],
  ];
  for (const [x, z] of crateSpots) {
    const mesh = new THREE.Mesh(crateGeometry, crateMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 22, shape: crateShape });
    body.position.set(x, 0.56, z);
    world.addBody(body);

    props.push({ mesh, body });
  }

  return props;
}
