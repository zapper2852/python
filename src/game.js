/**
 * Shared player state: money, health, fuel, wanted level, inventory.
 *
 * Everything the HUD draws lives here, so the HUD only ever polls one object
 * instead of chasing half a dozen modules.
 */

export const FUEL_CAPACITY = 55; // litres

export class Game {
  constructor() {
    this.money = 480;
    this.bank = 1200; // savings held at the bank
    this.maxHealth = 150;
    this.health = 150;
    this.wanted = 0; // 0..5 stars
    this.heat = 0; // seconds since the last crime
    this.fuel = 38; // litres in the tank
    this.inventory = ['pistol'];
    this.mag = { pistol: 15, rifle: 0, carbine: 0 };
    this.reserve = { pistol: 45, rifle: 0, carbine: 0 };
    this.jailed = false;
    this.ownedGuns = { pistol: 1 };
    this.listeners = new Set();
    this.notifications = [];
    this.stats = { crimes: 0, arrests: 0, civiliansDown: 0, jobsDone: 0 };
  }

  on(type, fn) {
    const entry = { type, fn };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  emit(type, detail = {}) {
    for (const entry of this.listeners) {
      if (entry.type === type) entry.fn(detail);
    }
  }

  notify(text, kind = 'info') {
    this.notifications.push({ text, kind, at: performance.now() });
    if (this.notifications.length > 4) this.notifications.shift();
    this.emit('notify', { text, kind });
  }

  spend(amount, reason = '') {
    if (this.money < amount) {
      this.notify('Not enough money', 'warn');
      return false;
    }
    this.money -= amount;
    this.emit('money', { amount: -amount, reason });
    return true;
  }

  earn(amount, reason = '') {
    this.money += amount;
    this.emit('money', { amount, reason });
    this.notify(`+$${Math.round(amount)} ${reason}`.trim(), 'good');
  }

  /** Moves cash off the street and into the bank account. */
  deposit(amount) {
    const value = Math.min(Math.max(0, Math.floor(amount)), Math.floor(this.money));
    if (value <= 0) {
      this.notify('No cash to deposit', 'warn');
      return 0;
    }
    this.money -= value;
    this.bank += value;
    this.emit('money', { amount: -value, reason: 'deposit' });
    this.notify(`Deposited $${value}`, 'good');
    return value;
  }

  /** Takes money back out of the bank account. */
  withdraw(amount) {
    const value = Math.min(Math.max(0, Math.floor(amount)), Math.floor(this.bank));
    if (value <= 0) {
      this.notify('Nothing left to withdraw', 'warn');
      return 0;
    }
    this.bank -= value;
    this.money += value;
    this.emit('money', { amount: value, reason: 'withdrawal' });
    this.notify(`Withdrew $${value}`, 'good');
    return value;
  }

  damage(amount) {
    if (this.jailed) return;
    this.health = Math.max(0, this.health - amount);
    this.emit('damage', { amount });
    if (this.health <= 0) this.emit('death');
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Raises the wanted level and restarts the cool-down clock. */
  crime(type, stars = 1) {
    if (this.jailed) return;
    this.heat = 0;
    this.stats.crimes += 1;
    if (stars > this.wanted) {
      this.wanted = Math.min(5, stars);
      const label = {
        speeding: 'Speeding',
        redlight: 'Ran a red light',
        crash: 'Reckless driving',
        police: 'Assaulting an officer',
        shooting: 'Shots fired',
        civilian: 'Civilian down',
        theft: 'Grand theft auto',
        robbery: 'Armed robbery',
      }[type] || 'Crime';
      this.notify(`Wanted: ${label}`, 'warn');
    }
    this.emit('crime', { type, stars });
  }

  clearWanted() {
    this.wanted = 0;
    this.heat = 0;
    this.emit('clearWanted');
  }

  holdWeapon(id) {
    return id === 'fist' || this.inventory.includes(id);
  }

  /** Consumes fuel, returns false when the tank has run dry. */
  useFuel(litres) {
    this.fuel = Math.max(0, this.fuel - litres);
    return this.fuel > 0;
  }

  refuel(litres, pricePerLitre) {
    const wanted = Math.min(litres, FUEL_CAPACITY - this.fuel);
    if (wanted <= 0.05) {
      this.notify('Tank is already full', 'info');
      return 0;
    }
    const cost = wanted * pricePerLitre;
    if (!this.spend(cost, 'fuel')) return 0;
    this.fuel += wanted;
    this.notify(`Refuelled ${wanted.toFixed(1)} L · $${cost.toFixed(2)}`, 'good');
    return wanted;
  }

  tickWanted(dt, { chased = false } = {}) {
    if (this.wanted <= 0) return;
    this.heat += dt;
    if (!chased && this.heat > 22) {
      this.heat = 0;
      this.wanted = Math.max(0, this.wanted - 1);
      if (this.wanted === 0) this.notify('You lost the police', 'good');
    }
  }
}
