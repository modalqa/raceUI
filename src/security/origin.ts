import { isIP } from 'node:net';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (isIP(h) === 4) return h.startsWith('127.');
  if (h.startsWith('::ffff:')) return isLoopbackHost(h.slice(7));
  return false;
}

/** Normalizes an origin string (`https://Example.com:443/x` -> `https://example.com`). */
export function normalizeOrigin(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new PolicyError(`invalid origin "${input}"`);
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) throw new PolicyError(`unsupported URL scheme "${u.protocol}" in "${input}"`);
  return u.origin;
}

/**
 * Target-origin policy (PRD §8, §12). Loopback origins are allowed by default; anything else
 * must be authorized explicitly at invocation (`--allow-origin`). Scenario files cannot grant
 * themselves extra authorization.
 */
export class OriginPolicy {
  private readonly allowed: Set<string>;
  readonly targetOrigin: string;
  private readonly basePath: string;

  constructor(baseUrl: string, allowOrigins: string[] = []) {
    this.allowed = new Set(allowOrigins.map(normalizeOrigin));
    this.targetOrigin = normalizeOrigin(baseUrl);
    this.basePath = new URL(baseUrl).pathname.replace(/\/$/, '');
    if (!this.isAllowed(this.targetOrigin)) {
      throw new PolicyError(
        `target origin ${this.targetOrigin} is not loopback; authorize it explicitly with --allow-origin ${this.targetOrigin} (only for environments you are authorized to test)`,
      );
    }
  }

  get explicitOrigins(): string[] {
    return [...this.allowed];
  }

  isAllowed(url: string): boolean {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (!ALLOWED_SCHEMES.has(u.protocol)) return false;
    return isLoopbackHost(u.hostname) || this.allowed.has(u.origin);
  }

  /** Browser sub-resources: allow in-page schemes that never reach the network. */
  isAllowedBrowserRequest(url: string): boolean {
    if (/^(data|blob|about):/i.test(url)) return true;
    return this.isAllowed(url);
  }

  /** Resolves a scenario path against the base URL (keeping any base path) and verifies it stays approved. */
  resolve(pathname: string): string {
    const url = new URL(this.basePath + pathname, this.targetOrigin);
    if (!this.isAllowed(url.href)) throw new PolicyError(`resolved URL ${url.origin} is not an approved origin`);
    return url.href;
  }
}

export function createPolicy(baseUrl: string, allowOrigins: string[] = []): OriginPolicy {
  return new OriginPolicy(baseUrl, allowOrigins);
}
