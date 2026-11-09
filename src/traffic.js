import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createSimpleCar, CAR_COLORS } from './vehicles.js';
import { CITY, ROAD_LINES, EXT } from './city.js';
import { signalState } from './signals.js';

/**
 * Kinematic city traffic.
 *
 * Every car follows the centre of its own right-hand lane through a polyline
 * built from the road grid, steers with a pure-pursuit controller (so it never
 * snaps or wiggles through a corner), and plans its speed ahead of time from
 * the road curvature, the car in front and the traffic light. That keeps the
 * stream calm and glitch-free while still obeying the rules of the road:
 * right-hand traffic, speed limits, stop lines, amber lights and no blocking
 * the junction.
 */

const SPEED_LIMIT = 12.5; // ~45 km/h
const ACCEL = 2.7;
const BRAKE = 6.4; // hard limit, used for stopping distances
const COMFORT = 3.2; // planned deceleration for lights, queues and corners
const MAX_LATERAL = 8.0; // m/s² of cornering grip
const IDM_S0 = 2.4; // metres kept to the car in front
const IDM_T = 1.35; // seconds of headway
const CAR_LENGTH = 4.4;
const STOP_OFFSET = CITY.roadHalf + 5.4; // stop line, just outside the crosswalk
const STOP_LIMIT = 46; // how far ahead a red light is considered

const VECTORS = {
  E: { x: 1, z: 0 },
  W: { x: -1, z: 0 },
  N: { x: 0, z: -1 },
  S: { x: 0, z: 1 },
};
const OPPOSITE = { E: 'W', W: 'E', N: 'S', S: 'N' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };
const isHorizontal = (dir) => dir === 'E' || dir === 'W';
const isPositive = (dir) => dir === 'E' || dir === 'S';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Centre of the right-hand lane for a direction and road coordinate. */
function lanePoint(dir, road, along) {
  if (dir === 'E') return { x: along, z: road + CITY.lane };
  if (dir === 'W') return { x: along, z: road - CITY.lane };
  if (dir === 'N') return { x: road + CITY.lane, z: along };
  return { x: road - CITY.lane, z: along }; // S
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Builds the drivable polyline through the next junction, with speed limits. */
function planLeg(ai) {
  const dir = ai.dir;
  const road = ai.road;
  const sign = isPositive(dir) ? 1 : -1;
  const horizontal = isHorizontal(dir);
  const along = horizontal ? ai.pos.x : ai.pos.z;

  let cross = null;
  for (const line of ROAD_LINES) {
    if (sign * (line - along) < 2) continue;
    if (cross === null || Math.abs(line - along) < Math.abs(cross - along)) cross = line;
  }

  if (cross === null) {
    // Outside the grid: turn around and keep driving.
    ai.dir = OPPOSITE[dir];
    planLeg(ai);
    return;
  }

  const ix = horizontal ? cross : road;
  const iz = horizontal ? road : cross;

  // A direction that heads off the road network would strand the car outside
  // the city, so the choice is filtered down to directions that stay inside.
  const leavesGrid = (candidate) => {
    const v = VECTORS[candidate];
    return Math.abs(ix + v.x * 40) > EXT + 0.5 || Math.abs(iz + v.z * 40) > EXT + 0.5;
  };

  let next = dir;
  const roll = Math.random();
  if (roll < 0.24) next = LEFT[dir];
  else if (roll < 0.48) next = RIGHT[dir];
  if (leavesGrid(next)) {
    const options = [LEFT[dir], RIGHT[dir], dir].filter((candidate) => !leavesGrid(candidate));
    if (options.length) next = options[0];
  }

  ai.nextCross = cross;
  ai.turn = next === dir ? 'straight' : next === LEFT[dir] ? 'left' : 'right';
  // The car is still driving the current leg; the new heading only applies
  // once this path has been followed to the end.
  ai.nextDir = next;
  ai.nextRoad = next === dir ? road : cross;

  const points = [];
  const push = (x, z, v) => {
    const last = points[points.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < 0.35) return;
    points.push({ x, z, v });
  };

  if (next === dir) {
    const end = cross + sign * 34;
    for (let a = along; sign * (a - end) < -0.01; a += 4 * sign) {
      const p = lanePoint(dir, road, a);
      push(p.x, p.z, SPEED_LIMIT);
    }
    ai.path = points;
    ai.cursor = 0;
    return;
  }

  // Quarter-circle turn laid out between the two lane centre lines.
  const isLeft = next === LEFT[dir];
  const radius = isLeft ? 13 : 8.6;
  // Stay a little under the lateral limit so the steering controller always has
  // headroom to hold the arc instead of running wide off the corner.
  const arcSpeed = Math.min(Math.sqrt(MAX_LATERAL * radius * 0.8), SPEED_LIMIT);

  const inZ = dir === 'E' ? road + CITY.lane : road - CITY.lane;
  const inX = dir === 'N' ? road + CITY.lane : road - CITY.lane;
  const outZ = next === 'E' ? cross + CITY.lane : cross - CITY.lane;
  const outX = next === 'N' ? cross + CITY.lane : cross - CITY.lane;
  const corner = { x: horizontal ? outX : inX, z: horizontal ? inZ : outZ };

  const f = VECTORS[dir];
  const side = isLeft ? { x: f.z, z: -f.x } : { x: -f.z, z: f.x };
  const center = {
    x: corner.x - f.x * radius + side.x * radius,
    z: corner.z - f.z * radius + side.z * radius,
  };
  const tangentIn = { x: center.x - side.x * radius, z: center.z - side.z * radius };
  const tangentOut = { x: center.x + f.x * radius, z: center.z + f.z * radius };

  const tangentAlong = horizontal ? tangentIn.x : tangentIn.z;
  for (let a = along; sign * a < sign * tangentAlong - 0.05; a += 4 * sign) {
    const p = lanePoint(dir, road, a);
    push(p.x, p.z, SPEED_LIMIT);
  }

  const startAngle = Math.atan2(-side.z, -side.x);
  const endAngle = Math.atan2(f.z, f.x);
  const sweep = wrapAngle(endAngle - startAngle);
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const angle = startAngle + sweep * (i / steps);
    push(
      center.x + Math.cos(angle) * radius,
      center.z + Math.sin(angle) * radius,
      arcSpeed
    );
  }

  const nextVector = VECTORS[next];
  for (let d = 4; d <= 34; d += 4) {
    push(tangentOut.x + nextVector.x * d, tangentOut.z + nextVector.z * d, SPEED_LIMIT);
  }

  ai.path = points;
  ai.cursor = 0;
}

