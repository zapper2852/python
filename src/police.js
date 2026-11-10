import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CITY, ROAD_LINES, blockBounds } from './city.js';
import { createSimpleCar } from './vehicles.js';
import { signalState } from './signals.js';
import { createPerson, animatePerson } from './character.js';

/**
 * Police, wanted levels and the arrest chain.
 *
 * Three patrol units roam the grid. Speeding, running a red light, ramming a
 * cruiser or shooting someone raises the wanted level; the nearest unit then
 * runs the road network to you, calls backup if you stay ahead of them, and
 * switches to an on-foot pursuit with pistols and rifles if you bail out.
 */

const PATROL_SPEED = 9.5;
const CHASE_SPEED = 40; // m/s ≈ 90 mph on the straights
const BACKUP_AFTER = 120;
const GIVE_UP_AFTER = 420;
const ARREST_RANGE = 3.0;
const SHOOT_RANGE = 15.5; // ≈ 50 ft

const isHorizontal = (dir) => dir === 'E' || dir === 'W';
const LANE = CITY.lane;

function nextLine(value, dir) {
  const sign = dir === 'E' || dir === 'S' ? 1 : -1;
  let best = null;
  for (const line of ROAD_LINES) {
    if (sign * (line - value) < 2) continue;
    if (best === null || Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

export class Police {
  constructor(scene, world, { game, car, player, traffic, audio, ragdolls, station }) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.car = car;
    this.player = player;
    this.traffic = traffic;
    this.audio = audio;
    this.ragdolls = ragdolls;
    this.station = station || { x: -42, z: 52 };
    this.releasePoint = { x: -42, z: 26 };

    this.units = [];
    this.officers = [];
    this.chaseTimer = 0;
    this.backupCalled = false;
    this.givenUp = false;
    this.sirenLevel = 0;
    this.speedingTimer = 0;
    this.redLightCooldown = 0;
    this.lastArrest = 0;
    this.jailing = null;

    this.redMat = new THREE.MeshStandardMaterial({ color: '#4a0b0b', emissive: '#ff2d1a', emissiveIntensity: 1 });
    this.blueMat = new THREE.MeshStandardMaterial({ color: '#0b1a4a', emissive: '#2d6bff', emissiveIntensity: 1 });

    for (let i = 0; i < 3; i += 1) this.spawnUnit(i);
  }

  // --- units ---------------------------------------------------------------
  spawnUnit(index) {
    const model = createSimpleCar('#16202c', { brakeLights: true });
    const group = new THREE.Group();
    group.add(model.group);

    // Light bar.
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.3), this.redMat);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.3), this.blueMat);
    red.position.set(-0.3, 1.56, 0.2);
    blue.position.set(0.3, 1.56, 0.2);
    group.add(red, blue);

    // Livery stripes.
    const white = new THREE.MeshStandardMaterial({ color: '#e8edf2', roughness: 0.6 });
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 2.4), white);
      stripe.position.set(side * 0.93, 0.86, 0.1);
      group.add(stripe);
    }

    this.scene.add(group);

    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.7, 2.2)),
    });
    body.userData = { police: true };
    this.world.addBody(body);

    // Parked on the street outside the precinct, ready to roll.
    const spawns = [
      { x: -84 - LANE, z: 24, dir: 'S', road: -84 },
      { x: LANE, z: -36, dir: 'N', road: 0 },
      { x: -36, z: -84 + LANE, dir: 'E', road: -84 },
    ];
    const spawn = spawns[index % spawns.length];
    const yawFor = { E: -Math.PI / 2, W: Math.PI / 2, N: 0, S: Math.PI };
    const unit = {
      index,
      group,
      body,
      wheels: model.wheels,
      pos: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: yawFor[spawn.dir],
      speed: 0,
      dir: spawn.dir,
      road: spawn.road,
      waypoint: { x: 0, z: 0 },
      state: 'patrol',
      lightsOn: false,
      flash: 0,
      stopTimer: 0,
      stuckTimer: 0,
      officer: null,
    };
    this.setWaypoint(unit);
    this.units.push(unit);
    return unit;
  }

  setWaypoint(unit, target = null) {
    // Sit on the right-hand lane of the road the unit is on.
    const cross = nextLine(isHorizontal(unit.dir) ? unit.pos.x : unit.pos.z, unit.dir);
    if (cross === null) {
      unit.dir = { E: 'W', W: 'E', N: 'S', S: 'N' }[unit.dir];
      const again = nextLine(isHorizontal(unit.dir) ? unit.pos.x : unit.pos.z, unit.dir);
      if (again === null) {
        unit.waypoint = { x: target?.x ?? 0, z: target?.z ?? 0 };
        return;
      }
      unit.waypoint = this.cornerFor(unit, again);
      return;
    }
    unit.waypoint = this.cornerFor(unit, cross);
  }

  cornerFor(unit, cross) {
    if (unit.dir === 'E') return { x: cross, z: unit.road + LANE };
    if (unit.dir === 'W') return { x: cross, z: unit.road - LANE };
    if (unit.dir === 'N') return { x: unit.road + LANE, z: cross };
    return { x: unit.road - LANE, z: cross };
  }

  pickDirection(unit, target) {
    const options = [];
    for (const dir of ['E', 'W', 'N', 'S']) {
      if (isHorizontal(dir) === isHorizontal(unit.dir) && dir === unit.dir) continue;
      const opposite = { E: 'W', W: 'E', N: 'S', S: 'N' }[unit.dir];
      if (dir === opposite) continue;
      options.push(dir);
    }
    if (!target) return options[Math.floor(Math.random() * options.length)];
    let best = options[0];
    let bestScore = Infinity;
    for (const dir of options) {
      const step = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[dir];
      const x = unit.pos.x + step[0] * CITY.spacing;
      const z = unit.pos.z + step[1] * CITY.spacing;
      const score = Math.abs(target.x - x) + Math.abs(target.z - z) + Math.random() * 16;
      if (score < bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    return best;
  }

  nearestUnit(position, { chasingOnly = false } = {}) {
    let best = null;
    let bestDistance = Infinity;
    for (const unit of this.units) {
      if (chasingOnly && unit.state !== 'chase' && unit.state !== 'stop') continue;
      const distance = Math.hypot(unit.pos.x - position.x, unit.pos.z - position.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = unit;
      }
    }
    return best ? { unit: best, distance: bestDistance } : null;
  }

  // --- per-frame -----------------------------------------------------------
  update(dt, ctx) {
    const {
      playerPosition,
      inVehicle,
      onFoot,
      speedMph = 0,
      now = performance.now() / 1000,
      elapsed = 0,
    } = ctx;

    this.checkCrimes(dt, ctx);
    this.updateArrest(dt, ctx);

    const chasing = this.game.wanted > 0 && !this.game.jailed;
    if (chasing) {
      this.chaseTimer += dt;
      if (this.chaseTimer > BACKUP_AFTER && !this.backupCalled) {
        this.backupCalled = true;
        this.game.notify('Police backup dispatched', 'warn');
        for (const unit of this.units) {
          if (unit.state === 'patrol') unit.state = 'chase';
        }
      }
      if (this.chaseTimer > GIVE_UP_AFTER && !this.givenUp) {
        this.givenUp = true;
        this.game.notify('The police are giving up the chase', 'good');
        this.game.clearWanted();
        for (const unit of this.units) {
          unit.state = 'return';
          unit.lightsOn = false;
        }
        this.chaseTimer = 0;
        this.backupCalled = false;
      }
    } else {
      this.chaseTimer = 0;
      this.backupCalled = false;
      this.givenUp = false;
    }

    let nearestSiren = Infinity;
    for (const unit of this.units) {
      this.updateUnit(dt, unit, { ...ctx, chasing, elapsed });
      const distance = Math.hypot(unit.pos.x - playerPosition.x, unit.pos.z - playerPosition.z);
      unit.distance = distance;
      if (unit.state === 'chase' || unit.state === 'stop') nearestSiren = Math.min(nearestSiren, distance);
    }

    // Nearest cruiser decides how loud the siren is.
    const targetSiren = Number.isFinite(nearestSiren) ? Math.max(0, 1 - nearestSiren / 130) : 0;
    this.sirenLevel += (targetSiren - this.sirenLevel) * Math.min(1, dt * 2);
    this.audio?.setSiren(this.sirenLevel);

    this.updateOfficers(dt, ctx);
  }

  checkCrimes(dt, ctx) {
    const { playerPosition, inVehicle, speedMph, elapsed = 0 } = ctx;
    const nearest = this.nearestUnit(playerPosition);
    const watched = nearest && nearest.distance < 130;
    this.redLightCooldown = Math.max(0, this.redLightCooldown - dt);

    // Speeding, but only while a cruiser is around to see it.
    if (inVehicle && speedMph > 45 && watched) {
      this.speedingTimer += dt;
      if (this.speedingTimer > 2.2) {
        this.speedingTimer = 0;
        this.game.crime('speeding', 1);
      }
    } else {
      this.speedingTimer = Math.max(0, this.speedingTimer - dt * 0.6);
    }

    // Running a red light: fast, inside a junction, on a red approach.
    if (inVehicle && this.redLightCooldown <= 0) {
      const body = this.car.chassisBody;
      const ix = Math.round(body.position.x / CITY.spacing);
      const iz = Math.round(body.position.z / CITY.spacing);
      const nodeX = ix * CITY.spacing;
      const nodeZ = iz * CITY.spacing;
      const inJunction =
        Math.abs(body.position.x - nodeX) < CITY.roadHalf + 2 &&
        Math.abs(body.position.z - nodeZ) < CITY.roadHalf + 2;
      const speed = Math.hypot(body.velocity.x, body.velocity.z);
      if (inJunction && speed > 6 && ix >= -CITY.blocks && ix <= CITY.blocks && iz >= -CITY.blocks && iz <= CITY.blocks) {
        const state = signalState(elapsed, ix, iz);
        const axis = Math.abs(body.velocity.x) > Math.abs(body.velocity.z) ? 'ew' : 'ns';
        if (state[axis] === 'red') {
          this.game.crime('redlight', 2);
          this.redLightCooldown = 6;
        }
      }
    }
  }

  updateUnit(dt, unit, ctx) {
    const { playerPosition, inVehicle, onFoot, chasing } = ctx;

    if (!chasing && (unit.state === 'chase' || unit.state === 'stop')) {
      unit.state = 'return';
      unit.lightsOn = false;
    }

    const playerDistance = Math.hypot(unit.pos.x - playerPosition.x, unit.pos.z - playerPosition.z);

    if (chasing && unit.state !== 'trafficStop') {
      if (unit.state !== 'chase') unit.state = 'chase';
      unit.lightsOn = true;
    }

    if (unit.state === 'chase' && playerDistance < 70) {
      unit.lightsOn = true;
    }

    let desiredSpeed = PATROL_SPEED;
    let target = unit.waypoint;

    if (unit.state === 'chase') {
      desiredSpeed = CHASE_SPEED;
      // Close the last stretch directly, otherwise take the quickest road route.
      if (playerDistance < 42) {
        target = { x: playerPosition.x, z: playerPosition.z };
        desiredSpeed = playerDistance < 14 ? 7 : CHASE_SPEED;
      }
    } else if (unit.state === 'trafficStop') {
      desiredSpeed = 0;
      unit.stopTimer -= dt;
      if (unit.stopTimer <= 0) {
        unit.state = 'return';
        unit.lightsOn = false;
        if (unit.officer) this.despawnOfficer(unit.officer);
      }
    } else if (unit.state === 'return') {
      const stationDistance = Math.hypot(unit.pos.x - this.station.x, unit.pos.z - this.station.z);
      if (stationDistance < 18) {
        unit.state = 'patrol';
        unit.lightsOn = false;
      }
      target = stationDistance < 60 ? this.station : unit.waypoint;
      desiredSpeed = PATROL_SPEED * 0.9;
    }

    // Traffic-stop roll: a cruiser tucked behind a civilian car sometimes pulls it over.
    if (unit.state === 'patrol' && this.traffic) {
      for (const ai of this.traffic.cars) {
        const dx = ai.pos.x - unit.pos.x;
        const dz = ai.pos.z - unit.pos.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 2 && distance < 7) {
          const ahead = Math.cos(unit.yaw) * dz - Math.sin(unit.yaw) * dx;
          if (ahead > 0 && Math.random() < 1 / 75 / 60) {
            unit.state = 'trafficStop';
            unit.stopTimer = 45;
            unit.lightsOn = true;
            unit.stoppedCar = ai;
            ai.pulledOver = true;
            break;
          }
        }
      }
    }

    // --- steering ---------------------------------------------------------
    const dx = target.x - unit.pos.x;
    const dz = target.z - unit.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 5 && unit.state !== 'chase') {
      if (unit.state === 'trafficStop' || unit.state === 'return') {
        // hold position
      } else {
        const newDir = this.pickDirection(unit, null);
        unit.road = isHorizontal(unit.dir) ? unit.road : unit.road;
        unit.road = isHorizontal(unit.dir) ? unit.pos.z : unit.pos.x;
        unit.road = Math.round(unit.road / CITY.spacing) * CITY.spacing;
        unit.dir = newDir;
        this.setWaypoint(unit);
      }
    }

    const desiredYaw = Math.atan2(-dx, -dz);
    let diff = desiredYaw - unit.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxYaw = (unit.speed < 8 ? 3.4 : 1.9) * dt;
    unit.yaw += Math.max(-maxYaw, Math.min(maxYaw, diff));

    // Slow for hard corners.
    if (Math.abs(diff) > 0.55) desiredSpeed = Math.min(desiredSpeed, 8);
    if (unit.state === 'chase' && playerDistance < 18 && !inVehicle) desiredSpeed = Math.min(desiredSpeed, 0);

    const accel = unit.speed < desiredSpeed ? 10 : -18;
    unit.speed = Math.max(0, unit.speed + accel * dt);
    unit.speed = Math.min(unit.speed, desiredSpeed);

    const moveX = -Math.sin(unit.yaw) * unit.speed * dt;
    const moveZ = -Math.cos(unit.yaw) * unit.speed * dt;
    unit.pos.x += moveX;
    unit.pos.z += moveZ;

    unit.group.position.set(unit.pos.x, 0, unit.pos.z);
    unit.group.rotation.y = unit.yaw;

    // Light bar flash.
    unit.flash += dt;
    const on = Math.floor(unit.flash * 6) % 2 === 0;
    unit.group.children.forEach((child) => {
      if (child.material !== this.redMat && child.material !== this.blueMat) return;
      child.visible = unit.lightsOn && (child.material === this.redMat ? on : !on);
    });

    const spin = (unit.speed / 0.34) * dt;
    for (const wheel of unit.wheels || []) wheel.rotation.x -= spin;

    if (unit.body) {
      unit.body.position.set(unit.pos.x, 0.72, unit.pos.z);
      unit.body.quaternion.setFromEuler(0, unit.yaw, 0);
    }

    // --- on-foot pursuit --------------------------------------------------
    if (unit.state === 'chase' && onFoot && playerDistance < 26) {
      if (!unit.officer) {
        unit.officer = this.spawnOfficer(unit, playerDistance);
      }
    }

    // Close enough to make an arrest.
    if (
      unit.state === 'chase' &&
      inVehicle &&
      playerDistance < 7 &&
      unit.speed < 4 &&
      this.game.wanted > 0
    ) {
      this.arrest('vehicle');
    }
  }

  // --- officers ------------------------------------------------------------
  spawnOfficer(unit, distance) {
    const rig = createPerson({
      skin: '#d3a17e',
      shirt: '#1b2a44',
      pants: '#141c2a',
      hair: '#1a1410',
      jacket: '#22334f',
      shoes: '#101317',
    });
    rig.root.position.set(unit.pos.x, CITY.curb, unit.pos.z);
    rig.root.scale.setScalar(1);
    this.scene.add(rig.root);

    const angle = Math.random() * Math.PI * 2;
    const officer = {
      rig,
      pos: new THREE.Vector3(unit.pos.x + Math.cos(angle) * 1.8, 0, unit.pos.z + Math.sin(angle) * 1.8),
      yaw: 0,
      speed: 0,
      shootTimer: 0.8 + Math.random(),
      unit,
      armed: Math.random() < 0.3 ? 'rifle' : 'pistol',
    };
    unit.speed = 0;
    this.officers.push(officer);
    return officer;
  }

  despawnOfficer(officer) {
    if (!officer) return;
    this.scene.remove(officer.rig.root);
    const index = this.officers.indexOf(officer);
    if (index >= 0) this.officers.splice(index, 1);
    if (officer.unit) officer.unit.officer = null;
  }

  updateOfficers(dt, ctx) {
    const { playerPosition, onFoot, inVehicle } = ctx;
    for (let i = this.officers.length - 1; i >= 0; i -= 1) {
      const officer = this.officers[i];
      const dx = playerPosition.x - officer.pos.x;
      const dz = playerPosition.z - officer.pos.z;
      const distance = Math.hypot(dx, dz);

      if (this.game.wanted <= 0 || this.game.jailed) {
        this.despawnOfficer(officer);
        continue;
      }

      const wantsArrest = onFoot && distance < ARREST_RANGE;
      if (wantsArrest) {
        this.arrest('officer');
        continue;
      }

      const stop = distance < SHOOT_RANGE ? 7 : 0;
      const move = distance > stop;
      officer.speed = move ? 6.8 : 0;

      if (move) {
        const desiredYaw = Math.atan2(-dx, -dz);
        let diff = desiredYaw - officer.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        officer.yaw += Math.max(-5 * dt, Math.min(5 * dt, diff));
        officer.pos.x += (dx / distance) * officer.speed * dt;
        officer.pos.z += (dz / distance) * officer.speed * dt;
      } else {
        const desiredYaw = Math.atan2(-dx, -dz);
        let diff = desiredYaw - officer.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        officer.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
      }

      officer.rig.root.position.set(officer.pos.x, CITY.curb, officer.pos.z);
      officer.rig.root.rotation.y = officer.yaw;
      animatePerson(officer.rig, { dt, speed: officer.speed });

      // Shooting.
      if (distance < SHOOT_RANGE && this.game.wanted > 0) {
        officer.shootTimer -= dt;
        if (officer.shootTimer <= 0) {
          officer.shootTimer = officer.armed === 'rifle' ? 0.55 : 1.25;
          const headshot = Math.random() < 0.14;
          this.game.damage(headshot ? 20 : 10);
          this.audio?.gunshot(officer.armed);
          if (this.game.health <= 0) this.arrest('downed');
        }
      }
    }

    // Parked officers despawn when the area is quiet.
    for (const unit of this.units) {
      if (unit.officer && unit.state !== 'chase') this.despawnOfficer(unit.officer);
    }
  }

  // --- arrest / jail -------------------------------------------------------
  arrest(reason) {
    const now = performance.now();
    if (this.jailing || now - this.lastArrest < 5000) return;
    this.lastArrest = now;
    this.jailing = { phase: 'cuffed', timer: 1.6, reason };

    this.game.jailed = true;
    this.game.stats.arrests += 1;
    this.car.setControlEnabled(false);
    this.car.chassisBody.velocity.setZero();
    this.player.group.visible = true;
    this.game.notify('You are under arrest', 'warn');
    this.game.emit('arrest', { reason });
  }

  updateArrest(dt, ctx) {
    if (!this.jailing) return;
    this.jailing.timer -= dt;

    if (this.jailing.phase === 'cuffed' && this.jailing.timer <= 0) {
      this.jailing.phase = 'jail';
      this.jailing.timer = 12;
      const fine = Math.min(this.game.money, 500);
      this.game.money -= fine;
      this.game.notify(`Booked at the station · $${fine} fine`, 'warn');
      this.game.emit('jail', { seconds: 12 });
      this.player.group.visible = false;
      if (ctx.onFoot) {
        // keep the model hidden while processing
      }
      this.car.chassisBody.position.set(0, 1.1, 8);
      this.car.chassisBody.velocity.setZero();
    }

    if (this.jailing.phase === 'jail' && this.jailing.timer <= 0) {
      this.jailing = null;
      this.game.jailed = false;
      this.game.clearWanted();
      this.game.health = this.game.maxHealth;
      this.player.group.visible = true;
      this.player.teleportTo?.(this.releasePoint.x, this.releasePoint.z);
      this.game.emit('released');
      this.game.notify('Released from custody', 'good');
      for (const unit of this.units) {
        unit.state = 'return';
        unit.lightsOn = false;
      }
    }
  }
}
