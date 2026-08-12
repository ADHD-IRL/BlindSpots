import { createHash } from 'node:crypto';
import { canonicalJson } from '@mae/core';
import type { CanonicalObject, ModelRequest, ResolvedModelRequest } from './types.ts';

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
  return {
    purpose: request.purpose,
    model: request.model,
    maxTokens: request.maxTokens,
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: request.thinking ?? DEFAULT_THINKING,
    effort: request.effort ?? DEFAULT_EFFORT,
    outputSchema: request.outputSchema ?? null,
  };
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
