import type { APIRequestContext } from 'playwright';
import type { OriginPolicy } from '../security/origin.js';

export interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
  json?: unknown;
  durationMs: number;
}

export class HttpError extends Error {}

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

const MAX_BODY = 1024 * 1024;

/**
 * Minimal HTTP client for fixture hooks and read-only API assertions.
 * Redirects are never followed, so a hook cannot bounce RaceUI to an unapproved target.
 */
export async function httpRequest(policy: OriginPolicy, req: HttpRequest, viaContext?: APIRequestContext): Promise<HttpResult> {
  if (!policy.isAllowed(req.url)) throw new HttpError(`refusing request to unapproved origin ${new URL(req.url).origin}`);
  const started = performance.now();
  const headers: Record<string, string> = { accept: 'application/json', ...(req.headers ?? {}) };
  let data: string | undefined;
  if (req.body !== undefined) {
    data = JSON.stringify(req.body);
    headers['content-type'] ??= 'application/json';
  }

  if (viaContext) {
    const res = await viaContext.fetch(req.url, { method: req.method, headers, data, timeout: req.timeoutMs, maxRedirects: 0, failOnStatusCode: false });
    const body = (await res.text()).slice(0, MAX_BODY);
    return finish(res.status(), body, started);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetch(req.url, { method: req.method, headers, body: data, redirect: 'manual', signal: ctrl.signal });
    const body = (await res.text()).slice(0, MAX_BODY);
    return finish(res.status, body, started);
  } catch (err) {
    if (ctrl.signal.aborted) throw new HttpError(`request timed out after ${req.timeoutMs} ms`);
    throw new HttpError(`request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function finish(status: number, body: string, started: number): HttpResult {
  if (status >= 300 && status < 400) throw new HttpError(`unexpected redirect (HTTP ${status}); redirects are not followed`);
  let json: unknown;
  try {
    json = body.length ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  return { status, ok: status >= 200 && status < 300, body, json, durationMs: Math.round(performance.now() - started) };
}

/** Replaces runtime placeholders (${RUN_ID}, ${ATTEMPT}, ${RESOURCE_ID}). */
export function applyRuntime(input: string, vars: Record<string, string>): string {
  return input.replace(/\$\{(RUN_ID|ATTEMPT|RESOURCE_ID)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function applyRuntimeHeaders(h: Record<string, string> | undefined, vars: Record<string, string>): Record<string, string> | undefined {
  if (!h) return undefined;
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, applyRuntime(v, vars)]));
}

export function applyRuntimeDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return applyRuntime(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => applyRuntimeDeep(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, applyRuntimeDeep(v, vars)])) as T;
  }
  return value;
}