function ensurePath(ai) {
  // Self-heal: if the car has strayed far from its path, plan a fresh leg from
  // where it actually is instead of steering back to a stale point.
  const current = ai.path[ai.cursor];
  const strayed = current ? Math.hypot(current.x - ai.pos.x, current.z - ai.pos.z) > 14 : false;

  if (ai.cursor < ai.path.length - 2 && !strayed) return;
  ai.dir = ai.nextDir ?? ai.dir;
  ai.road = ai.nextRoad ?? ai.road;
  planLeg(ai);
}

function advanceCursor(ai) {
  const fx = -Math.sin(ai.yaw);
  const fz = -Math.cos(ai.yaw);
  while (ai.cursor < ai.path.length - 1) {
    const point = ai.path[ai.cursor];
    const dx = point.x - ai.pos.x;
    const dz = point.z - ai.pos.z;
    const ahead = dx * fx + dz * fz;
    if (ahead > -0.5 && Math.hypot(dx, dz) > 1.6) break;
    ai.cursor += 1;
  }
}

/** Point `distance` metres along the remaining path — the pure-pursuit target. */
function lookaheadPoint(ai, distance) {
  let remaining = distance;
  let x = ai.pos.x;
  let z = ai.pos.z;
  for (let i = ai.cursor; i < ai.path.length; i += 1) {
    const point = ai.path[i];
    const dx = point.x - x;
    const dz = point.z - z;
    const d = Math.hypot(dx, dz);
    if (d >= remaining) {
      if (d < 1e-4) continue;
      return { x: x + (dx / d) * remaining, z: z + (dz / d) * remaining, distance };
    }
    remaining -= d;
    x = point.x;
    z = point.z;
  }
  return { x, z, distance: Math.hypot(x - ai.pos.x, z - ai.pos.z) };
}

