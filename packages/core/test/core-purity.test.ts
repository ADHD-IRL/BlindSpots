import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `packages/core` holds every constraint the architecture enforces. It stays pure so those
 * constraints can be tested without a database, a network, or a model — which is the whole
 * reason the implementation plan puts the deterministic core before any model call.
 *
 * ESLint enforces this too. This test exists as well because a lint rule can be disabled
 * inline or skipped in a hurry, and this invariant should cost a red test to break.
 *
 * `node:crypto` is the single exception: deterministic, no I/O, and it lets `computeHash`
 * live beside the chain verifier it serves.
 */
const ALLOWED_EXTERNAL = new Set(['node:crypto']);

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Matches static imports, `export ... from`, and dynamic `import()`. */
const SPECIFIER = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g;

describe('core purity', () => {
  const files = walk(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))('%s imports nothing impure', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const offenders: string[] = [];

    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;
      const isRelative = specifier.startsWith('.');
      if (isRelative || ALLOWED_EXTERNAL.has(specifier)) continue;
      offenders.push(specifier);
    }

    expect(offenders, `packages/core must not import ${offenders.join(', ')}`).toEqual([]);
  });
});
