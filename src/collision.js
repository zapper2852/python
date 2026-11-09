import * as CANNON from 'cannon-es';

/**
 * Turns the city's box collider descriptions into static cannon bodies so the
 * car (and anything else physical) cannot drive through buildings, pumps,
 * street lamps, trees or parked cars.
 *
 * Each description is `{ size: [w, h, d], position: [x, y, z], rotationY }`
 * with the position at the centre of the box.
 */
export function createStaticColliders(world, colliders) {
  const bodies = [];

  for (const collider of colliders) {
    const [w, h, d] = collider.size;
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
    });
    body.position.set(...collider.position);
    if (collider.rotationY) {
      body.quaternion.setFromEuler(0, collider.rotationY, 0);
    }
    world.addBody(body);
    bodies.push(body);
  }

  return bodies;
}
