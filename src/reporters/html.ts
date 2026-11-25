import { describeExpected } from '../assertions/compare.js';
import type { ActorResult, AssertionResult, AttemptResult, RunReport } from './types.js';

/**
 * Static, offline HTML report (FR-16). Generated only from the sanitized JSON report: no server,
 * no external assets, no scripts that fetch anything. Evidence links are relative to the run
 * directory, so open the file from there.
 */
export function renderHtmlReport(r: RunReport): string {
  const s = r.summary;
  const attempts = r.attempts.map(renderAttempt).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'">
<title>RaceUI report: ${esc(r.scenario)} (${esc(r.status)})</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--card:#f6f8fa;--blue:#0a6cf0;--pass:#1a7f37;--fail:#cf222e;--inc:#9a6700;--skip:#6e7781}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--card:#161b22;--blue:#4493f8;--pass:#3fb950;--fail:#f85149;--inc:#d29922;--skip:#8b949e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 20px 64px}
.brand{font-weight:800;font-size:28px;letter-spacing:-.5px}.brand span{color:var(--blue)}
.tag{color:var(--muted);margin:0 0 20px}
h2{font-size:18px;margin:32px 0 12px}h3{font-size:15px;margin:16px 0 8px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 24px;color:var(--muted)}.meta b{color:var(--fg);font-weight:600}
.tiles{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:130px}
.tile .n{font-size:26px;font-weight:700}.tile .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.badge{display:inline-block;border-radius:999px;padding:1px 10px;font-weight:700;font-size:12px;border:1px solid currentColor}
.PASS{color:var(--pass)}.FAIL{color:var(--fail)}.INCONCLUSIVE,.ERROR{color:var(--inc)}.SKIPPED{color:var(--skip)}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}td.num{font-variant-numeric:tabular-nums}
details.attempt{border:1px solid var(--line);border-radius:10px;margin:10px 0;background:var(--card)}
details.attempt>summary{cursor:pointer;padding:10px 14px;list-style:none;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
details.attempt>summary::-webkit-details-marker{display:none}.body{padding:0 14px 14px;background:var(--bg);border-top:1px solid var(--line);border-radius:0 0 10px 10px}
.muted{color:var(--muted)}.reasons{margin:6px 0;padding-left:18px}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;max-height:420px}
.shots{display:flex;gap:12px;flex-wrap:wrap}.shots figure{margin:0;max-width:340px}.shots img{max-width:100%;border:1px solid var(--line);border-radius:6px}
.shots figcaption{color:var(--muted);font-size:12px}.note{color:var(--muted);font-size:13px}
a{color:var(--blue)}
</style>
</head>
<body>
<main>
<div class="brand">Race<span>UI</span></div>
<p class="tag">Two users. One resource. Zero room for bugs.</p>

<h1 style="font-size:22px;margin:0 0 8px">${esc(r.scenario)} <span class="badge ${esc(r.status)}">${esc(r.status)}</span>${r.interrupted ? ' <span class="badge INCONCLUSIVE">INTERRUPTED</span>' : ''}</h1>
<div class="meta">
  <div>Run <b>${esc(r.runId)}</b></div>
  <div>Exit code <b>${r.exitCode}</b></div>
  <div>Seed <b>${r.seed}</b></div>
  <div>Target <b>${esc(r.config.targetOrigin)}</b></div>
  <div>Started <b>${esc(r.startedAt)}</b></div>
  <div>Finished <b>${esc(r.finishedAt ?? '-')}</b></div>
  <div>Browser <b>${esc(r.environment.browser)} ${esc(r.environment.browserVersion ?? '')}</b></div>
  <div>RaceUI <b>${esc(r.tool.version)}</b> · Node <b>${esc(r.environment.node)}</b> · <b>${esc(r.environment.platform)}/${esc(r.environment.arch)}</b></div>
</div>

<div class="tiles">
  ${tile('Requested', s.requested)}${tile('Executed', s.executed)}${tile('Pass', s.passed, 'PASS')}${tile('Fail', s.failed, 'FAIL')}${tile('Inconclusive', s.inconclusive, 'INCONCLUSIVE')}${tile('Skipped', s.skipped, 'SKIPPED')}
</div>
${r.status === 'PASS' ? '<p class="note">No violation was detected in the executed attempts. This does not prove the system is race-free.</p>' : ''}
${r.errors.length ? `<h2>Run notes</h2><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}

<h2>Attempts</h2>
<table>
<thead><tr><th>#</th><th>Status</th><th>Timing</th><th>Summary</th></tr></thead>
<tbody>
${r.attempts.map((a) => `<tr><td class="num"><a href="#attempt-${a.index}">${a.index}</a></td><td><span class="badge ${a.status}">${a.status}</span>${a.failureKind ? ` <span class="muted">${esc(a.failureKind)}</span>` : ''}</td><td class="num">${timingCell(a)}</td><td>${esc(a.reasons[0] ?? '')}</td></tr>`).join('\n')}
</tbody>
</table>

${attempts}

<h2>Limitations</h2>
<ul>${r.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>

<h2>Configuration</h2>
<details><summary>Resolved run configuration (redacted)</summary><pre>${esc(JSON.stringify(r.config, null, 2))}</pre></details>
<p class="note">Generated offline from report.json (schema v${r.schemaVersion}). Evidence paths are relative to this file.</p>
</main>
</body>
</html>
`;
}

