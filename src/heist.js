import { el, actionButton } from './venue.js';

/**
 * Vault cracking.
 *
 * Three (or more) tumblers, each a dial sweeping back and forth. Press Lock
 * while the marker sits inside the narrow green band to set it; the next tumbler
 * is faster and the band tighter. One miss trips the alarm and the job is blown.
 */
export class VaultCrack {
  constructor(panel, { game = null, audio = null } = {}) {
    this.panel = panel;
    this.game = game;
    this.audio = audio;
    this.active = false;
    this.finished = false;
    this.raf = 0;
    this.onKey = (event) => {
      if (!this.active || event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      this.attempt();
    };
  }

  start(title, options = {}) {
    const {
      locks = 3,
      windowSize = 0.12,
      speed = 0.62,
      blurb = 'Stop every tumbler inside the green band. One miss trips the alarm.',
      onSuccess = () => {},
      onFail = () => {},
    } = options;

    this.active = true;
    this.finished = false;
    this.locks = locks;
    this.lock = 0;
    this.windowSize = windowSize;
    this.speed = speed;
    this.onSuccess = onSuccess;
    this.onFail = onFail;
    this.value = Math.random();
    this.direction = 1;
    this.target = this.rollTarget();

    this.panel.show(title, '<kbd>Space</kbd> to lock a tumbler');
    this.panel.onClose = () => this.stop();

    const body = this.panel.clear();
    body.appendChild(el('p', 'venue-blurb', blurb));
    this.counter = el('div', 'venue-stat');
    body.appendChild(this.counter);

    this.track = el('div', 'heist-track');
    this.zone = el('div', 'heist-zone');
    this.marker = el('div', 'heist-marker');
    this.track.append(this.zone, this.marker);
    body.appendChild(this.track);

    this.result = el('div', 'venue-result');
    body.appendChild(this.result);

    this.lockButton = actionButton('Lock tumbler', () => this.attempt(), {
      className: 'venue-button',
    });
    body.appendChild(this.lockButton);

    this.paint();
    window.addEventListener('keydown', this.onKey);
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.loop(now));
  }

  rollTarget() {
    const span = Math.max(0.05, 1 - this.windowSize - 0.08);
    return 0.04 + Math.random() * span;
  }

  paint() {
    this.zone.style.left = `${this.target * 100}%`;
    this.zone.style.width = `${this.windowSize * 100}%`;
    this.marker.style.left = `${this.value * 100}%`;
    this.counter.textContent = `Tumbler ${Math.min(this.lock + 1, this.locks)} of ${this.locks}`;
  }

  loop(now) {
    if (!this.active || this.finished) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.value += this.direction * this.speed * dt;
    if (this.value >= 1) {
      this.value = 1;
      this.direction = -1;
    } else if (this.value <= 0) {
      this.value = 0;
      this.direction = 1;
    }
    this.marker.style.left = `${this.value * 100}%`;
    this.raf = requestAnimationFrame((next) => this.loop(next));
  }

  attempt() {
    if (!this.active || this.finished) return;
    const hit = this.value >= this.target && this.value <= this.target + this.windowSize;
    if (!hit) {
      this.finish(false);
      return;
    }

    this.audio?.burst({ freq: 640, type: 'square', duration: 0.06, gain: 0.14 });
    this.lock += 1;
    if (this.lock >= this.locks) {
      this.finish(true);
      return;
    }
    this.target = this.rollTarget();
    this.speed *= 1.16;
    this.windowSize = Math.max(0.06, this.windowSize * 0.9);
    this.paint();
  }

  finish(success) {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('keydown', this.onKey);

    if (success) {
      this.onSuccess();
    } else {
      this.onFail();
    }

    const body = this.panel.clear();
    body.appendChild(
      el(
        'p',
        `venue-result ${success ? 'good' : 'bad'}`,
        success ? 'The bolts slide back and the vault swings open.' : 'The tumbler slips — the alarm goes off.'
      )
    );
    body.appendChild(actionButton('Step away', () => this.panel.hide(), { className: 'venue-button' }));
  }

  stop() {
    this.active = false;
    this.finished = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('keydown', this.onKey);
  }
}
