/**
 * Browser port of the Unity `RealisticCarController` wheel-collider setup.
 *
 * Unity's WheelCollider becomes a cannon-es RaycastVehicle wheel: a raycast
 * suspension with per-wheel motor torque, brake torque, steering and a wheel
 * pose to copy onto a visual mesh. Every public tuning value below keeps the
 * script's name, unit and default (metres, Newton-metres, degrees), so the
 * dynamics read like the original file.
 */

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const DEG2RAD = Math.PI / 180;

// --- Chassis / wheel geometry (metres) -------------------------------------
const WHEEL_RADIUS = 0.36;
const WHEEL_WIDTH = 0.26;
const WHEEL_BASE_HALF = 1.32; // distance from the body centre to each axle
const TRACK_HALF = 0.86; // distance from the body centre to each wheel
const CONNECTION_Y = -0.12; // wheel connection point, in body space
const SUSPENSION_REST_LENGTH = 0.34;
const CHASSIS_HALF_EXTENTS = new CANNON.Vec3(0.8, 0.32, 1.95);
// Offsetting the collision box upwards puts the body origin — cannon's centre
// of mass — below the body's geometric centre, like the Unity script's
// `centerOfMass` transform.
const COM_LIFT = 0.18;

const SPAWN_POSITION = new CANNON.Vec3(0, 1.1, 8);

export class CarController {
  // --- Car physics (same names and units as the Unity script) --------------
  // Raised from the script's 30 for a sharper turn-in.
  maxSteerAngle = 45;
  motorForce = 1500;
  brakeForce = 3000;