function renderAttempt(a: AttemptResult): string {
  const open = a.status === 'FAIL' || a.status === 'INCONCLUSIVE' ? ' open' : '';
  const shots = a.actors.filter((x) => x.screenshot);
  const other = a.evidence.filter((e) => !e.endsWith('.png'));
  return `<details class="attempt" id="attempt-${a.index}"${open}>
<summary><b>Attempt ${a.index}</b> <span class="badge ${a.status}">${a.status}</span>${a.failureKind ? `<span class="muted">${esc(a.failureKind)}</span>` : ''}<span class="muted">${timingCell(a)}</span>${a.resourceId ? `<span class="muted">resource ${esc(a.resourceId)}</span>` : ''}</summary>
<div class="body">
${a.reasons.length ? `<ul class="reasons">${a.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${a.assertions.length ? `<h3>Assertions</h3><table><thead><tr><th>Status</th><th>Source</th><th>Expected</th><th>Observed</th><th>Detail</th></tr></thead><tbody>${a.assertions.map(assertionRow).join('')}</tbody></table>` : ''}
${a.actors.length ? `<h3>Actors</h3><table><thead><tr><th>Actor</th><th>Prepare</th><th>Planned</th><th>Dispatch</th><th>Completed</th><th>Target request</th><th>Error</th></tr></thead><tbody>${a.actors.map(actorRow).join('')}</tbody></table>` : ''}
<h3>Fixture</h3>
<p class="muted">Reset: ${esc(a.fixture.reset.status)}${a.fixture.reset.httpStatus ? ` (HTTP ${a.fixture.reset.httpStatus})` : ''}${a.fixture.reset.error ? ` · ${esc(a.fixture.reset.error)}` : ''} · Baseline: ${esc(a.fixture.baseline.status)}${a.fixture.baseline.observed !== undefined ? ` (observed ${esc(JSON.stringify(a.fixture.baseline.observed))})` : ''}${a.fixture.baseline.reason ? ` · ${esc(a.fixture.baseline.reason)}` : ''}</p>
${shots.length ? `<h3>Screenshots</h3><div class="shots">${shots.map((x) => `<figure><a href="${attr(x.screenshot!)}"><img loading="lazy" src="${attr(x.screenshot!)}" alt="${attr(x.id)} screenshot"></a><figcaption>${esc(x.id)}</figcaption></figure>`).join('')}</div>` : ''}
${other.length ? `<h3>Evidence files</h3><ul>${other.map((e) => `<li><a href="${attr(e)}">${esc(e)}</a>${e.endsWith('.zip') ? ' <span class="muted">(Playwright trace, unredacted: npx playwright show-trace)</span>' : ''}</li>`).join('')}</ul>` : ''}
${a.notes.length ? `<h3>Notes</h3><ul>${a.notes.map((n) => `<li class="note">${esc(n)}</li>`).join('')}</ul>` : ''}
</div>
</details>`;
}

function assertionRow(x: AssertionResult): string {
  const observed = x.observed === null ? 'n/a' : JSON.stringify(x.observed);
  const who = x.matchedActors?.length ? ` (${x.matchedActors.join(', ')})` : '';
  return `<tr><td><span class="badge ${x.status}">${x.status}</span></td><td><code>${esc(x.source)}</code>${x.label ? `<div class="muted">${esc(x.label)}</div>` : ''}</td><td>${esc(describeExpected(x.comparison ?? {}))}</td><td>${esc(observed + who)}</td><td class="muted">${esc(x.reason ?? '')}</td></tr>`;
}

function actorRow(x: ActorResult): string {
  const t = x.targetRequest;
  const req = t ? `${t.method} ${pathOf(t.url)} → ${t.status ?? t.failure ?? '?'} (start ${t.startMs} ms${t.responseMs !== undefined ? `, response ${t.responseMs} ms` : ''})` : '-';
  return `<tr><td><b>${esc(x.id)}</b></td><td>${esc(x.prepare.status)}${x.prepare.durationMs !== undefined ? ` <span class="muted">${x.prepare.durationMs} ms</span>` : ''}</td><td class="num">${fmt(x.plannedOffsetMs)}</td><td class="num">${fmt(x.dispatchMs)}</td><td class="num">${fmt(x.completedMs)}</td><td>${esc(req)}${x.targetRequestNote ? `<div class="muted">${esc(x.targetRequestNote)}</div>` : ''}</td><td>${esc(x.actionError ?? x.prepare.error ?? '')}</td></tr>`;
}

function timingCell(a: AttemptResult): string {
  const t = a.timing;
  if (!t) return '-';
  const v = t.mode === 'simultaneous' ? `skew ${t.dispatchSkewMs ?? 'n/a'} ms` : `offset error ${t.maxOffsetErrorMs ?? 'n/a'} ms`;
  return `${esc(v)} · ${esc(t.quality)}`;
}

function tile(label: string, n: number, cls = ''): string {
  return `<div class="tile"><div class="n ${cls}">${n}</div><div class="l">${esc(label)}</div></div>`;
}

function fmt(n: number | undefined): string {
  return n === undefined ? '-' : `${n} ms`;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Relative evidence paths only; anything else is neutralized. */
function attr(p: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('/') || p.includes('..')) return '#';
  return esc(p);
}
