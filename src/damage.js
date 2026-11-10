import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * Progressive crash damage.
 *
 * Impacts are measured from the physics contact velocity, so a nudge at walking
 * pace costs nothing while a 60 mph hit destroys the car. Panels bend and drop
 * off, the shell crumples, smoke pours out — and past the breakdown threshold
 * the engine dies and the car cannot drive away.
 */

const BREAKDOWN_AT = 82;
const MAX_DAMAGE = 100;

export class VehicleDamage {
  constructor(car, { scene, world, audio, game, onBreakdown = null }) {
    this.car = car;
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.game = game;
    this.level = 0;
    this.broken = false;
    this.onBreakdown = onBreakdown;
    this.lastImpact = 0;
    this.detached = [];
    this.smoke = null;
    this.smokeAge = 0;
    this.crumpled = 0;

    car.chassisBody.addEventListener('collide', (event) => this.handleCollision(event));
  }

  handleCollision(event) {
    const contact = event.contact;
    if (!contact) return;
    const speed = Math.abs(contact.getImpactVelocityAlongNormal());
    if (speed < 3.1) return;
    this.lastImpact = speed;

    const damage = (speed - 3) * 1.35;
    this.applyDamage(damage, speed);
    this.audio?.crash(speed);

    // Hitting a police car is a crime; wrecking someone else's car draws
    // attention too. Kerbs and buildings do not.
    const other = event.body;
    if (other && other.userData && other.userData.police) {
      this.game.crime('police', 3);
    } else if (other && other.userData && other.userData.traffic && speed > 6) {
      this.game.crime('crash', 1);
    }
  }

  applyDamage(amount, impactSpeed = 0) {
    if (this.broken) return;
    this.level = Math.min(MAX_DAMAGE, this.level + amount);
    const model = this.car.model;

    // --- bumpers ---------------------------------------------------------
    if (this.level > 16 && model.bumpers?.front) {
      const bend = Math.min(1, (this.level - 16) / 40);
      model.bumpers.front.rotation.x = bend * 0.34;
      model.bumpers.front.position.y = -bend * 0.09;
    }
    if (this.level > 40 && model.bumpers?.rear) {
      const bend = Math.min(1, (this.level - 40) / 35);
      model.bumpers.rear.rotation.x = -bend * 0.28;
      model.bumpers.rear.position.y = -bend * 0.07;
    }

    // A hard enough hit tears the bumper off entirely.
    if (this.level > 52 && impactSpeed > 8 && model.bumpers?.front && !this.detached.includes('front')) {
      this.detachPanel(model.bumpers.front, 'front');
    }
    if (this.level > 74 && impactSpeed > 9 && model.bumpers?.rear && !this.detached.includes('rear')) {
      this.detachPanel(model.bumpers.rear, 'rear');
    }

    // --- body shell ------------------------------------------------------
    const crush = Math.max(0, (this.level - 25) / 75);
    if (crush > this.crumpled + 0.01) {
      this.crumpled = crush;
      this.crumpleShell(crush);
    }

    if (model.windshield) {
      model.windshield.material.opacity = Math.min(0.85, 0.22 + crush * 0.5);
      model.windshield.material.color.setHex(crush > 0.4 ? 0xb8c8d4 : 0x8fa8bd);
    }

    if (this.level > 55) this.emitSmoke();

    if (this.level >= BREAKDOWN_AT && !this.broken) {
      this.broken = true;
      this.car.disabled = true;
      this.car.setControlEnabled(false);
      this.game.notify('Engine destroyed — the car is dead', 'warn');
      this.onBreakdown?.();
    }
  }

