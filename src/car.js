/**
 * Browser port of the Unity `RealisticCarController` wheel-collider setup.
 *
 * Unity's WheelCollider becomes a cannon-es RaycastVehicle wheel: a raycast
 * suspension with per-wheel motor torque, brake torque, steering and a wheel
 * pose to copy onto a visual mesh. The public tuning values keep the script's
 * names and units (metres, Newton-metres, degrees).
 */

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel, createWheelMesh, wheelGeometry, groundOffsetY } from './carModel.js';

const DEG2RAD = Math.PI / 180;

// --- Chassis / wheel geometry (metres) -------------------------------------
const WHEEL_RADIUS = wheelGeometry.radius;
const CONNECTION_Y = -0.12; // wheel connection point, in body space
const SUSPENSION_REST_LENGTH = 0.34;
const CHASSIS_HALF_EXTENTS = new CANNON.Vec3(0.8, 0.32, 1.95);
// Offsetting the collision box upwards puts the body origin — cannon's centre
// of mass — below the body's centre, like the Unity script's `centerOfMass`.
const COM_LIFT = 0.18;
const SPAWN_POSITION = new CANNON.Vec3(0, 1.1, 8);

// --- Road behaviour --------------------------------------------------------
const TOP_SPEED_KMH = 200;
const TORQUE_FALLOFF = 0.77; // how much torque fades towards top speed
const DRAG = 0.42; // N per (m/s)²
const ROLLING_RESISTANCE = 160; // N
const COAST_BRAKE_TORQUE = 220; // Nm of engine braking off-throttle
const FRONT_BRAKE_BIAS = 0.65;
// The tyres can only use so much brake torque; asking for more just locks the
// wheels and upsets the car, so the request is clamped to roughly 1 g.
const GRIP_BRAKE_TORQUE = 1150;
const BRAKE_RAMP_SECONDS = 0.18;
const STEERING_FADE_KMH = 130;
const STEERING_FADE = 0.55; // share of lock given up at speed
const STEERING_WHEEL_RATIO = 2.2;

