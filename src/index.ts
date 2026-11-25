/** Programmatic API (unstable in v0.1; the CLI and JSON report are the supported contracts). */
export { loadScenario, parseScenarioText, checkReferences, checkRepeatPolicy, ConfigError } from './schema/load.js';
export { scenarioSchema, LIMITS } from './schema/scenario.js';
export type { Scenario, Actor, Check } from './schema/scenario.js';
export { runScenario, resolveRunConfig } from './engine/runner.js';
export type { RunOptions, RunOutcome } from './engine/runner.js';
export { Barrier, BarrierError } from './engine/barrier.js';
export { planOffsets, attemptSeed, evaluateTiming, mulberry32 } from './engine/scheduler.js';
export { classifyAttempt, aggregateStatus, EXIT } from './assertions/classify.js';
export { evaluatePointer, compare } from './assertions/compare.js';
export { OriginPolicy, PolicyError, createPolicy, isLoopbackHost } from './security/origin.js';
export { Redactor, REDACTED } from './security/redact.js';
export type * from './reporters/types.js';
export { VERSION } from './version.js';
