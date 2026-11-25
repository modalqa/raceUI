import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type EvidenceMode = 'on-failure' | 'always' | 'none';

/** Writes per-attempt evidence under the run directory; all returned paths are relative to it (NFR-06). */
export class EvidenceCollector {
  constructor(
    readonly runDir: string,
    readonly mode: EvidenceMode,
  ) {}

  shouldCapture(status: string): boolean {
    if (this.mode === 'none') return false;
    if (this.mode === 'always') return true;
    return status !== 'PASS';
  }

  attemptDirName(index: number): string {
    return `attempt-${String(index).padStart(3, '0')}`;
  }

  /** Returns [absolute, relative] paths for a file in the attempt directory, creating it. */
  file(index: number, name: string): [string, string] {
    const dir = path.join(this.runDir, this.attemptDirName(index));
    mkdirSync(dir, { recursive: true });
    const rel = `${this.attemptDirName(index)}/${name}`;
    return [path.join(dir, name), rel];
  }

  writeJson(index: number, name: string, data: unknown): string {
    const [abs, rel] = this.file(index, name);
    writeFileSync(abs, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return rel;
  }
}

/** Makes an actor id safe to use as a file name. */
export function safeName(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '_');
}