const tempForce = new CANNON.Vec3();
const tempForward = new CANNON.Vec3();

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
    this.currentEngineTorque = 0;
    this.brakeRamp = 0;
    this.keys = new Set();

    this.chassisBody = new CANNON.Body({ mass: 1200, linearDamping: 0.01 });
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
      { x: -wheelGeometry.trackHalf, z: -wheelGeometry.baseHalf, isFrontWheel: true },
      { x: wheelGeometry.trackHalf, z: -wheelGeometry.baseHalf, isFrontWheel: true },
      { x: -wheelGeometry.trackHalf, z: wheelGeometry.baseHalf, isFrontWheel: false },
      { x: wheelGeometry.trackHalf, z: wheelGeometry.baseHalf, isFrontWheel: false },
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

    // Rigid-body group holding the car-space model.
    this.chassisGroup = new THREE.Group();
    this.model = createCarModel();
    this.model.root.position.y = groundOffsetY;
    this.chassisGroup.add(this.model.root);
    scene.add(this.chassisGroup);

    this.wheelMeshes = this.vehicle.wheelInfos.map(() => {
      const wheel = createWheelMesh();
      scene.add(wheel);
      return wheel;
    });

    this.cockpitEye = this.model.driverEye
      .clone()
      .setY(this.model.driverEye.y + groundOffsetY);
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

  /** Torque available at the wheels, fading towards top speed. */
  engineTorque() {
    const ratio = Math.min(this.speedKmh / TOP_SPEED_KMH, 1);
    return this.motorForce * (1 - TORQUE_FALLOFF * ratio * ratio);
  }

  /**
   * Unity `HandleMotor`, plus the parts of a real car it skips: a foot brake on
   * the down key while rolling forward, engine braking off-throttle, and a
   * handbrake that only locks the rear axle.
   */
  handleMotor(delta) {
    let throttle = this.m_verticalInput;
    let footBrake = 0;

    if (throttle < 0 && this.forwardSpeedKmh > 3) {
      footBrake = this.brakeForce; // S brakes first, reverses once stopped
      throttle = 0;
    }

    const handbrake = this.keys.has('Space');
    const braking = footBrake > 0 || handbrake;
    this.brakeRamp = braking ? Math.min(1, this.brakeRamp + delta / BRAKE_RAMP_SECONDS) : 0;

    this.currentEngineTorque = throttle * this.engineTorque();
    const engineForce = this.currentEngineTorque / WHEEL_RADIUS;
    this.vehicle.applyEngineForce(engineForce, 2);
    this.vehicle.applyEngineForce(engineForce, 3);

    let frontBrake = Math.min(footBrake * FRONT_BRAKE_BIAS, GRIP_BRAKE_TORQUE);
    let rearBrake = Math.min(footBrake * (1 - FRONT_BRAKE_BIAS), GRIP_BRAKE_TORQUE);
    let ramp = this.brakeRamp;

    if (handbrake) {
      frontBrake = 0;
      rearBrake = GRIP_BRAKE_TORQUE; // rear axle locks
    } else if (throttle === 0 && footBrake === 0) {
      frontBrake = 0;
      rearBrake = this.speedKmh > 1 ? COAST_BRAKE_TORQUE : 0; // engine braking
      ramp = 1;
    }

    this.currentBrakeForce = rearBrake * ramp;
    this.setAxleBrakes(frontBrake * ramp, rearBrake * ramp, delta);
  }

  setAxleBrakes(frontTorque, rearTorque, delta = 1 / 60) {
    // cannon's raycast wheel takes a friction impulse, not a force, so the
    // brake force at the contact patch (torque / radius) is scaled by the step.
    const front = (frontTorque / WHEEL_RADIUS) * delta;
    const rear = (rearTorque / WHEEL_RADIUS) * delta;
    this.vehicle.setBrake(front, 0);
    this.vehicle.setBrake(front, 1);
    this.vehicle.setBrake(rear, 2);
    this.vehicle.setBrake(rear, 3);
  }

  /** Unity `HandleSteering`: front wheels only, inverted input, fading at speed. */
  handleSteering() {
    const authority = 1 - STEERING_FADE * Math.min(this.speedKmh / STEERING_FADE_KMH, 1);
    // Inverted steering: A turns right, D turns left.
    this.m_steeringAngle = -this.maxSteerAngle * authority * this.m_horizontalInput;

    const radians = this.m_steeringAngle * DEG2RAD;
    this.vehicle.setSteeringValue(radians, 0);
    this.vehicle.setSteeringValue(radians, 1);
  }

  /** Aerodynamic drag plus rolling resistance. */
  applyResistance() {
    const velocity = this.chassisBody.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.2) return;

    const force = DRAG * speed * speed + ROLLING_RESISTANCE;
    tempForce.set((-force * velocity.x) / speed, 0, (-force * velocity.z) / speed);
    this.chassisBody.applyForce(tempForce);
  }

  /** One physics tick — corresponds to Unity's `FixedUpdate`. */
  fixedUpdate(delta = 1 / 60) {
    this.getInput();
    this.handleMotor(delta);
    this.handleSteering();
    this.applyResistance();
  }

  /** Copy the physics pose onto the rendered meshes (`UpdateWheels`). */
  syncMeshes() {
    const { position, quaternion } = this.chassisBody;
    this.chassisGroup.position.copy(position);
    this.chassisGroup.quaternion.copy(quaternion);

    this.model.steeringWheel.rotation.z =
      -this.m_steeringAngle * DEG2RAD * STEERING_WHEEL_RATIO;
    this.model.setBrakeLights(this.currentBrakeForce > 500);

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
    this.currentEngineTorque = 0;
    this.brakeRamp = 0;
    this.vehicle.applyEngineForce(0, 2);
    this.vehicle.applyEngineForce(0, 3);
    this.handleSteering();
    this.setAxleBrakes(0, 0);
  }

  /** Signed speed along the car's nose (metres per second). */
  get forwardSpeed() {
    tempForward.set(0, 0, -1);
    this.chassisBody.quaternion.vmult(tempForward, tempForward);
    return this.chassisBody.velocity.dot(tempForward);
  }

  get forwardSpeedKmh() {
    return this.forwardSpeed * 3.6;
  }

  get speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  get telemetry() {
    return {
      speed: Math.round(this.speedKmh),
      steering: Math.round(this.m_steeringAngle),
      torque: Math.round(this.currentEngineTorque),
      brake: Math.round(this.currentBrakeForce),
    };
  }
}
