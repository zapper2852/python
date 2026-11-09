import * as THREE from 'three';
import { createSimpleCar, CAR_COLORS } from './vehicles.js';
import { CITY, ROAD_LINES } from './city.js';

const CRUISE = 11.5; // ~40 km/h
const TURN = 5;
const MAX_YAW_RATE = 2.6;

const VECTORS = {
  E: new THREE.Vector2(1, 0),
  W: new THREE.Vector2(-1, 0),
  N: new THREE.Vector2(0, -1),
  S: new THREE.Vector2(0, 1),
};
const OPPOSITE = { E: 'W', W: 'E', N: 'S', S: 'N' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };

const isHorizontal = (dir) => dir === 'E' || dir === 'W';
const isPositive = (dir) => dir === 'E' || dir === 'S';
const laneSign = (dir) => (dir === 'E' || dir === 'N' ? 1 : -1);

function lanePoint(dir, road, along) {
  if (dir === 'E') return new THREE.Vector2(along, road + CITY.lane);
  if (dir === 'W') return new THREE.Vector2(along, road - CITY.lane);
  if (dir === 'N') return new THREE.Vector2(road + CITY.lane, along);
  return new THREE.Vector2(road - CITY.lane, along);
}

/** Builds the next straight run plus the curve through the intersection. */
function planLeg(car) {
  const axis = isHorizontal(car.dir) ? 'x' : 'z';
  const sign = isPositive(car.dir) ? 1 : -1;
  const along = axis === 'x' ? car.pos.x : car.pos.y;

  let cross = null;
  for (const line of ROAD_LINES) {
    const delta = line - along;
    if (sign * delta < 6) continue;
    if (cross === null || Math.abs(delta) < Math.abs(cross - along)) cross = line;
  }
  if (cross === null) {
    car.dir = OPPOSITE[car.dir];
    return planLeg(car);
  }

  const ix = isHorizontal(car.dir) ? cross : car.road;
  const iz = isHorizontal(car.dir) ? car.road : cross;

  const roll = Math.random();
  let next = car.dir;
  if (roll < 0.26) next = LEFT[car.dir];
  else if (roll < 0.5) next = RIGHT[car.dir];

  // Stay inside the city: at the outer ring, turn rather than drive off.
  const atEdge = Math.abs(cross) >= CITY.blocks * CITY.spacing - 0.5;
  if (atEdge && next === car.dir) next = Math.random() < 0.5 ? LEFT[car.dir] : RIGHT[car.dir];

  const entry = lanePoint(car.dir, car.road, cross - sign * 7);
  const roadB = isHorizontal(next) ? iz : ix;
  const exit = lanePoint(next, roadB, cross + (isPositive(next) ? 1 : -1) * 7);
  const control = isHorizontal(car.dir)
    ? new THREE.Vector2(exit.x, entry.y)
    : new THREE.Vector2(entry.x, exit.y);

  const points = [];
  if (car.pos.distanceTo(entry) > 1.2) {
    points.push(entry.clone().set(entry.x, entry.y));
  }
  const straight = next === car.dir;
  if (!straight) {
    for (let i = 1; i <= 6; i += 1) {
      const t = i / 6;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      const p = new THREE.Vector2(
        a * entry.x + b * control.x + c * exit.x,
        a * entry.y + b * control.y + c * exit.y
      );
      p.slow = true;
      points.push(p);
    }
  }
  const beyond = exit.clone().addScaledVector(VECTORS[next], 26);
  points.push(beyond);

  car.waypoints = points;
  car.dir = next;
  car.road = roadB;
}

function followLimit(car, others, playerPosition) {
  const forward = VECTORS[car.dir];
  let limit = CRUISE;

  const consider = (x, z, speed, radius) => {
    const dx = x - car.pos.x;
    const dz = z - car.pos.y;
    const ahead = dx * forward.x + dz * forward.y;
    const side = Math.abs(dx * forward.y - dz * forward.x);
    if (ahead <= 0 || ahead > radius || side > 2.8) return;
    if (ahead < radius * 0.55) limit = Math.min(limit, Math.max(0, speed - 1));
    else limit = Math.min(limit, Math.max(4, speed));
  };

  for (const other of others) {
    if (other === car) continue;
    consider(other.pos.x, other.pos.y, other.speed, 20);
  }
  if (playerPosition) consider(playerPosition.x, playerPosition.z, 0, 17);

  return limit;
}

export function createTraffic(scene, car, count = 22) {
  const cars = [];

  for (let i = 0; i < count; i += 1) {
    const color = CAR_COLORS[i % CAR_COLORS.length];
    const model = createSimpleCar(color, { taxi: i % 7 === 3 });
    scene.add(model.group);

    const central = ROAD_LINES.filter((line) => Math.abs(line) <= CITY.spacing);
    const inTown = Math.random() < 0.78;
    const pool = inTown ? central : ROAD_LINES;
    const road = pool[Math.floor(Math.random() * pool.length)];
    const dir = ['E', 'W', 'N', 'S'][Math.floor(Math.random() * 4)];
    const along = inTown ? -110 + Math.random() * 220 : -220 + Math.random() * 440;

    const carState = {
      model,
      group: model.group,
      wheels: model.wheels,
      dir,
      road,
      pos: lanePoint(dir, road, along),
      yaw: 0,
      speed: CRUISE * 0.6,
      waypoints: [],
    };

    // keep clear of the player's spawn
    if (carState.pos.distanceTo(new THREE.Vector2(0, 8)) < 40) {
      carState.pos = lanePoint(dir, road, along + 120);
    }

    planLeg(carState);
    cars.push(carState);
  }

  const playerPosition = new THREE.Vector3();
  const target = new THREE.Vector2();

  function update(dt) {
    playerPosition.copy(car.chassisBody.position);

    for (const ai of cars) {
      if (!ai.waypoints.length) planLeg(ai);

      target.copy(ai.waypoints[0]);
      let dx = target.x - ai.pos.x;
      let dz = target.y - ai.pos.y;
      let dist = Math.hypot(dx, dz);

      while (dist < 2.6 && ai.waypoints.length > 1) {
        ai.waypoints.shift();
        target.copy(ai.waypoints[0]);
        dx = target.x - ai.pos.x;
        dz = target.y - ai.pos.y;
        dist = Math.hypot(dx, dz);
      }

      const desiredYaw = Math.atan2(-dx, -dz);
      let diff = desiredYaw - ai.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = MAX_YAW_RATE * dt;
      ai.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));

      const slowAhead = ai.waypoints.some(
        (p) => p.slow && p.distanceTo(ai.pos) < 14
      );
      let targetSpeed = followLimit(ai, cars, playerPosition);
      if (slowAhead) targetSpeed = Math.min(targetSpeed, TURN);
      targetSpeed *= Math.max(0.15, Math.cos(Math.min(Math.abs(diff), 1.2)));

      const accel = targetSpeed > ai.speed ? 5 : 12;
      ai.speed += Math.max(-accel * dt, Math.min(accel * dt, targetSpeed - ai.speed));

      ai.pos.x += -Math.sin(ai.yaw) * ai.speed * dt;
      ai.pos.y += -Math.cos(ai.yaw) * ai.speed * dt;

      ai.group.position.set(ai.pos.x, 0, ai.pos.y);
      ai.group.rotation.y = ai.yaw;

      const spin = (ai.speed / 0.34) * dt;
      for (const wheel of ai.wheels) {
        wheel.rotation.x -= spin;
        wheel.rotation.y = wheel.userData.front ? Math.max(-0.5, Math.min(0.5, diff)) : 0;
      }
    }
  }

  return { cars, update };
}
