import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from '../../src/reporters/html.js';
import type { RunReport } from '../../src/reporters/types.js';

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    schemaVersion: 1,
    tool: { name: 'raceui', version: '0.1.0' },
    runId: 'r1',
    scenario: 'demo',
    scenarioFile: 'demo.yaml',
    seed: 1,
    status: 'FAIL',
    exitCode: 1,
    interrupted: false,
    startedAt: '2026-01-01T00:00:00Z',
    summary: { requested: 1, executed: 1, passed: 0, failed: 1, inconclusive: 0, skipped: 0 },
    environment: { node: 'v22', platform: 'linux', arch: 'x64', browser: 'chromium', headed: false },
    config: { repeat: 1, seed: 1, evidence: 'on-failure', stopOnFail: false, targetOrigin: 'http://127.0.0.1', allowOrigins: [], overrides: {}, timing: {}, fixtures: null, scenario: {} },
    attempts: [{
      index: 1,
      status: 'FAIL',
      failureKind: 'invariant-violation',
      reasons: ['<script>alert(1)</script>'],
      fixture: { reset: { status: 'ok' }, baseline: { status: 'PASS' } },
      actors: [{ id: 'a', prepare: { status: 'ok' }, action: 'completed', requestCount: 0, screenshot: 'javascript:alert(1)' }],
      assertions: [{ index: 0, type: 'api', source: 'GET /x#/n', expected: 1, comparison: { equals: 1 }, observed: 2, status: 'FAIL', observations: 1 }],
      errors: [],
      notes: [],
      evidence: ['attempt-001/requests.json', '../../etc/passwd'],
    }],
    errors: [],
    limitations: ['limit'],
    ...overrides,
  };
}

describe('renderHtmlReport', () => {
  it('is static and escapes untrusted content', () => {
    const html = renderHtmlReport(report());
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('href="../../etc/passwd"');
    expect(html).toContain('href="attempt-001/requests.json"');
    expect(html).toContain("default-src 'none'");
  });
  it('shows status, summary and assertion values', () => {
    const html = renderHtmlReport(report());
    expect(html).toContain('<title>RaceUI report: demo (FAIL)</title>');
    expect(html).toContain('GET /x#/n');
  });
});
