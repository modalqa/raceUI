import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM module without type declarations
import { createPlayground } from '../../playground/server.mjs';
import { runScenario } from '../../src/engine/runner.js';
import { ConfigError, loadScenario } from '../../src/schema/load.js';

const TOKEN = 'extra-secret-token';
const SESSION_SECRET = 'super-secret-session-value-42';
process.env.RACEUI_FIXTURE_TOKEN = TOKEN;
process.env.PG_SESSION = SESSION_SECRET;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const auth = `Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'`;

interface Playground { baseUrl: string; close: () => Promise<void> }
async function start(mode: 'vulnerable' | 'fixed'): Promise<Playground> {
  const pg = createPlayground({ mode, delay: 120, token: TOKEN });
  await new Promise<void>((r) => pg.server.listen(0, '127.0.0.1', () => r()));
  const { port } = pg.server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => { pg.server.closeAllConnections?.(); pg.server.close(() => r()); }) };
}

let dir: string;
const write = (name: string, text: string) => {
  const f = path.join(dir, name);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text, 'utf8');
  return f;
};
const run = (file: string, extra: Partial<Parameters<typeof runScenario>[1]> = {}) =>
  runScenario(loadScenario(file), { outputDir: path.join(dir, 'artifacts'), ...extra });

function scenario(baseUrl: string, body: { actors: string; checks: string; timing?: string; run?: string; name?: string }): string {
  return `version: 1
name: ${body.name ?? 'extra-it'}
baseUrl: ${baseUrl}
actors:
${body.actors}
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
    equals: 0
timing:
${body.timing ?? '  mode: simultaneous'}
assertions:
  settleMs: 200
  timeoutMs: 2000
  checks:
${body.checks}
run:
${body.run ?? '  repeat: 1\n  seed: 5'}
`;
}

const bookingActor = (id: string, user: string, race = "      click: '[data-testid=\"confirm-booking\"]'") => `  - id: ${id}
    prepare:
      - navigate: /login?user=${user}&next=/booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
${race}`;

