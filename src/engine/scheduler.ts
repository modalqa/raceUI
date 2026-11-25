import type { TimingConfig } from '../schema/scenario.js';

/** mulberry32: tiny, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a stable per-attempt seed from the run seed (attempts are 1-based). */
export function attemptSeed(runSeed: number, attempt: number): number {
  let h = (runSeed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/**
 * Planned release offsets (ms after barrier release) per actor. Deterministic for a given
 * seed (NFR-04); actual execution timing may still differ.
 */
export function planOffsets(timing: Pick<TimingConfig, 'mode' | 'offsetsMs' | 'jitterMs'>, actorIds: string[], seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  switch (timing.mode) {
    case 'simultaneous':
      for (const id of actorIds) out[id] = 0;
      break;
    case 'staggered':
      for (const id of actorIds) out[id] = timing.offsetsMs?.[id] ?? 0;
      break;
    case 'jitter': {
      const rnd = mulberry32(seed);
      const bound = timing.jitterMs ?? 0;
      for (const id of actorIds) out[id] = Math.round(rnd() * bound);
      break;
    }
  }
  return out;
}

export interface TimingQuality {
  /** max(dispatch) - min(dispatch) across actors that dispatched. */
  dispatchSkewMs: number | null;
  /** Largest |actual - planned| deviation of the relative schedule. */
  maxOffsetErrorMs: number | null;
  thresholdMs: number;
  quality: 'within-threshold' | 'exceeded' | 'not-measured';
}

/**
 * Evaluates timing validity (PRD §6.1, §7.2). For simultaneous mode the dispatch skew is
 * compared to the threshold; for staggered/jitter, the deviation from planned relative offsets.
 * Offsets are normalized to the earliest actor so a constant release latency is not an error.
 */
export function evaluateTiming(
  mode: TimingConfig['mode'],
  planned: Record<string, number>,
  dispatched: Record<string, number | undefined>,
  thresholdMs: number,
): TimingQuality {
  const ids = Object.keys(planned).filter((id) => dispatched[id] !== undefined);
  if (ids.length < 2) return { dispatchSkewMs: null, maxOffsetErrorMs: null, thresholdMs, quality: 'not-measured' };
  const actual = ids.map((id) => dispatched[id] as number);
  const skew = Math.max(...actual) - Math.min(...actual);
  const minPlanned = Math.min(...ids.map((id) => planned[id] as number));
  const minActual = Math.min(...actual);
  const errors = ids.map((id) => Math.abs((dispatched[id] as number) - minActual - ((planned[id] as number) - minPlanned)));
  const maxErr = Math.max(...errors);
  const measure = mode === 'simultaneous' ? skew : maxErr;
  return {
    dispatchSkewMs: round(skew),
    maxOffsetErrorMs: round(maxErr),
    thresholdMs,
    quality: measure <= thresholdMs ? 'within-threshold' : 'exceeded',
  };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Sleeps until the monotonic clock reaches `target` (ms, performance.now() base). */
export async function sleepUntil(target: number): Promise<void> {
  // No busy-waiting: a spinning actor would block the event loop and delay other actors.
  const remaining = target - performance.now();
  if (remaining >= 1) await new Promise((r) => setTimeout(r, remaining));
}
