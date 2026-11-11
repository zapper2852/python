import * as THREE from 'three';
import { createPerson, animatePerson } from './character.js';
import { CasinoGames } from './gambling.js';
import { VaultCrack } from './heist.js';
import { CITY } from './city.js';

/**
 * The casino: a bodyguard on the vault, three playable tables and a robbery
 * that only works from inside the floor and only once the guard is down.
 */

const TABLE_LABEL = { blackjack: 'blackjack', roulette: 'roulette', poker: 'poker' };

export class Casino {
  constructor({ scene, game, audio, ragdolls, site, panel, weapons }) {
    this.scene = scene;
    this.game = game;
    this.audio = audio;
    this.ragdolls = ragdolls;
    this.site = site;
    this.weapons = weapons;
    this.games = new CasinoGames(game, audio, panel);
    this.heist = new VaultCrack(panel, { game, audio });
    this.cooldown = 0;
    this.guard = null;

    if (site) {
      this.guard = this.createGuard();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.7, 2.2, 32),
        new THREE.MeshBasicMaterial({
          color: '#ffcf5c',
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.entrance.x, CITY.curb + 0.09, site.entrance.z + 3.5);
      scene.add(ring);
      this.marker = ring;
    }
  }

  createGuard() {
    const rig = createPerson({
      skin: '#c08a63',
      shirt: '#0f1a2b',
      pants: '#141a24',
      hair: '#14100c',
      jacket: '#1b2a3f',
      shoes: '#0d0f12',
    });
    const spot = this.site.guard;
    rig.root.position.set(spot.x, CITY.curb, spot.z);
    rig.root.scale.setScalar(1.08);
    rig.root.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    this.scene.add(rig.root);
    return {
      rig,
      pos: new THREE.Vector3(spot.x, 0, spot.z),
      home: spot,
      yaw: 0,
      alive: true,
    };
  }

  get bodyguardPresent() {
    return Boolean(this.guard && this.guard.alive);
  }

  inside(position) {
    if (!this.site) return false;
    const box = this.site.interior;
    return position.x > box.x0 && position.x < box.x1 && position.z > box.z0 && position.z < box.z1;
  }

  /** What the player can do from where they stand, if anything. */
  prompt(position) {
    if (!this.site || !this.inside(position)) return null;

    for (const table of this.site.tables) {
      if (Math.hypot(position.x - table.x, position.z - table.z) < 4.2) {
        return {
          text: `E · Play ${TABLE_LABEL[table.kind]}`,
          run: () => this.games.open(table.kind),
        };
      }
    }

    const vault = this.site.vault;
    if (Math.hypot(position.x - vault.x, position.z - vault.z) < 5) {
      if (this.guard && this.guard.alive) {
        return { text: 'Vault · the bodyguard is watching it' };
      }
      if (this.cooldown > 0) {
        return { text: `Vault · alarm hot for ${Math.ceil(this.cooldown)}s` };
      }
      return { text: 'E · Crack the casino vault', run: () => this.startRobbery() };
    }
    return null;
  }

  armed() {
    return Boolean(this.weapons && this.weapons.currentId && this.weapons.currentId !== 'fist');
  }

  startRobbery() {
    if (this.guard && this.guard.alive) {
      this.game.notify('The bodyguard is standing on the vault', 'warn');
      return;
    }
    if (!this.armed()) {
      this.game.notify('You need a firearm for this', 'warn');
      return;
    }
    if (this.cooldown > 0) return;

    this.heist.start('Crack the casino vault', {
      locks: 4,
      windowSize: 0.1,
      speed: 0.72,
      blurb: 'Four tumblers, each faster than the last. One miss trips the alarm.',
      onSuccess: () => this.loot(),
      onFail: () => this.alarm(),
    });
  }

  loot() {
    const take = 4200 + Math.floor(Math.random() * 900);
    this.game.earn(take, 'casino vault');
    this.game.crime('robbery', 3);
    this.cooldown = 90;
    this.audio?.crash(9);
    this.game.notify('Casino cleaned out — the cameras saw everything', 'warn');
  }

  alarm() {
    this.game.crime('robbery', 2);
    this.cooldown = 45;
    this.audio?.burst({ freq: 900, type: 'square', duration: 0.5, gain: 0.28, sweep: 480 });
    this.game.notify('Alarm tripped — the vault locks down', 'warn');
  }

  downBodyguard() {
    const guard = this.guard;
    if (!guard || !guard.alive) return false;
    guard.alive = false;
    guard.rig.root.visible = false;
    this.ragdolls.spawn({
      position: { x: guard.pos.x, y: 1.1, z: guard.pos.z },
      velocity: { x: 0, y: -0.2, z: 0 },
      colors: { shirt: '#0f1a2b', pants: '#141a24', skin: '#c08a63' },
    });
    this.game.notify('Bodyguard down — the vault is unguarded', 'warn');
    return true;
  }

  update(dt, playerPosition) {
    if (!this.site) return;
    this.cooldown = Math.max(0, this.cooldown - dt);

    const guard = this.guard;
    if (!guard || !guard.alive) return;
    const dx = playerPosition.x - guard.pos.x;
    const dz = playerPosition.z - guard.pos.z;
    const distance = Math.hypot(dx, dz);
    const wanted = distance < 16 ? Math.atan2(-dx, -dz) : 0;
    let diff = wanted - guard.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    guard.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
    guard.rig.root.rotation.y = guard.yaw;
    animatePerson(guard.rig, { dt, speed: 0 });
  }
}