const countCheck = (equals: number) => `    - api:
        get: /test-support/seat-01/booking-count
        headers:
          ${auth}
        pointer: /count
        equals: ${equals}`;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'raceui-extra-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('fixed playground: engine edge cases', () => {
  let pg: Playground;
  beforeAll(async () => (pg = await start('fixed')));
  afterAll(() => pg.close());

  it('race action error (locator/key failure) is INCONCLUSIVE, never a race verdict', async () => {
    const yaml = scenario(pg.baseUrl, {
      actors: [bookingActor('user-a', 'alice'), bookingActor('user-b', 'bob', "      press:\n        selector: '[data-testid=\"confirm-booking\"]'\n        key: NotARealKey123")].join('\n'),
      checks: `    - ui:
        text: Booking successful
        count:
          equals: 2`,
    });
    const { report } = await run(write('action-error.yaml', yaml));
    const a = report.attempts[0]!;
    expect(a.status).toBe('INCONCLUSIVE');
    expect(a.actors.find((x) => x.id === 'user-b')!.action).toBe('error');
    expect(a.reasons.join(' ')).toMatch(/action error/);
  });

  it('timing threshold exceeded without a violation is INCONCLUSIVE and keeps actual timing', async () => {
    const yaml = scenario(pg.baseUrl, {
      actors: [bookingActor('user-a', 'alice'), bookingActor('user-b', 'bob')].join('\n'),
      timing: '  mode: staggered\n  offsetsMs:\n    user-a: 0\n    user-b: 300\n  maxDispatchSkewMs: 0',
      checks: countCheck(1),
    });
    const { report } = await run(write('timing.yaml', yaml));
    const a = report.attempts[0]!;
    expect(a.timing?.quality).toBe('exceeded');
    expect(a.status).toBe('INCONCLUSIVE');
    expect(a.timing?.plannedOffsetsMs).toEqual({ 'user-a': 0, 'user-b': 300 });
    expect(a.actors.find((x) => x.id === 'user-b')!.dispatchMs!).toBeGreaterThanOrEqual(290);
  });

  it('separate users: storage-state cookies and localStorage stay isolated per context', async () => {
    const origin = pg.baseUrl;
    const state = (user: string, note: string) => JSON.stringify({
      cookies: [{ name: 'pg_user', value: user, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [{ origin, localStorage: [{ name: 'pg_note', value: note }] }],
    });
    write('iso/auth/a.json', state('alice', 'note-from-a'));
    write('iso/auth/b.json', state('bob', 'note-from-b'));
    const actor = (id: string, file: string) => `  - id: ${id}
    storageState: ./auth/${file}
    prepare:
      - navigate: /booking/seat-01
    race:
      click: '[data-testid="confirm-booking"]'`;
    const yaml = scenario(origin, {
      actors: [actor('user-a', 'a.json'), actor('user-b', 'b.json')].join('\n'),
      checks: `    - api:
        get: /api/me
        actor: user-a
        pointer: /user
        equals: alice
    - api:
        get: /api/me
        actor: user-b
        pointer: /user
        equals: bob
    - ui:
        actor: user-a
        text: note-from-a
    - ui:
        actor: user-b
        text: note-from-b
    - ui:
        text: note-from-a
        count:
          equals: 1
${countCheck(1)}`,
    });
    const { report } = await run(write('iso/isolation.yaml', yaml));
    expect(report.attempts[0]!.assertions.map((x) => x.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(report.status).toBe('PASS');
  });

  it('shared storage-state identity must be explicitly configured', () => {
    write('shared/auth/same.json', JSON.stringify({ cookies: [], origins: [] }));
    const actor = (id: string, extra = '') => `  - id: ${id}
    storageState: ./auth/same.json${extra}
    race:
      click: '#x'`;
    const implicit = scenario(pg.baseUrl, { actors: [actor('a'), actor('b')].join('\n'), checks: countCheck(1) });
    expect(() => loadScenario(write('shared/implicit.yaml', implicit))).toThrow(ConfigError);
    const explicit = scenario(pg.baseUrl, { actors: [actor('a', '\n    sharedIdentity: true'), actor('b', '\n    sharedIdentity: true')].join('\n'), checks: countCheck(1) });
    expect(loadScenario(write('shared/explicit.yaml', explicit)).scenario.actors[0]!.sharedIdentity).toBe(true);
  });

  it('secrets in config and URLs are redacted from report, requests and HTML', async () => {
    const actor = (id: string, user: string) => `  - id: ${id}
    prepare:
      - navigate: /login?user=${user}&next=/booking/seat-01
      - navigate: /booking/seat-01?session=\${PG_SESSION}
    race:
      click: '[data-testid="confirm-booking"]'`;
    const yaml = scenario(pg.baseUrl, {
      actors: [actor('user-a', 'alice'), actor('user-b', 'bob')].join('\n'),
      checks: countCheck(1),
      run: '  repeat: 1\n  seed: 5\n  evidence: always',
    });
    const { report, runDir } = await run(write('secrets.yaml', yaml));
    expect(report.status).toBe('PASS');
    const files = ['report.json', 'report.html', ...readdirSync(path.join(runDir, 'attempt-001')).filter((f) => f.endsWith('.json')).map((f) => `attempt-001/${f}`)];
    for (const f of files) {
      const text = readFileSync(path.join(runDir, f), 'utf8');
      expect(text, f).not.toContain(SESSION_SECRET);
      expect(text, f).not.toContain(TOKEN);
    }
    expect(report.attempts[0]!.actors[0]!.finalUrl).toContain('session=%5BREDACTED%5D'.replace('%5BREDACTED%5D', '[REDACTED]'));
  });

  it('opt-in traces are saved locally and the static HTML report is written', async () => {
    const yaml = scenario(pg.baseUrl, { actors: [bookingActor('user-a', 'alice'), bookingActor('user-b', 'bob')].join('\n'), checks: countCheck(1) });
    const { report, runDir, htmlPath } = await run(write('trace.yaml', yaml), { trace: 'always' });
    expect(report.status).toBe('PASS');
    expect(report.attempts[0]!.evidence).toEqual(expect.arrayContaining(['attempt-001/user-a-trace.zip', 'attempt-001/user-b-trace.zip']));
    expect(existsSync(path.join(runDir, 'attempt-001', 'user-a-trace.zip'))).toBe(true);
    expect(report.limitations.join(' ')).toMatch(/NOT redacted/);
    const html = readFileSync(htmlPath!, 'utf8');
    expect(html).toContain('<title>RaceUI report: extra-it (PASS)</title>');
    expect(html).not.toMatch(/<script/i);
  });
});

describe('CLI invocation (CI contract)', () => {
  let vuln: Playground;
  let fixed: Playground;
  beforeAll(async () => {
    expect(existsSync(CLI), 'run `npm run build` first').toBe(true);
    vuln = await start('vulnerable');
    fixed = await start('fixed');
  });
  afterAll(async () => {
    await vuln.close();
    await fixed.close();
  });

  // Async spawn: the playground runs in this process, so a blocking spawnSync would starve it.
  const cli = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: '1' } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  const yaml = (baseUrl: string) => scenario(baseUrl, { actors: [bookingActor('user-a', 'alice'), bookingActor('user-b', 'bob')].join('\n'), checks: countCheck(1), run: '  repeat: 2\n  seed: 9' });

  it('exit 1 + machine-readable JSON on a confirmed violation', async () => {
    const r = await cli(['run', write('cli-vuln.yaml', yaml(vuln.baseUrl)), '--json', '--output', path.join(dir, 'cli-art')]);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.status).toBe('FAIL');
    expect(report.summary.requested).toBe(2);
  }, 120_000);

  it('exit 0 when every attempt passes', async () => {
    const r = await cli(['run', write('cli-fixed.yaml', yaml(fixed.baseUrl)), '--no-logo', '--output', path.join(dir, 'cli-art')]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Result: PASS (exit 0)');
  }, 120_000);

  it('exit 2 for invalid configuration, bad usage and unapproved targets', async () => {
    expect((await cli(['validate', write('bad.yaml', 'version: 1\nname: x\n')])).status).toBe(2);
    expect((await cli(['run', 'missing.yaml', '--repeat', '0'])).status).toBe(2);
    const ext = write('ext.yaml', yaml('https://staging.example.com'));
    expect((await cli(['validate', ext])).status).toBe(2);
    expect((await cli(['validate', ext, '--allow-origin', 'https://staging.example.com'])).status).toBe(0);
  });

  it('report command regenerates HTML from JSON', async () => {
    const artDir = path.join(dir, 'cli-art');
    const run1 = readdirSync(artDir)[0]!;
    const out = path.join(dir, 'regen.html');
    const r = await cli(['report', path.join(artDir, run1, 'report.json'), '--out', out]);
    expect(r.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('RaceUI report');
  });

  it('install-skill copies SKILL.md for each agent without overwriting', async () => {
    const proj = path.join(dir, 'proj');
    mkdirSync(proj, { recursive: true });
    for (const [agent, rel] of [['claude', '.claude/skills/raceui'], ['codex', '.agents/skills/raceui'], ['cursor', '.cursor/skills/raceui']] as const) {
      expect((await cli(['install-skill', '--agent', agent, '--dir', proj])).status).toBe(0);
      expect(readFileSync(path.join(proj, rel, 'SKILL.md'), 'utf8')).toMatch(/^---\nname: raceui/);
      expect((await cli(['install-skill', '--agent', agent, '--dir', proj])).status).toBe(2);
    }
  });
});
