import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhysicsWorld, createScene, createTrack } from './world.js';
import { CarController } from './car.js';
import { Hud } from './hud.js';

const FIXED_STEP = 1 / 60;
const CHASE_FOV = 55;
const COCKPIT_FOV = 74;
const CHASE_BACK = 8.2;
const CHASE_HEIGHT = 3.4;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = createScene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const world = createPhysicsWorld();
const props = createTrack(world, scene);
const car = new CarController(world, scene);
const hud = new Hud();

const camera = new THREE.PerspectiveCamera(CHASE_FOV, 1, 0.05, 600);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

car.attachInput();

let view = 'chase';
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') {
    car.reset();
    snapCamera();
  }
  if (event.code === 'KeyC') {
    view = view === 'chase' ? 'cockpit' : 'chase';
    if (view === 'chase') snapCamera();
  }
});

// --- Cameras ---------------------------------------------------------------
const forward = new THREE.Vector3();
const carPosition = new THREE.Vector3();
const carQuat = new THREE.Quaternion();
const desiredCamera = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const cockpitWorld = new THREE.Vector3();
const pitchDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.045, 0, 0));

function readCarPose() {
  const { position, quaternion } = car.chassisBody;
  carPosition.set(position.x, position.y, position.z);
  carQuat.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  forward.set(0, 0, -1).applyQuaternion(carQuat);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
}

function desiredChasePosition() {
  desiredCamera
    .copy(carPosition)
    .addScaledVector(forward, -CHASE_BACK)
    .add(new THREE.Vector3(0, CHASE_HEIGHT, 0));
  desiredCamera.y = Math.max(desiredCamera.y, 1.2);
  return desiredCamera;
}

function setFov(value) {
  if (Math.abs(camera.fov - value) < 0.01) return;
  camera.fov = value;
  camera.updateProjectionMatrix();
}

function snapCamera() {
  readCarPose();
  if (view === 'cockpit') return;
  camera.position.copy(desiredChasePosition());
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

snapCamera();

function updateCamera(delta) {
  readCarPose();

  if (view === 'cockpit') {
    setFov(COCKPIT_FOV);
    cockpitWorld.copy(car.cockpitEye).applyQuaternion(carQuat).add(carPosition);
    camera.position.copy(cockpitWorld);
    camera.quaternion.copy(carQuat).multiply(pitchDown);
    return;
  }

  setFov(CHASE_FOV + Math.min(car.speedKmh / 200, 1) * 12);
  const smoothing = 1 - Math.exp(-6 * delta);
  camera.position.lerp(desiredChasePosition(), smoothing);
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

// --- Loop ------------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;

function frame() {
  requestAnimationFrame(frame);

  const delta = Math.min(clock.getDelta(), 0.1);
  accumulator += delta;
  while (accumulator >= FIXED_STEP) {
    car.fixedUpdate(FIXED_STEP);
    world.step(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  car.syncMeshes();
  for (const { mesh, body } of props) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  updateCamera(delta);
  hud.update(car.telemetry);
  renderer.render(scene, camera);
}

frame();

// Exposed so the controller can be inspected or tinkered with in the console.
window.carDemo = {
  car,
  world,
  scene,
  camera,
  reset: snapCamera,
  getView: () => view,
};
