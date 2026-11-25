import type { Comparison } from '../schema/scenario.js';

export class PointerError extends Error {}

/** RFC 6901 JSON Pointer evaluation. Throws PointerError when the path does not exist. */
export function evaluatePointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) throw new PointerError(`invalid JSON Pointer "${pointer}"`);
  let cur: unknown = doc;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) throw new PointerError(`"${token}" is not a valid array index in ${pointer}`);
      const i = Number(token);
      if (i >= cur.length) throw new PointerError(`index ${i} out of range in ${pointer}`);
      cur = cur[i];
    } else if (cur !== null && typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, token)) throw new PointerError(`"${token}" not found in ${pointer}`);
      cur = (cur as Record<string, unknown>)[token];
    } else {
      throw new PointerError(`cannot descend into non-container at "${token}" in ${pointer}`);
    }
  }
  return cur;
}

export interface ComparisonResult {
  pass: boolean;
  expected: Record<string, unknown>;
  reason?: string;
}

/** Typed comparison: equals/notEquals use strict JSON equality; min/max require numbers. */
export function compare(observed: unknown, c: Pick<Comparison, 'equals' | 'notEquals' | 'min' | 'max'>): ComparisonResult {
  const expected: Record<string, unknown> = {};
  const reasons: string[] = [];
  if (c.equals !== undefined) {
    expected.equals = c.equals;
    if (observed !== c.equals) reasons.push(`expected ${JSON.stringify(c.equals)}, observed ${JSON.stringify(observed)}`);
  }
  if (c.notEquals !== undefined) {
    expected.notEquals = c.notEquals;
    if (observed === c.notEquals) reasons.push(`expected value other than ${JSON.stringify(c.notEquals)}`);
  }
  if (c.min !== undefined || c.max !== undefined) {
    if (c.min !== undefined) expected.min = c.min;
    if (c.max !== undefined) expected.max = c.max;
    if (typeof observed !== 'number') {
      reasons.push(`expected a number, observed ${JSON.stringify(observed)}`);
    } else {
      if (c.min !== undefined && observed < c.min) reasons.push(`observed ${observed} < min ${c.min}`);
      if (c.max !== undefined && observed > c.max) reasons.push(`observed ${observed} > max ${c.max}`);
    }
  }
  return { pass: reasons.length === 0, expected, ...(reasons.length ? { reason: reasons.join('; ') } : {}) };
}

/** Summarizes the expected value for display (e.g. "1", ">= 0", "<= 1"). */
export function describeExpected(e: Record<string, unknown>): string {
  const parts: string[] = [];
  if ('equals' in e) parts.push(JSON.stringify(e.equals));
  if ('notEquals' in e) parts.push(`!= ${JSON.stringify(e.notEquals)}`);
  if ('min' in e) parts.push(`>= ${String(e.min)}`);
  if ('max' in e) parts.push(`<= ${String(e.max)}`);
  return parts.join(' and ');
}
