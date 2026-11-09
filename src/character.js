import * as THREE from 'three';

const HIP_HEIGHT = 0.97;

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra });
}

function part(materialRef, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), materialRef);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  return mesh;
}

/**
 * A blocky but properly jointed humanoid: hip -> torso -> head/arms and
 * hip -> thigh -> shin -> foot, so it can be animated procedurally.
 */
export function createPerson({
  skin = '#c9906b',
  shirt = '#2f6f9e',
  pants = '#2b303a',
  hair = '#241a12',
  shoes = '#e6e7e9',
  jacket = null,
  scale = 1,
} = {}) {
  const skinM = material(skin, { roughness: 0.72 });
  const shirtM = material(shirt);
  const pantsM = material(pants);
  const hairM = material(hair, { roughness: 0.95 });
  const shoeM = material(shoes, { roughness: 0.6 });
  const jacketM = jacket ? material(jacket) : shirtM;

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_HEIGHT;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);

  torso.add(part(jacketM, [0.42, 0.34, 0.24], [0, 0.31, 0]));
  torso.add(part(shirtM, [0.36, 0.2, 0.22], [0, 0.09, 0]));
  torso.add(part(pantsM, [0.36, 0.16, 0.23], [0, -0.04, 0]));

  const neck = new THREE.Group();
  neck.position.set(0, 0.52, 0);
  torso.add(neck);
  neck.add(part(skinM, [0.1, 0.08, 0.1], [0, 0.02, 0]));

  const head = new THREE.Group();
  head.position.set(0, 0.12, 0);
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skinM);
  skull.scale.set(1, 1.12, 1.02);
  skull.castShadow = true;
  head.add(skull);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM);
  hairCap.position.y = 0.012;
  hairCap.castShadow = true;
  head.add(hairCap);
  // Nose gives the head a facing direction.
  head.add(part(skinM, [0.045, 0.05, 0.06], [0, -0.01, -0.11]));

  const arms = [];
  const hands = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.42, 0);
    torso.add(shoulder);

    shoulder.add(part(jacketM, [0.13, 0.3, 0.15], [0, -0.14, 0]));

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.29, 0);
    shoulder.add(elbow);
    elbow.add(part(skinM, [0.11, 0.26, 0.13], [0, -0.13, 0]));
    const hand = part(skinM, [0.11, 0.09, 0.13], [0, -0.29, 0]);
    elbow.add(hand);

    arms.push(shoulder);
    hands.push(elbow);
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const hipJoint = new THREE.Group();
    hipJoint.position.set(side * 0.12, -0.06, 0);
    hips.add(hipJoint);
    hipJoint.add(part(pantsM, [0.17, 0.44, 0.19], [0, -0.22, 0]));

    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hipJoint.add(knee);
    knee.add(part(pantsM, [0.15, 0.4, 0.17], [0, -0.2, 0]));
    const foot = part(shoeM, [0.15, 0.1, 0.3], [0, -0.44, -0.06]);
    knee.add(foot);

    legs.push({ hip: hipJoint, knee });
  }

  root.scale.setScalar(scale);
  root.traverse((node) => {
    if (node.isMesh) node.receiveShadow = true;
  });

  const rig = {
    root,
    hips,
    torso,
    head,
    arms,
    hands,
    legs,
    anim: {
      phase: 0,
      speed: 0,
      crouch: 0,
      lean: 0,
    },
  };
  return rig;
}

const damp = (current, target, dt, rate = 10) => current + (target - current) * Math.min(1, dt * rate);

/**
 * Procedural walk / run / crouch cycle. `speed` is metres per second; the
 * stride, arm swing and body lean all scale from it, so the motion blends
 * smoothly instead of snapping between poses.
 */
export function animatePerson(rig, { dt = 1 / 60, speed = 0, crouch = false, seated = false } = {}) {
  const a = rig.anim;
  a.speed = damp(a.speed, speed, dt, 9);
  a.crouch = damp(a.crouch, crouch ? 1 : 0, dt, 8);

  if (seated) {
    rig.hips.position.y = damp(rig.hips.position.y, HIP_HEIGHT - 0.16, dt, 10);
    rig.hips.rotation.x = damp(rig.hips.rotation.x, 0, dt, 8);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, 0.08, dt, 8);
    for (const leg of rig.legs) {
      leg.hip.rotation.x = damp(leg.hip.rotation.x, -1.35, dt, 10);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, 1.3, dt, 10);
    }
    for (const arm of rig.arms) arm.rotation.x = damp(arm.rotation.x, -0.75, dt, 10);
    for (const elbow of rig.hands) elbow.rotation.x = damp(elbow.rotation.x, -0.5, dt, 10);
    for (const arm of rig.arms) arm.rotation.z = damp(arm.rotation.z, 0.12, dt, 10);
    return;
  }

  const moving = a.speed > 0.05;
  const stride = Math.min(a.speed / 1.5, 2.4);
  a.phase += a.speed * dt * 3.1;

  const swing = Math.sin(a.phase) * 0.62 * stride;
  const swingBack = Math.sin(a.phase + Math.PI) * 0.62 * stride;
  const kneeBend = (p) => Math.max(0, Math.cos(p)) * 0.9 * Math.min(stride, 1.6);

  const hipY = HIP_HEIGHT - a.crouch * 0.36 - (moving ? Math.abs(Math.sin(a.phase * 2)) * 0.035 * Math.min(stride, 1.4) : 0);
  rig.hips.position.y = damp(rig.hips.position.y, hipY, dt, 14);

  const crouchBend = a.crouch * 1.05;
  rig.legs[0].hip.rotation.x = -swing - crouchBend;
  rig.legs[1].hip.rotation.x = -swingBack - crouchBend;
  rig.legs[0].knee.rotation.x = kneeBend(a.phase) + a.crouch * 1.75;
  rig.legs[1].knee.rotation.x = kneeBend(a.phase + Math.PI) + a.crouch * 1.75;
  rig.legs[0].hip.rotation.z = damp(rig.legs[0].hip.rotation.z, a.crouch * 0.14, dt, 8);
  rig.legs[1].hip.rotation.z = damp(rig.legs[1].hip.rotation.z, -a.crouch * 0.14, dt, 8);

  const armAmp = moving ? 0.42 * stride : 0;
  rig.arms[0].rotation.x = swing * 0.85 * (armAmp > 0 ? 1 : 0) - 0.05;
  rig.arms[1].rotation.x = swingBack * 0.85 * (armAmp > 0 ? 1 : 0) - 0.05;
  rig.arms[0].rotation.z = 0.08 + a.crouch * 0.1;
  rig.arms[1].rotation.z = -0.08 - a.crouch * 0.1;
  rig.hands[0].rotation.x = moving ? Math.max(0, -Math.sin(a.phase)) * 0.7 : 0.12;
  rig.hands[1].rotation.x = moving ? Math.max(0, Math.sin(a.phase)) * 0.7 : 0.12;

  // Lean into the run, bob the head, keep the idle pose alive.
  a.lean = damp(a.lean, Math.min(a.speed / 8, 1) * 0.16 + a.crouch * 0.18, dt, 6);
  rig.torso.rotation.x = a.lean;
  rig.torso.rotation.z = moving ? Math.sin(a.phase) * 0.05 : Math.sin(performance.now() * 0.0012) * 0.012;
  rig.head.rotation.x = -a.lean * 0.55;
  rig.head.rotation.z = moving ? Math.sin(a.phase) * 0.04 : 0;
}
