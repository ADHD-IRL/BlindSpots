import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CassetteSink } from '../transport/recording.ts';
import { type Cassette, assertCassette } from './types.ts';

const SUFFIX = '.json';

/**
 * `<purpose>.<key prefix>.json`.
 *
 * The purpose makes the directory readable; the key prefix makes the name unique and ties
 * the file to the request it answers. The full key is inside the file and is the only thing
 * lookup uses — the filename is a convenience and is never trusted.
 */
export function cassetteFileName(cassette: Cassette): string {
  const slug = cassette.request.purpose.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  return `${slug === '' ? 'call' : slug}.${cassette.key.slice(0, 12)}${SUFFIX}`;
}

/**
 * Loads and validates every cassette in a directory.
 *
 * A missing directory throws rather than yielding an empty library. An empty library is
 * indistinguishable from a correct one until the first call, at which point every request
 * misses and the message blames the request. Failing here names the actual problem.
 */
export function loadCassetteLibrary(dir: string): Cassette[] {
  if (!existsSync(dir)) {
    throw new Error(
      `Cassette directory ${dir} does not exist. An empty library is not the same as a ` +
        'missing one, and only one of them is worth reporting as a cassette miss.',
    );
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(SUFFIX))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
      }
      return assertCassette(parsed, path);
    });
}

/** Writes one cassette, validating it on the way out. Returns the path written. */
export function writeCassette(dir: string, cassette: Cassette): string {
  // Round-tripped through the same validator that guards loading, so a cassette that could
  // never be replayed is never written in the first place.
  const validated = assertCassette(JSON.parse(JSON.stringify(cassette)), '<in-memory cassette>');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, cassetteFileName(validated));
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return path;
}

/** A sink for `RecordingTransport` that writes each capture to `dir`. */
export function fileCassetteSink(dir: string): CassetteSink {
  return (cassette) => {
    writeCassette(dir, cassette);
  };
}