  /** Deforms the body shell's vertices a little more with every big impact. */
  crumpleShell(crush) {
    const shell = this.car.model.shell;
    if (!shell) return;
    if (!shell.userData.original) {
      shell.userData.original = shell.geometry.attributes.position.array.slice();
    }
    const original = shell.userData.original;
    const position = shell.geometry.attributes.position;
    const amount = crush * crush * 0.16;
    const frontZ = original[2];
    for (let i = 0; i < position.count; i += 1) {
      const ox = original[i * 3];
      const oy = original[i * 3 + 1];
      const oz = original[i * 3 + 2];
      // Damage concentrates on the nose and the corners.
      const front = Math.max(0, -oz) / 2.1;
      const noise = Math.sin(ox * 21.7 + oy * 13.3 + oz * 8.1 + this.crumpled * 17) * 0.5 + 0.5;
      const squash = 1 - amount * (0.35 + front * 0.9) * noise;
      position.setXYZ(
        i,
        ox * (1 - amount * 0.5 * noise),
        oy * squash + amount * 0.12 * front,
        oz * (1 + amount * 0.25 * front)
      );
    }
    position.needsUpdate = true;
    shell.geometry.computeVertexNormals();
  }

  detachPanel(panel, key) {
    this.detached.push(key);
    const bounds = new THREE.Box3().setFromObject(panel);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const quat = new THREE.Quaternion();
    panel.getWorldQuaternion(quat);

    const material = panel.children[0]?.material || new THREE.MeshStandardMaterial({ color: '#14171b' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(center);
    mesh.quaternion.copy(quat);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 7,
      shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
      position: new CANNON.Vec3(center.x, center.y, center.z),
      linearDamping: 0.1,
      angularDamping: 0.2,
    });
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    const velocity = this.car.chassisBody.velocity;
    body.velocity.set(velocity.x * 0.75, 1.6, velocity.z * 0.75);
    body.angularVelocity.set(Math.random() * 4 - 2, Math.random() * 3, Math.random() * 4 - 2);
    this.world.addBody(body);
    this.detached.push({ mesh, body });
    panel.visible = false;
    this.audio?.crash(7);
  }

  emitSmoke() {
    if (this.smoke) return;
    const geometry = new THREE.BufferGeometry();
    const count = 40;
    const positions = new Float32Array(count * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#3a3f45',
      size: 1.5,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.smoke = new THREE.Points(geometry, material);
    this.scene.add(this.smoke);
  }

  update(dt) {
    // Keep detached panels moving with the physics world.
    for (const item of this.detached) {
      if (!item.mesh) continue;
      item.mesh.position.copy(item.body.position);
      item.mesh.quaternion.copy(item.body.quaternion);
    }

    if (this.smoke) {
      this.smokeAge += dt;
      const positions = this.smoke.geometry.attributes.position;
      const base = this.car.chassisGroup.position;
      for (let i = 0; i < positions.count; i += 1) {
        const t = ((this.smokeAge * 0.5 + i / positions.count) % 1);
        positions.setXYZ(
          i,
          base.x + Math.sin(i * 2.1 + this.smokeAge) * (0.3 + t * 1.1),
          base.y + 0.75 + t * 3.2,
          base.z + Math.cos(i * 1.7 + this.smokeAge) * (0.3 + t * 1.4)
        );
      }
      positions.needsUpdate = true;
      this.smoke.material.opacity = 0.5 * (1 - this.level / 140);
    }
  }

  repair() {
    this.level = 0;
    this.broken = false;
    this.crumpled = 0;
    this.car.disabled = false;
    const model = this.car.model;
    if (model.bumpers?.front) {
      model.bumpers.front.visible = true;
      model.bumpers.front.rotation.set(0, 0, 0);
      model.bumpers.front.position.set(0, 0, 0);
    }
    if (model.bumpers?.rear) {
      model.bumpers.rear.visible = true;
      model.bumpers.rear.rotation.set(0, 0, 0);
      model.bumpers.rear.position.set(0, 0, 0);
    }
    const shell = model.shell;
    if (shell?.userData.original) {
      shell.geometry.attributes.position.array.set(shell.userData.original);
      shell.geometry.attributes.position.needsUpdate = true;
      shell.geometry.computeVertexNormals();
    }
    if (this.smoke) {
      this.scene.remove(this.smoke);
      this.smoke = null;
    }
    for (const item of this.detached) {
      if (item.mesh) {
        this.scene.remove(item.mesh);
        this.world.removeBody(item.body);
      }
    }
    this.detached = [];
  }
}
