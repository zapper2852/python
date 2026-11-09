import { CITY, ROAD_LINES } from './city.js';

/** Metres from the centre of the map to its edge. */
const VIEW_RADIUS = 135;

const ACCENT = '#ff7a45';
const FUEL = '#3ddc84';

/**
 * Top-down canvas minimap. North is always up, the player sits in the middle,
 * gas stations are pinned to the edge when they fall outside the view so they
 * can never be lost.
 */
export class Minimap {
  constructor(canvas, { gasStations = [], info = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gasStations = gasStations;
    this.info = info;
    this.size = 200;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.size = Math.round(rect.width) || 200;
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update({ x, z, heading = 0, traffic = [] }) {
    const ctx = this.ctx;
    const size = this.size;
    const c = size / 2;
    const inner = size / 2 - 8;
    const scale = inner / VIEW_RADIUS;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0c1219';
    ctx.fillRect(0, 0, size, size);

    // Land patches between the roads.
    ctx.fillStyle = '#151d26';
    for (let i = -CITY.blocks; i < CITY.blocks; i += 1) {
      for (let j = -CITY.blocks; j < CITY.blocks; j += 1) {
        const x0 = c + (i * CITY.spacing + CITY.roadHalf - x) * scale;
        const z0 = c + (j * CITY.spacing + CITY.roadHalf - z) * scale;
        const w = (CITY.spacing - CITY.roadHalf * 2) * scale;
        ctx.fillRect(x0, z0, w, w);
      }
    }

    // Asphalt.
    ctx.strokeStyle = '#3c4755';
    ctx.lineWidth = Math.max(3, CITY.roadHalf * 2 * scale);
    for (const line of ROAD_LINES) {
      const sx = c + (line - x) * scale;
      if (sx > -20 && sx < size + 20) {
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, size);
        ctx.stroke();
      }
      const sz = c + (line - z) * scale;
      if (sz > -20 && sz < size + 20) {
        ctx.beginPath();
        ctx.moveTo(0, sz);
        ctx.lineTo(size, sz);
        ctx.stroke();
      }
    }

    // Centre-line dots so the map reads as roads rather than a grid.
    ctx.fillStyle = 'rgba(230,238,246,0.22)';
    for (const line of ROAD_LINES) {
      const sx = c + (line - x) * scale;
      if (sx > 0 && sx < size) {
        for (let sz = -CITY.blocks; sz <= CITY.blocks; sz += 1) {
          const py = c + (sz * CITY.spacing - z) * scale;
          if (py > 0 && py < size) ctx.fillRect(sx - 0.5, py, 1, 3);
        }
      }
      const sz = c + (line - z) * scale;
      if (sz > 0 && sz < size) {
        for (let sx = -CITY.blocks; sx <= CITY.blocks; sx += 1) {
          const px = c + (sx * CITY.spacing - x) * scale;
          if (px > 0 && px < size) ctx.fillRect(px, sz - 0.5, 3, 1);
        }
      }
    }

    // Traffic.
    ctx.fillStyle = 'rgba(210,222,235,0.78)';
    for (const vehicle of traffic) {
      const px = c + (vehicle.x - x) * scale;
      const py = c + (vehicle.z - z) * scale;
      if (px < 2 || py < 2 || px > size - 2 || py > size - 2) continue;
      ctx.beginPath();
      ctx.arc(px, py, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gas stations, clamped to the ring when out of view.
    let nearest = Infinity;
    for (const station of this.gasStations) {
      const dx = (station.x - x) * scale;
      const dz = (station.z - z) * scale;
      const distance = Math.hypot(station.x - x, station.z - z);
      nearest = Math.min(nearest, distance);

      let px = c + dx;
      let py = c + dz;
      const length = Math.hypot(dx, dz);
      const clamped = length > inner;
      if (clamped && length > 0.001) {
        px = c + (dx / length) * inner;
        py = c + (dz / length) * inner;
      }

      ctx.fillStyle = FUEL;
      ctx.beginPath();
      ctx.arc(px, py, clamped ? 5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#08130c';
      ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('G', px, py + 0.5);

      if (clamped) {
        ctx.fillStyle = 'rgba(232,242,236,0.9)';
        ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(`${Math.round(distance)}m`, px, py + 12);
      }
    }

    // Player arrow.
    const angle = Math.atan2(-Math.cos(heading), -Math.sin(heading));
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-2.6, 0);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Compass.
    ctx.fillStyle = 'rgba(232,242,255,0.6)';
    ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', c, 4);

    if (this.info) {
      this.info.textContent = Number.isFinite(nearest)
        ? `Nearest fuel · ${Math.round(nearest)} m`
        : '';
    }
  }
}
