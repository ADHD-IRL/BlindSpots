import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../src/model/types.ts';
import {
  type AnthropicLike,
  AnthropicTransport,
  MissingCredentialsError,
} from '../src/transport/anthropic.ts';

/**
 * These tests never open a socket. They drive the live transport against a stub client, which
 * is the only way to check the request mapping without credentials — and the request mapping
 * is where the removed sampling parameters would creep back in.
 */

const request: ModelRequest = {
  purpose: 'phase1_finding',
  model: 'claude-opus-5',
  maxTokens: 2048,
  system: 'You are a domain persona.',
  messages: [{ role: 'user', content: 'State one finding.' }],
};

function message(patch: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'a finding', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    ...patch,
  } as unknown as Anthropic.Message;
}

function stub(reply: Anthropic.Message): {
  client: AnthropicLike;
  params: Anthropic.MessageStreamParams[];
} {
  const params: Anthropic.MessageStreamParams[] = [];
  return {
    params,
    client: {
      messages: {
        stream(p: Anthropic.MessageStreamParams) {
          params.push(p);
          return { finalMessage: async () => reply };
        },
      },
    },
  };
}

describe('the request sent to the Messages API', () => {
  it('carries the resolved request and nothing else', async () => {
    const { client, params } = stub(message());
    await new AnthropicTransport({ client }).complete(request);

    expect(params[0]).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 2048,
      system: 'You are a domain persona.',
      messages: [{ role: 'user', content: 'State one finding.' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
  });

  it.each(['temperature', 'top_p', 'top_k'])('never sends %s', async (field) => {
    // All three are rejected with a 400 on this model family. `ModelRequest` has no field for
    // any of them, so there is nothing to send — this asserts the mapping did not add one.
    const { client, params } = stub(message());
    await new AnthropicTransport({ client }).complete(request);
    expect(params[0]).not.toHaveProperty(field);
  });

  it('never sends thinking.budget_tokens', async () => {
    const { client, params } = stub(message());
    await new AnthropicTransport({ client }).complete(request);
    expect(params[0]!.thinking).toEqual({ type: 'adaptive' });
  });

  it('omits output_config.format when no schema was asked for', async () => {
    const { client, params } = stub(message());
    await new AnthropicTransport({ client }).complete(request);
    expect(params[0]!.output_config).not.toHaveProperty('format');
  });

  it('sends a structured-output format when a schema was asked for', async () => {
    const { client, params } = stub(message());
    const schema = { type: 'object', properties: { statement: { type: 'string' } } };
    await new AnthropicTransport({ client }).complete({ ...request, outputSchema: schema });
    expect(params[0]!.output_config?.format).toEqual({ type: 'json_schema', schema });
  });

  it('honours an explicit effort and thinking setting', async () => {
    const { client, params } = stub(message());
    await new AnthropicTransport({ client }).complete({
      ...request,
      effort: 'low',
      thinking: 'disabled',
    });
    expect(params[0]!.output_config?.effort).toBe('low');
    expect(params[0]!.thinking).toEqual({ type: 'disabled' });
  });
});

describe('the response read back', () => {
  it('marks a live call live, and names the transport', async () => {
    const { client } = stub(message());
    const response = await new AnthropicTransport({ client, id: 'anthropic:primary' }).complete(request);
    expect(response.provenance).toBe('live');
    expect(response.transportId).toBe('anthropic:primary');
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('reports the model that answered, not the one requested', async () => {
    const { client } = stub(message({ model: 'claude-opus-5-20260101' }));
    expect((await new AnthropicTransport({ client }).complete(request)).model).toBe(
      'claude-opus-5-20260101',
    );
  });

  it('surfaces a refusal instead of an empty answer', async () => {
    // stop_reason has to be read before the content. On a refusal the content is empty, and
    // code that reads text first cannot tell "refused" from "found nothing".
    const { client } = stub(
      message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
      } as unknown as Partial<Anthropic.Message>),
    );
    const response = await new AnthropicTransport({ client }).complete(request);
    expect(response.stopReason).toBe('refusal');
    expect(response.refusalCategory).toBe('cyber');
  });

  it('falls back to an unspecified category when the API gives no detail', async () => {
    const { client } = stub(message({ content: [], stop_reason: 'refusal' }));
    expect((await new AnthropicTransport({ client }).complete(request)).refusalCategory).toBe(
      'unspecified',
    );
  });

  it('sets no refusal category when the model did not refuse', async () => {
    const { client } = stub(message());
    expect((await new AnthropicTransport({ client }).complete(request)).refusalCategory).toBeUndefined();
  });

  it('does not fold thinking blocks into the finding text', async () => {
    // A reasoning trace is not a finding. Concatenating it would run the charter validator
    // over the wrong artifact, and would put unvalidated reasoning into the output package.
    const { client } = stub(
      message({
        content: [
          { type: 'thinking', thinking: 'weighing the evidence', signature: 'sig' },
          { type: 'text', text: 'a finding', citations: null },
        ],
      } as unknown as Partial<Anthropic.Message>),
    );
    expect((await new AnthropicTransport({ client }).complete(request)).text).toBe('a finding');
  });

  it('concatenates multiple text blocks in order', async () => {
    const { client } = stub(
      message({
        content: [
          { type: 'text', text: 'part one ', citations: null },
          { type: 'text', text: 'part two', citations: null },
        ],
      } as unknown as Partial<Anthropic.Message>),
    );
    expect((await new AnthropicTransport({ client }).complete(request)).text).toBe(
      'part one part two',
    );
  });

  it('treats a null stop_reason as end_turn', async () => {
    const { client } = stub(message({ stop_reason: null }));
    expect((await new AnthropicTransport({ client }).complete(request)).stopReason).toBe('end_turn');
  });
});

describe('credentials', () => {
  const saved = process.env['ANTHROPIC_API_KEY'];
  afterEach(() => {
    if (saved === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = saved;
  });

  it('refuses to construct without a key, and points at the fixture transport', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => new AnthropicTransport()).toThrow(MissingCredentialsError);
    expect(() => new AnthropicTransport()).toThrow(/RecordedTransport over the cassettes/);
  });

  it('constructs a client from the environment when a key is present', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-not-a-real-key';
    // Constructing opens no connection; this only proves the credential path is wired.
    expect(new AnthropicTransport().id).toBe('anthropic');
  });
});
