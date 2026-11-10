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
  const handMeshes = [];
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
    handMeshes.push(hand);
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

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.44, 0);
    knee.add(ankle);
    ankle.add(part(shoeM, [0.15, 0.1, 0.3], [0, 0, -0.06]));

    legs.push({ hip: hipJoint, knee, ankle });
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
    handMeshes,
    legs,
    materials: {
      skin: skinM,
      shirt: shirtM,
      pants: pantsM,
      hair: hairM,
      shoes: shoeM,
      jacket: jacketM,
    },
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
export function animatePerson(
  rig,
  { dt = 1 / 60, speed = 0, crouch = false, seated = false, driving = false, aiming = false, riding = false } = {}
) {
  const a = rig.anim;
  a.speed = damp(a.speed, speed, dt, 9);
  a.crouch = damp(a.crouch, crouch ? 1 : 0, dt, 8);

  if (seated) {
    rig.hips.position.y = damp(rig.hips.position.y, HIP_HEIGHT - 0.1, dt, 10);
    rig.hips.rotation.x = damp(rig.hips.rotation.x, 0, dt, 8);
    // Hands on the wheel: torso leans in, both arms reach forward and inward.
    rig.torso.rotation.x = damp(rig.torso.rotation.x, driving ? 0.12 : 0.06, dt, 8);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, 0, dt, 8);
    for (const leg of rig.legs) {
      // Thighs forward, shins hanging down: knees bend backwards, never forwards.
      leg.hip.rotation.x = damp(leg.hip.rotation.x, 1.32, dt, 10);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, -1.28, dt, 10);
      leg.ankle.rotation.x = damp(leg.ankle.rotation.x, 0.18, dt, 10);
      leg.hip.rotation.z = damp(leg.hip.rotation.z, 0, dt, 10);
    }
    const armX = driving ? 1.34 : 0.92;
    const elbowX = driving ? -0.52 : -0.26;
    rig.arms.forEach((arm) => {
      arm.rotation.x = damp(arm.rotation.x, armX, dt, 10);
    });
    rig.hands.forEach((elbow) => {
      elbow.rotation.x = damp(elbow.rotation.x, elbowX, dt, 10);
    });
    rig.arms[0].rotation.z = damp(rig.arms[0].rotation.z, driving ? 0.3 : 0.12, dt, 10);
    rig.arms[1].rotation.z = damp(rig.arms[1].rotation.z, driving ? -0.3 : 0.12, dt, 10);
    rig.head.rotation.x = damp(rig.head.rotation.x, 0, dt, 10);
    return;
  }

  if (riding) {
    // Crouched over the tank, arms out to the bars, knees tucked in.
    rig.hips.position.y = damp(rig.hips.position.y, HIP_HEIGHT - 0.06, dt, 10);
    rig.hips.rotation.x = damp(rig.hips.rotation.x, -0.3, dt, 8);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, 0.62, dt, 9);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, 0, dt, 9);
    rig.head.rotation.x = damp(rig.head.rotation.x, -0.5, dt, 9);
    for (const leg of rig.legs) {
      leg.hip.rotation.x = damp(leg.hip.rotation.x, 1.15, dt, 10);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, -1.5, dt, 10);
      leg.hip.rotation.z = damp(leg.hip.rotation.z, leg === rig.legs[0] ? 0.34 : -0.34, dt, 10);
    }
    rig.arms.forEach((arm, index) => {
      arm.rotation.x = damp(arm.rotation.x, 1.28, dt, 11);
      arm.rotation.z = damp(arm.rotation.z, index === 0 ? 0.34 : -0.34, dt, 11);
    });
    rig.hands.forEach((elbow) => {
      elbow.rotation.x = damp(elbow.rotation.x, -0.42, dt, 11);
    });
    return;
  }

  if (aiming) {
    // Both arms out in front, right hand on the grip, left supporting.
    rig.arms[1].rotation.x = damp(rig.arms[1].rotation.x, 1.42, dt, 13);
    rig.hands[1].rotation.x = damp(rig.hands[1].rotation.x, -0.06, dt, 13);
    rig.arms[1].rotation.z = damp(rig.arms[1].rotation.z, -0.1, dt, 13);
    rig.arms[0].rotation.x = damp(rig.arms[0].rotation.x, 1.32, dt, 13);
    rig.hands[0].rotation.x = damp(rig.hands[0].rotation.x, -0.52, dt, 13);
    rig.arms[0].rotation.z = damp(rig.arms[0].rotation.z, 0.42, dt, 13);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, 0.16, dt, 8);
    return;
  }

  const moving = a.speed > 0.05;
  const stride = Math.min(a.speed / 1.6, 2.3);
  a.phase += a.speed * dt * 2.9;
  const p = a.phase;

  const swing = Math.sin(p) * 0.55 * stride;

  // Knee flexion peaks just after toe-off, tucking the heel up behind the leg.
  // A positive hip angle swings the leg forward, a negative knee angle folds it
  // backwards — the old cycle had this reversed, which read as walking backwards.
  const flexAt = (phase) =>
    Math.pow(Math.max(0, -Math.sin(phase - Math.PI / 8)), 2) * 1.4 * Math.min(stride, 1.7);
  const flexA = moving ? flexAt(p) : 0;
  const flexB = moving ? flexAt(p + Math.PI) : 0;

  const crouchHip = a.crouch * 0.78;
  const crouchKnee = a.crouch * 1.85;

  rig.legs[0].hip.rotation.x = swing + crouchHip;
  rig.legs[1].hip.rotation.x = -swing + crouchHip;
  rig.legs[0].knee.rotation.x = -flexA - crouchKnee;
  rig.legs[1].knee.rotation.x = -flexB - crouchKnee;
  rig.legs[0].ankle.rotation.x = flexA * 0.42 + a.crouch * 0.55;
  rig.legs[1].ankle.rotation.x = flexB * 0.42 + a.crouch * 0.55;
  rig.legs[0].hip.rotation.z = damp(rig.legs[0].hip.rotation.z, a.crouch * 0.12, dt, 8);
  rig.legs[1].hip.rotation.z = damp(rig.legs[1].hip.rotation.z, -a.crouch * 0.12, dt, 8);

  const bob = moving ? Math.abs(Math.sin(p * 2)) * 0.028 * Math.min(stride, 1.5) : 0;
  const hipY = HIP_HEIGHT - a.crouch * 0.34 - bob;
  rig.hips.position.y = damp(rig.hips.position.y, hipY, dt, 14);

  const armSwing = swing * 0.85;
  rig.arms[0].rotation.x = -armSwing - 0.04 + a.crouch * 0.32;
  rig.arms[1].rotation.x = armSwing - 0.04 + a.crouch * 0.32;
  rig.arms[0].rotation.z = 0.09 + a.crouch * 0.14;
  rig.arms[1].rotation.z = -0.09 - a.crouch * 0.14;
  rig.hands[0].rotation.x = moving ? 0.16 + Math.max(0, -Math.sin(p)) * 0.45 : 0.12;
  rig.hands[1].rotation.x = moving ? 0.16 + Math.max(0, Math.sin(p)) * 0.45 : 0.12;

  // Lean into the run, counter-rotate the torso, keep the idle pose alive.
  a.lean = damp(a.lean, Math.min(a.speed / 8, 1) * 0.14 + a.crouch * 0.2, dt, 6);
  rig.torso.rotation.x = a.lean;
  rig.torso.rotation.y = moving ? Math.sin(p) * 0.06 * Math.min(stride, 1.4) : 0;
  rig.torso.rotation.z = moving
    ? Math.sin(p) * 0.04
    : Math.sin(performance.now() * 0.0012) * 0.012;
  rig.head.rotation.x = -a.lean * 0.5;
  rig.head.rotation.y = -rig.torso.rotation.y * 0.7;
  rig.head.rotation.z = moving ? Math.sin(p) * 0.035 : 0;
}
