import { compare, evaluatePointer, PointerError } from '../assertions/compare.js';
import type { Baseline, HttpHook, Scenario } from '../schema/scenario.js';
import type { OriginPolicy } from '../security/origin.js';
import type { BaselineResult, FixtureStepResult } from '../reporters/types.js';
import { applyRuntime, applyRuntimeDeep, applyRuntimeHeaders, httpRequest } from './http.js';

/**
 * Fixture lifecycle (PRD FR-10): optional one-time setup, per-attempt reset or unique
 * resources, and a baseline assertion that must hold before any race action is released.
 */
export class FixtureManager {
  constructor(
    private readonly scenario: Scenario,
    private readonly policy: OriginPolicy,
  ) {}

  get strategy(): 'reset' | 'unique' {
    return this.scenario.fixtures?.strategy ?? 'reset';
  }

  resourceId(vars: Record<string, string>): string | undefined {
    const t = this.scenario.fixtures?.resourceTemplate;
    return t ? applyRuntime(t, vars) : undefined;
  }

  async setup(vars: Record<string, string>): Promise<FixtureStepResult> {
    const hook = this.scenario.fixtures?.setup;
    if (!hook) return { status: 'not-configured' };
    return this.callHook(hook, vars);
  }

  async reset(vars: Record<string, string>): Promise<FixtureStepResult> {
    const hook = this.scenario.fixtures?.reset;
    if (!hook) return { status: 'not-configured' };
    return this.callHook(hook, vars);
  }

  async baseline(vars: Record<string, string>): Promise<BaselineResult> {
    const b = this.scenario.fixtures?.baseline;
    if (!b) return { status: 'not-configured' };
    return checkBaseline(b, vars, this.policy);
  }

  private async callHook(hook: HttpHook, vars: Record<string, string>): Promise<FixtureStepResult> {
    try {
      const res = await httpRequest(this.policy, {
        method: hook.method,
        url: this.policy.resolve(applyRuntime(hook.path, vars)),
        headers: applyRuntimeHeaders(hook.headers, vars),
        body: hook.body ? applyRuntimeDeep(hook.body, vars) : undefined,
        timeoutMs: hook.timeoutMs,
      });
      if (!res.ok) return { status: 'failed', httpStatus: res.status, durationMs: res.durationMs, error: `HTTP ${res.status}` };
      return { status: 'ok', httpStatus: res.status, durationMs: res.durationMs };
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }
  }
}

async function checkBaseline(b: Baseline, vars: Record<string, string>, policy: OriginPolicy): Promise<BaselineResult> {
  const p = applyRuntime(b.get, vars);
  const source = `GET ${p}#${b.pointer}`;
  try {
    const res = await httpRequest(policy, { method: 'GET', url: policy.resolve(p), headers: applyRuntimeHeaders(b.headers, vars), timeoutMs: 10_000 });
    if (!res.ok) return { status: 'ERROR', source, reason: `HTTP ${res.status}` };
    if (res.json === undefined) return { status: 'ERROR', source, reason: 'response is not JSON' };
    const observed = evaluatePointer(res.json, b.pointer);
    const r = compare(observed, b);
    return { status: r.pass ? 'PASS' : 'FAIL', source, expected: r.expected, observed, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (err) {
    return { status: 'ERROR', source, reason: err instanceof PointerError ? err.message : (err as Error).message };
  }
}
