import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhysicsWorld, createScene, addGround } from './world.js';
import { CarController } from './car.js';
import { Hud } from './hud.js';
import { buildCity } from './city.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { Player } from './player.js';
import { initInput, keys, isShift, isCrouch } from './input.js';

const FIXED_STEP = 1 / 60;
const CHASE_FOV = 55;
const COCKPIT_FOV = 74;
const CHASE_BACK = 8.2;
const CHASE_HEIGHT = 3.4;
const FOOT_FOV = 62;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = createScene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const world = createPhysicsWorld();
addGround(world);
buildCity(scene);

const car = new CarController(world, scene);
const traffic = createTraffic(scene, car, 20);
const peds = createPedestrians(scene, 16);
const player = new Player(scene);
const hud = new Hud();

initInput();
car.attachInput();

const camera = new THREE.PerspectiveCamera(CHASE_FOV, 1, 0.05, 900);
const sun = scene.userData.sun;
const sunOffset = new THREE.Vector3(70, 110, 45);
scene.add(sun.target);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let view = 'chase';
let onFoot = false;
let camYaw = 0;

// The driver starts seated in the car.
player.enterCar(car);

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') {
    car.reset();
    if (!onFoot) snapCamera();
  }
  if (event.code === 'KeyC' && !onFoot) {
    view = view === 'chase' ? 'cockpit' : 'chase';
    if (view === 'chase') snapCamera();
  }
  if (event.code === 'AltLeft' || event.code === 'AltRight') {
    event.preventDefault();
    if (event.repeat) return;
    if (!onFoot) {
      onFoot = true;
      car.setControlEnabled(false);
      player.exitCar(car);
      camYaw = player.yaw;
      view = 'foot';
    } else {
      const carPosition = car.chassisBody.position;
      const distance = Math.hypot(
        player.position.x - carPosition.x,
        player.position.z - carPosition.z
      );
      if (distance < 5) {
        onFoot = false;
        player.enterCar(car);
        car.setControlEnabled(true);
        view = 'chase';
        snapCamera();
      }
    }
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
  if (view === 'foot') {
    footCamera(1);
    return;
  }
  camera.position.copy(desiredChasePosition());
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

function footCamera(delta) {
  const target = player.position.clone();
  target.y += 1.35;
  const desired = target
    .clone()
    .add(new THREE.Vector3(Math.sin(camYaw) * 4.6, 1.55, Math.cos(camYaw) * 4.6));
  desired.y = Math.max(desired.y, 0.9);
  camera.position.lerp(desired, delta >= 1 ? 1 : 1 - Math.exp(-10 * delta));
  camera.lookAt(target);
  setFov(FOOT_FOV);
}

snapCamera();

function updateCamera(delta) {
  if (onFoot) {
    footCamera(delta);
    return;
  }
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
  traffic.update(delta);

  if (onFoot) {
    const rotate = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
    camYaw += rotate * 2.1 * delta;

    const moveForward =
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const moveRight =
      (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);

    player.updateOnFoot(delta, {
      forward: moveForward,
      right: moveRight,
      sprint: isShift(),
      crouch: isCrouch(),
      camYaw,
    });
  } else {
    player.updateSeated(delta);
  }

  peds.update(delta, onFoot ? player.position : car.chassisBody.position);

  updateCamera(delta);
  hud.update(car.telemetry);

  // Keep the shadow volume around whatever we are looking at.
  const focus = onFoot ? player.position : carPosition;
  sun.position.copy(focus).add(sunOffset);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
}

frame();

// Exposed so the scene can be inspected or tinkered with in the console.
window.carDemo = {
  renderer,
  car,
  world,
  scene,
  camera,
  traffic,
  peds,
  player,
  reset: snapCamera,
  getView: () => (onFoot ? 'foot' : view),
  isOnFoot: () => onFoot,
};
