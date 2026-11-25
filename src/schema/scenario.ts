import { z } from 'zod';

/** Hard MVP limits. Intentional safeguards, not capacity claims. */
export const LIMITS = {
  minActors: 2,
  maxActors: 5,
  maxRepeat: 100,
  maxPrepareSteps: 50,
  maxChecks: 50,
  maxTimeoutMs: 120_000,
  maxJitterMs: 10_000,
  maxOffsetMs: 10_000,
} as const;

/** Placeholders resolved per attempt rather than from the environment. */
export const RUNTIME_PLACEHOLDERS = ['RUN_ID', 'ATTEMPT', 'RESOURCE_ID'] as const;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

/** A path relative to baseUrl. Absolute URLs are rejected so every request stays on the approved origin. */
const relPath = z
  .string()
  .min(1)
  .refine((v) => v.startsWith('/') && !v.startsWith('//'), {
    message: 'must be a path relative to baseUrl starting with "/" (absolute URLs are not allowed)',
  });

const selector = z.string().min(1, 'selector must not be empty');
const timeoutMs = z.number().int().min(1).max(LIMITS.maxTimeoutMs);
const headers = z.record(z.string().min(1), z.string());

const prepareStep = z.union([
  z.strictObject({ navigate: relPath }),
  z.strictObject({ fill: z.strictObject({ selector, value: z.string() }) }),
  z.strictObject({ click: selector }),
  z.strictObject({ waitFor: selector }),
]);

const raceAction = z.union([
  z.strictObject({ click: selector }),
  z.strictObject({ press: z.strictObject({ selector, key: z.string().min(1) }) }),
]);

const actor = z.strictObject({
  id: z.string().regex(ID_RE, 'actor id must be 1-40 chars of letters, digits, "-" or "_"'),
  storageState: z.string().min(1).optional(),
  /** Must be true when this actor intentionally shares a storage-state identity with another actor. */
  sharedIdentity: z.boolean().default(false),
  prepare: z.array(prepareStep).max(LIMITS.maxPrepareSteps).default([]),
  race: raceAction,
});

const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Typed comparison against a JSON Pointer value. Exactly one operator family is required. */
const comparison = {
  pointer: z.string().refine((v) => v === '' || v.startsWith('/'), 'JSON Pointer must be "" or start with "/"'),
  equals: jsonScalar.optional(),
  notEquals: jsonScalar.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
};

function hasOperator(v: { equals?: unknown; notEquals?: unknown; min?: unknown; max?: unknown }): boolean {
  return v.equals !== undefined || v.notEquals !== undefined || v.min !== undefined || v.max !== undefined;
}

const apiCheck = z
  .strictObject({
    get: relPath,
    headers: headers.optional(),
    actor: z.string().optional(),
    label: z.string().min(1).max(80).optional(),
    pollMs: z.number().int().min(25).max(10_000).optional(),
    ...comparison,
  })
  .refine(hasOperator, { message: 'api check requires one of equals, notEquals, min or max' })
  .refine((v) => !(v.equals !== undefined && (v.min !== undefined || v.max !== undefined)), {
    message: 'equals cannot be combined with min/max',
  });

const countCheck = z
  .strictObject({
    equals: z.number().int().min(0).optional(),
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  })
  .refine((v) => v.equals !== undefined || v.min !== undefined || v.max !== undefined, {
    message: 'count requires equals, min or max',
  })
  .refine((v) => !(v.equals !== undefined && (v.min !== undefined || v.max !== undefined)), {
    message: 'count.equals cannot be combined with min/max',
  });

const uiCheck = z
  .strictObject({
    text: z.string().min(1),
    actor: z.string().optional(),
    label: z.string().min(1).max(80).optional(),
    count: countCheck.optional(),
  })
  .refine((v) => v.count !== undefined || v.actor !== undefined, {
    message: 'aggregate ui check requires count; with "actor" set, count defaults to { equals: 1 } (text visible)',
  });

const check = z.union([z.strictObject({ ui: uiCheck }), z.strictObject({ api: apiCheck })]);

const httpHook = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  path: relPath,
  headers: headers.optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: timeoutMs.default(10_000),
});

const baseline = z
  .strictObject({
    get: relPath,
    headers: headers.optional(),
    ...comparison,
  })
  .refine(hasOperator, { message: 'baseline requires one of equals, notEquals, min or max' });

