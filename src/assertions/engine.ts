import type { ApiCheck, Check, UiCheck } from '../schema/scenario.js';
import type { OriginPolicy } from '../security/origin.js';
import type { AssertionResult } from '../reporters/types.js';
import type { ActorSession } from '../engine/sessions.js';
import { firstLine } from '../engine/sessions.js';
import { applyRuntime, applyRuntimeHeaders, httpRequest } from '../engine/http.js';
import { compare, evaluatePointer, PointerError } from './compare.js';

export interface AssertionContext {
  sessions: Map<string, ActorSession>;
  policy: OriginPolicy;
  vars: Record<string, string>;
  timeoutMs: number;
  pollMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Evaluates all checks concurrently within one bounded observation window (FR-08, FR-09).
 * Each check is polled until it holds or the window closes; the last observation is reported.
 */
export async function evaluateChecks(checks: Check[], ctx: AssertionContext): Promise<AssertionResult[]> {
  const deadline = performance.now() + ctx.timeoutMs;
  return Promise.all(checks.map((c, i) => ('ui' in c ? evaluateUi(i, c.ui, ctx, deadline) : evaluateApi(i, c.api, ctx, deadline))));
}

async function evaluateUi(index: number, check: UiCheck, ctx: AssertionContext, deadline: number): Promise<AssertionResult> {
  const text = applyRuntime(check.text, ctx.vars);
  const count = check.count ?? { equals: 1 };
  const targets = check.actor ? [check.actor] : [...ctx.sessions.keys()];
  const source = check.actor ? `ui[${check.actor}]:"${text}"` : `ui:"${text}"`;
  let observations = 0;
  let matched: string[] = [];
  let lastError: string | undefined;
  for (;;) {
    observations++;
    try {
      const flags = await Promise.all(targets.map(async (id) => {
        const s = ctx.sessions.get(id);
        return s ? s.hasVisibleText(text) : false;
      }));
      matched = targets.filter((_, i) => flags[i]);
      lastError = undefined;
    } catch (err) {
      lastError = firstLine(err);
    }
    const r = compare(matched.length, count);
    if (!lastError && r.pass) {
      return { index, type: 'ui', source, actor: check.actor, expected: r.expected, observed: matched.length, matchedActors: matched, status: 'PASS', observations, observedAt: new Date().toISOString() };
    }
    if (performance.now() + ctx.pollMs > deadline) {
      if (lastError) return { index, type: 'ui', source, actor: check.actor, expected: r.expected, observed: null, status: 'ERROR', reason: lastError, observations };
      return {
        index, type: 'ui', source, actor: check.actor, expected: r.expected, observed: matched.length, matchedActors: matched, status: 'FAIL',
        reason: `expected text visible on ${describeCount(count)} actor page(s), observed ${matched.length}${matched.length ? ` (${matched.join(', ')})` : ''}`,
        observations, observedAt: new Date().toISOString(),
      };
    }
    await sleep(ctx.pollMs);
  }
}

function describeCount(c: { equals?: number; min?: number; max?: number }): string {
  if (c.equals !== undefined) return `exactly ${c.equals}`;
  const parts = [];
  if (c.min !== undefined) parts.push(`at least ${c.min}`);
  if (c.max !== undefined) parts.push(`at most ${c.max}`);
  return parts.join(' and ');
}

async function evaluateApi(index: number, check: ApiCheck, ctx: AssertionContext, deadline: number): Promise<AssertionResult> {
  const p = applyRuntime(check.get, ctx.vars);
  const source = `GET ${p}#${check.pointer}${check.actor ? ` (as ${check.actor})` : ''}`;
  const pollMs = check.pollMs ?? ctx.pollMs;
  const base = { index, type: 'api' as const, source, actor: check.actor, pointer: check.pointer };
  let observations = 0;
  let last: { observed: unknown; pass: boolean; expected: Record<string, unknown>; reason?: string } | undefined;
  let lastError: string | undefined;
  for (;;) {
    observations++;
    try {
      const via = check.actor ? ctx.sessions.get(check.actor)?.context.request : undefined;
      const remaining = Math.max(250, Math.round(deadline - performance.now()));
      const res = await httpRequest(ctx.policy, { method: 'GET', url: ctx.policy.resolve(p), headers: applyRuntimeHeaders(check.headers, ctx.vars), timeoutMs: remaining }, via);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (res.json === undefined) throw new Error('response is not JSON');
      const observed = evaluatePointer(res.json, check.pointer);
      const r = compare(observed, check);
      last = { observed, pass: r.pass, expected: r.expected, reason: r.reason };
      lastError = undefined;
    } catch (err) {
      lastError = err instanceof PointerError ? err.message : firstLine(err);
    }
    if (last && !lastError && last.pass) {
      return { ...base, expected: last.expected, observed: last.observed, status: 'PASS', observations, observedAt: new Date().toISOString() };
    }
    if (performance.now() + pollMs > deadline) {
      if (lastError) {
        return { ...base, expected: last?.expected ?? compare(undefined, check).expected, observed: null, status: 'ERROR', reason: `verification endpoint unavailable: ${lastError}`, observations };
      }
      return { ...base, expected: last!.expected, observed: last!.observed, status: 'FAIL', reason: last!.reason, observations, observedAt: new Date().toISOString() };
    }
    await sleep(pollMs);
  }
}
