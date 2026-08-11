import { describe, expect, it } from 'vitest';
import type { Cassette } from '../src/cassette/types.ts';
import { cassetteKey } from '../src/model/key.ts';
import {
  ModelRefusalError,
  type ModelRequest,
  type ModelResponse,
  TruncatedResponseError,
  assertUsable,
} from '../src/model/types.ts';
import { CassetteMissError, RecordedTransport } from '../src/transport/recorded.ts';

const request: ModelRequest = {
  purpose: 'phase1_finding',
  model: 'claude-opus-5',
  maxTokens: 2048,
  system: 'You are a domain persona.',
  messages: [{ role: 'user', content: 'State one finding.' }],
};

function cassette(overrides: Partial<Cassette> = {}): Cassette {
  const req = overrides.request ?? request;
  return {
    key: cassetteKey(req),
    origin: 'authored',
    capturedAt: '2026-08-11T00:00:00.000Z',
    capturedBy: 'system:test',
    note: 'test fixture',
    request: req,
    response: {
      text: 'a finding',
      stopReason: 'end_turn',
      model: 'claude-opus-5',
      usage: { inputTokens: 10, outputTokens: 20 },
    },
    ...overrides,
  };
}

describe('replaying a cassette', () => {
  it('returns the recorded response for a matching request', async () => {
    const transport = new RecordedTransport([cassette()]);
    const response = await transport.complete(request);
    expect(response.text).toBe('a finding');
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(response.transportId).toBe('recorded');
  });

  it('marks an authored cassette as authored, not replayed', async () => {
    // The distinction the whole scheme exists for. `replayed` says a model said this once;
    // `authored` says no model has ever said it. A run over authored cassettes shows the
    // machinery works and shows nothing at all about what a model would produce.
    const transport = new RecordedTransport([cassette({ origin: 'authored' })]);
    expect((await transport.complete(request)).provenance).toBe('authored');
  });

  it('marks a recorded cassette as replayed, never as live', async () => {
    const transport = new RecordedTransport([cassette({ origin: 'recorded' })]);
    expect((await transport.complete(request)).provenance).toBe('replayed');
  });

  it('derives provenance from the origin, ignoring anything the response carries', async () => {
    // Loading validates this away, but the transport must not depend on having been given
    // validated input: provenance is decided here and only here.
    const forged = cassette({
      origin: 'authored',
      response: {
        text: 'a finding',
        stopReason: 'end_turn',
        model: 'claude-opus-5',
        usage: { inputTokens: 10, outputTokens: 20 },
        provenance: 'live',
      } as unknown as Cassette['response'],
    });
    const response = await new RecordedTransport([forged]).complete(request);
    expect(response.provenance).toBe('authored');
  });

  it('replays a refusal as a refusal', async () => {
    const refusal = cassette({
      response: {
        text: '',
        stopReason: 'refusal',
        model: 'claude-opus-5',
        usage: { inputTokens: 10, outputTokens: 0 },
        refusalCategory: 'unspecified',
      },
    });
    const response = await new RecordedTransport([refusal]).complete(request);
    expect(response.stopReason).toBe('refusal');
    expect(response.refusalCategory).toBe('unspecified');
  });
});

describe('a cassette miss', () => {
  const transport = new RecordedTransport([cassette()], { label: 'fixtures/cassettes' });

  it('throws rather than inventing a response', async () => {
    // The one behaviour that makes this transport safe to build the persona runtime on. A
    // transport that fabricates on a miss produces a suite that is green and has tested
    // nothing, and it is invisible exactly when the prompt has changed under it.
    await expect(transport.complete({ ...request, system: 'different' })).rejects.toThrow(
      CassetteMissError,
    );
  });

  it('names the purpose, the key and the library it searched', async () => {
    await expect(transport.complete({ ...request, purpose: 'challenge_response' })).rejects.toThrow(
      /purpose "challenge_response".*fixtures\/cassettes \(1 cassette/s,
    );
  });

  it('says what to do instead of guessing', async () => {
    await expect(transport.complete({ ...request, maxTokens: 4096 })).rejects.toThrow(
      /re-record against a live transport, or author a cassette/,
    );
  });

  it('reports a hit or miss without performing one', () => {
    expect(transport.has(request)).toBe(true);
    expect(transport.has({ ...request, purpose: 'other' })).toBe(false);
    expect(transport.keyFor(request)).toBe(cassetteKey(request));
  });
});

describe('the library itself', () => {
  it('rejects two cassettes claiming the same key', () => {
    // Identical requests with different answers make replay order-dependent, which is the
    // one property a fixture transport must not have.
    expect(
      () => new RecordedTransport([cassette({ origin: 'authored' }), cassette({ origin: 'recorded' })]),
    ).toThrow(/Two cassettes claim key/);
  });

  it('reports its size and contents', () => {
    const transport = new RecordedTransport([cassette()]);
    expect(transport.size).toBe(1);
    expect(transport.cassettes().map((c) => c.request.purpose)).toEqual(['phase1_finding']);
  });
});

describe('assertUsable', () => {
  const response = (patch: Partial<ModelResponse>): ModelResponse => ({
    text: 'a finding',
    stopReason: 'end_turn',
    model: 'claude-opus-5',
    usage: { inputTokens: 10, outputTokens: 20 },
    provenance: 'authored',
    transportId: 'recorded',
    ...patch,
  });

  it('passes a completed response through', () => {
    const ok = response({});
    expect(assertUsable(ok)).toBe(ok);
  });

  it('throws on a refusal rather than yielding an empty finding', () => {
    expect(() => assertUsable(response({ stopReason: 'refusal', text: '' }))).toThrow(
      ModelRefusalError,
    );
  });

  it.each(['max_tokens', 'model_context_window_exceeded'] as const)(
    'throws on %s, because a truncated finding loses its caveats last',
    (stopReason) => {
      expect(() => assertUsable(response({ stopReason }))).toThrow(TruncatedResponseError);
    },
  );

  it('carries the response on the error so it can be logged', () => {
    const refused = response({ stopReason: 'refusal', refusalCategory: 'unspecified' });
    try {
      assertUsable(refused);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ModelRefusalError).response).toBe(refused);
      expect((error as Error).message).toContain('unspecified');
    }
  });
});
