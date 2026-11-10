import * as THREE from 'three';
import { createPerson, animatePerson } from './character.js';
import { CITY, blockBounds } from './city.js';

const SKINS = ['#d7a583', '#c08a63', '#8d5a3b', '#efc7a6', '#6f4630', '#b98160'];
const SHIRTS = ['#2f6f9e', '#a33b3b', '#3d7a4f', '#c9a227', '#5a4b8a', '#d97b2b', '#2a2f38', '#e3e6e8'];
const PANTS = ['#2b303a', '#3a4050', '#4b4137', '#22303c', '#5a5f66'];
const HAIR = ['#241a12', '#14100c', '#5a3a22', '#8a6a3a', '#2b2b2b'];

function walkLoop(i, j) {
  const b = blockBounds(i, j);
  const inset = 2;
  const x0 = b.x0 + inset;
  const x1 = b.x1 - inset;
  const z0 = b.z0 + inset;
  const z1 = b.z1 - inset;
  return [
    new THREE.Vector2(x0, z0),
    new THREE.Vector2(x1, z0),
    new THREE.Vector2(x1, z1),
    new THREE.Vector2(x0, z1),
  ];
}

export function createPedestrians(scene, count = 20) {
  const loops = [];
  for (let i = -2; i < 2; i += 1) {
    for (let j = -2; j < 2; j += 1) loops.push(walkLoop(i, j));
  }

  const peds = [];
  for (let n = 0; n < count; n += 1) {
    const rig = createPerson({
      skin: SKINS[n % SKINS.length],
      shirt: SHIRTS[(n * 3) % SHIRTS.length],
      pants: PANTS[(n * 2) % PANTS.length],
      hair: HAIR[(n * 5) % HAIR.length],
      jacket: n % 3 === 0 ? SHIRTS[(n * 5 + 2) % SHIRTS.length] : null,
      scale: 0.94 + (n % 4) * 0.03,
    });
    rig.root.traverse((node) => {
      if (node.isMesh) node.castShadow = false;
    });
    scene.add(rig.root);

    const loop = loops[n % loops.length];
    const corner = n % 4;
    const ped = {
      rig,
      loop,
      corner,
      dir: n % 5 === 0 ? -1 : 1,
      speed: 1.15 + (n % 3) * 0.16,
      pos: loop[corner].clone(),
      yaw: Math.random() * Math.PI * 2,
      pause: 0,
    };
    ped.rig.root.position.set(ped.pos.x, CITY.curb, ped.pos.y);
    peds.push(ped);
  }

  const toPlayer = new THREE.Vector2();

  function kill(ped) {
    ped.down = true;
    ped.rig.root.visible = false;
  }

  function update(dt, playerPosition) {
    for (const ped of peds) {
      if (ped.down) continue;
      const target = ped.loop[ped.corner];
      const dx = target.x - ped.pos.x;
      const dz = target.y - ped.pos.y;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.2) {
        ped.corner = (ped.corner + ped.dir + 4) % 4;
        if (Math.random() < 0.18) ped.pause = 0.6 + Math.random() * 1.4;
      }

      // Give way to the player when they get close.
      toPlayer.set(playerPosition.x - ped.pos.x, playerPosition.z - ped.pos.y);
      const near = toPlayer.length();
      let speed = ped.speed;
      if (near < 2.1) speed *= 0.15;
      if (ped.pause > 0) {
        ped.pause -= dt;
        speed = 0;
      }

      const desiredYaw = Math.atan2(-dx, -dz);
      let diff = desiredYaw - ped.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ped.yaw += Math.max(-3 * dt, Math.min(3 * dt, diff));

      if (speed > 0 && dist > 0.01) {
        const step = Math.min(speed * dt, dist);
        ped.pos.x += (dx / dist) * step;
        ped.pos.y += (dz / dist) * step;
      }

      const rig = ped.rig;
      rig.root.position.set(ped.pos.x, CITY.curb, ped.pos.y);
      rig.root.rotation.y = ped.yaw;
      animatePerson(rig, { dt, speed: speed > 0 ? speed : 0 });
    }
  }

  return { peds, update, kill };
}
