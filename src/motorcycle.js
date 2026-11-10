import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { keys as sharedKeys } from './input.js';
import { groundHeightAt } from './city.js';

const DEG2RAD = Math.PI / 180;
const MASS = 210;
const WHEEL_RADIUS = 0.33;
const MAX_STEER = 46 * DEG2RAD;
const TOP_SPEED = 74; // m/s ~ 165 mph

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function dashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext('2d'), texture };
}

function buildBikeModel() {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#1d6fd0', metalness: 0.6, roughness: 0.28 });
  const accent = new THREE.MeshStandardMaterial({ color: '#e8452f', metalness: 0.4, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#14171c', roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: '#a9b1ba', metalness: 0.95, roughness: 0.25 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#101214', roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({
    color: '#8fb6cf',
    metalness: 0.2,
    roughness: 0.05,
    transparent: true,
    opacity: 0.32,
  });

  const add = (material, size, position, rotation = null) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };

  // Fairing, tank, seat, tail — a compact sport-bike silhouette.
  add(paint, [0.34, 0.4, 0.62], [0, 0.72, -0.42], [0.24, 0, 0]);
  add(paint, [0.36, 0.22, 0.5], [0, 0.9, -0.08]);
  add(accent, [0.3, 0.16, 0.34], [0, 0.78, 0.2]);
  add(dark, [0.28, 0.1, 0.44], [0, 0.94, 0.42]);
  add(paint, [0.26, 0.2, 0.46], [0, 0.98, 0.72], [-0.16, 0, 0]);
  add(accent, [0.2, 0.1, 0.3], [0, 1.04, 0.86]);
  add(dark, [0.3, 0.3, 0.5], [0, 0.55, 0.24]);
  add(metal, [0.16, 0.16, 0.5], [0, 0.42, 0.55], [0.1, 0, 0]);
  add(metal, [0.1, 0.1, 0.25], [0.16, 0.34, 0.82]);
  add(dark, [0.2, 0.1, 0.24], [0, 1.14, -0.5]);
  // windscreen
  add(glass, [0.28, 0.22, 0.04], [0, 1.1, -0.72], [0.5, 0, 0]);
  // headlight
  add(new THREE.MeshStandardMaterial({ color: '#fff8e6', emissive: '#ffeec2', emissiveIntensity: 1.8 }),
    [0.2, 0.1, 0.06], [0, 0.86, -0.78]);
  // forks
  for (const side of [-1, 1]) {
    add(metal, [0.05, 0.5, 0.05], [side * 0.11, 0.6, -0.68], [0.22, 0, 0]);
    add(metal, [0.08, 0.08, 0.06], [side * 0.16, 1.0, -0.6]);
  }
  // handlebars + mirrors
  add(metal, [0.56, 0.04, 0.04], [0, 1.02, -0.52]);
  for (const side of [-1, 1]) {
    add(dark, [0.06, 0.06, 0.06], [side * 0.4, 1.05, -0.5]);
    add(dark, [0.1, 0.05, 0.05], [side * 0.5, 1.12, -0.56]);
  }
  // swingarm + chain
  add(metal, [0.06, 0.09, 0.62], [0, 0.42, 0.55]);

  // Dash cluster (canvas texture updated live).
  const dash = dashTexture();
  const dashMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.13),
    new THREE.MeshBasicMaterial({ map: dash.texture, transparent: true })
  );
  dashMesh.position.set(0, 1.06, -0.66);
  dashMesh.rotation.x = -0.5;
  root.add(dashMesh);

  root.traverse((node) => {
    if (node.isMesh) node.receiveShadow = true;
  });

  return { root, dash, accent, paint };
}

function buildBikeWheel(radius) {
  const group = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: '#101214', roughness: 0.95 });
  const rim = new THREE.MeshStandardMaterial({ color: '#20242b', metalness: 0.8, roughness: 0.35 });
  const disc = new THREE.MeshStandardMaterial({ color: '#8f979f', metalness: 0.9, roughness: 0.3 });

  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.055, 0.055, 10, 26), rubber);
  group.add(tyre);
  const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.1, radius - 0.1, 0.05, 20), rim);
  rimMesh.rotation.z = Math.PI / 2;
  group.add(rimMesh);
  for (let i = 0; i < 5; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, (radius - 0.1) * 2), rim);
    spoke.rotation.x = (i / 5) * Math.PI;
    group.add(spoke);
  }
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.015, 18), disc);
  rotor.rotation.z = Math.PI / 2;
  rotor.position.x = 0.05;
  group.add(rotor);

  group.traverse((node) => {
    if (node.isMesh) node.castShadow = true;
  });
  return group;
}

