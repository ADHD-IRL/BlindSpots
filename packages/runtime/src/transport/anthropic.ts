import Anthropic from '@anthropic-ai/sdk';
import { resolveRequest } from '../model/key.ts';
import type { ModelRequest, ModelResponse, ModelTransport, StopReason } from '../model/types.ts';

/**
 * The narrow seam onto the SDK.
 *
 * Typed against the SDK's own parameter and message types so the mapping below cannot drift
 * from the API, but narrow enough that a test can substitute a stub without constructing a
 * client. Streaming is used rather than a plain create: these are long, high-`max_tokens`
 * analytical calls, and a non-streaming request of that shape is the one that hits a
 * request timeout.
 */
export interface AnthropicLike {
  readonly messages: {
    stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      'AnthropicTransport needs an API key (ANTHROPIC_API_KEY or the apiKey option). ' +
        'No key is not a reason to fabricate output: use RecordedTransport over the ' +
        'cassettes in fixtures/cassettes/, whose responses are marked for what they are.',
    );
    this.name = 'MissingCredentialsError';
  }
}

export interface AnthropicTransportOptions {
  readonly client?: AnthropicLike;
  readonly apiKey?: string;
  readonly id?: string;
}

/**
 * The live transport.
 *
 * Notably absent: `temperature`, `top_p`, `top_k`, and `thinking.budget_tokens`. All four are
 * rejected with a 400 on this model family, and none of them can be expressed by
 * `ModelRequest` — a request shape with no field for a removed parameter cannot grow one
 * back by accident.
 *
 * This class is the only thing in the repository that opens a network connection to a model,
 * and nothing in `packages/core` can reach it.
 */
export class AnthropicTransport implements ModelTransport {
  readonly id: string;
  #client: AnthropicLike;

  constructor(options: AnthropicTransportOptions = {}) {
    this.id = options.id ?? 'anthropic';

    if (options.client !== undefined) {
      this.#client = options.client;
      return;
    }

    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    if (apiKey === '') throw new MissingCredentialsError();
    this.#client = new Anthropic({ apiKey });
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const r = resolveRequest(request);

    const message = await this.#client.messages
      .stream({
        model: r.model,
        max_tokens: r.maxTokens,
        system: r.system,
        messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
        thinking: r.thinking === 'adaptive' ? { type: 'adaptive' } : { type: 'disabled' },
        output_config: {
          effort: r.effort,
          ...(r.outputSchema === null
            ? {}
            : { format: { type: 'json_schema' as const, schema: r.outputSchema } }),
        },
      })
      .finalMessage();

    // Read the stop reason before the content, always. On a refusal the content is empty,
    // and code that reads text first cannot tell "refused" from "had nothing to say".
    const stopReason: StopReason = message.stop_reason ?? 'end_turn';
    const refusalCategory =
      stopReason === 'refusal' ? (message.stop_details?.category ?? 'unspecified') : undefined;

    // Thinking blocks are deliberately not concatenated into the text. They are a reasoning
    // trace, not a finding, and a charter validator run over them would be validating the
    // wrong artifact.
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      stopReason,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      ...(refusalCategory === undefined ? {} : { refusalCategory }),
      provenance: 'live',
      transportId: this.id,
    };
  }
}
