import { describe, expect, it } from 'vitest';
import { cassetteKey, resolveRequest } from '../src/model/key.ts';
import type { ModelRequest } from '../src/model/types.ts';

const base: ModelRequest = {
  purpose: 'phase1_finding',
  model: 'claude-opus-5',
  maxTokens: 2048,
  system: 'You are a domain persona.',
  messages: [{ role: 'user', content: 'State one finding.' }],
};

describe('the cassette key', () => {
  it('does not depend on the order the request object was built in', () => {
    // The reason `canonicalJson` is used rather than JSON.stringify. A request assembled by
    // spreading defaults last would otherwise key differently from the same request
    // assembled the other way round, and the miss would be unexplainable.
    const reordered = {
      messages: base.messages,
      system: base.system,
      maxTokens: base.maxTokens,
      model: base.model,
      purpose: base.purpose,
    };
    expect(cassetteKey(reordered)).toBe(cassetteKey(base));
  });

  it('treats an omitted default and an explicit one as the same request', () => {
    // Both produce byte-identical API calls, so they must replay against one cassette.
    expect(cassetteKey({ ...base, thinking: 'adaptive', effort: 'high' })).toBe(cassetteKey(base));
  });

  it('separates calls that differ only in purpose', () => {
    // Same prompt serving two steps of the protocol is two calls, and the ledger has to be
    // able to say which one it was.
    expect(cassetteKey({ ...base, purpose: 'challenge_response' })).not.toBe(cassetteKey(base));
  });

  it.each([
    ['model', { model: 'claude-sonnet-5' }],
    ['maxTokens', { maxTokens: 4096 }],
    ['system', { system: 'You are a challenger persona.' }],
    ['effort', { effort: 'low' as const }],
    ['thinking', { thinking: 'disabled' as const }],
    ['outputSchema', { outputSchema: { type: 'object' } }],
    ['messages', { messages: [{ role: 'user' as const, content: 'State two findings.' }] }],
  ])('changes when %s changes', (_field, patch) => {
    expect(cassetteKey({ ...base, ...patch })).not.toBe(cassetteKey(base));
  });

  it('resolves defaults exactly once, for both hashing and dispatch', () => {
    const resolved = resolveRequest(base);
    expect(resolved.thinking).toBe('adaptive');
    expect(resolved.effort).toBe('high');
    expect(resolved.outputSchema).toBeNull();
  });

  it('ignores properties that are not part of the request', () => {
    // A caller passing its own bookkeeping alongside a request must not shift the key, or
    // recordings become unreplayable for a reason invisible in the prompt.
    const withExtra = { ...base, requestedAt: '2026-08-11T00:00:00.000Z' } as ModelRequest;
    expect(cassetteKey(withExtra)).toBe(cassetteKey(base));
  });
});
