import * as THREE from 'three';

/**
 * Jobs, missions and the shop.
 *
 * Each location is a glowing marker on a sidewalk corner: walk or drive into it
 * and press E. Jobs pay on delivery, missions pay more but make you wanted.
 */

export const SHOP_ITEMS = [
  { id: 'pistol_ammo', name: 'Pistol ammo (15)', price: 40, kind: 'ammo', weapon: 'pistol', amount: 15 },
  { id: 'rifle_ammo', name: 'Rifle ammo (30)', price: 70, kind: 'ammo', weapon: 'rifle', amount: 30 },
  { id: 'rifle', name: 'Assault rifle', price: 850, kind: 'weapon', weapon: 'rifle' },
  { id: 'medkit', name: 'Medkit (+60 health)', price: 90, kind: 'health', amount: 60 },
  { id: 'repair', name: 'Repair kit (car)', price: 130, kind: 'repair' },
];

const JOB_DEFS = [
  {
    id: 'courier',
    title: 'Courier package',
    blurb: 'Deliver the parcel across town.',
    pay: 140,
    seconds: 105,
    stars: 0,
    at: { x: -18, z: 44 },
    target: { x: 168, z: -84 },
  },
  {
    id: 'taxi',
    title: 'Taxi fare',
    blurb: 'Pick the fare up and drop them off.',
    pay: 175,
    seconds: 115,
    stars: 0,
    at: { x: -70, z: -36 },
    target: { x: -20, z: 150 },
  },
  {
    id: 'parts',
    title: 'Parts run',
    blurb: 'Rush engine parts to the garage.',
    pay: 210,
    seconds: 95,
    stars: 0,
    at: { x: 96, z: 30 },
    target: { x: -150, z: 12 },
  },
];

const MISSION_DEFS = [
  {
    id: 'getaway',
    title: 'Getaway driver',
    blurb: 'Lose the heat after the drop. Pays big.',
    pay: 950,
    seconds: 150,
    stars: 2,
    at: { x: 44, z: -150 },
    target: { x: 150, z: 150 },
  },
  {
    id: 'collector',
    title: 'Debt collector',
    blurb: 'Collect the package from the docks.',
    pay: 1200,
    seconds: 160,
    stars: 2,
    at: { x: -150, z: -150 },
    target: { x: 30, z: -30 },
  },
];

function labelTexture(text, color) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.fillStyle = color;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0b1117';
  g.font = 'bold 72px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, size / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMarker(scene, { x, z, color, label }) {
  const group = new THREE.Group();
  const y = 0.06;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.0, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.02, z);
  group.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 5, 20, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(x, 2.5, z);
  group.add(beam);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: labelTexture(label, color), transparent: true, depthWrite: false })
  );
  sprite.position.set(x, 3.5, z);
  sprite.scale.set(2.1, 2.1, 1);
  group.add(sprite);

  scene.add(group);
  return { group, ring, beam, sprite };
}

export class JobBoard {
  constructor(scene, game, audio) {
    this.scene = scene;
    this.game = game;
    this.audio = audio;
    this.markers = [];
    this.active = null;
    this.targetMarker = null;

    for (const job of JOB_DEFS) {
      this.markers.push({
        ...job,
        kind: 'job',
        color: '#38d2a0',
        label: 'J',
        x: job.at.x,
        z: job.at.z,
      });
    }
    for (const mission of MISSION_DEFS) {
      this.markers.push({
        ...mission,
        kind: 'mission',
        color: '#d85ce0',
        label: 'M',
        x: mission.at.x,
        z: mission.at.z,
      });
    }

    this.markers.push({
      id: 'shop',
      kind: 'shop',
      title: 'Weapon store',
      x: 62,
      z: -60,
      color: '#ffb02e',
      label: '$',
    });

    this.markers.push({
      id: 'garage',
      kind: 'garage',
      title: 'Repair shop',
      x: -96,
      z: -110,
      color: '#5aa9ff',
      label: 'R',
    });

    for (const marker of this.markers) {
      marker.visual = buildMarker(scene, marker);
    }
  }

  nearest(position, radius = 5) {
    let best = null;
    let bestDistance = radius;
    for (const marker of this.markers) {
      const distance = Math.hypot(position.x - marker.x, position.z - marker.z);
      if (distance < bestDistance) {
        best = marker;
        bestDistance = distance;
      }
    }
    return best;
  }

  get objective() {
    if (!this.active) return '';
    const job = this.active;
    return `${job.title} · ${Math.round(job.timeLeft)}s · $${job.pay}`;
  }

  accept(marker) {
    if (this.active) {
      this.game.notify('Finish your current job first', 'warn');
      return false;
    }
    if (marker.kind !== 'job' && marker.kind !== 'mission') return false;
    this.active = {
      ...marker,
      timeLeft: marker.seconds,
    };
    this.game.notify(`Job accepted: ${marker.title}`, 'good');
    this.targetMarker = buildMarker(this.scene, {
      x: marker.target.x,
      z: marker.target.z,
      color: marker.color,
      label: '!',
    });
    return true;
  }

  cancel() {
    this.active = null;
    if (this.targetMarker) {
      this.scene.remove(this.targetMarker.group);
      this.targetMarker = null;
    }
  }

  update(dt, position) {
    if (!this.active) return;
    const job = this.active;
    job.timeLeft -= dt;
    if (job.timeLeft <= 0) {
      this.game.notify(`Failed: ${job.title} ran out of time`, 'warn');
      this.cancel();
      return;
    }

    const distance = Math.hypot(position.x - job.target.x, position.z - job.target.z);
    // The drop-off only counts while actually inside the marker.
    if (distance < 4.5) {
      this.game.earn(job.pay, job.kind === 'mission' ? 'mission' : 'job');
      if (job.stars) this.game.crime('theft', job.stars);
      this.game.stats.jobsDone += 1;
      this.cancel();
    }
  }

  /** Buy one shop item; returns true when the purchase went through. */
  buy(item, ctx = {}) {
    if (item.kind === 'weapon') {
      if (this.game.ownedGuns[item.weapon]) {
        this.game.notify('You already own that weapon', 'info');
        return false;
      }
      if (!this.game.spend(item.price, item.name)) return false;
      this.game.ownedGuns[item.weapon] = 1;
      this.game.inventory.push(item.weapon);
      this.game.mag[item.weapon] = 0;
      this.game.reserve[item.weapon] = 30;
      this.game.selectWeapon?.(item.weapon);
      this.game.notify(`Purchased ${item.name}`, 'good');
      return true;
    }

    if (item.kind === 'ammo') {
      if (!this.game.ownedGuns[item.weapon]) {
        this.game.notify('Buy the weapon first', 'warn');
        return false;
      }
      if (!this.game.spend(item.price, item.name)) return false;
      this.game.reserve[item.weapon] = (this.game.reserve[item.weapon] || 0) + item.amount;
      this.game.notify(`+${item.amount} rounds`, 'good');
      return true;
    }

    if (item.kind === 'health') {
      if (!this.game.spend(item.price, item.name)) return false;
      this.game.heal(item.amount);
      this.game.notify('Patched up', 'good');
      return true;
    }

    if (item.kind === 'repair') {
      if (!this.game.spend(item.price, item.name)) return false;
      ctx.repair?.();
      this.game.notify('Car repaired', 'good');
      return true;
    }

    return false;
  }
}
