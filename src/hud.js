/** Everything the player reads: speed, money, fuel, heat, prompts and panels. */
export class Hud {
  constructor(game) {
    this.game = game;
    this.speed = document.getElementById('speed-value');
    this.steering = document.getElementById('steer-value');
    this.torque = document.getElementById('torque-value');
    this.brake = document.getElementById('brake-value');
    this.gear = document.getElementById('gear-value');
    this.vehicleLine = document.getElementById('vehicle-line');

    this.cash = document.getElementById('cash');
    this.clock = document.getElementById('clock');
    this.healthFill = document.getElementById('health-fill');
    this.fuelFill = document.getElementById('fuel-fill');
    this.fuelText = document.getElementById('fuel-text');
    this.priceText = document.getElementById('price-text');
    this.wantedEl = document.getElementById('wanted');
    this.promptEl = document.getElementById('prompt');
    this.objectiveEl = document.getElementById('objective');
    this.toastsEl = document.getElementById('toasts');
    this.weaponName = document.getElementById('weapon-name');
    this.weaponAmmo = document.getElementById('weapon-ammo');

    this.shopEl = document.getElementById('shop');
    this.shopItems = document.getElementById('shop-items');
    this.wheelEl = document.getElementById('weapon-wheel');
    this.wheelRing = document.getElementById('wheel-ring');
    this.jailEl = document.getElementById('jail');
    this.jailTimer = document.getElementById('jail-timer');
    this.shopOpen = false;
    this.wheelIndex = 0;
    this.wheelList = [];

    game.on('notify', ({ text, kind }) => this.toast(text, kind));
  }

  update({ telemetry, fuel, capacity, price = null, clock = '', wanted = 0, prompt = '', objective = '', vehicle = 'car' }) {
    if (telemetry) {
      this.speed.textContent = String(telemetry.mph ?? telemetry.speed ?? 0);
      this.steering.textContent = String(telemetry.steering ?? 0);
      this.torque.textContent = String(telemetry.torque ?? 0);
      this.brake.textContent = String(telemetry.brake ?? 0);
      this.gear.textContent = String(telemetry.gear ?? 1);
    }
    this.vehicleLine.textContent =
      vehicle === 'bike' ? 'Race bike · 6-speed' : vehicle === 'foot' ? 'On foot · Alt to enter a car' : 'Automatic 6-speed · rear-wheel drive';

    this.cash.textContent = `$${Math.round(this.game.money)}`;
    this.clock.textContent = clock;
    this.healthFill.style.width = `${Math.max(0, (this.game.health / this.game.maxHealth) * 100)}%`;
    this.fuelFill.style.width = `${Math.max(0, (this.game.fuel / capacity) * 100)}%`;
    this.fuelText.textContent = `Fuel ${this.game.fuel.toFixed(1)} L`;
    this.priceText.textContent = price === null ? '' : `$${price.toFixed(2)}/L`;
    this.wantedEl.textContent = wanted > 0 ? '★'.repeat(wanted) : '';

    this.promptEl.textContent = prompt;
    this.promptEl.classList.toggle('visible', Boolean(prompt));

    this.objectiveEl.textContent = objective;
    this.objectiveEl.classList.toggle('visible', Boolean(objective));
  }

  setWeapon(name, ammo) {
    this.weaponName.textContent = name;
    this.weaponAmmo.textContent = ammo;
  }

  toast(text, kind = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    this.toastsEl.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 0.25s ease';
      setTimeout(() => node.remove(), 260);
    }, 2600);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
  }

  // --- shop ---------------------------------------------------------------
  showShop(items, onBuy, ctx) {
    this.shopItems.innerHTML = '';
    for (const item of items) {
      const button = document.createElement('button');
      const owned = item.kind === 'weapon' && this.game.ownedGuns[item.weapon];
      button.className = `shop-item${owned ? ' owned' : ''}`;
      button.innerHTML = `<span>${item.name}</span><span class="price">$${item.price}</span>`;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onBuy(item, ctx);
        if (this.shopOpen) this.showShop(items, onBuy, ctx);
      });
      this.shopItems.appendChild(button);
    }
    this.shopEl.classList.remove('hidden');
    this.shopOpen = true;
  }

  hideShop() {
    this.shopEl.classList.add('hidden');
    this.shopOpen = false;
  }

  // --- weapon wheel -------------------------------------------------------
  showWheel(list, activeIndex = 0) {
    this.wheelList = list;
    this.wheelIndex = activeIndex;
    this.wheelRing.innerHTML = '';
    const count = Math.max(1, list.length);
    list.forEach((entry, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = entry.name;
      item.style.left = `${160 + Math.cos(angle) * 118}px`;
      item.style.top = `${160 + Math.sin(angle) * 118}px`;
      this.wheelRing.appendChild(item);
    });
    this.highlightWheel();
    this.wheelEl.classList.remove('hidden');
  }

  get wheelOpen() {
    return !this.wheelEl.classList.contains('hidden');
  }

  highlightWheel() {
    [...this.wheelRing.children].forEach((node, index) => {
      node.classList.toggle('active', index === this.wheelIndex);
    });
  }

  pointerWheel(clientX, clientY) {
    if (!this.wheelOpen || this.wheelList.length === 0) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2;
    const wrapped = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.wheelIndex = Math.round((wrapped / (Math.PI * 2)) * this.wheelList.length) % this.wheelList.length;
    this.highlightWheel();
  }

  hideWheel() {
    this.wheelEl.classList.add('hidden');
  }

  // --- jail ---------------------------------------------------------------
  showJail(seconds) {
    this.jailEl.classList.remove('hidden');
    this.jailTimer.textContent = String(Math.ceil(seconds));
  }

  tickJail(seconds) {
    if (this.jailEl.classList.contains('hidden')) return;
    this.jailTimer.textContent = String(Math.max(0, Math.ceil(seconds)));
  }

  hideJail() {
    this.jailEl.classList.add('hidden');
  }
}
