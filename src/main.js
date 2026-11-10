import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhysicsWorld, createScene, addGround } from './world.js';
import { CarController } from './car.js';
import { Motorcycle } from './motorcycle.js';
import { Hud } from './hud.js';
import { buildCity, CITY } from './city.js';
import { createStaticColliders } from './collision.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { Player } from './player.js';
import { Minimap } from './minimap.js';
import { initInput, keys, isShift, isCrouch } from './input.js';
import { Game, FUEL_CAPACITY } from './game.js';
import { AudioKit } from './audio.js';
import { Weapons, WEAPONS } from './weapons.js';
import { Ragdolls } from './ragdoll.js';
import { VehicleDamage } from './damage.js';
import { Police } from './police.js';
import { JobBoard, SHOP_ITEMS } from './jobs.js';
import { DayNight } from './daynight.js';

const FIXED_STEP = 1 / 60;
const CHASE_FOV = 55;
const COCKPIT_FOV = 74;
const CHASE_BACK = 8.2;
const CHASE_HEIGHT = 3.4;
const FOOT_FOV = 62;
const HEADSHOT = 20;

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
const city = buildCity(scene);
createStaticColliders(world, city.colliders);

const game = new Game();
const audio = new AudioKit();
const car = new CarController(world, scene);
const bike = new Motorcycle(world, scene);
const lot = city.parkingLots[0];
if (lot) bike.parkAt(lot.moto.x, lot.moto.z, 0);

const traffic = createTraffic(scene, car, 26, world);
const peds = createPedestrians(scene, 22);
const player = new Player(scene);
const hud = new Hud(game);
const weapons = new Weapons(game, audio, scene);
const ragdolls = new Ragdolls(scene, world);

const damage = new VehicleDamage(car, {
  scene,
  world,
  audio,
  game,
  onBreakdown: () => {
    car.disabled = true;
  },
});

const police = new Police(scene, world, {
  game,
  car,
  player,
  traffic,
  audio,
  ragdolls,
  station: city.policeStation,
});

const jobs = new JobBoard(scene, game, audio);
const dayNight = new DayNight(scene, { lampMaterial: city.lampMaterial });

const minimap = new Minimap(document.getElementById('minimap'), {
  gasStations: city.gasStations,
  info: document.getElementById('minimap-info'),
  pois: [
    ...jobs.markers.map((m) => ({ x: m.x, z: m.z, color: m.color, label: m.label })),
    { x: city.policeStation.x, z: city.policeStation.z, color: '#4d8dff', label: 'P' },
    ...(lot ? [{ x: lot.moto.x, z: lot.moto.z, color: '#e8452f', label: 'B' }] : []),
  ],
});

initInput();
car.attachInput();
weapons.select('fist');
if (game.holdWeapon('pistol')) {
  // the starter pistol is carried from the first frame
}

const camera = new THREE.PerspectiveCamera(CHASE_FOV, 1, 0.05, 1200);
const sunOffset = new THREE.Vector3(70, 110, 45);
scene.add(scene.userData.sun.target);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- state -----------------------------------------------------------------
let view = 'chase';
let onFoot = false;
let mount = 'car'; // 'car' | 'bike'
let camYaw = 0;
let elapsed = 0;
let jailSeconds = 0;
let engineRunning = false;

player.playEnterCar(car);
player.entry = null;
player.group.position.set(0.35, -0.78, 0.15);
player.group.rotation.set(0, 0, 0);
car.model.setDoor(0);

// --- interaction -----------------------------------------------------------
let promptText = '';
let pendingInteract = null;

