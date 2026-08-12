import { cassetteKey } from '../model/key.ts';
import type { ModelRequest, ModelResponse, ModelTransport } from '../model/types.ts';
import type { Cassette } from '../cassette/types.ts';

/** Where captured cassettes go. Injected, so this transport performs no I/O of its own. */
export type CassetteSink = (cassette: Cassette) => void;

export interface RecordingTransportOptions {
  readonly capturedBy: string;
  /** Injected so recordings are reproducible under test. */
  readonly now?: () => string;
  readonly id?: string;
}

/**
 * Wraps a live transport and captures what it returns.
 *
 * Only `live` responses are captured. Wrapping a `RecordedTransport` and writing the result
 * back out would mint fresh "recorded" cassettes from replays — and, worse, from authored
 * ones, turning something a human invented into something a model is recorded as having
 * said. That is the laundering path this whole provenance scheme exists to close, so it
 * throws rather than being merely discouraged.
 */
export class RecordingTransport implements ModelTransport {
  readonly id: string;
  #inner: ModelTransport;
  #sink: CassetteSink;
  #capturedBy: string;
  #now: () => string;

  constructor(inner: ModelTransport, sink: CassetteSink, options: RecordingTransportOptions) {
    if (options.capturedBy.trim() === '') {
      throw new Error('RecordingTransport requires capturedBy: a capture is attributable work.');
    }
    this.#inner = inner;
    this.#sink = sink;
    this.#capturedBy = options.capturedBy;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? `recording:${inner.id}`;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.#inner.complete(request);

    if (response.provenance !== 'live') {
      throw new Error(
        `Refusing to record a "${response.provenance}" response from transport ` +
          `"${response.transportId}". Only a live model call can be captured as a recording; ` +
          'recording a replay would re-stamp it as something a model produced.',
      );
    }

    // A refusal or a truncation is recorded as faithfully as a completion. The cassette is a
    // record of what happened, not of what was wanted; `assertUsable` is where the caller
    // decides what to do about it.
    this.#sink({
      key: cassetteKey(request),
      origin: 'recorded',
      capturedAt: this.#now(),
      capturedBy: this.#capturedBy,
      request,
      response: {
        text: response.text,
        stopReason: response.stopReason,
        model: response.model,
        usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
        ...(response.refusalCategory === undefined ? {} : { refusalCategory: response.refusalCategory }),
      },
    });

    return {
      text: response.text,
      stopReason: response.stopReason,
      model: response.model,
      usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      ...(response.refusalCategory === undefined ? {} : { refusalCategory: response.refusalCategory }),
      provenance: 'live',
      transportId: this.id,
    };
  }
}
