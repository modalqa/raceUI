import path from 'node:path';
import { describeExpected } from '../assertions/compare.js';
import type { AttemptResult, RunReport } from './types.js';

const C = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

export function paint(color: boolean) {
  const wrap = (code: string) => (s: string) => (color ? `${code}${s}${C.reset}` : s);
  return { red: wrap(C.red), green: wrap(C.green), yellow: wrap(C.yellow), gray: wrap(C.gray), bold: wrap(C.bold) };
}

function statusColor(p: ReturnType<typeof paint>, status: string): string {
  if (status === 'PASS') return p.green(status);
  if (status === 'FAIL') return p.red(status);
  if (status === 'SKIPPED') return p.gray(status);
  return p.yellow(status);
}

export function header(report: Pick<RunReport, 'tool' | 'scenario' | 'seed' | 'summary'>, actors: number): string {
  return [
    `RaceUI v${report.tool.version}`,
    `Scenario: ${report.scenario}`,
    `Actors: ${actors} | Requested attempts: ${report.summary.requested} | Seed: ${report.seed}`,
  ].join('\n');
}

function attemptDetails(a: AttemptResult, p: ReturnType<typeof paint>): string[] {
  const lines = [`Attempt ${String(a.index).padStart(2, '0')}: ${statusColor(p, a.status)}${a.failureKind ? p.gray(` (${a.failureKind})`) : ''}`];
  if (a.timing) {
    const t = a.timing;
    const measure = t.mode === 'simultaneous' ? `Browser action dispatch skew: ${t.dispatchSkewMs ?? 'n/a'} ms` : `Max offset error: ${t.maxOffsetErrorMs ?? 'n/a'} ms (planned ${JSON.stringify(t.plannedOffsetsMs)})`;
    lines.push(`  ${measure} [${t.quality}, threshold ${t.thresholdMs} ms]`);
  }
  for (const as of a.assertions.filter((x) => x.status !== 'PASS')) {
    lines.push(`  ${as.status} ${as.source}`);
    lines.push(`    Expected: ${describeExpected(as.expected as Record<string, unknown>)}  Observed: ${JSON.stringify(as.observed)}${as.matchedActors?.length ? ` (${as.matchedActors.join(', ')})` : ''}`);
  }
  for (const r of a.reasons.filter((r) => !a.assertions.some((as) => r.startsWith(as.source)))) lines.push(`  ${r}`);
  for (const n of a.notes.filter((n) => !n.startsWith('No violation'))) lines.push(p.gray(`  Note: ${n}`));
  if (a.evidenceDir) lines.push(`  Evidence: ${a.evidenceDir}/`);
  return lines;
}

export function summary(report: RunReport, color: boolean, cwd = process.cwd(), reportPath?: string): string {
  const p = paint(color);
  const s = report.summary;
  const out: string[] = [
    '',
    `${p.green('PASS')}          ${s.passed}`,
    `${p.red('FAIL')}          ${s.failed}`,
    `${p.yellow('INCONCLUSIVE')}  ${s.inconclusive}`,
  ];
  if (s.skipped) out.push(`${p.gray('SKIPPED')}       ${s.skipped}`);
  const interesting = report.attempts.filter((a) => a.status === 'FAIL' || a.status === 'INCONCLUSIVE');
  const shown = interesting.slice(0, 10);
  for (const a of shown) out.push('', ...attemptDetails(a, p));
  if (interesting.length > shown.length) out.push('', p.gray(`... ${interesting.length - shown.length} more non-passing attempt(s) in the JSON report`));
  for (const e of report.errors) out.push('', p.yellow(`Run note: ${e}`));
  out.push('', `Result: ${statusColor(p, report.status)}${report.interrupted ? ' (interrupted)' : ''} (exit ${report.exitCode})`);
  if (reportPath) out.push(`Report: ${path.relative(cwd, reportPath) || reportPath}`);
  if (report.status === 'PASS') out.push(p.gray('No violation was detected in the executed attempts. This does not prove the system is race-free.'));
  return out.join('\n');
}
