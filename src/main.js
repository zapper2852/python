import * as THREE from 'three';
import { createPhysicsWorld, createScene, createTrack } from './world.js';
import { CarController } from './car.js';
import { Hud } from './hud.js';

const FIXED_STEP = 1 / 60;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = createScene();
const world = createPhysicsWorld();
const props = createTrack(world, scene);
const car = new CarController(world, scene);
const hud = new Hud();

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

car.attachInput();
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') {
    car.reset();
    snapCamera();
  }
});

// --- Chase camera ----------------------------------------------------------
const CAMERA_BACK = 8.2;
const CAMERA_HEIGHT = 3.4;
const forward = new THREE.Vector3();
const carPosition = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function readCarPose() {
  const { position, quaternion } = car.chassisBody;
  carPosition.set(position.x, position.y, position.z);
  forward.set(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  );
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
}

function desiredCameraPosition() {
  desiredCamera
    .copy(carPosition)
    .addScaledVector(forward, -CAMERA_BACK)
    .add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
  desiredCamera.y = Math.max(desiredCamera.y, 1.2);
  return desiredCamera;
}

function snapCamera() {
  readCarPose();
  camera.position.copy(desiredCameraPosition());
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

snapCamera();

// --- Loop ------------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;

function frame() {
  requestAnimationFrame(frame);

  const delta = Math.min(clock.getDelta(), 0.1);
  accumulator += delta;
  while (accumulator >= FIXED_STEP) {
    car.fixedUpdate();
    world.step(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  car.syncMeshes();
  for (const { mesh, body } of props) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  readCarPose();
  const smoothing = 1 - Math.exp(-6 * delta);
  camera.position.lerp(desiredCameraPosition(), smoothing);
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);

  hud.update(car.telemetry);
  renderer.render(scene, camera);
}

frame();

// Exposed so the controller can be inspected or tinkered with in the console.
window.carDemo = { car, world, scene, camera, reset: snapCamera };
