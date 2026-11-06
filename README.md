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
| `S` / `↓` | Reverse |
| `A` `D` / `←` `→` | Steering (front wheels only) |
| `Space` | Handbrake — full brake torque on all four wheels |
| `R` | Respawn on the straight |

## How the Unity script maps

| Unity | Here |
| --- | --- |
| `WheelCollider` | cannon-es `RaycastVehicle` wheel — raycast suspension with per-wheel motor, brake and steering |
| `rearLeftW.motorTorque` / `rearRightW.motorTorque` | `applyEngineForce` on the two rear wheels (`F = τ / r`) |
| `brakeTorque` on all four wheels | `setBrake` on all four wheels |
| `frontLeftW.steerAngle` / `frontRightW.steerAngle` | `setSteeringValue` on the two front wheels |
| `rb.centerOfMass` | chassis collision box offset upwards, putting the body origin below the body's centre |
| `FixedUpdate` | fixed 1/60 s physics step |
| `GetWorldPose` in `UpdateWheelPos` | `updateWheelTransform` copied onto the wheel meshes |

`maxSteerAngle`, `motorForce` and `brakeForce` keep the script's names, units
(degrees, Nm) and defaults in `src/car.js`.

## Files

- `src/car.js` — the controller: input, motor, braking, steering, wheel sync.
- `src/world.js` — physics world, ground, cones and crates.
- `src/hud.js` — live speed and torque readout.
- `src/main.js` — renderer, fixed-step loop, chase camera.

`window.carDemo.car` is exposed for tuning from the browser console.
