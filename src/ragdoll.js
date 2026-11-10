import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * Physical ragdolls.
 *
 * A hit civilian is replaced by six connected bodies (torso, head, two arms,
 * two legs) joined with point-to-point constraints, so they flop, bounce and
 * settle on the tarmac instead of playing a canned death clip.
 */

const MAX_RAGDOLLS = 8;
const LIFETIME = 26; // seconds before the body is cleaned up

function boxMesh(size, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
  );
  mesh.castShadow = true;
  return mesh;
}

export class Ragdolls {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
  }

  get count() {
    return this.list.length;
  }

  spawn({ position, velocity = { x: 0, y: 0, z: 0 }, yaw = 0, colors = {} }) {
    const {
      skin = '#d9a684',
      shirt = '#2f6f9e',
      pants = '#2b303a',
      hair = '#241a12',
    } = colors;

    const bodies = [];
    const meshes = [];
    const constraints = [];

    const makeBody = (size, mass, offset, color, shapeType = 'box') => {
      const body = new CANNON.Body({
        mass,
        linearDamping: 0.04,
        angularDamping: 0.18,
      });
      body.addShape(
        shapeType === 'sphere'
          ? new CANNON.Sphere(size[0])
          : new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2))
      );
      const quat = new CANNON.Quaternion();
      quat.setFromEuler(0, yaw, 0);
      const worldOffset = new CANNON.Vec3(offset[0], offset[1], offset[2]);
      quat.vmult(worldOffset, worldOffset);
      body.position.set(position.x + worldOffset.x, position.y + worldOffset.y, position.z + worldOffset.z);
      body.quaternion.copy(quat);
      body.velocity.set(velocity.x, velocity.y, velocity.z);
      body.angularVelocity.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 6
      );
      this.world.addBody(body);
      bodies.push(body);

      const mesh =
        shapeType === 'sphere'
          ? new THREE.Mesh(
              new THREE.SphereGeometry(size[0], 12, 10),
              new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
            )
          : boxMesh(size, color);
      mesh.castShadow = true;
      this.scene.add(mesh);
      meshes.push(mesh);
      return body;
    };

    const torso = makeBody([0.42, 0.52, 0.26], 11, [0, 0, 0], shirt);
    const head = makeBody([0.115], 4, [0, 0.42, 0], skin, 'sphere');
    const armL = makeBody([0.12, 0.52, 0.14], 2.4, [-0.3, 0.08, 0], skin);
    const armR = makeBody([0.12, 0.52, 0.14], 2.4, [0.3, 0.08, 0], skin);
    const legL = makeBody([0.17, 0.86, 0.19], 4.2, [-0.12, -0.66, 0], pants);
    const legR = makeBody([0.17, 0.86, 0.19], 4.2, [0.12, -0.66, 0], pants);

    const joint = (body, pivotA, pivotB) => {
      const constraint = new CANNON.PointToPointConstraint(
        torso,
        new CANNON.Vec3(pivotA[0], pivotA[1], pivotA[2]),
        body,
        new CANNON.Vec3(pivotB[0], pivotB[1], pivotB[2])
      );
      this.world.addConstraint(constraint);
      constraints.push(constraint);
    };

    joint(head, [0, 0.26, 0], [0, -0.14, 0]);
    joint(armL, [-0.2, 0.2, 0], [0, 0.24, 0]);
    joint(armR, [0.2, 0.2, 0], [0, 0.24, 0]);
    joint(legL, [-0.11, -0.26, 0], [0, 0.4, 0]);
    joint(legR, [0.11, -0.26, 0], [0, 0.4, 0]);

    // Hair cap so the head still reads as a person.
    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.119, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshStandardMaterial({ color: hair, roughness: 0.95 })
    );
    hairMesh.position.y = 0.03;
    meshes[1].add(hairMesh);

    const ragdoll = {
      bodies,
      meshes,
      constraints,
      age: 0,
      synced: true,
    };
    this.list.push(ragdoll);
    if (this.list.length > MAX_RAGDOLLS) this.remove(this.list[0]);
    return ragdoll;
  }

  remove(ragdoll) {
    for (const body of ragdoll.bodies) this.world.removeBody(body);
    for (const constraint of ragdoll.constraints) this.world.removeConstraint(constraint);
    for (const mesh of ragdoll.meshes) this.scene.remove(mesh);
    const index = this.list.indexOf(ragdoll);
    if (index >= 0) this.list.splice(index, 1);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const ragdoll = this.list[i];
      ragdoll.age += dt;
      for (let b = 0; b < ragdoll.bodies.length; b += 1) {
        const body = ragdoll.bodies[b];
        const mesh = ragdoll.meshes[b];
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      }
      if (ragdoll.age > LIFETIME) {
        ragdoll.meshes.forEach((mesh) => {
          mesh.traverse((node) => {
            if (node.material) node.material.transparent = true;
            if (node.material) node.material.opacity = Math.max(0, 1 - (ragdoll.age - LIFETIME) / 2);
          });
        });
        if (ragdoll.age > LIFETIME + 2) this.remove(ragdoll);
      }
    }
  }
}
