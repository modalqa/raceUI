import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { aggregateStatus, classifyAttempt, EXIT } from '../assertions/classify.js';
import { evaluateChecks } from '../assertions/engine.js';
import { EvidenceCollector, safeName, type EvidenceMode } from '../evidence/collector.js';
import { checkRepeatPolicy, ConfigError, type LoadedScenario } from '../schema/load.js';
import { LIMITS } from '../schema/scenario.js';
import { createPolicy, type OriginPolicy } from '../security/origin.js';
import { Redactor } from '../security/redact.js';
import {
  REPORT_SCHEMA_VERSION,
  type ActorResult,
  type AssertionResult,
  type AttemptResult,
  type AttemptTiming,
  type RunReport,
} from '../reporters/types.js';
import { VERSION } from '../version.js';
import { Barrier, BarrierError } from './barrier.js';
import { FixtureManager } from './fixtures.js';
import { attemptSeed, evaluateTiming, planOffsets, randomSeed, sleepUntil } from './scheduler.js';
import { ActorSession, firstLine } from './sessions.js';

export interface RunOptions {
  outputDir: string;
  repeat?: number;
  seed?: number;
  headed?: boolean;
  evidence?: EvidenceMode;
  stopOnFail?: boolean;
  allowOrigins?: string[];
  signal?: AbortSignal;
  /** Progress lines (attempt started / finished). */
  onProgress?: (msg: string) => void;
}

export interface RunOutcome {
  report: RunReport;
  reportPath: string;
  runDir: string;
}

class Interrupted extends Error {
  constructor() {
    super('interrupted');
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

/**
 * Validates options (repeat policy, target policy) without launching anything. Throws
 * ConfigError / PolicyError, which map to exit code 2.
 */
export function resolveRunConfig(loaded: LoadedScenario, opts: Pick<RunOptions, 'repeat' | 'seed' | 'allowOrigins' | 'evidence' | 'headed'>) {
  const s = loaded.scenario;
  const repeat = opts.repeat ?? s.run.repeat;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > LIMITS.maxRepeat) {
    throw new ConfigError([`repeat must be an integer between 1 and ${LIMITS.maxRepeat}`]);
  }
  const seed = opts.seed ?? s.run.seed ?? randomSeed();
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) throw new ConfigError(['seed must be an integer between 0 and 4294967295']);
  const repeatIssues = checkRepeatPolicy(s, repeat);
  if (repeatIssues.length) throw new ConfigError(repeatIssues);
  const policy = createPolicy(s.baseUrl, opts.allowOrigins ?? []);
  const overrides: Record<string, unknown> = {};
  if (opts.repeat !== undefined) overrides.repeat = opts.repeat;
  if (opts.seed !== undefined) overrides.seed = opts.seed;
  if (opts.evidence !== undefined) overrides.evidence = opts.evidence;
  if (opts.headed !== undefined) overrides.headed = opts.headed;
  return {
    repeat,
    seed,
    policy,
    evidence: opts.evidence ?? s.run.evidence,
    headed: opts.headed ?? s.run.headed,
    overrides,
  };
}

