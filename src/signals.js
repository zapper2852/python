/**
 * City traffic-light timing.
 *
 * North-south and east-west approaches alternate on a fixed cycle with an
 * amber phase and an all-red clearance interval. Every intersection is given
 * its own offset so the grid does not blink in unison and drivers get a slow
 * rolling green wave instead of stopping at every corner.
 */

const GREEN = 13;
const YELLOW = 3;
const ALL_RED = 1;
const HALF = GREEN + YELLOW + ALL_RED;

export const SIGNAL_CYCLE = HALF * 2;

/** Seconds an intersection's cycle is shifted by, based on its grid index. */
export function signalOffset(ix, jz) {
  const bucket = (((ix * 5 + jz * 11) % 6) + 6) % 6;
  return bucket * 1.6;
}

/** Returns `{ ns, ew }` where each value is 'green' | 'yellow' | 'red'. */
export function signalState(time, ix, jz) {
  let t = (time + signalOffset(ix, jz)) % SIGNAL_CYCLE;
  if (t < 0) t += SIGNAL_CYCLE;

  if (t < GREEN) return { ns: 'green', ew: 'red' };
  if (t < GREEN + YELLOW) return { ns: 'yellow', ew: 'red' };
  if (t < HALF) return { ns: 'red', ew: 'red' };

  const u = t - HALF;
  if (u < GREEN) return { ns: 'red', ew: 'green' };
  if (u < GREEN + YELLOW) return { ns: 'red', ew: 'yellow' };
  return { ns: 'red', ew: 'red' };
}
