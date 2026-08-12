import { describe, expect, it } from 'vitest';
import type { Cassette } from '../src/cassette/types.ts';
import { assertCassette } from '../src/cassette/types.ts';
import { cassetteKey } from '../src/model/key.ts';
import type {
  ModelProvenance,
  ModelRequest,
  ModelResponse,
  ModelTransport,
} from '../src/model/types.ts';
import { RecordedTransport } from '../src/transport/recorded.ts';
import { RecordingTransport } from '../src/transport/recording.ts';

const request: ModelRequest = {
  purpose: 'phase1_finding',
  model: 'claude-opus-5',
  maxTokens: 2048,
  system: 'You are a domain persona.',
  messages: [{ role: 'user', content: 'State one finding.' }],
};

class StubTransport implements ModelTransport {
  readonly id = 'stub';
  #response: Partial<ModelResponse>;

  constructor(response: Partial<ModelResponse> = {}) {
    this.#response = response;
  }

  async complete(): Promise<ModelResponse> {
    return {
      text: 'a finding',
      stopReason: 'end_turn',
      model: 'claude-opus-5',
      usage: { inputTokens: 100, outputTokens: 50 },
      provenance: 'live',
      transportId: this.id,
      ...this.#response,
    };
  }
}

function capture(inner: ModelTransport): { transport: RecordingTransport; written: Cassette[] } {
  const written: Cassette[] = [];
  const transport = new RecordingTransport(inner, (c) => written.push(c), {
    capturedBy: 'human:test_operator',
    now: () => '2026-08-11T00:00:00.000Z',
  });
  return { transport, written };
}

describe('recording a live call', () => {
  it('writes a cassette that validates and replays identically', async () => {
    const { transport, written } = capture(new StubTransport());
    const live = await transport.complete(request);

    expect(written).toHaveLength(1);
    const cassette = assertCassette(JSON.parse(JSON.stringify(written[0])), 'captured');
    expect(cassette.origin).toBe('recorded');
    expect(cassette.capturedBy).toBe('human:test_operator');
    expect(cassette.key).toBe(cassetteKey(request));

    const replayed = await new RecordedTransport([cassette]).complete(request);
    expect(replayed.text).toBe(live.text);
    expect(replayed.usage).toEqual(live.usage);
    // The one field that must differ. The capture was live; every replay of it is not.
    expect(live.provenance).toBe('live');
    expect(replayed.provenance).toBe('replayed');
  });

  it('records a refusal as faithfully as a completion', async () => {
    // The cassette is a record of what happened, not of what was wanted. Deciding what to do
    // about a refusal belongs to assertUsable, not to whether it gets written down.
    const { transport, written } = capture(
      new StubTransport({ text: '', stopReason: 'refusal', refusalCategory: 'unspecified' }),
    );
    await transport.complete(request);
    expect(written[0]!.response.stopReason).toBe('refusal');
    expect(written[0]!.response.refusalCategory).toBe('unspecified');
  });

  it('identifies itself as the recording wrapper', async () => {
    const { transport } = capture(new StubTransport());
    expect((await transport.complete(request)).transportId).toBe('recording:stub');
  });

  it('requires a named capturer', () => {
    expect(
      () => new RecordingTransport(new StubTransport(), () => {}, { capturedBy: '  ' }),
    ).toThrow(/requires capturedBy/);
  });
});

describe('what recording refuses to do', () => {
  it.each(['replayed', 'authored'] as const)(
    'refuses to record a %s response',
    async (provenance: ModelProvenance) => {
      // The laundering path. Recording a replay re-stamps it as a fresh capture; recording an
      // authored response turns something a human wrote into something a model is on record
      // as having said. Neither is a warning — both throw.
      const { transport, written } = capture(new StubTransport({ provenance }));
      await expect(transport.complete(request)).rejects.toThrow(/Refusing to record a "/);
      expect(written).toHaveLength(0);
    },
  );

  it('names the transport it refused, so the wiring mistake is findable', async () => {
    const { transport } = capture(new StubTransport({ provenance: 'authored' }));
    await expect(transport.complete(request)).rejects.toThrow(/transport "stub"/);
  });

  it('cannot be chained onto a RecordedTransport', async () => {
    // The mistake this catches is easy to make: point the recorder at whatever transport is
    // configured, in an environment where that is the fixture one.
    const inner = new RecordedTransport([
      {
        key: cassetteKey(request),
        origin: 'authored',
        capturedAt: '2026-08-11T00:00:00.000Z',
        capturedBy: 'system:test',
        note: 'authored fixture',
        request,
        response: {
          text: 'a finding',
          stopReason: 'end_turn',
          model: 'claude-opus-5',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
    ]);
    const { transport } = capture(inner);
    await expect(transport.complete(request)).rejects.toThrow(/Only a live model call/);
  });
});
