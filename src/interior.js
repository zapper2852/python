import * as THREE from 'three';

const DEG = Math.PI / 180;
const GEAR_TOPS = [42, 78, 116, 152, 190, 230];

// --- small builders ---------------------------------------------------------

function box(material, size, position, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  return mesh;
}

function cylinder(material, radiusTop, radiusBottom, height, segments, position, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material
  );
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  return mesh;
}

function disc(material, radius, position, segments = 32) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material);
  mesh.position.set(...position);
  return mesh;
}

// --- backlit gauge face -----------------------------------------------------

function gaugeTexture({ max, majorStep, caption, redlineFrom = null }) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 3;

  const face = g.createRadialGradient(cx, cy * 0.7, 6, cx, cy, R * 1.25);
  face.addColorStop(0, '#16222b');
  face.addColorStop(0.55, '#0a1015');
  face.addColorStop(1, '#05080b');
  g.fillStyle = face;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = '#3b464f';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, cy, R - 3, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#0d1216';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, R - 8, 0, Math.PI * 2);
  g.stroke();

  const angle = (t) => (225 - 270 * t) * DEG;
  const xy = (a, r) => [cx + Math.cos(a) * r, cy - Math.sin(a) * r];

  if (redlineFrom != null) {
    g.strokeStyle = 'rgba(214, 62, 44, 0.85)';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(cx, cy, R - 18, -angle(redlineFrom / max), -angle(1), false);
    g.stroke();
  }

  const minorCount = 5;
  for (let i = 0; i <= (max / majorStep) * minorCount; i += 1) {
    const t = (i / ((max / majorStep) * minorCount)) * 1;
    const a = angle(t);
    const major = i % minorCount === 0;
    const [x1, y1] = xy(a, R * (major ? 0.74 : 0.82));
    const [x2, y2] = xy(a, R * 0.88);
    g.strokeStyle = major ? '#dbe4ec' : '#67747f';
    g.lineWidth = major ? 4 : 2;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  g.fillStyle = '#e6edf3';
  g.font = '600 21px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let v = 0; v <= max; v += majorStep) {
    const [x, y] = xy(angle(v / max), R * 0.6);
    g.fillText(String(v), x, y);
  }

  g.fillStyle = '#8c99a4';
  g.font = '500 15px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText(caption, cx, cy + R * 0.46);

  g.fillStyle = '#4d5a65';
  g.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText('AUTHENTIC MOTOR CO.', cx, cy + R * 0.72);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function screenTexture() {
  const w = 512;
  const h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');

  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0b1a24');
  bg.addColorStop(1, '#040a0e');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // status bar
  g.fillStyle = 'rgba(160, 196, 214, 0.16)';
  g.fillRect(0, 0, w, 34);
  g.fillStyle = '#bcd4e2';
  g.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('09:41', 16, 18);
  g.textAlign = 'right';
  g.fillText('21°C', w - 16, 18);
  g.textAlign = 'left';

  // album art
  const art = g.createLinearGradient(28, 56, 148, 176);
  art.addColorStop(0, '#2f6c8c');
  art.addColorStop(1, '#122a38');
  g.fillStyle = art;
  g.beginPath();
  g.roundRect(28, 56, 122, 122, 10);
  g.fill();
  g.strokeStyle = 'rgba(190, 224, 240, 0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(89, 117, 26, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = '#dbe9f2';
  g.font = '600 24px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText('Night Drive', 174, 84);
  g.fillStyle = '#7d96a5';
  g.font = '400 17px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText('Midnight Cruise · 12 tracks', 174, 112);

  // progress
  g.fillStyle = 'rgba(150, 186, 204, 0.22)';
  g.beginPath();
  g.roundRect(174, 148, 300, 6, 3);
  g.fill();
  g.fillStyle = '#6fb8dc';
  g.beginPath();
  g.roundRect(174, 148, 118, 6, 3);
  g.fill();
  g.fillStyle = '#7d96a5';
  g.font = '400 14px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText('1:42', 174, 172);
  g.textAlign = 'right';
  g.fillText('3:58', 474, 172);
  g.textAlign = 'left';

  // climate row
  g.fillStyle = 'rgba(150, 186, 204, 0.12)';
  g.beginPath();
  g.roundRect(28, 212, 456, 52, 10);
  g.fill();
  const labels = ['AUTO', '21°', '21°', 'SYNC'];
  labels.forEach((label, i) => {
    g.fillStyle = i === 0 ? '#6fb8dc' : '#93a8b4';
    g.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 85 + i * 114, 239);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// --- materials --------------------------------------------------------------

function interiorMaterials(shared) {
  return {
    leather: shared.leather,
    headliner: shared.headliner,
    trim: shared.trim,
    chrome: shared.chrome,
    aluminium: shared.aluminium,
    dash: new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 0.84 }),
    dashTop: new THREE.MeshStandardMaterial({ color: '#15191d', roughness: 0.95 }),
    panel: new THREE.MeshStandardMaterial({ color: '#111519', roughness: 0.66 }),
    seat: new THREE.MeshStandardMaterial({ color: '#262a30', roughness: 0.76 }),
    bolster: new THREE.MeshStandardMaterial({ color: '#1d2126', roughness: 0.7 }),
    stitch: new THREE.MeshStandardMaterial({ color: '#9da5ae', roughness: 0.5 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 1 }),
    mat: new THREE.MeshStandardMaterial({ color: '#1b1f23', roughness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#0d1013', roughness: 0.95 }),
    needle: new THREE.MeshStandardMaterial({
      color: '#f1f5f8',
      emissive: '#ff5a3c',
      emissiveIntensity: 1.4,
      roughness: 0.35,
    }),
    backlight: new THREE.MeshStandardMaterial({
      color: '#0d1216',
      emissive: '#5b9bc0',
      emissiveIntensity: 0.7,
      roughness: 0.4,
    }),
    ambient: new THREE.MeshBasicMaterial({ color: '#6fb8dc' }),
    screen: new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }),
  };
}

