/**
 * Browser port of the Unity `RealisticCarController` wheel-collider setup.
 *
 * Unity's WheelCollider becomes a cannon-es RaycastVehicle wheel: a raycast
 * suspension with per-wheel motor torque, brake torque, steering and a wheel
 * pose to copy onto a visual mesh. The public tuning values keep the script's
 * names and units (metres, Newton-metres, degrees).
 *
 * On top of the script the drivetrain is now modelled properly: a six-speed
 * automatic with a real torque curve, a traction limit at the rear axle, a
 * brake torque budget clamped to the available tyre grip (so the wheels never
 * lock and launch the car), speed-sensitive steering with a realistic rack
 * rate, aerodynamic drag and a little downforce at speed.
 */

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel, createWheelMesh, wheelGeometry, groundOffsetY } from './carModel.js';
import { keys as sharedKeys } from './input.js';
import { gripAt } from './city.js';

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

const MASS = 1200;
const REAR_LOAD = 0.52; // share of the weight carried by the driven axle

// --- Drivetrain ------------------------------------------------------------
const PEAK_TORQUE = 292; // Nm at the crank
const GEARS = [3.62, 2.19, 1.5, 1.14, 0.9, 0.74];
const FINAL_DRIVE = 3.55;
const DRIVETRAIN_EFFICIENCY = 0.9;
const IDLE_RPM = 850;
const REDLINE_RPM = 6800;
const UPSHIFT_RPM = 6100;
const DOWNSHIFT_RPM = 1800;
const SHIFT_SECONDS = 0.34;
const REVERSE_SCALE = 0.55;

// --- Road behaviour --------------------------------------------------------
const DRAG = 0.42; // N per (m/s)²
const DOWNFORCE = 0.55; // N per (m/s)², presses the tyres down at speed
const ROLLING_RESISTANCE = 190; // N
const COAST_BRAKE_TORQUE = 260; // Nm of engine braking off-throttle

const FRONT_BRAKE_BIAS = 0.63;
const MAX_BRAKE_TORQUE = 3000; // Nm requested at full pedal
const GRIP_BRAKE_TORQUE = 1900; // Nm the tyres can actually use per axle
const BRAKE_RAMP_SECONDS = 0.1;

const BASE_FRICTION_FRONT = 3.05;
const BASE_FRICTION_REAR = 2.95;

const STEERING_FADE_KMH = 92;
const STEERING_FADE = 0.72;
const STEERING_RATE = 2.4; // rad/s of steering travel while turning in
const STEERING_RETURN_RATE = 3.4;
const STEERING_WHEEL_RATIO = 2.2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const tempForce = new CANNON.Vec3();
const tempForward = new CANNON.Vec3();

/** Normalised engine torque across the rev range. */
function torqueCurve(rpm) {
  const peakRpm = 4200;
  if (rpm <= peakRpm) {
    const t = (rpm - IDLE_RPM) / Math.max(1, peakRpm - IDLE_RPM);
    return 0.64 + 0.36 * Math.sin(clamp(t, 0, 1) * (Math.PI / 2));
  }
  const t = (rpm - peakRpm) / Math.max(1, REDLINE_RPM - peakRpm);
  return 1 - 0.2 * clamp(t, 0, 1) ** 2;
}

export class CarController {
  // --- Car physics (same names and units as the Unity script) --------------
  maxSteerAngle = 34;
  motorForce = 2100;
  brakeForce = 3000;

  constructor(world, scene) {
    this.world = world;
    this.scene = scene;

    this.m_horizontalInput = 0;
    this.m_verticalInput = 0;
    this.m_steeringAngle = 0; // radians
    this.currentBrakeForce = 0;
    this.currentEngineTorque = 0;
    this.brakeRamp = 0;
    this.controlEnabled = true;
    this.disabled = false;
    this.currentGrip = 1;
    this.gear = 1;
    this.shiftTimer = 0;
    this.shiftCut = 1;
    this.keys = sharedKeys;

    this.chassisBody = new CANNON.Body({ mass: MASS, linearDamping: 0.005 });
    this.chassisBody.addShape(
      new CANNON.Box(CHASSIS_HALF_EXTENTS),
      new CANNON.Vec3(0, COM_LIFT, 0)
    );
    this.chassisBody.angularDamping = 0.32;

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
      suspensionStiffness: 380,
      suspensionRestLength: SUSPENSION_REST_LENGTH,
      frictionSlip: BASE_FRICTION_FRONT,
      dampingRelaxation: 2.4,
      dampingCompression: 4.5,
      maxSuspensionForce: 200000,
      rollInfluence: 0.038,
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
        frictionSlip: isFrontWheel ? BASE_FRICTION_FRONT : BASE_FRICTION_REAR,
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
    this.keys = sharedKeys;
  }