function nearestStation(position) {
  let best = null;
  let bestDistance = 9;
  for (const station of city.gasStations) {
    const distance = Math.hypot(position.x - station.x, position.z - station.z);
    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestTraffic(position, radius = 4.5) {
  let best = null;
  let bestDistance = radius;
  for (const ai of traffic.cars) {
    const distance = Math.hypot(position.x - ai.pos.x, position.z - ai.pos.z);
    if (distance < bestDistance) {
      best = ai;
      bestDistance = distance;
    }
  }
  return best;
}

function playerPosition() {
  if (!onFoot) {
    const body = mount === 'bike' ? bike.chassisBody : car.chassisBody;
    return { x: body.position.x, z: body.position.z };
  }
  return { x: player.position.x, z: player.position.z };
}

function refreshPrompt() {
  promptText = '';
  pendingInteract = null;
  if (game.jailed || hud.shopOpen) return;
  const pos = playerPosition();

  if (!onFoot) {
    const station = nearestStation(pos);
    if (station) {
      promptText = `E · Refuel at $${station.price.toFixed(2)}/L`;
      pendingInteract = () => game.refuel(FUEL_CAPACITY - game.fuel, station.price);
    }
    return;
  }

  const marker = jobs.nearest(player.position, 5);
  if (marker) {
    if (marker.kind === 'job' || marker.kind === 'mission') {
      promptText = `E · Accept "${marker.title}" · $${marker.pay}`;
      pendingInteract = () => jobs.accept(marker);
    } else if (marker.kind === 'shop') {
      promptText = 'E · Open the weapon store';
      pendingInteract = () => hud.showShop(SHOP_ITEMS, (item, ctx) => jobs.buy(item, ctx), {
        repair: () => damage.repair(),
      });
    } else if (marker.kind === 'garage') {
      promptText = `E · Repair car · $130 (${Math.round(damage.level)}% damage)`;
      pendingInteract = () => {
        if (game.spend(130, 'repair')) {
          damage.repair();
          game.notify('Car repaired', 'good');
        }
      };
    }
    return;
  }

  if (Math.hypot(player.position.x - bike.chassisGroup.position.x, player.position.z - bike.chassisGroup.position.z) < 4) {
    promptText = 'E · Ride the motorcycle';
    pendingInteract = () => mountBike();
    return;
  }

  const station = nearestStation(pos);
  if (station) {
    promptText = `E · Refuel at $${station.price.toFixed(2)}/L`;
    pendingInteract = () => game.refuel(FUEL_CAPACITY - game.fuel, station.price);
    return;
  }

  const ai = nearestTraffic(player.position);
  if (ai) {
    promptText = 'E · Carjack this car';
    pendingInteract = () => hijack(ai);
  }
}

function interact() {
  if (hud.shopOpen) {
    hud.hideShop();
    return;
  }
  if (pendingInteract) pendingInteract();
}

// --- vehicle switching ------------------------------------------------------
function mountBike() {
  onFoot = false;
  mount = 'bike';
  player.enterBike(bike);
  bike.setControlEnabled(true);
  car.setControlEnabled(false);
  view = 'chase';
  game.notify('Race bike · Space for a wheelie', 'info');
}

function mountCar() {
  onFoot = false;
  mount = 'car';
  player.playEnterCar(car);
  bike.setControlEnabled(false);
  car.setControlEnabled(true);
  view = 'chase';
}

function stepOut() {
  onFoot = true;
  if (mount === 'bike') {
    player.exitBike(bike);
    bike.setControlEnabled(false);
  } else {
    player.exitCar(car);
    car.setControlEnabled(false);
  }
  camYaw = player.yaw;
  view = 'foot';
  player.setFirstPerson(false);
}

function hijack(ai) {
  ai.pulledOver = true;
  ai.stolen = true;
  game.crime('theft', 2);
  game.notify('Carjacked — the police are looking for you', 'warn');

  // The driver bails out and runs.
  const bail = new THREE.Vector3(ai.pos.x + 1.8, CITY.curb, ai.pos.z);
  ragdolls.spawn({
    position: { x: bail.x, y: 1.1, z: bail.z },
    velocity: { x: 2.5, y: 0.5, z: 0 },
    colors: { shirt: '#3d7a4f', pants: '#2b303a' },
  });

  ai.group.visible = false;
  if (ai.body) ai.body.collisionResponse = false;

  // Take the car: move the player's physics car onto the stolen one.
  mount = 'car';
  onFoot = false;
  const color = ai.model.group.children[0]?.material?.color;
  if (color) {
    car.model.shell.material.color.copy(color);
    car.model.bumpers.front.children.forEach((child) => child.material.color.set('#14171b'));
  }
  car.chassisBody.position.set(ai.pos.x, 1.05, ai.pos.z);
  car.chassisBody.quaternion.setFromEuler(0, ai.yaw, 0);
  car.chassisBody.velocity.set(0, 0, 0);
  car.chassisBody.angularVelocity.set(0, 0, 0);
  player.playEnterCar(car);
  car.setControlEnabled(true);
  view = 'chase';
}

// --- input -----------------------------------------------------------------
window.addEventListener('keydown', (event) => {
  audio.ensure();
  if (event.code === 'Tab') {
    event.preventDefault();
    if (event.repeat) return;
    if (!hud.wheelOpen) {
      const list = weapons.held;
      hud.showWheel(list.map((id) => WEAPONS[id]), list.indexOf(weapons.currentId));
      hud.wheelList = list;
    }
    return;
  }

  if (event.code === 'Escape') {
    hud.hideShop();
    hud.hideWheel();
    return;
  }

  if (event.code === 'KeyR') {
    if (mount === 'car') {
      car.reset();
    } else if (mount === 'bike') {
      bike.reset();
    }
    if (onFoot) {
      player.teleportTo(3, 12);
      player.setOutfit('casual');
    }
    if (!onFoot) snapCamera();
  }

  if (event.code === 'KeyC') {
    if (onFoot) {
      player.setFirstPerson(!player.firstPerson);
    } else if (mount === 'bike') {
      view = view === 'chase' ? 'cockpit' : view === 'cockpit' ? 'gopro' : 'chase';
      if (view === 'chase') snapCamera();
    } else {
      view = view === 'chase' ? 'cockpit' : 'chase';
      if (view === 'chase') snapCamera();
    }
  }

  if (event.code === 'KeyE' && !event.repeat) interact();

  if (event.code === 'KeyF' && !event.repeat) {
    if (onFoot) weapons.beginReload();
  }

  if (event.code === 'KeyV' && !event.repeat && onFoot) {
    if (weapons.currentId !== 'fist') weapons.select('fist');
    weapons.tryFire(shootOrigin(), aimDirection(), hitTest);
  }

  if (event.code === 'AltLeft' || event.code === 'AltRight') {
    event.preventDefault();
    if (event.repeat) return;
    if (!onFoot) {
      stepOut();
      return;
    }
    if (mount === 'bike') {
      const distance = Math.hypot(
        player.position.x - bike.chassisGroup.position.x,
        player.position.z - bike.chassisGroup.position.z
      );
      if (distance < 5) mountBike();
      return;
    }
    if (mount === 'car') {
      const carPosition = car.chassisBody.position;
      const distance = Math.hypot(player.position.x - carPosition.x, player.position.z - carPosition.z);
      if (distance < 5) mountCar();
      return;
    }
    const bikeDistance = Math.hypot(
      player.position.x - bike.chassisGroup.position.x,
      player.position.z - bike.chassisGroup.position.z
    );
    if (bikeDistance < 4.5) mountBike();
    else mountCar();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab' && hud.wheelOpen) {
    const list = hud.wheelList;
    const pick = list[hud.wheelIndex];
    if (pick) weapons.select(pick);
    hud.hideWheel();
  }
});

window.addEventListener('mousemove', (event) => {
  if (hud.wheelOpen) hud.pointerWheel(event.clientX, event.clientY);
});

window.addEventListener('mousedown', (event) => {
  audio.ensure();
  if (event.button !== 0) return;
  if (hud.shopOpen || hud.wheelOpen || game.jailed) return;
  if (!onFoot) return;
  triggerHeld = true;
  if (!player.aiming) return;
  weapons.tryFire(shootOrigin(), aimDirection(), hitTest);
});

window.addEventListener('mouseup', () => {
  triggerHeld = false;
});

window.addEventListener('contextmenu', (event) => {
  if (onFoot) event.preventDefault();
});

window.addEventListener('pointerdown', () => audio.ensure());

// --- aiming / shooting -----------------------------------------------------
const originVec = new THREE.Vector3();
const dirVec = new THREE.Vector3();

function shootOrigin() {
  player.rig.handMeshes[1].getWorldPosition(originVec);
  return originVec.clone();
}

function aimDirection() {
  return dirVec.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).normalize().clone();
}

function hitTest(origin, direction, maxDistance) {
  let best = null;
  const consider = (position, radius, target) => {
    const toX = position.x - origin.x;
    const toY = position.y - origin.y;
    const toZ = position.z - origin.z;
    const along = toX * direction.x + toY * direction.y + toZ * direction.z;
    if (along < 0 || along > maxDistance) return;
    const px = origin.x + direction.x * along;
    const py = origin.y + direction.y * along;
    const pz = origin.z + direction.z * along;
    const perp = Math.hypot(position.x - px, position.y - py, position.z - pz);
    if (perp > radius) return;
    if (!best || along < best.distance) {
      best = {
        distance: along,
        point: new THREE.Vector3(px, py, pz),
        target,
      };
    }
  };

  for (const ped of peds.peds) {
    if (ped.down) continue;
    consider({ x: ped.pos.x, y: 1.05, z: ped.pos.y }, 0.55, { type: 'ped', ref: ped });
  }
  for (const officer of police.officers) {
    consider({ x: officer.pos.x, y: 1.05, z: officer.pos.z }, 0.55, { type: 'officer', ref: officer });
  }
  for (const ai of traffic.cars) {
    if (ai.stolen && ai.group.visible === false) continue;
    consider({ x: ai.pos.x, y: 0.85, z: ai.pos.z }, 1.5, { type: 'car', ref: ai });
  }
  for (const unit of police.units) {
    consider({ x: unit.pos.x, y: 0.85, z: unit.pos.z }, 1.7, { type: 'policeCar', ref: unit });
  }
  return best;
}

game.on('shot', ({ hit }) => {
  if (!hit) return;
  const weapon = weapons.def;
  const { target } = hit;

  if (target.type === 'ped') {
    const ped = target.ref;
    peds.kill(ped);
    ragdolls.spawn({
      position: { x: ped.pos.x, y: 1.1, z: ped.pos.y },
      velocity: { x: -Math.sin(player.yaw) * 2.5, y: 1.4, z: -Math.cos(player.yaw) * 2.5 },
      colors: {
        shirt: ped.rig.materials.shirt.color.getHexString(),
        pants: ped.rig.materials.pants.color.getHexString(),
        skin: ped.rig.materials.skin.color.getHexString(),
      },
    });
    game.stats.civiliansDown += 1;
    game.crime('civilian', 3);
  } else if (target.type === 'officer') {
    const officer = target.ref;
    ragdolls.spawn({
      position: { x: officer.pos.x, y: 1.1, z: officer.pos.z },
      colors: { shirt: '#1b2a44', pants: '#141c2a', skin: '#d3a17e' },
    });
    police.despawnOfficer(officer);
    game.crime('police', 4);
  } else if (target.type === 'policeCar') {
    game.crime('police', 3);
  } else if (target.type === 'car') {
    game.crime('shooting', 2);
  }
  void weapon;
});

game.on('punch', ({ hit }) => {
  if (!hit) return;
  const { target } = hit;
  if (target.type === 'ped') {
    peds.kill(target.ref);
    ragdolls.spawn({
      position: { x: target.ref.pos.x, y: 1.1, z: target.ref.pos.y },
      velocity: { x: -Math.sin(player.yaw) * 3.4, y: 1.2, z: -Math.cos(player.yaw) * 3.4 },
      colors: {
        shirt: target.ref.rig.materials.shirt.color.getHexString(),
        pants: target.ref.rig.materials.pants.color.getHexString(),
        skin: target.ref.rig.materials.skin.color.getHexString(),
      },
    });
    game.crime('civilian', 3);
  } else if (target.type === 'officer') {
    police.despawnOfficer(target.ref);
    game.crime('police', 4);
  }
});

game.on('reloadStart', ({ duration }) => player.startReload(duration));
game.on('weapon', ({ id }) => player.setWeapon(id === 'fist' ? null : id));
game.on('damage', ({ amount }) => {
  if (amount >= 10) hud.toast(`-${amount} health`, 'warn');
});
game.on('death', () => police.arrest('downed'));
game.on('jail', ({ seconds }) => {
  jailSeconds = seconds;
  hud.showJail(seconds);
  onFoot = true;
  mount = 'car';
  player.detachVehicle();
  car.setControlEnabled(false);
  bike.setControlEnabled(false);
});
game.on('released', () => {
  hud.hideJail();
  onFoot = true;
  view = 'foot';
  camYaw = player.yaw;
  snapCamera();
});

// --- cameras ---------------------------------------------------------------
const forward = new THREE.Vector3();
const carPosition = new THREE.Vector3();
const carQuat = new THREE.Quaternion();
const desiredCamera = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const cockpitWorld = new THREE.Vector3();
const pitchDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.045, 0, 0));

