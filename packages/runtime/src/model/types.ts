import type { CanonicalValue } from '@mae/core';

/**
 * The model transport seam.
 *
 * Everything above this line is deterministic and tested; everything below it is a network
 * call to a system whose output is not reproducible. Putting the boundary in one small
 * interface is what lets the persona runtime — the charter loop, the repair reducer, the
 * ledger writes — be built and tested before any model is called, and what lets a run be
 * replayed afterwards.
 */
export interface ModelTransport {
  /** Recorded on every response and written to the ledger. Identifies *what answered*. */
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * Where a response came from.
 *
 * Three values, not two, and the distinction is the same one the field content carries
 * (`ContentClass` in `@mae/core`). `replayed` means a model produced this text once and it
 * was captured; `authored` means no model ever produced it — a human wrote the cassette so
 * the runtime could be exercised. A run built on authored cassettes demonstrates that the
 * machinery works. It demonstrates nothing whatsoever about what a model would say.
 *
 * This is not a field a caller supplies. It is derived from the transport that produced the
 * response and from the cassette's declared origin, so it cannot be claimed.
 */
export const MODEL_PROVENANCE = ['live', 'replayed', 'authored'] as const;
export type ModelProvenance = (typeof MODEL_PROVENANCE)[number];

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** Reasoning effort (`output_config.effort`). Sent explicitly so it is part of the key. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * A JSON Schema for structured output, typed as a canonical object so it is guaranteed
 * hashable. A schema containing `undefined` would throw in `canonicalJson` rather than
 * silently hashing to something else, but typing it out is cheaper than discovering that.
 */
export type CanonicalObject = { readonly [key: string]: CanonicalValue };

export interface ModelRequest {
  /**
   * What this call is for — `phase1_finding`, `challenge_response`, and so on.
   *
   * Part of the hashed request, deliberately. Two calls with identical prompts serving
   * different steps of the protocol are different calls, and the ledger needs to say which
   * one it was. It also gives cassette files a name a human can read.
   */
  readonly purpose: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  /**
   * Adaptive thinking is the default. `budget_tokens` is deliberately absent: it is rejected
   * with a 400 on this model family, and so are `temperature`, `top_p` and `top_k`. There is
   * no knob here to set them, which is the point — a request shape that cannot express a
   * removed parameter cannot drift back to one.
   */
  readonly thinking?: 'adaptive' | 'disabled';
  readonly effort?: Effort;
  readonly outputSchema?: CanonicalObject;
}

/**
 * A request with every default resolved.
 *
 * Both the cassette key and the live API call are computed from this, never from the raw
 * request. If they were computed separately, a default applied on one path and not the
 * other would produce a cassette that can never be replayed — a miss with no visible cause.
 */
export interface ResolvedModelRequest {
  readonly purpose: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly thinking: 'adaptive' | 'disabled';
  readonly effort: Effort;
  readonly outputSchema: CanonicalObject | null;
}

/**
 * Stop reasons, mirroring the Messages API.
 *
 * `refusal` is in the list because it must be checked before the content is read: on a
 * refusal there is no usable content, and code that reads `text` first sees an empty string
 * and treats it as an empty answer.
 */
export const STOP_REASONS = [
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'pause_turn',
  'refusal',
  'model_context_window_exceeded',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * A response as it is stored in a cassette.
 *
 * Note what is *not* here: `provenance`. A stored response carries no claim about where it
 * came from, because a stored claim is a forgeable one — a hand-authored file asserting
 * `provenance: "live"` would replay as a live result forever. Provenance is stamped by the
 * transport at the moment of delivery and derived from the cassette's declared origin.
 */
export interface RecordedResponse {
  readonly text: string;
  readonly stopReason: StopReason;
  /** The model that actually answered, which may differ from the one requested. */
  readonly model: string;
  readonly usage: ModelUsage;
  /** Set only on `stop_reason: refusal`. The policy category the API reported. */
  readonly refusalCategory?: string;
}

export interface ModelResponse extends RecordedResponse {
  readonly provenance: ModelProvenance;
  /** The transport that delivered this response. */
  readonly transportId: string;
}

/**
 * A response is usable only if the model finished saying what it had to say.
 *
 * Both failure modes here are ones that look like success to a careless caller. A refusal
 * arrives with empty content, which parses as "the persona found nothing". A `max_tokens`
 * stop arrives with *truncated* content, which — under structured output — is invalid JSON
 * at best and a finding missing its caveats at worst. Neither may be quietly turned into a
 * finding, so both throw.
 */
export function assertUsable(response: ModelResponse): ModelResponse {
  if (response.stopReason === 'refusal') {
    throw new ModelRefusalError(response);
  }
  if (response.stopReason === 'max_tokens' || response.stopReason === 'model_context_window_exceeded') {
    throw new TruncatedResponseError(response);
  }
  return response;
}

export class ModelRefusalError extends Error {
  readonly response: ModelResponse;

  constructor(response: ModelResponse) {
    super(
      `Model refused the request${response.refusalCategory === undefined ? '' : ` (${response.refusalCategory})`}. ` +
        'A refusal is a routing event, not an empty finding: it is logged and referred, ' +
        'never treated as "the persona had nothing to say".',
    );
    this.name = 'ModelRefusalError';
    this.response = response;
  }
}

export class TruncatedResponseError extends Error {
  readonly response: ModelResponse;

  constructor(response: ModelResponse) {
    super(
      `Model output stopped at "${response.stopReason}" and is therefore incomplete. A ` +
        'truncated finding is not a shorter finding — its caveats, grades and gap ' +
        'declarations are exactly the parts that come last.',
    );
    this.name = 'TruncatedResponseError';
    this.response = response;
  }
}