  /** Stops the car taking keyboard input while the player is on foot. */
  setControlEnabled(enabled) {
    this.controlEnabled = enabled;
    if (!enabled) {
      this.m_horizontalInput = 0;
      this.m_verticalInput = 0;
      this.currentEngineTorque = 0;
      this.vehicle.applyEngineForce(0, 2);
      this.vehicle.applyEngineForce(0, 3);
    }
  }

  /** Mirrors `Input.GetAxis("Horizontal"/"Vertical")` for WASD and arrow keys. */
  getInput() {
    if (!this.controlEnabled || this.disabled) {
      this.m_horizontalInput = 0;
      this.m_verticalInput = 0;
      return;
    }
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');

    this.m_horizontalInput = (right ? 1 : 0) - (left ? 1 : 0);
    this.m_verticalInput = (forward ? 1 : 0) - (back ? 1 : 0);
  }

  /** Engine speed the current gear would turn at this road speed. */
  get engineRpm() {
    const speed = Math.abs(this.forwardSpeed);
    const ratio = GEARS[this.gear - 1];
    return clamp((speed / WHEEL_RADIUS) * ratio * FINAL_DRIVE * 9.5493, IDLE_RPM, REDLINE_RPM);
  }

  /** Automatic gear selection with a short torque cut while it shifts. */
  updateGearbox(delta, throttle, speed) {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= delta;
      this.shiftCut = 0.2;
      return;
    }
    this.shiftCut = 1;

