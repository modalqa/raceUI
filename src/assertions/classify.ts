import type { TimingQuality } from '../engine/scheduler.js';
import type { AssertionResult, AttemptResult, AttemptStatus, RunStatus } from '../reporters/types.js';

export interface ClassifyInput {
  /** Whether race actions were released (barrier passed). */
  released: boolean;
  /** Reason the race was not released (fixture, baseline, preparation, barrier...). */
  notReleasedReason?: string;
  actionErrors: string[];
  assertions: AssertionResult[];
  timing?: TimingQuality;
  /** Required evidence that could not be captured. */
  missingEvidence: string[];
}

export interface Classification {
  status: Exclude<AttemptStatus, 'SKIPPED'>;
  failureKind?: AttemptResult['failureKind'];
  reasons: string[];
  notes: string[];
}

/**
 * Result classification (PRD §7.3).
 * - A verified business-rule violation takes precedence over timing uncertainty.
 * - A UI-only failure is labeled a UI outcome mismatch, and is not trusted when an actor's
 *   action errored (a failed locator is an execution error, not proof of a race).
 * - Anything else that prevents a sound verdict is INCONCLUSIVE.
 */
export function classifyAttempt(input: ClassifyInput): Classification {
  const reasons: string[] = [];
  const notes: string[] = [];

  if (!input.released) {
    return {
      status: 'INCONCLUSIVE',
      reasons: [input.notReleasedReason ?? 'race actions were not released'],
      notes: ['No race action was dispatched; no partial release occurred.'],
    };
  }

  const apiFails = input.assertions.filter((a) => a.type === 'api' && a.status === 'FAIL');
  const uiFails = input.assertions.filter((a) => a.type === 'ui' && a.status === 'FAIL');
  const uiTrusted = input.actionErrors.length === 0;
  const confirmed = [...apiFails, ...(uiTrusted ? uiFails : [])];

  if (confirmed.length > 0) {
    for (const a of confirmed) reasons.push(`${a.source}: ${a.reason ?? 'assertion failed'}`);
    const failureKind = apiFails.length > 0 ? 'invariant-violation' : 'ui-outcome-mismatch';
    if (failureKind === 'ui-outcome-mismatch') {
      notes.push('UI outcome mismatch only: no authoritative API check failed, so this is not automatically a persisted data conflict.');
    }
    if (input.timing?.quality === 'exceeded') {
      notes.push(`Timing caveat: dispatch timing exceeded the ${input.timing.thresholdMs} ms threshold; the violation is reported but should not be attributed to simultaneous requests.`);
    }
    if (input.actionErrors.length) notes.push(`Action errors also occurred: ${input.actionErrors.join('; ')}`);
    notes.push('Observed violation is client-side evidence; it does not by itself prove the server-side cause.');
    return { status: 'FAIL', failureKind, reasons, notes };
  }

  for (const e of input.actionErrors) reasons.push(`action error: ${e}`);
  if (!uiTrusted) {
    for (const a of uiFails) reasons.push(`${a.source}: UI mismatch not trusted because an action failed (${a.reason ?? 'assertion failed'})`);
  }
  for (const a of input.assertions) {
    if (a.status === 'ERROR' || a.status === 'INCONCLUSIVE') reasons.push(`${a.source}: verification unavailable (${a.reason ?? 'error'})`);
  }
  if (input.timing?.quality === 'exceeded') {
    const measured = input.timing.dispatchSkewMs;
    reasons.push(`timing threshold exceeded (skew ${measured} ms, max offset error ${input.timing.maxOffsetErrorMs} ms, threshold ${input.timing.thresholdMs} ms)`);
  } else if (input.timing?.quality === 'not-measured' && input.actionErrors.length === 0) {
    reasons.push('dispatch timing could not be measured');
  }
  for (const m of input.missingEvidence) reasons.push(`missing required evidence: ${m}`);

  if (reasons.length > 0) return { status: 'INCONCLUSIVE', reasons, notes };
  return { status: 'PASS', reasons: [], notes: ['No violation detected in this attempt; this does not prove the system is race-free.'] };
}

/** Exit codes (PRD §7.4). */
export const EXIT = {
  PASS: 0,
  FAIL: 1,
  CONFIG: 2,
  INCONCLUSIVE: 3,
  INTERRUPTED: 130,
} as const;

export function aggregateStatus(statuses: AttemptStatus[], requested: number): { status: RunStatus; exitCode: number } {
  if (statuses.includes('FAIL')) return { status: 'FAIL', exitCode: EXIT.FAIL };
  const passed = statuses.filter((s) => s === 'PASS').length;
  if (passed === requested && requested > 0) return { status: 'PASS', exitCode: EXIT.PASS };
  return { status: 'INCONCLUSIVE', exitCode: EXIT.INCONCLUSIVE };
}
