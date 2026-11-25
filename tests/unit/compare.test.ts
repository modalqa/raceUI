import { describe, expect, it } from 'vitest';
import { compare, evaluatePointer, PointerError } from '../../src/assertions/compare.js';

describe('evaluatePointer (RFC 6901)', () => {
  const doc = { foo: ['bar', 'baz'], '': 0, 'a/b': 1, 'm~n': 8, nested: { count: 2 } };
  it('resolves standard pointers', () => {
    expect(evaluatePointer(doc, '')).toBe(doc);
    expect(evaluatePointer(doc, '/foo/0')).toBe('bar');
    expect(evaluatePointer(doc, '/')).toBe(0);
    expect(evaluatePointer(doc, '/a~1b')).toBe(1);
    expect(evaluatePointer(doc, '/m~0n')).toBe(8);
    expect(evaluatePointer(doc, '/nested/count')).toBe(2);
  });
  it('throws on missing paths', () => {
    expect(() => evaluatePointer(doc, '/missing')).toThrow(PointerError);
    expect(() => evaluatePointer(doc, '/foo/7')).toThrow(PointerError);
    expect(() => evaluatePointer(doc, '/foo/01')).toThrow(PointerError);
  });
});

describe('compare', () => {
  it('uses strict typed equality', () => {
    expect(compare(1, { equals: 1 }).pass).toBe(true);
    expect(compare('1', { equals: 1 }).pass).toBe(false);
    expect(compare(2, { notEquals: 1 }).pass).toBe(true);
  });
  it('requires numbers for min/max', () => {
    expect(compare(0, { min: 0, max: 1 }).pass).toBe(true);
    expect(compare(2, { max: 1 }).pass).toBe(false);
    expect(compare('2', { max: 5 }).pass).toBe(false);
  });
});
