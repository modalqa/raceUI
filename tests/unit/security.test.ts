import { describe, expect, it } from 'vitest';
import { createPolicy, isLoopbackHost, PolicyError } from '../../src/security/origin.js';
import { REDACTED, Redactor } from '../../src/security/redact.js';

describe('target origin policy', () => {
  it('recognizes loopback hosts', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['example.com', '10.0.0.1', '192.168.1.1', 'localhost.evil.com']) expect(isLoopbackHost(h)).toBe(false);
  });
  it('allows loopback by default and rejects other targets', () => {
    expect(createPolicy('http://127.0.0.1:3000').targetOrigin).toBe('http://127.0.0.1:3000');
    expect(() => createPolicy('https://staging.example.com')).toThrow(PolicyError);
  });
  it('requires explicit --allow-origin for non-loopback targets', () => {
    const p = createPolicy('https://staging.example.com/app', ['https://staging.example.com']);
    expect(p.resolve('/login')).toBe('https://staging.example.com/app/login');
    expect(p.isAllowed('https://evil.example.org/x')).toBe(false);
  });
  it('rejects unsupported schemes', () => {
    expect(() => createPolicy('file:///etc/passwd')).toThrow(PolicyError);
    const p = createPolicy('http://localhost:3000');
    expect(p.isAllowed('javascript:alert(1)')).toBe(false);
    expect(p.isAllowedBrowserRequest('data:image/png;base64,AAAA')).toBe(true);
  });
});

describe('Redactor', () => {
  it('redacts registered secrets, sensitive headers and query params', () => {
    const r = new Redactor(['s3cr3t-token']);
    expect(r.text('Bearer s3cr3t-token')).toBe(`Bearer ${REDACTED}`);
    expect(r.headers({ Authorization: 'Bearer abc', Accept: 'json', 'X-Api-Key': 'k' })).toEqual({ Authorization: REDACTED, Accept: 'json', 'X-Api-Key': REDACTED });
    const u = r.url('http://user:pw@localhost/cb?code=xyz&token=abc&page=2');
    expect(u).not.toContain('xyz');
    expect(u).not.toContain('abc');
    expect(u).not.toContain('pw@');
    expect(u).toContain('page=2');
  });
  it('remembers header secrets and scrubs them elsewhere', () => {
    const r = new Redactor();
    r.headers({ Authorization: 'Bearer hidden-value-123' });
    expect(r.deep({ msg: 'got hidden-value-123 back' })).toEqual({ msg: `got ${REDACTED} back` });
  });
});