function activeBody() {
  return mount === 'bike' ? bike.chassisBody : car.chassisBody;
}

function readCarPose() {
  const body = activeBody();
  const { position, quaternion } = body;
  carPosition.set(position.x, position.y, position.z);
  carQuat.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  forward.set(0, 0, -1).applyQuaternion(carQuat);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
}

function desiredChasePosition() {
  const back = mount === 'bike' ? 5.4 : CHASE_BACK;
  const height = mount === 'bike' ? 2.3 : CHASE_HEIGHT;
  desiredCamera
    .copy(carPosition)
    .addScaledVector(forward, -back)
    .add(new THREE.Vector3(0, height, 0));
  desiredCamera.y = Math.max(desiredCamera.y, 1.2);
  return desiredCamera;
}

function setFov(value) {
  if (Math.abs(camera.fov - value) < 0.01) return;
  camera.fov = value;
  camera.updateProjectionMatrix();
}

function snapCamera() {
  if (onFoot) {
    footCamera(1);
    return;
  }
  readCarPose();
  if (view === 'cockpit' || view === 'gopro') return;
  camera.position.copy(desiredChasePosition());
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

function footCamera(delta) {
  const eye = player.eyeWorld;
  if (player.firstPerson) {
    camera.position.lerp(eye, delta >= 1 ? 1 : 1 - Math.exp(-18 * delta));
    camera.rotation.set(0, camYaw, 0);
    setFov(FOOT_FOV + 12);
    return;
  }
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
    if (mount === 'bike') {
      cockpitWorld.copy(bike.cockpitEye).applyQuaternion(carQuat).add(carPosition);
      camera.position.copy(cockpitWorld);
      camera.quaternion.copy(carQuat).multiply(pitchDown);
    } else {
      cockpitWorld.copy(car.cockpitEye).applyQuaternion(carQuat).add(carPosition);
      camera.position.copy(cockpitWorld);
      camera.quaternion.copy(carQuat).multiply(pitchDown);
    }
    return;
  }

  if (view === 'gopro') {
    setFov(78);
    camera.position.copy(player.helmetCameraWorld);
    camera.quaternion.copy(carQuat).multiply(pitchDown);
    return;
  }

  setFov(CHASE_FOV + Math.min((mount === 'bike' ? bike.speedMph : car.speedKmh) / 120, 1) * 12);
  const smoothing = 1 - Math.exp(-6 * delta);
  camera.position.lerp(desiredChasePosition(), smoothing);
  lookAt.copy(carPosition).addScaledVector(forward, 3);
  lookAt.y += 0.8;
  camera.lookAt(lookAt);
}

