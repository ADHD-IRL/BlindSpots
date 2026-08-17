import { cassetteKey } from '../model/key.ts';
import type { ModelRequest, ModelResponse, ModelTransport } from '../model/types.ts';
import { type Cassette, PROVENANCE_BY_ORIGIN } from '../cassette/types.ts';

/**
 * A cassette miss.
 *
 * This throws. It does not fall through to a live call, it does not return a placeholder,
 * and it does not synthesize a plausible answer — which is the entire reason this transport
 * is safe to build the persona runtime on. A transport that quietly invents a response on a
 * miss produces a green test suite that has tested nothing, and the failure is invisible
 * precisely in the case where the prompt changed and nobody noticed.
 */
export class CassetteMissError extends Error {
  readonly key: string;
  readonly purpose: string;

  constructor(request: ModelRequest, key: string, libraryLabel: string, librarySize: number) {
    super(
      `No cassette for purpose "${request.purpose}" (key ${key.slice(0, 12)}…) in ` +
        `${libraryLabel} (${librarySize} cassette(s)).\n` +
        'The request has changed, or was never recorded. Nothing is invented to fill the ' +
        'gap: re-record against a live transport, or author a cassette and mark it authored.',
    );
    this.name = 'CassetteMissError';
    this.key = key;
    this.purpose = request.purpose;
  }
}

export interface RecordedTransportOptions {
  /** Shown in miss messages. A directory path, usually. */
  readonly label?: string;
  readonly id?: string;
}

/**
 * Replays recorded or authored responses. No network, no credentials, no clock.
 *
 * The counterpart of `DeterministicEmbedder` in `@mae/fields`: an offline implementation of
 * an interface whose real version needs an API key, so that everything above the seam can be
 * tested in CI. And with the same warning attached — replaying an authored cassette shows
 * that the runtime handles a response of that shape. It says nothing about whether a model
 * would produce one.
 *
 * Performs no I/O itself. Cassettes are handed in already parsed and validated, which keeps
 * the lookup and the provenance rules testable without a filesystem.
 */
export class RecordedTransport implements ModelTransport {
  readonly id: string;
  readonly label: string;
  #byKey: Map<string, Cassette>;

  constructor(cassettes: readonly Cassette[], options: RecordedTransportOptions = {}) {
    this.id = options.id ?? 'recorded';
    this.label = options.label ?? 'the in-memory cassette library';
    this.#byKey = new Map();

    for (const cassette of cassettes) {
      const existing = this.#byKey.get(cassette.key);
      if (existing !== undefined) {
        throw new Error(
          `Two cassettes claim key ${cassette.key.slice(0, 12)}… (purpose ` +
            `"${cassette.request.purpose}", origins ${existing.origin} and ${cassette.origin}). ` +
            'Identical requests must have one recorded answer, or the replay picks arbitrarily.',
        );
      }
      this.#byKey.set(cassette.key, cassette);
    }
  }

  get size(): number {
    return this.#byKey.size;
  }

  /** The cassettes held, in insertion order. Used by tooling that reports library contents. */
  cassettes(): Cassette[] {
    return [...this.#byKey.values()];
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = cassetteKey(request);
    const cassette = this.#byKey.get(key);
    if (cassette === undefined) {
      throw new CassetteMissError(request, key, this.label, this.#byKey.size);
    }

    const stored = cassette.response;
    // Constructed field by field rather than spread. A spread would carry any extra property
    // on the stored object into the response — including a `provenance` one — and the whole
    // point is that provenance is decided here and nowhere else.
    return {
      text: stored.text,
      stopReason: stored.stopReason,
      model: stored.model,
      usage: { inputTokens: stored.usage.inputTokens, outputTokens: stored.usage.outputTokens },
      ...(stored.refusalCategory === undefined ? {} : { refusalCategory: stored.refusalCategory }),
      provenance: PROVENANCE_BY_ORIGIN[cassette.origin],
      transportId: this.id,
    };
  }

  /** The key a request would look up. Exposed for tooling that reports misses in bulk. */
  keyFor(request: ModelRequest): string {
    return cassetteKey(request);
  }

  /** Whether a request would replay. Never used to decide whether to call live. */
  has(request: ModelRequest): boolean {
    return this.#byKey.has(cassetteKey(request));
  }
}
