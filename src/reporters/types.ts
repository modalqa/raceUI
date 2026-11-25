import type { TimingQuality } from '../engine/scheduler.js';

export const REPORT_SCHEMA_VERSION = 1;

export type AttemptStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'SKIPPED';
export type RunStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type CheckStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'ERROR';

export interface AssertionResult {
  index: number;
  type: 'ui' | 'api';
  /** Where the observation came from, e.g. `ui:"Booking successful"` or `GET /test-support/count#/count`. */
  source: string;
  actor?: string;
  pointer?: string;
  expected: unknown;
  observed: unknown;
  status: CheckStatus;
  reason?: string;
  /** For ui checks: which actor pages showed the text in the final observation. */
  matchedActors?: string[];
  observations: number;
  observedAt?: string;
}

export interface RequestRecord {
  method: string;
  url: string;
  resourceType: string;
  /** ms relative to barrier release (monotonic). Browser/client-side observation, not server receive time. */
  startMs: number;
  responseMs?: number;
  status?: number;
  failure?: string;
  target?: boolean;
  blocked?: boolean;
}

export interface ActorResult {
  id: string;
  storageState?: string;
  prepare: { status: 'ok' | 'failed' | 'not-started'; durationMs?: number; completedAt?: string; error?: string };
  plannedOffsetMs?: number;
  /** Runner dispatch time, ms after barrier release (monotonic clock). */
  dispatchMs?: number;
  dispatchedAt?: string;
  /** Playwright action completion, ms after barrier release. */
  completedMs?: number;
  action: 'completed' | 'error' | 'not-dispatched';
  actionError?: string;
  targetRequest?: RequestRecord | null;
  targetRequestNote?: string;
  requestCount: number;
  finalUrl?: string;
  screenshot?: string;
}

export interface FixtureStepResult {
  status: 'ok' | 'failed' | 'not-configured' | 'skipped';
  httpStatus?: number;
  durationMs?: number;
  error?: string;
}

export interface BaselineResult {
  status: 'PASS' | 'FAIL' | 'ERROR' | 'not-configured' | 'skipped';
  source?: string;
  expected?: unknown;
  observed?: unknown;
  reason?: string;
}

export interface AttemptTiming extends TimingQuality {
  mode: 'simultaneous' | 'staggered' | 'jitter';
  seed: number;
  plannedOffsetsMs: Record<string, number>;
  releasedAt?: string;
}

export interface AttemptResult {
  index: number;
  status: AttemptStatus;
  /** For FAIL: whether authoritative (API) evidence exists or only UI outcomes mismatched. */
  failureKind?: 'invariant-violation' | 'ui-outcome-mismatch';
  reasons: string[];
  resourceId?: string;
  startedAt?: string;
  durationMs?: number;
  fixture: { reset: FixtureStepResult; baseline: BaselineResult };
  timing?: AttemptTiming;
  actors: ActorResult[];
  assertions: AssertionResult[];
  errors: string[];
  notes: string[];
  evidence: string[];
  evidenceDir?: string;
}

export interface RunReport {
  schemaVersion: number;
  tool: { name: 'raceui'; version: string };
  runId: string;
  scenario: string;
  scenarioFile: string;
  seed: number;
  status: RunStatus;
  exitCode: number;
  interrupted: boolean;
  startedAt: string;
  finishedAt?: string;
  summary: { requested: number; executed: number; passed: number; failed: number; inconclusive: number; skipped: number };
  environment: { node: string; platform: string; arch: string; browser: string; browserVersion?: string; headed: boolean };
  config: {
    repeat: number;
    seed: number;
    evidence: string;
    stopOnFail: boolean;
    targetOrigin: string;
    allowOrigins: string[];
    overrides: Record<string, unknown>;
    timing: unknown;
    fixtures: unknown;
    /** Scenario as written, with `${VAR}` placeholders unresolved and sensitive values redacted. */
    scenario: unknown;
  };
  setup?: FixtureStepResult;
  attempts: AttemptResult[];
  errors: string[];
  limitations: string[];
}