/** Speed profile that lets the car brake smoothly for the next curve. */
function pathSpeedLimit(ai) {
  let target = SPEED_LIMIT;
  let travelled = 0;
  let x = ai.pos.x;
  let z = ai.pos.z;

  for (let i = ai.cursor; i < ai.path.length; i += 1) {
    const point = ai.path[i];
    travelled += Math.hypot(point.x - x, point.z - z);
    x = point.x;
    z = point.z;
    if (travelled > 90) break;
    if (point.v < SPEED_LIMIT) {
      const allowed = Math.sqrt(
        point.v * point.v + 2 * COMFORT * Math.max(0, travelled - 1.2)
      );
      target = Math.min(target, allowed);
    }
  }
  return target;
}

/** Distance to the stop line and the light colour for the junction ahead. */
function signalAhead(ai, time) {
  if (ai.nextCross === null) return null;
  const horizontal = isHorizontal(ai.dir);
  const sign = isPositive(ai.dir) ? 1 : -1;
  const along = horizontal ? ai.pos.x : ai.pos.z;
  const line = ai.nextCross - sign * STOP_OFFSET;
  const gap = sign * (line - along) - CAR_LENGTH / 2;

  const ix = Math.round((horizontal ? ai.nextCross : ai.road) / CITY.spacing);
  const jz = Math.round((horizontal ? ai.road : ai.nextCross) / CITY.spacing);
  const state = signalState(time, ix, jz);
  const color = horizontal ? state.ew : state.ns;

  return { gap, color };
}

/**
 * Speed allowed by the car (or player) ahead, from a plain distance gap.
 * Blends a braking-distance curve with matching the leader's speed.
 */
function leaderSpeedLimit(gap, leaderSpeed) {
  if (gap <= IDM_S0) return 0;
  const free = gap - IDM_S0;
  // Matching speed plus a comfortable closing margin: close the gap on a fast
  // leader instead of crawling behind it.
  return Math.sqrt(leaderSpeed * leaderSpeed + 2 * COMFORT * free);
}

