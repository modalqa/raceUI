import type { Browser, BrowserContext, Locator, Page, Request } from 'playwright';
import type { Actor, PrepareStep, RaceAction, TimingConfig } from '../schema/scenario.js';
import type { OriginPolicy } from '../security/origin.js';
import type { Redactor } from '../security/redact.js';
import type { RequestRecord } from '../reporters/types.js';
import { applyRuntime } from './http.js';
import { round } from './scheduler.js';

type RequestFilter = NonNullable<TimingConfig['requestFilter']>;

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

/**
 * One actor = one isolated BrowserContext (own cookies, storage, cache) and one page (FR-02).
 * Requests to unapproved origins are aborted and service workers are blocked (best effort,
 * not a network sandbox).
 */
export class ActorSession {
  readonly requests: RequestRecord[] = [];
  readonly blocked: string[] = [];
  private releaseAt: number | null = null;
  private dispatchAt: number | null = null;
  private readonly live = new Map<Request, RequestRecord>();
  private inflight = 0;
  private closed = false;

  private constructor(
    readonly actor: Actor,
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly policy: OriginPolicy,
    private readonly redactor: Redactor,
  ) {}

  static async create(
    browser: Browser,
    actor: Actor,
    opts: { storageState?: string; policy: OriginPolicy; redactor: Redactor; actionTimeoutMs: number; trace?: boolean },
  ): Promise<ActorSession> {
    const context = await browser.newContext({
      storageState: opts.storageState,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    try {
      if (opts.trace) await context.tracing.start({ screenshots: true, snapshots: true, title: actor.id });
      const page = await context.newPage();
      page.setDefaultTimeout(opts.actionTimeoutMs);
      page.setDefaultNavigationTimeout(Math.max(opts.actionTimeoutMs, 15_000));
      const session = new ActorSession(actor, context, page, opts.policy, opts.redactor);
      await session.install();
      return session;
    } catch (err) {
      await context.close().catch(() => undefined);
      throw err;
    }
  }

  private async install(): Promise<void> {
    await this.context.route('**/*', async (route) => {
      const url = route.request().url();
      if (this.policy.isAllowedBrowserRequest(url)) return route.continue();
      this.blocked.push(this.redactor.url(url));
      return route.abort('blockedbyclient');
    });
    this.page.on('request', (req) => {
      if (this.releaseAt === null) return;
      this.inflight++;
      const rec: RequestRecord = {
        method: req.method(),
        url: this.redactor.url(req.url()),
        resourceType: req.resourceType(),
        startMs: round(performance.now() - this.releaseAt),
      };
      this.live.set(req, rec);
      this.requests.push(rec);
    });
    const done = (req: Request, failure?: string) => {
      const rec = this.live.get(req);
      if (!rec) return;
      this.live.delete(req);
      this.inflight = Math.max(0, this.inflight - 1);
      if (failure) {
        rec.failure = failure;
        if (failure.includes('BLOCKED_BY_CLIENT')) rec.blocked = true;
      }
    };
    this.page.on('response', (res) => {
      const rec = this.live.get(res.request());
      if (rec && this.releaseAt !== null) {
        rec.status = res.status();
        rec.responseMs = round(performance.now() - this.releaseAt);
      }
    });
    this.page.on('requestfinished', (req) => done(req));
    this.page.on('requestfailed', (req) => done(req, req.failure()?.errorText ?? 'failed'));
  }

  /** Runs preparation steps in order (FR-03). */
  async prepare(steps: PrepareStep[], vars: Record<string, string>): Promise<void> {
    for (const [i, step] of steps.entries()) {
      try {
        if ('navigate' in step) {
          const url = this.policy.resolve(applyRuntime(step.navigate, vars));
          const res = await this.page.goto(url, { waitUntil: 'load' });
          if (!this.policy.isAllowed(this.page.url())) throw new Error(`navigation ended on unapproved origin ${new URL(this.page.url()).origin}`);
          if (res && res.status() >= 400) throw new Error(`navigation returned HTTP ${res.status()}`);
        } else if ('fill' in step) {
          await this.locator(applyRuntime(step.fill.selector, vars)).fill(applyRuntime(step.fill.value, vars));
        } else if ('click' in step) {
          await this.locator(applyRuntime(step.click, vars)).click();
        } else {
          await this.locator(applyRuntime(step.waitFor, vars)).waitFor({ state: 'visible' });
        }
      } catch (err) {
        const kind = Object.keys(step)[0];
        throw new Error(`prepare step ${i + 1} (${kind}) failed: ${firstLine(err)}`);
      }
    }
  }

  /** Locator readiness check before arriving at the barrier: unique, visible, enabled. */
  async checkReady(race: RaceAction, vars: Record<string, string>): Promise<void> {
    const loc = this.locator(this.raceSelector(race, vars));
    await loc.first().waitFor({ state: 'visible' });
    const n = await loc.count();
    if (n !== 1) throw new Error(`race locator matched ${n} elements; it must be unique`);
    if (!(await loc.isEnabled())) throw new Error('race locator is disabled');
  }

  markRelease(at: number): void {
    this.releaseAt = at;
  }

  /** Executes the single race action (FR-06). Never retried by RaceUI. */
  async dispatch(race: RaceAction, vars: Record<string, string>, timeoutMs: number): Promise<{ dispatchMs: number; dispatchedAt: string; completedMs?: number; error?: string }> {
    const loc = this.locator(this.raceSelector(race, vars));
    const t = performance.now();
    this.dispatchAt = t;
    const dispatchedAt = new Date().toISOString();
    const dispatchMs = round(t - (this.releaseAt ?? t));
    try {
      if ('click' in race) await loc.click({ timeout: timeoutMs });
      else await loc.press(race.press.key, { timeout: timeoutMs });
      return { dispatchMs, dispatchedAt, completedMs: round(performance.now() - (this.releaseAt ?? t)) };
    } catch (err) {
      return { dispatchMs, dispatchedAt, error: firstLine(err) };
    }
  }

  /** Waits until no tracked request is in flight, bounded by `timeoutMs`. */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (this.inflight === 0) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return this.inflight === 0;
  }

  /** Returns whether `text` is visible (exact match) on this actor's page. */
  async hasVisibleText(text: string): Promise<boolean> {
    const loc = this.page.getByText(text, { exact: true });
    const n = Math.min(await loc.count(), 20);
    for (let i = 0; i < n; i++) {
      if (await loc.nth(i).isVisible()) return true;
    }
    return false;
  }

  /**
   * Identifies the target request (PRD §7.2): with a filter, the first match after dispatch;
   * otherwise a heuristic (single non-GET fetch/xhr). Ambiguity is labeled, never guessed.
   */
  targetRequest(filter: RequestFilter | undefined, vars: Record<string, string>): { request: RequestRecord | null; note?: string } {
    const dispatchRel = this.dispatchAt !== null && this.releaseAt !== null ? this.dispatchAt - this.releaseAt : 0;
    const after = this.requests.filter((r) => r.startMs >= dispatchRel - 1);
    let candidates: RequestRecord[];
    let mode: 'filter' | 'heuristic';
    if (filter) {
      mode = 'filter';
      const method = filter.method?.toUpperCase();
      const path = filter.path ? applyRuntime(filter.path, vars) : undefined;
      const re = filter.urlPattern ? globToRegExp(applyRuntime(filter.urlPattern, vars)) : undefined;
      candidates = after.filter((r) => {
        if (method && r.method !== method) return false;
        let u: URL | undefined;
        try {
          u = new URL(r.url);
        } catch {
          return false;
        }
        if (path && u.pathname !== path) return false;
        if (re && !re.test(r.url)) return false;
        return true;
      });
    } else {
      mode = 'heuristic';
      candidates = after.filter((r) => r.method !== 'GET' && (r.resourceType === 'fetch' || r.resourceType === 'xhr' || r.resourceType === 'document'));
    }
    for (const c of candidates) c.target = true;
    if (candidates.length === 0) return { request: null, note: mode === 'filter' ? 'no request matched timing.requestFilter' : 'no state-changing request observed (configure timing.requestFilter to identify it)' };
    if (candidates.length > 1) return { request: candidates[0] ?? null, note: `ambiguous: ${candidates.length} requests matched (${mode}); first one shown` };
    return { request: candidates[0] ?? null, ...(mode === 'heuristic' ? { note: 'identified heuristically (single non-GET request after dispatch)' } : {}) };
  }

  /** Stops tracing; saves the trace zip when `file` is given, otherwise discards it. */
  async stopTrace(file?: string): Promise<void> {
    await this.context.tracing.stop(file ? { path: file } : undefined);
  }

  async screenshot(file: string): Promise<void> {
    await this.page.screenshot({ path: file, fullPage: true, timeout: 10_000 });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close().catch(() => undefined);
  }

  private raceSelector(race: RaceAction, vars: Record<string, string>): string {
    return applyRuntime('click' in race ? race.click : race.press.selector, vars);
  }

  private locator(selector: string): Locator {
    return this.page.locator(selector);
  }
}

export function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0]?.trim() ?? msg;
}