export class Motorcycle {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.keys = sharedKeys;
    this.controlEnabled = true;
    this.disabled = false;
    this.steer = 0;
    this.throttle = 0;
    this.gear = 1;
    this.rpm = 1400;
    this.speedKmh = 0;
    this.wheelie = 0;
    this.lean = 0;
    this.spawn = new CANNON.Vec3(-58, 1.0, 44);

    this.chassisBody = new CANNON.Body({ mass: MASS, linearDamping: 0.01 });
    this.chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.35, 0.95)), new CANNON.Vec3(0, 0.3, 0));
    this.chassisBody.angularDamping = 0.28;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    for (const z of [-0.72, 0.68]) {
      this.vehicle.addWheel({
        radius: WHEEL_RADIUS,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(0, -0.04, z),
        isFrontWheel: z < 0,
        suspensionStiffness: 720,
        suspensionRestLength: 0.24,
        maxSuspensionTravel: 0.2,
        maxSuspensionForce: 160000,
        dampingRelaxation: 2.6,
        dampingCompression: 5.2,
        frictionSlip: 5.2,
        rollInfluence: 0.02,
        customSlidingRotationalSpeed: -40,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    this.vehicle.addToWorld(world);

    this.chassisGroup = new THREE.Group();
    this.model = buildBikeModel();
    // The model is drawn with y = 0 on the road; the physics origin sits at
    // the body's centre of mass, roughly 0.58 m higher.
    this.model.root.position.y = -0.58;
    this.chassisGroup.add(this.model.root);
    scene.add(this.chassisGroup);

    this.wheels = this.vehicle.wheelInfos.map(() => {
      const wheel = buildBikeWheel(WHEEL_RADIUS);
      scene.add(wheel);
      return wheel;
    });

    this.seat = new THREE.Object3D();
    this.seat.position.set(0, 0.02, 0.2);
    this.model.root.add(this.seat);

    this.cockpitEye = new THREE.Vector3(0, 1.5, -0.32);
    this.parked = true;
    this.reset();
  }

  reset() {
    this.chassisBody.position.copy(this.spawn);
    this.chassisBody.quaternion.setFromEuler(0, Math.PI / 2, 0);
    this.chassisBody.velocity.setZero();
    this.chassisBody.angularVelocity.setZero();
    this.chassisBody.force.setZero();
    this.chassisBody.torque.setZero();
    this.steer = 0;
    this.throttle = 0;
    this.wheelie = 0;
    this.disabled = false;
    this.vehicle.applyEngineForce(0, 0);
    this.vehicle.setSteeringValue(0, 0);
    this.vehicle.setBrake(0, 0);
    this.vehicle.setBrake(0, 1);
  }

  setControlEnabled(enabled) {
    this.controlEnabled = enabled;
    if (!enabled) {
      this.vehicle.applyEngineForce(0, 1);
      this.vehicle.setBrake(2, 0);
      this.vehicle.setBrake(2, 1);
    }
  }

  get speedMph() {
    return Math.abs(this.forwardSpeed) * 2.2369;
  }

  get forwardSpeed() {
    const temp = new CANNON.Vec3(0, 0, -1);
    this.chassisBody.quaternion.vmult(temp, temp);
    return this.chassisBody.velocity.dot(temp);
  }

  fixedUpdate(dt) {
    if (!this.controlEnabled || this.disabled) {
      this.updateStability(dt);
      return;
    }

    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const brake = this.keys.has('Space');

    this.throttle = forward ? 1 : 0;
    const speed = this.forwardSpeed;

    // Inverted steering like the car, quick rack for a race bike.
    const fade = 1 - Math.min(1, Math.abs(speed) / 52) * 0.72;
    const target = -MAX_STEER * fade * ((right ? 1 : 0) - (left ? 1 : 0));
    const maxStep = 4.2 * dt;
    this.steer += clamp(target - this.steer, -maxStep, maxStep);
    this.vehicle.setSteeringValue(this.steer, 0);

    if (back && speed > 1.5) {
      this.vehicle.applyEngineForce(0, 1);
      this.vehicle.setBrake(2.0, 0);
      this.vehicle.setBrake(2.0, 1);
    } else {
      const power = this.throttle * 2600 * (1 - Math.abs(speed) / TOP_SPEED);
      const reverse = back ? -700 : 0;
      this.vehicle.applyEngineForce(power + reverse, 1);
      this.vehicle.setBrake(brake ? 0.6 : 0, 0);
      this.vehicle.setBrake(brake ? 0.6 : 0, 1);
    }

    this.speedKmh = Math.abs(this.forwardSpeed) * 3.6;
    this.gear = Math.max(1, Math.min(6, Math.floor(this.speedKmh / 30) + 1));
    this.rpm = clamp(1400 + (this.speedKmh / 60) * 12000 + this.throttle * 1200, 1200, 15000);

    // Wheelie: torque about the bike's right axis lifts the front wheel.
    if (brake && this.throttle > 0.5 && speed > 3) {
      this.wheelie = Math.min(1, this.wheelie + dt * 1.6);
    } else {
      this.wheelie = Math.max(0, this.wheelie - dt * 2.2);
    }
    if (this.wheelie > 0.05) {
      const rightAxis = new CANNON.Vec3(1, 0, 0);
      this.chassisBody.quaternion.vmult(rightAxis, rightAxis);
      this.chassisBody.angularVelocity.x -= rightAxis.x * this.wheelie * dt * 6;
      this.chassisBody.angularVelocity.z -= rightAxis.z * this.wheelie * dt * 6;
    }

    this.lean += (clamp(this.steer * Math.min(1, this.speedKmh / 45) * 1.4, -0.5, 0.5) - this.lean) * Math.min(1, dt * 5);

    this.updateStability(dt);
  }

  /** Keeps the bike upright — a two-wheel raycast vehicle has no self-righting. */
  updateStability(dt) {
    const up = new CANNON.Vec3(0, 1, 0);
    this.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), up);
    const torque = up.cross(new CANNON.Vec3(0, 1, 0));
    const k = MASS * 42;
    this.chassisBody.angularVelocity.x += torque.x * k * dt;
    this.chassisBody.angularVelocity.z += torque.z * k * dt;
    // Damp the roll a little so it does not wobble.
    const forward = new CANNON.Vec3(0, 0, -1);
    this.chassisBody.quaternion.vmult(forward, forward);
    const roll = this.chassisBody.angularVelocity.dot(forward);
    this.chassisBody.angularVelocity.vsub(forward.scale(roll * 0.06), this.chassisBody.angularVelocity);
  }

  syncMeshes() {
    this.chassisGroup.position.copy(this.chassisBody.position);
    this.chassisGroup.quaternion.copy(this.chassisBody.quaternion);
    this.model.root.rotation.z = -this.lean;
    this.model.root.rotation.x = this.wheelie * 0.32;

    this.vehicle.wheelInfos.forEach((wheel, index) => {
      this.vehicle.updateWheelTransform(index);
      const transform = wheel.worldTransform;
      this.wheels[index].position.copy(transform.position);
      this.wheels[index].quaternion.copy(transform.quaternion);
    });

    // Dashboard.
    const { ctx, canvas, texture } = this.model.dash;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8,12,18,0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#3ce0a0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(70, 70, 46, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1, this.speedMph / 170));
    ctx.stroke();
    ctx.fillStyle = '#eaf4ff';
    ctx.font = 'bold 42px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(this.speedMph)), 70, 84);
    ctx.font = '13px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#8fb2c8';
    ctx.fillText('MPH', 70, 104);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#ffb02e';
    ctx.fillText(`${this.gear}`, 170, 44);
    ctx.fillStyle = '#7fe1ff';
    ctx.fillRect(170, 58, Math.min(70, (this.rpm / 15000) * 70), 8);
    ctx.fillStyle = '#9fb6c8';
    ctx.font = '12px ui-sans-serif, sans-serif';
    ctx.fillText(`${Math.round(this.rpm / 100) / 10}k rpm`, 170, 84);
    this.model.dash.texture.needsUpdate = true;
  }

  /** Place the bike on a parking lot bay, upright and stationary. */
  parkAt(x, z, yaw = 0) {
    this.chassisBody.position.set(x, groundHeightAt(x, z) + 0.9, z);
    this.chassisBody.quaternion.setFromEuler(0, yaw, 0);
    this.chassisBody.velocity.setZero();
    this.chassisBody.angularVelocity.setZero();
    this.steer = 0;
    this.lean = 0;
    this.wheelie = 0;
  }

  get telemetry() {
    return {
      speed: Math.round(this.speedMph),
      rpm: Math.round(this.rpm),
      gear: this.gear,
      lean: this.lean,
    };
  }
}