// --- dashboard --------------------------------------------------------------

function buildDashboard(root, m) {
  // Main dash body, layered so the profile reads as soft-touch moulded plastic.
  root.add(box(m.dash, [1.38, 0.24, 0.32], [0, 0.72, -0.62]));
  root.add(box(m.dash, [1.30, 0.14, 0.22], [0, 0.58, -0.68]));
  root.add(box(m.panel, [1.30, 0.10, 0.12], [0, 0.5, -0.72]));
  root.add(box(m.dashTop, [1.36, 0.06, 0.34], [0, 0.855, -0.6], [-0.1, 0, 0]));

  // Black firewall face in front of the footwell.
  root.add(box(m.panel, [1.3, 0.46, 0.02], [0, 0.66, -0.772]));

  // Windscreen defroster grille and a satin trim band under the pad.
  root.add(box(m.panel, [1.10, 0.014, 0.10], [0, 0.878, -0.7]));
  root.add(box(m.aluminium, [1.26, 0.016, 0.02], [0, 0.79, -0.462]));
  root.add(box(m.ambient, [1.20, 0.006, 0.008], [0, 0.804, -0.458]));

  // Driver side: the cluster is rebated into a moulded binnacle housing.
  root.add(box(m.dash, [0.44, 0.12, 0.16], [0.35, 0.8, -0.53]));
  root.add(box(m.panel, [0.44, 0.20, 0.04], [0.35, 0.877, -0.505]));
  root.add(box(m.dashTop, [0.44, 0.03, 0.09], [0.35, 0.972, -0.487], [0.2, 0, 0]));
  root.add(box(m.dashTop, [0.44, 0.02, 0.05], [0.35, 0.783, -0.49]));
  for (const side of [-1, 1]) {
    root.add(box(m.dashTop, [0.03, 0.19, 0.06], [0.35 + side * 0.205, 0.877, -0.487]));
  }

  // Centre stack: surround, screen, climate strip, hazard switch.
  const stack = new THREE.Group();
  stack.position.set(0, 0.755, -0.455);
  stack.rotation.x = -0.12;

  stack.add(box(m.panel, [0.34, 0.26, 0.03], [0, 0, 0]));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.152), m.screen);
  screen.position.set(0, 0.025, 0.017);
  stack.add(screen);
  stack.add(box(m.chrome, [0.30, 0.006, 0.008], [0, -0.055, 0.017]));

  for (let i = 0; i < 4; i += 1) {
    stack.add(box(m.panel, [0.05, 0.024, 0.012], [-0.098 + i * 0.065, -0.088, 0.017]));
  }
  stack.add(box(m.needle, [0.028, 0.02, 0.012], [0.135, -0.088, 0.017]));
  stack.add(box(m.dash, [0.34, 0.02, 0.035], [0, 0.115, 0.002]));
  root.add(stack);

  // Contrast stitching along the rear edge of the dash top.
  root.add(box(m.stitch, [1.28, 0.004, 0.006], [0, 0.884, -0.437]));

  // Round air vents either side of the stack.
  for (const side of [-1, 1]) {
    const vent = new THREE.Group();
    vent.position.set(side * 0.5, 0.79, -0.458);
    vent.rotation.x = -0.14;
    vent.add(cylinder(m.panel, 0.062, 0.062, 0.035, 24, [0, 0, 0], [Math.PI / 2, 0, 0]));
    vent.add(
      new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.006, 8, 28), m.aluminium)
    );
    for (let i = -1; i <= 1; i += 1) {
      vent.add(box(m.aluminium, [0.096, 0.008, 0.006], [0, i * 0.018, 0.016]));
    }
    root.add(vent);
  }

}

