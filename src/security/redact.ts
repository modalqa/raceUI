export const REDACTED = '[REDACTED]';

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$|token|secret|session|password|api[-_]?key|auth/i;
const SENSITIVE_PARAM = /token|secret|password|passwd|pwd|api[-_]?key|key|auth|session|sig|signature|code|credential|jwt/i;

/**
 * Redacts secrets from text, headers and URLs. Every resolved environment value and every
 * sensitive header value seen during a run is registered so it never appears in reports.
 */
export class Redactor {
  private readonly secrets = new Set<string>();

  constructor(secrets: Iterable<string> = []) {
    for (const s of secrets) this.add(s);
  }

  add(secret: string | undefined | null): void {
    if (!secret || secret.length < 3) return;
    this.secrets.add(secret);
    // Also catch the token part of "Bearer xyz" / "Basic xyz".
    const m = /^(?:bearer|basic|token)\s+(.+)$/i.exec(secret);
    if (m?.[1] && m[1].length >= 3) this.secrets.add(m[1]);
  }

  text(input: string): string {
    let out = input;
    // Longest first so overlapping secrets are fully removed.
    for (const s of [...this.secrets].sort((a, b) => b.length - a.length)) {
      if (out.includes(s)) out = out.split(s).join(REDACTED);
    }
    return out;
  }

  url(input: string): string {
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      return this.text(input);
    }
    if (u.username) u.username = 'redacted';
    if (u.password) u.password = 'redacted';
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) u.searchParams.set(key, REDACTED);
    }
    return this.text(u.toString().replace(/%5BREDACTED%5D/g, REDACTED));
  }

  headers(h: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!h) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (SENSITIVE_HEADER.test(k)) {
        this.add(v);
        out[k] = REDACTED;
      } else {
        out[k] = this.text(v);
      }
    }
    return out;
  }

  /** Deep-redacts any JSON-compatible value (strings are scrubbed of known secrets). */
  deep<T>(value: T): T {
    if (typeof value === 'string') return this.text(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.deep(v)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = k.toLowerCase() === 'headers' && v && typeof v === 'object' && !Array.isArray(v)
          ? this.headers(v as Record<string, string>)
          : this.deep(v);
      }
      return out as T;
    }
    return value;
  }
}

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER.test(name);
}