// --- loop ------------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;
let triggerHeld = false;

function activeSpeedMph() {
  if (onFoot) return 0;
  if (mount === 'bike') return bike.speedMph;
  return car.speedKmh * 0.621371;
}

function updateFuel(dt) {
  if (onFoot) return;
  const running = mount === 'bike' ? true : !car.disabled;
  if (!running) return;
  const throttle = mount === 'bike' ? bike.throttle : Math.abs(car.m_verticalInput);
  const used = game.useFuel(dt * (0.004 + throttle * 0.02));
  if (!used) {
    if (mount === 'bike') bike.setControlEnabled(false);
    else {
      car.disabled = true;
      car.setControlEnabled(false);
      game.notify('Out of fuel', 'warn');
    }
  }
}

function frame() {
  requestAnimationFrame(frame);

  const delta = Math.min(clock.getDelta(), 0.1);
  elapsed += delta;
  accumulator += delta;
  while (accumulator >= FIXED_STEP) {
    if (mount === 'car' && !onFoot) car.fixedUpdate(FIXED_STEP);
    else car.fixedUpdate(FIXED_STEP);
    if (mount === 'bike' && !onFoot) bike.fixedUpdate(FIXED_STEP);
    world.step(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  car.syncMeshes();
  bike.syncMeshes();

  traffic.update(delta, elapsed);
  for (const ai of traffic.cars) {
    if (ai.honked) {
      const distance = Math.hypot(ai.pos.x - camera.position.x, ai.pos.z - camera.position.z);
      if (distance < 55) audio.horn();
    }
  }
  city.signals.update(elapsed);

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
  } else if (mount === 'bike') {
    player.updateRider(delta);
  } else {
    player.updateSeated(delta, { driving: true });
  }

  peds.update(delta, onFoot ? player.position : car.chassisBody.position);

  const position = playerPosition();
  const station = nearestStation(position);
  police.update(delta, {
    playerPosition: position,
    inVehicle: !onFoot,
    onFoot,
    speedMph: activeSpeedMph(),
    elapsed,
  });

  jobs.update(delta, position);
  damage.update(delta);
  ragdolls.update(delta);
  weapons.update(delta);

  const darkness = dayNight.update(delta);
  const headlightPower = 18 + darkness * 120;
  for (const beam of car.model.headlights) beam.intensity = headlightPower;
  car.model.headlightMaterial.emissiveIntensity = 1.2 + darkness * 2.4;

  updateFuel(delta);
  refreshPrompt();

  player.setAiming(onFoot && Boolean(player.weaponId) && player.weaponId !== 'fist');

  if (triggerHeld && onFoot && player.aiming && weapons.def.auto) {
    weapons.tryFire(shootOrigin(), aimDirection(), hitTest);
  }

  // HUD.
  const telemetry = onFoot
    ? { mph: 0, speed: 0, steering: 0, torque: 0, brake: 0, gear: 0 }
    : mount === 'bike'
      ? { mph: Math.round(bike.speedMph), steering: Math.round((bike.steer * 180) / Math.PI), torque: Math.round(bike.throttle * 120), brake: 0, gear: bike.gear }
      : { mph: Math.round(car.speedKmh * 0.621371), steering: Math.round(car.m_steeringAngle * (180 / Math.PI)), torque: Math.round(car.currentEngineTorque), brake: Math.round(car.currentBrakeForce), gear: car.gear };

  hud.update({
    telemetry,
    fuel: game.fuel,
    capacity: FUEL_CAPACITY,
    price: station ? station.price : null,
    clock: dayNight.clockLabel,
    wanted: game.wanted,
    prompt: promptText,
    objective: jobs.objective,
    vehicle: onFoot ? 'foot' : mount,
  });
  hud.setWeapon(weapons.def.name, weapons.ammoText);
  if (game.jailed) {
    jailSeconds = Math.max(0, jailSeconds - delta);
    hud.tickJail(jailSeconds);
  }

  // Engine audio.
  if (!engineRunning) {
    audio.startEngine();
    engineRunning = true;
  }
  if (onFoot) {
    audio.updateEngine({ rpm: 850, throttle: 0, running: false });
  } else if (mount === 'bike') {
    audio.updateEngine({ rpm: bike.rpm, throttle: bike.throttle, speed: bike.speedKmh, running: true });
  } else {
    const throttle = Math.abs(car.m_verticalInput);
    audio.updateEngine({
      rpm: car.engineRpm,
      throttle,
      speed: car.speedKmh,
      running: !car.disabled,
    });
  }

  updateCamera(delta);

  const heading = onFoot ? player.yaw : Math.atan2(-forward.x, -forward.z);
  minimap.update({
    x: onFoot ? player.position.x : carPosition.x,
    z: onFoot ? player.position.z : carPosition.z,
    heading,
    traffic: traffic.cars.map((ai) => ai.pos),
    police: police.units.map((unit) => ({ x: unit.pos.x, z: unit.pos.z, lights: unit.lightsOn })),
  });

  // Keep the shadow volume around whatever we are looking at.
  const focus = onFoot ? player.position : carPosition;
  sunOffset.copy(dayNight.sunOffset).multiplyScalar(0.85).add(new THREE.Vector3(0, 60, 0));
  scene.userData.sun.position.copy(focus).add(sunOffset);
  scene.userData.sun.target.position.copy(focus);
  scene.userData.sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
}

frame();

// Exposed so the scene can be inspected or tinkered with in the console.
window.carDemo = {
  renderer,
  car,
  bike,
  world,
  scene,
  camera,
  traffic,
  peds,
  player,
  city,
  minimap,
  game,
  police,
  jobs,
  damage,
  weapons,
  ragdolls,
  dayNight,
  reset: snapCamera,
  getView: () => (onFoot ? (player.firstPerson ? 'firstPerson' : 'foot') : view),
  isOnFoot: () => onFoot,
  getMount: () => mount,
  interact,
};
