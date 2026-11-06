/** Updates the overlay with the live controller values. */
export class Hud {
  constructor() {
    this.speed = document.getElementById('speed-value');
    this.steering = document.getElementById('steer-value');
    this.torque = document.getElementById('torque-value');
    this.brake = document.getElementById('brake-value');
  }

  update(telemetry) {
    this.speed.textContent = String(telemetry.speed);
    this.steering.textContent = String(telemetry.steering);
    this.torque.textContent = String(telemetry.torque);
    this.brake.textContent = String(telemetry.brake);
  }
}