  constructor(world, scene) {
    this.world = world;
    this.scene = scene;

    this.m_horizontalInput = 0;
    this.m_verticalInput = 0;
    this.m_steeringAngle = 0;
    this.currentBrakeForce = 0;
    this.keys = new Set();

    this.chassisBody = new CANNON.Body({ mass: 1200, linearDamping: 0.04 });
    this.chassisBody.addShape(
      new CANNON.Box(CHASSIS_HALF_EXTENTS),
      new CANNON.Vec3(0, COM_LIFT, 0)
    );
    this.chassisBody.angularDamping = 0.25;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    // Wheel order: front-left, front-right, rear-left, rear-right.
    const wheelTemplate = {
      radius: WHEEL_RADIUS,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      suspensionStiffness: 340,
      suspensionRestLength: SUSPENSION_REST_LENGTH,
      frictionSlip: 2.4,
      dampingRelaxation: 2.3,
      dampingCompression: 4.4,
      maxSuspensionForce: 200000,
      rollInfluence: 0.05,
      maxSuspensionTravel: 0.3,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    // The car's nose points down -Z, which is the direction a positive motor
    // force drives a cannon-es raycast vehicle.
    const wheelPositions = [
      { x: -TRACK_HALF, z: -WHEEL_BASE_HALF, isFrontWheel: true },
      { x: TRACK_HALF, z: -WHEEL_BASE_HALF, isFrontWheel: true },
      { x: -TRACK_HALF, z: WHEEL_BASE_HALF, isFrontWheel: false },
      { x: TRACK_HALF, z: WHEEL_BASE_HALF, isFrontWheel: false },
    ];

    for (const { x, z, isFrontWheel } of wheelPositions) {
      this.vehicle.addWheel({
        ...wheelTemplate,
        chassisConnectionPointLocal: new CANNON.Vec3(x, CONNECTION_Y, z),
        isFrontWheel,
      });
    }

    this.vehicle.addToWorld(world);
    this.reset();

    this.meshes = this.buildMeshes();
    scene.add(this.root);
    for (const wheel of this.wheelMeshes) scene.add(wheel);
  }

  // --- Visuals -------------------------------------------------------------
  buildMeshes() {
    this.root = new THREE.Group();

    const paint = new THREE.MeshStandardMaterial({
      color: '#e2553d',
      roughness: 0.32,
      metalness: 0.35,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: '#1b2027',
      roughness: 0.12,
      metalness: 0.6,
    });

    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = COM_LIFT;
    this.root.add(bodyGroup);

    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(
        CHASSIS_HALF_EXTENTS.x * 2,
        CHASSIS_HALF_EXTENTS.y * 2,
        CHASSIS_HALF_EXTENTS.z * 2
      ),
      paint
    );
    hull.castShadow = true;
    hull.receiveShadow = true;
    bodyGroup.add(hull);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.46, 1.7), glass);
    cabin.position.set(0, CHASSIS_HALF_EXTENTS.y + 0.2, -0.15);
    cabin.castShadow = true;
    bodyGroup.add(cabin);

    const lampMaterial = new THREE.MeshStandardMaterial({
      color: '#fff6d8',
      emissive: '#ffe9b0',
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    const tailMaterial = new THREE.MeshStandardMaterial({
      color: '#7c1a12',
      emissive: '#ff3b22',
      emissiveIntensity: 1.1,
      roughness: 0.5,
    });

    for (const x of [-0.52, 0.52]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.08), lampMaterial);
      lamp.position.set(x, 0.02, -CHASSIS_HALF_EXTENTS.z);
      bodyGroup.add(lamp);

      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.06), tailMaterial);
      tail.position.set(x, 0.04, CHASSIS_HALF_EXTENTS.z);
      bodyGroup.add(tail);
    }

    const tyreGeometry = new THREE.CylinderGeometry(
      WHEEL_RADIUS,
      WHEEL_RADIUS,
      WHEEL_WIDTH,
      22
    );
    tyreGeometry.rotateZ(Math.PI / 2); // align the cylinder axis with the wheel axle
    const tyreMaterial = new THREE.MeshStandardMaterial({
      color: '#14171b',
      roughness: 0.85,
    });
    const hubGeometry = new THREE.BoxGeometry(WHEEL_WIDTH + 0.02, 0.16, 0.16);
    hubGeometry.rotateY(Math.PI / 2);
    const hubMaterial = new THREE.MeshStandardMaterial({
      color: '#98a3b0',
      roughness: 0.35,
      metalness: 0.7,
    });

    this.wheelMeshes = this.vehicle.wheelInfos.map(() => {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tyreGeometry, tyreMaterial));
      wheel.add(new THREE.Mesh(hubGeometry, hubMaterial));
      wheel.children.forEach((child) => {
        child.castShadow = true;
      });
      return wheel;
    });

    return this.vehicle.wheelInfos;
  }

  // --- Input (Unity `GetInput`) --------------------------------------------
  attachInput() {
    const handled = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
    ]);

    window.addEventListener('keydown', (event) => {
      if (!handled.has(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      if (!handled.has(event.code)) return;
      event.preventDefault();
      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Mirrors `Input.GetAxis("Horizontal"/"Vertical")` for WASD and arrow keys. */
  getInput() {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');

    this.m_horizontalInput = (right ? 1 : 0) - (left ? 1 : 0);
    this.m_verticalInput = (forward ? 1 : 0) - (back ? 1 : 0);
  }

  /** Unity `HandleMotor`: torque on the rear wheels, handbrake on Space. */
  handleMotor() {
    // Unity applies torque in Nm; a raycast wheel wants the contact force, so
    // torque is divided by the wheel radius (F = τ / r).
    const engineForce = (this.m_verticalInput * this.motorForce) / WHEEL_RADIUS;
    this.vehicle.applyEngineForce(engineForce, 2);
    this.vehicle.applyEngineForce(engineForce, 3);

    this.currentBrakeForce = this.keys.has('Space') ? this.brakeForce : 0;
    this.applyBraking(this.currentBrakeForce);
  }

  applyBraking(force) {
    const brake = force / WHEEL_RADIUS;
    for (let i = 0; i < 4; i += 1) this.vehicle.setBrake(brake, i);
  }

  /** Unity `HandleSteering`: the front wheels only, with inverted input. */
  handleSteering() {
    // Inverted steering: A turns right, D turns left.
    this.m_steeringAngle = -this.maxSteerAngle * this.m_horizontalInput;
    const radians = this.m_steeringAngle * DEG2RAD;
    this.vehicle.setSteeringValue(radians, 0);
    this.vehicle.setSteeringValue(radians, 1);
  }

  /** One physics tick — corresponds to Unity's `FixedUpdate`. */
  fixedUpdate() {
    this.getInput();
    this.handleMotor();
    this.handleSteering();
  }

  /** Copy the physics pose onto the rendered meshes (`UpdateWheels`). */
  syncMeshes() {
    const { position, quaternion } = this.chassisBody;
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);

    this.vehicle.wheelInfos.forEach((wheel, index) => {
      this.vehicle.updateWheelTransform(index);
      const transform = wheel.worldTransform;
      this.wheelMeshes[index].position.copy(transform.position);
      this.wheelMeshes[index].quaternion.copy(transform.quaternion);
    });
  }

  reset() {
    this.chassisBody.position.copy(SPAWN_POSITION);
    this.chassisBody.quaternion.set(0, 0, 0, 1);
    this.chassisBody.velocity.setZero();
    this.chassisBody.angularVelocity.setZero();
    this.chassisBody.force.setZero();
    this.chassisBody.torque.setZero();
    this.keys.clear();
    this.m_horizontalInput = 0;
    this.m_verticalInput = 0;
    this.m_steeringAngle = 0;
    this.currentBrakeForce = 0;
    this.vehicle.applyEngineForce(0, 2);
    this.vehicle.applyEngineForce(0, 3);
    this.handleSteering();
    this.applyBraking(0);
  }

  get speedKmh() {
    return this.chassisBody.velocity.length() * 3.6;
  }

  get telemetry() {
    return {
      speed: Math.round(this.speedKmh),
      steering: Math.round(this.m_steeringAngle),
      torque: Math.round(this.m_verticalInput * this.motorForce),
      brake: Math.round(this.currentBrakeForce),
      onGround: this.vehicle.wheelInfos.some((wheel) => wheel.isInContact),
    };
  }
}
