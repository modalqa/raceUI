import { describe, expect, it } from 'vitest';
import { aggregateStatus, classifyAttempt } from '../../src/assertions/classify.js';
import type { AssertionResult } from '../../src/reporters/types.js';

const ok = { dispatchSkewMs: 2, maxOffsetErrorMs: 2, thresholdMs: 50, quality: 'within-threshold' as const };
const exceeded = { ...ok, dispatchSkewMs: 120, quality: 'exceeded' as const };
const a = (type: 'ui' | 'api', status: AssertionResult['status']): AssertionResult => ({
  index: 0, type, source: `${type}:x`, expected: { equals: 1 }, observed: 2, status, observations: 1, reason: 'r',
});

describe('classifyAttempt', () => {
  it('PASS when invariants hold and timing is valid', () => {
    expect(classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'PASS'), a('ui', 'PASS')], timing: ok, missingEvidence: [] }).status).toBe('PASS');
  });
  it('INCONCLUSIVE when not released (barrier / baseline / reset)', () => {
    const c = classifyAttempt({ released: false, notReleasedReason: 'barrier timeout', actionErrors: [], assertions: [], missingEvidence: [] });
    expect(c.status).toBe('INCONCLUSIVE');
    expect(c.reasons[0]).toContain('barrier timeout');
  });
  it('FAIL with authoritative API evidence even when the UI looks fine', () => {
    const c = classifyAttempt({ released: true, actionErrors: [], assertions: [a('ui', 'PASS'), a('api', 'FAIL')], timing: ok, missingEvidence: [] });
    expect(c.status).toBe('FAIL');
    expect(c.failureKind).toBe('invariant-violation');
  });
  it('labels UI-only failures as UI outcome mismatch', () => {
    const c = classifyAttempt({ released: true, actionErrors: [], assertions: [a('ui', 'FAIL'), a('api', 'PASS')], timing: ok, missingEvidence: [] });
    expect(c.status).toBe('FAIL');
    expect(c.failureKind).toBe('ui-outcome-mismatch');
  });
  it('timing exceeded without violation is INCONCLUSIVE', () => {
    expect(classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'PASS')], timing: exceeded, missingEvidence: [] }).status).toBe('INCONCLUSIVE');
  });
  it('a verified violation takes precedence over timing uncertainty (with caveat)', () => {
    const c = classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'FAIL')], timing: exceeded, missingEvidence: [] });
    expect(c.status).toBe('FAIL');
    expect(c.notes.join(' ')).toMatch(/Timing caveat/);
  });
  it('a locator/action error with only UI mismatches is INCONCLUSIVE', () => {
    const c = classifyAttempt({ released: true, actionErrors: ['user-b: timeout'], assertions: [a('ui', 'FAIL')], timing: ok, missingEvidence: [] });
    expect(c.status).toBe('INCONCLUSIVE');
  });
  it('verification outage is INCONCLUSIVE unless another violation is established', () => {
    expect(classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'ERROR'), a('ui', 'PASS')], timing: ok, missingEvidence: [] }).status).toBe('INCONCLUSIVE');
    expect(classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'ERROR'), a('api', 'FAIL')], timing: ok, missingEvidence: [] }).status).toBe('FAIL');
  });
  it('missing required evidence is INCONCLUSIVE', () => {
    expect(classifyAttempt({ released: true, actionErrors: [], assertions: [a('api', 'PASS')], timing: ok, missingEvidence: ['screenshot'] }).status).toBe('INCONCLUSIVE');
  });
});

describe('aggregateStatus / exit codes', () => {
  it('maps statuses to documented exit codes', () => {
    expect(aggregateStatus(['PASS', 'PASS'], 2)).toEqual({ status: 'PASS', exitCode: 0 });
    expect(aggregateStatus(['PASS', 'FAIL', 'INCONCLUSIVE'], 3)).toEqual({ status: 'FAIL', exitCode: 1 });
    expect(aggregateStatus(['PASS', 'INCONCLUSIVE'], 2)).toEqual({ status: 'INCONCLUSIVE', exitCode: 3 });
    expect(aggregateStatus(['PASS', 'SKIPPED'], 2)).toEqual({ status: 'INCONCLUSIVE', exitCode: 3 });
  });
});
