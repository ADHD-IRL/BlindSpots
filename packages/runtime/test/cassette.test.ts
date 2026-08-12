import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type Cassette,
  CassetteIntegrityError,
  assertCassette,
} from '../src/cassette/types.ts';
import { cassetteFileName, loadCassetteLibrary, writeCassette } from '../src/cassette/library.ts';
import { cassetteKey } from '../src/model/key.ts';
import type { ModelRequest } from '../src/model/types.ts';

const request: ModelRequest = {
  purpose: 'phase1_finding',
  model: 'claude-opus-5',
  maxTokens: 2048,
  system: 'You are a domain persona.',
  messages: [{ role: 'user', content: 'State one finding.' }],
};

const valid: Cassette = {
  key: cassetteKey(request),
  origin: 'authored',
  capturedAt: '2026-08-11T00:00:00.000Z',
  capturedBy: 'system:test',
  note: 'exercises the accepted path',
  request,
  response: {
    text: '{"statement":"..."}',
    stopReason: 'end_turn',
    model: 'claude-opus-5',
    usage: { inputTokens: 10, outputTokens: 20 },
  },
};

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mae-cassettes-'));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Round-trip through JSON, because that is how a cassette actually arrives. */
function check(patch: Record<string, unknown>): () => unknown {
  return () => assertCassette(JSON.parse(JSON.stringify({ ...valid, ...patch })), 'test');
}

describe('cassette validation', () => {
  it('accepts a well-formed cassette', () => {
    expect(check({})()).toMatchObject({ origin: 'authored', key: valid.key });
  });

  it('rejects a cassette that declares no origin', () => {
    // Same argument as an ungraded field source. Guessing "recorded" would present an
    // invented response as something a model said; guessing "authored" would throw away a
    // real capture. Neither guess is available.
    expect(check({ origin: undefined })).toThrow(/does not declare a valid origin/);
  });

  it('rejects an authored cassette with no note', () => {
    expect(check({ note: '   ' })).toThrow(/must carry a note/);
  });

  it('does not require a note on a recorded cassette', () => {
    // A capture explains itself: a model produced it in response to the stored request.
    expect(check({ origin: 'recorded', note: undefined })).not.toThrow();
  });

  it('rejects a stored response that claims its own provenance', () => {
    // The single most important check here. If a file could assert provenance, a hand-written
    // cassette saying "live" would replay as a live result for the life of the repository.
    expect(
      check({ response: { ...valid.response, provenance: 'live' } }),
    ).toThrow(/must not carry a provenance field/);
  });

  it('rejects a cassette whose request was edited after capture', () => {
    // The response would then be bound to a prompt that never produced it, and the replay
    // would look perfect.
    expect(
      check({ request: { ...request, system: 'You are a challenger persona.' } }),
    ).toThrow(/key does not match its request/);
  });

  it('rejects an unknown stop reason', () => {
    expect(check({ response: { ...valid.response, stopReason: 'finished' } })).toThrow(
      /stopReason must be one of/,
    );
  });

  it('rejects a refusal category on a response that did not refuse', () => {
    expect(
      check({ response: { ...valid.response, refusalCategory: 'cyber' } }),
    ).toThrow(/only meaningful on a refusal/);
  });

  it.each([
    ['capturedBy', { capturedBy: '' }, /no capturedBy/],
    ['capturedAt', { capturedAt: 'last Tuesday' }, /valid capturedAt/],
    ['request', { request: null }, /no request/],
    ['response', { response: null }, /no response/],
    ['response.text', { response: { ...valid.response, text: 42 } }, /text must be a string/],
    ['response.model', { response: { ...valid.response, model: '' } }, /model is required/],
    ['response.usage', { response: { ...valid.response, usage: {} } }, /numeric inputTokens/],
    ['request.purpose', { request: { ...request, purpose: '' } }, /purpose is required/],
    ['request.maxTokens', { request: { ...request, maxTokens: 0 } }, /positive integer/],
    ['request.messages', { request: { ...request, messages: [] } }, /non-empty array/],
    [
      'message role',
      { request: { ...request, messages: [{ role: 'system', content: 'x' }] } },
      /role "user" or "assistant"/,
    ],
  ])('rejects a bad %s', (_name, patch, message) => {
    expect(check(patch)).toThrow(message as RegExp);
  });

  it('reports failures as CassetteIntegrityError with the file named', () => {
    expect(check({ origin: 'guessed' })).toThrow(CassetteIntegrityError);
    expect(check({ origin: 'guessed' })).toThrow(/^test: /);
  });

  it('rejects a cassette that is not an object at all', () => {
    expect(() => assertCassette([valid], 'test')).toThrow(/must be a JSON object/);
  });
});

describe('the cassette library on disk', () => {
  it('writes and loads a cassette unchanged', () => {
    const dir = tempDir();
    const path = writeCassette(dir, valid);
    expect(path.endsWith(cassetteFileName(valid))).toBe(true);

    const [loaded] = loadCassetteLibrary(dir);
    expect(loaded).toEqual(valid);
  });

  it('names files by purpose and key prefix', () => {
    expect(cassetteFileName(valid)).toBe(`phase1_finding.${valid.key.slice(0, 12)}.json`);
  });

  it('refuses to write a cassette that could never be replayed', () => {
    const dir = tempDir();
    const broken = { ...valid, key: 'f'.repeat(64) };
    expect(() => writeCassette(dir, broken)).toThrow(/key does not match its request/);
  });

  it('validates every file it loads, naming the offending path', () => {
    const dir = tempDir();
    writeCassette(dir, valid);
    const rogue = join(dir, 'rogue.json');
    writeFileSync(rogue, JSON.stringify({ ...valid, origin: 'recorded', key: 'x' }), 'utf8');
    expect(() => loadCassetteLibrary(dir)).toThrow(new RegExp(rogue.replace(/[.\\]/g, '\\$&')));
  });

  it('reports unparseable JSON as such rather than as a miss', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'truncated.json'), '{"key":', 'utf8');
    expect(() => loadCassetteLibrary(dir)).toThrow(/not valid JSON/);
  });

  it('throws on a missing directory rather than returning an empty library', () => {
    // An empty library and a missing one behave identically until the first call, at which
    // point every request misses and the error blames the request.
    expect(() => loadCassetteLibrary(join(tempDir(), 'nope'))).toThrow(/does not exist/);
  });

  it('ignores non-cassette files in the directory', () => {
    const dir = tempDir();
    writeCassette(dir, valid);
    writeFileSync(join(dir, 'README.md'), '# cassettes\n', 'utf8');
    expect(loadCassetteLibrary(dir)).toHaveLength(1);
  });

  it('writes readable JSON, because these files are reviewed by hand', () => {
    const dir = tempDir();
    const path = writeCassette(dir, valid);
    expect(readFileSync(path, 'utf8')).toContain('\n  "origin": "authored"');
  });
});
