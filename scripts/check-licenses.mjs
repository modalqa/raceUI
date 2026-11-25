#!/usr/bin/env node
/**
 * Verifies the licenses of RaceUI's runtime dependency tree (PRD §15).
 * Walks `dependencies` transitively from package.json via node_modules and fails (exit 1) when a
 * package has a license outside the allowlist. Prints a Markdown table.
 *
 *   node scripts/check-licenses.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0']);

function findPkg(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const seen = new Map();
const queue = Object.keys(root.dependencies ?? {}).map((n) => [n, ROOT]);
while (queue.length) {
  const [name, from] = queue.shift();
  const file = findPkg(name, from);
  if (!file) {
    seen.set(name, { version: '?', license: 'MISSING' });
    continue;
  }
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');
  seen.set(key, { version: pkg.version, license });
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dep, path.dirname(file)]);
}

const ok = (lic) => lic.replace(/[()]/g, '').split(/\s+OR\s+/).some((l) => ALLOWED.has(l.trim()));
let bad = 0;
console.log('| Package | License | OK |\n|---|---|---|');
for (const [key, { license }] of [...seen].sort()) {
  const good = ok(license);
  if (!good) bad++;
  console.log(`| ${key} | ${license} | ${good ? 'yes' : '**NO**'} |`);
}
console.log(`\n${seen.size} runtime packages checked; ${bad} outside the allowlist (${[...ALLOWED].join(', ')}).`);
process.exitCode = bad ? 1 : 0;