// --- instrument cluster -----------------------------------------------------

function buildCluster(root, m, api) {
  const group = new THREE.Group();
  group.position.set(0.35, 0.877, -0.482);
  group.rotation.x = -0.15;

  group.add(box(m.panel, [0.40, 0.175, 0.035], [0, 0, 0]));
  group.add(box(m.panel, [0.36, 0.135, 0.012], [0, 0.004, 0.02]));

  const tach = gaugeTexture({ max: 8, majorStep: 1, caption: 'x1000 r/min', redlineFrom: 6.5 });
  const speedo = gaugeTexture({ max: 240, majorStep: 40, caption: 'km/h' });

  const dials = [
    { x: -0.081, texture: tach, key: 'rpmNeedle' },
    { x: 0.081, texture: speedo, key: 'speedNeedle' },
  ];

  for (const dial of dials) {
    const face = new THREE.MeshStandardMaterial({
      map: dial.texture,
      emissive: '#ffffff',
      emissiveMap: dial.texture,
      emissiveIntensity: 0.55,
      roughness: 0.6,
      metalness: 0,
    });
    group.add(disc(face, 0.06, [dial.x, 0.004, 0.028]));

    const needle = new THREE.Group();
    needle.name = dial.key;
    needle.position.set(dial.x, 0.004, 0.032);
    needle.add(box(m.needle, [0.005, 0.05, 0.0015], [0, 0.021, 0]));
    needle.add(box(m.needle, [0.007, 0.012, 0.0015], [0, -0.013, 0]));
    group.add(needle);
    api[dial.key] = needle;
  }

  // Hub caps and the small digital strip between the dials.
  for (const dial of dials) {
    group.add(cylinder(m.chrome, 0.008, 0.008, 0.008, 12, [dial.x, 0.004, 0.036], [Math.PI / 2, 0, 0]));
  }
  group.add(box(m.backlight, [0.03, 0.05, 0.001], [0, 0.02, 0.03]));

  root.add(group);
}

// --- steering wheel ---------------------------------------------------------