const fixtures = z
  .strictObject({
    strategy: z.enum(['reset', 'unique']).default('reset'),
    resourceTemplate: z.string().min(1).optional(),
    setup: httpHook.optional(),
    reset: httpHook.optional(),
    baseline: baseline.optional(),
  })
  .refine((f) => f.strategy !== 'unique' || f.resourceTemplate !== undefined, {
    message: 'strategy "unique" requires resourceTemplate (e.g. "seat-${RUN_ID}-${ATTEMPT}")',
    path: ['resourceTemplate'],
  });

const requestFilter = z
  .strictObject({
    method: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    urlPattern: z.string().min(1).optional(),
  })
  .refine((f) => f.method || f.path || f.urlPattern, { message: 'requestFilter needs method, path or urlPattern' });

const timing = z
  .strictObject({
    mode: z.enum(['simultaneous', 'staggered', 'jitter']).default('simultaneous'),
    offsetsMs: z.record(z.string(), z.number().int().min(0).max(LIMITS.maxOffsetMs)).optional(),
    jitterMs: z.number().int().min(0).max(LIMITS.maxJitterMs).optional(),
    maxDispatchSkewMs: z.number().int().min(0).max(10_000).default(100),
    barrierTimeoutMs: timeoutMs.default(30_000),
    actionTimeoutMs: timeoutMs.default(5_000),
    prepareTimeoutMs: timeoutMs.default(30_000),
    requestFilter: requestFilter.optional(),
  })
  .refine((t) => t.mode !== 'staggered' || t.offsetsMs !== undefined, {
    message: 'timing.mode "staggered" requires offsetsMs',
    path: ['offsetsMs'],
  })
  .refine((t) => t.mode !== 'jitter' || t.jitterMs !== undefined, {
    message: 'timing.mode "jitter" requires jitterMs',
    path: ['jitterMs'],
  })
  .refine((t) => t.mode === 'staggered' || t.offsetsMs === undefined, {
    message: 'offsetsMs is only valid with mode "staggered"',
    path: ['offsetsMs'],
  })
  .refine((t) => t.mode === 'jitter' || t.jitterMs === undefined, {
    message: 'jitterMs is only valid with mode "jitter"',
    path: ['jitterMs'],
  });

const assertions = z.strictObject({
  settleMs: z.number().int().min(0).max(LIMITS.maxTimeoutMs).default(500),
  timeoutMs: timeoutMs.default(5_000),
  pollMs: z.number().int().min(25).max(10_000).default(250),
  checks: z.array(check).min(1, 'at least one assertion is required').max(LIMITS.maxChecks),
});

const run = z.strictObject({
  repeat: z.number().int().min(1).max(LIMITS.maxRepeat).default(1),
  seed: z.number().int().min(0).max(2 ** 32 - 1).optional(),
  browser: z.literal('chromium').default('chromium'),
  evidence: z.enum(['on-failure', 'always', 'none']).default('on-failure'),
  /** Opt-in raw Playwright traces (may contain sensitive data; kept locally). */
  trace: z.enum(['off', 'on-failure', 'always']).default('off'),
  headed: z.boolean().default(false),
});

export const scenarioSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().regex(/^[\w.-]{1,80}$/, 'name must be 1-80 chars of letters, digits, ".", "-" or "_"'),
  description: z.string().optional(),
  baseUrl: z.url({ protocol: /^https?$/, error: 'baseUrl must be an http(s) URL' }),
  actors: z
    .array(actor)
    .min(LIMITS.minActors, `at least ${LIMITS.minActors} actors are required`)
    .max(LIMITS.maxActors, `at most ${LIMITS.maxActors} actors are supported`),
  fixtures: fixtures.optional(),
  timing: timing.prefault({}),
  assertions,
  run: run.prefault({}),
});

export type Scenario = z.output<typeof scenarioSchema>;
export type Actor = Scenario['actors'][number];
export type PrepareStep = Actor['prepare'][number];
export type RaceAction = Actor['race'];
export type Check = Scenario['assertions']['checks'][number];
export type UiCheck = Extract<Check, { ui: unknown }>['ui'];
export type ApiCheck = Extract<Check, { api: unknown }>['api'];
export type HttpHook = NonNullable<NonNullable<Scenario['fixtures']>['reset']>;
export type Baseline = NonNullable<NonNullable<Scenario['fixtures']>['baseline']>;
export type Comparison = Pick<ApiCheck, 'pointer' | 'equals' | 'notEquals' | 'min' | 'max'>;
export type TimingConfig = Scenario['timing'];
export type RunConfig = Scenario['run'];
