import { describe, expect, it } from 'vitest';
import { attemptSeed, evaluateTiming, planOffsets } from '../../src/engine/scheduler.js';

const ids = ['a', 'b', 'c'];

describe('planOffsets', () => {
  it('simultaneous mode uses zero offsets', () => {
    expect(planOffsets({ mode: 'simultaneous' }, ids, 1)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('staggered mode uses explicit offsets', () => {
    expect(planOffsets({ mode: 'staggered', offsetsMs: { a: 0, b: 25, c: 50 } }, ids, 1)).toEqual({ a: 0, b: 25, c: 50 });
  });

  it('seeded jitter is deterministic and bounded (NFR-04)', () => {
    const t = { mode: 'jitter' as const, jitterMs: 40 };
    const x = planOffsets(t, ids, attemptSeed(42, 3));
    const y = planOffsets(t, ids, attemptSeed(42, 3));
    expect(x).toEqual(y);
    for (const v of Object.values(x)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(40);
    }
    const differs = [1, 2, 4, 5, 6].some((i) => JSON.stringify(planOffsets(t, ids, attemptSeed(42, i))) !== JSON.stringify(x));
    expect(differs).toBe(true);
  });

  it('attempt seeds are stable and distinct', () => {
    expect(attemptSeed(42, 1)).toBe(attemptSeed(42, 1));
    expect(attemptSeed(42, 1)).not.toBe(attemptSeed(42, 2));
    expect(attemptSeed(42, 1)).not.toBe(attemptSeed(43, 1));
  });
});

describe('evaluateTiming', () => {
  it('measures dispatch skew in simultaneous mode', () => {
    const q = evaluateTiming('simultaneous', { a: 0, b: 0 }, { a: 1, b: 5 }, 10);
    expect(q.dispatchSkewMs).toBe(4);
    expect(q.quality).toBe('within-threshold');
    expect(evaluateTiming('simultaneous', { a: 0, b: 0 }, { a: 1, b: 50 }, 10).quality).toBe('exceeded');
  });

  it('measures deviation from relative offsets in staggered mode', () => {
    const ok = evaluateTiming('staggered', { a: 0, b: 100 }, { a: 3, b: 104 }, 10);
    expect(ok.maxOffsetErrorMs).toBe(1);
    expect(ok.quality).toBe('within-threshold');
    expect(evaluateTiming('staggered', { a: 0, b: 100 }, { a: 0, b: 10 }, 10).quality).toBe('exceeded');
  });

  it('is not measured when fewer than two actors dispatched', () => {
    expect(evaluateTiming('simultaneous', { a: 0, b: 0 }, { a: 1, b: undefined }, 10).quality).toBe('not-measured');
  });
});