function buildSteeringWheel(root, m, api) {
  const column = new THREE.Group();
  column.position.set(0.35, 0.9, -0.415);
  column.rotation.x = -0.36;

  const shroud = cylinder(m.panel, 0.048, 0.078, 0.26, 20, [0, 0, -0.1], [Math.PI / 2, 0, 0]);
  column.add(shroud);

  // Indicator and wiper stalks.
  for (const side of [-1, 1]) {
    const stalk = box(m.panel, [0.022, 0.022, 0.13], [side * 0.1, 0.02, -0.06], [0, 0, side * 0.18]);
    column.add(stalk);
  }

  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.166, 0.023, 12, 40), m.leather);
  wheel.add(rim);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.148, 0.004, 8, 36), m.aluminium));

  // Three spokes and a leather-wrapped hub with a badge.
  for (const side of [-1, 1]) {
    wheel.add(box(m.aluminium, [0.105, 0.026, 0.026], [side * 0.096, 0.004, 0]));
  }
  wheel.add(box(m.aluminium, [0.03, 0.12, 0.024], [0, -0.094, 0]));
  wheel.add(box(m.leather, [0.115, 0.08, 0.05], [0, 0.006, 0]));
  wheel.add(cylinder(m.chrome, 0.024, 0.024, 0.006, 20, [0, 0.012, 0.028], [Math.PI / 2, 0, 0]));

  column.add(wheel);
  root.add(column);
  api.steeringWheel = wheel;
}

// --- seats ------------------------------------------------------------------

function buildFrontSeat(root, m, x) {
  const seat = new THREE.Group();
  seat.position.set(x, 0, 0);

  // Rails and pedestal.
  seat.add(box(m.panel, [0.34, 0.05, 0.46], [0, 0.49, 0.22]));
  seat.add(box(m.panel, [0.3, 0.1, 0.34], [0, 0.555, 0.22]));

  // Cushion with side bolsters and contrast stitching.
  seat.add(box(m.seat, [0.44, 0.1, 0.48], [0, 0.635, 0.2]));
  for (const side of [-1, 1]) {
    seat.add(box(m.bolster, [0.075, 0.13, 0.46], [side * 0.185, 0.665, 0.2]));
    seat.add(box(m.stitch, [0.004, 0.004, 0.42], [side * 0.148, 0.687, 0.2]));
  }

  // Reclined backrest.
  const back = new THREE.Group();
  back.position.set(0, 0.665, 0.43);
  back.rotation.x = 0.16;

  back.add(box(m.seat, [0.42, 0.52, 0.14], [0, 0.26, 0]));
  for (const side of [-1, 1]) {
    back.add(box(m.bolster, [0.07, 0.42, 0.16], [side * 0.18, 0.24, 0.025]));
    back.add(box(m.stitch, [0.004, 0.38, 0.004], [side * 0.145, 0.24, 0.072]));
  }
  back.add(box(m.stitch, [0.16, 0.004, 0.004], [0, 0.12, 0.072]));

  // Headrest on two posts.
  back.add(box(m.seat, [0.25, 0.15, 0.12], [0, 0.605, 0.01]));
  back.add(box(m.stitch, [0.16, 0.004, 0.004], [0, 0.655, 0.072]));
  for (const side of [-1, 1]) {
    back.add(cylinder(m.chrome, 0.009, 0.009, 0.07, 10, [side * 0.075, 0.5, 0]));
  }

  seat.add(back);
  root.add(seat);
}

function buildRearBench(root, m) {
  root.add(box(m.seat, [1.24, 0.12, 0.44], [0, 0.62, 0.98]));

  const back = new THREE.Group();
  back.position.set(0, 0.68, 1.2);
  back.rotation.x = 0.18;
  back.add(box(m.seat, [1.24, 0.46, 0.14], [0, 0.23, 0]));
  back.add(box(m.stitch, [1.12, 0.004, 0.004], [0, 0.14, 0.072]));
  for (const x of [-0.38, 0.02, 0.42]) {
    back.add(box(m.stitch, [0.004, 0.34, 0.004], [x - 0.16, 0.24, 0.072]));
  }
  for (const x of [-0.3, 0.3]) {
    back.add(box(m.seat, [0.22, 0.13, 0.11], [x, 0.53, 0.01]));
  }
  root.add(back);
}

