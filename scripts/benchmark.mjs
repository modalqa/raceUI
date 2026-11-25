#!/usr/bin/env node
/**
 * RaceUI reference benchmark (PRD NFR-02 / NFR-03).
 *
 *   npm run build && node scripts/benchmark.mjs [--attempts 100] [--memory-attempts 20]
 *
 * 1. Dispatch skew: 2 actors x N attempts (default 100) against the local "fixed" playground
 *    (a ready-button demo). Reports p50 / p95 / max runner dispatch skew.
 * 2. Memory: 5 actors x M attempts; samples the runner's RSS and the summed RSS of the
 *    Playwright Chromium processes, and reports the peaks.
 *
 * Results are measurements on the machine it runs on, not guarantees. Output: Markdown + JSON.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPlayground } from '../playground/server.mjs';
import { loadScenario, runScenario } from '../dist/index.js';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const ATTEMPTS = arg('--attempts', 100);
const MEM_ATTEMPTS = arg('--memory-attempts', 20);
const TOKEN = 'bench-token';
process.env.RACEUI_FIXTURE_TOKEN = TOKEN;

async function chromiumRssBytes() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ms-playwright*' } | Measure-Object -Property WorkingSetSize -Sum).Sum"], { windowsHide: true });
      return Number(stdout.trim()) || 0;
    }
    const { stdout } = await exec('ps', ['-A', '-o', 'rss=,command=']);
    return stdout.split('\n').filter((l) => l.includes('ms-playwright')).reduce((s, l) => s + Number(l.trim().split(/\s+/)[0]) * 1024, 0);
  } catch {
    return 0;
  }
}

function percentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1);
  return v[Math.max(0, idx)];
}

function scenarioYaml(baseUrl, actors, repeat) {
  const ids = Array.from({ length: actors }, (_, i) => `actor-${i + 1}`);
  return `version: 1
name: benchmark-${actors}-actors
baseUrl: ${baseUrl}
actors:
${ids.map((id) => `  - id: ${id}
    prepare:
      - navigate: /login?user=${id}&next=/booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'`).join('\n')}
fixtures:
  reset:
    method: POST
    path: /test-support/reset
    headers:
      Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
  baseline:
    get: /test-support/seat-01/booking-count
    headers:
      Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
    pointer: /count
    equals: 0
timing:
  mode: simultaneous
  maxDispatchSkewMs: 50
assertions:
  settleMs: 100
  timeoutMs: 3000
  checks:
    - api:
        get: /test-support/seat-01/booking-count
        headers:
          Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
        pointer: /count
        equals: 1
run:
  repeat: ${repeat}
  seed: 1
  evidence: none
`;
}

async function measure(baseUrl, dir, actors, repeat, label) {
  const file = path.join(dir, `${label}.yaml`);
  writeFileSync(file, scenarioYaml(baseUrl, actors, repeat));
  let peakRunner = 0;
  let peakChromium = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peakRunner = Math.max(peakRunner, process.memoryUsage().rss);
      peakChromium = Math.max(peakChromium, await chromiumRssBytes());
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
  const started = performance.now();
  const { report } = await runScenario(loadScenario(file), {
    outputDir: path.join(dir, 'artifacts'),
    html: false,
    onProgress: (m) => process.stderr.write(`\r${label}: ${m.padEnd(60)}`),
  });
  sampling = false;
  await sampler;
  process.stderr.write('\n');
  const skews = report.attempts.map((a) => a.timing?.dispatchSkewMs).filter((x) => typeof x === 'number');
  return {
    label,
    actors,
    attempts: repeat,
    summary: report.summary,
    status: report.status,
    dispatchSkewMs: { p50: percentile(skews, 50), p95: percentile(skews, 95), max: skews.length ? Math.max(...skews) : null, samples: skews.length },
    peakRunnerRssMB: Math.round(peakRunner / 1048576),
    peakChromiumRssMB: Math.round(peakChromium / 1048576),
    peakTotalRssMB: Math.round((peakRunner + peakChromium) / 1048576),
    durationS: Math.round((performance.now() - started) / 100) / 10,
    browserVersion: report.environment.browserVersion,
  };
}

const pg = createPlayground({ mode: 'fixed', delay: 50, token: TOKEN });
await new Promise((r) => pg.server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${pg.server.address().port}`;
const dir = mkdtempSync(path.join(os.tmpdir(), 'raceui-bench-'));
try {
  const skew = await measure(baseUrl, dir, 2, ATTEMPTS, 'skew-2-actors');
  const mem = await measure(baseUrl, dir, 5, MEM_ATTEMPTS, 'memory-5-actors');
  const env = {
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
    cpu: `${os.cpus()[0]?.model ?? 'unknown'} x${os.cpus().length}`,
    ramGB: Math.round(os.totalmem() / 1073741824),
    node: process.version,
    browser: `chromium ${skew.browserVersion}`,
  };
  const result = { env, results: [skew, mem] };
  console.log('```json\n' + JSON.stringify(result, null, 2) + '\n```');
  console.log(`
| Run | Actors | Attempts | PASS | Skew p50 | Skew p95 | Skew max | Peak runner RSS | Peak Chromium RSS | Duration |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${[skew, mem].map((r) => `| ${r.label} | ${r.actors} | ${r.attempts} | ${r.summary.passed} | ${r.dispatchSkewMs.p50} ms | ${r.dispatchSkewMs.p95} ms | ${r.dispatchSkewMs.max} ms | ${r.peakRunnerRssMB} MB | ${r.peakChromiumRssMB} MB | ${r.durationS} s |`).join('\n')}

Reference machine: ${env.os}, ${env.cpu}, ${env.ramGB} GB RAM, Node ${env.node}, ${env.browser}.
NFR-03 target (p95 dispatch skew <= 50 ms, 2 actors, ${ATTEMPTS} attempts): ${skew.dispatchSkewMs.p95 !== null && skew.dispatchSkewMs.p95 <= 50 ? 'MET' : 'NOT MET'}.`);
} finally {
  pg.server.closeAllConnections?.();
  pg.server.close();
  rmSync(dir, { recursive: true, force: true });
}
