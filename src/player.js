import * as THREE from 'three';
import { createPerson, animatePerson } from './character.js';
import { groundHeightAt, CITY } from './city.js';
import { createWeaponMesh } from './weapons.js';

const WALK_SPEED = 1.85;
const SPRINT_SPEED = 6.6;
const CROUCH_SPEED = 1.05;

const CASUAL = { jacket: '#b8452f', shirt: '#22405c', pants: '#2a3140', shoes: '#f0f1f3' };
const BIKE_SUIT = { jacket: '#1b2029', shirt: '#171c24', pants: '#14181e', shoes: '#0d0f12' };

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.rig = createPerson({
      skin: '#d9a684',
      shirt: CASUAL.shirt,
      pants: CASUAL.pants,
      hair: '#1c1510',
      jacket: CASUAL.jacket,
      shoes: CASUAL.shoes,
    });
    this.group = this.rig.root;
    this.group.visible = false;
    scene.add(this.group);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.driving = true;
    this.mode = 'none';
    this.car = null;
    this.bike = null;
    this.firstPerson = false;
    this.cuffed = false;

    this.weaponId = null;
    this.weaponMesh = null;
    this.aiming = false;
    this.reloadTimer = 0;
    this.reloadTotal = 0;
    this.magDrop = null;
    this.punchTimer = 0;

    this.helmetOn = 0;
    this.helmetTarget = 0;
    this.entry = null;
    this.doorTimer = null;

    this.helmet = this.buildHelmet();
    this.barHelmet = this.buildHelmet(true);
    this.outfit = 'casual';
  }

  // --- wardrobe -------------------------------------------------------------
  buildHelmet(forBike = false) {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#1a1f27', roughness: 0.42, metalness: 0.25 })
    );
    shell.scale.set(1, 1.06, 1.08);
    shell.castShadow = true;
    group.add(shell);

    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.157, 16, 10, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.3, Math.PI * 0.34),
      new THREE.MeshStandardMaterial({
        color: '#20303c',
        metalness: 0.85,
        roughness: 0.08,
        transparent: true,
        opacity: 0.82,
      })
    );
    group.add(visor);

    // Stripes and a GoPro mount on the crown.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.02, 0.32),
      new THREE.MeshStandardMaterial({ color: '#e8452f', roughness: 0.5 })
    );
    stripe.position.y = 0.15;
    group.add(stripe);

    const gopro = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.045, 0.05),
      new THREE.MeshStandardMaterial({ color: '#0c0f13', roughness: 0.4, metalness: 0.5 })
    );
    gopro.position.set(0, 0.175, -0.01);
    group.add(gopro);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10),
      new THREE.MeshStandardMaterial({ color: '#1a3a52', metalness: 0.9, roughness: 0.1 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.175, -0.045);
    group.add(lens);
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.008, 0.006),
      new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 2 })
    );
    led.position.set(0.02, 0.19, -0.035);
    group.add(led);

    group.visible = false;
    group.userData.gopro = gopro;
    if (forBike) {
      group.scale.setScalar(1.05);
    } else {
      this.rig.head.add(group);
    }
    return group;
  }

  setOutfit(kind) {
    if (kind === this.outfit) return;
    this.outfit = kind;
    const palette = kind === 'bike' ? BIKE_SUIT : CASUAL;
    const m = this.rig.materials;
    m.jacket.color.set(palette.jacket);
    m.shirt.color.set(palette.shirt);
    m.pants.color.set(palette.pants);
    m.shoes.color.set(palette.shoes);
    m.hair.color.set(kind === 'bike' ? '#12100e' : '#1c1510');
  }

  // --- weapons / interaction ------------------------------------------------
  setWeapon(id) {
    if (this.weaponMesh) {
      this.weaponMesh.removeFromParent();
      this.weaponMesh = null;
    }
    this.weaponId = id;
    if (!id || id === 'fist') return;
    const mesh = createWeaponMesh(id);
    mesh.position.set(0, -0.02, 0.02);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.scale.setScalar(0.9);
    this.weaponMesh = mesh;
    this.rig.handMeshes[1].add(mesh);
  }

  setAiming(value) {
    this.aiming = value;
  }

  punch() {
    this.punchTimer = 0.34;
  }

  /**
   * Reload sequence: gun dips, spent magazine drops, left hand goes to the hip
   * for a fresh one and slides it home.
   */
  startReload(duration) {
    this.reloadTimer = duration;
    this.reloadTotal = duration;
    this.magDropped = false;
  }

  dropMagazine() {
    if (!this.weaponMesh) return;
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.13, 0.06),
      new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.6, roughness: 0.4 })
    );
    const world = new THREE.Vector3();
    this.weaponMesh.getWorldPosition(world);
    mag.position.copy(world);
    this.scene.add(mag);
    this.magDrop = { mesh: mag, life: 0.9, vy: 0 };
  }

  // --- vehicles -------------------------------------------------------------
  /**
   * Climb in: from wherever the character is standing, step to the open door,
   * fold into the seat, then shut the door behind them. Nothing snaps.
   */
  playEnterCar(car) {
    this.driving = true;
    this.mode = 'car';
    this.car = car;
    this.velocity.set(0, 0, 0);

    const worldStart = new THREE.Vector3();
    this.group.getWorldPosition(worldStart);
    this.group.removeFromParent();
    car.chassisGroup.add(this.group);

    // Car-local copy of the standing position, clamped to a couple of paces so
    // the entry reads as a step in rather than a skate across the street.
    const body = car.chassisBody;
    const inverse = new THREE.Quaternion(
      -body.quaternion.x,
      -body.quaternion.y,
      -body.quaternion.z,
      body.quaternion.w
    ).normalize();
    const start = worldStart
      .clone()
      .sub(new THREE.Vector3(body.position.x, body.position.y, body.position.z))
      .applyQuaternion(inverse);
    start.y = groundHeightAt(body.position.x, body.position.z) - body.position.y;
    const offset = new THREE.Vector2(start.x - 0.35, start.z - 0.15);
    if (offset.length() > 2.4) offset.setLength(2.4);
    start.set(0.35 + offset.x, start.y, 0.15 + offset.y);

    const seat = new THREE.Vector3(0.35, -0.78, 0.15);
    const door = new THREE.Vector3(1.5, start.y + (seat.y - start.y) * 0.4, 0.2);

    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.group.position.copy(start);
    this.group.rotation.set(0, Math.PI / 2, 0);

    this.rig.anim.speed = 0;
    car.model.setDoor(0);
    this.entry = { car, phase: 'approach', timer: 0.45, duration: 0.45, start, door, seat };
    this.setOutfit('casual');
    this.helmetTarget = 0;
  }

  exitCar(car) {
    this.driving = false;
    this.mode = 'none';
    this.group.removeFromParent();
    this.group.scale.setScalar(1);

    const quaternion = car.chassisGroup.quaternion;
    const spot = new THREE.Vector3(1.75, 0, 0.15).applyQuaternion(quaternion);
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

    // Swing the door shut behind us.
    car.model.setDoor(0.85);
    this.doorTimer = { car, timer: 0.5, from: 0.85 };
  }

  enterBike(bike) {
    this.mode = 'bike';
    this.bike = bike;
    this.driving = false;
    this.velocity.set(0, 0, 0);
    this.group.removeFromParent();
    bike.seat.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(0.82);
    this.group.visible = true;
    this.setOutfit('bike');
    this.helmetTarget = 1;
    this.helmetOn = 0;
    this.rig.anim.speed = 0;
  }

  exitBike(bike) {
    this.mode = 'none';
    this.helmetTarget = 0;
    this.group.removeFromParent();
    this.group.scale.setScalar(1);
    this.scene.add(this.group);

    const spot = new THREE.Vector3(1.2, 0, 0).applyQuaternion(bike.chassisGroup.quaternion);
    spot.add(bike.chassisGroup.position);
    spot.y = groundHeightAt(spot.x, spot.z);
    this.position.copy(spot);
    this.group.position.copy(spot);
    this.yaw = Math.atan2(-Math.cos(0), -Math.sin(0));
    this.group.rotation.set(0, this.yaw, 0);
    this.velocity.set(0, 0, 0);

    // Helmet comes off and sits on the bars.
    if (bike.model && !this.barHelmet.parent) {
      this.barHelmet.position.set(0, 1.14, -0.52);
      this.barHelmet.rotation.set(0.3, 0, 0);
      bike.model.root.add(this.barHelmet);
    }
    this.barHelmet.visible = true;
    setTimeout(() => this.setOutfit('casual'), 900);
  }

  /** Drop out of whatever we were riding without a positional hand-off. */
  detachVehicle() {
    this.group.removeFromParent();
    this.driving = false;
    this.mode = 'none';
    this.scene.add(this.group);
    this.group.visible = false;
  }

  teleportTo(x, z) {
    this.group.removeFromParent();
    this.scene.add(this.group);
    this.group.scale.setScalar(1);
    this.group.visible = true;
    this.position.set(x, groundHeightAt(x, z), z);
    this.group.position.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.mode = 'none';
    this.driving = false;
    this.helmetTarget = 0;
    this.setOutfit('casual');
  }

  setFirstPerson(value) {
    this.firstPerson = value;
    this.rig.head.visible = !value;
  }

  get helmetCameraWorld() {
    const target = new THREE.Vector3();
    this.rig.head.getWorldPosition(target);
    target.y += 0.24;
    return target;
  }

  get eyeWorld() {
    const target = new THREE.Vector3();
    this.rig.head.getWorldPosition(target);
    target.y += 0.04;
    return target;
  }

  // --- updates --------------------------------------------------------------
  updateSeated(dt, { driving = true } = {}) {
    const phase = this.entry ? this.entry.phase : 'seated';
    if (this.entry) this.updateEntry(dt);

    if (phase === 'approach') {
      // Walking up to the open door: let the walk cycle drive the legs.
      animatePerson(this.rig, { dt, speed: 1.15 });
    } else if (phase === 'enter') {
      // Legs fold into the seat while the body swings in through the door.
      animatePerson(this.rig, { dt, seated: true, driving: false });
    } else {
      animatePerson(this.rig, { dt, seated: true, driving });
    }
    this.applyWeaponPose(dt);
  }

  updateEntry(dt) {
    const entry = this.entry;
    const car = entry.car;
    entry.timer -= dt;
    const t = Math.min(1, 1 - Math.max(0, entry.timer) / entry.duration);
    const ease = t * t * (3 - 2 * t);

    if (entry.phase === 'approach') {
      car.model.setDoor(Math.min(1, t * 1.5));
      this.group.position.lerpVectors(entry.start, entry.door, ease);
      this.group.scale.setScalar(1 - t * 0.12);
      this.group.rotation.set(0, Math.PI / 2 - ease * 0.3, 0);
      if (entry.timer <= 0) {
        entry.phase = 'enter';
        entry.timer = 0.55;
        entry.duration = 0.55;
      }
      return;
    }

    if (entry.phase === 'enter') {
      car.model.setDoor(1);
      this.group.position.lerpVectors(entry.door, entry.seat, ease);
      this.group.scale.setScalar(0.88 - t * 0.13);
      this.group.rotation.set(
        -0.24 * Math.sin(ease * Math.PI),
        (1 - ease) * (Math.PI / 2 - 0.3),
        0
      );
      if (entry.timer <= 0) {
        entry.phase = 'settle';
        entry.timer = 0.34;
        entry.duration = 0.34;
        this.group.position.copy(entry.seat);
        this.group.rotation.set(0, 0, 0);
        this.group.scale.setScalar(0.75);
      }
      return;
    }

    // Settle into the seat and swing the door shut.
    car.model.setDoor(Math.max(0, entry.timer) / entry.duration);
    if (entry.timer <= 0) {
      car.model.setDoor(0);
      this.entry = null;
    }
  }

  updateRider(dt) {
    animatePerson(this.rig, { dt, riding: true });
    this.applyWeaponPose(dt);
    this.updateHelmet(dt);
  }

  updateOnFoot(dt, { forward = 0, right = 0, sprint = false, crouch = false, camYaw = 0 }) {
    const forwardVec = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const rightVec = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));

    const wish = new THREE.Vector3()
      .addScaledVector(forwardVec, forward)
      .addScaledVector(rightVec, right);
    const inputLength = Math.min(wish.length(), 1);
    if (inputLength > 0.001) wish.normalize();

    const topSpeed = this.cuffed ? 0 : crouch ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
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
    } else if (this.aiming) {
      // Face the look direction while shooting from a standstill.
      let diff = camYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 9);
    }

    const groundY = groundHeightAt(this.position.x, this.position.z);
    this.position.y += (groundY - this.position.y) * Math.min(1, dt * 14);

    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.yaw, 0);

    animatePerson(this.rig, {
      dt,
      speed: this.speed,
      crouch: crouch && this.speed > 0.2,
      aiming: this.aiming && this.weaponId && this.weaponId !== 'fist',
    });
    this.rig.head.visible = !this.firstPerson;
    this.applyWeaponPose(dt);
    this.updateHelmet(dt);
    this.updateExtras(dt);

    if (this.doorTimer) {
      this.doorTimer.timer -= dt;
      const t = Math.max(0, this.doorTimer.timer) / 0.5;
      this.doorTimer.car.model.setDoor(t * 0.85);
      if (this.doorTimer.timer <= 0) this.doorTimer = null;
    }
  }

  updateHelmet(dt) {
    const target = this.helmetTarget;
    const rate = this.mode === 'bike' ? 1.4 : 1.8;
    this.helmetOn += Math.sign(target - this.helmetOn) * Math.min(Math.abs(target - this.helmetOn), dt * rate);
    const t = this.helmetOn;

    this.helmet.visible = t > 0.02;
    this.helmet.scale.setScalar(0.8 + t * 0.22);
    this.helmet.position.set(
      (1 - t) * -0.3,
      (1 - t) * -0.8,
      (1 - t) * -0.22
    );
    this.helmet.rotation.set((1 - t) * 0.5, (1 - t) * -0.4, 0);
    if (this.barHelmet.parent && this.mode === 'bike') this.barHelmet.visible = false;
  }

  applyWeaponPose(dt) {
    // Punch overrides the arm pose briefly.
    if (this.punchTimer > 0) {
      this.punchTimer = Math.max(0, this.punchTimer - dt);
      const t = 1 - this.punchTimer / 0.34;
      const extend = Math.sin(Math.min(1, t * 1.6) * Math.PI);
      this.rig.arms[1].rotation.x = 1.1 + extend * 0.6;
      this.rig.hands[1].rotation.x = -extend * 0.1;
      this.rig.arms[1].rotation.z = -0.25;
      this.rig.torso.rotation.y = -0.22 * extend;
    }

    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const t = 1 - this.reloadTimer / Math.max(0.001, this.reloadTotal);
      // Gun dips, left hand works the magazine, then the slide.
      if (this.weaponMesh) {
        this.weaponMesh.rotation.x = -Math.PI / 2 + Math.sin(t * Math.PI) * 0.5;
        this.weaponMesh.position.y = -0.02 - Math.sin(t * Math.PI) * 0.06;
      }
      this.rig.arms[1].rotation.x = 1.42 - Math.sin(t * Math.PI) * 0.55;
      this.rig.arms[0].rotation.x = 1.32 - Math.sin(t * Math.PI) * 0.5;
      this.rig.hands[0].rotation.x = -0.52 - Math.sin(t * Math.PI * 2) * 0.6;
      this.rig.arms[0].rotation.z = 0.42 - Math.sin(t * Math.PI) * 0.2;

      if (!this.magDropped && t > 0.3) {
        this.magDropped = true;
        this.dropMagazine();
      }
      if (t > 0.92) {
        this.reloadTimer = 0;
        if (this.weaponMesh) {
          this.weaponMesh.rotation.x = -Math.PI / 2;
          this.weaponMesh.position.y = -0.02;
        }
      }
    }

    if (this.magDrop) {
      this.magDrop.life -= dt;
      this.magDrop.vy -= 9.81 * dt;
      this.magDrop.mesh.position.y += this.magDrop.vy * dt;
      this.magDrop.mesh.rotation.x += dt * 6;
      if (this.magDrop.mesh.position.y < groundHeightAt(this.magDrop.mesh.position.x, this.magDrop.mesh.position.z) + 0.05) {
        this.magDrop.mesh.position.y = groundHeightAt(this.magDrop.mesh.position.x, this.magDrop.mesh.position.z) + 0.05;
        this.magDrop.mesh.rotation.x = Math.PI / 2;
        this.magDrop.vy = 0;
      }
      if (this.magDrop.life <= 0) {
        this.scene.remove(this.magDrop.mesh);
        this.magDrop = null;
      }
    }
  }

  updateExtras() {
    // Handcuff pose while booked.
    if (this.cuffed) {
      this.rig.arms[0].rotation.x = 0.9;
      this.rig.arms[1].rotation.x = 0.9;
      this.rig.arms[0].rotation.z = 0.5;
      this.rig.arms[1].rotation.z = -0.5;
    }
    if (this.mode === 'bike') this.updateHelmet(0.016);
  }
}