// --- centre console ---------------------------------------------------------

function buildCentreConsole(root, m) {
  root.add(box(m.dash, [0.23, 0.16, 1.16], [0, 0.55, 0.2]));
  root.add(box(m.panel, [0.21, 0.03, 1.14], [0, 0.638, 0.2]));
  root.add(box(m.ambient, [0.006, 0.005, 1.0], [0.104, 0.6, 0.2]));

  // Gear lever with a leather boot.
  root.add(cylinder(m.leather, 0.032, 0.058, 0.07, 16, [0.02, 0.675, -0.06]));
  root.add(cylinder(m.chrome, 0.011, 0.011, 0.11, 12, [0.02, 0.75, -0.06]));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 18, 12), m.leather);
  knob.position.set(0.02, 0.812, -0.06);
  root.add(knob);
  root.add(cylinder(m.chrome, 0.028, 0.028, 0.006, 16, [0.02, 0.79, -0.06]));

  // Handbrake.
  root.add(box(m.panel, [0.036, 0.03, 0.24], [-0.03, 0.685, 0.12], [0.34, 0, 0]));
  root.add(box(m.leather, [0.032, 0.032, 0.1], [-0.03, 0.725, 0.03], [0.34, 0, 0]));
  root.add(cylinder(m.chrome, 0.012, 0.012, 0.014, 12, [-0.03, 0.723, -0.028], [0, 0, Math.PI / 2]));

  // Cupholders and switch bank.
  for (const z of [0.2, 0.315]) {
    root.add(cylinder(m.panel, 0.036, 0.036, 0.012, 20, [0, 0.652, z]));
    root.add(cylinder(m.rubber, 0.03, 0.03, 0.006, 20, [0, 0.655, z]));
  }
  for (let i = 0; i < 3; i += 1) {
    root.add(box(m.panel, [0.044, 0.014, 0.03], [-0.06 + i * 0.06, 0.652, 0.04]));
  }

  // Padded armrest.
  root.add(box(m.leather, [0.21, 0.075, 0.36], [0, 0.68, 0.6]));
  root.add(box(m.stitch, [0.19, 0.004, 0.34], [0, 0.719, 0.6]));
}

// --- doors, mirrors and trim ------------------------------------------------

function buildDoorCard(root, m, side) {
  const inner = side * 0.695;

  root.add(box(m.dash, [0.035, 0.34, 1.62], [side * 0.708, 0.655, 0.22]));
  root.add(box(m.panel, [0.02, 0.1, 1.2], [inner - side * 0.004, 0.5, 0.24]));

  // Armrest with a chrome pull handle and window switch.
  root.add(box(m.leather, [0.1, 0.07, 0.6], [inner - side * 0.05, 0.735, 0.16]));
  root.add(box(m.chrome, [0.022, 0.028, 0.22], [inner - side * 0.075, 0.79, 0.0]));
  root.add(box(m.panel, [0.05, 0.012, 0.1], [inner - side * 0.05, 0.776, 0.1]));
  root.add(box(m.aluminium, [0.025, 0.008, 0.03], [inner - side * 0.05, 0.783, 0.12]));

  // Speaker in the door.
  const speaker = cylinder(m.panel, 0.078, 0.078, 0.012, 24, [inner - side * 0.008, 0.6, 0.42], [0, 0, Math.PI / 2]);
  root.add(speaker);
  const speakerRing = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.006, 8, 28), m.aluminium);
  speakerRing.position.set(inner - side * 0.014, 0.6, 0.42);
  speakerRing.rotation.y = Math.PI / 2;
  root.add(speakerRing);

  // Satin trim along the top roll of the door.
  root.add(box(m.chrome, [0.018, 0.012, 1.24], [inner - side * 0.006, 0.815, 0.2]));
}

