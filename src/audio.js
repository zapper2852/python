/**
 * Tiny procedural audio kit — no sample files, everything is synthesised.
 *
 * The engine is two detuned saws through a low-pass filter whose cutoff and
 * gain follow rpm and throttle, so acceleration barks and lifting off settles
 * into a burble. Sirens, gunshots and crash impacts are short synth bursts.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.siren = null;
    this.sirenGain = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  // --- engine --------------------------------------------------------------
  startEngine() {
    if (this.engine || !this.ensure()) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 5;

    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    a.frequency.value = 55;
    b.frequency.value = 57;

    const drive = ctx.createGain();
    drive.gain.value = 0.5;
    a.connect(drive);
    b.connect(drive);
    drive.connect(filter);
    filter.connect(out);
    out.connect(this.master);
    a.start();
    b.start();

    // Exhaust noise layer.
    const length = ctx.sampleRate * 1.2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 180;
    noiseFilter.Q.value = 1.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start();

    this.engine = { out, filter, a, b, noiseGain, noiseFilter };
  }

  updateEngine({ rpm = 850, throttle = 0, speed = 0, running = true } = {}) {
    if (!this.engine) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freq = clamp(rpm / 26, 24, 260);
    const load = clamp(throttle, 0, 1);

    this.engine.a.frequency.setTargetAtTime(freq, t, 0.05);
    this.engine.b.frequency.setTargetAtTime(freq * 1.503, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(420 + load * 1500 + freq * 5, t, 0.08);
    this.engine.out.gain.setTargetAtTime(running ? 0.16 + load * 0.22 : 0, t, 0.09);
    this.engine.noiseGain.gain.setTargetAtTime(running ? 0.02 + load * 0.06 : 0, t, 0.1);
    this.engine.noiseFilter.frequency.setTargetAtTime(120 + speed * 6, t, 0.1);
  }

  stopEngine() {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.out.gain.setTargetAtTime(0, t, 0.1);
    this.engine.noiseGain.gain.setTargetAtTime(0, t, 0.1);
  }

  // --- one-shots -----------------------------------------------------------
  burst({ freq = 200, type = 'square', duration = 0.12, gain = 0.4, sweep = null }) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noiseBurst({ duration = 0.25, gain = 0.5, cut = 1200, q = 1 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cut;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.value = gain;
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t);
  }

  gunshot(kind = 'pistol') {
    this.noiseBurst({ duration: kind === 'rifle' ? 0.16 : 0.1, gain: 0.5, cut: kind === 'rifle' ? 2600 : 1800, q: 0.7 });
    this.burst({ freq: kind === 'rifle' ? 220 : 160, type: 'square', duration: 0.08, gain: 0.3, sweep: 60 });
  }

  crash(force = 1) {
    const gain = clamp(force / 12, 0.12, 0.8);
    this.noiseBurst({ duration: 0.3, gain, cut: 900 + Math.random() * 900, q: 0.8 });
    this.burst({ freq: 90, type: 'sawtooth', duration: 0.18, gain: gain * 0.6, sweep: 40 });
  }

  horn() {
    this.burst({ freq: 400, type: 'square', duration: 0.34, gain: 0.16 });
    this.burst({ freq: 505, type: 'square', duration: 0.34, gain: 0.12 });
  }

  punch() {
    this.noiseBurst({ duration: 0.09, gain: 0.35, cut: 380, q: 0.6 });
  }

  sirenStart() {
    if (this.siren || !this.ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.42;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    this.siren = { osc, lfo };
    this.sirenGain = gain;
  }

  /** 0..1 — the nearest siren gets louder, everything else fades out. */
  setSiren(level) {
    if (level > 0.01) this.sirenStart();
    if (!this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.1, this.ctx.currentTime, 0.15);
  }
}
