import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM module without type declarations
import { createPlayground } from '../../playground/server.mjs';
import { runScenario, resolveRunConfig } from '../../src/engine/runner.js';
import { loadScenario } from '../../src/schema/load.js';
import { PolicyError } from '../../src/security/origin.js';

const TOKEN = 'integration-secret-token';
process.env.RACEUI_FIXTURE_TOKEN = TOKEN;

interface Playground {
  baseUrl: string;
  state: { seats: Map<string, unknown[]>; attendance: unknown[] };
  close: () => Promise<void>;
}

async function start(mode: 'vulnerable' | 'fixed'): Promise<Playground> {
  const pg = createPlayground({ mode, delay: 120, token: TOKEN });
  await new Promise<void>((r) => pg.server.listen(0, '127.0.0.1', () => r()));
  const { port } = pg.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state: pg.state,
    close: () => new Promise<void>((r) => { pg.server.closeAllConnections?.(); pg.server.close(() => r()); }),
  };
}

const auth = `Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'`;

function bookingYaml(baseUrl: string, opts: { repeat?: number; userBSelector?: string; baselineEquals?: number; extraChecks?: string; checks?: string } = {}): string {
  return `
version: 1
name: booking-it
baseUrl: ${baseUrl}
actors:
  - id: user-a
    prepare:
      - navigate: /login?user=alice&next=/booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'
  - id: user-b
    prepare:
      - navigate: /login?user=bob&next=/booking/seat-01
      - waitFor: '${opts.userBSelector ?? '[data-testid="confirm-booking"]'}'
    race:
      click: '[data-testid="confirm-booking"]'
fixtures:
  reset:
    method: POST
    path: /test-support/reset
    headers:
      ${auth}
  baseline:
    get: /test-support/seat-01/booking-count
    headers:
      ${auth}
    pointer: /count
    equals: ${opts.baselineEquals ?? 0}
timing:
  mode: simultaneous
  maxDispatchSkewMs: 100
  barrierTimeoutMs: 8000
  prepareTimeoutMs: 4000
  actionTimeoutMs: 3000
  requestFilter:
    method: POST
    path: /api/bookings
assertions:
  settleMs: 200
  timeoutMs: 2000
  checks:
${opts.checks ?? `    - ui:
        text: Booking successful
        count:
          equals: 1
    - api:
        get: /test-support/seat-01/booking-count
        headers:
          ${auth}
        pointer: /count
        equals: 1`}
${opts.extraChecks ?? ''}
run:
  repeat: ${opts.repeat ?? 2}
  seed: 42
`;
}

let dir: string;
const write = (name: string, text: string) => {
  const f = path.join(dir, name);
  writeFileSync(f, text, 'utf8');
  return f;
};
const run = (file: string, extra: Partial<Parameters<typeof runScenario>[1]> = {}) =>
  runScenario(loadScenario(file), { outputDir: path.join(dir, 'artifacts'), ...extra });

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'raceui-it-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('vulnerable playground', () => {
  let pg: Playground;
  beforeAll(async () => (pg = await start('vulnerable')));
  afterAll(() => pg.close());

  it('detects a verified duplicate booking (committed count > 1)', async () => {
    const { report, reportPath } = await run(write('vuln.yaml', bookingYaml(pg.baseUrl, { repeat: 3 })));
    expect(report.status).toBe('FAIL');
    expect(report.exitCode).toBe(1);
    expect(report.summary.failed).toBeGreaterThanOrEqual(1);
    const failed = report.attempts.find((a) => a.status === 'FAIL')!;
    expect(failed.failureKind).toBe('invariant-violation');
    const api = failed.assertions.find((a) => a.type === 'api')!;
    expect(api.observed as number).toBeGreaterThan(1);
    // Evidence on failure, paths relative to the report root.
    expect(failed.evidence).toContain(`attempt-${String(failed.index).padStart(3, '0')}/user-a.png`);
    const json = readFileSync(reportPath, 'utf8');
    expect(JSON.parse(json).schemaVersion).toBe(1);
    // Secrets never appear in the report.
    expect(json).not.toContain(TOKEN);
    for (const a of failed.actors) expect(a.targetRequest?.method).toBe('POST');
  });

  it('UI looks acceptable but the authoritative API count is wrong -> FAIL', async () => {
    const checks = `    - ui:
        text: Booking successful
        count:
          min: 1
    - api:
        get: /test-support/seat-01/booking-count
        headers:
          ${auth}
        pointer: /count
        equals: 1`;
    const { report } = await run(write('ui-ok-api-bad.yaml', bookingYaml(pg.baseUrl, { repeat: 1, checks })));
    expect(report.status).toBe('FAIL');
    const a = report.attempts[0]!;
    expect(a.assertions.find((x) => x.type === 'ui')!.status).toBe('PASS');
    expect(a.failureKind).toBe('invariant-violation');
  });

  it('stops with --stop-on-fail and marks skipped attempts', async () => {
    const { report } = await run(write('stop.yaml', bookingYaml(pg.baseUrl, { repeat: 4 })), { stopOnFail: true });
    expect(report.attempts[0]!.status).toBe('FAIL');
    expect(report.summary.skipped).toBe(3);
    expect(report.exitCode).toBe(1);
  });
});

