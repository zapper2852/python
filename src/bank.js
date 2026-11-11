import * as THREE from 'three';
import { el, actionButton } from './venue.js';
import { VaultCrack } from './heist.js';
import { CITY } from './city.js';

/**
 * The bank: a teller for moving money in and out of a bank account, and a vault
 * on the east wall that can be cracked for cash at the price of a wanted level.
 */
export class Bank {
  constructor({ scene, game, site, panel, audio, weapons }) {
    this.scene = scene;
    this.game = game;
    this.site = site;
    this.panel = panel;
    this.audio = audio;
    this.weapons = weapons;
    this.heist = new VaultCrack(panel, { game, audio });
    this.cooldown = 0;

    if (site) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.7, 2.2, 32),
        new THREE.MeshBasicMaterial({
          color: '#7ec8ff',
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.entrance.x, CITY.curb + 0.09, site.entrance.z + 3.5);
      scene.add(ring);
      this.marker = ring;
    }
  }

  inside(position) {
    if (!this.site) return false;
    const box = this.site.interior;
    return position.x > box.x0 && position.x < box.x1 && position.z > box.z0 && position.z < box.z1;
  }

  prompt(position) {
    if (!this.site || !this.inside(position)) return null;

    const teller = this.site.teller;
    if (Math.hypot(position.x - teller.x, position.z - teller.z) < 4.6) {
      return { text: 'E · Use the bank teller', run: () => this.openTeller() };
    }

    const vault = this.site.vault;
    if (Math.hypot(position.x - vault.x, position.z - vault.z) < 5) {
      if (this.cooldown > 0) {
        return { text: `Bank vault · alarm hot for ${Math.ceil(this.cooldown)}s` };
      }
      return { text: 'E · Rob the bank vault', run: () => this.startRobbery() };
    }
    return null;
  }

  openTeller() {
    this.panel.show('Bank teller');
    this.panel.onClose = null;
    this.renderTeller();
  }

  renderTeller() {
    const body = this.panel.clear();

    const cash = el('div', 'venue-stat');
    cash.append(el('span', '', 'Cash on hand'), el('span', '', `$${Math.floor(this.game.money)}`));
    body.appendChild(cash);
    const account = el('div', 'venue-stat');
    account.append(el('span', '', 'Bank account'), el('span', '', `$${Math.floor(this.game.bank)}`));
    body.appendChild(account);

    body.appendChild(el('p', 'venue-label', 'Withdraw'));
    const withdraw = el('div', 'venue-row');
    for (const amount of [100, 500, 1000]) {
      withdraw.appendChild(
        actionButton(`$${amount}`, () => {
          this.game.withdraw(amount);
          this.renderTeller();
        }, { className: 'venue-button' })
      );
    }
    withdraw.appendChild(
      actionButton('Everything', () => {
        this.game.withdraw(this.game.bank);
        this.renderTeller();
      }, { className: 'venue-button' })
    );
    body.appendChild(withdraw);

    body.appendChild(el('p', 'venue-label', 'Deposit'));
    const deposit = el('div', 'venue-row');
    for (const amount of [100, 500, 1000]) {
      deposit.appendChild(
        actionButton(`$${amount}`, () => {
          this.game.deposit(amount);
          this.renderTeller();
        }, { className: 'venue-button' })
      );
    }
    deposit.appendChild(
      actionButton('Everything', () => {
        this.game.deposit(this.game.money);
        this.renderTeller();
      }, { className: 'venue-button' })
    );
    body.appendChild(deposit);
  }

  get armed() {
    return Boolean(this.weapons && this.weapons.currentId && this.weapons.currentId !== 'fist');
  }

  startRobbery() {
    if (this.cooldown > 0) return;
    if (!this.armed) {
      this.game.notify('The vault needs a little persuasion — bring a gun', 'warn');
      return;
    }
    this.heist.start('Drill the bank vault', {
      locks: 4,
      windowSize: 0.11,
      speed: 0.66,
      blurb: 'Four tumblers. Miss one and the silent alarm calls the precinct.',
      onSuccess: () => this.loot(),
      onFail: () => this.alarm(),
    });
  }

  loot() {
    const take = 2400 + Math.floor(Math.random() * 900);
    this.game.earn(take, 'bank vault');
    this.game.crime('robbery', 3);
    this.cooldown = 90;
    this.audio?.crash(9);
    this.game.notify('Bank vault emptied — the police are on their way', 'warn');
  }

  alarm() {
    this.game.crime('robbery', 2);
    this.cooldown = 45;
    this.audio?.burst({ freq: 820, type: 'square', duration: 0.5, gain: 0.26, sweep: 460 });
    this.game.notify('Silent alarm — the vault seals itself', 'warn');
  }

  update(dt) {
    if (!this.site) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
  }
}