function buildHeadlinerTrim(root, m) {
  // Rear-view mirror on its stalk.
  root.add(cylinder(m.panel, 0.011, 0.011, 0.08, 10, [0, 1.3, -0.05], [0.35, 0, 0]));
  root.add(box(m.trim, [0.24, 0.07, 0.025], [0, 1.25, -0.02]));
  root.add(box(m.chrome, [0.2, 0.048, 0.006], [0, 1.25, -0.032]));

  // Sun visors.
  for (const side of [-1, 1]) {
    root.add(box(m.headliner, [0.34, 0.022, 0.16], [side * 0.37, 1.29, -0.01], [0.05, 0, 0]));
  }

  // Cabin dome light.
  root.add(box(m.panel, [0.17, 0.014, 0.1], [0, 1.312, 0.30]));
  root.add(box(m.backlight, [0.14, 0.006, 0.075], [0, 1.306, 0.30]));

  // Grab handles above the doors.
  for (const side of [-1, 1]) {
    root.add(box(m.panel, [0.026, 0.026, 0.22], [side * 0.5, 1.28, 0.72]));
  }

  // Parcel shelf behind the rear seats.
  root.add(box(m.panel, [1.24, 0.02, 0.3], [0, 1.01, 1.45]));
}

function buildPedals(root, m) {
  for (const { x, w } of [
    { x: 0.42, w: 0.07 },
    { x: 0.29, w: 0.11 },
  ]) {
    root.add(box(m.panel, [w, 0.15, 0.022], [x, 0.56, -0.62], [-0.22, 0, 0]));
    root.add(box(m.rubber, [w - 0.02, 0.12, 0.006], [x, 0.56, -0.605], [-0.22, 0, 0]));
  }
  // Dead pedal and floor mats.
  root.add(box(m.panel, [0.09, 0.14, 0.02], [0.11, 0.56, -0.6], [-0.22, 0, 0]));
  root.add(box(m.mat, [0.44, 0.008, 0.42], [0.35, 0.462, 0.16]));
  root.add(box(m.mat, [0.44, 0.008, 0.42], [-0.35, 0.462, 0.16]));
}

// --- public builder ---------------------------------------------------------

export function buildInterior(root, shared) {
  const m = interiorMaterials(shared);
  const api = { steeringWheel: null, speedNeedle: null, rpmNeedle: null };

  root.add(box(m.carpet, [1.36, 0.02, 1.8], [0, 0.455, 0.3]));

  buildDashboard(root, m);
  buildCluster(root, m, api);
  buildSteeringWheel(root, m, api);
  buildFrontSeat(root, m, 0.35);
  buildFrontSeat(root, m, -0.35);
  buildRearBench(root, m);
  buildCentreConsole(root, m);
  for (const side of [-1, 1]) buildDoorCard(root, m, side);
  buildHeadlinerTrim(root, m);
  buildPedals(root, m);

  return {
    steeringWheel: api.steeringWheel,
    /** Drives the two gauge needles from road speed. */
    setDashboard(speedKmh) {
      let rpm = 850;
      let base = 0;
      for (const top of GEAR_TOPS) {
        if (speedKmh <= top) {
          rpm = 950 + ((speedKmh - base) / (top - base)) * 5400;
          break;
        }
        base = top;
      }
      if (speedKmh > GEAR_TOPS[GEAR_TOPS.length - 1]) rpm = 6500;

      const t = (v) => Math.min(1, Math.max(0, v));
      api.speedNeedle.rotation.z = (135 - 270 * t(speedKmh / 240)) * DEG;
      api.rpmNeedle.rotation.z = (135 - 270 * t((rpm - 800) / 6500)) * DEG;
    },
  };
}
