# Car Controller — browser demo

A drivable port of the Unity `RealisticCarController` wheel-collider script, so the
handling model can be tried in a browser instead of the Unity editor.

## Run

```sh
npm install
npm run dev     # http://localhost:3000
```

## Controls

| Input | Effect |
| --- | --- |
| `W` / `↑` | Throttle (rear-wheel drive) |
| `S` / `↓` | Foot brake while rolling forward, reverse once stopped |
| `A` `D` / `←` `→` | Steering (front wheels only, inverted: `A` steers right) |
| `Space` | Handbrake — locks the rear axle |
| `C` | Camera: chase / driver's seat |
| `R` | Respawn on the straight |

## How the Unity script maps

| Unity | Here |
| --- | --- |
| `WheelCollider` | cannon-es `RaycastVehicle` wheel — raycast suspension with per-wheel motor, brake and steering |
| `rearLeftW.motorTorque` / `rearRightW.motorTorque` | `applyEngineForce` on the two rear wheels (`F = τ / r`) |
| `brakeTorque` | `setBrake` per axle, as a friction impulse (`F·dt`) |
| `frontLeftW.steerAngle` / `frontRightW.steerAngle` | `setSteeringValue` on the two front wheels |
| `rb.centerOfMass` | chassis collision box offset upwards, putting the body origin below the body's centre |
| `FixedUpdate` | fixed 1/60 s physics step |
| `GetWorldPose` in `UpdateWheelPos` | `updateWheelTransform` copied onto the wheel meshes |

`maxSteerAngle`, `motorForce` and `brakeForce` keep the script's names and units
(degrees, Nm) in `src/car.js`. Steering is inverted and `maxSteerAngle` is raised
from the script's 30° to 45° so the car turns in harder.

## Physics on top of the script

The script only ever applies motor torque and an all-wheel handbrake. These were
added for a car that behaves like a car:

- **Torque curve** — torque fades towards top speed, so it pulls hard off the line
  and runs out of puff around 200 km/h.
- **Drag and rolling resistance** — quadratic aero drag plus a constant rolling
  term, so lifting off coasts and settles instead of running forever.
- **Foot brake with front bias** — `S` brakes at 65 % front / 35 % rear, ramped in
  over 0.18 s, and clamped to about 1 g because the tyres cannot use more torque
  than that (100–0 km/h ≈ 38 m). It becomes reverse below 3 km/h.
- **Rear-only handbrake** — locks the rear axle, which rotates the car instead of
  stopping it in a straight line.
- **Engine braking** — a little rear brake torque off-throttle.
- **Speed-sensitive steering** — up to 55 % of the lock is given up by 130 km/h, so
  the car does not spin on a fast lane change.

Measured headlessly with `node` inside the container: 0–100 km/h in 4.6 s,
197 km/h top speed, 100–0 km/h in 2.7 s / 38 m.

## Files

- `src/car.js` — the controller: input, drivetrain, brakes, steering, wheel sync.
- `src/carModel.js` — the car: extruded body shell, greenhouse, lights, and the
  interior (dashboard, cluster, seats, console, steering wheel).
- `src/world.js` — physics world, ground, cones and crates.
- `src/hud.js` — live speed and torque readout.
- `src/main.js` — renderer, fixed-step loop, chase and cockpit cameras.

`window.carDemo.car` is exposed for tuning from the browser console.