export function createTraffic(scene, car, count = 24, world = null) {
  const cars = [];
  const playerPos = new THREE.Vector3();
  let playerSpeed = 0;

  const segments = [];
  for (const road of ROAD_LINES) {
    for (let k = 0; k < ROAD_LINES.length - 1; k += 1) {
      segments.push({ road, a: ROAD_LINES[k], b: ROAD_LINES[k + 1] });
    }
  }

  const directions = ['E', 'W', 'N', 'S'];

  for (let i = 0; i < count; i += 1) {
    let placed = null;

    for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
      const segment = segments[Math.floor(Math.random() * segments.length)];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const margin = CITY.roadHalf + 10;
      const along =
        segment.a + margin + Math.random() * Math.max(2, segment.b - segment.a - margin * 2);
      const pos = lanePoint(dir, segment.road, along);

      if (Math.hypot(pos.x, pos.z - 8) < 42) continue;
      let clear = true;
      for (const other of cars) {
        if (Math.hypot(other.pos.x - pos.x, other.pos.z - pos.z) < 16) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      placed = { pos, dir, road: segment.road };
    }

    if (!placed) continue;

    const color = CAR_COLORS[i % CAR_COLORS.length];
    const model = createSimpleCar(color, { taxi: i % 7 === 3 });
    model.group.position.set(placed.pos.x, 0, placed.pos.z);
    scene.add(model.group);

    const ai = {
      model,
      group: model.group,
      wheels: model.wheels,
      brakeLight: model.brakeLight,
      dir: placed.dir,
      road: placed.road,
      pos: placed.pos,
      yaw: Math.atan2(-VECTORS[placed.dir].x, -VECTORS[placed.dir].z),
      speed: SPEED_LIMIT * (0.35 + Math.random() * 0.3),
      accel: 0,
      path: [],
      cursor: 0,
      nextCross: null,
      turn: 'straight',
      body: null,
    };

    if (world) {
      ai.body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        shape: new CANNON.Box(new CANNON.Vec3(0.92, 0.68, 2.15)),
      });
      ai.body.position.set(ai.pos.x, 0.72, ai.pos.z);
      ai.body.quaternion.setFromEuler(0, ai.yaw, 0);
      world.addBody(ai.body);
    }

    planLeg(ai);
    cars.push(ai);
  }

  function findLead(ai) {
    const fx = -Math.sin(ai.yaw);
    const fz = -Math.cos(ai.yaw);
    let best = null;

    const consider = (x, z, speed) => {
      const dx = x - ai.pos.x;
      const dz = z - ai.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0.2 || ahead > 30) return;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral > 2.3) return;
      const gap = ahead - CAR_LENGTH;
      if (gap < -1.5) return;
      if (!best || gap < best.gap) best = { gap, speed };
    };

    for (const other of cars) {
      if (other === ai) continue;
      consider(other.pos.x, other.pos.z, other.speed);
    }
    if (playerPos) consider(playerPos.x, playerPos.z, playerSpeed);

    return best;
  }

  function update(dt, time) {
    playerPos.copy(car.chassisBody.position);
    const vx = car.chassisBody.velocity.x;
    const vz = car.chassisBody.velocity.z;
    playerSpeed = Math.hypot(vx, vz);

    for (const ai of cars) {
      ensurePath(ai);
      advanceCursor(ai);

      // --- speed planning --------------------------------------------------
      let target = pathSpeedLimit(ai);

      const signal = signalAhead(ai, time);
      if (signal && signal.gap > 0 && signal.gap < STOP_LIMIT) {
        // Never slam on the brakes when the light changes too late to stop:
        // that is how a driver ends up stuck in the middle of the junction.
        const stoppingDistance = (ai.speed * ai.speed) / (2 * BRAKE) + 1;
        const mustStop =
          signal.gap > stoppingDistance &&
          (signal.color === 'red' || (signal.color === 'yellow' && signal.gap > 8));
        if (mustStop) {
          // Aim to be stationary 1.2 m short of the line, braking comfortably.
          target = Math.min(target, Math.sqrt(2 * COMFORT * Math.max(0, signal.gap - 1.2)));
        }
      }

      const lead = findLead(ai);
      if (lead) {
        target = Math.min(target, leaderSpeedLimit(lead.gap, lead.speed));
      }

      target = clamp(target, 0, SPEED_LIMIT);

      // Proportional approach, but commit to full braking once the car is well
      // over the profile so a light never gets run through reaction lag.
      const error = target - ai.speed;
      let desiredAccel;
      if (error < -1) desiredAccel = -BRAKE;
      else if (error < 0) desiredAccel = error * 4.5;
      else desiredAccel = Math.min(ACCEL, error * 2.2);

      ai.accel += (desiredAccel - ai.accel) * Math.min(1, dt * 12);
      ai.speed = Math.max(0, ai.speed + ai.accel * dt);
      if (target < 0.25 && ai.speed < 0.4) {
        ai.speed = 0;
        ai.accel = 0;
      }

      // --- steering --------------------------------------------------------
      const lookDistance = clamp(5.5 + ai.speed * 0.6, 5.5, 13);
      const aim = lookaheadPoint(ai, lookDistance);
      const desiredYaw = Math.atan2(-(aim.x - ai.pos.x), -(aim.z - ai.pos.z));
      const alpha = wrapAngle(desiredYaw - ai.yaw);
      const lateral = aim.distance > 0.4 ? aim.distance : 0.4;
      let yawRate = (ai.speed * 2 * Math.sin(alpha)) / lateral;
      const yawCap = MAX_LATERAL / Math.max(ai.speed, 2.4);
      yawRate = clamp(yawRate, -yawCap, yawCap);
      ai.yaw += yawRate * dt;

      ai.pos.x += -Math.sin(ai.yaw) * ai.speed * dt;
      ai.pos.z += -Math.cos(ai.yaw) * ai.speed * dt;

      // --- presentation ----------------------------------------------------
      ai.group.position.set(ai.pos.x, 0, ai.pos.z);
      ai.group.rotation.y = ai.yaw;

      const spin = (ai.speed / 0.34) * dt;
      for (const wheel of ai.wheels) {
        wheel.rotation.x -= spin;
        wheel.rotation.y = wheel.userData.front
          ? clamp(alpha * 0.7, -0.42, 0.42)
          : 0;
      }
      if (ai.brakeLight) {
        ai.brakeLight.emissiveIntensity = ai.accel < -1.2 || ai.speed < 0.3 ? 1.9 : 0.5;
      }

      // Kinematic body carries the collision volume for the player's car.
      if (ai.body) {
        if (dt > 0.0001) {
          ai.body.velocity.set(
            (ai.pos.x - ai.body.position.x) / dt,
            0,
            (ai.pos.z - ai.body.position.z) / dt
          );
        }
        ai.body.position.set(ai.pos.x, 0.72, ai.pos.z);
        ai.body.quaternion.setFromEuler(0, ai.yaw, 0);
      }
    }
  }

  return { cars, update };
}
