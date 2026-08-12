import { cassetteKey } from '../model/key.ts';
import {
  type ModelProvenance,
  type ModelRequest,
  type RecordedResponse,
  STOP_REASONS,
} from '../model/types.ts';

/**
 * Where a cassette's content came from.
 *
 * Declared, never inferred — the same rule the field ingest applies to `contentClass`, for
 * the same reason. Guessing `recorded` launders an invention into a captured model output;
 * guessing `authored` throws away a real capture. There is no safe default, so there is
 * none.
 *
 *  - `recorded` — a model produced this text and it was captured verbatim.
 *  - `authored` — a human wrote it so the runtime could be exercised without credentials.
 *    This is model output the way `fixtures/fields/` is curated expertise: neither.
 */
export const CASSETTE_ORIGINS = ['recorded', 'authored'] as const;
export type CassetteOrigin = (typeof CASSETTE_ORIGINS)[number];

/** Origin decides provenance. A cassette cannot assert its own. */
export const PROVENANCE_BY_ORIGIN: Readonly<Record<CassetteOrigin, ModelProvenance>> = {
  recorded: 'replayed',
  authored: 'authored',
};

export interface Cassette {
  /** `sha256(canonical_json(resolved_request))`. Verified on load, never trusted. */
  readonly key: string;
  readonly origin: CassetteOrigin;
  readonly capturedAt: string;
  /** Who captured or wrote it. Accountability attaches to a name, as everywhere else. */
  readonly capturedBy: string;
  /**
   * Required for `authored` cassettes: what this invented response is meant to exercise.
   * The counterpart of `gradedBy` on a field source — an invention with no stated purpose
   * is indistinguishable from a capture nobody can find.
   */
  readonly note?: string;
  readonly request: ModelRequest;
  readonly response: RecordedResponse;
}

export class CassetteIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CassetteIntegrityError';
  }
}

const STOP_REASON_SET: ReadonlySet<string> = new Set(STOP_REASONS);
const ORIGIN_SET: ReadonlySet<string> = new Set(CASSETTE_ORIGINS);

/**
 * Validates an untrusted cassette, from a file or anywhere else.
 *
 * The load-bearing check is the last one: the stored key is recomputed from the stored
 * request. Without it, editing a cassette's request while leaving its key alone silently
 * binds a response to a prompt that never produced it, and the replay looks perfect.
 */
export function assertCassette(value: unknown, where: string): Cassette {
  const fail = (message: string): never => {
    throw new CassetteIntegrityError(`${where}: ${message}`);
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('cassette must be a JSON object');
  }
  const c = value as Record<string, unknown>;

  if (typeof c['origin'] !== 'string' || !ORIGIN_SET.has(c['origin'])) {
    return fail(
      `cassette does not declare a valid origin (${CASSETTE_ORIGINS.join(' | ')}). There is ` +
        'no default: guessing "recorded" would present an invented response as model output.',
    );
  }
  const origin = c['origin'] as CassetteOrigin;

  if (typeof c['capturedBy'] !== 'string' || c['capturedBy'].trim() === '') {
    return fail('cassette has no capturedBy');
  }
  if (typeof c['capturedAt'] !== 'string' || Number.isNaN(Date.parse(c['capturedAt']))) {
    return fail('cassette has no valid capturedAt timestamp');
  }

  const note = c['note'];
  if (note !== undefined && typeof note !== 'string') return fail('note must be a string');
  if (origin === 'authored' && (typeof note !== 'string' || note.trim() === '')) {
    return fail(
      'an authored cassette must carry a note saying what it exercises. No model produced ' +
        'this text; the note is the only thing that distinguishes it from one that did.',
    );
  }

  const request = c['request'];
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return fail('cassette has no request');
  }
  const q = request as Record<string, unknown>;
  // Checked before the key is computed, so a malformed request fails as "no purpose" rather
  // than as a canonical-JSON error thrown from inside the hash.
  for (const field of ['purpose', 'model', 'system'] as const) {
    if (typeof q[field] !== 'string' || q[field] === '') return fail(`request.${field} is required`);
  }
  if (typeof q['maxTokens'] !== 'number' || !Number.isInteger(q['maxTokens']) || q['maxTokens'] <= 0) {
    return fail('request.maxTokens must be a positive integer');
  }
  if (!Array.isArray(q['messages']) || q['messages'].length === 0) {
    return fail('request.messages must be a non-empty array');
  }
  for (const m of q['messages'] as unknown[]) {
    const msg = m as Record<string, unknown>;
    if (typeof m !== 'object' || m === null) return fail('each message must be an object');
    if (msg['role'] !== 'user' && msg['role'] !== 'assistant') {
      return fail('each message needs role "user" or "assistant"');
    }
    if (typeof msg['content'] !== 'string') return fail('each message needs string content');
  }

  const response = c['response'];
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return fail('cassette has no response');
  }
  const r = response as Record<string, unknown>;

  if ('provenance' in r) {
    return fail(
      'stored responses must not carry a provenance field. Provenance is stamped by the ' +
        'transport from the cassette origin; a stored one would let a file claim to be live.',
    );
  }
  if (typeof r['text'] !== 'string') return fail('response.text must be a string');
  if (typeof r['stopReason'] !== 'string' || !STOP_REASON_SET.has(r['stopReason'])) {
    return fail(`response.stopReason must be one of ${STOP_REASONS.join(', ')}`);
  }
  if (typeof r['model'] !== 'string' || r['model'] === '') return fail('response.model is required');

  const usage = r['usage'];
  if (
    typeof usage !== 'object' ||
    usage === null ||
    typeof (usage as Record<string, unknown>)['inputTokens'] !== 'number' ||
    typeof (usage as Record<string, unknown>)['outputTokens'] !== 'number'
  ) {
    return fail('response.usage must carry numeric inputTokens and outputTokens');
  }

  const refusalCategory = r['refusalCategory'];
  if (refusalCategory !== undefined && typeof refusalCategory !== 'string') {
    return fail('response.refusalCategory must be a string');
  }
  if (r['stopReason'] !== 'refusal' && refusalCategory !== undefined) {
    return fail('response.refusalCategory is only meaningful on a refusal');
  }

  const schema = q['outputSchema'];
  if (schema !== undefined && (typeof schema !== 'object' || schema === null || Array.isArray(schema))) {
    return fail('request.outputSchema must be a JSON object');
  }

  const typedRequest = request as ModelRequest;
  // `resolveRequest` validates `thinking` and `effort` on the way into the hash. Catching it
  // here is what turns "thinking is banana" into a message naming the file it came from.
  let computed: string;
  try {
    computed = cassetteKey(typedRequest);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (typeof c['key'] !== 'string' || c['key'] === '') return fail('cassette has no key');
  if (c['key'] !== computed) {
    return fail(
      `key does not match its request (stored ${String(c['key']).slice(0, 12)}…, computed ` +
        `${computed.slice(0, 12)}…). Either the request was edited after capture or the ` +
        'response belongs to a different prompt.',
    );
  }

  return {
    key: computed,
    origin,
    capturedAt: c['capturedAt'],
    capturedBy: c['capturedBy'],
    ...(note === undefined ? {} : { note }),
    request: typedRequest,
    response: {
      text: r['text'],
      stopReason: r['stopReason'] as RecordedResponse['stopReason'],
      model: r['model'],
      usage: {
        inputTokens: (usage as { inputTokens: number }).inputTokens,
        outputTokens: (usage as { outputTokens: number }).outputTokens,
      },
      ...(refusalCategory === undefined ? {} : { refusalCategory }),
    },
  };
}