describe('fixed playground', () => {
  let pg: Playground;
  beforeAll(async () => (pg = await start('fixed')));
  afterAll(() => pg.close());

  it('passes: exactly one booking, the losing actor sees the expected rejection, sessions isolated', async () => {
    const extraChecks = `    - ui:
        text: Seat unavailable
        count:
          equals: 1
    - ui:
        actor: user-a
        text: alice
    - ui:
        actor: user-b
        text: bob`;
    const { report } = await run(write('fixed.yaml', bookingYaml(pg.baseUrl, { repeat: 3, extraChecks })));
    expect(report.attempts.map((a) => a.status)).toEqual(['PASS', 'PASS', 'PASS']);
    expect(report.exitCode).toBe(0);
    for (const a of report.attempts) expect(a.timing?.quality).toBe('within-threshold');
  });

  it('same account in two contexts: duplicate attendance is prevented', async () => {
    const yaml = `
version: 1
name: attendance-it
baseUrl: ${pg.baseUrl}
actors:
  - id: laptop
    prepare:
      - navigate: /login?user=emp-9&next=/attendance
    race:
      click: '[data-testid="clock-in"]'
  - id: phone
    prepare:
      - navigate: /login?user=emp-9&next=/attendance
    race:
      click: '[data-testid="clock-in"]'
assertions:
  settleMs: 200
  timeoutMs: 2000
  checks:
    - api:
        get: /test-support/attendance/emp-9/count
        headers:
          ${auth}
        pointer: /count
        max: 1
    - ui:
        text: Already clocked in
        count:
          equals: 1
`;
    const { report } = await run(write('attendance.yaml', yaml));
    expect(report.status).toBe('PASS');
  });

  it('delayed/missing actor: no partial release, attempt INCONCLUSIVE', async () => {
    const { report } = await run(write('missing.yaml', bookingYaml(pg.baseUrl, { repeat: 1, userBSelector: '[data-testid="does-not-exist"]' })));
    const a = report.attempts[0]!;
    expect(a.status).toBe('INCONCLUSIVE');
    expect(a.actors.every((x) => x.action === 'not-dispatched')).toBe(true);
    expect(a.actors.find((x) => x.id === 'user-b')!.prepare.status).toBe('failed');
    expect(pg.state.seats.get('seat-01') ?? []).toHaveLength(0); // nothing was booked
    expect(report.exitCode).toBe(3);
  });

  it('incorrect baseline: no race mutation, unsafe repeat stops', async () => {
    const { report } = await run(write('baseline.yaml', bookingYaml(pg.baseUrl, { repeat: 3, baselineEquals: 5 })));
    expect(report.attempts[0]!.status).toBe('INCONCLUSIVE');
    expect(report.attempts[0]!.fixture.baseline.status).toBe('FAIL');
    expect(report.attempts.slice(1).every((a) => a.status === 'SKIPPED')).toBe(true);
    expect(report.exitCode).toBe(3);
    expect(pg.state.seats.get('seat-01') ?? []).toHaveLength(0);
  });

  it('verification outage is INCONCLUSIVE', async () => {
    const checks = `    - api:
        get: /test-support/does-not-exist
        headers:
          ${auth}
        pointer: /count
        equals: 1`;
    const { report } = await run(write('outage.yaml', bookingYaml(pg.baseUrl, { repeat: 1, checks })));
    expect(report.attempts[0]!.status).toBe('INCONCLUSIVE');
    expect(report.attempts[0]!.assertions[0]!.status).toBe('ERROR');
  });

  it('interrupt: closes contexts and writes a partial report with exit 130', async () => {
    const ctrl = new AbortController();
    const p = run(write('interrupt.yaml', bookingYaml(pg.baseUrl, { repeat: 5 })), {
      signal: ctrl.signal,
      onProgress: (m) => {
        if (m.startsWith('Attempt 02/')) ctrl.abort();
      },
    });
    const { report, reportPath } = await p;
    expect(report.interrupted).toBe(true);
    expect(report.exitCode).toBe(130);
    expect(report.summary.skipped).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).interrupted).toBe(true);
  });

  it('non-approved external target fails policy before any action', () => {
    const f = write('external.yaml', bookingYaml('https://staging.example.com', { repeat: 1 }));
    expect(() => resolveRunConfig(loadScenario(f), {})).toThrow(PolicyError);
  });
});
