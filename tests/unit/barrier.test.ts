import { describe, expect, it } from 'vitest';
import { Barrier, BarrierError } from '../../src/engine/barrier.js';

describe('Barrier', () => {
  it('releases only after every party arrives', async () => {
    const b = new Barrier(['a', 'b', 'c'], 1000);
    let released = false;
    void b.wait().then(() => (released = true));
    void b.arrive('a');
    void b.arrive('b');
    await new Promise((r) => setTimeout(r, 20));
    expect(released).toBe(false);
    expect(b.missing()).toEqual(['c']);
    void b.arrive('c');
    const arrivals = await b.wait();
    expect([...arrivals.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('times out with the missing parties and never releases (no partial release)', async () => {
    const b = new Barrier(['a', 'b'], 50);
    void b.arrive('a');
    const err = await b.wait().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BarrierError);
    expect((err as BarrierError).reason).toBe('timeout');
    expect((err as BarrierError).missing).toEqual(['b']);
    // A late arrival after the timeout must not release the barrier.
    void b.arrive('b').catch(() => undefined);
    await expect(b.wait()).rejects.toBeInstanceOf(BarrierError);
  });

  it('breaks immediately when a party fails preparation', async () => {
    const b = new Barrier(['a', 'b'], 10_000);
    b.break('b', 'locator not found');
    const err = (await b.wait().catch((e: unknown) => e)) as BarrierError;
    expect(err.reason).toBe('broken');
    expect(err.message).toContain('locator not found');
    void b.arrive('a').catch(() => undefined);
    await expect(b.wait()).rejects.toBeInstanceOf(BarrierError);
  });

  it('rejects unknown parties', () => {
    const b = new Barrier(['a'], 100);
    expect(() => b.arrive('zzz')).toThrow(/unknown barrier party/);
    b.dispose();
  });
});
