/** One shared keyboard state so the car and the on-foot player never fight. */
export const keys = new Set();

const HANDLED = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
]);

export function initInput() {
  window.addEventListener('keydown', (event) => {
    if (!HANDLED.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => keys.clear());
}

export const isShift = () => keys.has('ShiftLeft') || keys.has('ShiftRight');
export const isCrouch = () => keys.has('ControlLeft') || keys.has('ControlRight');
