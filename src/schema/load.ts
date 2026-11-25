import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { RUNTIME_PLACEHOLDERS, scenarioSchema, type Scenario } from './scenario.js';

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid scenario:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadedScenario {
  /** Fully validated scenario with environment placeholders resolved. */
  scenario: Scenario;
  /** Parsed YAML before environment resolution (safe to report: contains `${VAR}` not secrets). */
  raw: unknown;
  /** Absolute path of the scenario file. */
  file: string;
  /** Directory relative paths are resolved against. */
  dir: string;
  /** Resolved environment values that must be redacted from all output. */
  secrets: string[];
  /** Absolute storage-state paths keyed by actor id. */
  storageStates: Record<string, string>;
}

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const MAX_FILE_BYTES = 256 * 1024;

function resolveEnv(value: unknown, env: NodeJS.ProcessEnv, issues: string[], secrets: Set<string>, at: string): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (whole, name: string) => {
      if ((RUNTIME_PLACEHOLDERS as readonly string[]).includes(name)) return whole;
      const v = env[name];
      if (v === undefined || v === '') {
        issues.push(`${at}: environment variable \${${name}} is not set`);
        return whole;
      }
      if (v.length >= 3) secrets.add(v);
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveEnv(v, env, issues, secrets, `${at}[${i}]`));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEnv(v, env, issues, secrets, at ? `${at}.${k}` : k);
    return out;
  }
  return value;
}

function formatPath(p: PropertyKey[]): string {
  return p.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '') || '(root)';
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/** Semantic checks that Zod's structural validation cannot express. */
export function checkReferences(s: Scenario): string[] {
  const issues: string[] = [];
  const ids = s.actors.map((a) => a.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push(`actors: duplicate actor id "${id}"`);
    seen.add(id);
  }
  const known = new Set(ids);

  if (s.timing.mode === 'staggered' && s.timing.offsetsMs) {
    for (const key of Object.keys(s.timing.offsetsMs)) {
      if (!known.has(key)) issues.push(`timing.offsetsMs: unknown actor "${key}"`);
    }
    for (const id of ids) {
      if (s.timing.offsetsMs[id] === undefined) issues.push(`timing.offsetsMs: missing offset for actor "${id}"`);
    }
  }

  s.assertions.checks.forEach((c, i) => {
    const ref = 'ui' in c ? c.ui.actor : c.api.actor;
    if (ref !== undefined && !known.has(ref)) issues.push(`assertions.checks[${i}]: unknown actor "${ref}"`);
    if ('ui' in c && c.ui.count) {
      const n = c.ui.actor ? 1 : ids.length;
      const { equals, min, max } = c.ui.count;
      if (equals !== undefined && equals > n) issues.push(`assertions.checks[${i}].ui.count.equals (${equals}) exceeds the number of observed actors (${n})`);
      if (min !== undefined && min > n) issues.push(`assertions.checks[${i}].ui.count.min (${min}) exceeds the number of observed actors (${n})`);
      if (min !== undefined && max !== undefined && min > max) issues.push(`assertions.checks[${i}].ui.count: min is greater than max`);
    }
    if ('api' in c && c.api.min !== undefined && c.api.max !== undefined && c.api.min > c.api.max) {
      issues.push(`assertions.checks[${i}].api: min is greater than max`);
    }
  });

  const usesResourceId = collectStrings(s).some((v) => v.includes('${RESOURCE_ID}'));
  if (usesResourceId && s.fixtures?.strategy !== 'unique') {
    issues.push('${RESOURCE_ID} is only available with fixtures.strategy "unique"');
  }
  return issues;
}

/**
 * Repeated attempts against shared mutable state are only meaningful with a reset hook or
 * per-attempt unique resources, plus a verified baseline (PRD §6.1).
 */
export function checkRepeatPolicy(s: Scenario, repeat: number): string[] {
  if (repeat <= 1) return [];
  const issues: string[] = [];
  const f = s.fixtures;
  if (!f || (f.strategy === 'reset' && !f.reset)) {
    issues.push(`repeat ${repeat} requires fixtures.reset or fixtures.strategy "unique" so every attempt starts from a known state`);
  }
  if (!f?.baseline) issues.push(`repeat ${repeat} requires fixtures.baseline to verify the starting state before each race`);
  return issues;
}

export function parseScenarioText(text: string, env: NodeJS.ProcessEnv = process.env): Omit<LoadedScenario, 'file' | 'dir' | 'storageStates'> {
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true, schema: 'core', customTags: [] });
  if (doc.errors.length > 0) throw new ConfigError(doc.errors.map((e) => `YAML: ${e.message.split('\n')[0]}`));
  const raw: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(['scenario must be a YAML mapping']);

  const issues: string[] = [];
  const secrets = new Set<string>();
  const resolved = resolveEnv(raw, env, issues, secrets, '');
  if (issues.length) throw new ConfigError(issues);

  const parsed = scenarioSchema.safeParse(resolved);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`));
  }
  const refIssues = checkReferences(parsed.data);
  if (refIssues.length) throw new ConfigError(refIssues);
  return { scenario: parsed.data, raw, secrets: [...secrets] };
}

export function loadScenario(file: string, env: NodeJS.ProcessEnv = process.env): LoadedScenario {
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new ConfigError([`scenario file not found: ${file}`]);
  const st = statSync(abs);
  if (!st.isFile()) throw new ConfigError([`not a file: ${file}`]);
  if (st.size > MAX_FILE_BYTES) throw new ConfigError([`scenario file is larger than ${MAX_FILE_BYTES} bytes`]);

  const parsed = parseScenarioText(readFileSync(abs, 'utf8'), env);
  const dir = path.dirname(abs);
  const storageStates: Record<string, string> = {};
  const issues: string[] = [];
  for (const a of parsed.scenario.actors) {
    if (!a.storageState) continue;
    const p = path.resolve(dir, a.storageState);
    if (!existsSync(p)) {
      issues.push(`actors.${a.id}.storageState: file not found: ${a.storageState}`);
      continue;
    }
    try {
      JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      issues.push(`actors.${a.id}.storageState: not valid JSON: ${a.storageState}`);
      continue;
    }
    storageStates[a.id] = p;
  }
  if (issues.length) throw new ConfigError(issues);
  return { ...parsed, file: abs, dir, storageStates };
}
