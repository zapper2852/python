import * as THREE from 'three';

/**
 * Weapons, ammunition and the held gun models.
 *
 * Each gun has a magazine and a reserve. Firing costs a round, the empty
 * magazine clicks, and reloading swaps in a fresh mag after a short animation
 * window (driven by the character rig).
 */

export const WEAPONS = {
  fist: {
    id: 'fist',
    name: 'Fists',
    melee: true,
    damage: 16,
    interval: 0.42,
    range: 2.1,
  },
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 26,
    interval: 0.24,
    mag: 15,
    reload: 1.9,
    range: 110,
    spread: 0.014,
    auto: false,
    price: 0,
  },
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    damage: 42,
    interval: 0.105,
    mag: 30,
    reload: 2.3,
    range: 230,
    spread: 0.022,
    auto: true,
    price: 850,
  },
};

const gunCache = new Map();

/** A compact, blocky gun pointing down -Z, sized for the character's hand. */
export function createWeaponMesh(id) {
  if (gunCache.has(id)) return gunCache.get(id).clone(true);
  const root = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1e23', roughness: 0.55, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: '#6d747d', roughness: 0.35, metalness: 0.9 });

  const add = (size, position, material = dark) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    root.add(mesh);
    return mesh;
  };

  if (id === 'rifle') {
    add([0.055, 0.075, 0.62], [0, 0, -0.16]);
    add([0.04, 0.04, 0.34], [0, 0.005, -0.55], steel);
    add([0.05, 0.16, 0.1], [0, -0.11, 0.05]);
    add([0.06, 0.09, 0.2], [0, -0.02, 0.2]);
    add([0.055, 0.055, 0.16], [0, 0.05, 0.06]);
    add([0.03, 0.06, 0.05], [0, 0.09, -0.36], steel);
  } else {
    add([0.05, 0.07, 0.26], [0, 0, -0.06]);
    add([0.036, 0.036, 0.12], [0, 0.012, -0.22], steel);
    add([0.045, 0.14, 0.075], [0, -0.09, 0.06]);
    add([0.03, 0.03, 0.03], [0, 0.045, 0.02], steel);
  }
  root.traverse((node) => {
    if (node.isMesh) node.castShadow = true;
  });
  gunCache.set(id, root.clone(true));
  return root;
}

export class Weapons {
  constructor(game, audio, scene) {
    this.game = game;
    this.audio = audio;
    this.scene = scene;
    this.currentId = 'fist';
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.tracers = [];
    this.muzzleFlash = null;
  }

  get def() {
    return WEAPONS[this.currentId];
  }

  get held() {
    return ['fist', ...this.game.inventory.filter((id) => WEAPONS[id] && id !== 'fist')];
  }

  select(id) {
    if (!WEAPONS[id] || !this.game.holdWeapon(id)) return false;
    if (this.currentId === id) return true;
    this.currentId = id;
    this.reloading = false;
    this.reloadTimer = 0;
    this.game.emit('weapon', { id });
    return true;
  }

  get ammoText() {
    const def = this.def;
    if (def.melee) return '—';
    const mag = this.game.mag[def.id] ?? 0;
    const reserve = this.game.reserve[def.id] ?? 0;
    return `${mag} / ${reserve}`;
  }

  get empty() {
    const def = this.def;
    return !def.melee && (this.game.mag[def.id] ?? 0) <= 0;
  }

  beginReload() {
    const def = this.def;
    if (def.melee || this.reloading) return false;
    if ((this.game.mag[def.id] ?? 0) >= def.mag) return false;
    if ((this.game.reserve[def.id] ?? 0) <= 0) {
      this.game.notify('No spare magazines', 'warn');
      return false;
    }
    this.reloading = true;
    this.reloadTimer = def.reload;
    this.game.emit('reloadStart', { duration: def.reload, weapon: def.id });
    return true;
  }

  /** Returns true when a round actually left the barrel. */
  tryFire(origin, direction, hitTest) {
    if (this.reloading) return null;
    const def = this.def;
    if (this.cooldown > 0) return null;
    this.cooldown = def.interval;

    if (def.melee) {
      this.audio.punch();
      const hit = hitTest(origin, direction, def.range);
      this.game.emit('punch', { hit });
      return { fired: true, hit };
    }

    if ((this.game.mag[def.id] ?? 0) <= 0) {
      this.audio.burst({ freq: 900, type: 'square', duration: 0.04, gain: 0.08 });
      return { fired: false, empty: true };
    }

    this.game.mag[def.id] -= 1;
    const dir = direction.clone();
    dir.x += (Math.random() - 0.5) * def.spread * 2;
    dir.y += (Math.random() - 0.5) * def.spread * 2;
    dir.z += (Math.random() - 0.5) * def.spread * 2;
    dir.normalize();

    const hit = hitTest(origin, dir, def.range);
    this.audio.gunshot(def.id);
    this.spawnTracer(origin, dir, hit ? hit.distance : def.range, def.id === 'rifle');
    this.game.emit('shot', { hit, weapon: def.id });
    return { fired: true, hit };
  }

  spawnTracer(origin, dir, distance, rifle) {
    const end = origin.clone().addScaledVector(dir, distance);
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const material = new THREE.LineBasicMaterial({
      color: rifle ? 0xfff0c0 : 0xffe08a,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });

    if (!this.muzzleFlash) {
      const light = new THREE.PointLight(0xffd27a, 0, 9);
      this.scene.add(light);
      this.muzzleFlash = light;
    }
    this.muzzleFlash.position.copy(origin);
    this.muzzleFlash.intensity = 5;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.09);
      if (tracer.life <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    if (this.muzzleFlash && this.muzzleFlash.intensity > 0) {
      this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 70);
    }

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const def = this.def;
        const missing = def.mag - (this.game.mag[def.id] ?? 0);
        const taken = Math.min(missing, this.game.reserve[def.id] ?? 0);
        this.game.mag[def.id] += taken;
        this.game.reserve[def.id] -= taken;
        this.reloading = false;
        this.game.emit('reloadEnd', { weapon: def.id });
      }
    }
  }
}
