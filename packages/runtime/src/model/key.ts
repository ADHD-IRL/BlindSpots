import { createHash } from 'node:crypto';
import { canonicalJson } from '@mae/core';
import {
  EFFORT_LEVELS,
  type CanonicalObject,
  type ModelRequest,
  type ResolvedModelRequest,
} from './types.ts';

/**
 * Defaults, applied in exactly one place.
 *
 * Adaptive thinking, per the current API guidance for this model family. High effort because
 * the work these personas do is adversarial reasoning over graded evidence, where the
 * characteristic failure is a fluent invention rather than a slow answer. Callers can lower
 * it; they cannot leave it unstated, because an unstated parameter is one the server may
 * change under a recording and a replay alike.
 */
export const DEFAULT_THINKING = 'adaptive';
export const DEFAULT_EFFORT = 'high';

/**
 * Resolves a request to the exact shape that is both hashed and sent.
 *
 * Every optional field becomes concrete here. Two requests that would produce identical API
 * calls must produce identical keys — otherwise `{}` and `{ thinking: 'adaptive' }` record
 * under different keys, and the second one misses against a cassette captured with the
 * first for no reason a reader could ever find.
 */
export function resolveRequest(request: ModelRequest): ResolvedModelRequest {
  const thinking = request.thinking ?? DEFAULT_THINKING;
  const effort = request.effort ?? DEFAULT_EFFORT;

  // Checked here rather than only at the type level, because requests also arrive from
  // cassette files, which are JSON and can say anything. This is the single choke point both
  // the hash and the API call pass through, so validating here closes both at once. It
  // matters most for `thinking`: the transport maps it with a two-way branch, so an
  // unrecognised value would silently become `disabled` — a request that quietly stops
  // asking for reasoning and replays forever as though it never had.
  if (thinking !== 'adaptive' && thinking !== 'disabled') {
    throw new InvalidModelRequestError('thinking', thinking, ['adaptive', 'disabled']);
  }
  if (!EFFORT_SET.has(effort)) {
    throw new InvalidModelRequestError('effort', effort, [...EFFORT_LEVELS]);
  }

  return {
    purpose: request.purpose,
    model: request.model,
    maxTokens: request.maxTokens,
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    thinking,
    effort,
    outputSchema: request.outputSchema ?? null,
  };
}

const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);

export class InvalidModelRequestError extends Error {
  readonly field: string;

  constructor(field: string, value: unknown, permitted: readonly string[]) {
    super(
      `Model request field "${field}" is ${JSON.stringify(value)}; permitted values are ` +
        `${permitted.join(', ')}. An unrecognised value would be mapped to a default and ` +
        'sent as a request nobody wrote.',
    );
    this.name = 'InvalidModelRequestError';
    this.field = field;
  }
}

/**
 * The canonical form of a resolved request.
 *
 * Built field by field rather than by spreading the object, so a stray property on a caller's
 * request object cannot change the key, and an `undefined` cannot reach `canonicalJson` and
 * throw there.
 */
export function canonicalRequest(request: ModelRequest): CanonicalObject {
  const r = resolveRequest(request);
  return {
    purpose: r.purpose,
    model: r.model,
    maxTokens: r.maxTokens,
    system: r.system,
    messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: r.thinking,
    effort: r.effort,
    outputSchema: r.outputSchema,
  };
}

/**
 * `key = sha256(canonical_json(resolved_request))`.
 *
 * Reuses the ledger's canonical serializer rather than `JSON.stringify` for the same reason
 * the ledger does: key order must not decide identity. A cassette recorded from a request
 * built one way has to replay against the same request built another.
 */
export function cassetteKey(request: ModelRequest): string {
  return createHash('sha256').update(canonicalJson(canonicalRequest(request)), 'utf8').digest('hex');
}
