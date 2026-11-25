export class BarrierError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
    public readonly reason: 'timeout' | 'broken',
  ) {
    super(message);
    this.name = 'BarrierError';
  }
}

/**
 * Readiness barrier (PRD FR-04, NFR-05). Every party must arrive before `wait()` resolves.
 * If any party breaks the barrier or the timeout elapses, `wait()` rejects and no race action
 * may be released: there is never a partial release.
 *
 * This is an in-process software synchronization point, not a network or database lock.
 */
export class Barrier {
  private readonly arrived = new Map<string, number>();
  private readonly parties: Set<string>;
  private settled = false;
  private resolveFn!: (arrivals: Map<string, number>) => void;
  private rejectFn!: (err: BarrierError) => void;
  private timer: NodeJS.Timeout | undefined;
  private readonly promise: Promise<Map<string, number>>;

  constructor(parties: string[], private readonly timeoutMs: number, private readonly now: () => number = () => performance.now()) {
    if (parties.length === 0) throw new Error('barrier requires at least one party');
    this.parties = new Set(parties);
    this.promise = new Promise((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
    // Avoid unhandled rejection noise if nobody awaits yet; callers still observe it via wait().
    this.promise.catch(() => undefined);
    this.timer = setTimeout(() => {
      this.fail(new BarrierError(`readiness barrier timed out after ${timeoutMs} ms`, this.missing(), 'timeout'));
    }, timeoutMs);
  }

  missing(): string[] {
    return [...this.parties].filter((p) => !this.arrived.has(p));
  }

  get isSettled(): boolean {
    return this.settled;
  }

  /** Marks `party` as ready. Returns the barrier promise (resolves at release). */
  arrive(party: string): Promise<Map<string, number>> {
    if (!this.parties.has(party)) throw new Error(`unknown barrier party "${party}"`);
    if (!this.settled && !this.arrived.has(party)) {
      this.arrived.set(party, this.now());
      if (this.arrived.size === this.parties.size) {
        this.settled = true;
        clearTimeout(this.timer);
        this.resolveFn(new Map(this.arrived));
      }
    }
    return this.promise;
  }

  /** Breaks the barrier (e.g. a party failed preparation). */
  break(party: string, reason: string): void {
    this.fail(new BarrierError(`actor "${party}" cannot reach the barrier: ${reason}`, this.missing(), 'broken'));
  }

  wait(): Promise<Map<string, number>> {
    return this.promise;
  }

  dispose(): void {
    this.fail(new BarrierError('barrier disposed', this.missing(), 'broken'));
  }

  private fail(err: BarrierError): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.rejectFn(err);
  }
}