    if (throttle > 0.1 && speed > -0.5) {
      const rpm = this.engineRpm;
      if (rpm > UPSHIFT_RPM && this.gear < GEARS.length) {
        this.gear += 1;
        this.shiftTimer = SHIFT_SECONDS;
      } else if (rpm < DOWNSHIFT_RPM && this.gear > 1) {
        this.gear -= 1;
        this.shiftTimer = SHIFT_SECONDS * 0.55;
      }
    } else if (this.gear > 1 && Math.abs(speed) < 0.6) {
      this.gear = 1;
    }
  }

  /** Tarmac, wet patches, gravel and potholes all get different tyre grip. */
  applySurfaceGrip() {
    const grip = gripAt(this.chassisBody.position.x, this.chassisBody.position.z);
    if (Math.abs(grip - this.currentGrip) < 0.001) return;
    this.currentGrip = grip;
    this.vehicle.wheelInfos.forEach((wheel, index) => {
      const base = index < 2 ? BASE_FRICTION_FRONT : BASE_FRICTION_REAR;
      wheel.frictionSlip = base * grip;
    });
  }

  /**
   * Unity `HandleMotor`, plus the parts of a real car it skips: a foot brake on
   * the down key while rolling forward, engine braking off-throttle, and a
   * handbrake that only locks the rear axle.
   */
  handleMotor(delta) {
    const input = this.m_verticalInput;
    const speed = this.forwardSpeed;

    let drive = 0;
    let brakePedal = 0;

    if (input > 0) {
      if (speed < -0.8) brakePedal = input;
      else drive = input;
    } else if (input < 0) {
      if (speed > 0.8) brakePedal = -input;
      else drive = input;
    }

    const handbrake = this.keys.has('Space');
    this.updateGearbox(delta, input, speed);

    // --- engine force at the rear axle ------------------------------------
    let crankTorque = 0;
    let force = 0;

    if (drive !== 0 && !handbrake) {
      const reversing = drive < 0;
      const ratio = reversing ? GEARS[0] : GEARS[this.gear - 1];
      const rpm = this.engineRpm;
      crankTorque = PEAK_TORQUE * torqueCurve(rpm) * this.shiftCut * Math.abs(drive);
      force = (crankTorque * ratio * FINAL_DRIVE * DRIVETRAIN_EFFICIENCY) / WHEEL_RADIUS;
      if (reversing) force *= -REVERSE_SCALE;
      force = clamp(force, -MASS * 9.81 * REAR_LOAD * this.currentGrip, MASS * 9.81 * REAR_LOAD * this.currentGrip);
    }

    this.currentEngineTorque = crankTorque;
    this.vehicle.applyEngineForce(force / 2, 2);
    this.vehicle.applyEngineForce(force / 2, 3);

    // --- brakes ------------------------------------------------------------
    const braking = brakePedal > 0 || handbrake;
    this.brakeRamp = braking ? Math.min(1, this.brakeRamp + delta / BRAKE_RAMP_SECONDS) : 0;

    const gripBudget = GRIP_BRAKE_TORQUE * this.currentGrip;
    let frontBrake = 0;
    let rearBrake = 0;

    if (handbrake) {
      rearBrake = gripBudget;
    } else if (brakePedal > 0) {
      // ABS: never ask the tyre for more torque than it can use.
      frontBrake = Math.min(brakePedal * MAX_BRAKE_TORQUE * FRONT_BRAKE_BIAS, gripBudget);
      rearBrake = Math.min(
        brakePedal * MAX_BRAKE_TORQUE * (1 - FRONT_BRAKE_BIAS),
        gripBudget * 0.8
      );
    }

    const ramp = this.brakeRamp;
    frontBrake *= ramp;
    rearBrake *= ramp;

    if (!braking && drive === 0 && this.speedKmh > 1) {
      rearBrake += COAST_BRAKE_TORQUE; // engine braking
    }

    this.currentBrakeForce = frontBrake + rearBrake;
    this.setAxleBrakes(frontBrake, rearBrake, delta);
  }

  setAxleBrakes(frontTorque, rearTorque, delta = 1 / 60) {
    // cannon's raycast wheel takes a friction impulse, not a force, so the
    // brake force at the contact patch (torque / radius) is scaled by the step.
    const front = ((frontTorque / WHEEL_RADIUS) * delta) / 2;
    const rear = ((rearTorque / WHEEL_RADIUS) * delta) / 2;
    this.vehicle.setBrake(front, 0);
    this.vehicle.setBrake(front, 1);
    this.vehicle.setBrake(rear, 2);
    this.vehicle.setBrake(rear, 3);
  }

  /**
   * Unity `HandleSteering`: front wheels only, inverted input, lock fading with
   * speed and a steering rack that takes time to move.
   */
  handleSteering(delta) {
    const authority = 1 - STEERING_FADE * Math.min(this.speedKmh / STEERING_FADE_KMH, 1);
    // Inverted steering: A turns right, D turns left.
    const target = -this.maxSteerAngle * DEG2RAD * authority * this.m_horizontalInput;

    const towardCentre =
      Math.abs(target) < Math.abs(this.m_steeringAngle) ||
      Math.sign(target) !== Math.sign(this.m_steeringAngle);
    const rate = towardCentre ? STEERING_RETURN_RATE : STEERING_RATE;
    const maxStep = rate * delta;
    const diff = target - this.m_steeringAngle;
    this.m_steeringAngle += clamp(diff, -maxStep, maxStep);

    this.vehicle.setSteeringValue(this.m_steeringAngle, 0);
    this.vehicle.setSteeringValue(this.m_steeringAngle, 1);
  }

  /** Aerodynamic drag, rolling resistance and downforce. */
  applyResistance() {
    const velocity = this.chassisBody.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);

    if (speed > 0.2) {
      const force = DRAG * speed * speed + ROLLING_RESISTANCE;
      tempForce.set((-force * velocity.x) / speed, 0, (-force * velocity.z) / speed);
      this.chassisBody.applyForce(tempForce);
    }

    const down = DOWNFORCE * speed * speed;
    if (down > 1) {
      tempForce.set(0, -down, 0);
      this.chassisBody.applyForce(tempForce);
    }
  }

  /** One physics tick — corresponds to Unity's `FixedUpdate`. */
  fixedUpdate(delta = 1 / 60) {
    this.getInput();
    this.applySurfaceGrip();
    this.handleMotor(delta);
    this.handleSteering(delta);
    this.applyResistance();
  }

  /** Copy the physics pose onto the rendered meshes (`UpdateWheels`). */
  syncMeshes() {
    const { position, quaternion } = this.chassisBody;
    this.chassisGroup.position.copy(position);
    this.chassisGroup.quaternion.copy(quaternion);

    this.model.steeringWheel.rotation.z =
      -this.m_steeringAngle * STEERING_WHEEL_RATIO;
    this.model.setBrakeLights(this.currentBrakeForce > 500);
    this.model.setDashboard(this.speedKmh);

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
    this.m_horizontalInput = 0;
    this.m_verticalInput = 0;
    this.m_steeringAngle = 0;
    this.currentBrakeForce = 0;
    this.currentEngineTorque = 0;
    this.brakeRamp = 0;
    this.gear = 1;
    this.shiftTimer = 0;
    this.shiftCut = 1;
    this.vehicle.applyEngineForce(0, 2);
    this.vehicle.applyEngineForce(0, 3);
    this.vehicle.setSteeringValue(0, 0);
    this.vehicle.setSteeringValue(0, 1);
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
      mph: Math.round(this.speedKmh * 0.621371),
      rpm: Math.round(this.engineRpm),
      steering: Math.round(this.m_steeringAngle / DEG2RAD),
      torque: Math.round(this.currentEngineTorque),
      brake: Math.round(this.currentBrakeForce),
      gear: this.gear,
    };
  }
}
