import { describe, expect, it } from 'vitest';
import { checkRepeatPolicy, ConfigError, parseScenarioText } from '../../src/schema/load.js';

const base = [
  'version: 1',
  'name: demo',
  'baseUrl: http://127.0.0.1:3000',
  'actors:',
  '  - id: a',
  '    prepare:',
  '      - navigate: /x',
  '    race:',
  "      click: '#go'",
  '  - id: b',
  '    race:',
  "      click: '#go'",
  'assertions:',
  '  checks:',
  '    - ui:',
  '        text: Done',
  '        count:',
  '          equals: 1',
  '',
].join('\n');

function issues(text: string, env: NodeJS.ProcessEnv = {}): string[] {
  try {
    parseScenarioText(text, env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
}

describe('scenario schema', () => {
  it('accepts a minimal scenario and applies defaults', () => {
    const { scenario } = parseScenarioText(base, {});
    expect(scenario.timing.mode).toBe('simultaneous');
    expect(scenario.timing.maxDispatchSkewMs).toBe(100);
    expect(scenario.run.repeat).toBe(1);
    expect(scenario.run.evidence).toBe('on-failure');
    expect(scenario.run.browser).toBe('chromium');
  });
  it('rejects unknown keys', () => {
    expect(issues(base + 'extra: 1\n').join()).toMatch(/extra/i);
    expect(issues(base.replace("      click: '#go'\n  - id: b", "      click: '#go'\n      force: true\n  - id: b")).length).toBeGreaterThan(0);
  });
  it('rejects duplicate actor ids', () => {
    expect(issues(base.replace('id: b', 'id: a')).join()).toMatch(/duplicate actor id "a"/);
  });
  it('enforces actor limits', () => {
    const one = base.replace("  - id: b\n    race:\n      click: '#go'\n", '');
    expect(issues(one).join()).toMatch(/at least 2 actors/);
  });
  it('rejects absolute URLs in paths', () => {
    expect(issues(base.replace('navigate: /x', 'navigate: https://evil.example.com/')).join()).toMatch(/relative to baseUrl/);
  });
  it('rejects unsupported race actions (no arbitrary JS)', () => {
    expect(issues(base.replace("    race:\n      click: '#go'\n  - id: b", "    race:\n      evaluate: 'alert(1)'\n  - id: b")).length).toBeGreaterThan(0);
  });
  it('rejects missing references', () => {
    const staggered = base + 'timing:\n  mode: staggered\n  offsetsMs:\n    a: 0\n    zz: 5\n';
    const msg = issues(staggered).join('\n');
    expect(msg).toMatch(/unknown actor "zz"/);
    expect(msg).toMatch(/missing offset for actor "b"/);
    expect(issues(base.replace('text: Done', 'text: Done\n        actor: ghost')).join()).toMatch(/unknown actor "ghost"/);
  });
  it('requires an assertion', () => {
    expect(issues(base.replace(/assertions:[\s\S]*$/, 'assertions:\n  checks: []\n')).join()).toMatch(/at least one assertion/);
  });
  it('rejects out-of-range limits', () => {
    expect(issues(base + 'run:\n  repeat: 500\n').length).toBeGreaterThan(0);
  });
  it('resolves environment variables and reports unresolved ones', () => {
    const t = base.replace('text: Done', 'text: ${GREETING}');
    expect(issues(t).join()).toMatch(/GREETING/);
    const { scenario, secrets } = parseScenarioText(t, { GREETING: 'Hello there' });
    const check = scenario.assertions.checks[0];
    expect(check && 'ui' in check ? check.ui.text : '').toBe('Hello there');
    expect(secrets).toContain('Hello there');
  });
  it('restricts ${RESOURCE_ID} to the unique fixture strategy', () => {
    expect(issues(base.replace('navigate: /x', 'navigate: /x/${RESOURCE_ID}')).join()).toMatch(/RESOURCE_ID/);
  });
  it('rejects duplicate YAML keys', () => {
    expect(issues(base + 'name: again\n').length).toBeGreaterThan(0);
  });
});

describe('repeat policy', () => {
  it('requires reset (or unique) and baseline for repeats', () => {
    const { scenario } = parseScenarioText(base, {});
    expect(checkRepeatPolicy(scenario, 1)).toEqual([]);
    const i = checkRepeatPolicy(scenario, 5).join();
    expect(i).toMatch(/fixtures.reset/);
    expect(i).toMatch(/fixtures.baseline/);
    const withFixtures = parseScenarioText(base + 'fixtures:\n  reset:\n    path: /reset\n  baseline:\n    get: /count\n    pointer: /n\n    equals: 0\n', {}).scenario;
    expect(checkRepeatPolicy(withFixtures, 5)).toEqual([]);
  });
});