export async function runScenario(loaded: LoadedScenario, opts: RunOptions): Promise<RunOutcome> {
  const s = loaded.scenario;
  const cfg = resolveRunConfig(loaded, opts);
  const { repeat, seed, policy } = cfg;
  const redactor = new Redactor(loaded.secrets);
  // Register configured header values as secrets as well.
  redactor.deep({ headers: s.fixtures?.reset?.headers });
  redactor.deep({ headers: s.fixtures?.setup?.headers });
  redactor.deep({ headers: s.fixtures?.baseline?.headers });
  for (const c of s.assertions.checks) if ('api' in c) redactor.deep({ headers: c.api.headers });

  const runId = newRunId();
  const runDir = path.resolve(opts.outputDir, runId);
  mkdirSync(runDir, { recursive: true });
  const reportPath = path.join(runDir, 'report.json');
  const evidence = new EvidenceCollector(runDir, cfg.evidence);
  const fixtures = new FixtureManager(s, policy);
  const progress = opts.onProgress ?? (() => undefined);

  const report: RunReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'raceui', version: VERSION },
    runId,
    scenario: s.name,
    scenarioFile: path.relative(process.cwd(), loaded.file) || loaded.file,
    seed,
    status: 'INCONCLUSIVE',
    exitCode: EXIT.INCONCLUSIVE,
    interrupted: false,
    startedAt: new Date().toISOString(),
    summary: { requested: repeat, executed: 0, passed: 0, failed: 0, inconclusive: 0, skipped: 0 },
    environment: { node: process.version, platform: process.platform, arch: process.arch, browser: s.run.browser, headed: cfg.headed },
    config: {
      repeat,
      seed,
      evidence: cfg.evidence,
      stopOnFail: !!opts.stopOnFail,
      targetOrigin: policy.targetOrigin,
      allowOrigins: policy.explicitOrigins,
      overrides: cfg.overrides,
      timing: s.timing,
      fixtures: redactor.deep(s.fixtures ?? null),
      scenario: redactor.deep(loaded.raw),
    },
    attempts: [],
    errors: [],
    limitations: [
      'Barrier release is a client-side software synchronization; it does not guarantee server-side simultaneity.',
      'Request timings are browser-side observations, not server receive times.',
      'Replaying a seed reproduces planned offsets only, not OS scheduling, network behavior or server ordering.',
      'Passing attempts mean no violation was detected in these attempts, not that the system is race-free.',
    ],
  };

  const writeReport = () => writeFileSync(reportPath, JSON.stringify(redactor.deep(report), null, 2) + '\n', 'utf8');

  let browser: Browser | undefined;
  let interrupted = false;
  const onAbort = () => {
    interrupted = true;
    void browser?.close().catch(() => undefined);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const checkAbort = () => {
    if (interrupted || opts.signal?.aborted) {
      interrupted = true;
      throw new Interrupted();
    }
  };

  const skipFrom = (from: number, reason: string) => {
    for (let j = from; j <= repeat; j++) {
      report.attempts.push({
        index: j,
        status: 'SKIPPED',
        reasons: [reason],
        fixture: { reset: { status: 'skipped' }, baseline: { status: 'skipped' } },
        actors: [],
        assertions: [],
        errors: [],
        notes: [],
        evidence: [],
      });
    }
  };

  try {
    checkAbort();
    browser = await chromium.launch({ headless: !cfg.headed });
    report.environment.browserVersion = browser.version();

    const setup = await fixtures.setup({ RUN_ID: runId });
    if (setup.status !== 'not-configured') report.setup = setup;
    if (setup.status === 'failed') {
      report.errors.push(`fixture setup failed: ${setup.error}`);
      skipFrom(1, 'fixture setup failed; no attempt was started');
    } else {
      for (let i = 1; i <= repeat; i++) {
        checkAbort();
        progress(`Attempt ${String(i).padStart(2, '0')}/${repeat} ...`);
        const { attempt, stop } = await runAttempt(i);
        report.attempts.push(attempt);
        progress(`Attempt ${String(i).padStart(2, '0')}: ${attempt.status}${attempt.reasons[0] ? ` - ${attempt.reasons[0]}` : ''}`);
        writeReport(); // keep a partial report on disk after every attempt
        if (stop) {
          report.errors.push(`stopped after attempt ${i}: ${stop}`);
          skipFrom(i + 1, `not executed: ${stop}`);
          break;
        }
        if (opts.stopOnFail && attempt.status === 'FAIL') {
          skipFrom(i + 1, 'not executed: --stop-on-fail after a confirmed failure');
          break;
        }
      }
    }
  } catch (err) {
    const partial = (err as { attempt?: AttemptResult }).attempt;
    if (partial) report.attempts.push(partial);
    if (!(err instanceof Interrupted) && !interrupted) report.errors.push(`run error: ${redactor.text(firstLine(err))}`);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    await browser?.close().catch(() => undefined);
  }

  if (interrupted) {
    report.interrupted = true;
    report.errors.push('run interrupted by user');
    skipFrom(report.attempts.length + 1, 'not executed: run interrupted');
  } else if (report.attempts.length < repeat) {
    skipFrom(report.attempts.length + 1, 'not executed: run aborted by an infrastructure error');
  }

  const statuses = report.attempts.map((a) => a.status);
  report.summary = {
    requested: repeat,
    executed: report.attempts.filter((a) => a.status !== 'SKIPPED').length,
    passed: statuses.filter((x) => x === 'PASS').length,
    failed: statuses.filter((x) => x === 'FAIL').length,
    inconclusive: statuses.filter((x) => x === 'INCONCLUSIVE').length,
    skipped: statuses.filter((x) => x === 'SKIPPED').length,
  };
  const agg = aggregateStatus(statuses, repeat);
  report.status = agg.status;
  report.exitCode = interrupted ? EXIT.INTERRUPTED : agg.exitCode;
  report.finishedAt = new Date().toISOString();
  writeReport();
  return { report: redactor.deep(report), reportPath, runDir };

  // ---------------------------------------------------------------- attempt
  async function runAttempt(index: number): Promise<{ attempt: AttemptResult; stop?: string }> {
    const started = performance.now();
    const vars: Record<string, string> = { RUN_ID: runId, ATTEMPT: String(index).padStart(3, '0') };
    const resourceId = fixtures.resourceId(vars);
    if (resourceId) vars.RESOURCE_ID = resourceId;
    const aSeed = attemptSeed(seed, index);
    const ids = s.actors.map((a) => a.id);
    const planned = planOffsets(s.timing, ids, aSeed);

    const attempt: AttemptResult = {
      index,
      status: 'INCONCLUSIVE',
      reasons: [],
      ...(resourceId ? { resourceId } : {}),
      startedAt: new Date().toISOString(),
      fixture: { reset: { status: 'not-configured' }, baseline: { status: 'not-configured' } },
      actors: s.actors.map((a) => ({
        id: a.id,
        ...(a.storageState ? { storageState: a.storageState } : {}),
        prepare: { status: 'not-started' },
        plannedOffsetMs: planned[a.id],
        action: 'not-dispatched',
        requestCount: 0,
      })),
      assertions: [],
      errors: [],
      notes: [],
      evidence: [],
    };
    const actorResult = (id: string) => attempt.actors.find((a) => a.id === id) as ActorResult;
    const finish = (stop?: string) => {
      attempt.durationMs = Math.round(performance.now() - started);
      return { attempt, ...(stop ? { stop } : {}) };
    };
    const notReleased = (reason: string) => {
      const c = classifyAttempt({ released: false, notReleasedReason: reason, actionErrors: [], assertions: [], missingEvidence: [] });
      attempt.status = c.status;
      attempt.reasons = c.reasons;
      attempt.notes.push(...c.notes);
    };

    // 1. Fixture reset + baseline: must hold before any browser mutation.
    attempt.fixture.reset = await fixtures.reset(vars);
    if (attempt.fixture.reset.status === 'failed') {
      notReleased(`fixture reset failed: ${attempt.fixture.reset.error}`);
      return finish('fixture reset failed; continuing could race against an unknown state');
    }
    attempt.fixture.baseline = await fixtures.baseline(vars);
    if (attempt.fixture.baseline.status === 'FAIL' || attempt.fixture.baseline.status === 'ERROR') {
      const b = attempt.fixture.baseline;
      notReleased(`baseline not satisfied (${b.source}): ${b.reason}`);
      return finish('baseline verification failed; refusing to race against an unverified state');
    }
    checkAbort();

    // 2. Isolated contexts.
    const sessions = new Map<string, ActorSession>();
    let timing: AttemptTiming | undefined;
    try {
      try {
        for (const a of s.actors) {
          sessions.set(a.id, await ActorSession.create(browser!, a, {
            storageState: loaded.storageStates[a.id],
            policy,
            redactor,
            actionTimeoutMs: s.timing.actionTimeoutMs,
          }));
        }
      } catch (err) {
        checkAbort();
        notReleased(`browser context creation failed: ${firstLine(err)}`);
        return finish('browser infrastructure error');
      }

      // 3. Prepare in parallel, check readiness, arrive at barrier.
      const barrier = new Barrier(ids, s.timing.barrierTimeoutMs);
      await Promise.all(s.actors.map(async (a) => {
        const r = actorResult(a.id);
        const session = sessions.get(a.id)!;
        const t0 = performance.now();
        try {
          await withTimeout((async () => {
            await session.prepare(a.prepare, vars);
            await session.checkReady(a.race, vars);
          })(), s.timing.prepareTimeoutMs, 'preparation');
          r.prepare = { status: 'ok', durationMs: Math.round(performance.now() - t0), completedAt: new Date().toISOString() };
          void barrier.arrive(a.id);
        } catch (err) {
          r.prepare = { status: 'failed', durationMs: Math.round(performance.now() - t0), error: redactor.text(firstLine(err)) };
          barrier.break(a.id, r.prepare.error ?? 'preparation failed');
        }
      }));

      try {
        await barrier.wait();
      } catch (err) {
        checkAbort();
        const be = err as BarrierError;
        notReleased(`readiness barrier not reached (${be.reason}): ${be.message}${be.missing.length ? `; not ready: ${be.missing.join(', ')}` : ''}`);
        await captureEvidence(index, attempt, sessions);
        return finish();
      }
      checkAbort();

      // 4. Release: schedule exactly one race action per actor (no retries).
      const releaseT = performance.now();
      const releasedAt = new Date().toISOString();
      for (const sess of sessions.values()) sess.markRelease(releaseT);
      const dispatched: Record<string, number | undefined> = {};
      await Promise.all(s.actors.map(async (a) => {
        await sleepUntil(releaseT + (planned[a.id] ?? 0));
        const res = await sessions.get(a.id)!.dispatch(a.race, vars, s.timing.actionTimeoutMs);
        const r = actorResult(a.id);
        r.dispatchMs = res.dispatchMs;
        r.dispatchedAt = res.dispatchedAt;
        dispatched[a.id] = res.dispatchMs;
        if (res.error) {
          r.action = 'error';
          r.actionError = redactor.text(res.error);
        } else {
          r.action = 'completed';
          r.completedMs = res.completedMs;
        }
      }));
      checkAbort();
      const tq = evaluateTiming(s.timing.mode, planned, dispatched, s.timing.maxDispatchSkewMs);
      timing = { mode: s.timing.mode, seed: aSeed, plannedOffsetsMs: planned, releasedAt, ...tq };
      attempt.timing = timing;

      // 5. Observe: let in-flight requests finish, settle, then evaluate within a bounded window.
      await Promise.all([...sessions.values()].map((x) => x.waitForIdle(s.assertions.timeoutMs)));
      if (s.assertions.settleMs > 0) await new Promise((r) => setTimeout(r, s.assertions.settleMs));
      checkAbort();
      const assertions: AssertionResult[] = await evaluateChecks(s.assertions.checks, {
        sessions,
        policy,
        vars,
        timeoutMs: s.assertions.timeoutMs,
        pollMs: s.assertions.pollMs,
      });
      attempt.assertions = assertions;
      checkAbort();

      for (const a of s.actors) {
        const sess = sessions.get(a.id)!;
        const r = actorResult(a.id);
        const t = sess.targetRequest(s.timing.requestFilter, vars);
        r.targetRequest = t.request;
        if (t.note) r.targetRequestNote = t.note;
        r.requestCount = sess.requests.length;
        r.finalUrl = redactor.url(sess.page.url());
        if (sess.blocked.length) attempt.notes.push(`${a.id}: blocked ${sess.blocked.length} request(s) to unapproved origins (e.g. ${sess.blocked[0]})`);
      }

      // 6. Classify, then capture evidence.
      const actionErrors = attempt.actors.filter((r) => r.actionError).map((r) => `${r.id}: ${r.actionError}`);
      let c = classifyAttempt({ released: true, actionErrors, assertions, timing: tq, missingEvidence: [] });
      if (evidence.shouldCapture(c.status)) {
        const missing = await captureEvidence(index, attempt, sessions);
        if (missing.length) {
          if (cfg.evidence === 'always' && c.status === 'PASS') {
            c = classifyAttempt({ released: true, actionErrors, assertions, timing: tq, missingEvidence: missing });
          } else {
            attempt.notes.push(`evidence limitation: ${missing.join('; ')}`);
          }
        }
      }
      attempt.status = c.status;
      attempt.reasons = c.reasons;
      if (c.failureKind) attempt.failureKind = c.failureKind;
      attempt.notes.push(...c.notes);
      return finish();
    } catch (err) {
      if (err instanceof Interrupted || interrupted) {
        attempt.status = 'INCONCLUSIVE';
        attempt.reasons = ['interrupted before the attempt completed'];
        throw Object.assign(err instanceof Interrupted ? err : new Interrupted(), { attempt });
      }
      attempt.errors.push(redactor.text(firstLine(err)));
      attempt.status = 'INCONCLUSIVE';
      attempt.reasons = [`infrastructure error: ${redactor.text(firstLine(err))}`];
      return finish('infrastructure error; safe continuation cannot be established');
    } finally {
      // Close contexts before any subsequent fixture reset (PRD §7.1).
      await Promise.all([...sessions.values()].map((x) => x.close()));
    }
  }

  async function captureEvidence(index: number, attempt: AttemptResult, sessions: Map<string, ActorSession>): Promise<string[]> {
    if (cfg.evidence === 'none') return [];
    const missing: string[] = [];
    attempt.evidenceDir = evidence.attemptDirName(index);
    for (const [id, sess] of sessions) {
      const [abs, rel] = evidence.file(index, `${safeName(id)}.png`);
      try {
        await sess.screenshot(abs);
        attempt.evidence.push(rel);
        const r = attempt.actors.find((a) => a.id === id);
        if (r) r.screenshot = rel;
      } catch (err) {
        missing.push(`screenshot for ${id} (${firstLine(err)})`);
      }
    }
    const requests = Object.fromEntries([...sessions].map(([id, sess]) => [id, { requests: sess.requests, blocked: sess.blocked }]));
    attempt.evidence.push(evidence.writeJson(index, 'requests.json', redactor.deep({ note: 'Sanitized browser-side request metadata after barrier release. Bodies are not captured.', actors: requests })));
    attempt.evidence.push(evidence.writeJson(index, 'timing.json', {
      note: 'Offsets in ms relative to barrier release (monotonic runner clock). Timestamps are UTC wall-clock.',
      timing: attempt.timing ?? null,
      actors: attempt.actors.map((a) => ({
        id: a.id,
        prepare: a.prepare,
        plannedOffsetMs: a.plannedOffsetMs,
        dispatchMs: a.dispatchMs,
        dispatchedAt: a.dispatchedAt,
        completedMs: a.completedMs,
        action: a.action,
        actionError: a.actionError,
        targetRequest: a.targetRequest,
        targetRequestNote: a.targetRequestNote,
      })),
    }));
    return missing;
  }
}

export type { OriginPolicy };
