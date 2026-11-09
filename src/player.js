import * as THREE from 'three';
import { createPerson, animatePerson } from './character.js';
import { groundHeightAt, CITY } from './city.js';

const WALK_SPEED = 1.85;
const SPRINT_SPEED = 6.6;
const CROUCH_SPEED = 1.05;

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.rig = createPerson({
      skin: '#d9a684',
      shirt: '#22405c',
      pants: '#2a3140',
      hair: '#1c1510',
      jacket: '#b8452f',
      shoes: '#f0f1f3',
    });
    this.group = this.rig.root;
    this.group.visible = false;
    scene.add(this.group);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.driving = true;
  }

  /** Sits the same figure in the driver's seat, parented to the chassis. */
  enterCar(car) {
    this.driving = true;
    this.velocity.set(0, 0, 0);
    this.group.scale.setScalar(0.75);
    this.group.position.set(0.35, -0.78, 0.15);
    this.group.rotation.set(0, 0, 0);
    car.chassisGroup.add(this.group);
    this.group.visible = true;
    this.rig.anim.speed = 0;
  }

  exitCar(car) {
    this.driving = false;
    this.group.scale.setScalar(1);
    this.group.removeFromParent();

    const quaternion = car.chassisGroup.quaternion;
    const spot = new THREE.Vector3(1.6, 0, 0.15).applyQuaternion(quaternion);
    spot.add(car.chassisGroup.position);
    spot.y = groundHeightAt(spot.x, spot.z);

    this.scene.add(this.group);
    this.position.copy(spot);
    this.group.position.copy(spot);
    this.velocity.set(0, 0, 0);
    this.speed = 0;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    this.yaw = Math.atan2(-forward.x, -forward.z);
    this.group.rotation.set(0, this.yaw, 0);
    this.rig.anim.speed = 0;
    this.rig.anim.phase = 0;
    this.group.visible = true;
  }

  updateSeated(dt) {
    animatePerson(this.rig, { dt, seated: true });
  }

  updateOnFoot(dt, { forward = 0, right = 0, sprint = false, crouch = false, camYaw = 0 }) {
    const forwardVec = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const rightVec = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));

    const wish = new THREE.Vector3()
      .addScaledVector(forwardVec, forward)
      .addScaledVector(rightVec, right);
    const inputLength = Math.min(wish.length(), 1);
    if (inputLength > 0.001) wish.normalize();

    const topSpeed = crouch ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
    const desired = wish.multiplyScalar(topSpeed * inputLength);

    const rate = 1 - Math.exp(-12 * dt);
    this.velocity.lerp(desired, rate);
    if (this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0, 0);

    this.position.addScaledVector(this.velocity, dt);
    const limit = CITY.blocks * CITY.spacing + 60;
    this.position.x = Math.max(-limit, Math.min(limit, this.position.x));
    this.position.z = Math.max(-limit, Math.min(limit, this.position.z));

    this.speed = this.velocity.length();
    if (this.speed > 0.25) {
      const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 11);
    }

    const groundY = groundHeightAt(this.position.x, this.position.z);
    this.position.y += (groundY - this.position.y) * Math.min(1, dt * 14);

    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.yaw, 0);
    animatePerson(this.rig, { dt, speed: this.speed, crouch: crouch && this.speed > 0.2 });
  }
}
